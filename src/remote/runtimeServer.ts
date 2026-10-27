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
import { WorkbuddyLoginBridge } from './oauth/workbuddyLoginBridge.js';
import { WorkbuddyClients, WORKBUDDY_SCOPES } from './oauth/workbuddyClients.js';
import { createRateLimiter } from './rateLimit.js';
import type { RuntimeConfig } from './runtimeConfig.js';
import type { Client } from 'pg';
const DEV_ACCEPTANCE_SCOPES = [
  'rooms:read',
  'rooms:write',
  'orders:read',
  'orders:write',
  'finance:read',
  'channels:read',
  'channels:write',
];
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
  const workbuddyResource = `${config.publicOrigin}/workbuddy/mcp`;
  const workbuddyNamespace = `${namespace}:workbuddy`;
  const workbuddyStore = new RedisAuthorizationCodeStore(dependencies.redis);
  const workbuddyClients = config.workbuddySource
    ? new WorkbuddyClients(workbuddyStore, workbuddyNamespace, config.workbuddySource)
    : undefined;
  const workbuddyCodes = workbuddyClients
    ? new AuthorizationCodeService(workbuddyStore, workbuddyResource, workbuddyNamespace, Date.now, true)
    : undefined;
  const workbuddyTokens = workbuddyClients
    ? new OAuthTokenService(new RedisTokenFamilyStore(dependencies.redis), grants, workbuddyResource, workbuddyNamespace, Date.now, true)
    : undefined;
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
  const discoverableScopes = [...new Set(config.clients.flatMap((client) => client.allowedScopes))];
  const allowRequest = createRateLimiter(dependencies.redis, namespace);
  const authorization = createBrowserAuthorization({
    issuer: config.publicOrigin,
    namespace,
    clients: config.clients,
    ...(workbuddyClients ? {
      workbuddyResource,
      workbuddyBridge: new WorkbuddyLoginBridge(config.environment, dependencies.businessFetch),
      workbuddyCodes,
      resolveClient: (id: string) => workbuddyClients.get(id),
    } : {}),
    store: new RedisAuthorizationCodeStore(dependencies.redis),
    cipher,
    grants,
    codes,
    bridge: dependencies.bridge,
    onDiagnostic: (event) => console.info(JSON.stringify({ component: 'browser_oauth', ...event })),
  });
  const oauth = createOAuthHttpHandler({
    issuer: config.publicOrigin,
    resource: config.resourceUrl,
    clients: config.clients,
    ...(workbuddyClients ? {
      workbuddyResource,
      workbuddyCodes,
      workbuddyTokens,
      resolveClient: (id: string) => workbuddyClients.get(id),
      scopesSupported: [...new Set([...config.clients.flatMap((c) => c.allowedScopes), ...WORKBUDDY_SCOPES])],
    } : {}),
    codes,
    tokens,
    authorization,
    allowRequest,
    onTokenDiagnostic: (event) =>
      console.info(JSON.stringify({ component: 'oauth_token', ...event })),
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
      if (req.url === '/oauth/register' && workbuddyClients) {
        if (!(await allowRequest(req))) { json(res, 429, { error: 'rate_limited' }); return; }
        await workbuddyClients.register(req, res);
        return;
      }
      if (req.url !== '/mcp' && !(workbuddyClients && req.url === '/workbuddy/mcp')) {
        await oauth(req, res);
        return;
      }
      const workbuddyRequest = req.url === '/workbuddy/mcp';
      const requestedResource = workbuddyRequest ? workbuddyResource : config.resourceUrl;
      const metadataUrl = `${config.publicOrigin}/.well-known/oauth-protected-resource${workbuddyRequest ? '' : '/mcp'}`;
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
      if (
        req.headers.authorization !== undefined &&
        (!match || (req.headersDistinct.authorization?.length ?? 0) !== 1)
      ) {
        res.setHeader(
          'WWW-Authenticate',
          `Bearer resource_metadata="${metadataUrl}"`
        );
        json(res, 401, { error: 'invalid_token' });
        return;
      }
      // WorkBuddy discovers OAuth only after a protected resource challenges it.
      // Keep ChatGPT's existing anonymous onboarding on /mcp unchanged.
      if (workbuddyRequest && !match) {
        res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`);
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      // No token permits only public onboarding; invalid tokens never fall back to anonymous.
      const identity = match ? await (workbuddyRequest ? workbuddyTokens! : tokens).verify(match[1], requestedResource) : undefined;
      const oauthScheme = [{ type: 'oauth2', scopes: ['rooms:read'] }];
      const clientScopes = workbuddyRequest
        ? [...((identity && await workbuddyClients!.get(identity.clientId))?.allowedScopes ?? [])]
        : identity
          ? [...(config.clients.find((client) => client.clientId === identity.clientId)?.allowedScopes ?? [])]
          : discoverableScopes;
      const devAcceptanceAvailable =
        !workbuddyRequest && config.environment === 'dev' &&
        config.businessEnabled &&
        !!identity &&
        DEV_ACCEPTANCE_SCOPES.every((scope) => clientScopes.includes(scope));
      const availableBusinessTools = config.businessEnabled
        ? business.list({ scopes: clientScopes, clientId: identity?.clientId }).filter((tool) =>
            !workbuddyRequest || ['open_property_session', 'list_authorized_properties', 'switch_property', 'get_operation_status',
              'query_room_status_new', 'query_today_room_status', 'query_room_prices', 'query_today_orders',
              'query_pre_arrival_orders', 'query_in_house_orders', 'query_pre_departure_orders',
              'query_orders_by_date_range', 'get_order_details_v2', 'query_operational_data_v2',
              'cn_check_in_order', 'cn_check_out_order', 'cn_cancel_order', 'cn_extend_order', 'cn_arrange_room',
              'cn_close_rooms', 'cn_open_rooms', 'cn_update_room_clean_state',
              'cn_query_channel_connection', 'cn_update_channel_prices', 'cn_batch_update_channel_prices',
              'cn_update_central_prices', 'cn_create_manual_order',
              'cn_map_channel_listing', 'cn_connect_channel_poi',
              'cn_start_channel_connection', 'cn_complete_channel_connection'].includes(String(tool.name)))
        : [];
      const mcp = new Server(
        { name: 'localsbnb-remote', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: 'localsbnb_get_started',
            description:
              'Explain how to register or connect LocalsBnb. Call before asking for account information. Never collect passwords, verification codes or App Secrets in chat. After the user is ready, call remote_connection_check to trigger secure OAuth sign-in or registration.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            securitySchemes: [{ type: 'noauth' }],
            annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
          },
          {
            name: 'remote_connection_check',
            description:
              'Connect or check LocalsBnb. If not linked, use the platform OAuth prompt; the secure page supports registration and login. After authorization, report the selected property and whether business tools are enabled.',
            securitySchemes: oauthScheme,
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
          },
          ...(devAcceptanceAvailable
            ? [
                {
                  name: 'remote_acceptance_scope_check',
                  description:
                    'Dev acceptance only: request all configured room, order, finance and channel test permissions in one OAuth consent, then report the granted scopes. This tool never reads or changes business data.',
                  securitySchemes: [{ type: 'oauth2', scopes: DEV_ACCEPTANCE_SCOPES }],
                  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                  annotations: {
                    readOnlyHint: true,
                    openWorldHint: false,
                    destructiveHint: false,
                  },
                },
              ]
            : []),
          ...(config.businessEnabled
            ? availableBusinessTools
                .map(({ requiredScopes, ...tool }) => ({
                  ...tool,
                  securitySchemes: [
                    {
                      type: 'oauth2',
                      scopes:
                        Array.isArray(requiredScopes) && requiredScopes.length
                          ? requiredScopes
                          : ['rooms:read'],
                    },
                  ],
                }))
            : []),
        ],
      }));
      mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (request.params.name === 'localsbnb_get_started') {
          if (Object.keys(request.params.arguments ?? {}).length)
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: 'This tool takes no arguments. Do not send account credentials.',
                },
              ],
            };
          return {
            content: [
              {
                type: 'text',
                text: 'Welcome to LocalsBnb. To start, call remote_connection_check and use the platform Connect action. Register or sign in on the secure LocalsBnb page, choose your property and approve access. Credentials stay on the server; never paste passwords, codes or App Secrets into chat. Return here to check initialization. An account without an existing App Secret may still require administrator setup.',
              },
            ],
          };
        }
        if (!identity) {
          return {
            isError: true,
            _meta: {
              'mcp/www_authenticate': [
                `Bearer resource_metadata="${metadataUrl}", scope="rooms:read"`,
              ],
            },
            content: [
              {
                type: 'text',
                text: 'Connect your LocalsBnb account using the platform authorization prompt. Register or sign in on the secure page, then retry. No account data has been accessed.',
              },
            ],
          };
        }
        if (request.params.name === 'remote_acceptance_scope_check') {
          if (!devAcceptanceAvailable || Object.keys(request.params.arguments ?? {}).length)
            return { isError: true, content: [{ type: 'text', text: 'Unknown tool or arguments' }] };
          if (DEV_ACCEPTANCE_SCOPES.some((scope) => !identity.scopes.includes(scope)))
            return {
              isError: true,
              _meta: {
                'mcp/www_authenticate': [
                  `Bearer resource_metadata="${metadataUrl}", scope="${DEV_ACCEPTANCE_SCOPES.join(' ')}", error="insufficient_scope", error_description="Authorize all dev acceptance permissions to continue"`,
                ],
              },
              content: [{ type: 'text', text: 'Additional dev test authorization is required.' }],
            };
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
        }
        if (config.businessEnabled && request.params.name !== 'remote_connection_check') {
          const visibleTool = availableBusinessTools.find(
            (tool) => tool.name === request.params.name
          );
          const requiredScopes = visibleTool?.requiredScopes as string[] | undefined;
          const missingScopes = (requiredScopes ?? []).filter(
            (scope) => !identity.scopes.includes(scope)
          );
          if (missingScopes.length) {
            return {
              isError: true,
              _meta: {
                'mcp/www_authenticate': [
                  `Bearer resource_metadata="${metadataUrl}", scope="${[...new Set([...identity.scopes, ...missingScopes])].join(' ')}", error="insufficient_scope", error_description="Authorize the additional tool permissions to continue"`,
                ],
              },
              content: [{ type: 'text', text: 'Additional authorization is required for this tool.' }],
            };
          }
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
          `Bearer error="invalid_token", resource_metadata="${config.publicOrigin}/.well-known/oauth-protected-resource${req.url === '/workbuddy/mcp' ? '' : '/mcp'}"`
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
