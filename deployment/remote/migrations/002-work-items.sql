CREATE TABLE IF NOT EXISTS mcp_auth.work_items (
 id uuid PRIMARY KEY,
 owner_hash text NOT NULL,
 kind text NOT NULL,
 dedup text NOT NULL,
 payload text NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 version integer NOT NULL DEFAULT 0,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(owner_hash,kind,dedup)
);
CREATE INDEX IF NOT EXISTS mcp_work_expiry_idx ON mcp_auth.work_items(expires_at);
