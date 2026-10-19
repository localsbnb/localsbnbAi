export type RegionId = 'cn' | 'overseas';

export type AppLocale = 'en' | 'ja' | 'th' | 'ms' | 'zh-CN' | 'zh-TW';

export interface RegionProfile {
  region: RegionId;
  campId?: string;
  locale: AppLocale;
  /** Accept-Language / Hudson lang */
  localeCode: string;
  hudsonTimeZone: string;
  ianaTimeZone: string;
  currency: string;
  dateFormat: string;
  highlightWeekends: 1 | 2;
}

export const CN_PROFILE: RegionProfile = {
  region: 'cn',
  locale: 'zh-CN',
  localeCode: 'zh-CN',
  hudsonTimeZone: 'ASIA_SHANGHAI',
  ianaTimeZone: 'Asia/Shanghai',
  currency: 'CNY',
  dateFormat: 'YYYY_MM_DD_HH_MM_24',
  highlightWeekends: 2,
};

export function profilesDiffer(a: RegionProfile, b: RegionProfile): boolean {
  return (
    a.region !== b.region ||
    a.locale !== b.locale ||
    a.localeCode !== b.localeCode ||
    a.currency !== b.currency ||
    a.hudsonTimeZone !== b.hudsonTimeZone ||
    a.dateFormat !== b.dateFormat ||
    a.highlightWeekends !== b.highlightWeekends ||
    String(a.campId ?? '') !== String(b.campId ?? '')
  );
}
