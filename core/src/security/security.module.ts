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
    InMemoryAuditStore,
    InMemoryIdempotencyStore,
    InMemoryEscalationStore,
    PrismaAuditStore,
  ],
})
export class SecurityModule {}
