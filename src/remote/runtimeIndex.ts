import pg from 'pg';
import Redis from 'ioredis';
import { readRuntimeConfig } from './runtimeConfig.js';
import { createRemoteRuntime } from './runtimeServer.js';
import { HudsonLoginBridge } from './oauth/hudsonLoginBridge.js';
import { classifyPostgresFailure } from './postgresFailure.js';

type StartupPhase =
  | 'config'
  | 'storage_init'
  | 'redis_connect'
  | 'postgres_grants'
  | 'postgres_work_items'
  | 'redis_ping'
  | 'server_create'
  | 'listen';

let startupPhase: StartupPhase = 'config';
type RedisFailure = 'auth' | 'tls' | 'dns' | 'timeout' | 'refused' | 'reset' | 'network' | 'unknown';
let lastRedisFailure: RedisFailure | undefined;

// Classify Redis errors without ever writing their message (which can contain an endpoint).
function classifyRedisFailure(error: unknown): RedisFailure {
  const value = error && typeof error === 'object' ? error : {};
  const code = 'code' in value && typeof value.code === 'string' ? value.code : '';
  const message = 'message' in value && typeof value.message === 'string' ? value.message : '';
  if (/WRONGPASS|NOAUTH|invalid username-password|authentication failed/i.test(message)) return 'auth';
  if (/TLS|SSL|CERT|EPROTO|certificate/i.test(`${code} ${message}`)) return 'tls';
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'dns';
  if (/ETIMEDOUT|timeout/i.test(`${code} ${message}`)) return 'timeout';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ECONNRESET') return 'reset';
  if (/EHOSTUNREACH|ENETUNREACH/.test(code)) return 'network';
  return 'unknown';
}

// Only report configuration errors whose messages are known to contain no values.
const safeConfigErrors = new Set([
  'LOCALSBNB_REMOTE_ENV must explicitly be dev or prod',
  'LOCALSBNB_REMOTE_PUBLIC_ORIGIN is required',
  'LOCALSBNB_REMOTE_PUBLIC_ORIGIN must be an HTTPS origin',
  'LOCALSBNB_REMOTE_PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query or fragment',
  'LUKEYUN_API_BASE_URL is required',
  'LUKEYUN_API_BASE_URL must be an HTTPS origin',
  'LUKEYUN_API_BASE_URL must be an HTTPS origin without credentials, path, query or fragment',
  'LOCALSBNB_SITE_URL is required',
  'LOCALSBNB_SITE_URL must be an HTTPS origin',
  'LOCALSBNB_SITE_URL must be an HTTPS origin without credentials, path, query or fragment',
  'Remote environment, Hudson and browser site must match the approved deployment',
  'Remove local stdio credential configuration from the remote service',
  'LOCALSBNB_REMOTE_PORT must be an integer between 1 and 65535',
  'Invalid LOCALSBNB_REMOTE_DATABASE_URL',
  'Invalid LOCALSBNB_REMOTE_REDIS_URL',
  'Invalid plaintext Redis opt-in',
  'Invalid plaintext PostgreSQL opt-in',
  'Invalid remote encryption key configuration',
  'Invalid remote client registrations',
  'Invalid remote bind host',
  'Invalid business feature flag',
  'Remote business requires dedicated handshake service secret',
]);
const safeStorageCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  '28P01', // PostgreSQL invalid_password
  '42501', // PostgreSQL insufficient_privilege
  '42P01', // PostgreSQL undefined_table
  '3F000', // PostgreSQL invalid_schema_name
  '57P03', // PostgreSQL cannot_connect_now
  '08001', // PostgreSQL sqlclient_unable_to_establish_sqlconnection
  '08006', // PostgreSQL connection_failure
]);

async function main(): Promise<void> {
  const config = readRuntimeConfig(process.env);
  startupPhase = 'storage_init';
  const db = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    ...(config.databaseTlsEnabled ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: () => null,
  });
  redis.on('error', (error: unknown) => {
    lastRedisFailure = classifyRedisFailure(error);
  });
  db.on('error', () => undefined);
  const checkStorage = async (onPhase?: (phase: StartupPhase) => void) => {
    onPhase?.('postgres_grants');
    await db.query(
      'SELECT grant_id,subject_id,client_id,camp_id,resource,scopes,credential_ciphertext,expires_at,revoked_at FROM mcp_auth.grants LIMIT 0'
    );
    if (config.businessEnabled) {
      onPhase?.('postgres_work_items');
      await db.query(
        'SELECT id,owner_hash,kind,dedup,payload,status,version,expires_at FROM mcp_auth.work_items LIMIT 0'
      );
    }
    onPhase?.('redis_ping');
    if ((await redis.ping()) !== 'PONG') throw new Error('Storage unavailable');
  };
  try {
    startupPhase = 'redis_connect';
    await redis.connect();
    await checkStorage((phase) => {
      startupPhase = phase;
    });
    startupPhase = 'server_create';
    const server = createRemoteRuntime(config, {
      db,
      redis,
      checkStorage,
      bridge: new HudsonLoginBridge(config.environment),
    });
    startupPhase = 'listen';
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
void main().catch((error: unknown) => {
  const configError = error instanceof Error && safeConfigErrors.has(error.message)
    ? error.message
    : undefined;
  const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const storageCode = typeof rawCode === 'string' && safeStorageCodes.has(rawCode)
    ? rawCode
    : undefined;
  const redisFailure = startupPhase === 'redis_connect'
    ? lastRedisFailure ?? classifyRedisFailure(error)
    : undefined;
  const postgresFailure = startupPhase === 'postgres_grants' || startupPhase === 'postgres_work_items'
    ? classifyPostgresFailure(error)
    : undefined;
  process.stderr.write(
    `${JSON.stringify({
      component: 'remote_startup',
      phase: startupPhase,
      ...(startupPhase === 'config' && configError ? { reason: configError } : {}),
      ...(startupPhase !== 'config' && storageCode ? { code: storageCode } : {}),
      ...(redisFailure ? { redisFailure } : {}),
      ...(postgresFailure ? { postgresFailure } : {}),
      status: 'failed',
    })}\n`
  );
  process.stderr.write(
    'Remote startup failed. Check explicit configuration, storage and applied migrations.\n'
  );
  process.exitCode = 1;
});
