import type { ToolHandler } from '../../types/mcp.js';
import { handleError } from '../../utils/errorHandler.js';
import { z } from 'zod';
import { fetchOrdersByType, formatOrderList } from './ordersGetShared.js';

const schema = z.object({
  pageNum: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().default(10),
  keyword: z.string().default(''),
});

export const queryPreDepartureOrdersHandler: ToolHandler = async (args, context) => {
  try {
    const { logger, permissionChecker } = context;
    permissionChecker.checkPermission('query_pre_departure_orders', ['orders:read']);
    const params = schema.parse(args);
    const data = await fetchOrdersByType(context, '12', params.pageNum, params.pageSize, params.keyword);
    logger.info('Pre-departure orders queried', {
      total: data.total,
      returned: data.list.length,
      pageNum: params.pageNum,
      pageSize: params.pageSize,
    });
    return {
      content: [
        {
          type: 'text',
          text: formatOrderList('预离订单（今日待退房）', data.list, data.total, params.pageNum, params.pageSize),
        },
      ],
    };
  } catch (error) {
    return handleError(error);
  }
};
