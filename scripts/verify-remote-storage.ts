/** 仅连接 deployment/remote/compose.yaml 的本机实例，不接受外部连接串。 */
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { parse } from 'dotenv';
import pg from 'pg';
import Redis from 'ioredis';
import { AuthorizationCodeService, pkceS256 } from '../src/remote/oauth/authorizationCode.js';
import { CredentialCipher } from '../src/remote/oauth/credentialCipher.js';
import { PostgresGrantStore } from '../src/remote/oauth/postgresGrantStore.js';
import { OAuthTokenService } from '../src/remote/oauth/tokenService.js';
import { RedisTokenFamilyStore } from '../src/remote/oauth/redisTokenStore.js';
import { RedisAuthorizationCodeStore } from '../src/remote/oauth/redisCodeStore.js';

async function main(): Promise<void> {
  const env = parse(readFileSync('deployment/remote/.env.local'));
  if (!env.MCP_LOCAL_DB_PASSWORD || !env.MCP_LOCAL_REDIS_PASSWORD) throw new Error('Missing local configuration');
  const db = new pg.Client({host:'127.0.0.1',port:55432,database:'localsbnb_mcp',user:'localsbnb_mcp',
    password:env.MCP_LOCAL_DB_PASSWORD,connectionTimeoutMillis:5000,query_timeout:5000});
  const redis = new Redis({host:'127.0.0.1',port:56379,password:env.MCP_LOCAL_REDIS_PASSWORD,
    lazyConnect:true,connectTimeout:5000,maxRetriesPerRequest:0,retryStrategy:()=>null,enableOfflineQueue:false});
  redis.on('error', () => undefined); // 不输出连接配置或原始驱动异常。
  const keys = new Set<string>();
  const runId=randomUUID();
  try {
    await db.connect();
    await db.query('BEGIN');
    await db.query('CREATE TEMP TABLE mcp_storage_probe (id uuid PRIMARY KEY, payload jsonb NOT NULL) ON COMMIT DROP');
    await db.query('INSERT INTO mcp_storage_probe (id,payload) VALUES ($1,$2::jsonb)',[runId,JSON.stringify({client:'test-client',scope:['rooms:read']})]);
    const rows=await db.query('SELECT payload FROM mcp_storage_probe WHERE id=$1',[runId]);
    assert.equal(rows.rows[0].payload.client,'test-client');
    await db.query(readFileSync('deployment/remote/migrations/001-auth-grants.sql','utf8'));
    const cipher=new CredentialCipher('integration-key',{ 'integration-key':randomBytes(32) });
    const grants=new PostgresGrantStore(db,cipher);
    const persisted={grantId:runId,subjectId:'local-test-user',clientId:'local-test-client',campId:'local-test-camp',
      resource:'https://mcp.example/mcp',scopes:['rooms:read'],expiresAt:new Date(Date.now()+60000)};
    await grants.create(persisted,'test-only-hudson-secret');
    const stored=await db.query('SELECT credential_ciphertext FROM mcp_auth.grants WHERE grant_id=$1',[runId]);
    assert.ok(!stored.rows[0].credential_ciphertext.includes('test-only-hudson-secret'));
    assert.equal((await grants.readActive(runId,persisted.clientId,persisted.resource))?.hudsonCredential,'test-only-hudson-secret');
    assert.equal(await grants.readActive(runId,'other-client',persisted.resource),null);
    assert.equal(await grants.readActive(runId,persisted.clientId,'https://other.example/mcp'),null);
    await grants.revoke(runId,'different-user');
    assert.ok(await grants.readActive(runId,persisted.clientId,persisted.resource));
    await db.query('UPDATE mcp_auth.grants SET camp_id=$1 WHERE grant_id=$2',['tampered-camp',runId]);
    await assert.rejects(()=>grants.readActive(runId,persisted.clientId,persisted.resource),/decryption failed/);
    await db.query('UPDATE mcp_auth.grants SET camp_id=$1 WHERE grant_id=$2',[persisted.campId,runId]);
    await grants.revoke(runId,persisted.subjectId);
    assert.equal(await grants.readActive(runId,persisted.clientId,persisted.resource),null);
    const expiredId=randomUUID();
    await grants.create({...persisted,grantId:expiredId},'test-only-hudson-secret');
    await db.query("UPDATE mcp_auth.grants SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE grant_id=$1",[expiredId]);
    assert.equal(await grants.readActive(expiredId,persisted.clientId,persisted.resource),null);
    const tokenGrant={...persisted,grantId:randomUUID(),expiresAt:new Date(Date.now()+3600000)};
    await grants.create(tokenGrant,'test-only-hudson-secret');
    console.log('PASS PostgreSQL transaction, JSONB, encrypted grants, client/resource isolation, tamper rejection, revocation and expiry (transaction open until token checks finish)');

    await redis.connect();
    assert.equal(await redis.ping(),'PONG');
    const commands={
      set:async(key:string,value:string,expiry:'EX',seconds:number,condition:'NX')=>{keys.add(key);return redis.set(key,value,expiry,seconds,condition);},
      get:(key:string)=>redis.get(key),
      eval:(script:string,count:number,...args:string[])=>redis.eval(script,count,...args),
    };
    const store=new RedisAuthorizationCodeStore(commands);
    // 此验证共用一个回滚事务，串行化 PG 查询；Redis 刷新竞争仍并发执行。
    let grantReads:Promise<unknown>=Promise.resolve();
    const tokenReader={revoke:(id:string,subject:string)=>{const next=grantReads.then(()=>grants.revoke(id,subject));grantReads=next.catch(()=>undefined);return next;},readActive:(id:string,clientId:string,resource:string)=>{
      const next=grantReads.then(()=>grants.readActive(id,clientId,resource));
      grantReads=next.then(()=>undefined,()=>undefined);
      return next;
    }};
    const tokens=new OAuthTokenService(new RedisTokenFamilyStore(commands),tokenReader,tokenGrant.resource,'localsbnb:mcp:dev:oauth');
    const firstPair=await tokens.issue(tokenGrant);
    const identity=await tokens.verify(firstPair.access_token,tokenGrant.resource);
    assert.equal(identity.subjectId,tokenGrant.subjectId);
    assert.ok(!('hudsonCredential' in identity));
    await assert.rejects(()=>tokens.refresh('other-client',firstPair.refresh_token,tokenGrant.resource),/invalid_grant/);
    const refreshed=await tokens.refresh(tokenGrant.clientId,firstPair.refresh_token,tokenGrant.resource);
    await tokens.verify(refreshed.access_token,tokenGrant.resource);
    await assert.rejects(()=>tokens.refresh(tokenGrant.clientId,firstPair.refresh_token,tokenGrant.resource),/invalid_grant/);
    await assert.rejects(()=>tokens.verify(refreshed.access_token,tokenGrant.resource),/invalid_token/);
    tokenGrant.grantId=randomUUID();await grants.create(tokenGrant,'test-business-secret');
    const racePair=await tokens.issue(tokenGrant);
    const rotations=await Promise.allSettled(Array.from({length:12},()=>tokens.refresh(tokenGrant.clientId,racePair.refresh_token,tokenGrant.resource)));
    assert.equal(rotations.filter(r=>r.status==='fulfilled').length,1);
    const rotationWinner=rotations.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<typeof racePair>;
    await assert.rejects(()=>tokens.verify(rotationWinner.value.access_token,tokenGrant.resource),/invalid_token/);
    tokenGrant.grantId=randomUUID();await grants.create(tokenGrant,'test-business-secret');
    const revocable=await tokens.issue(tokenGrant);
    await tokens.revoke(tokenGrant.clientId,revocable.refresh_token);
    await assert.rejects(()=>tokens.verify(revocable.access_token,tokenGrant.resource),/invalid_token/);
    tokenGrant.grantId=randomUUID();await grants.create(tokenGrant,'test-business-secret');
    const grantRevocable=await tokens.issue(tokenGrant);
    await grants.revoke(tokenGrant.grantId,tokenGrant.subjectId);
    await assert.rejects(()=>tokens.verify(grantRevocable.access_token,tokenGrant.resource),/invalid_token/);
    await assert.rejects(()=>tokens.refresh(tokenGrant.clientId,grantRevocable.refresh_token,tokenGrant.resource),/invalid_grant/);
    await db.query('ROLLBACK');
    console.log('PASS Redis token rotation, concurrent replay family revocation, explicit revocation and PostgreSQL grant revocation (SQL rolled back)');
    const service=new AuthorizationCodeService(store,'https://mcp.example/mcp','localsbnb:mcp:dev:oauth');
    const client={clientId:`local-test-${runId}`,redirectUris:['https://client.example/callback'],allowedScopes:['rooms:read']};
    const grant={grantId:runId,clientId:client.clientId,resource:'https://mcp.example/mcp',scopes:['rooms:read']};
    const verifier='dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const issued=await service.issue(client,grant,{redirectUri:client.redirectUris[0],challenge:pkceS256(verifier),challengeMethod:'S256'});
    const code=new URL(issued.redirectUrl).searchParams.get('code')!;
    const request={code,verifier,redirectUri:client.redirectUris[0],resource:grant.resource};
    await assert.rejects(()=>service.redeem(client.clientId,{...request,verifier:'x'.repeat(43)}),/invalid_grant/);
    const contenders=await Promise.allSettled(Array.from({length:12},()=>service.redeem(client.clientId,request)));
    assert.equal(contenders.filter(r=>r.status==='fulfilled').length,1);
    await assert.rejects(()=>service.redeem(client.clientId,request),/invalid_grant/);
    console.log('PASS Redis authorization code PKCE, 12 concurrent redemptions (one winner), replay rejection');

    const ttlKey=`localsbnb:mcp:dev:oauth:probe:${runId}`;
    assert.equal(await store.putIfAbsent(ttlKey,'first',1),true);
    assert.equal(await store.putIfAbsent(ttlKey,'second',1),false);
    assert.equal(await store.consumeIfEqual(ttlKey,'wrong'),false);
    assert.equal(await store.read(ttlKey),'first');
    await new Promise(resolve=>setTimeout(resolve,1200));
    assert.equal(await store.read(ttlKey),null);
    console.log('PASS Redis NX, compare-and-delete protection and real TTL expiry');
  } finally {
    try {
      if (redis.status === 'ready') {
        for (const key of keys) await redis.del(key);
        await redis.quit();
      }
    } finally {
      redis.disconnect();
      await db.end(); // 异常时断开连接也会回滚未提交事务。
    }
  }
}

main().catch(() => {
  console.error('Local storage verification failed. Check local container health and .env.local; sensitive errors withheld.');
  process.exitCode=1;
});
