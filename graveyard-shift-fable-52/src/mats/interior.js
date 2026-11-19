// Interior art for the diner and the motel: one material for every interior surface, the
// sheet of signs that goes with it, the builder the area files author into, and the layer that puts
// it on screen.
//
// One material, one mesh a zone. Each vertex carries its surface kind (tile, linoleum, wood, plaster,
// vinyl, carpet, laminate, curtain, metal, sign, glow, neon, ceiling tile, stucco, concrete, worn
// paint), so a whole room is a single draw call. Patterns are computed from world position and the
// load-time noise volumes (three fetches, a fourth for walls).
//
// Light. A room has far more fittings than the light pool has slots, so every fitting's light is
// baked per vertex at build time as two colours: what reaches the vertex from lamps that burn
// without the power (aBakeA) and from lamps that need it (aBakeP). The shader adds
// albedo * (aBakeA * always + aBakeP * powered), where the two gains come per light group (a room)
// from the layer each frame: the power, the flicker of the room's real fixture, and a cut while that
// fixture holds a real light so the two are not counted twice. Glow faces and neon carry their own
// radiance in the same two attributes.
//
// Nothing here needs a renderer until installAreaArt(G): the area builders run in tests.
import {
  BufferGeometry, BufferAttribute, MeshStandardMaterial, Matrix4, Matrix3, Vector3, CanvasTexture, SRGBColorSpace,
  LinearMipmapLinearFilter, LinearFilter, BoxGeometry, DataTexture, RGBAFormat, DoubleSide, Mesh,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M } from '../level/build.js';
import { world as T } from '../game/tuning/world.js';

export const KIND = {
  paint: 0, tile: 1, linoleum: 2, wood: 3, plaster: 4, vinyl: 5, carpet: 6, laminate: 7, curtain: 8, metal: 9,
  sign: 10, glow: 11, neon: 12, ceiling: 13, stucco: 14, concrete: 15, mark: 16, clad: 17,
};
const MAX_GROUPS = 40;
const UNIT = 1 / 10; // scene intensity per candela (render/lights.js)
const chroma = (r, g, b) => { const y = r * 0.2126 + g * 0.7152 + b * 0.0722; return [r / y, g / y, b / y]; };
export const LIGHT = {
  tube: chroma(0.8, 1.0, 0.9), warm: chroma(1.0, 0.72, 0.42), red: chroma(1.0, 0.07, 0.04), pink: chroma(1.0, 0.16, 0.42),
  teal: chroma(0.1, 1.0, 0.82), tv: chroma(0.5, 0.7, 1.0), sodium: chroma(1.0, 0.46, 0.075), candle: chroma(1.0, 0.55, 0.18),
  moon: chroma(0.55, 0.7, 1.0), amber: chroma(1.0, 0.6, 0.12),
};

