import { AvailableAgentDto } from '../dtos/supervisor.dto';
import { ChatHistoryTurnDto } from '../dtos/message-client.dto';
import { AgentWorkflowConfig } from './agent-workflow.types';
import { IProcessAiTriggerJobData } from '../queue/job-data.interface';
import { AnswerResult } from './orchestration-answer.types';
import { CheckpointResponseDto } from '../dtos/checkpoint.dto';

export const EXECUTION_ENGINE_REGISTRY = Symbol.for('EXECUTION_ENGINE_REGISTRY');
export const EXECUTION_ROUTER = Symbol.for('EXECUTION_ROUTER');

export enum EExecutionEngineMode {
  SINGLE_AGENT = 'single_agent',
  PIPELINE_CHAINING = 'pipeline_chaining',
  PARALLEL_FANOUT = 'parallel_fanout',
  DYNAMIC_SUPERVISOR = 'dynamic_supervisor',
  // Chỉ dùng làm routing.mode của turn chạy fixed workflow; không có engine tương ứng trong registry.
  WORKFLOW = 'workflow',
}

export interface EngineRoutingContext {
  prompt: string;
  userId: string;
  workspaceId?: string;
  channelId?: string;
  messageId?: string;
  workflowId?: string;
  history?: ChatHistoryTurnDto[];
  availableAgents?: AvailableAgentDto[];
  forcedMode?: 'single' | 'supervisor' | 'pipeline' | 'fanout' | 'auto' | string;
  contextCharBudgetEstimate?: number;
  metadata?: Record<string, unknown>;
}

export interface EngineExecutionContext {
  data: IProcessAiTriggerJobData;
  replyMessageId: string;
  prompt: string;
  agents: AvailableAgentDto[];
  history: ChatHistoryTurnDto[];
  signal?: AbortSignal;
  workflowConfig?: AgentWorkflowConfig;
  metadata?: Record<string, unknown>;
}

export interface EngineRoutingDecision {
  mode: EExecutionEngineMode | string;
  reason: string;
  engineId?: string;
  metadata?: Record<string, unknown>;
}

export interface IExecutionEngine {
  /**
   * Định danh duy nhất của Engine (ví dụ: 'single_agent', 'pipeline_chaining', 'parallel_fanout', 'dynamic_supervisor')
   */
  readonly id: string;

  /**
   * Tên hiển thị người dùng hoặc log
   */
  readonly name: string;

  /**
   * Thứ tự ưu tiên khi router đánh giá (số càng cao được evaluate trước, mặc định 0)
   */
  readonly priority?: number;

  /**
   * Quyết định xem Engine có tiếp nhận xử lý yêu cầu này không
   */
  canHandle(context: EngineRoutingContext): boolean | Promise<boolean>;

  /**
   * Thực thi yêu cầu và trả về kết quả chuẩn AnswerResult
   */
  execute(context: EngineExecutionContext): Promise<AnswerResult>;
  resume?(checkpoint: CheckpointResponseDto): Promise<AnswerResult>;
}

export interface IExecutionEngineRegistry {
  register(engine: IExecutionEngine): void;
  get(id: string): IExecutionEngine | undefined;
  list(): readonly IExecutionEngine[];
  has(id: string): boolean;
}

export interface IExecutionRouter {
  route(context: EngineRoutingContext): Promise<EngineRoutingDecision> | EngineRoutingDecision;
}
