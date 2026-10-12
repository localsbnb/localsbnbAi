import { RemoteHudsonClient } from '../src/remote/business/hudsonClient';
const origin = 'https://hudson-dev.localhome.cn';
it('binds origin, camp and raw secret and does not trust supplied headers', async () => {
  const fetcher = jest.fn(async () => new Response(JSON.stringify({ success: true, data: [] })));
  const client = new RemoteHudsonClient(origin, 'private-token', '123', fetcher as typeof fetch);
  await client.request({
    method: 'POST',
    url: '/camp/get',
    headers: { campId: '999', 'hudson-access-token': 'attacker' },
    data: {},
  });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(origin + '/camp/get');
  expect(init.redirect).toBe('error');
  expect(JSON.parse(String(init.body)).campId).toBe('123');
  expect(init.headers).toMatchObject({ campId: '123', 'hudson-access-token': 'private-token' });
});
it.each([
  { url: '/camp/get', data: { nested: [{ campId: '999' }] } },
  { url: 'https://example.com/camp/get', data: {} },
  { url: '//example.com/camp/get', data: {} },
  { url: '/camp/get?token=1', data: {} },
  { url: '/room/updateCleanState', data: {} },
])('rejects unsafe request before transport: $url', async (request) => {
  const fetcher = jest.fn();
  const client = new RemoteHudsonClient(origin, 'private-token', '123', fetcher);
  await expect(client.request({ method: 'POST', ...request })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('never retries ambiguous writes or exposes transport errors', async () => {
  const fetcher = jest.fn(async () => {
    throw new Error('private-token');
  });
  const client = new RemoteHudsonClient(origin, 'private-token', '123', fetcher, true);
  await expect(
    client.request({
      method: 'POST',
      url: '/room/updateCleanState',
      data: { roomId: '1' },
      retry: true,
    })
  ).rejects.toThrow('Hudson request outcome unavailable');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
