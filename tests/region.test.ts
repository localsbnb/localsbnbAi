import {
  addDaysYmd,
  getMondayOfWeekContaining,
  getThisWeekRange,
  getLastWeekRange,
  toOverseasDays,
  isHighlightWeekend,
  formatYmdByPattern,
  toZoneStartMs,
  toZoneEndMs,
} from '../src/region/dates';
import { formatFen } from '../src/region/money';
import { channelDisplayName, hudsonTimeZoneToIana, normalizeLocale } from '../src/region/timezone';
import { resolveRegionProfile } from '../src/region/resolve';
import { CN_PROFILE, profilesDiffer } from '../src/region/types';
import { t, cleanStateLabel } from '../src/region/i18n';
import { getOverseasToolDescription } from '../src/region/toolDescriptions';
import { getActiveToolDefinitions, toolDefinitions } from '../src/config/tools';
import { ErrorCode, MCPError } from '../src/utils/errorHandler';

describe('region dates', () => {
  it('adds calendar days without timezone shift', () => {
    expect(addDaysYmd('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('uses Monday as start of week', () => {
    expect(getMondayOfWeekContaining('2026-09-09')).toBe('2026-09-07');
    expect(getThisWeekRange('2026-09-09')).toEqual({ start: '2026-09-07', end: '2026-09-13' });
    expect(getLastWeekRange('2026-09-09')).toEqual({ start: '2026-08-31', end: '2026-09-06' });
  });

  it('converts calendar days to overseas days offset', () => {
    expect(toOverseasDays(1)).toBe(0);
    expect(toOverseasDays(7)).toBe(6);
    expect(toOverseasDays(30)).toBe(29);
  });

  it('highlights Fri+Sat or Sat+Sun', () => {
    expect(isHighlightWeekend('2026-09-11', 1)).toBe(true); // Friday
    expect(isHighlightWeekend('2026-09-12', 1)).toBe(true); // Saturday
    expect(isHighlightWeekend('2026-09-13', 1)).toBe(false); // Sunday
    expect(isHighlightWeekend('2026-09-12', 2)).toBe(true);
    expect(isHighlightWeekend('2026-09-13', 2)).toBe(true);
    expect(isHighlightWeekend('2026-09-11', 2)).toBe(false);
  });

  it('formats ymd by Hudson dateFormat', () => {
    expect(formatYmdByPattern('2026-09-07', 'YYYY_MM_DD_HH_MM_24')).toBe('2026/09/07');
    expect(formatYmdByPattern('2026-09-07', 'MM_DD_YYYY_H_MM_AMPM')).toBe('09/07/2026');
    expect(formatYmdByPattern('2026-09-07', 'DD_MM_YYYY_HH_MM_24')).toBe('07/09/2026');
  });

  it('order list endDate must be begin-of-day like startDate (not end-of-day)', () => {
    const tz = 'Asia/Shanghai';
    const day = '2026-09-08';
    const start = toZoneStartMs(day, tz);
    const endBegin = toZoneStartMs(day, tz);
    const endOfDay = toZoneEndMs(day, tz);
    expect(endBegin).toBe(start);
    expect(endOfDay).toBeGreaterThan(start);
    // Hudson /bnbOrderDetails/page/get rejects end-of-day with date union validation
  });
});

describe('region money / locale / channel', () => {
  it('formats fen with currency decimals', () => {
    expect(formatFen(12345, 'USD')).toBe('USD 123.45');
    expect(formatFen(12345, 'JPY')).toBe('JPY 123');
  });

  it('normalizes locale and timezone, defaulting to en / New York', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('ko')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
    expect(hudsonTimeZoneToIana('ASIA_TOKYO')).toBe('Asia/Tokyo');
    expect(hudsonTimeZoneToIana('ASIA_SEOUL')).toBe('America/New_York');
  });

  it('maps channel ids without Chinese names', () => {
    expect(channelDisplayName(1)).toBe('Airbnb');
    expect(channelDisplayName('9')).toBe('Booking.com');
    expect(channelDisplayName(10)).toBe('Agoda');
    expect(channelDisplayName(113)).toBe('Trip.com');
    expect(channelDisplayName(1, '爱彼迎')).toBe('Airbnb');
    expect(channelDisplayName(113, '携程国际')).toBe('Trip.com');
  });

  it('labels cleanState 0/2 instead of raw digits', () => {
    expect(cleanStateLabel('en', 0)).toBe('Unknown');
    expect(cleanStateLabel('en', 1)).toBe('Dirty');
    expect(cleanStateLabel('en', 2)).toBe('Cleaning');
    expect(cleanStateLabel('en', 3)).toBe('Clean');
    expect(cleanStateLabel('ja', 0)).toBe('不明');
    expect(cleanStateLabel('ja', 2)).toBe('清掃中');
    expect(cleanStateLabel('ja', 1)).toBe('未清掃');
    expect(cleanStateLabel('ja', 3)).toBe('清掃済');
  });

  it('falls back i18n to English', () => {
    expect(t('en', 'title.preArrival')).toMatch(/Arrivals/);
    expect(t(undefined, 'title.preArrival')).toMatch(/Arrivals/);
  });

  it('detects profile locale/currency changes for live refresh', () => {
    const base = { ...CN_PROFILE, campId: '1', region: 'overseas' as const, locale: 'en' as const, localeCode: 'en-US' };
    expect(profilesDiffer(base, { ...base })).toBe(false);
    expect(profilesDiffer(base, { ...base, locale: 'ja', localeCode: 'ja-JP' })).toBe(true);
    expect(profilesDiffer(base, { ...base, currency: 'JPY' })).toBe(true);
  });
});

describe('region resolve isolation', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  it('skips camp/get when campId is missing', async () => {
    const request = jest.fn();
    const profile = await resolveRegionProfile({ request }, undefined, logger);
    expect(profile.region).toBe('cn');
    expect(request).not.toHaveBeenCalled();
  });

  it('does not call overseas APIs when isBnb is not 1', async () => {
    const request = jest.fn().mockResolvedValue({
      success: true,
      data: { isBnb: 0, campId: '1' },
    });
    const profile = await resolveRegionProfile({ request }, '1', logger);
    expect(profile.region).toBe('cn');
    expect(profile.ianaTimeZone).toBe(CN_PROFILE.ianaTimeZone);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].url).toBe('/camp/get');
  });

  it('loads overseas configs only after isBnb === 1', async () => {
    const request = jest.fn(async (cfg: { url: string }) => {
      if (cfg.url === '/camp/get') {
        return { success: true, data: { isBnb: 1 } };
      }
      if (cfg.url === '/systemConfigs/get') {
        return {
          success: true,
          data: {
            systemConfigs: [
              { configCode: 'hudson.bnbBasic.language', configValue: 'ja' },
              { configCode: 'hudson.bnbBasic.timeZone', configValue: 'ASIA_TOKYO' },
              { configCode: 'hudson.bnbBasic.currency', configValue: 'JPY' },
              { configCode: 'hudson.bnbBasic.dateFormat', configValue: 'YYYY_MM_DD_HH_MM_24' },
            ],
          },
        };
      }
      if (cfg.url === '/systemConfig/bnbUser/calendarPersonalization/get') {
        return { success: true, data: { highlightWeekends: 1 } };
      }
      throw new Error(`unexpected ${cfg.url}`);
    });
    const profile = await resolveRegionProfile({ request }, '2091', logger);
    expect(profile.region).toBe('overseas');
    expect(profile.locale).toBe('ja');
    expect(profile.ianaTimeZone).toBe('Asia/Tokyo');
    expect(profile.currency).toBe('JPY');
    expect(profile.highlightWeekends).toBe(1);
    expect(request.mock.calls.map((c) => c[0].url)).toEqual([
      '/camp/get',
      '/systemConfigs/get',
      '/systemConfig/bnbUser/calendarPersonalization/get',
    ]);
  });

  it('does not fallback to CN when camp/get returns USER_TOKEN_INVALID', async () => {
    const request = jest.fn().mockResolvedValue({
      success: false,
      errorCode: 'USER_TOKEN_INVALID',
      errorMsg: 'token invalid',
    });
    await expect(resolveRegionProfile({ request }, '2091', logger)).rejects.toMatchObject({
      name: 'MCPError',
      code: ErrorCode.AUTH_INVALID,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].url).toBe('/camp/get');
  });

  it('does not fallback to CN when camp/get throws 401 AUTH_INVALID', async () => {
    const request = jest.fn().mockRejectedValue(new MCPError(ErrorCode.AUTH_INVALID, 'API密钥无效或已过期'));
    await expect(resolveRegionProfile({ request }, '2091', logger)).rejects.toMatchObject({
      code: ErrorCode.AUTH_INVALID,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('tool registration isolation', () => {
  it('keeps CN tool names and does not register write tools', () => {
    const cn = getActiveToolDefinitions(CN_PROFILE);
    expect(cn).toBe(toolDefinitions);
    expect(cn.map((t) => t.name)).not.toEqual(expect.arrayContaining(['check_in_order']));
    expect(cn).toHaveLength(10);
  });

  it('registers write tools only for overseas and localizes descriptions', () => {
    const overseas = getActiveToolDefinitions({
      ...CN_PROFILE,
      region: 'overseas',
      locale: 'en',
      localeCode: 'en-US',
    });
    const names = overseas.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['check_in_order', 'check_out_order', 'extend_order', 'arrange_room'])
    );
    const today = overseas.find((t) => t.name === 'query_today_orders');
    expect(today?.description).toBe(getOverseasToolDescription('query_today_orders', 'en'));
    expect(today?.description).not.toBe(toolDefinitions.find((t) => t.name === 'query_today_orders')?.description);
  });
});
