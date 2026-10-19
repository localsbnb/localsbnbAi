import { randomUUID } from 'node:crypto';
import { WorkStore, hash } from './workStore.js';
import { PostgresGrantStore } from '../oauth/postgresGrantStore.js';
export const CHANNEL_TARGETS = {
  airbnb: '/linkairbnb',
  booking: '/linkbooking',
  trip: '/linktrip',
  agoda: '/linkagoda',
} as const;
export type RemoteChannel = keyof typeof CHANNEL_TARGETS;
export class RemoteHandshake {
  constructor(
    private readonly store: WorkStore,
    private readonly grants: PostgresGrantStore,
    private readonly siteOrigin: string,
    private readonly resource: string,
    private readonly environment: 'dev' | 'prod'
  ) {}
  private owner(): string {
    return hash('handshake:' + this.resource);
  }
  async create(
    grantId: string,
    clientId: string,
    campId: string,
    channel: RemoteChannel,
    sourceGrantId = grantId
  ): Promise<{ openUrl: string; expiresAt: Date }> {
    if (!Object.hasOwn(CHANNEL_TARGETS, channel)) throw new Error('Invalid channel');
    const work = await this.store.create(
      this.owner(),
      'handshake',
      randomUUID(),
      { grantId, sourceGrantId, clientId, campId, channel },
      120
    );
    return { openUrl: `${this.siteOrigin}/ai/connect/${work.id}`, expiresAt: work.expiresAt };
  }
  async redeem(
    ticket: string
  ): Promise<{
    campId: string;
    token: string;
    target: string;
    channel: RemoteChannel;
    environment: 'dev' | 'prod';
  }> {
    const work = await this.store.get<{
      grantId: string;
      sourceGrantId: string;
      clientId: string;
      campId: string;
      channel: RemoteChannel;
    }>(this.owner(), ticket, 'handshake');
    if (!work || work.status !== 'pending') throw new Error('Ticket unavailable');
    const grant = await this.grants.readActive(
      work.data.grantId,
      work.data.clientId,
      this.resource
    );
    const source = await this.grants.readActive(
      work.data.sourceGrantId,
      work.data.clientId,
      this.resource
    );
    if (
      !source ||
      !grant ||
      source.subjectId !== grant.subjectId ||
      grant.campId !== work.data.campId ||
      !Object.hasOwn(CHANNEL_TARGETS, work.data.channel)
    )
      throw new Error('Ticket unavailable');
    if (!(await this.store.replace(work, work.data, 'consumed')))
      throw new Error('Ticket unavailable');
    return {
      campId: grant.campId,
      token: grant.hudsonCredential,
      target: CHANNEL_TARGETS[work.data.channel],
      channel: work.data.channel,
      environment: this.environment,
    };
  }
}
