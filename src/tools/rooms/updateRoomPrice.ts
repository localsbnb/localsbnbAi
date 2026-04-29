import type { ToolHandler, ToolContext } from '../../types/mcp.js';
import { validateUpdateRoomPriceParams } from '../../utils/validator.js';
import { handleError, createSuccessResult } from '../../utils/errorHandler.js';
import type { APIResponse } from '../../types/api.js';

export const updateRoomPriceHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('update_room_price', ['rooms:write']);

    // 参数验证
    const params = validateUpdateRoomPriceParams(args);
    logger.info('Updating room price', {
      roomTypeId: params.roomTypeId,
      date: params.date,
      price: params.price,
    });

    // 调用API
    const response = await apiClient.request<APIResponse<{ roomTypeId: string; date: string; price: number }>>({
      method: 'PUT',
      url: '/api/v1/rooms/prices',
      data: {
        store_id: params.storeId,
        room_type_id: params.roomTypeId,
        date: params.date,
        price: params.price,
      },
    });

    logger.info('Room price updated successfully', {
      roomTypeId: params.roomTypeId,
      date: params.date,
    });

    return createSuccessResult({
      message: '价格更新成功',
      ...response.data,
    });
  } catch (error) {
    return handleError(error);
  }
};
