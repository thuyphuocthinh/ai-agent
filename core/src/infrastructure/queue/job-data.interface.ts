import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
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

export interface IEdgeDispatchMessageJobData {
  workspaceId: string;
  message: JSONRPCMessage;
}

export interface IEdgeNotifyMessageJobData {
  workspaceId: string;
  message: JSONRPCMessage;
}

export type TJobData = {
  [EJobName.PROCESS_AI_TRIGGER]: IProcessAiTriggerJobData;
  [EJobName.PROCESS_APPROVAL]: IProcessApprovalJobData;
  [EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN]: IUpdateDynamicProviderTokenJobData;
  [EJobName.EDGE_DISPATCH_MESSAGE]: IEdgeDispatchMessageJobData;
  [EJobName.EDGE_NOTIFY_MESSAGE]: IEdgeNotifyMessageJobData;
  [key: string]: any;
};
