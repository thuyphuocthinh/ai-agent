import { DataSourceOptions } from 'typeorm';
import { join } from 'path';

export const getDataSourceOptions = (): DataSourceOptions => {
  const dbType =
    process.env.DB_TYPE || (process.env.DB_HOST ? 'postgres' : 'sqlite');

  if (dbType === 'sqlite') {
    return {
      type: 'better-sqlite3',
      database: process.env.DB_FILE || join(process.cwd(), 'agent.sqlite'),
      synchronize: true,
      logging: ['error'],
      entities: [
        join(process.cwd(), 'dist/**/*.entity.js'),
        join(process.cwd(), 'src/**/*.entity.ts'),
      ],
    };
  }

  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres',
    database: process.env.DB_NAME || 'agent_db',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    synchronize: false,
    logging: ['error'],
    entities: [
      join(process.cwd(), 'dist/**/*.entity.js'),
      join(process.cwd(), 'src/**/*.entity.ts'),
    ],
    migrations: [join(process.cwd(), 'src/**/migrations/**/*.{js,ts}')],
    extra: {
      max: parseInt(process.env.DB_POOL_SIZE || '20', 10),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    },
  };
};
