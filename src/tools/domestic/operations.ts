import type { ToolContext, ToolResult } from '../../types/mcp.js';
import { createHash } from 'node:crypto';
import { domesticChannelLaunch } from './channelLaunch.js';
import { addDaysYmd, apiDateToYmd, requireCampId } from '../../region/index.js';
import { createSuccessResult, ErrorCode, MCPError } from '../../utils/errorHandler.js';
import { dateRange, id, integer, invalid, post, previewOrExecute, responseId, rows, ymd, type Row } from '../overseas/mutationPreview.js';

function domestic(context: ToolContext): void {
  if (context.regionProfile?.region !== 'cn') invalid('This operation is only available for domestic properties');
  requireCampId(context);
}

function exact(value: unknown, expected: string): boolean {
  return responseId(value) === expected;
}

async function settleDomesticReads(
  checks: Array<{ path: string; value: Promise<Row> }>,
  errorCode: string,
  action: string
): Promise<Row[]> {
  const results = await Promise.allSettled(checks.map((check) => check.value));
  const failures = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [];
    const error = result.reason;
    const details = error instanceof MCPError && error.details && typeof error.details === 'object'
      ? error.details as Record<string, unknown> : {};
    const code = typeof details.errorCode === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(details.errorCode)
      ? details.errorCode : error instanceof MCPError ? error.code : 'UNAVAILABLE';
    return [`${checks[index].path}: ${code}`];
  });
  if (failures.length) throw new MCPError(ErrorCode.API_ERROR,
    `${action} read checks failed`, {
      errorCode, errorDetail: failures.join('; '), action,
    });
  return results.map((result) => (result as PromiseFulfilledResult<Row>).value);
}

function date(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return ymd(value.slice(0, 10), 'date');
  const converted = apiDateToYmd(value, 'Asia/Shanghai');
  if (!converted) invalid('Backend date is missing or invalid');
  return ymd(converted, 'date');
}

async function order(context: ToolContext, orderId: string): Promise<Row> {
  const data = await post(context, '/order/get', { orderId });
  if (!exact(data.orderId, orderId) || !String(data.guestName ?? '').trim() || !Array.isArray(data.orderDetails))
    invalid('Order identity is incomplete; query the exact order before modifying it');
  return data;
}

function detail(data: Row, orderDetailId: string): Row {
  const found = rows(data.orderDetails).find((row) => exact(row.orderDetailId, orderDetailId));
  if (!found) invalid('Order detail does not belong to this order');
  return found;
}

function orderSummary(data: Row, selected: Row): Row {
  return {
    orderId: responseId(data.orderId),
    orderDetailId: responseId(selected.orderDetailId),
    guestName: String(data.guestName).trim(),
    roomCategoryId: responseId(selected.roomCategoryId),
    roomId: responseId(selected.roomId),
    roomName: selected.roomName ?? null,
    checkInDate: date(selected.checkInDateStr ?? selected.checkInDate),
    checkOutDate: date(selected.checkOutDateStr ?? selected.checkOutDate),
    orderDetailState: selected.orderDetailState,
  };
}

export async function domesticCheckInOut(args: Record<string, unknown>, context: ToolContext, kind: 'check_in_order' | 'check_out_order'): Promise<ToolResult> {
  domestic(context);
  const orderId = id(args.orderId, 'orderId');
  const detailIds = args.orderDetailIds;
  if (!Array.isArray(detailIds) || detailIds.length !== 1) invalid('Exactly one orderDetailId is required');
  const orderDetailId = id(detailIds[0], 'orderDetailId');
  const data = await order(context, orderId);
  const selected = detail(data, orderDetailId);
  const summary = orderSummary(data, selected);
  if (kind === 'check_in_order') {
    if (Number(selected.orderDetailState) !== 1) invalid('Only an awaiting-check-in order detail can be checked in');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (Number(data.isLt) !== 1 && String(summary.checkInDate) > today)
      invalid('Early check-in requires changing the booking dates in the PC first');
  }
  if (kind === 'check_out_order') {
    if (Number(selected.orderDetailState) !== 2)
      invalid('Only an in-house order detail can be checked out');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (String(summary.checkOutDate) > today)
      invalid('Early checkout may require repricing or a deposit refund; use the PC');
  }
  const payload = kind === 'check_in_order'
    ? { campId: requireCampId(context), orderDetailIds: [orderDetailId] }
    : { campId: requireCampId(context), orderDetailCheckOuts: [{ orderDetailId }] };
  return previewOrExecute(args, context, kind,
    kind === 'check_in_order' ? '/orderDetails/checkIn' : '/orderDetails/checkOut/v2',
    payload, summary, summary, () => order(context, orderId));
}

