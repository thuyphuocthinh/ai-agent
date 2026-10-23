import { AvailableAgentDto } from '../../contracts';

export interface AgentRankingCache {
  current?: { shown: AvailableAgentDto[]; omittedCount: number };
}
