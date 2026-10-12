import { OAuthTokenService, type TokenFamilyStore } from '../src/remote/oauth/tokenService';
const resource = 'https://mcp.example/mcp';
function setup() {
  let now = Date.now();
  let active = true;
  const data = new Map<string, string>();
  const grant = { grantId: 'grant-1', subjectId: 'user-1', campId: 'camp-1', clientId: 'client-1', resource,
    scopes: ['rooms:read', 'orders:read'], expiresAt: new Date(now + 10 * 86400_000), hudsonCredential: 'must-not-escape' };
  const store: TokenFamilyStore = {
    putIfAbsent: async (k,v) => { if(data.has(k)) return false; data.set(k,v); return true; },
    read: async k => data.get(k) ?? null,
    compareAndSet: async (k,old,next) => { if(data.get(k)!==old) return false; data.set(k,next); return true; },
  };
  const reader = { revoke:jest.fn(async()=>{active=false;}), readActive: jest.fn(async () => active ? grant : null) };
  const service = new OAuthTokenService(store, reader, resource, 'localsbnb:mcp:dev:oauth', () => now);
  const issue = () => service.issue({...grant, scopes:['rooms:read']});
  return {service, store, reader, grant, data, issue, advance:(ms:number)=>{now+=ms;}, revokeGrant:()=>{active=false;}};
}
it('stores only hashes; verified context has bound identity, limited scope and no Hudson credential', async()=>{
  const t=setup(); const p=await t.issue();
  const saved=[...t.data.values()].join('');
  expect(saved).not.toContain(p.access_token); expect(saved).not.toContain(p.refresh_token);
  expect(saved).not.toContain('must-not-escape');
  const context=await t.service.verify(p.access_token,resource);
  expect(context).toMatchObject({subjectId:'user-1',campId:'camp-1',scopes:['rooms:read']});
  expect(context).not.toHaveProperty('hudsonCredential');
  expect(p.expires_in).toBe(600);
});
it('rotates both tokens and revokes the family when an old refresh token is reused',async()=>{
  const t=setup();const first=await t.issue();const next=await t.service.refresh('client-1',first.refresh_token,resource);
  await expect(t.service.verify(first.access_token,resource)).rejects.toThrow('invalid_token');
  await expect(t.service.verify(next.access_token,resource)).resolves.toBeDefined();
  await expect(t.service.refresh('client-1',first.refresh_token,resource)).rejects.toThrow('invalid_grant');
  await expect(t.service.verify(next.access_token,resource)).rejects.toThrow('invalid_token');
  await expect(t.service.refresh('client-1',next.refresh_token,resource)).rejects.toThrow('invalid_grant');
});
it('only one concurrent refresh succeeds, then replay revokes its family',async()=>{
  const t=setup();const p=await t.issue();
  const results=await Promise.allSettled(Array.from({length:12},()=>t.service.refresh('client-1',p.refresh_token,resource)));
  const winners=results.filter((r):r is PromiseFulfilledResult<Awaited<ReturnType<typeof t.issue>>>=>r.status==='fulfilled');
  expect(winners).toHaveLength(1);
  await expect(t.service.verify(winners[0].value.access_token,resource)).rejects.toThrow('invalid_token');
});
it('wrong client/resource and guessed secrets do not revoke a valid family',async()=>{
  const t=setup();const p=await t.issue();
  await expect(t.service.refresh('other',p.refresh_token,resource)).rejects.toThrow('invalid_grant');
  await expect(t.service.refresh('client-1',p.refresh_token,'https://wrong.example/mcp')).rejects.toThrow('invalid_grant');
  const forged=p.refresh_token.slice(0,p.refresh_token.lastIndexOf('.')+1)+'a'.repeat(43);
  await expect(t.service.refresh('client-1',forged,resource)).rejects.toThrow('invalid_grant');
  await t.service.revoke('other',p.refresh_token); await t.service.revoke('client-1',forged);
  await expect(t.service.verify(p.access_token,resource)).resolves.toBeDefined();
});
it('access expiry permits refresh, but absolute family expiry requires authorization',async()=>{
  const t=setup();const p=await t.issue();t.advance(600_000);
  await expect(t.service.verify(p.access_token,resource)).rejects.toThrow('invalid_token');
  const next=await t.service.refresh('client-1',p.refresh_token,resource);t.advance(7*86400_000);
  await expect(t.service.refresh('client-1',next.refresh_token,resource)).rejects.toThrow('invalid_grant');
});
it('grant revocation blocks issue, access and refresh',async()=>{
  const t=setup();const p=await t.issue();t.revokeGrant();
  await expect(t.issue()).rejects.toThrow('invalid_grant');
  await expect(t.service.verify(p.access_token,resource)).rejects.toThrow('invalid_token');
  await expect(t.service.refresh('client-1',p.refresh_token,resource)).rejects.toThrow('invalid_grant');
});
it('scope reduction invalidates existing broader tokens',async()=>{
  const t=setup();const p=await t.issue();t.grant.scopes=['orders:read'];
  await expect(t.service.verify(p.access_token,resource)).rejects.toThrow('invalid_token');
  await expect(t.service.refresh('client-1',p.refresh_token,resource)).rejects.toThrow('invalid_grant');
});
it('revocation also disables other tokens derived from the same grant',async()=>{
  const t=setup();const a=await t.issue();const b=await t.issue();await t.service.revoke('client-1',a.access_token);
  await expect(t.service.verify(a.access_token,resource)).rejects.toThrow('invalid_token');
  await expect(t.service.verify(b.access_token,resource)).rejects.toThrow('invalid_token');
  expect(t.reader.revoke).toHaveBeenCalledWith('grant-1','user-1');
});
it('caps token lifetime at grant expiry',async()=>{
  const t=setup();t.grant.expiresAt=new Date(t.grant.expiresAt.getTime()-10*86400_000+30_000);
  const p=await t.issue();expect(p.expires_in).toBe(30);t.advance(30_000);
  await expect(t.service.verify(p.access_token,resource)).rejects.toThrow('invalid_token');
  await expect(t.service.refresh('client-1',p.refresh_token,resource)).rejects.toThrow('invalid_grant');
});
it('fails closed on store outage without an in-memory fallback',async()=>{
  const t=setup();const p=await t.issue();t.store.read=async()=>{throw new Error('store unavailable');};
  await expect(t.service.verify(p.access_token,resource)).rejects.toThrow('store unavailable');
});
it('separates refresh/access token types and resource audiences',async()=>{
  const t=setup();const p=await t.issue();
  await expect(t.service.verify(p.refresh_token,resource)).rejects.toThrow('invalid_token');
  await expect(t.service.refresh('client-1',p.access_token,resource)).rejects.toThrow('invalid_grant');
  await expect(t.service.verify(p.access_token,'https://other.example/mcp')).rejects.toThrow('invalid_token');
});