// ---- the sign sheet -------------------------------------------------------------------------------
const HEAD = '"Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif';
const SANS = '"Helvetica Neue", "Arial", sans-serif';
const SCRIPT = '"Brush Script MT", "Snell Roundhand", cursive';
const ATLAS = 2048;
function text(c, s, x, y, px, color, font = HEAD, align = 'center', weight = '', maxW = 0) {
  c.font = `${weight} ${px}px ${font}`;
  if (maxW > 0) { const wd = c.measureText(s).width; if (wd > maxW) c.font = `${weight} ${Math.floor(px * maxW / wd)}px ${font}`; }
  c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color;
  c.fillText(s, x, y);
}
function grime(c, w, h, rng, n, a) {
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(4, 40);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(30,24,14,${a * rng.range(0.3, 1)})`); g.addColorStop(1, 'rgba(30,24,14,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
const MENU = [
  ['BREAKFAST ALL NIGHT', [['TWO EGGS, TOAST', '2.95'], ['SHORT STACK', '2.50'], ['HASH & EGGS', '3.75'], ['TRUCKER PLATE', '5.25'], ['BISCUITS, GRAVY', '2.85']]],
  ['FROM THE GRILL', [['MAE BURGER', '3.50'], ['PATTY MELT', '3.95'], ['HOT TURKEY', '4.25'], ['CHILI BOWL', '2.25'], ['GRILLED CHEESE', '2.10']]],
  ['PIE & COFFEE', [['APPLE', '1.50'], ['CHERRY', '1.50'], ['PECAN', '1.75'], ['COFFEE', '.60'], ['BOTTOMLESS', '.95']]],
];
const ENTRIES = [
  ['menu', 1152, 400, (c, w, h, rng) => {
    c.fillStyle = '#efe7cf'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#8c1711'; c.fillRect(0, 0, w, 14); c.fillRect(0, h - 14, w, 14);
    MENU.forEach(([head, rows], k) => {
      const x0 = 30 + k * 376;
      text(c, head, x0 + 170, 58, 44, '#8c1711', HEAD, 'center', '', 330);
      c.fillStyle = '#22313a'; c.fillRect(x0, 88, 340, 3);
      rows.forEach(([name, price], i) => {
        const y = 128 + i * 50;
        text(c, name, x0, y, 30, '#22313a', SANS, 'left', 'bold', 250); text(c, price, x0 + 340, y, 30, '#22313a', SANS, 'right', 'bold');
      });
      if (k) { c.fillStyle = 'rgba(34,49,58,0.35)'; c.fillRect(x0 - 20, 30, 2, h - 60); }
    });
    grime(c, w, h, rng, 50, 0.16);
  }],
  ['motel', 1280, 224, (c, w, h) => {
    c.fillStyle = '#0d2a2c'; c.fillRect(0, 0, w, h);
    text(c, 'LARKSPUR', 400, h / 2 + 4, 170, '#f3ead0', HEAD, 'center', '', 740); text(c, 'MOTEL', 1030, h / 2 + 4, 170, '#ffb23a', HEAD, 'center', '', 440);
  }],
  ['vacancy', 640, 128, (c, w, h) => {
    c.fillStyle = '#12090a'; c.fillRect(0, 0, w, h);
    text(c, 'NO', 86, h / 2 + 2, 96, '#ff5a4a', HEAD, 'center', '', 150); text(c, 'VACANCY', 410, h / 2 + 2, 96, '#ff5a4a', HEAD, 'center', '', 430);
  }],
  ['specials', 288, 400, (c, w, h, rng) => {
    c.fillStyle = '#1b211d'; c.fillRect(0, 0, w, h); c.strokeStyle = '#6b4a2a'; c.lineWidth = 14; c.strokeRect(7, 7, w - 14, h - 14);
    text(c, "Today's", w / 2, 60, 46, '#e9e4d4', SCRIPT); text(c, 'SPECIALS', w / 2, 108, 40, '#f0d264', HEAD);
    [['meatloaf', '3.95'], ['chili + pie', '3.25'], ['pot roast', '4.50'], ['soup: bean', '1.25']].forEach(([a, b], i) => { text(c, a, 34, 170 + i * 46, 30, '#e9e4d4', SCRIPT, 'left'); text(c, b, w - 34, 170 + i * 46, 28, '#e9e4d4', SCRIPT, 'right'); });
    text(c, 'CASH ONLY', w / 2, 362, 26, '#d86a5a', HEAD);
    c.globalAlpha = 0.25; for (let i = 0; i < 40; i++) { c.fillStyle = '#cfcfc0'; c.fillRect(rng.range(20, w - 60), rng.range(20, h - 20), rng.range(10, 50), 2); } c.globalAlpha = 1;
  }],
  ['rates', 288, 352, (c, w, h, rng) => {
    c.fillStyle = '#e6dfc8'; c.fillRect(0, 0, w, h); c.strokeStyle = '#0d2a2c'; c.lineWidth = 8; c.strokeRect(8, 8, w - 16, h - 16);
    text(c, 'LARKSPUR MOTEL', w / 2, 46, 34, '#0d2a2c', HEAD, 'center', '', 240);
    [['SINGLE', '$29'], ['DOUBLE', '$36'], ['WEEKLY', '$160']].forEach(([a, b], i) => { text(c, a, 34, 104 + i * 44, 30, '#22313a', SANS, 'left', 'bold'); text(c, b, w - 34, 104 + i * 44, 30, '#8c1711', SANS, 'right', 'bold'); });
    text(c, 'COLOR TV · AIR COND', w / 2, 246, 22, '#22313a', SANS, 'center', 'bold', 240); text(c, 'CHECK OUT 11 AM', w / 2, 282, 24, '#22313a', SANS, 'center', 'bold');
    text(c, 'NO REFUNDS', w / 2, 316, 22, '#8c1711', SANS, 'center', 'bold');
    grime(c, w, h, rng, 20, 0.2);
  }],
  ['keys', 448, 224, (c, w, h, rng) => {
    c.fillStyle = '#4a3320'; c.fillRect(0, 0, w, h);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 7; i++) {
      const x = 40 + i * 61, y = 46 + r * 104, n = (r ? 201 : 101) + i;
      text(c, String(n), x, y - 22, 20, '#e2d6b0', SANS, 'center', 'bold');
      c.fillStyle = '#b89a48'; c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill();
      if (rng.next() < 0.55) { c.fillStyle = ['#b03a2a', '#2a6a62', '#c9a227'][i % 3]; c.beginPath(); c.moveTo(x - 11, y + 8); c.lineTo(x + 11, y + 8); c.lineTo(x + 8, y + 50); c.lineTo(x - 8, y + 50); c.fill(); c.fillStyle = '#b8b8b0'; c.fillRect(x - 2, y, 4, 12); }
    }
  }],
  ['juke', 256, 400, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ffcf6a'); g.addColorStop(0.5, '#ff7a3a'); g.addColorStop(1, '#c2264a');
    c.fillStyle = '#1a0d0a'; c.fillRect(0, 0, w, h);
    c.fillStyle = g; c.beginPath(); c.moveTo(18, h - 16); c.lineTo(18, 130); c.arc(w / 2, 130, w / 2 - 18, Math.PI, 0); c.lineTo(w - 18, h - 16); c.fill();
    c.fillStyle = '#160b08'; c.beginPath(); c.moveTo(48, 250); c.lineTo(48, 140); c.arc(w / 2, 140, w / 2 - 48, Math.PI, 0); c.lineTo(w - 48, 250); c.fill();
    for (let i = 0; i < 10; i++) { c.fillStyle = i % 2 ? '#f3ead0' : '#bfe6dc'; c.fillRect(60 + (i % 5) * 28, 150 + Math.floor(i / 5) * 44, 24, 34); }
    c.fillStyle = '#160b08'; c.fillRect(40, 276, w - 80, 86); for (let i = 0; i < 9; i++) { c.fillStyle = '#ffcf6a'; c.fillRect(48 + i * 19, 284, 3, 70); }
    text(c, 'MELODY 100', w / 2, 262, 20, '#160b08', HEAD);
  }],
  ['wait', 224, 288, (c, w, h, rng) => {
    c.fillStyle = '#efe7cf'; c.fillRect(0, 0, w, h); c.strokeStyle = '#8c1711'; c.lineWidth = 10; c.strokeRect(10, 10, w - 20, h - 20);
    text(c, 'PLEASE', w / 2, 70, 52, '#8c1711'); text(c, 'SEAT', w / 2, 132, 62, '#22313a'); text(c, 'YOURSELF', w / 2, 196, 44, '#22313a', HEAD, 'center', '', 180);
    text(c, 'Mae', w / 2, 248, 40, '#8c1711', SCRIPT); grime(c, w, h, rng, 14, 0.2);
  }],
  ['wetfloor', 160, 224, (c, w, h) => {
    c.fillStyle = '#e2b414'; c.fillRect(0, 0, w, h);
    text(c, 'CAUTION', w / 2, 40, 36, '#141414'); c.fillStyle = '#141414'; c.beginPath(); c.moveTo(w / 2, 70); c.lineTo(w / 2 + 40, 140); c.lineTo(w / 2 - 40, 140); c.fill();
    text(c, '!', w / 2, 112, 54, '#e2b414'); text(c, 'WET FLOOR', w / 2, 180, 30, '#141414', HEAD, 'center', '', 140);
  }],
  ['exit', 192, 96, (c, w, h) => { c.fillStyle = '#1a0503'; c.fillRect(0, 0, w, h); text(c, 'EXIT', w / 2, h / 2 + 3, 80, '#ff4a36', HEAD, 'center', '', 170); }],
  ['office', 448, 112, (c, w, h) => { c.fillStyle = '#081a1c'; c.fillRect(0, 0, w, h); text(c, 'OFFICE', w / 2, h / 2 + 3, 96, '#7ff0dc', HEAD, 'center', '', 400); }],
  ['ice', 224, 224, (c, w, h, rng) => {
    c.fillStyle = '#dfe9ee'; c.fillRect(0, 0, w, h); text(c, 'ICE', w / 2, 96, 150, '#1b5fae'); text(c, 'GUESTS ONLY', w / 2, 190, 26, '#1b5fae', SANS, 'center', 'bold');
    grime(c, w, h, rng, 20, 0.18);
  }],
  ['pie', 384, 160, (c, w, h) => { c.fillStyle = '#100608'; c.fillRect(0, 0, w, h); text(c, 'Fresh Pie', w / 2, h / 2, 110, '#ff6aa0', SCRIPT, 'center', '', 350); }],
  ['coffee', 384, 160, (c, w, h) => { c.fillStyle = '#04100e'; c.fillRect(0, 0, w, h); text(c, 'COFFEE', w / 2, h / 2 + 4, 120, '#6ff0d8', HEAD, 'center', '', 350); }],
  ['nums', 640, 80, (c, w, h) => { for (let i = 0; i < 10; i++) { c.fillStyle = '#a88d3c'; c.fillRect(i * 64 + 4, 4, 56, 72); text(c, String(i), i * 64 + 32, 42, 64, '#17130a', HEAD); } }],
  ['clock', 192, 192, (c, w, h) => {
    c.fillStyle = '#e9e4d4'; c.beginPath(); c.arc(96, 96, 92, 0, 7); c.fill(); c.strokeStyle = '#141414'; c.lineWidth = 8; c.stroke();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.fillStyle = '#141414'; c.fillRect(96 + Math.sin(a) * 76 - 3, 96 - Math.cos(a) * 76 - 3, 6, 6); }
    c.lineWidth = 7; c.beginPath(); c.moveTo(96, 96); c.lineTo(96 + 38, 96 - 22); c.stroke(); c.lineWidth = 5; c.beginPath(); c.moveTo(96, 96); c.lineTo(96 - 18, 96 - 68); c.stroke();
  }],
  ['art1', 256, 192, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#d9a25a'); g.addColorStop(0.55, '#b0563a'); g.addColorStop(0.56, '#2c4a4a'); g.addColorStop(1, '#16282c'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = '#f0d8a0'; c.beginPath(); c.arc(180, 86, 26, 0, 7); c.fill(); c.strokeStyle = '#3a2a1a'; c.lineWidth = 14; c.strokeRect(7, 7, w - 14, h - 14); }],
  ['art2', 256, 192, (c, w, h) => { c.fillStyle = '#9db3a8'; c.fillRect(0, 0, w, h); c.fillStyle = '#3d5a48'; for (let i = 0; i < 7; i++) { c.beginPath(); c.moveTo(20 + i * 34, 170); c.lineTo(38 + i * 34, 60 + (i % 3) * 20); c.lineTo(56 + i * 34, 170); c.fill(); } c.fillStyle = '#e8e2cf'; c.fillRect(0, 150, w, 42); c.strokeStyle = '#c9b68a'; c.lineWidth = 14; c.strokeRect(7, 7, w - 14, h - 14); }],
  ['art3', 192, 256, (c, w, h) => { c.fillStyle = '#e6dcc0'; c.fillRect(0, 0, w, h); c.fillStyle = '#7a2f2a'; c.beginPath(); c.ellipse(96, 150, 50, 66, 0, 0, 7); c.fill(); c.fillStyle = '#2f5a3a'; c.fillRect(90, 40, 12, 60); c.strokeStyle = '#2a2018'; c.lineWidth = 12; c.strokeRect(6, 6, w - 12, h - 12); }],
  ['calendar', 176, 240, (c, w, h) => {
    c.fillStyle = '#f0ece0'; c.fillRect(0, 0, w, h); c.fillStyle = '#1f5a52'; c.fillRect(0, 0, w, 84); text(c, 'OCTOBER', w / 2, 34, 30, '#f0ece0'); text(c, 'Hale Feed & Seed', w / 2, 66, 18, '#f0ece0', SANS);
    for (let r = 0; r < 5; r++) for (let i = 0; i < 7; i++) { const d = r * 7 + i - 1; if (d < 1 || d > 31) continue; text(c, String(d), 16 + i * 24, 108 + r * 28, 15, '#222', SANS, 'center', 'bold'); if (d < 19) { c.strokeStyle = '#b02a1a'; c.lineWidth = 2; c.beginPath(); c.moveTo(8 + i * 24, 100 + r * 28); c.lineTo(24 + i * 24, 116 + r * 28); c.stroke(); } }
  }],
  ['ticket', 96, 160, (c, w, h) => { c.fillStyle = '#e8e6d8'; c.fillRect(0, 0, w, h); c.fillStyle = '#3a4a7a'; for (let i = 0; i < 6; i++) c.fillRect(10, 24 + i * 20, 40 + ((i * 37) % 36), 3); text(c, '14', 72, 14, 16, '#b02a1a', SANS, 'center', 'bold'); }],
  ['tvstatic', 160, 128, (c, w, h, rng) => { for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const v = Math.floor(rng.range(40, 255)); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, y, 2, 2); } }],
  ['tvbars', 160, 128, (c, w, h) => { ['#c8c8c8', '#c8c832', '#32c8c8', '#32c832', '#c832c8', '#c83232', '#3232c8'].forEach((k, i) => { c.fillStyle = k; c.fillRect(i * w / 7, 0, w / 7 + 1, h * 0.72); }); c.fillStyle = '#101018'; c.fillRect(0, h * 0.72, w, h); text(c, 'PLEASE STAND BY', w / 2, h * 0.86, 15, '#e8e8e8', SANS, 'center', 'bold'); }],
  ['boot', 64, 144, (c) => {
    c.fillStyle = '#fff'; c.beginPath(); c.ellipse(32, 46, 22, 42, 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(32, 118, 17, 22, 0, 0, 7); c.fill();
    c.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 7; i++) c.fillRect(6, 12 + i * 11, 52, 4); for (let i = 0; i < 3; i++) c.fillRect(10, 104 + i * 11, 44, 4); c.globalCompositeOperation = 'source-over';
  }],
  ['smear', 384, 160, (c, w, h, rng) => {
    for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(255,255,255,${rng.range(0.5, 1)})`; const y = rng.range(40, 120), x = rng.range(0, 60); c.beginPath(); c.ellipse(x + rng.range(60, 300) / 2, y, rng.range(40, 170), rng.range(3, 12), rng.range(-0.06, 0.06), 0, 7); c.fill(); }
    c.beginPath(); c.ellipse(60, 80, 54, 60, 0, 0, 7); c.fill();
  }],
  ['splat', 192, 192, (c, w, h, rng) => { c.fillStyle = '#fff'; for (let i = 0; i < 46; i++) { const a = rng.range(0, 6.28), d = rng.range(0, 1) ** 2 * 86; c.beginPath(); c.arc(96 + Math.cos(a) * d, 96 + Math.sin(a) * d, rng.range(2, 22) * (1 - d / 110), 0, 7); c.fill(); } }],
  ['scrawl', 448, 160, (c, w, h) => { text(c, 'STAY OUT OF 6', w / 2, 60, 74, '#fff', SCRIPT, 'center', 'bold', 420); text(c, 'she is not sick. she is gone', w / 2, 124, 34, '#fff', SCRIPT, 'center', '', 420); }],
  ['help', 320, 128, (c, w, h) => { text(c, 'ALIVE IN 203', w / 2, h / 2, 76, '#fff', SCRIPT, 'center', 'bold', 300); }],
  ['guest', 224, 160, (c, w, h) => { c.fillStyle = '#ece6d2'; c.fillRect(0, 0, w, h); c.fillStyle = '#7a8aa8'; for (let i = 0; i < 7; i++) c.fillRect(0, 22 + i * 19, w, 1); c.fillStyle = '#2a2a3a'; for (let i = 0; i < 5; i++) c.fillRect(12, 14 + i * 19, 70 + ((i * 53) % 90), 3); c.fillStyle = '#c9c2a8'; c.fillRect(w / 2 - 1, 0, 2, h); }],
  ['deliveries', 512, 128, (c, w, h, rng) => {
    c.fillStyle = '#d9d2bc'; c.fillRect(0, 0, w, h); c.strokeStyle = '#8c1711'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
    text(c, 'DELIVERIES', w / 2, 50, 62, '#8c1711', HEAD, 'center', '', 460); text(c, 'RING BELL  ·  NO PARKING', w / 2, 100, 24, '#22313a', SANS, 'center', 'bold', 440);
    grime(c, w, h, rng, 40, 0.3);
  }],
  ['coldstore', 768, 160, (c, w, h, rng) => {
    c.clearRect(0, 0, w, h);
    text(c, 'HALE COLD STORE', w / 2, h / 2 + 4, 124, '#ffffff', HEAD, 'center', '', 740);
    c.globalCompositeOperation = 'destination-out'; grime(c, w, h, rng, 45, 0.9); c.globalCompositeOperation = 'source-over';
  }],
  ['tyres', 640, 160, (c, w, h, rng) => {
    c.clearRect(0, 0, w, h);
    text(c, 'TYRES & LUBE', w / 2, h / 2 + 4, 124, '#ffffff', HEAD, 'center', '', 610);
    c.globalCompositeOperation = 'destination-out'; grime(c, w, h, rng, 40, 0.9); c.globalCompositeOperation = 'source-over';
  }],
  ['wash', 224, 160, (c, w, h, rng) => {
    c.fillStyle = '#e8e6d8'; c.fillRect(0, 0, w, h); c.fillStyle = '#1b5fae'; c.fillRect(0, 0, w, 44);
    text(c, 'NOTICE', w / 2, 24, 30, '#fff'); text(c, 'EMPLOYEES', w / 2, 76, 28, '#22313a', SANS, 'center', 'bold', 200); text(c, 'MUST WASH HANDS', w / 2, 112, 22, '#22313a', SANS, 'center', 'bold', 200);
    grime(c, w, h, rng, 14, 0.25);
  }],
  ['hand', 128, 160, (c) => {
    c.fillStyle = '#fff'; c.beginPath(); c.ellipse(64, 104, 34, 40, 0, 0, 7); c.fill();
    for (const [x, y, l, a] of [[30, 70, 44, -0.35], [48, 56, 54, -0.12], [68, 54, 56, 0.05], [88, 62, 48, 0.25], [104, 100, 34, 1.1]]) { c.save(); c.translate(x, y); c.rotate(a); c.beginPath(); c.ellipse(0, -l / 2 + 10, 8, l / 2, 0, 0, 7); c.fill(); c.restore(); }
    c.fillRect(46, 130, 10, 30); c.fillRect(70, 132, 8, 26);
  }],
  ['pic', 128, 96, (c, w, h) => { c.fillStyle = '#d8d0b8'; c.fillRect(0, 0, w, h); c.fillStyle = '#6a7a8a'; c.fillRect(8, 8, w - 16, h - 16); c.fillStyle = '#d8b090'; c.beginPath(); c.arc(46, 46, 14, 0, 7); c.arc(80, 50, 12, 0, 7); c.fill(); c.fillStyle = '#3a2a2a'; c.fillRect(30, 60, 66, 28); }],
];
const RECTS = (() => {
  const order = ENTRIES.map((e, i) => i).sort((a, b) => ENTRIES[b][2] - ENTRIES[a][2]);
  const rects = {};
  let x = 2, y = 2, rowH = 0;
  for (const i of order) {
    const [name, w, h] = ENTRIES[i];
    if (x + w + 2 > ATLAS) { x = 2; y += rowH + 4; rowH = 0; }
    rects[name] = { x, y, w, h };
    x += w + 4; rowH = Math.max(rowH, h);
  }
  if (y + rowH > ATLAS) throw new Error('interior atlas overflow');
  return rects;
})();
// [u0, v0, u1, v1] of an entry, or of a part of it (u from the left, v from the top, 0..1)
export function atlasUv(name, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
  const r = RECTS[name];
  if (!r) throw new Error(`interior atlas: no entry "${name}"`);
  const k = 1 / ATLAS;
  return [(r.x + r.w * u0 + 1) * k, 1 - (r.y + r.h * v1 - 1) * k, (r.x + r.w * u1 - 1) * k, 1 - (r.y + r.h * v0 + 1) * k];
}
export const atlasAspect = (name) => RECTS[name].w / RECTS[name].h;
function atlasTexture(rng) {
  if (typeof document === 'undefined') { const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat); t.needsUpdate = true; return t; }
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS; canvas.height = ATLAS;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, ATLAS, ATLAS);
  for (const [name, w, h, draw] of ENTRIES) {
    const r = RECTS[name];
    c.save(); c.beginPath(); c.rect(r.x, r.y, w, h); c.clip(); c.translate(r.x, r.y);
    draw(c, w, h, rng.fork(name));
    c.restore();
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 8; t.generateMipmaps = true;
  return t;
}

