export type PostgresFailure =
  | 'auth'
  | 'tls_unsupported'
  | 'tls_certificate'
  | 'tls'
  | 'database_missing'
  | 'schema_missing'
  | 'table_missing'
  | 'privilege'
  | 'dns'
  | 'timeout'
  | 'refused'
  | 'network'
  | 'unknown';

/** Return only a fixed category; PostgreSQL messages may contain endpoints or credentials. */
export function classifyPostgresFailure(error: unknown): PostgresFailure {
  const value = error && typeof error === 'object' ? error : {};
  const code = 'code' in value && typeof value.code === 'string' ? value.code : '';
  const message = 'message' in value && typeof value.message === 'string' ? value.message : '';
  if (code === '28P01' || /password authentication failed/i.test(message)) return 'auth';
  if (code === '3D000') return 'database_missing';
  if (code === '3F000') return 'schema_missing';
  if (code === '42P01') return 'table_missing';
  if (code === '42501' || /no pg_hba\.conf entry/i.test(message)) return 'privilege';
  if (/does not support SSL|SSL is not enabled/i.test(message)) return 'tls_unsupported';
  if (/CERT|certificate|self.signed|unable to verify/i.test(`${code} ${message}`)) return 'tls_certificate';
  if (/SSL|TLS|EPROTO/i.test(`${code} ${message}`)) return 'tls';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code === 'ETIMEDOUT' || /timeout/i.test(message)) return 'timeout';
  if (code === 'ECONNREFUSED') return 'refused';
  if (/ECONNRESET|EHOSTUNREACH|ENETUNREACH|08001|08006/.test(code)) return 'network';
  return 'unknown';
}
