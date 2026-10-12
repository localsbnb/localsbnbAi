import { createServer, request, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createOAuthHttpHandler, type HttpOAuthClient } from '../src/remote/oauth/httpHandler';
import { AuthorizationCodeService, pkceS256 } from '../src/remote/oauth/authorizationCode';
import { OAuthTokenService, type TokenResponse } from '../src/remote/oauth/tokenService';
const issuer='https://mcp.example'; const resource=issuer+'/mcp';
const verifier='a'.repeat(43);
const publicClient:HttpOAuthClient={clientId:'public',authMethod:'none',redirectUris:['https://client.example/cb'],allowedScopes:['rooms:read']};
const confidential:HttpOAuthClient={...publicClient,clientId:'private',authMethod:'client_secret_basic',secretSha256:createHash('sha256').update('test-secret').digest('hex')};
let server:Server; let port:number; let codes:AuthorizationCodeService; let tokens:OAuthTokenService;
let allowed:boolean; let active:boolean; let failed:boolean;
beforeEach(async()=>{
  allowed=true;active=true;failed=false;
  const data=new Map<string,string>();
  const store={
    putIfAbsent:async(k:string,v:string)=>{if(data.has(k))return false;data.set(k,v);return true;},
    read:async(k:string)=>{if(failed)throw new Error('secret db error');return data.get(k)??null;},
    consumeIfEqual:async(k:string,v:string)=>{if(data.get(k)!==v)return false;data.delete(k);return true;},
    compareAndSet:async(k:string,v:string,n:string)=>{if(data.get(k)!==v)return false;data.set(k,n);return true;},
  };
  codes=new AuthorizationCodeService(store,resource,'localsbnb:mcp:dev:oauth');
  tokens=new OAuthTokenService(store,{revoke:async()=>{active=false;},readActive:async(grantId,clientId)=>active?{
    grantId,clientId,resource,subjectId:'user',campId:'camp',scopes:['rooms:read'],expiresAt:new Date(Date.now()+3600000),
  }:null},resource,'localsbnb:mcp:dev:oauth');
  const handler=createOAuthHttpHandler({issuer,resource,clients:[publicClient,confidential],codes,tokens,allowRequest:async()=>allowed});
  server=createServer((req,res)=>{void handler(req,res);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  port=(server.address() as AddressInfo).port;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
function call(path:string, body?:Record<string,string>|string, headers:Record<string,string>={}, method=body===undefined?'GET':'POST') {
  const text=typeof body==='string'?body:new URLSearchParams(body).toString();
  return new Promise<{status:number;body:TokenResponse & {error?:string;token_endpoint?:string;resource?:string;code_challenge_methods_supported?:string[]};headers:import('node:http').IncomingHttpHeaders}>((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,method,headers:{Host:'mcp.example','Content-Type':'application/x-www-form-urlencoded',...headers}},res=>{
      let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(raw),headers:res.headers}));
    });req.on('error',reject);req.end(text);
  });
}
async function form(client=publicClient) {
  const {redirectUrl}=await codes.issue(client,{grantId:'grant',clientId:client.clientId,resource,scopes:['rooms:read']},
    {redirectUri:client.redirectUris[0],challenge:pkceS256(verifier),challengeMethod:'S256'});
  return {client_id:client.clientId,grant_type:'authorization_code',code:new URL(redirectUrl).searchParams.get('code')!,
    code_verifier:verifier,redirect_uri:client.redirectUris[0],resource};
}
it('publishes fixed discovery URLs and does not trust forwarded host',async()=>{
  const r=await call('/.well-known/oauth-authorization-server',undefined,{'X-Forwarded-Host':'evil.example'});
  expect(r.status).toBe(200);expect(r.body.token_endpoint).toBe(issuer+'/token');
  expect(r.body.code_challenge_methods_supported).toEqual(['S256']);
  const p=await call('/.well-known/oauth-protected-resource/mcp');expect(p.body.resource).toBe(resource);
});
it('exchanges a public client code, refreshes and revokes through HTTP',async()=>{
  const r=await call('/token',await form());expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store');
  await expect(tokens.verify(r.body.access_token,resource)).resolves.toMatchObject({campId:'camp'});
  const next=await call('/token',{client_id:'public',grant_type:'refresh_token',refresh_token:r.body.refresh_token,resource});
  expect(next.status).toBe(200);
  expect((await call('/revoke',{client_id:'public',token:next.body.refresh_token})).status).toBe(200);
  await expect(tokens.verify(next.body.access_token,resource)).rejects.toThrow('invalid_token');
});
it('authenticates confidential client before consuming its code',async()=>{
  const f=await form(confidential);delete (f as Partial<typeof f>).client_id;
  const bad=await call('/token',f,{Authorization:'Basic '+Buffer.from('private:wrong').toString('base64')});
  expect(bad.status).toBe(401);expect(bad.headers['www-authenticate']).toContain('Basic');
  const good=await call('/token',f,{Authorization:'Basic '+Buffer.from('private:test-secret').toString('base64')});
  expect(good.status).toBe(200);
});
it('rejects mixed authentication methods and body secrets',async()=>{
  const f=await form();expect((await call('/token',{...f,client_secret:'secret'})).status).toBe(400);
  expect((await call('/token',f,{Authorization:'Basic '+Buffer.from('public:secret').toString('base64')})).status).toBe(400);
});
it('rejects wrong resource, redirect and verifier without issuing tokens',async()=>{
  const f=await form();
  expect((await call('/token',{...f,resource:'https://other.example/mcp'})).body.error).toBe('invalid_target');
  expect((await call('/token',{...f,redirect_uri:'https://evil.example'})).body.error).toBe('invalid_grant');
  expect((await call('/token',{...f,code_verifier:'b'.repeat(43)})).body.error).toBe('invalid_grant');
  expect((await call('/token',f)).status).toBe(200);
  expect((await call('/token',f)).body.error).toBe('invalid_grant');
});
it('checks grant revocation between authorization and token issuance',async()=>{
  const f=await form();active=false;expect((await call('/token',f)).body.error).toBe('invalid_grant');
  active=true;expect((await call('/token',f)).body.error).toBe('invalid_grant');
});
it('rejects duplicate parameters, JSON, oversized forms and query credentials',async()=>{
  const f=await form();
  expect((await call('/token',new URLSearchParams(f)+'&client_id=other')).status).toBe(400);
  expect((await call('/token',JSON.stringify(f),{'Content-Type':'application/json'})).status).toBe(415);
  expect((await call('/token','x='+'a'.repeat(17000))).status).toBe(413);
  expect((await call('/token?code=secret',f)).status).toBe(400);
});
it('rejects wrong Host/Origin and unsupported methods',async()=>{
  const f=await form();expect((await call('/token',f,{Host:'evil.example'})).status).toBe(400);
  expect((await call('/token',f,{Origin:'https://evil.example'})).status).toBe(403);
  const get=await call('/token');expect(get.status).toBe(405);expect(get.headers.allow).toBe('POST');
});
it('keeps authorization and readiness unavailable until login consent is implemented',async()=>{
  expect((await call('/authorize?client_id=public')).status).toBe(503);expect((await call('/readyz')).status).toBe(503);
});
it('limits before code consumption and does not leak store failures',async()=>{
  const f=await form();allowed=false;const limited=await call('/token',f);expect(limited.status).toBe(429);
  allowed=true;failed=true;const error=await call('/token',f);expect(error.status).toBe(503);
  expect(JSON.stringify(error.body)).not.toContain('secret');failed=false;expect((await call('/token',f)).status).toBe(200);
});
it('returns success for invalid revocation token and rejects unsupported grants/scopes',async()=>{
  expect((await call('/revoke',{client_id:'public',token:'invalid'})).status).toBe(200);
  expect((await call('/token',{client_id:'public',grant_type:'password'})).body.error).toBe('unsupported_grant_type');
  expect((await call('/token',{...await form(),scope:'orders:write'})).body.error).toBe('invalid_scope');
});
