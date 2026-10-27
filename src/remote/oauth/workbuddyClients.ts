import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpOAuthClient } from './httpHandler.js';
import { isWorkbuddyRedirect } from './authorizationCode.js';
import type { OneTimeCodeStore } from './authorizationCode.js';

export const WORKBUDDY_SCOPES = [
  'rooms:read', 'rooms:write', 'orders:read', 'orders:write',
  'finance:read', 'channels:read', 'channels:write',
] as const;
function send(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

/** Public clients are stored separately from ChatGPT's configured confidential clients. */
export class WorkbuddyClients {
  constructor(private readonly store: OneTimeCodeStore, private readonly namespace: string, private readonly source: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source)) throw new Error('Invalid WorkBuddy source');
  }
  private key(id: string): string { return `${this.namespace}:client:${id}`; }
  async get(id: string): Promise<HttpOAuthClient | undefined> {
    if (!/^wb_[A-Za-z0-9_-]{32}$/.test(id)) return undefined;
    const raw = await this.store.read(this.key(id));
    if (!raw) return undefined;
    try {
      const c = JSON.parse(raw) as HttpOAuthClient;
      return c.clientId === id && c.authMethod === 'none' ? c : undefined;
    } catch { return undefined; }
  }
  async register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0].trim() !== 'application/json' || req.headers.origin) {
      send(res, 400, { error: 'invalid_client_metadata' }); return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > 8192) throw new Error();
        chunks.push(chunk as Buffer);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      const redirectUris = input.redirect_uris;
      if (!Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 3 ||
          redirectUris.some((uri) => typeof uri !== 'string' || uri.length > 512 || !this.validRedirect(uri)) ||
          (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== 'none') ||
          (input.grant_types !== undefined && (!Array.isArray(input.grant_types) ||
            input.grant_types.some((g) => !['authorization_code', 'refresh_token'].includes(String(g))))) ||
          (input.response_types !== undefined && (!Array.isArray(input.response_types) ||
            input.response_types.some((t) => t !== 'code')))) throw new Error();
      const id = `wb_${randomBytes(24).toString('base64url')}`;
      const client: HttpOAuthClient = { clientId: id, authMethod: 'none', redirectUris: [...new Set(redirectUris)], allowedScopes: [...WORKBUDDY_SCOPES] };
      if (!(await this.store.putIfAbsent(this.key(id), JSON.stringify(client), 365 * 86400))) throw new Error();
      send(res, 201, { client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: 'none', redirect_uris: client.redirectUris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: WORKBUDDY_SCOPES.join(' ') });
    } catch { send(res, 400, { error: 'invalid_client_metadata' }); }
  }
  private validRedirect(value: string): boolean {
    let url: URL;
    try { url = new URL(value); } catch { return false; }
    if (!isWorkbuddyRedirect(url)) return false;
    return url.protocol !== 'workbuddy:' ||
      url.pathname.toLowerCase() === `/mcp/connector%3a${this.source}/oauth/callback` ||
      /^\/mcp\/custom-mcp%3a[a-z0-9][a-z0-9-]{0,63}\/oauth\/callback$/i.test(url.pathname);
  }
}
