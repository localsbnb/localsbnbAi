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
  mfaRequired?: boolean;
  signupEmail?: string;
  signupAttempted?: boolean;
  signupSentAt?: number;
  consentProcessing?: boolean;
  completedRedirect?: string;
  completedAt?: number;
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
  onDiagnostic?: (event: { phase: string; flow: string }) => void;
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const browserTransactionTtlSeconds = 30 * 60;
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
const styles = `:root{font-family:system-ui,sans-serif;color:#172b36;background:#f3f6fa}*{box-sizing:border-box}body{margin:0;padding:32px 16px}main{max-width:480px;margin:4vh auto;background:white;padding:32px;border-radius:20px;box-shadow:0 8px 40px #10203012}h1{font-size:28px;margin-top:0}p{line-height:1.6}label{display:block;font-size:14px}input,select{display:block;width:100%;padding:12px;margin-top:6px;border:1px solid #c7d1da;border-radius:8px;font:inherit}button{padding:12px 18px;border:0;border-radius:8px;background:#116b59;color:white;font:inherit;cursor:pointer;margin:8px 4px 0 0}details{margin-top:24px;border-top:1px solid #ddd;padding-top:18px}summary{cursor:pointer;color:#116b59}[role=alert]{background:#fff1df;padding:12px;border-radius:8px}small{color:#526270}strong{overflow-wrap:anywhere}@media(max-width:480px){main{padding:22px;margin:0 auto}}`;
function page(res: ServerResponse, body: string, status = 200, redirectOrigin?: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    // Chromium/WebKit also enforce form-action on the consent POST's 303 redirect.
    // Allow only the registered OAuth callback origin, never arbitrary destinations.
    'Content-Security-Policy': `default-src 'none'; style-src 'sha256-${createHash('sha256').update(styles).digest('base64')}'; form-action 'self'${redirectOrigin ? ` ${redirectOrigin}` : ''}; frame-ancestors 'none'; base-uri 'none'`,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    // Browser form POST needs a non-null Origin; send only the origin, never OAuth URL parameters.
    'Referrer-Policy': 'origin',
  });
  res.end(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect LocalsBnb</title>' +
      `<style>${styles}</style>` +
      '<body><main><h1>Connect LocalsBnb</h1><p>Connect your property securely, then return to your conversation.</p>' +
      body +
      '</main></body></html>'
  );
}
const messages: Record<string, string> = {
  signup_failed:
    'Registration could not be completed. If an account was created, sign in above. Otherwise start a new connection to try again.',
  signup_unavailable:
    'These details cannot be used to register. Check them or sign in with your existing account.',
  login_failed: 'Sign-in failed. Check your details and try again.',
  mfa_required: 'An email verification code was sent. Enter it with your email and password to continue.',
  mfa_rate_limit: 'Please wait 60 seconds before signing in without a code to request another one.',
  no_properties: 'This account has no available properties.',
  property_forbidden: 'This property is no longer available to this account. Start again.',
  credential_setup_required:
    'This property needs an existing LocalsBnb App Secret. Contact your administrator, then start again.',
};
class BrowserFlowError extends Error {
  constructor(readonly reason: keyof typeof flowMessages) {
    super(reason);
  }
}
const flowMessages = {
  request: 'The sign-in request was rejected. Start a new connection from ChatGPT. (B01)',
  origin: 'The browser did not send the expected origin. Start a new connection from ChatGPT. (B02)',
  transaction: 'This connection expired or was already used. Start a new connection from ChatGPT. (B03)',
  cookie: 'The browser did not return the sign-in cookie. Allow cookies for this site and start again. (B04)',
  cookieChanged: 'The browser sign-in session changed. Start a new connection from ChatGPT. (B05)',
  csrf: 'This form no longer matches the connection. Start a new connection from ChatGPT. (B06)',
  storage: 'The connection state could not be restored. Start a new connection from ChatGPT. (B07)',
  changed: 'This connection changed while signing in. Start a new connection from ChatGPT. (B08)',
} as const;
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
  const diagnostic = (phase: string, id: string) =>
    options.onDiagnostic?.({ phase, flow: digest(id).slice(0, 12) });
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
      const registration =
        options.bridge.sendSignupCode && options.bridge.signup
          ? `<details ${p.signupEmail ? 'open' : ''}><summary>Create a new account</summary><form method="post" action="/authorize/signup">${hidden}${
              p.signupEmail
                ? `<p>A verification code was sent to ${escape(p.signupEmail)}.</p><label>Email verification code<input name="authCode" autocomplete="one-time-code" maxlength="32" required></label><label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="1024" required></label><small>At least 8 characters, including letters and numbers.</small>${p.signupAttempted ? '<p>Registration was already attempted. Sign in above if your account was created; otherwise start a new connection. We will not submit registration again automatically.</p>' : '<button name="intent" value="complete">Create account</button>'}`
                : `<label>Email<input name="email" type="email" autocomplete="email" maxlength="320" required></label><label>Name<input name="nickName" autocomplete="name" maxlength="100" required></label><label>Country code (e.g. US)<input name="countryCode" minlength="2" maxlength="2" required></label><label>Phone country code (e.g. +1)<input name="areaCode" maxlength="7" required></label><label>Phone number<input name="mobile" type="tel" maxlength="20" required></label><label>Number of listings (optional)<input name="houseNum" type="number" min="1"></label><button name="intent" value="send">Send verification code</button>`
            }</form></details>`
          : '';
      page(
        res,
        intro +
          (message ? `<p role="alert">${escape(message)}</p>` : '') +
          `<form method="post" action="/authorize/login">${hidden}<p><label>Email <input name="email" type="email" autocomplete="username" required></label></p><p><label>Password <input name="password" type="password" autocomplete="current-password" required></label></p>${p.mfaRequired ? '<p><label>Email verification code <input name="authCode" autocomplete="one-time-code" maxlength="32"></label><small>If you need a new code, wait 60 seconds and sign in again without one.</small></p>' : ''}<button type="submit">Sign in</button></form>` +
          registration +
          '<p><small>Your password and verification code stay out of the conversation. Existing credentials are never reset by this connection.</small></p>',
        200,
        new URL(p.redirectUri).origin
      );
    } else {
      page(
        res,
        intro +
          (message ? `<p role="alert">${escape(message)}</p>` : '') +
          `<p>Account: ${escape(p.session.subjectId)}</p><p>Only the selected property will be connected.</p><form method="post" action="/authorize/consent">${hidden}<label>Property <select name="campId">${p.session.camps.map((c) => `<option value="${escape(c.campId)}">${escape(c.name)}</option>`).join('')}</select></label><p><button name="decision" value="approve">Allow access</button> <button name="decision" value="deny">Cancel</button></p></form>`,
        200,
        new URL(p.redirectUri).origin
      );
    }
  }
  return async (req, res) => {
    try {
      if (req.headers.host !== origin.host) throw new BrowserFlowError('request');
      const url = new URL(req.url ?? '/', origin.origin);
      if (url.origin !== origin.origin) throw new BrowserFlowError('request');
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
          expiresAt: now() + browserTransactionTtlSeconds * 1000,
        };
        if (
          !(await options.store.putIfAbsent(
            key(id),
            options.cipher.seal(JSON.stringify(p), key(id)),
            browserTransactionTtlSeconds
          ))
        )
          throw new Error();
        diagnostic('created', id);
        cookie(res, id, browser, browserTransactionTtlSeconds);
        form(res, id, csrf, p);
        return;
      }
      if (
        req.method !== 'POST' ||
        !['/authorize/login', '/authorize/signup', '/authorize/consent'].includes(url.pathname) ||
        url.search
      )
        throw new BrowserFlowError('request');
      if (req.headers.origin !== origin.origin) throw new BrowserFlowError('origin');
      let f: URLSearchParams;
      try {
        f = await readOAuthForm(req);
      } catch {
        throw new BrowserFlowError('request');
      }
      const id = f.get('transaction') ?? '';
      const csrf = f.get('csrf') ?? '';
      if (!/^[A-Za-z0-9_-]{22}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(csrf))
        throw new BrowserFlowError('request');
      const raw = await options.store.read(key(id));
      if (!raw) {
        diagnostic('missing', id);
        throw new BrowserFlowError('transaction');
      }
      let p: Pending;
      try {
        p = JSON.parse(options.cipher.open(raw, key(id))) as Pending;
      } catch {
        throw new BrowserFlowError('storage');
      }
      const cookies = (req.headers.cookie ?? '')
        .split(';')
        .map((c) => c.trim())
        .filter((c) => c.startsWith(cookieName(id) + '='));
      if (cookies.length !== 1) throw new BrowserFlowError('cookie');
      if (p.expiresAt <= now()) {
        diagnostic('expired', id);
        throw new BrowserFlowError('transaction');
      }
      if (!equal(digest(cookies[0].slice(cookieName(id).length + 1)), p.browserHash))
        throw new BrowserFlowError('cookieChanged');
      if (!equal(digest(csrf), p.csrfHash)) throw new BrowserFlowError('csrf');
      if (url.pathname === '/authorize/consent' && p.completedRedirect) {
        if (!p.completedAt || p.completedAt + 120000 <= now())
          throw new BrowserFlowError('transaction');
        diagnostic('replayed', id);
        res.writeHead(303, {
          Location: p.completedRedirect,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        });
        res.end();
        diagnostic('redirect_replayed', id);
        return;
      }
      if (url.pathname === '/authorize/signup') {
        if (p.session || !options.bridge.sendSignupCode || !options.bridge.signup)
          throw new Error();
        const intent = f.get('intent');
        if (intent !== 'send' && intent !== 'complete') throw new Error();
        if (
          intent === 'send' &&
          (p.signupEmail || (p.signupSentAt !== undefined && now() - p.signupSentAt < 60000))
        )
          throw new Error();
        if (intent === 'complete' && (!p.signupEmail || p.signupAttempted)) throw new Error();
        if (
          intent === 'complete' &&
          (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(f.get('password') ?? '') ||
            (f.get('password')?.length ?? 0) > 1024 ||
            !(f.get('authCode') ?? '').trim() ||
            (f.get('authCode')?.length ?? 0) > 32)
        ) {
          form(
            res,
            id,
            csrf,
            p,
            'Enter the email code and a password of at least 8 characters, including letters and numbers.'
          );
          return;
        }
        // Claim before external side effects: duplicate POSTs cannot resend or register twice.
        if (intent === 'send') p.signupSentAt = now();
        else p.signupAttempted = true;
        const claimed = options.cipher.seal(JSON.stringify(p), key(id));
        if (
          !(await options.store.compareAndSet(
            key(id),
            raw,
            claimed,
            Math.ceil((p.expiresAt - now()) / 1000)
          ))
        )
          throw new Error();
        let message = '';
        try {
          if (intent === 'send') {
            const email = (f.get('email') ?? '').trim().toLowerCase();
            await options.bridge.sendSignupCode({
              email,
              nickName: (f.get('nickName') ?? '').trim(),
              countryCode: (f.get('countryCode') ?? '').trim(),
              mobile: (f.get('mobile') ?? '').trim(),
              areaCode: (f.get('areaCode') ?? '').trim(),
              ...(f.get('houseNum') ? { houseNum: Number(f.get('houseNum')) } : {}),
            });
            p.signupEmail = email;
          } else {
            p.session = await options.bridge.signup(
              p.signupEmail!,
              f.get('password') ?? '',
              f.get('authCode') ?? ''
            );
          }
        } catch (error) {
          message =
            error instanceof BrowserAuthError ? messages[error.code] : messages.signup_failed;
        }
        if (
          p.expiresAt <= now() ||
          !(await options.store.compareAndSet(
            key(id),
            claimed,
            options.cipher.seal(JSON.stringify(p), key(id)),
            Math.ceil((p.expiresAt - now()) / 1000)
          ))
        )
          throw new Error();
        form(res, id, csrf, p, message);
        return;
      }
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
            if (error.code === 'mfa_required' || error.code === 'mfa_rate_limit') {
              p.mfaRequired = true;
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
            }
            form(res, id, csrf, p, messages[error.code]);
            return;
          }
          throw error;
        }
        if (p.expiresAt <= now()) throw new BrowserFlowError('transaction');
        if (
          !(await options.store.compareAndSet(
            key(id),
            raw,
            options.cipher.seal(JSON.stringify(p), key(id)),
            Math.ceil((p.expiresAt - now()) / 1000)
          ))
        )
          throw new BrowserFlowError('changed');
        diagnostic('login_ready', id);
        form(res, id, csrf, p);
        return;
      }
      if (!p.session || !['approve', 'deny'].includes(f.get('decision') ?? '')) throw new Error();
      diagnostic('consent_received', id);
      if (p.consentProcessing) throw new BrowserFlowError('changed');
      const campId = f.get('campId') ?? '';
      if (f.get('decision') === 'approve' && !p.session.camps.some((c) => c.campId === campId))
        throw new Error();
      // Claim the request before side effects, but retain it until the redirect is ready.
      // Otherwise an upstream/DB failure makes every retry look like an expired transaction.
      const claimed = options.cipher.seal(JSON.stringify({ ...p, consentProcessing: true }), key(id));
      if (!(await options.store.compareAndSet(key(id), raw, claimed, Math.ceil((p.expiresAt - now()) / 1000))))
        throw new BrowserFlowError('changed');
      const redirect = new URL(p.redirectUri);
      let grantId: string | undefined;
      try {
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
          grantId = grant.grantId;
          await options.grants.create(grant, verified.credential);
          const issued = await options.codes.issue(clients.get(p.clientId)!, grant, {
            redirectUri: p.redirectUri,
            challenge: p.challenge,
            challengeMethod: 'S256',
            state: p.state,
          });
          redirect.href = issued.redirectUrl;
        }
        // A second form POST from the same browser receives the same short-lived code redirect.
        // The code itself remains one-time at /token; no second grant or code is created.
        const remaining = Math.min(120, Math.ceil((p.expiresAt - now()) / 1000));
        if (remaining < 1) throw new BrowserFlowError('transaction');
        const completed = options.cipher.seal(
          JSON.stringify({ ...p, session: undefined, consentProcessing: false,
            completedRedirect: redirect.toString(), completedAt: now() }),
          key(id)
        );
        if (!(await options.store.compareAndSet(key(id), claimed, completed, remaining)))
          throw new BrowserFlowError('changed');
        diagnostic('redirect_ready', id);
      } catch (error) {
        if (grantId) await options.grants.revoke(grantId, p.session.subjectId);
        if (p.expiresAt > now())
          await options.store.compareAndSet(key(id), claimed, raw, Math.ceil((p.expiresAt - now()) / 1000));
        if (error instanceof BrowserAuthError) {
          form(res, id, csrf, p, messages[error.code]);
          return;
        }
        throw error;
      }
      cookie(res, id, cookies[0].slice(cookieName(id).length + 1), Math.min(120, Math.ceil((p.expiresAt - now()) / 1000)));
      res.writeHead(303, {
        Location: redirect.toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      res.end();
      diagnostic('redirect_sent', id);
    } catch (error) {
      req.resume();
      page(
        res,
        `<p role="alert">${escape(error instanceof BrowserAuthError ? messages[error.code] : error instanceof BrowserFlowError ? flowMessages[error.reason] : 'This connection could not be completed. Return to your app and start again.')}</p>`,
        400
      );
    }
  };
}
