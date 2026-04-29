// 订单相关类型
export interface QueryOrdersParams {
  storeId: string;
  startDate: string;
  endDate: string;
  status?: 'pending' | 'checked_in' | 'checked_out' | 'cancelled';
  roomType?: string;
  guestName?: string;
  phone?: string;
  page?: number;
  pageSize?: number;
}

export interface Order {
  orderId: string;
  orderNo: string;
  guestName: string;
  phone: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  status: string;
  totalAmount: number;
  paidAmount: number;
}

export interface CreateOrderParams {
  storeId: string;
  guestName: string;
  phone: string;
  idCard?: string;
  roomTypeId: string;
  checkInDate: string;
  checkOutDate: string;
  totalAmount?: number;
  deposit?: number;
  channel?: string;
  remark?: string;
}

// 房态相关类型
export interface QueryRoomStatusParams {
  storeId: string;
  startDate: string;
  endDate: string;
  roomTypeId?: string;
}

export interface QueryRoomPricesParams {
  storeId: string;
  startDate: string;
  endDate: string;
  roomTypeId?: string;
}

export interface UpdateRoomPriceParams {
  storeId: string;
  roomTypeId: string;
  date: string;
  price: number;
}

export interface BatchUpdatePricesParams {
  storeId: string;
  updates: Array<{
    roomTypeId: string;
    date: string;
    price: number;
  }>;
}

// 财务相关类型
export interface QueryFinancialDataParams {
  storeId: string;
  startDate: string;
  endDate: string;
  category?: 'income' | 'expense';
}

export interface QueryOperationalDataParams {
  storeId: string;
  startDate: string;
  endDate: string;
  type?: 'accommodation' | 'voucher';
}

export interface AnalyzeRevenueParams {
  storeId: string;
  startDate: string;
  endDate: string;
  forecastDays?: number;
}

// 渠道相关类型
export interface ListChannelsParams {
  storeId: string;
}

export interface GetChannelDetailsParams {
  storeId: string;
  channelId: string;
}

// API响应类型
export interface APIResponse<T = unknown> {
  code: number;
  message?: string;
  data: T;
}
