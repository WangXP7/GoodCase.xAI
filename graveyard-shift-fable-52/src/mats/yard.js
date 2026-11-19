// The yard's surfaces and the world objects' material.
//
// Static places (the garage, the scrapyard) are authored into the interior art (one material,
// light baked per vertex, powered groups): YARD names the surface kinds they use there.
//
// World objects (the weapon box, the machines, the bench's lamp, the power switch, wall-buy boards,
// neon signs, pickups, power-ups) change state, so they get one material of their own: vertex
// colour, one sheet of art (brand panels, weapon silhouettes, stencils, sign lettering) and a glow
// per vertex on a numbered channel. A channel's gain is one float in a uniform array, so every
// object in the game shares the material and a state change is one number written, never a
// recompile. Channel 0 is always on.
import {
  BufferGeometry, BufferAttribute, MeshStandardMaterial, Matrix4, Matrix3, Vector3, CanvasTexture, DataTexture, RGBAFormat,
  SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter, BoxGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rgb, M } from '../level/build.js';

// ---- surfaces of the yard, as kinds of the interior art material ----------------------------------
export const YARD = {
  rustHeavy: { kind: 'metal', color: rgb(0x4a2a1a), par: 1.6 },
  corrugated: { kind: 'clad', color: rgb(0x6b7572), par: 1 },
  oilConcrete: { kind: 'concrete', color: rgb(0x4c4a45) },
  tyre: { kind: 'paint', color: rgb(0x0a0a0b), par: 0 },
  tarp: { kind: 'curtain', color: rgb(0x26455f), par: 0 },
};

