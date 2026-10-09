import type { ToolContext } from '../src/types/mcp';
import {
  handshakeSessionScope,
  importAirbnbListingsHandler,
  pollHandshakeHandler,
  resolveHandshakeOrigin,
  startHandshakeHandler,
} from '../src/tools/auth/handshake';
import { snapshot } from '../src/tools/overseas/channelConnectionSnapshot';
import { saveLocalHandshakeTicket } from '../src/auth/handshakeTickets';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

function contextWith(request: jest.Mock): ToolContext {
  return {
    apiClient: { request },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    permissionChecker: { checkPermission: jest.fn() },
    campId: '2091',
    getHudsonAccessToken: () => 'hudson-token',
  };
}

describe('handshake origin', () => {
  const orig = process.env.LOCALSBNB_SITE_URL;
  afterEach(() => {
    if (orig == null) delete process.env.LOCALSBNB_SITE_URL;
    else process.env.LOCALSBNB_SITE_URL = orig;
  });

  it('uses LOCALSBNB_SITE_URL when set', () => {
    process.env.LOCALSBNB_SITE_URL = 'http://localhost:3000/';
    expect(resolveHandshakeOrigin()).toBe('http://localhost:3000');
  });
});

describe('handshake tools', () => {
  const origStore = process.env.LOCALSBNB_HANDSHAKE_STORE;
  const origSite = process.env.LOCALSBNB_SITE_URL;
  const origFetch = global.fetch;
  const origOpen = process.env.LOCALSBNB_OPEN_BROWSER;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'lb-hs-'));
    process.env.LOCALSBNB_HANDSHAKE_STORE = path.join(dir, 'handshakes.json');
    process.env.LOCALSBNB_OPEN_BROWSER = '0';
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (origStore == null) delete process.env.LOCALSBNB_HANDSHAKE_STORE;
    else process.env.LOCALSBNB_HANDSHAKE_STORE = origStore;
    if (origOpen == null) delete process.env.LOCALSBNB_OPEN_BROWSER;
    else process.env.LOCALSBNB_OPEN_BROWSER = origOpen;
    global.fetch = origFetch;
    if (origSite == null) delete process.env.LOCALSBNB_SITE_URL;
    else process.env.LOCALSBNB_SITE_URL = origSite;
    jest.restoreAllMocks();
  });

  it('start_handshake returns openUrl without the hudson token', async () => {
    process.env.LOCALSBNB_SITE_URL = 'http://localhost:3000';
    const request = jest.fn().mockResolvedValue({
      success: true,
      data: { records: [], pois: [] },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { ticketId: 'abc123', openUrl: 'http://localhost:3000/ai/handshake/abc123' },
      }),
    }) as unknown as typeof fetch;

    const result = await startHandshakeHandler({ type: 'airbnb_oauth' }, contextWith(request));
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('http://localhost:3000/ai/handshake/abc123');
    expect(result.content[0].text).toContain('ticketId=abc123');
    expect(result.content[0].text).toMatch(/manually/i);
    expect(result.content[0].text).not.toContain('hudson-token');
  });

  function linked(status = 3) {
    return { pois: [{ poiId: 'p1', poiName: 'Villa' }], roomCategories: [{
      poiId: 'p1', roomCategoryId: 'r1', connectionStatus: status,
      parentRoomCategoryInfo: { roomCategoryId: 'local-room' },
    }] };
  }
  function flow(baseline = { pois: [] } as Record<string, unknown>) {
    let current: Record<string, unknown> = baseline;
    const request = jest.fn(async ({url}) => ({ success: true, data:
      url === '/account/page/get' ? {records:[{accountId:'acc-9',isTokenExpired:0,lastSyncTime:Date.now()}]} : current }));
    const context = contextWith(request);
    saveLocalHandshakeTicket({ ticketId:'t1',type:'airbnb_oauth',campId:'2091',
      baselineAccountIds:[],baselineFingerprints:[],baselinePois:snapshot(baseline),
      sessionScope:handshakeSessionScope(context),createdAt:Date.now(),expiresAt:Date.now()+60000 });
    return {context,request,set:(value:Record<string,unknown>)=>{current=value;},
      poll:async()=>JSON.parse((await pollHandshakeHandler({},context)).content[0].text)};
  }
  it('account creation alone stays pending', async () => {
    expect((await flow().poll()).status).toBe('pending');
  });
  it('no-argument completion finds the flow and accepts new connected rooms without parent POI', async () => {
    const f = flow(); f.set(linked());
    expect((await f.poll()).status).toBe('succeeded');
    const calls=f.request.mock.calls.length;
    expect((await f.poll()).status).toBe('succeeded');
    expect(f.request).toHaveBeenCalledTimes(calls);
  });
  it('existing POI room mapping changes complete the flow', async () => {
    const f = flow(linked(1)); f.set(linked());
    expect((await f.poll()).status).toBe('succeeded');
  });
  it('unchanged listings and refreshed account timestamps stay pending', async () => {
    expect((await flow(linked()).poll()).status).toBe('pending');
  });
  it('pending retains the original baseline for a later check', async () => {
    const f=flow(); f.set(linked(1));
    expect((await f.poll()).status).toBe('pending');
    f.set(linked()); expect((await f.poll()).status).toBe('succeeded');
  });
  it('failed connection requires web action', async () => {
    const f=flow(); f.set(linked(4));
    expect((await f.poll()).status).toBe('needs_action');
  });
  it('a connected but unmapped room is incomplete', async () => {
    const f=flow(); const data=linked(); data.roomCategories[0].parentRoomCategoryInfo.roomCategoryId=''; f.set(data);
    expect((await f.poll()).status).toBe('pending');
  });
  it('a different credential cannot complete a stored ticket', async () => {
    const f=flow();
    const result=await pollHandshakeHandler({ticketId:'t1'},{...f.context,getHudsonAccessToken:()=> 'different'});
    expect(result.isError).toBe(true); expect(f.request).not.toHaveBeenCalled();
  });
  it('expired flow is not success', async () => {
    const f=flow(); jest.spyOn(Date,'now').mockReturnValue(Date.now()+120000);
    expect((await pollHandshakeHandler({},f.context)).isError).toBe(true);
  });

  it('import_airbnb_listings previews without confirm', async () => {
    const request = jest.fn().mockResolvedValue({
      success: true,
      data: {
        requestId: 'req-1',
        poiInfos: [
          {
            address: '1 Beach',
            roomCategoryInfos: [{ outRoomCategoryId: 'L1', outRoomCategoryName: 'Villa', isImported: false }],
          },
        ],
      },
    });
    const result = await importAirbnbListingsHandler({ accountId: 'acc-9' }, contextWith(request));
    expect(result.content[0].text).toContain('req-1');
    expect(result.content[0].text).toContain('L1');
    expect(result.content[0].text).toMatch(/Preview only/i);
  });
});
