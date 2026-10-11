// core.js —— 调色板 + 几何原语 + 两套几何构建器
//
// 核心思路：模型只描述一次（一串原语），
//   smooth 构建器 → 把原语变成真实的球/胶囊/盒/管，顶点色合并成一个 BufferGeometry
//   voxel  构建器 → 把原语空间体素化，逐面剔除后生成方块网格
// 这样两个版本的角色轮廓必然一致。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ── 调色板 ───────────────────────────────────────────── */
export const PAL = {
  white: '#ffffff', body: '#fbfdff', bodyShade: '#e3ecf4',
  beak: '#f2a53a', beakDark: '#d98a22', pouch: '#f9b855',
  leg: '#f0ab3f', legDark: '#d1913a', eye: '#26313d', fish: '#9dc6e2',
  scarf: '#e2604a', scarfDark: '#c14435',
  frame: '#17807c', frameLo: '#0f5f63',
  tire: '#2b3745', rim: '#c6d4e0', hub: '#8d9dab', metal: '#a3b0bd',
  saddle: '#3b4a5a',
  grass: '#7cb254', grassLo: '#5f9040',
  road: '#c9c2b4', roadLine: '#fdfaf1', roadEdge: '#b6ad9c',
  hillFar: '#79ab80', hillNear: '#639870',
  trunk: '#7a5a3c', leaf: '#4e8f5b', leafLo: '#3e7a4c', leafHi: '#63a86d',
  rock: '#9aa3a8', rockLo: '#828b90',
};

/* ── 原语 ─────────────────────────────────────────────
   k: 0=ell 椭球  1=box 盒  2=cap 胶囊  3=tor 圆环  4=cone 圆锥  5=tube 扫掠管
   可选 q:[x,y,z,w] 四元数（优先于 rot） / rot:[ex,ey,ez] 欧拉角
   ────────────────────────────────────────────────── */
export const ell = (p, r, c, rot, q) => ({ k: 0, p, r: Array.isArray(r) ? r : [r, r, r], c, rot, q });
export const box = (p, s, c, rot, q) => ({ k: 1, p, s, c, rot, q });
export const cap = (a, b, r, c) => ({ k: 2, a, b, r, c });
export const tor = (p, R, r, axis, c) => ({ k: 3, p, R, r, axis: axis || 'z', c });
export const cone = (p, r, h, c) => ({ k: 4, p, r, h, c });
/** pts: [[x,y,z,r], ...] —— 沿折线扫掠、半径可变的管 */
export const tube = (pts, c) => ({ k: 5, pts, c });

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function primQuat(pr) {
  if (pr.q) return new THREE.Quaternion(pr.q[0], pr.q[1], pr.q[2], pr.q[3]);
  if (pr.rot) return new THREE.Quaternion().setFromEuler(new THREE.Euler(pr.rot[0] || 0, pr.rot[1] || 0, pr.rot[2] || 0));
  return null;
}

/* ── 扫掠管几何（平行传输坐标系，避免扭转） ─────────── */
function buildTubeGeometry(pts, radialSeg) {
  const n = pts.length;
  // 防御：点必须是 [x,y,z,r] 四元。少写 z 会静默产出全 NaN 的顶点，
  // 再被 mergeGeometries 合并进大网格，只在 boundingSphere 那里报一句警告，
  // 表现为"整根零件凭空消失"，很难查。
  for (let i = 0; i < n; i++) {
    if (pts[i].length !== 4 || pts[i].some((v) => !Number.isFinite(v))) {
      throw new Error(`tube(): 第 ${i} 个点应为 [x, y, z, 半径]，实际是 [${pts[i]}]`);
    }
  }
  const pos = [], nor = [], idx = [];

  const tan = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    tan.push(new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize());
  }

  let nrm = new THREE.Vector3(1, 0, 0);
  if (Math.abs(nrm.dot(tan[0])) > 0.9) nrm.set(0, 0, 1);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = tan[i];
    nrm = nrm.clone().sub(t.clone().multiplyScalar(nrm.dot(t))).normalize();
    const bin = new THREE.Vector3().crossVectors(t, nrm).normalize();
    frames.push([nrm.clone(), bin]);
  }

  for (let i = 0; i < n; i++) {
    const [x, y, z, r] = pts[i];
    const [N, B] = frames[i];
    for (let j = 0; j <= radialSeg; j++) {
      const a = (j / radialSeg) * Math.PI * 2;
      const dx = N.x * Math.cos(a) + B.x * Math.sin(a);
      const dy = N.y * Math.cos(a) + B.y * Math.sin(a);
      const dz = N.z * Math.cos(a) + B.z * Math.sin(a);
      pos.push(x + dx * r, y + dy * r, z + dz * r);
      nor.push(dx, dy, dz);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radialSeg; j++) {
      const a = i * (radialSeg + 1) + j, b = a + radialSeg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);   // 顺序保证法线朝外
    }
  }

  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/* ── 平滑构建器 ─────────────────────────────────────── */
