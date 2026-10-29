import { Injectable } from '@nestjs/common';
import { SupervisorRoundDto } from '../../contracts/dtos/supervisor.dto';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';
import { ConversationMemoryRecord as ConversationMemoryEntity } from '../../memory/memory.interface';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { capRoundResults } from '../../common/text/token-budget.util';
import { detectFrustration } from '../loop/utils/detect-frustration.util';
import {
  buildFrustrationWarning,
  buildHistorySection,
  buildMemoriesSection,
  buildOriginalPromptSection,
  buildRoundsSection,
  buildSkillCatalogSection,
} from './utils/supervisor-guidance-prompt.util';

// Ghép conversation_memory + skill catalog + lịch sử hội thoại + prompt gốc + các round đã chạy
// thành 1 prompt duy nhất, đúng thứ tự.
@Injectable()
export class SupervisorPromptBuilder {
  constructor(private readonly memoryManager: MemoryManagerService) {}

  build(
    originalPrompt: string,
    previousRounds: SupervisorRoundDto[],
    history: ChatHistoryTurnDto[],
    memories: ConversationMemoryEntity[],
    modelId: string,
    skillCatalog = '',
  ): string {
    const sections: string[] = [];

    // ver3.md mục 5 — đứng ĐẦU TIÊN (trước cả channel_memory), vì đây là tín
    // hiệu khẩn của CHÍNH lượt đang xử lý, không phải thông tin nền.
    const frustrationPattern = detectFrustration(originalPrompt);
    if (frustrationPattern) {
      sections.push(buildFrustrationWarning(frustrationPattern));
    }

    // ver3.md mục 1 (dài hạn) — đứng TRƯỚC lịch sử hội thoại, framing rõ là
    // GỢI Ý tham khảo, không phải cam kết tuyệt đối (thực thể vẫn có thể bị
    // đổi/xoá bởi người khác sau đó).
    if (memories.length > 0) {
      sections.push(buildMemoriesSection(memories.map((m) => m.content)));
    }

    // Level 1 của skill: Supervisor chỉ lập kế hoạch (không gọi tool), nên catalog
    // để nó nêu slug trong task giao cho agent — agent tự đọc bằng read_skill.
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
