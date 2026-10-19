import type { RedisCommands } from './redisCodeStore.js';
import type { TokenFamilyStore } from './tokenService.js';
const REPLACE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0
`;
export class RedisTokenFamilyStore implements TokenFamilyStore {
  constructor(private readonly redis: RedisCommands) {}
  async putIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
  }
  read(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
  async compareAndSet(
    key: string,
    expected: string,
    replacement: string,
    ttlSeconds: number
  ): Promise<boolean> {
    return (
      (await this.redis.eval(REPLACE, 1, key, expected, replacement, String(ttlSeconds))) === 1
    );
  }
}
