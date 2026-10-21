/* ============================================================
 * cities/shanghai.js —— 上海 · 陆家嘴 + 外滩
 * 东方明珠 / 上海中心 / 环球金融中心 / 金茂 / 国金双塔 /
 * 外滩万国建筑群 / 黄浦江游船
 * ========================================================== */
import { pearlTower, shanghaiTwist, swfcTower, jinmaoTower, ifcTwin, cbdTower } from '../lib/towers.js';
import { westernBuilding } from '../lib/heritage.js';

/** 画一条曲线河道（中心线 + 半宽 → 多边形） */
function paintRiver(ctx, pts, width) {
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[Math.max(0, i - 1)], n = pts[Math.min(pts.length - 1, i + 1)];
    const dx = n[0] - p[0], dz = n[1] - p[1], len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * width / 2, nz = dx / len * width / 2;
    L.push([pts[i][0] + nx, pts[i][1] + nz]);
    R.push([pts[i][0] - nx, pts[i][1] - nz]);
  }
  ctx.paintPoly(L.concat(R.reverse()), '#15242c');
  return { L, R };
}

export default {
  id: 'shanghai',
  name: '上海',
  subtitle: '魔都天际 · 浦江夜韵',
  camera: { radius: 1150, phi: 0.72, theta: 0.95, targetY: 80, minR: 160, maxR: 2300 },
  palette: {
    ground: 0x3b3e44, blotch: '104,108,116',
    road: 0x32353b, roadDash: 'rgba(235,225,195,.42)', curb: 0x74797f, plaza: 0x42464c,
    facades: [0x909499, 0x7e838a, 0x9da2a8, 0x70757d, 0xa8adb4],
    glassBase: '#2c4658', brickBase: 0x70757d, baseColor: 0x4a4e55,
    roofGold: 0xc9a227, tileBlack: 0x2b2e34,
    treeColors: { plane: 0x355030, willow: 0x6f7d3c, pine: 0x2d4a2c, broad: 0x405a34, pineTall: 0x27402c },
    waterDeep: 0x142834, waterShallow: 0x2e5060,
    fog: 0x5f6f80, fogMix: 0.4,
    skyTop: 0x1c3050, skyHorizon: 0xc98a5a,
  },

  async build(ctx) {
    const r = ctx.rng;
    /* ========== 壹 · 黄浦江 ========== */
    await ctx.step('引一浦江…');
    const river = paintRiver(ctx, [[540, -520], [320, -230], [150, -30], [-50, 180], [-190, 500]], 96);
    // 分段水面
    for (let i = 0; i < river.L.length - 1; i++) {
      const mx = (river.L[i][0] + river.R[i][0]) / 2, mz = (river.L[i][1] + river.R[i][1]) / 2;
      ctx.water(mx, mz, 96 + 8, Math.hypot(river.L[i][0] - river.L[i + 1][0], river.L[i][1] - river.L[i + 1][1]) + 10);
    }

    /* ========== 贰 · 陆家嘴 ========== */
    await ctx.step('立陆家嘴天际线…');
    pearlTower(ctx, 210, -230, 468);
    shanghaiTwist(ctx, 292, -168, 520);
    swfcTower(ctx, 148, -118, 492);
    jinmaoTower(ctx, 242, -282, 420);
    ifcTwin(ctx, 322, -238, 260);
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2, rr = 90 + r() * 110;
      const x = 235 + Math.cos(a) * rr, z = -200 + Math.sin(a) * rr;
      if (Math.hypot(x - 235, z + 200) < 80) continue;
      cbdTower(ctx, x, z, 110 + r() * 190, i);
    }
    // 陆家嘴环形天桥
    const ring = ctx.mat('ringBridge', { color: 0xd8dde2, roughness: 0.5, metalness: 0.3 });
    for (const [a, b] of [[[-90, 14], [90, 14]], [[90, 14], [90, 66]], [[90, 66], [-90, 66]], [[-90, 66], [-90, 14]]]) {
      ctx.beam([a, b], 5, 0.8, ring, 13);
    }

    /* ========== 叁 · 外滩 ========== */
    await ctx.step('起万国建筑群…');
    const bundY = [[-150, -40], [-135, 10], [-118, 60], [-100, 110], [-80, 158], [-58, 200]];
    const variants = ['peace', 'customs', 'hsbc', 'bund', 'bund', 'bund'];
    bundY.forEach(([x, z], i) => {
      westernBuilding(ctx, x, z, { w: 26 + (i % 2) * 6, d: 17, h: 20 + (i % 3) * 5, variant: variants[i], ry: Math.PI / 2, mark: i === 0 ? '外滩和平饭店' : null });
    });
    // 外滩观景平台
    for (let i = 0; i < 6; i++) {
      const x = -155 + i * 28, z = -30 + i * 46;
      ctx.box(14, 1.2, 10, x, 0.4, z, { mat: ctx.mat('bundPlaza', { color: 0x8a8d92, roughness: 0.85 }), ry: Math.PI / 2, cast: false });
    }
    // 陈毅广场雕像
    ctx.box(6, 3, 6, -120, 0.4, 40, { mat: ctx.mat('chenyiBase', { color: 0x6f7378, roughness: 0.8 }) });

    /* ========== 肆 · 浦江两岸 ========== */
    await ctx.step('点亮浦江两岸…');
    // 浦西老城厢
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const x0 = -560 + i * 88, z0 = -420 + j * 88;
      for (let k = 0; k < 4; k++) {
        const bx = x0 + 10 + r() * 60, bz = z0 + 10 + r() * 60;
        if (Math.hypot(bx + 100, bz - 60) < 110) continue; // 外滩留白
        ctx.building(bx, bz, { w: 20 + r() * 16, d: 20 + r() * 16, h: 25 + r() * 95, roof: 'flat', shop: r() < 0.2 });
      }
    }
    // 浦东腹地
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x0 = 380 + i * 80, z0 = -300 + j * 90;
      ctx.building(x0 + 12 + r() * 50, z0 + 12 + r() * 60, { w: 22, d: 22, h: 30 + r() * 90, roof: 'flat' });
      ctx.building(x0 + 50 + r() * 24, z0 + 60 + r() * 24, { w: 20, d: 20, h: 40 + r() * 90, roof: 'flat' });
    }
    // 苏州河北岸
    for (let i = 0; i < 20; i++) {
      ctx.building(-540 + r() * 1080, -500 + r() * 120, { w: 22, d: 20, h: 28 + r() * 70, roof: 'flat' });
    }
    // 南京东路 / 世纪大道
    ctx.avenue(-180, -40, 140, -210, { w: 16, tree: 'plane', lamp: true });
    ctx.avenue(210, -230, 330, 120, { w: 16, tree: 'plane', lamp: true });
    // 游船
    ctx.boat([[480, 0, -470], [280, 0, -190], [110, 0, -10], [-90, 0, 160], [-210, 0, 420]], { kind: 'youchuan', speed: 6 });
    ctx.boat([[-230, 0, 440], [-80, 0, 140], [140, 0, -40], [400, 0, -360]], { kind: 'youchuan', speed: 5 });
    // 车流
    ctx.carLane({ x1: -260, z1: 60, x2: 160, z2: -120, n: 8, speed: 13 });
    ctx.carLane({ x1: 120, z1: -260, x2: 360, z2: 60, n: 8, speed: 13 });
    ctx.carLane({ x1: -400, z1: -120, x2: 80, z2: -300, n: 6, speed: 12 });
    // 滨江绿带
    for (let i = 0; i < 30; i++) {
      const t = r(), x = -200 + r() * 420, z = -300 + r() * 560;
      ctx.tree(x, z, { type: r() < 0.5 ? 'plane' : 'willow', scale: 0.85 + r() * 0.4 });
    }
  },
};
