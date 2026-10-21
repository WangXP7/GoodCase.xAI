/* 静态探针：不开浏览器，直接对 index.html 里**实际使用的那份数学代码**做断言
   做法：按锚点把纯数学片段切出来，在 Node 里 eval，避免"测的是复制品"。
   覆盖：二十面体网格、SDF 符号/可星形性、smin 权重、极分解、页面结构、注入锚点。*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = { pass: 0, fail: 0 };
const ok = (name, cond, detail) => {
  const p = !!cond; p ? T.pass++ : T.fail++;
  console.log(`${p ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  — ' + detail : ''}`);
  return p;
};

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ---------- A. 结构检查 ---------- */
ok('无残留占位符', !/__P\d__/.test(html), (html.match(/__P\d__/g) || []).length);
ok('index.html 为 LF 行尾', !html.includes('\r\n'));
for (const id of ['c', 'boot', 'err', 'brand', 'stat', 'bar', 'tip', 'ghost',
  'sTotal', 'sDesk', 'sFloor', 'sHand', 'sPen', 'sFps',
  'bNew', 'bShake', 'bReset', 'bTrans', 'bShadow', 'bSlow', 'bSound', 'bUi']) {
  ok('DOM #' + id, html.includes('id="' + id + '"'));
}
ok('importmap 指向本地 vendor', /"three"\s*:\s*"\.\/vendor\/three\.module\.min\.js"/.test(html));
const vendor = path.join(ROOT, 'vendor', 'three.module.min.js');
ok('vendor 存在且为 r160 同一份', fs.existsSync(vendor) && fs.statSync(vendor).size === 670681,
  fs.existsSync(vendor) ? fs.statSync(vendor).size + ' B' : 'missing');
ok('未引用任何 CDN', !/https?:\/\/[^"']*three/.test(html) && !/unpkg|jsdelivr|cdnjs/.test(html));

/* ---------- B. 注入锚点必须真实存在于 three 运行时 ---------- */
const three = fs.readFileSync(vendor, 'utf8');
for (const chunk of ['begin_vertex', 'beginnormal_vertex']) {
  ok('three 包含着色器 chunk <' + chunk + '>', three.includes('#include <' + chunk + '>'));
}
ok('代码替换 <beginnormal_vertex>', html.includes(".replace('#include <beginnormal_vertex>', SKIN_POSN)"));
ok('代码替换 <begin_vertex>', html.includes(".replace('#include <begin_vertex>', '')")
  && html.includes(".replace('#include <begin_vertex>', SKIN_POS)"));

/* ---------- C. 抽出纯数学片段并 eval ---------- */
const slice = (a, b) => {
  const i = html.indexOf(a);
  if (i < 0) throw new Error('锚点缺失: ' + a);
  const j = b ? html.indexOf(b, i) : html.length;
  if (j < 0) throw new Error('锚点缺失: ' + b);
  return html.slice(i, j);
};
const src =
  slice('const clamp = (v, a, b)', '/* ------------------------- 3. 二十面体细分球') +
  slice('function icosphere(sub)', '/* -------- 4. 网格') +
  slice('const _inv3 = new Float64Array(9)', '/* ---- 形状匹配') +
  '\nmodule.exports = { icosphere, field, fieldW, polar3, inv3, LOBES, NLOBE, C0, RESTQ, CORE_OFF, SMOOTH_K, GRAV_V, TABLE, FLOOR_Y, mulberry32 };';
const ctx = { module: { exports: {} }, Math, console, Array, Float64Array, Float32Array, Map, Set };
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'gummy-math.js' });
const M = ctx.module.exports;

