/* ============================================================
 * heritage.js — 传统 / 历史建筑构件
 * 大雁塔 / 钟鼓楼 / 庙殿 / 中山陵 / 阅江楼 / 琉璃塔 / 佛顶宫 /
 * 总统府 / 民国建筑 / 孙中山铜像 / 外滩万国建筑 / 江南民居
 * ========================================================== */
import * as THREE from 'three';
import { hipRoof, gableRoof, paifang, screenWall } from './roofs.js';

const granite = ctx => ctx.mat('granite', { color: 0xa8a49a, roughness: 0.85 });
const redPillar = ctx => ctx.mat('redPillar', { color: 0x8a2f22, roughness: 0.55 });
const goldRoof = ctx => ctx.mat('roofGoldH', { color: 0xd8b23a, roughness: 0.42, metalness: 0.3 });
const greenRoof = ctx => ctx.mat('roofGreenH', { color: 0x2e6b4f, roughness: 0.5, metalness: 0.2 });
const blueRoof = ctx => ctx.mat('roofBlueH', { color: 0x2b4f8a, roughness: 0.5, metalness: 0.2 });

/** 大雁塔式方塔 */
export function pagoda(ctx, x, z, { h = 64, tiers = 7, mark = '大雁塔', brick = 0x9a9384, y0 = 0 } = {}) {
  ctx.mark(mark);
  const body = ctx.mat('pagodaBody', { color: brick, roughness: 0.88 });
  const eave = ctx.mat('pagodaEave', { color: 0x4a4f57, roughness: 0.7 });
  let w = h * 0.24, y = y0;
  ctx.box(w + 8, 4, w + 8, x, y, z, { mat: granite(ctx) });
  for (let i = 0; i < tiers; i++) {
    const th = h / tiers * (i === 0 ? 0.9 : 1);
    ctx.box(w, th, w, x, y, z, { mat: body });
    ctx.box(w + 3.4, 1.1, w + 3.4, x, y + th, z, { mat: eave, cast: false });
    y += th + 1.1;
    w *= 0.9;
  }
  ctx.cyl(0.5, 2.4, 10, x, y, z, { mat: goldRoof(ctx), seg: 6 });
  return h;
}

/** 钟楼 / 鼓楼 */
export function bellTower(ctx, x, z, { h = 34, mark = '钟楼', gold = true, y0 = 0 } = {}) {
  ctx.mark(mark);
  const w = h * 0.62;
  // 台基 + 券洞
  ctx.box(w + 10, h * 0.34, w + 10, x, y0, z, { mat: granite(ctx) });
  const dark = ctx.mat('archDark', { color: 0x1c1f26, roughness: 0.9 });
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    ctx.box(w * 0.26, h * 0.2, 1.2, x + dx * (w / 2 + 5), y0 + h * 0.07, z + dz * (w / 2 + 5), { mat: dark, cast: false });
  }
  // 红柱回廊
  const py = y0 + h * 0.34;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ctx.cyl(0.9, 1, h * 0.3, x + sx * w * 0.4, py, z + sz * w * 0.4, { mat: redPillar(ctx), seg: 8 });
  }
  ctx.box(w + 2, h * 0.06, w + 2, x, py + h * 0.3, z, { mat: redPillar(ctx), cast: false });
  hipRoof(ctx, x, py + h * 0.36, z, w * 0.98, w * 0.98, { mat: gold ? goldRoof(ctx) : greenRoof(ctx), eave: 1.1, tiers: 2 });
  ctx.cyl(0.3, 1.2, 6, x, py + h * 0.36 + h * 0.5, z, { mat: goldRoof(ctx), seg: 4 });
  return h;
}

