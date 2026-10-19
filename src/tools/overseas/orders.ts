import type { ToolContext, ToolResult } from '../../types/mcp.js';
import {
  apiDateToYmd,
  channelDisplayName,
  detailStateLabel,
  extractPage,
  formatApiDate,
  formatFen,
  formatYmdByPattern,
  getLastWeekRange,
  getThisWeekRange,
  getTodayYmd,
  hudsonPost,
  inHouseWindow,
  isHighlightWeekend,
  profileOf,
  requireCampId,
  t,
  toZoneStartMs,
} from '../../region/index.js';
import { MCPError, ErrorCode, isOrderNotFoundError } from '../../utils/errorHandler.js';

export interface OverseasOrderRow {
  orderDetailId?: number | string;
  orderId?: number | string;
  orderChannelId?: number | string;
  channelId?: number | string;
  outOrderId?: string;
  orderState?: number;
  orderDetailState?: number;
  roomCategoryName?: string;
  roomName?: string;
  numberOfGuest?: number;
  guestName?: string;
  guestMobile?: string;
  guestEmail?: string;
  bookedTime?: unknown;
  checkInTime?: unknown;
  checkOutTime?: unknown;
  accommodationFare?: number;
  commission?: number;
  paid?: number;
  includeCommissionRoomPrice?: number;
  reduceCommissionRoomPrice?: number;
  commissionPrice?: number;
  nights?: number;
}

export async function fetchOverseasOrderPage(
  context: ToolContext,
  params: {
    dateTimeSearchType: number;
    startDate: string;
    endDate: string;
    orderDetailStates?: number[];
    searchKey?: string;
    pageNum: number;
    pageSize: number;
  }
): Promise<{ list: OverseasOrderRow[]; total: number }> {
  const campId = requireCampId(context);
  const tz = profileOf(context).ianaTimeZone;
  // Hudson BnbOrderDetailsPageGetRequest：startDate/endDate 均需当日 0 点（@BeginOfDay）。
  // 传日末时间戳会触发 date 联合校验（date:trigger union validation / 触发联合验证）。
  const data = await hudsonPost<unknown>(
    context,
    '/bnbOrderDetails/page/get',
    {
      campId,
      searchKey: params.searchKey || undefined,
      dateTimeSearchType: params.dateTimeSearchType,
      startDate: toZoneStartMs(params.startDate, tz),
      endDate: toZoneStartMs(params.endDate, tz),
      orderDetailStates: params.orderDetailStates,
      pageNum: params.pageNum,
      pageSize: params.pageSize,
    },
    'order list',
    'orders'
  );
  const page = extractPage<OverseasOrderRow>(data);
  return {
    list: page.list,
    total: page.total,
  };
}

function pickGuest(row: OverseasOrderRow): string {
  return String(row.guestName || '').trim() || '-';
}

export function formatOverseasOrderList(
  context: ToolContext,
  title: string,
  list: OverseasOrderRow[],
  total: number,
  pageNum: number,
  pageSize: number
): string {
  const profile = profileOf(context);
  const locale = profile.locale;
  const lines: string[] = [
    title,
    `${profile.locale}｜${profile.currency}｜${profile.ianaTimeZone}`,
    `${t(locale, 'label.total')}：${total}；${t(locale, 'label.page')}：${pageNum}；${t(locale, 'label.returned')}：${list.length}（pageSize=${pageSize}）`,
  ];
  if (!list.length) {
    lines.push(t(locale, 'label.empty'));
    return lines.join('\n');
  }

  for (const [idx, order] of list.entries()) {
    const checkInYmd = apiDateToYmd(order.checkInTime, profile.ianaTimeZone);
    const weekend =
      checkInYmd && isHighlightWeekend(checkInYmd, profile.highlightWeekends)
        ? `｜${t(locale, 'label.weekend')}`
        : '';
    const stay = `${formatApiDate(order.checkInTime, profile.ianaTimeZone)} ~ ${formatApiDate(order.checkOutTime, profile.ianaTimeZone)}`;
    lines.push(
      `${idx + 1}. ${t(locale, 'label.orderId')}：${order.orderId ?? '-'}｜${t(locale, 'label.detailId')}：${order.orderDetailId ?? '-'}｜` +
        `${t(locale, 'label.guest')}：${pickGuest(order)}｜${t(locale, 'label.channel')}：${channelDisplayName(order.orderChannelId ?? order.channelId)}｜` +
        `${t(locale, 'label.roomType')}：${order.roomCategoryName || '-'}｜${t(locale, 'label.room')}：${order.roomName || '-'}｜` +
        `${t(locale, 'label.stay')}：${stay}｜${t(locale, 'label.nights')}：${order.nights ?? '-'}｜` +
        `${detailStateLabel(locale, order.orderDetailState)}｜` +
        `${t(locale, 'label.netFare')}：${formatFen(order.reduceCommissionRoomPrice ?? order.accommodationFare, profile.currency)}｜` +
        `${t(locale, 'label.commission')}：${formatFen(order.commissionPrice ?? order.commission, profile.currency)}｜` +
        `${t(locale, 'label.paid')}：${formatFen(order.paid, profile.currency)}${weekend}`
    );
  }
  return lines.join('\n');
}

