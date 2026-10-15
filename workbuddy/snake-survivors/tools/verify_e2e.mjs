// 蛇人幸存者 E2E 验证：三层验证的第三层（Playwright 真浏览器端到端）
// 断言覆盖：尾击伤害/击退、毒瓶区域/叠毒/DOT/减速、诅咒易伤/降攻、
// 中毒+诅咒连锁爆炸、蛇人召集灭敌、升级三选一、远程预警先行、精英敌潮、
// 敌人强度成长、死亡与重开、10 分钟胜利、伤害数字、屏幕震动、无 JS 报错。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // 回退：从托管 node workspace 解析（ESM 不读 NODE_PATH）
  const { createRequire } = await import('node:module');
  const require = createRequire('C:/Users/wxppa/.workbuddy/binaries/node/workspace/package.json');
  ({ chromium } = require('playwright'));
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const shots = path.join(root, 'shots');
const PORT = 8917;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.jpg':'image/jpeg', '.png':'image/png', '.md':'text/plain; charset=utf-8' };
const server = http.createServer((req, res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if(!file.startsWith(root)){ res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data)=>{
    if(err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const results = [];
const errors = [];
function check(name, cond, extra){
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
}
const shot = (n) => page.screenshot({ path: path.join(shots, n), type: 'jpeg', quality: 86 });
// 确保世界处于运行态（点掉可能弹出的升级卡）
async function ensurePlay(){
  for(let i = 0; i < 10; i++){
    const st = await page.evaluate(() => __game.state);
    if(st === 'play') return;
    if(st === 'levelup'){ await page.click('#cards .card2'); await page.waitForTimeout(150); }
    else return;
  }
}

const browser = await chromium.launch({ args: ['--disable-quic', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('response', r => { if(r.status() >= 400 && !r.url().includes('favicon')) errors.push('http' + r.status() + ': ' + r.url()); });

console.log('== 加载 ==');
await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__debug, null, { timeout: 20000 });
check('页面加载且游戏初始化', true);
await shot('01-menu.jpg');

console.log('== 开始对局 ==');
await page.click('#startBtn');
await page.waitForTimeout(400);
check('进入战斗状态', await page.evaluate(() => __game.state === 'play'));
// 测试期高血量，避免中途被围死
await page.evaluate(() => { __game.player.maxHp = 100000; __game.player.hp = 100000; });
// 摆一批敌人让首张战斗截图有内容
await page.evaluate(() => {
  for(let i = 0; i < 14; i++){
    const a = i/14*Math.PI*2;
    __debug.spawn(i%4 === 0 ? 'ranged' : 'melee', Math.cos(a)*15, Math.sin(a)*15);
  }
});
await page.waitForTimeout(2600);
await shot('02-battle.jpg');

console.log('== 技能一：尾击 ==');
await page.evaluate(() => {
  __debug.killAll(); __debug.freeze(); __debug.clearCd();
  const e = __debug.spawn('melee', 3, 0);
  e.hp = 100; e.maxHp = 100;
  window.__t1 = e;
});
await page.evaluate(() => { __debug.clearCd(); __debug.cast(0); });
await page.waitForTimeout(250);
const ra = await page.evaluate(() => ({ hp: window.__t1.hp, kb: Math.hypot(window.__t1.kbx, window.__t1.kbz) }));
check('尾击造成真实伤害', ra.hp < 92, `hp 100 -> ${ra.hp.toFixed(1)}`);
check('尾击产生击退位移', ra.kb > 2, `knockback=${ra.kb.toFixed(1)}`);

console.log('== 技能二：毒瓶 ==');
await page.evaluate(() => {
  __debug.killAll(); __debug.freeze(); __debug.clearCd();
  // 单个中毒目标 + 单个对照目标（清场后立即测量，排除分离/导演敌人干扰）
  const a = __debug.spawn('melee', 10, 0); a.hp = 600; a.maxHp = 600; window.__eB = a;
  const c = __debug.spawn('melee', 10, -30); c.hp = 600; c.maxHp = 600; window.__eC = c;
  __debug.zoneAt(10, 0, 8.5, 6, 9, 0.35);   // 直接在目标处生成毒液区
});
await page.waitForFunction(() => window.__eB.poison.stacks > 0, null, { timeout: 8000 });
check('毒液区域给敌人叠毒', true, 'stacks=' + (await page.evaluate(() => window.__eB.poison.stacks)));
const h1 = await page.evaluate(() => window.__eB.hp);
await page.waitForTimeout(900);
const h2 = await page.evaluate(() => window.__eB.hp);
check('毒液持续掉血（DOT）', h2 < h1 - 3, `${h1.toFixed(0)} -> ${h2.toFixed(0)}`);
const d0 = await page.evaluate(() => ({ a: Math.hypot(window.__eB.x, window.__eB.z), c: Math.hypot(window.__eC.x, window.__eC.z) }));
await page.waitForTimeout(500);
const d1 = await page.evaluate(() => ({ a: Math.hypot(window.__eB.x, window.__eB.z), c: Math.hypot(window.__eC.x, window.__eC.z) }));
const mvA = d0.a - d1.a, mvC = d0.c - d1.c;
check('毒液减速敌人（对照实验）', mvA > mvC*0.35 && mvA < mvC*0.85, `中毒位移${mvA.toFixed(2)} vs 对照${mvC.toFixed(2)}`);
// 毒瓶完整链路（投掷→落地成区）
await page.evaluate(() => { __debug.killAll(); __debug.spawn('melee', 9, 0); __debug.clearCd(); __debug.cast(1); });
await page.waitForFunction(() => window.__debug.zoneCount() >= 1, null, { timeout: 10000 });
check('毒瓶投掷落地生成毒液区域', true);
await page.evaluate(() => { __debug.clearCd(); __debug.cast(1); __debug.cast(2); });
await page.waitForTimeout(1200);
await shot('03-poison-curse.jpg');

console.log('== 技能三：诅咒 ==');
await page.evaluate(() => {
  __debug.killAll(); __debug.clearCd();
  window.__eA = __debug.spawn('melee', 3, 0.8); window.__eA.hp = 1000; window.__eA.maxHp = 1000;
  window.__eD = __debug.spawn('melee', 3, -0.8); window.__eD.hp = 1000; window.__eD.maxHp = 1000;
  __debug.applyStatus(window.__eA, 0, 5);
  __debug.cast(0);
});
await page.waitForTimeout(300);
const rc = await page.evaluate(() => ({ a: window.__eA.hp, d: window.__eD.hp, curse: window.__eA.curseTtl }));
check('诅咒状态真实施加', rc.curse > 0, `curseTtl=${rc.curse.toFixed(1)}s`);
check('诅咒使敌人受到更多伤害', rc.a < rc.d - 1, `受诅咒掉${(1000-rc.a).toFixed(1)} vs 普通掉${(1000-rc.d).toFixed(1)}`);
// 诅咒降攻：对照组直接接触
await page.evaluate(() => {
  __debug.killAll();
  __game.player.hp = 100000;
  __game.player.cdT[0] = 99;
  const e = __debug.spawn('melee', 1.4, 0);
  e.hp = 99999; e.dmg = 40;
  __debug.applyStatus(e, 0, 5);
  window.__eW = e;
  window.__hp0 = __game.player.hp;
});
await page.waitForTimeout(400);
const hpW = await page.evaluate(() => __game.player.hp);
const taken = await page.evaluate(() => window.__hp0 - __game.player.hp);
check('诅咒降低敌人攻击力', taken > 12 && taken < 30, `原伤害40，实际受到${taken.toFixed(0)}`);

console.log('== 联动：中毒+诅咒爆炸 ==');
await page.evaluate(() => {
  __debug.killAll();
  window.__eX = __debug.spawn('melee', 6, 0); window.__eX.hp = 60; window.__eX.maxHp = 60;
  window.__eY = __debug.spawn('melee', 8.6, 0); window.__eY.hp = 60; window.__eY.maxHp = 60;
  __debug.applyStatus(window.__eX, 2, 5);
  __debug.applyStatus(window.__eY, 2, 5);
  window.__logN = __game.S.log.length;
});
await page.waitForFunction(n => __game.S.log.length > n, await page.evaluate(() => window.__logN), { timeout: 12000 });
const rd = await page.evaluate(() => ({ x: window.__eX.hp < 60, y: window.__eY.hp < 55 }));
check('双状态敌人触发剧毒爆炸', rd.x, `src hp=${(await page.evaluate(() => window.__eX.hp)).toFixed(0)}`);
check('爆炸范围伤害波及邻敌（可连锁）', rd.y, `neighbor hp=${(await page.evaluate(() => window.__eY.hp)).toFixed(0)}`);

console.log('== 技能四：蛇人召集 ==');
await page.evaluate(() => {
  __debug.killAll(); __debug.giveEnergy(100);
  window.__eR = [];
  for(let i = 0; i < 6; i++){
    const e = __debug.spawn('melee', 20, i*1.5 - 3.75);
    e.hp = 22; e.maxHp = 22;
    window.__eR.push(e);
  }
});
await page.evaluate(() => { __game.player.cdT[3] = 0; __debug.cast(3); });
const cn = await page.evaluate(() => window.__debug.clanCount());
check('召集消耗能量召唤大量族人', cn >= 10, 'clans=' + cn);
const trNow = await page.evaluate(() => window.__debug.trauma());
check('召集触发屏幕震动', trNow > 0.3, 'trauma=' + trNow.toFixed(2));
// 等到族人冲到屏幕中段再截图
await page.waitForFunction(() => window.__game.clans.some(c => Math.abs(c.x) < 14), null, { timeout: 15000 });
await shot('04-rally.jpg');
await page.waitForFunction(() => window.__eR.every(e => e.dead), null, { timeout: 25000 });
check('族人横向冲锋真实歼灭敌人', true);

console.log('== 升级三选一 ==');
await page.evaluate(() => { __debug.killAll(); __debug.addXP(80); });
await page.waitForFunction(() => __game.state === 'levelup', null, { timeout: 8000 });
const cards = await page.evaluate(() => document.querySelectorAll('#cards .card2').length);
check('升级时弹出三张随机强化卡', cards === 3, 'cards=' + cards);
await shot('05-levelup.jpg');
const upBefore = await page.evaluate(() => JSON.stringify(__game.player.up));
// 逐张点完所有待选等级（addXP(80) 会累积多级）
for(let i = 0; i < 8; i++){
  if(await page.evaluate(() => __game.state) !== 'levelup') break;
  await page.click('#cards .card2');
  await page.waitForTimeout(200);
}
const rl = await page.evaluate(() => ({ state: __game.state, up: JSON.stringify(__game.player.up), lvl: __game.S.level }));
check('选择强化后回到战斗且属性提升', rl.state === 'play' && rl.up !== upBefore && rl.lvl >= 2, `level=${rl.lvl}, upgrades=${rl.up}`);

console.log('== 远程音波：预警先行 ==');
await page.waitForFunction(() => __game.state === 'play', null, { timeout: 5000 });
await page.evaluate(() => {
  __debug.clearShots(); __debug.clearTeles(); __debug.killAll();
  __game.player.cdT[0] = 99;
  // 页面内高频采样，避免跨进程轮询错过 1 秒级的预警窗口
  window.__teleAt = -1; window.__shotAt = -1;
  window.__iv = setInterval(() => {
    if(__debug.teleCount() > 0 && window.__teleAt < 0) window.__teleAt = performance.now();
    if(__debug.shotCount() > 0 && window.__shotAt < 0) window.__shotAt = performance.now();
  }, 40);
  __debug.spawn('ranged', 0, -16);
});
await page.waitForTimeout(9000);
const rw = await page.evaluate(() => {
  clearInterval(window.__iv);
  return { tele: window.__teleAt, shot: window.__shotAt };
});
check('远程敌人发射前显示攻击预警圈', rw.tele > 0 && (rw.shot < 0 || rw.tele <= rw.shot),
  `tele@${rw.tele.toFixed(0)}ms shot@${rw.shot.toFixed(0)}ms`);
check('预警结束后发射精神音波', rw.shot > 0);

console.log('== 精英敌潮 ==');
await page.evaluate(() => { __debug.killAll(); __debug.setTime(119); });
await page.waitForFunction(() => __game.S.t >= 120, null, { timeout: 6000 });
await page.waitForFunction(() => __game.enemies.some(e => e.elite), null, { timeout: 12000 });
check('定时精英敌潮刷新精英敌人', true);
const eliteN = await page.evaluate(() => __game.enemies.filter(e => e.elite).length);
await page.waitForTimeout(2500);
await shot('06-elite.jpg');

console.log('== 敌人数值成长 ==');
// 基线：对局刚开始（t≈0，缩放 1.0）；晚期：t=300s（缩放 ≈14.75）
const hpEarly = await page.evaluate(() => { const e = __debug.spawn('melee', 30, 30); const h = e.maxHp; e.dead = true; return h; });
const tNow = await page.evaluate(() => __game.S.t);
await page.evaluate(() => __debug.setTime(300));
const hpLate = await page.evaluate(() => { const e = __debug.spawn('melee', 30, 30); const h = e.maxHp; e.dead = true; return h; });
check('敌人生命值随时间大幅提升', hpLate > 300 && hpLate > hpEarly * 3, `t=${tNow.toFixed(0)}s: ${hpEarly.toFixed(0)} -> t=300s: ${hpLate.toFixed(0)}`);

console.log('== 角色/敌人造型特写 ==');
await page.evaluate(() => {
  __debug.killAll(); __debug.clearCd();
  __debug.spawn('melee', 3.2, 1.2);
  __debug.spawn('melee', 4.2, -1.6);
  __debug.spawn('ranged', -3.6, 1.8);
  __debug.spawn('elite', -4.5, -2.5);
  __debug.setZoom(11);
});
await page.waitForTimeout(1600);
await shot('09-detail.jpg');
await page.evaluate(() => __debug.setZoom(33));

console.log('== 伤害数字 ==');
await page.evaluate(() => { __debug.killAll(); __game.player.cdT[0] = 0; __debug.spawn('melee', 4, 0); });
let dnOK = false;
const tdn = Date.now();
while(Date.now() - tdn < 9000){
  if(await page.evaluate(() => __debug.dmgCount()) > 0){ dnOK = true; break; }
  await page.waitForTimeout(120);
}
check('伤害数字正常弹出', dnOK);

console.log('== 死亡与重新开始 ==');
await ensurePlay();
await page.evaluate(() => { __debug.killAll(); __game.player.hp = 60; __game.player.iframe = 0; __debug.damagePlayer(99999); });
await page.waitForFunction(() => __game.state === 'over', null, { timeout: 6000 });
check('生命归零进入失败结算', true);
await shot('07-gameover.jpg');
await page.click('#restartBtn');
await page.waitForTimeout(400);
const ri = await page.evaluate(() => ({ state: __game.state, hp: __game.player.hp, n: __game.enemies.length, t: __game.S.t, kills: __game.S.kills, lvl: __game.S.level }));
check('重新开始完整重置对局', ri.state === 'play' && ri.hp === 100 && ri.t < 2 && ri.kills === 0 && ri.lvl === 1 && ri.n <= 2, JSON.stringify(ri));

console.log('== 10 分钟生存胜利 ==');
await ensurePlay();
await page.evaluate(() => { __debug.killAll(); __game.player.hp = 100000; __debug.setTime(596); });
await page.waitForFunction(() => __game.state === 'win', null, { timeout: 25000 });
check('生存满 10 分钟触发胜利', true);
await shot('08-win.jpg');

console.log('== 工程约束 ==');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
check('无 CDN 引用（three.js 本地 vendored）', !/cdn\.jsdelivr|unpkg|cdnjs|bootcdn/.test(html));
check('importmap 指向本地 vendor', /"three":\s*"\.\/vendor\/three\.module\.min\.js"/.test(html));
check('vendor/three.module.min.js 存在', fs.existsSync(path.join(root, 'vendor', 'three.module.min.js')));
check('全程无 JS 运行时错误', errors.length === 0, errors.slice(0, 3).join(' ; '));

await browser.close();
server.close();
const fail = results.filter(r => !r.pass);
console.log(`\n===== ${results.length - fail.length}/${results.length} 通过 =====`);
if(fail.length){ console.log('失败项：'); fail.forEach(f => console.log('  - ' + f.name)); process.exit(1); }
