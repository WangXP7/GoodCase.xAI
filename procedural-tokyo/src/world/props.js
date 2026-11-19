// Street furniture and vegetation: the models (built procedurally once) and the per-tile instancing.
// Local frame of every model: +y up, origin on the ground; `rot` from the tile turns local +z to the
// direction given by the compiler (see tools/pipeline/landscape.mjs and markings.mjs).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Tree } from '@dgreenheck/ez-tree';
import { PROP, DECAL } from '../shared/tileformat.js';
import { shared } from './materials.js';
import { LAMP_LAYER, lampMaterial, lampScene } from './lamplight.js';
import { parkedVehicles } from './traffic.js';
import { DECAL_COLS, DECAL_ROWS } from './decals.js';

const TREE_LOD_DISTANCE = 160; // metres from the camera to the nearest point of a tile; beyond it trees are simple shapes

// ---------------------------------------------------------------- geometry helpers
function colored(geo, rgb) {
  const g = geo.index ? geo.toNonIndexed() : geo, n = g.attributes.position.count, c = new Float32Array(n * 3);
  const col = new THREE.Color().setRGB(...rgb, THREE.SRGBColorSpace);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}
const box = (w, h, d, x, y, z, rgb) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), rgb);
const tube = (r0, r1, h, x, y, z, rgb, seg = 8) => colored(new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y + h / 2, z), rgb);

const CONCRETE = [0.6, 0.6, 0.58], STEEL = [0.36, 0.38, 0.4], DARK = [0.16, 0.17, 0.18];

// Japanese utility pole: concrete mast, two crossarms, a street lamp on a short arm (local +x),
// optionally a pole-top transformer.
const POLE_LAMP = { x: 1.0, y: 5.6 };
function poleGeometry(transformer) {
  const parts = [
    colored(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5).rotateZ(Math.PI / 2).translate(0.5, POLE_LAMP.y + 0.08, 0), STEEL),
    box(0.5, 0.09, 0.2, POLE_LAMP.x, POLE_LAMP.y + 0.04, 0, [0.7, 0.71, 0.72]),
    tube(0.17, 0.12, 10.2, 0, 0, 0, CONCRETE),
    box(1.9, 0.09, 0.09, 0, 9.6, 0, STEEL), box(1.5, 0.09, 0.09, 0, 8.9, 0, STEEL),
    box(0.5, 0.07, 0.07, 0.25, 7.1, 0, STEEL),
  ];
  for (const x of [-0.85, 0, 0.85]) parts.push(tube(0.04, 0.03, 0.16, x, 9.64, 0, [0.85, 0.85, 0.82], 6));
  if (transformer) parts.push(tube(0.3, 0.3, 0.85, 0.42, 7.7, 0, [0.5, 0.52, 0.53], 10), box(0.5, 0.06, 0.4, 0.3, 7.66, 0, STEEL));
  return mergeGeometries(parts);
}
export const WIRE_HEIGHTS = [[-0.85, 9.8], [0, 9.8], [0.85, 9.8], [-0.65, 9.05], [0.65, 9.05], [0.45, 7.15]]; // [lateral offset, height]

// Street light: tapered mast with an arm towards the road (+z) and a flat LED head.
function lightGeometry() {
  return mergeGeometries([
    tube(0.11, 0.07, 8.6, 0, 0, 0, STEEL),
    colored(new THREE.CylinderGeometry(0.045, 0.045, 2.1, 6).rotateX(Math.PI / 2).translate(0, 8.6, 1.0), STEEL),
    box(0.3, 0.1, 0.75, 0, 8.58, 2.25, [0.7, 0.71, 0.72]),
  ]);
}
const LAMP = { y: 8.5, z: 2.25 };

// Signal mast: pole at the kerb, arm over the road (local -x), horizontal three-lens head facing +z.
const SIGNAL = { arm: 3.4, y: 5.6 };
function signalGeometry() {
  const { arm, y } = SIGNAL;
  return mergeGeometries([
    tube(0.12, 0.09, 6.3, 0, 0, 0, STEEL),
    colored(new THREE.CylinderGeometry(0.05, 0.05, arm, 6).rotateZ(Math.PI / 2).translate(-arm / 2, y + 0.45, 0), STEEL),
    box(1.3, 0.46, 0.22, -arm + 0.35, y, 0, [0.72, 0.73, 0.72]),
    box(1.34, 0.05, 0.3, -arm + 0.35, y + 0.25, 0.13, DARK), // visor
  ]);
}

