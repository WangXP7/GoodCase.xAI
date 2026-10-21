/* ============================================================
 * towers.js — 现代地标塔楼（参数化，剪影识别优先）
 * ========================================================== */
import * as THREE from 'three';

const steel = (ctx, c = 0x9aa2ab) => ctx.mat('steel' + c, { color: c, roughness: 0.5, metalness: 0.65 });

/** 紫峰大厦（绿地鼓楼中心）—— 三角三瓣 + 观景台 + 天线 */
export function zifengTower(ctx, x, z, h = 380) {
  ctx.mark('紫峰大厦');
  const g = ctx.glass(2);
  const fin = steel(ctx, 0x7f8890);
  ctx.box(72, 10, 72, x, 0, z, { mat: ctx.mat('zifengPodium', { color: 0x2c3038, roughness: 0.4, metalness: 0.4 }) });
  const segs = [
    { y0: 10, y1: h * 0.52, r0: 33, r1: 25 },
    { y0: h * 0.52, y1: h * 0.82, r0: 25, r1: 18.5 },
    { y0: h * 0.82, y1: h * 0.94, r0: 18.5, r1: 13.5 },
  ];
  for (const s of segs) {
    ctx.cyl(s.r1, s.r0, s.y1 - s.y0, x, s.y0, z, { mat: g, seg: 3, ry: Math.PI / 6 });
    // 三条竖向棱线（三瓣轮廓的关键）
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 6 + k * (Math.PI * 2 / 3);
      const rr = (s.r0 + s.r1) / 2 * 1.06;
      ctx.box(1.6, s.y1 - s.y0 + 0.5, 1.6, x + Math.cos(a) * rr, s.y0 - 0.25, z + Math.sin(a) * rr, { mat: fin, cast: false });
    }
  }
  // 观景台（灯笼式圆筒 + 灯带）
  ctx.cyl(10, 9.5, 7, x, h * 0.74, z, { mat: ctx.mat('zifengObs', { color: 0xbfd4dd, roughness: 0.2, metalness: 0.5 }, ['window']) });
  ctx.cyl(10.6, 10.6, 1.2, x, h * 0.74 + 3.4, z, { mat: ctx.mat('zifengRing', { color: 0xffd9a0, emissive: 0xffb45e, emissiveIntensity: 0 }, ['lamp']) });
  // 天线
  ctx.cyl(0.9, 2.2, h * 0.075, x, h * 0.94, z, { mat: fin, seg: 6 });
  ctx.cyl(0.05, 0.5, 6, x, h * 0.94 + h * 0.075, z, { mat: fin, seg: 4 });
  return h;
}

/** 东方明珠 —— 三柱擎三球 */
export function pearlTower(ctx, x, z, h = 468) {
  ctx.mark('东方明珠');
  const shell = ctx.mat('pearlShell', { color: 0xe9e6dc, roughness: 0.4, metalness: 0.25 });
  const red = ctx.mat('pearlRed', { color: 0xb03a2e, roughness: 0.45, emissive: 0x4a0f08, emissiveIntensity: 0 }, ['neon']);
  ctx.cyl(5, 5.5, h * 0.93, x, 0, z, { mat: shell, seg: 10 });
  for (const [lean, r, top] of [[-0.16, 8, 0.56], [0.16, 8, 0.56], [0.10, 4, 0.2]]) {
    const dx = Math.sin(lean) * h * top, hh = h * top;
    ctx.cyl(r * 0.85, r, hh, x + dx, 0, z, { mat: shell, seg: 10, rz: -lean });
  }
  const sphere = (yy, r) => {
    const g = new THREE.SphereGeometry(r, 22, 14);
    g.translate(x, yy, z);
    ctx._push(red._key, g, red);
  };
  sphere(h * 0.19, 23); sphere(h * 0.55, 29); sphere(h * 0.86, 10);
  ctx.cyl(1.4, 2.2, h * 0.14, x, h * 0.93, z, { mat: shell, seg: 8 });
  ctx.box(6, 3, 6, x, 4, z, { mat: ctx.mat('pearlBase', { color: 0x8a8578, roughness: 0.8 }) });
  return h;
}

