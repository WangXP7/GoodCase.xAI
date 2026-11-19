// Decals: the few things that lie on a surface rather than being part of it, drawn once into one
// small sheet and laid as flat lit quads: worn paint, leaves, cigarette ends, cups, the handprints
// on the saloon's glass. (Stains, tyre tracks, patches, cracks and the blood on the ground are not
// here: they are painted into the ground material's own maps, see groundMask.js, props/ground.js.)
// createDecals(rng) -> { lit: texture|null, uv(name) -> [u0, v0, u1, v1], aspect(name), isLit(name) }
// Without a DOM (unit tests) the texture is null and the rectangles are still valid.
import { CanvasTexture, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter } from 'three';

const LIT = 1024;
const HEAD = '"Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif';

const stroke = (c, pts, width, style) => {
  c.strokeStyle = style; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
};
// take paint back off: speckle and scuffs, heavier where `where(x, y)` is larger
function wearOff(c, rng, w, h, amount, where = () => 1) {
  c.save();
  c.globalCompositeOperation = 'destination-out';
  const n = Math.round(w * h * 0.03 * amount);
  for (let i = 0; i < n; i++) {
    const x = rng.next() * w, y = rng.next() * h;
    if (rng.next() > where(x, y)) continue;
    const r = 0.8 + rng.next() * rng.next() * 3.5;
    c.fillStyle = `rgba(0,0,0,${0.5 + 0.5 * rng.next()})`;
    c.beginPath(); c.ellipse(x, y, r * (1 + 2 * rng.next()), r, rng.next() * 3.14, 0, 6.3); c.fill();
  }
  for (let i = 0; i < 10 * amount; i++) { // tyre scuffs across it
    c.strokeStyle = `rgba(0,0,0,${0.2 + 0.3 * rng.next()})`; c.lineWidth = 3 + rng.next() * 10;
    const y = rng.next() * h, t = (rng.next() - 0.5) * 0.5;
    c.beginPath(); c.moveTo(-10, y); c.lineTo(w + 10, y + t * w); c.stroke();
  }
  c.restore();
}
function stencil(c, rng, w, h, str, px, wear) {
  c.font = `${px}px ${HEAD}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = 'rgba(112,110,100,0.85)';
  c.fillText(str, w / 2, h / 2 + px * 0.04);
  wearOff(c, rng, w, h, wear);
}

// ---- lit sheet
const LEAF = ['#241b0b', '#2b1d0a', '#191509', '#30240d', '#1e1207', '#23220c'];
const leaves = (c, w, h, rng) => {
  for (let i = 0; i < 170; i++) {
    // thickest along the top edge (the kerb or fence side)
    const y = h * rng.next() ** 1.8, x = rng.next() * w;
    c.save(); c.translate(x, y); c.rotate(rng.next() * 6.283);
    c.fillStyle = LEAF[Math.floor(rng.next() * LEAF.length)];
    const s = 3.5 + rng.next() * 5.5;
    c.beginPath(); c.ellipse(0, 0, s, s * (0.35 + 0.25 * rng.next()), 0, 0, 6.3); c.fill();
    c.strokeStyle = 'rgba(20,14,6,0.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(-s, 0); c.lineTo(s * 1.3, 0); c.stroke();
    c.restore();
  }
  for (let i = 0; i < 14; i++) { c.strokeStyle = '#2a2014'; c.lineWidth = 2; const x = rng.next() * w, y = h * 0.5 * rng.next(); c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rng.next() - 0.5) * 70, y + (rng.next() - 0.5) * 30); c.stroke(); }
};
const debris = (c, w, h, rng) => {
  for (let i = 0; i < 44; i++) { // cigarette ends
    c.save(); c.translate(rng.next() * w, h * rng.next() ** 1.5); c.rotate(rng.next() * 6.283);
    c.fillStyle = '#8f8a7c'; c.fillRect(-5, -1.2, 7, 2.4); c.fillStyle = '#6e4a1c'; c.fillRect(2, -1.2, 3.5, 2.4);
    c.restore();
  }
  for (let i = 0; i < 7; i++) { // crushed paper cups, lids
    c.save(); c.translate(w * (0.06 + 0.88 * rng.next()), h * (0.1 + 0.6 * rng.next())); c.rotate(rng.next() * 6.283);
    c.fillStyle = i % 3 ? '#7d786a' : '#4f0e0a';
    c.beginPath(); c.moveTo(-9, -6); c.lineTo(9, -8); c.lineTo(10, 8); c.lineTo(-8, 5); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(-6, -1, 14, 2);
    c.restore();
  }
  for (let i = 0; i < 26; i++) { // caps, foil, scraps of paper
    c.fillStyle = ['#6f6c62', '#45433c', '#5c6164', '#6e6043', '#1e3042'][Math.floor(rng.next() * 5)];
    c.save(); c.translate(rng.next() * w, h * rng.next() ** 1.3); c.rotate(rng.next() * 3);
    if (i % 3) c.fillRect(-3, -2, 4 + rng.next() * 9, 3 + rng.next() * 6); else { c.beginPath(); c.arc(0, 0, 3, 0, 6.3); c.fill(); }
    c.restore();
  }
};
const handprint = (c, w, h, rng) => {
  // a palm and four fingers dragged down the glass
  const col = 'rgba(150,16,12,0.95)';
  c.fillStyle = col; c.beginPath(); c.ellipse(w * 0.5, h * 0.42, w * 0.2, h * 0.15, 0, 0, 6.3); c.fill();
  for (let i = 0; i < 4; i++) { const x = w * (0.33 + i * 0.11); c.beginPath(); c.ellipse(x, h * (0.2 - 0.03 * Math.sin(i * 1.2 + 0.6)), w * 0.035, h * 0.1, (i - 1.5) * 0.12, 0, 6.3); c.fill(); }
  c.beginPath(); c.ellipse(w * 0.24, h * 0.4, w * 0.035, h * 0.08, -0.9, 0, 6.3); c.fill();
  for (let i = 0; i < 5; i++) { // the drag, and runs
    const x = w * (0.34 + i * 0.08); const g = c.createLinearGradient(0, h * 0.45, 0, h);
    g.addColorStop(0, 'rgba(150,16,12,0.8)'); g.addColorStop(1, 'rgba(150,16,12,0)');
    c.fillStyle = g; c.fillRect(x, h * 0.45, w * (0.03 + 0.03 * rng.next()), h * (0.3 + 0.25 * rng.next()));
  }
  wearOff(c, rng, w, h, 0.5);
};

// name, width, height (px), draw. Shelf-packed; world size is chosen where the decal is placed.
const LIT_ENTRIES = [
  ['leavesA', 500, 160, leaves], ['leavesB', 500, 160, leaves], ['debrisA', 500, 128, debris], ['debrisB', 500, 128, debris],
  ['numbers', 768, 128, (c, w, h, rng) => { for (let i = 0; i < 6; i++) { c.save(); c.translate(i * 128, 0); c.beginPath(); c.rect(0, 0, 128, h); c.clip(); stencil(c, rng, 128, h, String(i + 1), 118, 1.6); c.restore(); } }],
  ['slow', 448, 128, (c, w, h, rng) => stencil(c, rng, w, h, 'SLOW', 124, 1.5)],
  ['trucks', 500, 112, (c, w, h, rng) => stencil(c, rng, w, h, 'TRUCKS', 108, 1.7)],
  ['noPark', 500, 96, (c, w, h, rng) => stencil(c, rng, w, h, 'NO PARKING', 88, 1.4)],
  ['handprint', 128, 160, handprint],
];

function pack(entries, size, pad) {
  const order = entries.map((e, i) => i).sort((a, b) => entries[b][2] - entries[a][2]);
  const rects = {};
  let x = pad, y = pad, rowH = 0;
  for (const i of order) {
    const [name, w, h] = entries[i];
    if (x + w + pad > size) { x = pad; y += rowH + pad; rowH = 0; }
    rects[name] = { x, y, w, h };
    x += w + pad; rowH = Math.max(rowH, h);
  }
  if (y + rowH + pad > size) throw new Error(`decal sheet overflow (${size})`);
  return rects;
}

function draw(entries, rects, size, rng) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, size, size);
  for (const [name, w, h, fn] of entries) {
    const r = rects[name];
    c.save();
    c.beginPath(); c.rect(r.x, r.y, w, h); c.clip();
    c.translate(r.x, r.y);
    fn(c, w, h, rng.fork(name));
    c.restore();
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.anisotropy = 8;
  return t;
}

export function createDecals(rng) {
  const lr = pack(LIT_ENTRIES, LIT, 6);
  const find = (name) => {
    if (!lr[name]) throw new Error(`decals: no entry "${name}"`);
    return lr[name];
  };
  return {
    lit: draw(LIT_ENTRIES, lr, LIT, rng.fork('lit')),
    isLit: (name) => !!lr[name],
    uv(name, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
      const r = find(name);
      const inset = 1 / LIT;
      return [(r.x + r.w * u0) / LIT + inset, 1 - (r.y + r.h * v1) / LIT + inset, (r.x + r.w * u1) / LIT - inset, 1 - (r.y + r.h * v0) / LIT - inset];
    },
    aspect(name) { const r = find(name); return r.w / r.h; },
  };
}
