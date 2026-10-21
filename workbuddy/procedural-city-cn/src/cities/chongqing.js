/* ============================================================
 * cities/chongqing.js —— 重庆 · 8D 魔幻山城（项目最重要风格）
 * 两江交汇 / 渝中半岛 / 叠叠退台 / 轻轨穿楼 / 长江索道 /
 * 洪崖洞吊脚楼 / 来福士水晶连廊 / 解放碑 / 立体高架
 * ========================================================== */
import { cbdTower } from '../lib/towers.js';
import { hongyadong, rafflesCity, viaduct, cableCar, monorailThroughBuilding } from '../lib/infra.js';
import { hipRoof } from '../lib/roofs.js';

export default {
  id: 'chongqing',
  name: '重庆',
  subtitle: '8D 魔幻 · 两江交汇',
  camera: { radius: 1150, phi: 0.72, theta: 0.72, targetY: 40, minR: 160, maxR: 2300 },
  palette: {
    ground: 0x3e3b35, blotch: '112,106,94',
    road: 0x36332c, roadDash: 'rgba(242,226,182,.48)', curb: 0x877f6d, plaza: 0x47423a,
    facades: [0x8b8069, 0x776a59, 0x95866d, 0x6c6253, 0x908372],
    glassBase: '#3a4c56', brickBase: 0x706655, baseColor: 0x5b544a,
    roofGold: 0xcb942a, tileBlack: 0x34312a,
    treeColors: { plane: 0x3e5431, willow: 0x707d3c, pine: 0x2f4a2e, broad: 0x465b35, pineTall: 0x2d422d },
    waterDeep: 0x1c323a, waterShallow: 0x3e625c,
    fog: 0x8a7a68, fogMix: 0.45,
    skyTop: 0x2c4a72, skyHorizon: 0xd89a62,
  },

  async build(ctx) {
    const r = ctx.rng;
    /* ========== 壹 · 两江交汇 ========== */
    await ctx.step('切开两江…');
    ctx.paintPoly([[-600, 240], [600, 240], [600, 345], [-600, 345]], '#1c2a2e');   // 长江
    ctx.water(0, 292, 1200, 108);
    ctx.paintPoly([[-315, -600], [-215, -600], [-215, 245], [-315, 245]], '#1c2a2e'); // 嘉陵江
    ctx.water(-265, -180, 100, 830);
    // 南山 / 歌乐山
    ctx.ridge(430, -500, 500, 90, 190, ctx.mat('nanshan', { color: 0x3f5a42, roughness: 1 }));
    ctx.ridge(-560, -560, -340, 70, 150, ctx.mat('geleshan', { color: 0x44553f, roughness: 1 }));
    // 枇杷山（城内孤峰）
    ctx.hill(95, 185, 62, 22, ctx.mat('pipashan', { color: 0x4d5a3c, roughness: 0.96 }), { top: 0.35 });
    for (let i = 0; i < 18; i++) ctx.tree(95 + (r() - 0.5) * 90, 185 + (r() - 0.5) * 80, { type: 'broad', scale: 0.8 + r() * 0.4 });

    /* ========== 贰 · 渝中叠楼 ========== */
    await ctx.step('搭起叠叠楼…');
    const conc = ctx.mat('cqConcrete', { color: 0x857b6c, roughness: 0.92 });
    const plats = [
      [ -30, 0, 60, 330, 300, 7 ],
      [ 25, 7, 115, 190, 150, 7 ],
      [ -45, 14, 35, 130, 100, 7 ],
      [ 60, 14, 150, 90, 70, 6 ],
    ];
    for (const [x, y, z, w, d, h] of plats) ctx.box(w, h, d, x, y, z, { mat: conc, cast: false });
    // 平台裙楼（建于台顶，向下填满平台 → 露出台沿，形成叠叠退台）
    for (const [x, y, z, w, d, h] of plats) {
      for (let i = 0; i < 10; i++) {
        const bw = 16 + r() * 12, bd = 16 + r() * 12;
        const bx = x - w / 2 + 12 + r() * (w - 24), bz = z - d / 2 + 12 + r() * (d - 24);
        ctx.building(bx, bz, { w: bw, d: bd, h: 14 + r() * 38, y: y + h, roof: 'flat', shop: r() < 0.25 });
      }
    }
    // 山顶高宅（枇杷山，贴合坡地）
    for (let i = 0; i < 5; i++) {
      const hx = 95 + (r() - 0.5) * 60, hz = 185 + (r() - 0.5) * 50;
      ctx.building(hx, hz, { w: 16, d: 16, h: 20 + r() * 16, roof: 'flat', y: ctx.groundY(hx, hz) });
    }

    /* ========== 叁 · 立体交通 ========== */
    await ctx.step('架轻轨 · 拉索道…');
    // 李子坝轻轨穿楼
    const trainPts = monorailThroughBuilding(ctx, 50, -15, { h: 62, mark: '李子坝轻轨穿楼' });
    ctx.train(trainPts, { speed: 20, cars: 3 });
    // 长江索道
    cableCar(ctx, -150, -60, -150, 400, { h: 48, mark: '长江索道' });
    // 两层互通高架
    viaduct(ctx, [[-300, -45], [-80, -45], [70, 25]], { w: 15, h: 13, mark: '黄花园立交' });
    viaduct(ctx, [[-300, -30], [-80, -30], [70, 40]], { w: 15, h: 21, mark: '渝中高架' });
    // 盘龙立交小匝道
    viaduct(ctx, [[-80, -45], [10, -120], [-60, -150]], { w: 9, h: 26 });
    // 车流
    ctx.carLane({ x1: -280, z1: 120, x2: 120, z2: 120, n: 8, speed: 13 });
    ctx.carLane({ x1: -150, z1: -80, x2: -150, z2: 230, n: 7, speed: 12 });
    ctx.carLane({ x1: -60, z1: -60, x2: 130, z2: 200, n: 5, speed: 11 });

    /* ========== 肆 · 魔幻地标 ========== */
    await ctx.step('点灯 · 洪崖洞…');
    // 解放碑 CBD
    const jfb = [0, 60];
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2, rr = 40 + r() * 60;
      cbdTower(ctx, jfb[0] + Math.cos(a) * rr, jfb[1] + Math.sin(a) * rr, 170 + r() * 120, i);
    }
    // 解放碑
    ctx.mark('解放碑');
    ctx.box(14, 6, 14, jfb[0], 7, jfb[1], { mat: ctx.mat('jfbBase', { color: 0x8a8578, roughness: 0.85 }) });
    ctx.box(7.5, 34, 7.5, jfb[0], 13, jfb[1], { mat: ctx.mat('jfbBody', { color: 0xb8b2a4, roughness: 0.7 }) });
    ctx.box(8.6, 2.2, 8.6, jfb[0], 47, jfb[1], { mat: ctx.mat('jfbTop', { color: 0xc8a03a, roughness: 0.4, metalness: 0.5 }, ['lamp']) });
    for (const [dx, dz] of [[0, 4], [0, -4], [4, 0], [-4, 0]]) {
      ctx.box(0.3, 2.6, 2.6, jfb[0] + dx, 33, jfb[1] + dz, { mat: ctx.mat('jfbClock', { color: 0xf0ead8, emissive: 0xffe8b0, emissiveIntensity: 0 }, ['lamp']), cast: false });
    }
    // 朝天门来福士
    rafflesCity(ctx, -185, 232, { h: 320, mark: '重庆来福士' });
    // 洪崖洞
    hongyadong(ctx, 128, 118, { w: 56, h: 44, mark: '洪崖洞' });
    // 山城步道灯笼巷
    for (let i = 0; i < 20; i++) ctx.lantern(-180 + (i % 10) * 40, 3.2 + (i > 9 ? 7 : 0), 60 + (i > 9 ? 30 : 0), 1.1);
    // 江北 / 南岸楼群
    for (let i = 0; i < 26; i++) {
      const x = -560 + r() * 1120, z = -420 + r() * 220;
      if (Math.abs(x + 265) < 70) continue;
      cbdTower(ctx, x, z, 70 + r() * 150, i + 1);
    }
    for (let i = 0; i < 22; i++) {
      const x = -560 + r() * 1120, z = 380 + r() * 200;
      if (Math.abs(z - 292) < 60) continue;
      cbdTower(ctx, x, z, 70 + r() * 140, i + 2);
    }
    // 树
    for (let i = 0; i < 40; i++) ctx.tree(-500 + r() * 1000, -380 + r() * 620, { type: 'broad', scale: 0.8 + r() * 0.5 });
  },
};
