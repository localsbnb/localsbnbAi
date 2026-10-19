import type { ToolContext, ToolResult } from '../../types/mcp.js';
import {
  addDaysYmd,
  channelDisplayName,
  formatApiDate,
  formatFen,
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

interface ChannelPriceView {
  l?: Array<{
    i?: number | string;
    n?: string;
    r?: Array<{
      c?: number | string;
      pi?: number | string;
      pn?: string;
      cm?: number;
      dp?: Array<{ d?: unknown; p?: number }>;
    }>;
  }>;
  cl?: Array<{ ci?: number | string; cn?: string }>;
}

export async function queryRoomPricesOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const campId = requireCampId(context);
  const resolved = resolveNaturalWeek({
    date: typeof args.date === 'string' ? args.date : undefined,
    days: Number(args.days) > 0 ? Number(args.days) : 7,
    timeRange: args.timeRange as 'this_week' | 'last_week' | undefined,
    timeZone: profile.ianaTimeZone,
  });
  const payload = {
    campId,
    startDate: toZoneStartMs(resolved.date, profile.ianaTimeZone),
    days: toOverseasDays(resolved.days),
  };
  const data = await hudsonPost<ChannelPriceView>(
    context,
    '/bnbRatePrice/channelPrice/get',
    payload,
    'channel rates',
    'room_price'
  );
  const channelNameById = new Map<string, string>();
  for (const ch of data?.cl || []) {
    channelNameById.set(String(ch.ci), channelDisplayName(ch.ci, ch.cn));
  }

  const roomCategories = (data?.l || []).map((cat) => ({
    roomCategoryId: cat.i,
    roomCategoryName: cat.n,
    rates: (cat.r || []).map((rate) => ({
      channelId: rate.c,
      channelName: channelNameById.get(String(rate.c)) || channelDisplayName(rate.c),
      productId: rate.pi,
      productName: rate.pn,
      canModify: rate.cm,
      prices: (rate.dp || []).map((dp) => {
        const ymd = String(formatApiDate(dp.d, profile.ianaTimeZone)).slice(0, 10);
        return {
          date: formatApiDate(dp.d, profile.ianaTimeZone),
          weekday: /^\d{4}-\d{2}-\d{2}/.test(ymd) ? weekdayShort(ymd) : undefined,
          weekend: /^\d{4}-\d{2}-\d{2}/.test(ymd)
            ? isHighlightWeekend(ymd, profile.highlightWeekends)
            : false,
          amountFen: dp.p,
          amount: formatFen(dp.p, profile.currency),
        };
      }),
    })),
  }));

  return createSuccessResult({
    title: t(profile.locale, 'title.prices'),
    startDate: resolved.date,
    calendarDays: resolved.days,
    overseasDays: payload.days,
    endDate: addDaysYmd(resolved.date, resolved.days - 1),
    timeRange: args.timeRange,
    currency: profile.currency,
    timezone: profile.ianaTimeZone,
    channels: (data?.cl || []).map((ch) => ({
      channelId: ch.ci,
      channelName: channelDisplayName(ch.ci, ch.cn),
    })),
    roomCategories,
  });
}
