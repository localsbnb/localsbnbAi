import { BrowserAuthError, HudsonLoginBridge, type BrowserLoginBridge, type BrowserLoginSession } from './hudsonLoginBridge.js';

interface Envelope { success?: boolean; data?: unknown }
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown): string => {
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new BrowserAuthError('login_failed');
};

/** Separate domestic login adapter; never falls back to another edition after authentication. */
export class WorkbuddyLoginBridge implements BrowserLoginBridge {
  private readonly origin: string;
  private readonly overseas: HudsonLoginBridge;
  constructor(environment: 'dev' | 'prod', private readonly fetcher: typeof fetch = fetch) {
    this.origin = environment === 'dev' ? 'https://hudson-dev.localhome.cn' : 'https://hudson-prod.localhome.cn';
    this.overseas = new HudsonLoginBridge(environment, fetcher);
  }
  private async post(path: string, body: object, token?: string, campId = '0'): Promise<Envelope> {
    try {
      const response = await this.fetcher(this.origin + path, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', campId,
          ...(token ? { 'hudson-access-token': `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      return await response.json() as Envelope;
    } catch { throw new BrowserAuthError('login_failed'); }
  }
  async login(account: string, password: string, authCode?: string, edition: 'cn' | 'overseas' = 'cn'): Promise<BrowserLoginSession> {
    if (edition === 'overseas') {
      const session = await this.overseas.login(account, password, authCode);
      return { ...session, edition };
    }
    const normalized = account.trim();
    if (!normalized || normalized.length > 320 || (!password && !authCode) || password.length > 1024)
      throw new BrowserAuthError('login_failed');
    const email = normalized.includes('@');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new BrowserAuthError('login_failed');
    if (!email && !/^\+?[0-9]{6,20}$/.test(normalized)) throw new BrowserAuthError('login_failed');
    const login = await this.post('/user/sign-in', {
      authType: email ? 3 : authCode ? 2 : 1,
      ...(email ? { email: normalized.toLowerCase() } : { mobile: normalized, areaCode: '+86' }),
      ...(password ? { password } : {}),
      ...(authCode ? { authCode } : {}),
    });
    if (login.success !== true || typeof login.data !== 'string' || !login.data || /\s/.test(login.data))
      throw new BrowserAuthError('login_failed');
    const token = login.data;
    const own = await this.post('/user/own/get', {}, token);
    const campsResponse = await this.post('/camps/get', {}, token);
    if (own.success !== true || campsResponse.success !== true) throw new BrowserAuthError('login_failed');
    const rawCamps = record(campsResponse.data).camps;
    if (!Array.isArray(rawCamps)) throw new BrowserAuthError('no_properties');
    const candidates = rawCamps.map((c) => ({ campId: id(record(c).campId), name: String(record(c).name ?? '门店') }));
    const editions = await Promise.all(candidates.map(async (camp) => {
      const detail = await this.post('/camp/get', { campId: camp.campId }, token, camp.campId);
      return detail.success === true && Number(record(detail.data).isBnb) === 0 ? camp : null;
    }));
    const camps = editions.filter((camp): camp is (typeof candidates)[number] => camp !== null);
    if (!camps.length) throw new BrowserAuthError('no_properties');
    return { subjectId: id(record(own.data).userId), loginToken: token, camps, edition };
  }
  async authorize(session: BrowserLoginSession, campId: string, edition: 'cn' | 'overseas' = 'cn'): Promise<{ subjectId: string; credential: string }> {
    if (session.edition !== edition || !session.camps.some((c) => c.campId === campId))
      throw new BrowserAuthError('property_forbidden');
    const own = await this.post('/user/own/get', {}, session.loginToken);
    const camps = await this.post('/camps/get', {}, session.loginToken);
    if (own.success !== true || id(record(own.data).userId) !== session.subjectId ||
        camps.success !== true || !Array.isArray(record(camps.data).camps) ||
        !(record(camps.data).camps as unknown[]).some((c) => id(record(c).campId) === campId))
      throw new BrowserAuthError('property_forbidden');
    const camp = await this.post('/camp/get', { campId }, session.loginToken, campId);
    if (camp.success !== true || (Number(record(camp.data).isBnb) === 1) !== (edition === 'overseas'))
      throw new BrowserAuthError('property_forbidden');
    const secret = await this.post('/user/secret/get', { campId }, session.loginToken, campId);
    if (secret.success !== true || typeof secret.data !== 'string' || !secret.data.trim())
      throw new BrowserAuthError('credential_setup_required');
    return { subjectId: session.subjectId, credential: secret.data.trim() };
  }
}
