CREATE TABLE IF NOT EXISTS mcp_auth.work_items (
 id uuid PRIMARY KEY,
 owner_hash text NOT NULL,
 kind text NOT NULL,
 dedup text NOT NULL,
 payload text NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 version integer NOT NULL DEFAULT 0,
 expires_at timestamptz NOT NULL,
 create_time timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 time_version timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(owner_hash,kind,dedup)
);
CREATE INDEX IF NOT EXISTS mcp_work_expiry_idx ON mcp_auth.work_items(expires_at);

COMMENT ON TABLE mcp_auth.work_items IS '远程 MCP 加密工作项、去重状态与过期控制';
COMMENT ON COLUMN mcp_auth.work_items.id IS '工作项 UUID，由应用生成';
COMMENT ON COLUMN mcp_auth.work_items.owner_hash IS '工作项所属主体的哈希标识';
COMMENT ON COLUMN mcp_auth.work_items.kind IS '工作项类型';
COMMENT ON COLUMN mcp_auth.work_items.dedup IS '同一主体和类型下的去重键';
COMMENT ON COLUMN mcp_auth.work_items.payload IS '加密后的工作项数据';
COMMENT ON COLUMN mcp_auth.work_items.status IS '工作项状态，写操作 running 或 unknown 时须保留';
COMMENT ON COLUMN mcp_auth.work_items.version IS '整数乐观锁版本，每次状态更新递增';
COMMENT ON COLUMN mcp_auth.work_items.expires_at IS '工作项过期时间';
COMMENT ON COLUMN mcp_auth.work_items.create_time IS '记录创建时间';
COMMENT ON COLUMN mcp_auth.work_items.time_version IS '最近状态变更时间，不替代整数乐观锁版本';
