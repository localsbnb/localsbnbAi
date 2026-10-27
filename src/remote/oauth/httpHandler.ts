import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  AuthorizationCodeService,
  OAuthCodeError,
  type RegisteredOAuthClient,
} from './authorizationCode.js';
import { OAuthTokenService, OAuthTokenError } from './tokenService.js';

export type HttpOAuthClient = RegisteredOAuthClient &
  ({ authMethod: 'none' } | { authMethod: 'client_secret_basic'; secretSha256: string });
export interface OAuthHttpOptions {
  issuer: string;
  resource: string;
  clients: readonly HttpOAuthClient[];
  basePath?: '' | '/oauth';
  metadataPath?: string;
  resolveClient?: (id: string) => Promise<HttpOAuthClient | undefined>;
  scopesSupported?: readonly string[];
  workbuddyResource?: string;
  workbuddyCodes?: Pick<AuthorizationCodeService, 'redeem'>;
  workbuddyTokens?: Pick<OAuthTokenService, 'issue' | 'refresh' | 'revoke'>;
  codes: Pick<AuthorizationCodeService, 'redeem'>;
  tokens: Pick<OAuthTokenService, 'issue' | 'refresh' | 'revoke'>;
  /** 必须由部署注入可信来源限流；不得盲目信任客户端 X-Forwarded-For。 */
  allowRequest: (req: IncomingMessage) => Promise<boolean>;
  authorization?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** 仅记录令牌兑换阶段和状态，不接收请求体或凭证。 */
  onTokenDiagnostic?: (event: { phase: 'received' | 'issued' | 'rejected'; status?: number; error?: string }) => void;
}
class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(code);
  }
}
function send(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
}
function required(form: URLSearchParams, key: string): string {
  const value = form.get(key);
  if (!value) throw new HttpError(400, 'invalid_request');
  return value;
}
export async function readOAuthForm(req: IncomingMessage): Promise<URLSearchParams> {
  if (
    req.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
      'application/x-www-form-urlencoded' ||
    req.headers['content-encoding']
  )
    throw new HttpError(415, 'invalid_request');
  const body = await new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (failed) return;
      if (size > 16 * 1024) {
        failed = true;
        chunks.length = 0;
        reject(new HttpError(413, 'invalid_request'));
        return;
      }
      chunks.push(chunk);
    });
    req.once('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.once('error', () => reject(new HttpError(400, 'invalid_request')));
    req.once('aborted', () => reject(new HttpError(400, 'invalid_request')));
  });
  const form = new URLSearchParams(body);
  for (const key of form.keys())
    if (form.getAll(key).length !== 1) throw new HttpError(400, 'invalid_request');
  return form;
}
async function authenticate(
  req: IncomingMessage,
  form: URLSearchParams,
  clients: ReadonlyMap<string, HttpOAuthClient>,
  resolveClient?: (id: string) => Promise<HttpOAuthClient | undefined>
): Promise<HttpOAuthClient> {
  if (form.has('client_secret')) throw new HttpError(400, 'invalid_request');
  const header = req.headers.authorization;
  let id: string;
  let secret: string | undefined;
  if (header) {
    if (form.has('client_id') || (req.headersDistinct.authorization?.length ?? 0) !== 1)
      throw new HttpError(400, 'invalid_request');
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
    if (!match) throw new HttpError(401, 'invalid_client');
    const decoded = Buffer.from(match[1], 'base64');
    if (decoded.toString('base64') !== match[1]) throw new HttpError(401, 'invalid_client');
    const raw = decoded.toString('utf8');
    const colon = raw.indexOf(':');
    if (colon < 0) throw new HttpError(401, 'invalid_client');
    try {
      id = decodeURIComponent(raw.slice(0, colon).replace(/\+/g, ' '));
      secret = decodeURIComponent(raw.slice(colon + 1).replace(/\+/g, ' '));
    } catch {
      throw new HttpError(401, 'invalid_client');
    }
  } else {
    id = required(form, 'client_id');
  }
  const client = clients.get(id) ?? await resolveClient?.(id);
  if (!client) throw new HttpError(401, 'invalid_client');
  if (client.authMethod === 'none') {
    if (header) throw new HttpError(401, 'invalid_client');
  } else {
    const actual = createHash('sha256')
      .update(secret ?? '')
      .digest();
    if (!secret || !timingSafeEqual(actual, Buffer.from(client.secretSha256, 'hex')))
      throw new HttpError(401, 'invalid_client');
  }
  return client;
}