// ---- the sheet ---------------------------------------------------------------------------------------
const HEAD = '"Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif';
const SANS = '"Helvetica Neue", "Arial", sans-serif';
const SCRIPT = '"Brush Script MT", "Snell Roundhand", cursive';
const SHEET_W = 2048, SHEET_H = 2048;
function text(c, s, x, y, px, color, font = HEAD, align = 'center', weight = '', maxW = 0) {
  c.font = `${weight} ${px}px ${font}`;
  if (maxW > 0) { const wd = c.measureText(s).width; if (wd > maxW) c.font = `${weight} ${Math.floor(px * maxW / wd)}px ${font}`; }
  c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color;
  c.fillText(s, x, y);
}
function poly(c, pts) { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }
function wear(c, w, h, rng, n, a) {
  if (!rng) return;
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(3, 30);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(24,18,10,${a * rng.range(0.3, 1)})`); g.addColorStop(1, 'rgba(24,18,10,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// Weapon silhouettes, side on, muzzle to the right, in a 100 x 36 box. Each is a list of polygons;
// they are the game's own guns (tuning.weapons.table ids), drawn from their viewmodels' proportions.
export const WEAPON_IDS = ['pistol', 'revolver', 'pump', 'autoShotgun', 'smg', 'rifle', 'battleRifle', 'lmg', 'jumper', 'flare'];
const R = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const GUNS = {
  pistol: [R(28, 8, 70, 16), R(30, 16, 66, 19), [[32, 19], [45, 19], [41, 34], [28, 34]], [[45, 19], [54, 19], [54, 21], [50, 25], [45, 25]], R(66, 6.5, 68, 8)],
  revolver: [R(52, 8, 84, 12.5), R(52, 12.5, 70, 14.5), R(34, 7, 54, 20), [[24, 12], [36, 15], [38, 20], [33, 34], [20, 33], [24, 22]], [[38, 20], [50, 20], [50, 22], [45, 26], [40, 25]], R(30, 5, 35, 9), R(81, 6, 83, 8)],
  pump: [R(32, 9.5, 98, 12.5), R(42, 13.5, 92, 16.5), R(54, 12.5, 72, 19.5), R(24, 8.5, 44, 19), [[2, 11], [24, 9.5], [24, 19], [14, 20], [3, 26]], [[30, 19], [40, 19], [40, 21], [36, 24], [30, 23]], R(95, 7.5, 97, 9.5)],
  autoShotgun: [R(34, 9.5, 97, 12.5), R(44, 13.5, 86, 17), R(26, 8, 48, 19.5), [[2, 12], [26, 9.5], [26, 17], [8, 24], [2, 24]], [[28, 19.5], [36, 19.5], [32, 31], [25, 30]], R(38, 19.5, 44, 27), R(50, 12.5, 58, 13.5), R(94, 7.5, 96, 9.5)],
  smg: [R(26, 9, 62, 17), R(62, 11, 78, 14), R(42, 17, 48, 35), [[28, 17], [36, 17], [33, 29], [25, 28]], R(4, 9.5, 26, 11.5), R(4, 9.5, 6, 21), R(52, 17, 60, 19), R(72, 8, 74, 11), R(30, 6.5, 34, 9)],
  rifle: [[[2, 11], [22, 9], [22, 17], [10, 20], [2, 20]], R(22, 9, 52, 18), R(52, 10, 74, 16.5), R(74, 12, 97, 14), [[40, 18], [47, 18], [52, 33], [44, 33]], [[26, 18], [33, 18], [30, 29], [23, 28]], R(28, 5.5, 46, 7), R(28, 7, 31, 9), R(43, 7, 46, 9), [[78, 6], [81, 6], [82, 12], [77, 12]]],
  battleRifle: [[[1, 11], [20, 9.5], [24, 18.5], [8, 22], [1, 21]], R(20, 9.5, 50, 18.5), R(50, 11, 72, 17), R(72, 12, 99, 14.5), R(38, 18.5, 46, 32), [[24, 18.5], [31, 18.5], [28, 28], [22, 27]], R(26, 7, 34, 9.5), [[84, 6.5], [87, 6.5], [88, 12], [83, 12]], R(96, 11, 99, 15.5)],
  lmg: [[[1, 11], [18, 9], [18, 19], [6, 22], [1, 21]], R(18, 8.5, 50, 19), R(50, 10.5, 70, 16), R(70, 11.5, 99, 14), R(34, 19, 50, 31), [[20, 19], [27, 19], [24, 29], [18, 28]], R(40, 4, 54, 6), R(42, 6, 44, 8.5), R(51, 6, 53, 8.5), [[78, 14], [80, 14], [74, 33], [72, 33]], [[82, 14], [84, 14], [90, 33], [88, 33]], R(95, 10, 99, 15.5)],
  jumper: [R(20, 10, 60, 19), R(60, 12, 82, 17), R(82, 9.5, 88, 19.5), R(90, 11, 92, 18), R(94, 12.5, 96, 16.5), R(28, 4, 50, 10), [[24, 19], [32, 19], [29, 31], [21, 30]], [[2, 12], [20, 11], [20, 18], [6, 22], [2, 21]], R(40, 19, 54, 24), R(64, 8, 66, 12), R(70, 8, 72, 12), R(76, 8, 78, 12)],
  flare: [R(34, 7, 70, 18), R(70, 8.5, 74, 16.5), R(30, 9, 36, 18), [[32, 18], [45, 18], [41, 34], [27, 33]], [[45, 18], [55, 18], [55, 20], [50, 25], [45, 24]], R(28, 5, 33, 9)],
};
const GUN_W = 320, GUN_H = 116;
export const CHALKED = ['pump', 'autoShotgun', 'smg', 'rifle']; // the weapons sold off a wall
function drawGun(c, id, w, h, outline) {
  const s = w / 100, oy = (h - 36 * s) / 2;
  c.save(); c.translate(0, oy); c.scale(s, s);
  c.lineJoin = 'round';
  for (const p of GUNS[id]) {
    poly(c, p);
    if (outline) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); } else { c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 0.6; c.stroke(); }
  }
  if (outline) { c.globalCompositeOperation = 'destination-out'; for (const p of GUNS[id]) { poly(c, p); c.fill(); } c.globalCompositeOperation = 'source-over'; }
  c.restore();
}

// Machine fronts: each brand has its own colours, mark and line. 320 x 560.
export const BRANDS = {
  secondHelping: { bg: '#e9dfc0', ink: '#1f5a3a', hot: '#c8452a', name: ['SECOND', 'HELPING'], line: 'eat up · stand longer', mark: 'plate' },
  shortOrder: { bg: '#b8231c', ink: '#ffe9a8', hot: '#ffd23a', name: ['SHORT', 'ORDER'], line: 'hands that never fumble', mark: 'bell' },
  longHaul: { bg: '#18324e', ink: '#f2a43a', hot: '#f4efe0', name: ['LONG', 'HAUL'], line: 'more road in every stride', mark: 'road' },
  jumpStart: { bg: '#f2c318', ink: '#17171a', hot: '#c2271c', name: ['JUMP', 'START'], line: 'one more go · then pay again', mark: 'bolt' },
};
function drawBrand(c, w, h, rng, b) {
  c.fillStyle = b.bg; c.fillRect(0, 0, w, h);
  c.fillStyle = b.ink; c.fillRect(0, 0, w, 16); c.fillRect(0, h - 16, w, 16);
  c.strokeStyle = b.ink; c.lineWidth = 6; c.strokeRect(20, 34, w - 40, h - 68);
  text(c, b.name[0], w / 2, 104, 92, b.ink, HEAD, 'center', '', w - 70);
  text(c, b.name[1], w / 2, 190, 92, b.hot, HEAD, 'center', '', w - 70);
  const cx = w / 2, cy = 342;
  if (b.mark === 'plate') {
    c.fillStyle = b.ink; c.beginPath(); c.arc(cx, cy, 86, 0, 7); c.fill();
    c.fillStyle = b.bg; c.beginPath(); c.arc(cx, cy, 70, 0, 7); c.fill();
    c.fillStyle = b.hot; c.beginPath(); c.arc(cx - 14, cy + 6, 40, Math.PI, 0); c.fill(); c.beginPath(); c.arc(cx + 22, cy + 10, 30, Math.PI, 0); c.fill();
    c.fillStyle = b.ink; c.fillRect(cx - 62, cy + 6, 124, 10);
    for (const s of [-1, 1]) { c.fillRect(cx + s * 118 - 5, cy - 80, 10, 160); if (s < 0) for (let i = -1; i <= 1; i++) c.fillRect(cx + s * 118 + i * 12 - 3, cy - 96, 6, 44); else { c.beginPath(); c.ellipse(cx + s * 118, cy - 70, 14, 34, 0, 0, 7); c.fill(); } }
  } else if (b.mark === 'bell') {
    c.fillStyle = b.hot; c.beginPath(); c.arc(cx, cy + 30, 92, Math.PI, 0); c.fill();
    c.fillStyle = b.ink; c.fillRect(cx - 112, cy + 30, 224, 18); c.beginPath(); c.arc(cx, cy - 66, 14, 0, 7); c.fill();
    c.strokeStyle = b.ink; c.lineWidth = 7; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(cx + s * 116, cy - 40); c.lineTo(cx + s * 146, cy - 62); c.moveTo(cx + s * 124, cy - 6); c.lineTo(cx + s * 156, cy - 10); c.stroke(); }
    c.fillStyle = '#f4efe0'; c.fillRect(cx - 40, cy + 62, 80, 60); c.fillStyle = b.bg; for (let i = 0; i < 4; i++) c.fillRect(cx - 30, cy + 72 + i * 12, 40 + ((i * 17) % 20), 4);
  } else if (b.mark === 'road') {
    c.fillStyle = b.ink; poly(c, [[cx - 22, cy - 96], [cx + 22, cy - 96], [cx + 124, cy + 96], [cx - 124, cy + 96]]); c.fill();
    c.fillStyle = b.bg; for (let i = 0; i < 5; i++) { const t = i / 5, y0 = cy - 90 + t * t * 186 + i * 6, hh = 10 + i * 9, ww = 3 + i * 3; c.fillRect(cx - ww, y0, ww * 2, hh); }
    c.fillStyle = b.hot; c.beginPath(); c.arc(cx + 84, cy - 70, 26, 0, 7); c.fill();
  } else {
    c.fillStyle = b.ink; c.fillRect(cx - 100, cy - 54, 200, 128); c.fillRect(cx - 74, cy - 78, 40, 26); c.fillRect(cx + 34, cy - 78, 40, 26);
    c.fillStyle = b.bg; poly(c, [[cx + 14, cy - 44], [cx - 40, cy + 16], [cx - 6, cy + 16], [cx - 22, cy + 64], [cx + 40, cy - 2], [cx + 6, cy - 2]]); c.fill();
    text(c, '+', cx - 78, cy - 26, 40, b.bg); text(c, '–', cx + 78, cy - 28, 40, b.bg);
  }
  text(c, b.line, w / 2, 474, 26, b.ink, SANS, 'center', 'bold', w - 70);
  text(c, 'INSERT POINTS', w / 2, 516, 22, b.hot === '#f4efe0' ? b.ink : b.hot, HEAD, 'center', '', w - 80);
  wear(c, w, h, rng, 50, 0.22);
}

const ENTRIES = [
  ['white', 16, 16, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); }],
  ['garage', 1536, 288, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    text(c, "Rudy's", 250, h / 2 - 6, 200, '#ffffff', SCRIPT, 'center', '', 440);
    text(c, 'GARAGE', 1010, h / 2 + 8, 270, '#ffffff', HEAD, 'center', '', 1000);
  }],
  ['garageSub', 1024, 96, (c, w, h) => { c.clearRect(0, 0, w, h); text(c, 'TOWING  ·  SALVAGE  ·  24 HR', w / 2, h / 2 + 3, 78, '#ffffff', HEAD, 'center', '', 990); }],
  ['topper', 768, 176, (c, w, h) => { c.fillStyle = '#0c0a08'; c.fillRect(0, 0, w, h); text(c, 'TRUCK STOP', w / 2, h / 2 + 4, 150, '#ffffff', HEAD, 'center', '', 720); }],
  ['open', 512, 176, (c, w, h) => { c.clearRect(0, 0, w, h); text(c, 'OPEN', w / 2, h / 2 + 4, 170, '#ffffff', HEAD, 'center', '', 480); }],
  ['salvage', 768, 160, (c, w, h, rng) => {
    c.fillStyle = '#d8d0b4'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7a1a12'; c.lineWidth = 10; c.strokeRect(8, 8, w - 16, h - 16);
    text(c, 'WE BUY WRECKS', w / 2, 60, 78, '#7a1a12', HEAD, 'center', '', 700); text(c, 'NO PARTS PULLED AFTER DARK  ·  DOG ON SITE', w / 2, 122, 26, '#1f2a30', SANS, 'center', 'bold', 700);
    wear(c, w, h, rng, 60, 0.35);
  }],
  ['danger', 256, 320, (c, w, h, rng) => {
    c.fillStyle = '#e9e6da'; c.fillRect(0, 0, w, h); c.fillStyle = '#b3201a'; c.fillRect(0, 0, w, 86);
    text(c, 'DANGER', w / 2, 46, 68, '#fff', HEAD, 'center', '', 220);
    c.fillStyle = '#17171a'; poly(c, [[w / 2 + 16, 104], [w / 2 - 34, 172], [w / 2 - 4, 172], [w / 2 - 20, 232], [w / 2 + 40, 152], [w / 2 + 8, 152]]); c.fill();
    text(c, 'MAIN SUPPLY', w / 2, 262, 34, '#17171a', HEAD, 'center', '', 220); text(c, 'THROW TO RESTORE', w / 2, 296, 20, '#17171a', SANS, 'center', 'bold', 220);
    wear(c, w, h, rng, 20, 0.3);
  }],
  ['onoff', 96, 256, (c, w, h) => { c.fillStyle = '#17171a'; c.fillRect(0, 0, w, h); text(c, 'ON', w / 2, 44, 50, '#e9e6da', HEAD); text(c, 'OFF', w / 2, h - 40, 50, '#e9e6da', HEAD, 'center', '', 80); }],
  ['freight', 640, 224, (c, w, h, rng) => {
    c.clearRect(0, 0, w, h);
    text(c, 'LARKSPUR LINE FREIGHT', w / 2, 44, 50, '#fff', HEAD, 'center', '', 610);
    text(c, 'LOT 77  ·  DO NOT DROP', w / 2, 106, 44, '#fff', HEAD, 'center', '', 560);
    text(c, 'HOLD FOR COLLECTION', w / 2, 170, 54, '#fff', HEAD, 'center', '', 600);
    if (rng) { c.globalCompositeOperation = 'destination-out'; wear(c, w, h, rng, 70, 0.9); c.globalCompositeOperation = 'source-over'; }
  }],
  ['arrows', 224, 224, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.fillStyle = '#fff';
    for (const x of [62, 162]) { poly(c, [[x, 20], [x + 44, 86], [x + 16, 86], [x + 16, 170], [x - 16, 170], [x - 16, 86], [x - 44, 86]]); c.fill(); }
    c.fillRect(20, 190, 184, 14);
  }],
  ['query', 128, 128, (c, w, h) => { c.clearRect(0, 0, w, h); text(c, '?', w / 2, h / 2 + 6, 130, '#fff', HEAD); }],
  ['upgrade', 512, 160, (c, w, h, rng) => {
    c.fillStyle = '#1b2224'; c.fillRect(0, 0, w, h); c.strokeStyle = '#d99a2a'; c.lineWidth = 8; c.strokeRect(8, 8, w - 16, h - 16);
    text(c, 'REWORK BENCH', w / 2, 58, 70, '#d99a2a', HEAD, 'center', '', 460); text(c, 'one job per gun  ·  no refunds', w / 2, 118, 28, '#e9e6da', SANS, 'center', 'bold', 450);
    wear(c, w, h, rng, 30, 0.3);
  }],
  ['orders', 320, 256, (c, w, h, rng) => {
    c.fillStyle = '#6a4a2a'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) { const x = 16 + (i % 3) * 100, y = 18 + Math.floor(i / 3) * 120; c.fillStyle = ['#efe9d6', '#f2d9d0', '#dfe8ee'][i % 3]; c.save(); c.translate(x + 44, y + 52); c.rotate(rng ? rng.range(-0.08, 0.08) : 0); c.fillRect(-44, -52, 88, 104); c.fillStyle = '#3a4a6a'; for (let k = 0; k < 6; k++) c.fillRect(-36, -36 + k * 14, 40 + ((k * 23 + i * 7) % 30), 3); c.fillStyle = '#b3201a'; c.beginPath(); c.arc(0, -46, 5, 0, 7); c.fill(); c.restore(); }
  }],
  ['plate', 256, 128, (c, w, h, rng) => { c.fillStyle = '#d9d6c8'; c.fillRect(0, 0, w, h); c.strokeStyle = '#1f2a30'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12); text(c, 'RUD·0077', w / 2, h / 2 + 4, 62, '#1f2a30', HEAD, 'center', '', 220); wear(c, w, h, rng, 12, 0.3); }],
  ['sold', 160, 64, (c, w, h) => { c.fillStyle = '#06140a'; c.fillRect(0, 0, w, h); text(c, 'SERVED', w / 2, h / 2 + 2, 46, '#7dffa0', HEAD, 'center', '', 140); }],
  ...Object.keys(BRANDS).map((k) => [`brand:${k}`, 320, 560, (c, w, h, rng) => drawBrand(c, w, h, rng, BRANDS[k])]),
  ...Object.keys(BRANDS).map((k) => [`head:${k}`, 448, 96, (c, w, h) => { const b = BRANDS[k]; c.fillStyle = b.ink; c.fillRect(0, 0, w, h); text(c, b.name.join(' '), w / 2, h / 2 + 3, 76, b.bg, HEAD, 'center', '', w - 30); }]),
  ...WEAPON_IDS.map((id) => [`gun:${id}`, GUN_W, GUN_H, (c, w, h) => { c.clearRect(0, 0, w, h); drawGun(c, id, w, h, false); }]),
  ...CHALKED.map((id) => [`chalk:${id}`, GUN_W * 2, GUN_H * 2, (c, w, h, rng) => {
    c.clearRect(0, 0, w, h); drawGun(c, id, w, h, true);
    if (rng) { c.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(0,0,0,${rng.range(0.2, 0.9)})`; c.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 5), rng.range(1, 3)); } c.globalCompositeOperation = 'source-over'; }
  }]),
];
const RECTS = (() => {
  const order = ENTRIES.map((e, i) => i).sort((a, b) => ENTRIES[b][2] - ENTRIES[a][2]);
  const rects = {};
  let x = 2, y = 2, rowH = 0;
  for (const i of order) {
    const [name, w, h] = ENTRIES[i];
    if (x + w + 2 > SHEET_W) { x = 2; y += rowH + 4; rowH = 0; }
    rects[name] = { x, y, w, h };
    x += w + 4; rowH = Math.max(rowH, h);
  }
  if (y + rowH > SHEET_H) throw new Error('yard sheet overflow');
  return rects;
})();
// [u0, v0, u1, v1] of an entry (u from the left, v0 the bottom edge), or of a part of it
export function sheetUv(name, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
  const r = RECTS[name];
  if (!r) throw new Error(`yard sheet: no entry "${name}"`);
  return [(r.x + r.w * u0 + 1) / SHEET_W, 1 - (r.y + r.h * v1 - 1) / SHEET_H, (r.x + r.w * u1 - 1) / SHEET_W, 1 - (r.y + r.h * v0 + 1) / SHEET_H];
}
export const sheetAspect = (name) => RECTS[name].w / RECTS[name].h;
const WHITE_UV = (() => { const r = sheetUv('white'); return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]; })();
function sheetTexture(rng) {
  if (typeof document === 'undefined') { const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat); t.needsUpdate = true; return t; }
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W; canvas.height = SHEET_H;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, SHEET_W, SHEET_H);
  for (const [name, w, h, draw] of ENTRIES) {
    const r = RECTS[name];
    c.save(); c.beginPath(); c.rect(r.x, r.y, w, h); c.clip(); c.translate(r.x, r.y);
    draw(c, w, h, rng && rng.fork ? rng.fork(name) : null);
    c.restore();
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 8; t.generateMipmaps = true;
  return t;
}

