// DataSource cho TypeORM CLI (`pnpm --filter @agent/core migration:run`,
// `migration:generate`). Đọc .env ở gốc repo rồi dùng đúng cấu hình của app
// (database.config.ts), nên CLI và app luôn khớp nhau.
import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { getDataSourceOptions } from './src/infrastructure/database/database.config';

config({ path: resolve(__dirname, '..', '.env') });

export default new DataSource(getDataSourceOptions());
