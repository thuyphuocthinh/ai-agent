import { DataSourceOptions } from 'typeorm';
import { join } from 'path';

// Đường dẫn tính từ CHÍNH file này (không theo process.cwd()) và chỉ nạp đúng 1
// loại file theo cách đang chạy: .ts khi chạy từ source (ts-node/jest), .js khi
// chạy bản build. Trước đây nạp cả `dist/**` lẫn `src/**` theo cwd nên 1 bản
// build cũ còn sót làm TypeORM thấy entity trùng/cũ, và chạy từ thư mục khác
// (VD `cli`) thì không tìm thấy entity nào.
const SOURCE_EXT = __filename.endsWith('.ts') ? 'ts' : 'js';
const ENTITY_GLOB = join(__dirname, 'entities', `*.entity.${SOURCE_EXT}`);
const MIGRATION_GLOB = join(__dirname, 'migrations', `*.${SOURCE_EXT}`);

export const getDataSourceOptions = (): DataSourceOptions => {
  const dbType =
    process.env.DB_TYPE || (process.env.DB_HOST ? 'postgres' : 'sqlite');

  if (dbType === 'sqlite') {
    return {
      type: 'better-sqlite3',
      database: process.env.DB_FILE || join(process.cwd(), 'agent.sqlite'),
      synchronize: true,
      logging: ['error'],
      entities: [ENTITY_GLOB],
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
    entities: [ENTITY_GLOB],
    migrations: [MIGRATION_GLOB],
    extra: {
      max: parseInt(process.env.DB_POOL_SIZE || '20', 10),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    },
  };
};
