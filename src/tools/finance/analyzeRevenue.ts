import type { ToolHandler, ToolContext } from '../../types/mcp.js';
import { validateAnalyzeRevenueParams } from '../../utils/validator.js';
import { handleError, createSuccessResult } from '../../utils/errorHandler.js';
import type { APIResponse, RevenueAnalysisResponse } from '../../types/api.js';

export const analyzeRevenueHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('analyze_revenue', ['finance:read']);

    // 参数验证
    const params = validateAnalyzeRevenueParams(args);
    logger.info('Analyzing revenue', params as unknown as Record<string, unknown>);

    // TODO: 调用路客云REST API
    // 待提供API接口文档后实现具体调用逻辑
    const response = await apiClient.request<APIResponse<RevenueAnalysisResponse>>({
      method: 'GET',
      url: '/api/v1/finance/analyze',
      params: {
        store_id: params.storeId,
        start_date: params.startDate,
        end_date: params.endDate,
        forecast_days: params.forecastDays,
      },
    });

    logger.info('Revenue analysis completed');

    return createSuccessResult(response.data);
  } catch (error) {
    return handleError(error);
  }
};
