import type { AppLocale } from './types.js';

const HUDSON_TO_IANA: Record<string, string> = {
  AMERICA_NEW_YORK: 'America/New_York',
  ASIA_TOKYO: 'Asia/Tokyo',
  ASIA_BANGKOK: 'Asia/Bangkok',
  ASIA_KUALA_LUMPUR: 'Asia/Kuala_Lumpur',
  ASIA_SINGAPORE: 'Asia/Singapore',
  ASIA_SHANGHAI: 'Asia/Shanghai',
};

const LOCALE_TO_BCP47: Record<AppLocale, string> = {
  en: 'en-US',
  ja: 'ja-JP',
  th: 'th-TH',
  ms: 'ms-MY',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
};

export function hudsonTimeZoneToIana(code: string | undefined): string {
  if (!code) return 'America/New_York';
  return HUDSON_TO_IANA[code] || 'America/New_York';
}

export function normalizeLocale(code: string | undefined): AppLocale {
  const raw = String(code || '').trim();
  if (raw === 'en' || raw === 'en-US' || raw === 'en_US') return 'en';
  if (raw === 'ja' || raw === 'ja-JP' || raw === 'ja_JP') return 'ja';
  if (raw === 'th' || raw === 'th-TH' || raw === 'th_TH') return 'th';
  if (raw === 'ms' || raw === 'ms-MY' || raw === 'ms_MY') return 'ms';
  if (raw === 'zh-CN' || raw === 'zh_CN' || raw === 'zh') return 'zh-CN';
  if (raw === 'zh-TW' || raw === 'zh_TW') return 'zh-TW';
  return 'en';
}

export function localeToBcp47(locale: AppLocale): string {
  return LOCALE_TO_BCP47[locale];
}

export const CHANNEL_DISPLAY: Record<string, string> = {
  '1': 'Airbnb',
  '9': 'Booking.com',
  '10': 'Agoda',
  '113': 'Trip.com',
};

export function channelDisplayName(channelId: unknown, fallback?: string): string {
  const key = String(channelId ?? '');
  return CHANNEL_DISPLAY[key] || fallback || key || '-';
}
