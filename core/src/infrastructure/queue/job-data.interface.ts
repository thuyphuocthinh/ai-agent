import { EJobName } from '../../constants/queue.constant';

export interface IProcessAiTriggerJobData {
  userId: string;
  channelId: string;
  workspaceId: string;
  messageId: string;
  botUserId: string;
  channelType: string;
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
