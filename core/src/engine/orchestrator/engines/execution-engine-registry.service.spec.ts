import { ExecutionEngineRegistryService } from './execution-engine-registry.service';
import {
  IExecutionEngine,
  EngineRoutingContext,
  EngineExecutionContext,
} from '../../../contracts/engine/execution-engine.interface';
import { AnswerResult } from '../../../contracts/engine/orchestration-answer.types';

describe('ExecutionEngineRegistryService', () => {
  let registry: ExecutionEngineRegistryService;

  beforeEach(() => {
    registry = new ExecutionEngineRegistryService();
  });

  const createMockEngine = (
    id: string,
    priority: number = 0,
    canHandleResult: boolean = true,
  ): IExecutionEngine => ({
    id,
    name: `Mock Engine ${id}`,
    priority,
    canHandle: jest.fn().mockResolvedValue(canHandleResult),
    execute: jest.fn().mockResolvedValue({ content: `Result from ${id}` } as AnswerResult),
  });

  it('đăng ký thành công một engine và lấy ra bằng id', () => {
    const engine = createMockEngine('single_agent', 10);
    registry.register(engine);

    expect(registry.has('single_agent')).toBe(true);
    expect(registry.get('single_agent')).toBe(engine);
  });

  it('trả về undefined và false khi tra cứu engine chưa đăng ký', () => {
    expect(registry.has('non_existent')).toBe(false);
    expect(registry.get('non_existent')).toBeUndefined();
  });

  it('bắn lỗi nếu engine không có id hợp lệ hoặc thiếu phương thức execute()', () => {
    expect(() =>
      registry.register({} as unknown as IExecutionEngine),
    ).toThrow('[ExecutionEngineRegistry] Engine id hợp lệ là bắt buộc');

    expect(() =>
      registry.register({
        id: 'invalid_engine',
        name: 'Invalid',
      } as unknown as IExecutionEngine),
    ).toThrow(
      '[ExecutionEngineRegistry] Engine "invalid_engine" phải có phương thức execute()',
    );
  });

  it('liệt kê danh sách các engine được sắp xếp theo độ ưu tiên giảm dần (priority descending)', () => {
    const engineLow = createMockEngine('low_priority', 1);
    const engineHigh = createMockEngine('high_priority', 100);
    const engineMedium = createMockEngine('medium_priority', 50);
    const engineDefault = createMockEngine('default_priority'); // priority mặc định 0

    registry.register(engineLow);
    registry.register(engineHigh);
    registry.register(engineMedium);
    registry.register(engineDefault);

    const list = registry.list();
    expect(list.map((e) => e.id)).toEqual([
      'high_priority',
      'medium_priority',
      'low_priority',
      'default_priority',
    ]);
  });

  it('cho phép ghi đè (update) engine nếu đăng ký cùng một id', () => {
    const engineV1 = createMockEngine('single_agent', 1);
    const engineV2 = createMockEngine('single_agent', 10);

    registry.register(engineV1);
    expect(registry.get('single_agent')?.priority).toBe(1);

    registry.register(engineV2);
    expect(registry.get('single_agent')?.priority).toBe(10);
    expect(registry.list()).toHaveLength(1);
  });
});
