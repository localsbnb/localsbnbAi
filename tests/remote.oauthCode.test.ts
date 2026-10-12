import { AuthorizationCodeService, pkceS256, type OneTimeCodeStore } from '../src/remote/oauth/authorizationCode';
import { RedisAuthorizationCodeStore } from '../src/remote/oauth/redisCodeStore';

const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const client = {clientId:'test-client',redirectUris:['https://client.example/callback'],allowedScopes:['rooms:read']};
const grant = {grantId:'server-approved-grant',clientId:client.clientId,resource:'https://mcp.example/mcp',scopes:['rooms:read']};
function setup() {
  const data=new Map<string,string>();
  const store: OneTimeCodeStore={
    putIfAbsent:async(k,v)=>{if(data.has(k))return false;data.set(k,v);return true;},
    read:async k=>data.get(k)??null,
    consumeIfEqual:async(k,v)=>{if(data.get(k)!==v)return false;data.delete(k);return true;},
  };
  let now=1000;
  const service=new AuthorizationCodeService(store,grant.resource,'localsbnb:mcp:dev:oauth',()=>now);
  const request={redirectUri:client.redirectUris[0],challenge,challengeMethod:'S256',state:'opaque-client-state'};
  const issue=async()=>new URL((await service.issue(client,grant,request)).redirectUrl).searchParams.get('code')!;
  const exchange=(code:string)=>({code,verifier,redirectUri:request.redirectUri,resource:grant.resource});
  return {service,store,data,request,issue,exchange,expire:()=>{now+=120000;}};
}
it('matches the RFC 7636 S256 test vector',()=>expect(pkceS256(verifier)).toBe(challenge));
it('returns state unchanged, stores only a digest key and redeems once',async()=>{
  const t=setup();const issued=await t.service.issue(client,grant,t.request);const url=new URL(issued.redirectUrl);
  const code=url.searchParams.get('code')!;
  expect(url.searchParams.get('state')).toBe(t.request.state);
  expect([...t.data.keys()][0]).not.toContain(code);
  expect(await t.service.redeem(client.clientId,t.exchange(code))).toEqual(grant);
  await expect(t.service.redeem(client.clientId,t.exchange(code))).rejects.toThrow('invalid_grant');
});
it('only one concurrent redemption succeeds',async()=>{
  const t=setup();const code=await t.issue();
  const result=await Promise.allSettled(Array.from({length:8},()=>t.service.redeem(client.clientId,t.exchange(code))));
  expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
it('rejects expiry even when the store has not removed the record',async()=>{
  const t=setup();const code=await t.issue();t.expire();
  await expect(t.service.redeem(client.clientId,t.exchange(code))).rejects.toThrow('invalid_grant');
});
it.each(['verifier','redirectUri','resource'])('rejects a mismatched %s without consuming valid code',async field=>{
  const t=setup();const code=await t.issue();
  await expect(t.service.redeem(client.clientId,{...t.exchange(code),[field]:field==='verifier'?'x'.repeat(43):'https://other.example'})).rejects.toThrow('invalid_grant');
  expect(await t.service.redeem(client.clientId,t.exchange(code))).toEqual(grant);
});
it('rejects a different client',async()=>{
  const t=setup();const code=await t.issue();
  await expect(t.service.redeem('other',t.exchange(code))).rejects.toThrow('invalid_grant');
});
it.each(['plain',''])('refuses PKCE method %s',async challengeMethod=>{
  const t=setup();await expect(t.service.issue(client,grant,{...t.request,challengeMethod})).rejects.toThrow('invalid_request');
});
it.each(['https://client.example.evil/callback','https://client.example/callback/','http://client.example/callback'])('rejects unregistered redirect %s',async redirectUri=>{
  const t=setup();await expect(t.service.issue(client,grant,{...t.request,redirectUri})).rejects.toThrow('invalid_request');
});
it('does not issue wider scopes than the registered client',async()=>{
  const t=setup();await expect(t.service.issue(client,{...grant,scopes:['orders:write']},t.request)).rejects.toThrow('invalid_scope');
});
it('does not leak corrupt stored data into errors',async()=>{
  const t=setup();const code=await t.issue();t.data.set([...t.data.keys()][0],'sensitive-invalid-json');
  await expect(t.service.redeem(client.clientId,t.exchange(code))).rejects.toThrow(/^invalid_grant$/);
});
it('propagates storage outages instead of falling back to memory',async()=>{
  const t=setup();t.store.putIfAbsent=async()=>{throw new Error('storage unavailable');};
  await expect(t.issue()).rejects.toThrow('storage unavailable');
});
it('sends an atomic compare/delete to Redis and treats a losing race as failure',async()=>{
  const redis={set:jest.fn().mockResolvedValue('OK'),get:jest.fn().mockResolvedValue('record'),eval:jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0)};
  const store=new RedisAuthorizationCodeStore(redis);
  expect(await store.putIfAbsent('key','record',120)).toBe(true);
  expect(redis.set).toHaveBeenCalledWith('key','record','EX',120,'NX');
  expect(await store.consumeIfEqual('key','record')).toBe(true);
  expect(await store.consumeIfEqual('key','record')).toBe(false);
  expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('DEL'"),1,'key','record');
});