// ---- the object builder ------------------------------------------------------------------------------
const _v = new Vector3(), _n = new Vector3(), _nm = new Matrix3(), _mw = new Matrix4();
const WHITE = [1, 1, 1], NOGLOW = [0, 0, 0];
// createObj(): geometry for the object material. add(geo, o) / box / quad at the current transform.
// o: m, color, glow [r,g,b] (radiance), ch (gain channel, 0 = always), tex (sheet entry, for geometry
// with uvs 0..1) or uv (a rect).
export function createObj() {
  const pos = [], nrm = [], col = [], uv = [], glow = [], idx = [];
  let n = 0;
  const stack = [new Matrix4()];
  const top = () => stack[stack.length - 1];
  const O = {
    get count() { return n; },
    at(m, fn) { stack.push(new Matrix4().multiplyMatrices(top(), m)); try { fn(); } finally { stack.pop(); } return O; },
    add(geo, o = {}) {
      const mat = o.m ? _mw.multiplyMatrices(top(), o.m) : _mw.copy(top());
      _nm.getNormalMatrix(mat);
      const flip = mat.determinant() < 0;
      const p = geo.getAttribute('position'), nr = geo.getAttribute('normal'), gu = geo.getAttribute('uv');
      const rect = o.uv || (o.tex ? sheetUv(o.tex) : null);
      const c = o.color || WHITE, g = o.glow || NOGLOW, ch = o.glow ? (o.ch || 0) : 0, base = n;
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i).applyMatrix4(mat);
        _n.fromBufferAttribute(nr, i).applyMatrix3(_nm).normalize();
        pos.push(_v.x, _v.y, _v.z); nrm.push(_n.x, _n.y, _n.z); col.push(c[0], c[1], c[2]); glow.push(g[0], g[1], g[2], ch);
        if (rect && gu) uv.push(rect[0] + (rect[2] - rect[0]) * gu.getX(i), rect[1] + (rect[3] - rect[1]) * gu.getY(i)); else uv.push(WHITE_UV[0], WHITE_UV[1]);
      }
      const ix = geo.getIndex(), cnt = ix ? ix.count : p.count;
      for (let i = 0; i < cnt; i += 3) {
        const a = ix ? ix.getX(i) : i, b = ix ? ix.getX(i + 1) : i + 1, d = ix ? ix.getX(i + 2) : i + 2;
        if (flip) idx.push(base + a, base + d, base + b); else idx.push(base + a, base + b, base + d);
      }
      n += p.count;
      geo.dispose();
      return O;
    },
    box(mn, mx, color, o = {}) {
      const w = mx[0] - mn[0], h = mx[1] - mn[1], d = mx[2] - mn[2];
      const g = o.bevel ? new RoundedBoxGeometry(w, h, d, 1, Math.min(o.bevel, w / 2, h / 2, d / 2)) : new BoxGeometry(w, h, d);
      return O.add(g, { ...o, color, m: M((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2, o.rx || 0, o.ry || 0, o.rz || 0) });
    },
    // a flat quad from o along u and v (normal u x v); o.tex / o.uv puts a sheet entry on it. Returns
    // the index of its first vertex (four, in the order 00, 10, 11, 01), for a strip whose uvs change.
    quad(o0, u, v, o = {}) {
      const m = top();
      const O0 = _v.set(o0[0], o0[1], o0[2]).applyMatrix4(m).toArray();
      const U = _v.set(u[0], u[1], u[2]).transformDirection(m).toArray(), ul = Math.hypot(u[0], u[1], u[2]);
      const V = _v.set(v[0], v[1], v[2]).transformDirection(m).toArray(), vl = Math.hypot(v[0], v[1], v[2]);
      const N = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
      const rect = o.uv || (o.tex ? sheetUv(o.tex) : null);
      const c = o.color || WHITE, g = o.glow || NOGLOW, ch = o.glow ? (o.ch || 0) : 0, base = n;
      for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        pos.push(O0[0] + U[0] * ul * i + V[0] * vl * j, O0[1] + U[1] * ul * i + V[1] * vl * j, O0[2] + U[2] * ul * i + V[2] * vl * j);
        nrm.push(N[0], N[1], N[2]); col.push(c[0], c[1], c[2]); glow.push(g[0], g[1], g[2], ch);
        if (rect) uv.push(rect[0] + (rect[2] - rect[0]) * i, rect[1] + (rect[3] - rect[1]) * j); else uv.push(WHITE_UV[0], WHITE_UV[1]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      n += 4;
      return base;
    },
    geometry() {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
      g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      g.setAttribute('aGlow', new BufferAttribute(new Float32Array(glow), 4));
      g.setIndex(n > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : new BufferAttribute(new Uint16Array(idx), 1));
      g.computeBoundingSphere();
      return g;
    },
  };
  return O;
}
// write a sheet entry onto the four vertices of a quad made by O.quad (no allocation)
export function setQuadUv(geometry, first, rect) {
  const a = geometry.getAttribute('uv');
  a.setXY(first, rect[0], rect[1]); a.setXY(first + 1, rect[2], rect[1]); a.setXY(first + 2, rect[2], rect[3]); a.setXY(first + 3, rect[0], rect[3]);
  a.needsUpdate = true;
}