export function buildSmoothGeometry(prims) {
  const geos = [];
  const col = new THREE.Color();

  for (const pr of prims) {
    let g;
    const q = primQuat(pr);

    if (pr.k === 0) {
      g = new THREE.SphereGeometry(1, 24, 16);
      g.scale(pr.r[0], pr.r[1], pr.r[2]);
      if (q) g.applyQuaternion(q);
      g.translate(pr.p[0], pr.p[1], pr.p[2]);
    } else if (pr.k === 1) {
      g = new THREE.BoxGeometry(pr.s[0], pr.s[1], pr.s[2]);
      if (q) g.applyQuaternion(q);
      g.translate(pr.p[0], pr.p[1], pr.p[2]);
    } else if (pr.k === 2) {
      const a = new THREE.Vector3(pr.a[0], pr.a[1], pr.a[2]);
      const b = new THREE.Vector3(pr.b[0], pr.b[1], pr.b[2]);
      const dir = b.clone().sub(a);
      g = new THREE.CapsuleGeometry(pr.r, dir.length(), 4, 14);
      dir.normalize();
      const mid = a.clone().add(b).multiplyScalar(0.5);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      g.translate(mid.x, mid.y, mid.z);
    } else if (pr.k === 3) {
      g = new THREE.TorusGeometry(pr.R, pr.r, 8, 30);
      if (pr.axis === 'x') g.rotateY(Math.PI / 2);
      else if (pr.axis === 'y') g.rotateX(Math.PI / 2);
      g.translate(pr.p[0], pr.p[1], pr.p[2]);
    } else if (pr.k === 4) {
      g = new THREE.ConeGeometry(pr.r, pr.h, 16, 1);
      g.translate(0, pr.h / 2, 0);
      if (q) g.applyQuaternion(q);
      g.translate(pr.p[0], pr.p[1], pr.p[2]);
    } else {
      g = buildTubeGeometry(pr.pts, 16);
    }

    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    col.set(pr.c);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geos.push(g);
  }
  return mergeGeometries(geos, false);
}

/* ── 体素构建器 ─────────────────────────────────────── */

function primBounds(pr) {
  if (pr.k === 0) {
    if (!pr.q && !pr.rot) {
      return [pr.p[0] - pr.r[0], pr.p[1] - pr.r[1], pr.p[2] - pr.r[2],
              pr.p[0] + pr.r[0], pr.p[1] + pr.r[1], pr.p[2] + pr.r[2]];
    }
    const m = Math.max(pr.r[0], pr.r[1], pr.r[2]);
    return [pr.p[0] - m, pr.p[1] - m, pr.p[2] - m, pr.p[0] + m, pr.p[1] + m, pr.p[2] + m];
  }
  if (pr.k === 1) {
    const h = Math.hypot(pr.s[0], pr.s[1], pr.s[2]) / 2;
    return [pr.p[0] - h, pr.p[1] - h, pr.p[2] - h, pr.p[0] + h, pr.p[1] + h, pr.p[2] + h];
  }
  if (pr.k === 2) {
    return [Math.min(pr.a[0], pr.b[0]) - pr.r, Math.min(pr.a[1], pr.b[1]) - pr.r, Math.min(pr.a[2], pr.b[2]) - pr.r,
            Math.max(pr.a[0], pr.b[0]) + pr.r, Math.max(pr.a[1], pr.b[1]) + pr.r, Math.max(pr.a[2], pr.b[2]) + pr.r];
  }
  if (pr.k === 3) {
    const e = pr.R + pr.r, ax = pr.axis;
    return [pr.p[0] - (ax === 'x' ? pr.r : e), pr.p[1] - (ax === 'y' ? pr.r : e), pr.p[2] - (ax === 'z' ? pr.r : e),
            pr.p[0] + (ax === 'x' ? pr.r : e), pr.p[1] + (ax === 'y' ? pr.r : e), pr.p[2] + (ax === 'z' ? pr.r : e)];
  }
  if (pr.k === 5) {
    let r = 0, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const p of pr.pts) {
      r = Math.max(r, p[3]);
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
    }
    return [lo[0] - r, lo[1] - r, lo[2] - r, hi[0] + r, hi[1] + r, hi[2] + r];
  }
  return [pr.p[0] - pr.r, pr.p[1], pr.p[2] - pr.r, pr.p[0] + pr.r, pr.p[1] + pr.h, pr.p[2] + pr.r];
}

