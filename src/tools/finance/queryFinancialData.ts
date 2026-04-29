import type { ToolHandler, ToolContext } from '../../types/mcp.js';
import { validateQueryFinancialDataParams } from '../../utils/validator.js';
import { handleError, createSuccessResult } from '../../utils/errorHandler.js';
import type { APIResponse, FinancialDataResponse } from '../../types/api.js';

export const queryFinancialDataHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('query_financial_data', ['finance:read']);

    // 参数验证
    const params = validateQueryFinancialDataParams(args);
    logger.info('Querying financial data', params as unknown as Record<string, unknown>);

    // TODO: 调用路客云REST API
    // 待提供API接口文档后实现具体调用逻辑
    const response = await apiClient.request<APIResponse<FinancialDataResponse>>({
      method: 'GET',
      url: '/api/v1/finance/data',
      params: {
        store_id: params.storeId,
        start_date: params.startDate,
        end_date: params.endDate,
        category: params.category,
      },
    });

    logger.info('Financial data queried successfully');

    return createSuccessResult(response.data);
  } catch (error) {
    return handleError(error);
  }
};
