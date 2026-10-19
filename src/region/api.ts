import type { ToolContext } from '../types/mcp.js';
import { assertApiSuccess, type PermissionFriendlyDomain } from '../utils/errorHandler.js';

export interface HudsonEnvelope<T> {
  success?: boolean;
  errorCode?: string;
  errorMsg?: string;
  errorDetail?: string;
  data?: T;
}

export function requireCampId(context: ToolContext): string {
  const campId = context.campId;
  if (!campId) {
    throw new Error('APP_ID not configured. Please set APP_ID environment variable.');
  }
  return String(campId);
}

export async function hudsonPost<T>(
  context: ToolContext,
  url: string,
  data: unknown,
  actionLabel: string,
  permissionDomain?: PermissionFriendlyDomain
): Promise<T> {
  const response = await context.apiClient.request<HudsonEnvelope<T>>({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json' },
    data,
  });
  assertApiSuccess(response, actionLabel, permissionDomain);
  return response.data as T;
}

export function extractPage<T>(data: unknown): { list: T[]; total: number } {
  if (!data || typeof data !== 'object') return { list: [], total: 0 };
  const rec = data as Record<string, unknown>;
  const raw = rec.records ?? rec.list ?? rec.rows ?? [];
  const list = Array.isArray(raw) ? (raw as T[]) : [];
  const total = Number(rec.total ?? list.length) || 0;
  return { list, total };
}

export function toIdList(value: unknown): Array<string | number> {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'number' ? v : String(v)));
  if (value == null || value === '') return [];
  return [typeof value === 'number' ? value : String(value)];
}
