import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  ORCHESTRATION_SYSTEM_PROMPT,
  EAgentStreamStepType,
  NATIVE_TOOL_PROVIDER,
} from '@agent/core/constants';
import {
  RunReactLoopRequestDto,
  RunReactLoopResponseDto,
} from '../../contracts/dtos/react-loop.dto';
import { McpToolDto } from '../../contracts/dtos/mcp.dto';
import { ReactLoopRunDeps } from './react-loop.interface';
import { LlmStrategyFactory } from '../strategy/llm-strategy.factory';
import {
  IToolProvider,
  TOOL_PROVIDER,
  IStreamSink,
  STREAM_SINK,
  ISkillCatalogReader,
  SKILL_CATALOG_READER,
  ISkillMatch,
  ISkillMatcher,
  SKILL_MATCHER,
  ISkillPlaybookDetail,
} from '../../contracts';
import { CircuitBreakerService } from '../../infrastructure/resilience/circuit-breaker.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../cancellation/cancellable-run.util';
import { TurnCancelledError } from './errors/turn-cancelled.error';
import { capToolResultSize } from '../../common/text/token-budget.util';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { READ_SKILL_TOOL_NAME } from '../../infrastructure/tools/native/read-skill.tool';
import { ReactLoopRun } from './react-loop-run';
import { ToolRepeatGuard } from './guards/tool-repeat-guard';
import { TokenMicroBuffer } from './utils/token-micro-buffer.util';
import { formatPersonaPrompt } from './utils/persona-prompt.util';
import { resolveEffectiveTools } from './utils/effective-tools.util';
import {
  buildPolicyGroundingPrompt,
  buildResourcesPrompt,
  formatResourceBlock,
} from './utils/react-loop-prompt.util';
import {
  buildExplicitPlaybookBlock,
  buildSkillPlaybookBlock,
  formatSkillAutoloadLog,
} from './utils/skill-playbook-prompt.util';
import { loadSkillCatalogSafely } from './utils/skill-catalog-loader.util';
import { readSkillAutoloadConfig } from '../../common/skill-autoload.config';
import { PersonaDto } from '../../contracts/dtos/supervisor.dto';
import {
  ProviderPreflightGuard,
  BusinessPolicyEngine,
  PolicyCorpusService,
  SemanticPolicyEvaluatorService,
  IdempotencyManager,
  ActionAuditService,
} from '../../security';

// Ghi chú thiết kế đầy đủ (WHY): docs/orchestration/code-notes/react-loop.service.md
// Logic chi tiết 1 lượt chạy (tool call, self-check, quantity-nudge...) nằm
// ở ReactLoopRun (react-loop-run.ts) — file này chỉ dựng dependencies rồi giao việc.
@Injectable()
export class ReactLoopService {
  private readonly logger = new Logger(ReactLoopService.name);

  constructor(
    @Inject(TOOL_PROVIDER)
    private readonly toolProvider: IToolProvider,
    private readonly llmFactory: LlmStrategyFactory,
    @Inject(STREAM_SINK)
    private readonly streamSink: IStreamSink,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly cancellation: AgentCancellationService,
    private readonly memoryManager: MemoryManagerService,
    @Optional()
    private readonly preflightGuard?: ProviderPreflightGuard,
    @Optional()
    private readonly policyEngine?: BusinessPolicyEngine,
    @Optional()
    private readonly semanticPolicyEvaluator?: SemanticPolicyEvaluatorService,
    @Optional()
    private readonly policyCorpus?: PolicyCorpusService,
    @Optional()
    private readonly idempotencyManager?: IdempotencyManager,
    @Optional()
    private readonly actionAudit?: ActionAuditService,
    @Optional()
    @Inject(SKILL_CATALOG_READER)
    private readonly skillCatalog?: ISkillCatalogReader,
    @Optional()
    @Inject(SKILL_MATCHER)
    private readonly skillMatcher?: ISkillMatcher,
  ) {}