// ---- mapped street furniture; all models face local +z (towards the street)
const WOOD = [0.45, 0.32, 0.2], STONE = [0.55, 0.54, 0.52], BRONZE = [0.3, 0.24, 0.16], RED = [0.78, 0.1, 0.1];
const shape = (geo, rgb, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => colored(geo.scale(sx, sy, sz).translate(x, y, z), rgb);

// Pole-type bus stop: round sign and timetable; variant 1 adds a shelter with a bench.
function busStopGeometry(shelter) {
  const parts = [
    tube(0.045, 0.045, 2.75, 0, 0, 0, STEEL), box(0.34, 0.3, 0.34, 0, 0.15, 0, CONCRETE),
    colored(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 20).rotateX(Math.PI / 2).translate(0, 2.5, 0), [0.93, 0.5, 0.1]),
    colored(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16).rotateX(Math.PI / 2).translate(0, 2.5, 0), [0.95, 0.95, 0.92]),
    box(0.5, 0.75, 0.06, 0, 1.35, 0, [0.9, 0.9, 0.88]),
  ];
  if (shelter) {
    parts.push(box(3.6, 0.08, 1.5, 1.2, 2.55, -0.9, [0.82, 0.84, 0.86]));
    for (const x of [-0.5, 2.9]) parts.push(tube(0.04, 0.04, 2.55, x, 0, -1.5, STEEL));
    parts.push(box(3.4, 1.9, 0.04, 1.2, 1.3, -1.6, [0.78, 0.84, 0.86]), box(2.2, 0.06, 0.4, 1.2, 0.45, -1.3, WOOD));
  }
  return mergeGeometries(parts);
}
const benchGeometry = () => mergeGeometries([
  box(1.6, 0.06, 0.45, 0, 0.43, 0, WOOD), box(1.6, 0.42, 0.05, 0, 0.72, -0.21, WOOD),
  box(0.06, 0.43, 0.42, -0.7, 0.215, 0, STEEL), box(0.06, 0.43, 0.42, 0.7, 0.215, 0, STEEL),
]);
const bollardGeometry = () => mergeGeometries([tube(0.075, 0.075, 0.85, 0, 0, 0, [0.3, 0.31, 0.33], 10), tube(0.08, 0.08, 0.1, 0, 0.62, 0, [0.9, 0.9, 0.86], 10)]);
// Japan Post box: red, on a short pedestal.
const postBoxGeometry = () => mergeGeometries([
  box(0.3, 0.75, 0.28, 0, 0.375, 0, RED), box(0.52, 0.72, 0.46, 0, 1.11, 0, RED), box(0.56, 0.05, 0.5, 0, 1.49, 0, RED),
  box(0.3, 0.04, 0.02, 0, 1.3, 0.235, DARK),
]);
const phoneGeometry = () => mergeGeometries([
  box(0.95, 0.12, 0.95, 0, 2.2, 0, [0.4, 0.45, 0.44]), box(0.95, 0.1, 0.95, 0, 0.05, 0, [0.4, 0.45, 0.44]),
  box(0.04, 2.1, 0.9, -0.45, 1.1, 0, [0.72, 0.82, 0.8]), box(0.04, 2.1, 0.9, 0.45, 1.1, 0, [0.72, 0.82, 0.8]), box(0.9, 2.1, 0.04, 0, 1.1, -0.45, [0.72, 0.82, 0.8]),
  box(0.3, 0.4, 0.2, 0, 1.2, -0.3, [0.25, 0.6, 0.35]),
]);
// Subway entrance: stairs going down between low walls, under a canopy with the blue sign band.
const subwayGeometry = () => mergeGeometries([
  box(0.2, 1.1, 4.6, -1.1, 0.55, 0, CONCRETE), box(0.2, 1.1, 4.6, 1.1, 0.55, 0, CONCRETE), box(2.4, 1.1, 0.2, 0, 0.55, -2.3, CONCRETE),
  box(2.0, 0.04, 4.4, 0, 0.03, 0, [0.03, 0.03, 0.035]),
  ...[[-1.1, 2.2], [1.1, 2.2], [-1.1, -2.2], [1.1, -2.2]].map(([x, z]) => tube(0.05, 0.05, 2.6, x, 0, z, STEEL)),
  box(2.6, 0.12, 5.0, 0, 2.66, 0, [0.85, 0.86, 0.87]), box(2.6, 0.42, 0.1, 0, 2.42, 2.5, [0.06, 0.4, 0.75]),
]);
// Statues: 0 a figure on a plinth, 1 Hachikō (a seated dog on its granite base), 2 the Moyai stone head.
function statueGeometry(variant) {
  if (variant === 1) return mergeGeometries([
    box(1.5, 1.35, 1.1, 0, 0.675, 0, STONE), box(1.7, 0.12, 1.3, 0, 0.06, 0, STONE),
    shape(new THREE.SphereGeometry(0.5, 12, 8), BRONZE, 0, 1.75, -0.12, 0.62, 0.75, 0.85),   // haunches
    shape(new THREE.SphereGeometry(0.5, 12, 8), BRONZE, 0, 2.05, 0.12, 0.5, 0.8, 0.5),       // chest
    shape(new THREE.SphereGeometry(0.5, 12, 8), BRONZE, 0, 2.55, 0.2, 0.42, 0.42, 0.46),     // head
    shape(new THREE.SphereGeometry(0.5, 8, 6), BRONZE, 0, 2.5, 0.42, 0.2, 0.18, 0.3),        // muzzle
    shape(new THREE.ConeGeometry(0.5, 1, 6), BRONZE, -0.13, 2.82, 0.14, 0.16, 0.2, 0.12),    // ears
    shape(new THREE.ConeGeometry(0.5, 1, 6), BRONZE, 0.13, 2.78, 0.14, 0.16, 0.14, 0.12),    // (the left one drooped)
    ...[-0.14, 0.14].map((x) => shape(new THREE.CylinderGeometry(0.5, 0.5, 1, 8), BRONZE, x, 1.72, 0.3, 0.13, 0.75, 0.13)), // forelegs
    shape(new THREE.TorusGeometry(0.5, 0.2, 6, 10, Math.PI * 1.4), BRONZE, 0, 1.75, -0.48, 0.3, 0.3, 0.3),                 // curled tail
  ]);
  if (variant === 2) return mergeGeometries([
    shape(new THREE.SphereGeometry(0.5, 12, 10), [0.35, 0.34, 0.33], 0, 1.35, 0, 1.5, 2.7, 1.3),
    box(0.3, 0.9, 0.4, 0, 1.45, 0.62, [0.33, 0.32, 0.31]), box(1.0, 0.12, 0.2, 0, 1.95, 0.6, [0.28, 0.27, 0.26]),
  ]);
  return mergeGeometries([
    box(0.9, 1.0, 0.9, 0, 0.5, 0, STONE),
    shape(new THREE.SphereGeometry(0.5, 10, 8), BRONZE, 0, 1.55, 0, 0.5, 1.1, 0.4),
    shape(new THREE.SphereGeometry(0.5, 8, 6), BRONZE, 0, 2.25, 0, 0.3, 0.32, 0.3),
  ]);
}
// A rack of parked bicycles.
function bikesGeometry() {
  const parts = [box(3.0, 0.05, 0.05, 0, 0.75, -0.6, STEEL)];
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.58, c = [[0.12, 0.2, 0.5], [0.6, 0.1, 0.1], [0.75, 0.75, 0.75], [0.1, 0.1, 0.1], [0.2, 0.45, 0.25]][i];
    for (const z of [-0.52, 0.52]) parts.push(colored(new THREE.TorusGeometry(0.31, 0.022, 4, 12).rotateY(Math.PI / 2).translate(x, 0.33, z), DARK));
    parts.push(box(0.04, 0.05, 1.0, x, 0.6, 0, c), box(0.04, 0.5, 0.05, x, 0.72, -0.3, c), box(0.04, 0.6, 0.05, x, 0.78, 0.45, c),
      box(0.42, 0.03, 0.03, x, 1.05, 0.45, DARK), box(0.12, 0.05, 0.24, x, 0.98, -0.3, DARK));
  }
  return mergeGeometries(parts);
}
// Wayside shrine: a small red torii and a stone lantern.
const shrineGeometry = () => mergeGeometries([
  tube(0.07, 0.06, 1.9, -0.6, 0, 0, RED), tube(0.07, 0.06, 1.9, 0.6, 0, 0, RED),
  box(1.7, 0.1, 0.12, 0, 1.92, 0, RED), box(1.4, 0.07, 0.08, 0, 1.6, 0, RED),
  box(0.3, 0.7, 0.3, 0, 0.35, -0.9, STONE), box(0.42, 0.3, 0.42, 0, 0.85, -0.9, STONE), box(0.56, 0.1, 0.56, 0, 1.05, -0.9, STONE),
]);

