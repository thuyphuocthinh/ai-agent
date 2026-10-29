import { SmartExecutionRouter } from './smart-execution-router.service';
import { ExecutionEngineRegistryService } from './execution-engine-registry.service';
import {
  EExecutionEngineMode,
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

describe('SmartExecutionRouter', () => {
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
    registry.register(stubEngine(EExecutionEngineMode.SINGLE_AGENT));
    registry.register(
      stubEngine(
        EExecutionEngineMode.PIPELINE_CHAINING,
        (ctx) => ctx.workflowId === 'weekly-report',
      ),
    );
    registry.register(stubEngine(EExecutionEngineMode.PARALLEL_FANOUT));
    router = new SmartExecutionRouter(registry);
  });

  it('mặc định chọn Single Agent', () => {
    const decision = router.route(baseContext());
    expect(decision.mode).toBe(EExecutionEngineMode.SINGLE_AGENT);
    expect(decision.engineId).toBe(EExecutionEngineMode.SINGLE_AGENT);
  });

  it('rơi về Dynamic Supervisor khi chưa có provider kết nối', () => {
    const decision = router.route(baseContext({ availableAgents: [] }));
    expect(decision.mode).toBe(EExecutionEngineMode.DYNAMIC_SUPERVISOR);
    expect(decision.engineId).toBeUndefined();
  });

  it('chọn Pipeline khi metadata.pipeline hoặc workflowId đã đăng ký pipeline', () => {
    expect(
      router.route(baseContext({ metadata: { pipeline: { id: 'p' } } })).mode,
    ).toBe(EExecutionEngineMode.PIPELINE_CHAINING);
    expect(
      router.route(baseContext({ workflowId: 'weekly-report' })).mode,
    ).toBe(EExecutionEngineMode.PIPELINE_CHAINING);
  });

  it('không chọn Pipeline khi workflowId không phải pipeline hoặc chỉ khớp regex theo nội dung', () => {
    expect(router.route(baseContext({ workflowId: 'other' })).mode).toBe(
      EExecutionEngineMode.SINGLE_AGENT,
    );
    expect(
      router.route(baseContext({ prompt: 'Quy trình đổi trả hàng là gì?' })).mode,
    ).toBe(EExecutionEngineMode.SINGLE_AGENT);
  });

  it('chọn Fan-Out khi có metadata.fanout', () => {
    const decision = router.route(baseContext({ metadata: { fanout: { id: 'f' } } }));
    expect(decision.mode).toBe(EExecutionEngineMode.PARALLEL_FANOUT);
  });

  it('prompt có từ khóa fan-out nhưng thiếu định nghĩa → Dynamic Supervisor (giữ hành vi hybrid cũ)', () => {
    const decision = router.route(
      baseContext({ prompt: 'Quét đồng thời 3 sàn và so sánh giá' }),
    );
    expect(decision.mode).toBe(EExecutionEngineMode.DYNAMIC_SUPERVISOR);
  });

  it.each([
    ['chạy script python để vẽ đồ thị', 'sandbox'],
    ['Thiết lập red-team và blue-team tranh luận', 'đối kháng'],
    ['a'.repeat(30001), 'payload quá khổ'],
  ])('heuristic hybrid (%#: %s) → Dynamic Supervisor', (prompt) => {
    expect(router.route(baseContext({ prompt })).mode).toBe(
      EExecutionEngineMode.DYNAMIC_SUPERVISOR,
    );
  });

  describe('forcedMode', () => {
    it.each([
      ['single', EExecutionEngineMode.SINGLE_AGENT],
      ['pipeline', EExecutionEngineMode.PIPELINE_CHAINING],
      ['fanout', EExecutionEngineMode.PARALLEL_FANOUT],
      ['supervisor', EExecutionEngineMode.DYNAMIC_SUPERVISOR],
    ])('"%s" → %s', (forcedMode, expected) => {
      expect(router.route(baseContext({ forcedMode })).mode).toBe(expected);
    });

    it('forcedMode=single bỏ qua heuristic hybrid', () => {
      const decision = router.route(
        baseContext({ forcedMode: 'single', prompt: 'quét đồng thời 3 sàn' }),
      );
      expect(decision.mode).toBe(EExecutionEngineMode.SINGLE_AGENT);
    });

    it('forcedMode=single nhưng chưa có provider → Dynamic Supervisor', () => {
      const decision = router.route(
        baseContext({ forcedMode: 'single', availableAgents: [] }),
      );
      expect(decision.mode).toBe(EExecutionEngineMode.DYNAMIC_SUPERVISOR);
    });

    it('forcedMode trỏ tới engine chưa đăng ký → Dynamic Supervisor', () => {
      const emptyRouter = new SmartExecutionRouter(new ExecutionEngineRegistryService());
      expect(emptyRouter.route(baseContext({ forcedMode: 'fanout' })).mode).toBe(
        EExecutionEngineMode.DYNAMIC_SUPERVISOR,
      );
    });

    it('forcedMode=auto đi theo heuristic', () => {
      expect(router.route(baseContext({ forcedMode: 'auto' })).mode).toBe(
        EExecutionEngineMode.SINGLE_AGENT,
      );
    });
  });
});
