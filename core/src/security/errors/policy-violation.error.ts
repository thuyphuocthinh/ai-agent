import { BaseDomainException } from '../../common/errors';

export class BusinessPolicyViolationError extends BaseDomainException {
  public readonly code = 'BUSINESS_POLICY_VIOLATION';
  public readonly statusCode = 422;
  public readonly status = 422;

  constructor(
    public readonly policyRule: string,
    public readonly explanation: string,
  ) {
    super(`Vi phạm chính sách kinh doanh (${policyRule}): ${explanation}`, {
      userFriendlyMessage: `Thao tác không hợp lệ theo chính sách: ${explanation}`,
      details: {
        policyRule,
        explanation,
      },
    });
  }
}
