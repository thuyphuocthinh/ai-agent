import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EExecutionEngineMode,
  EForcedExecutionMode,
  EngineRoutingContext,
  EngineRoutingDecision,
  EXECUTION_ENGINE_REGISTRY,
  IExecutionEngineRegistry,
  IExecutionRouter,
} from '../../../contracts/engine/execution-engine.interface';

const FORCED_MODE_TO_ENGINE: Record<string, EExecutionEngineMode> = {
  [EForcedExecutionMode.DETERMINISTIC]: EExecutionEngineMode.DETERMINISTIC,
  [EForcedExecutionMode.AUTONOMOUS]: EExecutionEngineMode.AUTONOMOUS,
  [EForcedExecutionMode.SINGLE]: EExecutionEngineMode.SINGLE_AGENT,
  [EForcedExecutionMode.SUPERVISOR]: EExecutionEngineMode.DYNAMIC_SUPERVISOR,
  [EForcedExecutionMode.PIPELINE]: EExecutionEngineMode.PIPELINE_CHAINING,
  [EForcedExecutionMode.FANOUT]: EExecutionEngineMode.PARALLEL_FANOUT,
};

const LEGACY_MODE_TO_UNIFIED_ENGINE: Record<string, EExecutionEngineMode> = {
  [EExecutionEngineMode.SINGLE_AGENT]: EExecutionEngineMode.AUTONOMOUS,
  [EExecutionEngineMode.DYNAMIC_SUPERVISOR]: EExecutionEngineMode.AUTONOMOUS,
  [EExecutionEngineMode.PIPELINE_CHAINING]: EExecutionEngineMode.DETERMINISTIC,
  [EExecutionEngineMode.PARALLEL_FANOUT]: EExecutionEngineMode.DETERMINISTIC,
};

/**
 * SmartExecutionRouter
 *
 * Định tuyến AI Orchestration theo kiến trúc Two-Engine Architecture:
 * 1. Forced Mode: Cấu hình cưỡng bức từ ENV hoặc Request (giải quyết qua Registry Alias).
 * 2. Deterministic Mode: Kịch bản định sẵn (workflowId, graph, pipeline, fanout) -> DETERMINISTIC.
 * 3. Autonomous Mode: Mọi hội thoại đàm thoại tự do mở -> AUTONOMOUS.
 *
 * Tuyệt đối không dùng regex phỏng đoán. Không còn nhánh fallback lồng nhau.
 */
@Injectable()
export class SmartExecutionRouter implements IExecutionRouter {
  private readonly logger = new Logger(SmartExecutionRouter.name);

  constructor(
    @Inject(EXECUTION_ENGINE_REGISTRY)
    private readonly registry: IExecutionEngineRegistry,
  ) {}

  route(context: EngineRoutingContext): EngineRoutingDecision {
    const decision = this.decide(context);
    this.logger.log(
      `[Router] turn=${context.messageId ?? '-'} mode=${decision.mode} reason="${decision.reason}"`,
    );
    return decision;
  }

  private decide(context: EngineRoutingContext): EngineRoutingDecision {
    // 1. Cưỡng bức qua forcedMode
    const forced = this.routeForced(context);
    if (forced) return forced;

    // 2. Kịch bản định sẵn tường minh (workflowId hoặc metadata đồ thị/pipeline/fanout)
    const isDeterministic = Boolean(
      context.workflowId ||
      context.metadata?.graph ||
      context.metadata?.pipeline ||
      context.metadata?.fanout,
    );
    if (isDeterministic) {
      return this.engineDecision(
        EExecutionEngineMode.DETERMINISTIC,
        'Kịch bản định sẵn (workflowId hoặc metadata đồ thị/pipeline/fanout)',
      );
    }

    // 3. Mặc định: Autonomous Engine tiếp nhận toàn bộ hội thoại mở tự do
    return this.engineDecision(
      EExecutionEngineMode.AUTONOMOUS,
      'Hội thoại mở tự do: Điều phối qua Autonomous Engine',
    );
  }

  private routeForced(
    context: EngineRoutingContext,
  ): EngineRoutingDecision | undefined {
    const target = context.forcedMode
      ? FORCED_MODE_TO_ENGINE[context.forcedMode]
      : undefined;
    if (!target) return undefined;

    return this.engineDecision(
      target,
      `Cưỡng bức chạy qua ${target} (forcedMode=${context.forcedMode})`,
    );
  }

  private engineDecision(
    mode: EExecutionEngineMode,
    reason: string,
  ): EngineRoutingDecision {
    const engineId = LEGACY_MODE_TO_UNIFIED_ENGINE[mode] ?? mode;
    return { mode, engineId, reason };
  }
}
