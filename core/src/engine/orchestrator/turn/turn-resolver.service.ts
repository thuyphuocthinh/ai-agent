import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import {
  IMessageSink,
  MESSAGE_SINK,
  IWorkflowRegistry,
  WORKFLOW_REGISTRY,
  EXECUTION_ENGINE_REGISTRY,
  EXECUTION_ROUTER,
  EExecutionEngineMode,
  IExecutionEngineRegistry,
  IExecutionRouter,
} from '../../../contracts';
import { SupervisorService } from '../../supervisor/supervisor.service';
import { AgentDiscoveryService } from '../../discovery/agent-discovery.service';
import { AnswerResult } from '../../../contracts/engine/orchestration-answer.types';
import { MemoryManagerService } from '../../../memory/memory-manager.service';
import { EffectiveConversationContext } from '../../../contracts/memory/conversation-compaction.interface';
import { ConversationCompactionService } from '../context/conversation-compaction.service';

/**
 * TurnResolverService
 *
 * Master Dispatcher (Tổng đài điều phối AI Orchestration).
 * Nhiệm vụ duy nhất:
 * 1. Thu thập ngữ cảnh câu hỏi, lịch sử và danh sách agent khả dụng.
 * 2. Phân loại tác vụ thông qua Execution Router (Deterministic vs Autonomous).
 * 3. Phân bổ công việc tới Engine chuyên trách tương ứng trong Execution Engine Registry.
 *
 * Hoàn toàn tách biệt khỏi logic thực thi vòng lặp (Execution Engine).
 */
@Injectable()
export class TurnResolverService {
  private readonly logger = new Logger(TurnResolverService.name);

  constructor(
    @Inject(MESSAGE_SINK)
    private readonly messageSink: IMessageSink,
    private readonly supervisor: SupervisorService,
    private readonly memoryManager: MemoryManagerService,
    @Inject(EXECUTION_ENGINE_REGISTRY)
    private readonly engineRegistry: IExecutionEngineRegistry,
    @Inject(EXECUTION_ROUTER)
    private readonly router: IExecutionRouter,
    @Optional()
    @Inject(WORKFLOW_REGISTRY)
    private readonly workflowRegistry?: IWorkflowRegistry,
    @Optional()
    private readonly agentDiscovery?: AgentDiscoveryService,
    @Optional()
    private readonly compactionService?: ConversationCompactionService,
  ) {}

  async resolveAnswer(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
  ): Promise<AnswerResult> {
    const { userId, channelId, messageId, workspaceId, workflowId } = data;
    const conversationId = data.conversationId ?? channelId;
    const modelId =
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;
    const charBudget = this.memoryManager.buildBudget(modelId).historyCharBudget;

    const [prompt, agents, effectiveContext] = await Promise.all([
      data.prompt
        ? Promise.resolve(data.prompt)
        : this.messageSink.getMessageText({ id: messageId, userId }),
      this.agentDiscovery
        ? this.agentDiscovery.getAvailableAgents(userId, workspaceId)
        : this.supervisor.getAvailableAgents(userId, workspaceId),
      this.resolveContextTurns(
        conversationId,
        channelId,
        userId,
        messageId,
        modelId,
        charBudget,
      ),
    ]);
    const { summary: contextSummary, recentTurns: history } = effectiveContext;

    const decision = await this.router.route({
      prompt,
      userId: data.userId,
      workspaceId: data.workspaceId,
      channelId: data.channelId,
      messageId: replyMessageId,
      workflowId,
      history,
      availableAgents: agents,
      forcedMode: this.forcedModeFromEnv(),
    });

    const targetEngineId = decision.engineId ?? decision.mode;
    const engine = this.engineRegistry.get(targetEngineId);

    if (engine) {
      const answer = await engine.execute({
        data,
        replyMessageId,
        prompt,
        agents,
        history,
        ...(contextSummary ? { contextSummary } : {}),
        metadata: {
          forcedMode: this.forcedModeFromEnv(),
          routingDecision: decision,
        },
      });
      return { ...answer, routing: { mode: engine.id } };
    }

    throw new Error(
      `[TurnResolverService] Không tìm thấy engine "${targetEngineId}" để thực thi turn ${replyMessageId}`,
    );
  }

  private async resolveContextTurns(
    conversationId: string | undefined,
    channelId: string | undefined,
    userId: string,
    beforeMessageId: string,
    modelId: string,
    charBudget: number,
  ): Promise<EffectiveConversationContext> {
    if (this.compactionService && conversationId) {
      const compacted = await this.compactionService.loadEffectiveContext(
        conversationId,
        modelId,
      );
      if (compacted.summary || compacted.recentTurns.length > 0) {
        return compacted;
      }
    }
    const recentTurns = await this.messageSink.getRecentHistory({
      channelId,
      userId,
      beforeMessageId,
      limit: ORCHESTRATION_CONSTANTS.CHAT_HISTORY_LIMIT,
      charBudget,
    });
    return { recentTurns };
  }

  private forcedModeFromEnv(): string {
    const mode = process.env.DEFAULT_ORCHESTRATION_MODE;
    return mode ?? 'auto';
  }
}
