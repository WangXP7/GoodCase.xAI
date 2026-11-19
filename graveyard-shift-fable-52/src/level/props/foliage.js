// Treeline, undergrowth and weeds as alpha cards: whole-tree silhouettes on crossed planes plus a
// few drooping boughs, drawn once into a canvas. Normals are bent outward from the trunk so a lamp
// or the moon shades a tree as a volume rather than as flat cards.
import { BufferGeometry, BufferAttribute, CanvasTexture, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter } from 'three';

const SIZE = 2048;
// regions in pixels: x, y, w, h
const R = {
  treeA: [0, 0, 640, 1408], treeB: [640, 0, 640, 1408], treeC: [0, 1408, 480, 640],
  bough: [1280, 0, 768, 512], shrub: [1280, 512, 768, 600], grass: [1280, 1112, 768, 440], weed: [1280, 1552, 768, 496],
  bark: [496, 1424, 120, 600],
};
const uvOf = (r) => [r[0] / SIZE, 1 - (r[1] + r[3]) / SIZE, (r[0] + r[2]) / SIZE, 1 - r[1] / SIZE];

function needles(c, rng, x0, y0, x1, y1, sag, len, dark) {
  // a bough from (x0,y0) to (x1,y1) that sags in the middle: a dark solid mass first, so the tree
  // is opaque where it is thick, then short strokes that break up its edge
  const n = Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0) / 5));
  const at = (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI * 0.9) * sag];
  c.fillStyle = `rgb(${Math.round(9 * dark)},${Math.round(17 * dark)},${Math.round(11 * dark)})`;
  c.beginPath();
  for (let i = 0; i <= n; i++) { const p = at(i / n); c.lineTo(p[0], p[1] - len * 0.35 * (1 - (i / n) * 0.8)); }
  for (let i = n; i >= 0; i--) { const p = at(i / n); c.lineTo(p[0], p[1] + len * 1.0 * (1 - (i / n) * 0.7)); }
  c.fill();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = at(t);
    const k = 1 - 0.55 * t;
    for (let j = 0; j < 4; j++) {
      const a = Math.atan2(y1 - y0, x1 - x0) + (rng.next() - 0.5) * 2.4 + 0.5;
      const l = len * k * (0.5 + rng.next());
      const g = Math.round((20 + rng.next() * 30) * dark), rr = Math.round(g * (0.42 + rng.next() * 0.2)), b = Math.round(g * (0.5 + rng.next() * 0.2));
      c.strokeStyle = `rgb(${rr},${g},${b})`;
      c.lineWidth = 2 + rng.next() * 3;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l + l * 0.35); c.stroke();
    }
  }
}

function drawConifer(c, rng, r, o) {
  const [x, y, w, h] = r;
  const cx = x + w / 2;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  // trunk
  c.strokeStyle = '#17110c'; c.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const t0 = i / 40, t1 = (i + 1) / 40;
    c.lineWidth = 3 + 18 * t1;
    c.beginPath(); c.moveTo(cx + Math.sin(i * 0.4) * 3, y + 12 + (h - 12) * t0); c.lineTo(cx + Math.sin((i + 1) * 0.4) * 3, y + 12 + (h - 12) * t1); c.stroke();
  }
  // boughs, tip to skirt
  const start = o.bare || 0.16;
  let yy = y + 16;
  while (yy < y + h * (1 - start)) {
    const t = (yy - y) / (h * (1 - start));
    for (const s of [-1, 1]) {
      if (rng.next() < (o.gap || 0.08)) continue;
      const reach = (w / 2 - 16) * Math.pow(t, o.shape || 0.72) * (0.55 + 0.5 * rng.next());
      const droop = reach * (0.22 + 0.5 * t) * (0.6 + 0.8 * rng.next());
      needles(c, rng, cx, yy, cx + s * reach, yy + droop, reach * 0.12, 10 + 16 * t, 0.75 + 0.4 * (1 - t));
    }
    yy += 9 + rng.next() * (o.step || 9) * 2 * (0.6 + t);
  }
  c.restore();
}

