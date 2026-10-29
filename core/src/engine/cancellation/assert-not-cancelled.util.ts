import { AgentCancellationService } from './agent-cancellation.service';
import { TurnCancelledError } from '../loop/errors/turn-cancelled.error';

// Kiểm tra cờ hủy của turn trước khi bắt đầu một việc tốn kém: ném TurnCancelledError
// nếu tín hiệu abort đã bật hoặc người dùng đã yêu cầu dừng (Redis).
export async function assertNotCancelled(
  cancellation: AgentCancellationService,
  messageId: string,
  signal?: AbortSignal,
): Promise<void> {
  const isCancelled = await cancellation.isCancelled(messageId);
  if (signal?.aborted || isCancelled) {
    throw new TurnCancelledError(undefined);
  }
}
