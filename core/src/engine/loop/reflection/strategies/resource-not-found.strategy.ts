import {
  STRATEGY_NOT_FOUND_MSG,
  STRATEGY_NOT_FOUND_HINT,
} from '../../../../constants/prompts/reflection.prompt';
import {
  EToolFailureCategory,
  type IToolDiagnosticStrategy,
  type IToolFailureDiagnostic,
  type IToolFailureReflectionContext,
} from '../../../../contracts/engine/tool-reflection.interface';

export class ResourceNotFoundStrategy implements IToolDiagnosticStrategy {
  public readonly category = EToolFailureCategory.RESOURCE_NOT_FOUND;
  private static readonly PATTERN =
    /(?:not found|404|no such (?:file|record|table|user|item)|không tìm thấy)/i;

  public canHandle(context: IToolFailureReflectionContext): boolean {
    return ResourceNotFoundStrategy.PATTERN.test(context.rawErrorMessage);
  }

  public diagnose(_context: IToolFailureReflectionContext): IToolFailureDiagnostic {
    return {
      category: this.category,
      rootCauseDescription: STRATEGY_NOT_FOUND_MSG,
      actionableGuidance: STRATEGY_NOT_FOUND_HINT,
      canRetryWithAdjustment: true,
    };
  }
}
