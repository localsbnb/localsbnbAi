import type { ToolHandler, ToolContext } from '../../types/mcp.js';
import { validateQueryOrdersParams } from '../../utils/validator.js';
import { handleError, createSuccessResult } from '../../utils/errorHandler.js';
import type { APIResponse, OrdersResponse } from '../../types/api.js';

export const queryOrdersHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('query_orders', ['orders:read']);

    // 参数验证
    const params = validateQueryOrdersParams(args);
    logger.info('Querying orders', params as unknown as Record<string, unknown>);

    // 调用API
    const response = await apiClient.request<APIResponse<OrdersResponse>>({
      method: 'GET',
      url: '/api/v1/orders',
      params: {
        store_id: params.storeId,
        start_date: params.startDate,
        end_date: params.endDate,
        status: params.status,
        room_type: params.roomType,
        guest_name: params.guestName,
        phone: params.phone,
        page: params.page,
        page_size: params.pageSize,
      },
    });

    logger.info('Orders queried successfully', {
      total: response.data.total,
      count: response.data.list.length,
    });

    return createSuccessResult(response.data);
  } catch (error) {
    return handleError(error);
  }
};
