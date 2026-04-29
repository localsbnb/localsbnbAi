/**
 * 对 dist 目录下所有 .js / .mjs 进行混淆，用于生产打包（不修改文件名与导入路径）
 */
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: false,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: [],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 0,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 2,
  stringArrayWrappersType: 'variable',
  stringArrayMaxLength: 100,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  reservedNames: ['^main$', '^require$', '^exports$', '^module$', '^__dirname$', '^__filename$'],
  reservedStrings: [],
};

function walkDir(dir, extList, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walkDir(full, extList, fileList);
    } else if (extList.some((ext) => file.endsWith(ext))) {
      fileList.push(full);
    }
  }
  return fileList;
}

function run() {
  const files = walkDir(DIST, ['.js', '.mjs']);
  console.log('[obfuscate] Processing %d files in dist/', files.length);
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    try {
      const result = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions);
      fs.writeFileSync(file, result.getObfuscatedCode(), 'utf8');
      console.log('[obfuscate] %s', path.relative(DIST, file));
    } catch (err) {
      console.error('[obfuscate] Error:', file, err.message);
      process.exitCode = 1;
    }
  }
  console.log('[obfuscate] Done.');
}

run();