// ---- more mapped objects (tools/pipeline/extras.mjs)
// A fire hydrant marker: the round red 消火栓 sign on a pole.
const hydrantGeometry = () => mergeGeometries([
  tube(0.035, 0.035, 2.6, 0, 0, 0, [0.85, 0.85, 0.82]),
  colored(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 18).rotateX(Math.PI / 2).translate(0, 2.4, 0), RED),
  colored(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16).rotateX(Math.PI / 2).translate(0, 2.4, 0), [0.95, 0.95, 0.92]),
]);
const infoGeometry = () => mergeGeometries([
  tube(0.04, 0.04, 1.9, -0.55, 0, 0, STEEL), tube(0.04, 0.04, 1.9, 0.55, 0, 0, STEEL),
  box(1.3, 0.95, 0.06, 0, 1.4, 0, [0.9, 0.9, 0.86]), box(1.1, 0.75, 0.07, 0, 1.4, 0, [0.35, 0.55, 0.45]),
]);
const tableGeometry = () => mergeGeometries([
  box(1.6, 0.06, 0.75, 0, 0.74, 0, WOOD), box(1.6, 0.05, 0.28, 0, 0.44, 0.62, WOOD), box(1.6, 0.05, 0.28, 0, 0.44, -0.62, WOOD),
  box(0.08, 0.74, 1.4, -0.6, 0.37, 0, STEEL), box(0.08, 0.74, 1.4, 0.6, 0.37, 0, STEEL),
]);
// Playground equipment: 0 a slide, 1 a swing.
function playGeometry(variant) {
  if (variant === 1) return mergeGeometries([
    tube(0.04, 0.04, 2.2, -1.2, 0, 0, [0.2, 0.45, 0.75]), tube(0.04, 0.04, 2.2, 1.2, 0, 0, [0.2, 0.45, 0.75]),
    box(2.5, 0.07, 0.07, 0, 2.2, 0, [0.2, 0.45, 0.75]),
    ...[-0.5, 0.5].flatMap((x) => [box(0.02, 1.6, 0.02, x - 0.18, 1.4, 0, DARK), box(0.02, 1.6, 0.02, x + 0.18, 1.4, 0, DARK), box(0.42, 0.04, 0.2, x, 0.6, 0, [0.85, 0.2, 0.15])]),
  ]);
  return mergeGeometries([
    box(0.9, 0.08, 0.9, 0, 1.5, -1.0, [0.9, 0.7, 0.1]), ...[[-0.4, -1.4], [0.4, -1.4], [-0.4, -0.6], [0.4, -0.6]].map(([x, z]) => tube(0.04, 0.04, 1.5, x, 0, z, [0.2, 0.45, 0.75])),
    colored(new THREE.BoxGeometry(0.6, 0.05, 2.6).rotateX(-0.55).translate(0, 0.78, 0.55), [0.85, 0.2, 0.15]),
  ]);
}
// Torii, 5 m between the pillars at scale 1: two pillars, the tie beam, and the lintel with its upturned ends.
const toriiGeometry = () => {
  const wood = [0.42, 0.3, 0.2];
  return mergeGeometries([
    tube(0.3, 0.26, 5.6, -2.5, 0, 0, wood, 14), tube(0.3, 0.26, 5.6, 2.5, 0, 0, wood, 14),
    box(6.0, 0.36, 0.3, 0, 4.4, 0, wood), box(7.0, 0.42, 0.5, 0, 5.75, 0, wood), box(7.4, 0.2, 0.62, 0, 6.05, 0, wood),
    colored(new THREE.BoxGeometry(0.9, 0.2, 0.62).rotateZ(0.22).translate(-3.9, 6.18, 0), wood),
    colored(new THREE.BoxGeometry(0.9, 0.2, 0.62).rotateZ(-0.22).translate(3.9, 6.18, 0), wood),
  ]);
};
// Level crossing: a warning mast each side of the road with the X sign and lamps, and the barrier arm raised.
const railCrossingGeometry = () => {
  const yellow = [0.92, 0.75, 0.1];
  const parts = [];
  for (const [x, z, s] of [[-3.6, -4.5, 1], [3.6, 4.5, -1]]) {
    parts.push(tube(0.06, 0.06, 3.6, x, 0, z, yellow),
      colored(new THREE.BoxGeometry(1.3, 0.14, 0.04).rotateZ(0.6).translate(x, 3.0, z), yellow), colored(new THREE.BoxGeometry(1.3, 0.14, 0.04).rotateZ(-0.6).translate(x, 3.0, z), yellow),
      box(0.18, 0.18, 0.1, x - 0.25, 2.3, z, RED), box(0.18, 0.18, 0.1, x + 0.25, 2.3, z, RED),
      colored(new THREE.BoxGeometry(0.07, 4.2, 0.07).rotateZ(0.25 * s).translate(x - 0.55 * s, 2.9, z), yellow), box(0.3, 1.0, 0.3, x, 0.5, z, [0.25, 0.25, 0.25]));
  }
  return mergeGeometries(parts);
};

function vendingGeometry() {
  return mergeGeometries([box(1.02, 1.83, 0.72, 0, 0.915, 0, [1, 1, 1]), box(1.06, 0.1, 0.76, 0, 0.05, 0, DARK)]);
}