/** Whole-order cancellation only for unpaid, unoccupied domestic manual orders. */
export async function domesticCancelOrder(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  domestic(context);
  const orderId = id(args.orderId, 'orderId');
  const data = await order(context, orderId);
  const collection = data.roomPriceCollectionInfo as Row | undefined;
  const deposit = data.depositGetView as Row | undefined;
  if (!exact(data.channelId, '0') || Number(data.isLt) !== 0)
    invalid('Only domestic manual short-stay orders may be cancelled; use the PC for OTA or long-stay orders');
  const details = rows(data.orderDetails);
  if (!details.length || details.some((row) => Number(row.orderDetailState) !== 1))
    invalid('Every order detail must be awaiting check-in; cancellation of occupied or final orders requires the PC');
  if (!collection || collection.receivedPrice !== 0 || Number(collection.isOnlinePayment ?? 0) !== 0 ||
    !Array.isArray(data.paymentOrders) || data.paymentOrders.length ||
    !Array.isArray(data.refundOrders) || data.refundOrders.length ||
    (deposit && (Number(deposit.depositPayPrice ?? 0) !== 0 || deposit.depositPaymentOrder)))
    invalid('Cancellation with payments, refunds, deposits or incomplete financial data requires the PC');
  const summary = { orderId, guestName: data.guestName, totalPriceFen: data.totalPrice,
    details: details.map((row) => orderSummary(data, row)), receivedPriceFen: 0,
    action: 'Cancel the entire order and release all assigned rooms; no refund is requested.' };
  return previewOrExecute(args, context, 'cancel_order', '/order/cancel',
    { campId: requireCampId(context), orderId }, summary, summary, () => order(context, orderId));
}

export async function domesticArrangeRoom(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  domestic(context);
  const orderId = id(args.orderId, 'orderId');
  const orderDetailId = id(args.orderDetailId, 'orderDetailId');
  const roomId = id(args.roomId, 'roomId');
  const data = await order(context, orderId);
  const selected = detail(data, orderDetailId);
  const summary = orderSummary(data, selected);
  if (responseId(selected.roomId) === roomId) invalid('Target room is already assigned to this order detail');
  const available = await room(context, summary.checkInDate as string, summary.checkOutDate as string, roomId);
  if (available.roomCategoryId !== summary.roomCategoryId)
    invalid('Target room belongs to another room category; use the PC to change room category');
  await requireVacancy(context, roomId, summary.checkInDate as string, summary.checkOutDate as string);
  // Hudson treats orderId as the long-stay bulk-arrangement path. Ordinary
  // orders must use the single-detail path even when the parent order is known.
  const payload = { campId: requireCampId(context), orderDetailId,
    roomCategoryId: available.roomCategoryId, roomId, isAutoArrangeRoom: 0 };
  return previewOrExecute(args, context, 'arrange_room', '/orderDetail/arrangeRoom', payload,
    { ...summary, targetRoomName: available.roomName, targetRoomId: roomId },
    { ...summary, targetRoomName: available.roomName, targetRoomId: roomId },
    () => order(context, orderId));
}

export async function domesticExtendOrder(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  domestic(context);
  const orderId = id(args.previousOrderId, 'previousOrderId');
  const roomId = id(args.roomId, 'roomId');
  const nights = integer(args.nights, 'nights', 1, 90);
  // Domestic Hudson requires an explicit price. Never derive a payable amount from overseas rules.
  const price = integer(args.priceFen, 'priceFen', 0, 100_000_000);
  const data = await order(context, orderId);
  const matches = rows(data.orderDetails).filter((row) => exact(row.roomId, roomId));
  if (matches.length !== 1) invalid('Cannot uniquely identify the occupied room detail');
  const selected = matches[0];
  const previous = orderSummary(data, selected);
  const checkOutDate = addDaysYmd(previous.checkOutDate as string, nights);
  await room(context, previous.checkOutDate as string, checkOutDate, roomId);
  await requireVacancy(context, roomId, previous.checkOutDate as string, checkOutDate);
  const payload = { campId: requireCampId(context), orderDetailExtends: [{
    orderDetailId: previous.orderDetailId, roomCategoryId: previous.roomCategoryId, roomId,
    checkOutDate, price,
  }] };
  return previewOrExecute(args, context, 'extend_order', '/orderDetails/extendStay', payload,
    { ...previous, newCheckOutDate: checkOutDate, extensionPriceFen: price },
    { ...previous, newCheckOutDate: checkOutDate, extensionPriceFen: price },
    () => order(context, orderId));
}

