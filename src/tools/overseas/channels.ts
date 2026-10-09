import type { ToolContext, ToolResult } from '../../types/mcp.js';
import { createSuccessResult } from '../../utils/errorHandler.js';
import { extractPage } from '../../region/index.js';
import {
  id,
  invalid,
  integer,
  post,
  previewOrExecute,
  responseId,
  rows,
  record,
  type Row,
} from './mutationPreview.js';

/** Constants match overseas PC lib/api/services/poi.ts (9e4a367). */
const CHANNELS = {
  booking: { channelId: '9', accountId: '1264751971073368066' },
  trip: { channelId: '113', accountId: '2036274710696730625' },
  agoda: { channelId: '10', accountId: '2036274710696730627' },
} as const;
export function channel(args: Record<string, unknown>) {
  const key = args.channel;
  if (typeof key !== 'string' || !(key in CHANNELS) || !Object.hasOwn(CHANNELS, key))
    invalid('channel must be booking, trip, or agoda');
  return CHANNELS[key as keyof typeof CHANNELS];
}
export async function channelData(context: ToolContext, channelId: string, poiId?: string) {
  const data = await post(context, '/channelRoomCategories/bnb/get', {
    channelIds: [channelId],
    ...(poiId ? { poiIds: [poiId] } : {}),
  });
  if (!data || !Array.isArray(data.pois))
    invalid('Channel POI response is incomplete; cannot verify connections');
  return data;
}
function roomRows(data: Row) {
  return rows(data.roomCategories ?? data.listings);
}

export async function localListings(context: ToolContext, parentPoiId?: string): Promise<Row[]> {
  const result: Row[] = [];
  for (let pageNum = 1; pageNum <= 20; pageNum++) {
    const data = await post(context, '/bnbListings/page/get', {
      listingTypes: parentPoiId ? [3] : [1, 2, 3],
      isSelectAll: 1,
      ...(parentPoiId ? { mpIds: [parentPoiId] } : {}),
      pageNum,
      pageSize: 100,
    });
    const page = extractPage<Row>(data);
    result.push(...page.list);
    if (page.list.length < 100 || (typeof data?.total === 'number' && result.length >= data.total))
      return result;
  }
  return invalid(
    'Too many local listings to validate safely; narrow the operation in the PC website'
  );
}
function flattenListings(list: Row[]): Row[] {
  return list.flatMap((row) => [row, ...flattenListings(rows(row.connectListingViews))]);
}

export async function queryChannelConnection(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { channelId } = channel(args);
  const poiId = args.poiId === undefined ? undefined : id(args.poiId, 'poiId');
  const data = await channelData(context, channelId, poiId);
  const localPage = integer(args.pageNum ?? 1, 'pageNum', 1, 10000);
  const local = await post(context, '/bnbListings/page/get', {
    listingTypes: [1, 2, 3],
    pageNum: localPage,
    pageSize: 50,
  });
  return createSuccessResult({
    channelId,
    poiId,
    channel: data,
    localCandidates: local,
    statuses: { 1: 'unmapped', 2: 'connecting', 3: 'connected', 4: 'error' },
    next: 'Use returned string IDs to preview map_channel_listing. Empty channel data may mean synchronization is pending; query again later, do not recreate the POI.',
  });
}

export async function connectChannelPoi(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const selected = channel(args);
  const outPoiId = id(args.outPoiId, 'outPoiId');
  const data = await channelData(context, selected.channelId);
  const existing = rows(data.pois).find((row) => String(row.outPoiId) === outPoiId);
  if (existing)
    return createSuccessResult({
      status: 'already_exists',
      channelId: selected.channelId,
      poi: existing,
      next: 'Query this poiId and map listings as needed; no create request sent.',
    });
  return previewOrExecute(
    args,
    context,
    'connect_channel_poi',
    '/poi/createChannelPoi',
    { campId: context.campId, ...selected, outPoiId },
    {
      channel: args.channel,
      outPoiId,
      effect:
        'Create a channel property connection; mapping and channel policies may still be required.',
    },
    undefined,
    async (result) => {
      const poiId = responseId((result as { poiId?: unknown })?.poiId);
      if (!poiId) invalid('Create acknowledged without a poiId; query connection before retrying');
      return channelData(context, selected.channelId, poiId);
    }
  );
}

