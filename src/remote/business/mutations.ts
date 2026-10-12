import type { ToolContext, ToolResult, APIClient } from '../../types/mcp.js';
import { canonical, hash, WorkStore } from './workStore.js';
const result = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});
interface Mutation {
  tool: string;
  endpoint: string;
  digest: string;
  summary: unknown;
  payload: Record<string, unknown>;
  outcome?: unknown;
}
export function persistentPreview(
  store: WorkStore,
  owner: string,
  writer: APIClient,
  checkCurrent: () => Promise<void>
): NonNullable<ToolContext['remote']>['preview'] {
  return async (input) => {
    const { args, tool, endpoint, payload, summary, snapshot, readBack } = input;
    if (args.confirm !== undefined && typeof args.confirm !== 'boolean')
      throw new Error('confirm must be boolean');
    const digest = hash(canonical({ tool, endpoint, payload, snapshot }));
    if (args.confirm !== true) {
      if (await store.hasUncertain(owner))
        return result({
          status: 'unknown',
          next: 'An earlier write is unresolved. Query its operation status and affected resources; do not submit another mutation.',
        });
      const work = await store.create<Mutation>(
        owner,
        'mutation',
        digest,
        { tool, endpoint, digest, summary, payload },
        600
      );
      return result({
        status: work.status === 'pending' ? 'preview' : work.status,
        previewId: work.id,
        expiresAt: work.expiresAt,
        summary: work.data.summary,
        payload: work.data.payload,
        outcome: work.data.outcome,
        next: 'Show exact changes. After explicit user approval repeat with confirm=true and previewId. Never retry running/unknown writes.',
      });
    }
    const work = await store.get<Mutation>(owner, String(args.previewId ?? ''), 'mutation');
    if (!work || work.data.digest !== digest)
      throw new Error('Preview missing, expired, or changed. Request a new preview.');
    if (work.status !== 'pending')
      return result({
        status: work.status,
        operationId: work.id,
        outcome: work.data.outcome,
        next: 'Do not repeat the write. Query affected resources.',
      });
    if (await store.hasUncertain(owner))
      throw new Error(
        'An earlier write is unresolved. Verify affected resources before confirming another operation.'
      );
    await checkCurrent();
    if (!(await store.replace(work, work.data, 'running', 86400)))
      throw new Error('Preview already consumed');
    const claimed = { ...work, status: 'running', version: work.version + 1 };
    let response: { success?: boolean; data?: unknown };
    try {
      response = await writer.request({
        method: 'POST',
        url: endpoint,
        data: payload,
        retry: false,
      });
    } catch {
      await store.replace(
        claimed,
        { ...work.data, outcome: { reason: 'response_unavailable' } },
        'unknown',
        86400
      );
      return result({
        status: 'unknown',
        operationId: work.id,
        next: 'Request may have committed. Query affected resources; do not retry.',
      });
    }
    if (response.success !== true || response.data === false) {
      await store.replace(
        claimed,
        { ...work.data, outcome: { reason: 'not_acknowledged' } },
        'unknown',
        86400
      );
      return result({
        status: 'unknown',
        operationId: work.id,
        next: 'Backend did not acknowledge success. Verify resources before another write.',
      });
    }
    let readBackResult: unknown;
    let readBackStatus = 'not_requested';
    if (readBack)
      try {
        readBackResult = await readBack(response.data);
        readBackStatus = 'read';
      } catch {
        readBackStatus = 'failed';
      }
    const outcome = { data: response.data ?? null, readBackStatus, readBack: readBackResult };
    await store.replace(claimed, { ...work.data, outcome }, 'submitted', 86400);
    return result({
      status: 'submitted',
      operationId: work.id,
      ...outcome,
      next: 'Submission is acknowledged. Verify the resource state; do not repeat this operation.',
    });
  };
}
