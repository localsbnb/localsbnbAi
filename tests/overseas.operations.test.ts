import type { RequestConfig, ToolContext, ToolResult } from '../src/types/mcp';
import { CN_PROFILE } from '../src/region/types';
import { getActiveToolDefinitions } from '../src/config/tools';
import { getOverseasOperationTools } from '../src/tools/overseas/operationTools';
import {
  connectChannelPoi,
  mapChannelListing,
  queryChannelConnection,
} from '../src/tools/overseas/channels';
import {
  changeRoomAvailability,
  createManualOrder,
  updateChannelPrices,
  updateRoomCleanState,
} from '../src/tools/overseas/operations';
import { PREVIEW_TTL_MS } from '../src/tools/overseas/mutationPreview';
import { toZoneStartMs } from '../src/region/dates';

const profile = {
  ...CN_PROFILE,
  region: 'overseas' as const,
  locale: 'en' as const,
  currency: 'USD',
  ianaTimeZone: 'America/New_York',
};
const decode = (result: ToolResult) => JSON.parse(result.content[0].text);
const ok = (data: unknown) => ({ success: true, data });
function setup(overrides: Record<string, any> = {}) {
  const responses: Record<string, any> = {
    '/channelRoomCategories/bnb/get': {
      pois: [
        { poiId: 'p1', outPoiId: 'ext1', poiName: 'Beach Hotel', parentPoiInfo: { poiId: 'lp1' } },
      ],
      roomCategories: [
        {
          poiId: 'p1',
          roomCategoryId: 'cr1',
          roomCategoryName: 'Channel double',
          roomCategoryProductInfos: [{ roomCategoryProductId: 'cp1' }],
        },
      ],
    },
    '/bnbListings/page/get': {
      list: [
        { mpId: 'lp1', mpType: 1, nickName: 'Local hotel' },
        {
          mpId: 'cat1',
          mpType: 2,
          nickName: 'Local double',
          ratePlanViews: [{ roomCategoryProductId: 'lp-rate' }],
        },
      ],
      total: 2,
    },
    '/bnbRatePrice/channelPrice/get': {
      l: [
        {
          i: 'cat1',
          n: 'Double',
          r: [{ c: '9', pi: 'rate1', pn: 'Flexible', cm: 1, dp: [10000, 12000] }],
        },
      ],
    },
    '/bnbRoomStatuses/rooms/get': {
      list: [{ i: 'cat1', n: 'Double', rs: [{ i: 'r1', n: '101' }] }],
    },
    '/bnbRoomStatuses/occ/get': { list: [] },
    '/bnbRoomStatuses/reservation/get': { reservations: [] },
    '/bnbOrder/calcPayout': { accommodationFare: 20000, cleaningFee: 1000, tax: 500 },
    '/poi/createChannelPoi': { poiId: 'new1' },
    '/poiMapping/bnb': true,
    '/roomCategoryMapping/bnb': true,
    '/bnbRatePrice/channelPrice/save': true,
    '/bnbRoomStatuses/close': true,
    '/bnbRoomStatuses/open': true,
    '/room/updateCleanState': true,
    '/bnbOrder/save': { orderId: 'order1' },
    '/bnbOrder/get': { orderId: 'order1', orderDetails: [{ roomId: 'r1' }] },
    ...overrides,
  };
  const request = jest.fn(async (config: RequestConfig) => {
    if (!(config.url in responses)) throw new Error(`Unexpected endpoint ${config.url}`);
    const data = responses[config.url];
    if (data instanceof Error) throw data;
    if (data && data.success === false) return data;
    return ok(data);
  });
  const context: ToolContext = {
    apiClient: { request },
    campId: 'camp1',
    regionProfile: profile,
    getHudsonAccessToken: () => 'test-secret',
    permissionChecker: { checkPermission: jest.fn() },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  };
  const writes = () => request.mock.calls.map(([r]) => r).filter((r) => r.retry === false);
  return { context, request, responses, writes };
}
const rateArgs = {
  roomCategoryProductId: 'rate1',
  startDate: '2026-10-10',
  endDate: '2026-10-11',
  amountFen: 15000,
};
const roomArgs = { roomId: 'r1', startDate: '2026-10-10', endDate: '2026-10-11' };
const orderArgs = {
  roomId: 'r1',
  roomCategoryId: 'cat1',
  checkInDate: '2026-10-10',
  checkOutDate: '2026-10-12',
  guestName: 'Test guest',
};

