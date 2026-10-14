/* =====================================================================
   Minecraft — JavaScript Edition
   ---------------------------------------------------------------------
   零依赖 · 原生 WebGL2 · 全程序化生成 · 单文件离线运行
   ===================================================================== */

'use strict';

/* ---------------------------------------------------------------------
   0. 全局常量
   --------------------------------------------------------------------- */
const CH_X = 16;             // 区块 X 尺寸
const CH_Y = 128;            // 世界高度
const CH_Z = 16;             // 区块 Z 尺寸
const CH_AREA = CH_X * CH_Z; // 256
const CH_VOL = CH_X * CH_Y * CH_Z; // 32768
const SEA_LEVEL = 62;         // 海平面
const BEDROCK_LEVEL = 4;      // 基岩层高度
const MAX_LIGHT = 15;

// 世界坐标 → 区块内偏移的索引函数（y-major，利于按列遍历）
const IDX = (x, y, z) => x | (z << 4) | (y << 8);

// 六个方向：0=+X 1=-X 2=+Y(上) 3=-Y(下) 4=+Z 5=-Z
const DIRS = [
  [ 1, 0, 0], [-1, 0, 0],
  [ 0, 1, 0], [ 0,-1, 0],
  [ 0, 0, 1], [ 0, 0,-1],
];
const DIR_OPP = [1, 0, 3, 2, 5, 4];

/* ---------------------------------------------------------------------
   1. 数学工具
   --------------------------------------------------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);
const fract = (v) => v - Math.floor(v);
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* --- mat4（列主序，与 WebGL uniformMatrix4fv 一致） --- */
const M4 = {
  create() { return new Float32Array(16); },
  identity(o) {
    o[0]=1;o[1]=0;o[2]=0;o[3]=0; o[4]=0;o[5]=1;o[6]=0;o[7]=0;
    o[8]=0;o[9]=0;o[10]=1;o[11]=0; o[12]=0;o[13]=0;o[14]=0;o[15]=1; return o;
  },
  copy(o, a) { o.set(a); return o; },
  mul(o, a, b) { // o = a * b
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    for (let i = 0; i < 4; i++) {
      const b0=b[i*4], b1=b[i*4+1], b2=b[i*4+2], b3=b[i*4+3];
      o[i*4+0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      o[i*4+1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      o[i*4+2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      o[i*4+3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    }
    return o;
  },
  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o[0]=f/aspect;o[1]=0;o[2]=0;o[3]=0;
    o[4]=0;o[5]=f;o[6]=0;o[7]=0;
    o[8]=0;o[9]=0;o[10]=(far+near)*nf;o[11]=-1;
    o[12]=0;o[13]=0;o[14]=2*far*near*nf;o[15]=0; return o;
  },
  ortho(o, l, r, b, t, n, f) {
    const lr = 1/(l-r), bt = 1/(b-t), nf = 1/(n-f);
    o[0]=-2*lr;o[1]=0;o[2]=0;o[3]=0;
    o[4]=0;o[5]=-2*bt;o[6]=0;o[7]=0;
    o[8]=0;o[9]=0;o[10]=2*nf;o[11]=0;
    o[12]=(l+r)*lr;o[13]=(t+b)*bt;o[14]=(f+n)*nf;o[15]=1; return o;
  },
  fromTranslation(o, x, y, z) { M4.identity(o); o[12]=x; o[13]=y; o[14]=z; return o; },
  fromScale(o, x, y, z) { M4.identity(o); o[0]=x; o[5]=y; o[10]=z; return o; },
  fromRotX(o, r) {
    const c = Math.cos(r), s = Math.sin(r);
    M4.identity(o); o[5]=c; o[6]=s; o[9]=-s; o[10]=c; return o;
  },
  fromRotY(o, r) {
    const c = Math.cos(r), s = Math.sin(r);
    M4.identity(o); o[0]=c; o[2]=-s; o[8]=s; o[10]=c; return o;
  },
  fromRotZ(o, r) {
    const c = Math.cos(r), s = Math.sin(r);
    M4.identity(o); o[0]=c; o[1]=s; o[4]=-s; o[5]=c; return o;
  },
  /** 第一人称视角矩阵：view = Rx(pitch) · Ry(-yaw) · T(-eye) */
  fpsView(o, ex, ey, ez, yaw, pitch, roll = 0) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // 旋转部分 R = Rx(pitch) * Ry(-yaw) * Rz(roll)
    const r00 = cy * cr,                r01 = -cy * sr,               r02 = sy;
    const r10 = sp * sy * cr + cp * sr, r11 = -sp * sy * sr + cp * cr, r12 = -sp * cy;
    const r20 = -cp * sy * cr + sp * sr,r21 = cp * sy * sr + sp * cr,  r22 = cp * cy;
    o[0]=r00;o[1]=r10;o[2]=r20;o[3]=0;
    o[4]=r01;o[5]=r11;o[6]=r21;o[7]=0;
    o[8]=r02;o[9]=r12;o[10]=r22;o[11]=0;
    o[12]=-(r00*ex + r01*ey + r02*ez);
    o[13]=-(r10*ex + r11*ey + r12*ez);
    o[14]=-(r20*ex + r21*ey + r22*ez);
    o[15]=1;
    return o;
  },
  invert(o, a) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3],a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11],a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10,
          b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12,
          b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30,
          b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
    if (!det) return null;
    det = 1 / det;
    o[0]=(a11*b11-a12*b10+a13*b09)*det; o[1]=(a02*b10-a01*b11-a03*b09)*det;
    o[2]=(a31*b05-a32*b04+a33*b03)*det; o[3]=(a22*b04-a21*b05-a23*b03)*det;
    o[4]=(a12*b08-a10*b11-a13*b07)*det; o[5]=(a00*b11-a02*b08+a03*b07)*det;
    o[6]=(a32*b02-a30*b05-a33*b01)*det; o[7]=(a20*b05-a22*b02+a23*b01)*det;
    o[8]=(a10*b10-a11*b08+a13*b06)*det; o[9]=(a01*b08-a00*b10-a03*b06)*det;
    o[10]=(a30*b04-a31*b02+a33*b00)*det;o[11]=(a21*b02-a20*b04-a23*b00)*det;
    o[12]=(a11*b07-a10*b09-a12*b06)*det;o[13]=(a00*b09-a01*b07+a02*b06)*det;
    o[14]=(a31*b01-a30*b03-a32*b00)*det;o[15]=(a20*b03-a21*b01+a22*b00)*det;
    return o;
  },
  /** 变换一个点（w=1），返回 [x,y,z,w] */
  xformPoint(a, x, y, z) {
    return [
      a[0]*x + a[4]*y + a[8]*z + a[12],
      a[1]*x + a[5]*y + a[9]*z + a[13],
      a[2]*x + a[6]*y + a[10]*z + a[14],
      a[3]*x + a[7]*y + a[11]*z + a[15],
    ];
  },
};

