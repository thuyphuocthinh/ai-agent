import { AgentWorkflowConfig, ChatHistoryTurnDto } from '../../contracts';
import { IProcessAiTriggerJobData } from '../../contracts/queue/job-data.interface';

export interface RunWorkflowOptions {
  workflow: AgentWorkflowConfig;
  prompt: string;
  data: IProcessAiTriggerJobData;
  replyMessageId: string;
  history: ChatHistoryTurnDto[];
  signal?: AbortSignal;
}
