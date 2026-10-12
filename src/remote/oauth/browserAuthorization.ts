import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AuthorizationCodeService,
  type OneTimeCodeStore,
  type RegisteredOAuthClient,
} from './authorizationCode.js';
import { CredentialCipher } from './credentialCipher.js';
import type { PostgresGrantStore } from './postgresGrantStore.js';
import type { TokenFamilyStore } from './tokenService.js';
import {
  BrowserAuthError,
  type BrowserLoginBridge,
  type BrowserLoginSession,
} from './hudsonLoginBridge.js';
import { readOAuthForm } from './httpHandler.js';

interface Pending {
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  challenge: string;
  state?: string;
  browserHash: string;
  csrfHash: string;
  expiresAt: number;
  session?: BrowserLoginSession;
}
export interface BrowserAuthorizationOptions {
  issuer: string;
  namespace: string;
  clients: readonly RegisteredOAuthClient[];
  store: OneTimeCodeStore & Pick<TokenFamilyStore, 'compareAndSet'>;
  cipher: CredentialCipher;
  bridge: BrowserLoginBridge;
  grants: Pick<PostgresGrantStore, 'create' | 'revoke'>;
  codes: Pick<AuthorizationCodeService, 'issue'>;
  now?: () => number;
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
function page(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Content-Security-Policy':
      "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect LocalsBnb</title><body><main><h1>Connect LocalsBnb</h1>' +
      body +
      '</main></body></html>'
  );
}
const messages: Record<string, string> = {
  login_failed: 'Sign-in failed. Check your details and try again.',
  mfa_required: 'Enter the email verification code and your password to continue.',
  mfa_rate_limit: 'Please wait before requesting another verification code.',
  no_properties: 'This account has no available properties.',
  property_forbidden: 'This property is no longer available to this account. Start again.',
  credential_setup_required:
    'This property needs an existing LocalsBnb App Secret. Contact your administrator, then start again.',
};
/** 浏览器事务绑定 HttpOnly Cookie + CSRF，Redis 内仅存加密事务；不复用本地凭证路径。 */
export function createBrowserAuthorization(
  options: BrowserAuthorizationOptions
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const origin = new URL(options.issuer);
  if (
    origin.protocol !== 'https:' ||
    options.issuer !== origin.origin ||
    !/^localsbnb:mcp:(dev|prod):oauth$/.test(options.namespace)
  )
    throw new Error('Invalid browser authorization configuration');
  const clients = new Map(
    options.clients.map((c) => [
      c.clientId,
      { ...c, redirectUris: [...c.redirectUris], allowedScopes: [...c.allowedScopes] },
    ])
  );
  const now = options.now ?? Date.now;
  const key = (id: string) => `${options.namespace}:pending:${digest(id)}`;
  const cookieName = (id: string) => `__Host-locals_mcp_${id}`;
  const cookie = (res: ServerResponse, id: string, value: string, age: number) =>
    res.setHeader(
      'Set-Cookie',
      `${cookieName(id)}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`
    );
  function form(res: ServerResponse, id: string, csrf: string, p: Pending, message = ''): void {
    const hidden = `<input type="hidden" name="transaction" value="${escape(id)}"><input type="hidden" name="csrf" value="${escape(csrf)}">`;
    const intro = `<p>Application: <strong>${escape(p.clientId)}</strong></p><p>Requested permissions: ${p.scopes.map(escape).join(', ')}</p>`;
    if (!p.session) {
      page(
        res,
        intro +
          (message ? `<p role="alert">${escape(message)}</p>` : '') +
          `<form method="post" action="/authorize/login">${hidden}<p><label>Email <input name="email" type="email" autocomplete="username" required></label></p><p><label>Password <input name="password" type="password" autocomplete="current-password" required></label></p><p><label>Email verification code (if requested) <input name="authCode" autocomplete="one-time-code"></label></p><button type="submit">Sign in</button></form>`
      );
    } else {
      page(
        res,
        intro +
          `<p>Account: ${escape(p.session.subjectId)}</p><p>Only the selected property will be connected.</p><form method="post" action="/authorize/consent">${hidden}<label>Property <select name="campId">${p.session.camps.map((c) => `<option value="${escape(c.campId)}">${escape(c.name)}</option>`).join('')}</select></label><p><button name="decision" value="approve">Allow access</button> <button name="decision" value="deny">Cancel</button></p></form>`
      );
    }
  }
  return async (req, res) => {
    try {
      if (req.headers.host !== origin.host) throw new Error();
      const url = new URL(req.url ?? '/', origin.origin);
      if (url.origin !== origin.origin) throw new Error();
      if (req.method === 'GET' && url.pathname === '/authorize') {
        const q = url.searchParams;
        for (const k of q.keys()) if (q.getAll(k).length !== 1) throw new Error();
        const client = clients.get(q.get('client_id') ?? '');
        const redirectUri = q.get('redirect_uri') ?? '';
        if (!client || !client.redirectUris.includes(redirectUri)) throw new Error();
        const redirect = new URL(redirectUri);
        const scopes = (q.get('scope') ?? '').split(' ');
        if (
          redirect.protocol !== 'https:' ||
          redirect.username ||
          redirect.password ||
          redirect.hash ||
          redirect.searchParams.has('code') ||
          redirect.searchParams.has('state') ||
          q.get('response_type') !== 'code' ||
          q.get('resource') !== origin.origin + '/mcp' ||
          q.get('code_challenge_method') !== 'S256' ||
          !/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge') ?? '') ||
          scopes.some((s) => !s || !client.allowedScopes.includes(s)) ||
          (q.get('state')?.length ?? 0) > 2048
        )
          throw new Error();
        const id = randomBytes(16).toString('base64url');
        const csrf = randomBytes(32).toString('base64url');
        const browser = randomBytes(32).toString('base64url');
        const p: Pending = {
          clientId: client.clientId,
          redirectUri,
          resource: origin.origin + '/mcp',
          scopes: [...new Set(scopes)],
          challenge: q.get('code_challenge')!,
          state: q.get('state') ?? undefined,
          browserHash: digest(browser),
          csrfHash: digest(csrf),
          expiresAt: now() + 600000,
        };
        if (
          !(await options.store.putIfAbsent(
            key(id),
            options.cipher.seal(JSON.stringify(p), key(id)),
            600
          ))
        )
          throw new Error();
        cookie(res, id, browser, 600);
        form(res, id, csrf, p);
        return;
      }
      if (
        req.method !== 'POST' ||
        !['/authorize/login', '/authorize/consent'].includes(url.pathname) ||
        url.search ||
        req.headers.origin !== origin.origin
      )
        throw new Error();
      const f = await readOAuthForm(req);
      const id = f.get('transaction') ?? '';
      const csrf = f.get('csrf') ?? '';
      if (!/^[A-Za-z0-9_-]{22}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new Error();
      const raw = await options.store.read(key(id));
      if (!raw) throw new Error();
      const p = JSON.parse(options.cipher.open(raw, key(id))) as Pending;
      const cookies = (req.headers.cookie ?? '')
        .split(';')
        .map((c) => c.trim())
        .filter((c) => c.startsWith(cookieName(id) + '='));
      if (
        cookies.length !== 1 ||
        p.expiresAt <= now() ||
        !equal(digest(cookies[0].slice(cookieName(id).length + 1)), p.browserHash) ||
        !equal(digest(csrf), p.csrfHash)
      )
        throw new Error();
      if (url.pathname === '/authorize/login') {
        if (p.session) throw new Error();
        try {
          p.session = await options.bridge.login(
            f.get('email') ?? '',
            f.get('password') ?? '',
            f.get('authCode') ?? undefined
          );
        } catch (error) {
          if (error instanceof BrowserAuthError) {
            form(res, id, csrf, p, messages[error.code]);
            return;
          }
          throw error;
        }
        if (
          p.expiresAt <= now() ||
          !(await options.store.compareAndSet(
            key(id),
            raw,
            options.cipher.seal(JSON.stringify(p), key(id)),
            Math.ceil((p.expiresAt - now()) / 1000)
          ))
        )
          throw new Error();
        form(res, id, csrf, p);
        return;
      }
      if (!p.session || !['approve', 'deny'].includes(f.get('decision') ?? '')) throw new Error();
      const campId = f.get('campId') ?? '';
      if (f.get('decision') === 'approve' && !p.session.camps.some((c) => c.campId === campId))
        throw new Error();
      if (!(await options.store.consumeIfEqual(key(id), raw))) throw new Error();
      cookie(res, id, '', 0);
      const redirect = new URL(p.redirectUri);
      if (f.get('decision') === 'deny') {
        redirect.searchParams.set('error', 'access_denied');
        if (p.state !== undefined) redirect.searchParams.set('state', p.state);
      } else {
        const verified = await options.bridge.authorize(p.session, campId);
        if (verified.subjectId !== p.session.subjectId) throw new Error();
        const grant = {
          grantId: randomUUID(),
          subjectId: verified.subjectId,
          clientId: p.clientId,
          campId,
          resource: p.resource,
          scopes: p.scopes,
          expiresAt: new Date(now() + 7 * 86400000),
        };
        await options.grants.create(grant, verified.credential);
        try {
          const issued = await options.codes.issue(clients.get(p.clientId)!, grant, {
            redirectUri: p.redirectUri,
            challenge: p.challenge,
            challengeMethod: 'S256',
            state: p.state,
          });
          redirect.href = issued.redirectUrl;
        } catch (error) {
          await options.grants.revoke(grant.grantId, grant.subjectId);
          throw error;
        }
      }
      res.writeHead(303, {
        Location: redirect.toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      res.end();
    } catch (error) {
      req.resume();
      page(
        res,
        `<p role="alert">${escape(error instanceof BrowserAuthError ? messages[error.code] : 'This connection could not be completed. Return to your app and start again.')}</p>`,
        400
      );
    }
  };
}
