import type { ToolContext, ToolResult } from '../src/types/mcp';
import {
  startChannelConnection,
  completeChannelConnection,
  CHANNEL_FLOW_TTL_MS,
} from '../src/tools/overseas/channelConnectionFlow';
import { tryOpenSystemBrowser } from '../src/auth/openSystemBrowser';
jest.mock('../src/auth/openSystemBrowser', () => ({
  tryOpenSystemBrowser: jest.fn().mockResolvedValue({ opened: true, reason: 'opened' }),
}));
const decode = (r: ToolResult) => JSON.parse(r.content[0].text);
function setup() {
  let data: Record<string, unknown> = { pois: [], roomCategories: [] };
  const request = jest.fn(async () => ({ success: true, data }));
  const context: ToolContext = {
    apiClient: { request },
    campId: 'camp1',
    getHudsonAccessToken: () => 'test-token',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    permissionChecker: { checkPermission: jest.fn() },
  };
  return {
    context,
    request,
    set: (next: Record<string, unknown>) => {
      data = next;
    },
  };
}
function connected(status = 3) {
  return {
    pois: [{ poiId: 'p1', outPoiId: 'ext', parentPoiInfo: { poiId: 'local' } }],
    roomCategories: [
      {
        poiId: 'p1',
        roomCategoryId: 'r1',
        connectionStatus: status,
        parentRoomCategoryInfo: { roomCategoryId: 'local-room' },
        roomCategoryProductInfos: [
          {
            roomCategoryProductId: 'price',
            parentRoomCategoryProductInfo: { roomCategoryProductId: 'local-price' },
          },
        ],
      },
    ],
  };
}
const originalSite = process.env.LOCALSBNB_SITE_URL;
describe('simple S08 PC flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LOCALSBNB_SITE_URL = 'https://overseas-dev.localhome.cn';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalSite === undefined) delete process.env.LOCALSBNB_SITE_URL;
    else process.env.LOCALSBNB_SITE_URL = originalSite;
  });
  it.each([
    ['booking', '9', 'linkbooking'],
    ['trip', '113', 'linktrip'],
    ['agoda', '10', 'linkagoda'],
  ])('opens %s after recording the matching channel baseline', async (channel, id, path) => {
    const t = setup();
    const start = decode(await startChannelConnection({ channel }, t.context));
    expect(start.status).toBe('awaiting_user');
    expect(start.message).toContain('已完成');
    expect(t.request.mock.calls[0]).toEqual([
      expect.objectContaining({
        url: '/channelRoomCategories/bnb/get',
        data: { campId: 'camp1', channelIds: [id] },
      }),
    ]);
    expect(tryOpenSystemBrowser).toHaveBeenCalledWith(`https://overseas-dev.localhome.cn/${path}`);
    expect(t.request.mock.invocationCallOrder[0]).toBeLessThan(
      (tryOpenSystemBrowser as jest.Mock).mock.invocationCallOrder[0]
    );
    t.set(connected());
    const done = decode(await completeChannelConnection({}, t.context));
    expect(done.status).toBe('succeeded');
    expect(t.request).toHaveBeenCalledTimes(2);
  });
  it('does not mistake a pre-existing connected POI for completion or reset a pending baseline', async () => {
    const t = setup();
    t.set(connected());
    await startChannelConnection({ channel: 'booking' }, t.context);
    expect(decode(await completeChannelConnection({}, t.context)).status).toBe('pending');
    await startChannelConnection({ channel: 'agoda' }, t.context);
    expect(tryOpenSystemBrowser).toHaveBeenCalledTimes(1);
    expect(t.request).toHaveBeenCalledTimes(2);
  });
  it('detects an existing POI that finishes mapping, without asking for any IDs', async () => {
    const t = setup();
    t.set(connected(2));
    await startChannelConnection({ channel: 'trip' }, t.context);
    t.set(connected());
    expect(decode(await completeChannelConnection({}, t.context)).status).toBe('succeeded');
    expect(decode(await completeChannelConnection({}, t.context)).status).toBe('succeeded');
    expect(t.request).toHaveBeenCalledTimes(2);
  });
  it('keeps the original baseline while waiting for synchronization', async () => {
    const t = setup();
    await startChannelConnection({ channel: 'booking' }, t.context);
    t.set(connected(2));
    expect(decode(await completeChannelConnection({}, t.context)).status).toBe('pending');
    t.set(connected());
    expect(decode(await completeChannelConnection({}, t.context)).status).toBe('succeeded');
  });
  it.each(['no-rooms', 'no-parent', 'no-product', 'failed'])(
    'refuses incomplete or failed mapping: %s',
    async (issue) => {
      const t = setup();
      await startChannelConnection({ channel: 'booking' }, t.context);
      const data = connected();
      if (issue === 'no-rooms') data.roomCategories = [];
      if (issue === 'no-parent') data.pois[0].parentPoiInfo.poiId = '';
      if (issue === 'no-product')
        data.roomCategories[0].roomCategoryProductInfos[0].parentRoomCategoryProductInfo.roomCategoryProductId =
          '';
      if (issue === 'failed') data.roomCategories[0].connectionStatus = 4;
      t.set(data);
      expect(decode(await completeChannelConnection({}, t.context)).status).toBe(
        issue === 'failed' ? 'needs_action' : 'pending'
      );
    }
  );
  it('ignores timestamps, names and deleted POIs as completion signals', async () => {
    const t = setup();
    t.set(connected());
    await startChannelConnection({ channel: 'booking' }, t.context);
    const next = connected();
    t.set({
      ...next,
      pois: [{ ...next.pois[0], poiName: 'Changed name', lastSyncTime: Date.now() }],
    });
    expect(decode(await completeChannelConnection({}, t.context)).status).toBe('pending');
    t.set({ pois: [], roomCategories: [] });
    expect(decode(await completeChannelConnection({}, t.context)).status).toBe('pending');
  });
  it('isolates camps, credentials and clients, and expires pending flows', async () => {
    const t = setup();
    await startChannelConnection({ channel: 'booking' }, t.context);
    t.set(connected());
    for (const ctx of [
      { ...t.context, campId: 'other' },
      { ...t.context, getHudsonAccessToken: () => 'other' },
      setup().context,
    ])
      expect(decode(await completeChannelConnection({}, ctx)).status).toBe('no_active_flow');
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + CHANNEL_FLOW_TTL_MS + 1);
    expect(decode(await completeChannelConnection({}, t.context)).status).toBe('expired');
  });
  it('keeps a manual URL when opening the browser fails', async () => {
    (tryOpenSystemBrowser as jest.Mock).mockResolvedValueOnce({
      opened: false,
      reason: 'disabled',
    });
    const t = setup();
    const result = decode(await startChannelConnection({ channel: 'trip' }, t.context));
    expect(result.browserOpenRequested).toBe(false);
    expect(result.openUrl).toMatch(/linktrip$/);
    t.set(connected());
    expect(decode(await completeChannelConnection({}, t.context)).status).toBe('succeeded');
  });
  it('does not open the browser when the baseline API fails', async () => {
    const t = setup();
    t.request.mockRejectedValueOnce(new Error('denied'));
    await expect(startChannelConnection({ channel: 'booking' }, t.context)).rejects.toThrow(
      'denied'
    );
    expect(tryOpenSystemBrowser).not.toHaveBeenCalled();
    expect(decode(await completeChannelConnection({}, t.context)).status).toBe('no_active_flow');
  });
});