// Front panel of a vending machine: rows of drinks behind glass, price strips, the delivery flap.
function vendingTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#dfe6ea'; g.fillRect(8, 10, 112, 150);
  const drinks = ['#c8102e', '#f2a900', '#1d6fb8', '#2e8b57', '#111', '#e85d04', '#fff', '#7b2d8b', '#6b3e26'];
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 9; i++) {
      g.fillStyle = drinks[(i * 7 + row * 4) % drinks.length];
      g.fillRect(12 + i * 12, 16 + row * 50, 8, 30);
      g.fillStyle = '#333'; g.fillRect(12 + i * 12, 48 + row * 50, 8, 4);
      g.fillStyle = i % 3 ? '#2a6cff' : '#e03131'; g.fillRect(13 + i * 12, 53 + row * 50, 6, 3);
    }
  g.fillStyle = '#c9c9c4'; g.fillRect(8, 168, 112, 30);
  g.fillStyle = '#222'; g.fillRect(84, 174, 28, 18); g.fillRect(20, 212, 88, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const VENDING_BODY = [[0.92, 0.92, 0.9], [0.75, 0.1, 0.12], [0.12, 0.3, 0.62], [0.9, 0.86, 0.72]];

// The light a lamp throws on the ground under it, as a share of what falls straight below: it thins with the
// square of the distance and with the slant, (1 + (r / h)^2)^-1.5 for a lamp h above the ground. The quad
// reaches POOL_REACH lamp heights out; the little that is left there is taken off so the edge is at zero.
const POOL_REACH = 2.6;
function glowTexture() {
  const N = 128, data = new Uint8Array(N * N * 4), edge = (1 + POOL_REACH ** 2) ** -1.5;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const d = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2) / (N / 2);
    const v = d >= 1 ? 0 : Math.max(0, ((1 + (POOL_REACH * d) ** 2) ** -1.5 - edge) / (1 - edge));
    data.set([v * 255, v * 255, v * 255, 255], (j * N + i) * 4);
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Road symbols: one atlas cell per DECAL variant; [width, length] on the road in metres.
const CELL_W = 256, CELL_H = 512;
function decalTexture() {
  const c = document.createElement('canvas');
  c.width = DECAL_COLS * CELL_W; c.height = DECAL_ROWS * CELL_H;
  const g = c.getContext('2d');
  const cell = (v, draw) => {
    g.save();
    g.translate((v % DECAL_COLS) * CELL_W, Math.floor(v / DECAL_COLS) * CELL_H);
    g.beginPath(); g.rect(0, 0, CELL_W, CELL_H); g.clip();
    draw();
    g.restore();
  };
  // Arrows are drawn in metres on a 1.7 x 5 m cell: the far end (direction of travel) is up.
  const arrow = (through, turn) => () => {
    g.scale(CELL_W / 1.7, CELL_H / 5);
    g.fillStyle = g.strokeStyle = '#fff'; g.lineWidth = 0.17; g.lineCap = 'butt'; g.lineJoin = 'round';
    const x = turn === 0 ? 0.85 : turn < 0 ? 1.15 : 0.55; // shaft position leaves room for the branch
    const head = (tx, ty, dx, dy, len, wid) => { // triangle with its tip at (tx, ty) pointing along (dx, dy)
      g.beginPath(); g.moveTo(tx, ty);
      g.lineTo(tx - dx * len - dy * wid, ty - dy * len + dx * wid); g.lineTo(tx - dx * len + dy * wid, ty - dy * len - dx * wid);
      g.closePath(); g.fill();
    };
    if (through) { g.beginPath(); g.moveTo(x, 4.9); g.lineTo(x, 1.7); g.stroke(); head(x, 0.1, 0, -1, 1.7, 0.33); }
    if (turn) {
      const y = through ? 2.9 : 1.9, ex = x + turn * 0.25;
      g.beginPath(); g.moveTo(x, 4.9); g.lineTo(x, y + 0.5); g.quadraticCurveTo(x, y, ex, y - 0.25); g.stroke();
      head(x + turn * 0.9, y - 0.95, turn * 0.68, -0.73, 1.05, 0.3);
    }
  };
  cell(DECAL.THROUGH, arrow(true, 0)); cell(DECAL.LEFT, arrow(false, -1)); cell(DECAL.RIGHT, arrow(false, 1));
  cell(DECAL.THROUGH_LEFT, arrow(true, -1)); cell(DECAL.THROUGH_RIGHT, arrow(true, 1));
  // Text is stretched along the road, as painted, so it reads from a low viewpoint.
  const font = (px) => `900 ${px}px "Yu Gothic", "Meiryo", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;
  const fit = (text, x, y, w, h, color) => {
    g.save();
    g.font = font(200); g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = color;
    const m = g.measureText(text), tw = m.width, th = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    g.translate(x + w / 2, y + h); g.scale(w / tw, h / th);
    g.fillText(text, 0, -m.actualBoundingBoxDescent);
    g.restore();
  };
  cell(DECAL.STOP, () => [...'止まれ'].forEach((ch, i) => fit(ch, 14, 10 + i * 168, CELL_W - 28, 150, '#fff')));
  for (const [v, text] of [[DECAL.SPEED_20, '20'], [DECAL.SPEED_30, '30'], [DECAL.SPEED_40, '40'], [DECAL.SPEED_50, '50'], [DECAL.SPEED_60, '60']])
    cell(v, () => [...text].forEach((ch, i) => fit(ch, 10 + i * 124, 12, 112, CELL_H - 24, '#f2a31b')));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Lenses of the traffic signals: unlit discs that cycle green -> yellow -> red from uTime.
function lensMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec2 aLens; // x: 0 green, 1 yellow, 2 red; y: phase 0 or 1 (crossing directions alternate)
      varying vec2 vLens; varying vec2 vUv;
      void main() { vLens = aLens; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vLens; varying vec2 vUv;
      void main() {
        float t = mod(uTime + vLens.y * 32.0, 64.0);            // 0-27 green, 27-30 yellow, 30-64 red
        float state = t < 27.0 ? 0.0 : t < 30.0 ? 1.0 : 2.0;
        float on = 1.0 - step(0.5, abs(state - vLens.x));
        vec3 c = vLens.x < 0.5 ? vec3(0.0, 1.0, 0.62) : vLens.x < 1.5 ? vec3(1.0, 0.7, 0.0) : vec3(1.0, 0.08, 0.05);
        float d = length(vUv - 0.5) * 2.0;
        if (d > 1.0) discard;
        gl_FragColor = vec4(c * mix(0.06, 2.6, on) * (1.0 - 0.35 * d), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- trees
// Variants 0-1 are street trees, 2-3 park trees. `height` is the model height in metres at scale 1.
const TREES = [
  { preset: 'Ash Medium', seed: 11, height: 9, tint: 0xb5c890 },
  { preset: 'Oak Small', seed: 23, height: 8, tint: 0xc0d09a },
  { preset: 'Oak Medium', seed: 5, height: 13, tint: 0x9fb87f },
  { preset: 'Oak Large', seed: 42, height: 17, tint: 0x8fae78 },
  // by genus (OSM): 4 ginkgo — tall and narrow, fresh green; 5 cherry — low and spreading, in blossom
  { preset: 'Aspen Medium', seed: 7, height: 13, tint: 0xa9c24f, recolor: true },
  { preset: 'Ash Small', seed: 31, height: 7, tint: 0xf4b6cf, recolor: true, blossom: true },
];

// The seasons: every tree draws a colour of its own by where it stands (so the tree near by and the simple one
// far off agree). Autumn: reds, oranges and yellows, with a few evergreens left; spring: cherry blossom on about
// a third of them — pale pink, deeper pink, almost white — among fresh green. Summer is the trees as they are.
const SEASON_VERT_PARS = /* glsl */ `
varying float vTreeSeed;
varying vec3 vLeafAt;
`;
const SEASON_VERT = /* glsl */ `
  vLeafAt = position;
  #ifdef USE_INSTANCING
    vTreeSeed = fract(sin(dot(floor(instanceMatrix[3].xz * 4.0), vec2(12.9898, 78.233))) * 43758.5453);
  #else
    vTreeSeed = 0.5;
  #endif
`;
const SEASON_FRAG_PARS = /* glsl */ `
uniform float uSeason;
varying float vTreeSeed;
varying vec3 vLeafAt;
vec3 seasonColor(float s);
float leafHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
// Cherry blossom on a leaf card: instead of leaves, a scatter of small five-petalled flowers — pale pink, each
// a little different, deeper at the heart — with the air between them cut away. Returns colour and cover.
vec4 blossom(vec2 uv, float seed) {
  vec2 g = uv * 5.0, id = floor(g), f = fract(g) - 0.5;
  float h = leafHash(vec3(id, seed * 91.0)), h2 = leafHash(vec3(id.yx + 3.0, seed * 37.0));
  f += (vec2(h2, fract(h2 * 7.7)) - 0.5) * 0.35;
  float r = length(f), a = atan(f.y, f.x) + h * 6.2832;
  float flower = step(r, 0.3 + 0.13 * cos(5.0 * a)) * step(0.18, h);
  vec3 c = mix(vec3(0.82, 0.5, 0.6), vec3(0.92, 0.78, 0.82), h2);
  c = mix(vec3(0.7, 0.25, 0.38), c, smoothstep(0.02, 0.16, r));
  return vec4(c, flower);
}
// Foliage on a smooth crown: clusters of leaves, each its own shade and some a neighbour's colour, with dark
// gaps between them (fading out where they would be smaller than a pixel). Returns the crown's colour.
vec3 foliage(float seed, float light) {
  vec3 at = vLeafAt * 13.0 + seed * 31.0, cell = floor(at);
  float n = leafHash(cell), m = leafHash(cell + 7.3), fine = 1.0 - smoothstep(0.25, 0.9, fwidth(at.x) + fwidth(at.y) + fwidth(at.z));
  vec3 c = mix(seasonColor(seed), seasonColor(fract(seed + 0.13 + 0.2 * m)), step(0.62, n) * 0.75 * fine);
  float gap = smoothstep(0.0, 0.22, n);                       // the dark between the clusters
  return c * light * mix(1.0, mix(0.28, 1.0, gap) * (0.75 + 0.55 * m), fine);
}
vec3 seasonColor(float s) {
  float t = fract(s * 7.31 + 0.13);                       // a second number from the first
  if (uSeason < 1.5) {                                    // autumn
    // a Tokyo park in November: rust, russet and ochre among dark evergreens — deep colours, none of them bright
    if (s < 0.34) return mix(vec3(0.035, 0.085, 0.03), vec3(0.06, 0.11, 0.035), t);  // evergreen
    if (s < 0.42) return mix(vec3(0.16, 0.15, 0.04), vec3(0.2, 0.13, 0.035), t);     // turning
    if (s < 0.72) return mix(vec3(0.4, 0.15, 0.03), vec3(0.3, 0.1, 0.025), t);       // rust, burnt orange
    if (s < 0.86) return mix(vec3(0.24, 0.085, 0.03), vec3(0.3, 0.06, 0.03), t);     // russet, dull red
    return mix(vec3(0.46, 0.27, 0.05), vec3(0.38, 0.2, 0.04), t);                    // ochre
  }
  if (s < 0.38) return mix(mix(vec3(0.86, 0.6, 0.68), vec3(0.78, 0.45, 0.56), t), vec3(0.9, 0.8, 0.82), step(0.75, t)); // blossom
  return mix(vec3(0.2, 0.36, 0.09), vec3(0.3, 0.42, 0.12), t);                      // fresh green
}
`;

// Leaves: ez-tree's own leaf material moves vertices without the instance matrix, so it cannot be
// instanced. This one keeps its texture and adds a sway that works per instance. The alpha cutoff is
// low on purpose: minified, the texture's averaged alpha drops, and at 0.5 the canopy would vanish
// a few tens of metres away.
// recolor: use only the brightness and outline of the leaf texture, and the tint as the colour (blossom).
// blossom: a cherry — in flower whatever the season says.
function leafMaterial(map, tint, recolor = false, blossom = false) {
  const m = new THREE.MeshStandardMaterial({ map, color: tint, alphaTest: 0.18, side: THREE.DoubleSide, roughness: 0.85 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLampOn = { value: 0 }; shader.uniforms.uLampMap = shared.uLampMap; // (no lamp light here; the sampler still needs its texture)
    if (recolor) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec4 leaf = texture2D(map, vMapUv);
      diffuseColor.rgb *= 0.55 + 0.7 * dot(leaf.rgb, vec3(0.3, 0.6, 0.1));
      diffuseColor.a *= leaf.a;`);
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uSeason = shared.uSeason;
    // (the season: the leaf keeps its outline and its light and shade, and takes the tree's colour)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SEASON_FRAG_PARS)
      .replace('#include <alphatest_fragment>', `if (uSeason > 0.5) diffuseColor.rgb = seasonColor(vTreeSeed) * (0.45 + 1.0 * dot(texture2D(map, vMapUv).rgb, vec3(0.3, 0.6, 0.1)));
      // the trees in blossom (in spring, those the season makes pink; a cherry, always) bear flowers, not leaves
      if (${blossom ? 'true' : 'uSeason > 1.5 && vTreeSeed < 0.38'}) { vec4 bloom = blossom(vMapUv, vTreeSeed); diffuseColor = vec4(bloom.rgb * (0.85 + 0.3 * vTreeSeed), bloom.a); }
      #include <alphatest_fragment>`);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;' + SEASON_VERT_PARS)
      .replace('#include <project_vertex>', SEASON_VERT + '#include <project_vertex>')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 swayAt = (instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vec3 swayAt = transformed;
        #endif
        float sway = 0.6 * sin(uTime * 1.3 + swayAt.x * 0.35 + swayAt.z * 0.27) + 0.3 * sin(uTime * 2.9 + swayAt.x * 1.1 + swayAt.y);
        transformed.xz += uv.y * sway * 0.07;`);
  };
  m.customProgramCacheKey = () => (recolor ? 'leaves-recolor-v7' : 'leaves-v7') + (blossom ? '-blossom' : '');
  return m;
}

// The simple far trees take the season too: their crowns (green in the model; the trunk is brown) are recoloured.
function seasonal(m) {
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer); // (the lamp light's uniforms: lamplight.js)
    shader.uniforms.uSeason = shared.uSeason; shader.uniforms.uTreeGlow = shared.uTreeGlow;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>' + SEASON_VERT_PARS).replace('#include <project_vertex>', SEASON_VERT + '#include <project_vertex>');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTreeGlow;\n' + SEASON_FRAG_PARS)
      // (on the abstract model by night the crowns glow a little, blue-green: lighter on top)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (vColor.g > vColor.r) totalEmissiveRadiance += uTreeGlow * (0.35 + 0.9 * clamp(vColor.g / 0.1, 0.0, 1.0));')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // (a crown is not of one colour: patches of it lean towards another tree's, and are lighter or darker)
        if (uSeason > 0.5 && vColor.g > vColor.r) diffuseColor.rgb = foliage(vTreeSeed, 0.22 + 0.85 * clamp(vColor.g / 0.1, 0.0, 1.0));`);
  };
  m.customProgramCacheKey = () => 'blob-season-v6';
  return m;
}

