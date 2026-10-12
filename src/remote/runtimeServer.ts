import { timingSafeEqual } from 'node:crypto';
import { WorkStore } from './business/workStore.js';
import { BusinessEngine } from './business/engine.js';
import { ChannelFlows } from './business/channelFlows.js';
import { RemoteHandshake } from './business/handshake.js';
import { createServer, type ServerResponse } from 'node:http';
import { Server } from 'mcp-remote-sdk/server/index.js';
import { StreamableHTTPServerTransport } from 'mcp-remote-sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from 'mcp-remote-sdk/types.js';
import { createOAuthHttpHandler, readOAuthForm } from './oauth/httpHandler.js';
import { createBrowserAuthorization } from './oauth/browserAuthorization.js';
import { AuthorizationCodeService } from './oauth/authorizationCode.js';
import { OAuthTokenService, OAuthTokenError } from './oauth/tokenService.js';
import { CredentialCipher } from './oauth/credentialCipher.js';
import { PostgresGrantStore } from './oauth/postgresGrantStore.js';
import { RedisAuthorizationCodeStore, type RedisCommands } from './oauth/redisCodeStore.js';
import { RedisTokenFamilyStore } from './oauth/redisTokenStore.js';
import type { BrowserLoginBridge } from './oauth/hudsonLoginBridge.js';
import { createRateLimiter } from './rateLimit.js';
import type { RuntimeConfig } from './runtimeConfig.js';
import type { Client } from 'pg';
function json(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
/** 请求级认证入口；业务工具通过独立开关启用，身份不写进程全局。 */
export function createRemoteRuntime(
  config: RuntimeConfig,
  dependencies: {
    db: Pick<Client, 'query'>;
    redis: RedisCommands;
    bridge: BrowserLoginBridge;
    checkStorage: () => Promise<void>;
    businessFetch?: typeof fetch;
  }
) {
  const namespace = `localsbnb:mcp:${config.environment}:oauth`;
  const cipher = new CredentialCipher(config.activeKeyId, config.keys);
  const grants = new PostgresGrantStore(dependencies.db, cipher);
  const codes = new AuthorizationCodeService(
    new RedisAuthorizationCodeStore(dependencies.redis),
    config.resourceUrl,
    namespace
  );
  const tokens = new OAuthTokenService(
    new RedisTokenFamilyStore(dependencies.redis),
    grants,
    config.resourceUrl,
    namespace
  );
  const workStore = new WorkStore(dependencies.db, cipher);
  const handshake = new RemoteHandshake(
    workStore,
    grants,
    config.siteOrigin,
    config.resourceUrl,
    config.environment
  );
  const business = new BusinessEngine(
    grants,
    workStore,
    new ChannelFlows(workStore, handshake),
    config.hudsonOrigin,
    dependencies.businessFetch
  );
  const allowRequest = createRateLimiter(dependencies.redis, namespace);
  const authorization = createBrowserAuthorization({
    issuer: config.publicOrigin,
    namespace,
    clients: config.clients,
    store: new RedisAuthorizationCodeStore(dependencies.redis),
    cipher,
    grants,
    codes,
    bridge: dependencies.bridge,
  });
  const oauth = createOAuthHttpHandler({
    issuer: config.publicOrigin,
    resource: config.resourceUrl,
    clients: config.clients,
    codes,
    tokens,
    authorization,
    allowRequest,
  });
  const server = createServer((req, res) => {
    void (async () => {
      if (req.headers.host !== new URL(config.publicOrigin).host) {
        json(res, 400, { error: 'invalid_host' });
        return;
      }
      if (req.url === '/healthz' && req.method === 'GET') {
        json(res, 200, { status: 'ok' });
        return;
      }
      if (req.url === '/readyz' && req.method === 'GET') {
        await dependencies.checkStorage();
        json(res, 200, {
          status: 'ready',
          mode: config.businessEnabled ? 'business' : 'auth_preview',
          businessReady: !!config.businessEnabled,
        });
        return;
      }
      if (req.url === '/internal/handshake/redeem') {
        if (
          !config.businessEnabled ||
          !config.handshakeSecret ||
          req.method !== 'POST' ||
          req.headers.origin
        ) {
          json(res, 404, { error: 'not_found' });
          return;
        }
        const supplied = Buffer.from(req.headers.authorization ?? '');
        const expected = Buffer.from('Bearer ' + config.handshakeSecret);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          json(res, 401, { error: 'unauthorized' });
          return;
        }
        if (!(await allowRequest(req))) {
          json(res, 429, { error: 'rate_limited' });
          return;
        }
        try {
          const form = await readOAuthForm(req);
          json(res, 200, await handshake.redeem(form.get('ticket') ?? ''));
        } catch {
          json(res, 410, { error: 'ticket_unavailable' });
        }
        return;
      }
      if (req.url !== '/mcp') {
        await oauth(req, res);
        return;
      }
      if (req.headers.origin && req.headers.origin !== config.publicOrigin) {
        json(res, 403, { error: 'invalid_origin' });
        return;
      }
      if (!(await allowRequest(req))) {
        res.setHeader('Retry-After', '60');
        json(res, 429, { error: 'rate_limited' });
        return;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        json(res, 405, { error: 'method_not_allowed' });
        return;
      }
      const match = /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(req.headers.authorization ?? '');
      if (!match || (req.headersDistinct.authorization?.length ?? 0) !== 1) {
        res.setHeader(
          'WWW-Authenticate',
          `Bearer resource_metadata="${config.publicOrigin}/.well-known/oauth-protected-resource/mcp"`
        );
        json(res, 401, { error: 'invalid_token' });
        return;
      }
      const identity = await tokens.verify(match[1], config.resourceUrl);
      const mcp = new Server(
        { name: 'localsbnb-remote', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: 'remote_connection_check',
            description:
              'Check the authorized LocalsBnb connection and whether business tools are enabled.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
          },
          ...(config.businessEnabled ? business.list(identity) : []),
        ],
      }));
      mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (config.businessEnabled && request.params.name !== 'remote_connection_check') {
          try {
            return {
              ...(await business.call(
                identity,
                request.params.name,
                request.params.arguments ?? {}
              )),
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: error instanceof Error ? error.message : 'Business request failed',
                },
              ],
            };
          }
        }
        if (
          request.params.name !== 'remote_connection_check' ||
          Object.keys(request.params.arguments ?? {}).length
        )
          return { isError: true, content: [{ type: 'text', text: 'Unknown tool or arguments' }] };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                subjectId: identity.subjectId,
                campId: identity.campId,
                scopes: identity.scopes,
                businessReady: !!config.businessEnabled,
              }),
            },
          ],
        };
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: 65536,
      });
      res.once('close', () => {
        void mcp.close().catch(() => undefined);
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    })().catch((error) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof OAuthTokenError) {
        res.setHeader(
          'WWW-Authenticate',
          `Bearer error="invalid_token", resource_metadata="${config.publicOrigin}/.well-known/oauth-protected-resource/mcp"`
        );
        json(res, 401, { error: 'invalid_token' });
      } else json(res, 503, { error: 'temporarily_unavailable' });
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}
