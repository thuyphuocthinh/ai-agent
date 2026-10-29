import { ToolCallTraceDto } from '../dtos/react-loop.dto';
import { IClarificationCandidate } from './clarification.types';

export class ClarificationRequiredError extends Error {
  constructor(
    public readonly question: string,
    public readonly candidates: readonly IClarificationCandidate[],
    public readonly toolCalls: readonly ToolCallTraceDto[] = [],
    public readonly parameterName?: string,
  ) {
    super(question);
    this.name = 'ClarificationRequiredError';
  }
}