function buildTree(def) {
  const tree = new Tree();
  tree.loadPreset(def.preset);
  const o = tree.options;
  o.seed = def.seed;
  // fewer, larger leaf cards: thousands of trees are drawn, not one hero tree
  o.leaves.count = Math.max(4, Math.round(o.leaves.count * 0.55));
  o.leaves.size *= 1.45;
  // thinner meshes: the presets are tuned for a single hero tree, we draw thousands
  for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(3, Math.round(o.branch.sections[k] * 0.5));
  for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * 0.6));
  tree.generate();
  const size = new THREE.Box3().setFromObject(tree).getSize(new THREE.Vector3());
  const s = def.height / size.y;
  const prep = (mesh) => { const g = mesh.geometry.clone(); g.scale(s, s, s); g.computeBoundingSphere(); return g; };
  return {
    radius: (Math.max(size.x, size.z) * s) / 2, height: def.height,
    branches: prep(tree.branchesMesh), leaves: prep(tree.leavesMesh),
    branchMat: new THREE.MeshStandardMaterial({ map: tree.branchesMesh.material.map, roughness: 0.95 }),
    leafMat: leafMaterial(tree.leavesMesh.material.map, def.tint, def.recolor, def.blossom),
  };
}

// Far trees: a smooth lumpy crown on a stick (unit height, unit width), coloured per vertex.
function blobTreeGeometry() {
  // a crown of several lumps grown into one another (a main mass, shoulders, a top), each a little uneven
  const lump = ([cx, cy, cz, r, squash], k) => {
    const g = mergeVertices(new THREE.IcosahedronGeometry(r, 1).deleteAttribute('uv').deleteAttribute('normal'));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const w = 0.86 + 0.2 * Math.sin(x * 21 + z * 13 + k * 2.1) * Math.sin(y * 17 + x * 9 + k) + 0.1 * Math.sin(z * 31 + y * 23 + k * 4.7);
      p.setXYZ(i, cx + x * w, cy + y * w * squash, cz + z * w);
    }
    g.computeVertexNormals();
    return g.toNonIndexed();
  };
  const crown = mergeGeometries([[0, 0.6, 0, 0.36, 0.95], [0.21, 0.52, 0.08, 0.26, 0.85], [-0.19, 0.55, -0.11, 0.27, 0.85], [0.03, 0.8, -0.04, 0.24, 0.9], [-0.06, 0.5, 0.22, 0.25, 0.8], [0.1, 0.56, -0.22, 0.23, 0.8]].map(lump));
  const g = crown, n = g.attributes.position.count, c = new Float32Array(n * 3);
  // darker underneath, lighter on top, like a lit canopy
  for (let i = 0; i < n; i++) {
    const t = THREE.MathUtils.clamp((g.attributes.position.getY(i) - 0.25) / 0.75, 0, 1);
    // (the olive green of leaves in the sun, not the blue-green of paint)
    c[i * 3] = 0.02 + 0.046 * t; c[i * 3 + 1] = 0.034 + 0.074 * t; c[i * 3 + 2] = 0.011 + 0.02 * t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return mergeGeometries([g, tube(0.035, 0.03, 0.35, 0, 0, 0, [0.25, 0.2, 0.16], 5)]);
}

