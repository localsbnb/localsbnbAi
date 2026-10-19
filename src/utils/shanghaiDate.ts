/**
 * 业务日期按 Asia/Shanghai 计算（与路客云、订单/房态工具一致）
 */

export function getTodayShanghai(): string {
  return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
}

/** 在给定日历日上加减天数，返回 YYYY-MM-DD（上海日历日） */
export function addDaysYmd(ymd: string, deltaDays: number): string {
  const ms = new Date(`${ymd}T12:00:00+08:00`).getTime() + deltaDays * 86400000;
  return new Date(ms).toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
}

/** 含 anchor 日期的自然周：周一～周日（ISO 周，上海日期） */
export function getMondayOfWeekContaining(anchorYmd: string): string {
  const d = new Date(`${anchorYmd}T12:00:00+08:00`);
  const dow = d.getUTCDay();
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

export type WeekTimeRange = 'this_week' | 'last_week';

/**
 * 房价/房态等「date + days」接口：用户说「本周」「上周」时用自然周（周一～周日），
 * 不要用「从今天往前/往后数 7 天」代替。
 */
export function resolveDateAndDaysForNaturalWeek(params: {
  date?: string;
  days: number;
  timeRange?: WeekTimeRange;
}): { date: string; days: number; anchor: string } {
  const anchor = params.date ?? getTodayShanghai();
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
