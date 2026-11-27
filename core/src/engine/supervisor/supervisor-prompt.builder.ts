import { Injectable } from '@nestjs/common';
import { SupervisorRoundDto } from '../../contracts/dtos/supervisor.dto';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';
import { ConversationMemoryRecord as ConversationMemoryEntity } from '../../memory/memory.interface';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { capRoundResults } from '../../common/text/token-budget.util';
import { detectFrustration } from '../loop/utils/detect-frustration.util';
import {
  buildConversationSummarySection,
  buildFrustrationWarning,
  buildHistorySection,
  buildOriginalPromptSection,
  buildRoundsSection,
  buildSkillCatalogSection,
} from './utils/supervisor-guidance-prompt.util';

export interface SupervisorPlanPromptOptions {
  readonly originalPrompt: string;
  readonly previousRounds: SupervisorRoundDto[];
  readonly history: ChatHistoryTurnDto[];
  readonly modelId: string;
  readonly contextSummary?: string;
  readonly skillCatalog?: string;
}

// Ghép tóm tắt hội thoại + skill catalog + lịch sử hội thoại + prompt gốc + các round đã chạy
// thành 1 prompt duy nhất, đúng thứ tự.
@Injectable()
export class SupervisorPromptBuilder {
  constructor(private readonly memoryManager: MemoryManagerService) {}

  build(
    originalPrompt: string,
    previousRounds: SupervisorRoundDto[],
    history: ChatHistoryTurnDto[],
    _memories: ConversationMemoryEntity[],
    modelId: string,
    skillCatalog = '',
  ): string {
    return this.buildPlanPrompt({
      originalPrompt,
      previousRounds,
      history,
      modelId,
      skillCatalog,
    });
  }

  buildPlanPrompt(options: SupervisorPlanPromptOptions): string {
    const {
      originalPrompt,
      previousRounds,
      history,
      modelId,
      contextSummary,
      skillCatalog = '',
    } = options;
    const sections: string[] = [];

    const frustrationPattern = detectFrustration(originalPrompt);
    if (frustrationPattern) {
      sections.push(buildFrustrationWarning(frustrationPattern));
    }

    const summarySection = buildConversationSummarySection(contextSummary);
    if (summarySection) {
      sections.push(summarySection);
    }

    if (skillCatalog) {
      sections.push(buildSkillCatalogSection(skillCatalog));
    }

    if (history.length > 0) {
      sections.push(buildHistorySection(history));
    }

    sections.push(buildOriginalPromptSection(originalPrompt));

    if (previousRounds.length > 0) {
      sections.push(
        buildRoundsSection(
          capRoundResults(
            previousRounds,
            this.memoryManager.buildBudget(modelId).toolResultCharBudget,
          ),
        ),
      );
    }

    return sections.join('\n\n');
  }
}
