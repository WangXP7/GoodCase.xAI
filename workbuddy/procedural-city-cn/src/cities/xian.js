/* ============================================================
 * cities/xian.js —— 西安 · 古都长安
 * 完整明城墙 + 护城河 + 永宁门 / 钟楼 / 鼓楼 / 大雁塔 /
 * 小雁塔 / 秦岭 / 曲江池 / 仿唐街区
 * ========================================================== */
import { pagoda, bellTower, templeHall } from '../lib/heritage.js';
import { cityWall, archBridge } from '../lib/infra.js';

const WALL = [[-260, -300], [260, -300], [260, 300], [-260, 300]];

export default {
  id: 'xian',
  name: '西安',
  subtitle: '长安十二时辰 · 古都',
  camera: { radius: 1150, phi: 0.78, theta: 0.72, targetY: 30, minR: 160, maxR: 2300 },
  palette: {
    ground: 0x4b4539, blotch: '122,112,92',
    road: 0x3b362c, roadDash: 'rgba(232,212,162,.5)', curb: 0x8b8069, plaza: 0x51493d,
    facades: [0x9c8c6e, 0x8c7c5e, 0xaa9a7a, 0x7c6e54, 0xb2a27a],
    glassBase: '#3a4c56', brickBase: 0x7c7160, baseColor: 0x5c5346,
    roofGold: 0xd8b23a, tileBlack: 0x302d28,
    treeColors: { plane: 0x4c5c32, willow: 0x7c8c3e, pine: 0x2f4a2e, broad: 0x4c5c36, pineTall: 0x2d422d },
    waterDeep: 0x26383a, waterShallow: 0x48625e,
    fog: 0xa89478, fogMix: 0.4,
    skyTop: 0x3a5a8a, skyHorizon: 0xe0b078,
  },

  async build(ctx) {
    const r = ctx.rng;
    /* ========== 壹 · 秦岭与曲江 ========== */
    await ctx.step('望秦岭 · 引曲江…');
    ctx.ridge(430, -520, 520, 110, 240, ctx.mat('qinling', { color: 0x3f5a6a, roughness: 1 }));
    ctx.ridge(380, -520, 520, 70, 160, ctx.mat('qinling2', { color: 0x47647a, roughness: 1 }));
    // 曲江池
    ctx.paintPoly([[90, 300], [260, 300], [260, 400], [90, 400]], '#1c2b2a');
    ctx.water(175, 350, 170, 100);
    for (let i = 0; i < 8; i++) ctx.tree(100 + r() * 150, 305 + r() * 90, { type: 'willow', scale: 0.9 + r() * 0.4 });

    /* ========== 贰 · 明城墙与护城河 ========== */
    await ctx.step('砌城墙 · 引护城河…');
    // 护城河（四段 + 角部）
    const moat = [[-332, -372], [332, -372], [332, 372], [-332, 372]];
    const inner = [[-260, -300], [260, -300], [260, 300], [-260, 300]];
    ctx.paintPoly(moat, '#1d2b29');
    ctx.paintPoly(inner, ctx.palette.ground);
    ctx.water(0, -336, 664, 72);
    ctx.water(0, 336, 664, 72);
    ctx.water(-336, 0, 72, 744);
    ctx.water(336, 0, 72, 744);
    cityWall(ctx, WALL, {
      h: 16, w: 8, mark: '西安明城墙',
      gates: [
        { at: 3, t: 0.5, mark: '永宁门' },
        { at: 1, t: 0.5, mark: '长乐门' },
        { at: 0, t: 0.5, mark: '安远门' },
        { at: 2, t: 0.5, mark: '安定门' },
      ],
    });
    // 护城河桥（四门吊桥）
    for (const [bx, bz] of [[0, -336], [0, 336], [-336, 0], [336, 0]]) {
      ctx.beam([[bx, bz], [bx, bz + (bz === 0 ? 0 : (bz > 0 ? 90 : -90))]], 12, 0.8, ctx.mat('drawBridge', { color: 0x8b8069, roughness: 0.85 }), 1.2);
    }
    archBridge(ctx, 0, -336, { len: 30, w: 10, span: 15, h: 4, mark: '永宁门护城河桥' });

    /* ========== 叁 · 长安中轴 ========== */
    await ctx.step('立钟鼓 · 建大雁塔…');
    // 钟楼（居中，四门洞开）
    ctx.paintRect(0, 0, 90, 90, '#52493d');
    bellTower(ctx, 0, 0, { h: 36, mark: '钟楼', gold: true });
    // 鼓楼
    ctx.paintRect(-80, 70, 70, 70, '#52493d');
    bellTower(ctx, -80, 70, { h: 34, mark: '鼓楼', gold: true });
    // 大雁塔 / 小雁塔
    ctx.paintRect(150, -220, 90, 90, '#52493d');
    pagoda(ctx, 150, -220, { h: 64, tiers: 7, mark: '大雁塔', brick: 0x9a8a72 });
    ctx.paintRect(-150, -180, 70, 70, '#52493d');
    pagoda(ctx, -150, -180, { h: 43, tiers: 13, mark: '小雁塔', brick: 0x96866e });
    // 大唐不夜城（仿唐街区）
    for (let i = 0; i < 14; i++) {
      const x = 60 + (i % 7) * 34, z = 90 + Math.floor(i / 7) * 60;
      ctx.building(x, z, { w: 22, d: 18, h: 12 + r() * 6, roof: { type: 'gold' } });
    }
    ctx.mark('大唐不夜城');

    /* ========== 肆 · 坊里街巷 ========== */
    await ctx.step('点坊灯 · 植国槐…');
    // 棋盘式街巷（城内限高）
    const v = [-200, -120, -40, 40, 120, 200];
    const h = [-220, -130, -40, 50, 140, 230];
    for (const x of v) ctx.road(x, -295, x, 295, 12, { lantern: false });
    for (const z of h) ctx.road(-255, z, 255, z, 12);
    for (let i = 0; i < v.length - 1; i++) for (let j = 0; j < h.length - 1; j++) {
      const x0 = v[i] + 8, z0 = h[j] + 8, x1 = v[i + 1] - 8, z1 = h[j + 1] - 8;
      if (Math.hypot((x0 + x1) / 2, (z0 + z1) / 2) < 55) continue;
      for (let x = x0 + 14; x < x1 - 6; x += 30) for (let z = z0 + 14; z < z1 - 6; z += 30) {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        if (Math.hypot(x - cx, z - cz) < 40) continue;
        ctx.building(x + (r() - 0.5) * 5, z + (r() - 0.5) * 5, {
          w: 16 + r() * 8, d: 16 + r() * 8, h: 11 + r() * 16,
          roof: r() < 0.35 ? { type: r() < 0.6 ? 'gold' : 'green' } : 'flat',
        });
      }
    }
    // 仿唐屋顶点缀（全城）
    for (let i = 0; i < 10; i++) {
      ctx.building(-240 + r() * 480, -280 + r() * 560, { w: 18, d: 18, h: 10 + r() * 8, roof: { type: 'gold' } });
    }
    // 红灯笼（城中轴线）
    for (let i = 0; i < 24; i++) ctx.lantern(-230 + i * 20, 4.6, 3, 1);
    for (let i = 0; i < 24; i++) ctx.lantern(3, 4.6, -230 + i * 20, 1);
    // 国槐行道树
    for (let i = 0; i < 60; i++) {
      ctx.tree(-255 + r() * 510, -295 + r() * 590, { type: r() < 0.6 ? 'plane' : 'broad', scale: 0.85 + r() * 0.4 });
    }
    // 城外新区
    for (let i = 0; i < 40; i++) {
      const x = -560 + r() * 1120, z = -560 + r() * 1120;
      if (Math.abs(x) < 380 && Math.abs(z) < 420) continue;
      ctx.building(x, z, { w: 20 + r() * 14, d: 20 + r() * 14, h: 25 + r() * 100, roof: 'flat' });
    }
    // 车马流
    ctx.carLane({ x1: -240, z1: 0, x2: 240, z2: 0, n: 8, speed: 12 });
    ctx.carLane({ x1: 0, z1: -260, x2: 0, z2: 260, n: 8, speed: 12 });
    ctx.carLane({ x1: -180, z1: -200, x2: 200, z2: 200, n: 5, speed: 11 });
  },
};
