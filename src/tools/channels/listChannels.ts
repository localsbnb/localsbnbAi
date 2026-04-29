import type { ToolHandler, ToolContext } from '../../types/mcp.js';
import { validateListChannelsParams } from '../../utils/validator.js';
import { handleError, createSuccessResult } from '../../utils/errorHandler.js';
import type { APIResponse, ChannelsResponse } from '../../types/api.js';

export const listChannelsHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('list_channels', ['channels:read']);

    // 参数验证
    const params = validateListChannelsParams(args);
    logger.info('Listing channels', { storeId: params.storeId });

    // TODO: 调用路客云REST API
    // 待提供API接口文档后实现具体调用逻辑
    const response = await apiClient.request<APIResponse<ChannelsResponse>>({
      method: 'GET',
      url: '/api/v1/channels',
      params: {
        store_id: params.storeId,
      },
    });

    logger.info('Channels listed successfully', {
      channelCount: response.data.channels.length,
    });

    return createSuccessResult(response.data);
  } catch (error) {
    return handleError(error);
  }
};