// ---------------------------------------------------------------- per-tile instancing
// One instanced mesh for all the props of one kind in the whole city (a pole, a lamp, a parked car of one
// model...). A tile hands in its share when it is loaded and takes it back when it goes: the mesh is then written
// anew, all shares one after the other. Drawing costs the processor per mesh, not per pole — and one tile's
// poles are a dozen; so the meshes are few and large, and the graphics card does the rest (these things are
// small: there is no need to leave out those that are out of view).
class Pool {
  constructor(parent, geometry, material, shadow, lamp, extra) {
    Object.assign(this, { parent, material, shadow, lamp, extra, shares: new Set(), mesh: null, stale: false });
    this.geometry = extra ? geometry.clone() : geometry; // (extra: an attribute of its own per prop: { name, size })
  }

  add(share) { this.shares.add(share); this.stale = true; }
  remove(share) { this.shares.delete(share); this.stale = true; }

  write() {
    if (!this.stale) return;
    this.stale = false;
    let total = 0, coloured = false;
    for (const s of this.shares) { total += s.count; coloured ||= !!s.colors; }
    let mesh = this.mesh;
    if (!mesh || total > mesh.instanceMatrix.count) { // (room for half as many again: tiles come and go all the time)
      const room = Math.max(64, Math.ceil(total * 1.5));
      if (mesh) { this.parent.remove(mesh); mesh.dispose(); }
      mesh = this.mesh = new THREE.InstancedMesh(this.geometry, this.material, room);
      mesh.castShadow = mesh.receiveShadow = this.shadow;
      mesh.frustumCulled = false;
      mesh.raycast = () => {}; // (nothing here is ever picked)
      if (this.lamp) mesh.layers.set(LAMP_LAYER);
      if (this.extra) this.geometry.setAttribute(this.extra.name, new THREE.InstancedBufferAttribute(new Float32Array(room * this.extra.size), this.extra.size));
      this.parent.add(mesh);
    }
    if (coloured && !mesh.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3).fill(1), 3);
    const extra = this.extra && this.geometry.attributes[this.extra.name];
    let n = 0;
    for (const s of this.shares) {
      mesh.instanceMatrix.array.set(s.matrices, n * 16);
      if (s.colors) mesh.instanceColor.array.set(s.colors, n * 3);
      if (extra) extra.array.set(s.extra, n * this.extra.size);
      n += s.count;
    }
    mesh.count = total;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (extra) extra.needsUpdate = true;
  }
}

export class Props {
  root = null;       // the scene the pools' meshes stand in (set by whoever makes the Props)
  pools = new Map(); // by model, material and kind: see pool()

  pool(geometry, material, shadow, lamp, extra) {
    const key = `${geometry.uuid} ${material.uuid} ${shadow} ${lamp}`;
    if (!this.pools.has(key)) this.pools.set(key, new Pool(lamp ? lampScene : this.root, geometry, material, shadow, lamp, extra));
    return this.pools.get(key);
  }

