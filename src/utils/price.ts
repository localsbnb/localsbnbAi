/**
 * 路客云订单相关接口金额单位为「分」，展示给用户时需转为「元」。
 */
export function fenToYuanString(value: number | undefined | null): string {
  if (value == null || Number.isNaN(Number(value))) return '0.00';
  return (Number(value) / 100).toFixed(2);
}
