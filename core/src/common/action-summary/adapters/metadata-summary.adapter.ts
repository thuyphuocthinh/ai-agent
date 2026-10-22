import { ActionSummaryAdapter, ActionSummaryContext } from '../action-summary.interface';

export class MetadataSummaryAdapter implements ActionSummaryAdapter {
  readonly priority = 10;

  supports(context: ActionSummaryContext): boolean {
    return Boolean(context.toolDescription && context.toolDescription.trim().length > 0);
  }

  format(context: ActionSummaryContext): string {
    const desc = (context.toolDescription ?? '').trim();
    // Lấy câu đầu tiên của description nếu dài
    const firstSentence = desc.split(/[.\n]/)[0].trim();
    return firstSentence || desc;
  }
}

export class FallbackSummaryAdapter implements ActionSummaryAdapter {
  readonly priority = 0;

  supports(_context: ActionSummaryContext): boolean {
    return true;
  }

  format(context: ActionSummaryContext): string {
    const cleanName = context.toolName.replace(/[._-]+/g, ' ').trim();
    return `Thực thi tác vụ: ${cleanName}`;
  }
}