describe('preview confirmation protection', () => {
  afterEach(() => jest.restoreAllMocks());
  it('refuses first-call confirm, non-boolean confirmation and guessed preview IDs', async () => {
    const { context, writes } = setup();
    for (const extra of [
      { confirm: true },
      { confirm: 'true' },
      { confirm: 1 },
      { confirm: true, previewId: 'guessed' },
    ]) {
      await expect(updateChannelPrices({ ...rateArgs, ...extra }, context)).rejects.toThrow();
    }
    expect(writes()).toHaveLength(0);
  });
  it('binds confirmations to exact arguments and user session', async () => {
    const { context, writes } = setup();
    const preview = decode(await updateChannelPrices(rateArgs, context));
    expect(preview.status).toBe('preview');
    expect(writes()).toHaveLength(0);
    await expect(
      updateChannelPrices(
        { ...rateArgs, amountFen: 16000, confirm: true, previewId: preview.previewId },
        context
      )
    ).rejects.toThrow(/changed/);
    await expect(
      updateChannelPrices(
        { ...rateArgs, confirm: true, previewId: preview.previewId },
        { ...context, getHudsonAccessToken: () => 'changed' }
      )
    ).rejects.toThrow(/changed/);
    await expect(
      updateChannelPrices(
        { ...rateArgs, confirm: true, previewId: preview.previewId },
        { ...context, campId: 'other' }
      )
    ).rejects.toThrow(/changed/);
    await expect(
      updateChannelPrices(
        { ...rateArgs, confirm: true, previewId: preview.previewId },
        setup().context
      )
    ).rejects.toThrow(/missing/);
    expect(writes()).toHaveLength(0);
  });
  it('expires confirmation and prevents concurrent replay', async () => {
    const { context, writes } = setup();
    const expired = decode(await updateChannelPrices(rateArgs, context));
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + PREVIEW_TTL_MS + 1);
    await expect(
      updateChannelPrices({ ...rateArgs, confirm: true, previewId: expired.previewId }, context)
    ).rejects.toThrow(/expired/);
    jest.restoreAllMocks();
    const preview = decode(await updateChannelPrices(rateArgs, context));
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        updateChannelPrices({ ...rateArgs, confirm: true, previewId: preview.previewId }, context)
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(writes()).toHaveLength(1);
  });
  it('consumes preview on ambiguous network failure and disables request retries', async () => {
    const { context, responses, writes } = setup();
    const preview = decode(await updateChannelPrices(rateArgs, context));
    responses['/bnbRatePrice/channelPrice/save'] = new Error('timeout');
    await expect(
      updateChannelPrices({ ...rateArgs, confirm: true, previewId: preview.previewId }, context)
    ).rejects.toThrow('timeout');
    await expect(
      updateChannelPrices({ ...rateArgs, confirm: true, previewId: preview.previewId }, context)
    ).rejects.toThrow(/missing/);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].retry).toBe(false);
  });
  it.each([false, { success: false, errorCode: 'COMMON_PERMISSION_DENIED', errorMsg: 'denied' }])(
    'does not report rejected writes as successful (%j)',
    async (failure) => {
      const { context, responses } = setup();
      const preview = decode(await updateChannelPrices(rateArgs, context));
      responses['/bnbRatePrice/channelPrice/save'] = failure;
      await expect(
        updateChannelPrices({ ...rateArgs, confirm: true, previewId: preview.previewId }, context)
      ).rejects.toThrow();
    }
  );
});

