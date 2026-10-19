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
    create_time timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_version timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted smallint NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1))
);
CREATE INDEX IF NOT EXISTS mcp_grants_subject_client_idx
    ON mcp_auth.grants (subject_id, client_id);

COMMENT ON SCHEMA mcp_auth IS '远程 MCP 独立授权与工作状态，不存放 Hudson 业务表';
COMMENT ON TABLE mcp_auth.grants IS '远程 MCP 用户、客户端与门店授权记录';
COMMENT ON COLUMN mcp_auth.grants.grant_id IS '授权记录 UUID，由应用生成';
COMMENT ON COLUMN mcp_auth.grants.subject_id IS 'LocalsBnb 用户标识';
COMMENT ON COLUMN mcp_auth.grants.client_id IS 'OAuth 客户端标识';
COMMENT ON COLUMN mcp_auth.grants.camp_id IS '授权门店标识';
COMMENT ON COLUMN mcp_auth.grants.resource IS '授权对应的 MCP 资源地址';
COMMENT ON COLUMN mcp_auth.grants.scopes IS '授权权限范围';
COMMENT ON COLUMN mcp_auth.grants.credential_ciphertext IS '加密后的 Hudson 业务凭证，禁止明文记录';
COMMENT ON COLUMN mcp_auth.grants.expires_at IS '授权过期时间';
COMMENT ON COLUMN mcp_auth.grants.revoked_at IS '授权撤销时间；为空表示未撤销';
COMMENT ON COLUMN mcp_auth.grants.create_time IS '记录创建时间';
COMMENT ON COLUMN mcp_auth.grants.time_version IS '最近状态变更时间，不用于乐观锁';
COMMENT ON COLUMN mcp_auth.grants.is_deleted IS '管理性软删除标记：0 未删除，1 已删除；授权撤销使用 revoked_at';
