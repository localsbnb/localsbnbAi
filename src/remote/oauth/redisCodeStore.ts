import { RedisTokenFamilyStore } from './redisTokenStore.js';
import type { OneTimeCodeStore } from './authorizationCode.js';

/** Redis 驱动的最小适配接口；连接地址和认证由部署注入，不读取 Hudson 配置文件。 */
export interface RedisCommands {
  set(
    key: string,
    value: string,
    expiry: 'EX',
    seconds: number,
    condition: 'NX'
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
}

const CONSUME = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class RedisAuthorizationCodeStore implements OneTimeCodeStore {
  constructor(private readonly redis: RedisCommands) {}
  async putIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
  }
  compareAndSet(
    key: string,
    expected: string,
    replacement: string,
    ttlSeconds: number
  ): Promise<boolean> {
    return new RedisTokenFamilyStore(this.redis).compareAndSet(
      key,
      expected,
      replacement,
      ttlSeconds
    );
  }
  read(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
  async consumeIfEqual(key: string, expected: string): Promise<boolean> {
    return (await this.redis.eval(CONSUME, 1, key, expected)) === 1;
  }
}
