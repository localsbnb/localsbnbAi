import { createHash } from 'crypto';
import { channelData } from '../overseas/channels.js';
import { snapshot, fingerprint, ready } from '../overseas/channelConnectionSnapshot.js';
import { createSuccessResult } from '../../utils/errorHandler.js';
import type { ToolContext, ToolDefinition, ToolResult } from '../../types/mcp.js';
import { config } from '../../config/index.js';
import { extractPage, hudsonPost, requireCampId, type HudsonEnvelope } from '../../region/api.js';
import { handleToolError, MCPError, ErrorCode } from '../../utils/errorHandler.js';
import {
  HANDSHAKE_TTL_MS,
  readLocalHandshakeTicket,
  readLatestLocalHandshakeTicket,
  saveLocalHandshakeTicket,
} from '../../auth/handshakeTickets.js';
import { formatHudsonAccessTokenHeader } from '../../auth/hudsonToken.js';
import { tryOpenSystemBrowser } from '../../auth/openSystemBrowser.js';

export const AIRBNB_CHANNEL_ID = '1';

export const HANDSHAKE_TOOL_NAMES = [
  'start_handshake',
  'poll_handshake',
  'list_channel_accounts',
  'import_airbnb_listings',
] as const;

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function str(args: Record<string, unknown>, key: string): string {
  return args[key] == null ? '' : String(args[key]).trim();
}

function requireToken(context: ToolContext): string {
  const token = context.getHudsonAccessToken?.();
  if (!token) {
    throw new MCPError(
      ErrorCode.AUTH_REQUIRED,
      'Sign in first with sign_in or complete_sign_up, then connect Airbnb.'
    );
  }
  return token;
}

