// model.js —— 整车 + 鹈鹕的几何原语定义（两个版本共用）
//
// 坐标系：+X 前进，+Y 向上，+Z 右侧（车手左手侧为 -Z）
// 尺寸参考真实公路车按比例放大：轮半径 0.575，五通高 0.45，曲柄 0.28

import { PAL, ell, box, cap, tor, tube } from './core.js';

export const RIG = {
  REAR_HUB: [0, 0.575, 0],
  FRONT_HUB: [2.30, 0.575, 0],
  BB: [1.35, 0.45, 0],
  CRANK: 0.28,
  PEDAL_Z: 0.115,
  HIP: [0.56, 1.76, 0.17],
  L1: 1.05,
  L2: 0.95,
  NECK_PIVOT: [0.86, 2.30, 0],
  SCARF_ROOT: [0.97, 2.55, 0],
  LIFT: -1.15,          // 整车沿 X 平移，使场景居中
};

// 体素模式下必须把过细的零件加粗，否则会整条丢失
export const VOXEL = 0.07;
export function thin(mode) {
  const v = mode === 'voxel';
  return {
    vox: v,
    spokeR: v ? 0.038 : 0.013,
    spokes: v ? 4 : 8,
    rimR: v ? 0.050 : 0.028,
    tubeR: v ? 0.048 : 0.042,
    chainR: v ? 0.040 : 0.018,
    pedalT: v ? 0.048 : 0.022,
    crankT: v ? 0.048 : 0.030,
    scarfT: v ? 0.085 : 0.052,
    scarfH: v ? 0.160 : 0.115,
    thighR: v ? 0.115 : 0.105,
    shankR: v ? 0.075 : 0.062,
    footT: v ? 0.052 : 0.036,
    eyeHi: !v,
    fish: v ? 0.085 : 0.062,
  };
}

/* ── 车轮 ─────────────────────────────────────────── */
export function wheelPrims(hub, T) {
  const [cx, cy, cz] = hub;
  const P = [
    tor([cx, cy, cz], 0.500, 0.075, 'z', PAL.tire),
    tor([cx, cy, cz], 0.442, T.rimR, 'z', PAL.rim),
    ell([cx, cy, cz], [0.085, 0.085, 0.062], PAL.hub),
  ];
  for (let i = 0; i < T.spokes; i++) {
    const a = (i * Math.PI) / T.spokes;
    const dx = 0.44 * Math.cos(a), dy = 0.44 * Math.sin(a);
    P.push(cap([cx - dx, cy - dy, cz], [cx + dx, cy + dy, cz], T.spokeR, PAL.rim));
  }
  return P;
}

/* ── 车架 ─────────────────────────────────────────── */
export function bikePrims(T) {
  const r = T.tubeR;
  const HZ = 0.055;   // 后三角左右撑的开档
  const P = [];

  // 后三角（左右各一）
  for (const s of [1, -1]) {
    P.push(cap([0, 0.575, s * HZ], [1.35, 0.45, s * HZ * 0.7], r * 0.85, PAL.frame));
    P.push(cap([0, 0.575, s * HZ], [0.42, 1.26, 0], r * 0.8, PAL.frame));
  }
  // 主三角
  P.push(cap([1.35, 0.45, 0], [0.42, 1.26, 0], r, PAL.frame));            // 座管
  P.push(cap([1.35, 0.45, 0], [2.24, 1.16, 0], r, PAL.frame));            // 下管
  P.push(cap([0.42, 1.26, 0], [2.12, 1.46, 0], r * 0.95, PAL.frame));     // 上管
  P.push(cap([2.12, 1.46, 0], [2.24, 1.16, 0], r * 1.05, PAL.frameLo));   // 头管
  // 前叉
  for (const s of [1, -1]) P.push(cap([2.24, 1.16, 0], [2.30, 0.575, s * HZ], r * 0.8, PAL.frame));
  // 座管延伸 + 车座
  P.push(cap([0.42, 1.26, 0], [0.34, 1.44, 0], r * 0.7, PAL.metal));
  P.push(ell([0.30, 1.46, 0], [0.21, 0.048, 0.115], PAL.saddle, [0, 0, -0.06]));
  P.push(ell([-0.02, 1.44, 0], [0.10, 0.055, 0.125], PAL.saddle, [0, 0, -0.06]));
  // 把立 + 燕把
  P.push(cap([2.12, 1.46, 0], [2.05, 1.60, 0], r * 0.6, PAL.metal));
  P.push(cap([2.05, 1.60, -0.34], [2.05, 1.60, 0.34], r * 0.62, PAL.frameLo));
  for (const s of [1, -1]) P.push(cap([2.05, 1.60, s * 0.34], [1.90, 1.605, s * 0.385], r * 0.7, PAL.saddle));
  // 车铃
  P.push(ell([1.86, 1.63, 0.16], [0.055, 0.055, 0.055], '#f3b93f'));
  // 传动
  P.push(tor([1.35, 0.45, 0.105], 0.150, 0.024, 'z', PAL.metal));
  P.push(tor([0, 0.575, 0.09], 0.058, 0.020, 'z', PAL.metal));
  P.push(cap([1.35, 0.598, 0.10], [0, 0.630, 0.09], T.chainR, PAL.frameLo));
  P.push(cap([1.35, 0.302, 0.10], [0, 0.520, 0.09], T.chainR, PAL.frameLo));
  return P;
}

