import { config } from '../../config/index.js';
import { tryOpenSystemBrowser } from '../../auth/openSystemBrowser.js';
import type { ToolContext } from '../../types/mcp.js';
import { requireCampId } from '../../region/index.js';
import { invalid } from '../overseas/mutationPreview.js';

/** Public PC entry only: credentials are supplied by the user's PC login, never by an MCP URL. */
export async function domesticChannelLaunch(context: ToolContext, channelId: string) {
  if (!/^[1-9][0-9]*$/.test(channelId)) invalid('channelId must be a domestic channel ID');
  const apiOrigin = context.remote ? context.remote.hudsonOrigin : config.api.baseURL;
  const sites: Record<string, { origin: string; environment: string }> = {
    'https://hudson-dev.localhome.cn': { origin: 'https://h-dev.localhome.cn', environment: 'dev' },
    'https://hudson-prod.localhome.cn': { origin: 'https://h.localhome.cn', environment: 'prod' },
  };
  const site = apiOrigin && sites[apiOrigin];
  if (!site) invalid('Domestic PC authorization environment is not configured');
  const url = new URL('/channels/list', site.origin);
  url.searchParams.set('aiChannelId', channelId);
  url.searchParams.set('aiCampId', requireCampId(context));
  url.searchParams.set('aiEnvironment', site.environment);
  const openUrl = url.toString();
  // A remote service cannot open the user's browser by spawning a process on ACK.
  const opened = context.remote ? { opened: false, reason: 'open_in_client' }
    : await tryOpenSystemBrowser(openUrl);
  return { openUrl, browserOpenRequested: opened.opened, browserOpenReason: opened.reason };
}
