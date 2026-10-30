import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ECheckpointKind } from '@agent/core/constants';
import {
  AnswerResult,
  buildAnswer,
} from '../../../contracts/engine/orchestration-answer.types';
import {
  EExecutionEngineMode,
  EForcedExecutionMode,
  EngineExecutionContext,
  EngineRoutingContext,
  IExecutionEngine,
} from '../../../contracts/engine/execution-engine.interface';
import {
  EDeterministicNodeType,
  DeterministicGraphDefinition,
  DeterministicStepConfig,
} from '../../../contracts/engine/deterministic-graph.interface';
import { PipelineDefinition } from '../../../contracts/engine/pipeline-chaining.interface';
import { FanoutDefinition } from '../../../contracts/engine/parallel-fanout.interface';
import {
  IWorkflowRegistry,
  WORKFLOW_REGISTRY,
} from '../../../contracts/engine/agent-workflow.types';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { assertNotCancelled } from '../../cancellation/assert-not-cancelled.util';
import { IToolProvider, TOOL_PROVIDER } from '../../../contracts';
import { ToolCallTraceDto } from '../../../contracts/dtos/react-loop.dto';
import { ExecutedStepDto } from '../../../contracts/dtos/message-client.dto';
import { CheckpointService } from '../../hitl/checkpoint.service';
import { executeApprovedTool } from '../../hitl/utils/approved-tool-execution.util';
import { CheckpointResponseDto } from '../../../contracts/dtos/checkpoint.dto';
import {
  buildApprovedToolFailureMessage,
  buildClarifiedPrompt,
} from './utils/engine-prompt.util';
import { DeterministicSingleRunner } from './deterministic/deterministic-single.runner';
import { DeterministicSequenceRunner } from './deterministic/deterministic-sequence.runner';
import { DeterministicParallelRunner } from './deterministic/deterministic-parallel.runner';

/**
 * DeterministicEngine
 *
 * Thái cực 1: Động cơ thực thi kịch bản định sẵn (Unified Graph Orchestrator).
 * Hoạt động như một Orchestrator Facade tinh gọn, ủy quyền thực thi cho các runner con:
 * - DeterministicSingleRunner: Node 1-Step Fixed Workflow
 * - DeterministicSequenceRunner: Node Chuỗi tuần tự (Sequential DAG / Pipeline)
 * - DeterministicParallelRunner: Node Cụm song song Fork-Join (Fan-out) + Safe HITL Guard
 */
@Injectable()
export class DeterministicEngine implements IExecutionEngine {
  readonly id = EExecutionEngineMode.DETERMINISTIC;
  readonly name = 'Deterministic Execution Engine (Unified Graph)';
  readonly priority = 20;

  private readonly logger = new Logger(DeterministicEngine.name);

  constructor(
    private readonly singleRunner: DeterministicSingleRunner,
    private readonly sequenceRunner: DeterministicSequenceRunner,
    private readonly parallelRunner: DeterministicParallelRunner,
    private readonly cancellation: AgentCancellationService,
    @Optional()
    @Inject(TOOL_PROVIDER)
    private readonly toolProvider?: IToolProvider,
    @Optional()
    private readonly checkpointService?: CheckpointService,
    @Optional()
    @Inject(WORKFLOW_REGISTRY)
    private readonly workflowRegistry?: IWorkflowRegistry,
  ) {}

  canHandle(context: EngineRoutingContext): boolean {
    if (
      context.forcedMode === EForcedExecutionMode.DETERMINISTIC ||
      context.forcedMode === EForcedExecutionMode.PIPELINE ||
      context.forcedMode === EForcedExecutionMode.FANOUT
    ) {
      return true;
    }
    if (context.forcedMode && context.forcedMode !== EForcedExecutionMode.AUTO) {
      return false;
    }
    return Boolean(
      context.workflowId ||
      context.metadata?.graph ||
      context.metadata?.pipeline ||
      context.metadata?.fanout,
    );
  }

