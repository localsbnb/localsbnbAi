import type { ToolContext, ToolResult } from '../../types/mcp.js';
import { channelData } from '../../tools/overseas/channels.js';
import {
  snapshot,
  fingerprint,
  ready,
  type PoiSnapshot,
} from '../../tools/overseas/channelConnectionSnapshot.js';
import { WorkStore } from './workStore.js';
import { RemoteHandshake, CHANNEL_TARGETS, type RemoteChannel } from './handshake.js';
const channelIds = { airbnb: '1', booking: '9', trip: '113', agoda: '10' };
interface Flow {
  channel: RemoteChannel;
  baseline: PoiSnapshot[];
  completed?: PoiSnapshot[];
}
const result = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});
export class ChannelFlows {
  constructor(
    private readonly store: WorkStore,
    private readonly handshake: RemoteHandshake
  ) {}
  async start(
    owner: string,
    channel: RemoteChannel,
    ctx: ToolContext,
    grantId: string,
    clientId: string,
    sourceGrantId = grantId
  ): Promise<ToolResult> {
    if (!Object.hasOwn(CHANNEL_TARGETS, channel)) throw new Error('Unknown channel');
    // 快照在开链前完成；同一会话只维护一条活跃流程。
    const baseline = snapshot(await channelData(ctx, channelIds[channel]));
    let work = await this.store.create<Flow>(
      owner,
      'channel',
      'active',
      { channel, baseline },
      3600
    );
    if (work.status === 'succeeded') {
      if (!(await this.store.replace(work, { channel, baseline }, 'pending', 3600)))
        throw new Error('Channel flow changed');
      work = { ...work, data: { channel, baseline }, status: 'pending', version: work.version + 1 };
    }
    const link = await this.handshake.create(
      grantId,
      clientId,
      ctx.campId!,
      work.data.channel,
      sourceGrantId
    );
    return result({
      status: 'awaiting_user',
      channel: work.data.channel,
      flowId: work.id,
      ...link,
      message: '打开链接，在网页完成关联后回到对话，只需回复“已完成”。',
      next: 'Keep sessionId. On done call complete_channel_connection with this sessionId; do not ask the user for IDs. Reopening preserves the original baseline.',
    });
  }
  async complete(owner: string, ctx: ToolContext): Promise<ToolResult> {
    // 不创建空流程；按固定 dedup 查询只读记录。
    const work = await this.store.find<Flow>(owner, 'channel', 'active');
    if (!work)
      return result({ status: 'no_active_flow', message: '没有有效关联流程，请先发起渠道连接。' });
    if (work.status === 'succeeded')
      return result({
        status: 'succeeded',
        channel: work.data.channel,
        properties: work.data.completed,
      });
    const current = snapshot(await channelData(ctx, channelIds[work.data.channel]));
    const old = new Map(work.data.baseline.map((p) => [p.poiId, p]));
    const changed = current.filter(
      (p) => !old.has(p.poiId) || fingerprint(p) !== fingerprint(old.get(p.poiId)!)
    );
    const failed = changed.some((p) => p.rooms.some((r) => r.status === 4 || !!r.error));
    const done =
      changed.length > 0 &&
      !failed &&
      changed.every((p) => ready(p, work.data.channel !== 'airbnb'));
    if (done) {
      if (!(await this.store.replace(work, { ...work.data, completed: changed }, 'succeeded')))
        throw new Error('Flow changed');
    }
    return result({
      status: done ? 'succeeded' : failed ? 'needs_action' : 'pending',
      channel: work.data.channel,
      properties: changed,
      message: done
        ? '已核对门店/房型关联变化，完成。'
        : failed
          ? '检测到关联异常，请在网页处理后回复“已完成”。'
          : '尚未检测到完整关联变化，稍后回复“已完成”继续核对。',
      next: 'Never treat account-only changes as completion. Preserve the baseline and do not submit imports again.',
    });
  }
}
