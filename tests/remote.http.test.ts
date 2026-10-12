import { get, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { Client } from 'mcp-remote-sdk/client/index.js';
import { StreamableHTTPClientTransport } from 'mcp-remote-sdk/client/streamableHttp.js';
import { createMockHttpServer } from '../src/remote/mockServer';

describe('M02 loopback Streamable HTTP prototype', () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    server = createMockHttpServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (!server.listening) return;
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  });
  it('is alive but never claims production readiness', async () => {
    expect((await fetch(`${origin}/healthz`)).status).toBe(200);
    expect((await fetch(`${origin}/readyz`)).status).toBe(503);
  });
  it('rejects browser requests from an unrelated origin', async () => {
    expect((await fetch(`${origin}/mcp`, {method:'POST',headers:{Origin:'https://evil.example'}})).status).toBe(403);
  });
  it('rejects a DNS rebinding host', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      get(`${origin}/healthz`, {headers:{Host:'evil.example'}}, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    expect(status).toBe(403);
  });
  it('rejects malformed JSON without exposing request contents', async () => {
    const response=await fetch(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:'{sensitive-broken-json'});
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('sensitive-broken-json');
  });
  it('limits HTTP request bodies', async () => {
    const response=await fetch(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({padding:'x'.repeat(70000)})});
    expect(response.status).toBe(413);
  });
  it.each(['GET','DELETE'])('rejects unsupported %s transport requests', async method => {
    expect((await fetch(`${origin}/mcp`,{method})).status).toBe(405);
  });
  it('supports SDK initialize/list/call without exposing business tools', async () => {
    const client = new Client({name:'m02-test',version:'1.0.0'});
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
      expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['remote_connection_check']);
      const result = await client.callTool({name:'remote_connection_check',arguments:{}});
      expect(result.content).toEqual([{type:'text',text:JSON.stringify({mode:'mock',businessConnected:false,authorizationReady:false})}]);
      expect((await client.callTool({name:'create_manual_order',arguments:{}})).isError).toBe(true);
    } finally { await client.close(); }
  });
  it('isolates parallel protocol clients without process-global account state', async () => {
    await Promise.all([1,2].map(async id => {
      const client = new Client({name:`parallel-${id}`,version:'1.0.0'});
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
        expect((await client.listTools()).tools).toHaveLength(1);
      } finally { await client.close(); }
    }));
  });
});
