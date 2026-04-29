import { z } from 'zod';
import type {
  QueryOrdersParams,
  CreateOrderParams,
  QueryRoomStatusParams,
  QueryRoomPricesParams,
  UpdateRoomPriceParams,
  BatchUpdatePricesParams,
  QueryFinancialDataParams,
  QueryOperationalDataParams,
  AnalyzeRevenueParams,
  ListChannelsParams,
  GetChannelDetailsParams,
} from '../types/tools.js';

// 日期格式验证
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD');

// 订单查询参数验证
export const queryOrdersSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
  startDate: dateSchema,
  endDate: dateSchema,
  status: z.enum(['pending', 'checked_in', 'checked_out', 'cancelled']).optional(),
  roomType: z.string().optional(),
  guestName: z.string().optional(),
  phone: z.string().optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export function validateQueryOrdersParams(args: unknown): QueryOrdersParams {
  return queryOrdersSchema.parse(args);
}

// 获取订单详情参数验证
export const getOrderDetailsSchema = z.object({
  orderId: z.string().min(1, '订单ID不能为空'),
});

export function validateGetOrderDetailsParams(args: unknown): { orderId: string } {
  return getOrderDetailsSchema.parse(args);
}

// 创建订单参数验证
export const createOrderSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
  guestName: z.string().min(1, '客人姓名不能为空'),
  phone: z.string().min(1, '手机号不能为空'),
  idCard: z.string().optional(),
  roomTypeId: z.string().min(1, '房源类型ID不能为空'),
  checkInDate: dateSchema,
  checkOutDate: dateSchema,
  totalAmount: z.number().nonnegative().optional(),
  deposit: z.number().nonnegative().optional(),
  channel: z.string().optional(),
  remark: z.string().optional(),
});

export function validateCreateOrderParams(args: unknown): CreateOrderParams {
  return createOrderSchema.parse(args);
}

// 办理入住参数验证
export const checkInOrderSchema = z.object({
  orderId: z.string().min(1, '订单ID不能为空'),
  roomId: z.string().optional(),
});

export function validateCheckInOrderParams(args: unknown): { orderId: string; roomId?: string } {
  return checkInOrderSchema.parse(args);
}

// 办理退房参数验证
export const checkOutOrderSchema = z.object({
  orderId: z.string().min(1, '订单ID不能为空'),
});

export function validateCheckOutOrderParams(args: unknown): { orderId: string } {
  return checkOutOrderSchema.parse(args);
}

// 取消订单参数验证
export const cancelOrderSchema = z.object({
  orderId: z.string().min(1, '订单ID不能为空'),
  reason: z.string().optional(),
});

export function validateCancelOrderParams(args: unknown): { orderId: string; reason?: string } {
  return cancelOrderSchema.parse(args);
}

// 查询房态参数验证
export const queryRoomStatusSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
  startDate: dateSchema,
  endDate: dateSchema,
  roomTypeId: z.string().optional(),
});

export function validateQueryRoomStatusParams(args: unknown): QueryRoomStatusParams {
  return queryRoomStatusSchema.parse(args);
}

// 查询房价参数验证
export const queryRoomPricesSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
  startDate: dateSchema,
  endDate: dateSchema,
  roomTypeId: z.string().optional(),
});

export function validateQueryRoomPricesParams(args: unknown): QueryRoomPricesParams {
  return queryRoomPricesSchema.parse(args);
}

// 更新房价参数验证
export const updateRoomPriceSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
  roomTypeId: z.string().min(1, '房源类型ID不能为空'),
  date: dateSchema,
  price: z.number().positive('价格必须大于0'),
});

export function validateUpdateRoomPriceParams(args: unknown): UpdateRoomPriceParams {
  return updateRoomPriceSchema.parse(args);
}

// 批量更新价格参数验证
export const batchUpdatePricesSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
  updates: z.array(
    z.object({
      roomTypeId: z.string().min(1, '房源类型ID不能为空'),
      date: dateSchema,
      price: z.number().positive('价格必须大于0'),
    })
  ).min(1, '至少需要一个更新项'),
});

export function validateBatchUpdatePricesParams(args: unknown): BatchUpdatePricesParams {
  return batchUpdatePricesSchema.parse(args);
}

// 查询财务数据参数验证
export const queryFinancialDataSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
  startDate: dateSchema,
  endDate: dateSchema,
  category: z.enum(['income', 'expense']).optional(),
});

export function validateQueryFinancialDataParams(args: unknown): QueryFinancialDataParams {
  return queryFinancialDataSchema.parse(args);
}

// 查询经营数据参数验证
export const queryOperationalDataSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
  startDate: dateSchema,
  endDate: dateSchema,
  type: z.enum(['accommodation', 'voucher']).optional(),
});

export function validateQueryOperationalDataParams(args: unknown): QueryOperationalDataParams {
  return queryOperationalDataSchema.parse(args);
}

// 收益分析参数验证
export const analyzeRevenueSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
  startDate: dateSchema,
  endDate: dateSchema,
  forecastDays: z.number().int().positive().max(30).default(7),
});

export function validateAnalyzeRevenueParams(args: unknown): AnalyzeRevenueParams {
  return analyzeRevenueSchema.parse(args);
}

// 获取渠道列表参数验证
export const listChannelsSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
});

export function validateListChannelsParams(args: unknown): ListChannelsParams {
  return listChannelsSchema.parse(args);
}

// 获取渠道详情参数验证
export const getChannelDetailsSchema = z.object({
  storeId: z.string().min(1, '店铺ID不能为空'),
  channelId: z.string().min(1, '渠道ID不能为空'),
});

export function validateGetChannelDetailsParams(args: unknown): GetChannelDetailsParams {
  return getChannelDetailsSchema.parse(args);
}
