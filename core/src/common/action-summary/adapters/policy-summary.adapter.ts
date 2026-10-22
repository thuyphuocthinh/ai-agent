import { ActionSummaryAdapter, ActionSummaryContext } from '../action-summary.interface';
import {
  DEFAULT_ACTION_SUMMARY_POLICIES,
  interpolateTemplate,
  ToolActionPolicyRule,
} from '../action-summary.policy';

export class PolicySummaryAdapter implements ActionSummaryAdapter {
  readonly priority = 50;

  constructor(
    private readonly policies: ToolActionPolicyRule[] = DEFAULT_ACTION_SUMMARY_POLICIES,
  ) {}

  supports(context: ActionSummaryContext): boolean {
    return this.findMatchingRule(context) !== null;
  }

  format(context: ActionSummaryContext): string {
    const rule = this.findMatchingRule(context);
    if (!rule) {
      return `Thực thi tác vụ: ${context.toolName}`;
    }

    const args = context.args ?? {};
    if (typeof rule.template === 'function') {
      return rule.template(args);
    }

    return interpolateTemplate(rule.template, args);
  }

  private findMatchingRule(context: ActionSummaryContext): ToolActionPolicyRule | null {
    for (const rule of this.policies) {
      if (rule.provider) {
        const matchesProvider =
          rule.provider instanceof RegExp
            ? rule.provider.test(context.provider)
            : rule.provider.toLowerCase() === context.provider.toLowerCase();
        if (!matchesProvider) continue;
      }

      const matchesTool =
        rule.tool instanceof RegExp
          ? rule.tool.test(context.toolName)
          : rule.tool.toLowerCase() === context.toolName.toLowerCase();

      if (matchesTool) {
        return rule;
      }
    }
    return null;
  }
}
