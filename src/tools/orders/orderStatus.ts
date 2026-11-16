import { z } from 'zod';

// Hudson EnumOrder.EnumOrderState and EnumOrderDetail.EnumOrderDetailState.
export const orderStatusFilterSchema = z.enum(['active', 'cancelled', 'all']).default('active');
export type OrderStatusFilter = z.infer<typeof orderStatusFilterSchema>;
const cancelledStates = [5, 7, 8, 9, 10];
const nonCancelledStates = [0, 1, 2, 3, 4, 6, 11, 12, 13, 14, 15];
export function orderStatusFilters(status: OrderStatusFilter = 'active') {
  if (status === 'all') return {};
  if (status === 'cancelled') return { orderStates: cancelledStates };
  return { orderStates: nonCancelledStates, orderDetailStates: [0, 1, 2, 3, 5] };
}
const names: Record<number, [string, string]> = {
  0: ['临时态', 'Draft'], 1: ['待处理', 'Pending'], 2: ['已预订', 'Reserved'],
  3: ['进行中', 'In progress'], 4: ['已完成', 'Completed'], 5: ['已取消', 'Cancelled'],
  6: ['待支付', 'Unpaid'], 7: ['已取消（支付超时）', 'Cancelled (payment timeout)'],
  8: ['已取消（拒绝预订）', 'Cancelled (reservation refused)'],
  9: ['已取消（库存不足）', 'Cancelled (insufficient inventory)'],
  10: ['已取消（少付）', 'Cancelled (underpayment)'], 11: ['待取消', 'Cancellation pending'],
  12: ['接受中', 'Acceptance pending'], 13: ['拒绝中', 'Refusal pending'],
  14: ['咨询中', 'Inquiry'], 15: ['预留', 'Hold'],
};
export function orderStateLabel(state: unknown, locale = 'zh-CN'): string {
  const value = state == null || state === '' ? undefined : names[Number(state)];
  return value ? value[locale.startsWith('zh') ? 0 : 1] : (locale.startsWith('zh') ? '状态未知' : 'Unknown status');
}
