import { createServer, request, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createBrowserAuthorization } from '../src/remote/oauth/browserAuthorization';
import { createOAuthHttpHandler } from '../src/remote/oauth/httpHandler';
import { OAuthTokenService } from '../src/remote/oauth/tokenService';
import type { PersistentGrant } from '../src/remote/oauth/postgresGrantStore';
import { CredentialCipher } from '../src/remote/oauth/credentialCipher';
import { AuthorizationCodeService, pkceS256 } from '../src/remote/oauth/authorizationCode';
import { BrowserAuthError } from '../src/remote/oauth/hudsonLoginBridge';
const issuer='https://mcp.example';const resource=issuer+'/mcp';const verifier='a'.repeat(43);
const client={clientId:'test-app',redirectUris:['https://client.example/cb'],allowedScopes:['rooms:read']};
let server:Server;let port:number;let now:number;let data:Map<string,string>;let codes:AuthorizationCodeService;
let bridge:{login:jest.Mock;authorize:jest.Mock};let grants:{create:jest.Mock;revoke:jest.Mock};
beforeEach(async()=>{
  now=Date.now();data=new Map();
  const store={putIfAbsent:async(k:string,v:string)=>{if(data.has(k))return false;data.set(k,v);return true;},read:async(k:string)=>data.get(k)??null,
    compareAndSet:async(k:string,v:string,n:string)=>{if(data.get(k)!==v)return false;data.set(k,n);return true;},
    consumeIfEqual:async(k:string,v:string)=>{if(data.get(k)!==v)return false;data.delete(k);return true;}};
  bridge={login:jest.fn().mockResolvedValue({subjectId:'123',loginToken:'private-login-token',camps:[{campId:'456',name:'<script>property</script>'}]}),
    authorize:jest.fn().mockResolvedValue({subjectId:'123',credential:'private-app-secret'})};
  const saved=new Map<string,PersistentGrant>();
  grants={create:jest.fn(async(g:PersistentGrant)=>{saved.set(g.grantId,g);}),revoke:jest.fn(async(id:string)=>{saved.delete(id);})};
  codes=new AuthorizationCodeService(store,resource,'localsbnb:mcp:dev:oauth',()=>now);
  const browser=createBrowserAuthorization({issuer,namespace:'localsbnb:mcp:dev:oauth',clients:[client],store,
    cipher:new CredentialCipher('key',{key:randomBytes(32)}),bridge,grants,codes,now:()=>now});
  const tokens=new OAuthTokenService(store,{revoke:async(id)=>{saved.delete(id);},readActive:async(id)=>saved.get(id)??null},resource,'localsbnb:mcp:dev:oauth',()=>now);
  const handler=createOAuthHttpHandler({issuer,resource,clients:[{...client,authMethod:'none'}],codes,tokens,authorization:browser,allowRequest:async()=>true});
  server=createServer((req,res)=>{void handler(req,res);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));port=(server.address() as AddressInfo).port;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
function call(path:string,body?:Record<string,string>,cookie?:string,origin=issuer){return new Promise<{status:number;html:string;headers:import('node:http').IncomingHttpHeaders}>((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port,path,method:body?'POST':'GET',headers:{Host:'mcp.example',Origin:origin,'Content-Type':'application/x-www-form-urlencoded',...(cookie?{Cookie:cookie}:{})}},res=>{
    let html='';res.on('data',c=>html+=c);res.on('end',()=>resolve({status:res.statusCode!,html,headers:res.headers}));});req.on('error',reject);req.end(body?new URLSearchParams(body).toString():undefined);
});}
async function begin(overrides:Record<string,string>={}){
  const q=new URLSearchParams({client_id:client.clientId,redirect_uri:client.redirectUris[0],resource,scope:'rooms:read',response_type:'code',code_challenge_method:'S256',code_challenge:pkceS256(verifier),state:'state-123',...overrides});
  const r=await call('/authorize?'+q);return {...r,cookie:r.headers['set-cookie']?.[0]?.split(';')[0]??'',
    transaction:r.html.match(/name="transaction" value="([^"]+)"/)?.[1]??'',csrf:r.html.match(/name="csrf" value="([^"]+)"/)?.[1]??''};
}
async function login(t:Awaited<ReturnType<typeof begin>>){return call('/authorize/login',{transaction:t.transaction,csrf:t.csrf,email:'a@example.com',password:'not-stored'},t.cookie);}
it('renders secure login/consent, encrypts session and issues code only after approval',async()=>{
  const t=await begin();expect(t.status).toBe(200);expect(t.headers['set-cookie']?.[0]).toContain('HttpOnly; Secure; SameSite=Lax');
  const r=await login(t);expect(r.html).toContain('&lt;script&gt;');expect(r.html).not.toContain('private-login-token');
  expect([...data.values()].join('')).not.toContain('private-login-token');expect([...data.values()].join('')).not.toContain('not-stored');
  expect(grants.create).not.toHaveBeenCalled();
  const approved=await call('/authorize/consent',{transaction:t.transaction,csrf:t.csrf,campId:'456',decision:'approve'},t.cookie);
  expect(approved.status).toBe(303);expect(grants.create).toHaveBeenCalledWith(expect.objectContaining({subjectId:'123',campId:'456'}),'private-app-secret');
  const u=new URL(approved.headers.location!);expect(u.searchParams.get('state')).toBe('state-123');
  const token=await call('/token',{client_id:client.clientId,grant_type:'authorization_code',code:u.searchParams.get('code')!,code_verifier:verifier,redirect_uri:client.redirectUris[0],resource});
  expect(token.status).toBe(200);expect(JSON.parse(token.html)).toMatchObject({token_type:'Bearer',scope:'rooms:read'});
  expect(token.html).not.toContain('private-app-secret');
});
it('does not fetch a secret or create a grant on denial',async()=>{
  const t=await begin();await login(t);const r=await call('/authorize/consent',{transaction:t.transaction,csrf:t.csrf,decision:'deny'},t.cookie);
  expect(r.status).toBe(303);expect(new URL(r.headers.location!).searchParams.get('error')).toBe('access_denied');
  expect(bridge.authorize).not.toHaveBeenCalled();expect(grants.create).not.toHaveBeenCalled();
});
it('rejects CSRF, browser mismatch and wrong origin before login',async()=>{
  const t=await begin();const f={transaction:t.transaction,csrf:t.csrf,email:'a',password:'b'};
  expect((await call('/authorize/login',{...f,csrf:'a'.repeat(43)},t.cookie)).status).toBe(400);
  expect((await call('/authorize/login',f,t.cookie+'x')).status).toBe(400);
  expect((await call('/authorize/login',f,t.cookie,'https://evil.example')).status).toBe(400);
  expect(bridge.login).not.toHaveBeenCalled();
});
it('rejects unsupported scope and unregistered redirect without redirecting',async()=>{
  expect((await begin({scope:'admin'})).status).toBe(400);const t=await begin({redirect_uri:'https://evil.example'});expect(t.status).toBe(400);expect(t.headers.location).toBeUndefined();
});
it('expires browser transactions and prevents premature or cross-property approval',async()=>{
  const t=await begin();const f={transaction:t.transaction,csrf:t.csrf,campId:'456',decision:'approve'};
  expect((await call('/authorize/consent',f,t.cookie)).status).toBe(400);await login(t);
  expect((await call('/authorize/consent',{...f,campId:'999'},t.cookie)).status).toBe(400);
  now+=600000;expect((await call('/authorize/consent',f,t.cookie)).status).toBe(400);expect(grants.create).not.toHaveBeenCalled();
});
it('consumes consent once under concurrency',async()=>{
  const t=await begin();await login(t);const f={transaction:t.transaction,csrf:t.csrf,campId:'456',decision:'approve'};
  const results=await Promise.all(Array.from({length:6},()=>call('/authorize/consent',f,t.cookie)));
  expect(results.filter(r=>r.status===303)).toHaveLength(1);expect(grants.create).toHaveBeenCalledTimes(1);
});
it('handles MFA without storing password or echoing backend errors',async()=>{
  const t=await begin();bridge.login.mockRejectedValueOnce(new BrowserAuthError('mfa_required'));const r=await login(t);
  expect(r.html).toContain('verification code');expect(r.html).not.toContain('not-stored');expect(grants.create).not.toHaveBeenCalled();
  expect((await login(t)).status).toBe(200);
});
it('rechecks identity and property authorization at consent',async()=>{
  const t=await begin();await login(t);bridge.authorize.mockRejectedValueOnce(new BrowserAuthError('property_forbidden'));
  const r=await call('/authorize/consent',{transaction:t.transaction,csrf:t.csrf,campId:'456',decision:'approve'},t.cookie);
  expect(r.status).toBe(400);expect(grants.create).not.toHaveBeenCalled();
});
it('revokes a persisted grant if code issuance fails',async()=>{
  const t=await begin();await login(t);jest.spyOn(codes,'issue').mockRejectedValueOnce(new Error('sensitive failure'));
  const r=await call('/authorize/consent',{transaction:t.transaction,csrf:t.csrf,campId:'456',decision:'approve'},t.cookie);
  expect(r.status).toBe(400);expect(r.html).not.toContain('sensitive');expect(grants.revoke).toHaveBeenCalledTimes(1);
});
