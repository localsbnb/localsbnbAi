import type { ToolContext, ToolResult } from '../../types/mcp.js';
import {
  formatFen,
  formatYmdByPattern,
  getLastWeekRange,
  getThisWeekRange,
  getTodayYmd,
  hudsonPost,
  profileOf,
  requireCampId,
  t,
  toZoneEndMs,
  toZoneStartMs,
} from '../../region/index.js';
import { createSuccessResult } from '../../utils/errorHandler.js';

interface AnalysisBlock {
  businessIncome?: number | string;
  adr?: number | string;
  occ?: number | string;
  hChain?: string;
  tChain?: string;
  openRoomCount?: number | string;
}

interface AnalysisView {
  businessIncomeAnalysis?: AnalysisBlock;
  adrAnalysis?: AnalysisBlock;
  occAnalysis?: AnalysisBlock;
  openRoomCountParAnalysis?: AnalysisBlock;
}

interface OverviewList {
  dateList?: Array<{ date?: unknown; data?: number | string }>;
  aggregationData?: number | string;
}

interface OverviewView {
  businessIncomeList?: OverviewList;
  occList?: OverviewList;
  revParList?: OverviewList;
  palList?: OverviewList;
}

function resolveOpsRange(
  context: ToolContext,
  args: Record<string, unknown>
): { startDate: string; endDate: string } {
  const tz = profileOf(context).ianaTimeZone;
  const today = getTodayYmd(tz);
  if (args.timeRange === 'this_week') {
    const r = getThisWeekRange(typeof args.date === 'string' ? args.date : today);
    return { startDate: r.start, endDate: r.end };
  }
  if (args.timeRange === 'last_week') {
    const r = getLastWeekRange(typeof args.date === 'string' ? args.date : today);
    return { startDate: r.start, endDate: r.end };
  }
  if (typeof args.startDate === 'string' && typeof args.endDate === 'string') {
    return { startDate: args.startDate, endDate: args.endDate };
  }
  const day = typeof args.date === 'string' ? args.date : today;
  return { startDate: day, endDate: day };
}

function asAmount(value: unknown, currency: string): string {
  if (value == null || value === '') return formatFen(0, currency);
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND']);
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  return `${currency} ${n.toFixed(digits)}`;
}

export async function queryOperationalDataOverseas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const profile = profileOf(context);
  const campId = requireCampId(context);
  const range = resolveOpsRange(context, args);
  const tz = profile.ianaTimeZone;
  const body = {
    campId,
    startDate: toZoneStartMs(range.startDate, tz),
    endDate: toZoneEndMs(range.endDate, tz),
  };

  const [analysis, overview] = await Promise.all([
    hudsonPost<AnalysisView>(
      context,
      '/bnbReport/accommodation/management/analysis/get',
      body,
      'operational analysis',
      'finance'
    ),
    hudsonPost<OverviewView>(
      context,
      '/bnbReport/accommodation/management/analysis/getGeneralOverview',
      {
        ...body,
        type: 'DATE',
        orderType: 'STANDARD_BOOKING',
        isCommission: 1,
      },
      'operational overview',
      'finance'
    ),
  ]);

  const income = analysis?.businessIncomeAnalysis;
  const adr = analysis?.adrAnalysis;
  const occ = analysis?.occAnalysis;
  const openRooms = analysis?.openRoomCountParAnalysis;

  const summary = {
    title: t(profile.locale, 'title.ops'),
    startDate: formatYmdByPattern(range.startDate, profile.dateFormat),
    endDate: formatYmdByPattern(range.endDate, profile.dateFormat),
    timezone: tz,
    currency: profile.currency,
    nightAudit: null,
    [t(profile.locale, 'ops.income')]: asAmount(income?.businessIncome, profile.currency),
    [t(profile.locale, 'ops.dod')]: income?.hChain ?? '-',
    [t(profile.locale, 'ops.mom')]: income?.tChain ?? '-',
    [t(profile.locale, 'ops.occ')]: occ?.occ ?? '-',
    [t(profile.locale, 'ops.adr')]: asAmount(adr?.adr, profile.currency),
    [t(profile.locale, 'ops.openRooms')]: openRooms?.openRoomCount ?? '-',
  };

  return createSuccessResult({
    summary,
    analysis,
    overview,
    queryDate: range.startDate,
    queryEndDate: range.endDate,
  });
}
