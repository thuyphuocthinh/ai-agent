import { ChatHistoryTurnDto } from './message-client.dto';
import { EStepExecutionStatus } from '@agent/core/constants';
import { PersonaDto } from './supervisor.dto';
import { IClarificationQuestion } from '../engine/clarification.types';

export class RunReactLoopRequestDto {
  prompt: string;
  // Provider định danh (khi chạy multi-provider có thể là 'multi' hoặc provider chính)
  provider: string;
  // Danh sách nhiều providers (dành cho chế độ Multi-Provider Single Agent)
  providers?: string[];
  userId: string;
  channelId: string;
  conversationId?: string;
  workspaceId?: string;
  tenantId?: string;
  // messageId của message BOT (reply) — dùng để stream step lên đúng bubble
  messageId: string;
  channelType?: string; // 'direct' | 'group' | 'cli' | 'web'
  sessionType?: string;
  // Lịch sử hội thoại — TurnResolverService fetch 1 LẦN/turn rồi truyền
  // xuống cho cả SupervisorService.plan() lẫn đây, đảm bảo cả 2 nhìn thấy
  // đúng CÙNG 1 snapshot lịch sử (không tự fetch riêng, tránh lệch nhau).
  history: ChatHistoryTurnDto[];
  // Model id trong LLM_MODEL_REGISTRY (VD 'gemini-2.0-flash', 'gpt-4o-mini',
  // 'claude-haiku') — optional, chưa có UI cho user chọn nên mặc định lấy
  // ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL nếu không truyền. Field đã
  // sẵn để cắm UI chọn model sau này mà không cần sửa ReactLoopService.
  model?: string;
  // Khoá riêng cho luồng text/resync của LẦN CHẠY NÀY — bắt buộc phải khác
  // nhau giữa các ReactLoopService.run() chạy SONG SONG cùng messageId (Giai
  // đoạn Supervisor fan-out nhiều agent 1 lúc), nếu không FE sẽ gộp chung 1
  // chuỗi và 1 agent resync() có thể xoá mất phần agent kia đang stream.
  // Không truyền = dùng DEFAULT_STREAM_KEY (an toàn cho các chỗ gọi ĐƠN,
  // không có rủi ro chạy song song cùng messageId).
  streamKey?: string;
  // Persona Supervisor giao cho Worker ở bước này (xem PersonaDto) — optional,
  // không truyền = Worker chạy với system prompt mặc định như cũ.
  persona?: PersonaDto;
  // Danh sách công cụ được phép dùng (Principle of Least Privilege).
  // Nếu truyền, ReactLoop chỉ nạp các tool trùng tên trong mảng này.
  allowedTools?: string[];
  // Số lần tự sửa lỗi tối đa khi gọi tool fail (Hard cap: mặc định 2 lần, không retry vô tận)
  maxSelfCorrectionRetries?: number;
  selfCorrectionCount?: number;
}

export class ToolCallTraceDto {
  tool: string;
  // 'awaiting_approval' (Giai đoạn 3, HITL) — tool bị Risk Gate chặn, đang chờ
  // user bấm Duyệt/Từ chối, KHÁC với 'error' (đã thử chạy và thất bại thật).
  status: EStepExecutionStatus;
  // Xem trước ngắn gọn kết quả tool trả về (rút gọn 1 dòng) — hiện dưới mỗi
  // bước trong timeline FE, giống Claude Code hiện "⎿ output" dưới tool call.
  resultPreview?: string;
  // Tham số THẬT LLM đã sinh ra để gọi tool (VD code Python của run_python,
  // câu SQL của execute_*_query) — chỉ để HIỂN THỊ/COPY cho user xem, không
  // dùng lại ở đâu trong pipeline (khác resultPreview không feed ngược LLM).
  argsPreview?: string;
}

export class ReflectionTraceDto {
  attempt: number;
  tool: string;
  error: string;
  reflection: string;
  correctedArgs?: Record<string, unknown>;
}

export class RunReactLoopResponseDto {
  answer: string;
  toolCalls: ToolCallTraceDto[];
  reflectionTraces?: ReflectionTraceDto[];
  clarificationRequired?: IClarificationQuestion;
}

export class QuantityCheckRequiredDto {
  requiredCount: number;
}

export class QuantityCheckAchievedDto {
  achievedCount: number;
}