export async function mapChannelListing(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { channelId } = channel(args);
  const poiId = id(args.poiId, 'poiId');
  const data = await channelData(context, channelId, poiId);
  const poi = rows(data.pois).find((row) => responseId(row.poiId) === poiId);
  if (!poi) invalid('Channel POI not found in this camp/channel; query_channel_connection first');
  const parent = record(poi.parentPoiInfo);
  const parentId = parent ? responseId(parent.poiId ?? parent.mpId ?? parent.parentPoiId) : '';
  if (args.kind === 'room' && !parentId)
    invalid('Map the channel property to a local property before mapping rooms');
  const local = flattenListings(
    await localListings(context, args.kind === 'room' ? parentId : undefined)
  );
  if (args.kind === 'property') {
    const parentPoiId = id(args.parentPoiId, 'parentPoiId');
    const target = local.find(
      (row) => responseId(row.mpId) === parentPoiId && Number(row.mpType) === 1
    );
    if (!target) invalid('Local property not found');
    return previewOrExecute(
      args,
      context,
      'map_channel_listing',
      '/poiMapping/bnb',
      { campId: context.campId, poiId, parentPoiId, isPublish: 0 },
      {
        channel: args.channel,
        kind: 'property',
        channelProperty: poi.poiName,
        localProperty: target.nickName,
        previous: poi.parentPoiInfo ?? null,
      },
      undefined,
      () => channelData(context, channelId, poiId)
    );
  }
  if (args.kind !== 'room') invalid('kind must be property or room');
  const roomCategoryId = id(args.roomCategoryId, 'roomCategoryId');
  const parentRoomCategoryId = id(args.parentRoomCategoryId, 'parentRoomCategoryId');
  const source = roomRows(data).find(
    (row) =>
      responseId(row.roomCategoryId ?? row.channelRoomCategoryId) === roomCategoryId &&
      (row.poiId == null || responseId(row.poiId) === poiId)
  );
  const target = local.find(
    (row) => responseId(row.mpId) === parentRoomCategoryId && Number(row.mpType) === 2
  );
  if (!source || !target)
    invalid('Channel or local room category not found; query candidates first');
  if (
    roomRows(data).some(
      (row) =>
        responseId(row.roomCategoryId ?? row.channelRoomCategoryId) !== roomCategoryId &&
        responseId(record(row.parentRoomCategoryInfo).roomCategoryId) === parentRoomCategoryId
    )
  )
    invalid('Another channel room is already mapped to this local room category');
  const products =
    args.productMappings === undefined
      ? undefined
      : rows(args.productMappings).map((item) => {
          const productId = id(item.roomCategoryProductId, 'roomCategoryProductId');
          const parentId = id(item.parentRoomCategoryProductId, 'parentRoomCategoryProductId');
          if (
            !rows(source.roomCategoryProductInfos ?? source.channelRoomCategoryProductInfos).some(
              (p) =>
                responseId(p.roomCategoryProductId ?? p.channelRoomCategoryProductId) === productId
            ) ||
            !rows(target.ratePlanViews).some(
              (p) => responseId(p.roomCategoryProductId) === parentId
            )
          )
            invalid('Product mapping IDs must belong to the selected room categories');
          return {
            roomCategoryProductId: productId,
            parentRoomCategoryProductId: parentId,
            ...(channelId === '113' ? { isPublish: 0 } : {}),
          };
        });
  if (
    args.productMappings !== undefined &&
    (!Array.isArray(args.productMappings) ||
      !products?.length ||
      products.length > 50 ||
      new Set(products.map((p) => p.roomCategoryProductId)).size !== products.length)
  )
    invalid('productMappings must contain 1–50 unique channel products');
  const mapping = {
    roomCategoryId,
    parentRoomCategoryId,
    ...(channelId === '113' ? { isPublish: 0 } : {}),
    ...(products ? { roomCategoryProductMappings: products } : {}),
  };
  return previewOrExecute(
    args,
    context,
    'map_channel_listing',
    '/roomCategoryMapping/bnb',
    { campId: context.campId, roomCategoryMappings: [mapping] },
    {
      channel: args.channel,
      poiId,
      channelRoom: source.roomCategoryName ?? source.channelRoomCategoryName,
      localRoom: target.nickName,
      previous: source.parentRoomCategoryInfo ?? null,
      parentPoiId: parentId,
      products,
    },
    undefined,
    () => channelData(context, channelId, poiId)
  );
}
