/* ============================================================
 * infra.js — 基础设施构件
 * 城墙 / 中华门瓮城 / 石拱桥 / 长江大桥 / 南京眼 / 城市高架 /
 * 轻轨穿楼 / 长江索道 / 洪崖洞 / 重庆来福士
 * ========================================================== */
import * as THREE from 'three';
import { gateTower, cornerTower } from './heritage.js';
import { hipRoof } from './roofs.js';

const wallMat = ctx => ctx.mat('cityWallBrick', { color: 0x5f6b66, roughness: 0.92 });
const wallTop = ctx => ctx.mat('cityWallTop', { color: 0x77837d, roughness: 0.85 });

/** 城墙（沿多边形路径，含雉堞 / 城门楼 / 角楼） */
export function cityWall(ctx, pts, { h = 13, w = 7, gates = [], corners = true, mark = '明城墙' } = {}) {
  ctx.mark(mark);
  const wm = wallMat(ctx), tm = wallTop(ctx);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % n];
    const len = Math.hypot(x2 - x1, z2 - z1), ry = Math.atan2(x2 - x1, z2 - z1);
    ctx.box(w, h, len, (x1 + x2) / 2, 0, (z1 + z2) / 2, { mat: wm, ry });
    ctx.merlons(x1, z1, x2, z2, h, 1.5, tm, 2.4);
    // 马道（内侧缓坡）
    ctx.box(w * 0.5, 0.3, len, (x1 + x2) / 2, h + 0.2, (z1 + z2) / 2, { mat: tm, ry, cast: false });
  }
  for (const g of gates) {
    const i = g.at % n;
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % n];
    const t = g.t || 0.5;
    gateTower(ctx, x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, {
      w: 18, h: h + 7, mark: g.mark || '城门楼', ry: Math.atan2(x2 - x1, z2 - z1) + Math.PI / 2, y0: h,
    });
  }
  if (corners) for (let i = 0; i < n; i++) cornerTower(ctx, pts[i][0], pts[i][1], { mark: '角楼', y0: h });
}

/** 中华门：三道瓮城 */
export function zhonghuaGate(ctx, x, z, { w = 46, h = 16, mark = '中华门' } = {}) {
  ctx.mark(mark);
  const wm = wallMat(ctx), dark = ctx.mat('zhonghuaDark', { color: 0x14171d, roughness: 0.95 });
  const gold = ctx.mat('zhonghuaGold', { color: 0xc8a03a, roughness: 0.4, metalness: 0.5 });
  const layers = [
    { z: 0, w: w, h: h },
    { z: 26, w: w * 0.82, h: h * 1.05 },
    { z: 52, w: w * 0.66, h: h * 1.1 },
  ];
  for (const L of layers) {
    ctx.box(L.w, L.h, 10, x, 0, z + L.z, { mat: wm });
    // 三道门洞（中洞大、两侧小）
    for (const [dx, dw] of [[0, 7], [-L.w * 0.26, 4.4], [L.w * 0.26, 4.4]]) {
      ctx.box(dw, L.h * 0.62, 1.2, x + dx, L.h * 0.19, z + L.z - 5.2, { mat: dark, cast: false });
      ctx.box(dw, 1.2, 10.4, x + dx, L.h * 0.19 + L.h * 0.62, z + L.z, { mat: wm, cast: false });
      // 门钉
      ctx.box(dw + 0.6, L.h * 0.5, 0.5, x + dx, L.h * 0.24, z + L.z - 5.0, { mat: gold, cast: false });
    }
    // 藏兵洞（侧壁小窗）
    for (let i = 0; i < 5; i++) {
      ctx.box(2.6, 2.2, 1, x - L.w / 2 + 4 + i * (L.w - 8) / 4, L.h * 0.42, z + L.z - 5.2, { mat: dark, cast: false });
    }
  }
  // 主城楼（重檐歇山）
  gateTower(ctx, x, z + 26, { w: w * 0.8, h: h * 1.9, mark: '中华门城楼' });
  // 瓮城草坪
  ctx.paintRect(x, z + 30, w * 0.8, 44, '#4d5244');
  return 0;
}

