#!/usr/bin/env node
// 只创建当前项目独立的本地测试存储，不修改 Docker 全局配置。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'deployment/remote/.env.local');
if (!fs.existsSync(file)) {
  fs.writeFileSync(file, `MCP_LOCAL_DB_PASSWORD=${crypto.randomBytes(24).toString('hex')}\nMCP_LOCAL_REDIS_PASSWORD=${crypto.randomBytes(24).toString('hex')}\n`, {mode:0o600,flag:'wx'});
}
fs.chmodSync(file, 0o600);
const env = {...process.env};
if (process.platform === 'darwin') env.PATH = `/Applications/Docker.app/Contents/Resources/bin:${env.PATH || ''}`;
const args = ['compose','--project-name','localsbnb-mcp-local','--env-file',file,'-f',path.join(root,'deployment/remote/compose.yaml'),'up','-d','--wait','--wait-timeout','90'];
const result = spawnSync('docker',args,{cwd:root,env,stdio:'inherit'});
if (result.error) console.error('Could not start local storage. Start Docker Desktop and retry.');
process.exitCode = result.status ?? 1;
