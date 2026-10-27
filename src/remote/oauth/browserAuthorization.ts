import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AuthorizationCodeService,
  isWorkbuddyRedirect,
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
import { brandMarkDataUri } from './brandMark.js';

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
  edition?: 'cn' | 'overseas';
}
export interface BrowserAuthorizationOptions {
  issuer: string;
  namespace: string;
  clients: readonly RegisteredOAuthClient[];
  resource?: string;
  basePath?: '/authorize' | '/oauth/authorize';
  resolveClient?: (id: string) => Promise<RegisteredOAuthClient | undefined>;
  workbuddy?: boolean;
  workbuddyResource?: string;
  workbuddyBridge?: BrowserLoginBridge;
  workbuddyCodes?: Pick<AuthorizationCodeService, 'issue'>;
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
const styles = `
:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#17233b;background:#f7f9fd;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;min-height:100vh}button,input,select{font:inherit}button{cursor:pointer}
.shell{min-height:100vh;display:grid;grid-template-columns:minmax(340px,42%) minmax(0,1fr)}
.brand-pane{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:48px clamp(36px,5vw,88px);color:#fff;background:linear-gradient(155deg,#1d326b 0%,#304a98 53%,#4d65f6 100%)}
.brand-pane:before,.brand-pane:after{content:"";position:absolute;border:1px solid #ffffff27;border-radius:50%;pointer-events:none}.brand-pane:before{width:560px;height:560px;right:-280px;top:12%}.brand-pane:after{width:760px;height:760px;right:-370px;top:4%}
.brand-top,.brand-story,.brand-foot{position:relative;z-index:1}.brand-top{display:flex;align-items:center;gap:14px;font-size:25px;font-weight:700;letter-spacing:-.035em}.brand-top img,.mobile-brand img{width:50px;height:50px;border-radius:13px;background:#fff;object-fit:contain}.brand-story{max-width:430px}.brand-kicker{font-size:12px;font-weight:700;letter-spacing:.19em;text-transform:uppercase;color:#c9d5ff}.brand-story h2{font-size:clamp(32px,3.2vw,50px);line-height:1.2;letter-spacing:-.045em;margin:18px 0}.brand-story p{font-size:16px;line-height:1.8;color:#dce5ff}.brand-foot{font-size:12px;color:#c5d1fb}
.main-pane{display:flex;align-items:center;justify-content:center;min-width:0;padding:52px 28px}.card{width:min(100%,480px);min-width:0}.mobile-brand{display:none;align-items:center;gap:12px;font-size:22px;font-weight:700;margin-bottom:34px}.eyebrow{color:#5268be;font-size:12px;font-weight:750;letter-spacing:.13em;text-transform:uppercase;margin:0 0 12px}.card h1{font-size:32px;line-height:1.2;letter-spacing:-.04em;margin:0 0 12px;color:#14213c}.lead{color:#61708b;font-size:15px;line-height:1.7;margin:0 0 30px}.content{min-width:0}.field{display:block;margin:20px 0 0;font-size:13px;font-weight:650;color:#34415b}.field input,.field select{display:block;width:100%;height:48px;margin-top:8px;padding:0 14px;border:1px solid #d9e0ec;border-radius:11px;background:#fff;color:#17233b;outline:none;transition:border-color .15s,box-shadow .15s}.field input:focus,.field select:focus{border-color:#4d65f6;box-shadow:0 0 0 4px #4d65f620}.field input::placeholder{color:#a3aec1}.field select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,#62708a 50%),linear-gradient(135deg,#62708a 50%,transparent 50%);background-position:calc(100% - 19px) 21px,calc(100% - 14px) 21px;background-size:5px 5px;background-repeat:no-repeat;padding-right:36px}
.actions{display:flex;gap:12px;margin-top:26px}.button{min-height:48px;border-radius:11px;padding:11px 20px;border:1px solid transparent;font-weight:700;transition:background .15s,transform .15s}.button:active{transform:translateY(1px)}.button-primary{background:#4d65f6;color:#fff;box-shadow:0 8px 20px #4d65f62b}.button-primary:hover{background:#394fdf}.button-secondary{background:#fff;border-color:#d9e0ec;color:#34415b}.button-secondary:hover{background:#f6f8fd}.actions .button-primary{flex:1}.actions .button-secondary{min-width:100px}
.meta{border:1px solid #e2e7f1;border-radius:14px;background:#fbfcff;padding:16px 18px;margin:0 0 22px;min-width:0}.meta-row{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;font-size:13px;line-height:1.6;min-width:0}.meta-row+.meta-row{margin-top:9px}.meta-key{color:#6b7891;flex:none}.meta-value{color:#263550;font-weight:600;text-align:right;overflow-wrap:anywhere;min-width:0}.scope-list{display:flex;flex-wrap:wrap;gap:7px;justify-content:flex-end}.scope{display:inline-block;border-radius:7px;background:#edf1ff;color:#3e56cf;padding:2px 8px;font-size:12px;font-weight:650}
.notice{border:1px solid #f1d9bc;background:#fff8ec;color:#765124;padding:13px 15px;border-radius:11px;font-size:13px;line-height:1.6;margin:0 0 22px}.note{color:#7a879c;font-size:12px;line-height:1.7;margin:18px 0 0}.divider{border:0;border-top:1px solid #e9edf4;margin:30px 0 20px}.register{border-top:1px solid #e9edf4;margin-top:30px;padding-top:20px}.register summary{font-size:14px;font-weight:650;color:#465fe0;cursor:pointer}.register p{font-size:13px;line-height:1.6;color:#66758f}.register small{font-size:12px;color:#7a879c}.register .button{width:100%;margin-top:20px}
.edition-choice{border:0;margin:0;padding:0;min-width:0}.edition-choice legend{font-size:13px;font-weight:650;color:#34415b;margin-bottom:9px}.edition-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.edition-option{position:relative;display:block;min-width:0;cursor:pointer}.edition-option input{position:absolute;opacity:0;width:1px;height:1px}.edition-option span{display:block;border:1px solid #dce2ee;border-radius:11px;padding:13px 10px;color:#495670;font-size:14px;font-weight:650;text-align:center;overflow-wrap:anywhere}.edition-option input:checked+span{border-color:#4d65f6;background:#eef1ff;color:#324bd0}.edition-option input:focus-visible+span{outline:3px solid #a3afff;outline-offset:2px}
.error-card{border:1px solid #e7ebf3;background:#fff;border-radius:15px;padding:20px}.error-card .notice{margin-bottom:0}.error-hint{font-size:13px;line-height:1.7;color:#6b7891;margin:17px 0 0}
@media(max-width:900px){.shell{grid-template-columns:minmax(0,1fr)}.brand-pane{display:none}.main-pane{padding:42px 24px}.mobile-brand{display:flex}}@media(max-width:480px){.main-pane{align-items:flex-start;padding:34px 22px 50px}.card h1{font-size:28px}.lead{margin-bottom:25px}.mobile-brand{margin-bottom:40px}.actions{flex-wrap:wrap}.actions .button{width:100%}.meta-row{gap:10px}.meta{padding:14px}.scope-list{justify-content:flex-end}}`;
const editionScript = `document.querySelectorAll('input[name="edition"]').forEach(input=>input.addEventListener('change',()=>{const cn=document.querySelector('input[name="edition"]:checked')?.value==='cn';document.querySelectorAll('[data-cn][data-overseas]').forEach(el=>{el.textContent=el.getAttribute(cn?'data-cn':'data-overseas')});document.documentElement.lang=cn?'zh-CN':'en';document.title=(cn?'登录并连接门店 · 路客云':'Sign in to connect · LocalsBnb')}));`;
const dualText = (cn: string, overseas: string, selected: boolean): string =>
  `<span data-cn="${escape(cn)}" data-overseas="${escape(overseas)}">${escape(selected ? cn : overseas)}</span>`;
function page(res: ServerResponse, body: string, status = 200, redirectOrigin?: string, chinese = false, stage: 'login' | 'consent' | 'error' = 'login', workbuddy = false): void {
  const brand = chinese ? '路客云' : 'LocalsBnb';
  const title = stage === 'consent' ? (chinese ? '授权连接门店' : 'Connect a property') : stage === 'error' ? (chinese ? '连接未完成' : 'Connection not completed') : (chinese ? '登录并连接门店' : 'Sign in to connect');
  const destination = workbuddy ? 'WorkBuddy' : 'ChatGPT';
  const dynamic = workbuddy && stage === 'login';
  const label = (cn: string, overseas: string) => dynamic ? dualText(cn, overseas, chinese) : escape(chinese ? cn : overseas);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    // Chromium/WebKit also enforce form-action on the consent POST's 303 redirect.
    // Allow only the registered OAuth callback origin, never arbitrary destinations.
    'Content-Security-Policy': `default-src 'none'; img-src data:; style-src 'sha256-${createHash('sha256').update(styles).digest('base64')}'; ${dynamic ? `script-src 'sha256-${createHash('sha256').update(editionScript).digest('base64')}'; ` : ''}form-action 'self'${redirectOrigin ? ` ${redirectOrigin}` : ''}; frame-ancestors 'none'; base-uri 'none'`,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    // Browser form POST needs a non-null Origin; send only the origin, never OAuth URL parameters.
    'Referrer-Policy': 'origin',
  });
  res.end(
    `<!doctype html><html lang="${chinese ? 'zh-CN' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${brand}</title>` +
      `<style>${styles}</style>` +
      `<body><div class="shell"><aside class="brand-pane"><div class="brand-top"><img src="${brandMarkDataUri}" alt="">${label('路客云', 'LocalsBnb')}</div><div class="brand-story"><div class="brand-kicker">${label('值得信赖的门店连接', 'A secure connection')}</div><h2>${label('让门店运营，连接更多可能。', 'Your property, connected.')}</h2><p>${label('选择门店并确认授权，让服务在你许可的范围内工作。', 'Choose a property and review permissions before you connect.')}</p></div><div class="brand-foot">© ${new Date().getFullYear()} ${label('路客云', 'LocalsBnb')}</div></aside><main class="main-pane"><div class="card"><div class="mobile-brand"><img src="${brandMarkDataUri}" alt="">${label('路客云', 'LocalsBnb')}</div><p class="eyebrow">${label('安全授权', 'SECURE AUTHORIZATION')}</p><h1>${dynamic ? label('登录并连接门店', 'Sign in to connect') : title}</h1><p class="lead">${stage === 'error' ? label('请查看下方提示，然后重新发起连接。', 'Review the message below, then start a new connection.') : label(`完成后将返回 ${destination}。`, `After connecting, you will return to ${destination}.`)}</p><div class="content">${body}</div></div></main></div>${dynamic ? `<script>${editionScript}</script>` : ''}</body></html>`
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
const chineseMessages: Record<string, string> = {
  [messages.signup_failed]: '注册未能完成。如果账号已创建，请直接登录；否则请重新发起连接。',
  [messages.signup_unavailable]: '这些资料暂时无法用于注册。请检查后重试，或使用已有账号登录。',
  [messages.login_failed]: '登录失败，请检查账号和密码后重试。',
  [messages.mfa_required]: '邮箱验证码已发送，请输入验证码后继续。',
  [messages.mfa_rate_limit]: '请等待 60 秒后再请求新的验证码。',
  [messages.no_properties]: '该账号暂无可连接的门店。',
  [messages.property_forbidden]: '该门店已不属于当前账号，请重新发起连接。',
  [messages.credential_setup_required]: '该门店尚未配置路客云 App Secret，请联系管理员后重新发起连接。',
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
const chineseFlowMessages: Record<keyof typeof flowMessages, string> = {
  request: '连接请求无效，请从应用重新发起连接。(B01)',
  origin: '浏览器未提供预期的来源信息，请从应用重新发起连接。(B02)',
  transaction: '本次连接已过期或已经使用，请从应用重新发起连接。(B03)',
  cookie: '浏览器未返回登录 Cookie。请允许此网站使用 Cookie，然后重新连接。(B04)',
  cookieChanged: '浏览器登录会话已变化，请重新发起连接。(B05)',
  csrf: '表单已与本次连接不匹配，请重新发起连接。(B06)',
  storage: '无法恢复连接状态，请重新发起连接。(B07)',
  changed: '连接状态在操作过程中发生变化，请重新发起连接。(B08)',
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
  const basePath = options.basePath ?? '/authorize';
  const resource = options.resource ?? origin.origin + '/mcp';
  const clientFor = async (id: string, target: string) =>
    target === options.workbuddyResource ? options.resolveClient?.(id) : clients.get(id);
  const isWorkbuddy = (p: Pick<Pending, 'resource'>) => options.workbuddy || p.resource === options.workbuddyResource;
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
    const chinese = isWorkbuddy(p) && p.edition === 'cn';
    const label = (cn: string, overseas: string) => isWorkbuddy(p) && !p.session ? dualText(cn, overseas, chinese) : escape(chinese ? cn : overseas);
    const intro = `<div class="meta"><div class="meta-row"><span class="meta-key">${label('连接应用', 'Application')}</span><span class="meta-value">${escape(p.clientId)}</span></div><div class="meta-row"><span class="meta-key">${label('申请权限', 'Permissions')}</span><span class="meta-value scope-list">${p.scopes.map((scope) => `<span class="scope">${escape(scope)}</span>`).join('')}</span></div></div>`;
    const notice = message ? `<div role="alert" class="notice">${escape(chinese ? chineseMessages[message] ?? message : message)}</div>` : '';
    const callbackUrl = new URL(p.redirectUri);
    const callback = callbackUrl.protocol === 'workbuddy:' ? 'workbuddy:' : callbackUrl.origin;
    if (!p.session) {
      const registration =
        !isWorkbuddy(p) && options.bridge.sendSignupCode && options.bridge.signup
          ? `<details class="register" ${p.signupEmail ? 'open' : ''}><summary>Create a new account</summary><form method="post" action="${basePath}/signup">${hidden}${
              p.signupEmail
                ? `<p>A verification code was sent to ${escape(p.signupEmail)}.</p><label class="field">Email verification code<input name="authCode" autocomplete="one-time-code" maxlength="32" required></label><label class="field">New password<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="1024" required></label><small>At least 8 characters, including letters and numbers.</small>${p.signupAttempted ? '<p>Registration was already attempted. Sign in above if your account was created; otherwise start a new connection. We will not submit registration again automatically.</p>' : '<button class="button button-primary" name="intent" value="complete">Create account</button>'}`
                : `<label class="field">Email<input name="email" type="email" autocomplete="email" maxlength="320" required></label><label class="field">Name<input name="nickName" autocomplete="name" maxlength="100" required></label><label class="field">Country code (e.g. US)<input name="countryCode" minlength="2" maxlength="2" required></label><label class="field">Phone country code (e.g. +1)<input name="areaCode" maxlength="7" required></label><label class="field">Phone number<input name="mobile" type="tel" maxlength="20" required></label><label class="field">Number of listings (optional)<input name="houseNum" type="number" min="1"></label><button class="button button-primary" name="intent" value="send">Send verification code</button>`
            }</form></details>`
          : '';
      page(
        res,
        intro +
          notice +
          `<form method="post" action="${basePath}/login">${hidden}${isWorkbuddy(p) ? `<fieldset class="edition-choice"><legend>${label('选择地区', 'Choose a region')}</legend><div class="edition-options"><label class="edition-option"><input type="radio" name="edition" value="cn"${p.edition === 'cn' ? ' checked' : ''}><span>中国国内 · 路客云</span></label><label class="edition-option"><input type="radio" name="edition" value="overseas"${p.edition === 'overseas' ? ' checked' : ''}><span>Overseas · LocalsBnb</span></label></div></fieldset>` : ''}<label class="field">${label('邮箱或手机号', isWorkbuddy(p) ? 'Email or phone' : 'Email')}<input name="email" type="${isWorkbuddy(p) ? 'text' : 'email'}" autocomplete="username" required></label><label class="field">${label('密码', 'Password')}<input name="password" type="password" autocomplete="current-password" required></label>${p.mfaRequired ? `<label class="field">${label('邮箱验证码', 'Email verification code')}<input name="authCode" autocomplete="one-time-code" maxlength="32"></label><p class="note">${label('如需新验证码，请等待 60 秒后不填写验证码再次登录。', 'For a new code, wait 60 seconds and sign in again without a code.')}</p>` : ''}<div class="actions"><button class="button button-primary" type="submit">${label('登录并继续', 'Sign in and continue')}</button></div></form>` +
          registration +
          `<p class="note">${label('密码与验证码不会进入对话，也不会重置现有凭证。', 'Your password and verification code stay out of the conversation. Existing credentials are never reset.')}</p>`,
        200,
        callback,
        chinese,
        'login',
        isWorkbuddy(p)
      );
    } else {
      page(
        res,
        intro +
          notice +
          `<div class="meta"><div class="meta-row"><span class="meta-key">${chinese ? '当前账号' : 'Account'}</span><span class="meta-value">${escape(p.session.subjectId)}</span></div></div><form method="post" action="${basePath}/consent">${hidden}<label class="field">${chinese ? '授权门店' : 'Property'}<select name="campId">${p.session.camps.map((c) => `<option value="${escape(c.campId)}">${escape(c.name)}</option>`).join('')}</select></label><p class="note">${chinese ? '只有选中的门店会被连接。' : 'Only the selected property will be connected.'}</p><div class="actions"><button class="button button-primary" name="decision" value="approve">${chinese ? '允许访问' : 'Allow access'}</button><button class="button button-secondary" name="decision" value="deny">${chinese ? '取消' : 'Cancel'}</button></div></form>`,
        200,
        callback,
        chinese,
        'consent',
        isWorkbuddy(p)
      );
    }
  }
  return async (req, res) => {
    let errorChinese = false;
    let errorWorkbuddy = false;
    try {
      if (req.headers.host !== origin.host) throw new BrowserFlowError('request');
      const url = new URL(req.url ?? '/', origin.origin);
      if (url.origin !== origin.origin) throw new BrowserFlowError('request');
      if (req.method === 'GET' && url.pathname === basePath) {
        const q = url.searchParams;
        for (const k of q.keys()) if (q.getAll(k).length !== 1) throw new Error();
        const client = await clientFor(q.get('client_id') ?? '', q.get('resource') ?? '');
        const redirectUri = q.get('redirect_uri') ?? '';
        if (!client || !client.redirectUris.includes(redirectUri)) throw new Error();
        const redirect = new URL(redirectUri);
        // WorkBuddy omits scope even after dynamic registration. In OAuth this
        // means the authorization server chooses the default; show the full
        // registered permission set on the consent page before issuing a grant.
        const scopes = (q.get('scope') ??
          (q.get('resource') === options.workbuddyResource ? client.allowedScopes.join(' ') : '')).split(' ');
        if (
          !((q.get('resource') === options.workbuddyResource || options.workbuddy) ? isWorkbuddyRedirect(redirect) : redirect.protocol === 'https:') ||
          redirect.username ||
          redirect.password ||
          redirect.hash ||
          redirect.searchParams.has('code') ||
          redirect.searchParams.has('state') ||
          q.get('response_type') !== 'code' ||
          (q.get('resource') !== resource && q.get('resource') !== options.workbuddyResource) ||
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
          resource: q.get('resource')!,
          scopes: [...new Set(scopes)],
          challenge: q.get('code_challenge')!,
          state: q.get('state') ?? undefined,
          browserHash: digest(browser),
          csrfHash: digest(csrf),
          expiresAt: now() + browserTransactionTtlSeconds * 1000,
        };
        if (isWorkbuddy(p)) {
          const preferred = q.get('ui_locales') ?? req.headers['accept-language'] ?? '';
          p.edition = /^zh(?:-|,|$)/i.test(preferred) ? 'cn' : 'overseas';
        }
        errorChinese = isWorkbuddy(p) && p.edition === 'cn';
        errorWorkbuddy = isWorkbuddy(p);
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
        ![`${basePath}/login`, `${basePath}/signup`, `${basePath}/consent`].includes(url.pathname) ||
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
      errorChinese = isWorkbuddy(p) && p.edition === 'cn';
      errorWorkbuddy = isWorkbuddy(p);
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
      if (url.pathname === `${basePath}/consent` && p.completedRedirect) {
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
      if (url.pathname === `${basePath}/signup`) {
        if (p.session || isWorkbuddy(p) || !options.bridge.sendSignupCode || !options.bridge.signup)
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
      if (url.pathname === `${basePath}/login`) {
        if (p.session) throw new Error();
        try {
          const selectedEdition = isWorkbuddy(p) ? f.get('edition') : undefined;
          if (isWorkbuddy(p) && selectedEdition !== 'cn' && selectedEdition !== 'overseas') throw new Error();
          p.edition = selectedEdition as 'cn' | 'overseas' | undefined;
          p.session = await (isWorkbuddy(p) ? options.workbuddyBridge ?? options.bridge : options.bridge).login(
            f.get('email') ?? '',
            f.get('password') ?? '',
            f.get('authCode') ?? undefined,
            ...(isWorkbuddy(p) ? [p.edition] as const : [])
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
          const verified = await (isWorkbuddy(p) ? options.workbuddyBridge ?? options.bridge : options.bridge).authorize(
            p.session, campId, ...(isWorkbuddy(p) ? [p.edition] as const : [])
          );
          if (verified.subjectId !== p.session.subjectId) throw new Error();
          const grant = {
            grantId: randomUUID(),
            subjectId: verified.subjectId,
            clientId: p.clientId,
            campId,
            resource: p.resource,
            scopes: p.scopes,
            expiresAt: new Date(now() + (isWorkbuddy(p) ? 30 : 7) * 86400000),
          };
          grantId = grant.grantId;
          await options.grants.create(grant, verified.credential);
          const client = await clientFor(p.clientId, p.resource);
          if (!client) throw new Error();
          const issued = await (isWorkbuddy(p) ? options.workbuddyCodes ?? options.codes : options.codes).issue(client, grant, {
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
        `<div class="error-card"><div role="alert" class="notice">${escape(error instanceof BrowserAuthError ? (errorChinese ? chineseMessages[messages[error.code]] ?? messages[error.code] : messages[error.code]) : error instanceof BrowserFlowError ? (errorChinese ? chineseFlowMessages[error.reason] : flowMessages[error.reason]) : (errorChinese ? '本次连接未能完成，请返回应用并重新发起连接。' : 'This connection could not be completed. Return to your app and start again.'))}</div><p class="error-hint">${errorChinese ? '请关闭此页面，并从应用重新开始。' : 'Close this page and start a new connection from your app.'}</p></div>`,
        400,
        undefined,
        errorChinese,
        'error',
        errorWorkbuddy
      );
    }
  };
}
