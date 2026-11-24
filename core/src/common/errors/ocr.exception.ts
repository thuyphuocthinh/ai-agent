import { BaseDomainException } from './base-domain.exception';

export class OcrException extends BaseDomainException {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(
    message: string,
    options?: {
      code?: string;
      statusCode?: number;
      details?: Record<string, unknown>;
      userFriendlyMessage?: string;
      isOperational?: boolean;
    },
  ) {
    super(message, {
      userFriendlyMessage: options?.userFriendlyMessage ?? message,
      details: options?.details,
      isOperational: options?.isOperational ?? true,
    });
    this.code = options?.code ?? 'OCR_EXTRACTION_ERROR';
    this.statusCode = options?.statusCode ?? 400;
  }
}
