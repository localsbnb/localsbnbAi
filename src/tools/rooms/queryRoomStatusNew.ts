import type { ToolHandler } from '../../types/mcp.js';
import { assertApiSuccess, handleError, createSuccessResult } from '../../utils/errorHandler.js';
import { resolveDateAndDaysForNaturalWeek } from '../../utils/shanghaiDate.js';
import { z } from 'zod';

// 参数验证Schema
const queryRoomStatusNewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD').optional(),
  days: z.number().int().positive().default(30),
  /** 用户说「本周」「上周」房态日历时传此字段；自然周周一至周日，勿用「从今天起 30 天」代替本周 */
  timeRange: z.enum(['this_week', 'last_week']).optional(),
  roomCategoryIds: z.array(z.number()).optional(),
  roomCategoryGroupIds: z.array(z.number()).optional(),
  channelIds: z.array(z.number()).optional(),
  searchKey: z.string().optional(),
  pageNum: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(15),
});

// API响应类型
export interface RoomStatusView {
  roomId: number;
  roomName: string;
  floorName: string;
  isDirty: number;
  isHasNotCheckOutOrder: number;
  roomCategoryId: number;
  roomCategoryName: string;
  statuses: StatusView[];
}

export interface StatusView {
  date: string;
  isBlock: number;
  isOccupation: number;
}

export interface RoomCategoryStatusesResponse {
  roomStatusViews: RoomStatusView[];
}

export interface APIResponse {
  success: boolean;
  errorCode?: string;
  errorMsg?: string;
  errorDetail?: string;
  data?: RoomCategoryStatusesResponse;
}

export const queryRoomStatusNewHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('query_room_status_new', ['rooms:read']);

    // 参数验证
    const validatedParams = queryRoomStatusNewSchema.parse(args);

    const { date, days } = resolveDateAndDaysForNaturalWeek({
      date: validatedParams.date,
      days: validatedParams.days,
      timeRange: validatedParams.timeRange,
    });

    logger.info('Querying room status (new API)', {
      date,
      days,
      timeRange: validatedParams.timeRange,
    });

    // 从context中获取campId
    const campId = context.campId;
    if (!campId) {
      throw new Error('APP_ID not configured. Please set APP_ID environment variable.');
    }

    // 调用API
    // 注意：hudson-access-token 已在HTTPClient拦截器中自动添加到header
    const response = await apiClient.request<APIResponse>({
      method: 'POST',
      url: '/roomCategoryStatuses/central/get',
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        // campId作为字符串传递
        campId: String(campId),
        date,
        days,
        roomCategoryIds: validatedParams.roomCategoryIds || null,
        roomCategoryGroupIds: validatedParams.roomCategoryGroupIds || null,
        channelIds: validatedParams.channelIds || null,
        searchKey: validatedParams.searchKey || '',
        pageNum: validatedParams.pageNum,
        pageSize: validatedParams.pageSize,
      },
    });

    assertApiSuccess(response, '房态日历价查询', 'room_status');

    logger.info('Room status queried successfully (new API)', {
      roomCount: response.data?.roomStatusViews?.length || 0,
    });

    return createSuccessResult(response.data || { roomStatusViews: [] });
  } catch (error) {
    return handleError(error);
  }
};
