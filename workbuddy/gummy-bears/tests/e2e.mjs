/* 软糖熊 —— 真实浏览器端到端回归
   真实键鼠事件 + 页面内固定步长推进物理（不依赖无头环境的 rAF 节流）。
   关键断言都配了**反向对照**：把被测能力关掉后，断言必须失败，否则断言没有区分能力。*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW_MOD || 'C:/Users/wxppa/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const _pw = await import('file:///' + PW);
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const T = { pass: 0, fail: 0 };
function ok(name, cond, detail) {
  const p = !!cond; p ? T.pass++ : T.fail++;
  console.log(`${p ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && detail !== '' ? '  — ' + detail : ''}`);
  return p;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${srv.address().port}/index.html`;

const browser = await chromium.launch({
  executablePath: process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--enable-unsafe-swiftshader', '--disable-quic']
});
const pg = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errs = [];
pg.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 240)));
pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 240)); });

await pg.goto(URL, { waitUntil: 'commit' });
await pg.waitForFunction(() => window.__GB && window.__GB.ready, null, { timeout: 120000 });
await pg.waitForTimeout(900);
const ev = (fn, arg) => pg.evaluate(fn, arg);
const step = (n) => ev((k) => window.__GB.frameStep(k, 1 / 60, false), n);
await ev(() => window.__GB.pause());

/* ================= A. 启动与数值不变量 ================= */
const info = await ev(() => window.__GB.info());
ok('使用 WebGL2', info.renderer === 'WebGL2', info.renderer);
ok('程序化网格 2562 顶点 / 5120 面', info.geoVerts === 2562 && info.geoTris === 5120, `${info.geoVerts}v / ${info.geoTris}t`);
ok('无运行时报错', errs.length === 0, errs.join(' | ') || 'none');

let st = await ev(() => window.__GB.state());
ok('生成 16 只软糖熊', st.n === 16, st.n);
ok('预热后全部稳定在桌面', st.desk === 16 && st.floor === 0, `desk=${st.desk} floor=${st.floor}`);
ok('静止时几乎无穿透', st.pen < 0.02, st.pen.toFixed(5));

const pol = await ev(() => window.__GB.polarErr(0));
ok('形状匹配旋转矩阵正交且 det=1', pol.orthoErr < 1e-9 && near(pol.det, 1, 1e-9), `orthoErr=${pol.orthoErr.toExponential(2)} det=${pol.det.toFixed(9)}`);
const skin = await ev(() => window.__GB.skinErr(0));
ok('蒙皮矩阵把模板顶点精确映射到质点', skin < 1e-9, skin.toExponential(2));
const sdf = await ev(() => window.__GB.sdfSanity());
ok('隐式曲面内部为负 / 外部为正', sdf.insideMax < 0 && sdf.outsideMin > 0, `in=${sdf.insideMax.toFixed(3)} out=${sdf.outsideMin.toFixed(3)}`);
const mat = await ev(() => window.__GB.material(0));
ok('材质具备半透明与高光参数', mat.transmission >= 0 && mat.ior > 1 && mat.clearcoat > 0 && mat.envMapIntensity > 0,
  `trans=${mat.transmission} ior=${mat.ior} cc=${mat.clearcoat} env=${mat.envMapIntensity}`);

/* ================= B. 真实鼠标抓取 ================= */
const pick = await ev(() => {
  const G = window.__GB;
  for (let i = 0; i < G.state().n; i++) {
    const b = G.bearScreenBox(i);
    if (b && b.front === 9 && b.w > 40 && b.x0 > 40 && b.x1 < 1240 && b.y0 > 40 && b.y1 < 760) {
      return { i, x: b.cx, y: b.cy };
    }
  }
  return null;
});
ok('屏幕上存在可抓取的目标熊', !!pick, pick ? `bear #${pick.i} @(${pick.x | 0},${pick.y | 0})` : 'none');

const y0 = (await ev(i => window.__GB.bear(i).y, pick.i));
await pg.mouse.move(pick.x, pick.y);
await pg.mouse.down();
st = await ev(() => window.__GB.state());
ok('按下鼠标即抓住该熊', st.grabbed === pick.i, `grabbed=${st.grabbed}`);
for (let k = 1; k <= 12; k++) await pg.mouse.move(pick.x, pick.y - k * 14);
await step(30);
const y1 = (await ev(i => window.__GB.bear(i).y, pick.i));
ok('拖动可把熊举起来', y1 - y0 > 0.30, `Δy=${(y1 - y0).toFixed(3)}`);
st = await ev(() => window.__GB.state());
ok('举着时仍处于抓取状态', st.grabbed === pick.i, st.grabbed);
await pg.mouse.up();
st = await ev(() => window.__GB.state());
ok('松开鼠标即释放', st.grabbed === -1, st.grabbed);
await step(60);