/* ── 鹈鹕：身体 / 尾 / 双翅（相对整车原点） ─────────── */
export function pelicanBodyPrims(T) {
  const P = [
    // 躯干
    ell([0.28, 2.00, 0], [0.80, 0.56, 0.52], PAL.body, [0, 0, 0.09]),
    // 胸肩，过渡到脖子
    ell([0.76, 2.14, 0], [0.29, 0.33, 0.36], PAL.body, [0, 0, 0.20]),
    // 尾羽：四段递减椭球，半径步进要小否则会看成一串分离的球
    ell([-0.42, 1.95, 0], [0.40, 0.225, 0.190], PAL.bodyShade, [0, 0, 0.08]),
    ell([-0.78, 1.98, 0], [0.33, 0.185, 0.155], PAL.bodyShade, [0, 0, 0.10]),
    ell([-1.10, 2.02, 0], [0.26, 0.150, 0.125], PAL.bodyShade, [0, 0, 0.13]),
    ell([-1.38, 2.07, 0], [0.19, 0.110, 0.092], PAL.bodyShade, [0, 0, 0.16]),
  ];

  // 双翅：从肩伸到车把
  const S = [0.62, 2.22, 0.44], W = [1.52, 1.80, 0.42], H = [1.98, 1.58, 0.36];
  for (const s of [1, -1]) {
    P.push(ell([S[0], S[1], s * S[2]], [0.19, 0.19, 0.115], PAL.body));
    const seg = (A, B, rp, rt) => {
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      P.push(ell([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, s * ((A[2] + B[2]) / 2)],
                 [len / 2 + rt, rp, rt], PAL.body,
                 [0, 0, Math.atan2(B[1] - A[1], B[0] - A[0])]));
    };
    seg(S, W, 0.150, 0.070);
    seg(W, H, 0.108, 0.060);
    P.push(ell([H[0], H[1], s * H[2]], [0.115, 0.095, 0.082], PAL.body));
  }
  return P;
}

/* ── 颈 + 头 + 喙（相对颈部枢轴，写绝对坐标由 rig 平移） ── */
export function neckHeadPrims(T) {
  const P = [];
  // 颈：用扫掠管而不是胶囊拼接 —— 胶囊的半球端会在每个关节处顶出环状凸起
  // 首尾两端都埋进躯干 / 头里，开放端才不会露出来
  // 点格式是 [x, y, z, 半径] —— 别按 2D 习惯漏掉 z
  P.push(tube([
    [0.86, 2.26, 0, 0.205], [0.94, 2.44, 0, 0.196], [1.02, 2.58, 0, 0.187],
    [1.12, 2.71, 0, 0.177], [1.24, 2.82, 0, 0.166], [1.38, 2.91, 0, 0.155],
    [1.52, 2.99, 0, 0.146], [1.64, 3.02, 0, 0.115],
  ], PAL.body));

  // 头
  P.push(ell([1.70, 3.03, 0], [0.265, 0.265, 0.240], PAL.body));
  P.push(ell([1.60, 3.14, 0], [0.19, 0.125, 0.20], PAL.body));   // 后脑

  // 上喙：同样用管，末端收成极小半径由深色喙尖盖住
  P.push(tube([
    [1.78, 3.08, 0, 0.100], [1.95, 3.05, 0, 0.088], [2.15, 3.02, 0, 0.079],
    [2.42, 2.97, 0, 0.066], [2.66, 2.90, 0, 0.051], [2.74, 2.87, 0, 0.018],
  ], PAL.beak));
  P.push(ell([2.72, 2.885, 0], [0.050, 0.046, 0.043], PAL.beakDark));

  // 喉囊
  P.push(ell([2.28, 2.78, 0], [0.355, 0.200, 0.150], PAL.pouch));
  // 囊里露出的鱼尾
  P.push(ell([2.42, 3.05, 0], [0.085, T.fish, 0.055], PAL.fish, [0, 0, -0.55]));
  P.push(ell([2.42, 3.05, 0], [0.085, T.fish, 0.055], PAL.fish, [0, 0, 0.55]));

  // 眼
  for (const s of [1, -1]) {
    P.push(ell([1.81, 3.13, s * 0.192], [0.058, 0.058, 0.045], PAL.eye));
    if (T.eyeHi) P.push(ell([1.795, 3.155, s * 0.222], [0.024, 0.024, 0.02], '#ffffff'));
  }
  return P;
}

