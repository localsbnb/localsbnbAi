import type { ToolContext, ToolResult } from '../../types/mcp.js';
import {
  addDaysYmd,
  apiDateToYmd,
  extractPage,
  formatApiDate,
  formatFen,
  getTodayYmd,
  hudsonPost,
  profileOf,
  requireCampId,
  t,
  toIdList,
  toZoneStartMs,
  type AppLocale,
} from '../../region/index.js';
import { MCPError, ErrorCode } from '../../utils/errorHandler.js';

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function isConfirmed(args: Record<string, unknown>): boolean {
  return args.confirm === true || args.confirm === 'true' || args.confirm === 1 || args.confirm === '1';
}

function profileLine(context: ToolContext): string {
  const p = profileOf(context);
  return `${p.locale}｜${p.currency}｜${p.ianaTimeZone}`;
}

function previewHasIdentity(text: string, locale: AppLocale): boolean {
  const guestLabel = t(locale, 'label.guest');
  const orderLabel = t(locale, 'label.orderId');
  if (!text.includes(orderLabel) || !text.includes(guestLabel)) return false;
  const guest = text.split(`${guestLabel}：`)[1]?.split('\n')[0]?.trim() || '';
  const orderId = text.split(`${orderLabel}：`)[1]?.split('\n')[0]?.trim() || '';
  return Boolean(orderId && orderId !== '-' && guest && guest !== '-');
}

function formatStayPreview(context: ToolContext, data: Record<string, unknown>, detailId?: string): string {
  const profile = profileOf(context);
  const details = Array.isArray(data.orderDetails) ? (data.orderDetails as Record<string, unknown>[]) : [];
  const matched =
    (detailId && details.find((d) => String(d.orderDetailId) === String(detailId))) || details[0] || {};
  return [
    `${t(profile.locale, 'label.orderId')}：${data.orderId ?? '-'}`,
    `${t(profile.locale, 'label.detailId')}：${matched.orderDetailId ?? detailId ?? '-'}`,
    `${t(profile.locale, 'label.guest')}：${String(data.guestName || matched.guestName || '').trim() || '-'}`,
    `${t(profile.locale, 'label.room')}：${matched.roomName || '-'}`,
    `${t(profile.locale, 'label.stay')}：${formatApiDate(matched.checkInDate ?? data.checkInTime, profile.ianaTimeZone)} ~ ${formatApiDate(matched.checkOutDate ?? data.checkOutTime, profile.ianaTimeZone)}`,
    `${t(profile.locale, 'label.paid')}：${formatFen(Number(matched.paid ?? data.incomePrice), profile.currency)}`,
  ].join('\n');
}

async function previewOrder(context: ToolContext, orderId?: string, orderDetailId?: string): Promise<string> {
  const profile = profileOf(context);
  if (orderId) {
    try {
      const data = await hudsonPost<Record<string, unknown>>(
        context,
        '/bnbOrder/get',
        { campId: requireCampId(context), orderId },
        'order details',
        'orders'
      );
      return formatStayPreview(context, data, orderDetailId);
    } catch {
      return `${t(profile.locale, 'label.orderId')}：${orderId}`;
    }
  }
  if (!orderDetailId) return '';
  try {
    const tz = profile.ianaTimeZone;
    const today = getTodayYmd(tz);
    const page = await hudsonPost<unknown>(
      context,
      '/bnbOrderDetails/page/get',
      {
        campId: requireCampId(context),
        searchKey: String(orderDetailId),
        dateTimeSearchType: 1,
        startDate: toZoneStartMs(addDaysYmd(today, -180), tz),
        endDate: toZoneStartMs(today, tz),
        pageNum: 1,
        pageSize: 20,
      },
      'order list',
      'orders'
    );
    const hit = extractPage<Record<string, unknown>>(page).list.find(
      (row) => String(row.orderDetailId) === String(orderDetailId)
    );
    if (!hit) return `${t(profile.locale, 'label.detailId')}：${orderDetailId}`;
    return formatStayPreview(context, hit, orderDetailId);
  } catch {
    return `${t(profile.locale, 'label.detailId')}：${orderDetailId}`;
  }
}

