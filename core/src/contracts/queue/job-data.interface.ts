import { EJobName } from '../../constants/queue.constant';

export interface IProcessAiTriggerJobData {
  userId: string;
  conversationId?: string;
  channelId: string; // Alias backward-compatibility for conversationId
  workspaceId?: string;
  tenantId?: string;
  messageId: string;
  runId?: string;
  botUserId?: string;
  sessionType?: string;
  channelType?: string;
  workflowId?: string;
}

export interface IProcessApprovalJobData {
  checkpointId: string;
  userId: string;
}

export interface IUpdateDynamicProviderTokenJobData {
  providerId: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  previousRefreshToken?: string;
}

export type TJobData = {
  [EJobName.PROCESS_AI_TRIGGER]: IProcessAiTriggerJobData;
  [EJobName.PROCESS_APPROVAL]: IProcessApprovalJobData;
  [EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN]: IUpdateDynamicProviderTokenJobData;
  [key: string]: any;
};
