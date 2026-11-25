import {
  STRATEGY_AUTH_PERMISSION_MSG,
  STRATEGY_AUTH_PERMISSION_HINT,
} from '../../../../constants/prompts/reflection.prompt';
import {
  EToolFailureCategory,
  type IToolDiagnosticStrategy,
  type IToolFailureDiagnostic,
  type IToolFailureReflectionContext,
} from '../../../../contracts/engine/tool-reflection.interface';

export class AuthOrPermissionStrategy implements IToolDiagnosticStrategy {
  public readonly category = EToolFailureCategory.AUTH_OR_PERMISSION;
  private static readonly PATTERN =
    /(?:unauthorized|forbidden|401|403|access denied|permission denied|không có quyền)/i;

  public canHandle(context: IToolFailureReflectionContext): boolean {
    return AuthOrPermissionStrategy.PATTERN.test(context.rawErrorMessage);
  }

  public diagnose(_context: IToolFailureReflectionContext): IToolFailureDiagnostic {
    return {
      category: this.category,
      rootCauseDescription: STRATEGY_AUTH_PERMISSION_MSG,
      actionableGuidance: STRATEGY_AUTH_PERMISSION_HINT,
      canRetryWithAdjustment: false, // Fail-fast on auth failures
    };
  }
}
