import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service';
import { DatabaseHealthService } from './database-health.service';
import { getDataSourceOptions } from './database.config';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...getDataSourceOptions(),
      autoLoadEntities: true,
      migrationsRun: false,
    }),
  ],
  providers: [DatabaseService, DatabaseHealthService],
  exports: [DatabaseService, DatabaseHealthService, TypeOrmModule],
})
export class DatabaseModule {}