// ---- the material ---------------------------------------------------------------------------------
const FRAG_PARS = /* glsl */ `
uniform highp sampler3D tNzA;
uniform highp sampler3D tNzB;
uniform sampler2D tArtAtlas;
varying vec3 vArtP; varying vec3 vArtN; varying vec4 vArt; varying vec3 vArtEm; varying vec2 vArtUv;
float gArtR = 0.7; float gArtM = 0.0; vec3 gArtE = vec3(0.0);
float aHash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
`;
const FRAG_COLOR = /* glsl */ `#include <color_fragment>
{
  int kind = int(vArt.x + 0.5); float par = vArt.z; float wet = vArt.w;
  vec3 n = normalize(vArtN); vec3 p = vArtP;
  vec2 q = abs(n.y) > 0.7 ? p.xz : (abs(n.x) > abs(n.z) ? p.zy : p.xy);
  float lo = texture(tNzA, p * 0.23).x, mid = texture(tNzA, p * 1.4 + 0.31).x, hi = texture(tNzA, p * 8.0 + 0.7).x;
  float fy = p.y > 2.95 ? p.y - ${T.floors.upper.toFixed(2)} : p.y;
  vec3 c = diffuseColor.rgb; float r = 0.7; float mt = 0.0; bool glow = false;
  if (kind == 1) {
    float tl = par < 0.5 ? 0.305 : (par < 1.5 ? 0.2 : 0.15);
    vec2 g = q / tl; vec2 id = floor(g); vec2 f = fract(g);
    if (par < 0.5) c = mix(c, vec3(0.5, 0.47, 0.38), mod(id.x + id.y, 2.0));
    c *= 0.84 + 0.3 * aHash(id);
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * tl;
    float grout = 1.0 - smoothstep(par > 1.5 ? 0.001 : 0.003, par > 1.5 ? 0.004 : 0.008, e);
    c *= 0.7 + 0.55 * mid;
    c = mix(c, par > 1.5 ? c * 0.45 : vec3(0.045, 0.042, 0.036), grout);
    r = mix(0.16 + 0.3 * mid, 0.9, grout);
    float w = wet * smoothstep(0.38, 0.56, mid + 0.45 * wet);
    c *= 1.0 - 0.35 * w; r = mix(r, 0.04, w);
  } else if (kind == 2) {
    c *= (0.82 + 0.36 * lo) * (0.88 + 0.24 * hi);
    c *= 1.0 - 0.5 * step(0.494, abs(fract(q.x / 1.83) - 0.5));
    c *= 1.0 - 0.1 * smoothstep(0.55, 0.7, texture(tNzB, vec3(q * 0.9, 0.3)).a);
    r = 0.38 + 0.25 * mid;
    float w = wet * smoothstep(0.38, 0.56, mid + 0.45 * wet);
    c *= 1.0 - 0.35 * w; r = mix(r, 0.05, w);
  } else if (kind == 3) {
    vec3 s = p * (par < 0.5 ? vec3(0.1, 1.0, 1.0) : (par < 1.5 ? vec3(1.0, 1.0, 0.1) : vec3(1.0, 0.1, 1.0)));
    float ring = texture(tNzB, s * 4.0).a;
    c *= (0.66 + 0.68 * ring) * (0.9 + 0.2 * hi) * (0.85 + 0.3 * lo);
    r = 0.42 + 0.3 * ring;
  } else if (kind == 4) {
    float st = texture(tNzA, p * 0.55 + 0.17).x;
    c *= (0.86 + 0.28 * lo) * (0.94 + 0.12 * hi);
    float stain = smoothstep(2.0, 3.2, fy) * smoothstep(0.52, 0.72, st);
    c = mix(c, c * vec3(0.62, 0.52, 0.38), 0.35 * stain);
    c *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.4, fy)) * (0.4 + 0.6 * mid);
    if (par > 0.5) { float sp = abs(fract(q.x / (0.11 * par)) - 0.5); c *= 0.9 + 0.14 * smoothstep(0.2, 0.3, sp); c *= 1.0 - 0.25 * step(abs(fy - 2.45), 0.035); }
    r = 0.84;
  } else if (kind == 5) {
    vec3 v = texture(tNzB, p * 3.5).rgb;
    float crack = (1.0 - smoothstep(0.0, 0.05, v.g)) * smoothstep(0.5, 0.66, lo);
    c *= 0.82 + 0.36 * mid;
    c = mix(c, vec3(0.16, 0.13, 0.09), 0.8 * crack);
    r = 0.26 + 0.2 * mid + 0.5 * crack;
  } else if (kind == 6) {
    vec2 g = fract(q / 0.42) - 0.5;
    float d = abs(g.x) + abs(g.y);
    float motif = max(1.0 - smoothstep(0.015, 0.04, abs(d - 0.5)), 1.0 - smoothstep(0.05, 0.075, length(g)));
    c = mix(c, c * 2.1 + 0.015, 0.55 * motif * step(0.5, par));
    c *= (0.7 + 0.6 * hi) * (0.8 + 0.4 * mid);
    c *= 1.0 - 0.5 * smoothstep(0.58, 0.72, lo);
    c *= 1.0 - 0.4 * wet * smoothstep(0.3, 0.6, mid + 0.4 * wet);
    r = 1.0;
  } else if (kind == 7) {
    float sp = aHash(floor(q * 150.0));
    c *= 0.94 + 0.2 * step(0.9, sp) - 0.25 * step(sp, 0.05);
    c *= 0.86 + 0.28 * lo;
    r = 0.16 + 0.3 * mid;
  } else if (kind == 8) {
    c *= 0.8 + 0.4 * mid;
    if (par > 0.5) c *= 0.72 + 0.5 * step(0.5, fract((abs(n.x) > abs(n.z) ? p.z : p.x) / 0.085));
    c *= 0.92 + 0.16 * hi;
    r = 0.95;
  } else if (kind == 9) {
    mt = 1.0;
    c *= 0.75 + 0.4 * lo;
    c *= 1.0 - 0.55 * par * smoothstep(0.35, 0.65, mid);
    r = 0.2 + 0.28 * mid + 0.12 * hi + 0.3 * par;
  } else if (kind == 10) {
    vec4 t = texture(tArtAtlas, vArtUv);
    if (t.a < 0.5) discard;
    c *= t.rgb * (0.82 + 0.36 * lo);
    r = par > 0.5 ? 0.12 : 0.62;
  } else if (kind == 11) {
    vec3 t = vArtUv.x > -0.5 ? texture(tArtAtlas, vArtUv).rgb : vec3(1.0);
    gArtE = vArtEm * t; c *= t; r = 0.3; glow = true;
  } else if (kind == 12) {
    gArtE = vArtEm; r = 0.12; glow = true;
  } else if (kind == 13) {
    vec2 f = fract(q / 0.61);
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    c *= 0.5 + 0.5 * smoothstep(0.0, 0.035, e);
    c *= 0.86 + 0.28 * hi;
    vec3 v = texture(tNzB, p * 0.33).rgb;
    float ring = smoothstep(0.56, 0.66, lo) * (0.45 + 0.55 * (1.0 - smoothstep(0.0, 0.12, abs(v.r - 0.3))));
    c = mix(c, c * vec3(0.5, 0.37, 0.2), 0.7 * ring);
    r = 0.96;
  } else if (kind == 14) {
    vec3 dash = texture(tNzB, p * 7.0).rgb;
    float pebble = smoothstep(0.02, 0.22, dash.g);
    float blotch = texture(tNzA, p * 0.6 + 0.4).x;
    c *= (0.84 + 0.3 * lo) * (0.8 + 0.26 * pebble) * (0.94 + 0.12 * hi);
    c = mix(c, c * vec3(0.78, 0.74, 0.66), 0.5 * smoothstep(0.5, 0.7, blotch));
    float crack = (1.0 - smoothstep(0.0, 0.012, texture(tNzB, p * 0.8).g)) * smoothstep(0.55, 0.7, mid);
    c *= 1.0 - 0.5 * crack;
    float wp = wet * smoothstep(0.42, 0.68, blotch * 0.7 + mid * 0.5);
    c *= 1.0 - 0.3 * wp;
    c *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.5, fy)) * (0.4 + 0.6 * mid);
    r = mix(0.9, 0.34, wp);
  } else if (kind == 15) {
    float up = step(0.7, n.y);
    c *= (0.72 + 0.56 * lo) * (0.86 + 0.28 * hi);
    float pn = texture(tNzA, p * 0.45 + 0.6).x + 0.08 * (mid - 0.5);
    float pd = up * wet * smoothstep(0.47, 0.66, pn);
    float damp = up * wet * smoothstep(0.36, 0.56, pn);
    c *= 1.0 - 0.34 * damp - 0.16 * pd;
    c = mix(c, c * 0.8 + vec3(0.012, 0.016, 0.02), pd);
    r = mix(mix(0.84, 0.4, damp), 0.025, pd);
  } else if (kind == 17) {
    float along = abs(n.x) > abs(n.z) ? p.z : p.x;
    float pw = 1.22;
    float sx = abs(fract(along / pw) - 0.5) * pw;
    float seam = 1.0 - smoothstep(0.006, 0.02, 0.5 * pw - sx);
    float pid = aHash(vec2(floor(along / pw), floor(fy / 1.5)));
    float rib = par > 0.5 ? 0.5 + 0.5 * sin(fy * 62.8) : 0.5;
    c *= (0.84 + 0.3 * lo) * (0.92 + 0.14 * pid) * (0.94 + 0.12 * hi) * (0.8 + 0.4 * rib);
    float hs = 1.0 - smoothstep(0.004, 0.014, abs(fract(fy / 1.5 + 0.5) - 0.5) * 1.5);
    float run = smoothstep(0.55, 0.8, texture(tNzA, vec3(along * 2.6, fy * 0.22, 0.3)).x) * smoothstep(0.35, 0.0, fract(fy / 1.5));
    float rust = max(seam * smoothstep(0.4, 0.7, mid), 0.6 * run * smoothstep(0.45, 0.6, lo));
    c = mix(c, vec3(0.2, 0.09, 0.04) * (0.6 + 0.8 * hi), 0.75 * rust);
    c *= 1.0 - 0.6 * max(seam, hs) * (1.0 - rust);
    c *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.7, fy)) * (0.5 + 0.5 * mid);
    float wp = wet * smoothstep(0.35, 0.65, lo * 0.5 + mid * 0.6);
    c *= 1.0 - 0.22 * wp;
    r = mix(0.34 + 0.2 * mid, 0.85, rust); r = mix(r, 0.12, wp * (1.0 - rust));
    mt = 0.0;
  } else if (kind == 16) {
    if (mid * 0.7 + hi * 0.5 + 0.12 * par < 0.52) discard;
    c *= 0.75 + 0.4 * lo; r = 0.55;
  } else {
    c *= (0.84 + 0.32 * lo) * (0.93 + 0.14 * hi);
    c *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.25, fy)) * mid;
    r = par > 0.5 ? 0.3 : 0.72;
  }
  diffuseColor.rgb = c; gArtR = r; gArtM = mt;
  if (!glow) gArtE = c * vArtEm;
}`;

