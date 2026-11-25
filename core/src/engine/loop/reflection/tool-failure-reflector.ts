import {
  type IToolDiagnosticStrategy,
  type IToolFailureDiagnostic,
  type IToolFailureReflectionContext,
} from '../../../contracts/engine/tool-reflection.interface';
import { MissingRequiredArgStrategy } from './strategies/missing-required-arg.strategy';
import { InvalidArgTypeStrategy } from './strategies/invalid-arg-type.strategy';
import { ResourceNotFoundStrategy } from './strategies/resource-not-found.strategy';
import { QuerySyntaxErrorStrategy } from './strategies/query-syntax-error.strategy';
import { AuthOrPermissionStrategy } from './strategies/auth-or-permission.strategy';
import { GenericFallbackStrategy } from './strategies/generic-fallback.strategy';
import { buildToolReflectiveMessage } from '../utils/reflection-prompt.util';

export class ToolFailureReflector {
  private readonly strategies: readonly IToolDiagnosticStrategy[];
  private readonly fallbackStrategy: IToolDiagnosticStrategy;

  constructor() {
    this.fallbackStrategy = new GenericFallbackStrategy();
    this.strategies = Object.freeze([
      new MissingRequiredArgStrategy(),
      new InvalidArgTypeStrategy(),
      new ResourceNotFoundStrategy(),
      new QuerySyntaxErrorStrategy(),
      new AuthOrPermissionStrategy(),
    ]);
  }

  public reflect(context: IToolFailureReflectionContext): string {
    const diagnostic = this.diagnose(context);
    return buildToolReflectiveMessage(context, diagnostic);
  }

  public diagnose(context: IToolFailureReflectionContext): IToolFailureDiagnostic {
    const matchedStrategy =
      this.strategies.find((strategy) => strategy.canHandle(context)) ?? this.fallbackStrategy;
    return matchedStrategy.diagnose(context);
  }
}
