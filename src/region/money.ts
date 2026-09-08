const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND']);

export function formatFen(value: number | undefined | null, currency: string): string {
  if (value == null || Number.isNaN(Number(value))) {
    const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
    return `${currency} ${(0).toFixed(digits)}`;
  }
  const major = Number(value) / 100;
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  return `${currency} ${major.toFixed(digits)}`;
}
