/**
 * 发布/构建前清理 dist，避免旧产物（含误生成的 logs）被打进 npm 包。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true, force: true });
  console.log('[clean-dist] removed dist/');
} else {
  console.log('[clean-dist] dist/ already absent');
}