function patch(mat, noise, atlas, groups) {
  const u = { tNzA: { value: noise && noise.tNzA }, tNzB: { value: noise && noise.tNzB }, tArtAtlas: { value: atlas }, uArtGroup: { value: groups } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aArt; attribute vec3 aBakeA; attribute vec3 aBakeP; attribute vec2 aUv;
uniform vec4 uArtGroup[${MAX_GROUPS}];
varying vec3 vArtP; varying vec3 vArtN; varying vec4 vArt; varying vec3 vArtEm; varying vec2 vArtUv;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vArtP = transformed; vArtN = objectNormal; vArt = aArt; vArtUv = aUv;
{ vec4 g = uArtGroup[int(aArt.y + 0.5)]; vArtEm = aArt.x > 10.5 && aArt.x < 12.5 ? aBakeA * g.z + aBakeP * g.w : aBakeA * g.x + aBakeP * g.y; }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gArtR;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gArtM;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gArtE;');
  };
  mat.customProgramCacheKey = () => 'level:interior';
  mat.surf = u;
  return mat;
}

let MATS = null;
// The interior materials. `shared` is the one the art meshes use (kind per vertex, aArt.x); the
// named ones are the same material for callers that build their own mesh: give the geometry the
// attributes with interiorAttributes(geometry, kind).
export function createInteriorMats(G) {
  if (MATS) return MATS;
  const noise = G.mats && G.mats.noise;
  const groups = new Float32Array(MAX_GROUPS * 4).fill(1);
  const atlas = atlasTexture(G.rng ? G.rng.fork('interiorAtlas') : { fork: () => null });
  const shared = patch(new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), noise, atlas, groups);
  const out = { shared, groups, atlas, KIND };
  for (const k of ['tile', 'linoleum', 'wood', 'plaster', 'vinyl', 'carpet', 'laminate', 'curtain']) out[k] = shared;
  MATS = out;
  return out;
}
// Give any geometry what the shared material reads: one kind for all of it, lit by real lights only.
export function interiorAttributes(geometry, kind, par = 0) {
  const n = geometry.getAttribute('position').count;
  const art = new Float32Array(n * 4), z3 = new Float32Array(n * 3), uv = new Float32Array(n * 2).fill(-1), col = new Float32Array(n * 3).fill(1);
  for (let i = 0; i < n; i++) { art[i * 4] = KIND[kind] ?? kind; art[i * 4 + 2] = par; }
  geometry.setAttribute('aArt', new BufferAttribute(art, 4));
  geometry.setAttribute('aBakeA', new BufferAttribute(z3, 3));
  geometry.setAttribute('aBakeP', new BufferAttribute(z3.slice(), 3));
  geometry.setAttribute('aUv', new BufferAttribute(uv, 2));
  if (!geometry.getAttribute('color')) geometry.setAttribute('color', new BufferAttribute(col, 3));
  return geometry;
}

