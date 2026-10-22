import { Injectable } from '@nestjs/common';
import { ActionSummaryAdapter, ActionSummaryContext } from './action-summary.interface';
import { SqlSummaryAdapter } from './adapters/sql-summary.adapter';
import { PolicySummaryAdapter } from './adapters/policy-summary.adapter';
import {
  FallbackSummaryAdapter,
  MetadataSummaryAdapter,
} from './adapters/metadata-summary.adapter';

@Injectable()
export class ActionSummaryService {
  private readonly adapters: ActionSummaryAdapter[] = [];

  constructor() {
    // Đăng ký các adapter mặc định
    this.register(new SqlSummaryAdapter());
    this.register(new PolicySummaryAdapter());
    this.register(new MetadataSummaryAdapter());
    this.register(new FallbackSummaryAdapter());
  }

  /**
   * Đăng ký một adapter mới vào pipeline.
   * Tự động sắp xếp theo thứ tự ưu tiên (priority giảm dần).
   */
  register(adapter: ActionSummaryAdapter): this {
    this.adapters.push(adapter);
    this.adapters.sort((a, b) => b.priority - a.priority);
    return this;
  }

  /**
   * Trả về danh sách adapters hiện có.
   */
  getAdapters(): ReadonlyArray<ActionSummaryAdapter> {
    return this.adapters;
  }

  /**
   * Phân tích và sinh câu mô tả hành động nghiệp vụ thân thiện cho người dùng.
   */
  format(context: ActionSummaryContext): string {
    for (const adapter of this.adapters) {
      if (adapter.supports(context)) {
        try {
          return adapter.format(context);
        } catch {
          // Nếu adapter lỗi, rơi xuống adapter kế tiếp
          continue;
        }
      }
    }
    return `Thực thi tác vụ: ${context.toolName}`;
  }
}

// Singleton mặc định dùng cho các hàm tiện ích hoặc nơi không dùng Nest DI
export const defaultActionSummaryService = new ActionSummaryService();

export function formatActionSummary(context: ActionSummaryContext): string {
  return defaultActionSummaryService.format(context);
}
