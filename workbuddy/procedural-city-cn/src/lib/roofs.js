/* ============================================================
 * roofs.js — 中式屋顶 / 牌坊 / 照壁（参数化构件）
 * 约定：所有函数接收城市构建器 ctx，直接写入合并批次
 * ========================================================== */
import * as THREE from 'three';

/** 三角板（用于山墙） */
function triPlate(w, h, depth) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * 庑殿/歇山式四坡顶（反宇向阳 + 翼角起翘）
 * @param y 屋顶基面（楼顶标高）
 */
export function hipRoof(ctx, x, y, z, w, d, { mat, eave = 0.5, tiers = 1, ridge = 0.5 } = {}) {
  const T = THREE;
  const bandMat = ctx.mat('roofBand', { color: 0x8a2f22, roughness: 0.7 });
  const finMat = ctx.mat('roofFin', { color: 0xd8b23a, roughness: 0.5, metalness: 0.3 });
  // 檐口托板（外挑）
  ctx.box(w + eave * 2 + 0.5, 0.42, d + eave * 2 + 0.5, x, y, z, { mat: bandMat, cast: false });
  // 斗拱色带
  ctx.box(w + eave * 2 + 1.0, 0.5, d + eave * 2 + 1.0, x, y - 0.5, z, { mat: bandMat, cast: false });
  // 翼角（四角起翘）
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = x + sx * (w / 2 + eave), cz = z + sz * (d / 2 + eave);
    const ry = Math.atan2(sx, sz) + Math.PI / 4;
    ctx.box(0.16, 0.16, eave * 1.9, cx + sx * 0.2, y + 0.42, cz + sz * 0.2, { mat: finMat, ry, rz: -0.62, cast: false });
  }
  // 正脊
  const hRoof = Math.max(w, d) * 0.30 + 1.2;
  const r = (Math.max(w, d) / 2 + eave) / Math.SQRT2 * 1.04;
  ctx.cyl(0.02, r, hRoof, x, y + 0.42, z, { mat, ry: Math.PI / 4, seg: 4, cast: false });
  ctx.box(ridge + 0.3, 0.5, d + eave * 2 - 0.8, x, y + 0.42 + hRoof - 0.25, z, { mat: finMat, cast: false });
  // 重檐
  if (tiers > 1) {
    const w2 = w * 0.72, d2 = d * 0.72;
    const y2 = y + 0.42 + hRoof * 0.52;
    ctx.box(w2 + eave * 1.4, 0.34, d2 + eave * 1.4, x, y2, z, { mat: bandMat, cast: false });
    const h2 = hRoof * 0.5;
    const r2 = (Math.max(w2, d2) / 2 + eave * 0.7) / Math.SQRT2 * 1.04;
    ctx.cyl(0.02, r2, h2, x, y2 + 0.34, z, { mat, ry: Math.PI / 4, seg: 4, cast: false });
    ctx.box(ridge, 0.42, d2 + eave - 0.6, x, y2 + 0.34 + h2 - 0.2, z, { mat: finMat, cast: false });
  }
}

/** 硬山/双坡顶（民国民居），屋脊沿 z 轴 */
export function gableRoof(ctx, x, y, z, w, d, h, mat) {
  const T = THREE;
  const span = w + 0.7;            // 山墙方向跨度
  const len = d + 0.8;             // 屋脊方向长度
  const pitch = Math.atan2(h, span / 2);
  const slabLen = span / 2 / Math.cos(pitch);
  for (const sgn of [-1, 1]) {
    const g = new THREE.BoxGeometry(slabLen, 0.28, len);
    const m = new THREE.Matrix4();
    m.compose(
      new THREE.Vector3(x + sgn * span / 4, y + h / 2, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sgn * pitch)),
      new THREE.Vector3(1, 1, 1)
    );
    g.applyMatrix4(m);
    ctx._push(mat._key, g, mat);
  }
  // 山墙三角板
  for (const sgn of [-1, 1]) {
    const g = triPlate(span, h + 0.1, 0.3);
    g.rotateY(Math.PI / 2);
    g.translate(x + sgn * (span / 2 - 0.05), y, z);
    ctx._push(ctx.mat('wallGable', { color: 0xb8b2a4, roughness: 0.9 })._key, g, ctx.mat('wallGable', { color: 0xb8b2a4, roughness: 0.9 }));
  }
  // 檐口封边
  ctx.box(span + 0.3, 0.3, 0.3, x, y + h - 0.1, z - len / 2, { mat: ctx.mat('fascia', { color: 0x4a4038, roughness: 0.85 }), cast: false });
  ctx.box(span + 0.3, 0.3, 0.3, x, y + h - 0.1, z + len / 2, { mat: ctx.mat('fascia', { color: 0x4a4038, roughness: 0.85 }), cast: false });
}

/** 牌坊 */
export function paifang(ctx, x, z, { w = 9, h = 11, mat, rot = 0 } = {}) {
  const T = THREE;
  const colMat = mat || ctx.mat('paifangCol', { color: 0x8a2f22, roughness: 0.6 });
  const goldMat = ctx.mat('paifangGold', { color: 0xd8b23a, roughness: 0.4, metalness: 0.35 });
  const cw = 0.85;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ctx.cyl(cw / 2, cw / 2 * 1.1, h, x + sx * w / 2, 0, z + sz * 2.2, { mat: colMat, seg: 8, ry: rot });
  }
  const beam = (yy, ww, dd) => ctx.box(ww, 0.55, dd, x, yy, z, { mat: colMat, ry: rot, cast: false });
  beam(h * 0.62, w + 2.6, 0.8);
  beam(h * 0.86, w + 1.6, 0.7);
  // 匾额
  ctx.box(w * 0.5, 1.5, 0.3, x, h * 0.72, z, { mat: ctx.mat('plaque', { color: 0x2c2f36, roughness: 0.5, metalness: 0.3 }, ['neon']), ry: rot, cast: false });
  // 小额枋 + 坊顶
  for (const sx of [-1, 1]) {
    hipRoof(ctx, x + sx * 0, h * 0.86 + 0.55, z, w * 0.34, 2.4, { mat: goldMat, eave: 0.45, ridge: 0.3 });
  }
}

/** 照壁 */
export function screenWall(ctx, x, z, { w = 22, h = 6, mat, rot = 0 } = {}) {
  const wallMat = mat || ctx.mat('screenWall', { color: 0x9a958a, roughness: 0.9 });
  ctx.box(w, h, 1.2, x, 0, z, { mat: wallMat, ry: rot, cast: false });
  hipRoof(ctx, x, h, z, w, 1.6, { mat: ctx.mat('screenRoof', { color: 0x2e6b4f, roughness: 0.5 }), eave: 0.5 });
}
