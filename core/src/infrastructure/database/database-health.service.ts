import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
const isError = (error: unknown): error is Error => error instanceof Error;

@Injectable()
export class DatabaseHealthService implements OnModuleInit {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    const dbType =
      process.env.DB_TYPE || (process.env.DB_HOST ? 'postgres' : 'sqlite');
    console.log(`🔌 Testing database connection (${dbType})...`);
    console.log('Database config:', {
      type: dbType,
      host: process.env.DB_HOST || 'local (sqlite)',
      port: process.env.DB_PORT,
      database: process.env.DB_FILE || process.env.DB_NAME,
      user: process.env.DB_USER,
    });

    const alive = await this.isAlive();
    if (alive) {
      console.log('✅ Database connection successful!');
    } else {
      console.error('❌ Database connection failed.');
    }
  }

  async isAlive(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1 as test');
      return true;
    } catch (error: unknown) {
      if (isError(error)) {
        console.error('Database health check failed:', error.message);
      } else {
        console.error('Database health check failed:', error);
      }
      return false;
    }
  }
}
