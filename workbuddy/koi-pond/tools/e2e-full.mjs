// 完整功能验证：游动 / 摆尾 / 转向 / 群游 / 投食 / 抢食 / 涟漪 / 相机
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/wxppa/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-quic', '--use-gl=angle', '--use-angle=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text() + ' @ ' + (m.location() ? m.location().url : '')); });

await page.goto('http://127.0.0.1:8917/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.KOI_READY === true, { timeout: 90000 });
await page.waitForTimeout(1500);

const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + name + '  ' + detail); };

const snap = () => page.evaluate(() => {
  const K = window.KOI;
  const g = K.kois[0].body.geometry.attributes.position.array;
  let vsum = 0;
  // 采样尾段（头端几乎不摆）
  for (let i = Math.floor(g.length * 0.62); i < Math.floor(g.length * 0.95); i += 5) vsum += g[i];
  return {
    fishPos: K.kois.map(k => k.pos.toArray().map(n => +n.toFixed(2))),
    fishDir: K.kois.map(k => k.dir.toArray().map(n => +n.toFixed(2))),
    bodyHash: +vsum.toFixed(4),
    bend: K.kois.map(k => +k.bend.toFixed(2)),
    speeds: K.kois.map(k => +k.speed.toFixed(2)),
    camTheta: +K.cam.theta.toFixed(3),
    camDist: +K.cam.dist.toFixed(2),
    foods: K.foods.filter(f => f.alive).length,
    eaten: K.stats.eaten,
    fed: K.stats.fed,
    frames: K.frame
  };
});

/* 1. 静置观察：游动 + 摆尾 + 转向 */
const a = await snap();
await page.waitForTimeout(2600);
const b = await snap();

const moved = a.fishPos.filter((p, i) => Math.hypot(p[0] - b.fishPos[i][0], p[2] - b.fishPos[i][2]) > 0.05).length;
ok('鱼在游动', moved >= 4, `${moved}/7 条位移 > 0.05`);

const turned = a.fishDir.filter((d, i) => Math.hypot(d[0] - b.fishDir[i][0], d[2] - b.fishDir[i][2]) > 0.01).length;
ok('鱼在转向', turned >= 3, `${turned}/7 条朝向变化`);

ok('身体摆尾', Math.abs(a.bodyHash - b.bodyHash) > 0.008, `顶点哈希 ${a.bodyHash} -> ${b.bodyHash}`);
ok('有转弯弯曲', b.bend.some(v => Math.abs(v) > 0.05), `bend=[${b.bend}]`);
ok('渲染在推进', b.frames > a.frames, `${a.frames} -> ${b.frames} 帧`);

/* 2. 群游：最大间距不应过大（在半径 9.6x7.2 池里） */
const spread = await page.evaluate(() => {
  const K = window.KOI;
  let maxd = 0;
  for (let i = 0; i < K.kois.length; i++)
    for (let j = i + 1; j < K.kois.length; j++)
      maxd = Math.max(maxd, K.kois[i].pos.distanceTo(K.kois[j].pos));
  return +maxd.toFixed(2);
});
ok('鱼群聚集', spread < 12, `最远两条相距 ${spread}m`);

/* 3. 点击水面投食 */
const beforeFed = b.fed;
await page.mouse.click(660, 400);
await page.waitForTimeout(900);
const c = await snap();
ok('点击投食', c.fed > beforeFed, `投喂数 ${beforeFed} -> ${c.fed}，场上食物 ${c.foods}`);
ok('食物落水', c.foods > 0, `场上 ${c.foods} 颗`);

/* 4. 涟漪被激活 */
const rippleInfo = await page.evaluate(() => {
  const K = window.KOI;
  const u = K.waterMat.uniforms.uRipples.value;
  return u.filter(r => r.w > 0).length;
});
ok('产生涟漪', rippleInfo > 0, `${rippleInfo} 个活跃涟漪`);

/* 5. 在鱼附近投食，验证抢食 */
await page.evaluate(() => {
  const K = window.KOI;
  for (let i = 0; i < 4; i++) {
    const k = K.kois[i % K.kois.length];
    K.dropFood(k.pos.x, k.pos.z);
  }
});
const beforeEat = c.eaten;
await page.waitForTimeout(12000);
const d = await snap();
ok('鱼会抢食', d.eaten > beforeEat, `吃掉 ${beforeEat} -> ${d.eaten} 颗`);

/* 6. 相机拖动与缩放 */
await page.mouse.move(640, 400);
await page.mouse.down();
await page.mouse.move(760, 400, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(600);
const e = await snap();
ok('拖动环视', Math.abs(e.camTheta - d.camTheta) > 0.05, `theta ${d.camTheta} -> ${e.camTheta}`);

await page.mouse.wheel(0, -240);
await page.waitForTimeout(600);
const f = await snap();
ok('滚轮缩放', Math.abs(f.camDist - e.camDist) > 0.2, `dist ${e.camDist} -> ${f.camDist}`);

/* 7. 食物最终会被清理 */
ok('食物数量受控', f.foods < 40, `场上 ${f.foods} 颗`);

console.log('\nERRORS', errors.length);
errors.slice(0, 8).forEach(x => console.log('  !', x));

const failed = results.filter(r => !r.pass);
console.log(`\nRESULT ${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
