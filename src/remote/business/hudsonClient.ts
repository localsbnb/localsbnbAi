import type { APIClient, RequestConfig } from '../../types/mcp.js';
export const WRITE_PATHS = new Set([
  '/bnbRatePrice/channelPrice/save',
  '/bnbRoomStatuses/close',
  '/bnbRoomStatuses/open',
  '/bnbOrder/save',
  '/room/updateCleanState',
  '/poi/createChannelPoi',
  '/poiMapping/bnb',
  '/roomCategoryMapping/bnb',
  '/bnbOrderDetails/checkIn',
  '/bnbOrderDetails/checkOut',
  '/bnbOrder/extend',
  '/bnbOrderDetail/arrangeRoom',
]);
/** 固定域名、凭证和门店；没有 setter、无重试、不允许传入绝对 URL 或覆盖认证。 */
export class RemoteHudsonClient implements APIClient {
  constructor(
    private readonly origin: string,
    private readonly credential: string,
    private readonly campId: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly allowWrite = false
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
    if (!/^\/[A-Za-z0-9/_-]+$/.test(config.url) || config.method !== 'POST' || config.params)
      throw new Error('Unsupported remote API request');
    if (WRITE_PATHS.has(config.url) && !this.allowWrite)
      throw new Error('Write requires persisted approval');
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
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          'hudson-access-token': this.credential,
          campId: this.campId,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Hudson request outcome unavailable');
    }
    if (!response.ok) throw new Error('Hudson request rejected');
    try {
      const body = (await response.json()) as { success?: boolean; errorCode?: string } | null;
      // Do not echo backend stack traces, request headers or credentials from failure envelopes.
      if (body?.success === false)
        return {
          success: false,
          errorCode:
            body.errorCode === 'USER_TOKEN_INVALID' ? 'USER_TOKEN_INVALID' : 'API_REJECTED',
          errorMsg: 'Hudson rejected this operation',
          data: null,
        } as T;
      return body as T;
    } catch {
      throw new Error('Hudson response unavailable');
    }
  }
}
