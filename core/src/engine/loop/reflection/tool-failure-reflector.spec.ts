import { ToolFailureReflector } from './tool-failure-reflector';
import {
  EToolFailureCategory,
  IToolFailureReflectionContext,
} from '../../../contracts/engine/tool-reflection.interface';
import {
  TOOL_FAIL_FAST_TITLE,
  TOOL_REFLECTION_HEADER,
} from '../../../constants/prompts/reflection.prompt';

describe('ToolFailureReflector', () => {
  let reflector: ToolFailureReflector;

  beforeEach(() => {
    reflector = new ToolFailureReflector();
  });

  const createContext = (
    rawErrorMessage: string,
    consecutiveFailures = 1,
  ): IToolFailureReflectionContext => ({
    toolName: 'test_tool',
    displayName: 'Test Tool',
    rawErrorMessage,
    args: { query: 'SELECT * FROM users' },
    consecutiveFailures,
    maxRetries: 2,
  });

  it('should diagnose missing required property error', () => {
    const context = createContext('Error: missing required property "userId"');
    const diagnostic = reflector.diagnose(context);

    expect(diagnostic.category).toBe(EToolFailureCategory.MISSING_REQUIRED_ARG);
    expect(diagnostic.rootCauseDescription).toContain('userId');
    expect(diagnostic.canRetryWithAdjustment).toBe(true);

    const message = reflector.reflect(context);
    expect(message).toContain(TOOL_REFLECTION_HEADER);
    expect(message).toContain('Thiếu tham số bắt buộc');
  });

  it('should diagnose invalid arg type error', () => {
    const context = createContext('Invalid type: expected number, got string');
    const diagnostic = reflector.diagnose(context);

    expect(diagnostic.category).toBe(EToolFailureCategory.INVALID_ARG_TYPE);
    expect(diagnostic.canRetryWithAdjustment).toBe(true);
  });

  it('should diagnose resource not found error', () => {
    const context = createContext('404 Not Found: Item does not exist');
    const diagnostic = reflector.diagnose(context);

    expect(diagnostic.category).toBe(EToolFailureCategory.RESOURCE_NOT_FOUND);
    expect(diagnostic.canRetryWithAdjustment).toBe(true);
  });

  it('should diagnose query syntax error', () => {
    const context = createContext('SQL syntax error: column "order_date" does not exist');
    const diagnostic = reflector.diagnose(context);

    expect(diagnostic.category).toBe(EToolFailureCategory.QUERY_SYNTAX_ERROR);
    expect(diagnostic.canRetryWithAdjustment).toBe(true);
  });

  it('should diagnose auth/permission error with fail-fast (canRetryWithAdjustment=false)', () => {
    const context = createContext('403 Forbidden: access denied to table secrets');
    const diagnostic = reflector.diagnose(context);

    expect(diagnostic.category).toBe(EToolFailureCategory.AUTH_OR_PERMISSION);
    expect(diagnostic.canRetryWithAdjustment).toBe(false);

    // Reflect should immediately output fail-fast message
    const message = reflector.reflect(context);
    expect(message).toContain(TOOL_FAIL_FAST_TITLE);
  });

  it('should fallback to generic strategy for unknown errors', () => {
    const context = createContext('Connection reset by peer unexpectedly');
    const diagnostic = reflector.diagnose(context);

    expect(diagnostic.category).toBe(EToolFailureCategory.UNKNOWN);
    expect(diagnostic.canRetryWithAdjustment).toBe(true);
  });
});
