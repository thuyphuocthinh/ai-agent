import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EExecutionEngineMode,
  EngineRoutingContext,
  EngineRoutingDecision,
  EXECUTION_ENGINE_REGISTRY,
  IExecutionEngineRegistry,
  IExecutionRouter,
} from '../../contracts/execution-engine.interface';
import { decideExecutionMode } from './hybrid-execution-router.util';

const FORCED_MODE_TO_ENGINE: Record<string, EExecutionEngineMode> = {
  single: EExecutionEngineMode.SINGLE_AGENT,
  supervisor: EExecutionEngineMode.DYNAMIC_SUPERVISOR,
  pipeline: EExecutionEngineMode.PIPELINE_CHAINING,
  fanout: EExecutionEngineMode.PARALLEL_FANOUT,
};

/**
 * SmartExecutionRouter
 *
 * Chọn engine cho 1 turn theo thứ tự ưu tiên:
 * 1. forcedMode (cấu hình cưỡng bức).
 * 2. Định nghĩa tường minh: metadata.pipeline / workflowId đã đăng ký pipeline / metadata.fanout.
 *    Không auto-route theo regex vì "quy trình", "quét đồng thời"... xuất hiện cả trong chat thường,
 *    và Fan-Out không chạy được nếu thiếu FanoutDefinition.
 * 3. Heuristic hybrid (fan-out song song, sandbox, payload quá khổ, đối kháng) → Dynamic Supervisor.
 * 4. Mặc định Single Agent.
 *
 * Single Agent cần ít nhất 1 provider kết nối; nếu không có, rơi về Dynamic Supervisor.
 * Dynamic Supervisor không phải IExecutionEngine (chạy qua TurnResolverRun) nên router chỉ trả decision.
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
    const hasAgents = (context.availableAgents?.length ?? 0) > 0;

    const forced = this.routeForced(context, hasAgents);
    if (forced) return forced;

    const explicit = this.routeExplicitDefinition(context);
    if (explicit) return explicit;

    const hybrid = decideExecutionMode({
      prompt: context.prompt,
      forcedMode: 'auto',
      contextCharBudgetEstimate: context.contextCharBudgetEstimate,
    });
    if (hybrid.mode === EExecutionEngineMode.DYNAMIC_SUPERVISOR) {
      return this.supervisor(hybrid.reason);
    }

    if (!hasAgents) {
      return this.supervisor('Chưa có provider kết nối, dùng Dynamic Supervisor');
    }
    return this.engineDecision(EExecutionEngineMode.SINGLE_AGENT, hybrid.reason);
  }

  private routeForced(
    context: EngineRoutingContext,
    hasAgents: boolean,
  ): EngineRoutingDecision | undefined {
    const target = context.forcedMode
      ? FORCED_MODE_TO_ENGINE[context.forcedMode]
      : undefined;
    if (!target) return undefined;

    const reason = `Cưỡng bức chạy qua ${target} (forcedMode=${context.forcedMode})`;
    if (target === EExecutionEngineMode.SINGLE_AGENT && !hasAgents) {
      return this.supervisor(`${reason} nhưng chưa có provider kết nối, dùng Dynamic Supervisor`);
    }
    if (target === EExecutionEngineMode.DYNAMIC_SUPERVISOR) {
      return this.supervisor(reason);
    }
    if (!this.registry.has(target)) {
      return this.supervisor(`${reason} nhưng engine chưa đăng ký, dùng Dynamic Supervisor`);
    }
    return this.engineDecision(target, reason);
  }

  private routeExplicitDefinition(
    context: EngineRoutingContext,
  ): EngineRoutingDecision | undefined {
    const candidates: Array<[EExecutionEngineMode, boolean, string]> = [
      [
        EExecutionEngineMode.PIPELINE_CHAINING,
        this.hasPipelineDefinition(context),
        'Có pipeline tường minh (metadata.pipeline hoặc workflowId đã đăng ký)',
      ],
      [
        EExecutionEngineMode.PARALLEL_FANOUT,
        Boolean(context.metadata?.fanout),
        'Có fan-out tường minh (metadata.fanout)',
      ],
    ];

    for (const [mode, matched, reason] of candidates) {
      if (matched && this.registry.has(mode)) {
        return this.engineDecision(mode, reason);
      }
    }
    return undefined;
  }

  private hasPipelineDefinition(context: EngineRoutingContext): boolean {
    if (context.metadata?.pipeline) return true;
    if (!context.workflowId) return false;
    // Prompt rỗng để canHandle chỉ xét workflowId/metadata, bỏ qua regex theo nội dung.
    return Boolean(
      this.registry
        .get(EExecutionEngineMode.PIPELINE_CHAINING)
        ?.canHandle({ ...context, prompt: '' }),
    );
  }

  private engineDecision(
    mode: EExecutionEngineMode,
    reason: string,
  ): EngineRoutingDecision {
    return { mode, engineId: mode, reason };
  }

  private supervisor(reason: string): EngineRoutingDecision {
    return {
      mode: EExecutionEngineMode.DYNAMIC_SUPERVISOR,
      reason,
    };
  }
}
