import type { ToolContext } from '../../types/mcp.js';
import { assertApiSuccess } from '../../utils/errorHandler.js';
import { desensitizeOrderItem } from '../../utils/desensitize.js';
import { fenToYuanString } from '../../utils/price.js';

export interface OrderItem {
  orderId: number;
  orderDetailId: number;
  channelName: string;
  guestName: string;
  channelGuestName?: string;
  urgencyGuestName?: string;
  roomCategoryName: string;
  roomName: string;
  checkInDateStr: string;
  checkOutDateStr: string;
  reduceCommissionRoomPrice: number;
  invoicePrice: number;
  totalPrice: number;
  totalPayPrice: number;
  orderDetailPrices?: Array<{
    paymentTypeName: string;
    price: number;
    isPayout: number;
  }>;
}

interface OrdersGetResponse {
  list: OrderItem[];
  total: number;
}

interface APIResponse<T> {
  success: boolean;
  errorCode?: string;
  errorMsg?: string;
  errorDetail?: string;
  data?: T;
}

export function toShanghaiTimestampStart(date: string): number {
  return new Date(`${date}T00:00:00+08:00`).getTime();
}

export async function fetchOrdersByType(
  context: ToolContext,
  orderType: '10' | '11' | '12',
  pageNum = 1,
  pageSize = 10,
  keyword = ''
): Promise<{ list: OrderItem[]; total: number }> {
  const { apiClient } = context;
  const campId = context.campId;
  if (!campId) throw new Error('APP_ID not configured. Please set APP_ID environment variable.');

  const response = await apiClient.request<APIResponse<OrdersGetResponse>>({
    method: 'POST',
    url: '/orders/get',
    headers: { 'Content-Type': 'application/json' },
    data: {
      campId: String(campId),
      orderType,
      pageNum,
      keyword,
      pageSize,
    },
  });

  assertApiSuccess(response, '订单查询', 'orders');
  const list = (response.data?.list || []).map(desensitizeOrderItem);
  const total = Number(response.data?.total ?? list.length) || 0;
  return { list, total };
}

export async function fetchOrdersByDateRange(
  context: ToolContext,
  startDate: string,
  endDate: string,
  pageNum = 1,
  pageSize = 10
): Promise<{ list: OrderItem[]; total: number }> {
  const { apiClient } = context;
  const campId = context.campId;
  if (!campId) throw new Error('APP_ID not configured. Please set APP_ID environment variable.');

  const response = await apiClient.request<APIResponse<OrdersGetResponse>>({
    method: 'POST',
    url: '/orders/get',
    headers: { 'Content-Type': 'application/json' },
    data: {
      campId: String(campId),
      pageNum,
      pageSize,
      checkInDate: toShanghaiTimestampStart(startDate),
      checkOutDate: toShanghaiTimestampStart(endDate),
    },
  });

  assertApiSuccess(response, '订单查询', 'orders');
  const list = (response.data?.list || []).map(desensitizeOrderItem);
  const total = Number(response.data?.total ?? list.length) || 0;
  return { list, total };
}

function sumDepositFen(order: OrderItem): number {
  if (!order.orderDetailPrices?.length) return 0;
  return order.orderDetailPrices.reduce((sum, line) => {
    const name = String(line.paymentTypeName || '');
    if (!name.includes('押金') && !name.includes('定金') && !/deposit/i.test(name)) return sum;
    return sum + (Number(line.price) || 0);
  }, 0);
}

function pickGuestName(order: OrderItem): string {
  return [order.guestName, order.channelGuestName, order.urgencyGuestName]
    .map((s) => String(s || '').trim())
    .find((s) => s.length > 0) || '-';
}

export function formatOrderList(
  title: string,
  list: OrderItem[],
  total: number,
  pageNum = 1,
  pageSize = 10
): string {
  const lines: string[] = [];
  lines.push(title);
  lines.push(`总数：${total}；当前页：${pageNum}；当前返回：${list.length}（pageSize=${pageSize}）`);
  if (!list.length) {
    lines.push('当前无数据');
    return lines.join('\n');
  }

  for (const [idx, order] of list.entries()) {
    lines.push(
      `${idx + 1}. 订单ID：${order.orderId}｜明细ID：${order.orderDetailId}｜客人：${pickGuestName(order)}｜` +
        `渠道：${order.channelName || '-'}｜房型：${order.roomCategoryName || '-'}｜房间：${order.roomName || '-'}｜` +
        `入离：${order.checkInDateStr || '-'} ~ ${order.checkOutDateStr || '-'}｜` +
        `房费减佣：${fenToYuanString(order.reduceCommissionRoomPrice)}｜佣金：${fenToYuanString(order.invoicePrice)}｜` +
        `押金：${fenToYuanString(sumDepositFen(order))}｜总收入：${fenToYuanString(order.totalPrice)}｜实付：${fenToYuanString(order.totalPayPrice)}`
    );
  }
  return lines.join('\n');
}
