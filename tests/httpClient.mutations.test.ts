import { HTTPClient } from '../src/client/httpClient';
import { RetryHandler } from '../src/client/retryHandler';
import type { AxiosInstance } from 'axios';

describe('HTTPClient explicit write retry policy', () => {
  afterEach(() => jest.restoreAllMocks());
  it('sends retry=false exactly once even on ambiguous network failure', async () => {
    const client = new HTTPClient('', 'test-only-token');
    const axios = (client as unknown as { client: AxiosInstance }).client;
    const send = jest.spyOn(axios, 'request').mockRejectedValue(new Error('timeout'));
    const retry = jest.spyOn(RetryHandler.prototype, 'execute');
    await expect(
      client.request({ method: 'POST', url: '/bnbOrder/save', retry: false, data: {} })
    ).rejects.toThrow('timeout');
    expect(send).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });
  it('preserves existing retry handling when the caller does not disable it', async () => {
    const client = new HTTPClient('', 'test-only-token');
    const retry = jest
      .spyOn(RetryHandler.prototype, 'execute')
      .mockResolvedValue({ data: { success: true, data: [] } });
    await expect(
      client.request({ method: 'POST', url: '/bnbOrder/get', data: {} })
    ).resolves.toEqual({ success: true, data: [] });
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