describe('S08 channel operations', () => {
  it.each([
    ['booking', '9', '1264751971073368066'],
    ['trip', '113', '2036274710696730625'],
    ['agoda', '10', '2036274710696730627'],
  ])(
    'connects %s using the PC contract only after preview',
    async (channel, channelId, accountId) => {
      const { context, writes } = setup();
      const args = { channel, outPoiId: 'external-property' };
      const preview = decode(await connectChannelPoi(args, context));
      expect(writes()).toHaveLength(0);
      await connectChannelPoi({ ...args, confirm: true, previewId: preview.previewId }, context);
      expect(writes()[0]).toMatchObject({
        url: '/poi/createChannelPoi',
        data: { campId: 'camp1', channelId, accountId, outPoiId: 'external-property' },
      });
    }
  );
  it('does not create an already linked property twice', async () => {
    const { context, writes } = setup();
    expect(
      decode(await connectChannelPoi({ channel: 'booking', outPoiId: 'ext1' }, context)).status
    ).toBe('already_exists');
    expect(writes()).toHaveLength(0);
  });
  it.each(['airbnb', 'toString', '__proto__', ''])(
    'rejects unsupported channel %s',
    async (channel) => {
      const { context, request } = setup();
      await expect(connectChannelPoi({ channel, outPoiId: 'id' }, context)).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    }
  );
  it('queries connection status with string POI filters and paginated local candidates', async () => {
    const { context, request, writes } = setup();
    await queryChannelConnection(
      { channel: 'trip', poiId: '1234567890123456789', pageNum: 2 },
      context
    );
    expect(request.mock.calls[0][0].data).toEqual({
      campId: 'camp1',
      channelIds: ['113'],
      poiIds: ['1234567890123456789'],
    });
    expect(request.mock.calls[1][0].data).toMatchObject({ pageNum: 2, pageSize: 50 });
    expect(writes()).toHaveLength(0);
  });
  it('maps a verified property with isPublish=0', async () => {
    const { context, writes } = setup();
    const args = { channel: 'booking', poiId: 'p1', kind: 'property', parentPoiId: 'lp1' };
    const preview = decode(await mapChannelListing(args, context));
    await mapChannelListing({ ...args, confirm: true, previewId: preview.previewId }, context);
    expect(writes()[0].data).toEqual({
      campId: 'camp1',
      poiId: 'p1',
      parentPoiId: 'lp1',
      isPublish: 0,
    });
  });
  it('maps verified Trip rooms and products with isPublish=0 on both levels', async () => {
    const { context, writes } = setup();
    const args = {
      channel: 'trip',
      poiId: 'p1',
      kind: 'room',
      roomCategoryId: 'cr1',
      parentRoomCategoryId: 'cat1',
      productMappings: [{ roomCategoryProductId: 'cp1', parentRoomCategoryProductId: 'lp-rate' }],
    };
    const preview = decode(await mapChannelListing(args, context));
    await mapChannelListing({ ...args, confirm: true, previewId: preview.previewId }, context);
    expect(writes()[0].data).toEqual({
      campId: 'camp1',
      roomCategoryMappings: [
        {
          roomCategoryId: 'cr1',
          parentRoomCategoryId: 'cat1',
          isPublish: 0,
          roomCategoryProductMappings: [
            { roomCategoryProductId: 'cp1', parentRoomCategoryProductId: 'lp-rate', isPublish: 0 },
          ],
        },
      ],
    });
  });
  it.each([
    { poiId: 'other' },
    { parentRoomCategoryId: 'missing' },
    { roomCategoryId: 'missing' },
    { productMappings: [{ roomCategoryProductId: 'bad', parentRoomCategoryProductId: 'lp-rate' }] },
  ])('refuses foreign or fabricated mapping IDs %j', async (extra) => {
    const { context, writes } = setup();
    await expect(
      mapChannelListing(
        {
          channel: 'agoda',
          poiId: 'p1',
          kind: 'room',
          roomCategoryId: 'cr1',
          parentRoomCategoryId: 'cat1',
          ...extra,
        },
        context
      )
    ).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });
  it('requires a new confirmation when the existing mapping changes', async () => {
    const { context, responses, writes } = setup();
    const args = { channel: 'booking', poiId: 'p1', kind: 'property', parentPoiId: 'lp1' };
    const preview = decode(await mapChannelListing(args, context));
    responses['/channelRoomCategories/bnb/get'].pois[0].parentPoiInfo = { poiId: 'another' };
    await expect(
      mapChannelListing({ ...args, confirm: true, previewId: preview.previewId }, context)
    ).rejects.toThrow(/changed/);
    expect(writes()).toHaveLength(0);
  });
});

