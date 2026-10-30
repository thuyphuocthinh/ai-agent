import { SmartExecutionRouter } from './smart-execution-router.service';
import { ExecutionEngineRegistryService } from './execution-engine-registry.service';
import {
  EExecutionEngineMode,
  EForcedExecutionMode,
  EngineRoutingContext,
  IExecutionEngine,
} from '../../../contracts/engine/execution-engine.interface';
import { AnswerResult } from '../../../contracts/engine/orchestration-answer.types';

const stubEngine = (
  id: EExecutionEngineMode,
  canHandle: IExecutionEngine['canHandle'] = () => true,
): IExecutionEngine => ({
  id,
  name: id,
  canHandle,
  execute: jest.fn().mockResolvedValue({} as AnswerResult),
});

describe('SmartExecutionRouter (Two-Engine Architecture)', () => {
  const agents = [{ provider: 'sql_server', label: 'SQL', description: 'SQL DB' }];
  const baseContext = (
    overrides: Partial<EngineRoutingContext> = {},
  ): EngineRoutingContext => ({
    prompt: 'Tổng doanh thu hôm nay là bao nhiêu?',
    userId: 'user-1',
    availableAgents: agents,
    ...overrides,
  });

  let registry: ExecutionEngineRegistryService;
  let router: SmartExecutionRouter;

  beforeEach(() => {
    registry = new ExecutionEngineRegistryService();
    registry.register(stubEngine(EExecutionEngineMode.DETERMINISTIC));
    registry.register(stubEngine(EExecutionEngineMode.AUTONOMOUS));
    router = new SmartExecutionRouter(registry);
  });

  describe('Định tuyến mặc định (Hội thoại mở tự do)', () => {
    it('mặc định luôn chọn Autonomous Engine', () => {
      const decision = router.route(baseContext());
      expect(decision.mode).toBe(EExecutionEngineMode.AUTONOMOUS);
      expect(decision.engineId).toBe(EExecutionEngineMode.AUTONOMOUS);
    });

    it('không có provider/agent kết nối → vẫn chọn Autonomous Engine', () => {
      const decision = router.route(baseContext({ availableAgents: [] }));
      expect(decision.mode).toBe(EExecutionEngineMode.AUTONOMOUS);
    });

    it('prompt dài hoặc chứa từ khóa song song/đối kháng → không dùng regex, vẫn giao Autonomous Engine', () => {
      expect(
        router.route(baseContext({ prompt: 'quét đồng thời 3 sàn thương mại' })).mode,
      ).toBe(EExecutionEngineMode.AUTONOMOUS);

      expect(
        router.route(baseContext({ prompt: 'chạy script python vẽ đồ thị' })).mode,
      ).toBe(EExecutionEngineMode.AUTONOMOUS);

      expect(
        router.route(baseContext({ prompt: 'a'.repeat(35000) })).mode,
      ).toBe(EExecutionEngineMode.AUTONOMOUS);
    });
  });

  describe('Định tuyến Kịch bản định sẵn (Deterministic Engine)', () => {
    it('có workflowId → chọn Deterministic Engine', () => {
      const decision = router.route(baseContext({ workflowId: 'daily-report' }));
      expect(decision.mode).toBe(EExecutionEngineMode.DETERMINISTIC);
    });

    it('có metadata.graph (đồ thị hợp nhất mới) → chọn Deterministic Engine', () => {
      const decision = router.route(baseContext({ metadata: { graph: {} } }));
      expect(decision.mode).toBe(EExecutionEngineMode.DETERMINISTIC);
    });

    it('có metadata.pipeline hoặc metadata.fanout → chọn Deterministic Engine', () => {
      expect(
        router.route(baseContext({ metadata: { pipeline: {} } })).mode,
      ).toBe(EExecutionEngineMode.DETERMINISTIC);

      expect(
        router.route(baseContext({ metadata: { fanout: {} } })).mode,
      ).toBe(EExecutionEngineMode.DETERMINISTIC);
    });
  });

  describe('Định tuyến Cưỡng bức (forcedMode)', () => {
    it('forcedMode="deterministic" → Deterministic Engine', () => {
      expect(
        router.route(baseContext({ forcedMode: EForcedExecutionMode.DETERMINISTIC })).mode,
      ).toBe(EExecutionEngineMode.DETERMINISTIC);
    });

    it('forcedMode="autonomous" → Autonomous Engine', () => {
      expect(
        router.route(baseContext({ forcedMode: EForcedExecutionMode.AUTONOMOUS })).mode,
      ).toBe(EExecutionEngineMode.AUTONOMOUS);
    });

    it('forcedMode legacy: "single", "supervisor", "pipeline", "fanout"', () => {
      expect(router.route(baseContext({ forcedMode: 'single' })).mode).toBe(
        EExecutionEngineMode.SINGLE_AGENT,
      );
      expect(router.route(baseContext({ forcedMode: 'supervisor' })).mode).toBe(
        EExecutionEngineMode.DYNAMIC_SUPERVISOR,
      );
      expect(router.route(baseContext({ forcedMode: 'pipeline' })).mode).toBe(
        EExecutionEngineMode.PIPELINE_CHAINING,
      );
      expect(router.route(baseContext({ forcedMode: 'fanout' })).mode).toBe(
        EExecutionEngineMode.PARALLEL_FANOUT,
      );
    });
  });
});