// ---- the material ------------------------------------------------------------------------------------
export const CHANNELS = 56;
let MATS = null;
let nextChannel = 1;
// a gain channel of the object material: channel() -> index; mats.gain[index] = 0..n
export function channel() { if (nextChannel >= CHANNELS) throw new Error('yard: out of glow channels'); return nextChannel++; }
export function resetChannels() { nextChannel = 1; }
export const channelsUsed = () => nextChannel;

export function createYardMats(G) {
  if (MATS) return MATS;
  const gain = new Float32Array(CHANNELS);
  gain[0] = 1;
  const lift = { value: 0.012 };
  const object = new MeshStandardMaterial({ vertexColors: true, map: sheetTexture(G && G.rng ? G.rng.fork('yardSheet') : null), roughness: 0.55, metalness: 0.0 });
  object.onBeforeCompile = (s) => {
    s.uniforms.uObjGain = { value: gain };
    s.uniforms.uObjLift = lift;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aGlow; uniform float uObjGain[${CHANNELS}]; varying vec3 vObjGlow;`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvObjGlow = aGlow.rgb * uObjGain[int(aGlow.w + 0.5)];');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjGlow; uniform float uObjLift; vec3 gObjT = vec3(1.0);')
      .replace('#include <map_fragment>', 'vec4 objT = texture2D(map, vMapUv); if (objT.a < 0.5) discard; diffuseColor.rgb *= objT.rgb; gObjT = objT.rgb;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vObjGlow * gObjT + diffuseColor.rgb * uObjLift;');
  };
  object.customProgramCacheKey = () => 'level:yardObject';
  MATS = { ...YARD, object, gain, lift };
  return MATS;
}