describe('S09 channel prices', () => {
  it('uses property timezone, inclusive days offset and exact fen', async () => {
    const { context, request, writes } = setup();
    const preview = decode(await updateChannelPrices(rateArgs, context));
    expect(request.mock.calls[0][0].data).toMatchObject({
      startDate: toZoneStartMs('2026-10-10', 'America/New_York'),
      days: 1,
    });
    expect(preview.summary.currentPrices).toEqual([
      { date: '2026-10-10', amountFen: 10000 },
      { date: '2026-10-11', amountFen: 12000 },
    ]);
    await updateChannelPrices(
      { ...rateArgs, confirm: true, previewId: preview.previewId },
      context
    );
    expect(writes()[0].data).toEqual({
      campId: 'camp1',
      validWeekDays: [1, 1, 1, 1, 1, 1, 1],
      rates: [
        { from: '2026-10-10', to: '2026-10-11', roomCategoryProductId: 'rate1', value: 15000 },
      ],
    });
  });
  it('honors Sunday-first weekday filtering and dated price values', async () => {
    const { context, responses } = setup();
    responses['/bnbRatePrice/channelPrice/get'].l[0].r[0].dp = [
      { d: '2026-10-11', p: 12000 },
      { d: '2026-10-10', p: 10000 },
    ];
    const p = decode(
      await updateChannelPrices({ ...rateArgs, validWeekDays: [1, 0, 0, 0, 0, 0, 0] }, context)
    );
    expect(p.summary.currentPrices).toEqual([{ date: '2026-10-11', amountFen: 12000 }]);
  });
  it.each([{ cm: 0 }, { cm: 1, dp: [{ p: 10000, cm: 0 }, 12000] }])(
    'refuses row/day non-editable prices %j',
    async (extra) => {
      const { context, responses, writes } = setup();
      Object.assign(responses['/bnbRatePrice/channelPrice/get'].l[0].r[0], extra);
      await expect(updateChannelPrices(rateArgs, context)).rejects.toThrow();
      expect(writes()).toHaveLength(0);
    }
  );
  it('rejects changed prices and unsafe numeric product IDs', async () => {
    const { context, responses, writes } = setup();
    const p = decode(await updateChannelPrices(rateArgs, context));
    responses['/bnbRatePrice/channelPrice/get'].l[0].r[0].dp[0] = 5000;
    await expect(
      updateChannelPrices({ ...rateArgs, confirm: true, previewId: p.previewId }, context)
    ).rejects.toThrow(/changed/);
    responses['/bnbRatePrice/channelPrice/get'].l[0].r[0].pi = 1234567890123456789;
    await expect(updateChannelPrices(rateArgs, context)).rejects.toThrow(/unsafe/);
    expect(writes()).toHaveLength(0);
  });
  it.each([
    { amountFen: 1 },
    { amountFen: 1.1 },
    { amountFen: -1 },
    { amountFen: 1_000_000_000 },
    { startDate: '2026-02-30' },
    { endDate: '2026-10-09' },
    { endDate: '2027-10-10' },
    { validWeekDays: [1] },
    { validWeekDays: [0, 0, 0, 0, 0, 0, 0] },
  ])('refuses invalid prices/dates/weekdays %j', async (extra) => {
    const { context, request } = setup();
    await expect(updateChannelPrices({ ...rateArgs, ...extra }, context)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('S09 room availability', () => {
  it('closes only verified room/dates after confirmation', async () => {
    const { context, writes } = setup();
    const args = { ...roomArgs, type: 4, remark: 'Repair' };
    const p = decode(await changeRoomAvailability(args, context, 'close'));
    expect(writes()).toHaveLength(0);
    await changeRoomAvailability(
      { ...args, confirm: true, previewId: p.previewId },
      context,
      'close'
    );
    expect(writes()[0].data).toEqual({
      campId: 'camp1',
      startDate: '2026-10-10',
      endDate: '2026-10-11',
      type: 4,
      remark: 'Repair',
      roomDates: [{ roomId: 'r1', dates: ['2026-10-10', '2026-10-11'] }],
    });
  });
  it('opens only the specified manual blocked dates', async () => {
    const { context, writes } = setup({
      '/bnbRoomStatuses/occ/get': {
        list: [
          { ri: 'r1', d: '2026-10-10', ot: 4 },
          { ri: 'r1', d: '2026-10-11', ot: 5 },
        ],
      },
    });
    const p = decode(await changeRoomAvailability(roomArgs, context, 'open'));
    await changeRoomAvailability(
      { ...roomArgs, confirm: true, previewId: p.previewId },
      context,
      'open'
    );
    expect(writes()[0].data).toEqual({
      campId: 'camp1',
      roomDates: [{ roomId: 'r1', dates: ['2026-10-10', '2026-10-11'] }],
    });
  });
  it.each([2, 3])('refuses order/linked closure type %i', async (type) => {
    const { context, writes } = setup();
    await expect(changeRoomAvailability({ ...roomArgs, type }, context, 'close')).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });
  it.each([2, 3, 99])('refuses opening occupation type %i', async (ot) => {
    const { context, writes } = setup({
      '/bnbRoomStatuses/occ/get': { list: [{ ri: 'r1', d: '2026-10-10', ot }] },
    });
    await expect(
      changeRoomAvailability({ ...roomArgs, endDate: '2026-10-10' }, context, 'open')
    ).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });
  it('rejects reservations acquired between preview and confirm', async () => {
    const { context, responses, writes } = setup();
    const p = decode(await changeRoomAvailability(roomArgs, context, 'close'));
    responses['/bnbRoomStatuses/reservation/get'] = {
      reservations: [{ ri: 'r1', cid: '2026-10-09', cod: '2026-10-11' }],
    };
    await expect(
      changeRoomAvailability(
        { ...roomArgs, confirm: true, previewId: p.previewId },
        context,
        'close'
      )
    ).rejects.toThrow(/reservation/);
    expect(writes()).toHaveLength(0);
  });
  it('refuses unknown room', async () => {
    const { context } = setup();
    await expect(
      changeRoomAvailability({ ...roomArgs, roomId: 'foreign' }, context, 'close')
    ).rejects.toThrow(/not found/);
  });

  it('treats null occupation/reservation lists as empty availability', async () => {
    const { context, responses, writes } = setup();
    responses['/bnbRoomStatuses/occ/get'] = { list: null };
    responses['/bnbRoomStatuses/reservation/get'] = { reservations: null };
    const preview = decode(await changeRoomAvailability(roomArgs, context, 'close'));
    expect(preview.status).toBe('preview');
    expect(writes()).toHaveLength(0);
  });
});

describe('S09 manual orders', () => {
  it('quotes before preview, excludes checkout and saves only after approval', async () => {
    const { context, request, writes } = setup();
    const p = decode(await createManualOrder(orderArgs, context));
    expect(writes()).toHaveLength(0);
    expect(
      request.mock.calls.find(([r]) => r.url === '/bnbOrder/calcPayout')![0].data
    ).toMatchObject({
      campId: 'camp1',
      roomCategoryId: 'cat1',
      checkInDate: '2026-10-10',
      checkOutDate: '2026-10-12',
    });
    expect(p.summary.submittedAmounts).toMatchObject({
      totalFen: 21500,
      paidFen: 0,
      balanceFen: 21500,
    });
    expect(
      request.mock.calls.find(([r]) => r.url === '/bnbRoomStatuses/rooms/get')![0].data
    ).toMatchObject({ days: 1 });
    await createManualOrder({ ...orderArgs, confirm: true, previewId: p.previewId }, context);
    expect(writes()[0]).toMatchObject({
      url: '/bnbOrder/save',
      data: {
        orderId: null,
        orderState: 2,
        channelId: '0',
        orderChannelId: '0',
        orderOpFromType: 1,
        orderDetails: [
          {
            roomCategoryId: 'cat1',
            roomId: 'r1',
            saleType: 1,
            checkInDate: '2026-10-10',
            checkOutDate: '2026-10-12',
            paid: 0,
            accommodationFare: 20000,
            cleaningFee: 1000,
            tax: 500,
          },
        ],
      },
    });
  });
  it('rejects a changed quote', async () => {
    const { context, responses, writes } = setup();
    const p = decode(await createManualOrder(orderArgs, context));
    responses['/bnbOrder/calcPayout'].tax = 600;
    await expect(
      createManualOrder({ ...orderArgs, confirm: true, previewId: p.previewId }, context)
    ).rejects.toThrow(/changed/);
    expect(writes()).toHaveLength(0);
  });
  it.each([
    { roomCategoryId: 'wrong' },
    { roomId: 'wrong' },
    { checkOutDate: '2026-10-10' },
    { adults: 0 },
    { paidFen: 999999 },
    { accommodationFareFen: 1.2 },
    { guestEmail: 'bad' },
  ])('rejects invalid manual booking %j', async (extra) => {
    const { context, writes } = setup();
    await expect(createManualOrder({ ...orderArgs, ...extra }, context)).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });
  it('does not invent a quote or ignore reservations', async () => {
    const { context, responses, writes } = setup({ '/bnbOrder/calcPayout': null });
    await expect(createManualOrder(orderArgs, context)).rejects.toThrow(/incomplete|quote|accommodationFareFen/);
    const withFare = decode(
      await createManualOrder({ ...orderArgs, accommodationFareFen: 10000 }, context)
    );
    expect(withFare.summary.submittedAmounts.accommodationFare).toBe(10000);
    expect(withFare.summary.amounts.accommodationFare).toMatch(/^USD /);
    responses['/bnbRoomStatuses/reservation/get'] = {
      reservations: [{ ri: 'r1', cid: '2026-10-11', cod: '2026-10-13' }],
    };
    await expect(createManualOrder(orderArgs, context)).rejects.toThrow(/occupied/);
    expect(writes()).toHaveLength(0);
  });
  it('permits checkout-day availability and discloses explicit amount overrides', async () => {
    const { context } = setup({
      '/bnbRoomStatuses/reservation/get': {
        reservations: [{ ri: 'r1', cid: '2026-10-12', cod: '2026-10-13' }],
      },
    });
    const p = decode(
      await createManualOrder({ ...orderArgs, accommodationFareFen: 18000, paidFen: 1000 }, context)
    );
    expect(p.summary.submittedAmounts).toMatchObject({
      accommodationFare: 18000,
      totalFen: 19500,
      paidFen: 1000,
    });
  });
});

describe('room clean state', () => {
  it('previews then updates clean state after confirmation', async () => {
    const { context, writes, responses } = setup({
      '/bnbRoomStatuses/rooms/get': {
        list: [{ i: 'cat1', n: 'lhq', rs: [{ i: 'r1', n: 'lhq', cs: 3 }] }],
      },
    });
    const preview = decode(
      await updateRoomCleanState({ roomId: 'r1', cleanState: 'dirty' }, context)
    );
    expect(preview.status).toBe('preview');
    expect(preview.summary).toMatchObject({
      fromCleanState: 3,
      toCleanState: 1,
      toCleanStateLabel: 'Dirty',
    });
    expect(writes()).toHaveLength(0);
    responses['/bnbRoomStatuses/rooms/get'] = {
      list: [{ i: 'cat1', n: 'lhq', rs: [{ i: 'r1', n: 'lhq', cs: 1 }] }],
    };
    const submitted = decode(
      await updateRoomCleanState(
        { roomId: 'r1', cleanState: 1, confirm: true, previewId: preview.previewId },
        context
      )
    );
    expect(submitted.status).toBe('submitted');
    expect(writes()).toEqual([
      expect.objectContaining({
        url: '/room/updateCleanState',
        data: expect.objectContaining({ roomId: 'r1', cleanState: 1 }),
      }),
    ]);
    expect(submitted.readBack).toMatchObject({ cleanState: 1 });
  });

  it('refuses unknown rooms and invalid clean states', async () => {
    const { context, writes } = setup();
    await expect(
      updateRoomCleanState({ roomId: 'missing', cleanState: 'dirty' }, context)
    ).rejects.toThrow(/not found/);
    await expect(
      updateRoomCleanState({ roomId: 'r1', cleanState: 'filthy' }, context)
    ).rejects.toThrow(/cleanState/);
    expect(writes()).toHaveLength(0);
  });
});

describe('registration and permission boundaries', () => {
  it('registers overseas operation tools including clean-state updates', () => {
    const names = getOverseasOperationTools().map((t) => t.name);
    expect(names).toHaveLength(10);
    expect(names).toContain('update_room_clean_state');
    expect(getActiveToolDefinitions(profile).map((t) => t.name)).toEqual(
      expect.arrayContaining(names)
    );
    expect(getActiveToolDefinitions(CN_PROFILE).some((t) => names.includes(t.name))).toBe(false);
  });
  it('denies unauthorized calls before any API request', async () => {
    const { context, request } = setup();
    context.permissionChecker.checkPermission = () => {
      throw new Error('Permission denied');
    };
    const tool = getOverseasOperationTools().find((t) => t.name === 'create_manual_order')!;
    expect((await tool.handler(orderArgs, context)).isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect((await tool.handler(orderArgs, { ...context, regionProfile: CN_PROFILE })).isError).toBe(
      true
    );
  });
});

describe('contract regressions', () => {
  it('deducts the quoted discount exactly once, matching the PC form', async () => {
    const { context } = setup({
      '/bnbOrder/calcPayout': {
        accommodationFare: 20000,
        discountAmount: 3000,
        cleaningFee: 1000,
        tax: 500,
      },
    });
    const p = decode(await createManualOrder(orderArgs, context));
    expect(p.payload.orderDetails[0].accommodationFare).toBe(17000);
    expect(p.summary.submittedAmounts.totalFen).toBe(18500);
  });
  it('re-reads the created order without confusing read-back failure with write failure', async () => {
    const { context, responses, writes } = setup();
    const p = decode(await createManualOrder(orderArgs, context));
    responses['/bnbOrder/get'] = new Error('read permission denied');
    const r = decode(
      await createManualOrder({ ...orderArgs, confirm: true, previewId: p.previewId }, context)
    );
    expect(r.status).toBe('submitted');
    expect(r.readBackStatus).toBe('failed');
    expect(writes()).toHaveLength(1);
  });
  it('includes channel read-back after submission without claiming final connection success', async () => {
    const { context } = setup();
    const args = { channel: 'booking', outPoiId: 'new' };
    const p = decode(await connectChannelPoi(args, context));
    const r = decode(
      await connectChannelPoi({ ...args, confirm: true, previewId: p.previewId }, context)
    );
    expect(r.status).toBe('submitted');
    expect(r.readBackStatus).toBe('read');
    expect(r.readBack.pois).toHaveLength(1);
  });
  it('refuses room mapping until the property is linked, and scopes queries to that property', async () => {
    const { context, responses, request } = setup();
    const args = {
      channel: 'booking',
      poiId: 'p1',
      kind: 'room',
      roomCategoryId: 'cr1',
      parentRoomCategoryId: 'cat1',
    };
    await mapChannelListing(args, context);
    expect(
      request.mock.calls.find(([r]) => r.url === '/bnbListings/page/get')![0].data
    ).toMatchObject({ mpIds: ['lp1'], listingTypes: [3], isSelectAll: 1 });
    responses['/channelRoomCategories/bnb/get'].pois[0].parentPoiInfo = null;
    await expect(mapChannelListing(args, context)).rejects.toThrow(/before mapping/);
  });
  it('refuses duplicate local room mappings and incomplete channel results', async () => {
    const { context, responses } = setup();
    responses['/channelRoomCategories/bnb/get'].roomCategories.push({
      roomCategoryId: 'cr2',
      parentRoomCategoryInfo: { roomCategoryId: 'cat1' },
    });
    await expect(
      mapChannelListing(
        {
          channel: 'booking',
          poiId: 'p1',
          kind: 'room',
          roomCategoryId: 'cr1',
          parentRoomCategoryId: 'cat1',
        },
        context
      )
    ).rejects.toThrow(/already mapped/);
    responses['/channelRoomCategories/bnb/get'] = {};
    await expect(connectChannelPoi({ channel: 'trip', outPoiId: 'new' }, context)).rejects.toThrow(
      /incomplete/
    );
  });
  it('consumes all equivalent previews when one write is sent', async () => {
    const { context, writes } = setup();
    const p1 = decode(await updateChannelPrices(rateArgs, context));
    const p2 = decode(await updateChannelPrices(rateArgs, context));
    await updateChannelPrices({ ...rateArgs, confirm: true, previewId: p1.previewId }, context);
    await expect(
      updateChannelPrices({ ...rateArgs, confirm: true, previewId: p2.previewId }, context)
    ).rejects.toThrow(/missing/);
    expect(writes()).toHaveLength(1);
  });
  it('supports integer/decimal string prices and rejects missing selected dates', async () => {
    const { context, responses } = setup();
    responses['/bnbRatePrice/channelPrice/get'].l[0].r[0].dp = ['10000', '120.25'];
    const p = decode(await updateChannelPrices(rateArgs, context));
    expect(p.summary.currentPrices[1].amountFen).toBe(12025);
    responses['/bnbRatePrice/channelPrice/get'].l[0].r[0].dp = [10000];
    await expect(updateChannelPrices(rateArgs, context)).rejects.toThrow();
  });
});
