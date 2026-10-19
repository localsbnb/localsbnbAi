export interface BrowserLoginSession {
  subjectId: string;
  loginToken: string;
  camps: Array<{ campId: string; name: string }>;
}
export class BrowserAuthError extends Error {
  constructor(
    public readonly code:
      | 'login_failed'
      | 'mfa_required'
      | 'mfa_rate_limit'
      | 'no_properties'
      | 'property_forbidden'
      | 'credential_setup_required'
      | 'signup_failed'
      | 'signup_unavailable'
  ) {
    super(code);
  }
}
export interface SignupProfile {
  email: string;
  nickName: string;
  countryCode: string;
  mobile: string;
  areaCode: string;
  houseNum?: number;
}
export interface BrowserLoginBridge {
  sendSignupCode?(profile: SignupProfile): Promise<void>;
  signup?(email: string, password: string, authCode: string): Promise<BrowserLoginSession>;
  login(email: string, password: string, authCode?: string): Promise<BrowserLoginSession>;
  authorize(
    session: BrowserLoginSession,
    campId: string
  ): Promise<{ subjectId: string; credential: string }>;
}
interface Envelope {
  success?: boolean;
  errorCode?: string;
  data?: unknown;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function id(value: unknown): string {
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new BrowserAuthError('login_failed'); // 拒绝 JS 精度丢失的 Long。
}
/** 请求级登录适配器；禁止调用本地 persistSession 或重置已有 App Secret。 */
export class HudsonLoginBridge implements BrowserLoginBridge {
  private readonly origin: string;
  constructor(
    environment: 'dev' | 'prod',
    private readonly fetcher: typeof fetch = fetch
  ) {
    if (!['dev', 'prod'].includes(environment))
      throw new Error('Explicit Hudson environment required');
    this.origin =
      environment === 'dev'
        ? 'https://hudson-dev.localhome.cn'
        : 'https://hudson-prod.localhome.cn';
  }
  private async post(path: string, body: object, token?: string, campId = '0'): Promise<Envelope> {
    try {
      const response = await this.fetcher(this.origin + path, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          campId,
          ...(token ? { 'hudson-access-token': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      return (await response.json()) as Envelope;
    } catch {
      throw new BrowserAuthError('login_failed');
    }
  }
  private async identity(token: string): Promise<BrowserLoginSession> {
    const own = await this.post('/user/own/get', {}, token);
    if (own.success !== true) throw new BrowserAuthError('login_failed');
    const subjectId = id(record(own.data).userId);
    const properties = await this.post('/camps/get', {}, token);
    if (properties.success !== true) throw new BrowserAuthError('login_failed');
    const rawCamps = record(properties.data).camps;
    if (!Array.isArray(rawCamps)) throw new BrowserAuthError('no_properties');
    const camps = rawCamps.map((c) => {
      const r = record(c);
      return { campId: id(r.campId), name: typeof r.name === 'string' ? r.name : 'Property' };
    });
    if (!camps.length) throw new BrowserAuthError('no_properties');
    return { subjectId, loginToken: token, camps };
  }
  async login(email: string, password: string, authCode?: string): Promise<BrowserLoginSession> {
    if (
      !email.trim() ||
      !password ||
      email.length > 320 ||
      password.length > 1024 ||
      (authCode?.length ?? 0) > 32
    )
      throw new BrowserAuthError('login_failed');
    const result = await this.post('/user/bnb/sign-in', {
      email: email.trim().toLowerCase(),
      password,
      ...(this.origin.includes('hudson-prod') ? { enableMfa: 1 } : {}),
      ...(authCode ? { authCode } : {}),
    });
    if (result.errorCode === 'BNB_LOGIN_MFA_REQUIRED') throw new BrowserAuthError('mfa_required');
    if (result.errorCode === 'BNB_LOGIN_MFA_RATE_LIMIT')
      throw new BrowserAuthError('mfa_rate_limit');
    if (
      result.success !== true ||
      typeof result.data !== 'string' ||
      !result.data ||
      /[\r\n\s]/.test(result.data)
    )
      throw new BrowserAuthError('login_failed');
    return this.identity(result.data);
  }
  async sendSignupCode(profile: SignupProfile): Promise<void> {
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) ||
      profile.email.length > 320 ||
      !profile.nickName.trim() ||
      profile.nickName.length > 100 ||
      !/^[A-Za-z]{2}$/.test(profile.countryCode) ||
      !/^[0-9]{4,20}$/.test(profile.mobile) ||
      !/^\+?[0-9]{1,6}$/.test(profile.areaCode) ||
      (profile.houseNum !== undefined &&
        (!Number.isSafeInteger(profile.houseNum) || profile.houseNum < 1))
    )
      throw new BrowserAuthError('signup_failed');
    const email = profile.email.trim().toLowerCase();
    const check = await this.post('/user/bnb/sign-up/check', {
      email,
      mobile: profile.mobile,
      areaCode: profile.areaCode,
    });
    const errors = record(check.data).errorMessages;
    if (
      check.success !== true ||
      (Array.isArray(errors) && errors.some((e) => record(e).boolean === false))
    )
      throw new BrowserAuthError('signup_unavailable');
    const sent = await this.post('/user/bnb/auth-code/email', {
      ...profile,
      email,
      countryCode: profile.countryCode.toUpperCase(),
      type: 1,
      redirectUrl: this.origin.includes('hudson-dev')
        ? 'https://overseas-dev.localhome.cn/'
        : 'https://localsbnb.com/',
    });
    if (sent.success !== true) throw new BrowserAuthError('signup_failed');
  }
  async signup(email: string, password: string, authCode: string): Promise<BrowserLoginSession> {
    if (
      !email ||
      email.length > 320 ||
      password.length > 1024 ||
      !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password) ||
      !authCode.trim() ||
      authCode.length > 32
    )
      throw new BrowserAuthError('signup_failed');
    const result = await this.post('/user/bnb/sign-up', {
      email: email.trim().toLowerCase(),
      password,
      authCode,
    });
    if (
      result.success !== true ||
      typeof result.data !== 'string' ||
      !result.data ||
      /\s/.test(result.data)
    )
      throw new BrowserAuthError('signup_failed');
    return this.identity(result.data);
  }
  async authorize(
    session: BrowserLoginSession,
    campId: string
  ): Promise<{ subjectId: string; credential: string }> {
    const current = await this.identity(session.loginToken);
    if (current.subjectId !== session.subjectId || !current.camps.some((c) => c.campId === campId))
      throw new BrowserAuthError('property_forbidden');
    const secret = await this.post('/user/secret/get', { campId }, session.loginToken, campId);
    if (secret.success !== true || typeof secret.data !== 'string' || !secret.data.trim())
      throw new BrowserAuthError('credential_setup_required');
    // generate 会刷新已有 Secret；不能自动回退调用，以免破坏本地 stdio 用户。
    return { subjectId: current.subjectId, credential: secret.data.trim() };
  }
}
