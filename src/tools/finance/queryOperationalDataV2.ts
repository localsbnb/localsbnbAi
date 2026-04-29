import type { ToolHandler } from '../../types/mcp.js';
import {
  assertApiSuccess,
  handleError,
  createSuccessResult,
  MCPError,
  ErrorCode,
} from '../../utils/errorHandler.js';
import { getLastWeekRange, getThisWeekRange, getTodayShanghai } from '../../utils/shanghaiDate.js';
import { z } from 'zod';

// 参数验证Schema
const queryOperationalDataV2Schema = z
  .object({
    /** 锚定日期：单天查询或「本周/上周」的参照日，默认上海当天 */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD').optional(),
    /** 自定义统计区间起止（与 timeRange 互斥） */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** 本周/上周（自然周 周一～周日，Asia/Shanghai）；与 startDate/endDate 互斥 */
    timeRange: z.enum(['this_week', 'last_week']).optional(),
  })
  .superRefine((data, ctx) => {
    const hasStart = data.startDate != null;
    const hasEnd = data.endDate != null;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startDate 与 endDate 必须同时传入或同时省略',
      });
    }
    if (hasStart && hasEnd && data.timeRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '不要同时传入 timeRange 与 startDate/endDate',
      });
    }
    if (hasStart && hasEnd && data.startDate! > data.endDate!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startDate 不能晚于 endDate',
      });
    }
  });

// API响应类型
interface NightAuditPageGetResponse {
  list: Array<{
    orderNightAuditId: number;
    businessDate: string;
    nightAuditTime: string;
    nightAuditStatus: number;
    nightAuditFailReason: string;
    operationUserName: string;
  }>;
  total: number;
  current: number;
  size: number;
}

interface ReportHomePageV2Response {
  nowPredictCheckIn: number;
  nowAlreadyCheckIn: number;
  nowPredictCheckOut: number;
  nowOnSaleNum: number;
  userBusyRepairNum: number;
  dirtyNum: number;
  exceptionOrderNum: number;
  nowIncome: number;
}

interface AccommodationManagementAnalysisResponse {
  writeDownIncome: string;
  businessIncome: string;
  predictTotalBusinessIncome: string;
  predictForwardBusinessIncome: string;
  roomFeePriceIncludingCommission: string;
  hourRoomFeePriceIncludingCommission: string;
  otherOrderExpense: string;
  occ: string;
  adr: string;
  revPar: string;
  openRoomCount: string;
  roomCount: string;
  allDayOpenRoomCount: string;
  hourOpenRoomCount: string;
  growthTrendAnalysisList: Array<{
    date: string;
    businessIncome: number;
    roomFeePriceIncludingCommission: number;
    otherOrderExpense: number;
    writeDownIncome: number;
    occ: number;
    adr: number;
    revPar: number;
    openRoomCount: number;
  }>;
  orderOriginAnalysisList: Array<{
    channelId: string;
    channelName: string;
    orderCount: number;
  }>;
  orderTotalCount: number;
  allDayRoomFeePriceIncludingCommission: number;
}

interface APIResponse<T> {
  success: boolean;
  errorCode?: string;
  errorMsg?: string;
  errorDetail?: string;
  data?: T;
}

interface MergedOperationalData {
  nightAudit: NightAuditPageGetResponse;
  homePage: ReportHomePageV2Response;
  managementAnalysis: AccommodationManagementAnalysisResponse;
  /** 经营分析/夜审使用的区间起点（含） */
  queryDate: string;
  /** 经营分析/夜审使用的区间终点（含） */
  queryEndDate: string;
}

