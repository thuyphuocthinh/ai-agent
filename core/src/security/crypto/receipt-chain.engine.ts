import { Inject, Injectable } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalSortedJson } from '../idempotency/canonical-hasher';
import { CRYPTOGRAPHIC_SIGNER } from '../constants/receipt.constants';
import type {
  ICryptographicSigner,
  IGenerateReceiptCommand,
  ISignedReceipt,
  ICryptographicReceiptPayload,
} from '../contracts/cryptographic-receipt.interface';

@Injectable()
export class ReceiptChainEngine {
  constructor(
    @Inject(CRYPTOGRAPHIC_SIGNER)
    private readonly signer: ICryptographicSigner,
  ) {}

  public computeSha256(value: unknown): string {
    const canonicalString = canonicalSortedJson(value);
    return createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  }

  /**
   * Tạo biên nhận hoàn chỉnh: nhận previousReceiptHash để nhúng vào payload,
   * sau đó băm toàn bộ payload thành currentReceiptHash và ký số Ed25519.
   */
  public buildReceipt(
    command: IGenerateReceiptCommand,
    sequenceNumber: number,
    previousReceiptHash: string,
  ): ISignedReceipt {
    const argumentsHash = this.computeSha256(command.inputArgs ?? {});
    const resultHash = this.computeSha256(command.rawResult ?? {});

    const payload: ICryptographicReceiptPayload = {
      receiptId: `rcpt_${randomUUID()}`,
      sequenceNumber,
      timestampIso: new Date().toISOString(),
      conversationId: command.conversationId,
      tenantId: command.tenantId || 'default',
      userId: command.userId,
      agentId: command.agentId,
      action: {
        toolName: command.toolName,
        actionType: command.actionType,
        argumentsHash,
        resultHash,
        policyId: command.policyId,
        reviewerId: command.reviewerId,
      },
      previousReceiptHash,
    };

    const canonicalPayload = canonicalSortedJson(payload);
    const currentReceiptHash = createHash('sha256')
      .update(canonicalPayload, 'utf8')
      .digest('hex');

    const signature = this.signer.signPayload(canonicalPayload);

    return {
      header: {
        version: '1.0',
        algorithm: 'Ed25519',
        hashAlgo: 'SHA-256',
        keyId: this.signer.getKeyId(),
      },
      payload,
      currentReceiptHash,
      signature,
    };
  }
}
