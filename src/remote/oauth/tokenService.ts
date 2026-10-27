import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApprovedGrant } from './authorizationCode.js';
import type { PersistentGrant } from './postgresGrantStore.js';

export interface TokenFamilyStore {
  putIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  read(key: string): Promise<string | null>;
  compareAndSet(
    key: string,
    expected: string,
    replacement: string,
    ttlSeconds: number
  ): Promise<boolean>;
}
export interface ActiveGrantReader {
  revoke(grantId: string, subjectId: string): Promise<void>;
  readActive(grantId: string, clientId: string, resource: string): Promise<PersistentGrant | null>;
}
interface Family extends ApprovedGrant {
  accessHash: string;
  refreshHash: string;
  usedRefreshHashes: string[];
  accessExpiresAt: number;
  expiresAt: number;
  revoked: boolean;
}
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}
export class OAuthTokenError extends Error {
  constructor(public readonly code: 'invalid_grant' | 'invalid_token') {
    super(code);
  }
}
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
const matches = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** 内部核心：客户端认证由 HTTP 层负责。无全局用户、无本地凭证文件、无业务调用。 */
export class OAuthTokenService {
  constructor(
    private readonly store: TokenFamilyStore,
    private readonly grants: ActiveGrantReader,
    private readonly resource: string,
    private readonly namespace: string,
    private readonly now = Date.now,
    private readonly workbuddy = false
  ) {
    const url = new URL(resource);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      !/^localsbnb:mcp:(dev|prod):oauth(?::workbuddy)?$/.test(namespace)
    )
      throw new Error('Invalid token service configuration');
  }
  private key(id: string): string {
    return `${this.namespace}:family:${id}`;
  }
  private id(token: string, kind: 'at' | 'rt'): string | null {
    const parts = token.split('.');
    return parts.length === 3 &&
      parts[0] === kind &&
      /^[A-Za-z0-9_-]{22}$/.test(parts[1]) &&
      /^[A-Za-z0-9_-]{43}$/.test(parts[2])
      ? parts[1]
      : null;
  }
  private ttl(expiresAt: number): number {
    return Math.max(1, Math.ceil((expiresAt - this.now()) / 1000));
  }
  private parse(raw: string): Family {
    try {
      const f = JSON.parse(raw) as Family;
      if (
        !f ||
        !f.grantId ||
        !f.clientId ||
        f.resource !== this.resource ||
        typeof f.revoked !== 'boolean' ||
        !Number.isFinite(f.expiresAt) ||
        !Number.isFinite(f.accessExpiresAt) ||
        !Array.isArray(f.scopes) ||
        !f.scopes.length ||
        f.scopes.some((s) => typeof s !== 'string' || !s) ||
        !Array.isArray(f.usedRefreshHashes) ||
        f.usedRefreshHashes.length > 1000 ||
        [f.accessHash, f.refreshHash, ...f.usedRefreshHashes].some(
          (h) => typeof h !== 'string' || !/^[a-f0-9]{64}$/.test(h)
        )
      )
        throw new Error();
      return f;
    } catch {
      throw new OAuthTokenError('invalid_grant');
    }
  }
  private async active(grant: ApprovedGrant): Promise<PersistentGrant> {
    const current = await this.grants.readActive(grant.grantId, grant.clientId, grant.resource);
    if (
      !current ||
      current.grantId !== grant.grantId ||
      current.clientId !== grant.clientId ||
      current.resource !== this.resource ||
      current.expiresAt.getTime() <= this.now() ||
      !grant.scopes.length ||
      grant.scopes.some((s) => !current.scopes.includes(s))
    )
      throw new OAuthTokenError('invalid_grant');
    return current;
  }
  private pair(id: string, family: Family): TokenResponse {
    const access = `at.${id}.${randomBytes(32).toString('base64url')}`;
    const refresh = `rt.${id}.${randomBytes(32).toString('base64url')}`;
    family.accessHash = hash(access);
    family.refreshHash = hash(refresh);
    family.accessExpiresAt = Math.min(this.now() + (this.workbuddy ? 3_600_000 : 600_000), family.expiresAt);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: Math.max(0, Math.floor((family.accessExpiresAt - this.now()) / 1000)),
      scope: family.scopes.join(' '),
    };
  }
  /** 仅在授权码成功消费后调用，且每次重新核验持久授权。 */
  async issue(grant: ApprovedGrant): Promise<TokenResponse> {
    if (grant.resource !== this.resource) throw new OAuthTokenError('invalid_grant');
    const active = await this.active(grant);
    const id = randomBytes(16).toString('base64url');
    const family: Family = {
      grantId: grant.grantId,
      clientId: grant.clientId,
      resource: grant.resource,
      scopes: [...grant.scopes],
      accessHash: '',
      refreshHash: '',
      usedRefreshHashes: [],
      accessExpiresAt: 0,
      expiresAt: Math.min(this.now() + (this.workbuddy ? 30 : 7) * 86400_000, active.expiresAt.getTime()),
      revoked: false,
    };
    const response = this.pair(id, family);
    if (
      !(await this.store.putIfAbsent(
        this.key(id),
        JSON.stringify(family),
        this.ttl(family.expiresAt)
      ))
    )
      throw new Error('Token allocation failed');
    return response;
  }
  /** 并发重用旧 refresh token 也视为重放；整个 family 失效，客户端必须串行刷新。 */
  async refresh(clientId: string, token: string, resource: string): Promise<TokenResponse> {
    const id = this.id(token, 'rt');
    if (!id || resource !== this.resource) throw new OAuthTokenError('invalid_grant');
    for (let attempt = 0; attempt < 8; attempt++) {
      const raw = await this.store.read(this.key(id));
      if (!raw) break;
      const f = this.parse(raw);
      if (f.clientId !== clientId || f.revoked || f.expiresAt <= this.now()) break;
      const digest = hash(token);
      if (f.usedRefreshHashes.includes(digest)) {
        const grant = await this.grants.readActive(f.grantId, f.clientId, f.resource);
        if (grant) await this.grants.revoke(grant.grantId, grant.subjectId);
        if (
          await this.store.compareAndSet(
            this.key(id),
            raw,
            JSON.stringify({ ...f, revoked: true }),
            this.ttl(f.expiresAt)
          )
        )
          break;
        continue;
      }
      if (!matches(f.refreshHash, digest)) break;
      const active = await this.active(f);
      if (f.usedRefreshHashes.length >= 1000) break; // 有界记录；达到上限需重新授权。
      f.usedRefreshHashes.push(f.refreshHash);
      f.expiresAt = Math.min(f.expiresAt, active.expiresAt.getTime());
      const response = this.pair(id, f);
      if (
        await this.store.compareAndSet(this.key(id), raw, JSON.stringify(f), this.ttl(f.expiresAt))
      )
        return response;
    }
    throw new OAuthTokenError('invalid_grant');
  }
  async verify(token: string, resource: string): Promise<PersistentGrant> {
    const id = this.id(token, 'at');
    if (!id || resource !== this.resource) throw new OAuthTokenError('invalid_token');
    const raw = await this.store.read(this.key(id));
    if (!raw) throw new OAuthTokenError('invalid_token');
    let f: Family;
    try {
      f = this.parse(raw);
    } catch {
      throw new OAuthTokenError('invalid_token');
    }
    if (
      f.revoked ||
      f.expiresAt <= this.now() ||
      f.accessExpiresAt <= this.now() ||
      !matches(f.accessHash, hash(token))
    ) {
      throw new OAuthTokenError('invalid_token');
    }
    let active: PersistentGrant;
    try {
      active = await this.active(f);
    } catch (error) {
      if (error instanceof OAuthTokenError) throw new OAuthTokenError('invalid_token');
      throw error;
    }
    // 显式投影，避免把 reader 返回的 Hudson 凭证带入认证上下文或扩大 scope。
    return {
      grantId: active.grantId,
      subjectId: active.subjectId,
      campId: active.campId,
      clientId: active.clientId,
      resource: active.resource,
      scopes: [...f.scopes],
      expiresAt: new Date(Math.min(active.expiresAt.getTime(), f.accessExpiresAt)),
    };
  }
  /** RFC 7009 风格：无效 token/不同客户端不泄露存在性；存储故障仍上抛。 */
  async revoke(clientId: string, token: string): Promise<void> {
    const id = this.id(token, 'rt') ?? this.id(token, 'at');
    if (!id) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const raw = await this.store.read(this.key(id));
      if (!raw) return;
      const f = this.parse(raw);
      const digest = hash(token);
      if (
        f.clientId !== clientId ||
        f.expiresAt <= this.now() ||
        ![f.refreshHash, f.accessHash, ...f.usedRefreshHashes].some((h) => matches(h, digest))
      )
        return;
      // 撤销持久授权，已签发但未兑换的网页链接也随之失效。先撤销 PG，Redis 失败时仍拒绝业务。
      const grant = await this.grants.readActive(f.grantId, f.clientId, f.resource);
      if (grant) await this.grants.revoke(grant.grantId, grant.subjectId);
      if (f.revoked) return;
      if (
        await this.store.compareAndSet(
          this.key(id),
          raw,
          JSON.stringify({ ...f, revoked: true }),
          this.ttl(f.expiresAt)
        )
      )
        return;
    }
    throw new Error('Token revocation contention');
  }
}
