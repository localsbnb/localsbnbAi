import type { ToolHandler, ToolContext } from '../../types/mcp.js';
import { validateGetOrderDetailsParams } from '../../utils/validator.js';
import { handleError, createSuccessResult } from '../../utils/errorHandler.js';
import type { APIResponse, OrderResponse } from '../../types/api.js';

export const getOrderDetailsHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('get_order_details', ['orders:read']);

    // 参数验证
    const params = validateGetOrderDetailsParams(args);
    logger.info('Getting order details', { orderId: params.orderId });

    // 调用API
    const response = await apiClient.request<APIResponse<OrderResponse>>({
      method: 'GET',
      url: `/api/v1/orders/${params.orderId}`,
    });

    logger.info('Order details retrieved', { orderId: params.orderId });

    return createSuccessResult(response.data);
  } catch (error) {
    return handleError(error);
  }
};
