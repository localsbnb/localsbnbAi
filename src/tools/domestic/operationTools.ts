import type { ToolDefinition, ToolHandler } from '../../types/mcp.js';
import { handleToolError, ErrorCode, MCPError } from '../../utils/errorHandler.js';
import { CN_PROFILE } from '../../region/types.js';
import { overseasWriteTools } from '../../config/businessTools.js';
import { getOverseasOperationTools } from '../overseas/operationTools.js';
import {
  domesticArrangeRoom, domesticAvailability, domesticCheckInOut, domesticCleanState,
  domesticExtendOrder, domesticQueryChannel, domesticCreateManualOrder,
  domesticUpdateChannelPrices, domesticMapChannelListing, domesticConnectChannelPoi,
  domesticStartChannelConnection, domesticCompleteChannelConnection, domesticCancelOrder, domesticBatchChannelPrices, domesticUpdateCentralPrices,
} from './operations.js';

const domesticHandlers: Record<string, ToolHandler> = {
  cancel_order: domesticCancelOrder,
  batch_update_channel_prices: domesticBatchChannelPrices,
  update_central_prices: domesticUpdateCentralPrices,
  check_in_order: (args, context) => domesticCheckInOut(args, context, 'check_in_order'),
  check_out_order: (args, context) => domesticCheckInOut(args, context, 'check_out_order'),
  extend_order: domesticExtendOrder,
  arrange_room: domesticArrangeRoom,
  close_rooms: (args, context) => domesticAvailability(args, context, 'close_rooms'),
  open_rooms: (args, context) => domesticAvailability(args, context, 'open_rooms'),
  update_room_clean_state: domesticCleanState,
  query_channel_connection: domesticQueryChannel,
  update_channel_prices: domesticUpdateChannelPrices,
  create_manual_order: domesticCreateManualOrder,
  map_channel_listing: domesticMapChannelListing,
  connect_channel_poi: domesticConnectChannelPoi,
  start_channel_connection: domesticStartChannelConnection,
  complete_channel_connection: domesticCompleteChannelConnection, domesticCancelOrder, domesticBatchChannelPrices, domesticUpdateCentralPrices,
};

const domesticDescriptions: Record<string, string> = {
  cancel_order: '国内门店：取消整笔未收款、未入住的手工短租订单并释放房态；不支持 OTA、长租、已收款、押金或退款。核对全部房单后预览并确认。',
  batch_update_channel_prices: '国内门店：一次修改1至20个已核对渠道产品的绝对价格（分），最多30天。逐项展示当前价及新价后确认；任何一项无效时整批不提交。后端异常不得自动重试。',
  update_central_prices: '国内门店：修改1至20个房型的中央日历价（分），最多30天。可能按后台规则同步关联渠道产品；必须展示房型、关联产品、日期及新旧价格后明确确认。',
  check_in_order: '国内门店：核对订单、客人和房单后预览入住；经明确确认后执行。必须提供 orderId 和单个 orderDetailId。',
  check_out_order: '国内门店：核对订单后预览单房单正常退房；押金退款、提前退房改价暂不支持，需在 PC 处理。必须提供 orderId。',
  extend_order: '国内门店：续住指定房间，必须提供 previousOrderId、roomId、nights 和明确的续住 priceFen（分）。先预览并确认。',
  arrange_room: '国内门店：为已核对的订单房单手动排房。必须提供 orderId、orderDetailId、roomId；先预览并确认。',
  close_rooms: '国内门店：只关闭未有订单、占用和屏蔽的房间日期。先预览并确认。',
  open_rooms: '国内门店：只解除手动关房（类型 1、4、5），不解除订单或渠道屏蔽。先预览并确认。',
  update_room_clean_state: '国内门店：将一个房间设为脏房或净房，与国内 PC 房态标记一致。仅支持 dirty（1）或 clean（3），先预览并确认。',
  query_channel_connection: '国内门店：只读查询指定渠道的账号、门店及房型连接状态。必须提供 channelId。',
  update_channel_prices: '国内门店：修改一个经核对的渠道价格产品，最长 30 天，仅绝对价格（分）。预览当前价后须明确确认。',
  create_manual_order: '国内门店：创建单房、全日、未收款的手工订单。必须提供有效订单渠道、支付方式和固定 bookedTime 毫秒时间戳；会核对房态、报价和门店，预览后确认。',
  map_channel_listing: '国内门店：将已核对的渠道门店或未关联渠道房型映射至本门店实体；不支持产品映射。预览后确认。',
  connect_channel_poi: '国内门店：从已存在的渠道账号创建一个渠道门店关联。必须指定 channelId、accountId、outPoiId；先核对账号与现有门店，再预览确认。',
  start_channel_connection: '国内门店：记录渠道授权基线并返回带目标门店和渠道的国内 PC openUrl。必须在客户端打开链接或展示可点击链接，不能只说已唤起；用户完成页面授权后再核验。需要 channelId；保留 baselineToken，无需用户抄写。',
  complete_channel_connection: '国内门店：用原始 baselineToken 核对渠道账号及门店状态是否变化；变化不等于渠道同步最终成功。需要 channelId 和 baselineToken。',
};

