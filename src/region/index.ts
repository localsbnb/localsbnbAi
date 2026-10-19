import type { ToolContext } from '../types/mcp.js';
import { CN_PROFILE, type RegionProfile } from './types.js';

export { CN_PROFILE, profilesDiffer } from './types.js';
export type { AppLocale, RegionId, RegionProfile } from './types.js';
export { resolveRegionProfile, inHouseWindow } from './resolve.js';
export { hudsonTimeZoneToIana, normalizeLocale, localeToBcp47, channelDisplayName } from './timezone.js';
export {
  getTodayYmd,
  addDaysYmd,
  getThisWeekRange,
  getLastWeekRange,
  toOverseasDays,
  resolveNaturalWeek,
  toZoneStartMs,
  toZoneEndMs,
  formatYmdByPattern,
  isHighlightWeekend,
  weekdayShort,
  formatApiDate,
  apiDateToYmd,
} from './dates.js';
export { formatFen } from './money.js';
export { t, detailStateLabel, cleanStateLabel } from './i18n.js';
export { getOverseasToolDescription } from './toolDescriptions.js';
export { requireCampId, hudsonPost, extractPage, toIdList } from './api.js';

export function isOverseas(context: ToolContext): boolean {
  return context.regionProfile?.region === 'overseas';
}

export function profileOf(context: ToolContext): RegionProfile {
  return context.regionProfile ?? { ...CN_PROFILE, campId: context.campId };
}
