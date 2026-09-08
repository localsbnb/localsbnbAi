import { HTTPClient } from '../src/client/httpClient';
import { resolveRegionProfile } from '../src/region/resolve';
import { getActiveToolDefinitions, toolDefinitions } from '../src/config/tools';
import { t } from '../src/region/i18n';
import { getOverseasToolDescription } from '../src/region/toolDescriptions';
import {
  getOrderDetailsOverseas,
  queryInHouseOrdersOverseas,
  queryOrdersByDateRangeOverseas,
  queryPreArrivalOrdersOverseas,
  queryPreDepartureOrdersOverseas,
  queryTodayOrdersOverseas,
} from '../src/tools/overseas/orders';
import { queryRoomStatusNewOverseas, queryTodayRoomStatusOverseas } from '../src/tools/overseas/rooms';
import { queryRoomPricesOverseas } from '../src/tools/overseas/prices';
import { queryOperationalDataOverseas } from '../src/tools/overseas/finance';
import { checkInOrderOverseas } from '../src/tools/overseas/writes';
import { handleToolError } from '../src/utils/errorHandler';
import type { ToolContext, ToolResult } from '../src/types/mcp';

const campId = process.env.APP_ID || process.env.CAMP_ID;
const token = process.env.APP_SECRET || process.env.HUDSON_ACCESS_TOKEN;
const enabled = Boolean(campId && token);
const sampleOrder = process.env.OVERSEAS_SAMPLE_ORDER_ID || '2096985573978292226';

const describeLive = enabled ? describe : describe.skip;

function textOf(r: ToolResult): string {
  return r.content?.map((c) => c.text).join('\n') || '';
}

describeLive('overseas live read (APP_ID + APP_SECRET)', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  let context: ToolContext;

  beforeAll(async () => {
    const client = new HTTPClient('', token);
    const profile = await resolveRegionProfile(client, campId, logger);
    expect(profile.region).toBe('overseas');
    client.setExtraHeaders({
      lang: profile.localeCode,
      'Accept-Language': profile.localeCode,
      campId: String(profile.campId || campId),
    });
    context = {
      apiClient: client,
      logger,
      permissionChecker: { checkPermission() {} },
      campId,
      regionProfile: profile,
    };
  }, 30000);

  it('registers write tools and localizes descriptions', () => {
    const profile = context.regionProfile!;
    const tools = getActiveToolDefinitions(profile);
    expect(tools).toHaveLength(toolDefinitions.length + 4);
    expect(tools.map((x) => x.name)).toEqual(
      expect.arrayContaining(['check_in_order', 'check_out_order', 'extend_order', 'arrange_room'])
    );
    const desc = getOverseasToolDescription('query_today_orders', profile.locale);
    expect(desc && desc.length > 10).toBe(true);
  });

  it('pre-arrival / in-house / pre-departure / today board', async () => {
    const args = { pageNum: 1, pageSize: 5 };
    const a = await queryPreArrivalOrdersOverseas(args, context);
    const b = await queryInHouseOrdersOverseas(args, context);
    const c = await queryPreDepartureOrdersOverseas(args, context);
    const d = await queryTodayOrdersOverseas(args, context);
    for (const r of [a, b, c, d]) {
      expect(r.isError).toBeFalsy();
      expect(textOf(r).length).toBeGreaterThan(5);
    }
    expect(textOf(a)).toContain(t(context.regionProfile!.locale, 'title.preArrival'));
    expect(textOf(d)).toContain(t(context.regionProfile!.locale, 'title.todayOrders'));
  }, 60000);

  it('this-week date range', async () => {
    const r = await queryOrdersByDateRangeOverseas(
      { timeRange: 'this_week', pageNum: 1, pageSize: 5 },
      context
    );
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain(t(context.regionProfile!.locale, 'title.dateRange'));
  }, 30000);

  it('order details includes guest label', async () => {
    const r = await getOrderDetailsOverseas({ orderId: sampleOrder }, context);
    expect(r.isError).toBeFalsy();
    const text = textOf(r);
    expect(text).toContain(t(context.regionProfile!.locale, 'label.guest'));
    expect(text).toContain(String(sampleOrder).slice(0, 6));
  }, 30000);

  it('today rooms and this-week calendar / prices / ops', async () => {
    const rooms = await queryTodayRoomStatusOverseas({}, context);
    const cal = await queryRoomStatusNewOverseas({ timeRange: 'this_week' }, context);
    const prices = await queryRoomPricesOverseas({ timeRange: 'this_week' }, context);
    const ops = await queryOperationalDataOverseas({ timeRange: 'this_week' }, context);
    for (const r of [rooms, cal, prices, ops]) {
      expect(r.isError).toBeFalsy();
      expect(textOf(r).length).toBeGreaterThan(20);
    }
    expect(textOf(ops)).not.toMatch(/nightAudit\/page/);
  }, 90000);

  it('check-in preview asks for confirm in store language', async () => {
    const r = await checkInOrderOverseas(
      { orderDetailIds: ['0'], orderId: sampleOrder },
      context
    );
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain(t(context.regionProfile!.locale, 'confirm.need'));
  }, 30000);

  it('fake orderId and missing params stay friendly in store language', async () => {
    const locale = context.regionProfile!.locale;
    let fake: ToolResult;
    try {
      fake = await getOrderDetailsOverseas({ orderId: 'not-a-real-order' }, context);
    } catch (error) {
      fake = handleToolError(error, context);
    }
    expect(fake.isError).toBe(true);
    expect(textOf(fake)).toContain(t(locale, 'error.orderNotFound'));
    expect(textOf(fake)).not.toMatch(/-32603|Param error/i);

    let missing: ToolResult;
    try {
      missing = await checkInOrderOverseas({}, context);
    } catch (error) {
      missing = handleToolError(error, context);
    }
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain(t(locale, 'error.params'));
    expect(textOf(missing)).not.toContain(t(locale, 'error.internal'));
  }, 30000);

  it('prices use English channel names and rooms label cleanState 0/2', async () => {
    const prices = await queryRoomPricesOverseas({ timeRange: 'this_week' }, context);
    const rooms = await queryTodayRoomStatusOverseas({}, context);
    const priceText = textOf(prices);
    const roomText = textOf(rooms);
    expect(prices.isError).toBeFalsy();
    expect(rooms.isError).toBeFalsy();
    expect(priceText).not.toMatch(/爱彼迎|携程国际/);
    expect(priceText).toMatch(/Airbnb|Booking\.com|Agoda|Trip\.com/);
    expect(roomText).not.toMatch(/"cleanStateLabel": "[02]"/);
  }, 60000);
});
