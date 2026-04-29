import type { ToolHandler } from '../../types/mcp.js';
import { assertApiSuccess, handleError, createSuccessResult } from '../../utils/errorHandler.js';
import { resolveDateAndDaysForNaturalWeek } from '../../utils/shanghaiDate.js';
import { z } from 'zod';

// 参数验证Schema
const queryRoomPricesSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD').optional(),
  days: z.number().int().positive().max(30).default(7),
  /** 与「近7天」不同：本周/上周为自然周（周一至周日，上海时区），起点为当周周一、共 7 天 */
  timeRange: z.enum(['this_week', 'last_week']).optional(),
});

// API响应类型
interface RoomCategoryStatusView {
  roomCategoryId: string;
  roomCategoryName: string;
  channelRoomCategoryId: string;
  channelRoomCategoryName: string;
  channelId: string | null;
  roomCategoryMainPhotoMediaId: string;
  roomCategoryMainPhoto: string;
  roomCategoryProductId: string | null;
  seq: number;
  parentStatusViews: string[];
  centralStatusViews: Array<{
    isSupportCommission: number;
    date: string;
    price: number | null;
    basePrice: null;
    salePrice: number | null;
    storesPrice: null;
    commissionRate: number;
    isBlock: null;
    stock: null;
    isDiff: null;
  }>;
  roomCategoryStatuses: Array<{
    channelId: string;
    channelName: string;
    imageLogo: string;
    roomCategoryId: string;
    channelRoomCategoryId: string;
    channelRoomCategoryName: string;
    channelRoomCategoryMainPhotoMediaId: string;
    channelRoomCategoryMainPhoto: string;
    fromType: number;
    parentRoomCategoryProductId: string;
    channelRoomCategoryProductId: string;
    channelRoomCategoryProductName: string;
    saleType: number;
    sharePriceType: number | null;
    mealCount: null;
    accountId: string;
    accountName: string;
    channelRoomCategoryTag: {
      rateCategory: null;
      mealType: null;
    };
    isSupportCommission: number;
    commissionRate: number;
    express: string | null;
    expressType: string | null;
    expressValue: number | null;
    statusViews: Array<{
      isSupportCommission: number;
      date: string;
      price: number;
      basePrice: number;
      salePrice: number;
      storesPrice: null;
      commissionRate: number;
      isBlock: number;
      stock: number;
      isDiff: number;
    }>;
  }>;
}

interface RoomPricesResponse {
  roomCategoryInfos: RoomCategoryStatusView[];
}

interface APIResponse<T> {
  success: boolean;
  errorCode?: string;
  errorMsg?: string;
  errorDetail?: string;
  data?: T;
}

export const queryRoomPricesHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('query_room_prices', ['rooms:read']);

    // 参数验证
    const validatedParams = queryRoomPricesSchema.parse(args);

    const { date, days, anchor } = resolveDateAndDaysForNaturalWeek({
      date: validatedParams.date,
      days: validatedParams.days,
      timeRange: validatedParams.timeRange,
    });

    logger.info('Querying room prices', {
      date,
      days,
      anchor,
      timeRange: validatedParams.timeRange,
    });

    // 从context中获取campId
    const campId = context.campId;
    if (!campId) {
      throw new Error('APP_ID not configured. Please set APP_ID environment variable.');
    }

    // 调用API
    const response = await apiClient.request<APIResponse<RoomPricesResponse>>({
      method: 'POST',
      url: '/roomCategoryStatuses/roomCategory/channel/get',
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        campId: String(campId),
        roomCategoryIds: [],
        roomCategoryGroupIds: [],
        channelIds: [],
        poiIds: [],
        roomCategoryProductSaleType: 1, // 1-全日房, 2-钟点房
        date,
        days,
        isAvailability: 1, // 1-在线, 0-离线
        searchKey: '',
        accountIds: [],
        channelPoiIds: [],
        isChannelRp: '0',
        channelRoomCategoryIds: [],
      },
    });

    assertApiSuccess(response, '房价查询', 'room_price');

    logger.info('Room prices queried successfully', {
      date,
      days,
      roomCategoryCount: response.data?.roomCategoryInfos.length || 0,
    });

    return createSuccessResult({
      ...response.data,
      queryDate: date,
      queryDays: days,
      timeRange: validatedParams.timeRange,
    });
  } catch (error) {
    return handleError(error);
  }
};
