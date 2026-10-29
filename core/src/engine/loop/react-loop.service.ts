import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  ORCHESTRATION_SYSTEM_PROMPT,
  EAgentStreamStepType,
} from '@agent/core/constants';
import {
  RunReactLoopRequestDto,
  RunReactLoopResponseDto,
} from '../../contracts/dtos/react-loop.dto';
import { McpToolDto } from '../../contracts/dtos/mcp.dto';
import { LlmStrategyFactory } from '../strategy/llm-strategy.factory';
import {
  IToolProvider,
  TOOL_PROVIDER,
  IStreamSink,
  STREAM_SINK,
  ISkillCatalogReader,
  SKILL_CATALOG_READER,
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
import { formatPersonaPrompt } from './utils/persona-prompt.util';
import { PersonaDto } from '../../contracts/dtos/supervisor.dto';
import {
  ProviderPreflightGuard,
  BusinessPolicyEngine,
  PolicyCorpusService,
  SemanticPolicyEvaluatorService,
  IdempotencyManager,
  ActionAuditService,
} from '../../security';

// Provider đặc biệt của McpToolConnectorService trả các native tool dùng chung.
const NATIVE_PROVIDER = 'native';

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
    const onToken = (chunk: string) => {
      confirmedText += chunk;
      emitToken({ type: EAgentStreamStepType.TOKEN, text: chunk });
    };
    const resync = (text: string) => {
      confirmedText = text;
      emitToken({ type: EAgentStreamStepType.RESYNC, text });
    };

    return runCancellable(
      dto.messageId,
      this.cancellation,
      async (signal) => {
        const reactModelId =
          dto.model ??
          process.env.DEFAULT_REACT_MODEL ??
          ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;

        const targetProviders =
          dto.providers && dto.providers.length > 0
            ? dto.providers
            : [dto.provider];
        const primaryProvider = targetProviders[0];

        const [{ mcpTools, toolToProviderMap }, systemInstruction] =
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
          ]);

        if (signal.aborted) {
          throw new TurnCancelledError(undefined);
        }

        const { strategy, model } = this.llmFactory.resolve(reactModelId);
        // allowedTools chỉ giới hạn tool của provider; native tool (VD read_skill,
        // chỉ đọc) luôn có sẵn cho mọi engine.
        const effectiveTools =
          dto.allowedTools && dto.allowedTools.length > 0 && !dto.allowedTools.includes('*')
            ? mcpTools.filter(
                (t) =>
                  dto.allowedTools!.includes(t.name) ||
                  toolToProviderMap.get(t.name) === NATIVE_PROVIDER,
              )
            : mcpTools;

        // Level 1 của skill chỉ có ý nghĩa khi agent có read_skill — tránh chỉ dẫn
        // gọi tool không có (VD khi không có native tool nào được nạp).
        const skillCatalogText = effectiveTools.some(
          (t) => t.name === READ_SKILL_TOOL_NAME,
        )
          ? await this.loadSkillCatalog(dto.workspaceId)
          : '';
        const fullSystemInstruction = skillCatalogText
          ? `${systemInstruction}\n\n${skillCatalogText}`
          : systemInstruction;

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

        const reactLoopRun = new ReactLoopRun(
          {
            dto,
            mcpTools: effectiveTools,
            strategy,
            model,
            reactModelId,
            session,
            signal,
            repeatGuard,
            toolToProviderMap,
          },
          {
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
          },
        );

        return reactLoopRun.execute(onToken, resync);
      },
      () => new TurnCancelledError(confirmedText || undefined),
      parentSignal,
    );
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
    if (providers.includes(NATIVE_PROVIDER)) return loaded;

    try {
      const nativeTools = await this.toolProvider.getTools(
        NATIVE_PROVIDER,
        prompt,
        signal,
        workspaceId,
      );
      const taken = new Set(loaded.mcpTools.map((t) => t.name));
      for (const tool of nativeTools ?? []) {
        if (taken.has(tool.name)) continue;
        loaded.mcpTools.push(tool);
        loaded.toolToProviderMap.set(tool.name, NATIVE_PROVIDER);
      }
    } catch (error) {
      this.logger.warn(
        `Không thể nạp native tool: ${(error as Error)?.message}`,
      );
    }
    return loaded;
  }

  // Lỗi (VD DB chưa migrate) chỉ làm mất catalog, không được chặn lượt chạy.
  private async loadSkillCatalog(workspaceId?: string): Promise<string> {
    if (!this.skillCatalog) return '';
    try {
      return await this.skillCatalog.getCatalogForPrompt(workspaceId);
    } catch (error) {
      this.logger.warn(
        `Không thể nạp skill catalog: ${(error as Error)?.message}`,
      );
      return '';
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
    const mcpResources = (await this.toolProvider.getResources?.(
      provider,
      signal,
      workspaceId,
    )) ?? [];
    const resourceContents = await Promise.all(
      mcpResources.map(async (r) => {
        try {
          const content = (await this.toolProvider.readResource?.(
            provider,
            r.uri,
            userId,
            signal,
            workspaceId,
          )) ?? '';
          return `\n--- Resource: ${r.name} ---\n${capToolResultSize(content, this.memoryManager.buildBudget(modelId).toolResultCharBudget)}`;
        } catch (error) {
          this.logger.warn(
            `Failed to read resource ${r.uri}: ${(error as Error).message}`,
          );
          return '';
        }
      }),
    );

    let systemInstruction = ORCHESTRATION_SYSTEM_PROMPT;
    // Persona chỉ là chỉ dẫn văn bản — tập tool (mcpTools) ở run() không phụ thuộc vào nó.
    const personaPrompt = formatPersonaPrompt(persona);
    if (personaPrompt) {
      systemInstruction += `\n\n${personaPrompt}`;
    }
    const injectedResources = resourceContents.filter(Boolean).join('\n');
    if (injectedResources) {
      systemInstruction += `\n\nBạn có sẵn các Context/Resources sau trong bộ nhớ để tham khảo, tuyệt đối ưu tiên sử dụng thông tin này nếu liên quan đến câu hỏi của người dùng:\n${injectedResources}`;
    }

    // Context-Aware Policy Grounding: Tự động tiêm các quy chế doanh nghiệp liên quan trực tiếp vào System Prompt
    if (this.policyCorpus && userPrompt) {
      try {
        const relevant = await this.policyCorpus.findRelevantPolicies(userPrompt, {
          limit: 3,
          minScore: 0.15,
        });

        if (relevant.length > 0) {
          const policiesText = relevant
            .map((r) => `- [${r.chunk.id}] ${r.chunk.title}:\n  ${r.chunk.content}`)
            .join('\n\n');

          systemInstruction += `\n\n--- QUY CHẾ DOANH NGHIỆP BẮT BUỘC (ENTERPRISE POLICIES) ---\n` +
            `Các quy chế sau đây áp dụng trực tiếp cho yêu cầu của người dùng:\n\n${policiesText}\n\n` +
            `NGUYÊN TẮC THI HÀNH BẮT BUỘC:\n` +
            `Nếu yêu cầu của người dùng thuộc phạm vi cần phê duyệt (REQUIRE_APPROVAL) hoặc bị nghiêm cấm (DENY), ` +
            `bạn TUYỆT ĐỐI KHÔNG ĐƯỢC tự ý sinh script, file cấu hình (YAML, JSON), hoặc viết hướng dẫn chi tiết để người dùng tự làm thủ công nhằm lách quy chế. ` +
            `Hãy thông báo rõ ràng về điều khoản quy định và hướng dẫn người dùng xin phê duyệt từ cấp quản lý có thẩm quyền.`;
        }
      } catch (err) {
        this.logger.warn(`Lỗi truy xuất policy grounding: ${(err as Error).message}`);
      }
    }

    return systemInstruction;
  }
}
