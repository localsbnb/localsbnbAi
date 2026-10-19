import type { ToolContext, ToolResult } from '../../types/mcp.js';
import {
  addDaysYmd,
  apiDateToYmd,
  cleanStateLabel,
  formatFen,
  getTodayYmd,
  profileOf,
  toZoneStartMs,
  toOverseasDays,
} from '../../region/index.js';
import {
  dateRange,
  id,
  integer,
  invalid,
  post,
  previewOrExecute,
  responseId,
  rows,
  record,
  type Row,
} from './mutationPreview.js';

export async function updateChannelPrices(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const range = dateRange(args.startDate, args.endDate);
  const productId = id(args.roomCategoryProductId, 'roomCategoryProductId');
  const amountFen = integer(args.amountFen, 'amountFen', 10, 999_999_999);
  const weekDays = args.validWeekDays ?? [1, 1, 1, 1, 1, 1, 1];
  if (
    !Array.isArray(weekDays) ||
    weekDays.length !== 7 ||
    weekDays.some((v) => v !== 0 && v !== 1) ||
    !weekDays.includes(1)
  )
    invalid('validWeekDays must contain seven 0/1 values, Sunday first, with at least one enabled');
  const dates = Array.from({ length: range.days }, (_, i) => addDaysYmd(range.from, i)).filter(
    (day) => weekDays[new Date(`${day}T00:00:00Z`).getUTCDay()] === 1
  );
  if (!dates.length) invalid('No selected weekdays in the requested range');
  const profile = profileOf(context);
  const data = await post(context, '/bnbRatePrice/channelPrice/get', {
    startDate: toZoneStartMs(range.from, profile.ianaTimeZone),
    days: toOverseasDays(range.days),
  });
  let selected: { category: Row; rate: Row } | undefined;
  for (const category of rows(data?.l))
    for (const rate of rows(category.r)) {
      if (responseId(rate.pi) === productId) selected = { category, rate };
    }
  if (!selected) invalid('Rate product not found in this camp; query_room_prices first');
  if (
    selected.rate.cm != null &&
    String(selected.rate.cm).trim() !== '' &&
    Number(selected.rate.cm) === 0
  )
    invalid('This rate product cannot be modified');
  const dp: unknown[] = Array.isArray(selected.rate.dp) ? selected.rate.dp : [];
  const dated = dp.some((cell) => cell && typeof cell === 'object' && 'd' in cell);
  const current = dates.map((date) => {
    const index = (Date.parse(date) - Date.parse(range.from)) / 86400000;
    const cell = dated
      ? dp.find((p) => apiDateToYmd(record(p).d, profile.ianaTimeZone) === date)
      : dp[index];
    const object = record(cell);
    if (object.cm != null && String(object.cm).trim() !== '' && Number(object.cm) === 0)
      invalid(`Price is locked for ${date}`);
    const raw =
      cell && typeof cell === 'object'
        ? (object.value ?? object.p ?? object.price ?? object.amount)
        : cell;
    // PC dp numeric/integer strings are fen; decimal strings are major currency units.
    let price: unknown = raw;
    if (typeof raw === 'string' && /^\d+$/.test(raw)) price = Number(raw);
    else if (typeof raw === 'string' && /^\d+\.\d{1,2}$/.test(raw))
      price = Math.round(Number(raw) * 100);
    integer(price, `Current price for ${date}`);
    return { date, amountFen: price };
  });
  return previewOrExecute(
    args,
    context,
    'update_channel_prices',
    '/bnbRatePrice/channelPrice/save',
    {
      campId: context.campId,
      validWeekDays: weekDays,
      rates: [
        { from: range.from, to: range.to, roomCategoryProductId: productId, value: amountFen },
      ],
    },
    {
      roomCategoryId: responseId(selected.category.i),
      roomCategoryName: selected.category.n,
      productName: selected.rate.pn,
      channelId: responseId(selected.rate.c),
      currentPrices: current,
      newAmountFen: amountFen,
    },
    undefined,
    () =>
      post(context, '/bnbRatePrice/channelPrice/get', {
        startDate: toZoneStartMs(range.from, profile.ianaTimeZone),
        days: toOverseasDays(range.days),
      })
  );
}