function refuseIfUnidentified(context: ToolContext, preview: string, confirmed: boolean): ToolResult | null {
  const locale = profileOf(context).locale;
  if (!confirmed) return null;
  if (previewHasIdentity(preview, locale)) return null;
  return textResult(`${preview}\n\n${t(locale, 'confirm.needIdentity')}`);
}

export async function checkInOrderOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const campId = requireCampId(context);
  const orderDetailIds = toIdList(args.orderDetailIds ?? args.orderDetailId);
  if (!orderDetailIds.length) {
    throw new MCPError(ErrorCode.MISSING_PARAMS, 'orderDetailIds is required');
  }
  const preview = [
    t(profile.locale, 'confirm.title.checkIn'),
    profileLine(context),
    `orderDetailIds: ${orderDetailIds.join(', ')}`,
    await previewOrder(
      context,
      args.orderId != null ? String(args.orderId) : undefined,
      String(orderDetailIds[0])
    ),
  ]
    .filter(Boolean)
    .join('\n');

  if (!isConfirmed(args)) {
    return textResult(`${preview}\n\n${t(profile.locale, 'confirm.need')}`);
  }
  const blocked = refuseIfUnidentified(context, preview, true);
  if (blocked) return blocked;

  await hudsonPost<boolean>(
    context,
    '/bnbOrderDetails/checkIn',
    { campId, orderDetailIds },
    'check-in',
    'orders'
  );
  return textResult(`${t(profile.locale, 'confirm.done.checkIn')}\n${preview}`);
}

export async function checkOutOrderOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const campId = requireCampId(context);
  const orderDetailIds = toIdList(args.orderDetailIds ?? args.orderDetailId);
  if (!orderDetailIds.length) {
    throw new MCPError(ErrorCode.MISSING_PARAMS, 'orderDetailIds is required');
  }
  const preview = [
    t(profile.locale, 'confirm.title.checkOut'),
    profileLine(context),
    `orderDetailIds: ${orderDetailIds.join(', ')}`,
    await previewOrder(
      context,
      args.orderId != null ? String(args.orderId) : undefined,
      String(orderDetailIds[0])
    ),
  ]
    .filter(Boolean)
    .join('\n');

  if (!isConfirmed(args)) {
    return textResult(`${preview}\n\n${t(profile.locale, 'confirm.need')}`);
  }
  const blocked = refuseIfUnidentified(context, preview, true);
  if (blocked) return blocked;

  await hudsonPost<boolean>(
    context,
    '/bnbOrderDetails/checkOut',
    { campId, orderDetailIds },
    'check-out',
    'orders'
  );
  return textResult(`${t(profile.locale, 'confirm.done.checkOut')}\n${preview}`);
}

function asGuestNum(raw: unknown): { adultNum: number; childNum?: number; infantNum?: number; petNum?: number } {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const adultNum = Number(r.adultNum ?? r.numberOfGuest ?? 1) || 1;
    return {
      adultNum,
      childNum: r.childNum != null ? Number(r.childNum) : undefined,
      infantNum: r.infantNum != null ? Number(r.infantNum) : undefined,
      petNum: r.petNum != null ? Number(r.petNum) : undefined,
    };
  }
  const n = Number(raw);
  return { adultNum: Number.isFinite(n) && n > 0 ? n : 1 };
}