// ---- the builder ----------------------------------------------------------------------------------
const REG = { recs: new Map(), layer: null, polling: false };
const _v = new Vector3(), _n = new Vector3(), _nm = new Matrix3(), _mw = new Matrix4();

// createArt(B, zone): what an area builder authors into. Everything lands in one geometry, handed to
// the level as a one-instance B.instance (so it is culled with the zone and seen by the tests), with
// the material put on by installAreaArt.
//   room(name, o)      start a light group: later geometry is lit by the lights added after this
//   light(o)           { pos, lm, color, power, r0, amb, real, flicker, range, fx } a fitting. real: also a
//                      fixture for the light pool (kind 'tube'); fx: it is this world fixture (by position)
//   add(kind, geo, o)  a three geometry at B's transform. o: m, color, par, wet, glow, power, uv, shadow, nobake
//   quad(kind, o, u, v, col, opts)   a tessellated parallelogram from o along u and v (normal u x v)
//   sign(name, o, u, v, opts)        the same carrying a sheet entry (opts.glow: lit from behind)
//   movable(prop, open, fn)          what fn adds moves by the matrix `open` (in the transform at the call) when searched
//   detail(fn)                       optional dressing: thinned by G.quality.propDensity
export function createArt(B, zone) {
  const mk = () => ({ pos: [], nrm: [], col: [], uv: [], art: [], bA: [], bP: [], lit: [], ao: [], idx: [], n: 0 });
  // parts: the zone's art is split by where it is (A.part(name)) into meshes with their own bounds,
  // so what is behind the camera is not drawn
  const parts = new Map();
  const partOf = (name) => { if (!parts.has(name)) parts.set(name, { name, core: mk(), extra: mk() }); return parts.get(name); };
  let part = partOf('main'), detail = false;
  let buf = part.core;
  const glass = { pos: [], nrm: [], uv: [], gl: [], idx: [], n: 0 };
  const groups = [{ name: 'none', lights: [] }];
  let group = 0, lights = [];
  const fixtures = [], movables = [], boards = [], barriers = [], shots = {};
  const A = { zone, KIND, LIGHT, groups, fixtures, movables, boards, barriers, shots, B };
  A.part = (name) => { part = partOf(name); buf = detail ? part.extra : part.core; return A; };
  // a pane of glass with rain on it, drawn in the zone's one transparent mesh and never a collider:
  // o its lower-left corner, u along its width, v up its height. broken: only shards round the frame.
  A.glass = (o, u, v, opts = {}) => {
    const m = B.matrix();
    const O = _v.set(o[0], o[1], o[2]).applyMatrix4(m).toArray();
    const U = _v.set(u[0], u[1], u[2]).transformDirection(m).toArray(), ul = Math.hypot(u[0], u[1], u[2]);
    const V = _v.set(v[0], v[1], v[2]).transformDirection(m).toArray(), vl = Math.hypot(v[0], v[1], v[2]);
    const N = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
    const base = glass.n, seed = (glass.n * 0.137) % 1;
    for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      glass.pos.push(O[0] + U[0] * ul * i + V[0] * vl * j, O[1] + U[1] * ul * i + V[1] * vl * j, O[2] + U[2] * ul * i + V[2] * vl * j);
      glass.nrm.push(N[0], N[1], N[2]); glass.uv.push(i, j); glass.gl.push(ul, vl, opts.broken ? 1 : 0, seed);
    }
    glass.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    glass.n += 4;
    return A;
  };

  A.room = (name, o = {}) => { groups.push({ name, lights: [], ...o }); group = groups.length - 1; lights = groups[group].lights; if (groups.length > MAX_GROUPS) throw new Error('interior: too many light groups'); return group; };
  A.light = (o) => {
    const c = o.color || LIGHT.tube;
    const I = ((o.lm ?? 1000) / (4 * Math.PI)) * UNIT / Math.PI;
    const l = { pos: B.point(...o.pos), c: [c[0] * I, c[1] * I, c[2] * I], power: !!o.power, r0: o.r0 ?? 0.2, amb: o.amb ?? 0.006, down: o.down ?? 0, noShadow: !!o.noShadow, reach: o.reach };
    lights.push(l);
    if (o.real || o.fx) {
      const f = { pos: l.pos, power: l.power, group, lm: o.lm ?? 1000, color: c, range: o.range ?? 7, flicker: o.flicker || null, priority: o.priority ?? 0.9, y0: o.y0 ?? 0 };
      fixtures.push(f);
      if (o.real) B.fixture({ kind: 'tube', pos: l.pos, needsPower: l.power, flicker: !!o.flicker });
      groups[group][l.power ? 'fxP' : 'fxA'] = f;
    }
    return l;
  };
  // Light reaching a point, by group, with the level's colliders in the way (so the counter shades
  // the floor behind it and the kitchen's tubes stay in the kitchen). Run at finish(), when every
  // collider of the area exists. Two points on each fitting, for a soft edge.
  const SOFT = [[0.28, 0, 0.12], [-0.28, 0, -0.12]];
  const blocked = (boxes, px, py, pz, lx, ly, lz) => {
    const dx = lx - px, dy = ly - py, dz = lz - pz;
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i], mn = c.min, mx = c.max;
      let t0 = 0.0, t1 = 1.0;
      if (Math.abs(dx) < 1e-9) { if (px < mn[0] || px > mx[0]) continue; } else { let a = (mn[0] - px) / dx, b = (mx[0] - px) / dx; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      if (Math.abs(dy) < 1e-9) { if (py < mn[1] || py > mx[1]) continue; } else { let a = (mn[1] - py) / dy, b = (mx[1] - py) / dy; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      if (Math.abs(dz) < 1e-9) { if (pz < mn[2] || pz > mx[2]) continue; } else { let a = (mn[2] - pz) / dz, b = (mx[2] - pz) / dz; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      if (t0 <= 1e-6 || t1 >= 1 - 1e-6 || t1 - t0 < 1e-4) continue; // the point or the lamp is inside this box (the wall it is fixed to)
      return true;
    }
    return false;
  };
  const bake = (ls, x, y, z, nx, ny, nz, a, p) => {
    a[0] = a[1] = a[2] = p[0] = p[1] = p[2] = 0;
    const px = x + nx * 0.04, py = y + ny * 0.04, pz = z + nz * 0.04;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      const dx = l.pos[0] - x, dy = l.pos[1] - y, dz = l.pos[2] - z;
      const d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2) || 1e-3;
      let k = Math.max(0, ((nx * dx + ny * dy + nz * dz) / d + 0.3) / 1.3) / (d2 + l.r0);
      if (l.down) k *= Math.min(1, Math.max(0.08, (dy / d - (1 - l.down)) * 4 + 0.5));
      if (k > 1e-4 && l.boxes) {
        let vis = 0;
        for (const o of SOFT) if (!blocked(l.boxes, px, py, pz, l.pos[0] + o[0], l.pos[1] + o[1], l.pos[2] + o[2])) vis += 0.5;
        k *= vis;
      }
      k += l.amb;
      const t = l.power ? p : a;
      t[0] += l.c[0] * k; t[1] += l.c[1] * k; t[2] += l.c[2] * k;
    }
  };
  const _a = [0, 0, 0], _p = [0, 0, 0];
  const push = (kind, o, x, y, z, nx, ny, nz, c, u, v) => {
    buf.pos.push(x, y, z); buf.nrm.push(nx, ny, nz); buf.col.push(c[0], c[1], c[2]); buf.uv.push(u, v);
    buf.art.push(kind, group, o.par || 0, o.wet || 0); buf.ao.push(o.ao ? 1 : 0);
    if (o.glow) { const g = o.glow; buf.lit.push(-1); if (o.power) { buf.bA.push(0, 0, 0); buf.bP.push(g[0], g[1], g[2]); } else { buf.bA.push(g[0], g[1], g[2]); buf.bP.push(0, 0, 0); } }
    else { buf.lit.push(o.nobake ? -1 : (o.lit ?? 1)); buf.bA.push(0, 0, 0); buf.bP.push(0, 0, 0); }
    buf.n++;
  };
  // contact shade: how much of the half-space over a point is shut in by something within reach
  const AO_DIRS = [];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, e = k % 2 ? 0.45 : 0.95; AO_DIRS.push([Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)]); }
  const aoAt = (boxes, x, y, z, nx, ny, nz) => {
    // a frame on the normal
    let tx = ny, ty = -nx, tz = 0;
    if (Math.abs(nx) + Math.abs(ny) < 1e-3) { tx = 1; ty = 0; tz = 0; }
    const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const px = x + nx * 0.03, py = y + ny * 0.03, pz = z + nz * 0.03;
    let hit = 0;
    for (const d of AO_DIRS) {
      const r = 0.55;
      const dx = (tx * d[0] + nx * d[1] + bx * d[2]) * r, dy = (ty * d[0] + ny * d[1] + by * d[2]) * r, dz = (tz * d[0] + nz * d[1] + bz * d[2]) * r;
      if (blocked(boxes, px, py, pz, px + dx, py + dy, pz + dz)) hit++;
    }
    return hit / AO_DIRS.length;
  };
  const bakeAll = (b, solid) => {
    for (let i = 0; i < b.n; i++) {
      if (b.ao[i]) {
        const x = b.pos[i * 3], y = b.pos[i * 3 + 1], z = b.pos[i * 3 + 2];
        const near = solid.filter((c) => c.max[0] > x - 0.7 && c.min[0] < x + 0.7 && c.max[2] > z - 0.7 && c.min[2] < z + 0.7 && c.max[1] > y - 0.7 && c.min[1] < y + 0.7);
        const k = near.length ? 1 - 0.8 * aoAt(near, x, y, z, b.nrm[i * 3], b.nrm[i * 3 + 1], b.nrm[i * 3 + 2]) : 1;
        b.col[i * 3] *= k; b.col[i * 3 + 1] *= k; b.col[i * 3 + 2] *= k;
      }
      const s = b.lit[i];
      if (s < 0) continue;
      const ls = groups[b.art[i * 4 + 1]].lights;
      if (!ls.length) continue;
      bake(ls, b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2], b.nrm[i * 3], b.nrm[i * 3 + 1], b.nrm[i * 3 + 2], _a, _p);
      b.bA[i * 3] = _a[0] * s; b.bA[i * 3 + 1] = _a[1] * s; b.bA[i * 3 + 2] = _a[2] * s;
      b.bP[i * 3] = _p[0] * s; b.bP[i * 3 + 1] = _p[1] * s; b.bP[i * 3 + 2] = _p[2] * s;
    }
  };
  const WHITE = [1, 1, 1];
  A.add = (kindName, geo, o = {}) => {
    const kind = KIND[kindName];
    const mat = o.m ? _mw.multiplyMatrices(B.matrix(), o.m) : _mw.copy(B.matrix());
    _nm.getNormalMatrix(mat);
    const flip = mat.determinant() < 0;
    const p = geo.getAttribute('position'), nr = geo.getAttribute('normal'), uv = o.uv ? geo.getAttribute('uv') : null;
    const base = buf.n, c = o.color || WHITE, fn = typeof c === 'function';
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(mat);
      _n.fromBufferAttribute(nr, i).applyMatrix3(_nm).normalize();
      push(kind, o, _v.x, _v.y, _v.z, _n.x, _n.y, _n.z, fn ? c(_n, _v) : c, uv ? uv.getX(i) : -1, uv ? uv.getY(i) : -1);
    }
    const ix = geo.getIndex(), cnt = ix ? ix.count : p.count;
    for (let i = 0; i < cnt; i += 3) {
      const a = ix ? ix.getX(i) : i, b = ix ? ix.getX(i + 1) : i + 1, d = ix ? ix.getX(i + 2) : i + 2;
      if (flip) buf.idx.push(base + a, base + d, base + b); else buf.idx.push(base + a, base + b, base + d);
    }
    if (o.shadow) B.add('shadow', geo, { m: o.m }); else geo.dispose();
    return A;
  };
  A.quad = (kindName, o, u, v, col = WHITE, opts = {}) => {
    const kind = KIND[kindName];
    const m = B.matrix();
    const O = _v.set(o[0], o[1], o[2]).applyMatrix4(m).toArray();
    const U = _v.set(u[0], u[1], u[2]).transformDirection(m).toArray(), ul = Math.hypot(u[0], u[1], u[2]);
    const V = _v.set(v[0], v[1], v[2]).transformDirection(m).toArray(), vl = Math.hypot(v[0], v[1], v[2]);
    const N = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
    const nl = Math.hypot(N[0], N[1], N[2]) || 1; N[0] /= nl; N[1] /= nl; N[2] /= nl;
    const cell = opts.cell ?? 0.6;
    const nu = Math.max(1, Math.ceil(ul / cell)), nv = Math.max(1, Math.ceil(vl / cell));
    const base = buf.n, uv = opts.uv, fn = typeof col === 'function';
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const s = (i / nu) * ul, t = (j / nv) * vl;
      const x = O[0] + U[0] * s + V[0] * t, y = O[1] + U[1] * s + V[1] * t, z = O[2] + U[2] * s + V[2] * t;
      const c = fn ? col(x, y, z) : col;
      const o2 = opts.wetAt ? { ...opts, wet: opts.wetAt(x, y, z) } : opts;
      push(kind, o2, x, y, z, N[0], N[1], N[2], c, uv ? uv[0] + (uv[2] - uv[0]) * (i / nu) : -1, uv ? uv[1] + (uv[3] - uv[1]) * (j / nv) : -1);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      buf.idx.push(a, b, d, a, d, c);
    }
    return A;
  };
  // a sheet entry on a quad: o is its lower-left corner, u along its width, v up its height
  A.sign = (name, o, u, v, opts = {}) => A.quad(opts.glow ? 'glow' : 'sign', o, u, v, opts.color || (opts.glow ? [0.2, 0.2, 0.2] : WHITE), { cell: 99, ...opts, uv: opts.sub ? atlasUv(name, ...opts.sub) : atlasUv(name) });
  // An upright wall face in panels round its holes. face: '+x' | '-x' | '+z' | '-z' (the way it looks);
  // c: its plane coordinate; a0..a1 along it (x for z-faces, z for x-faces); holes [{ a, b, y0, y1 }].
  A.wall = (kind, face, c, a0, a1, y0, y1, col, opts = {}, holes = []) => {
    const put = (p, q, ya, yb) => {
      if (q - p < 1e-3 || yb - ya < 1e-3) return;
      if (face === '+z') A.quad(kind, [p, ya, c], [q - p, 0, 0], [0, yb - ya, 0], col, opts);
      else if (face === '-z') A.quad(kind, [q, ya, c], [p - q, 0, 0], [0, yb - ya, 0], col, opts);
      else if (face === '+x') A.quad(kind, [c, ya, q], [0, 0, p - q], [0, yb - ya, 0], col, opts);
      else A.quad(kind, [c, ya, p], [0, 0, q - p], [0, yb - ya, 0], col, opts);
    };
    let at = a0;
    for (const h of holes.slice().sort((x, y) => x.a - y.a)) {
      if (h.b <= a0 || h.a >= a1) continue;
      put(at, h.a, y0, y1);
      put(h.a, h.b, y0, Math.min(y1, Math.max(y0, h.y0)));
      put(h.a, h.b, Math.max(y0, Math.min(y1, h.y1)), y1);
      at = h.b;
    }
    put(at, a1, y0, y1);
    return A;
  };
  // a box by its corners (bevel optional), for furniture: [x0,y0,z0], [x1,y1,z1]
  A.box = (kind, mn, mx, col, opts = {}) => A.add(kind, opts.bevel ? new RoundedBoxGeometry(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], 1, Math.min(opts.bevel, (mx[0] - mn[0]) / 2, (mx[1] - mn[1]) / 2, (mx[2] - mn[2]) / 2)) : new BoxGeometry(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]),
    { ...opts, color: col, m: M((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2, opts.rx || 0, opts.ry || 0, opts.rz || 0) });
  A.movable = (prop, open, fn) => {
    if (detail) throw new Error('interior: a movable cannot be detail');
    const m = B.matrix();
    const world = new Matrix4().multiplyMatrices(m, open).multiply(m.clone().invert());
    const mine = part, start = mine.core.n;
    fn();
    if (part !== mine) throw new Error('interior: a movable cannot change part');
    movables.push({ prop, part: mine.name, start, end: mine.core.n, open: world });
    return A;
  };
  A.detail = (fn) => { if (detail) { fn(); return A; } detail = true; buf = part.extra; try { fn(); } finally { detail = false; buf = part.core; } return A; };
  A.shot = (name, cam, fov = 70) => { shots[name] = { cam, fov }; };
  A.finish = () => {
    // what can stand between a lamp and a surface: the area's colliders but its doors (they open)
    const solid = B.colliders.filter((c) => !c.door && c.max[1] - c.min[1] > 0.25);
    for (const g of groups) for (const l of g.lights) {
      const R = l.reach ?? 13;
      l.boxes = l.noShadow ? null : solid.filter((c) => c.max[0] > l.pos[0] - R && c.min[0] < l.pos[0] + R && c.max[2] > l.pos[2] - R && c.min[2] < l.pos[2] + R && c.max[1] > l.pos[1] - R && c.min[1] < l.pos[1] + R);
    }
    const top = B.matrix();
    if (Math.abs(top.elements[12]) + Math.abs(top.elements[14]) > 1e-9) throw new Error('interior: finish under a transform');
    const made = [];
    for (const pt of parts.values()) {
      const { core, extra } = pt;
      if (!core.n && !extra.n) continue;
      bakeAll(core, solid); bakeAll(extra, solid);
      const n0 = core.n;
      const cat = (k, T2) => { const out = new T2(core[k].length + extra[k].length); out.set(core[k]); out.set(extra[k], core[k].length); return out; };
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(cat('pos', Float32Array), 3));
      g.setAttribute('normal', new BufferAttribute(cat('nrm', Float32Array), 3));
      g.setAttribute('color', new BufferAttribute(cat('col', Float32Array), 3));
      g.setAttribute('aUv', new BufferAttribute(cat('uv', Float32Array), 2));
      g.setAttribute('aArt', new BufferAttribute(cat('art', Float32Array), 4));
      g.setAttribute('aBakeA', new BufferAttribute(cat('bA', Float32Array), 3));
      g.setAttribute('aBakeP', new BufferAttribute(cat('bP', Float32Array), 3));
      const idx = new Uint32Array(core.idx.length + extra.idx.length);
      idx.set(core.idx);
      for (let i = 0; i < extra.idx.length; i++) idx[core.idx.length + i] = extra.idx[i] + n0;
      g.setIndex(new BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      g.boundingSphere.radius += 0.6; // lids and drawers move a little outside what was built
      g.setDrawRange(0, 0); // nothing until the layer has put the material on
      B.inZone(zone, () => B.instance(`art:${zone}:${pt.name}`, g, 'interiorArt'));
      made.push({ name: pt.name, geometry: g, coreCount: core.idx.length, total: idx.length });
    }
    for (const g of groups) for (const l of g.lights) l.boxes = null;
    let glassGeo = null;
    if (glass.n) {
      glassGeo = new BufferGeometry();
      glassGeo.setAttribute('position', new BufferAttribute(new Float32Array(glass.pos), 3));
      glassGeo.setAttribute('normal', new BufferAttribute(new Float32Array(glass.nrm), 3));
      glassGeo.setAttribute('uv', new BufferAttribute(new Float32Array(glass.uv), 2));
      glassGeo.setAttribute('aGl', new BufferAttribute(new Float32Array(glass.gl), 4));
      glassGeo.setIndex(glass.idx);
      glassGeo.computeBoundingSphere();
    }
    const rec = { zone, parts: made, glass: glassGeo, groups, fixtures, movables, boards, barriers, shots, builder: B.colliders };
    REG.recs.set(zone, rec);
    poll();
    return rec;
  };
  return A;
}