/* ── 腿（各自以关节为原点的局部坐标，沿 +Y 生长） ───── */
export function thighPrims(L1, T) {
  return [
    cap([0, 0, 0], [0, L1, 0], T.thighR, PAL.leg),
    ell([0, 0.20, 0], [0.19, 0.28, 0.18], PAL.body),        // 羽毛覆盖的大腿根
    ell([0, L1 - 0.05, 0], [T.thighR * 0.95, T.thighR * 0.95, T.thighR * 0.9], PAL.legDark),
  ];
}
export function shankPrims(L2, T) {
  return [cap([0, 0, 0], [0, L2, 0], T.shankR, PAL.leg)];
}
export function footPrims(T) {
  const P = [
    ell([0.10, -0.02, 0], [0.150, T.footT, 0.090], PAL.leg),
    cap([0, 0, 0], [0.20, -0.03, 0], 0.038, PAL.legDark),
  ];
  for (const s of [1, 0, -1]) P.push(cap([0.06, -0.02, 0], [0.23, -0.03, s * 0.062], 0.022, PAL.legDark));
  return P;
}

/* ── 曲柄 / 踏板 / 围巾节 ──────────────────────────── */
export function crankArmPrims(side, T) {
  const R = RIG.CRANK, z = side * RIG.PEDAL_Z;
  return [box([R / 2 * side, 0, z], [R, T.crankT, T.crankT * 0.6], side > 0 ? PAL.metal : PAL.hub)];
}
export function pedalPrims(T) {
  return [
    box([0, 0, 0], [0.135, T.pedalT, 0.105], PAL.saddle),
    box([0, 0.005, 0], [0.115, T.pedalT * 0.55, 0.088], PAL.metal),
  ];
}
export const SCARF_STEP = 0.145;   // 每节长度，rig 里按此递推
export function scarfSegPrims(T) {
  return [box([-SCARF_STEP / 2, 0, 0], [SCARF_STEP, T.scarfH, T.scarfT], PAL.scarf)];
}

/* ── 路边景物 ─────────────────────────────────────── */
export function treePrims() {
  return [
    cap([0, 0, 0], [0, 0.85, 0], 0.085, PAL.trunk),
    ell([0, 1.45, 0], [0.78, 0.88, 0.78], PAL.leaf),
    ell([0.34, 1.10, 0.22], [0.52, 0.48, 0.52], PAL.leafLo),
    ell([-0.30, 1.24, -0.18], [0.46, 0.42, 0.46], PAL.leafHi),
  ];
}
export function rockPrims() {
  return [
    ell([0, 0.26, 0], [0.55, 0.30, 0.46], PAL.rock),
    ell([0.28, 0.20, 0.12], [0.34, 0.21, 0.30], PAL.rockLo),
  ];
}
export function bushPrims() {
  return [
    ell([0, 0.34, 0], [0.50, 0.38, 0.46], PAL.leafLo),
    ell([0.30, 0.26, 0.10], [0.33, 0.27, 0.30], PAL.leaf),
  ];
}
export function hillPrims(rx, ry, rz) {
  return [ell([0, 0, 0], [rx, ry, rz], Math.random() < 0.5 ? PAL.hillFar : PAL.hillNear)];
}
