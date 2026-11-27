import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import {
  EMessageRole,
  HISTORY_SEARCH_ERROR_CODES,
  HISTORY_SEARCH_TOOL_NAME,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import { MAX_TOOL_RESULT_CHARS } from '../../../common/text/token-budget.util';
import { CallToolResponseDto, McpToolDto } from '../../../contracts/dtos/mcp.dto';
import {
  CONVERSATION_HISTORY_SEARCH_REPOSITORY,
  ConversationHistoryMatchDto,
  IConversationHistorySearchRepository,
  SearchConversationHistoryParams,
} from '../../../contracts/memory/conversation-history-search.interface';
import { INativeTool, NativeToolExecutionContext } from './native-tool.interface';
import { NativeToolRegistryService } from './native-tool-registry.service';
import { nativeToolError, nativeToolJson } from './native-tool-response.util';

const PAYLOAD_OVERHEAD_RESERVE = 200;

@Injectable()
export class SearchConversationHistoryTool implements INativeTool, OnModuleInit {
  readonly name = HISTORY_SEARCH_TOOL_NAME;
  readonly description =
    'Tìm kiếm lại tin nhắn cũ trong chính cuộc hội thoại hiện tại từ PostgreSQL theo từ khóa, vai trò, khoảng thời gian, hoặc đọc ngữ cảnh xung quanh một messageId đã tìm thấy.';
  readonly inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Từ khóa ngắn gọn, mã định danh hoặc tên riêng cần tìm (khuyên dùng 1–3 từ cốt lõi thay vì viết cả câu hỏi dài).',
      },
      role: {
        type: 'string',
        enum: ['USER', 'ASSISTANT'],
        description:
          'Tùy chọn lọc người gửi. MẶC ĐỊNH ĐỂ TRỐNG để tìm cả USER lẫn ASSISTANT (vì quy tắc và thông tin gốc thường nằm trong tin USER).',
      },
      fromDate: {
        type: 'string',
        description:
          'Mốc thời gian bắt đầu (ISO-8601, ví dụ 2026-11-27T00:00:00Z).',
      },
      toDate: {
        type: 'string',
        description: 'Mốc thời gian kết thúc (ISO-8601).',
      },
      aroundMessageId: {
        type: 'string',
        description:
          'ID một tin nhắn khớp tìm được để đọc thêm các tin nhắn liền trước và liền sau nó.',
      },
      contextWindow: {
        type: 'number',
        description: 'Số tin trước và sau aroundMessageId (mặc định 2, tối đa 4).',
      },
      limit: {
        type: 'number',
        description: 'Số kết quả tối đa cần trả về (mặc định 8, tối đa 20).',
      },
      offset: {
        type: 'number',
        description: 'Vị trí bỏ qua để phân trang kết quả tìm kiếm (mặc định 0).',
      },
    },
    required: [],
  };

  constructor(
    @Optional()
    @Inject(CONVERSATION_HISTORY_SEARCH_REPOSITORY)
    private readonly repository?: IConversationHistorySearchRepository,
    @Optional()
    private readonly registry?: NativeToolRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry?.registerTool(this);
  }

  toMcpToolDto(): McpToolDto {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
    };
  }

  async execute(
    args: Record<string, unknown>,
    context?: NativeToolExecutionContext,
  ): Promise<CallToolResponseDto> {
    const conversationId = context?.conversationId?.trim();
    if (!conversationId) {
      return nativeToolError(
        HISTORY_SEARCH_ERROR_CODES.MISSING_CONVERSATION,
        'Thiếu conversationId trong ngữ cảnh thực thi.',
      );
    }
    if (!this.repository) {
      return nativeToolError(
        HISTORY_SEARCH_ERROR_CODES.SEARCH_FAILED,
        'Kho tìm kiếm lịch sử hội thoại chưa khả dụng.',
      );
    }

    const parsed = this.parseSearchParams(args, conversationId);
    if ('error' in parsed) {
      return nativeToolError(
        HISTORY_SEARCH_ERROR_CODES.INVALID_ARGUMENTS,
        parsed.error,
      );
    }

    try {
      let result = await this.repository.search(parsed);
      let roleFallbackUsed = false;

      if (result.mode === 'around' && result.items.length === 0) {
        return nativeToolError(
          HISTORY_SEARCH_ERROR_CODES.NOT_FOUND,
          'Không tìm thấy messageId trong cuộc hội thoại hiện tại.',
        );
      }

      if (result.mode === 'search' && result.items.length === 0 && parsed.role) {
        const crossRole = await this.repository.search({
          ...parsed,
          role: undefined,
        });
        if (crossRole.items.length > 0) {
          result = crossRole;
          roleFallbackUsed = true;
        }
      }

      const fitted = this.fitItemsWithinBudget(result.items);
      return nativeToolJson({
        mode: result.mode,
        totalMatches: result.totalMatches,
        returnedCount: fitted.items.length,
        hasMore:
          result.mode === 'search' &&
          (parsed.offset + fitted.items.length < result.totalMatches ||
            fitted.clipped),
        ...(roleFallbackUsed
          ? {
              roleFallbackUsed: true,
              note: 'Không có kết quả ở vai trò được lọc; đã tự mở rộng tìm kiếm cả USER và ASSISTANT.',
            }
          : {}),
        items: fitted.items,
      });
    } catch (error) {
      return nativeToolError(
        HISTORY_SEARCH_ERROR_CODES.SEARCH_FAILED,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private parseSearchParams(
    args: Record<string, unknown>,
    conversationId: string,
  ): SearchConversationHistoryParams | { error: string } {
    const query = typeof args.query === 'string' ? args.query.trim() : undefined;
    const aroundMessageId =
      typeof args.aroundMessageId === 'string'
        ? args.aroundMessageId.trim()
        : undefined;
    const fromDate = this.parseIsoDate(args.fromDate);
    const toDate = this.parseIsoDate(args.toDate);
    if (fromDate === null || toDate === null) {
      return {
        error: 'Tham số fromDate hoặc toDate không đúng định dạng ngày ISO hợp lệ.',
      };
    }
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      return { error: 'fromDate không được lớn hơn toDate.' };
    }
    if (!query && !aroundMessageId && !fromDate && !toDate) {
      return {
        error:
          'Cần cung cấp ít nhất một tiêu chí: query, fromDate/toDate hoặc aroundMessageId.',
      };
    }

    return {
      conversationId,
      ...(query ? { query } : {}),
      ...(args.role === 'USER' ? { role: EMessageRole.USER } : {}),
      ...(args.role === 'ASSISTANT' ? { role: EMessageRole.MODEL } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      ...(aroundMessageId ? { aroundMessageId } : {}),
      contextWindow: this.clampInt(
        args.contextWindow,
        1,
        ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_CONTEXT_WINDOW_MAX,
        ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_CONTEXT_WINDOW_DEFAULT,
      ),
      limit: this.clampInt(
        args.limit,
        1,
        ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_MAX_LIMIT,
        ORCHESTRATION_CONSTANTS.HISTORY_SEARCH_DEFAULT_LIMIT,
      ),
      offset: this.clampInt(args.offset, 0, Number.MAX_SAFE_INTEGER, 0),
    };
  }

  private parseIsoDate(raw: unknown): Date | undefined | null {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string') return null;
    const d = new Date(raw.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private clampInt(
    raw: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(raw)));
  }

  private fitItemsWithinBudget(items: readonly ConversationHistoryMatchDto[]): {
    items: ConversationHistoryMatchDto[];
    clipped: boolean;
  } {
    const kept: ConversationHistoryMatchDto[] = [];
    for (const item of items) {
      const candidate = [...kept, item];
      if (
        kept.length > 0 &&
        JSON.stringify({ items: candidate }).length >
          MAX_TOOL_RESULT_CHARS - PAYLOAD_OVERHEAD_RESERVE
      ) {
        return { items: kept, clipped: true };
      }
      kept.push(item);
    }
    return { items: kept, clipped: false };
  }
}
