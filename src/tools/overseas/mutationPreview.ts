/** Process-local, short-lived confirmations. No secrets or guest data are persisted. */
import { createHash, randomUUID } from 'crypto';
import type { ToolContext, ToolResult } from '../../types/mcp.js';
import {
  assertApiSuccess,
  createSuccessResult,
  ErrorCode,
  MCPError,
} from '../../utils/errorHandler.js';
import { hudsonPost, profileOf, requireCampId } from '../../region/index.js';

export const PREVIEW_TTL_MS = 10 * 60_000;
type Preview = { digest: string; expiresAt: number };
const stores = new WeakMap<object, Map<string, Preview>>();
export function invalid(message: string): never {
  throw new MCPError(ErrorCode.INVALID_PARAMS, message);
}
export function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160)
    invalid(`${label} must be a non-empty string ID`);
  return value.trim();
}
export function responseId(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    invalid('API returned an unsafe numeric ID; require string IDs');
  return value == null ? '' : String(value);
}
export function integer(
  value: unknown,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    invalid(`${label} must be an integer in [${min}, ${max}]`);
  return value;
}
export function ymd(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    invalid(`${label} must be a valid YYYY-MM-DD date`);
  return value;
}
export function dateRange(from: unknown, to: unknown): { from: string; to: string; days: number } {
  const start = ymd(from, 'startDate');
  const end = ymd(to, 'endDate');
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (days < 1 || days > 91) invalid('Date range must be ordered and no longer than 91 days');
  return { from: start, to: end, days };
}
export type Row = Record<string, unknown>;
export function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
}
export function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  if (value.some((row) => !row || typeof row !== 'object' || Array.isArray(row)))
    invalid('API returned malformed resource rows');
  return value as Row[];
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = record(value);
    return `{${Object.keys(object)
      .filter((k) => object[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Revalidated payload/snapshot must match the exact preview in the same client/session/camp. */
export async function previewOrExecute(
  args: Record<string, unknown>,
  context: ToolContext,
  tool: string,
  endpoint: string,
  payload: Record<string, unknown>,
  summary: unknown,
  snapshot: unknown = summary,
  readBack?: (data: unknown) => Promise<unknown>
): Promise<ToolResult> {
  if (args.confirm !== undefined && typeof args.confirm !== 'boolean')
    invalid('confirm must be a boolean');
  const profile = profileOf(context);
  const digest = createHash('sha256')
    .update(
      canonical({
        tool,
        endpoint,
        payload,
        snapshot,
        campId: requireCampId(context),
        token: context.getHudsonAccessToken?.() || '',
        currency: profile.currency,
        timezone: profile.ianaTimeZone,
      })
    )
    .digest('hex');
  let store = stores.get(context.apiClient);
  if (!store) {
    store = new Map();
    stores.set(context.apiClient, store);
  }
  for (const [key, preview] of store) if (preview.expiresAt <= Date.now()) store.delete(key);
  if (args.confirm !== true) {
    if (store.size >= 100) store.delete(store.keys().next().value!);
    const previewId = randomUUID();
    const expiresAt = Date.now() + PREVIEW_TTL_MS;
    store.set(previewId, { digest, expiresAt });
    return createSuccessResult({
      status: 'preview',
      tool,
      previewId,
      expiresAt,
      campId: context.campId,
      currency: profile.currency,
      timezone: profile.ianaTimeZone,
      summary,
      payload,
      next: 'Show this preview to the user. Only after explicit approval, repeat the same arguments with confirm=true and previewId. A changed quote/resource requires a new preview.',
    });
  }
  const previewId = id(args.previewId, 'previewId');
  const previous = store.get(previewId);
  if (!previous || previous.digest !== digest)
    invalid('Preview missing, expired, or changed. Request a fresh preview and user confirmation.');
  // Consume before sending; failed/ambiguous writes must not be blindly replayed.
  for (const [key, preview] of store) if (preview.digest === digest) store.delete(key);
  const response = await context.apiClient.request<{
    success?: boolean;
    data?: unknown;
    errorCode?: string;
    errorMsg?: string;
  }>({
    method: 'POST',
    url: endpoint,
    data: payload,
    headers: { 'Content-Type': 'application/json' },
    retry: false,
  });
  // Use the common envelope validation without sending another request.
  assertApiSuccess(response, tool);
  if (response.success !== true || response.data === false)
    throw new MCPError(
      ErrorCode.API_ERROR,
      `${tool} was not acknowledged as successful; verify state before retrying`
    );
  let readBackResult: unknown;
  let readBackStatus = 'not_requested';
  if (readBack) {
    try {
      readBackResult = await readBack(response.data);
      readBackStatus = 'read';
    } catch {
      readBackStatus = 'failed';
    }
  }
  return createSuccessResult({
    status: 'submitted',
    tool,
    data: response.data ?? null,
    readBackStatus,
    readBack: readBackResult,
    next:
      readBackStatus === 'read'
        ? 'Compare readBack with the approved change. Channel synchronization can be asynchronous; submission alone is not final connection success.'
        : 'Write was acknowledged, but read-back is unavailable. Query the affected resources; do not repeat the mutation automatically.',
  });
}

export async function post(
  context: ToolContext,
  url: string,
  data: Record<string, unknown>
): Promise<Row> {
  const result = await hudsonPost<unknown>(
    context,
    url,
    { ...data, campId: requireCampId(context) },
    url
  );
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new MCPError(ErrorCode.API_ERROR, `${url} returned incomplete data`);
  return result as Row;
}
