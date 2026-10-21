/* ============================================================
 * cities/shenzhen.js —— 深圳 · 赛博之城
 * 平安金融中心 / 京基100 / 华润春笋 / 华强北霓虹峡谷 /
 * 深圳湾 /  dense 玻璃森林
 * ========================================================== */
import { pingAnTower, kk100Tower, chunSun, cbdTower } from '../lib/towers.js';

export default {
  id: 'shenzhen',
  name: '深圳',
  subtitle: '赛博之城 · 霓虹峡谷',
  camera: { radius: 1150, phi: 0.7, theta: 0.85, targetY: 90, minR: 160, maxR: 2300 },
  palette: {
    ground: 0x34373d, blotch: '94,99,108',
    road: 0x2c2f35, roadDash: 'rgba(125,205,255,.38)', curb: 0x5c616a, plaza: 0x3d414a,
    facades: [0x71767f, 0x61666f, 0x81868f, 0x51565f, 0x91969f],
    glassBase: '#1c3448', brickBase: 0x61666f, baseColor: 0x3d414a,
    roofGold: 0xc9a227, tileBlack: 0x272a2f,
    treeColors: { plane: 0x2f4c2d, willow: 0x5c7036, pine: 0x28402c, broad: 0x37522f, pineTall: 0x24402a },
    waterDeep: 0x10242e, waterShallow: 0x28485c,
    fog: 0x2a3a4c, fogMix: 0.65,
    skyTop: 0x101c30, skyHorizon: 0x3c4c6c,
  },

  async build(ctx) {
    const r = ctx.rng;
    /* ========== 壹 · 深圳湾 ========== */
    await ctx.step('点亮深圳湾…');
    ctx.paintPoly([[-600, 300], [600, 300], [600, 395], [-600, 395]], '#0e2028');
    ctx.water(0, 348, 1200, 98);
    // 人才公园湖心绿岛
    ctx.hill(300, 330, 40, 8, ctx.mat('szPark', { color: 0x35502e, roughness: 0.95 }));
    for (let i = 0; i < 14; i++) ctx.tree(300 + (r() - 0.5) * 60, 330 + (r() - 0.5) * 50, { type: 'broad', scale: 0.9 + r() * 0.4 });

    /* ========== 贰 · 福田 CBD ========== */
    await ctx.step('立平安金融中心…');
    pingAnTower(ctx, -40, -190, 500);
    for (let i = 0; i < 8; i++) {
      const a = r() * Math.PI * 2, rr = 90 + r() * 120;
      cbdTower(ctx, -40 + Math.cos(a) * rr, -190 + Math.sin(a) * rr, 150 + r() * 190, i);
    }
    // 会展中轴绿带
    ctx.avenue(-40, -330, -40, -40, { w: 22, tree: 'plane', lamp: true });

    /* ========== 叁 · 罗湖 ========== */
    await ctx.step('起京基100…');
    kk100Tower(ctx, -280, -40, 442);
    cbdTower(ctx, -350, -90, 320, 1);
    cbdTower(ctx, -220, -110, 280, 2);
    cbdTower(ctx, -300, 40, 240, 3);
    for (let i = 0; i < 6; i++) cbdTower(ctx, -380 + r() * 220, -150 + r() * 260, 120 + r() * 130, i + 2);

    /* ========== 肆 · 南山春笋 ========== */
    await ctx.step('栽春笋…');
    chunSun(ctx, 280, 190, 390);
    for (let i = 0; i < 6; i++) cbdTower(ctx, 180 + r() * 220, 120 + r() * 160, 130 + r() * 170, i + 1);
    // 后海总部群
    cbdTower(ctx, 150, 250, 260, 2);
    cbdTower(ctx, 230, 280, 220, 3);
    cbdTower(ctx, 330, 260, 200, 4);

    /* ========== 伍 · 华强北霓虹峡谷 ========== */
    await ctx.step('亮华强北霓虹…');
    const neonCols = [0x30e0ff, 0xff3a8a, 0xffc23a, 0x53ff7a];
    for (let i = 0; i < 14; i++) {
      const x = -130 + i * 20;
      for (const sgn of [-1, 1]) {
        const bz = 60 + sgn * (16 + (i % 3) * 4);
        ctx.building(x, bz, { w: 16, d: 14, h: 40 + r() * 40, roof: 'flat', shop: true, shopTone: 2 });
      }
      // LED 广告牌
      const c = neonCols[i % 4];
      const m = ctx.mat('neon' + i, { color: c, emissive: c, emissiveIntensity: 0, roughness: 0.4 }, ['neon']);
      for (const sgn of [-1, 1]) {
        const px = x, pz = 60 + sgn * 12;
        const g = new ctx.THREE.BoxGeometry(1, 15 + r() * 10, 8);
        g.translate(px, 24, pz);
        ctx._push(m._key, g, m);
      }
    }
    ctx.mark('华强北霓虹街');

    /* ========== 陆 · 全城密林 ========== */
    await ctx.step('种下玻璃森林…');
    for (let i = 0; i < 70; i++) {
      const x = -560 + r() * 1120, z = -400 + r() * 640;
      if (z > 285) continue;
      if (Math.hypot(x + 40, z + 190) < 150) continue;
      if (Math.hypot(x - 280, z + 40) < 110) continue;
      if (Math.hypot(x + 280, z + 40) < 110) continue;
      if (Math.abs(x) < 150 && Math.abs(z - 60) < 60) continue;
      ctx.building(x, z, { w: 20 + r() * 16, d: 20 + r() * 16, h: 40 + r() * 160, roof: 'flat', shop: r() < 0.15 });
    }
    // 深南大道
    ctx.avenue(-560, -180, 560, -180, { w: 20, tree: 'plane', lamp: true });
    ctx.avenue(-400, 60, 400, 60, { w: 18, tree: 'plane', lamp: true });
    ctx.avenue(-300, -300, 300, -300, { w: 16, tree: 'plane', lamp: true });
    // 车流
    ctx.carLane({ x1: -540, z1: -180, x2: 540, z2: -180, n: 10, speed: 15 });
    ctx.carLane({ x1: -380, z1: 60, x2: 380, z2: 60, n: 9, speed: 14 });
    ctx.carLane({ x1: -150, z1: -260, x2: -150, z2: 280, n: 7, speed: 13 });
    // 滨海绿化
    for (let i = 0; i < 26; i++) ctx.tree(-560 + r() * 1120, 300 + r() * 60, { type: 'broad', scale: 0.85 + r() * 0.4 });
  },
};
