// 路客云REST API相关类型定义

export interface APIError {
  code: number;
  message: string;
  details?: unknown;
}

// 通用API响应格式
export interface APIResponse<T = unknown> {
  code: number;
  message?: string;
  data: T;
}

export interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

// 订单API响应
export interface OrdersResponse {
  list: OrderResponse[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OrderResponse {
  orderId: string;
  orderNo: string;
  guestName: string;
  phone: string;
  roomType: string;
  roomTypeName?: string;
  checkInDate: string;
  checkOutDate: string;
  nights?: number;
  status: string;
  totalAmount: number;
  paidAmount: number;
  deposit?: number;
  arrears?: number;
  channel?: string;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
}

// 房态API响应
export interface RoomStatusResponse {
  roomTypes: RoomTypeStatus[];
}

export interface RoomTypeStatus {
  roomTypeId: string;
  roomTypeName: string;
  rooms: RoomStatus[];
}

export interface RoomStatus {
  roomId: string;
  roomName: string;
  status: 'available' | 'occupied' | 'dirty' | 'maintenance';
  orders: OrderResponse[];
}

// 房价API响应
export interface RoomPricesResponse {
  prices: RoomPrice[];
}

export interface RoomPrice {
  date: string;
  roomTypeId: string;
  roomTypeName: string;
  price: number;
  available: number;
}

// 财务数据API响应
export interface FinancialDataResponse {
  totalIncome: number;
  totalExpense: number;
  profit: number;
  items: FinancialItem[];
}

export interface FinancialItem {
  date: string;
  category: string;
  amount: number;
  description: string;
}

// 经营数据API响应
export interface OperationalDataResponse {
  totalOrders: number;
  totalRevenue: number;
  averagePrice: number;
  occupancyRate: number;
  revpar: number;
  dailyData: DailyData[];
}

export interface DailyData {
  date: string;
  orders: number;
  revenue: number;
  occupancyRate: number;
}

// 收益分析API响应
export interface RevenueAnalysisResponse {
  historical: {
    totalRevenue: number;
    averageDailyRevenue: number;
    trend: 'up' | 'down' | 'stable';
  };
  forecast: {
    predictedRevenue: number;
    confidence: number;
    factors: string[];
  };
  recommendations: string[];
}

// 渠道API响应
export interface ChannelsResponse {
  channels: ChannelResponse[];
}

export interface ChannelResponse {
  channelId: string;
  channelName: string;
  channelType: 'ota' | 'device' | 'private';
  status: 'connected' | 'disconnected';
  connectedAt?: string;
  roomTypes: ChannelRoomType[];
}

export interface ChannelRoomType {
  roomTypeId: string;
  roomTypeName: string;
  synced: boolean;
}
