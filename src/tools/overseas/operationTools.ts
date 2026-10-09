import type { ToolDefinition, ToolHandler } from '../../types/mcp.js';
import { handleToolError, ErrorCode, MCPError } from '../../utils/errorHandler.js';
import { startChannelConnection, completeChannelConnection } from './channelConnectionFlow.js';
import { connectChannelPoi, mapChannelListing, queryChannelConnection } from './channels.js';
import {
  changeRoomAvailability,
  createManualOrder,
  updateChannelPrices,
  updateRoomCleanState,
} from './operations.js';

const stringId = {
  type: 'string',
  minLength: 1,
  description:
    'Exact string ID returned by a prior query; never guess or convert large IDs to numbers.',
};
const date = {
  type: 'string',
  format: 'date',
  description: 'YYYY-MM-DD in the property timezone. At most 91 calendar dates per operation.',
};
const money = {
  type: 'integer',
  minimum: 0,
  description: 'Integer amount in fen (minor units), never a decimal currency amount.',
};
const confirmation = {
  confirm: {
    type: 'boolean',
    default: false,
    description:
      'Only true after showing the preview and receiving explicit user approval for these exact changes.',
  },
  previewId: {
    type: 'string',
    description:
      'Required with confirm=true. Use the returned previewId within 10 minutes in this MCP session. Never reuse after submission.',
  },
};
const channel = { type: 'string', enum: ['booking', 'trip', 'agoda'] };
function define(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  scope: string,
  handler: ToolHandler,
  write = true
): ToolDefinition {
  return {
    name,
    description:
      description +
      (write
        ? ' First preview without confirm; display names, dates and amounts to the user. After their explicit approval, repeat identical arguments with confirm=true and previewId. Never retry an ambiguous write automatically.'
        : ''),
    inputSchema: {
      type: 'object',
      properties: { ...properties, ...(write ? confirmation : {}) },
      required,
      additionalProperties: false,
    },
    requiredScopes: [scope],
    handler: async (args, context) => {
      try {
        if (context.regionProfile?.region !== 'overseas')
          throw new MCPError(
            ErrorCode.INVALID_PARAMS,
            'This tool is only available for overseas properties'
          );
        if (!context.campId || context.campId === '0')
          throw new MCPError(ErrorCode.AUTH_REQUIRED, 'Select a valid camp before using this tool');
        context.permissionChecker.checkPermission(name, [scope]);
        return await handler(args, context);
      } catch (error) {
        return handleToolError(error, context);
      }
    },
  };
}

