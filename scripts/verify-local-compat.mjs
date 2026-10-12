/** 用现有 SDK 与构建产物执行真实 stdio 握手；不读取用户账号，不覆盖 dist。 */
import { mkdtempSync, cpSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sandbox = mkdtempSync(join(tmpdir(), 'localsbnb-stdio-compat-'));
const previousCwd = process.cwd();
try {
  const build = spawnSync(process.execPath, [join(root,'node_modules/typescript/bin/tsc'), '-p', join(root,'tsconfig.json'), '--outDir', sandbox], {cwd:root,stdio:'pipe'});
  assert.equal(build.status,0,'Compatibility build failed');
  symlinkSync(join(root,'node_modules'),join(sandbox,'node_modules'),'dir');
  writeFileSync(join(sandbox,'package.json'),JSON.stringify({type:'module'}));
  cpSync(join(sandbox,'index.js'),join(sandbox,'start.mjs'));
  cpSync(join(root,'scripts/run-mcp.cjs'),join(sandbox,'run.cjs'));
  // 证明本地入口不加载远程模块；否则这个测试构建会在启动时失败。
  rmSync(join(sandbox,'remote'),{recursive:true,force:true});
  process.chdir(sandbox);
  for(const entry of ['index.js','run.cjs']) {
    const client = new Client({name:'local-compat-check',version:'1.0.0'},{capabilities:{}});
    const transport = new StdioClientTransport({command:process.execPath,args:[join(sandbox,entry)],stderr:'ignore',env:{
      PATH:process.env.PATH ?? '', APP_ID:'',APP_SECRET:'',HUDSON_ACCESS_TOKEN:'',CAMP_ID:'',LUKEYUN_API_KEY:'',LUKEYUN_API_SCOPES:'',
      LOCALSBNB_CREDENTIALS_PATH:join(sandbox,'absent-credentials.json'),
      LUKEYUN_API_BASE_URL:'http://127.0.0.1:1',LOCALSBNB_LOG_TO_FILES:'false',
      // 本地入口无需提供远程配置，且不应读取无效的远程配置。
      LOCALSBNB_REMOTE_ENV:'invalid-for-remote',
    }});
    try {
      await client.connect(transport);
      const result=await client.listTools();
      assert.ok(result.tools.some(t=>t.name==='sign_in'));
      assert.ok(!result.tools.some(t=>t.name==='remote_connection_check'));
      console.log(`PASS local ${entry}: initialize + tools/list in bootstrap mode without remote modules or storage`);
    } finally { await client.close(); }
  }
} finally {
  process.chdir(previousCwd);
  rmSync(sandbox,{recursive:true,force:true});
}