/** 独立路由组件，不启动监听、不加载 dotenv/本地凭证；TLS/代理与登录桥接尚待部署层接入。 */
export function createOAuthHttpHandler(
  options: OAuthHttpOptions
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const issuer = new URL(options.issuer);
  if (
    issuer.protocol !== 'https:' ||
    options.issuer !== issuer.origin ||
    options.resource !== `${issuer.origin}${options.basePath ? '/workbuddy/mcp' : '/mcp'}`
  ) {
    throw new Error('OAuth HTTP requires an HTTPS root issuer and its /mcp resource');
  }
  const clients = new Map<string, HttpOAuthClient>();
  const basePath = options.basePath ?? '';
  const authorizationPath = `${basePath}/authorize`;
  const tokenPath = `${basePath}/token`;
  const revokePath = `${basePath}/revoke`;
  const metadataPath = options.metadataPath ?? '/.well-known/oauth-protected-resource/mcp';
  for (const client of options.clients) {
    if (
      !client.clientId ||
      clients.has(client.clientId) ||
      (client.authMethod !== 'none' && client.authMethod !== 'client_secret_basic') ||
      (client.authMethod === 'client_secret_basic' && !/^[a-f0-9]{64}$/.test(client.secretSha256))
    )
      throw new Error('Invalid OAuth client registration');
    clients.set(client.clientId, {
      ...client,
      redirectUris: [...client.redirectUris],
      allowedScopes: [...client.allowedScopes],
    });
  }
  return async (req, res) => {
    const tokenRequest = req.method === 'POST' && req.url?.split('?')[0] === tokenPath;
    if (tokenRequest) options.onTokenDiagnostic?.({ phase: 'received' });
    try {
      // 固定 issuer，忽略代理头生成 URL；部署代理必须保留已批准 Host。
      if (req.headers.host !== issuer.host) throw new HttpError(400, 'invalid_request');
      const url = new URL(req.url ?? '/', issuer.origin);
      if (url.origin !== issuer.origin) throw new HttpError(400, 'invalid_request');
      const path = url.pathname;
      if (
        [authorizationPath, `${authorizationPath}/login`, `${authorizationPath}/signup`, `${authorizationPath}/consent`].includes(path)
      ) {
        if (!options.authorization) throw new HttpError(503, 'temporarily_unavailable');
        if (!(await options.allowRequest(req))) throw new HttpError(429, 'temporarily_unavailable');
        await options.authorization(req, res);
        return;
      }
      if (path === '/readyz') throw new HttpError(503, 'temporarily_unavailable');
      if (url.search) throw new HttpError(400, 'invalid_request'); // token/secret 不接受 URL 参数。
      if (req.method === 'GET' && path === '/.well-known/oauth-authorization-server') {
        send(res, 200, {
          issuer: issuer.origin,
          authorization_endpoint: `${issuer.origin}${authorizationPath}`,
          token_endpoint: `${issuer.origin}${tokenPath}`,
          revocation_endpoint: `${issuer.origin}${revokePath}`,
          ...(options.resolveClient ? { registration_endpoint: `${issuer.origin}/oauth/register` } : {}),
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
          revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
          scopes_supported: [
            ...new Set(options.scopesSupported ?? [...clients.values()].flatMap((c) => [...c.allowedScopes])),
          ],
        });
        return;
      }
      if (req.method === 'GET' && path === metadataPath) {
        send(res, 200, {
          resource: options.resource,
          authorization_servers: [issuer.origin],
          bearer_methods_supported: ['header'],
        });
        return;
      }
      if (req.method === 'GET' && path === '/.well-known/oauth-protected-resource' && options.workbuddyResource) {
        send(res, 200, { resource: options.workbuddyResource, authorization_servers: [issuer.origin], bearer_methods_supported: ['header'] });
        return;
      }
      if (![tokenPath, revokePath].includes(path)) throw new HttpError(404, 'not_found');
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        throw new HttpError(405, 'invalid_request');
      }
      // 初期仅服务端客户端调用，尚未开放跨域浏览器 CORS；认证不使用浏览器 Cookie。
      if (req.headers.origin && req.headers.origin !== issuer.origin)
        throw new HttpError(403, 'invalid_request');
      if (!(await options.allowRequest(req))) throw new HttpError(429, 'temporarily_unavailable');
      const form = await readOAuthForm(req);
      const client = await authenticate(req, form, clients, options.resolveClient);
      const isWorkbuddy = !!options.workbuddyResource &&
        (path === revokePath ? client.clientId.startsWith('wb_') : form.get('resource') === options.workbuddyResource);
      if (isWorkbuddy !== client.clientId.startsWith('wb_')) throw new HttpError(400, 'invalid_target');
      const tokenService = isWorkbuddy ? options.workbuddyTokens : options.tokens;
      const codeService = isWorkbuddy ? options.workbuddyCodes : options.codes;
      if (!tokenService || !codeService) throw new HttpError(400, 'invalid_target');
      if (path === revokePath) {
        await tokenService.revoke(client.clientId, required(form, 'token'));
        send(res, 200, {});
        return;
      }
      const grantType = required(form, 'grant_type');
      if (!['authorization_code', 'refresh_token'].includes(grantType))
        throw new HttpError(400, 'unsupported_grant_type');
      const resource = required(form, 'resource');
      if (resource !== (isWorkbuddy ? options.workbuddyResource : options.resource)) throw new HttpError(400, 'invalid_target');
      if (form.has('scope')) throw new HttpError(400, 'invalid_scope'); // 初期仅使用授权时的完整 scope。
      if (grantType === 'authorization_code') {
        const redirectUri = required(form, 'redirect_uri');
        if (!client.redirectUris.includes(redirectUri)) throw new HttpError(400, 'invalid_grant');
        const approved = await codeService.redeem(client.clientId, {
          code: required(form, 'code'),
          verifier: required(form, 'code_verifier'),
          redirectUri,
          resource,
        });
        if (approved.scopes.some((s) => !client.allowedScopes.includes(s)))
          throw new HttpError(400, 'invalid_scope');
        send(res, 200, await tokenService.issue(approved));
      } else {
        send(
          res,
          200,
          await tokenService.refresh(client.clientId, required(form, 'refresh_token'), resource)
        );
      }
      if (tokenRequest) options.onTokenDiagnostic?.({ phase: 'issued', status: 200 });
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof OAuthCodeError || error instanceof OAuthTokenError
            ? 400
            : 503;
      const code =
        error instanceof HttpError ||
        error instanceof OAuthCodeError ||
        error instanceof OAuthTokenError
          ? error.code
          : 'temporarily_unavailable';
      if (tokenRequest) options.onTokenDiagnostic?.({ phase: 'rejected', status, error: code });
      if (status === 401) res.setHeader('WWW-Authenticate', 'Basic realm="mcp-oauth"');
      if (status === 429) res.setHeader('Retry-After', '60');
      // 原始数据库错误、请求体和认证头不写入日志或响应。
      req.resume();
      send(res, status, { error: code });
    }
  };
}
