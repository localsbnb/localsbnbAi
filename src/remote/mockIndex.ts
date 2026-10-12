import { createMockHttpServer } from './mockServer.js';

// 独立原型入口：不加载 dotenv、本机凭证或生产默认配置。
const rawPort = process.env.LOCALSBNB_REMOTE_PORT ?? '8787';
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
  throw new Error('LOCALSBNB_REMOTE_PORT must be an integer between 1 and 65535');
}
const server = createMockHttpServer();
server.on('error', () => {
  process.stderr.write('Remote mock could not listen on loopback.\n');
  process.exitCode = 1;
});
server.listen(Number(rawPort), '127.0.0.1', () => {
  process.stderr.write(`Local MCP mock: http://127.0.0.1:${rawPort}/mcp (no real data or OAuth)\n`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
