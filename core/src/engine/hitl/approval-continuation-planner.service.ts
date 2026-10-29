import { Injectable, Logger } from '@nestjs/common';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { DelegationDto } from '../../contracts/dtos/supervisor.dto';
import { CheckpointResponseDto } from '../../contracts/dtos/checkpoint.dto';
import { checkQuantity } from '../loop/guards/quantity-check.util';
import { LlmStrategyFactory } from '../strategy/llm-strategy.factory';
import { CircuitBreakerService } from '../../infrastructure/resilience/circuit-breaker.service';
import {
  buildContinuationTask,
  buildQuantityCapReachedResult,
  getRootTask,
} from './utils/hitl-message.util';

@Injectable()
export class ApprovalContinuationPlannerService {
  private readonly logger = new Logger(ApprovalContinuationPlannerService.name);

  constructor(
    private readonly llmFactory: LlmStrategyFactory,
    private readonly circuitBreaker: CircuitBreakerService,
  ) { }

  async resolveRemainingSteps(
    checkpoint: CheckpointResponseDto,
    toolResultText: string,
  ): Promise<{
    remainingSteps: DelegationDto[] | undefined;
    resultText: string;
  }> {
    const { pendingTool, pendingTask, roundsSoFar, remainingSteps } =
      checkpoint;
    const attempts =
      roundsSoFar.filter(
        (r) =>
          r.agent === pendingTool!.provider &&
          getRootTask(r.task) === getRootTask(pendingTask),
      ).length + 1;
    const capReached =
      attempts >= ORCHESTRATION_CONSTANTS.MAX_QUANTITY_CONTINUATION_ROUNDS;

    const { strategy, model } = this.llmFactory.resolve(
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
    );
    const { requiredCount, achievedCount } = await checkQuantity(
      pendingTask,
      toolResultText,
      strategy,
      model,
      this.circuitBreaker,
      this.logger,
    );
    if (requiredCount === 0 || requiredCount === achievedCount) {
      return { remainingSteps, resultText: toolResultText };
    }

    if (capReached) {
      this.logger.warn(
        `checkpoint=${checkpoint.id} quantity vẫn thiếu (requiredCount=${requiredCount} achievedCount=${achievedCount}) sau ${attempts} lần thử — dừng lại, báo rõ cho user`,
      );
      return {
        remainingSteps,
        resultText: buildQuantityCapReachedResult(
          toolResultText,
          requiredCount,
          achievedCount,
          attempts,
        ),
      };
    }

    this.logger.log(
      `checkpoint=${checkpoint.id} quantity mismatch requiredCount=${requiredCount} achievedCount=${achievedCount} — nudging to continue`,
    );
    const continuationStep: DelegationDto = {
      agent: pendingTool!.provider,
      task: buildContinuationTask(pendingTask, achievedCount, requiredCount),
      mustExecute: true,
    };
    return {
      remainingSteps: [continuationStep, ...(remainingSteps ?? [])],
      resultText: toolResultText,
    };
  }
}