/** 石拱桥 */
export function archBridge(ctx, x, z, { len = 26, w = 8, span = 14, h = 7, mark = '石拱桥', ry = 0 } = {}) {
  ctx.mark(mark);
  const stone = ctx.mat('bridgeStone', { color: 0x9b968a, roughness: 0.88 });
  const dark = ctx.mat('bridgeDark', { color: 0x3a3d44, roughness: 0.95 });
  ctx.box(len, 1.2, w, x, h, z, { mat: stone, ry });
  const arch = new THREE.TorusGeometry(span / 2, w * 0.32, 10, 24, Math.PI);
  arch.rotateY(Math.PI / 2);
  arch.translate(x, h - 0.2, z);
  ctx._push(stone._key, arch, stone);
  // 栏杆
  for (const sgn of [-1, 1]) {
    ctx.box(len, 0.5, 0.5, x, h + 1.8, z + sgn * (w / 2 - 0.4), { mat: stone, ry, cast: false });
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const px = x - len / 2 + len * t;
      const ca = Math.cos(ry), sa = Math.sin(ry);
      ctx.box(0.4, 1.4, 0.4, px, h + 1.1, z + sgn * (w / 2 - 0.4), { mat: stone, cast: false });
    }
  }
  // 桥底黑暗
  ctx.box(len * 0.8, 0.4, w * 0.8, x, 0.2, z, { mat: dark, cast: false });
  return h;
}

/** 南京长江大桥：红色桥头堡 + 桁架 */
export function yangtzeBridge(ctx, x, z, { len = 210, h = 78, mark = '南京长江大桥', ry = 0 } = {}) {
  ctx.mark(mark);
  const red = ctx.mat('bridgeRed', { color: 0xa8332c, roughness: 0.6 });
  const gray = ctx.mat('bridgeGray', { color: 0x8d9298, roughness: 0.7, metalness: 0.3 });
  const deckY = h * 0.62;
  // 桥面 + 桁架
  ctx.box(len, 3.2, 15, x, deckY, z, { mat: gray, ry });
  const truss = Math.floor(len / 7);
  for (let i = 0; i < truss; i++) {
    const t = (i + 0.5) / truss;
    const px = x - len / 2 + len * t;
    const ca = Math.cos(ry), sa = Math.sin(ry);
    ctx.box(1.1, 5.5, 15, px, deckY - 4.3, z, { mat: gray, ry, cast: false });
    ctx.box(0.5, 0.5, 15, px, deckY - 6.8, z, { mat: gray, ry, cast: false });
  }
  // 双桥头堡（门式框架 + 三面红旗）
  for (const sgn of [-1, 1]) {
    const tx = x + sgn * len * 0.3, tz = z;
    const ca = Math.cos(ry), sa = Math.sin(ry);
    const bx = tx - sa * 6, bz = tz - ca * 6;
    const bx2 = tx + sa * 6, bz2 = tz + ca * 6;
    for (const [px, pz] of [[bx, bz], [bx2, bz2]]) {
      ctx.box(6, h, 6, px, 0, pz, { mat: red });
    }
    // 横梁
    ctx.beam([[bx, deckY, bz], [bx2, deckY, bz2]], 4, 3.5, red);
    ctx.beam([[bx, h * 0.5, bz], [bx2, h * 0.5, bz2]], 3, 2.5, red);
    // 三面红旗
    for (let k = -1; k <= 1; k++) {
      const fx = tx + sa * k * 4.2, fz = tz + ca * k * 4.2;
      ctx.box(0.4, 10, 6, fx, h + 3, fz, { mat: ctx.mat('bridgeFlag', { color: 0xd83a2a, roughness: 0.6 }), rz: 0.35, cast: false });
    }
    // 桥墩
    ctx.cyl(9, 11, 14, tx, -4, tz, { mat: gray, seg: 10, ry });
  }
  // 引桥
  for (const sgn of [-1, 1]) {
    const ex = x + sgn * (len / 2 + 40);
    ctx.beam([[x + sgn * len / 2, deckY - 8, z], [ex, 0, z]], 15, 2, gray);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      ctx.cyl(3, 3.5, deckY - 8 - (deckY - 8) * t, x + sgn * (len / 2 + 40 * t), 0, z, { mat: gray, seg: 6, ry });
    }
  }
  return h;
}

