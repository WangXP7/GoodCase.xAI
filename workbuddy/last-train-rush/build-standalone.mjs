// 打包脚本：esbuild IIFE 全内联 → 单文件 HTML（可重复运行，自建/自清影子包）
// 坑①：String.replace 替换串里 $& / $` / $' 会静默改写压缩 JS → 必须用函数替换并断言 includes
// 坑②：esbuild 不读 importmap，裸导入 'three' 需靠项目内临时影子包 node_modules/three 解析
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ESBUILD = 'C:/Users/xp772/.workbuddy/binaries/node/workspace/node_modules/esbuild/bin/esbuild';
const SHADOW = path.join(ROOT, 'node_modules');
const SHADOW_THREE = path.join(SHADOW, 'three');

// 0. 准备影子包（每次构建都重建，避免上次清理后无法再打包）
function ensureShadow() {
  mkdirSync(path.join(SHADOW_THREE, 'addons/utils'), { recursive: true });
  copyFileSync(path.join(ROOT, 'vendor/three.module.min.js'), path.join(SHADOW_THREE, 'three.module.min.js'));
  copyFileSync(
    path.join(ROOT, 'vendor/addons/utils/BufferGeometryUtils.js'),
    path.join(SHADOW_THREE, 'addons/utils/BufferGeometryUtils.js'),
  );
  writeFileSync(path.join(SHADOW_THREE, 'package.json'), JSON.stringify({
    name: 'three', version: '0.160.0', type: 'module',
    main: './three.module.min.js',
    exports: { '.': './three.module.min.js', './addons/*': './addons/*' },
  }, null, 2));
}
ensureShadow();

// 1. 打包
execFileSync(process.execPath, [
  ESBUILD,
  path.join(ROOT, 'src/main.js'),
  '--bundle', '--format=iife', '--minify',
  '--target=es2020',
  `--outfile=${path.join(ROOT, '.bundle.js')}`,
], { stdio: 'inherit' });

const js = readFileSync(path.join(ROOT, '.bundle.js'), 'utf8');
console.log('bundle size:', (js.length / 1024).toFixed(1), 'KB');

// 2. 内联进 HTML
let html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const moduleTag = '<script type="module" src="./src/main.js"></script>';
if (!html.includes(moduleTag)) throw new Error('找不到模块脚本标签');
// 函数替换：替换串里的 $& 等不会被解释
html = html.replace(moduleTag, () => `<script>\n${js}\n</script>`);

// importmap 不再需要（IIFE 无裸导入），整块移除
const imStart = html.indexOf('<script type="importmap">');
const imEnd = html.indexOf('</script>', imStart) + '</script>'.length;
if (imStart >= 0) html = html.slice(0, imStart) + html.slice(imEnd);

if (!html.includes(js.slice(0, 2000))) throw new Error('内联断言失败：bundle 未完整进入 HTML');
if (html.includes('src="./src/')) throw new Error('仍有外链脚本');

const out = path.join(ROOT, 'last-train-rush-standalone.html');
writeFileSync(out, html);
console.log('standalone:', out, (html.length / 1024).toFixed(1), 'KB');

// 3. 清理
rmSync(path.join(ROOT, '.bundle.js'), { force: true });
if (existsSync(SHADOW)) rmSync(SHADOW, { recursive: true, force: true });
console.log('cleaned shadow package');
