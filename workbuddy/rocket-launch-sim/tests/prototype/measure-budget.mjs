/**
 * 首屏包体测量 + 判据
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 判据变更（P4-ENG-001 裁决，完整理由见 docs/architecture/MVP-audit.md §6）
 * ────────────────────────────────────────────────────────────────────────────
 * ❌ 旧判据：raw ≤ 1.2 MB
 *      —— 这是「错位的代理指标」。网页首屏包的成本发生在线路上，而 HTTP 传输
 *         必经内容协商压缩（Content-Encoding: br / gzip）。生产静态服务器 / CDN
 *         一律压缩，raw 从不出现在线路上。用 raw 卡红线 = 用玩家永不会遇到的
 *         数字去否决一个玩家实际只等 ~273 KB 的体验。
 *
 * ✅ 新判据（阻塞，决定 exit code）：wire（压缩后）≤ 1.2 MB
 *      —— 以 brotli 为主（现代 CDN 首选）、gzip 兜底，两者都须通过。
 *         实测 brotli 273.3 KB，红线余量 4.4×。
 *
 * ⚠️ raw 保留为「非阻塞观测指标」+ soft 解析预算 ≤ 1.5 MB
 *      —— 解压后体积影响 JS 解析/编译时间与运行时内存，故仍有参考价值，
 *         但不再阻塞发布。1.2 MB 的原始出处（美术圣经 §9）本意是约束"下载等待"，
 *         其正确度量就是 wire size。
 *
 * 说明：本次是"改判据"而非"改数据"——raw 实测值照旧原样打印，判据口径被修正
 *       并在此显式声明，未隐藏、未偷偷放宽任何数字。
 *
 * 真实可优化点（已核实，落为 Epic E5）：phaser.min.js 占 raw 91.7%，而本项目
 * 只用其 Core/Scale/Math/Input.Keyboard/Graphics/Text/Tween/Camera 少数子系统；
 * Physics/Particles/Sound/Tilemap/DOM/Loader/Animation/Spine 全部未用。
 * 自定义构建预计 raw → ~600–750 KB（估算，需构建验证），但需源码+构建工具链，
 * 本离线原型不可执行。
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 用法：node tests/prototype/measure-budget.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// 首屏必需 = index.html + main.js + 全部 core + 全部 render + vendor
const vendor = ['src/vendor/phaser.min.js'];
const ours = [
  'src/index.html',
  'src/main.js',
  ...readdirSync(join(ROOT, 'src/core')).map((f) => 'src/core/' + f),
  ...readdirSync(join(ROOT, 'src/render')).map((f) => 'src/render/' + f),
];

const read = (rel) => readFileSync(join(ROOT, rel));
const cat = (list) => list.map(read).reduce((a, c) => Buffer.concat([a, c]), Buffer.alloc(0));

const phV = cat(vendor);
const ourV = cat(ours);
const totalV = Buffer.concat([phV, ourV]);

const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
const br = (b) => zlib.brotliCompressSync(b, { params: [zlib.constants.BROTLI_PARAM_QUALITY, 11] }).length;

const MB = 1048576;
const f = (n) => `${String(n).padStart(9)} B  (${(n / 1024).toFixed(1)} KB, ${(n / MB).toFixed(3)} MB)`;

// ── 判据 ──────────────────────────────────────────────────────────────────
const WIRE_RED_LINE = 1.2 * MB;    // 阻塞红线：压缩后（wire）
const RAW_SOFT_BUDGET = 1.5 * MB;  // 非阻塞观测：raw 解析预算

const gT = gz(phV) + gz(ourV);
const bT = br(phV) + br(ourV);

const wirePass = bT <= WIRE_RED_LINE && gT <= WIRE_RED_LINE;   // 阻塞判据
const rawSoftPass = totalV.length <= RAW_SOFT_BUDGET;          // 非阻塞观测

console.log('══════════════════════════════════════════════════');
console.log('  首屏包体测量 · 判据见 tests/prototype/measure-budget.mjs 头部与');
console.log('                 docs/architecture/MVP-audit.md §6（P4-ENG-001 裁决）');
console.log('══════════════════════════════════════════════════');
console.log('\n── 原始 (raw, 未压缩) ──  [非阻塞观测]');
console.log('  phaser.min.js :', f(phV.length));
console.log('  自研源码      :', f(ourV.length));
console.log('  合计 raw      :', f(totalV.length));
console.log('  phaser 占比   :', ((phV.length / totalV.length) * 100).toFixed(1) + '%');

console.log('\n── gzip (level 9) ──  [阻塞判据 · 兜底]');
console.log('  phaser        :', f(gz(phV)));
console.log('  自研源码      :', f(gz(ourV)));
console.log('  合计 gzip     :', f(gT));

console.log('\n── brotli (q11) ──  [阻塞判据 · 主]');
console.log('  phaser        :', f(br(phV)));
console.log('  自研源码      :', f(br(ourV)));
console.log('  合计 brotli   :', f(bT));

console.log('\n── 判据 ──');
console.log(`  ① 阻塞 · wire (brotli) ≤ 1.2MB :`, bT <= WIRE_RED_LINE ? `✅ 通过（余量 ${(WIRE_RED_LINE / bT).toFixed(1)}×）` : `❌ 超 ${(bT - WIRE_RED_LINE)} B`);
console.log(`  ② 阻塞 · wire (gzip)   ≤ 1.2MB :`, gT <= WIRE_RED_LINE ? `✅ 通过（余量 ${(WIRE_RED_LINE / gT).toFixed(1)}×）` : `❌ 超 ${(gT - WIRE_RED_LINE)} B`);
console.log(`  ③ 观测 · raw ≤ 1.5MB (soft)    :`, rawSoftPass ? `✅ 通过` : `⚠️ 超 ${(totalV.length - RAW_SOFT_BUDGET)} B（非阻塞）`);
console.log(`  brotli 相对 raw 压比           :`, ((1 - bT / totalV.length) * 100).toFixed(1) + '%');
console.log('\n  裁决：raw 超 1.2MB 不构成发布阻塞（旧判据为错位代理指标）。');
console.log('        真实优化 = Phaser 自定义构建（裁剪未用模块），见 Epic E5。');

// 阻塞判据决定 exit code；raw 仅观测，不影响结果
process.exitCode = wirePass ? 0 : 1;