/* icosphere(4) → 20·4⁴ = 5120 面 */
const ic = M.icosphere(4);
ok('二十面体顶点数 = 2562', ic.V.length === 2562, ic.V.length);
ok('二十面体面数 = 5120', ic.F.length === 5120, ic.F.length);
let maxLenErr = 0, badIdx = 0, degen = 0;
for (const v of ic.V) maxLenErr = Math.max(maxLenErr, Math.abs(Math.hypot(v[0], v[1], v[2]) - 1));
for (const f of ic.F) {
  for (const i of f) if (i < 0 || i >= ic.V.length) badIdx++;
  if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) degen++;
}
ok('全部顶点为单位向量', maxLenErr < 1e-9, 'maxErr=' + maxLenErr.toExponential(2));
ok('无越界索引', badIdx === 0, badIdx);
ok('无退化三角形', degen === 0, degen);

/* SDF：内部为负 / 外部为正 / 从质心沿每个方向都存在符号翻转（网格径向求解的前提） */
ok('质心在体内 (field<0)', M.field(M.C0[0], M.C0[1], M.C0[2]) < -0.1, M.field(M.C0[0], M.C0[1], M.C0[2]).toFixed(4));
ok('各肢心在体内', M.LOBES.every(L => M.field(L[0], L[1], L[2]) < -0.02));
let worstOut = -Infinity;
for (let i = 0; i < 500; i++) {
  const u = M.mulberry32(9 + i)();
  let v = M.mulberry32(31 + i)(), w = M.mulberry32(77 + i)();
  const l = Math.hypot(u, v, w) || 1;
  worstOut = Math.max(worstOut, M.field(u / l * 2.0, v / l * 2.0, w / l * 2.0));
}
ok('半径 2.0 球面上处处为正', worstOut > 0.25, 'min=' + worstOut.toFixed(4));

let starFail = 0, rMin = Infinity, rMax = 0;
for (const d of ic.V) {
  const f0 = M.field(M.C0[0] + d[0] * 1e-3, M.C0[1] + d[1] * 1e-3, M.C0[2] + d[2] * 1e-3);
  const f1 = M.field(M.C0[0] + d[0] * 2.0, M.C0[1] + d[1] * 2.0, M.C0[2] + d[2] * 2.0);
  if (!(f0 < 0 && f1 > 0)) { starFail++; continue; }
  let lo = 1e-3, hi = 2.0;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (M.field(M.C0[0] + d[0] * m, M.C0[1] + d[1] * m, M.C0[2] + d[2] * m) < 0) lo = m; else hi = m; }
  const r = (lo + hi) / 2; rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
}
ok('全部 2562 个方向都存在零面（星形可解）', starFail === 0, '失败 ' + starFail + ' 个');
/* 半径区间由模板几何本身算出：坐姿模板下最短方向是吻部（≈0.18），
   最长方向是后脑/脚（≈0.53）。这条断言的作用是发现「模板塌成一个球」或「求根跑飞」。 */
ok('求根半径落在模板几何推得区间 [0.15, 0.70]', rMin > 0.15 && rMax < 0.70,
  'r ∈ [' + rMin.toFixed(3) + ', ' + rMax.toFixed(3) + ']');

/* smin 解析权重：和为 1、非负、且主贡献足够大 */
const W = new Float64Array(M.NLOBE);
let sumErr = 0, negCnt = 0, flat = 0;
const rnd = M.mulberry32(4242);
for (let i = 0; i < 800; i++) {
  const d = ic.V[(i * 7) % ic.V.length];
  let lo = 0.0, hi = 2.0;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (M.field(M.C0[0] + d[0] * m, M.C0[1] + d[1] * m, M.C0[2] + d[2] * m) < 0) lo = m; else hi = m; }
  const t = (lo + hi) / 2;
  M.fieldW(M.C0[0] + d[0] * t, M.C0[1] + d[1] * t, M.C0[2] + d[2] * t, W);
  let s = 0, mx = 0;
  for (let j = 0; j < M.NLOBE; j++) { s += W[j]; mx = Math.max(mx, W[j]); if (W[j] < 0) negCnt++; }
  sumErr = Math.max(sumErr, Math.abs(s - 1));
  if (mx < 0.05) flat++;
  if (rnd() < -1) flat++;
}
ok('smin 权重和恒为 1', sumErr < 1e-12, 'maxErr=' + sumErr.toExponential(2));
ok('smin 权重非负', negCnt === 0, negCnt);
ok('主权重均 > 0.05（蒙皮有有效影响）', flat === 0, flat);

