import { createHash, verify, createPublicKey } from 'node:crypto';
import { canonicalSortedJson } from '../idempotency/canonical-hasher';
import {
  GENESIS_RECEIPT_HASH,
  type ISignedReceipt,
  type IVerificationOutcome,
} from '../contracts/cryptographic-receipt.interface';

export class AuditorChainVerifier {
  /**
   * Xác minh toán học toàn bộ chuỗi biên nhận
   */
  public static verifyChain(
    receipts: readonly ISignedReceipt[],
    trustedPublicKeyPem: string,
  ): IVerificationOutcome {
    if (receipts.length === 0) {
      return { isValid: true, checkedCount: 0 };
    }

    const normalizedPubKey = trustedPublicKeyPem.replace(/\\n/g, '\n');
    const pubKey = createPublicKey({ key: normalizedPubKey, format: 'pem' });

    for (let index = 0; index < receipts.length; index++) {
      const receipt = receipts[index];
      const payload = receipt.payload;
      const canonicalPayloadString = canonicalSortedJson(payload);

      // 1. Kiểm tra chữ ký số Ed25519
      const signatureBuffer = Buffer.from(receipt.signature, 'hex');
      const dataBuffer = Buffer.from(canonicalPayloadString, 'utf8');
      const isSigValid = verify(null, dataBuffer, pubKey, signatureBuffer);

      if (!isSigValid) {
        return {
          isValid: false,
          checkedCount: index,
          failedAtStep: payload.sequenceNumber,
          reason: `Chữ ký Ed25519 không khớp tại sequence ${payload.sequenceNumber}. Dữ liệu payload đã bị chỉnh sửa!`,
        };
      }

      // 2. Kiểm tra Hash toàn vẹn (Current Receipt Hash)
      const expectedHash = createHash('sha256')
        .update(canonicalPayloadString, 'utf8')
        .digest('hex');

      if (expectedHash !== receipt.currentReceiptHash) {
        return {
          isValid: false,
          checkedCount: index,
          failedAtStep: payload.sequenceNumber,
          reason: `currentReceiptHash bị sai lệch tại sequence ${payload.sequenceNumber}.`,
        };
      }

      // 3. Kiểm tra tính liên tục của chuỗi băm (Hash-Chaining Continuity)
      if (index === 0) {
        if (payload.previousReceiptHash !== GENESIS_RECEIPT_HASH) {
          return {
            isValid: false,
            checkedCount: index,
            failedAtStep: payload.sequenceNumber,
            reason: `Bản ghi đầu tiên không trỏ về Genesis Hash!`,
          };
        }
      } else {
        const previousReceipt = receipts[index - 1];

        // Đảm bảo không bị nhảy cóc sequence number
        if (
          payload.sequenceNumber !==
          previousReceipt.payload.sequenceNumber + 1
        ) {
          return {
            isValid: false,
            checkedCount: index,
            failedAtStep: payload.sequenceNumber,
            reason: `Phát hiện mất log: Sequence nhảy cóc từ ${previousReceipt.payload.sequenceNumber} lên ${payload.sequenceNumber}!`,
          };
        }

        // ĐỐI CHIẾU XÂU CHUỖI: prevHash của bản ghi hiện tại phải bằng currentHash bản ghi trước!
        if (payload.previousReceiptHash !== previousReceipt.currentReceiptHash) {
          return {
            isValid: false,
            checkedCount: index,
            failedAtStep: payload.sequenceNumber,
            reason: `Đứt gãy chuỗi băm: prevHash của seq ${payload.sequenceNumber} không khớp với hash seq ${previousReceipt.payload.sequenceNumber}!`,
          };
        }
      }
    }

    return {
      isValid: true,
      checkedCount: receipts.length,
    };
  }
}
