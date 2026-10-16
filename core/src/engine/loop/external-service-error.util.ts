import { RpcException } from '@nestjs/microservices';
import { PiiScrubberUtil } from '../../security/pii/pii-scrubber.util';

export function describeExternalServiceError(error: unknown): string {
  if (error instanceof RpcException) {
    const info = error.getError() as { code?: string; message?: string };
    return `⚠️ Lỗi hệ thống (${info?.code ?? 'UNKNOWN'}): ${scrub(info?.message ?? error.message)}`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `⚠️ Lỗi: ${scrub(message)}`;
}

function scrub(message: string): string {
  return PiiScrubberUtil.scrub(message) as string;
}
