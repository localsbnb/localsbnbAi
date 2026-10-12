-- MCP 独立授权记录，不创建或修改 Hudson 业务表。
CREATE SCHEMA IF NOT EXISTS mcp_auth;
CREATE TABLE IF NOT EXISTS mcp_auth.grants (
    grant_id uuid PRIMARY KEY,
    subject_id text NOT NULL CHECK (length(subject_id) > 0),
    client_id text NOT NULL CHECK (length(client_id) > 0),
    camp_id text NOT NULL CHECK (length(camp_id) > 0 AND camp_id <> '0'),
    resource text NOT NULL,
    scopes text[] NOT NULL CHECK (cardinality(scopes) > 0),
    credential_ciphertext text NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS mcp_grants_subject_client_idx
    ON mcp_auth.grants (subject_id, client_id);
