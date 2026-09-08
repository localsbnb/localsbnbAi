import type { ToolContext, ToolResult } from '../../types/mcp.js';
import {
  addDaysYmd,
  channelDisplayName,
  cleanStateLabel,
  formatApiDate,
  formatFen,
  formatYmdByPattern,
  hudsonPost,
  isHighlightWeekend,
  profileOf,
  requireCampId,
  resolveNaturalWeek,
  t,
  toOverseasDays,
  toZoneStartMs,
  weekdayShort,
} from '../../region/index.js';
import { createSuccessResult } from '../../utils/errorHandler.js';

interface RoomsGetView {
  list?: Array<{
    i?: number | string;
    n?: string;
    lt?: number;
    rs?: Array<{ i?: number | string; n?: string; cs?: number; s?: number }>;
  }>;
}

interface ReservationGetView {
  reservations?: Array<{
    rci?: number | string;
    ri?: number | string;
    ci?: number | string;
    oi?: number | string;
    odi?: number | string;
    os?: number;
    ods?: number;
    cid?: unknown;
    cod?: unknown;
    gn?: string;
    ps?: number;
    po?: number;
    pa?: number;
    up?: number;
  }>;
}

interface InvGetView {
  list?: Array<{
    rci?: number | string;
    aivs?: number;
    ivs?: number[];
  }>;
}

interface OccGetView {
  list?: Array<{
    ri?: number | string;
    d?: unknown;
    ot?: number;
    r?: string;
  }>;
}

export function buildRoomStatusPayload(params: {
  campId: string;
  startDate: string;
  calendarDays: number;
  timeZone: string;
  roomCategoryIds?: number[];
  searchKey?: string;
}): { campId: string; startDate: number; days: number; roomCategoryIds?: number[]; searchKey?: string } {
  return {
    campId: params.campId,
    startDate: toZoneStartMs(params.startDate, params.timeZone),
    days: toOverseasDays(params.calendarDays),
    roomCategoryIds: params.roomCategoryIds,
    searchKey: params.searchKey || undefined,
  };
}