/** 上海中心大厦 —— 扭转三角体 */
export function shanghaiTwist(ctx, x, z, h = 520) {
  ctx.mark('上海中心大厦');
  const g = ctx.glass(1);
  const N = 54;
  let rot = 0;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const r0 = 30 - 17 * t, r1 = 30 - 17 * (t + 1 / N);
    ctx.cyl(r1, r0, h / N + 0.3, x, t * h, z, { mat: g, seg: 3, ry: rot, cast: true });
    rot += (Math.PI * 2) * 0.31 / N;
  }
  ctx.cyl(3, 6, 26, x, h, z, { mat: steel(ctx), seg: 8 });
  ctx.box(66, 8, 66, x, 0, z, { mat: ctx.mat('stPodium', { color: 0x30343c, roughness: 0.4, metalness: 0.35 }) });
  return h;
}

/** 环球金融中心 —— 开瓶器 */
export function swfcTower(ctx, x, z, h = 492) {
  ctx.mark('环球金融中心');
  const g = ctx.glass(0);
  const segs = [[0, 0.5, 21, 19], [0.5, 0.86, 19, 15]];
  for (const [t0, t1, r0, r1] of segs) {
    ctx.box(r0 * 2, (t1 - t0) * h, r0 * 2, x, t0 * h, z, { mat: g });
    ctx.box(r1 * 2, (t1 - t0) * h, r1 * 2, x, t0 * h, z, { mat: g });
  }
  // 开瓶器：双柱 + 顶梁 + 底梁，中空梯形
  const cy = h * 0.86, ch = h * 0.14;
  const frame = steel(ctx, 0x8f97a0);
  for (const sgn of [-1, 1]) {
    ctx.box(3.4, ch, 4.4, x + sgn * 9.5, cy, z, { mat: frame, rz: sgn * -0.05 });
  }
  ctx.box(24, 2.6, 4.4, x, cy + ch, z, { mat: frame });
  ctx.box(24, 2.6, 4.4, x, cy + 1.5, z, { mat: frame });
  ctx.cyl(0.4, 1.2, 12, x, cy + ch, z, { mat: frame, seg: 4 });
  return h;
}

/** 金茂大厦 —— 节节退台塔 */
export function jinmaoTower(ctx, x, z, h = 420) {
  ctx.mark('金茂大厦');
  const g = ctx.glass(2);
  const tiers = 10;
  let w = 42;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    ctx.box(w, h / tiers, w, x, t * h, z, { mat: g });
    ctx.box(w + 2.2, 0.9, w + 2.2, x, t * h + h / tiers - 0.45, z, { mat: steel(ctx, 0xb9c0c8), cast: false });
    w *= 0.885;
  }
  ctx.cyl(1.2, 2.6, 44, x, h, z, { mat: steel(ctx, 0xd8b23a), seg: 6 });
  return h;
}

/** 平安金融中心 —— 四角巨柱 */
export function pingAnTower(ctx, x, z, h = 500) {
  ctx.mark('平安金融中心');
  const g = ctx.glass(0);
  const fin = steel(ctx, 0xdfe3e8);
  const bands = 3;
  for (let b = 0; b < bands; b++) {
    const t0 = b / bands, t1 = (b + 1) / bands;
    const r0 = 26 - 9 * t0, r1 = 26 - 9 * t1;
    ctx.cyl(r1 * 0.9, r0 * 0.9, (t1 - t0) * h, x, t0 * h, z, { mat: g, seg: 4, ry: Math.PI / 4 });
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const rr = (r0 + r1) / 2;
      ctx.box(2.4, (t1 - t0) * h + 1, 2.4, x + Math.cos(a) * rr, t0 * h - 0.5, z + Math.sin(a) * rr, { mat: fin, cast: false });
    }
  }
  ctx.cyl(1, 2, 58, x, h, z, { mat: fin, seg: 6 });
  return h;
}

/** 京基100 */
export function kk100Tower(ctx, x, z, h = 442) {
  ctx.mark('京基100');
  const g = ctx.glass(1);
  const segs = [[0, 0.56, 21, 18], [0.56, 0.88, 18, 15.5]];
  for (const [t0, t1, r0, r1] of segs) ctx.cyl(r1, r0, (t1 - t0) * h, x, t0 * h, z, { mat: g, seg: 4, ry: Math.PI / 4 });
  ctx.cyl(14, 15.5, 22, x, h * 0.88, z, { mat: g, seg: 20 });
  ctx.cyl(0.8, 2.4, 40, x, h * 0.88 + 22, z, { mat: steel(ctx), seg: 6 });
  ctx.cyl(16, 16, 3, x, h * 0.88 + 20, z, { mat: ctx.mat('kkRed', { color: 0xa8332c, roughness: 0.5, emissive: 0x3a0d08, emissiveIntensity: 0 }, ['neon']) });
  return h;
}

