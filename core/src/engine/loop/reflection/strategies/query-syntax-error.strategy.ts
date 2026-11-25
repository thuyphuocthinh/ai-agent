import {
  STRATEGY_QUERY_SYNTAX_MSG,
  STRATEGY_QUERY_SYNTAX_HINT,
} from '../../../../constants/prompts/reflection.prompt';
import {
  EToolFailureCategory,
  type IToolDiagnosticStrategy,
  type IToolFailureDiagnostic,
  type IToolFailureReflectionContext,
} from '../../../../contracts/engine/tool-reflection.interface';

export class QuerySyntaxErrorStrategy implements IToolDiagnosticStrategy {
  public readonly category = EToolFailureCategory.QUERY_SYNTAX_ERROR;
  private static readonly PATTERN =
    /(?:syntax error|sql syntax|column .* does not exist|relation .* does not exist|undefined column|cú pháp)/i;

  public canHandle(context: IToolFailureReflectionContext): boolean {
    return QuerySyntaxErrorStrategy.PATTERN.test(context.rawErrorMessage);
  }

  public diagnose(_context: IToolFailureReflectionContext): IToolFailureDiagnostic {
    return {
      category: this.category,
      rootCauseDescription: STRATEGY_QUERY_SYNTAX_MSG,
      actionableGuidance: STRATEGY_QUERY_SYNTAX_HINT,
      canRetryWithAdjustment: true,
    };
  }
}
