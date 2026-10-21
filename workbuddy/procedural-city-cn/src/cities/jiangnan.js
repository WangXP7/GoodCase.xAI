/* ============================================================
 * cities/jiangnan.js —— 江南水乡
 * 十字运河 / 石拱桥群 / 白墙黛瓦 / 马头墙 / 乌篷船 /
 * 垂柳 / 古戏台 / 烟雨朦胧
 * ========================================================== */
import { waterTownHouse, templeHall } from '../lib/heritage.js';
import { archBridge } from '../lib/infra.js';
import { paifang } from '../lib/roofs.js';

export default {
  id: 'jiangnan',
  name: '江南水乡',
  subtitle: '小桥流水 · 烟雨朦胧',
  camera: { radius: 950, phi: 0.72, theta: 0.72, targetY: 20, minR: 120, maxR: 1900 },
  palette: {
    ground: 0x42463d, blotch: '104,109,96',
    road: 0x3f4339, roadDash: 'rgba(232,227,202,.4)', curb: 0x8b8e7d, plaza: 0x4a4d42,
    facades: [0x9c988b, 0x8c887b, 0xaaa697, 0x7c786b, 0xb2ae9d],
    glassBase: '#3a4c46', brickBase: 0x706c5e, baseColor: 0x5c584a,
    roofGold: 0xc9a227, tileBlack: 0x23262c,
    treeColors: { plane: 0x4c5c36, willow: 0x6a7c3e, pine: 0x2f4a2e, broad: 0x4c5c36, pineTall: 0x2d422d },
    waterDeep: 0x1c2e33, waterShallow: 0x3e5a54, waterMix: 0.18,
    fog: 0x8a9098, fogMix: 0.4,
    skyTop: 0x4a6a8a, skyHorizon: 0xd0cdc0,
  },

  async build(ctx) {
    const r = ctx.rng;
    /* ========== 壹 · 十字运河 ========== */
    await ctx.step('引十字运河…');
    ctx.paintPoly([[-320, -13], [320, -13], [320, 13], [-320, 13]], '#1a2a2c');
    ctx.paintPoly([[-13, -320], [13, -320], [13, 320], [-13, 320]], '#1a2a2c');
    ctx.water(0, 0, 640, 26);
    ctx.water(0, 0, 26, 640);
    // 支渠
    ctx.paintPoly([[-320, 110], [320, 110], [320, 122], [-320, 122]], '#1a2a2c');
    ctx.water(0, 116, 640, 12);
    ctx.paintPoly([[-320, -110], [320, -110], [320, -122], [-320, -122]], '#1a2a2c');
    ctx.water(0, -116, 640, 12);
    // 远山（淡到雾里）
    ctx.ridge(-430, -520, 520, 40, 90, ctx.mat('jnRidge', { color: 0x5a6a72, roughness: 1 }));
    ctx.ridge(430, -520, 520, 40, 90, ctx.mat('jnRidge2', { color: 0x5a6a72, roughness: 1 }));

    /* ========== 贰 · 桥群 ========== */
    await ctx.step('架拱桥…');
    archBridge(ctx, 0, 0, { len: 30, w: 9, span: 17, h: 8, mark: '环秀桥' });
    for (const [bx, bz] of [[-80, 0], [80, 0], [150, 0], [0, -80], [0, 80], [0, -170], [0, 170], [0, -260], [0, 260]]) {
      archBridge(ctx, bx, bz, { len: 24 + r() * 6, w: 8, span: 13 + r() * 5, h: 6 + r() * 3, mark: '石拱桥' });
    }

    /* ========== 叁 · 枕河人家 ========== */
    await ctx.step('起白墙黛瓦…');
    // 沿主运河两岸枕河民居
    for (const cz of [-26, 26, -135, 135]) {
      for (let x = -300; x < 300; x += 17) {
        if (Math.abs(x) < 16) continue;
        waterTownHouse(ctx, x + (r() - 0.5) * 3, cz, { w: 12, d: 9, h: 6.5 + r() * 2, ry: 0 });
      }
    }
    for (const cx of [-26, 26]) {
      for (let z = -300; z < 300; z += 17) {
        if (Math.abs(z) < 16) continue;
        waterTownHouse(ctx, cx, z + (r() - 0.5) * 3, { w: 12, d: 9, h: 6.5 + r() * 2, ry: Math.PI / 2 });
      }
    }
    // 街区内部
    for (let i = 0; i < 46; i++) {
      const x = -300 + r() * 600, z = -300 + r() * 600;
      if (Math.abs(z) < 45 || Math.abs(x) < 45) continue;
      if (Math.abs(Math.abs(z) - 116) < 40) continue;
      waterTownHouse(ctx, x, z, { w: 12 + r() * 5, d: 10 + r() * 4, h: 6 + r() * 3.5, ry: r() < 0.5 ? 0 : Math.PI / 2 });
    }
    // 古戏台 + 茶楼
    ctx.paintRect(80, 80, 70, 70, '#54574b');
    templeHall(ctx, 80, 80, { w: 16, d: 12, h: 11, mark: '古戏台', roof: 'green', tiers: 1 });
    paifang(ctx, 55, 55, { w: 9, h: 10 });

    /* ========== 肆 · 乌篷杨柳 ========== */
    await ctx.step('摇乌篷 · 拂杨柳…');
    // 乌篷船
    ctx.boat([[-300, 0, 0], [-100, 0, 0], [100, 0, 0], [300, 0, 0]], { kind: 'wupeng', speed: 3.2 });
    ctx.boat([[300, 0, 0], [100, 0, 0], [-100, 0, 0], [-300, 0, 0]], { kind: 'wupeng', speed: 2.8 });
    ctx.boat([[0, 0, -300], [0, 0, -100], [0, 0, 100], [0, 0, 300]], { kind: 'wupeng', speed: 3 });
    ctx.boat([[0, 0, 300], [0, 0, 100], [0, 0, -100], [0, 0, -300]], { kind: 'wupeng', speed: 2.6 });
    ctx.boat([[-300, 0, 116], [-100, 0, 116], [100, 0, 116], [300, 0, 116]], { kind: 'wupeng', speed: 3.4 });
    // 垂柳拂岸
    for (let x = -310; x < 310; x += 13) {
      if (Math.abs(x) < 14) continue;
      ctx.tree(x + (r() - 0.5) * 3, -20 - r() * 6, { type: 'willow', scale: 0.8 + r() * 0.35 });
      ctx.tree(x + (r() - 0.5) * 3, 20 + r() * 6, { type: 'willow', scale: 0.8 + r() * 0.35 });
    }
    for (let z = -310; z < 310; z += 13) {
      if (Math.abs(z) < 14) continue;
      ctx.tree(-20 - r() * 6, z + (r() - 0.5) * 3, { type: 'willow', scale: 0.8 + r() * 0.35 });
      ctx.tree(20 + r() * 6, z + (r() - 0.5) * 3, { type: 'willow', scale: 0.8 + r() * 0.35 });
    }
    // 石板路
    ctx.road(-320, -34, 320, -34, 8, { curb: false, dash: false, color: '#5a5d50' });
    ctx.road(-320, 34, 320, 34, 8, { curb: false, dash: false, color: '#5a5d50' });
    ctx.road(-34, -320, -34, 320, 8, { curb: false, dash: false, color: '#5a5d50' });
    ctx.road(34, -320, 34, 320, 8, { curb: false, dash: false, color: '#5a5d50' });
    // 红灯笼（桥头 / 巷口）
    for (let i = 0; i < 22; i++) ctx.lantern(-300 + (i % 11) * 55, 4.2, (i > 10 ? 40 : -40) + (r() - 0.5) * 8, 0.9);
    for (let i = 0; i < 12; i++) ctx.lantern((i > 5 ? 40 : -40) + (r() - 0.5) * 8, 4.2, -300 + (i % 6) * 110, 0.9);
  },
};
