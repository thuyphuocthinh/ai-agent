import { RunReactLoopRequestDto } from '../../../contracts/dtos/react-loop.dto';
import { IProcessAiTriggerJobData } from '../../../contracts/queue/job-data.interface';

export type ReactRequestIdentity = Pick<
  RunReactLoopRequestDto,
  | 'userId'
  | 'channelId'
  | 'conversationId'
  | 'workspaceId'
  | 'tenantId'
  | 'channelType'
  | 'sessionType'
>;

// Các field định danh/ngữ cảnh kênh của một lượt chạy ReAct, suy ra từ job data và
// giống hệt nhau ở mọi engine (single agent, pipeline, fan-out, workflow). Mỗi
// engine spread kết quả này rồi thêm field riêng của mình (messageId, history, model...).
export function buildReactRequestIdentity(
  data: IProcessAiTriggerJobData,
): ReactRequestIdentity {
  return {
    userId: data.userId,
    channelId: data.conversationId ?? data.channelId,
    conversationId: data.conversationId,
    workspaceId: data.tenantId ?? data.workspaceId,
    tenantId: data.tenantId,
    channelType: data.sessionType ?? data.channelType ?? 'web',
    sessionType: data.sessionType,
  };
}
