import { Module } from '@nestjs/common';
import { PromptInjectionGuard } from './guardrails/prompt-injection.guard';
import { ProviderPreflightGuard } from './preflight/provider-preflight.guard';
import { BusinessPolicyEngine } from './policy/business-policy.engine';
import { PolicyCorpusService } from './policy/policy-corpus.service';
import { SemanticPolicyEvaluatorService } from './policy/semantic-policy-evaluator.service';
import { HumanEscalationService } from './escalation/human-escalation.service';
import { IdempotencyManager } from './idempotency/idempotency.manager';
import { ActionAuditService } from './audit/action-audit.service';
import {
  AUDIT_STORE,
  ESCALATION_STORE,
  IDEMPOTENCY_STORE,
} from './constants/security.constants';
import { InMemoryAuditStore } from './adapters/in-memory-audit.store';
import { InMemoryIdempotencyStore } from './adapters/in-memory-idempotency.store';
import { InMemoryEscalationStore } from './adapters/in-memory-escalation.store';
import { PrismaAuditStore } from './adapters/prisma-audit.store';
import { PrismaReceiptAuditStore } from './adapters/prisma-receipt-audit.store';
import { Ed25519SignerService } from './crypto/ed25519-signer.service';
import { ReceiptChainEngine } from './crypto/receipt-chain.engine';
import {
  CRYPTOGRAPHIC_SIGNER,
  RECEIPT_CHAIN_ENGINE,
} from './constants/receipt.constants';
import { DatabaseModule } from '../infrastructure/database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [
    PromptInjectionGuard,
    ProviderPreflightGuard,
    BusinessPolicyEngine,
    PolicyCorpusService,
    SemanticPolicyEvaluatorService,
    HumanEscalationService,
    IdempotencyManager,
    ActionAuditService,
    InMemoryAuditStore,
    InMemoryIdempotencyStore,
    InMemoryEscalationStore,
    PrismaAuditStore,
    PrismaReceiptAuditStore,
    Ed25519SignerService,
    ReceiptChainEngine,
    {
      provide: CRYPTOGRAPHIC_SIGNER,
      useClass: Ed25519SignerService,
    },
    {
      provide: RECEIPT_CHAIN_ENGINE,
      useClass: ReceiptChainEngine,
    },
    {
      provide: AUDIT_STORE,
      useClass: PrismaAuditStore,
    },
    {
      provide: IDEMPOTENCY_STORE,
      useClass: InMemoryIdempotencyStore,
    },
    {
      provide: ESCALATION_STORE,
      useClass: InMemoryEscalationStore,
    },
  ],
  exports: [
    PromptInjectionGuard,
    ProviderPreflightGuard,
    BusinessPolicyEngine,
    PolicyCorpusService,
    SemanticPolicyEvaluatorService,
    HumanEscalationService,
    IdempotencyManager,
    ActionAuditService,
    AUDIT_STORE,
    IDEMPOTENCY_STORE,
    ESCALATION_STORE,
    CRYPTOGRAPHIC_SIGNER,
    RECEIPT_CHAIN_ENGINE,
    InMemoryAuditStore,
    InMemoryIdempotencyStore,
    InMemoryEscalationStore,
    PrismaAuditStore,
    PrismaReceiptAuditStore,
    Ed25519SignerService,
    ReceiptChainEngine,
  ],
})
export class SecurityModule {}
