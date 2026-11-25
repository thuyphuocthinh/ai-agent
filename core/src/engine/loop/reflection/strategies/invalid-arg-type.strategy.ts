import {
  STRATEGY_TYPE_MISMATCH_MSG,
  STRATEGY_TYPE_MISMATCH_HINT,
} from '../../../../constants/prompts/reflection.prompt';
import {
  EToolFailureCategory,
  type IToolDiagnosticStrategy,
  type IToolFailureDiagnostic,
  type IToolFailureReflectionContext,
} from '../../../../contracts/engine/tool-reflection.interface';

export class InvalidArgTypeStrategy implements IToolDiagnosticStrategy {
  public readonly category = EToolFailureCategory.INVALID_ARG_TYPE;
  private static readonly PATTERN =
    /(?:expected\s+(?:number|string|boolean|array|object)|invalid type|must be a(?:n)?\s+(?:number|string|boolean|integer)|sai kiểu dữ liệu)/i;

  public canHandle(context: IToolFailureReflectionContext): boolean {
    return InvalidArgTypeStrategy.PATTERN.test(context.rawErrorMessage);
  }

  public diagnose(_context: IToolFailureReflectionContext): IToolFailureDiagnostic {
    return {
      category: this.category,
      rootCauseDescription: STRATEGY_TYPE_MISMATCH_MSG,
      actionableGuidance: STRATEGY_TYPE_MISMATCH_HINT,
      canRetryWithAdjustment: true,
    };
  }
}
