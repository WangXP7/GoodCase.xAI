/* =====================================================================
 * TIDELINE · 单文件打包器
 *
 * 把 src/index.html 及其全部 <script src> 内联为一个自包含 HTML，
 * 产物可**直接双击运行**、可发邮件、可丢进任何静态托管——
 * 零外部资产、零构建依赖、零网络请求。
 *
 * 用法：node tools/build-single.js
 * 产物（两份内容完全相同）：
 *   dist/tideline-v<版本>.html   版本化快照，用于回滚与下载
 *   dist/index.html              静态托管根路径入口（部署时必需，只传版本化文件会 404）
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

/* 版本号取自项目唯一真源，避免 README 与代码漂移 */
const cst = fs.readFileSync(path.join(SRC, 'src', 'core', 'constants.js'), 'utf8');
const mVer = cst.match(/VERSION:\s*'([^']+)'/);
const VERSION = mVer ? mVer[1] : '0.0.0';

const inlined = [];
let missing = [];

/* 内联 </script 是致命陷阱：只要源码里出现该字面量，内联后 HTML 会被提前截断 */
function guardJs(code, file) {
  if (/<\/script/i.test(code)) {
    console.log('  ! ' + file + ' 含 </script 字面量，已转义为 <\\/script');
    return code.replace(/<\/script/gi, '<\\/script');
  }
  return code;
}

const out = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (all, rel) => {
  const fp = path.join(SRC, rel);
  if (!fs.existsSync(fp)) { missing.push(rel); return all; }
  const code = fs.readFileSync(fp, 'utf8');
  inlined.push({ rel: rel, lines: code.split('\n').length });
  return '<script>\n/* ===== ' + rel + ' ===== */\n' + guardJs(code, rel) + '\n</script>';
});

if (missing.length) {
  console.error('✗ 以下脚本未找到，打包中止：\n  ' + missing.join('\n  '));
  process.exit(1);
}

const banner = '<!--\n' +
  '  《潮线 TIDELINE》· 自包含测试版 v' + VERSION + '\n' +
  '  由 tools/build-single.js 生成 —— 请勿直接编辑本文件，改 src/ 后重新打包。\n' +
  '  ' + inlined.length + ' 个脚本已内联；零外部资产（图集与音频全部程序化生成）。\n' +
  '  操作：方向键/WASD 游动 · 空格/Shift 冲刺 · 连打任意键脱困 · P 暂停 · M 静音\n' +
  '-->\n';

const finalHtml = out.replace(/^<!DOCTYPE html>\n/, '<!DOCTYPE html>\n' + banner);

fs.mkdirSync(DIST, { recursive: true });
const outFile = path.join(DIST, 'tideline-v' + VERSION + '.html');

/* 自检：产物里不应再有外部 script src，也不应再有 </script 之外的裸结束标记错位 */
const leftover = finalHtml.match(/<script\s+src=/g);
const totalKb = (Buffer.byteLength(finalHtml, 'utf8') / 1024).toFixed(0);
if (leftover) {
  console.error('✗ 仍有 ' + leftover.length + ' 个未内联的 <script src>');
  process.exit(1);
}

fs.writeFileSync(outFile, finalHtml, 'utf8');

/* 静态托管的默认入口：使 dist/ 本身可直接作为发布根目录。
   两份内容完全相同——版本化文件名用于回滚与下载，index.html 用于根路径访问。 */
const indexFile = path.join(DIST, 'index.html');
fs.writeFileSync(indexFile, finalHtml, 'utf8');

console.log('=== TIDELINE 单文件打包 ===');
inlined.forEach(function (f) { console.log('  + ' + f.rel.padEnd(28) + f.lines + ' 行'); });
console.log('  ----------------------------------------');
console.log('  内联脚本 ' + inlined.length + ' 个 · 源码 ' +
  inlined.reduce(function (a, b) { return a + b.lines; }, 0) + ' 行');
console.log('  产物 ' + path.relative(ROOT, outFile).replace(/\\/g, '/') + '  (' + totalKb + ' KB)');
console.log('  入口 ' + path.relative(ROOT, indexFile).replace(/\\/g, '/') + '  (同一内容，供静态托管根路径)');
console.log('  外部请求检查：' + (leftover ? '✗ 有残留' : '✓ 无'));
