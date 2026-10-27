import type { APIClient, RequestConfig } from '../../types/mcp.js';
import { DOMESTIC_PROTOCOL_HEADERS } from '../../region/domesticProtocol.js';
// Domestic dev diagnostics expose only a bounded upstream code or HTTP status.
// Never forward Hudson's error message, details, response body, or credentials.
const CN_DEV_DIAGNOSTIC_PATHS = new Set([
  '/account/page/get', '/channelRoomCategories/page/get/v2', '/channels/get',
  '/order/cancel', '/order', '/order/get', '/orderDetail/arrangeRoom', '/orderDetails/checkIn',
  '/orderDetails/checkOut/v2', '/orderDetails/extendStay', '/paymentWays/get',
  '/poi/channelMapping', '/poi/createChannelPoi', '/poi/get', '/poi/page/get',
  '/room/updateCleanState', '/rooms/cleanOrDirty', '/roomCalendar/occupation/v2',
  '/roomCalendar/releaseOccupation/v2', '/roomCategories/page/get',
  '/roomCategory/channelMappingInfo/get', '/roomCategoryMapping/v5',
  '/roomCategoryPrice/calendarPrice/channelRoomCategory',
  '/roomCategoryStatuses/roomCategory/channel/get', '/roomCategoryStatuses/central/get', '/roomStatuses/block/get',
  '/roomStatuses/check', '/roomStatuses/occ/get', '/roomStatuses/orderDetails/get',
  '/roomStatuses/rooms/get', '/roomStatusesToday/get',
  '/unMappingRoomCategories/get',
]);
function safeUpstreamCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)
    ? value : null;
}
export const WRITE_PATHS = new Set([
  '/bnbRatePrice/channelPrice/save',
  '/bnbRoomStatuses/close',
  '/bnbRoomStatuses/open',
  '/bnbOrder/save',
  '/room/updateCleanState',
  '/rooms/cleanOrDirty',
  '/poi/createChannelPoi',
  '/poiMapping/bnb',
  '/roomCategoryMapping/bnb',
  '/bnbOrderDetails/checkIn',
  '/bnbOrderDetails/checkOut',
  '/bnbOrder/extend',
  '/bnbOrderDetail/arrangeRoom',
  '/orderDetails/checkIn',
  '/orderDetails/checkOut/v2',
  '/orderDetails/extendStay',
  '/orderDetail/arrangeRoom',
  '/order',
  '/order/cancel',
  '/roomCalendar/occupation/v2',
  '/roomCalendar/releaseOccupation/v2',
  '/roomCategoryPrice/calendarPrice/channelRoomCategory',
  '/poi/channelMapping',
  '/roomCategoryMapping/v5',
]);
const WRITE_METHODS: Readonly<Record<string, readonly string[]>> = {
  '/rooms/cleanOrDirty': ['PUT'],
  '/roomCalendar/releaseOccupation/v2': ['DELETE'],
  '/roomCategoryPrice/calendarPrice/channelRoomCategory': ['PUT'],
};
/** 固定域名、凭证和门店；没有 setter、无重试、不允许传入绝对 URL 或覆盖认证。 */
export class RemoteHudsonClient implements APIClient {
  constructor(
    private readonly origin: string,
    private readonly credential: string,
    private readonly campId: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly allowWrite = false,
    private readonly region: 'cn' | 'overseas' = 'overseas'
  ) {
    if (
      !['https://hudson-dev.localhome.cn', 'https://hudson-prod.localhome.cn'].includes(origin) ||
      !campId ||
      campId === '0' ||
      !credential
    )
      throw new Error('Invalid remote Hudson context');
  }
  async request<T>(config: RequestConfig): Promise<T> {
    if (!/^\/[A-Za-z0-9/_-]+$/.test(config.url) || config.params ||
      (config.method !== 'POST' && !(this.allowWrite && WRITE_PATHS.has(config.url) &&
        (WRITE_METHODS[config.url] ?? ['POST']).includes(config.method))))
      throw new Error('Unsupported remote API request');
    if (WRITE_PATHS.has(config.url) && !this.allowWrite)
      throw new Error('Write requires persisted approval');
    if (WRITE_PATHS.has(config.url) && !(WRITE_METHODS[config.url] ?? ['POST']).includes(config.method))
      throw new Error('Unsupported write method');
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) {
        v.forEach(walk);
        return;
      }
      if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          if (k === 'campId' && String(x) !== this.campId)
            throw new Error('Cross-property request rejected');
          walk(x);
        }
    };
    walk(config.data);
    const body = { ...((config.data as Record<string, unknown>) ?? {}), campId: this.campId };
    let response: Response;
    try {
      response = await this.fetcher(this.origin + config.url, {
        method: config.method,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          ...(this.region === 'cn' ? DOMESTIC_PROTOCOL_HEADERS : {}),
          'Content-Type': 'application/json',
          'hudson-access-token': this.credential,
          campId: this.campId,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Hudson request outcome unavailable');
    }
    if (!response.ok) {
      if (this.origin === 'https://hudson-dev.localhome.cn' && CN_DEV_DIAGNOSTIC_PATHS.has(config.url))
        return { success: false, errorCode: `HTTP_${response.status}`,
          errorMsg: 'Hudson request rejected' } as T;
      throw new Error('Hudson request rejected');
    }
    try {
      const body = (await response.json()) as { success?: boolean; errorCode?: string } | null;
      // Do not echo backend stack traces, request headers or credentials from failure envelopes.
      if (body?.success === false)
        return {
          success: false,
          errorCode: body.errorCode === 'USER_TOKEN_INVALID' ? 'USER_TOKEN_INVALID'
            : this.origin === 'https://hudson-dev.localhome.cn' && CN_DEV_DIAGNOSTIC_PATHS.has(config.url)
              ? safeUpstreamCode(body.errorCode) ?? 'API_REJECTED' : 'API_REJECTED',
          errorMsg: 'Hudson rejected this operation',
          data: null,
        } as T;
      return body as T;
    } catch {
      throw new Error('Hudson response unavailable');
    }
  }
}
