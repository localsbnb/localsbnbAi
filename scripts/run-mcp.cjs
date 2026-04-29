#!/usr/bin/env node
/**
 * CommonJS 启动器：在 Cursor 等环境下通过子进程启动 ESM 入口 start.mjs。
 * 子进程移除 NODE_OPTIONS，避免 --require 等导致 ESM 被当成 CJS 加载。
 */
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const entry = path.join(dir, 'start.mjs');
const env = { ...process.env };
delete env.NODE_OPTIONS;

const result = spawnSync(process.execPath, [entry], {
  stdio: 'inherit',
  cwd: dir,
  env,
});
process.exit(result.status !== null ? result.status : 1);
