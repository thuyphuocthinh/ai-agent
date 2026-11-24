export const GENESIS_RECEIPT_HASH = '0'.repeat(64);

export interface IReceiptActionContext {
  readonly toolName: string;
  readonly actionType: string;
  readonly argumentsHash: string;
  readonly resultHash: string;
  readonly policyId?: string;
  readonly reviewerId?: string;
}

export interface ICryptographicReceiptPayload {
  readonly receiptId: string;
  readonly sequenceNumber: number;
  readonly timestampIso: string;
  readonly conversationId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly agentId: string;
  readonly action: IReceiptActionContext;
  readonly previousReceiptHash: string;
}

export interface ISignedReceiptHeader {
  readonly version: '1.0';
  readonly algorithm: 'Ed25519';
  readonly hashAlgo: 'SHA-256';
  readonly keyId: string;
}

export interface ISignedReceipt {
  readonly header: ISignedReceiptHeader;
  readonly payload: ICryptographicReceiptPayload;
  readonly currentReceiptHash: string;
  readonly signature: string; // 128-character Hex encoded Ed25519 signature
}

export interface IGenerateReceiptCommand {
  readonly conversationId: string;
  readonly tenantId?: string;
  readonly userId: string;
  readonly agentId: string;
  readonly toolName: string;
  readonly actionType: string;
  readonly inputArgs: unknown;
  readonly rawResult: unknown;
  readonly policyId?: string;
  readonly reviewerId?: string;
}

export interface ICryptographicSigner {
  signPayload(canonicalPayloadJson: string): string;
  verifyPayload(
    canonicalPayloadJson: string,
    signatureHex: string,
    publicKeyPem: string,
  ): boolean;
  getKeyId(): string;
  getPublicKeyPem(): string;
}

export interface IVerificationOutcome {
  readonly isValid: boolean;
  readonly checkedCount: number;
  readonly failedAtStep?: number;
  readonly reason?: string;
}