  async run(
    dto: RunReactLoopRequestDto,
    parentSignal?: AbortSignal,
    repeatGuard?: ToolRepeatGuard,
  ): Promise<RunReactLoopResponseDto> {
    let confirmedText = '';
    const emitToken = (step: { type: EAgentStreamStepType.TOKEN | EAgentStreamStepType.RESYNC; text: string }) => {
      this.streamSink
        .emitStep(
          {
            userId: dto.userId,
            channelId: dto.channelId,
            messageId: dto.messageId,
            channelType: dto.channelType,
            streamKey: dto.streamKey,
          },
          step,
        )
        .catch(() => {}); // fire and forget
    };
    const microBuffer = new TokenMicroBuffer((bufferedText) => {
      emitToken({ type: EAgentStreamStepType.TOKEN, text: bufferedText });
    });
    const onToken = (chunk: string) => {
      confirmedText += chunk;
      microBuffer.add(chunk);
    };
    const resync = (text: string) => {
      microBuffer.flush();
      confirmedText = text;
      emitToken({ type: EAgentStreamStepType.RESYNC, text });
    };

    return runCancellable(
      dto.messageId,
      this.cancellation,
      async (signal) => {
        try {
          const prepared = await this.prepareLoop(dto, signal);
          const reactLoopRun = new ReactLoopRun(
            {
              dto,
              mcpTools: prepared.effectiveTools,
              strategy: prepared.strategy,
              model: prepared.model,
              reactModelId: prepared.reactModelId,
              session: prepared.session,
              signal,
              repeatGuard,
              toolToProviderMap: prepared.toolToProviderMap,
            },
            this.buildRunDeps(),
          );

          return await reactLoopRun.execute(onToken, resync);
        } finally {
          microBuffer.flush();
        }
      },
      () => new TurnCancelledError(confirmedText || undefined),
      parentSignal,
    );
  }

  // Nạp tool + system instruction + dò khớp skill SONG SONG (không cộng độ trễ nối tiếp),
  // rồi dựng chat session cho lượt chạy.
  private async prepareLoop(dto: RunReactLoopRequestDto, signal: AbortSignal) {
    const reactModelId =
      dto.model ??
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;

    const targetProviders =
      dto.providers && dto.providers.length > 0
        ? dto.providers
        : [dto.provider];
    const primaryProvider = targetProviders[0];

    // Skill gán cứng (workflow/pipeline) thì không dò theo độ khớp. Dò khớp chạy
    // song song với nạp tool/prompt để không cộng thêm độ trễ nối tiếp.
    const forcedSkillSlugs = dto.skills ?? [];
    const [{ mcpTools, toolToProviderMap }, systemInstruction, skillMatches] =
      await Promise.all([
        this.loadToolsForProviders(
          targetProviders,
          dto.prompt,
          signal,
          dto.workspaceId,
        ),
        this.buildSystemInstruction(
          primaryProvider,
          dto.userId,
          reactModelId,
          signal,
          dto.workspaceId,
          dto.persona,
          dto.prompt,
        ),
        forcedSkillSlugs.length > 0
          ? Promise.resolve<ISkillMatch[]>([])
          : this.loadSkillMatches(dto.prompt, dto.workspaceId),
      ]);

    if (signal.aborted) {
      throw new TurnCancelledError(undefined);
    }

    const { strategy, model } = this.llmFactory.resolve(reactModelId);
    const effectiveTools = resolveEffectiveTools(
      mcpTools,
      toolToProviderMap,
      dto.allowedTools,
    );

    const skillPromptText =
      forcedSkillSlugs.length > 0
        ? await this.buildExplicitSkillPrompt(forcedSkillSlugs, dto.workspaceId)
        : await this.buildMatchedSkillPrompt(
            skillMatches,
            dto.workspaceId,
            effectiveTools.some((t) => t.name === READ_SKILL_TOOL_NAME),
          );

    const fullSystemInstruction = [
      systemInstruction,
      skillPromptText,
    ]
      .filter(Boolean)
      .join('\n\n');

    this.logger.log(
      `run() userId=${dto.userId} provider=${dto.provider} providers=${targetProviders.join(',')} model=${model} toolsAvailable=${effectiveTools.length}/${mcpTools.length}`,
    );

    const session = strategy.startChat({
      model,
      systemInstruction: fullSystemInstruction,
      tools: effectiveTools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
      history: dto.history,
      temperature: ORCHESTRATION_CONSTANTS.REACT_LOOP_TEMPERATURE,
    });

    return {
      reactModelId,
      strategy,
      model,
      session,
      effectiveTools,
      toolToProviderMap,
    };
  }