async function quoteExtendPayout(
  context: ToolContext,
  previousOrderId: string,
  nights: number,
  roomId: unknown
): Promise<string> {
  const profile = profileOf(context);
  const campId = requireCampId(context);
  try {
    const order = await hudsonPost<Record<string, unknown>>(
      context,
      '/bnbOrder/get',
      { campId, orderId: previousOrderId },
      'order details',
      'orders'
    );
    const details = Array.isArray(order.orderDetails) ? (order.orderDetails as Record<string, unknown>[]) : [];
    const matched =
      details.find((d) => String(d.roomId) === String(roomId)) || details[0];
    if (!matched?.roomCategoryId) return '';
    const checkInYmd =
      apiDateToYmd(matched.checkOutDate ?? matched.expectCheckOutTime, profile.ianaTimeZone) ||
      apiDateToYmd(matched.checkOutDate, profile.ianaTimeZone);
    if (!checkInYmd) return '';
    const checkOutYmd = addDaysYmd(checkInYmd, nights);
    const quote = await hudsonPost<{
      accommodationFare?: number;
      commission?: number;
      cleaningFee?: number;
      managementFee?: number;
      tax?: number;
      discountAmount?: number;
    }>(
      context,
      '/bnbOrder/calcPayout',
      {
        campId,
        roomCategoryId: matched.roomCategoryId,
        checkInDate: toZoneStartMs(checkInYmd, profile.ianaTimeZone),
        checkOutDate: toZoneStartMs(checkOutYmd, profile.ianaTimeZone),
        guestNum: asGuestNum(matched.guestNum ?? order.guestNum),
      },
      'extend quote',
      'orders'
    );
    return [
      t(profile.locale, 'label.quote'),
      `${t(profile.locale, 'label.fare')}：${formatFen(quote?.accommodationFare, profile.currency)}`,
      `${t(profile.locale, 'label.commission')}：${formatFen(quote?.commission, profile.currency)}`,
    ].join('\n');
  } catch {
    return '';
  }
}

export async function extendOrderOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const campId = requireCampId(context);
  const previousOrderId = String(args.previousOrderId ?? args.orderId ?? '');
  const nights = Number(args.nights);
  const roomId = args.roomId;
  if (!previousOrderId || !Number.isFinite(nights) || nights < 1 || roomId == null) {
    throw new MCPError(ErrorCode.MISSING_PARAMS, 'previousOrderId, nights (>=1) and roomId are required');
  }
  const paid = args.paid == null || args.paid === '' ? undefined : Number(args.paid);
  const shouldQuote = args.calcPayout === true || args.calcPayout === 'true' || (paid == null && args.calcPayout !== false);
  const quote = shouldQuote ? await quoteExtendPayout(context, previousOrderId, nights, roomId) : '';
  const preview = [
    t(profile.locale, 'confirm.title.extend'),
    profileLine(context),
    await previewOrder(context, previousOrderId),
    `${t(profile.locale, 'label.nights')}：${nights}`,
    `${t(profile.locale, 'label.room')}：${roomId}`,
    paid != null ? `${t(profile.locale, 'label.paid')}：${formatFen(paid, profile.currency)}` : '',
    quote,
  ]
    .filter(Boolean)
    .join('\n');

  if (!isConfirmed(args)) {
    return textResult(`${preview}\n\n${t(profile.locale, 'confirm.need')}`);
  }
  const blocked = refuseIfUnidentified(context, preview, true);
  if (blocked) return blocked;

  const data = await hudsonPost<{ orderId?: string | number }>(
    context,
    '/bnbOrder/extend',
    {
      campId,
      previousOrderId,
      nights,
      roomId,
      paid,
    },
    'extend stay',
    'orders'
  );
  return textResult(
    `${t(profile.locale, 'confirm.done.extend', { orderId: String(data?.orderId ?? '-') })}\n${preview}`
  );
}

export async function arrangeRoomOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const campId = requireCampId(context);
  const orderDetailId = args.orderDetailId;
  const roomId = args.roomId;
  if (orderDetailId == null || roomId == null) {
    throw new MCPError(ErrorCode.MISSING_PARAMS, 'orderDetailId and roomId are required');
  }
  const preview = [
    t(profile.locale, 'confirm.title.arrange'),
    profileLine(context),
    `${t(profile.locale, 'label.detailId')}：${orderDetailId}`,
    `${t(profile.locale, 'label.room')}：${roomId}`,
    await previewOrder(
      context,
      args.orderId != null ? String(args.orderId) : undefined,
      String(orderDetailId)
    ),
  ]
    .filter(Boolean)
    .join('\n');

  if (!isConfirmed(args)) {
    return textResult(`${preview}\n\n${t(profile.locale, 'confirm.need')}`);
  }
  const blocked = refuseIfUnidentified(context, preview, true);
  if (blocked) return blocked;

  await hudsonPost<boolean>(
    context,
    '/bnbOrderDetail/arrangeRoom',
    { campId, orderDetailId, roomId },
    'arrange room',
    'orders'
  );
  return textResult(`${t(profile.locale, 'confirm.done.arrange')}\n${preview}`);
}
