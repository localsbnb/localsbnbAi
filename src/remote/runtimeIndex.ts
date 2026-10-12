import pg from 'pg';
import Redis from 'ioredis';
import { readRuntimeConfig } from './runtimeConfig.js';
import { createRemoteRuntime } from './runtimeServer.js';
import { HudsonLoginBridge } from './oauth/hudsonLoginBridge.js';

async function main(): Promise<void> {
  const config = readRuntimeConfig(process.env);
  const db = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    ...(config.environment === 'prod' ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  db.on('error', () => undefined);
  const checkStorage = async () => {
    await db.query(
      'SELECT grant_id,subject_id,client_id,camp_id,resource,scopes,credential_ciphertext,expires_at,revoked_at FROM mcp_auth.grants LIMIT 0'
    );
    if (config.businessEnabled)
      await db.query(
        'SELECT id,owner_hash,kind,dedup,payload,status,version,expires_at FROM mcp_auth.work_items LIMIT 0'
      );
    if ((await redis.ping()) !== 'PONG') throw new Error('Storage unavailable');
  };
  try {
    await redis.connect();
    await checkStorage();
    const server = createRemoteRuntime(config, {
      db,
      redis,
      checkStorage,
      bridge: new HudsonLoginBridge(config.environment),
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.bindHost ?? '127.0.0.1', resolve);
    });
    process.stderr.write(
      `Remote runtime listening on configured interface; business tools ${config.businessEnabled ? 'enabled' : 'disabled'}.\n`
    );
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      server.close();
      server.closeAllConnections();
      redis.disconnect();
      await db.end();
    };
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void stop().catch(() => {
          process.exitCode = 1;
        });
      });
  } catch (error) {
    redis.disconnect();
    await db.end();
    throw error;
  }
}
void main().catch(() => {
  process.stderr.write(
    'Remote startup failed. Check explicit configuration, storage and applied migrations.\n'
  );
  process.exitCode = 1;
});