type LocatedRoom = { roomCategoryId: string; roomCategoryName: string; roomName: string; room: Row };
async function room(context: ToolContext, startDate: string, endDate: string, roomId: string): Promise<LocatedRoom> {
  dateRange(startDate, endDate);
  // This lookup establishes room ownership and category only. Date-specific
  // vacancy and reservations are checked by the operation before preview.
  return todayRoom(context, roomId);
}

async function todayRoom(context: ToolContext, roomId: string): Promise<LocatedRoom> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${today}T00:00:00+08:00`).getTime();
  const data = await post(context, '/roomStatusesToday/get', {
    date, channelIds: null, roomCategoryGroupIds: [], roomCategoryIds: [], poiIds: [],
    isShowIdleClean: 0, isShowIdleDirty: 0, isShowLiveClean: 0, isShowLiveDirty: 0,
    isShowOcc: 0, isShowAll: 1, isAvailability: null, roomCategoryType: null,
  });
  for (const category of rows(data.roomCategories)) {
    const found = rows(category.rooms).find((item) => exact(item.roomId, roomId));
    if (found) return {
      roomCategoryId: responseId(category.roomCategoryId),
      roomCategoryName: String(category.roomCategoryName ?? ''),
      roomName: String(found.roomName ?? ''), room: { ...found, d: found.isDirty },
    };
  }
  invalid('Room does not belong to this property or is not available in today room status');
}

async function requireVacancy(context: ToolContext, roomId: string, checkInDate: string, checkOutDate: string): Promise<Row> {
  const checked = await post(context, '/roomStatuses/check', { roomChecks: [{
    roomId, saleType: 1, checkInDate, checkOutDate,
  }] });
  const views = rows(checked.roomStatusesCheckViews);
  if (views.length !== 1 || !exact(views[0].roomId, roomId) || Number(views[0].isAvailability) !== 1)
    invalid('Target room is not confirmed available for all selected nights');
  return views[0];
}

export async function domesticCleanState(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  domestic(context);
  const roomId = id(args.roomId, 'roomId');
  const cleanStates: Record<string, number> = { dirty: 1, clean: 3 };
  const cleanState = typeof args.cleanState === 'string'
    ? cleanStates[args.cleanState] : args.cleanState;
  if (cleanState !== 1 && cleanState !== 3)
    invalid('Domestic PC supports only dirty (1) or clean (3)');
  // Domestic PC displays isDirty, not the separate overseas/Bnb clean_state.
  const isDirty = cleanState === 3 ? 0 : 1;
  const located = await todayRoom(context, roomId);
  const previousIsDirty = integer(located.room.isDirty, 'isDirty', 0, 1);
  const summary = { roomId, roomName: located.roomName, roomCategoryId: located.roomCategoryId,
    previousCleanState: previousIsDirty === 0 ? 3 : 1, previousIsDirty, cleanState, isDirty };
  const payload = { campId: requireCampId(context),
    ...(isDirty === 0 ? { cleanRoomIds: [roomId] } : { dirtyRoomIds: [roomId] }) };
  return previewOrExecute(args, context, 'update_room_clean_state', '/rooms/cleanOrDirty',
    payload, summary, summary,
    async () => {
      const updated = await todayRoom(context, roomId);
      const actualIsDirty = integer(updated.room.isDirty, 'isDirty', 0, 1);
      return { roomId, cleanState: actualIsDirty === 0 ? 3 : 1, isDirty: actualIsDirty,
        matchesRequested: actualIsDirty === isDirty, verification: 'domestic_pc_is_dirty' };
    }, 'PUT');
}

export async function domesticAvailability(args: Record<string, unknown>, context: ToolContext, action: 'close_rooms' | 'open_rooms'): Promise<ToolResult> {
  domestic(context);
  const roomId = id(args.roomId, 'roomId');
  const range = dateRange(args.startDate, args.endDate);
  const located = await room(context, range.from, range.to, roomId);
  const query = { startDate: range.from, days: range.days - 1 };
  const [occ, block, orders] = await Promise.all([
    post(context, '/roomStatuses/occ/get', query),
    post(context, '/roomStatuses/block/get', query),
    post(context, '/roomStatuses/orderDetails/get', query),
  ]);
  const dates = Array.from({ length: range.days }, (_, index) => addDaysYmd(range.from, index));
  const matchDate = (item: Row) => dates.includes(date(item.d));
  const reservations = rows(orders.list).filter((item) => exact(item.ri, roomId) &&
    // The calendar returns a row for every booked date.
    dates.some((day) => day >= date(item.cid) && day < date(item.cod)));
  if (reservations.length) invalid('A booking intersects this room and date range');
  const occupied = rows(occ.list).filter((item) => exact(item.ri, roomId) && matchDate(item));
  const blocked = rows(block.list).filter((item) => exact(item.ri, roomId) && matchDate(item));
  let method: 'POST' | 'DELETE';
  let endpoint: string;
  let selected: string[];
  let occupationType: number | undefined;
  if (action === 'close_rooms') {
    if (occupied.length || blocked.length) invalid('Some selected dates are already closed or blocked');
    selected = dates;
    occupationType = integer(args.type ?? 1, 'type', 1, 5);
    if (![1, 4, 5].includes(occupationType)) invalid('Unsupported manual closure type');
    method = 'POST'; endpoint = '/roomCalendar/occupation/v2';
  } else {
    if (blocked.length) invalid('This range includes room-category blocks; release those in the PC first');
    if (occupied.length !== dates.length || occupied.some((item) => ![1, 4, 5].includes(Number(item.ot))))
      invalid('Only a fully selected manual closure may be reopened');
    selected = dates;
    method = 'DELETE'; endpoint = '/roomCalendar/releaseOccupation/v2';
  }
  const remark = args.remark === undefined ? undefined : String(args.remark).slice(0, 500);
  const payload = { campId: requireCampId(context), operationDataBeans: [{
    channelId: 0, roomCategoryId: located.roomCategoryId, roomId, dates: selected,
    ...(occupationType === undefined ? {} : { occupationType }), ...(remark ? { remark } : {}),
  }] };
  const summary = { roomId, roomName: located.roomName, roomCategoryId: located.roomCategoryId,
    startDate: range.from, endDate: range.to, action, occupationType };
  return previewOrExecute(args, context, action, endpoint, payload, summary, summary,
    () => post(context, '/roomStatuses/occ/get', query), method);
}

export async function domesticQueryChannel(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  domestic(context);
  const pageNum = integer(args.pageNum ?? 1, 'pageNum', 1, 10000);
  const channelId = id(args.channelId, 'channelId');
  const [accounts, properties, categories] = await settleDomesticReads([
    { path: '/account/page/get', value: post(context, '/account/page/get', { pageNum, pageSize: 50, channelId }) },
    { path: '/poi/page/get', value: post(context, '/poi/page/get', { pageNum, pageSize: 50, channelId }) },
    { path: '/channelRoomCategories/page/get/v2', value: post(context, '/channelRoomCategories/page/get/v2',
      { pageNum, pageSize: 50, channelIds: [channelId] }) },
  ], 'CN_CHANNEL_QUERY_REJECTED', 'query_channel_connection');
  return createSuccessResult({ accounts, properties, categories });
}

export async function domesticConnectChannelPoi(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  domestic(context);
  const channelId = id(args.channelId, 'channelId');
  const accountId = id(args.accountId, 'accountId');
  const outPoiId = id(args.outPoiId, 'outPoiId');
  const [accounts, properties] = await Promise.all([
    post(context, '/account/page/get', { channelId, pageNum: 1, pageSize: 100 }),
    post(context, '/poi/page/get', { pageNum: 1, pageSize: 100, channelId }),
  ]);
  if (!Array.isArray(accounts.list) || !Array.isArray(properties.list) ||
    rows(accounts.list).length >= 100 || rows(properties.list).length >= 100 ||
    Number(accounts.total ?? 0) > 100 || Number(properties.total ?? 0) > 100)
    invalid('Channel account/property list is incomplete; check the full list in the PC');
  const account = rows(accounts.list).find((item) => exact(item.accountId, accountId) && exact(item.channelId, channelId));
  if (!account) invalid('Channel account was not verified for this property');
  if (rows(properties.list).some((item) => exact(item.accountId, accountId) && responseId(item.outPoiId) === outPoiId))
    invalid('External property is already connected; query it instead of creating a duplicate');
  const payload = { campId: requireCampId(context), accountId, channelId, outPoiId };
  const summary = { channelId, channelName: account.channelName, accountId,
    accountName: account.username, outPoiId, existingPropertiesChecked: rows(properties.list).length };
  return previewOrExecute(args, context, 'connect_channel_poi', '/poi/createChannelPoi',
    payload, summary, summary, () => post(context, '/poi/page/get', { pageNum: 1, pageSize: 100, channelId }));
}

async function channelBaseline(context: ToolContext, channelId: string): Promise<Row> {
  const [accounts, properties] = await Promise.all([
    post(context, '/account/page/get', { channelId, pageNum: 1, pageSize: 100 }),
    post(context, '/poi/page/get', { pageNum: 1, pageSize: 100, channelId }),
  ]);
  if (!Array.isArray(accounts.list) || !Array.isArray(properties.list))
    invalid('Channel account/property listing is incomplete');
  if (rows(accounts.list).length >= 100 || rows(properties.list).length >= 100 ||
    Number(accounts.total ?? 0) > 100 || Number(properties.total ?? 0) > 100)
    invalid('Channel has more than 100 accounts/properties; use the PC connection workflow');
  const accountSummary = rows(accounts.list).map((item) => ({
    accountId: responseId(item.accountId), channelId: responseId(item.channelId),
    authorizeStatus: item.authorizeStatus, isTokenExpired: item.isTokenExpired,
  })).sort((a, b) => a.accountId.localeCompare(b.accountId));
  const propertySummary = rows(properties.list).map((item) => ({
    poiId: responseId(item.poiId), accountId: responseId(item.accountId),
    outPoiId: responseId(item.outPoiId), parentPoiId: responseId(item.parentPoiId),
  })).sort((a, b) => a.poiId.localeCompare(b.poiId));
  const baselineToken = createHash('sha256').update(JSON.stringify({
    campId: requireCampId(context), channelId, accountSummary, propertySummary,
  })).digest('hex');
  return { channelId, baselineToken, accounts: accountSummary, properties: propertySummary };
}

export async function domesticStartChannelConnection(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  domestic(context);
  const channelId = id(args.channelId, 'channelId');
  const baseline = await channelBaseline(context, channelId);
  const launch = await domesticChannelLaunch(context, channelId);
  return createSuccessResult({ status: 'awaiting_pc_authorization',
    ...baseline, ...launch,
    next: 'Open openUrl in the client browser (or show it as a clickable link). In the domestic PC page, sign in if needed, verify the property, and click the requested channel authorization button. Keep channelId and the original baselineToken; after the user finishes, call cn_complete_channel_connection. Opening the page does not mean authorization or synchronization succeeded.',
  });
}

export async function domesticCompleteChannelConnection(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  domestic(context);
  const channelId = id(args.channelId, 'channelId');
  const baselineToken = id(args.baselineToken, 'baselineToken');
  if (!/^[0-9a-f]{64}$/.test(baselineToken)) invalid('Invalid baselineToken');
  const current = await channelBaseline(context, channelId);
  const changed = current.baselineToken !== baselineToken;
  return createSuccessResult({ status: changed ? 'changed_requires_review' : 'pending',
    changed, ...current,
    next: changed
      ? 'Account or property state changed. Review the authorization status and mappings in the returned data; do not infer that channel synchronization has finished.'
      : 'No account or property state change is visible yet. Keep the original baselineToken and check again after the PC workflow.',
  });
}

export async function domesticUpdateChannelPrices(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  return domesticPriceChanges(args, context, 'update_channel_prices',
    [{ roomCategoryProductId: args.roomCategoryProductId, amountFen: args.amountFen }], false);
}

export async function domesticBatchChannelPrices(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  return domesticPriceChanges(args, context, 'batch_update_channel_prices', rows(args.items), false);
}

export async function domesticUpdateCentralPrices(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  return domesticPriceChanges(args, context, 'update_central_prices', rows(args.items), true);
}

async function domesticPriceChanges(args: Record<string, unknown>, context: ToolContext,
  tool: string, items: Row[], central: boolean): Promise<ToolResult> {
  domestic(context);
  if (!items.length || items.length > 20) invalid('Specify between 1 and 20 price targets');
  const range = dateRange(args.startDate, args.endDate);
  if (range.days > 30) invalid('Domestic price changes are limited to 30 dates');
  const key = central ? 'roomCategoryId' : 'roomCategoryProductId';
  const targets = items.map((item) => ({ id: id(item[key], key), amountFen: integer(item.amountFen, 'amountFen', 10, 999_999_999) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(targets.map((target) => target.id)).size !== targets.length) invalid('Duplicate price target');
  const flags = args.validWeekDays ?? [1, 1, 1, 1, 1, 1, 1];
  if (!Array.isArray(flags) || flags.length !== 7 || flags.some((flag) => flag !== 0 && flag !== 1))
    invalid('validWeekDays must contain seven 0/1 flags');
  // Hutool DateUtil.dayOfWeek and PC: Sunday=1 through Saturday=7.
  const daysOfWeek = flags.flatMap((flag, index) => flag === 1 ? [index + 1] : []);
  const selectedDates = Array.from({ length: range.days }, (_, index) => addDaysYmd(range.from, index))
    .filter((day) => daysOfWeek.includes(new Date(day + 'T00:00:00Z').getUTCDay() + 1));
  if (!selectedDates.length) invalid('At least one date must match the selected weekdays');
  // The PC central calendar has its own DTO: roomStatusViews[].statusViews.
  // centralStatusViews in the channel calendar can be empty even for valid rates.
  const queryPath = central ? '/roomCategoryStatuses/central/get' : '/roomCategoryStatuses/roomCategory/channel/get';
  const query = { date: range.from, days: range.days, roomCategoryProductSaleType: 1,
    roomCategoryIds: central ? targets.map((target) => target.id) : [],
    roomCategoryGroupIds: [], channelIds: [], poiIds: [], pageNum: 1, pageSize: 100 };
  const data = await post(context, queryPath, query);
  const calendar = central ? data.roomStatusViews : data.roomCategoryInfos;
  if (!Array.isArray(calendar)) invalid('Price response is incomplete');
  const categories = rows(calendar);
  const page = data.pageX as Row | undefined;
  if (central && (categories.length >= 100 || Number(page?.total ?? data.total ?? 0) > 100 || page?.hasNextPage === true))
    invalid('Central price listing is incomplete; use the PC to review all linked channels');
  const changes = targets.map((target) => {
    const matches = central
      ? categories.filter((category) => exact(category.roomCategoryId, target.id)).map((category) => ({ category, product: category }))
      : categories.flatMap((category) => rows(category.roomCategoryStatuses)
        .filter((product) => exact(product.channelRoomCategoryProductId, target.id)).map((product) => ({ category, product })));
    if (matches.length !== 1) invalid('Rate target does not belong to this property/page or is ambiguous');
    const { category, product } = matches[0];
    if (Number(product.isCannotModify) === 1) invalid('Channel price is not editable');
    const channelRoomCategoryId = central ? target.id : responseId(product.channelRoomCategoryId);
    if (!channelRoomCategoryId) invalid('Channel room category is missing');
    if (central && !Array.isArray(category.channelRoomCategoryStatuses))
      invalid('Linked channel prices are incomplete');
    const current = rows(product.statusViews)
      .filter((cell) => selectedDates.includes(date(cell.date)));
    if (current.length !== selectedDates.length || new Set(current.map((cell) => date(cell.date))).size !== selectedDates.length)
      invalid('Current prices are incomplete; narrow the date range');
    return { roomCategoryId: responseId(category.roomCategoryId), channelRoomCategoryId,
      ...(central ? {} : { roomCategoryProductId: target.id, channelId: responseId(product.channelId) }),
      name: central ? category.roomCategoryName : product.channelRoomCategoryProductName,
      ...(central ? { linkedChannels: rows(category.channelRoomCategoryStatuses).map((row) => ({
        channelId: responseId(row.channelId), channelRoomCategoryId: responseId(row.channelRoomCategoryId),
        channelName: row.channelName, name: row.channelRoomCategoryName, express: row.express ?? null,
        expressType: row.expressType ?? null, expressValue: row.expressValue ?? null,
        currentPrices: rows(row.statusViews).filter((cell) => selectedDates.includes(date(cell.date)))
          .map((cell) => ({ date: date(cell.date), priceFen: cell.price })),
      })) } : {}),
      currentPrices: current.map((cell) => ({ date: date(cell.date), priceFen: cell.price })),
      newAmountFen: target.amountFen };
  });
  const summary = { ...(tool === 'update_channel_prices' ? changes[0] : {}), mode: central ? 'central' : 'channel', startDate: range.from, endDate: range.to,
    selectedDates, daysOfWeek, changes,
    ...(central ? { impact: 'Central price changes may propagate to linked channels according to Hudson pricing rules. Review the linked channels before confirming.' } : {}) };
  const payload = { campId: requireCampId(context), isCentralPrice: central ? 1 : 0,
    ...(central ? {} : { isUsedExpress: 0 }),
    channelRoomCategoryPrices: changes.map((change) => ({
      channelRoomCategoryId: change.channelRoomCategoryId,
      ...(!central ? { channelRoomCategoryProductId: change.roomCategoryProductId } : {}),
      calendarPrice: change.newAmountFen, priceUpdateType: 1,
      dateGroup: [{ startDate: range.from, endDate: range.to }], daysOfWeek,
    })) };
  return previewOrExecute(args, context, tool, '/roomCategoryPrice/calendarPrice/channelRoomCategory',
    payload, summary, summary, () => post(context, queryPath, query), 'PUT');
}

export async function domesticCreateManualOrder(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  domestic(context);
  const roomId = id(args.roomId, 'roomId');
  const roomCategoryId = id(args.roomCategoryId, 'roomCategoryId');
  const orderChannelId = id(args.orderChannelId, 'orderChannelId');
  const paymentWayId = id(args.paymentWayId, 'paymentWayId');
  const checkInDate = ymd(args.checkInDate, 'checkInDate');
  const checkOutDate = ymd(args.checkOutDate, 'checkOutDate');
  const nights = (Date.parse(checkOutDate) - Date.parse(checkInDate)) / 86400000;
  if (nights < 1 || nights > 90) invalid('Manual order must cover 1–90 nights');
  const guestName = typeof args.guestName === 'string' ? args.guestName.trim() : '';
  if (!guestName || guestName.length > 160) invalid('guestName is required');
  if (['infants', 'pets', 'paidFen', 'cleaningFeeFen', 'taxFen'].some((field) => Number(args[field] ?? 0) !== 0))
    invalid('Domestic single-room manual orders do not support pets, infant counts, collected payments, fees, or tax overrides');
  if (args.guestEmail !== undefined && String(args.guestEmail).trim())
    invalid('Domestic manual orders do not accept guestEmail; enter contact details in the PC');
  const guestMobile = args.guestMobile === undefined ? undefined : String(args.guestMobile).trim();
  if (guestMobile && guestMobile.length > 500) invalid('guestMobile is too long');
  const remark = args.note === undefined ? undefined : String(args.note).trim();
  if (remark && remark.length > 500) invalid('note is too long');
  const guestNum = integer(args.adults ?? 1, 'adults', 1, 100) + integer(args.children ?? 0, 'children', 0, 100);
  if (guestNum > 100) invalid('guestNum exceeds the domestic limit');
  const located = await room(context, checkInDate, checkOutDate, roomId);
  if (located.roomCategoryId !== roomCategoryId) invalid('Room category and room do not match');
  const [availability, channels, ways] = await settleDomesticReads([
    { path: '/roomStatuses/check', value: requireVacancy(context, roomId, checkInDate, checkOutDate) },
    { path: '/channels/get', value: post(context, '/channels/get', {}) },
    { path: '/paymentWays/get', value: post(context, '/paymentWays/get', {}) },
  ], 'CN_ORDER_PREFLIGHT_REJECTED', 'create_manual_order');
  if (!rows(channels.channels).some((channel) => exact(channel.channelId, orderChannelId) && Number(channel.isEnable) === 1))
    invalid('Selected order channel is unavailable for this property');
  if (!rows(ways.paymentWays).some((way) => exact(way.paymentWayId, paymentWayId) && Number(way.isEnable) === 1))
    invalid('Selected payment way is unavailable for this property');
  const quotedFen = integer(availability.price, 'quoted price', 0, 100_000_000);
  const priceFen = args.accommodationFareFen === undefined ? quotedFen
    : integer(args.accommodationFareFen, 'accommodationFareFen', 0, 100_000_000);
  const bookedTime = integer(args.bookedTime, 'bookedTime', 1_600_000_000_000, 4_100_000_000_000);
  const payload = { campId: requireCampId(context), channelId: '0', orderChannelId,
    guestName, bookedTime, isCheckIn: 0, isDefaultCheckinGuest: 0,
    ...(guestMobile ? { guestMobile } : {}), ...(remark ? { remark } : {}),
    orderDetails: [{ roomCategoryId, roomId, isAutoArrangeRoom: 0,
      checkInDate, checkOutDate, saleType: 1, guestNum, orderDetailState: 1,
      orderDetailPrices: [{ paymentTypeId: '1', paymentWayId, isIncome: 1,
        isPayout: 0, currency: 'CNY', price: priceFen }],
    }],
  };
  const summary = { guestName, roomId, roomName: located.roomName, roomCategoryId,
    checkInDate, checkOutDate, nights, guestNum, orderChannelId, paymentWayId,
    quotedFen, priceFen, currency: 'CNY', paymentCollectedFen: 0 };
  return previewOrExecute(args, context, 'create_manual_order', '/order', payload, summary, summary,
    async (written) => {
      const createdId = responseId((written && typeof written === 'object' ? (written as Row).orderId : undefined));
      return createdId ? order(context, createdId) : { status: 'created', orderId: null, verification: 'query current orders' };
    });
}

export async function domesticMapChannelListing(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  domestic(context);
  if (args.productMappings !== undefined) invalid('Domestic product mapping requires the PC workflow');
  if (args.kind === 'property') {
    const poiId = id(args.poiId, 'poiId');
    const parentPoiId = id(args.parentPoiId, 'parentPoiId');
    const outPoiId = id(args.outPoiId, 'outPoiId');
    const outPoiName = typeof args.outPoiName === 'string' ? args.outPoiName.trim() : '';
    if (!outPoiName || outPoiName.length > 160) invalid('outPoiName is required');
    const [channelPoi, localPoi] = await Promise.all([
      post(context, '/poi/get', { poiId }), post(context, '/poi/get', { poiId: parentPoiId }),
    ]);
    if (!exact(channelPoi.poiId, poiId) || !exact(localPoi.poiId, parentPoiId) ||
      !exact(channelPoi.campId, requireCampId(context)) || !exact(localPoi.campId, requireCampId(context)) ||
      Number(localPoi.channelId) !== 0 || Number(channelPoi.channelId) === 0)
      invalid('Both channel and physical properties must belong to this authorized property');
    if (responseId(channelPoi.outPoiId) && responseId(channelPoi.outPoiId) !== outPoiId)
      invalid('External property ID differs from the channel property record');
    const payload = { campId: requireCampId(context), poiId, parentId: parentPoiId, outPoiId, outPoiName };
    const summary = { kind: 'property', poiId, poiName: channelPoi.name, channelId: channelPoi.channelId,
      parentPoiId, parentPoiName: localPoi.name, outPoiId, outPoiName };
    return previewOrExecute(args, context, 'map_channel_listing', '/poi/channelMapping',
      payload, summary, summary, () => post(context, '/poi/get', { poiId }));
  }
  if (args.kind === 'room') {
    const channelCategoryId = id(args.roomCategoryId, 'roomCategoryId');
    const localCategoryId = id(args.parentRoomCategoryId, 'parentRoomCategoryId');
    const [unmapped, physical] = await Promise.all([
      post(context, '/unMappingRoomCategories/get', {}),
      post(context, '/roomCategories/page/get', { pageSize: 1, pageNum: 1, roomCategoryIds: [localCategoryId] }),
    ]);
    const channel = rows(unmapped.unMappingRoomCategoryViews)
      .find((row) => exact(row.unMappingRoomCategoryId, channelCategoryId));
    const local = rows(physical.list).find((row) => exact(row.roomCategoryId, localCategoryId));
    if (!channel || !local || !exact(channel.campId, requireCampId(context)))
      invalid('Channel and physical room categories must belong to this authorized property');
    const payload = { campId: requireCampId(context), categoryMappings: [{
      roomCategoryId: localCategoryId,
      unMappingRoomCategories: [{ unMappingRoomCategoryId: channelCategoryId }],
    }] };
    const summary = { kind: 'room', channelRoomCategoryId: channelCategoryId,
      channelRoomCategoryName: channel.name, channelId: channel.channelId,
      physicalRoomCategoryId: localCategoryId, physicalRoomCategoryName: local.roomCategoryName };
    return previewOrExecute(args, context, 'map_channel_listing', '/roomCategoryMapping/v5',
      payload, summary, summary, () => post(context, '/roomCategory/channelMappingInfo/get', {}));
  }
  invalid('kind must be property or room');
}