/* ================= C. 堆叠 ================= */
await ev(() => { window.__GB.reset(); });
const two = await ev(() => {
  const G = window.__GB;
  const cand = [];
  for (let i = 0; i < G.state().n; i++) {
    const b = G.bearScreenBox(i);
    if (b && b.front === 9 && b.w > 40 && b.x0 > 40 && b.x1 < 1240 && b.y0 > 40 && b.y1 < 760) cand.push({ i, box: b });
  }
  if (cand.length < 2) return null;
  return { A: cand[0], B: cand[1], cB: G.centroid(cand[1].i) };
});
ok('屏幕上至少两只可交互的熊', !!two, two ? `A=#${two.A.i} B=#${two.B.i}` : 'none');

/* C1 拖拽：抓起 A 并抬到宿主熊上方（闭环调整，模拟真人拖到位） */
await pg.mouse.move(two.A.box.cx, two.A.box.cy);
await pg.mouse.down();
const gA = await ev(() => window.__GB.state().grabbed);
ok('能抓起要搬动的熊', gA === two.A.i, gA);
const want = two.cB[1] + 0.38;
let dy = -100;
for (let pass = 0; pass < 5; pass++) {
  await pg.mouse.move(two.A.box.cx, two.A.box.cy + dy);
  await step(18);
  const ay = await ev(i => window.__GB.bear(i).y, two.A.i);
  if (Math.abs(want - ay) < 0.07) break;
  dy -= (want - ay) / 0.00375;      // 屏幕纵向约 0.00375 世界单位/px
}
const lifted = await ev(i => window.__GB.bear(i).y, two.A.i);
ok('拖拽能把熊抬到宿主熊上方', lifted > two.cB[1] + 0.20, `y=${lifted.toFixed(3)} (宿主 ${two.cB[1].toFixed(3)})`);
await pg.mouse.up();
await step(80);
const dropped = await ev(i => window.__GB.bear(i).y, two.A.i);
ok('松手后熊会落回桌面而不是粘在手上', dropped < lifted, `${lifted.toFixed(3)} → ${dropped.toFixed(3)}`);

/* C2 堆叠物理：把 A 放到 B 正上方，看它能不能稳稳叠住 */
await ev(() => { window.__GB.reset(); });
await ev(() => {
  const G = window.__GB, c1 = G.centroid(1);
  G.place(0, c1[0], c1[1] + 0.62, c1[2], 0.3, 0, 0);   // 悬在宿主熊头顶上方一点点再落下
});
await step(200);
const stk = await ev(() => [window.__GB.bear(0).y, window.__GB.bear(1).y, window.__GB.gap(0, 1)]);
ok('熊能稳稳叠在另一只熊身上', stk[0] > stk[1] + 0.12, `A.y=${stk[0].toFixed(3)} B.y=${stk[1].toFixed(3)}`);
ok('叠上去的熊没有深穿插', stk[2] > -0.35, `gap=${stk[2].toFixed(3)}`);
const minGap = await ev(() => window.__GB.minGapAll());
ok('全场最小间隙正常', minGap > -0.5, `minGap=${minGap.toFixed(3)}`);

/* ================= D. 甩出 ================= */
const thrower = await ev(() => {
  const G = window.__GB;
  for (let i = 0; i < G.state().n; i++) {
    const b = G.bearScreenBox(i);
    if (b && b.front === 9 && b.w > 40 && b.x0 > 60 && b.x1 < 1220 && b.y0 > 60 && b.y1 < 740) return { i, x: b.cx, y: b.cy };
  }
  return null;
});
await pg.mouse.move(thrower.x, thrower.y);
await pg.mouse.down();
const grabbedId = await ev(() => window.__GB.state().grabbed);
ok('能抓住待甩的熊', grabbedId >= 0, grabbedId);
for (let k = 1; k <= 8; k++) await pg.mouse.move(thrower.x, thrower.y - k * 16);   // 先举到空中
await step(30);
await pg.mouse.move(thrower.x + 60, thrower.y - 120);
for (let k = 1; k <= 5; k++) await pg.mouse.move(thrower.x + 60 + k * 40, thrower.y - 120 - k * 6);
await pg.mouse.up();
const vThrow = await ev(i => window.__GB.centroidSpeed(i), grabbedId);
ok('甩手后获得明显速度', vThrow > 1.2, vThrow.toFixed(3));
const pA = await ev(i => window.__GB.centroid(i), grabbedId);
await step(60);
const pB = await ev(i => window.__GB.centroid(i), grabbedId);
const moved = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]);
ok('被甩出的熊在空中飞了一段', moved > 0.5, moved.toFixed(3));

