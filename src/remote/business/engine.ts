import Ajv from 'ajv';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolContext, ToolResult } from '../../types/mcp.js';
import { toolDefinitions, overseasWriteTools } from '../../config/businessTools.js';
import { getOverseasOperationTools } from '../../tools/overseas/operationTools.js';
import { CN_PROFILE, type RegionProfile } from '../../region/types.js';
import { resolveRegionProfile } from '../../region/resolve.js';
import { getOverseasToolDescription } from '../../region/toolDescriptions.js';
import { PostgresGrantStore, type PersistentGrant } from '../oauth/postgresGrantStore.js';
import { WorkStore, hash, type Work } from './workStore.js';
import { RemoteHudsonClient } from './hudsonClient.js';
import { persistentPreview } from './mutations.js';
import { ChannelFlows } from './channelFlows.js';
import type { RemoteChannel } from './handshake.js';
interface Session {
  grantId: string;
  campId: string;
  epoch: number;
}
const result = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});
const silent = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};
const listingProfile: RegionProfile = {
  ...CN_PROFILE,
  region: 'overseas',
  locale: 'en',
  localeCode: 'en',
};
const management = [
  {
    name: 'open_property_session',
    description:
      'Start an isolated property session for this conversation. Keep its sessionId for subsequent tools; never reuse another conversation session.',
    properties: { campId: { type: 'string' } },
    required: [],
  },
  {
    name: 'list_authorized_properties',
    description:
      'List properties already explicitly authorized by this user for this client. A new property requires connecting and approving it in the browser.',
    properties: {},
    required: [],
  },
  {
    name: 'switch_property',
    description:
      'Switch only this session to an already authorized property. Old previews and pending channel flows become invalid in this session.',
    properties: { sessionId: { type: 'string' }, campId: { type: 'string' } },
    required: ['sessionId', 'campId'],
  },
  {
    name: 'get_operation_status',
    description:
      'Check persisted write outcome. running/unknown means query affected resources and never retry automatically.',
    properties: { sessionId: { type: 'string' }, operationId: { type: 'string' } },
    required: ['sessionId', 'operationId'],
  },
];
export class BusinessEngine {
  private readonly ajv = new Ajv({ allErrors: false, jsonPointers: true });
  private readonly catalog: ToolDefinition[];
  constructor(
    private readonly grants: PostgresGrantStore,
    private readonly store: WorkStore,
    private readonly flows: ChannelFlows,
    private readonly hudsonOrigin: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.catalog = [
      ...toolDefinitions,
      ...overseasWriteTools(listingProfile),
      ...getOverseasOperationTools(),
    ].map((t) => {
      const properties = {
        ...(t.inputSchema.properties ?? {}),
        sessionId: { type: 'string', description: 'Use the session opened for this conversation.' },
        ...((t.requiredScopes ?? []).some((s) => s.endsWith(':write'))
          ? { previewId: { type: 'string' }, confirm: { type: 'boolean' } }
          : {}),
      };
      if (t.name === 'start_channel_connection')
        Object.assign(properties, {
          channel: { type: 'string', enum: ['airbnb', 'booking', 'trip', 'agoda'] },
        });
      return {
        ...t,
        inputSchema: {
          ...t.inputSchema,
          properties,
          required: [...new Set([...((t.inputSchema.required ?? []) as string[]), 'sessionId'])],
          additionalProperties: false,
        },
        description:
          (t.name === 'start_channel_connection'
            ? 'Connect Airbnb, Booking, Trip or Agoda. Record the baseline, return the HTTPS link, then ask the user to complete the website steps and reply only 已完成/done. Keep the original baseline when reopening.'
            : t.name === 'complete_channel_connection'
              ? 'After the user replies 已完成/done, compare the active channel baseline in this session. Call with sessionId only; never ask the user for resource IDs.'
              : (getOverseasToolDescription(t.name, 'en') ?? t.description)) +
          ' Remote state persists across requests; always use this conversation sessionId.',
      };
    });
  }
  private owner(identity: PersistentGrant): string {
    return hash(
      JSON.stringify([identity.subjectId, identity.clientId, identity.grantId, identity.resource])
    );
  }
  private scope(session: Work<Session>): string {
    return hash(
      JSON.stringify([
        session.owner,
        session.id,
        session.data.epoch,
        session.data.grantId,
        session.data.campId,
      ])
    );
  }
  list(identity: Pick<PersistentGrant, 'scopes'>): Array<Omit<ToolDefinition, 'handler'>> {
    return [
      ...management.map((m) => ({
        name: m.name,
        description: m.description,
        inputSchema: {
          type: 'object' as const,
          properties: m.properties,
          required: m.required,
          additionalProperties: false,
        },
      })),
      ...this.catalog
        .filter((t) => (t.requiredScopes ?? []).every((s) => identity.scopes.includes(s)))
        .map(({ handler: _handler, requiredScopes, ...t }) => ({
          ...t,
          requiredScopes,
          annotations: {
            readOnlyHint: !(requiredScopes ?? []).some((s) => s.endsWith(':write')),
            destructiveHint: (requiredScopes ?? []).some((s) => s.endsWith(':write')),
            openWorldHint: true,
          },
        })),
    ];
  }
  private async target(identity: PersistentGrant, campId?: string) {
    const authorized = await this.grants.listAuthorized(
      identity.subjectId,
      identity.clientId,
      identity.resource
    );
    const hit = authorized.find((g) => g.campId === (campId ?? identity.campId));
    if (!hit) throw new Error('Property not authorized. Reconnect and approve it first.');
    return hit;
  }
  async call(
    identity: PersistentGrant,
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const definition = this.list(identity).find((t) => t.name === name);
    if (!definition) throw new Error('Tool not authorized');
    if (!this.ajv.validate(definition.inputSchema as object, args))
      throw new Error('Invalid tool arguments');
    const owner = this.owner(identity);
    if (name === 'list_authorized_properties')
      return result({
        properties: await this.grants.listAuthorized(
          identity.subjectId,
          identity.clientId,
          identity.resource
        ),
        next: 'Use only these authorized properties. Connect again in the browser to authorize another property.',
      });
    if (name === 'open_property_session') {
      const selected = await this.target(identity, args.campId as string | undefined);
      const s = await this.store.create<Session>(
        owner,
        'session',
        randomUUID(),
        { grantId: selected.grantId, campId: selected.campId, epoch: 0 },
        86400
      );
      return result({
        sessionId: s.id,
        campId: s.data.campId,
        next: 'Remember sessionId only for this conversation and supply it to subsequent tools.',
      });
    }
    const session = await this.store.get<Session>(owner, String(args.sessionId), 'session');
    if (!session || session.status !== 'pending')
      throw new Error(
        'Session missing or busy. Open a fresh session if it expired; never reuse another conversation.'
      );
    // 会话级 CAS 防止切店与提交并发；崩溃时不自动解锁写入，重新开会话仍不能重用旧预览。
    if (!(await this.store.replace(session, session.data, 'busy'))) throw new Error('Session busy');
    const locked = { ...session, status: 'busy', version: session.version + 1 };
    let next = session.data;
    try {
      if (name === 'switch_property') {
        const selected = await this.target(identity, String(args.campId));
        next = {
          grantId: selected.grantId,
          campId: selected.campId,
          epoch: session.data.epoch + 1,
        };
        return result({
          sessionId: session.id,
          campId: next.campId,
          previewsInvalidated: true,
          next: 'Start fresh previews/channel flows in this property.',
        });
      }
      const scope = this.scope(session);
      if (name === 'get_operation_status') {
        const operation = await this.store.get(scope, String(args.operationId), 'mutation');
        return result(
          operation
            ? {
                operationId: operation.id,
                status: operation.status === 'running' ? 'unknown' : operation.status,
                data: operation.data,
                next: 'For unknown outcomes query affected resources; do not repeat the write.',
              }
            : { status: 'not_found' }
        );
      }
      const grant = await this.grants.readActive(
        session.data.grantId,
        identity.clientId,
        identity.resource
      );
      if (!grant || grant.subjectId !== identity.subjectId || grant.campId !== session.data.campId)
        throw new Error('Property authorization no longer valid');
      const scopes = identity.scopes.filter((s) => grant.scopes.includes(s));
      const tool = this.catalog.find((t) => t.name === name)!;
      if (!(tool.requiredScopes ?? []).every((s) => scopes.includes(s)))
        throw new Error('Property scope denied');
      const reader = new RemoteHudsonClient(
        this.hudsonOrigin,
        grant.hudsonCredential,
        grant.campId,
        this.fetcher
      );
      const writer = new RemoteHudsonClient(
        this.hudsonOrigin,
        grant.hudsonCredential,
        grant.campId,
        this.fetcher,
        true
      );
      const profile = await resolveRegionProfile(reader, grant.campId, silent);
      if (profile.region !== 'overseas')
        throw new Error('Only verified overseas properties are supported');
      // 远程写入不能依赖查询失败后的默认币种/时区。
      const settings = await reader.request<{
        success?: boolean;
        data?:
          | { systemConfigs?: Array<{ configCode: string; configValue: string }> }
          | Array<{ configCode: string; configValue: string }>;
      }>({
        method: 'POST',
        url: '/systemConfigs/get',
        data: {
          campId: grant.campId,
          systemConfigCodes: ['hudson.bnbBasic.currency', 'hudson.bnbBasic.timeZone'],
        },
      });
      const rows = Array.isArray(settings.data)
        ? settings.data
        : (settings.data?.systemConfigs ?? []);
      if (
        settings.success !== true ||
        !['hudson.bnbBasic.currency', 'hudson.bnbBasic.timeZone'].every((code) =>
          rows.some((r) => r.configCode === code && r.configValue)
        )
      )
        throw new Error('Property currency/timezone unavailable');
      if (
        rows.find((r) => r.configCode === 'hudson.bnbBasic.currency')?.configValue !==
          profile.currency ||
        rows.find((r) => r.configCode === 'hudson.bnbBasic.timeZone')?.configValue !==
          profile.hudsonTimeZone
      )
        throw new Error('Property settings changed; retry query');
      const preview = persistentPreview(this.store, scope, writer, async () => {
        const active = await this.grants.readActive(
          grant.grantId,
          identity.clientId,
          identity.resource
        );
        if (
          !active ||
          !(await this.grants.readActive(identity.grantId, identity.clientId, identity.resource))
        )
          throw new Error('Authorization revoked');
      });
      const ctx: ToolContext = {
        apiClient: reader,
        campId: grant.campId,
        regionProfile: profile,
        logger: silent,
        getHudsonAccessToken: () => grant.hudsonCredential,
        permissionChecker: {
          checkPermission: (_tool, required) => {
            if (!required.every((s) => scopes.includes(s))) throw new Error('Scope denied');
          },
        },
        remote: {
          preview: (input) =>
            preview({
              ...input,
              snapshot: {
                resource: input.snapshot,
                currency: profile.currency,
                timeZone: profile.hudsonTimeZone,
              },
            }),
        },
      };
      if (name === 'start_channel_connection')
        return await this.flows.start(
          scope,
          args.channel as RemoteChannel,
          ctx,
          grant.grantId,
          identity.clientId,
          identity.grantId
        );
      if (name === 'complete_channel_connection') return await this.flows.complete(scope, ctx);
      const { sessionId, ...businessArgs } = args;
      void sessionId;
      return await tool.handler(businessArgs, ctx);
    } finally {
      await this.store.replace(locked, next, 'pending').then((ok) => {
        if (!ok) throw new Error('Session release failed; do not repeat an uncertain write.');
      });
    }
  }
}