function drawDead(c, rng, r) {
  // a snag: bare trunk and broken limbs
  const [x, y, w, h] = r;
  const cx = x + w / 2;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.strokeStyle = '#1b1510'; c.lineCap = 'round';
  const limb = (x0, y0, a, len, wd, depth) => {
    const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
    c.lineWidth = wd; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    if (depth <= 0 || len < 16) return;
    const n = 1 + Math.floor(rng.next() * 2.4);
    for (let i = 0; i < n; i++) limb(x0 + (x1 - x0) * (0.4 + 0.6 * rng.next()), y0 + (y1 - y0) * (0.4 + 0.6 * rng.next()), a + (rng.next() - 0.5) * 1.7, len * (0.45 + 0.3 * rng.next()), wd * 0.6, depth - 1);
  };
  limb(cx, y + h, -Math.PI / 2 + 0.03, h * 0.9, 18, 0);
  for (let i = 0; i < 9; i++) {
    const t = 0.15 + 0.7 * rng.next();
    const s = rng.next() < 0.5 ? -1 : 1;
    limb(cx, y + h - h * 0.9 * t, -Math.PI / 2 + s * (0.7 + rng.next() * 0.6), (w / 2 - 20) * (1 - t * 0.6) * (0.5 + 0.5 * rng.next()), 9 * (1 - t * 0.5), 2);
  }
  c.restore();
}

function drawBough(c, rng, r) {
  const [x, y, w, h] = r;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  for (let i = 0; i < 7; i++) {
    const a = -0.5 + (i / 6) * 1.0;
    needles(c, rng, x + 12, y + h * 0.4, x + 12 + Math.cos(a) * (w - 60) * (0.7 + 0.3 * rng.next()), y + h * 0.4 + Math.sin(a) * (w - 60) * 0.5, 28, 26, 1);
  }
  c.restore();
}

function drawShrub(c, rng, r) {
  const [x, y, w, h] = r;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  for (let i = 0; i < 46; i++) {
    const a = -Math.PI * (0.08 + 0.84 * rng.next());
    const len = h * (0.45 + 0.5 * rng.next());
    const bx = x + w / 2 + (rng.next() - 0.5) * w * 0.3;
    c.strokeStyle = '#1a140d'; c.lineWidth = 3;
    const ex = bx + Math.cos(a) * len * (w / h) * 0.55, ey = y + h + Math.sin(a) * len;
    c.beginPath(); c.moveTo(bx, y + h); c.quadraticCurveTo(bx, y + h - len * 0.6, ex, ey); c.stroke();
    for (let j = 0; j < 16; j++) {
      const t = 0.35 + 0.65 * rng.next();
      const lx = bx + (ex - bx) * t * t + (rng.next() - 0.5) * 32, ly = y + h + (ey - y - h) * t + (rng.next() - 0.5) * 32;
      const g = Math.round(30 + rng.next() * 40);
      c.fillStyle = `rgb(${Math.round(g * 0.55)},${g},${Math.round(g * 0.4)})`;
      c.beginPath(); c.ellipse(lx, ly, 6 + rng.next() * 10, 4 + rng.next() * 6, rng.next() * 3.14, 0, 6.3); c.fill();
    }
  }
  c.restore();
}

function drawGrass(c, rng, r, tall) {
  const [x, y, w, h] = r;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  const n = tall ? 70 : 150;
  for (let i = 0; i < n; i++) {
    const bx = x + 20 + rng.next() * (w - 40);
    const len = h * (tall ? 0.5 + 0.48 * rng.next() : 0.3 + 0.6 * rng.next());
    const lean = (rng.next() - 0.5) * (tall ? 100 : 140);
    const g = Math.round(22 + rng.next() * 30);
    c.strokeStyle = tall && rng.next() < 0.3 ? `rgb(${Math.round(g * 0.9)},${Math.round(g * 0.8)},${Math.round(g * 0.45)})` : `rgb(${Math.round(g * 0.6)},${g},${Math.round(g * 0.4)})`;
    c.lineWidth = tall ? 3.2 + rng.next() * 3.2 : 2.4 + rng.next() * 2.8;
    c.beginPath(); c.moveTo(bx, y + h); c.quadraticCurveTo(bx + lean * 0.2, y + h - len * 0.6, bx + lean, y + h - len); c.stroke();
    if (tall && rng.next() < 0.35) { c.fillStyle = c.strokeStyle; c.beginPath(); c.ellipse(bx + lean, y + h - len, 5, 14, lean * 0.005, 0, 6.3); c.fill(); }
  }
  c.restore();
}

export function createFoliageTexture(rng) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, SIZE, SIZE);
  drawConifer(c, rng.fork('a'), R.treeA, { shape: 0.72, step: 8, gap: 0.06 });
  drawConifer(c, rng.fork('b'), R.treeB, { shape: 0.55, step: 13, gap: 0.22, bare: 0.3 });
  drawDead(c, rng.fork('c'), R.treeC);
  drawBough(c, rng.fork('d'), R.bough);
  drawShrub(c, rng.fork('e'), R.shrub);
  drawGrass(c, rng.fork('f'), R.grass, false);
  drawGrass(c, rng.fork('g'), R.weed, true);
  c.fillStyle = '#17110c'; c.fillRect(...R.bark);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.anisotropy = 4;
  return t;
}

