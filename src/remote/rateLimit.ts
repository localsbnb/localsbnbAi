import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { RedisCommands } from './oauth/redisCodeStore.js';
const TAKE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;
/** Redis 固定窗口；仅信任 socket 地址，不读取伪造代理头。当前反代来源共享额度。 */
export function createRateLimiter(
  redis: Pick<RedisCommands, 'eval'>,
  namespace: string
): (req: IncomingMessage) => Promise<boolean> {
  if (!/^localsbnb:mcp:(dev|prod):oauth$/.test(namespace))
    throw new Error('Invalid rate limit namespace');
  return async (req) => {
    const login = req.url?.split('?')[0] === '/authorize/login';
    const peer = createHash('sha256')
      .update(req.socket.remoteAddress ?? 'unknown')
      .digest('hex');
    const count = await redis.eval(
      TAKE,
      1,
      `${namespace}:rate:${login ? 'login' : 'requests'}:${peer}`,
      '60'
    );
    return typeof count === 'number' && count <= (login ? 10 : 120);
  };
}
