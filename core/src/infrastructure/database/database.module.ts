import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { DatabaseHealthService } from './database-health.service';
import { PrismaService } from './prisma.service';
import { PrismaChatSessionManager } from './adapters/prisma-chat-session.manager';
import { PrismaMessageSink } from './adapters/prisma-message-sink';
import { PrismaCheckpointService } from './adapters/prisma-checkpoint.service';
import { PrismaTriggerClaimService } from './adapters/prisma-trigger-claim.service';
import { PrismaWorkflowStore } from './adapters/prisma-workflow.store';

@Module({
  imports: [],
  providers: [
    DatabaseService,
    DatabaseHealthService,
    PrismaService,
    PrismaChatSessionManager,
    PrismaMessageSink,
    PrismaCheckpointService,
    PrismaTriggerClaimService,
    PrismaWorkflowStore,
  ],
  exports: [
    DatabaseService,
    DatabaseHealthService,
    PrismaService,
    PrismaChatSessionManager,
    PrismaMessageSink,
    PrismaCheckpointService,
    PrismaTriggerClaimService,
    PrismaWorkflowStore,
  ],
})
export class DatabaseModule {}