function resolveDateRange(
  context: ToolContext,
  args: {
    startDate?: string;
    endDate?: string;
    timeRange?: 'this_week' | 'last_week';
    date?: string;
  }
): { startDate: string; endDate: string } {
  const tz = profileOf(context).ianaTimeZone;
  const today = getTodayYmd(tz);
  if (args.timeRange === 'this_week') {
    const r = getThisWeekRange(args.date ?? today);
    return { startDate: r.start, endDate: r.end };
  }
  if (args.timeRange === 'last_week') {
    const r = getLastWeekRange(args.date ?? today);
    return { startDate: r.start, endDate: r.end };
  }
  const s = args.startDate;
  const e = args.endDate;
  if (!s && !e) return { startDate: today, endDate: today };
  if (s && !e) return { startDate: s, endDate: s };
  if (!s && e) return { startDate: e, endDate: e };
  return s! > e! ? { startDate: e!, endDate: s! } : { startDate: s!, endDate: e! };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export async function queryPreArrivalOrdersOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const today = getTodayYmd(profile.ianaTimeZone);
  const pageNum = Number(args.pageNum) || 1;
  const pageSize = Number(args.pageSize) || 10;
  const data = await fetchOverseasOrderPage(context, {
    dateTimeSearchType: 1,
    startDate: today,
    endDate: today,
    orderDetailStates: [1],
    searchKey: String(args.keyword || ''),
    pageNum,
    pageSize,
  });
  context.logger.info('Overseas pre-arrival orders', { total: data.total, today });
  return textResult(
    formatOverseasOrderList(context, t(profile.locale, 'title.preArrival'), data.list, data.total, pageNum, pageSize)
  );
}

export async function queryInHouseOrdersOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const today = getTodayYmd(profile.ianaTimeZone);
  const win = inHouseWindow(profile.ianaTimeZone);
  const pageNum = Number(args.pageNum) || 1;
  const pageSize = Number(args.pageSize) || 10;
  const raw = await fetchOverseasOrderPage(context, {
    dateTimeSearchType: 1,
    startDate: win.start,
    endDate: win.end,
    orderDetailStates: [2],
    searchKey: String(args.keyword || ''),
    pageNum,
    pageSize,
  });
  const list = raw.list.filter((row) => {
    const out = apiDateToYmd(row.checkOutTime, profile.ianaTimeZone);
    return !out || out > today;
  });
  context.logger.info('Overseas in-house orders', { fetched: raw.list.length, filtered: list.length, today });
  return textResult(
    formatOverseasOrderList(context, t(profile.locale, 'title.inHouse'), list, list.length, pageNum, pageSize)
  );
}

export async function queryPreDepartureOrdersOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const today = getTodayYmd(profile.ianaTimeZone);
  const pageNum = Number(args.pageNum) || 1;
  const pageSize = Number(args.pageSize) || 10;
  const data = await fetchOverseasOrderPage(context, {
    dateTimeSearchType: 2,
    startDate: today,
    endDate: today,
    orderDetailStates: [2],
    searchKey: String(args.keyword || ''),
    pageNum,
    pageSize,
  });
  context.logger.info('Overseas pre-departure orders', { total: data.total, today });
  return textResult(
    formatOverseasOrderList(context, t(profile.locale, 'title.preDeparture'), data.list, data.total, pageNum, pageSize)
  );
}

