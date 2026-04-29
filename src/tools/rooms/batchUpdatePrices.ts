import type { ToolHandler } from '../../types/mcp.js';
import { validateBatchUpdatePricesParams } from '../../utils/validator.js';
import { handleError, createSuccessResult } from '../../utils/errorHandler.js';
import type { APIResponse } from '../../types/api.js';

export const batchUpdatePricesHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('batch_update_prices', ['rooms:write']);

    // 参数验证
    const params = validateBatchUpdatePricesParams(args);
    logger.info('Batch updating prices', {
      storeId: params.storeId,
      updateCount: params.updates.length,
    });

    // 调用API
    const response = await apiClient.request<APIResponse<{ successCount: number; failedCount: number; failedItems: unknown[] }>>({
      method: 'POST',
      url: '/api/v1/rooms/prices/batch',
      data: {
        store_id: params.storeId,
        updates: params.updates.map((update) => ({
          room_type_id: update.roomTypeId,
          date: update.date,
          price: update.price,
        })),
      },
    });

    logger.info('Prices batch updated', {
      successCount: response.data.successCount,
      failedCount: response.data.failedCount,
    });

    return createSuccessResult({
      message: '批量更新完成',
      ...response.data,
    });
  } catch (error) {
    return handleError(error);
  }
};