/* ================= E. 撞到桌沿滑落 ================= */
const TABLE = await ev(() => window.__GB.constants.TABLE);
const FLOOR = await ev(() => window.__GB.constants.FLOOR_Y);
await ev(() => { window.__GB.reset(); });
await ev((tx) => { window.__GB.place(3, tx - 0.12, 0.42, 0.25, 0, 0, 0); window.__GB.velocity(3, 8, 0, 0); }, TABLE.x1);
await step(320);
const fell = await ev(() => window.__GB.bear(3));
ok('熊被推出桌沿并掉到地面', fell.y < FLOOR + 0.55, `y=${fell.y.toFixed(3)} (桌沿 ${TABLE.x1}, 地板 ${FLOOR})`);
ok('掉落后仍在地面范围内', Math.abs(fell.x) < 9 && Math.abs(fell.z) < 9, `x=${fell.x.toFixed(2)} z=${fell.z.toFixed(2)}`);
await step(120);
const rest = await ev(() => window.__GB.bear(3));
ok('落地后不再下坠', rest.y > FLOOR - 0.1 && rest.y < FLOOR + 0.7, `y=${rest.y.toFixed(3)}`);

/* ================= F. 碰撞（含反向对照） ================= */
await ev(() => { window.__GB.reset(); });
await ev(() => { window.__GB.place(0, 0, 0.30, 0, 0, 0, 0); window.__GB.place(1, 0.14, 0.30, 0, 0, 0, 0); });
await step(45);
const sep = await ev(() => window.__GB.distXZ(0, 1));
ok('重叠的两只熊会被推开', sep > 0.30, sep.toFixed(3));

await ev(() => { window.__GB.reset(); });
await ev(() => { window.__GB.setNoBearCollide(true); window.__GB.place(0, 0, 0.30, 0, 0, 0, 0); window.__GB.place(1, 0.14, 0.30, 0, 0, 0, 0); });
await step(45);
const sepOff = await ev(() => window.__GB.distXZ(0, 1));
ok('【反向对照】关掉熊-熊碰撞后不再分离', sepOff < 0.22, sepOff.toFixed(3));
await ev(() => window.__GB.setNoBearCollide(false));

await ev(() => { window.__GB.reset(); });
await step(120);
const st2 = await ev(() => window.__GB.state());
ok('正常运行时穿透保持在毫米级', st2.pen < 0.05, st2.pen.toFixed(5));

/* ================= G. 渲染 ================= */
const px1 = await ev(() => window.__GB.pixelStats());
ok('画面不是纯色/黑屏', px1.std > 8, `std=${px1.std.toFixed(1)} mean=${px1.mean.toFixed(1)}`);
ok('画面存在高光', px1.max > 200, px1.max.toFixed(1));
const sigA = await ev(() => window.__GB.lumaSig());
const sigB = await ev(() => window.__GB.lumaSig());
const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
ok('【反向对照】同一帧两次渲染完全一致', diff(sigA, sigB) < 0.01, diff(sigA, sigB).toFixed(5));
await ev(() => window.__GB.setTrans(false));
const sigC = await ev(() => window.__GB.lumaSig());
ok('关掉糖光后画面确实不同', diff(sigA, sigC) > 0.6, diff(sigA, sigC).toFixed(3));
await ev(() => window.__GB.setTrans(true));

const box = await ev(() => window.__GB.bearScreenBox(0));
ok('熊在画面内且尺寸合理', box && box.w > 30 && box.w < 600 && box.x0 > -50 && box.x1 < 1330, `w=${box && box.w.toFixed(0)}`);

/* ================= H. UI ================= */
await pg.click('#bNew');
st = await ev(() => window.__GB.state());
ok('「再来一只」新增一只熊', st.n === 17, st.n);
await pg.click('#bReset');
st = await ev(() => window.__GB.state());
ok('「全部归位」恢复 16 只且都在桌上', st.n === 16 && st.desk === 16, `n=${st.n} desk=${st.desk}`);
await pg.keyboard.press('r');
st = await ev(() => window.__GB.state());
ok('键盘 R 也能归位', st.n === 16 && st.desk === 16, `n=${st.n} desk=${st.desk}`);
await pg.click('#bShake');
await step(60);
st = await ev(() => window.__GB.state());
ok('「抖一抖」不会让熊炸飞', st.pen < 0.12 && st.n === 16, `pen=${st.pen.toFixed(4)}`);
await pg.click('#bSlow');
const ts = await ev(() => window.__GB.state().scale);
ok('「慢动作」把时间缩放到 0.22', near(ts, 0.22, 0.01), ts);
await pg.click('#bSlow');

ok('全程无运行时报错', errs.length === 0, errs.join(' | ') || 'none');

console.log(`\n=== E2E：${T.pass} 通过 / ${T.fail} 失败 ===`);
await browser.close();
srv.close();
process.exit(T.fail ? 1 : 0);