  private buildRunDeps(): ReactLoopRunDeps {
    return {
      toolProvider: this.toolProvider,
      streamSink: this.streamSink,
      mcpClient: this.toolProvider,
      agentStream: this.streamSink,
      circuitBreaker: this.circuitBreaker,
      memoryManager: this.memoryManager,
      logger: this.logger,
      preflightGuard: this.preflightGuard,
      policyEngine: this.policyEngine,
      semanticPolicyEvaluator: this.semanticPolicyEvaluator,
      idempotencyManager: this.idempotencyManager,
      actionAudit: this.actionAudit,
    };
  }

  // Native tool (VD read_skill) dùng chung cho mọi agent, không thuộc provider
  // nào — nạp thêm sau tool của provider; tool provider trùng tên được ưu tiên.
  private async loadToolsForProviders(
    providers: string[],
    prompt: string,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<{
    mcpTools: McpToolDto[];
    toolToProviderMap: Map<string, string>;
  }> {
    const loaded = await this.loadProviderTools(
      providers,
      prompt,
      signal,
      workspaceId,
    );
    if (providers.includes(NATIVE_TOOL_PROVIDER)) return loaded;

    try {
      const nativeTools = await this.toolProvider.getTools(
        NATIVE_TOOL_PROVIDER,
        prompt,
        signal,
        workspaceId,
      );
      const taken = new Set(loaded.mcpTools.map((t) => t.name));
      for (const tool of nativeTools ?? []) {
        if (taken.has(tool.name)) continue;
        loaded.mcpTools.push(tool);
        loaded.toolToProviderMap.set(tool.name, NATIVE_TOOL_PROVIDER);
      }
    } catch (error) {
      this.logger.warn(
        `Không thể nạp native tool: ${(error as Error)?.message}`,
      );
    }
    return loaded;
  }

  // Skill gán cứng cho lượt chạy (fixed workflow / pipeline): nạp 100% nội dung
  // hướng dẫn theo slug, bỏ qua dò khớp và catalog. Slug không có hoặc đã tắt bị
  // bỏ qua kèm cảnh báo; lỗi nạp (VD DB) chỉ làm mất phần này, không chặn lượt chạy.
  private async buildExplicitSkillPrompt(
    slugs: readonly string[],
    workspaceId?: string,
  ): Promise<string> {
    const catalog = this.skillCatalog;
    if (!catalog) return '';
    try {
      const found = await Promise.all(
        slugs.map((slug) => catalog.getSkillBySlug(slug, workspaceId)),
      );
      const skills = found.filter((s): s is ISkillPlaybookDetail => Boolean(s));
      const missing = slugs.filter(
        (slug) => !skills.some((s) => s.slug === slug),
      );
      if (missing.length > 0) {
        this.logger.warn(
          `[skill-explicit] không tìm thấy hoặc skill đã tắt: ${missing.join(', ')}`,
        );
      }
      this.logger.log(
        `[skill-explicit] loaded=${skills.map((s) => s.slug).join(',') || '-'}`,
      );
      return buildExplicitPlaybookBlock(skills);
    } catch (error) {
      this.logger.warn(
        `Không thể nạp skill gán cứng: ${(error as Error)?.message}`,
      );
      return '';
    }
  }

  // Skill khớp prompt (đã dò ở trên) nạp thẳng nội dung hướng dẫn, trong ngân
  // sách ký tự; skill đã nạp bỏ khỏi catalog Level 1 (chỉ nối khi có read_skill).
  private async buildMatchedSkillPrompt(
    matches: readonly ISkillMatch[],
    workspaceId: string | undefined,
    hasReadSkillTool: boolean,
  ): Promise<string> {
    const playbook = buildSkillPlaybookBlock(
      matches,
      readSkillAutoloadConfig().maxChars,
    );
    if (matches.length > 0) {
      this.logger.log(formatSkillAutoloadLog(matches, playbook));
    }

    const catalogText = hasReadSkillTool
      ? await loadSkillCatalogSafely(
          this.skillCatalog,
          this.logger,
          workspaceId,
          playbook.loadedSlugs,
        )
      : '';

    return [playbook.text, catalogText].filter(Boolean).join('\n\n');
  }

  // Lỗi/timeout embedding (hoặc DB chưa migrate) chỉ làm mất phần nạp tự động,
  // rơi về catalog — không được chặn lượt chạy.
  private async loadSkillMatches(
    prompt: string,
    workspaceId?: string,
  ): Promise<ISkillMatch[]> {
    if (!this.skillMatcher) return [];
    try {
      return await this.skillMatcher.match(prompt, workspaceId);
    } catch (error) {
      this.logger.warn(
        `Không thể nạp skill tự động: ${(error as Error)?.message}`,
      );
      return [];
    }
  }

  private async loadProviderTools(
    providers: string[],
    prompt: string,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<{
    mcpTools: McpToolDto[];
    toolToProviderMap: Map<string, string>;
  }> {
    const toolToProviderMap = new Map<string, string>();
    if (providers.length === 1) {
      const tools = await this.toolProvider.getTools(
        providers[0],
        prompt,
        signal,
        workspaceId,
      );
      tools.forEach((t) => toolToProviderMap.set(t.name, providers[0]));
      return { mcpTools: tools, toolToProviderMap };
    }

    const results = await Promise.allSettled(
      providers.map((p) =>
        this.toolProvider.getTools(p, prompt, signal, workspaceId),
      ),
    );

    const toolCounts = new Map<string, number>();
    const toolsByProvider: { provider: string; tools: McpToolDto[] }[] = [];

    results.forEach((res, i) => {
      const p = providers[i];
      if (res.status === 'fulfilled') {
        toolsByProvider.push({ provider: p, tools: res.value });
        res.value.forEach((t) => {
          toolCounts.set(t.name, (toolCounts.get(t.name) ?? 0) + 1);
        });
      } else {
        this.logger.warn(
          `Không thể nạp công cụ cho provider "${p}": ${(res.reason as Error)?.message}`,
        );
      }
    });

    const mcpTools: McpToolDto[] = [];
    toolsByProvider.forEach(({ provider: p, tools }) => {
      tools.forEach((t) => {
        const isCollision = (toolCounts.get(t.name) ?? 0) > 1;
        const resolvedName = isCollision ? `${p}__${t.name}` : t.name;
        toolToProviderMap.set(resolvedName, p);
        mcpTools.push({
          ...t,
          name: resolvedName,
        });
      });
    });

    return { mcpTools, toolToProviderMap };
  }

  private async buildSystemInstruction(
    provider: string,
    userId: string,
    modelId: string,
    signal?: AbortSignal,
    workspaceId?: string,
    persona?: PersonaDto,
    userPrompt?: string,
  ): Promise<string> {
    const resourceContents = await this.buildResourcesBlock(
      provider,
      userId,
      modelId,
      signal,
      workspaceId,
    );

    let systemInstruction = ORCHESTRATION_SYSTEM_PROMPT;
    // Persona chỉ là chỉ dẫn văn bản — tập tool (mcpTools) ở run() không phụ thuộc vào nó.
    const personaPrompt = formatPersonaPrompt(persona);
    if (personaPrompt) {
      systemInstruction += `\n\n${personaPrompt}`;
    }
    systemInstruction += buildResourcesPrompt(resourceContents);
    systemInstruction += await this.buildPolicyGroundingBlock(userPrompt);

    return systemInstruction;
  }

  // Đọc nội dung MCP resource của provider (cắt theo ngân sách); resource lỗi chỉ bị bỏ qua.
  private async buildResourcesBlock(
    provider: string,
    userId: string,
    modelId: string,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<string[]> {
    const mcpResources = (await this.toolProvider.getResources?.(
      provider,
      signal,
      workspaceId,
    )) ?? [];
    return Promise.all(
      mcpResources.map(async (r) => {
        try {
          const content = (await this.toolProvider.readResource?.(
            provider,
            r.uri,
            userId,
            signal,
            workspaceId,
          )) ?? '';
          return formatResourceBlock(
            r.name,
            capToolResultSize(
              content,
              this.memoryManager.buildBudget(modelId).toolResultCharBudget,
            ),
          );
        } catch (error) {
          this.logger.warn(
            `Failed to read resource ${r.uri}: ${(error as Error).message}`,
          );
          return '';
        }
      }),
    );
  }

  // Context-Aware Policy Grounding: Tự động tiêm các quy chế doanh nghiệp liên quan trực tiếp vào System Prompt
  private async buildPolicyGroundingBlock(userPrompt?: string): Promise<string> {
    if (!this.policyCorpus || !userPrompt) return '';
    try {
      const relevant = await this.policyCorpus.findRelevantPolicies(userPrompt, {
        limit: 3,
        minScore: 0.15,
      });

      return buildPolicyGroundingPrompt(relevant.map((r) => r.chunk));
    } catch (err) {
      this.logger.warn(`Lỗi truy xuất policy grounding: ${(err as Error).message}`);
      return '';
    }
  }
}
