import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService manages the database connection lifecycle via Prisma Client.
 * Implements OnModuleInit for eager connection on application boot,
 * and OnModuleDestroy for graceful connection teardown.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Prisma Client connected to PostgreSQL database successfully');
    } catch (error) {
      this.logger.error('Failed to connect Prisma Client to database', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma Client disconnected cleanly from database');
  }
}
