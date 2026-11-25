import {
  STRATEGY_GENERIC_MSG,
  STRATEGY_GENERIC_HINT,
} from '../../../../constants/prompts/reflection.prompt';
import {
  EToolFailureCategory,
  type IToolDiagnosticStrategy,
  type IToolFailureDiagnostic,
  type IToolFailureReflectionContext,
} from '../../../../contracts/engine/tool-reflection.interface';

export class GenericFallbackStrategy implements IToolDiagnosticStrategy {
  public readonly category = EToolFailureCategory.UNKNOWN;

  public canHandle(_context: IToolFailureReflectionContext): boolean {
    return true;
  }

  public diagnose(_context: IToolFailureReflectionContext): IToolFailureDiagnostic {
    return {
      category: this.category,
      rootCauseDescription: STRATEGY_GENERIC_MSG,
      actionableGuidance: STRATEGY_GENERIC_HINT,
      canRetryWithAdjustment: true,
    };
  }
}
