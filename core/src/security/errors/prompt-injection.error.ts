import { BaseDomainException } from '../../common/errors';

export class PromptInjectionDetectedError extends BaseDomainException {
  public readonly code = 'PROMPT_INJECTION_DETECTED';
  public readonly statusCode = 400;
  public readonly status = 400;

  constructor(
    public readonly reason: string,
    public readonly riskLevel: 'low' | 'medium' | 'high' = 'high',
    public readonly matchedPattern?: string,
  ) {
    super(`Phát hiện câu lệnh vi phạm an toàn (Prompt Injection): ${reason}`, {
      userFriendlyMessage: 'Yêu cầu không được chấp nhận do vi phạm quy tắc an toàn bảo mật.',
      details: {
        reason,
        riskLevel,
        ...(matchedPattern ? { matchedPattern } : {}),
      },
    });
  }
}
