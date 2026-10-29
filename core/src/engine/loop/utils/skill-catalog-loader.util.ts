import { Logger } from '@nestjs/common';
import { ISkillCatalogReader } from '../../../contracts/skill/skill-catalog-reader.interface';

// Nạp catalog Level 1 cho prompt. Lỗi (VD DB chưa migrate) chỉ làm mất catalog,
// không được chặn lượt chạy/lập kế hoạch nên trả '' và ghi một cảnh báo.
export async function loadSkillCatalogSafely(
  reader: ISkillCatalogReader | undefined,
  logger: Logger,
  tenantId?: string,
  excludeSlugs: readonly string[] = [],
): Promise<string> {
  if (!reader) return '';
  try {
    return await reader.getCatalogForPrompt(tenantId, excludeSlugs);
  } catch (error) {
    logger.warn(`Không thể nạp skill catalog: ${(error as Error)?.message}`);
    return '';
  }
}