export function getOverseasOperationTools(): ToolDefinition[] {
  return [
    define(
      'start_channel_connection',
      'Default for connecting Booking/Trip/Agoda: record the channel POI/mapping baseline and open its PC connection page. Tell the user to complete PC steps and reply only 已完成/done. No property IDs required. Only one pending flow per session; reuse it until done.',
      { channel },
      ['channel'],
      'channels:read',
      startChannelConnection,
      false
    ),
    define(
      'complete_channel_connection',
      'When the user says 已完成/done after starting a channel connection, call this with no arguments. Compare current POIs and mappings against the recorded baseline for the active channel. Only succeeded ends the flow; pending/needs_action preserves it. Never ask the user for IDs.',
      {},
      [],
      'channels:read',
      completeChannelConnection,
      false
    ),
    define(
      'connect_channel_poi',
      'Advanced direct-write path, only when explicitly requested. Prefer start_channel_connection for normal users. Connect a Booking.com, Trip.com or Agoda property using the external property ID. This creates a POI; listing mapping/policy setup may still be required.',
      { channel, outPoiId: stringId },
      ['channel', 'outPoiId'],
      'channels:write',
      connectChannelPoi
    ),
    define(
      'query_channel_connection',
      'Read channel POIs, connection statuses, room/product mappings and paginated local mapping candidates. Pending synchronization is not permission to create the POI again.',
      { channel, poiId: stringId, pageNum: { type: 'integer', minimum: 1, default: 1 } },
      ['channel'],
      'channels:read',
      queryChannelConnection,
      false
    ),
    define(
      'map_channel_listing',
      'Advanced direct-write path, only when explicitly requested; normal users complete mapping in the PC opened by start_channel_connection. Map one channel property or room category to a verified local listing. Use kind=property with parentPoiId; kind=room with roomCategoryId and parentRoomCategoryId. Optional product mappings bind rates of those same room categories. Does not disconnect or publish listings.',
      {
        channel,
        poiId: stringId,
        kind: { type: 'string', enum: ['property', 'room'] },
        parentPoiId: stringId,
        roomCategoryId: stringId,
        parentRoomCategoryId: stringId,
        productMappings: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: { roomCategoryProductId: stringId, parentRoomCategoryProductId: stringId },
            required: ['roomCategoryProductId', 'parentRoomCategoryProductId'],
            additionalProperties: false,
          },
        },
      },
      ['channel', 'poiId', 'kind'],
      'channels:write',
      mapChannelListing
    ),
    define(
      'update_channel_prices',
      'Set one verified channel rate product price over an inclusive date range. Reads current prices and refuses non-editable products or changed previews.',
      {
        roomCategoryProductId: stringId,
        startDate: date,
        endDate: date,
        amountFen: { ...money, minimum: 10, maximum: 999_999_999 },
        validWeekDays: {
          type: 'array',
          minItems: 7,
          maxItems: 7,
          items: { type: 'integer', enum: [0, 1] },
          description: 'Seven flags [Sunday, Monday, ..., Saturday]; defaults to all days.',
        },
      },
      ['roomCategoryProductId', 'startDate', 'endDate', 'amountFen'],
      'rooms:write',
      updateChannelPrices
    ),
    define(
      'close_rooms',
      'Close one verified room over an inclusive date range. Refuses reservation conflicts and existing occupations; supports manual closure types only.',
      {
        roomId: stringId,
        startDate: date,
        endDate: date,
        type: {
          type: 'integer',
          enum: [1, 4, 5],
          default: 1,
          description: '1 normal closure, 4 maintenance, 5 reserved',
        },
        remark: { type: 'string', maxLength: 500 },
      },
      ['roomId', 'startDate', 'endDate'],
      'rooms:write',
      (args, ctx) => changeRoomAvailability(args, ctx, 'close')
    ),
    define(
      'open_rooms',
      'Reopen explicitly selected dates on one room. Only existing manual closure types 1/4/5 may be removed. Reservation and linked occupations are refused.',
      { roomId: stringId, startDate: date, endDate: date },
      ['roomId', 'startDate', 'endDate'],
      'rooms:write',
      (args, ctx) => changeRoomAvailability(args, ctx, 'open')
    ),
    define(
      'update_room_clean_state',
      'Update one verified room cleaning status (dirty / cleaning / clean / not_set). Aligns with PC POST /room/updateCleanState. Accepts cleanState as 0–3 or not_set|dirty|waiting|clean.',
      {
        roomId: stringId,
        cleanState: {
          description:
            'Cleaning status: integer 0–3, or string not_set|dirty|waiting|waiting_for_inspection|cleaning|clean. 0 not_set, 1 dirty, 2 waiting/cleaning, 3 clean.',
        },
      },
      ['roomId', 'cleanState'],
      'rooms:write',
      updateRoomCleanState
    ),
    define(
      'create_manual_order',
      'Create one daily manual booking after verifying room ownership/availability and calculating payout. Check-out is exclusive. Manual channel 0, reserved state 2 (PC NewOrderDrawer). Optional price overrides in fen are included in the preview. Hourly, multiple-room, cancellation and payment collection are not supported.',
      {
        roomCategoryId: stringId,
        roomId: stringId,
        checkInDate: date,
        checkOutDate: date,
        guestName: { type: 'string', minLength: 1, maxLength: 160 },
        adults: { type: 'integer', minimum: 1, maximum: 100, default: 1 },
        children: { type: 'integer', minimum: 0, maximum: 100, default: 0 },
        infants: { type: 'integer', minimum: 0, maximum: 100, default: 0 },
        pets: { type: 'integer', minimum: 0, maximum: 100, default: 0 },
        guestEmail: { type: 'string', format: 'email' },
        guestMobile: { type: 'string', maxLength: 500 },
        note: { type: 'string', maxLength: 500 },
        paidFen: money,
        accommodationFareFen: money,
        cleaningFeeFen: money,
        taxFen: money,
      },
      ['roomCategoryId', 'roomId', 'checkInDate', 'checkOutDate', 'guestName'],
      'orders:write',
      createManualOrder
    ),
  ];
}