export const queryOperationalDataV2Handler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('query_operational_data_v2', ['finance:read']);

    // 参数验证
    const validatedParams = queryOperationalDataV2Schema.parse(args);

    const anchor = validatedParams.date ?? getTodayShanghai();
    let analysisStart: string;
    let analysisEnd: string;

    if (validatedParams.startDate && validatedParams.endDate) {
      analysisStart = validatedParams.startDate;
      analysisEnd = validatedParams.endDate;
    } else if (validatedParams.timeRange === 'this_week') {
      const r = getThisWeekRange(anchor);
      analysisStart = r.start;
      analysisEnd = r.end;
    } else if (validatedParams.timeRange === 'last_week') {
      const r = getLastWeekRange(anchor);
      analysisStart = r.start;
      analysisEnd = r.end;
    } else {
      analysisStart = anchor;
      analysisEnd = anchor;
    }

    if (analysisStart > analysisEnd) {
      throw new MCPError(ErrorCode.INVALID_PARAMS, '查询区间无效：起始日晚于结束日');
    }

    logger.info('Querying operational data (v2)', {
      anchor,
      analysisStart,
      analysisEnd,
      timeRange: validatedParams.timeRange,
    });

    // 从context中获取campId
    const campId = context.campId;
    if (!campId) {
      throw new Error('APP_ID not configured. Please set APP_ID environment variable.');
    }

    // 并行调用三个接口
    const [nightAuditResponse, homePageResponse, managementAnalysisResponse] = await Promise.all([
      // 1. 夜审分页接口
      apiClient.request<APIResponse<NightAuditPageGetResponse>>({
        method: 'POST',
        url: '/nightAudit/page/get',
        headers: {
          'Content-Type': 'application/json',
        },
        data: {
          campId: String(campId),
          beginBusinessDate: analysisStart,
          endBusinessDate: analysisEnd,
        },
      }),
      // 2. 首页报表v2接口
      apiClient.request<APIResponse<ReportHomePageV2Response>>({
        method: 'POST',
        url: '/report/homePage/v2',
        headers: {
          'Content-Type': 'application/json',
        },
        data: {
          campId: String(campId),
        },
      }),
      // 3. 经营分析-住宿数据v2接口
      apiClient.request<APIResponse<AccommodationManagementAnalysisResponse>>({
        method: 'POST',
        url: '/report/accommodation/management/analysis/get',
        headers: {
          'Content-Type': 'application/json',
        },
        data: {
          campId: String(campId),
          startDate: analysisStart,
          endDate: analysisEnd,
          predictStartDate: analysisStart,
          predictEndDate: analysisEnd,
          roomCategoryIds: [],
          channelIds: [],
          roomCategoryGroupIds: [],
          poiIds: [],
        },
      }),
    ]);

    assertApiSuccess(nightAuditResponse, '夜审数据查询', 'finance');
    assertApiSuccess(homePageResponse, '首页报表查询', 'finance');
    assertApiSuccess(managementAnalysisResponse, '经营分析数据查询', 'finance');

    // 合并数据
    const mergedData: MergedOperationalData = {
      nightAudit: nightAuditResponse.data || { list: [], total: 0, current: 1, size: 0 },
      homePage: homePageResponse.data || {
        nowPredictCheckIn: 0,
        nowAlreadyCheckIn: 0,
        nowPredictCheckOut: 0,
        nowOnSaleNum: 0,
        userBusyRepairNum: 0,
        dirtyNum: 0,
        exceptionOrderNum: 0,
        nowIncome: 0,
      },
      managementAnalysis: managementAnalysisResponse.data || {
        writeDownIncome: '0',
        businessIncome: '0',
        predictTotalBusinessIncome: '0',
        predictForwardBusinessIncome: '0',
        roomFeePriceIncludingCommission: '0',
        hourRoomFeePriceIncludingCommission: '0',
        otherOrderExpense: '0',
        occ: '0',
        adr: '0',
        revPar: '0',
        openRoomCount: '0',
        roomCount: '0',
        allDayOpenRoomCount: '0',
        hourOpenRoomCount: '0',
        growthTrendAnalysisList: [],
        orderOriginAnalysisList: [],
        orderTotalCount: 0,
        allDayRoomFeePriceIncludingCommission: 0,
      },
      queryDate: analysisStart,
      queryEndDate: analysisEnd,
    };

    logger.info('Operational data queried successfully (v2)', {
      analysisStart,
      analysisEnd,
      nightAuditCount: mergedData.nightAudit.list.length,
    });

    return createSuccessResult(mergedData);
  } catch (error) {
    return handleError(error);
  }
};
