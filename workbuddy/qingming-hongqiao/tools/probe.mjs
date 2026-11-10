// 汴河虹桥 · 静态探针（三层验证的第二层）
// 原则：按锚点把 index.html 里的产品代码原样切出来，放进 Node vm 里执行并断言。
// 不重写任何一份被测函数（测复制品 = 白测）。THREE 只做最小替身，被测逻辑仍是产品代码。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const module = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!module) { console.error('FAIL: module script not found'); process.exit(1); }
const SRC = module[1];

const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/* ---------------------------------------------------------------- 源码切片 */
function between(a, b) {
  const i = SRC.indexOf(a), j = SRC.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error('slice anchor missing: ' + a.slice(0, 40));
  return SRC.slice(i, j);
}
// 按花括号配平切函数；逐行先剔掉 // 注释，避免注释里的括号干扰计数
function sliceFn(sig) {
  const start = SRC.indexOf(sig);
  if (start < 0) throw new Error('fn missing: ' + sig);
  let depth = 0, i = start;
  for (; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error('fn unbalanced: ' + sig);
}

const CODE = [
  between('const clamp =', '/* 色调：绢本设色'),                                  // 工具函数
  between('const BANK_X = 18;', 'function buildBanks()'),                        // 桥几何常量 + 纯函数
  between('const CHAPTERS=[', 'CHAPTERS.forEach'),                                  // 全卷六段
  between('const TOUR_KEYS=[', 'const TOUR={'),                                   // 运镜关键帧
  sliceFn('function fovAt('),                                                     // FOV 插值
  sliceFn('function pushTriDir('),                                                // 三角面法线
  sliceFn('function hullGeo('),                                                   // 船体放样
  between('  const ridgeAt=', '  for(let layer=2;'),                             // 远山轮廓（产品代码）
].join('\n');

// vm 里 const/let 是词法绑定、不会挂到 sandbox 上；末尾加一句「导出绑定」把
// 产品代码的真实引用暴露给断言（被测函数本身仍是原样执行，没有任何副本）
const EXPORT = `
Object.assign(globalThis, {
  clamp, lerp, smoothstep, easeInOut, rnd,
  BANK_X, BANK_Y, DECK_HALF, DECK_RISE, deckY, archY, walkY,
  CHAPTERS, TOUR_KEYS, TOUR_DUR, fovAt,
  pushTriDir, hullGeo, ridgeAt
});`;

/* ---------------------------------------------------------------- THREE 最小替身 */
class Color {
  constructor(hex) {
    const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : 0xffffff;
    this.r = ((n >> 16) & 255) / 255; this.g = ((n >> 8) & 255) / 255; this.b = (n & 255) / 255;
  }
  clone() { const c = new Color(); c.r = this.r; c.g = this.g; c.b = this.b; return c; }
  lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
}
class Float32BufferAttribute {
  constructor(arr, n) { this.array = Float32Array.from(arr); this.itemSize = n; this.count = arr.length / n; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(n, a) { this.attributes[n] = a; }
}
const sandbox = {
  Math, Number, Array, Float32Array, Object, console,
  THREE: { Color, Float32BufferAttribute, BufferGeometry },
  H: 512, amp: 160, base: 212, seedv: 1.7,
};
vm.createContext(sandbox);
vm.runInContext(CODE + '\n' + EXPORT, sandbox);

/* ---------------------------------------------------------------- 1 桥几何 */
const S = sandbox;
check('结构常量与原文一致', S.BANK_X === 18 && S.DECK_HALF === 18 && S.BANK_Y === 1.9 && S.DECK_RISE === 5.4,
  `BANK_X=${S.BANK_X} HALF=${S.DECK_HALF} Y=${S.BANK_Y} RISE=${S.DECK_RISE}`);
check('桥面顶点 7.3 m / 两端落回岸面 1.9 m', near(S.deckY(0), 7.3) && near(S.deckY(18), 1.9) && near(S.deckY(-18), 1.9),
  `deckY(0)=${S.deckY(0).toFixed(2)} deckY(18)=${S.deckY(18).toFixed(2)}`);
check('桥面左右对称', [-13, -7, 0, 7, 13].every(x => near(S.deckY(x), S.deckY(-x), 1e-9)));
check('桥腹净空 ≈5.95 m（史载离水面 5.5–6 m）', near(S.archY(0), 5.95) && S.archY(0) > 5.5 && S.archY(0) < 6.1,
  `archY(0)=${S.archY(0).toFixed(2)}`);
check('引道连续：|x|>18 后桥面高度=街面', near(S.walkY(25), S.BANK_Y) && near(S.walkY(-25), S.BANK_Y));

/* ---------------------------------------------------------------- 2 放桅与净空 */
const lower = S.smoothstep(56, 14, 2);        // 近桥
const far = S.smoothstep(56, 14, 48);         // 远桥
check('反向 smoothstep 放桅曲线单调', lower > 0.99 && far < 0.1, `近=${lower.toFixed(3)} 远=${far.toFixed(3)}`);
const mastTip = 0.62 + 12.6 * Math.cos(1.26);      // 放倒后的桅顶高度（产品代码里的常量）
check('放倒桅顶低于桥腹净空', mastTip < S.archY(0), `桅顶 ${mastTip.toFixed(2)} m < 净空 ${S.archY(0).toFixed(2)} m`);
check('easeInOut 端点与中点', S.easeInOut(0) === 0 && S.easeInOut(1) === 1 && near(S.easeInOut(0.5), 0.5));

/* ---------------------------------------------------------------- 3 船体放样（回归 NaN） */
const hull = S.hullGeo(17.4, 4.65, 1.55);
const pos = hull.geo.attributes.position.array;
let nan = 0, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity, maxX = 0;
for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) nan++;
for (let i = 0; i < pos.length; i += 3) {
  minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
  minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
  maxX = Math.max(maxX, Math.abs(pos[i]));
}
check('船体顶点零 NaN / 零 Infinity', nan === 0, `vertices=${pos.length / 3}`);
check('放样站数 25 × 每站 15 点', hull.st.length === 25 && hull.st[0].length === 15,
  `${hull.st.length} 站 × ${hull.st[0].length} 点`);
check('船长 17.4 m / 型宽 4.65 m', near(maxZ - minZ, 17.4, 1e-4) && near(maxX * 2, 4.65, 0.02),
  `L=${(maxZ - minZ).toFixed(2)} B=${(maxX * 2).toFixed(2)}`);
check('吃水与舷高在合理区间', minY >= -1.56 && maxY <= 1.61, `y ∈ [${minY.toFixed(2)}, ${maxY.toFixed(2)}]`);
const sym = hull.st.every(row => {
  const n = row.length - 1;
  return row.every((p, k) => near(p[0], -row[n - k][0], 1e-5) && near(p[1], row[n - k][1], 1e-5));
});
check('船体左右舷严格对称', sym);

/* ---------------------------------------------------------------- 4 运镜与远山 */
check('全卷 6 段且首尾相接', S.CHAPTERS.length === 6 &&
  S.CHAPTERS.slice(0,5).every((c,i)=>c.z0 === S.CHAPTERS[i+1].z1),
  `${S.CHAPTERS.length} 段，z ${S.CHAPTERS[0].z1} → ${S.CHAPTERS[5].z0}`);
check('长卷总跨度 1100 m', S.CHAPTERS[0].z1 - S.CHAPTERS[5].z0 === 1100);
check('各段机位 / FOV 合法', S.CHAPTERS.every(c =>
  c.pos.length===3 && c.tgt.length===3 && c.fov>=30 && c.fov<=45 && c.pos[2]>c.tgt[2]));
check('六段内容与分章配置齐全',
  (html.match(/function buildCh[01345]\(/g)||[]).length === 5 &&
  /const FOG_BY_CH=\[\[[^\]]*\],[^;]*\]/.test(html) &&
  (html.match(/RIDGE_ALPHA=\[[^\]]*\]/g)||[]).length === 1);
