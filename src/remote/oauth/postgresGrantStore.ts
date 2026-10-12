import type { Client } from 'pg';
import { CredentialCipher } from './credentialCipher.js';

export interface PersistentGrant {
  grantId: string;
  subjectId: string;
  clientId: string;
  campId: string;
  resource: string;
  scopes: string[];
  expiresAt: Date;
}
function binding(g: PersistentGrant): string {
  return JSON.stringify([
    g.grantId,
    g.subjectId,
    g.clientId,
    g.campId,
    g.resource,
    g.scopes,
    g.expiresAt.toISOString(),
  ]);
}

/** 仅服务端授权完成后调用；不提供浏览器/模型自报身份的创建入口。 */
export class PostgresGrantStore {
  constructor(
    private readonly db: Pick<Client, 'query'>,
    private readonly cipher: CredentialCipher
  ) {}
  async create(grant: PersistentGrant, hudsonCredential: string): Promise<void> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(grant.grantId) ||
      !grant.subjectId ||
      !grant.clientId ||
      !grant.campId ||
      grant.campId === '0' ||
      !grant.scopes.length ||
      grant.scopes.some((s) => !s) ||
      !Number.isFinite(grant.expiresAt.getTime()) ||
      grant.expiresAt.getTime() <= Date.now()
    ) {
      throw new Error('Invalid approved grant');
    }
    const resource = new URL(grant.resource);
    if (
      resource.protocol !== 'https:' ||
      resource.username ||
      resource.password ||
      resource.hash ||
      resource.search
    )
      throw new Error('Invalid grant resource');
    const ciphertext = this.cipher.seal(hudsonCredential, binding(grant));
    await this.db.query(
      `INSERT INTO mcp_auth.grants
      (grant_id,subject_id,client_id,camp_id,resource,scopes,credential_ciphertext,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        grant.grantId,
        grant.subjectId,
        grant.clientId,
        grant.campId,
        grant.resource,
        grant.scopes,
        ciphertext,
        grant.expiresAt,
      ]
    );
  }
  async readActive(
    grantId: string,
    clientId: string,
    resource: string
  ): Promise<(PersistentGrant & { hudsonCredential: string }) | null> {
    const result = await this.db.query(
      `SELECT grant_id,subject_id,client_id,camp_id,resource,scopes,expires_at,credential_ciphertext
      FROM mcp_auth.grants WHERE grant_id=$1 AND client_id=$2 AND resource=$3 AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP`,
      [grantId, clientId, resource]
    );
    const row = result.rows[0];
    if (!row) return null;
    const grant: PersistentGrant = {
      grantId: row.grant_id,
      subjectId: row.subject_id,
      clientId: row.client_id,
      campId: row.camp_id,
      resource: row.resource,
      scopes: row.scopes,
      expiresAt: row.expires_at,
    };
    return {
      ...grant,
      hudsonCredential: this.cipher.open(row.credential_ciphertext, binding(grant)),
    };
  }
  async listAuthorized(
    subjectId: string,
    clientId: string,
    resource: string
  ): Promise<Array<{ grantId: string; campId: string; scopes: string[] }>> {
    const r = await this.db.query(
      'SELECT DISTINCT ON (camp_id) grant_id,camp_id,scopes FROM mcp_auth.grants WHERE subject_id=$1 AND client_id=$2 AND resource=$3 AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP ORDER BY camp_id,created_at DESC',
      [subjectId, clientId, resource]
    );
    return r.rows.map((row) => ({
      grantId: row.grant_id,
      campId: row.camp_id,
      scopes: row.scopes,
    }));
  }
  async revoke(grantId: string, subjectId: string): Promise<void> {
    await this.db.query(
      `UPDATE mcp_auth.grants SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP)
      WHERE grant_id=$1 AND subject_id=$2`,
      [grantId, subjectId]
    );
  }
}
