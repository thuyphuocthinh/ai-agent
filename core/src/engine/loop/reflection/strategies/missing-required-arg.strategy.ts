import {
  STRATEGY_MISSING_ARG_MSG,
  STRATEGY_MISSING_ARG_HINT,
} from '../../../../constants/prompts/reflection.prompt';
import {
  EToolFailureCategory,
  type IToolDiagnosticStrategy,
  type IToolFailureDiagnostic,
  type IToolFailureReflectionContext,
} from '../../../../contracts/engine/tool-reflection.interface';

export class MissingRequiredArgStrategy implements IToolDiagnosticStrategy {
  public readonly category = EToolFailureCategory.MISSING_REQUIRED_ARG;
  private static readonly PATTERN =
    /(?:missing required property|field required|requires parameter|thiếu tham số)\s*['"]?([a-zA-Z0-9_]+)['"]?/i;

  public canHandle(context: IToolFailureReflectionContext): boolean {
    return MissingRequiredArgStrategy.PATTERN.test(context.rawErrorMessage);
  }

  public diagnose(context: IToolFailureReflectionContext): IToolFailureDiagnostic {
    const match = context.rawErrorMessage.match(MissingRequiredArgStrategy.PATTERN);
    const missingProp = match?.[1] ? ` (Trường: "${match[1]}")` : '';
    return {
      category: this.category,
      rootCauseDescription: `${STRATEGY_MISSING_ARG_MSG}${missingProp}`,
      actionableGuidance: STRATEGY_MISSING_ARG_HINT,
      canRetryWithAdjustment: true,
    };
  }
}
