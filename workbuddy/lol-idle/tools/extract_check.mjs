import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const html = fs.readFileSync('D:/68.AIGC/GoodCase/lol-idle/index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('inline scripts:', scripts.length, 'total JS chars:', scripts.reduce((a, s) => a + s.length, 0));
const js = scripts.join('\n;\n');
// 语法层：把内联脚本写到系统临时目录再交给 node --check，不污染案例目录
const tmpFile = path.join(os.tmpdir(), 'rift-idle-check-' + process.pid + '.mjs');
fs.writeFileSync(tmpFile, js);
try {
  execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
  console.log('syntax: OK (node --check)');
} catch (e) {
  console.log('syntax: FAIL');
  console.log(String(e.stderr || e.message).slice(0, 800));
  process.exit(1);
} finally {
  try { fs.unlinkSync(tmpFile); } catch (e) {}
}

// 静态探针：把 PURE 段切出来在 vm 里跑，验证纯函数
const pureStart = js.indexOf('const PURE = {');
const pureEnd = js.indexOf('window.__pure = PURE;');
if (pureStart < 0 || pureEnd < 0) { console.log('PURE block not found'); process.exit(1); }

// 依赖的最小上游：常量 + clamp/fmt/MAX_OFFLINE
const need = [
  "const clamp = (v,a,b)=>v<a?a:v>b?b:v;",
  "const MAX_OFFLINE = 8*3600;",
  "const TARGETS_PER_GAME = 4;",
  "const RANKS = [{name:'黑铁'},{name:'青铜'},{name:'白银'},{name:'黄金'},{name:'铂金'},{name:'翡翠'},{name:'钻石'},{name:'大师'},{name:'宗师'},{name:'王者'}];",
  "const TIERS = ['IV','III','II','I'];",
];
// fmt 从源码里截取（含 units 数组）
const fmtSrc = js.slice(js.indexOf('const fmt = (n)'), js.indexOf('const fmtPct'));

const sandbox = { window: {}, Math, console };
vm.createContext(sandbox);
vm.runInContext(need.join('\n') + '\n' + fmtSrc + '\n' + js.slice(pureStart, pureEnd) + '\nthis.__P = PURE;', sandbox);
const P = sandbox.__P;

const cases = [];
const eq = (name, got, want) => cases.push({ name, got, want, ok: JSON.stringify(got) === JSON.stringify(want) });

eq('fmt(0)', P.fmt(0), '0');
eq('fmt(999)', P.fmt(999), '999');
eq('fmt(1500)', P.fmt(1500), '1.50K');
eq('fmt(1234567)', P.fmt(1234567), '1.23M');
eq('tower 1-1 hp', P.towerMaxHpFor(1, 0), 280);
eq('tower 1-2 > 1-1', P.towerMaxHpFor(1, 1) > P.towerMaxHpFor(1, 0), true);
eq('tower 2-1 > 1-3', P.towerMaxHpFor(2, 0) > P.towerMaxHpFor(1, 2), true);
eq('跨局台阶 ≈1.72×', Math.round(P.towerMaxHpFor(2, 0) / P.towerMaxHpFor(1, 0) * 100) / 100, 1.72);
eq('tower 10 局量级 < 100 万', P.towerMaxHpFor(10, 3) < 1e6, true);
eq('dps lv1', Math.round(P.heroDpsAt(14, 1, 1, 1, 0.08, 1.6, 1) * 100) / 100, Math.round(14 * 1.048 * 100) / 100);
eq('dps lv11 是 lv1 的 5.5 倍（1.185^10）', Math.round(P.heroDpsAt(14, 11, 1, 1, 0.08, 1.6, 1) / P.heroDpsAt(14, 1, 1, 1, 0.08, 1.6, 1) * 10) / 10, 5.5);
eq('star2 +18%', Math.round(P.heroDpsAt(14, 1, 2, 1, 0.08, 1.6, 1) / P.heroDpsAt(14, 1, 1, 1, 0.08, 1.6, 1) * 100), 118);
eq('crit 上限 85%', P.heroDpsAt(10, 1, 1, 1, 5, 2, 1), P.heroDpsAt(10, 1, 1, 1, 0.85, 2, 1));
eq('cost 1 级', P.costFor(16, 0, 1.155), 16);
eq('cost 10 级 > 1 级 3 倍', P.costFor(16, 9, 1.155) > P.costFor(16, 0, 1.155) * 3, true);
eq('离线 1 小时（gps 100）', P.offlineGold(100, 3600, 0.6), 216000);
eq('离线封顶 8 小时', P.offlineGold(100, 999999, 0.6), 1728000);
eq('rank(0) 黑铁 IV', P.rankOf(0), { idx: 0, tier: 'IV', name: '黑铁' });
eq('rank(4) 青铜 IV', P.rankOf(4), { idx: 1, tier: 'IV', name: '青铜' });
eq('rank(3) 黑铁 I', P.rankOf(3), { idx: 0, tier: 'I', name: '黑铁' });

let bad = 0;
for (const c of cases) {
  if (!c.ok) { bad++; console.log('  FAIL', c.name, 'got', JSON.stringify(c.got), 'want', JSON.stringify(c.want)); }
}
console.log(`static probe: ${cases.length - bad}/${cases.length} pass`);
process.exit(bad ? 1 : 0);
