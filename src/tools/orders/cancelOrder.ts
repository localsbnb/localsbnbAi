import type { ToolHandler, ToolContext } from '../../types/mcp.js';
import { validateCancelOrderParams } from '../../utils/validator.js';
import { handleError, createSuccessResult } from '../../utils/errorHandler.js';
import type { APIResponse } from '../../types/api.js';

export const cancelOrderHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('cancel_order', ['orders:write']);

    // 参数验证
    const params = validateCancelOrderParams(args);
    logger.info('Cancelling order', { orderId: params.orderId, reason: params.reason });

    // 调用API
    const response = await apiClient.request<APIResponse<{ orderId: string; status: string }>>({
      method: 'POST',
      url: `/api/v1/orders/${params.orderId}/cancel`,
      data: params.reason ? { reason: params.reason } : {},
    });

    logger.info('Order cancelled successfully', { orderId: params.orderId });

    return createSuccessResult({
      message: '订单已取消',
      ...response.data,
    });
  } catch (error) {
    return handleError(error);
  }
};
