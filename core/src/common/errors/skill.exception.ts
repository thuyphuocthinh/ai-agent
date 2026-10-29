import { ConflictException, HttpStatus, NotFoundException } from '@nestjs/common';

/**
 * Lỗi khi slug skill đã tồn tại trong cùng tenant (409)
 */
export class SkillSlugConflictException extends ConflictException {
  public readonly isDomainException = true;
  public readonly code = 'SKILL_SLUG_CONFLICT';
  public readonly statusCode = HttpStatus.CONFLICT;
  public readonly isOperational = true;
  public readonly userFriendlyMessage =
    'Mã định danh (slug) của skill đã tồn tại.';
  public readonly details?: Record<string, unknown>;

  constructor(slug: string, tenantId: string) {
    super({
      message: `Skill với slug "${slug}" đã tồn tại trong tenant "${tenantId}"`,
      code: 'SKILL_SLUG_CONFLICT',
      userFriendlyMessage: 'Mã định danh (slug) của skill đã tồn tại.',
      slug,
    });
    this.details = { slug, tenantId };
  }
}

/**
 * Lỗi khi không tìm thấy skill (404)
 */
export class SkillNotFoundException extends NotFoundException {
  public readonly isDomainException = true;
  public readonly code = 'SKILL_NOT_FOUND';
  public readonly statusCode = HttpStatus.NOT_FOUND;
  public readonly isOperational = true;
  public readonly userFriendlyMessage = 'Skill không tồn tại.';
  public readonly details?: Record<string, unknown>;

  constructor(identifier: string) {
    super({
      message: `Không tìm thấy skill: ${identifier}`,
      code: 'SKILL_NOT_FOUND',
      userFriendlyMessage: 'Skill không tồn tại.',
      identifier,
    });
    this.details = { identifier };
  }
}
