import { readRuntimeConfig } from '../src/remote/runtimeConfig';
function env() {
  return {
    LOCALSBNB_REMOTE_ENV: 'dev',
    LOCALSBNB_REMOTE_PUBLIC_ORIGIN: 'https://mcp.example',
    LUKEYUN_API_BASE_URL: 'https://hudson-dev.localhome.cn',
    LOCALSBNB_SITE_URL: 'https://overseas-dev.localhome.cn',
    LOCALSBNB_REMOTE_DATABASE_URL: 'postgresql://mcp:password@127.0.0.1:55432/localsbnb_mcp',
    LOCALSBNB_REMOTE_REDIS_URL: 'redis://:password@127.0.0.1:56379',
    LOCALSBNB_REMOTE_ACTIVE_KEY_ID: 'k1',
    LOCALSBNB_REMOTE_KEYS_JSON: JSON.stringify({ k1: 'ab'.repeat(32) }),
    LOCALSBNB_REMOTE_CLIENTS_JSON: JSON.stringify([
      {
        clientId: 'client',
        authMethod: 'none',
        redirectUris: ['https://client.example/cb'],
        allowedScopes: ['rooms:read'],
      },
    ]),
  };
}
it('loads dedicated storage, keys and client registrations', () => {
  const c = readRuntimeConfig(env());
  expect(c.keys.k1).toHaveLength(32);
  expect(c.clients[0].clientId).toBe('client');
});
it.each([
  'LOCALSBNB_REMOTE_DATABASE_URL',
  'LOCALSBNB_REMOTE_REDIS_URL',
  'LOCALSBNB_REMOTE_KEYS_JSON',
  'LOCALSBNB_REMOTE_CLIENTS_JSON',
])('rejects malformed %s without echoing secrets', (key) => {
  expect(() => readRuntimeConfig({ ...env(), [key]: 'sensitive-bad-value' })).toThrow();
  try {
    readRuntimeConfig({ ...env(), [key]: 'sensitive-bad-value' });
  } catch (e) {
    expect(String(e)).not.toContain('sensitive-bad-value');
  }
});
it('rejects missing active keys', () =>
  expect(() =>
    readRuntimeConfig({ ...env(), LOCALSBNB_REMOTE_ACTIVE_KEY_ID: 'missing' })
  ).toThrow());
it('rejects local shared credentials', () =>
  expect(() => readRuntimeConfig({ ...env(), APP_SECRET: 'local-secret' })).toThrow());
it.each([
  [
    {
      clientId: 'c',
      authMethod: 'none',
      redirectUris: ['http://client.example'],
      allowedScopes: ['rooms:read'],
    },
  ],
  [
    {
      clientId: 'c',
      authMethod: 'none',
      redirectUris: ['https://client.example'],
      allowedScopes: ['read write'],
    },
  ],
  [
    {
      clientId: 'c',
      authMethod: 'client_secret_basic',
      secretSha256: 'bad',
      redirectUris: ['https://client.example'],
      allowedScopes: ['read'],
    },
  ],
])('rejects unsafe registration %j', (client) =>
  expect(() =>
    readRuntimeConfig({ ...env(), LOCALSBNB_REMOTE_CLIENTS_JSON: JSON.stringify([client]) })
  ).toThrow()
);
it('requires TLS Redis in production', () =>
  expect(() =>
    readRuntimeConfig({
      ...env(),
      LOCALSBNB_REMOTE_ENV: 'prod',
      LUKEYUN_API_BASE_URL: 'https://hudson-prod.localhome.cn',
      LOCALSBNB_SITE_URL: 'https://localsbnb.com',
    })
  ).toThrow());
it('business mode requires an independent service secret', () => {
  expect(() => readRuntimeConfig({ ...env(), LOCALSBNB_REMOTE_BUSINESS_ENABLED: '1' })).toThrow(
    'handshake'
  );
  const c = readRuntimeConfig({
    ...env(),
    LOCALSBNB_REMOTE_BUSINESS_ENABLED: '1',
    LOCALSBNB_REMOTE_HANDSHAKE_SECRET: 'cd'.repeat(32),
  });
  expect(c.businessEnabled).toBe(true);
  expect(readRuntimeConfig(env()).businessEnabled).toBe(false);
});