export async function queryTodayOrdersOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const today = getTodayYmd(profile.ianaTimeZone);
  const win = inHouseWindow(profile.ianaTimeZone);
  const pageNum = Number(args.pageNum) || 1;
  const pageSize = Number(args.pageSize) || 10;
  const keyword = String(args.keyword || '');
  const [preArrival, inHouseRaw, preDeparture] = await Promise.all([
    fetchOverseasOrderPage(context, {
      dateTimeSearchType: 1,
      startDate: today,
      endDate: today,
      orderDetailStates: [1],
      searchKey: keyword,
      pageNum,
      pageSize,
    }),
    fetchOverseasOrderPage(context, {
      dateTimeSearchType: 1,
      startDate: win.start,
      endDate: win.end,
      orderDetailStates: [2],
      searchKey: keyword,
      pageNum,
      pageSize,
    }),
    fetchOverseasOrderPage(context, {
      dateTimeSearchType: 2,
      startDate: today,
      endDate: today,
      orderDetailStates: [2],
      searchKey: keyword,
      pageNum,
      pageSize,
    }),
  ]);
  const inHouseList = inHouseRaw.list.filter((row) => {
    const out = apiDateToYmd(row.checkOutTime, profile.ianaTimeZone);
    return !out || out > today;
  });
  const header = [
    t(profile.locale, 'title.todayOrders'),
    `${t(profile.locale, 'label.grandTotal')}：${preArrival.total + inHouseList.length + preDeparture.total}`,
    '',
  ].join('\n');
  return textResult(
    [
      header,
      formatOverseasOrderList(context, t(profile.locale, 'title.preArrival'), preArrival.list, preArrival.total, pageNum, pageSize),
      '',
      formatOverseasOrderList(context, t(profile.locale, 'title.inHouse'), inHouseList, inHouseList.length, pageNum, pageSize),
      '',
      formatOverseasOrderList(
        context,
        t(profile.locale, 'title.preDeparture'),
        preDeparture.list,
        preDeparture.total,
        pageNum,
        pageSize
      ),
    ].join('\n')
  );
}

export async function queryOrdersByDateRangeOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const range = resolveDateRange(context, {
    startDate: args.startDate as string | undefined,
    endDate: args.endDate as string | undefined,
    timeRange: args.timeRange as 'this_week' | 'last_week' | undefined,
    date: args.date as string | undefined,
  });
  const pageNum = Number(args.pageNum) || 1;
  const pageSize = Number(args.pageSize) || 10;
  const data = await fetchOverseasOrderPage(context, {
    dateTimeSearchType: 1,
    startDate: range.startDate,
    endDate: range.endDate,
    pageNum,
    pageSize,
  });
  const rangeLabel =
    range.startDate === range.endDate
      ? formatYmdByPattern(range.startDate, profile.dateFormat)
      : `${formatYmdByPattern(range.startDate, profile.dateFormat)} ~ ${formatYmdByPattern(range.endDate, profile.dateFormat)}`;
  context.logger.info('Overseas orders by date range', { ...range, total: data.total });
  return textResult(
    formatOverseasOrderList(
      context,
      `${t(profile.locale, 'title.dateRange')}：${rangeLabel}`,
      data.list,
      data.total,
      pageNum,
      pageSize
    )
  );
}

export async function getOrderDetailsOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const campId = requireCampId(context);
  const orderId = String(args.orderId ?? '').trim();
  if (!orderId) {
    throw new MCPError(ErrorCode.MISSING_PARAMS, 'orderId is required');
  }
  let data: Record<string, unknown>;
  try {
    data = await hudsonPost<Record<string, unknown>>(
      context,
      '/bnbOrder/get',
      { campId, orderId },
      'order details',
      'orders'
    );
  } catch (error) {
    if (isOrderNotFoundError(error)) {
      throw new MCPError(ErrorCode.API_NOT_FOUND, 'Order not found', {
        domain: 'order_detail',
        source: '路客云AI',
      });
    }
    throw error;
  }
  if (data == null || data.orderId == null) {
    throw new MCPError(ErrorCode.API_NOT_FOUND, 'Order not found', {
      domain: 'order_detail',
      source: '路客云AI',
    });
  }
  const guest = String(data.guestName || '').trim() || '-';
  const safe = data;
  const details = Array.isArray(data.orderDetails) ? (data.orderDetails as Record<string, unknown>[]) : [];
  const first = details[0] || {};
  const summary = [
    t(profile.locale, 'title.orderDetail'),
    `${profile.locale}｜${profile.currency}｜${profile.ianaTimeZone}`,
    t(profile.locale, 'guest.mustShow'),
    `${t(profile.locale, 'label.orderId')}：${data.orderId}`,
    `${t(profile.locale, 'label.guest')}：${guest}`,
    `${t(profile.locale, 'label.channel')}：${channelDisplayName(data.orderChannelId ?? data.channelId)}`,
    `${t(profile.locale, 'label.stay')}：${formatApiDate(first.checkInDate ?? first.expectCheckInTime, profile.ianaTimeZone)} ~ ${formatApiDate(first.checkOutDate ?? first.expectCheckOutTime, profile.ianaTimeZone)}`,
    `${t(profile.locale, 'label.room')}：${first.roomName || '-'}`,
    `${t(profile.locale, 'label.netFare')}：${formatFen(Number(data.reduceCommissionRoomPrice), profile.currency)}`,
    `${t(profile.locale, 'label.commission')}：${formatFen(Number(data.commissionPrice), profile.currency)}`,
    '',
    JSON.stringify(safe, null, 2),
  ].join('\n');
  return textResult(summary);
}
