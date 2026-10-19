import type { APIClient, Logger } from '../types/mcp.js';
import { ErrorCode, hudsonAuthErrorFromResponse, isHudsonAuthError, MCPError } from '../utils/errorHandler.js';
import { addDaysYmd, getTodayYmd } from './dates.js';
import { hudsonTimeZoneToIana, localeToBcp47, normalizeLocale } from './timezone.js';
import { CN_PROFILE, type RegionProfile } from './types.js';

const BASIC_CODES = [
  'hudson.bnbBasic.language',
  'hudson.bnbBasic.timeZone',
  'hudson.bnbBasic.currency',
  'hudson.bnbBasic.dateFormat',
] as const;

interface HudsonEnvelope<T> {
  success?: boolean;
  data?: T;
}

interface CampGetData {
  isBnb?: number | string | boolean;
  campId?: string | number;
}

interface SystemConfigRow {
  configCode?: string;
  configValue?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function pickConfig(rows: SystemConfigRow[], code: string): string | undefined {
  const hit = rows.find((r) => r.configCode === code);
  const v = hit?.configValue;
  return v == null || String(v).trim() === '' ? undefined : String(v).trim();
}

function isOverseasCamp(isBnb: unknown): boolean {
  return Number(isBnb) === 1 || isBnb === true || isBnb === '1';
}

export async function resolveRegionProfile(
  apiClient: APIClient,
  campId: string | undefined,
  logger: Logger
): Promise<RegionProfile> {
  if (!campId) {
    return { ...CN_PROFILE };
  }

  try {
    const campRes = await apiClient.request<HudsonEnvelope<CampGetData>>({
      method: 'POST',
      url: '/camp/get',
      headers: { 'Content-Type': 'application/json' },
      data: { campId: String(campId) },
    });

    if (campRes.success !== true) {
      const authError = hudsonAuthErrorFromResponse(campRes, 'camp profile');
      if (authError) throw authError;
      logger.warn('camp/get unsuccessful, fallback to CN', { campId });
      return { ...CN_PROFILE, campId };
    }

    if (!isOverseasCamp(campRes.data?.isBnb)) {
      logger.info('Camp resolved as CN', { campId, isBnb: campRes.data?.isBnb });
      return { ...CN_PROFILE, campId };
    }

    let rows: SystemConfigRow[] = [];
    try {
      const configRes = await apiClient.request<
        HudsonEnvelope<{ systemConfigs?: SystemConfigRow[] } | SystemConfigRow[]>
      >({
        method: 'POST',
        url: '/systemConfigs/get',
        headers: { 'Content-Type': 'application/json' },
        data: {
          campId: String(campId),
          systemConfigCodes: [...BASIC_CODES],
        },
      });
      const configPayload = configRes.data;
      rows = Array.isArray(configPayload)
        ? configPayload
        : Array.isArray(asRecord(configPayload).systemConfigs)
          ? (asRecord(configPayload).systemConfigs as SystemConfigRow[])
          : [];
    } catch (error) {
      logger.warn('systemConfigs/get failed, using overseas defaults', {
        campId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let highlightWeekends: 1 | 2 = 2;
    try {
      const weekendRes = await apiClient.request<HudsonEnvelope<{ highlightWeekends?: number }>>({
        method: 'POST',
        url: '/systemConfig/bnbUser/calendarPersonalization/get',
        headers: { 'Content-Type': 'application/json' },
        data: { campId: String(campId) },
      });
      const hw = Number(weekendRes.data?.highlightWeekends);
      highlightWeekends = hw === 1 ? 1 : 2;
    } catch (error) {
      logger.warn('calendarPersonalization/get failed, highlightWeekends=2', {
        campId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const locale = normalizeLocale(pickConfig(rows, 'hudson.bnbBasic.language'));
    const hudsonTimeZone = pickConfig(rows, 'hudson.bnbBasic.timeZone') || 'AMERICA_NEW_YORK';
    const currency = pickConfig(rows, 'hudson.bnbBasic.currency') || 'USD';
    const dateFormat = pickConfig(rows, 'hudson.bnbBasic.dateFormat') || 'YYYY_MM_DD_HH_MM_24';

    const profile: RegionProfile = {
      region: 'overseas',
      campId,
      locale,
      localeCode: localeToBcp47(locale),
      hudsonTimeZone,
      ianaTimeZone: hudsonTimeZoneToIana(hudsonTimeZone),
      currency,
      dateFormat,
      highlightWeekends,
    };

    logger.info('Camp resolved as overseas', {
      campId,
      locale: profile.locale,
      timezone: profile.hudsonTimeZone,
      iana: profile.ianaTimeZone,
      currency: profile.currency,
      highlightWeekends: profile.highlightWeekends,
      today: getTodayYmd(profile.ianaTimeZone),
    });
    return profile;
  } catch (error) {
    if (isHudsonAuthError(error)) {
      throw error instanceof MCPError
        ? error
        : new MCPError(ErrorCode.AUTH_INVALID, error instanceof Error ? error.message : String(error));
    }
    logger.warn('Region resolve failed, fallback to CN', {
      campId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...CN_PROFILE, campId };
  }
}

export function inHouseWindow(timeZone: string): { start: string; end: string } {
  const today = getTodayYmd(timeZone);
  return { start: addDaysYmd(today, -30), end: today };
}
