import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

export const ADMIN_API_KEY_HEADER = 'x-admin-key';
export const ADMIN_API_KEY_ENV = 'SKILL_ADMIN_API_KEY';

interface HttpRequestLike {
  headers: Record<string, string | string[] | undefined>;
}

// So sánh hằng thời gian: băm trước để hai chuỗi luôn cùng độ dài.
function safeEqual(a: string, b: string): boolean {
  const hash = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(hash(a), hash(b));
}

/**
 * Guard TẠM cho API quản trị khi hệ thống chưa có auth/RBAC: so header
 * `x-admin-key` với biến môi trường SKILL_ADMIN_API_KEY. Chưa cấu hình biến thì
 * từ chối mọi request (fail-closed). Thay bằng guard auth thật khi có.
 */
@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env[ADMIN_API_KEY_ENV];
    if (!expected) {
      throw new ForbiddenException(
        `API quản trị chưa được cấu hình (thiếu ${ADMIN_API_KEY_ENV})`,
      );
    }

    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    const header = request.headers[ADMIN_API_KEY_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || !safeEqual(provided, expected)) {
      throw new UnauthorizedException('Thiếu hoặc sai admin API key');
    }
    return true;
  }
}
