import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../prisma.service';
import { sanitizePrismaError } from '../../../common/errors';

const CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * PrismaTriggerClaimService
 * Cơ chế phân tán Atomic Claim Once ngăn ngừa các worker BullMQ xử lý trùng lặp cùng 1 triggerMessageId.
 * Sử dụng native INSERT ... ON CONFLICT DO NOTHING (skipDuplicates).
 * Tự động làm sạch các claim bị mồ côi (orphaned/stale claims) sau khi worker gặp sự cố cứng.
 */
@Injectable()
export class PrismaTriggerClaimService {
  private readonly logger = new Logger(PrismaTriggerClaimService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cố gắng giành quyền xử lý (Claim) trigger message.
   * Trả về true nếu là worker đầu tiên giành được lock, false nếu đã có worker khác claim trước.
   */
  async claim(triggerMessageId: string): Promise<boolean> {
    try {
      const result = await this.prisma.triggerClaim.createMany({
        data: [
          {
            id: uuidv7(),
            triggerMessageId,
          },
        ],
        skipDuplicates: true,
      });

      const claimed = result.count === 1;
      this.logger.log(
        `claim() triggerMessageId=${triggerMessageId} claimed=${claimed}`,
      );
      return claimed;
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaTriggerClaimService.claim');
    }
  }

  /**
   * Giải phóng claim khi việc bắt đầu lượt chat gặp lỗi sớm (trước khi kịp gửi tin nhắn phản hồi).
   */
  async release(triggerMessageId: string): Promise<void> {
    try {
      await this.prisma.triggerClaim.deleteMany({
        where: { triggerMessageId },
      });
      this.logger.warn(
        `release() triggerMessageId=${triggerMessageId} — Đã giải phóng claim để cho phép retry an toàn`,
      );
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaTriggerClaimService.release');
    }
  }

  /**
   * Dọn dẹp định kỳ các claim bị kẹt quá thời hạn CLAIM_TTL_MS do worker crash đột ngột.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'prisma-reap-stale-trigger-claims' })
  async reapStaleClaims(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - CLAIM_TTL_MS);
      const result = await this.prisma.triggerClaim.deleteMany({
        where: {
          createdAt: {
            lt: cutoff,
          },
        },
      });

      if (result.count > 0) {
        this.logger.warn(
          `reapStaleClaims() đã giải phóng ${result.count} stale claim(s) cũ hơn ${CLAIM_TTL_MS}ms`,
        );
      }
    } catch (error) {
      this.logger.error(
        `reapStaleClaims() gặp sự cố khi dọn dẹp trigger claims: ${(error as Error).message}`,
      );
    }
  }
}
