import { Ed25519SignerService } from './ed25519-signer.service';
import { ReceiptChainEngine } from './receipt-chain.engine';
import { AuditorChainVerifier } from './auditor-chain-verifier.util';
import {
  GENESIS_RECEIPT_HASH,
  type ISignedReceipt,
  type IGenerateReceiptCommand,
} from '../contracts/cryptographic-receipt.interface';

describe('ReceiptChainEngine & AuditorChainVerifier', () => {
  let signer: Ed25519SignerService;
  let engine: ReceiptChainEngine;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.AGENT_RECEIPT_PRIVATE_KEY_PEM;

    signer = new Ed25519SignerService();
    engine = new ReceiptChainEngine(signer);
  });

  const createCommand = (
    seq: number,
    toolName: string,
    actionType: string,
    amount: number,
  ): IGenerateReceiptCommand => ({
    conversationId: 'conv_test_123',
    tenantId: 'tenant_default',
    userId: 'usr_alice',
    agentId: 'agent_supervisor',
    toolName,
    actionType,
    inputArgs: { amount, currency: 'USD', reason: 'test action' },
    rawResult: { status: 'SUCCESS', transactionId: `tx_${seq}` },
    policyId: 'POL_TRANSACTION_LIMIT',
  });

  it('should successfully build a continuous 3-receipt chain and verify it', () => {
    // Action 1
    const cmd1 = createCommand(1, 'check_balance', 'READ', 0);
    const receipt1 = engine.buildReceipt(cmd1, 1, GENESIS_RECEIPT_HASH);

    expect(receipt1.payload.sequenceNumber).toBe(1);
    expect(receipt1.payload.previousReceiptHash).toBe(GENESIS_RECEIPT_HASH);
    expect(receipt1.currentReceiptHash.length).toBe(64);

    // Action 2 (xâu chuỗi từ receipt1)
    const cmd2 = createCommand(2, 'request_approval', 'APPROVAL', 500);
    const receipt2 = engine.buildReceipt(
      cmd2,
      2,
      receipt1.currentReceiptHash,
    );

    expect(receipt2.payload.sequenceNumber).toBe(2);
    expect(receipt2.payload.previousReceiptHash).toBe(
      receipt1.currentReceiptHash,
    );

    // Action 3 (xâu chuỗi từ receipt2)
    const cmd3 = createCommand(3, 'refund_payment', 'DESTRUCTIVE_EXECUTION', 500);
    const receipt3 = engine.buildReceipt(
      cmd3,
      3,
      receipt2.currentReceiptHash,
    );

    expect(receipt3.payload.sequenceNumber).toBe(3);
    expect(receipt3.payload.previousReceiptHash).toBe(
      receipt2.currentReceiptHash,
    );

    // Xác minh toán học toàn bộ chuỗi 3 biên nhận
    const chain: ISignedReceipt[] = [receipt1, receipt2, receipt3];
    const outcome = AuditorChainVerifier.verifyChain(
      chain,
      signer.getPublicKeyPem(),
    );

    expect(outcome.isValid).toBe(true);
    expect(outcome.checkedCount).toBe(3);
  });

  it('should detect tampering when payload in a receipt is maliciously altered', () => {
    const cmd1 = createCommand(1, 'check_balance', 'READ', 0);
    const receipt1 = engine.buildReceipt(cmd1, 1, GENESIS_RECEIPT_HASH);

    const cmd2 = createCommand(2, 'refund_payment', 'DESTRUCTIVE_EXECUTION', 100);
    const receipt2 = engine.buildReceipt(
      cmd2,
      2,
      receipt1.currentReceiptHash,
    );

    // Kẻ gian sửa actionType trong payload của receipt2 mà không thể ký lại
    const tamperedReceipt2: ISignedReceipt = {
      ...receipt2,
      payload: {
        ...receipt2.payload,
        action: {
          ...receipt2.payload.action,
          actionType: 'MALICIOUS_EXECUTION',
        },
      },
    };

    const chain = [receipt1, tamperedReceipt2];
    const outcome = AuditorChainVerifier.verifyChain(
      chain,
      signer.getPublicKeyPem(),
    );

    expect(outcome.isValid).toBe(false);
    expect(outcome.failedAtStep).toBe(2);
    expect(outcome.reason).toContain('Chữ ký Ed25519 không khớp');
  });

  it('should detect deletion/drop of an intermediate receipt (sequence and hash broken)', () => {
    const cmd1 = createCommand(1, 'check_balance', 'READ', 0);
    const receipt1 = engine.buildReceipt(cmd1, 1, GENESIS_RECEIPT_HASH);

    const cmd2 = createCommand(2, 'request_approval', 'APPROVAL', 500);
    const receipt2 = engine.buildReceipt(
      cmd2,
      2,
      receipt1.currentReceiptHash,
    );

    const cmd3 = createCommand(3, 'refund_payment', 'DESTRUCTIVE_EXECUTION', 500);
    const receipt3 = engine.buildReceipt(
      cmd3,
      3,
      receipt2.currentReceiptHash,
    );

    // Kẻ gian xóa bỏ receipt2 khỏi DB, chỉ còn receipt1 và receipt3
    const brokenChain = [receipt1, receipt3];
    const outcome = AuditorChainVerifier.verifyChain(
      brokenChain,
      signer.getPublicKeyPem(),
    );

    expect(outcome.isValid).toBe(false);
    expect(outcome.failedAtStep).toBe(3);
    expect(outcome.reason).toContain('Phát hiện mất log: Sequence nhảy cóc');
  });

  it('should detect when receipts order is swapped', () => {
    const cmd1 = createCommand(1, 'check_balance', 'READ', 0);
    const receipt1 = engine.buildReceipt(cmd1, 1, GENESIS_RECEIPT_HASH);

    const cmd2 = createCommand(2, 'refund_payment', 'DESTRUCTIVE_EXECUTION', 100);
    const receipt2 = engine.buildReceipt(
      cmd2,
      2,
      receipt1.currentReceiptHash,
    );

    // Đảo thứ tự receipt2 lên trước receipt1
    const swappedChain = [receipt2, receipt1];
    const outcome = AuditorChainVerifier.verifyChain(
      swappedChain,
      signer.getPublicKeyPem(),
    );

    expect(outcome.isValid).toBe(false);
    expect(outcome.reason).toContain(
      'Bản ghi đầu tiên không trỏ về Genesis Hash',
    );
  });

  it('should detect when currentReceiptHash does not match computed hash', () => {
    const cmd1 = createCommand(1, 'check_balance', 'READ', 0);
    const receipt1 = engine.buildReceipt(cmd1, 1, GENESIS_RECEIPT_HASH);

    const tamperedReceipt: ISignedReceipt = {
      ...receipt1,
      currentReceiptHash: 'f'.repeat(64),
    };

    const outcome = AuditorChainVerifier.verifyChain(
      [tamperedReceipt],
      signer.getPublicKeyPem(),
    );

    expect(outcome.isValid).toBe(false);
    expect(outcome.failedAtStep).toBe(1);
    expect(outcome.reason).toContain('currentReceiptHash bị sai lệch');
  });
});
