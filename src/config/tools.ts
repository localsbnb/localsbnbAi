import type { ToolDefinition } from '../types/mcp.js';
import * as roomHandlers from '../tools/rooms/index.js';
import * as orderHandlers from '../tools/orders/index.js';
import * as financeHandlers from '../tools/finance/index.js';

/**
 * 所有工具定义配置
 * 目前只包含已实现的工具
 */
export const toolDefinitions: ToolDefinition[] = [
  // 房态查询工具（仅读）
  {
    name: 'query_room_status_new',
    description:
      '按房型日历查询房态、可售与库存等（新接口）。与「房价/渠道价」无关：用户说「查看房态日历价」「房态日历价」指近期/渠道房价时，必须调用 query_room_prices，勿选本工具。用户说「本周」「上周」房态日历时必须传 timeRange=this_week 或 last_week（自然周周一至周日，上海时区），勿用「从今天起连续 30 天」代替本周。',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          format: 'date',
          description: '开始日期，格式：YYYY-MM-DD，默认为当天；与 timeRange 联用时表示锚定日所在周',
        },
        days: {
          type: 'number',
          default: 30,
          minimum: 1,
          description: '查询天数，默认30天；与 timeRange 互斥（传 timeRange 时固定为自然周 7 天）',
        },
        timeRange: {
          type: 'string',
          enum: ['this_week', 'last_week'],
          description: 'this_week=本周自然周；last_week=上周自然周。与仅按天数的「近30天」不同',
        },
        roomCategoryIds: {
          type: 'array',
          items: {
            type: 'number',
          },
          description: '房源类型ID列表（可选）',
        },
        roomCategoryGroupIds: {
          type: 'array',
          items: {
            type: 'number',
          },
          description: '房源分组ID列表（可选）',
        },
        channelIds: {
          type: 'array',
          items: {
            type: 'number',
          },
          description: '渠道ID列表（可选）',
        },
        searchKey: {
          type: 'string',
          description: '模糊搜索：房源编码、房源简称、房源名称（可选）',
        },
        pageNum: {
          type: 'number',
          default: 1,
          minimum: 1,
          description: '页码，默认1',
        },
        pageSize: {
          type: 'number',
          default: 15,
          minimum: 1,
          maximum: 100,
          description: '每页数量，默认15，最大100',
        },
      },
      required: [],
    },
    handler: roomHandlers.queryRoomStatusNewHandler,
    requiredScopes: ['rooms:read'],
  },
  {
    name: 'query_today_room_status',
    description:
      '查询今日（或指定日）房态汇总：房间状态、库存与保洁等，不含渠道房价。「查看房态日历价」指房价时请用 query_room_prices。支持关键词：今日房态、今日房态查询、今日房态统计、今日房态分析、今日房态报表、今日房态展示、今日房态可视化、今日房态仪表盘、今日房态报告、今日房态图表、今日房态表格、房态查询、房态',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          format: 'date',
          description: '日期，格式：YYYY-MM-DD，默认为当天',
        },
      },
      required: [],
    },
    handler: roomHandlers.queryTodayRoomStatusHandler,
    requiredScopes: ['rooms:read'],
  },
  {
    name: 'query_room_prices',
    description:
      '查询房价（渠道 RP、可配置天数价格）。用户说「本周房价」「上周房价」时必须传 timeRange=this_week 或 last_week（自然周周一至周日，上海时区），不要用「近7天」或默认 days=7 代替「本周」——否则日期区间错误。用户只说「近一周」「最近7天」且无「本周」字样时，可用 date+days（默认从当天起 7 天）。支持关键词：查看房态日历价、房态日历价、日历价、房价、近期房价、本月房间、XXX天房价、今日房价查询、房价查询',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          format: 'date',
          description: '开始日期 YYYY-MM-DD，默认当天；与 timeRange 联用时表示锚定日所在周',
        },
        days: {
          type: 'number',
          default: 7,
          minimum: 1,
          maximum: 30,
          description: '从 date 起连续天数；与 timeRange 互斥（传 timeRange 时固定为自然周 7 天）',
        },
        timeRange: {
          type: 'string',
          enum: ['this_week', 'last_week'],
          description: 'this_week=本周自然周房价；last_week=上周自然周。与「滚动 7 天」不同',
        },
      },
      required: [],
    },
    handler: roomHandlers.queryRoomPricesHandler,
    requiredScopes: ['rooms:read'],
  },
  // 订单管理工具（仅读）
  {
    name: 'query_today_orders',
    description:
      '今日订单（聚合事件）：同时查询预抵(orderType=11)、在住(orderType=10)、预离(orderType=12)三组，并分别返回总数与明细。支持关键词：订单、今日订单情况、待办事项、待办、今日待办、待处理订单情况、订单情况。',
    inputSchema: {
      type: 'object',
      properties: {
        pageNum: {
          type: 'number',
          default: 1,
          minimum: 1,
          description: '页码，默认1',
        },
        pageSize: {
          type: 'number',
          default: 10,
          minimum: 1,
          maximum: 50,
          description: '每页数量，默认10',
        },
        keyword: {
          type: 'string',
          description: '关键字（可选）',
        },
      },
      required: [],
    },
    handler: orderHandlers.queryTodayOrdersHandler,
    requiredScopes: ['orders:read'],
  },
  {
    name: 'query_pre_arrival_orders',
    description:
      '预抵订单（今日待入住）。固定调用 /orders/get 且 orderType=11。支持关键词：预抵、预抵订单、今日待入住、今日预订订单、今天待入住、剩余待入住、今日预抵。',
    inputSchema: {
      type: 'object',
      properties: {
        pageNum: {
          type: 'number',
          default: 1,
          minimum: 1,
          description: '页码，默认1',
        },
        pageSize: {
          type: 'number',
          default: 10,
          minimum: 1,
          maximum: 50,
          description: '每页数量，默认10',
        },
        keyword: {
          type: 'string',
          description: '关键字（可选）',
        },
      },
      required: [],
    },
    handler: orderHandlers.queryPreArrivalOrdersHandler,
    requiredScopes: ['orders:read'],
  },
  {
    name: 'query_in_house_orders',
    description:
      '在住订单（今日已入住）。固定调用 /orders/get 且 orderType=10。支持关键词：在住情况、在住订单、今日在住、今日已入住、已入住、今日在住订单。',
    inputSchema: {
      type: 'object',
      properties: {
        pageNum: {
          type: 'number',
          default: 1,
          minimum: 1,
          description: '页码，默认1',
        },
        pageSize: {
          type: 'number',
          default: 10,
          minimum: 1,
          maximum: 50,
          description: '每页数量，默认10',
        },
        keyword: {
          type: 'string',
          description: '关键字（可选）',
        },
      },
      required: [],
    },
    handler: orderHandlers.queryInHouseOrdersHandler,
    requiredScopes: ['orders:read'],
  },
  {
    name: 'query_pre_departure_orders',
    description:
      '预离订单（今日待退房）。固定调用 /orders/get 且 orderType=12。支持关键词：预离、预离订单、今日待退房、今日预离订单、今天待退房、剩余待退房、今日预离。',
    inputSchema: {
      type: 'object',
      properties: {
        pageNum: {
          type: 'number',
          default: 1,
          minimum: 1,
          description: '页码，默认1',
        },
        pageSize: {
          type: 'number',
          default: 10,
          minimum: 1,
          maximum: 50,
          description: '每页数量，默认10',
        },
        keyword: {
          type: 'string',
          description: '关键字（可选）',
        },
      },
      required: [],
    },
    handler: orderHandlers.queryPreDepartureOrdersHandler,
    requiredScopes: ['orders:read'],
  },
  {
    name: 'query_orders_by_date_range',
    description:
      '订单查询（日期范围事件）。支持按 startDate/endDate 或 timeRange(this_week/last_week) 查询，不与今日订单/预抵/在住/预离混用。支持关键词：订单查询、查询订单、某时间段订单。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: '查询开始日期 YYYY-MM-DD；与 endDate 配对',
        },
        endDate: {
          type: 'string',
          description: '查询结束日期 YYYY-MM-DD；与 startDate 配对',
        },
        timeRange: {
          type: 'string',
          enum: ['this_week', 'last_week'],
          description: 'this_week=本周自然周；last_week=上周自然周。与 startDate/endDate 二选一',
        },
        date: {
          type: 'string',
          format: 'date',
          description: '与 timeRange 联用时为锚定日（默认上海当天）',
        },
        pageNum: {
          type: 'number',
          default: 1,
          minimum: 1,
          description: '页码，默认1',
        },
        pageSize: {
          type: 'number',
          default: 10,
          minimum: 1,
          maximum: 50,
          description: '每页数量，默认10',
        },
      },
      required: [],
    },
    handler: orderHandlers.queryOrdersByDateRangeHandler,
    requiredScopes: ['orders:read'],
  },
  {
    name: 'get_order_details_v2',
    description: '根据订单ID查询订单详情信息。返回中含客人姓名字段，向用户回复时必须说明客人姓名（不得省略）。支持关键词：XXX订单详情、订单详情、订单详情查询、订单详情统计、订单详情分析、订单详情报表、订单详情展示、订单详情可视化、订单详情仪表盘、订单详情报告、订单详情图表、订单详情表格。用户可先通过今日订单获得订单号再查详情',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: '订单ID',
        },
      },
      required: ['orderId'],
    },
    handler: orderHandlers.getOrderDetailsV2Handler,
    requiredScopes: ['orders:read'],
  },
  // 运营数据工具
  {
    name: 'query_operational_data_v2',
    description:
      '查询运营数据：夜审分页、首页实时、经营分析（含入住率 OCC、ADR、RevPAR 等）。「本周」「本周入住率」「本周经营」「上周收入」等必须按自然周传参：优先传 timeRange 为 this_week 或 last_week（周一～周日，上海时区）；或显式传 startDate、endDate 为当周起止日。勿仅用单日 date 代替「本周」——否则经营分析区间错误。单日查询可只传 date（或 startDate=endDate=同一天）。支持关键词：当前运营情况、今天数据、数据、经营情况、运营数据、本周入住率、本周经营、上周数据等。若可呈现可视化表格则使用表格呈现',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          format: 'date',
          description:
            '锚定日期 YYYY-MM-DD：单日统计时即业务日；与 timeRange 联用时表示「以该日所在周」为本周/上周（默认不传则为上海当天）',
        },
        startDate: {
          type: 'string',
          format: 'date',
          description: '自定义统计区间起点，需与 endDate 同时传',
        },
        endDate: {
          type: 'string',
          format: 'date',
          description: '自定义统计区间终点，需与 startDate 同时传',
        },
        timeRange: {
          type: 'string',
          enum: ['this_week', 'last_week'],
          description: 'this_week=锚定日所在自然周（周一至周日）；last_week=上一完整自然周。与 startDate/endDate 二选一',
        },
      },
      required: [],
    },
    handler: financeHandlers.queryOperationalDataV2Handler,
    requiredScopes: ['finance:read'],
  },
];
