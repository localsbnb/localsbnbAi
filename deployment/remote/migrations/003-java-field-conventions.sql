-- 仅供已使用旧版 MCP 结构的 dev/测试库升级；由显式迁移命令以表 owner 身份执行。
-- 新库执行过 001/002 后再运行本文件也安全。生产新库使用 admin-review-prod/02。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='mcp_auth' AND table_name='grants' AND column_name='created_at') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='mcp_auth' AND table_name='grants' AND column_name='create_time') THEN
      RAISE EXCEPTION 'grants 同时存在 created_at 和 create_time，需人工核对';
    END IF;
    ALTER TABLE mcp_auth.grants RENAME COLUMN created_at TO create_time;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='mcp_auth' AND table_name='work_items' AND column_name='created_at') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='mcp_auth' AND table_name='work_items' AND column_name='create_time') THEN
      RAISE EXCEPTION 'work_items 同时存在 created_at 和 create_time，需人工核对';
    END IF;
    ALTER TABLE mcp_auth.work_items RENAME COLUMN created_at TO create_time;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='mcp_auth' AND table_name='work_items' AND column_name='updated_at') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='mcp_auth' AND table_name='work_items' AND column_name='time_version') THEN
      RAISE EXCEPTION 'work_items 同时存在 updated_at 和 time_version，需人工核对';
    END IF;
    ALTER TABLE mcp_auth.work_items RENAME COLUMN updated_at TO time_version;
  END IF;
END $$;

ALTER TABLE mcp_auth.grants
  ADD COLUMN IF NOT EXISTS time_version timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS is_deleted smallint NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1));

-- 老库补齐中文备注；新库重复执行 COMMENT 不改变数据。
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