/** All dates are business dates in the property's timezone, with an inclusive end. */
async function roomState(
  context: ToolContext,
  roomId: string,
  range: ReturnType<typeof dateRange>
) {
  const tz = profileOf(context).ianaTimeZone;
  // Room-status Hudson APIs expect YYYY-MM-DD (same as overseas PC), not epoch ms.
  const query = { startDate: range.from, days: toOverseasDays(range.days) };
  const rooms = await post(context, '/bnbRoomStatuses/rooms/get', query);
  let match: { category: Row; room: Row } | undefined;
  for (const category of rows(rooms?.list)) {
    const room = rows(category.rs).find((r) => responseId(r.i) === roomId);
    if (room) match = { room, category };
  }
  if (!match) invalid('Room not found in this camp; query_room_status_new first');
  const occupations = await post(context, '/bnbRoomStatuses/occ/get', query);
  const reservations = await post(context, '/bnbRoomStatuses/reservation/get', query);
  // Empty windows often return null instead of []; treat as empty lists.
  const occupationList = Array.isArray(occupations?.list) ? occupations.list : [];
  const reservationList = Array.isArray(reservations?.reservations) ? reservations.reservations : [];
  const dates = Array.from({ length: range.days }, (_, i) => addDaysYmd(range.from, i));
  const blocks = rows(occupationList).filter((r) => {
    if (responseId(r.ri) !== roomId) return false;
    const day = apiDateToYmd(r.d, tz);
    if (!day) invalid('Occupation date unavailable; cannot validate availability');
    return dates.includes(day);
  });
  const stays = rows(reservationList).filter((r) => {
    if (responseId(r.ri) !== roomId) return false;
    const start = apiDateToYmd(r.cid, tz),
      end = apiDateToYmd(r.cod, tz);
    if (!start || !end) invalid('Reservation dates unavailable; cannot validate availability');
    // Treat any overlapping returned reservation as a conflict, including unknown states.
    return start <= range.to && end > range.from;
  });
  return { ...match, dates, blocks, stays };
}
export async function changeRoomAvailability(
  args: Record<string, unknown>,
  context: ToolContext,
  action: 'close' | 'open'
): Promise<ToolResult> {
  const range = dateRange(args.startDate, args.endDate);
  const roomId = id(args.roomId, 'roomId');
  const type = action === 'close' ? integer(args.type ?? 1, 'type', 1, 5) : undefined;
  if (type === 2 || type === 3)
    invalid('Only manual closure types 1 (normal), 4 (maintenance), 5 (reserved) are supported');
  const state = await roomState(context, roomId, range);
  if (state.stays.length)
    invalid('Selected dates overlap a reservation; cannot change room availability');
  if (action === 'close' && state.blocks.length)
    invalid('Selected dates already have occupations; review existing blocks first');
  if (
    action === 'open' &&
    (state.blocks.some((b) => ![1, 4, 5].includes(Number(b.ot))) ||
      state.dates.some(
        (d) => !state.blocks.some((b) => apiDateToYmd(b.d, profileOf(context).ianaTimeZone) === d)
      ))
  )
    invalid('Open only explicitly selected dates with manual closures (types 1, 4, 5)');
  if (args.remark !== undefined && (typeof args.remark !== 'string' || args.remark.length > 500))
    invalid('remark must be text up to 500 characters');
  const payload = {
    campId: context.campId,
    roomDates: [{ roomId, dates: state.dates }],
    ...(action === 'close'
      ? { startDate: range.from, endDate: range.to, type, remark: args.remark ?? '' }
      : {}),
  };
  return previewOrExecute(
    args,
    context,
    `${action}_rooms`,
    `/bnbRoomStatuses/${action}`,
    payload,
    {
      roomName: state.room.n,
      roomCategoryName: state.category.n,
      dates: state.dates,
      action,
      existingBlocks: state.blocks,
    },
    undefined,
    () =>
      post(context, '/bnbRoomStatuses/occ/get', {
        startDate: range.from,
        days: toOverseasDays(range.days),
      })
  );
}

