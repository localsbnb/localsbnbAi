import { createHash } from 'crypto';
import type { ToolContext, ToolResult } from '../../types/mcp.js';
import { tryOpenSystemBrowser } from '../../auth/openSystemBrowser.js';
import { resolveHandshakeOrigin } from '../auth/handshake.js';
import { createSuccessResult } from '../../utils/errorHandler.js';
import { channel, channelData } from './channels.js';
import { snapshot, fingerprint, ready, type PoiSnapshot } from './channelConnectionSnapshot.js';

export const CHANNEL_FLOW_TTL_MS = 60 * 60_000;
const paths = { booking: '/linkbooking', trip: '/linktrip', agoda: '/linkagoda' } as const;
type ChannelName = keyof typeof paths;
type Flow = {
  channel: ChannelName;
  channelId: string;
  baseline: PoiSnapshot[];
  expiresAt: number;
  url: string;
  completed?: PoiSnapshot[];
};
// One pending flow per authenticated client/camp. "Done" never needs a channel or ID.
const flows = new WeakMap<object, { scope: string; flow: Flow }>();
function scope(context: ToolContext): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        context.campId,
        context.getHudsonAccessToken?.() || '',
        resolveHandshakeOrigin(),
      ])
    )
    .digest('hex');
}
function instruction(flow: Flow) {
  return `请在已打开的浏览器页面完成 ${flow.channel} 关联（手机或桌面均可），完成后回来回复“已完成”即可。若页面要求登录，请登录与当前 MCP 相同的门店。`;
}
export async function startChannelConnection(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const selected = channel(args);
  const name = args.channel as ChannelName;
  const key = scope(context);
  const previous = flows.get(context.apiClient);
  if (previous?.scope === key && previous.flow.expiresAt > Date.now() && !previous.flow.completed) {
    return createSuccessResult({
      status: 'awaiting_user',
      channel: previous.flow.channel,
      openUrl: previous.flow.url,
      message: instruction(previous.flow),
      next: 'Continue the active channel flow. Do not reset its baseline or ask the user for property IDs. On 已完成/done call complete_channel_connection without arguments.',
    });
  }
  // Capture before launching, so fast PC operations cannot be absorbed into the baseline.
  const baseline = snapshot(await channelData(context, selected.channelId));
  const url = new URL(paths[name], resolveHandshakeOrigin()).toString();
  const flow: Flow = {
    channel: name,
    channelId: selected.channelId,
    baseline,
    expiresAt: Date.now() + CHANNEL_FLOW_TTL_MS,
    url,
  };
  flows.set(context.apiClient, { scope: key, flow });
  const browser = await tryOpenSystemBrowser(url);
  return createSuccessResult({
    status: 'awaiting_user',
    channel: name,
    baselinePoiCount: baseline.length,
    expiresAt: flow.expiresAt,
    browserOpenRequested: browser.opened,
    openUrl: url,
    message: instruction(flow),
    next: 'Tell the user only to finish the browser steps (phone or desktop) and reply 已完成/done. If browser launch failed, show openUrl. Do not ask for poiId/outPoiId or invoke direct creation/mapping tools. On done call complete_channel_connection with no arguments.',
  });
}
export async function completeChannelConnection(
  _args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const entry = flows.get(context.apiClient);
  if (!entry || entry.scope !== scope(context))
    return createSuccessResult({
      status: 'no_active_flow',
      message: '没有找到当前门店的关联记录，请重新发起渠道连接。',
    });
  const flow = entry.flow;
  if (flow.completed)
    return createSuccessResult({
      status: 'succeeded',
      channel: flow.channel,
      properties: flow.completed,
      message: '已核对，渠道关联完成。',
    });
  if (flow.expiresAt <= Date.now()) {
    flows.delete(context.apiClient);
    return createSuccessResult({
      status: 'expired',
      message: '本次关联记录已过期，请重新发起。不能据此判断刚才的关联是否成功。',
    });
  }
  const current = snapshot(await channelData(context, flow.channelId));
  const old = new Map(flow.baseline.map((p) => [p.poiId, p]));
  const changed = current.filter(
    (p) => !old.has(p.poiId) || fingerprint(old.get(p.poiId)!) !== fingerprint(p)
  );
  if (!changed.length)
    return createSuccessResult({
      status: 'pending',
      channel: flow.channel,
      message: '暂未查到本次关联变化，可能仍在同步。稍后再回复“已完成”，我会继续核对。',
      next: 'Keep the original baseline; do not request IDs or recreate the property.',
    });
  const failed = changed.filter((p) => p.rooms.some((r) => r.status === 4 || !!r.error));
  if (failed.length)
    return createSuccessResult({
      status: 'needs_action',
      channel: flow.channel,
      properties: failed,
      message: '检测到关联异常，请在浏览器页面处理后，再回复“已完成”。',
    });
  if (changed.some((p) => !ready(p)))
    return createSuccessResult({
      status: 'pending',
      channel: flow.channel,
      properties: changed,
      message:
        '已检测到变化，但门店、房型或价格方案尚未全部关联完成。请在浏览器页面完成或等待同步后，再回复“已完成”。',
    });
  flow.completed = changed;
  return createSuccessResult({
    status: 'succeeded',
    channel: flow.channel,
    properties: changed,
    message: '已核对到本次渠道关联变化，门店、房型及返回的价格方案关联正常，已完成。',
    next: 'End this connection flow. Do not ask the user to supply IDs or submit another mapping.',
  });
}