/** 德基广场双塔（新街口） */
export function dejiTwin(ctx, x, z, h = 250) {
  ctx.mark('德基广场');
  const g = ctx.glass(2);
  for (const sgn of [-1, 1]) {
    const tx = x + sgn * 17;
    ctx.box(26, h, 26, tx, 0, z, { mat: g });
    ctx.box(26, 16, 26, tx, h, z, { mat: g, rz: sgn * -0.42 });
    ctx.box(3, 30, 3, tx, h + 12, z, { mat: steel(ctx), cast: false });
  }
  ctx.box(60, 6, 30, x, 0, z, { mat: ctx.mat('dejiBase', { color: 0x24272e, roughness: 0.5, metalness: 0.3 }, ['neon']) });
  return h;
}

/** 金陵饭店（老楼 + 璇宫） */
export function jinlingHotel(ctx, x, z, h = 110) {
  ctx.mark('金陵饭店');
  ctx.box(32, h * 0.85, 25, x, 0, z, { mat: ctx.facade(3) });
  ctx.cyl(13, 13.5, 7, x, h * 0.85, z, { mat: ctx.mat('jinlingGold', { color: 0xc8a85a, roughness: 0.35, metalness: 0.5 }, ['window']) });
  const dome = new THREE.SphereGeometry(11, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(x, h * 0.85 + 7, z);
  ctx._push(ctx.mat('jinlingDome', { color: 0xb59a4e, roughness: 0.4, metalness: 0.45 })._key, dome, ctx.mat('jinlingDome', { color: 0xb59a4e, roughness: 0.4, metalness: 0.45 }));
  ctx.cyl(0.3, 1, 8, x, h * 0.85 + 17, z, { mat: steel(ctx), seg: 4 });
  return h;
}

/** 华润总部春笋 */
export function chunSun(ctx, x, z, h = 390) {
  ctx.mark('华润总部春笋');
  const g = ctx.glass(0);
  const N = 40;
  for (let i = 0; i < N; i++) {
    const t = i / N, t2 = (i + 1) / N;
    const r0 = 24 - 16 * t, r1 = 24 - 16 * t2;
    const off0 = Math.sin(t * Math.PI) * 9, off1 = Math.sin(t2 * Math.PI) * 9;
    ctx.cyl(r1, r0, h / N + 0.4, x + (off0 + off1) / 2, t * h, z, { mat: g, seg: 18 });
  }
  ctx.cyl(0.6, 2.4, 30, x + 9, h, z, { mat: steel(ctx), seg: 6 });
  return h;
}

/** 上海国金中心双塔 */
export function ifcTwin(ctx, x, z, h = 260) {
  ctx.mark('上海国金中心');
  const g = ctx.glass(2);
  for (const sgn of [-1, 1]) {
    const tx = x + sgn * 15;
    ctx.cyl(14, 18, h * 0.92, tx, 0, z, { mat: g, seg: 4, ry: Math.PI / 4 });
    ctx.box(20, 10, 20, tx, h * 0.92, z, { mat: g, rz: sgn * 0.3 });
  }
  return h;
}

/** 通用 CBD 塔（玻璃方塔，微随机） */
export function cbdTower(ctx, x, z, h, i = 0) {
  ctx.stats.buildings++;
  const g = ctx.glass(i % 3);
  if (i % 3 === 0) {
    ctx.cyl(h * 0.02 + 12, 16, h, x, 0, z, { mat: g, seg: 4, ry: Math.PI / 4 });
    ctx.cyl(1, 2, 14, x, h, z, { mat: steel(ctx), seg: 4 });
  } else if (i % 3 === 1) {
    ctx.box(24, h, 24, x, 0, z, { mat: g });
    ctx.box(26, 5, 26, x, h, z, { mat: steel(ctx, 0x6d747d), cast: false });
    ctx.cyl(0.4, 1.4, 18, x, h + 5, z, { mat: steel(ctx), seg: 4 });
  } else {
    const segs = 3;
    for (let s = 0; s < segs; s++) {
      const k = 1 - s * 0.14;
      ctx.box(22 * k, h / segs, 22 * k, x, s * h / segs, z, { mat: g });
    }
  }
  return h;
}