// 点到线段的距离平方
function segDist2(x, y, z, a, b) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const dx = x - a[0], dy = y - a[1], dz = z - a[2];
  const len2 = bx * bx + by * by + bz * bz;
  let t = len2 > 0 ? (dx * bx + dy * by + dz * bz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = dx - bx * t, cy = dy - by * t, cz = dz - bz * t;
  return [cx * cx + cy * cy + cz * cz, t];
}

function insidePrim(pr, invQ, x, y, z) {
  let px = x, py = y, pz = z;
  if (invQ) {
    _v.set(x - pr.p[0], y - pr.p[1], z - pr.p[2]).applyQuaternion(invQ);
    px = _v.x + pr.p[0]; py = _v.y + pr.p[1]; pz = _v.z + pr.p[2];
  }
  if (pr.k === 0) {
    const a = (px - pr.p[0]) / pr.r[0], b = (py - pr.p[1]) / pr.r[1], c = (pz - pr.p[2]) / pr.r[2];
    return a * a + b * b + c * c <= 1;
  }
  if (pr.k === 1) {
    return Math.abs(px - pr.p[0]) <= pr.s[0] / 2 &&
           Math.abs(py - pr.p[1]) <= pr.s[1] / 2 &&
           Math.abs(pz - pr.p[2]) <= pr.s[2] / 2;
  }
  if (pr.k === 2) return segDist2(x, y, z, pr.a, pr.b)[0] <= pr.r * pr.r;
  if (pr.k === 3) {
    const dx = x - pr.p[0], dy = y - pr.p[1], dz = z - pr.p[2];
    let rad, axial;
    if (pr.axis === 'z') { rad = Math.hypot(dx, dy); axial = dz; }
    else if (pr.axis === 'x') { rad = Math.hypot(dy, dz); axial = dx; }
    else { rad = Math.hypot(dx, dz); axial = dy; }
    return Math.hypot(rad - pr.R, axial) <= pr.r;
  }
  if (pr.k === 5) {
    for (let i = 0; i < pr.pts.length - 1; i++) {
      const a = pr.pts[i], b = pr.pts[i + 1];
      const [d2, t] = segDist2(x, y, z, a, b);
      const r = a[3] + (b[3] - a[3]) * t;
      if (d2 <= r * r) return true;
    }
    return false;
  }
  const t = (y - pr.p[1]) / pr.h;
  if (t < 0 || t > 1) return false;
  return Math.hypot(x - pr.p[0], z - pr.p[2]) <= pr.r * (1 - t);
}

// 每个面的 (法线, u, v)，满足 u × v = n
const FACES = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];

export function buildVoxelGeometry(prims, size) {
  const cells = new Map();
  const key = (i, j, k) => i + ',' + j + ',' + k;
  const half = size * 0.5;

  for (const pr of prims) {
    const q = primQuat(pr);
    const invQ = q ? q.clone().invert() : null;
    const bb = primBounds(pr);
    const i0 = Math.floor(bb[0] / size), i1 = Math.ceil(bb[3] / size);
    const j0 = Math.floor(bb[1] / size), j1 = Math.ceil(bb[4] / size);
    const k0 = Math.floor(bb[2] / size), k1 = Math.ceil(bb[5] / size);
    for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * size;
      for (let j = j0; j <= j1; j++) {
        const y = (j + 0.5) * size;
        for (let k = k0; k <= k1; k++) {
          if (insidePrim(pr, invQ, x, y, (k + 0.5) * size)) cells.set(key(i, j, k), pr.c);
        }
      }
    }
  }

  // 逐面剔除：只输出暴露在外的面
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  const order = [0, 1, 2, 0, 2, 3];

  for (const [kstr, hex] of cells) {
    const [i, j, k] = kstr.split(',').map(Number);
    const cx = (i + 0.5) * size, cy = (j + 0.5) * size, cz = (k + 0.5) * size;
    c.set(hex);
    for (let f = 0; f < 6; f++) {
      const [n, u, v] = FACES[f];
      if (cells.has(key(i + n[0], j + n[1], k + n[2]))) continue;

      const corners = [];
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        corners.push([
          cx + n[0] * half + (u[0] * su + v[0] * sv) * half,
          cy + n[1] * half + (u[1] * su + v[1] * sv) * half,
          cz + n[2] * half + (u[2] * su + v[2] * sv) * half,
        ]);
      }
      for (const oi of order) {
        const p = corners[oi];
        pos.push(p[0], p[1], p[2]);
        nor.push(n[0], n[1], n[2]);
        col.push(c.r, c.g, c.b);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/* ── 按模式取构建器 ─────────────────────────────────── */
export function makeBuilder(mode, voxelSize) {
  const vs = voxelSize || 0.07;
  return (prims) => (mode === 'voxel' ? buildVoxelGeometry(prims, vs) : buildSmoothGeometry(prims));
}

export function makeMaterial(mode) {
  return mode === 'voxel'
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.04 });
}