/** 庙殿 / 大成殿：白石台基 + 红柱 + 金（绿）瓦重檐 */
export function templeHall(ctx, x, z, { w = 30, d = 18, h = 16, mark = '庙殿', roof = 'gold', tiers = 2, y0 = 0 } = {}) {
  ctx.mark(mark);
  ctx.box(w + 12, 2.2, d + 10, x, y0, z, { mat: granite(ctx) });
  const py = y0 + 2.2;
  ctx.box(w, h * 0.42, d, x, py, z, { mat: ctx.mat('templeWall', { color: 0xb8b2a4, roughness: 0.85 }) });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ctx.cyl(0.8, 0.9, h * 0.5, x + sx * (w / 2 - 1.5), py, z + sz * (d / 2 - 1.2), { mat: redPillar(ctx), seg: 8 });
  }
  const rm = roof === 'gold' ? goldRoof(ctx) : roof === 'green' ? greenRoof(ctx) : blueRoof(ctx);
  hipRoof(ctx, x, py + h * 0.5, z, w + 3, d + 3, { mat: rm, eave: 1.2, tiers });
  return h;
}

/** 中山陵：台阶 + 碑亭 + 蓝色琉璃瓦祭堂（y0 = 台地标高） */
export function sunYatSenMausoleum(ctx, x, z, { scale = 1, mark = '中山陵', y0 = 0 } = {}) {
  ctx.mark(mark);
  const white = ctx.mat('mausoleumWhite', { color: 0xe8e6de, roughness: 0.6 });
  const blue = blueRoof(ctx);
  // 392 级台阶（压缩为 14 级大台阶）
  const steps = 14, stepW = 26, run = 4.2, rise = 1.15;
  for (let i = 0; i < steps; i++) {
    ctx.box(stepW - i * 0.6, rise, run, x, y0 + i * rise, z - i * run, { mat: white, cast: false });
  }
  const topY = y0 + steps * rise, topZ = z - steps * run;
  // 两侧栏杆墙
  for (const sgn of [-1, 1]) {
    ctx.box(0.8, 1.1, steps * run, x + sgn * (stepW / 2 + 0.2), y0, z - steps * run / 2, { mat: white, cast: false });
  }
  // 碑亭
  const px = x, pz = topZ - 22;
  ctx.box(11, 0.6, 11, px, topY, pz, { mat: white });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ctx.cyl(0.7, 0.8, 8, px + sx * 4.4, topY + 0.6, pz + sz * 4.4, { mat: white, seg: 8 });
  }
  hipRoof(ctx, px, topY + 8.6, pz, 11, 11, { mat: blue, eave: 1.1 });
  // 祭堂
  const hx = x, hz = topZ - 58;
  ctx.box(38, 3, 34, hx, topY, hz, { mat: white });
  ctx.box(26, 15, 20, hx, topY + 3, hz, { mat: white });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ctx.cyl(1.1, 1.2, 15, hx + sx * 12, topY + 3, hz + sz * 8.6, { mat: white, seg: 8 });
  }
  hipRoof(ctx, hx, topY + 18, hz, 30, 24, { mat: blue, eave: 1.4, tiers: 2 });
  ctx.cyl(0.5, 1.6, 5, hx, topY + 18 + 16, hz, { mat: goldRoof(ctx), seg: 6 });
  return 0; // 高度由地形承载
}

/** 阅江楼：三层绿瓦朱楹 */
export function yuejiangTower(ctx, x, z, { h = 44, mark = '阅江楼', y0 = 0 } = {}) {
  ctx.mark(mark);
  const w = h * 0.34;
  ctx.box(w + 14, 5, w + 14, x, y0, z, { mat: granite(ctx) });
  let y = y0 + 5, cw = w;
  for (let i = 0; i < 3; i++) {
    const th = h * 0.24;
    ctx.box(cw, th, cw, x, y, z, { mat: ctx.mat('yuejiangWall', { color: 0xa8542c, roughness: 0.7 }) });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      ctx.cyl(0.9, 1, th, x + sx * (cw / 2 - 1.2), y, z + sz * (cw / 2 - 1.2), { mat: redPillar(ctx), seg: 8 });
    }
    hipRoof(ctx, x, y + th, z, cw + 2.4, cw + 2.4, { mat: greenRoof(ctx), eave: 1.2, tiers: i === 2 ? 2 : 1 });
    y += th + 3.2;
    cw *= 0.86;
  }
  ctx.cyl(0.4, 1.4, 7, x, y, z, { mat: goldRoof(ctx), seg: 4 });
  return h;
}

