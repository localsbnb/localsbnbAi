#!/usr/bin/env node
/**
 * CommonJS launcher: spawn the ESM entry start.mjs as a child process (for Cursor and similar hosts).
 * NODE_OPTIONS is stripped in the child so flags like --require do not force ESM to load as CJS.
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