  // Takes a tile's props (what build() returned) out of the pools again.
  release(built) { for (const share of built.shares) share.pool.remove(share); }

  constructor() {
    const std = (extra) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, ...extra });
    this.trees = TREES.map(buildTree);
    this.models = {
      pole: [poleGeometry(false), poleGeometry(true)], light: lightGeometry(), signal: signalGeometry(), vending: vendingGeometry(),
      blob: blobTreeGeometry(), lamp: new THREE.BoxGeometry(0.24, 0.03, 0.6), quad: new THREE.PlaneGeometry(1, 1),
      pool: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), lens: new THREE.CircleGeometry(0.15, 16),
    };
    // furniture drawn as one instanced model per kind (and variant)
    this.furniture = {
      [PROP.BUS_STOP]: [busStopGeometry(false), busStopGeometry(true)], [PROP.BENCH]: [benchGeometry()],
      [PROP.BOLLARD]: [bollardGeometry()], [PROP.POST_BOX]: [postBoxGeometry()], [PROP.PHONE]: [phoneGeometry()],
      [PROP.SUBWAY]: [subwayGeometry()], [PROP.STATUE]: [0, 1, 2].map(statueGeometry), [PROP.BIKES]: [bikesGeometry()],
      [PROP.SHRINE]: [shrineGeometry()], [PROP.HYDRANT]: [hydrantGeometry()], [PROP.INFO]: [infoGeometry()], [PROP.TABLE]: [tableGeometry()],
      [PROP.PLAY]: [playGeometry(0), playGeometry(1)], [PROP.TORII]: [toriiGeometry()], [PROP.RAIL_CROSSING]: [railCrossingGeometry()],
    };
    this.mats = {
      metal: std(), blob: seasonal(std({ roughness: 0.95, metalness: 0 })),
      vending: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }),
      panel: new THREE.MeshBasicMaterial({ map: vendingTexture() }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff2d8 }),
      // the footprint of a lamp's light, drawn into the light map (lamplight.js), not into the picture
      pool: lampMaterial(glowTexture()),
      lens: lensMaterial(),
      poolCool: null,
      decal: new THREE.MeshStandardMaterial({
        map: decalTexture(), transparent: true, depthWrite: false, roughness: 0.8,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -10,
      }),
      wire: new THREE.LineBasicMaterial({ color: 0x14161a }),
    };
    this.mats.poolCool = lampMaterial(this.mats.pool.map); // white LED lamps on the back streets
    this.mats.poolPark = lampMaterial(this.mats.pool.map); // lamps along park paths
    this.time = 0;
  }

  streetLights = 1; // strength of the light the street lamps throw on the ground at night (1: as designed)
  parkLights = 0.3; // the same for the lamps along park paths: dimmer than the streets

  update(dt) {
    this.time += dt;
    const night = shared.uNight.value;
    shared.uTime.value = this.time;
    this.mats.lens.uniforms.uTime.value = this.time;
    // the light straight under a lamp, in its colour: sodium-warm on the avenues, white on the back streets
    const k = night * this.streetLights;
    this.mats.pool.color.setRGB(1.9 * k, 1.5 * k, 0.95 * k);
    this.mats.poolCool.color.setRGB(1.15 * k, 1.25 * k, 1.4 * k);
    const p = night * this.parkLights;
    this.mats.poolPark.color.setRGB(1.7 * p, 1.5 * p, 1.05 * p);
    for (const pool of this.pools.values()) pool.write(); // (tiles that came or went since the last frame)
    this.mats.lamp.color.setRGB(0.35 + 2.4 * night, 0.34 + 2.2 * night, 0.32 + 1.8 * night);
    this.mats.panel.color.setScalar(0.85 + 1.1 * night);
  }

  // props: Float32Array of [kind, variant, rot, x, z, scale] rows; wires: Float32Array of [x1, z1, x2, z2] rows.
  // Returns { group, near, far, shares, count, roosts } — `near` holds the full trees, `far` the simple ones (the
  // other props are in the city's pools: `shares` is what this tile put there, for release()); count =
  // trees; roosts = [x, y, z, ...] of the tree crowns (where the birds come down).
  build(props, wires, ground) {
    const group = new THREE.Group(), near = new THREE.Group(), farGroup = new THREE.Group(), far = [], shares = [];
    group.add(near, farGroup);
    const by = new Map(), roosts = [];
    for (let i = 0; i < props.length; i += 6) {
      if (props[i] === PROP.TREE) roosts.push(props[i + 3], ground(props[i + 3], props[i + 4]) + this.trees[props[i + 1] % this.trees.length].height * props[i + 5] * 0.72, props[i + 4]);
      // one instanced mesh per kind and model; parked cars share a model per vehicle type (their variant also carries the colour)
      const key = props[i] * 16 + (props[i] === PROP.PARKED ? props[i + 1] & 3 : props[i] === PROP.TREE || props[i] === PROP.POLE || this.furniture[props[i]] ? props[i + 1] : 0);
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(i);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3();
    // One matrix per prop: `local` offsets the part within the prop's frame. With a `parent`, they make an instanced
    // mesh of the tile's own (the trees: near and far ones are shown in turn); without, they go into the city's
    // pool of that model (lamp: of the light thrown on the ground; extra: see Pool) and their share is returned.
    // clump: so many more of each are stood round it, a few metres off and a little smaller (park trees: a wood
    // is not a grid of single trees). The same for every part of the tree, near and far.
    const rand = (i, c, k) => { const h = Math.sin(props[i + 3] * 12.9898 + props[i + 4] * 78.233 + c * 37.719 + k * 11.13) * 43758.5453; return h - Math.floor(h); };
    const instanced = (rows, geo, mat, { parent = null, shadow = true, lift = 0, local = null, scale = null, clump = 0, lamp = false, extra = null } = {}) => {
      const more = typeof clump === 'function' ? clump : () => clump; // (clump may differ from row to row)
      const count = rows.reduce((sum, i) => sum + 1 + more(i), 0), matrices = new Float32Array(count * 16);
      let n = -1;
      rows.forEach((i) => { for (let c = 0; c <= more(i); c++) {
        const away = c ? 3 + 3.5 * rand(i, c, 1) : 0, turn = rand(i, c, 2) * 6.2832, size = c ? 0.7 + 0.35 * rand(i, c, 3) : 1;
        const x = props[i + 3] + Math.cos(turn) * away, z = props[i + 4] + Math.sin(turn) * away;
        let k = scale ? scale(i) : props[i + 5];
        k = Array.isArray(k) ? k.map((e) => e * size) : k * size;
        q.setFromAxisAngle(up, props[i + 2] + c * 2.1);
        v.set(x, ground(x, z) + lift, z);
        if (local) v.add(new THREE.Vector3(...local).multiplyScalar(props[i + 5]).applyQuaternion(q)); // (parts sit on a model of that size)
        if (Array.isArray(k)) s.set(...k); else s.setScalar(k);
        m.compose(v, q, s).toArray(matrices, ++n * 16);
      } });
      if (!parent) {
        const share = { count, matrices, colors: null, extra: null, pool: this.pool(geo, mat, shadow, lamp, extra) };
        share.pool.add(share);
        shares.push(share);
        return share;
      }
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.instanceMatrix.array.set(matrices);
      mesh.castShadow = shadow; mesh.receiveShadow = shadow;
      mesh.computeBoundingSphere();
      parent.add(mesh);
      return mesh;
    };

    for (const [key, rows] of by) {
      const kind = key >> 4, variant = key & 15;
      if (kind === PROP.TREE) {
        const t = this.trees[variant % this.trees.length], clump = variant === 2 || variant === 3 ? 2 : 0; // (park trees)
        instanced(rows, t.branches, t.branchMat, { parent: near, clump });
        instanced(rows, t.leaves, t.leafMat, { parent: near, clump });
        far.push(...rows); // (the simple shapes of all the tile's trees are one mesh: below)
      } else if (kind === PROP.POLE) {
        instanced(rows, this.models.pole[variant % 2], this.mats.metal);
        instanced(rows, this.models.lamp, this.mats.lamp, { shadow: false, local: [POLE_LAMP.x, POLE_LAMP.y - 0.02, 0], scale: () => [1.6, 1, 0.3] });
        instanced(rows, this.models.pool, this.mats.poolCool, { lamp: true, lift: 0.2, shadow: false, local: [POLE_LAMP.x + 0.6, 0, 0], scale: () => 2 * POOL_REACH * POLE_LAMP.y });
      } else if (kind === PROP.LIGHT) {
        instanced(rows, this.models.light, this.mats.metal, { lift: 0.15 });
        instanced(rows, this.models.lamp, this.mats.lamp, { lift: 0.15, shadow: false, local: [0, LAMP.y, LAMP.z] });
        // the light on the ground: street lights, and park lamps (half the height: a smaller patch, a strength of its own)
        const street = rows.filter((r) => props[r + 5] >= 1), park = rows.filter((r) => props[r + 5] < 1);
        if (street.length) instanced(street, this.models.pool, this.mats.pool, { lamp: true, lift: 0.34, shadow: false, local: [0, 0, LAMP.z + 1], scale: () => 2 * POOL_REACH * LAMP.y });
        if (park.length) instanced(park, this.models.pool, this.mats.poolPark, { lamp: true, lift: 0.34, shadow: false, local: [0, 0, LAMP.z + 1], scale: () => 1.4 * POOL_REACH * LAMP.y });
      } else if (kind === PROP.VENDING) {
        const body = instanced(rows, this.models.vending, this.mats.vending, { lift: 0.02 });
        body.colors = new Float32Array(rows.length * 3);
        rows.forEach((i, n) => new THREE.Color().setRGB(...VENDING_BODY[props[i + 1] % 4], THREE.SRGBColorSpace).toArray(body.colors, n * 3));
        instanced(rows, this.models.quad, this.mats.panel, { lift: 0.02, shadow: false, local: [0, 0.97, 0.365], scale: () => [0.94, 1.66, 1] });
      } else if (kind === PROP.PARKED) {
        const kit = parkedVehicles(), cars = instanced(rows, kit.models[variant % kit.models.length], kit.material, { lift: 0.05 });
        cars.colors = new Float32Array(rows.length * 3);
        rows.forEach((i, n) => new THREE.Color(kit.colors[(props[i + 1] >> 2) % kit.colors.length]).toArray(cars.colors, n * 3));
      } else if (this.furniture[kind]) {
        const models = this.furniture[kind];
        instanced(rows, models[variant % models.length], this.mats.metal, { lift: 0.12 });
      } else if (kind === PROP.DECAL) {
        // Draped over the road in the tile worker and attached by Streamer.
      } else if (kind === PROP.SIGNAL) {
        instanced(rows, this.models.signal, this.mats.metal, { lift: 0.15 });
        // three lenses per head; crossing directions alternate phase
        for (let lens = 0; lens < 3; lens++) {
          const lenses = instanced(rows, this.models.lens, this.mats.lens, {
            lift: 0.15, shadow: false, local: [-SIGNAL.arm + 0.35 + (lens - 1) * -0.4, SIGNAL.y, 0.115], scale: (i) => props[i + 5], extra: { name: 'aLens', size: 2 },
          });
          const a = lenses.extra = new Float32Array(rows.length * 2);
          rows.forEach((i, n) => { a[n * 2] = lens; a[n * 2 + 1] = Math.round(props[i + 2] / (Math.PI / 2)) % 2; });
        }
      }
    }

    // the far trees: one shape for every species (each at its own size), so one mesh for the whole tile
    if (far.length) {
      const tree = (i) => this.trees[(props[i + 1] & 15) % this.trees.length], park = (i) => ((props[i + 1] & 15) === 2 || (props[i + 1] & 15) === 3 ? 2 : 0);
      instanced(far, this.models.blob, this.mats.blob, { parent: farGroup, shadow: false, clump: park, scale: (i) => [tree(i).radius * 1.75 * props[i + 5], tree(i).height * props[i + 5], tree(i).radius * 1.75 * props[i + 5]] });
    }

    // wires: catenaries between pole tops
    if (wires.length) {
      const SEG = 6, pts = [];
      for (let i = 0; i < wires.length; i += 4) {
        const x1 = wires[i], z1 = wires[i + 1], x2 = wires[i + 2], z2 = wires[i + 3];
        const len = Math.hypot(x2 - x1, z2 - z1) || 1, nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
        const y1 = ground(x1, z1), y2 = ground(x2, z2), sag = len * 0.022;
        for (const [off, h] of WIRE_HEIGHTS)
          for (let k = 0; k < SEG; k++)
            for (const t of [k / SEG, (k + 1) / SEG])
              pts.push(x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + h - sag * 4 * t * (1 - t), z1 + (z2 - z1) * t + nz * off);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      near.add(new THREE.LineSegments(g, this.mats.wire)); // hair-thin: only worth drawing close up
    }
    return { group, near, far: farGroup, shares, roosts, count: (by.get(PROP.TREE * 16) ?? []).length + (by.get(PROP.TREE * 16 + 1) ?? []).length + (by.get(PROP.TREE * 16 + 2) ?? []).length + (by.get(PROP.TREE * 16 + 3) ?? []).length };
  }

  static lodDistance = TREE_LOD_DISTANCE;
}
