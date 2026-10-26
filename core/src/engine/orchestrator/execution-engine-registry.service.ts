import { Injectable, Logger } from '@nestjs/common';
import {
  IExecutionEngine,
  IExecutionEngineRegistry,
} from '../../contracts/execution-engine.interface';

/**
 * ExecutionEngineRegistryService
 *
 * Quản lý danh bạ các Execution Engine (Single Agent, Pipeline Chaining, Parallel Fan-Out, Supervisor...).
 * Hỗ trợ sắp xếp theo thứ tự ưu tiên (priority descending) để Router đánh giá lần lượt.
 */
@Injectable()
export class ExecutionEngineRegistryService implements IExecutionEngineRegistry {
  private readonly logger = new Logger(ExecutionEngineRegistryService.name);
  private readonly engines = new Map<string, IExecutionEngine>();

  /**
   * Đăng ký một Execution Engine vào hệ thống.
   * Nếu engine đã tồn tại với cùng id, nó sẽ được cập nhật.
   */
  register(engine: IExecutionEngine): void {
    if (!engine?.id || typeof engine.id !== 'string') {
      throw new Error('[ExecutionEngineRegistry] Engine id hợp lệ là bắt buộc');
    }
    if (typeof engine.execute !== 'function') {
      throw new Error(
        `[ExecutionEngineRegistry] Engine "${engine.id}" phải có phương thức execute()`,
      );
    }

    this.engines.set(engine.id, engine);
    this.logger.log(
      `Đã đăng ký engine "${engine.id}" (${engine.name ?? engine.id}) [priority: ${engine.priority ?? 0}]`,
    );
  }

  /**
   * Lấy engine theo id định danh.
   */
  get(id: string): IExecutionEngine | undefined {
    return this.engines.get(id);
  }

  /**
   * Kiểm tra xem engine có tồn tại trong registry hay không.
   */
  has(id: string): boolean {
    return this.engines.has(id);
  }

  /**
   * Trả về danh sách tất cả các engine đã đăng ký, được sắp xếp theo độ ưu tiên giảm dần.
   */
  list(): readonly IExecutionEngine[] {
    return Array.from(this.engines.values()).sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
  }
}
