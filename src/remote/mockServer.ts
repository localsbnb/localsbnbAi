import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from 'node:http';
import { Server } from 'mcp-remote-sdk/server/index.js';
import { StreamableHTTPServerTransport } from 'mcp-remote-sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from 'mcp-remote-sdk/types.js';

/** M02 协议原型：不导入本地账号、Hudson 客户端或业务工具。 */
function createMockMcpServer(): Server {
  const server = new Server(
    { name: 'localsbnb-remote-mock', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'remote_connection_check',
        description:
          'Local protocol test only. No authentication, hotel data or business operations are connected.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (
      request.params.name !== 'remote_connection_check' ||
      Object.keys(request.params.arguments ?? {}).length
    ) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Only remote_connection_check with empty arguments is available in this mock.',
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            mode: 'mock',
            businessConnected: false,
            authorizationReady: false,
          }),
        },
      ],
    };
  });
  return server;
}

function json(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const address = req.socket.localAddress;
  // 即使调用方误将 createServer 绑定外网，也拒绝非 loopback 请求。
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')) {
    json(res, 403, { error: 'mock_loopback_only' });
    return;
  }
  const port = req.socket.localPort;
  const authorities = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  if (!authorities.includes(req.headers.host ?? '')) {
    json(res, 403, { error: 'invalid_host' });
    return;
  }
  const origin = req.headers.origin;
  if (origin && !authorities.some((host) => origin === `http://${host}`)) {
    json(res, 403, { error: 'invalid_origin' });
    return;
  }
  if (req.url === '/healthz' && req.method === 'GET') {
    json(res, 200, { status: 'ok', mode: 'mock' });
    return;
  }
  if (req.url === '/readyz' && req.method === 'GET') {
    json(res, 503, { status: 'not_ready', reason: 'oauth_and_business_not_connected' });
    return;
  }
  if (req.url !== '/mcp') {
    json(res, 404, { error: 'not_found' });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }
  const server = createMockMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 64 * 1024,
  });
  res.once('close', () => {
    void server.close().catch(() => undefined);
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch {
    if (!res.headersSent) json(res, 500, { error: 'protocol_request_failed' });
    else res.end();
    await server.close().catch(() => undefined);
  }
}

export function createMockHttpServer(): HttpServer {
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'request_failed' });
      else res.end();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
