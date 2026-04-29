import type { ToolHandler } from '../../types/mcp.js';
import { handleError } from '../../utils/errorHandler.js';
import { getLastWeekRange, getThisWeekRange, getTodayShanghai } from '../../utils/shanghaiDate.js';
import { z } from 'zod';
import { fetchOrdersByDateRange, formatOrderList } from './ordersGetShared.js';

const dateStrSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期须为 YYYY-MM-DD');

const schema = z
  .object({
    startDate: dateStrSchema.optional(),
    endDate: dateStrSchema.optional(),
    timeRange: z.enum(['this_week', 'last_week']).optional(),
    date: dateStrSchema.optional(),
    pageNum: z.number().int().positive().default(1),
    pageSize: z.number().int().positive().default(10),
  })
  .superRefine((data, ctx) => {
    const hasExplicit = data.startDate != null || data.endDate != null;
    if (hasExplicit && data.timeRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '不要同时传入 timeRange 与 startDate/endDate',
      });
    }
  });

function resolveQueryDateRange(args: {
  startDate?: string;
  endDate?: string;
  timeRange?: 'this_week' | 'last_week';
  date?: string;
}): { startDate: string; endDate: string } {
  if (args.timeRange === 'this_week') {
    const anchor = args.date ?? getTodayShanghai();
    const r = getThisWeekRange(anchor);
    return { startDate: r.start, endDate: r.end };
  }
  if (args.timeRange === 'last_week') {
    const anchor = args.date ?? getTodayShanghai();
    const r = getLastWeekRange(anchor);
    return { startDate: r.start, endDate: r.end };
  }

  const today = getTodayShanghai();
  const s = args.startDate;
  const e = args.endDate;
  if (!s && !e) return { startDate: today, endDate: today };
  if (s && !e) return { startDate: s, endDate: s };
  if (!s && e) return { startDate: e, endDate: e };
  const start = s!;
  const end = e!;
  if (start > end) return { startDate: end, endDate: start };
  return { startDate: start, endDate: end };
}

export const queryOrdersByDateRangeHandler: ToolHandler = async (args, context) => {
  try {
    const { logger, permissionChecker } = context;
    permissionChecker.checkPermission('query_orders_by_date_range', ['orders:read']);
    const params = schema.parse(args);
    const range = resolveQueryDateRange(params);
    const data = await fetchOrdersByDateRange(
      context,
      range.startDate,
      range.endDate,
      params.pageNum,
      params.pageSize
    );
    const rangeLabel =
      range.startDate === range.endDate ? range.startDate : `${range.startDate} ~ ${range.endDate}`;
    logger.info('Orders by date range queried', {
      startDate: range.startDate,
      endDate: range.endDate,
      total: data.total,
      returned: data.list.length,
      pageNum: params.pageNum,
      pageSize: params.pageSize,
    });

    return {
      content: [
        {
          type: 'text',
          text: formatOrderList(`订单查询（日期范围：${rangeLabel}）`, data.list, data.total, params.pageNum, params.pageSize),
        },
      ],
    };
  } catch (error) {
    return handleError(error);
  }
};
