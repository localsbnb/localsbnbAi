export function getTodayYmd(timeZone: string): string {
  return new Date().toLocaleDateString('sv', { timeZone });
}

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d) + deltaDays * 86400000;
  return new Date(utc).toISOString().slice(0, 10);
}

export function getMondayOfWeekContaining(anchorYmd: string): string {
  const [y, m, d] = anchorYmd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  const daysFromMonday = (dow + 6) % 7;
  return addDaysYmd(anchorYmd, -daysFromMonday);
}

export function getThisWeekRange(anchorYmd: string): { start: string; end: string } {
  const mon = getMondayOfWeekContaining(anchorYmd);
  return { start: mon, end: addDaysYmd(mon, 6) };
}

export function getLastWeekRange(anchorYmd: string): { start: string; end: string } {
  const thisMon = getMondayOfWeekContaining(anchorYmd);
  const lastMon = addDaysYmd(thisMon, -7);
  return { start: lastMon, end: addDaysYmd(lastMon, 6) };
}

/** 海外房态/房价：日历天数 N → days = N-1（0 表示仅当天） */
export function toOverseasDays(calendarDays: number): number {
  return Math.max(Math.min(calendarDays, 91) - 1, 0);
}

export function resolveNaturalWeek(params: {
  date?: string;
  days: number;
  timeRange?: 'this_week' | 'last_week';
  timeZone: string;
}): { date: string; days: number; anchor: string } {
  const anchor = params.date ?? getTodayYmd(params.timeZone);
  if (params.timeRange === 'this_week') {
    const r = getThisWeekRange(anchor);
    return { date: r.start, days: 7, anchor };
  }
  if (params.timeRange === 'last_week') {
    const r = getLastWeekRange(anchor);
    return { date: r.start, days: 7, anchor };
  }
  return { date: anchor, days: params.days, anchor };
}

function tzOffsetMs(instant: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - instant;
}

/** 门店时区某日历日 00:00:00 的 epoch ms（用于请求，不用于改写返回日期） */
export function toZoneStartMs(ymd: string, timeZone: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset1 = tzOffsetMs(utcGuess, timeZone);
  const utc1 = Date.UTC(y, m - 1, d, 0, 0, 0) - offset1;
  const offset2 = tzOffsetMs(utc1, timeZone);
  return Date.UTC(y, m - 1, d, 0, 0, 0) - offset2;
}

export function toZoneEndMs(ymd: string, timeZone: string): number {
  return toZoneStartMs(addDaysYmd(ymd, 1), timeZone) - 1;
}

export function formatYmdByPattern(ymd: string, dateFormat: string): string {
  const [y, m, d] = ymd.split('-');
  switch (dateFormat) {
    case 'MM_DD_YYYY_H_MM_AMPM':
      return `${m}/${d}/${y}`;
    case 'DD_MM_YYYY_HH_MM_24':
    case 'DD_MM_YYYY_HH_MM_SS':
    case 'DD_MMM_YYYY_H_MM_SS_AMPM':
      return `${d}/${m}/${y}`;
    default:
      return `${y}/${m}/${d}`;
  }
}

/** 1=周五+周六，2=周六+周日 */
export function isHighlightWeekend(ymd: string, highlightWeekends: 1 | 2): boolean {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  if (highlightWeekends === 1) return dow === 5 || dow === 6;
  return dow === 6 || dow === 0;
}

export function weekdayShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names[new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()];
}

/** 接口已按门店时区处理的字符串原样返回；epoch 只格式成该时区墙钟，不再二次偏移已本地化的日期。 */
export function formatApiDate(value: unknown, timeZone: string): string {
  if (value == null || value === '') return '-';
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return '-';
    if (/^\d{13}$/.test(s) || /^\d{10}$/.test(s)) {
      return formatApiDate(Number(s.length === 10 ? `${s}000` : s), timeZone);
    }
    return s;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  }
  return String(value);
}

export function apiDateToYmd(value: unknown, timeZone: string): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    if (/^\d{13}$/.test(value) || /^\d{10}$/.test(value)) {
      return apiDateToYmd(Number(value.length === 10 ? `${value}000` : value), timeZone);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toLocaleDateString('sv', { timeZone });
  }
  return undefined;
}