// ---- geometry ------------------------------------------------------------------------------------

function cards(list) {
  // list: [{ p: [4 corners xyz], uv: [u0,v0,u1,v1], n: fn(x,y,z) -> [nx,ny,nz] }]
  const pos = [], nrm = [], uv = [], idx = [];
  list.forEach((q, k) => {
    const [u0, v0, u1, v1] = q.uv;
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    q.p.forEach((p, i) => {
      pos.push(p[0], p[1], p[2]);
      const n = q.n(p[0], p[1], p[2]);
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      nrm.push(n[0] / l, n[1] / l, n[2] / l);
      uv.push(uvs[i][0], uvs[i][1]);
    });
    const a = k * 4;
    idx.push(a, a + 1, a + 2, a, a + 2, a + 3, a, a + 2, a + 1, a, a + 3, a + 2); // both windings: the bent normals must not flip
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}

// upright quad through the y axis at angle a, spanning x in [-w/2, w/2], y in [0, h]
const upright = (a, w, h, y0 = 0, off = 0) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2 * c + off * -s, y0, -w / 2 * s + off * c], [w / 2 * c + off * -s, y0, w / 2 * s + off * c], [w / 2 * c + off * -s, y0 + h, w / 2 * s + off * c], [-w / 2 * c + off * -s, y0 + h, -w / 2 * s + off * c]];
};

// kind 'A' (full spruce), 'B' (thin pine), 'C' (dead snag). h: height in metres. near: add boughs.
export function treeGeometry(rng, kind, h, near) {
  const r = kind === 'A' ? R.treeA : kind === 'B' ? R.treeB : R.treeC;
  const w = h * (r[2] / r[3]);
  const uv = uvOf(r);
  const vol = (x, y, z) => [x * 1.4, 0.35 * (y / h - 0.3) * w, z * 1.4]; // outward and a little up
  const list = [];
  const a0 = rng.range(0, Math.PI);
  const planes = near ? 3 : 2;
  for (let i = 0; i < planes; i++) list.push({ p: upright(a0 + (i * Math.PI) / planes, w, h), uv: i % 2 ? [uv[2], uv[1], uv[0], uv[3]] : uv, n: vol });
  if (near && kind !== 'C') {
    const buv = uvOf(R.bough);
    const n = kind === 'A' ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const u = (i + rng.next()) / n; // 0 low on the tree .. 1 near the top
      const a = rng.range(0, 6.28);
      const len = (w / 2) * (1 - 0.82 * u) * rng.range(0.9, 1.25), wd = len * 0.62;
      const yy = h * (0.2 + 0.62 * u);
      const ca = Math.cos(a), sa = Math.sin(a);
      const droop = len * rng.range(0.25, 0.5), roll = rng.range(-0.5, 0.5) * wd;
      const px = -sa, pz = ca; // across the bough
      list.push({
        p: [[px * -wd / 2, yy + roll * 0.3, pz * -wd / 2], [ca * len + px * -wd / 2, yy - droop + roll * 0.3, sa * len + pz * -wd / 2], [ca * len + px * wd / 2, yy - droop - roll * 0.3, sa * len + pz * wd / 2], [px * wd / 2, yy - roll * 0.3, pz * wd / 2]],
        uv: buv, n: (x, yv, z) => [x * 0.5, 1, z * 0.5],
      });
    }
  }
  return cards(list);
}

export function shrubGeometry(rng, s) {
  const uv = uvOf(R.shrub);
  const w = 1.9 * s, h = 1.35 * s;
  const a0 = rng.range(0, Math.PI);
  const n = (x, y, z) => [x, 0.9 * h, z];
  return cards([0, 1, 2].map((i) => ({ p: upright(a0 + i * 1.05, w, h, -0.05, rng.range(-0.15, 0.15)), uv: i % 2 ? [uv[2], uv[1], uv[0], uv[3]] : uv, n })));
}

export function grassGeometry(rng, s, tall) {
  const uv = uvOf(tall ? R.weed : R.grass);
  const w = (tall ? 1.1 : 0.9) * s, h = (tall ? 0.85 : 0.42) * s;
  const a0 = rng.range(0, Math.PI);
  const n = () => [0, 1, 0];
  return cards([0, 1].map((i) => ({ p: upright(a0 + i * 1.57, w, h, -0.02), uv: i ? [uv[2], uv[1], uv[0], uv[3]] : uv, n })));
}
