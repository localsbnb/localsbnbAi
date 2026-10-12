import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OneTimeCodeStore {
  putIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  read(key: string): Promise<string | null>;
  /** 必须原子比较并删除；禁止先 GET 再 DEL。 */
  consumeIfEqual(key: string, expected: string): Promise<boolean>;
}

export interface RegisteredOAuthClient {
  clientId: string;
  redirectUris: readonly string[];
  allowedScopes: readonly string[];
}

/** 仅由可信登录/同意服务产生；不是浏览器或模型自报的身份。 */
export interface ApprovedGrant {
  grantId: string;
  clientId: string;
  resource: string;
  scopes: readonly string[];
}

interface CodeRecord {
  grantId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  challenge: string;
  expiresAt: number;
}

export class OAuthCodeError extends Error {
  constructor(public readonly code: 'invalid_request' | 'invalid_grant' | 'invalid_scope') {
    super(code);
  }
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export function pkceS256(verifier: string): string {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthCodeError('invalid_grant');
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** 授权码核心；不提供登录、token 发行或任何业务接口。 */
export class AuthorizationCodeService {
  constructor(
    private readonly store: OneTimeCodeStore,
    private readonly resource: string,
    private readonly namespace: string,
    private readonly now: () => number = Date.now
  ) {
    const url = new URL(resource);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
      throw new Error('OAuth resource must be a credential-free HTTPS URL');
    }
    if (!/^localsbnb:mcp:(dev|prod):oauth$/.test(namespace))
      throw new Error('Invalid OAuth storage namespace');
  }

  private key(code: string): string {
    return `${this.namespace}:code:${digest(code)}`;
  }

  async issue(
    client: RegisteredOAuthClient,
    grant: ApprovedGrant,
    request: {
      redirectUri: string;
      challenge: string;
      challengeMethod: string;
      state?: string;
    }
  ): Promise<{ redirectUrl: string; expiresIn: number }> {
    // 初期只支持预登记的 HTTPS Web 回调；不支持通配符、动态任意跳转或 native loopback。
    let redirect: URL;
    try {
      redirect = new URL(request.redirectUri);
    } catch {
      throw new OAuthCodeError('invalid_request');
    }
    if (
      !client.clientId ||
      !grant.grantId ||
      client.clientId !== grant.clientId ||
      grant.resource !== this.resource ||
      !client.redirectUris.includes(request.redirectUri) ||
      redirect.protocol !== 'https:' ||
      redirect.username ||
      redirect.password ||
      redirect.hash ||
      redirect.searchParams.has('code') ||
      redirect.searchParams.has('state') ||
      request.challengeMethod !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(request.challenge) ||
      (request.state !== undefined && request.state.length > 2048)
    ) {
      throw new OAuthCodeError('invalid_request');
    }
    if (
      !grant.scopes.length ||
      grant.scopes.some((scope) => !client.allowedScopes.includes(scope))
    ) {
      throw new OAuthCodeError('invalid_scope');
    }
    const expiresIn = 120;
    const record: CodeRecord = {
      grantId: grant.grantId,
      clientId: client.clientId,
      redirectUri: request.redirectUri,
      resource: this.resource,
      scopes: [...new Set(grant.scopes)],
      challenge: request.challenge,
      expiresAt: this.now() + expiresIn * 1000,
    };
    const code = randomBytes(32).toString('base64url');
    if (!(await this.store.putIfAbsent(this.key(code), JSON.stringify(record), expiresIn))) {
      throw new Error('Authorization code allocation failed');
    }
    redirect.searchParams.set('code', code);
    if (request.state !== undefined) redirect.searchParams.set('state', request.state);
    return { redirectUrl: redirect.toString(), expiresIn };
  }

  /** 调用前完成客户端认证；返回 grant 后仍须校验其未撤销，才能发行令牌。 */
  async redeem(
    clientId: string,
    request: {
      code: string;
      verifier: string;
      redirectUri: string;
      resource: string;
    }
  ): Promise<ApprovedGrant> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.code)) throw new OAuthCodeError('invalid_grant');
    const key = this.key(request.code);
    const raw = await this.store.read(key);
    if (!raw) throw new OAuthCodeError('invalid_grant');
    let record: CodeRecord;
    try {
      record = JSON.parse(raw) as CodeRecord;
    } catch {
      throw new OAuthCodeError('invalid_grant');
    }
    if (
      !record ||
      record.clientId !== clientId ||
      record.redirectUri !== request.redirectUri ||
      record.resource !== this.resource ||
      request.resource !== this.resource ||
      !Number.isFinite(record.expiresAt) ||
      record.expiresAt <= this.now() ||
      typeof record.grantId !== 'string' ||
      !record.grantId ||
      !Array.isArray(record.scopes) ||
      !record.scopes.length ||
      record.scopes.some((s) => typeof s !== 'string') ||
      typeof record.challenge !== 'string'
    ) {
      throw new OAuthCodeError('invalid_grant');
    }
    const actual = Buffer.from(pkceS256(request.verifier));
    const expected = Buffer.from(record.challenge);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new OAuthCodeError('invalid_grant');
    if (!(await this.store.consumeIfEqual(key, raw))) throw new OAuthCodeError('invalid_grant');
    return {
      grantId: record.grantId,
      clientId: record.clientId,
      resource: record.resource,
      scopes: record.scopes,
    };
  }
}