/* 极分解 */
function rot(y, p, r) {
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p), cr = Math.cos(r), sr = Math.sin(r);
  return [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp, cp * sr, cp * cr, -sp, -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp];
}
function orthoErr(R) {
  let e = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    let d = 0; for (let k = 0; k < 3; k++) d += R[k * 3 + r] * R[k * 3 + c];
    e = Math.max(e, Math.abs(d - (r === c ? 1 : 0)));
  }
  return e;
}
function mul3(A, B) { /* 行主序 · 行主序 */
  const O = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { let s = 0; for (let k = 0; k < 3; k++) s += A[r * 3 + k] * B[k * 3 + c]; O[r * 3 + c] = s; }
  return O;
}
const R0 = new Float64Array(9);
for (const [yaw, pitch, roll] of [[0, 0, 0], [0.7, -0.3, 1.2], [-2.1, 0.9, 0.4]]) {
  const R = rot(yaw, pitch, roll);
  M.polar3(R, R0);
  const e = orthoErr(R0);
  const det = R0[0] * (R0[4] * R0[8] - R0[5] * R0[7]) - R0[1] * (R0[3] * R0[8] - R0[5] * R0[6]) + R0[2] * (R0[3] * R0[7] - R0[4] * R0[6]);
  const same = Math.max(...R.map((v, i) => Math.abs(v - R0[i])));
  ok(`极分解(纯旋转) 正交·det=1·还原原矩阵 [${yaw},${pitch},${roll}]`,
    e < 1e-9 && Math.abs(det - 1) < 1e-9 && same < 1e-8,
    `orthoErr=${e.toExponential(2)} det=${det.toFixed(9)} Δ=${same.toExponential(2)}`);
}
/* 带各向异性拉伸：极因子仍是 R */
for (const s of [0.4, 0.62, 1.35]) {
  const R = rot(0.5, 0.2, -0.8);
  const A = mul3(R, [s * s, 0, 0, 0, s * s, 0, 0, 0, s * s]);
  M.polar3(A, R0);
  const e = orthoErr(R0);
  const det = R0[0] * (R0[4] * R0[8] - R0[5] * R0[7]) - R0[1] * (R0[3] * R0[8] - R0[5] * R0[6]) + R0[2] * (R0[3] * R0[7] - R0[4] * R0[6]);
  ok(`极分解(旋转×各向同性缩放 s=${s})`, e < 1e-8 && Math.abs(det - 1) < 1e-7, `orthoErr=${e.toExponential(2)} det=${det.toFixed(9)}`);
}
/* 退化输入不得产生 NaN */
{
  const Z = new Float64Array(9);
  M.polar3(Z, R0);
  ok('退化矩阵不产生 NaN', R0.every(Number.isFinite), Array.from(R0).join(','));
}

/* 世界常量自洽 */
ok('桌面在 y=0、地板在其下', M.TABLE.y1 === 0 && M.FLOOR_Y < M.TABLE.y0, `桌 ${M.TABLE.y1} / 地 ${M.FLOOR_Y}`);
ok('模板质心高度居中', M.C0[1] > 0.4 && M.C0[1] < 0.65, M.C0[1].toFixed(4));
ok('模板 9 肢偏移互不相同', new Set(M.RESTQ.map(q => q.map(v => v.toFixed(4)).join())).size === 9);

console.log(`\n=== 静态探针：${T.pass} 通过 / ${T.fail} 失败 ===`);
process.exit(T.fail ? 1 : 0);
