import { readRemoteConfig } from '../src/remote/config';

const dev = {
  LOCALSBNB_REMOTE_ENV: 'dev',
  LOCALSBNB_REMOTE_PUBLIC_ORIGIN: 'https://mcp-dev.example.com',
  LUKEYUN_API_BASE_URL: 'https://hudson-dev.localhome.cn',
  LOCALSBNB_SITE_URL: 'https://overseas-dev.localhome.cn',
};

describe('remote deployment boundary', () => {
  it('creates an explicit resource URL and leaves the supplied environment unchanged', () => {
    const env = Object.freeze({...dev});
    expect(readRemoteConfig(env)).toEqual({environment:'dev',publicOrigin:dev.LOCALSBNB_REMOTE_PUBLIC_ORIGIN,
      resourceUrl:'https://mcp-dev.example.com/mcp',hudsonOrigin:dev.LUKEYUN_API_BASE_URL,
      siteOrigin:dev.LOCALSBNB_SITE_URL,port:8787});
  });
  it('allows an explicitly selected production deployment', () => {
    expect(readRemoteConfig({...dev,LOCALSBNB_REMOTE_ENV:'prod',
      LUKEYUN_API_BASE_URL:'https://hudson-prod.localhome.cn',LOCALSBNB_SITE_URL:'https://localsbnb.com'}).environment).toBe('prod');
  });
  it.each([undefined,'','uat'])('does not default an invalid environment to prod (%s)', value => {
    expect(()=>readRemoteConfig({...dev,LOCALSBNB_REMOTE_ENV:value})).toThrow('explicitly');
  });
  it.each(['LUKEYUN_API_BASE_URL','LOCALSBNB_SITE_URL'])('rejects missing %s', key => {
    expect(()=>readRemoteConfig({...dev,[key]:undefined})).toThrow('required');
  });
  it('refuses sending dev authorization to prod Hudson', () => {
    expect(()=>readRemoteConfig({...dev,LUKEYUN_API_BASE_URL:'https://hudson-prod.localhome.cn'})).toThrow('must match');
  });
  it('refuses opening a different environment in the browser', () => {
    expect(()=>readRemoteConfig({...dev,LOCALSBNB_SITE_URL:'https://localsbnb.com'})).toThrow('must match');
  });
  it.each(['APP_SECRET','APP_ID','HUDSON_ACCESS_TOKEN','CAMP_ID','LUKEYUN_API_KEY','LUKEYUN_API_SCOPES','LOCALSBNB_CREDENTIALS_PATH'])('rejects local credential key %s', key => {
    expect(()=>readRemoteConfig({...dev,[key]:'sensitive-value'})).toThrow('local stdio');
  });
  it.each(['http://example.com','https://user:secret@example.com','https://example.com/path',
    'https://example.com/?token=secret','https://example.com/#secret','invalid-secret'])('rejects malformed public origin without echoing it', value => {
    try {readRemoteConfig({...dev,LOCALSBNB_REMOTE_PUBLIC_ORIGIN:value});throw new Error('unexpected pass');}
    catch(error) {expect((error as Error).message).toContain('HTTPS origin');expect((error as Error).message).not.toContain(value);}
  });
  it.each(['0','65536','1.2','12x','-1'])('rejects invalid port %s', value => {
    expect(()=>readRemoteConfig({...dev,LOCALSBNB_REMOTE_PORT:value})).toThrow('integer');
  });
});
