import { Ed25519SignerService } from './ed25519-signer.service';
import { generateReceiptKeyPair } from './generate-receipt-keys';

describe('Ed25519SignerService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should auto-generate an in-memory fallback Ed25519 key in development when env is missing', () => {
    delete process.env.AGENT_RECEIPT_PRIVATE_KEY_PEM;
    process.env.NODE_ENV = 'development';

    const signer = new Ed25519SignerService();

    expect(signer.getKeyId()).toBe('agent-core-local-dev');
    expect(signer.getPublicKeyPem()).toContain('BEGIN PUBLIC KEY');
  });

  it('should throw an error in production when AGENT_RECEIPT_PRIVATE_KEY_PEM is missing', () => {
    delete process.env.AGENT_RECEIPT_PRIVATE_KEY_PEM;
    process.env.NODE_ENV = 'production';

    expect(() => new Ed25519SignerService()).toThrow(
      /Bắt buộc phải cấu hình AGENT_RECEIPT_PRIVATE_KEY_PEM/i,
    );
  });

  it('should sign canonical payload and verify successfully with matching public key', () => {
    const { keyId, privateKeyPem, publicKeyPem } = generateReceiptKeyPair();
    process.env.AGENT_RECEIPT_KEY_ID = keyId;
    process.env.AGENT_RECEIPT_PRIVATE_KEY_PEM = privateKeyPem;
    process.env.NODE_ENV = 'production';

    const signer = new Ed25519SignerService();
    const payload = JSON.stringify({
      action: 'refund_order',
      amount: 500,
      sequence: 1,
    });

    const signatureHex = signer.signPayload(payload);

    expect(typeof signatureHex).toBe('string');
    expect(signatureHex.length).toBe(128); // 64 bytes in hex format

    const isValid = signer.verifyPayload(payload, signatureHex, publicKeyPem);
    expect(isValid).toBe(true);
  });

  it('should reject verification when payload is tampered', () => {
    const signer = new Ed25519SignerService();
    const originalPayload = JSON.stringify({ amount: 100 });
    const tamperedPayload = JSON.stringify({ amount: 9999 });

    const signatureHex = signer.signPayload(originalPayload);
    const isValid = signer.verifyPayload(
      tamperedPayload,
      signatureHex,
      signer.getPublicKeyPem(),
    );

    expect(isValid).toBe(false);
  });

  it('should reject verification when signature is invalid or checked with a different public key', () => {
    const signer1 = new Ed25519SignerService();
    const { publicKeyPem: differentPubKey } = generateReceiptKeyPair();

    const payload = JSON.stringify({ action: 'check_room' });
    const signatureHex = signer1.signPayload(payload);

    const isValidWithWrongKey = signer1.verifyPayload(
      payload,
      signatureHex,
      differentPubKey,
    );
    expect(isValidWithWrongKey).toBe(false);

    const isValidWithCorruptedSig = signer1.verifyPayload(
      payload,
      '0'.repeat(128),
      signer1.getPublicKeyPem(),
    );
    expect(isValidWithCorruptedSig).toBe(false);
  });

  it('should correctly parse private key when newlines are escaped (\\n in .env)', () => {
    const { privateKeyPem } = generateReceiptKeyPair();
    const escapedPem = privateKeyPem.replace(/\n/g, '\\n');
    process.env.AGENT_RECEIPT_PRIVATE_KEY_PEM = escapedPem;

    const signer = new Ed25519SignerService();
    expect(signer.getPublicKeyPem()).toContain('BEGIN PUBLIC KEY');

    const payload = JSON.stringify({ test: 'escaped_pem' });
    const sig = signer.signPayload(payload);
    expect(signer.verifyPayload(payload, sig, signer.getPublicKeyPem())).toBe(true);
  });
});
