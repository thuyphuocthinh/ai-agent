import { PrismaReceiptAuditStore } from './prisma-receipt-audit.store';
import { ReceiptChainEngine } from '../crypto/receipt-chain.engine';
import { Ed25519SignerService } from '../crypto/ed25519-signer.service';
import {
  GENESIS_RECEIPT_HASH,
  type IGenerateReceiptCommand,
} from '../contracts/cryptographic-receipt.interface';
import { AuditStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

describe('PrismaReceiptAuditStore', () => {
  let store: PrismaReceiptAuditStore;
  let receiptEngine: ReceiptChainEngine;
  let mockPrisma: {
    $transaction: jest.Mock;
    auditLog: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.AGENT_RECEIPT_PRIVATE_KEY_PEM;

    const signer = new Ed25519SignerService();
    receiptEngine = new ReceiptChainEngine(signer);

    mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(mockPrisma),
      ),
      auditLog: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    store = new PrismaReceiptAuditStore(
      mockPrisma as unknown as PrismaService,
      receiptEngine,
    );
  });

  const command: IGenerateReceiptCommand = {
    conversationId: 'conv_unit_test',
    userId: 'usr_unit_test',
    agentId: 'agent_unit_test',
    toolName: 'refund_order',
    actionType: 'DESTRUCTIVE_EXECUTION',
    inputArgs: { orderId: 'ord_123', amount: 50 },
    rawResult: { success: true },
  };

  it('should create the first receipt with sequence 1 and Genesis previousReceiptHash', async () => {
    mockPrisma.auditLog.findFirst.mockResolvedValue(null);
    mockPrisma.auditLog.create.mockImplementation(
      async ({ data }: { data: Prisma.AuditLogUncheckedCreateInput }) => ({
        id: 'mock_uuid_1',
        ...data,
      }),
    );

    const receipt = await store.recordActionWithReceipt(
      command,
      'ALLOW',
      AuditStatus.EXECUTED,
    );

    expect(receipt.payload.sequenceNumber).toBe(1);
    expect(receipt.payload.previousReceiptHash).toBe(GENESIS_RECEIPT_HASH);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sequenceNumber: 1,
          previousReceiptHash: GENESIS_RECEIPT_HASH,
          currentReceiptHash: receipt.currentReceiptHash,
        }),
      }),
    );
  });

  it('should chain to previous record with incremented sequence and matching previousReceiptHash', async () => {
    const prevCurrentHash =
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    mockPrisma.auditLog.findFirst.mockResolvedValue({
      sequenceNumber: 41,
      currentReceiptHash: prevCurrentHash,
    });
    mockPrisma.auditLog.create.mockImplementation(
      async ({ data }: { data: Prisma.AuditLogUncheckedCreateInput }) => ({
        id: 'mock_uuid_42',
        ...data,
      }),
    );

    const receipt = await store.recordActionWithReceipt(
      command,
      'ALLOW',
      AuditStatus.EXECUTED,
    );

    expect(receipt.payload.sequenceNumber).toBe(42);
    expect(receipt.payload.previousReceiptHash).toBe(prevCurrentHash);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sequenceNumber: 42,
          previousReceiptHash: prevCurrentHash,
          currentReceiptHash: receipt.currentReceiptHash,
        }),
      }),
    );
  });
});
