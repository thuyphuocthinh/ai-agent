import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service';
import { DatabaseHealthService } from './database-health.service';
import { PrismaService } from './prisma.service';
import { getDataSourceOptions } from './database.config';
import { PrismaChatSessionManager } from './adapters/prisma-chat-session.manager';
import { PrismaMessageSink } from './adapters/prisma-message-sink';
import { PrismaCheckpointService } from './adapters/prisma-checkpoint.service';
import { PrismaTriggerClaimService } from './adapters/prisma-trigger-claim.service';
import { PrismaWorkflowStore } from './adapters/prisma-workflow.store';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...getDataSourceOptions(),
      autoLoadEntities: true,
      migrationsRun: false,
    }),
  ],
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
    TypeOrmModule,
  ],
})
export class DatabaseModule {}