/** 南京眼：白色拱塔步行桥 */
export function nanjingEye(ctx, x, z, { r = 62, mark = '南京眼', ry = 0 } = {}) {
  ctx.mark(mark);
  const white = ctx.mat('eyeWhite', { color: 0xe8e8e4, roughness: 0.5, metalness: 0.15 });
  const steel = ctx.mat('eyeSteel', { color: 0xb9bec4, roughness: 0.5, metalness: 0.4 });
  const arch = new THREE.TorusGeometry(r, 2.2, 10, 40, Math.PI);
  arch.scale(1, 0.82, 1);
  arch.rotateZ(0.12);
  arch.translate(x, 2, z);
  ctx._push(white._key, arch, white);
  // 桥面
  ctx.box(r * 2.05, 1.4, 7, x, 2.6, z, { mat: white, ry });
  // 拉索
  for (let i = 1; i <= 9; i++) {
    const t = i / 10;
    const ax = x - r + r * 2 * t;
    const ay = 2 + Math.sin(t * Math.PI) * r * 0.82 * 0.94 + 2;
    ctx.cyl(0.09, 0.09, ay - 3, ax, 3, z, { mat: steel, seg: 3, cast: false });
  }
  return r;
}

/** 城市高架 */
export function viaduct(ctx, pts, { w = 15, h = 13, mark = null } = {}) {
  if (mark) ctx.mark(mark);
  const deck = ctx.mat('viaductDeck', { color: 0x6a6e75, roughness: 0.9 });
  const pier = ctx.mat('viaductPier', { color: 0x8d9298, roughness: 0.85 });
  ctx.beam(pts, w, 1.1, deck, h);
  for (const sgn of [-1, 1]) ctx.beam(pts, 0.5, 1.3, ctx.mat('viaductRail', { color: 0xd8d4c8, roughness: 0.7 }), h + 1.4);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.floor(len / 26));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      ctx.cyl(2.2, 2.8, h, x1 + (x2 - x1) * t, 0, z1 + (z2 - z1) * t, { mat: pier, seg: 8 });
    }
  }
}

/** 轻轨穿楼（李子坝）：返回列车路径 */
export function monorailThroughBuilding(ctx, x, z, { h = 60, mark = '轻轨穿楼' } = {}) {
  ctx.mark(mark);
  const body = ctx.facade(2);
  const gapY = h * 0.42, gapH = 9;
  // 楼体（中间留门洞）
  ctx.box(30, gapY, 22, x, 0, z, { mat: body });
  ctx.box(30, h - gapY - gapH, 22, x, gapY + gapH, z, { mat: body });
  for (const sz of [-1, 1]) {
    ctx.box(30, gapY, (22 - 11) / 2, x, 0, z + sz * (11 + (22 - 11) / 4), { mat: body });
  }
  // 门洞过梁
  ctx.box(30, 1.4, 22, x, gapY - 0.7, z, { mat: ctx.mat('lizibaLintel', { color: 0xcfc6b4, roughness: 0.8 }), cast: false });
  // 声屏障
  for (const sz of [-1, 1]) ctx.box(30, 3.4, 0.3, x, gapY + gapH + 0.2, z + sz * 5.8, { mat: ctx.mat('lizibaBarrier', { color: 0xdfe3e8, roughness: 0.5, metalness: 0.3, transparent: true, opacity: 0.55 }), cast: false });
  // 轨道梁 + 桥墩
  const pts = [[x - 150, 0, z], [x, 0, z], [x + 150, 0, z]];
  ctx.beam(pts.map(p => [p[0], p[2]]), 4.5, 0.8, ctx.mat('monoBeam', { color: 0xaab0b8, roughness: 0.6, metalness: 0.4 }), gapY + gapH + 1.6);
  for (const px of [x - 150, x - 75, x + 75, x + 150]) {
    ctx.cyl(2, 2.6, gapY + gapH + 1.6, px, 0, z, { mat: ctx.mat('monoPier', { color: 0x8d9298, roughness: 0.85 }), seg: 8 });
  }
  return [[x - 170, gapY + gapH + 4.6, z], [x + 170, gapY + gapH + 4.6, z]];
}

