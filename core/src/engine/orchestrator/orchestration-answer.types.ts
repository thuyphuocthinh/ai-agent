import { ToolCallTraceDto } from '../../contracts/dtos/react-loop.dto';
import { PersonaDto, SupervisorRoundDto } from '../../contracts/dtos/supervisor.dto';
import { ExecutedStepDto, TurnRoutingDto } from '../../contracts/dtos/message-client.dto';
import { PendingToolCall } from '../../infrastructure/database/entities/orchestration-checkpoint.entity';

// Object content (approval_request) đi qua createMessage() riêng, không qua đây.
export interface AnswerResult {
  content: string;
  toolCalls?: ToolCallTraceDto[];
  steps?: ExecutedStepDto[];
  persona?: PersonaDto;
  personas?: PersonaDto[];
  routing?: TurnRoutingDto;
}

export interface DelegateRoundResult {
  round: SupervisorRoundDto;
  toolCalls: ToolCallTraceDto[];
}

// delegateRound() trả dạng này thay vì throw khi bị Risk Gate chặn, để
// Promise.all() không mất kết quả của delegation anh em chạy song song.
export interface ApprovalRequiredDelegateResult {
  approvalRequired: PendingToolCall;
  task: string;
  toolCalls: ToolCallTraceDto[];
}

export function buildAnswer(
  content: string,
  toolCalls: ToolCallTraceDto[],
  steps?: ExecutedStepDto[],
): AnswerResult {
  const personas = steps
    ?.map((s) => s.persona)
    .filter((p): p is PersonaDto => Boolean(p));

  const result: AnswerResult = { content };
  if (toolCalls.length > 0) result.toolCalls = toolCalls;
  if (steps && steps.length > 0) result.steps = steps;
  if (personas && personas.length > 0) {
    result.persona = personas[0];
    result.personas = personas;
  }
  return result;
}
