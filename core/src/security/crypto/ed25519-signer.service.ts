import { Injectable, Logger } from '@nestjs/common';
import {
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
} from 'node:crypto';
import type { ICryptographicSigner } from '../contracts/cryptographic-receipt.interface';

@Injectable()
export class Ed25519SignerService implements ICryptographicSigner {
  private readonly logger = new Logger(Ed25519SignerService.name);
  private readonly keyId: string;
  private readonly privateKeyObject: KeyObject;
  private readonly publicKeyPem: string;

  constructor() {
    this.keyId = process.env.AGENT_RECEIPT_KEY_ID || 'agent-core-local-dev';
    let privateKeyPem = process.env.AGENT_RECEIPT_PRIVATE_KEY_PEM;

    // Fallback key trong RAM khi chạy local dev/test mà chưa cấu hình .env
    if (!privateKeyPem && process.env.NODE_ENV !== 'production') {
      this.logger.warn(
        '[SECURITY] Chưa cấu hình AGENT_RECEIPT_PRIVATE_KEY_PEM. Đang tự sinh khóa Ed25519 tạm trong RAM cho DEV (Fallback Key)...',
      );
      const { privateKey } = generateKeyPairSync('ed25519');
      privateKeyPem = privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }) as string;
    }

    if (!privateKeyPem) {
      throw new Error(
        'FATAL: Bắt buộc phải cấu hình AGENT_RECEIPT_PRIVATE_KEY_PEM trên môi trường Production!',
      );
    }

    try {
      const normalizedKeyPem = privateKeyPem.replace(/\\n/g, '\n');
      this.privateKeyObject = createPrivateKey({
        key: normalizedKeyPem,
        format: 'pem',
      });
      const pubKeyObject = createPublicKey(this.privateKeyObject);
      this.publicKeyPem = pubKeyObject.export({
        type: 'spki',
        format: 'pem',
      }) as string;
    } catch (error) {
      this.logger.error(
        `Failed to load Ed25519 keys: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  public getKeyId(): string {
    return this.keyId;
  }

  public getPublicKeyPem(): string {
    return this.publicKeyPem;
  }

  public signPayload(canonicalPayloadJson: string): string {
    const dataBuffer = Buffer.from(canonicalPayloadJson, 'utf8');
    const signatureBuffer = sign(null, dataBuffer, this.privateKeyObject);
    return signatureBuffer.toString('hex');
  }

  public verifyPayload(
    canonicalPayloadJson: string,
    signatureHex: string,
    publicKeyPem: string,
  ): boolean {
    try {
      const dataBuffer = Buffer.from(canonicalPayloadJson, 'utf8');
      const signatureBuffer = Buffer.from(signatureHex, 'hex');
      const pubKey = createPublicKey({ key: publicKeyPem, format: 'pem' });
      return verify(null, dataBuffer, pubKey, signatureBuffer);
    } catch {
      return false;
    }
  }
}
