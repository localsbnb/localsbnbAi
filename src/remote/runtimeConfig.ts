import { readRemoteConfig, type RemoteConfig } from './config.js';
import type { HttpOAuthClient } from './oauth/httpHandler.js';
export interface RuntimeConfig extends RemoteConfig {
  bindHost?: '127.0.0.1' | '0.0.0.0';
  businessEnabled?: boolean;
  handshakeSecret?: string;
  databaseUrl: string;
  databaseTlsEnabled: boolean;
  redisUrl: string;
  activeKeyId: string;
  keys: Record<string, Buffer>;
  clients: HttpOAuthClient[];
}
/** 专用远程环境变量；不加载 .env 或本地账号文件。错误只返回键名。 */
export function readRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>
): RuntimeConfig {
  const base = readRemoteConfig(env);
  const allowPlaintextRedis = env.LOCALSBNB_REMOTE_ALLOW_PLAINTEXT_REDIS;
  if (allowPlaintextRedis && !['0', '1'].includes(allowPlaintextRedis))
    throw new Error('Invalid plaintext Redis opt-in');
  const allowPlaintextPostgres = env.LOCALSBNB_REMOTE_ALLOW_PLAINTEXT_POSTGRES;
  if (allowPlaintextPostgres && !['0', '1'].includes(allowPlaintextPostgres))
    throw new Error('Invalid plaintext PostgreSQL opt-in');
  function connection(key: string, protocols: string[]): string {
    try {
      const value = env[key] ?? '';
      const url = new URL(value);
      if (
        !protocols.includes(url.protocol) ||
        !url.hostname ||
        url.hash ||
        !url.password ||
        url.search
      )
        throw new Error();
      if (
        base.environment === 'prod' &&
        url.protocol !== 'rediss:' &&
        key === 'LOCALSBNB_REMOTE_REDIS_URL' &&
        allowPlaintextRedis !== '1'
      )
        throw new Error();
      return value;
    } catch {
      throw new Error(`Invalid ${key}`);
    }
  }
  const databaseUrl = connection('LOCALSBNB_REMOTE_DATABASE_URL', ['postgres:', 'postgresql:']);
  const databaseTlsEnabled = base.environment === 'prod' && allowPlaintextPostgres !== '1';
  const redisUrl = connection('LOCALSBNB_REMOTE_REDIS_URL', ['redis:', 'rediss:']);
  let keys: Record<string, Buffer> = {};
  let clients: HttpOAuthClient[];
  const activeKeyId = env.LOCALSBNB_REMOTE_ACTIVE_KEY_ID ?? '';
  try {
    const raw = JSON.parse(env.LOCALSBNB_REMOTE_KEYS_JSON ?? '') as Record<string, unknown>;
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error();
    keys = Object.fromEntries(
      Object.entries(raw).map(([id, value]) => {
        if (
          !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
          typeof value !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value)
        )
          throw new Error();
        return [id, Buffer.from(value, 'hex')];
      })
    );
    if (!Object.prototype.hasOwnProperty.call(keys, activeKeyId)) throw new Error();
  } catch {
    throw new Error('Invalid remote encryption key configuration');
  }
  try {
    clients = JSON.parse(env.LOCALSBNB_REMOTE_CLIENTS_JSON ?? '') as HttpOAuthClient[];
    if (!Array.isArray(clients) || !clients.length) throw new Error();
    const ids = new Set<string>();
    for (const c of clients) {
      if (
        !c ||
        typeof c.clientId !== 'string' ||
        !c.clientId ||
        ids.has(c.clientId) ||
        !Array.isArray(c.redirectUris) ||
        !c.redirectUris.length ||
        !Array.isArray(c.allowedScopes) ||
        !c.allowedScopes.length ||
        c.allowedScopes.some(
          (s) => typeof s !== 'string' || !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(s)
        ) ||
        !['none', 'client_secret_basic'].includes(c.authMethod) ||
        (c.authMethod === 'client_secret_basic' && !/^[a-f0-9]{64}$/.test(c.secretSha256))
      )
        throw new Error();
      for (const uri of c.redirectUris) {
        const u = new URL(uri);
        if (
          u.protocol !== 'https:' ||
          u.username ||
          u.password ||
          u.hash ||
          u.searchParams.has('code') ||
          u.searchParams.has('state')
        )
          throw new Error();
      }
      ids.add(c.clientId);
    }
  } catch {
    throw new Error('Invalid remote client registrations');
  }
  const bindHost = env.LOCALSBNB_REMOTE_BIND_HOST ?? '127.0.0.1';
  if (bindHost !== '127.0.0.1' && bindHost !== '0.0.0.0')
    throw new Error('Invalid remote bind host');
  const businessEnabled = env.LOCALSBNB_REMOTE_BUSINESS_ENABLED === '1';
  if (
    env.LOCALSBNB_REMOTE_BUSINESS_ENABLED &&
    !['0', '1'].includes(env.LOCALSBNB_REMOTE_BUSINESS_ENABLED)
  )
    throw new Error('Invalid business feature flag');
  const handshakeSecret = env.LOCALSBNB_REMOTE_HANDSHAKE_SECRET;
  if (businessEnabled && !/^[a-f0-9]{64}$/.test(handshakeSecret ?? ''))
    throw new Error('Remote business requires dedicated handshake service secret');
  return {
    ...base,
    bindHost,
    businessEnabled,
    handshakeSecret,
    databaseUrl,
    databaseTlsEnabled,
    redisUrl,
    activeKeyId,
    keys,
    clients,
  };
}
