/** Local real PostgreSQL; no production APIs, no real bookings/imports. SQL always rolled back. */
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { parse } from 'dotenv';
import { CredentialCipher } from '../src/remote/oauth/credentialCipher.js';
import {
  PostgresGrantStore,
  type PersistentGrant,
} from '../src/remote/oauth/postgresGrantStore.js';
import { WorkStore } from '../src/remote/business/workStore.js';
import { RemoteHandshake } from '../src/remote/business/handshake.js';
import { ChannelFlows } from '../src/remote/business/channelFlows.js';
import { BusinessEngine } from '../src/remote/business/engine.js';
import { RemoteHudsonClient } from '../src/remote/business/hudsonClient.js';
import { persistentPreview } from '../src/remote/business/mutations.js';
import type { ToolResult } from '../src/types/mcp.js';
const data = (r: ToolResult) => JSON.parse(r.content[0].text!);
async function main() {
  const env = parse(readFileSync('deployment/remote/.env.local'));
  const db = new pg.Client({
    host: '127.0.0.1',
    port: 55432,
    database: 'localsbnb_mcp',
    user: 'localsbnb_mcp',
    password: env.MCP_LOCAL_DB_PASSWORD,
    connectionTimeoutMillis: 5000,
  });
  // A single rollback transaction; serialize the driver calls while retaining application races.
  let queue: Promise<unknown> = Promise.resolve();
  const sql = {
    query: (...args: unknown[]) => {
      const run = queue.then(() => (db.query as Function)(...args));
      queue = run.catch(() => undefined);
      return run;
    },
  } as Pick<pg.Client, 'query'>;
  const cipher = new CredentialCipher('test', { test: randomBytes(32) });
  const store = new WorkStore(sql, cipher),
    grants = new PostgresGrantStore(sql, cipher);
  const origin = 'https://hudson-dev.localhome.cn',
    resource = 'https://mcp.example/mcp';
  const handshake = () =>
    new RemoteHandshake(
      new WorkStore(sql, cipher),
      grants,
      'https://overseas-dev.localhome.cn',
      resource,
      'dev'
    );
  let currency = 'USD',
    cleanState = 1,
    writes = 0,
    ambiguous = false;
  let channelPayload: object = { pois: [], accounts: [] };
  const requests: Array<{ camp: string; token: string; path: string }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body));
    const headers = init?.headers as Record<string, string>;
    assert.equal(new URL(String(url)).origin, origin);
    assert.equal(init?.redirect, 'error');
    assert.equal(headers.campId, body.campId);
    assert.equal(headers['hudson-access-token'], 'secret-' + body.campId);
    requests.push({ camp: body.campId, token: headers['hudson-access-token'], path });
    let value: unknown;
    if (path === '/camp/get') value = { isBnb: 1, campId: body.campId };
    else if (path === '/systemConfigs/get')
      value = [
        { configCode: 'hudson.bnbBasic.currency', configValue: currency },
        { configCode: 'hudson.bnbBasic.timeZone', configValue: 'AMERICA_NEW_YORK' },
      ];
    else if (path === '/systemConfig/bnbUser/calendarPersonalization/get')
      value = { highlightWeekends: 2 };
    else if (path === '/bnbRoomStatuses/rooms/get')
      value = {
        list: [
          { i: 'cat', n: 'Test category', rs: [{ i: 'room-1', n: 'Test room', cs: cleanState }] },
        ],
      };
    else if (path === '/room/updateCleanState') {
      writes++;
      if (ambiguous) throw new Error('test transport lost response');
      value = true;
    } else if (path === '/channelRoomCategories/bnb/get') value = channelPayload;
    else throw new Error('Unexpected fixture path ' + path);
    return new Response(JSON.stringify({ success: true, data: value }), { status: 200 });
  };
  const engine = () =>
    new BusinessEngine(
      grants,
      new WorkStore(sql, cipher),
      new ChannelFlows(new WorkStore(sql, cipher), handshake()),
      origin,
      fetcher
    );
  const approved = async (subject: string, camp: string, scopes: string[]) => {
    const g: PersistentGrant = {
      grantId: randomUUID(),
      subjectId: subject,
      clientId: 'client',
      campId: camp,
      resource,
      scopes,
      expiresAt: new Date(Date.now() + 3600000),
    };
    await grants.create(g, 'secret-' + camp);
    return g;
  };
  try {
    await db.connect();
    await db.query('BEGIN');
    for (const file of ['001-auth-grants.sql', '002-work-items.sql'])
      await db.query(readFileSync('deployment/remote/migrations/' + file, 'utf8'));
    const a = await approved('user-a', '201', ['rooms:read', 'rooms:write', 'channels:read']);
    const second = await approved('user-a', '202', ['rooms:read', 'rooms:write', 'channels:read']);
    const b = await approved('user-b', '301', ['rooms:read']);
    assert.ok(
      !engine()
        .list(b)
        .some((t) => t.name === 'update_room_clean_state')
    );
    await assert.rejects(() => engine().call(b, 'update_room_clean_state', {}), /not authorized/);
    const s1 = data(await engine().call(a, 'open_property_session', {})).sessionId;
    const s2 = data(await engine().call(a, 'open_property_session', {})).sessionId;
    await assert.rejects(
      () => engine().call(b, 'switch_property', { sessionId: s1, campId: '301' }),
      /Session missing/
    );
    await assert.rejects(
      () => engine().call(a, 'switch_property', { sessionId: s1, campId: '999' }),
      /not authorized/
    );
    const args = { sessionId: s1, roomId: 'room-1', cleanState: 3 };
    const preview = data(await engine().call(a, 'update_room_clean_state', args));
    assert.equal(preview.status, 'preview');
    assert.equal(writes, 0);
    currency = 'EUR';
    const changed = await engine().call(a, 'update_room_clean_state', {
      ...args,
      confirm: true,
      previewId: preview.previewId,
    });
    assert.equal(changed.isError, true);
    assert.equal(writes, 0);
    currency = 'USD';
    // Newly constructed engines simulate different instances; the same persisted preview survives.
    const results = await Promise.allSettled([
      engine().call(a, 'update_room_clean_state', {
        ...args,
        confirm: true,
        previewId: preview.previewId,
      }),
      engine().call(a, 'update_room_clean_state', {
        ...args,
        confirm: true,
        previewId: preview.previewId,
      }),
    ]);
    assert.ok(
      results.some((r) => r.status === 'fulfilled' && data(r.value).status === 'submitted')
    );
    assert.equal(writes, 1);
    await engine().call(a, 'update_room_clean_state', {
      ...args,
      confirm: true,
      previewId: preview.previewId,
    });
    assert.equal(writes, 1);
    const status = data(
      await engine().call(a, 'get_operation_status', {
        sessionId: s1,
        operationId: preview.previewId,
      })
    );
    assert.equal(status.status, 'submitted');
    await engine().call(a, 'switch_property', { sessionId: s1, campId: '202' });
    const stale = await engine().call(a, 'update_room_clean_state', {
      ...args,
      confirm: true,
      previewId: preview.previewId,
    });
    assert.equal(stale.isError, true);
    assert.equal(writes, 1);
    const calls = await Promise.all([
      engine().call(a, 'update_room_clean_state', { ...args, confirm: false }),
      engine().call(a, 'update_room_clean_state', { ...args, sessionId: s2, confirm: false }),
    ]);
    assert.ok(calls.every((r) => data(r).status === 'preview'));
    assert.ok(requests.some((r) => r.camp === '201') && requests.some((r) => r.camp === '202'));
    // Atomic claim independent of the session lock, with crash/unknown outcome persisted.
    const writer = new RemoteHudsonClient(origin, 'secret-201', '201', fetcher, true);
    const input = {
      args: {},
      tool: 'test',
      endpoint: '/room/updateCleanState',
      payload: { campId: '201', roomId: 'room-1', cleanState: 2 },
      summary: { room: 'Test room' },
      snapshot: { state: 1 },
    };
    const direct = () =>
      persistentPreview(new WorkStore(sql, cipher), 'race-owner', writer, async () => undefined);
    const p = data(await direct()(input));
    const before = writes;
    await Promise.allSettled([
      direct()({ ...input, args: { confirm: true, previewId: p.previewId } }),
      direct()({ ...input, args: { confirm: true, previewId: p.previewId } }),
    ]);
    assert.equal(writes, before + 1);
    const uncertain = () =>
      persistentPreview(new WorkStore(sql, cipher), 'unknown-owner', writer, async () => undefined);
    ambiguous = true;
    const u = data(await uncertain()(input));
    assert.equal(
      data(await uncertain()({ ...input, args: { confirm: true, previewId: u.previewId } })).status,
      'unknown'
    );
    const count = writes;
    assert.equal(
      data(await uncertain()({ ...input, args: { confirm: true, previewId: u.previewId } })).status,
      'unknown'
    );
    assert.equal(writes, count);
    assert.equal(
      data(await uncertain()({ ...input, payload: { ...input.payload, cleanState: 0 } })).status,
      'unknown'
    );
    ambiguous = false;
    await sql.query(
      "UPDATE mcp_auth.work_items SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=$1",
      [u.previewId]
    );
    assert.equal((await store.get('unknown-owner', u.previewId, 'mutation'))?.status, 'unknown');
    // Read client rejects cross-camp, absolute URLs and mutations before transport.
    const reader = new RemoteHudsonClient(origin, 'secret-201', '201', fetcher);
    for (const request of [
      { method: 'POST', url: '/camp/get', data: { nested: { campId: '202' } } },
      { method: 'POST', url: 'https://evil.example/read', data: {} },
      { method: 'POST', url: '/room/updateCleanState', data: {} },
    ] as const)
      await assert.rejects(() => reader.request(request));
    for (const channel of ['airbnb', 'booking', 'trip', 'agoda'] as const) {
      const s = data(await engine().call(a, 'open_property_session', {})).sessionId;
      channelPayload = { pois: [], accounts: [{ id: 'old' }] };
      const start = data(
        await engine().call(a, 'start_channel_connection', { sessionId: s, channel })
      );
      assert.ok(!JSON.stringify(start).includes('secret-'));
      assert.equal(start.status, 'awaiting_user');
      const ticket = new URL(start.openUrl).pathname.split('/').at(-1)!;
      const redemption = await Promise.allSettled([
        handshake().redeem(ticket),
        handshake().redeem(ticket),
      ]);
      assert.equal(redemption.filter((r) => r.status === 'fulfilled').length, 1);
      const redeemed = (
        redemption.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
          Awaited<ReturnType<RemoteHandshake['redeem']>>
        >
      ).value;
      assert.equal(redeemed.channel, channel);
      assert.equal(redeemed.campId, '201');
      assert.equal(redeemed.environment, 'dev');
      channelPayload = { pois: [], accounts: [{ id: 'new' }] };
      assert.equal(
        data(await engine().call(a, 'complete_channel_connection', { sessionId: s })).status,
        'pending'
      );
      channelPayload = {
        pois: [{ poiId: 'poi-1', outPoiId: 'external-1', parentPoiInfo: { poiId: 'local-1' } }],
        roomCategories: [
          {
            poiId: 'poi-1',
            roomCategoryId: 'channel-room',
            parentRoomCategoryInfo: { roomCategoryId: 'local-room' },
            connectionStatus: 3,
          },
        ],
      };
      // Reopening keeps the original baseline even after sync has changed.
      const reopened = data(
        await engine().call(a, 'start_channel_connection', { sessionId: s, channel })
      );
      assert.equal(reopened.flowId, start.flowId);
      assert.equal(
        data(await engine().call(a, 'complete_channel_connection', { sessionId: s })).status,
        'succeeded'
      );
    }
    const checkBack=persistentPreview(new WorkStore(sql,cipher),'readback-owner',writer,async()=>undefined);
    const readBack=async()=>{throw new Error('fixture readback unavailable');};
    const rb=data(await checkBack({...input,readBack}));
    const rbResult=data(await checkBack({...input,readBack,args:{confirm:true,previewId:rb.previewId}}));
    assert.equal(rbResult.status,'submitted');assert.equal(rbResult.readBackStatus,'failed');
    const switchedTicket=await handshake().create(second.grantId,a.clientId,'202','booking',a.grantId);
    const expired = await handshake().create(a.grantId, a.clientId, '201', 'booking');
    const id = new URL(expired.openUrl).pathname.split('/').at(-1)!;
    await sql.query(
      "UPDATE mcp_auth.work_items SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=$1",
      [id]
    );
    await assert.rejects(() => handshake().redeem(id));
    const revoked = await handshake().create(a.grantId, a.clientId, '201', 'airbnb');
    await grants.revoke(a.grantId, a.subjectId);
    await assert.rejects(()=>handshake().redeem(new URL(switchedTicket.openUrl).pathname.split('/').at(-1)!));
    await assert.rejects(() =>
      handshake().redeem(new URL(revoked.openUrl).pathname.split('/').at(-1)!)
    );
    const rows = await sql.query('SELECT payload FROM mcp_auth.work_items');
    assert.ok(rows.rows.length > 0);
    assert.ok(
      rows.rows.every((r) => !r.payload.includes('room-1') && !r.payload.includes('secret-'))
    );
    console.log(
      'PASS M04–M06: real PG encrypted work state; identity/session/camp/scope isolation; restart recovery; preview/settings binding; concurrent confirmation at most once; unknown outcome blocks retry; all four channel baselines; single-use/expired/revoked tickets. SQL rolled back.'
    );
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
}
void main().catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : 'Remote business verification failed; sensitive details withheld.'
  );
  process.exitCode = 1;
});