/** 长江索道 */
export function cableCar(ctx, x1, z1, x2, z2, { h = 46, mark = '长江索道' } = {}) {
  ctx.mark(mark);
  const steel = ctx.mat('cableSteel', { color: 0x9aa2ab, roughness: 0.5, metalness: 0.6 });
  const cabin = ctx.mat('cableCabin', { color: 0xc0392b, roughness: 0.5, emissive: 0x3a0d08, emissiveIntensity: 0 }, ['neon']);
  for (const [px, pz] of [[x1, z1], [x2, z2]]) {
    ctx.cyl(1.2, 2, h, px, 0, pz, { mat: steel, seg: 8 });
    ctx.box(8, 1.6, 8, px, h, pz, { mat: steel, cast: false });
  }
  ctx.beam([[x1, z1], [x2, z2]], 0.7, 0.7, steel, h);
  ctx.beam([[x1, z1], [x2, z2]], 0.7, 0.7, steel, h - 1.4);
  // 吊厢（往返）
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 4.2), cabin);
  box.position.y = -2.6;
  g.add(box);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), steel);
  g.add(top);
  ctx.root.add(g);
  let s = 0, dir = 1;
  ctx.onTick((dt) => {
    s += dir * dt * 0.045;
    if (s > 1) { s = 1; dir = -1; }
    if (s < 0) { s = 0; dir = 1; }
    g.position.set(x1 + (x2 - x1) * s, h - 1.4, z1 + (z2 - z1) * s);
    g.position.y += Math.sin(s * 40) * 0.15;
  });
  ctx.stats.vehicles++;
  return g;
}

/** 洪崖洞：崖壁吊脚楼群 */
export function hongyadong(ctx, x, z, { w = 60, h = 46, mark = '洪崖洞' } = {}) {
  ctx.mark(mark);
  const cliff = ctx.mat('cliff', { color: 0x5a4f42, roughness: 0.95 });
  const wood = ctx.mat('hyWood', { color: 0x6b4a2c, roughness: 0.8 });
  const wall = ctx.mat('hyWall', { color: 0x8a7a62, roughness: 0.85 });
  const win = ctx.mat('hyWin', { color: 0xffc276, emissive: 0xff9a3c, emissiveIntensity: 0, roughness: 0.4 }, ['lamp', 'window']);
  const roofM = ctx.mat('hyRoof', { color: 0x2c2f36, roughness: 0.75 });
  // 崖壁（阶梯式后退）
  const floors = 9;
  for (let i = 0; i < floors; i++) {
    const t = i / floors;
    const inset = w * 0.5 * t;
    ctx.box(w - inset * 2, h / floors, 26, x, i * h / floors, z + inset * 0.55, { mat: cliff, cast: false });
    // 吊脚楼
    const bw = 7 + (i % 2) * 2;
    for (let k = 0; k < 4; k++) {
      const bx = x - (w - inset * 2) / 2 + 6 + k * ((w - inset * 2 - 12) / 3);
      const by = (i + 1) * h / floors;
      ctx.box(bw, 4.6, 8, bx, by - 4.6, z + inset * 0.55 + 6, { mat: wall });
      hipRoof(ctx, bx, by, z + inset * 0.55 + 6, bw, 8, { mat: roofM, eave: 0.4 });
      ctx.box(bw * 0.4, 1.8, 0.3, bx, by - 3.4, z + inset * 0.55 + 10.1, { mat: win, cast: false });
    }
  }
  // 底部支撑柱（吊脚）
  for (let i = 0; i < floors; i++) {
    const t = i / floors, inset = w * 0.5 * t;
    for (const sx of [-1, 1]) ctx.cyl(0.5, 0.5, 5, x + sx * (w / 2 - inset - 1), 0, z + inset * 0.55 + 10, { mat: wood, seg: 5 });
  }
  // 灯笼串
  for (let i = 0; i < 14; i++) ctx.lantern(x - w / 3 + (i % 7) * (w / 7), 2 + (i > 6 ? 5 : 0), z + 14 + (i > 6 ? 2 : 0), 1.1);
  return h;
}

/** 重庆来福士：四塔 + 水晶连廊 */
export function rafflesCity(ctx, x, z, { h = 320, mark = '重庆来福士' } = {}) {
  ctx.mark(mark);
  const g = ctx.glass(1);
  const crystal = ctx.mat('rafflesCrystal', {
    color: 0xbfe0e8, roughness: 0.1, metalness: 0.6,
    transparent: true, opacity: 0.5, emissive: 0x7fd4e8, emissiveIntensity: 0,
  }, ['neon', 'window']);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ctx.cyl(16, 26, h, x + sx * 30, 0, z + sz * 26, { mat: g, seg: 4, ry: Math.PI / 4 });
  }
  // 水晶连廊（顶部横向弧段）
  const seg = 26;
  for (let i = 0; i < seg; i++) {
    const t = i / (seg - 1);
    const px = x - 62 + 124 * t;
    const py = h * 0.9 + Math.sin(t * Math.PI) * -14 + 14;
    ctx.box(5.2, 5.2, 22, px, py, z, { mat: crystal, rz: Math.cos(t * Math.PI) * -0.06, cast: false });
  }
  return h;
}