const overseas = [
  ...overseasWriteTools({ ...CN_PROFILE, region: 'overseas', locale: 'en' }),
  ...getOverseasOperationTools(),
];

const priceDates = {
  startDate: { type: 'string', format: 'date', description: '上海时区 YYYY-MM-DD，含首尾最多30个日期。' },
  endDate: { type: 'string', format: 'date', description: '上海时区 YYYY-MM-DD，含首尾最多30个日期。' },
};
const priceBase = overseas.find((tool) => tool.name === 'update_channel_prices')!;
const domesticOnly: ToolDefinition[] = [
  { name: 'cancel_order', description: '', requiredScopes: ['orders:write'], handler: domesticCancelOrder,
    inputSchema: { type: 'object', properties: {
      orderId: { type: 'string', minLength: 1 },
      confirm: priceBase.inputSchema.properties!.confirm,
      previewId: priceBase.inputSchema.properties!.previewId,
    }, required: ['orderId'], additionalProperties: false } },
  ...(['batch_update_channel_prices', 'update_central_prices'] as const).map((name): ToolDefinition => {
    const target = name === 'update_central_prices' ? 'roomCategoryId' : 'roomCategoryProductId';
    return { ...priceBase, name, handler: domesticHandlers[name],
      inputSchema: { type: 'object', properties: {
        ...priceDates,
        validWeekDays: priceBase.inputSchema.properties!.validWeekDays,
        confirm: priceBase.inputSchema.properties!.confirm,
        previewId: priceBase.inputSchema.properties!.previewId,
        items: { type: 'array', minItems: 1, maxItems: 20, items: {
          type: 'object', properties: { [target]: { type: 'string', minLength: 1 },
            amountFen: { type: 'integer', minimum: 10, maximum: 999_999_999 } },
          required: [target, 'amountFen'], additionalProperties: false,
        } },
      }, required: ['items', 'startDate', 'endDate'], additionalProperties: false } };
  }),
];

export function getDomesticOperationTools(): ToolDefinition[] {
  return [...overseas, ...domesticOnly].filter((tool) => domesticHandlers[tool.name]).map((tool) => {
    const properties = { ...(tool.inputSchema.properties ?? {}) };
    if (['update_channel_prices', 'batch_update_channel_prices', 'update_central_prices'].includes(tool.name))
      Object.assign(properties, priceDates);
    if (tool.name === 'update_room_clean_state') properties.cleanState = {
      enum: ['dirty', 'clean', 1, 3],
      description: 'Domestic PC room flag: dirty (1) or clean (3). Other cleaning workflow states are unsupported.',
    };
    if (tool.name === 'extend_order') properties.priceFen = {
      type: 'integer', minimum: 0, maximum: 100_000_000,
      description: 'Explicit domestic extension amount in fen; required for a domestic property.',
    };
    if (tool.name === 'query_channel_connection') properties.channelId = { type: 'string', minLength: 1 };
    if (tool.name === 'create_manual_order') Object.assign(properties, {
      orderChannelId: { type: 'string', minLength: 1 },
      paymentWayId: { type: 'string', minLength: 1 },
      bookedTime: { type: 'integer', minimum: 1600000000000, maximum: 4100000000000 },
    });
    if (tool.name === 'map_channel_listing') Object.assign(properties, {
      outPoiId: { type: 'string', minLength: 1 }, outPoiName: { type: 'string', minLength: 1 },
    });
    if (tool.name === 'connect_channel_poi') Object.assign(properties, {
      channelId: { type: 'string', minLength: 1 }, accountId: { type: 'string', minLength: 1 },
    });
    if (tool.name === 'start_channel_connection' || tool.name === 'complete_channel_connection')
      properties.channelId = { type: 'string', minLength: 1 };
    if (tool.name === 'complete_channel_connection')
      properties.baselineToken = { type: 'string', pattern: '^[0-9a-f]{64}$' };
    const required = (tool.inputSchema.required ?? []) as string[];
    return {
      ...tool,
      description: domesticDescriptions[tool.name],
      inputSchema: { ...tool.inputSchema, properties,
        required: tool.name === 'query_channel_connection' ? ['channelId']
          : tool.name === 'map_channel_listing' ? ['kind']
          : tool.name === 'connect_channel_poi' ? ['channelId', 'accountId', 'outPoiId']
          : tool.name === 'start_channel_connection' ? ['channelId']
          : tool.name === 'complete_channel_connection' ? ['channelId', 'baselineToken']
          : tool.name === 'create_manual_order' ? [...required, 'orderChannelId', 'paymentWayId', 'bookedTime']
          : required },
      handler: async (args, context) => {
        try {
          if (context.regionProfile?.region !== 'cn')
            throw new MCPError(ErrorCode.INVALID_PARAMS, 'Domestic operation requires a domestic property');
          context.permissionChecker.checkPermission(tool.name, tool.requiredScopes ?? []);
          return await domesticHandlers[tool.name](args, context);
        } catch (error) { return handleToolError(error, context); }
      },
    };
  });
}

/** Distinct remote names keep overseas tool schemas and handlers byte-for-byte unchanged. */
export function getDomesticRemoteOperationTools(): ToolDefinition[] {
  return getDomesticOperationTools().map((tool) => ({ ...tool, name: `cn_${tool.name}` }));
}