export async function fetchOverseasRoomBundle(
  context: ToolContext,
  startDate: string,
  calendarDays: number,
  extra?: { roomCategoryIds?: number[]; searchKey?: string }
) {
  const profile = profileOf(context);
  const campId = requireCampId(context);
  const payload = buildRoomStatusPayload({
    campId,
    startDate,
    calendarDays,
    timeZone: profile.ianaTimeZone,
    roomCategoryIds: extra?.roomCategoryIds,
    searchKey: extra?.searchKey,
  });

  const [rooms, reservations, inventory, occupations] = await Promise.all([
    hudsonPost<RoomsGetView>(context, '/bnbRoomStatuses/rooms/get', payload, 'room list', 'room_status'),
    hudsonPost<ReservationGetView>(context, '/bnbRoomStatuses/reservation/get', payload, 'reservations', 'room_status'),
    hudsonPost<InvGetView>(context, '/bnbRoomStatuses/inv/get', payload, 'inventory', 'room_status'),
    hudsonPost<OccGetView>(context, '/bnbRoomStatuses/occ/get', payload, 'occupations', 'room_status'),
  ]);

  const dates = Array.from({ length: calendarDays }, (_, i) => addDaysYmd(startDate, i));
  const invByCategory = new Map<string, { allInventories?: number; inventories: number[] }>();
  for (const item of inventory?.list || []) {
    invByCategory.set(String(item.rci), { allInventories: item.aivs, inventories: item.ivs || [] });
  }

  const reservationsByRoom = new Map<string, Array<Record<string, unknown>>>();
  for (const r of reservations?.reservations || []) {
    const key = String(r.ri ?? '');
    const row = {
      orderId: r.oi,
      orderDetailId: r.odi,
      roomCategoryId: r.rci,
      roomId: r.ri,
      channelId: r.ci,
      channelName: channelDisplayName(r.ci),
      guestName: String(r.gn || '').trim() || '-',
      checkIn: formatApiDate(r.cid, profile.ianaTimeZone),
      checkOut: formatApiDate(r.cod, profile.ianaTimeZone),
      orderState: r.os,
      orderDetailState: r.ods,
      payout: formatFen(r.po, profile.currency),
      paid: formatFen(r.pa, profile.currency),
      unpaid: formatFen(r.up, profile.currency),
      payState: r.ps,
    };
    const list = reservationsByRoom.get(key) || [];
    list.push(row);
    reservationsByRoom.set(key, list);
  }

  const occByRoom = new Map<string, Array<Record<string, unknown>>>();
  for (const o of occupations?.list || []) {
    const key = String(o.ri ?? '');
    const list = occByRoom.get(key) || [];
    list.push({
      date: formatApiDate(o.d, profile.ianaTimeZone),
      occupationType: o.ot,
      remark: o.r || '',
    });
    occByRoom.set(key, list);
  }

  const roomCategories = (rooms?.list || []).map((cat) => {
    const inv = invByCategory.get(String(cat.i));
    return {
      roomCategoryId: cat.i,
      roomCategoryName: cat.n,
      listingType: cat.lt,
      rooms: (cat.rs || []).map((room) => ({
        roomId: room.i,
        roomName: room.n,
        cleanState: room.cs,
        cleanStateLabel: cleanStateLabel(profile.locale, room.cs),
        seq: room.s,
        reservations: reservationsByRoom.get(String(room.i)) || [],
        occupations: occByRoom.get(String(room.i)) || [],
      })),
      inventoryByDate: dates.map((ymd, idx) => ({
        date: ymd,
        weekday: weekdayShort(ymd),
        weekend: isHighlightWeekend(ymd, profile.highlightWeekends),
        remaining: inv?.inventories?.[idx],
      })),
      allInventories: inv?.allInventories,
    };
  });

  return {
    startDate,
    calendarDays,
    overseasDays: payload.days,
    timezone: profile.ianaTimeZone,
    currency: profile.currency,
    highlightWeekends: profile.highlightWeekends,
    roomCategories,
  };
}

export async function queryTodayRoomStatusOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const startDate =
    typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
      ? args.date
      : getTodaySafe(profile.ianaTimeZone);
  const assembled = await fetchOverseasRoomBundle(context, startDate, 1);
  const rooms = assembled.roomCategories.flatMap((c) => c.rooms);
  const dirty = rooms.filter((r) => Number(r.cleanState) === 1).length;
  const withStay = rooms.filter((r) => r.reservations.length > 0).length;
  const summary = {
    title: t(profile.locale, 'title.todayRooms'),
    queryDate: formatYmdByPattern(startDate, profile.dateFormat),
    roomCount: rooms.length,
    roomsWithReservation: withStay,
    dirtyCount: dirty,
    idleCount: Math.max(rooms.length - withStay, 0),
  };
  return createSuccessResult({ summary, ...assembled });
}

export async function queryRoomStatusNewOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const resolved = resolveNaturalWeek({
    date: typeof args.date === 'string' ? args.date : undefined,
    days: Number(args.days) > 0 ? Number(args.days) : 30,
    timeRange: args.timeRange as 'this_week' | 'last_week' | undefined,
    timeZone: profile.ianaTimeZone,
  });
  const assembled = await fetchOverseasRoomBundle(context, resolved.date, resolved.days, {
    roomCategoryIds: Array.isArray(args.roomCategoryIds) ? (args.roomCategoryIds as number[]) : undefined,
    searchKey: typeof args.searchKey === 'string' ? args.searchKey : undefined,
  });
  return createSuccessResult({
    title: t(profile.locale, 'title.roomCalendar'),
    timeRange: args.timeRange,
    ...assembled,
  });
}

function getTodaySafe(timeZone: string): string {
  return new Date().toLocaleDateString('sv', { timeZone });
}
