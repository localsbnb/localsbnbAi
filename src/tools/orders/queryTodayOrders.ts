import type { ToolHandler } from '../../types/mcp.js';
import { handleError } from '../../utils/errorHandler.js';
import { z } from 'zod';
import { fetchOrdersByType, formatOrderList } from './ordersGetShared.js';

const schema = z.object({
  pageNum: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().default(10),
  keyword: z.string().default(''),
});

export const queryTodayOrdersHandler: ToolHandler = async (args, context) => {
  try {
    const { logger, permissionChecker } = context;
    permissionChecker.checkPermission('query_today_orders', ['orders:read']);
    const params = schema.parse(args);

    const [preArrival, inHouse, preDeparture] = await Promise.all([
      fetchOrdersByType(context, '11', params.pageNum, params.pageSize, params.keyword),
      fetchOrdersByType(context, '10', params.pageNum, params.pageSize, params.keyword),
      fetchOrdersByType(context, '12', params.pageNum, params.pageSize, params.keyword),
    ]);

    logger.info('Today orders queried by 3 groups', {
      preArrivalTotal: preArrival.total,
      inHouseTotal: inHouse.total,
      preDepartureTotal: preDeparture.total,
      pageNum: params.pageNum,
      pageSize: params.pageSize,
    });

    const blocks = [
      '今日订单情况（由预抵/在住/预离三组组成）',
      `合计总数：${preArrival.total + inHouse.total + preDeparture.total}`,
      '',
      formatOrderList('一、预抵订单（orderType=11）', preArrival.list, preArrival.total, params.pageNum, params.pageSize),
      '',
      formatOrderList('二、在住订单（orderType=10）', inHouse.list, inHouse.total, params.pageNum, params.pageSize),
      '',
      formatOrderList(
        '三、预离订单（orderType=12）',
        preDeparture.list,
        preDeparture.total,
        params.pageNum,
        params.pageSize
      ),
    ];

    return {
      content: [
        {
          type: 'text',
          text: blocks.join('\n'),
        },
      ],
    };
  } catch (error) {
    return handleError(error);
  }
};
