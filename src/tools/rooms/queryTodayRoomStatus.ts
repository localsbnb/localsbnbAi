import type { ToolHandler } from '../../types/mcp.js';
import { assertApiSuccess, handleError, createSuccessResult } from '../../utils/errorHandler.js';
import { desensitizeRoomStatusItem } from '../../utils/desensitize.js';
import { z } from 'zod';

// 参数验证Schema
const queryTodayRoomStatusSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD').optional(),
});

// API响应类型
interface RoomStatusTodayResponse {
  basic: {
    roomNum: number;
    soldNum: number;
    liveNum: number;
    idleNum: number;
    occNum: number;
    occ: number;
    idleCleanNum: number;
    idleDirtyNum: number;
    liveCleanNum: number;
    liveDirtyNum: number;
  };
  roomCategories: Array<{
    roomCategoryId: string;
    roomCategoryName: string;
    roomCategoryMainPhotoMediaId: number;
    rooms: Array<{
      roomId: string;
      roomName: string;
      isDirty: number;
      roomCategoryId: string;
      isOcc: number;
      isLive: number;
      isIdle: number;
      isPreCome: number;
      isPreLeave: number;
      isArrangeSameRoom: number;
      occupationType: number | null;
      occupationRemark: string | null;
      guestName: string;
      orders: Array<{
        channelId: string;
        orderChannelId: string;
        orderId: string;
        isOta: number;
        isLt: number;
        guestNum: number;
        checkinGuestNum: number;
        guestMobile: string | null;
        guestName: string;
        orderState: number;
        orderDetailId: string;
        orderDetailState: number;
        orderDetailDisplayState: number;
        saleType: number;
        checkInDate: string;
        checkOutDate: string;
        currency: string;
        orderPrice: number;
        orderTotalPrice: number;
        orderTotalPayPrice: number;
        remark: string;
        isMultiOrderDetail: number;
        orderTags: Array<{
          orderTagId: string;
          orderTagName: string;
        }>;
        expectCheckInTime: number;
        expectCheckInTimeStr: string | null;
        expectCheckOutTime: number;
        expectCheckOutTimeStr: string | null;
      }>;
    }>;
    roomNum: number;
    soldNum: number;
    liveNum: number;
    idleNum: number;
    occNum: number;
  }>;
}

interface APIResponse<T> {
  success: boolean;
  errorCode?: string;
  errorMsg?: string;
  errorDetail?: string;
  data?: T;
}

export const queryTodayRoomStatusHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('query_today_room_status', ['rooms:read']);

    // 参数验证
    const validatedParams = queryTodayRoomStatusSchema.parse(args);
    
    // 如果没有提供date，使用当天日期（基于中国时区 Asia/Shanghai，确保与路客云 API 一致）
    const date = validatedParams.date || new Date().toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
    
    // 将日期转换为时间戳：必须是一天的开始（中国时区 UTC+8 的 00:00:00）
    // new Date('YYYY-MM-DD') 会被解析为 UTC 午夜，在中国是 08:00，不符合 API 要求
    const dateTimestamp = new Date(`${date}T00:00:00+08:00`).getTime();
    
    logger.info('Querying today room status', { date });

    // 从context中获取campId
    const campId = context.campId;
    if (!campId) {
      throw new Error('APP_ID not configured. Please set APP_ID environment variable.');
    }

    // 调用API
    const response = await apiClient.request<APIResponse<RoomStatusTodayResponse>>({
      method: 'POST',
      url: '/roomStatusesToday/get',
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        campId: String(campId),
        channelIds: null,
        roomCategoryGroupIds: [],
        roomCategoryIds: [],
        poiIds: [],
        date: dateTimestamp,
        isShowIdleClean: 0,
        isShowIdleDirty: 0,
        isShowLiveClean: 0,
        isShowLiveDirty: 0,
        isShowOcc: 0,
        isShowAll: 1,
        isAvailability: null,
        roomCategoryType: null,
      },
    });

    assertApiSuccess(response, '今日房态查询', 'room_status');

    logger.info('Today room status queried successfully', {
      date,
      roomCategoriesCount: response.data?.roomCategories.length || 0,
    });

    const data = response.data;
    const roomCategories = data?.roomCategories?.map((cat: Record<string, unknown>) => ({
      ...cat,
      rooms: Array.isArray(cat.rooms) ? (cat.rooms as Record<string, unknown>[]).map(desensitizeRoomStatusItem) : cat.rooms,
    })) ?? data?.roomCategories;

    return createSuccessResult({
      ...data,
      roomCategories,
      queryDate: date,
    });
  } catch (error) {
    return handleError(error);
  }
};
