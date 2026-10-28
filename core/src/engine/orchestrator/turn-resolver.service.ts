import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import {
  IMessageSink,
  MESSAGE_SINK,
  IWorkflowRegistry,
  WORKFLOW_REGISTRY,
  WORKFLOW_RUNNER,
  EXECUTION_ENGINE_REGISTRY,
  EXECUTION_ROUTER,
  EExecutionEngineMode,
  IExecutionEngineRegistry,
  IExecutionRouter,
} from '../../contracts';
import { SupervisorService } from '../supervisor/supervisor.service';
import { WorkflowRunnerService } from '../workflow/workflow-runner.service';
import { AnswerResult } from './orchestration-answer.types';
import { MemoryManagerService } from '../../memory/memory-manager.service';

/**
 * TurnResolverService
 *
 * Master Dispatcher (Tổng đài điều phối AI Orchestration).
 * Nhiệm vụ duy nhất:
 * 1. Thu thập ngữ cảnh câu hỏi, lịch sử và danh sách agent khả dụng.
 * 2. Phân loại tác vụ thông qua Execution Router.
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
    @Inject(WORKFLOW_RUNNER)
    private readonly workflowRunner?: WorkflowRunnerService,
  ) {}

  async resolveAnswer(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
  ): Promise<AnswerResult> {
    const { userId, channelId, messageId, workspaceId, workflowId } = data;
    const [prompt, agents, history] = await Promise.all([
      this.messageSink.getMessageText({ id: messageId, userId }),
      this.supervisor.getAvailableAgents(userId, workspaceId),
      this.messageSink.getRecentHistory({
        channelId,
        userId,
        beforeMessageId: messageId,
        limit: ORCHESTRATION_CONSTANTS.CHAT_HISTORY_LIMIT,
        charBudget: this.memoryManager.buildBudget(
          process.env.DEFAULT_REACT_MODEL ??
            ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
        ).historyCharBudget,
      }),
    ]);

    const isPipelineWorkflow =
      workflowId &&
      this.engineRegistry
        .get(EExecutionEngineMode.PIPELINE_CHAINING)
        ?.canHandle({
          userId: data.userId,
          workspaceId: data.workspaceId,
          channelId: data.channelId,
          workflowId,
          prompt: '',
        });

    if (!isPipelineWorkflow && workflowId && this.workflowRegistry && this.workflowRunner) {
      const workflow = this.workflowRegistry.get(workflowId);
      if (workflow) {
        this.logger.log(
          `Routing trực tiếp tới fixed workflow "${workflowId}" (${workflow.name}) cho turn ${replyMessageId}`,
        );
        const answer = await this.workflowRunner.runWorkflow({
          workflow,
          prompt,
          data,
          replyMessageId,
          history,
        });
        return { ...answer, routing: { mode: EExecutionEngineMode.WORKFLOW, label: workflow.name } };
      }
      this.logger.warn(
        `Không tìm thấy workflowId="${workflowId}" trong registry. Fallback về Dynamic Supervisor.`,
      );
    }

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
    const engine =
      this.engineRegistry.get(targetEngineId) ??
      this.engineRegistry.get(EExecutionEngineMode.DYNAMIC_SUPERVISOR);

    if (engine) {
      const answer = await engine.execute({ data, replyMessageId, prompt, agents, history });
      return { ...answer, routing: { mode: engine.id } };
    }

    throw new Error(
      `[TurnResolverService] Không tìm thấy engine "${targetEngineId}" để thực thi turn ${replyMessageId}`,
    );
  }

  private forcedModeFromEnv(): 'single' | 'supervisor' | 'auto' {
    const mode = process.env.DEFAULT_ORCHESTRATION_MODE;
    return mode === 'single' || mode === 'supervisor' ? mode : 'auto';
  }
}