/** 由 yaw/pitch 求单位朝向向量（yaw=0 朝 -Z，pitch>0 抬头） */
function lookDir(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * cp;
  return out;
}

/* ---------------------------------------------------------------------
   2. 随机数与噪声
   --------------------------------------------------------------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32 位整数哈希 → [0,1) */
function hash2i(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed|0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3i(x, y, z, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x1b873593)
        ^ Math.imul(seed|0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 改进 Perlin 噪声 */
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = i;
  const rnd = mulberry32(seed >>> 0);
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const tmp = t[i]; t[i] = t[j]; t[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = t[i & 255];

  const G3 = new Float32Array([
    1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
    1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
    0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1,
  ]);
  const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);

  function grad3(hash, x, y, z) {
    const h = (hash & 11) * 3;
    return G3[h]*x + G3[h+1]*y + G3[h+2]*z;
  }

  function noise2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X+1] + Y], bb = perm[perm[X+1] + Y + 1];
    const x1 = lerp(grad3(aa, xf, yf, 0), grad3(ba, xf-1, yf, 0), u);
    const x2 = lerp(grad3(ab, xf, yf-1, 0), grad3(bb, xf-1, yf-1, 0), u);
    return lerp(x1, x2, v) * 1.4; // 归一化到约 [-1,1]
  }

  function noise3(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y), zf = z - Math.floor(z);
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const A  = perm[X] + Y, AA = perm[A] + Z, AB = perm[A+1] + Z;
    const B  = perm[X+1] + Y, BA = perm[B] + Z, BB = perm[B+1] + Z;
    const x1 = lerp(grad3(perm[AA],   xf, yf, zf),   grad3(perm[BA],   xf-1, yf, zf), u);
    const x2 = lerp(grad3(perm[AB],   xf, yf-1, zf), grad3(perm[BB],   xf-1, yf-1, zf), u);
    const y1 = lerp(x1, x2, v);
    const x3 = lerp(grad3(perm[AA+1], xf, yf, zf-1), grad3(perm[BA+1], xf-1, yf, zf-1), u);
    const x4 = lerp(grad3(perm[AB+1], xf, yf-1, zf-1), grad3(perm[BB+1], xf-1, yf-1, zf-1), u);
    const y2 = lerp(x3, x4, v);
    return lerp(y1, y2, w) * 1.4;
  }

  /** 分形叠加 */
  function fbm2(x, y, oct = 4, lac = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise2(x * freq, y * freq);
      norm += amp; amp *= gain; freq *= lac;
    }
    return sum / norm;
  }
  function fbm3(x, y, z, oct = 4, lac = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise3(x * freq, y * freq, z * freq);
      norm += amp; amp *= gain; freq *= lac;
    }
    return sum / norm;
  }
  /** 山脊噪声（用于山脉） */
  function ridge2(x, y, oct = 4) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(noise2(x * freq, y * freq));
      sum += amp * n * n; norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }
  return { noise2, noise3, fbm2, fbm3, ridge2 };
}

/* ---------------------------------------------------------------------
   3. 杂项
   --------------------------------------------------------------------- */
function fmtTime(t) { // t: 0..1 一天中的比例，0 = 日出(6:00)
  const total = ((t * 24) + 6) % 24;
  const h = Math.floor(total);
  const m = Math.floor((total - h) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function fmtNum(n) { return n.toLocaleString('en-US'); }
function nowMs() { return performance.now(); }