function poll() {
  if (REG.polling || typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
  REG.polling = true;
  const tick = () => {
    const G = window.__G;
    if (G && G.level && G.scene && G.mats && !G.mats.stub) { try { installAreaArt(G); } catch (err) { (window.__errors || []).push(`[areaArt] ${err && err.message}`); console.error(`[areaArt] ${err && err.stack ? err.stack : err}`); } } else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---- the glass ------------------------------------------------------------------------------------
// One transparent material for every pane: a dark tint, beads of rain and runs that creep down, and
// for a broken pane only jagged shards round the frame. Purely visual: no pane has a collider.
function glassMaterial(time) {
  const mat = new MeshStandardMaterial({ color: 0x0b1416, roughness: 0.06, metalness: 0, transparent: true, depthWrite: false, side: DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlT = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aGl; varying vec4 vGl; varying vec2 vGlUv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGl = aGl; vGlUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uGlT; varying vec4 vGl; varying vec2 vGlUv;
float gHash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 m = vGlUv * vGl.xy;
  vec2 g = m * 30.0; vec2 id = floor(g); float h = gHash(id + vGl.w * 31.0);
  vec2 o = (vec2(gHash(id + 7.1), gHash(id + 3.3)) - 0.5) * 0.55;
  float bead = step(0.8, h) * (1.0 - smoothstep(0.05 + 0.14 * h, 0.1 + 0.2 * h, length(fract(g) - 0.5 - o)));
  float col = floor(m.x * 22.0); float hc = gHash(vec2(col, vGl.w * 17.0));
  float head = fract(m.y * 0.45 + hc * 9.0 + uGlT * (0.03 + 0.07 * hc));
  float run = step(0.72, hc) * (1.0 - smoothstep(0.1, 0.24, abs(fract(m.x * 22.0) - 0.5 + 0.12 * sin(m.y * 9.0 + hc * 40.0)))) * smoothstep(0.0, 0.45, head) * step(head, 0.5);
  float water = clamp(bead + run, 0.0, 1.0);
  float a = 0.16 + 0.3 * water;
  if (vGl.z > 0.5) {
    vec2 c = vGlUv - 0.5; float ang = atan(c.y, c.x) * 2.864789 + 9.0;
    float sec = floor(ang), t = fract(ang);
    float tooth = (0.03 + 0.22 * gHash(vec2(sec, vGl.w * 53.0))) * (1.0 - abs(2.0 * t - 1.0));
    float e = min(min(vGlUv.x, 1.0 - vGlUv.x) * vGl.x, min(vGlUv.y, 1.0 - vGlUv.y) * vGl.y) / min(vGl.x, vGl.y);
    if (e > tooth) discard;
    a = 0.4 + 0.3 * water;
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.25, 0.28), water);
  diffuseColor.a = a;
}`);
  };
  mat.customProgramCacheKey = () => 'level:interiorGlass';
  return mat;
}

// ---- the layer ------------------------------------------------------------------------------------
// installAreaArt(G): once G.level exists. Idempotent: a second call returns the same layer and does
// nothing. Until createLevel calls it the layer installs itself on the first frame after
// boot. layer.update() runs the layer once a frame; it is also chained onto G.level.update, and it
// does nothing the second time it is called in a frame, so integration may call it itself.
export function installAreaArt(G) {
  if (REG.layer) return REG.layer;
  const level = G.level;
  const recs = [...REG.recs.values()].filter((r) => r.builder && level.groups[r.zone]);
  const mats = createInteriorMats(G);
  const glassTime = { value: 0 };
  const layer = { mats, recs, meshes: {}, glass: null, boards: null, updaters: [], installed: true };
  REG.layer = layer; // from here a second call returns this layer, whatever happens below
  const fxAt = (pos) => { const L = G.lights && G.lights.fixtures; if (!L) return null; for (const f of L) if (Math.abs(f.pos.x - pos[0]) + Math.abs(f.pos.y - pos[1]) + Math.abs(f.pos.z - pos[2]) < 0.02) return f; return null; };
  for (const rec of recs) {
    const group = level.groups[rec.zone];
    const byGeo = new Map();
    group.traverse((c) => { if (c.geometry) byGeo.set(c.geometry, c); });
    layer.meshes[rec.zone] = [];
    for (const pt of rec.parts) {
      const mesh = byGeo.get(pt.geometry);
      if (!mesh) continue;
      mesh.material = mats.shared;
      mesh.receiveShadow = true; mesh.castShadow = false;
      mesh.name = `art:${rec.zone}:${pt.name}`;
      // bounds of its own, so a part behind the camera is not drawn (world.js turns culling off for
      // its instanced meshes, whose instances are spread over a zone; this one is a single piece)
      if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      pt.mesh = mesh;
      layer.meshes[rec.zone].push(mesh);
    }
    // the real fixtures behind the light groups: tune what world.js registered as a plain tube
    for (const f of rec.fixtures) {
      const fx = fxAt(f.pos);
      f.fx = fx;
      if (!fx) continue;
      fx.pool = false;
      if (f.flicker && fx.flicker) Object.assign(fx.flicker, f.flicker);
      fx.set({ color: f.color, lumens: f.lm, range: f.range, priority: f.priority });
    }
    // searchables drawn in the art mesh: the lid, drawer or door moves when searched
    const byProp = new Map();
    for (const mv of rec.movables) { if (!byProp.has(mv.prop)) byProp.set(mv.prop, []); byProp.get(mv.prop).push(mv); }
    for (const [prop, list] of byProp) {
      let open = false;
      const set = (on) => {
        if (on === open) return;
        open = on;
        for (const mv of list) {
          const pt = rec.parts.find((q) => q.name === mv.part);
          if (!pt) continue;
          const pos = pt.geometry.getAttribute('position'), nrm = pt.geometry.getAttribute('normal');
          const m = on ? mv.open : (mv.inv || (mv.inv = mv.open.clone().invert()));
          _nm.getNormalMatrix(m);
          for (let i = mv.start; i < mv.end; i++) {
            _v.fromBufferAttribute(pos, i).applyMatrix4(m); pos.setXYZ(i, _v.x, _v.y, _v.z);
            _n.fromBufferAttribute(nrm, i).applyMatrix3(_nm).normalize(); nrm.setXYZ(i, _n.x, _n.y, _n.z);
          }
          pos.needsUpdate = true; nrm.needsUpdate = true;
        }
      };
      level.props[prop] = { setState(s) { if (s === 'open') set(true); else if (s === 'shut') set(false); }, setSearched(b) { set(!!b); } };
      if (G.params && G.params.searched === 'all') set(true);
    }
    Object.assign(level.shots, rec.shots);
    const p = G.params || {};
    if (p.shot && rec.shots[p.shot] && typeof window !== 'undefined' && window.__setShot && !p.cam) window.__setShot({ cam: rec.shots[p.shot].cam, fov: p.fov || rec.shots[p.shot].fov });
  }
  // every pane of every zone in one transparent mesh (one draw call), hidden while no zone that has
  // glass is drawn
  {
    const withGlass = recs.filter((r) => r.glass);
    if (withGlass.length) {
      const geo = withGlass.length > 1 ? mergeGeometries(withGlass.map((r) => r.glass), false) : withGlass[0].glass;
      geo.computeBoundingSphere();
      const gm = new Mesh(geo, glassMaterial(glassTime));
      gm.name = 'glass'; gm.renderOrder = 4; gm.castShadow = false; gm.receiveShadow = false; gm.userData.noReflect = true;
      level.root.add(gm);
      layer.glass = gm;
      const gg = withGlass.map((r) => level.groups[r.zone]);
      layer.updaters.push(() => { let vis = false; for (let i = 0; i < gg.length; i++) if (gg[i].visible) vis = true; gm.visible = vis; });
    }
  }
  // optional dressing by the tier's propDensity; the tier is picked after the first frames (and can
  // change in play), so this is applied again on every tier change
  const applyDensity = () => {
    const dens = G.quality && Number.isFinite(G.quality.propDensity) ? Math.max(0, Math.min(1, G.quality.propDensity)) : 1;
    for (const rec of recs) for (const pt of rec.parts) pt.geometry.setDrawRange(0, pt.coreCount + Math.floor(((pt.total - pt.coreCount) * dens) / 3) * 3);
    layer.density = dens;
  };
  applyDensity();
  if (G.quality && typeof G.quality.onChange === 'function') G.quality.onChange(applyDensity);
  layer.applyDensity = applyDensity;
  // group gains, once a frame while the level updates
  const g = mats.groups;
  const stutter = (t, ph) => (Math.sin(t * 2.3 + ph) + Math.sin(t * 7.1 + ph * 1.7) > 1.5 || ((t + ph) % 9.5) > 8.8 ? 0.08 + 0.3 * Math.max(0, Math.sin(t * 61 + ph)) : 1);
  const table = []; // [offset, rec group]
  let off = 4;
  for (const rec of recs) for (let i = 1; i < rec.groups.length; i++) { table.push(rec.groups[i]); rec.groups[i].slot = off; off += 4; }
  // each zone's groups are numbered from 1 in its own geometry: remap by an offset per zone
  for (const rec of recs) {
    const first = rec.groups[1] ? rec.groups[1].slot / 4 : 0;
    if (first > 1) for (const pt of rec.parts) { const a = pt.geometry.getAttribute('aArt'); for (let i = 0; i < a.count; i++) { const v = a.getY(i); if (v > 0.5) a.setY(i, v + first - 1); } a.needsUpdate = true; }
  }
  const gainOf = (f) => (f && f.fx ? f.fx.gain : 1);
  const realOf = (f) => (f && f.fx && f.fx.enabled ? Math.min(1, f.fx.real || 0) : 0);
  let lastFrame = -1, lastT = NaN;
  function update() {
    const t = G.time.t, frame = G.time.frame;
    if (frame === lastFrame && t === lastT) return; // already run this frame (by the level, or by whoever integrates the layer)
    lastFrame = frame; lastT = t;
    const on = level.power && level.power.on ? 1 : 0;
    g[0] = g[1] = g[2] = g[3] = 0;
    for (let i = 0; i < table.length; i++) {
      const gr = table[i], o = gr.slot;
      const fa = gr.flickA ? stutter(t, gr.flickA) : gainOf(gr.fxA), fp = gr.flickP ? stutter(t, gr.flickP) : gainOf(gr.fxP);
      // what a real light in the pool is already putting on these surfaces is taken off the bake,
      // separately for the lamps that burn without the power and the ones that need it
      g[o] = fa * (1 - 0.55 * realOf(gr.fxA)); g[o + 1] = on * fp * (1 - 0.45 * realOf(gr.fxP)); g[o + 2] = fa; g[o + 3] = on * fp;
    }
    glassTime.value = t;
    for (let i = 0; i < layer.updaters.length; i++) layer.updaters[i](G.time.dt || 0, t);
  }
  const lu = level.update;
  level.update = function areaArtUpdate() { lu.call(level); update(); };
  layer.update = update;
  for (const hook of REG.hooks || []) { try { hook(G, layer); } catch (err) { console.error(`[areaArt] ${err && err.stack ? err.stack : err}`); } }
  update();
  if (typeof window !== 'undefined') window.__areaArt = layer;
  return layer;
}
// boards.js and barrier.js add what they need at install: fn(G, layer)
export function onInstall(fn) { (REG.hooks || (REG.hooks = [])).push(fn); }
