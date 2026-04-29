import type { ToolHandler, ToolContext } from '../../types/mcp.js';
import { validateGetChannelDetailsParams } from '../../utils/validator.js';
import { handleError, createSuccessResult } from '../../utils/errorHandler.js';
import type { APIResponse, ChannelResponse } from '../../types/api.js';

export const getChannelDetailsHandler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('get_channel_details', ['channels:read']);

    // 参数验证
    const params = validateGetChannelDetailsParams(args);
    logger.info('Getting channel details', {
      storeId: params.storeId,
      channelId: params.channelId,
    });

    // TODO: 调用路客云REST API
    // 待提供API接口文档后实现具体调用逻辑
    const response = await apiClient.request<APIResponse<ChannelResponse>>({
      method: 'GET',
      url: `/api/v1/channels/${params.channelId}`,
      params: {
        store_id: params.storeId,
      },
    });

    logger.info('Channel details retrieved', { channelId: params.channelId });

    return createSuccessResult(response.data);
  } catch (error) {
    return handleError(error);
  }
};
