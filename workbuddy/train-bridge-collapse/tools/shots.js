// 案例验收截图：真浏览器渲染，按叙事节点输出 JPEG 到 shots/
const { chromium } = require('playwright');
const path = require('path');

const CASE = 'D:/68.AIGC/GoodCase/outputs/train-bridge-collapse';
const FILE = 'file:///' + path.resolve(CASE + '/index.html').replace(/\\/g, '/');

// [帧号, 文件名, 说明, 特写(可选: {zoom, follow})]
const SHOTS = [
  [120, '01-approach', '入桥前：应力着色下的桁架，机车冒着蒸汽驶向损伤跨', null],
  [175, '02-failure', '首次失效：损伤跨杆件轴力超限，裂缝张开、杆件断裂', null],
  [258, '03-derail', '脱轨：轨排随跨塌落，机车俯冲下坠、车钩拉断', null],
  [400, '04-splash', '入水：整车砸入水面，激起水花、泡沫与辐射状涟漪', null],
  [760, '05-sunk', '沉底：5 节车厢全部进水沉落河床，碎片散落水底', null],
  [95,  '06-loco',  '机车特写：程序化绘制的蒸汽机车，动轮落在轨面', { zoom: 4.0 }],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(700);

  // 冻结主循环，改为手动推进：保证截图时刻可复现
  await page.evaluate(() => { initSim(); setTrainVelocity(); S.run = false; });

  let prev = 0;
  for (const [frame, name, desc, opt] of SHOTS) {
    if (frame < prev) {                       // 逆序跳帧：重置仿真后从 0 重放
      await page.evaluate(() => { initSim(); setTrainVelocity(); S.run = false; });
      prev = 0;
    }
    await page.evaluate(n => { for (let i = 0; i < n; i++) step(CFG.DT); }, frame - prev);
    prev = frame;
    await page.evaluate((o) => {
      if (!window.__ouc) { window.__ouc = updateCam; updateCam = function () {}; }
      S.cam.sh = 0;
      if (o) {                                   // 特写：锁定镜头到机车
        const loco = S.cars[0];
        S.cam.x = (loco.c[0].x + loco.c[1].x) / 2 + 8;
        S.cam.y = (loco.c[0].y + loco.c[1].y) / 2 - 12;
        S.cam.z = o.zoom;
      } else {                                   // 常规：让镜头收敛到叙事机位
        for (let i = 0; i < 90; i++) window.__ouc(1 / 60);
      }
      draw();
    }, opt);
    await page.waitForTimeout(120);
    const info = await page.evaluate(() => ({
      t: +S.t.toFixed(2), z: +S.cam.z.toFixed(2), broke: S.broke,
      wet: S.cars.filter(c => c.wet).length, sunk: S.cars.filter(c => c.sunk).length,
    }));
    await page.screenshot({ path: `${CASE}/shots/${name}.jpg`, type: 'jpeg', quality: 90 });
    console.log(`${name}.jpg  t=${info.t}s  断裂${info.broke}  落水${info.wet}/5  沉没${info.sunk}/5  zoom=${info.z}  — ${desc}`);
  }
  console.log('\nERRORS:', errs.length, errs.slice(0, 5).join(' | '));
  await browser.close();
})();