check('五段精细度与动态系统齐全',
  /const ENRICH_CFG=\{/.test(html) && (html.match(/enrichChapter\(\d,g,b\)/g)||[]).length === 5 &&
  /if\(o\.detail\)\{/.test(html) && /檐下椽子/.test(html) &&
  ['bird','cloud','cart','boat','flag'].every(k=>html.includes("case '"+k+"':")) &&
  html.includes('updateMobiles(time, dt);'));
check('五类动态物体与转圈行人代码齐备',
  ['addFlock','addClouds','mobileCart','mobileBoat','addFlag'].every(f=>html.includes('function '+f+'(')) &&
  html.includes("axis:'circle'"));
check('六种宋式屋舍样式与自动计数齐备',
  ['pavilionGeo','towerGeo','courtyardGeo','granaryGeo','watersideGeo','gateArchGeo']
    .every(f=>html.includes('function '+f+'(')) &&
  /const STYLE_FN=\{/.test(html) && /const STYLE_XR=\{/.test(html) &&
  /let BUILDINGS=0;/.test(html) && html.split('styles:[').length-1 === 5);
check('运镜脚本长度 20.0 s / 12 帧全卷', S.TOUR_DUR === 20 && S.TOUR_KEYS.length === 12,
  `dur=${S.TOUR_DUR} keys=${S.TOUR_KEYS.length}`);
check('运镜跨越全卷首尾', Math.max(...S.TOUR_KEYS.map(k=>k.p[2])) > 400 &&
  Math.min(...S.TOUR_KEYS.map(k=>k.p[2])) < -450);
check('FOV 首末帧 = 44° / 31.5°', near(S.fovAt(0), 44) && near(S.fovAt(1), 31.5),
  `${S.fovAt(0)} → ${S.fovAt(1)}`);
check('运镜终点 = 画卷默认机位', S.TOUR_KEYS[11].p.join(',') === '5.6,10.6,57' && S.TOUR_KEYS[11].t.join(',') === '0,4.5,0.5');
let ridgeSeam = true;
for (const l of [0, 1, 2]) if (!near(S.ridgeAt(0, l), S.ridgeAt(1, l), 1e-6)) ridgeSeam = false;
check('远山整数谐波横向无缝（t=0 与 t=1 等高）', ridgeSeam);

/* ---------------------------------------------------------------- 5 交付完整性 */
const vendor = path.join(root, 'vendor', 'three.module.min.js');
check('importmap 指向本地 vendored three', /"three"\s*:\s*"\.\/vendor\/three\.module\.min\.js"/.test(html));
check('three.module.min.js 存在且为 r160 全量包', fs.existsSync(vendor) && fs.statSync(vendor).size === 670681,
  fs.existsSync(vendor) ? `${fs.statSync(vendor).size} B` : 'missing');
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
const ref = path.join(root, '..', 'lunar-rover', 'vendor', 'three.module.min.js');
check('vendor 与工作区 pin 的 r160 逐字节一致', fs.existsSync(ref) && md5(vendor) === md5(ref));
check('零 CDN / 零外部 <script src>', !/<script[^>]+src\s*=/.test(html) && !/https?:\/\/(unpkg|cdn|jsdelivr|cdnjs)/i.test(html));
check('单 module 脚本 + file:// 兜底提示', (html.match(/<script type="module">/g) || []).length === 1 && /需要以 HTTP 打开/.test(html));
const allFiles = ['README.md', 'index.html', 'tools/extract_check.mjs', 'tools/probe.mjs', 'tools/verify_e2e.mjs', 'tools/shots.mjs', 'tools/look.mjs'];
const shots = ['00-overview','01-ch0-country','02-ch1-canal','03-ch2-hongqiao','04-ch3-street','05-ch4-gate','06-ch5-city','07-tour'];
// 扫描排除本文件：探针自身必须含这些检测词字面量，否则会自匹配成假阳性
const scanFiles = allFiles.filter(f => !f.endsWith('probe.mjs'));
const joined = scanFiles.map(f => fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : '').join('\n') + html;
check('交付文件齐全', allFiles.every(f => fs.existsSync(path.join(root, f))), `${allFiles.length} 个`);
check('8 张交付截图齐全且非空', shots.every(s => {
  const f = path.join(root, 'shots', s + '.jpg');
  return fs.existsSync(f) && fs.statSync(f).size > 20000;
}), `${shots.length} 张`);
const placeholders = joined.match(/__PART\d*__|TODO|FIXME|PLACEHOLDER|待补|此处省略/gi) || [];
check('零占位符 / 零简略收尾标记', placeholders.length === 0, placeholders.slice(0, 3).join(','));
check('文本 LF 归一化', !html.includes('\r\n'));

const pass = results.filter(r => r.pass).length;
console.log(`\n=== 静态探针 ${pass}/${results.length} PASS ===`);
process.exit(pass === results.length ? 0 : 1);
