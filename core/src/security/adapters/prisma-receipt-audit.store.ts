import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ReceiptChainEngine } from '../crypto/receipt-chain.engine';
import {
  GENESIS_RECEIPT_HASH,
  type IGenerateReceiptCommand,
  type ISignedReceipt,
} from '../contracts/cryptographic-receipt.interface';
import { sanitizePrismaError } from '../../common/errors';
import { AuditStatus, Prisma } from '@prisma/client';

@Injectable()
export class PrismaReceiptAuditStore {
  private readonly logger = new Logger(PrismaReceiptAuditStore.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly receiptEngine: ReceiptChainEngine,
  ) {}

  /**
   * Lưu vết kiểm toán và ký số nguyên tử (Atomic Hash-Chaining).
   * Sử dụng Transaction để chống Race Condition khi nhiều workers cùng log.
   */
  async recordActionWithReceipt(
    command: IGenerateReceiptCommand,
    verdict: string,
    status: AuditStatus,
  ): Promise<ISignedReceipt> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // [ĐOẠN 1]: TÌM BẢN GHI TRƯỚC (N-1) ĐỂ LẤY CURRENT HASH CỦA NÓ
          const lastRecord = await tx.auditLog.findFirst({
            where: { conversationId: command.conversationId },
            orderBy: { sequenceNumber: 'desc' },
            select: {
              sequenceNumber: true,
              currentReceiptHash: true,
            },
          });

          // Nếu chưa có bản ghi nào, sequence = 1, prevHash = Genesis 64 số 0.
          // Nếu đã có bản ghi trước, lấy currentReceiptHash của nó làm prevHash của bản ghi này.
          const nextSeq = lastRecord ? lastRecord.sequenceNumber + 1 : 1;
          const prevHash = lastRecord
            ? lastRecord.currentReceiptHash
            : GENESIS_RECEIPT_HASH;

          // [ĐOẠN 2]: CHUYỂN prevHash VÀO BUILDER ĐỂ SINH RA currentReceiptHash MỚI
          const signedReceipt = this.receiptEngine.buildReceipt(
            command,
            nextSeq,
            prevHash,
          );

          // [ĐOẠN 3]: LƯU BẢN GHI HIỆN TẠI VÀO DB VỚI CẢ 2 HASH (PREV VÀ CURRENT)
          await tx.auditLog.create({
            data: {
              conversationId: command.conversationId,
              userId: command.userId,
              provider: 'core_security',
              toolName: command.toolName,
              actionType: command.actionType,
              fingerprint: this.receiptEngine.computeSha256(command.inputArgs),
              inputArgs: JSON.parse(
                JSON.stringify(command.inputArgs),
              ) as Prisma.InputJsonObject,
              resultPreview:
                typeof command.rawResult === 'string'
                  ? command.rawResult.slice(0, 1000)
                  : JSON.stringify(command.rawResult).slice(0, 1000),
              verdict,
              status,
              // Metadata chữ ký & xâu chuỗi băm
              sequenceNumber: signedReceipt.payload.sequenceNumber,
              previousReceiptHash: signedReceipt.payload.previousReceiptHash,
              currentReceiptHash: signedReceipt.currentReceiptHash,
              signature: signedReceipt.signature,
              keyId: signedReceipt.header.keyId,
            },
          });

          return signedReceipt;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      throw sanitizePrismaError(
        error,
        'PrismaReceiptAuditStore.recordActionWithReceipt',
      );
    }
  }
}