  async execute(context: EngineExecutionContext): Promise<AnswerResult> {
    const { data, replyMessageId, signal } = context;
    await assertNotCancelled(this.cancellation, replyMessageId, signal);

    // 1. Chạy Fixed Workflow khi có workflowId
    const workflowId = data.workflowId;
    if (workflowId && this.workflowRegistry) {
      const workflow = this.workflowRegistry.get(workflowId);
      if (workflow) {
        this.logger.log(
          `[DeterministicEngine] Chạy fixed workflow "${workflowId}" (${workflow.name}) cho turn ${replyMessageId}`,
        );
        return this.singleRunner.run(workflow, context);
      }
    }

    // 2. Chạy đồ thị hợp nhất mới (metadata.graph)
    const graph = context.metadata?.graph as DeterministicGraphDefinition | undefined;
    if (graph) {
      const node = graph.rootNode;
      switch (node.kind) {
        case EDeterministicNodeType.SINGLE:
          return this.singleRunner.run(
            {
              id: node.config.id,
              name: node.config.name,
              systemPrompt: node.config.systemPrompt,
              tools: node.config.tools,
              skills: node.config.skills,
              model: node.config.model,
              provider: node.config.provider,
              requireHumanApprovalFor: node.config.requireHumanApprovalFor,
            },
            context,
          );
        case EDeterministicNodeType.SEQUENCE:
          return this.sequenceRunner.run(node.steps, context, graph.id);
        case EDeterministicNodeType.PARALLEL:
          return this.parallelRunner.run(node.config, context);
      }
    }

    // 3. Tương thích ngược: metadata.pipeline (Pipeline Chaining cũ)
    const pipeline = context.metadata?.pipeline as PipelineDefinition | undefined;
    if (pipeline) {
      const steps: DeterministicStepConfig[] = pipeline.steps.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        promptTemplate: s.promptTemplate,
        systemPrompt: s.systemPrompt,
        model: s.model,
        tools: s.tools,
        skills: s.skills,
        provider: s.provider,
        outputSchema: s.outputSchema,
        condition: s.condition,
        branchMap: s.branchMap,
        defaultNextStepId: s.defaultNextStepId,
        failurePolicy: s.failurePolicy,
        maxStepRetries: s.maxStepRetries,
        transform: s.transform,
      }));
      return this.sequenceRunner.run(steps, context, pipeline.id);
    }

    // 4. Tương thích ngược: metadata.fanout (Parallel Fanout cũ)
    const fanout = context.metadata?.fanout as FanoutDefinition | undefined;
    if (fanout) {
      return this.parallelRunner.run(
        {
          id: fanout.id,
          name: fanout.name,
          workers: fanout.workers.map((w) => ({
            id: w.id,
            name: w.name,
            prompt: w.prompt,
            provider: w.provider,
            tools: w.tools,
          })),
          maxConcurrency: fanout.maxConcurrency,
          aggregatorModel: fanout.aggregatorModel,
        },
        context,
      );
    }

    throw new Error(
      `[DeterministicEngine] Không tìm thấy cấu hình đồ thị hoặc workflow hợp lệ cho turn ${replyMessageId}`,
    );
  }

  async resume(checkpoint: CheckpointResponseDto): Promise<AnswerResult> {
    const { replyMessageId, kind } = checkpoint;
    this.logger.log(`[DeterministicEngine] Khép kín Resume cho turn ${replyMessageId} (kind=${kind})`);

    if (kind === ECheckpointKind.CLARIFICATION) {
      const selected = checkpoint.selectedProvider ?? checkpoint.pendingTask ?? '';
      const clarifiedPrompt = buildClarifiedPrompt(
        checkpoint.originalPrompt,
        selected,
        checkpoint.selectedProvider,
      );

      const context: EngineExecutionContext = {
        data: {
          userId: checkpoint.userId,
          channelId: checkpoint.channelId,
          conversationId: checkpoint.conversationId ?? checkpoint.channelId,
          messageId: checkpoint.replyMessageId,
          workspaceId: checkpoint.workspaceId,
          channelType: checkpoint.channelType,
          sessionType: checkpoint.sessionType,
          workflowId: (checkpoint as unknown as { workflowId?: string }).workflowId,
        },
        metadata: (checkpoint as unknown as { metadata?: EngineExecutionContext['metadata'] }).metadata,
        replyMessageId: checkpoint.replyMessageId,
        prompt: clarifiedPrompt,
        agents: [],
        history: checkpoint.history,
      };

      return this.execute(context);
    }

    if (kind === ECheckpointKind.APPROVAL) {
      const pendingTool = checkpoint.pendingTool;
      if (!pendingTool) {
        throw new Error(`[DeterministicEngine] Checkpoint ${checkpoint.id} thiếu pendingTool`);
      }

      if (!this.toolProvider) {
        throw new Error('[DeterministicEngine] Thiếu toolProvider để thực thi tool đã duyệt');
      }

      const {
        resultText: toolResultText,
        isError,
        trace: executedToolTrace,
      } = await executeApprovedTool(
        {
          toolProvider: this.toolProvider,
          markToolExecuted: this.checkpointService
            ? (dto) => this.checkpointService!.markToolExecuted(dto)
            : undefined,
        },
        checkpoint,
        pendingTool,
      );

      if (isError) {
        return buildAnswer(buildApprovedToolFailureMessage(pendingTool.name, toolResultText), []);
      }

      const allToolCalls: ToolCallTraceDto[] = [
        ...(checkpoint.toolCalls ?? []),
        executedToolTrace,
      ];

      const executedSteps: ExecutedStepDto[] = (checkpoint.roundsSoFar ?? []).map((r) => ({
        agent: r.agent,
        task: r.task,
        result: r.result,
        toolCalls: [],
      }));

      executedSteps.push({
        agent: pendingTool.provider,
        task: checkpoint.pendingTask ?? pendingTool.name,
        result: toolResultText,
        toolCalls: [executedToolTrace],
      });

      return buildAnswer(toolResultText, allToolCalls, executedSteps);
    }

    throw new Error(`[DeterministicEngine] Không hỗ trợ loại checkpoint kind=${kind}`);
  }
}
