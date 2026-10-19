/** 显式迁移：只读专用远程配置，不加载根目录 .env。启动服务本身不自动迁移。 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { readRuntimeConfig } from './runtimeConfig.js';
async function main(): Promise<void> {
  const config = readRuntimeConfig(process.env);
  const db = new pg.Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    ...(config.databaseTlsEnabled ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  try {
    await db.connect();
    await db.query('BEGIN');
    await db.query(
      readFileSync(
        new URL('../../deployment/remote/migrations/001-auth-grants.sql', import.meta.url),
        'utf8'
      )
    );
    await db.query(
      readFileSync(
        new URL('../../deployment/remote/migrations/002-work-items.sql', import.meta.url),
        'utf8'
      )
    );
    await db.query(
      readFileSync(
        new URL('../../deployment/remote/migrations/003-java-field-conventions.sql', import.meta.url),
        'utf8'
      )
    );
    await db.query('COMMIT');
    process.stdout.write('Remote auth schema migration completed.\n');
  } finally {
    await db.end();
  }
}
void main().catch(() => {
  process.stderr.write('Remote migration failed; sensitive connection details withheld.\n');
  process.exitCode = 1;
});
