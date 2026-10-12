import { HudsonLoginBridge } from '../src/remote/oauth/hudsonLoginBridge';
function setup(environment:'dev'|'prod'='dev') {
  const fetcher=jest.fn();
  const bridge=new HudsonLoginBridge(environment,fetcher as unknown as typeof fetch);
  const result=(data:unknown)=>fetcher.mockResolvedValueOnce({ok:true,json:async()=>({success:true,data})});
  const identity=()=>{result({userId:'1234567890123456789'});result({camps:[{campId:'2345678901234567890',name:'Property'}]});};
  return {bridge,fetcher,result,identity};
}
it('verifies current user and properties with explicit dev routing',async()=>{
  const t=setup();t.result('login-token');t.identity();const s=await t.bridge.login('A@example.com','password');
  expect(s.subjectId).toBe('1234567890123456789');
  expect(t.fetcher.mock.calls.map(c=>new URL(c[0]).pathname)).toEqual(['/user/bnb/sign-in','/user/own/get','/camps/get']);
  expect(t.fetcher.mock.calls.every(c=>c[0].startsWith('https://hudson-dev.localhome.cn/'))).toBe(true);
  expect(t.fetcher.mock.calls[1][1].headers['hudson-access-token']).toBe('Bearer login-token');
});
it('reads an existing secret without calling generate',async()=>{
  const t=setup();t.result('login-token');t.identity();const s=await t.bridge.login('a@example.com','password');
  t.identity();t.result('existing-secret');expect(await t.bridge.authorize(s,s.camps[0].campId)).toEqual({subjectId:s.subjectId,credential:'existing-secret'});
  expect(t.fetcher.mock.calls.some(c=>c[0].endsWith('/user/secret/generate'))).toBe(false);
});
it('missing secret never resets local credentials',async()=>{
  const t=setup();t.result('login-token');t.identity();const s=await t.bridge.login('a@example.com','password');
  t.identity();t.result('');await expect(t.bridge.authorize(s,s.camps[0].campId)).rejects.toThrow('credential_setup_required');
  expect(t.fetcher.mock.calls.filter(c=>c[0].includes('/secret/')).map(c=>new URL(c[0]).pathname)).toEqual(['/user/secret/get']);
});
it('requires production MFA and hides backend details',async()=>{
  const t=setup('prod');t.fetcher.mockResolvedValueOnce({ok:true,json:async()=>({success:false,errorCode:'BNB_LOGIN_MFA_REQUIRED',errorDetail:'sensitive'})});
  await expect(t.bridge.login('a@example.com','password')).rejects.toThrow(/^mfa_required$/);
  expect(JSON.parse(t.fetcher.mock.calls[0][1].body).enableMfa).toBe(1);
});
it('rejects changed identity and inaccessible properties before reading secrets',async()=>{
  const t=setup();t.result('login-token');t.identity();const s=await t.bridge.login('a@example.com','password');
  t.result({userId:'999'});t.result({camps:s.camps});await expect(t.bridge.authorize(s,s.camps[0].campId)).rejects.toThrow('property_forbidden');
  t.identity();await expect(t.bridge.authorize(s,'999')).rejects.toThrow('property_forbidden');
  expect(t.fetcher.mock.calls.some(c=>c[0].includes('/secret/'))).toBe(false);
});
it('rejects imprecise IDs and hides raw network failures',async()=>{
  const t=setup();t.result('login-token');t.result({userId:Number.MAX_SAFE_INTEGER+1});
  await expect(t.bridge.login('a@example.com','password')).rejects.toThrow(/^login_failed$/);
  t.fetcher.mockRejectedValueOnce(new Error('password=secret'));await expect(t.bridge.login('a@example.com','password')).rejects.toThrow(/^login_failed$/);
});
