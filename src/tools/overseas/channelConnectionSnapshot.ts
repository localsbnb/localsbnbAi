import { record, responseId, rows, type Row } from './mutationPreview.js';
export type PoiSnapshot = {
  poiId: string;
  outPoiId: string;
  name: string;
  parentPoiId: string;
  rooms: Array<{
    id: string;
    parentId: string;
    status: number;
    error: string;
    products: Array<{ id: string; parentId: string }>;
  }>;
};
export function snapshot(data: Row): PoiSnapshot[] {
  const pois = rows(data.pois);
  const rooms = rows(data.roomCategories ?? data.listings);
  return pois
    .map((poi) => {
      const poiId = responseId(poi.poiId),
        outPoiId = responseId(poi.outPoiId);
      const parent = record(poi.parentPoiInfo);
      return {
        poiId,
        outPoiId,
        name: String(poi.poiName ?? ''),
        parentPoiId: responseId(parent.poiId ?? parent.mpId ?? parent.parentPoiId),
        rooms: rooms
          .filter((room) =>
            room.poiId != null
              ? responseId(room.poiId) === poiId
              : room.outPoiId != null
                ? responseId(room.outPoiId) === outPoiId
                : pois.length === 1
          )
          .map((room) => ({
            id: responseId(room.roomCategoryId ?? room.channelRoomCategoryId),
            parentId: responseId(record(room.parentRoomCategoryInfo).roomCategoryId),
            status: Number(room.connectionStatus ?? 0),
            error: String(room.initErrorReason ?? ''),
            products: rows(room.roomCategoryProductInfos ?? room.channelRoomCategoryProductInfos)
              .map((product) => ({
                id: responseId(
                  product.roomCategoryProductId ?? product.channelRoomCategoryProductId
                ),
                parentId: responseId(
                  record(product.parentRoomCategoryProductInfo).roomCategoryProductId ??
                    record(product.parentRoomCategoryProductInfo).room_category_product_id ??
                    record(product.parentRoomCategoryProductInfo).parentRoomCategoryProductId ??
                    record(product.parentRoomCategoryProductInfo).parent_room_category_product_id
                ),
              }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
    })
    .sort((a, b) => a.poiId.localeCompare(b.poiId));
}
export function fingerprint(poi: PoiSnapshot): string {
  // Ignore names, timestamps and array ordering: background refresh alone is not completion.
  return JSON.stringify({ outPoiId: poi.outPoiId, parentPoiId: poi.parentPoiId, rooms: poi.rooms });
}
export function ready(poi: PoiSnapshot, requireProperty = true): boolean {
  return (
    !!poi.poiId &&
    (!requireProperty || !!poi.parentPoiId) &&
    poi.rooms.length > 0 &&
    poi.rooms.every(
      (room) =>
        !!room.id &&
        !!room.parentId &&
        room.status === 3 &&
        !room.error &&
        room.products.every((p) => !!p.id && !!p.parentId)
    )
  );
}