export async function createManualOrder(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const stay = dateRange(args.checkInDate, args.checkOutDate);
  if (stay.days < 2) invalid('Checkout must be after check-in');
  const occupied = dateRange(stay.from, addDaysYmd(stay.to, -1));
  const roomId = id(args.roomId, 'roomId');
  const roomCategoryId = id(args.roomCategoryId, 'roomCategoryId');
  const guestName = id(args.guestName, 'guestName');
  const guestNum = {
    adultNum: integer(args.adults ?? 1, 'adults', 1, 100),
    childNum: integer(args.children ?? 0, 'children', 0, 100),
    infantNum: integer(args.infants ?? 0, 'infants', 0, 100),
    petNum: integer(args.pets ?? 0, 'pets', 0, 100),
  };
  const paid = integer(args.paidFen ?? 0, 'paidFen');
  for (const field of ['guestEmail', 'guestMobile', 'note'])
    if (
      args[field] !== undefined &&
      (typeof args[field] !== 'string' || String(args[field]).length > 500)
    )
      invalid(`${field} must be text up to 500 characters`);
  if (args.guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(args.guestEmail)))
    invalid('guestEmail is invalid');
  const state = await roomState(context, roomId, occupied);
  if (responseId(state.category.i) !== roomCategoryId)
    invalid('Room does not belong to the selected room category');
  if (state.blocks.length || state.stays.length) invalid('Room is occupied for the requested stay');
  // Align with PC NewOrderDrawer: calcPayout can be empty when no rate plan; host may type amounts.
  let quote: Row = {};
  try {
    quote = await post(context, '/bnbOrder/calcPayout', {
      roomCategoryId,
      checkInDate: stay.from,
      checkOutDate: stay.to,
      guestNum,
    });
  } catch {
    quote = {};
  }
  const hasQuotedFare = typeof quote.accommodationFare === 'number';
  if (!hasQuotedFare && args.accommodationFareFen == null)
    invalid('Payout quote unavailable; pass accommodationFareFen (fen) or set rates on PC first');
  const quotedFare = hasQuotedFare ? integer(quote.accommodationFare, 'quoted accommodation fare') : 0;
  const discount = integer(quote.discountAmount ?? 0, 'quoted discount');
  const accommodationFare = integer(
    args.accommodationFareFen ?? Math.max(0, quotedFare - discount),
    'accommodationFareFen'
  );
  const cleaningFee = integer(args.cleaningFeeFen ?? quote.cleaningFee ?? 0, 'cleaningFeeFen');
  const tax = integer(args.taxFen ?? quote.tax ?? 0, 'taxFen');
  const total = integer(accommodationFare + cleaningFee + tax, 'totalFen');
  if (paid > total) invalid('paidFen exceeds the order total');
  // Match PC NewOrderDrawer: new manual orders are fixed RESERVED(2), not confirmed(3).
  const payload = {
    campId: context.campId,
    orderId: null,
    orderState: 2,
    channelId: '0',
    orderChannelId: '0',
    orderOpFromType: 1,
    guestName,
    guestNum,
    guestEmail: args.guestEmail,
    guestMobile: args.guestMobile,
    note: args.note,
    orderDetails: [
      {
        roomCategoryId,
        roomId,
        saleType: 1,
        checkInDate: stay.from,
        checkOutDate: stay.to,
        guestName,
        guestNum,
        paid,
        accommodationFare,
        cleaningFee,
        tax,
      },
    ],
  };
  const currency = profileOf(context).currency;
  return previewOrExecute(
    args,
    context,
    'create_manual_order',
    '/bnbOrder/save',
    payload,
    {
      guestName,
      roomName: state.room.n,
      roomCategoryName: state.category.n,
      checkInDate: stay.from,
      checkOutDate: stay.to,
      nights: stay.days - 1,
      currency,
      // Show major currency units to humans; wire payload still uses fen.
      amounts: {
        accommodationFare: formatFen(accommodationFare, currency),
        cleaningFee: formatFen(cleaningFee, currency),
        tax: formatFen(tax, currency),
        total: formatFen(total, currency),
        paid: formatFen(paid, currency),
        balance: formatFen(total - paid, currency),
      },
      submittedAmounts: {
        accommodationFare,
        cleaningFee,
        tax,
        totalFen: total,
        paidFen: paid,
        balanceFen: total - paid,
      },
      note: 'Daily manual order, PC reserved state=2. Present amounts.* (with currency) to the host; do not mention fen. Quoted discount is deducted from accommodationFare unless overridden.',
    },
    undefined,
    async (result) => {
      const orderId = responseId((result as { orderId?: unknown })?.orderId);
      if (!orderId) invalid('Save acknowledged without an orderId; query orders before retrying');
      return post(context, '/bnbOrder/get', { orderId });
    }
  );
}

