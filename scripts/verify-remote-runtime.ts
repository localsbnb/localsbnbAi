/** 本机 Docker 全链路：真实 PG/Redis，Hudson 使用替身；全部 SQL 回滚，Redis 独立测试前缀。 */
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import pg from 'pg';
import Redis from 'ioredis';
import { parse } from 'dotenv';
import { createRemoteRuntime } from '../src/remote/runtimeServer.js';
import { pkceS256 } from '../src/remote/oauth/authorizationCode.js';
import type { RuntimeConfig } from '../src/remote/runtimeConfig.js';
import type { BrowserLoginSession } from '../src/remote/oauth/hudsonLoginBridge.js';
async function main(): Promise<void> {
  const businessEnabled = process.argv.includes('--business');
  const env = parse(readFileSync('deployment/remote/.env.local'));
  if (!env.MCP_LOCAL_DB_PASSWORD || !env.MCP_LOCAL_REDIS_PASSWORD)
    throw new Error('Missing local configuration');
  const db = new pg.Client({
    host: '127.0.0.1',
    port: 55432,
    database: 'localsbnb_mcp',
    user: 'localsbnb_mcp',
    password: env.MCP_LOCAL_DB_PASSWORD,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  const redis = new Redis({
    host: '127.0.0.1',
    port: 56379,
    password: env.MCP_LOCAL_REDIS_PASSWORD,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 5000,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  const prefix = `test-runtime:${randomUUID()}:`;
  const keys = new Set<string>();
  const key = (value: string) => {
    const mapped = prefix + value;
    keys.add(mapped);
    return mapped;
  };
  const commands = {
    set: (k: string, v: string, ex: 'EX', seconds: number, nx: 'NX') =>
      redis.set(key(k), v, ex, seconds, nx),
    get: (k: string) => redis.get(key(k)),
    eval: (script: string, count: number, ...args: string[]) =>
      redis.eval(script, count, ...args.map((arg, i) => (i < count ? key(arg) : arg))),
  };
  const config: RuntimeConfig = {
    environment: 'dev',
    publicOrigin: 'https://mcp.example',
    resourceUrl: 'https://mcp.example/mcp',
    hudsonOrigin: 'https://hudson-dev.localhome.cn',
    siteOrigin: 'https://overseas-dev.localhome.cn',
    port: 8787,
    businessEnabled,
    handshakeSecret: randomBytes(32).toString('hex'),
    databaseUrl: 'unused',
    redisUrl: 'unused',
    activeKeyId: 'test',
    keys: { test: randomBytes(32) },
    clients: [
      {
        clientId: 'test-client',
        authMethod: 'none',
        redirectUris: ['https://client.example/cb'],
        allowedScopes: ['rooms:read', 'channels:read'],
      },
    ],
  };
  let readinessFails = false;
  const server = createRemoteRuntime(config, {
    db,
    redis: commands,
    businessFetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body));
      assert.equal(new URL(String(url)).origin, config.hudsonOrigin);
      assert.equal(body.campId, '201');
      const data =
        path === '/camp/get'
          ? { isBnb: 1 }
          : path === '/systemConfigs/get'
            ? [
                { configCode: 'hudson.bnbBasic.currency', configValue: 'USD' },
                { configCode: 'hudson.bnbBasic.timeZone', configValue: 'AMERICA_NEW_YORK' },
              ]
            : path === '/channelRoomCategories/bnb/get'
              ? { pois: [] }
              : {};
      return new Response(JSON.stringify({ success: true, data }));
    },
    checkStorage: async () => {
      if (readinessFails) throw new Error();
      await db.query('SELECT grant_id FROM mcp_auth.grants LIMIT 0');
      assert.equal(await redis.ping(), 'PONG');
    },
    bridge: {
      login: async (email: string) => ({
        subjectId: email === 'one@example.com' ? '101' : '102',
        loginToken: 'test-login',
        camps: [{ campId: email === 'one@example.com' ? '201' : '202', name: 'Test property' }],
      }),
      authorize: async (session: BrowserLoginSession, campId: string) => {
        assert.equal(session.camps[0].campId, campId);
        return { subjectId: session.subjectId, credential: 'test-business-secret' };
      },
    },
  });
  try {
    await db.connect();
    await redis.connect();
    await db.query('BEGIN');
    await db.query(readFileSync('deployment/remote/migrations/001-auth-grants.sql', 'utf8'));
    if (businessEnabled)
      await db.query(readFileSync('deployment/remote/migrations/002-work-items.sql', 'utf8'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const call = (path: string, body?: string, headers: Record<string, string> = {}) => {
      return new Promise<{
        status: number;
        text: string;
        headers: import('node:http').IncomingHttpHeaders;
      }>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path,
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              Host: 'mcp.example',
              Origin: config.publicOrigin,
              'Content-Type': 'application/x-www-form-urlencoded',
              ...headers,
            },
          },
          (res) => {
            let text = '';
            res.on('data', (c) => (text += c));
            res.on('end', () => resolve({ status: res.statusCode!, text, headers: res.headers }));
          }
        );
        req.on('error', reject);
        req.end(body);
      });
    };
    const form = (values: Record<string, string>) => new URLSearchParams(values).toString();
    assert.equal((await call('/healthz')).status, 200);
    assert.equal((await call('/readyz')).status, 200);
    readinessFails = true;
    assert.equal((await call('/readyz')).status, 503);
    readinessFails = false;
    const unauth = await call('/mcp', '{}', { 'Content-Type': 'application/json' });
    assert.equal(unauth.status, 401);
    assert.ok(unauth.headers['www-authenticate']?.includes('resource_metadata'));
    const authorize = async (email: string, campId: string) => {
      const verifier = 'a'.repeat(43);
      const start = await call(
        '/authorize?' +
          form({
            client_id: 'test-client',
            redirect_uri: 'https://client.example/cb',
            resource: config.resourceUrl,
            scope: 'rooms:read channels:read',
            response_type: 'code',
            code_challenge_method: 'S256',
            code_challenge: pkceS256(verifier),
          })
      );
      assert.equal(start.status, 200);
      const transaction = start.text.match(/name="transaction" value="([^"]+)"/)![1];
      const csrf = start.text.match(/name="csrf" value="([^"]+)"/)![1];
      const Cookie = start.headers['set-cookie']![0].split(';')[0];
      assert.equal(
        (
          await call(
            '/authorize/login',
            form({ transaction, csrf, email, password: 'test-password' }),
            { Cookie }
          )
        ).status,
        200
      );
      const approved = await call(
        '/authorize/consent',
        form({ transaction, csrf, campId, decision: 'approve' }),
        { Cookie }
      );
      assert.equal(approved.status, 303);
      const code = new URL(approved.headers.location!).searchParams.get('code')!;
      const token = await call(
        '/token',
        form({
          client_id: 'test-client',
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: 'https://client.example/cb',
          resource: config.resourceUrl,
        })
      );
      assert.equal(token.status, 200);
      assert.ok(!token.text.includes('test-business-secret'));
      return JSON.parse(token.text) as { access_token: string; refresh_token: string };
    };
    const a = await authorize('one@example.com', '201');
    const b = await authorize('two@example.com', '202');
    const mcp = async (token: string, method: string, params: object) => {
      return call('/mcp', JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer ' + token,
      });
    };
    const init = await mcp(a.access_token, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'integration', version: '1' },
    });
    assert.equal(init.status, 200);
    const list = await mcp(a.access_token, 'tools/list', {});
    assert.equal(list.status, 200);
    assert.equal(JSON.parse(list.text).result.tools.length > 1, businessEnabled);
    for (const [pair, user, camp] of [
      [a, '101', '201'],
      [b, '102', '202'],
    ] as const) {
      const result = await mcp(pair.access_token, 'tools/call', {
        name: 'remote_connection_check',
        arguments: {},
      });
      assert.equal(result.status, 200);
      const identity = JSON.parse(JSON.parse(result.text).result.content[0].text);
      assert.equal(identity.subjectId, user);
      assert.equal(identity.campId, camp);
      assert.equal(identity.businessReady, businessEnabled);
    }
    let pendingTicket = '';
    if (businessEnabled) {
      const invoke = async (token: string, name: string, args: object) => {
        const r = await mcp(token, 'tools/call', { name, arguments: args });
        assert.equal(r.status, 200);
        return JSON.parse(r.text).result;
      };
      const session = JSON.parse(
        (await invoke(a.access_token, 'open_property_session', {})).content[0].text
      ).sessionId;
      assert.equal(
        (await invoke(b.access_token, 'complete_channel_connection', { sessionId: session }))
          .isError,
        true
      );
      assert.equal(
        (
          await invoke(a.access_token, 'update_room_clean_state', {
            sessionId: session,
            roomId: '1',
            cleanState: 3,
          })
        ).isError,
        true
      );
      const start = JSON.parse(
        (
          await invoke(a.access_token, 'start_channel_connection', {
            sessionId: session,
            channel: 'booking',
          })
        ).content[0].text
      );
      const ticket = new URL(start.openUrl).pathname.split('/').at(-1)!;
      assert.ok(!JSON.stringify(start).includes('test-business-secret'));
      const redeemHeaders = { Origin: '', Authorization: 'Bearer ' + config.handshakeSecret };
      assert.equal(
        (
          await call('/internal/handshake/redeem', form({ ticket }), {
            Authorization: redeemHeaders.Authorization,
          })
        ).status,
        404
      );
      assert.equal(
        (
          await call('/internal/handshake/redeem', form({ ticket }), {
            Origin: '',
            Authorization: 'Bearer wrong',
          })
        ).status,
        401
      );
      const redeemed = await call('/internal/handshake/redeem', form({ ticket }), redeemHeaders);
      assert.equal(redeemed.status, 200);
      assert.equal(JSON.parse(redeemed.text).environment, 'dev');
      assert.equal(JSON.parse(redeemed.text).campId, '201');
      assert.equal(
        (await call('/internal/handshake/redeem', form({ ticket }), redeemHeaders)).status,
        410
      );
      const again = JSON.parse(
        (
          await invoke(a.access_token, 'start_channel_connection', {
            sessionId: session,
            channel: 'booking',
          })
        ).content[0].text
      );
      pendingTicket = new URL(again.openUrl).pathname.split('/').at(-1)!;
    }
    const refreshed = await call(
      '/token',
      form({
        client_id: 'test-client',
        grant_type: 'refresh_token',
        refresh_token: a.refresh_token,
        resource: config.resourceUrl,
      })
    );
    assert.equal(refreshed.status, 200);
    const next = JSON.parse(refreshed.text);
    assert.equal((await mcp(a.access_token, 'tools/list', {})).status, 401);
    assert.equal(
      (await call('/revoke', form({ client_id: 'test-client', token: next.refresh_token }))).status,
      200
    );
    assert.equal((await mcp(next.access_token, 'tools/list', {})).status, 401);
    assert.equal((await mcp(b.access_token, 'tools/list', {})).status, 200);
    if (businessEnabled)
      assert.equal(
        (
          await call('/internal/handshake/redeem', form({ ticket: pendingTicket }), {
            Origin: '',
            Authorization: 'Bearer ' + config.handshakeSecret,
          })
        ).status,
        410
      );
    // 只删除本测试的限流 key，再验证 10 次登录限额以及 X-Forwarded-For 不可绕过。
    for (const k of keys) if (k.includes(':rate:')) await redis.del(k);
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await call('/authorize/login', 'invalid=1', { 'X-Forwarded-For': `192.0.2.${i}` })).status,
        400
      );
    assert.equal(
      (await call('/authorize/login', 'invalid=1', { 'X-Forwarded-For': '192.0.2.99' })).status,
      429
    );
    await db.query('ROLLBACK');
    console.log(
      `PASS runtime (${businessEnabled ? 'business' : 'auth_preview'}): real PG/Redis OAuth-to-MCP flow, two identities, refresh/revocation, readiness and rate limit; SQL rolled back`
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      if (redis.status === 'ready') for (const k of keys) await redis.del(k);
    } finally {
      redis.disconnect();
      await db.end();
    }
  }
}
void main().catch(() => {
  console.error('Local runtime verification failed; sensitive details withheld.');
  process.exitCode = 1;
});