/** 大报恩寺琉璃塔：九层八面玻璃塔 */
export function porcelainPagoda(ctx, x, z, { h = 88, mark = '大报恩寺琉璃塔', y0 = 0 } = {}) {
  ctx.mark(mark);
  const glass = ctx.mat('liuliGlass', {
    color: 0xdfe8ea, roughness: 0.15, metalness: 0.3,
    transparent: true, opacity: 0.42, emissive: 0xffe0b0, emissiveIntensity: 0,
  }, ['window', 'neon']);
  const gold = ctx.mat('liuliGold', { color: 0xd8b23a, roughness: 0.35, metalness: 0.55 });
  ctx.box(30, 3, 30, x, y0, z, { mat: granite(ctx) });
  let r = 11, y = y0 + 3;
  for (let i = 0; i < 9; i++) {
    const th = h / 9 * (i < 3 ? 0.82 : 1);
    ctx.cyl(r, r * 0.94, th, x, y, z, { mat: glass, seg: 8 });
    ctx.cyl(r + 1.2, r + 1.2, 0.7, x, y + th, z, { mat: gold, seg: 8, cast: false });
    y += th + 0.7;
    r *= 0.93;
  }
  ctx.cyl(0.6, 2.6, 14, x, y, z, { mat: gold, seg: 6 });
  return h;
}

/** 牛首山佛顶宫：金顶大穹窿 */
export function fodingPalace(ctx, x, z, { r = 40, mark = '牛首山佛顶宫', y0 = 0 } = {}) {
  ctx.mark(mark);
  const white = ctx.mat('fodingWhite', { color: 0xe6e2d8, roughness: 0.55 });
  const gold = ctx.mat('fodingGold', { color: 0xc9a227, roughness: 0.3, metalness: 0.6 });
  ctx.box(r * 2.3, 10, r * 2.3, x, y0 - 4, z, { mat: granite(ctx) });
  for (let i = 0; i < 3; i++) ctx.box(r * 2.1 - i * r * 0.5, 1.6, r * 2.1 - i * r * 0.5, x, y0 + 6 + i * 1.6, z, { mat: white, cast: false });
  // 主穹顶
  const dome = new THREE.SphereGeometry(r, 26, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.78, 1);
  dome.translate(x, y0 + 9.8, z);
  ctx._push(gold._key, dome, gold);
  // 穹顶环饰
  ctx.cyl(r * 1.02, r * 1.02, 1.6, x, y0 + 9.8, z, { mat: white, seg: 26, cast: false });
  // 四角小塔
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const tx = x + sx * r * 1.5, tz = z + sz * r * 1.5;
    ctx.cyl(3, 3.4, 14, tx, y0 + 6, tz, { mat: white, seg: 8 });
    ctx.cyl(3.6, 3.6, 1, tx, y0 + 20, tz, { mat: gold, seg: 8, cast: false });
  }
  ctx.cyl(1, 3, 12, x, y0 + 9.8 + r * 0.78, z, { mat: gold, seg: 8 });
  return r * 2;
}

/** 总统府：门楼 + 西式主楼 + 围墙 */
export function presidentialPalace(ctx, x, z, { mark = '总统府' } = {}) {
  ctx.mark(mark);
  const stone = ctx.mat('presiStone', { color: 0xcfc6b4, roughness: 0.8 });
  const red = ctx.mat('presiRed', { color: 0x8a2f22, roughness: 0.6 });
  // 围墙
  ctx.beam([[-46, -30], [-46, 34]], 1.2, 4, stone);
  ctx.beam([[46, -30], [46, 34]], 1.2, 4, stone);
  ctx.beam([[-46, 34], [46, 34]], 1.2, 4, stone);
  // 门楼
  ctx.box(16, 9, 8, x, 0, z + 32, { mat: red });
  ctx.box(17, 1, 9, x, 9, z + 32, { mat: stone, cast: false });
  hipRoof(ctx, x, 10, z + 32, 15, 7.5, { mat: greenRoof(ctx), eave: 0.9 });
  ctx.box(7, 3.4, 0.4, x, 3.5, z + 27.8, { mat: ctx.mat('presiPlaque', { color: 0x2c2f36, roughness: 0.5, metalness: 0.4 }, ['neon']), cast: false });
  // 西式主楼（柱廊 + 山花）
  ctx.box(34, 11, 16, x, 0, z, { mat: stone });
  for (let i = 0; i < 6; i++) ctx.cyl(0.9, 1, 8, x - 12.5 + i * 5, 0, z - 9, { mat: stone, seg: 8 });
  const ped = new THREE.Shape();
  ped.moveTo(-9, 0); ped.lineTo(9, 0); ped.lineTo(0, 4.6); ped.closePath();
  const pg = new THREE.ExtrudeGeometry(ped, { depth: 1.4, bevelEnabled: false });
  pg.translate(x, 11, z - 9.8);
  ctx._push(stone._key, pg, stone);
  // 子超楼
  ctx.box(14, 16, 12, x + 26, 0, z + 12, { mat: ctx.facade(1) });
  return 0;
}