const CLEAN_STATE_ALIASES: Record<string, 0 | 1 | 2 | 3> = {
  '0': 0,
  not_set: 0,
  unset: 0,
  '1': 1,
  dirty: 1,
  '2': 2,
  waiting: 2,
  waiting_for_inspection: 2,
  cleaning: 2,
  '3': 3,
  clean: 3,
};

function parseCleanState(value: unknown): 0 | 1 | 2 | 3 {
  if (typeof value === 'number' && [0, 1, 2, 3].includes(value)) return value as 0 | 1 | 2 | 3;
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (key in CLEAN_STATE_ALIASES) return CLEAN_STATE_ALIASES[key];
  }
  invalid('cleanState must be 0|1|2|3 or not_set|dirty|waiting|clean');
}

async function findRoomInCamp(context: ToolContext, roomId: string) {
  const profile = profileOf(context);
  const today = getTodayYmd(profile.ianaTimeZone);
  const rooms = await post(context, '/bnbRoomStatuses/rooms/get', {
    startDate: today,
    days: toOverseasDays(7),
  });
  for (const category of rows(rooms?.list)) {
    const room = rows(category.rs).find((r) => responseId(r.i) === roomId);
    if (room) {
      return {
        room,
        category,
        currentCleanState: Number(room.cs ?? 0) as 0 | 1 | 2 | 3,
      };
    }
  }
  invalid('Room not found in this camp; query_room_status_new first');
}

/** Align with PC AvailabilityCalendar → POST /room/updateCleanState. */
export async function updateRoomCleanState(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const roomId = id(args.roomId, 'roomId');
  const cleanState = parseCleanState(args.cleanState);
  const found = await findRoomInCamp(context, roomId);
  const profile = profileOf(context);
  const payload = {
    campId: context.campId,
    roomId,
    cleanState,
  };
  return previewOrExecute(
    args,
    context,
    'update_room_clean_state',
    '/room/updateCleanState',
    payload,
    {
      roomName: found.room.n,
      roomCategoryName: found.category.n,
      fromCleanState: found.currentCleanState,
      fromCleanStateLabel: cleanStateLabel(profile.locale, found.currentCleanState),
      toCleanState: cleanState,
      toCleanStateLabel: cleanStateLabel(profile.locale, cleanState),
    },
    // Digest must not include live "from" clean state — it can change between preview and confirm.
    { roomId, cleanState },
    async () => {
      const after = await findRoomInCamp(context, roomId);
      return {
        roomId,
        cleanState: after.currentCleanState,
        cleanStateLabel: cleanStateLabel(profile.locale, after.currentCleanState),
      };
    }
  );
}
