import { createHash, randomBytes } from 'node:crypto';
import type { ApprovedGrant } from './authorizationCode.js';
import type { TokenFamilyStore, TokenResponse } from './tokenService.js';
import type { HttpOAuthClient } from './httpHandler.js';

export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
export const DEVICE_CLIENT_ID = 'wb_cloud_device_dev';
export const DEVICE_SCOPES = ['rooms:read', 'orders:read'];
const lifetime = 600;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
interface DeviceRecord {
  userCode: string;
  state: string;
  challenge: string;
  scopes: string[];
  expiresAt: number;
  lastPoll: number;
  interval: number;
  status: 'pending' | 'approved' | 'denied' | 'consumed';
  grant?: ApprovedGrant;
}
export class DeviceAuthorizationError extends Error {
  constructor(readonly code: 'invalid_request' | 'invalid_client' | 'invalid_scope' | 'invalid_grant' |
    'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token') { super(code); }
}
/** Dev-only RFC 8628 client. User code is public; only the polling client receives device_code. */
export class DeviceAuthorization {
  readonly client: HttpOAuthClient;
  constructor(
    private readonly store: TokenFamilyStore,
    private readonly issuer: string,
    private readonly namespace: string,
    private readonly issueToken: (grant: ApprovedGrant) => Promise<TokenResponse>,
    private readonly now = Date.now,
  ) {
    if (!/^localsbnb:mcp:dev:oauth:workbuddy$/.test(namespace) || new URL(issuer).origin !== issuer || !issuer.startsWith('https://'))
      throw new Error('Device authorization requires a dev HTTPS issuer');
    this.client = { clientId: DEVICE_CLIENT_ID, authMethod: 'none',
      redirectUris: [issuer + '/device/complete'], allowedScopes: [...DEVICE_SCOPES] };
  }
  private key(kind: string, value: string) { return `${this.namespace}:device:${kind}:${hash(value)}`; }
  private ttl(record: DeviceRecord) { return Math.max(1, Math.ceil((record.expiresAt - this.now()) / 1000)); }
  private async read(key: string): Promise<{ raw: string; record: DeviceRecord }> {
    const raw = await this.store.read(key);
    if (!raw) throw new DeviceAuthorizationError('expired_token');
    const record = JSON.parse(raw) as DeviceRecord;
    if (record.expiresAt <= this.now()) throw new DeviceAuthorizationError('expired_token');
    return { raw, record };
  }
  async start(form: URLSearchParams) {
    if (form.get('client_id') !== DEVICE_CLIENT_ID) throw new DeviceAuthorizationError('invalid_client');
    if (form.get('resource') !== this.issuer + '/workbuddy/mcp') throw new DeviceAuthorizationError('invalid_request');
    const scopes = [...new Set((form.get('scope') ?? DEVICE_SCOPES.join(' ')).split(' '))];
    if (!scopes.length || scopes.some(scope => !DEVICE_SCOPES.includes(scope))) throw new DeviceAuthorizationError('invalid_scope');
    const deviceCode = randomBytes(32).toString('base64url');
    const userCode = randomBytes(5).toString('hex').toUpperCase().replace(/^(.{5})/, '$1-');
    const state = randomBytes(32).toString('base64url');
    const key = this.key('record', deviceCode);
    const record: DeviceRecord = { userCode, state, challenge: randomBytes(32).toString('base64url'), scopes,
      expiresAt: this.now() + lifetime * 1000, lastPoll: 0, interval: 5, status: 'pending' };
    if (!await this.store.putIfAbsent(key, JSON.stringify(record), lifetime) ||
      !await this.store.putIfAbsent(this.key('user', userCode), key, lifetime) ||
      !await this.store.putIfAbsent(this.key('state', state), key, lifetime)) throw new Error('Device allocation failed');
    return { device_code: deviceCode, user_code: userCode, verification_uri: this.issuer + '/device',
      verification_uri_complete: this.issuer + '/device?user_code=' + userCode, expires_in: lifetime, interval: 5 };
  }
  async authorizationUrl(userCode: string): Promise<string> {
    if (!/^[A-F0-9]{5}-[A-F0-9]{5}$/.test(userCode)) throw new DeviceAuthorizationError('invalid_request');
    const key = await this.store.read(this.key('user', userCode));
    if (!key) throw new DeviceAuthorizationError('expired_token');
    const { record } = await this.read(key);
    if (record.status !== 'pending') throw new DeviceAuthorizationError('invalid_grant');
    return this.issuer + '/authorize?' + new URLSearchParams({ client_id: DEVICE_CLIENT_ID,
      redirect_uri: this.client.redirectUris[0], resource: this.issuer + '/workbuddy/mcp',
      scope: record.scopes.join(' '), response_type: 'code', code_challenge_method: 'S256',
      code_challenge: record.challenge, state: record.state, ui_locales: 'zh-CN' });
  }
  private async byState(state: string) {
    const key = await this.store.read(this.key('state', state));
    if (!key) throw new DeviceAuthorizationError('expired_token');
    return { key, ...await this.read(key) };
  }
  async validateBrowserRequest(query: URLSearchParams): Promise<string | null> {
    try {
      const { record } = await this.byState(query.get('state') ?? '');
      return record.status === 'pending' && query.get('client_id') === DEVICE_CLIENT_ID &&
        query.get('redirect_uri') === this.client.redirectUris[0] &&
        query.get('resource') === this.issuer + '/workbuddy/mcp' &&
        query.get('scope') === record.scopes.join(' ') && query.get('code_challenge') === record.challenge
        ? record.userCode : null;
    } catch { return null; }
  }
  async decide(state: string, grant?: ApprovedGrant): Promise<void> {
    const { key, raw, record } = await this.byState(state);
    if (record.status !== 'pending') throw new DeviceAuthorizationError('invalid_grant');
    if (grant && (grant.clientId !== DEVICE_CLIENT_ID || grant.resource !== this.issuer + '/workbuddy/mcp' ||
      !grant.scopes.length || grant.scopes.length !== record.scopes.length || grant.scopes.some(s => !record.scopes.includes(s))))
      throw new DeviceAuthorizationError('invalid_scope');
    if (!await this.store.compareAndSet(key, raw, JSON.stringify({ ...record, status: grant ? 'approved' : 'denied', grant }), this.ttl(record)))
      throw new DeviceAuthorizationError('invalid_grant');
  }
  async poll(form: URLSearchParams): Promise<TokenResponse> {
    if (form.get('client_id') !== DEVICE_CLIENT_ID) throw new DeviceAuthorizationError('invalid_client');
    if (form.get('resource') !== this.issuer + '/workbuddy/mcp') throw new DeviceAuthorizationError('invalid_request');
    const code = form.get('device_code') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new DeviceAuthorizationError('invalid_grant');
    const key = this.key('record', code);
    const { raw, record } = await this.read(key);
    if (record.status === 'denied') throw new DeviceAuthorizationError('access_denied');
    if (record.status === 'consumed') throw new DeviceAuthorizationError('invalid_grant');
    const tooFast = record.lastPoll > 0 && this.now() < record.lastPoll + record.interval * 1000;
    if (tooFast || record.status === 'pending') {
      const next = { ...record, lastPoll: this.now(), interval: record.interval + (tooFast ? 5 : 0) };
      if (!await this.store.compareAndSet(key, raw, JSON.stringify(next), this.ttl(record)))
        throw new DeviceAuthorizationError('authorization_pending');
      throw new DeviceAuthorizationError(tooFast ? 'slow_down' : 'authorization_pending');
    }
    // Consume before token allocation: a concurrent poll or retry cannot mint a second token family.
    if (!record.grant || !await this.store.compareAndSet(key, raw,
      JSON.stringify({ ...record, status: 'consumed', grant: undefined }), this.ttl(record)))
      throw new DeviceAuthorizationError('invalid_grant');
    return this.issueToken(record.grant);
  }
}