/** 孙中山铜像（新街口） */
export function sunYatSenStatue(ctx, x, z, { mark = '孙中山铜像' } = {}) {
  ctx.mark(mark);
  const bronze = ctx.mat('bronze', { color: 0x8a6a3a, roughness: 0.45, metalness: 0.65 });
  const stone = granite(ctx);
  ctx.box(12, 1.6, 12, x, 0, z, { mat: stone });
  ctx.box(10.4, 1.6, 10.4, x, 1.6, z, { mat: stone });
  ctx.box(8.4, 3.2, 8.4, x, 3.2, z, { mat: stone });
  const y = 6.4;
  // 人物（简化立柱身形）
  ctx.box(2.6, 5.6, 1.8, x, y, z, { mat: bronze });
  ctx.box(2.0, 1.8, 1.5, x, y + 5.6, z, { mat: bronze });
  ctx.cyl(0.62, 0.68, 0.8, x, y + 7.4, z, { mat: bronze, seg: 10 });
  for (const sgn of [-1, 1]) ctx.box(0.7, 3.6, 0.7, x + sgn * 1.7, y + 1.2, z + 0.5, { mat: bronze, rz: sgn * 0.12 });
  return 0;
}

/** 外滩万国建筑群 */
export function westernBuilding(ctx, x, z, { w = 26, d = 18, h = 22, variant = 'bund', ry = 0, mark = null } = {}) {
  if (mark) ctx.mark(mark);
  const stone = ctx.mat('bundStone', { color: 0xd6cdba, roughness: 0.78 });
  const gray = ctx.mat('bundGray', { color: 0xa9a496, roughness: 0.8 });
  const green = ctx.mat('bundGreen', { color: 0x2e6b4f, roughness: 0.55, metalness: 0.25 });
  const body = variant === 'hsbc' ? stone : gray;
  ctx.box(w, h, d, x, 0, z, { mat: body, ry });
  ctx.box(w + 1.4, 1.2, d + 1.4, x, h, z, { mat: stone, ry, cast: false });
  if (variant === 'peace') {           // 和平饭店：绿金字塔 + 钟
    ctx.box(w * 0.34, 12, d * 0.4, x, h, z, { mat: gray, ry });
    ctx.cyl(0.02, w * 0.24, 9, x, h + 12, z, { mat: green, ry: Math.PI / 4, seg: 4 });
    ctx.cyl(1.6, 1.6, 0.5, x, h + 8.5, z + d * 0.21, { mat: ctx.mat('clockFace', { color: 0xf0ead8, emissive: 0xffe8b0, emissiveIntensity: 0 }, ['lamp']), ry: Math.PI / 2, seg: 16 });
  } else if (variant === 'customs') {  // 江海关钟楼
    ctx.box(w * 0.3, 18, d * 0.34, x, h, z, { mat: gray, ry });
    ctx.cyl(0.02, w * 0.21, 8, x, h + 18, z, { mat: green, ry: Math.PI / 4, seg: 4 });
    ctx.cyl(1.8, 1.8, 0.5, x, h + 12, z + d * 0.18, { mat: ctx.mat('clockFace2', { color: 0xf0ead8, emissive: 0xffe8b0, emissiveIntensity: 0 }, ['lamp']), ry: Math.PI / 2, seg: 16 });
  } else if (variant === 'hsbc') {     // 汇丰：穹顶
    ctx.cyl(5.5, 6.5, 8, x, h, z, { mat: stone, seg: 10 });
    const dome = new THREE.SphereGeometry(5, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(x, h + 8, z);
    ctx._push(stone._key, dome, stone);
    ctx.cyl(0.3, 1, 5, x, h + 13, z, { mat: ctx.mat('spire', { color: 0xc9a227, roughness: 0.4, metalness: 0.5 }), seg: 4 });
  } else {                              // 通用列柱立面
    for (let i = 0; i < 5; i++) ctx.cyl(0.7, 0.8, h * 0.6, x - w / 2 + 3 + i * (w - 6) / 4, h * 0.4, z + d / 2 + 0.4, { mat: stone, seg: 6, ry });
  }
  return h;
}

/** 江南民居：白墙黛瓦 + 马头墙 */
export function waterTownHouse(ctx, x, z, { w = 12, d = 10, h = 7.5, ry = 0 } = {}) {
  ctx.stats.buildings++;
  const white = ctx.mat('wwWhite', { color: 0xe4e0d4, roughness: 0.9 });
  const tile = ctx.mat('wwTile', { color: 0x2c2f36, roughness: 0.75 });
  const wood = ctx.mat('wwWood', { color: 0x6b4a2c, roughness: 0.8 });
  ctx.box(w, h, d, x, 0, z, { mat: white, ry });
  gableRoof(ctx, x, h, z, w, d, 3.4, tile);
  // 马头墙（阶形山墙）
  for (const sgn of [-1, 1]) {
    const hx = x + sgn * (w / 2 + 0.15), hz = z;
    const ca = Math.cos(ry), sa = Math.sin(ry);
    const ox = -sa * sgn * 0.3, oz = ca * sgn * 0.3;
    for (let i = 0; i < 3; i++) {
      const bw = (1.6 - i * 0.35);
      ctx.box(bw, 1.1, d * 0.94, hx + ox, h + 3.2 + i * 1.0, hz + oz, { mat: white, ry, cast: false });
    }
  }
  // 木门木窗
  ctx.box(2.2, 3.2, 0.3, x, 0, z + d / 2 + 0.1, { mat: wood, ry, cast: false });
  ctx.box(1.6, 1.4, 0.3, x + w * 0.28, 2.2, z + d / 2 + 0.1, { mat: wood, ry, cast: false });
  ctx.box(1.6, 1.4, 0.3, x - w * 0.28, 2.2, z + d / 2 + 0.1, { mat: wood, ry, cast: false });
  return h;
}

/** 城楼（城墙上的门楼） */
export function gateTower(ctx, x, z, { w = 20, h = 18, mark = '城楼', ry = 0, gold = true, y0 = 0 } = {}) {
  ctx.mark(mark);
  const red = ctx.mat('gateRed', { color: 0x8a2f22, roughness: 0.6 });
  const wall = ctx.mat('gateWall', { color: 0x6d6a62, roughness: 0.9 });
  ctx.box(w + 4, h * 0.3, w * 0.72, x, y0, z, { mat: wall, ry });
  ctx.box(w, h * 0.56, w * 0.62, x, y0 + h * 0.3, z, { mat: red, ry });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ctx.cyl(0.9, 1, h * 0.56, x + sx * (w / 2 - 1.4), y0 + h * 0.3, z + sz * (w * 0.31 - 1), { mat: red, seg: 8, ry });
  }
  hipRoof(ctx, x, y0 + h * 0.86, z, w + 3, w * 0.72 + 2, { mat: gold ? goldRoof(ctx) : greenRoof(ctx), eave: 1.0, tiers: 2 });
  return h;
}

/** 角楼 */
export function cornerTower(ctx, x, z, { h = 16, mark = '角楼', y0 = 0 } = {}) {
  ctx.mark(mark);
  const red = ctx.mat('cornerRed', { color: 0x8a2f22, roughness: 0.6 });
  ctx.box(14, h * 0.5, 14, x, y0, z, { mat: red });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ctx.cyl(0.8, 0.9, h * 0.42, x + sx * 5.4, y0 + h * 0.5, z + sz * 5.4, { mat: red, seg: 8 });
  }
  hipRoof(ctx, x, y0 + h * 0.92, z, 17, 17, { mat: goldRoof(ctx), eave: 1.0, tiers: 2 });
  return h;
}

export { paifang, screenWall };