export function resolveHandshakeOrigin(): string {
  const fromEnv = (process.env.LOCALSBNB_SITE_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  if (config.api.baseURL.includes('hudson-dev') || config.api.baseURL.includes('hudson-uat')) {
    return 'https://overseas-dev.localhome.cn';
  }
  return 'https://localsbnb.com';
}

interface AccountRow {
  accountId?: string | number;
  username?: string;
  outAccountId?: string;
  isTokenExpired?: number;
  channelId?: string | number;
  lastSyncTime?: string | number;
}

export async function listAirbnbAccounts(context: ToolContext): Promise<AccountRow[]> {
  const campId = requireCampId(context);
  const data = await hudsonPost<unknown>(
    context,
    '/account/page/get',
    { campId, channelId: AIRBNB_CHANNEL_ID, pageNum: 1, pageSize: 50 },
    'list Airbnb accounts'
  );
  return extractPage<AccountRow>(data).list;
}

function accountIdOf(row: AccountRow): string {
  return String(row.accountId ?? '').trim();
}

export function handshakeSessionScope(context: ToolContext): string {
  return createHash('sha256').update(JSON.stringify([requireCampId(context),requireToken(context),resolveHandshakeOrigin()])).digest('hex');
}

function formatAccounts(rows: AccountRow[]): string {
  if (!rows.length) return 'No Airbnb accounts linked yet.';
  return rows
    .map((row, i) => {
      const expired = Number(row.isTokenExpired) === 1 ? ' disconnected' : '';
      return `${i + 1}. accountId=${accountIdOf(row)} name=${row.username || row.outAccountId || '-'}${expired}`;
    })
    .join('\n');
}

export async function startHandshakeHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const type = str(args, 'type') || 'airbnb_oauth';
  if (type !== 'airbnb_oauth') {
    throw new MCPError(
      ErrorCode.INVALID_PARAMS,
      'Only type=airbnb_oauth is supported in P1. Google login is not available yet.'
    );
  }
  const token = requireToken(context);
  const campId = requireCampId(context);
  const existing = await listAirbnbAccounts(context);
  const baselinePois = snapshot(await channelData(context, AIRBNB_CHANNEL_ID));
  const origin = resolveHandshakeOrigin();
  const response = await fetch(`${origin}/api/ai/handshake/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'hudson-access-token': formatHudsonAccessTokenHeader(token),
    },
    body: JSON.stringify({ campId, type: 'airbnb_oauth' }),
  });
  const json = (await response.json().catch(() => ({}))) as HudsonEnvelope<{
    ticketId?: string;
    openUrl?: string;
    expiresAt?: number;
  }>;
  if (!response.ok || json.success !== true || !json.data?.ticketId || !json.data.openUrl) {
    const hint = [
      `Could not create handshake at ${origin}/api/ai/handshake/create`,
      json.errorMsg ? `errorMsg=${json.errorMsg}` : `HTTP ${response.status}`,
      'For local test: start overseas PC (next dev) and set LOCALSBNB_SITE_URL to that origin, e.g. http://localhost:3000',
      'Airbnb redirect_uri must match the PC callback host (cookie cannot jump across localhost vs overseas-dev).',
    ].join('\n');
    return textResult(hint, true);
  }

  const now = Date.now();
  saveLocalHandshakeTicket({
    ticketId: json.data.ticketId,
    type: 'airbnb_oauth',
    campId,
    baselineAccountIds: existing.map(accountIdOf).filter(Boolean),
    baselineFingerprints: [],
    baselinePois,
    sessionScope: handshakeSessionScope(context),
    createdAt: now,
    expiresAt: json.data.expiresAt || now + HANDSHAKE_TTL_MS,
  });

  const already = formatAccounts(existing);
  const openUrl = json.data.openUrl;
  const browser = await tryOpenSystemBrowser(openUrl);
  const openHint = browser.opened
    ? 'Tried to open the system browser once. If no window appeared, open this URL manually (do not share it):'
    : `Could not auto-open the browser (${browser.reason}). Open this URL manually (do not share it):`;
  return textResult(
    [
      openHint,
      openUrl,
      '',
      `ticketId=${json.data.ticketId}`,
      '请在打开的浏览器页面完成 Airbnb 授权及房源导入/关联（手机或桌面均可），完成后回到对话只回复“已完成”即可。网页保留 Handshake 登录态。',
      'On 已完成/done call poll_handshake with no arguments; it resolves this session internally and compares POI/room mappings. Do not ask the user for IDs. Do not import again after they completed it in the browser.',
      '',
      'Current Airbnb accounts:',
      already,
    ].join('\n')
  );
}

export async function pollHandshakeHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const scope = handshakeSessionScope(context);
  const ticketId = str(args, 'ticketId');
  const ticket = ticketId ? readLocalHandshakeTicket(ticketId) : readLatestLocalHandshakeTicket(scope);
  if (!ticket || ticket.sessionScope !== scope || ticket.campId !== requireCampId(context) || !ticket.baselinePois) {
    return textResult('Handshake record missing, expired, or belongs to another session. Start a new handshake; do not treat this as completed.', true);
  }
  if (ticket.completedPois) return createSuccessResult({status:'succeeded',channel:'airbnb',properties:ticket.completedPois});
  const accounts = await listAirbnbAccounts(context);
  const current = snapshot(await channelData(context, AIRBNB_CHANNEL_ID));
  const previous = new Map(ticket.baselinePois.map(poi=>[poi.poiId,poi]));
  const changed = current.filter(poi=>!previous.has(poi.poiId)||fingerprint(previous.get(poi.poiId)!)!==fingerprint(poi));
  if (changed.some(poi=>poi.rooms.some(room=>room.status===4||room.error))) {
    return createSuccessResult({status:'needs_action',properties:changed,message:'房源关联存在异常，请在浏览器页面处理后再回复“已完成”。'});
  }
  if (!accounts.some(account=>Number(account.isTokenExpired)!==1) || !changed.length || changed.some(poi=>!ready(poi,false))) {
    return createSuccessResult({status:'pending',properties:changed,
      message:'尚未确认本次房源导入/关联完成。请在已打开的网页完成或等待同步，然后再回复“已完成”。',
      next:'Keep the original baseline. Account creation or lastSyncTime changes alone do not prove property/room linkage. Do not request IDs or import on the user’s behalf.'});
  }
  saveLocalHandshakeTicket({...ticket,completedPois:changed});
  return createSuccessResult({status:'succeeded',channel:'airbnb',properties:changed,
    message:'已核对本次门店/房型关联变化，Airbnb 房源关联完成。',next:'End this flow; do not ask for IDs or import these listings again.'});
}

export async function listChannelAccountsHandler(
  _args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  requireToken(context);
  const rows = await listAirbnbAccounts(context);
  return textResult(formatAccounts(rows));
}

interface PullListing {
  outRoomCategoryId?: string;
  outRoomCategoryName?: string;
  isImported?: boolean;
  address?: string;
}

export async function importAirbnbListingsHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  requireToken(context);
  const campId = requireCampId(context);
  const accountId = str(args, 'accountId');
  if (!accountId) throw new MCPError(ErrorCode.MISSING_PARAMS, 'accountId is required');
  const confirm = args.confirm === true || args.confirm === 'true';
  const requestIdArg = str(args, 'requestId');
  const idsRaw = args.outRoomCategoryIds;
  const outRoomCategoryIds = Array.isArray(idsRaw)
    ? idsRaw.map((id) => String(id).trim()).filter(Boolean)
    : [];

  if (!confirm || !outRoomCategoryIds.length) {
    const pull = await hudsonPost<{
      requestId?: string;
      poiInfos?: Array<{ address?: string; roomCategoryInfos?: PullListing[] }>;
    }>(
      context,
      '/quickOnline/pull',
      { campId, channelId: AIRBNB_CHANNEL_ID, accountId },
      'pull Airbnb listings'
    );
    const listings: PullListing[] = [];
    for (const poi of pull.poiInfos ?? []) {
      for (const room of poi.roomCategoryInfos ?? []) {
        listings.push({
          ...room,
          address: poi.address,
        });
      }
    }
    if (!listings.length) {
      return textResult('No Airbnb listings found on this account.');
    }
    const lines = listings.map((item, i) => {
      const imported = item.isImported ? ' alreadyImported' : '';
      return `${i + 1}. ${item.outRoomCategoryName || '-'} id=${item.outRoomCategoryId || '-'}${imported} ${item.address || ''}`.trim();
    });
    return textResult(
      [
        `requestId=${pull.requestId || '-'}`,
        'Preview only. Ask the host which listings to import, then call import_airbnb_listings again with accountId, requestId, outRoomCategoryIds and confirm=true. Never confirm in the same turn as this preview.',
        ...lines,
      ].join('\n')
    );
  }

  if (!requestIdArg) {
    throw new MCPError(ErrorCode.MISSING_PARAMS, 'requestId from the preview pull is required to import');
  }
  const imported = await hudsonPost<{ successRoomCategoryNum?: number; poiName?: string }>(
    context,
    '/quickOnline/import',
    { campId, requestId: requestIdArg, outRoomCategoryIds },
    'import Airbnb listings'
  );
  return textResult(
    `Import accepted. poi=${imported.poiName || '-'} listings=${imported.successRoomCategoryNum ?? outRoomCategoryIds.length}. Calendar sync may take a few minutes.`
  );
}

function wrap(
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
): ToolDefinition['handler'] {
  return async (args, context) => {
    try {
      return await handler(args, context);
    } catch (error) {
      return handleToolError(error, context);
    }
  };
}

export function getHandshakeToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'start_handshake',
      description:
        'Start Airbnb OAuth for a signed-in LocalsBnb host. Tries once to open the system browser; if that fails, returns a URL for the human to open manually. The browser page (phone or desktop) retains login and lets them finish authorization plus listing import/mapping. They only reply 已完成/done; then call poll_handshake with no arguments. Do not put tokens in chat. Google is not supported yet.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['airbnb_oauth'],
            description: 'Only airbnb_oauth in this version',
          },
        },
        required: [],
      },
      handler: wrap(startHandshakeHandler),
    },
    {
      name: 'poll_handshake',
      description:
        'When the user says 已完成/done after Airbnb browser onboarding, call with no arguments. Resolve the current session internally and compare POI/room mappings. A new account or sync timestamp alone is not success. Keep pending until linkage is verified; do not re-import after browser completion.',
      inputSchema: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'ticketId returned by start_handshake' },
        },
        required: [],
      },
      handler: wrap(pollHandshakeHandler),
    },
    {
      name: 'list_channel_accounts',
      description: 'List Airbnb channel accounts already linked to this property.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: wrap(listChannelAccountsHandler),
    },
    {
      name: 'import_airbnb_listings',
      description:
        'Preview or import Airbnb listings after OAuth. First call with accountId only. Then confirm=true with requestId and outRoomCategoryIds chosen by the human. Never confirm on the first preview.',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Airbnb accountId from poll_handshake or list_channel_accounts' },
          requestId: { type: 'string', description: 'From the preview pull' },
          outRoomCategoryIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Listing ids to import',
          },
          confirm: {
            type: 'boolean',
            description: 'Execute import only after the human picked listings. Omit to preview.',
          },
        },
        required: ['accountId'],
      },
      handler: wrap(importAirbnbListingsHandler),
    },
  ];
}
