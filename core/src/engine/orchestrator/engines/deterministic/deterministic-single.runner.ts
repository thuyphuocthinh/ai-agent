import { Injectable, Logger } from '@nestjs/common';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  buildAnswer,
} from '../../../../contracts/engine/orchestration-answer.types';
import {
  EExecutionEngineMode,
  EngineExecutionContext,
} from '../../../../contracts/engine/execution-engine.interface';
import { AgentWorkflowConfig } from '../../../../contracts/engine/agent-workflow.types';
import { ReactLoopService } from '../../../loop/react-loop.service';
import { CheckpointPauseService } from '../../../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../../../infrastructure/resilience/metrics-registry.service';
import { TurnCancelledError } from '../../../loop/errors/turn-cancelled.error';
import { ApprovalRequiredError } from '../../../loop/errors/approval-required.error';
import { ClarificationRequiredError } from '../../../../contracts/engine/clarification-required.error';
import { RunReactLoopRequestDto } from '../../../../contracts/dtos/react-loop.dto';
import { buildReactRequestIdentity } from '../../utils/react-request-identity.util';
import { AvailableAgentDto } from '../../../../contracts/dtos/supervisor.dto';

/**
 * DeterministicSingleRunner
 *
 * Chịu trách nhiệm thực thi Node 1-Step (Fixed Workflow) trong Deterministic Engine.
 * Hỗ trợ khép kín cả Clarification và Approval HITL.
 */
@Injectable()
export class DeterministicSingleRunner {
  private readonly logger = new Logger(DeterministicSingleRunner.name);

  constructor(
    private readonly reactLoop: ReactLoopService,
    private readonly checkpointPause: CheckpointPauseService,
    private readonly metrics: MetricsRegistryService,
  ) {}

  async run(
    workflow: AgentWorkflowConfig,
    context: EngineExecutionContext,
  ): Promise<AnswerResult> {
    const { data, replyMessageId, prompt, history, signal } = context;

    const requestDto: RunReactLoopRequestDto = {
      prompt,
      provider: workflow.provider ?? 'compute',
      ...buildReactRequestIdentity(data),
      messageId: replyMessageId,
      history,
      model: workflow.model,
      persona: {
        role: workflow.name,
        goal: workflow.systemPrompt,
      },
      allowedTools: workflow.tools ? [...workflow.tools] : undefined,
      skills: workflow.skills ? [...workflow.skills] : undefined,
    };

    try {
      const result = await this.reactLoop.run(requestDto, signal);
      return buildAnswer(result.answer, result.toolCalls, [
        {
          agent: workflow.id,
          task: prompt,
          persona: { role: workflow.name, goal: workflow.systemPrompt },
          toolCalls: result.toolCalls,
          result: result.answer,
        },
      ]);
    } catch (error) {
      if (error instanceof TurnCancelledError) throw error;

      if (error instanceof ClarificationRequiredError) {
        this.logger.warn(
          `[DeterministicSingleRunner] Workflow "${workflow.id}" tạm dừng chờ làm rõ: "${error.question}"`,
        );
        this.metrics.incrementBehaviorSignal('clarification_required');
        const candidates: AvailableAgentDto[] = error.candidates.map((c) => ({
          provider: c.id,
          label: c.label,
          description: c.description ?? '',
        }));
        return this.checkpointPause.pauseForClarification(
          data,
          prompt,
          [],
          error.toolCalls ? [...error.toolCalls] : [],
          history,
          error.question,
          candidates,
          [],
          EExecutionEngineMode.DETERMINISTIC,
        );
      }

      if (error instanceof ApprovalRequiredError) {
        this.logger.warn(
          `[DeterministicSingleRunner] Workflow "${workflow.id}" tạm dừng chờ HITL approval cho tool "${error.pendingTool.name}"`,
        );
        this.metrics.incrementBehaviorSignal('approval_required');

        const approvalNeeded: ApprovalRequiredDelegateResult = {
          approvalRequired: error.pendingTool,
          task: prompt,
          toolCalls: error.toolCalls,
        };

        return this.checkpointPause.pauseForApproval(
          data,
          prompt,
          [
            {
              agent: workflow.id,
              task: prompt,
              result: `Workflow "${workflow.name}" yêu cầu phê duyệt cho thao tác: ${error.pendingTool.name}`,
            },
          ],
          error.toolCalls,
          history,
          approvalNeeded,
          [],
          EExecutionEngineMode.DETERMINISTIC,
        );
      }

      this.logger.error(
        `[DeterministicSingleRunner] Lỗi thực thi workflow "${workflow.id}": ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
