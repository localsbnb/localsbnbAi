/** Explicit configuration for the future HTTP entry point. Never imports local auth or dotenv. */
export interface RemoteConfig {
  environment: 'dev' | 'prod';
  publicOrigin: string;
  resourceUrl: string;
  hudsonOrigin: string;
  siteOrigin: string;
  port: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

function httpsOrigin(env: Environment, key: string): string {
  const value = env[key]?.trim();
  // Do not include supplied values in errors: malformed URLs may contain secrets.
  if (!value) throw new Error(`${key} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an HTTPS origin`);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(`${key} must be an HTTPS origin without credentials, path, query or fragment`);
  }
  return url.origin;
}

/** No production default: a missing or mismatched environment must stop startup. */
export function readRemoteConfig(env: Environment): RemoteConfig {
  const environment = env.LOCALSBNB_REMOTE_ENV;
  if (environment !== 'dev' && environment !== 'prod') {
    throw new Error('LOCALSBNB_REMOTE_ENV must explicitly be dev or prod');
  }
  const publicOrigin = httpsOrigin(env, 'LOCALSBNB_REMOTE_PUBLIC_ORIGIN');
  const hudsonOrigin = httpsOrigin(env, 'LUKEYUN_API_BASE_URL');
  const siteOrigin = httpsOrigin(env, 'LOCALSBNB_SITE_URL');
  const expectedHudson =
    environment === 'dev' ? 'https://hudson-dev.localhome.cn' : 'https://hudson-prod.localhome.cn';
  const expectedSite =
    environment === 'dev' ? 'https://overseas-dev.localhome.cn' : 'https://localsbnb.com';
  if (hudsonOrigin !== expectedHudson || siteOrigin !== expectedSite) {
    throw new Error(
      'Remote environment, Hudson and browser site must match the approved deployment'
    );
  }
  // Local stdio credentials must never silently become a shared remote identity.
  const localAuthKeys = [
    'APP_SECRET',
    'APP_ID',
    'HUDSON_ACCESS_TOKEN',
    'CAMP_ID',
    'LUKEYUN_API_KEY',
    'LUKEYUN_API_SCOPES',
    'LOCALSBNB_CREDENTIALS_PATH',
  ];
  if (localAuthKeys.some((key) => !!env[key]?.trim())) {
    throw new Error('Remove local stdio credential configuration from the remote service');
  }
  const rawPort = env.LOCALSBNB_REMOTE_PORT ?? '8787';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('LOCALSBNB_REMOTE_PORT must be an integer between 1 and 65535');
  }
  return {
    environment,
    publicOrigin,
    resourceUrl: `${publicOrigin}/mcp`,
    hudsonOrigin,
    siteOrigin,
    port,
  };
}
