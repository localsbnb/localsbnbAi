import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { CredentialCipher } from '../oauth/credentialCipher.js';
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
        .join(',') +
      '}'
    );
  return JSON.stringify(v) ?? 'null';
}
export interface Work<T = Record<string, unknown>> {
  id: string;
  owner: string;
  kind: string;
  dedup: string;
  data: T;
  status: string;
  version: number;
  expiresAt: Date;
}
export class WorkStore {
  constructor(
    private readonly db: Pick<Client, 'query'>,
    private readonly cipher: CredentialCipher
  ) {}
  private binding(id: string, owner: string, kind: string, dedup: string): string {
    return canonical([id, owner, kind, dedup]);
  }
  private decode<T>(row: Record<string, unknown>): Work<T> {
    const id = String(row.id),
      owner = String(row.owner_hash),
      kind = String(row.kind),
      dedup = String(row.dedup);
    return {
      id,
      owner,
      kind,
      dedup,
      data: JSON.parse(
        this.cipher.open(String(row.payload), this.binding(id, owner, kind, dedup))
      ) as T,
      status: String(row.status),
      version: Number(row.version),
      expiresAt: row.expires_at as Date,
    };
  }
  async create<T>(
    owner: string,
    kind: string,
    dedup: string,
    data: T,
    ttlSeconds: number
  ): Promise<Work<T>> {
    // 按唯一键清理过期记录，不删除其他用户数据。running/unknown 写操作保留阻止自动重试。
    await this.db.query(
      "DELETE FROM mcp_auth.work_items WHERE owner_hash=$1 AND kind=$2 AND dedup=$3 AND expires_at<=CURRENT_TIMESTAMP AND status NOT IN ('running','unknown')",
      [owner, kind, dedup]
    );
    const id = randomUUID();
    const payload = this.cipher.seal(JSON.stringify(data), this.binding(id, owner, kind, dedup));
    await this.db.query(
      "INSERT INTO mcp_auth.work_items(id,owner_hash,kind,dedup,payload,expires_at) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP+$6*INTERVAL '1 second') ON CONFLICT(owner_hash,kind,dedup) DO NOTHING",
      [id, owner, kind, dedup, payload, ttlSeconds]
    );
    const r = await this.db.query(
      'SELECT * FROM mcp_auth.work_items WHERE owner_hash=$1 AND kind=$2 AND dedup=$3',
      [owner, kind, dedup]
    );
    return this.decode<T>(r.rows[0]);
  }
  async get<T>(owner: string, id: string, kind: string): Promise<Work<T> | null> {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    const r = await this.db.query(
      "SELECT * FROM mcp_auth.work_items WHERE id=$1 AND owner_hash=$2 AND kind=$3 AND (expires_at>CURRENT_TIMESTAMP OR (kind='mutation' AND status IN ('running','unknown')))",
      [id, owner, kind]
    );
    return r.rows[0] ? this.decode<T>(r.rows[0]) : null;
  }
  async replace<T>(
    work: Work<T>,
    data: T,
    status = work.status,
    ttlSeconds?: number
  ): Promise<boolean> {
    const payload = this.cipher.seal(
      JSON.stringify(data),
      this.binding(work.id, work.owner, work.kind, work.dedup)
    );
    const r = await this.db.query(
      "UPDATE mcp_auth.work_items SET payload=$1,status=$2,version=version+1,updated_at=CURRENT_TIMESTAMP,expires_at=CASE WHEN $3::int IS NULL THEN expires_at ELSE CURRENT_TIMESTAMP+$3*INTERVAL '1 second' END WHERE id=$4 AND owner_hash=$5 AND version=$6 AND status=$7 AND expires_at>CURRENT_TIMESTAMP",
      [payload, status, ttlSeconds ?? null, work.id, work.owner, work.version, work.status]
    );
    return r.rowCount === 1;
  }
  async find<T>(owner: string, kind: string, dedup: string): Promise<Work<T> | null> {
    const r = await this.db.query(
      'SELECT * FROM mcp_auth.work_items WHERE owner_hash=$1 AND kind=$2 AND dedup=$3 AND expires_at>CURRENT_TIMESTAMP',
      [owner, kind, dedup]
    );
    return r.rows[0] ? this.decode<T>(r.rows[0]) : null;
  }
  async hasUncertain(owner: string): Promise<boolean> {
    const r = await this.db.query(
      "SELECT 1 FROM mcp_auth.work_items WHERE owner_hash=$1 AND kind='mutation' AND status IN ('running','unknown') LIMIT 1",
      [owner]
    );
    return !!r.rowCount;
  }
}
