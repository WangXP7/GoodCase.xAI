// The scrapyard's stacks and its crane.
//
// A stack is worldLayout's `stack` box filled with pressed cars (carGeometry at its
// middle level, crushed), laid nose to tail in layers on timber bearers. All the stacks are one mesh
// in the car-body material, made when the level installs, with a cheaper stand-in for a distance. The collider is worldLayout's box (drawn by
// nobody else): each car also stands in the level's `vcRefl` bucket as a plain box, which is what
// the puddles mirror and what the no-invisible-wall test sees.
import { box, cyl, cylUp, M, rgb, torus } from '../build.js';
import { carGeometry, CAR_TYPES } from './car.js';
import { VBuf, MID, FAR, registerVehicle } from './vehicleParts.js';
import { YARD } from '../../mats/yard.js';

const TYPES = ['sedan', 'hatch', 'wagon', 'sedan', 'suv', 'hatch', 'wagon', 'pickup'];
const PAINTS = [0x5a2a1e, 0x8a8c86, 0x24403f, 0x1a1c20, 0x4f6478, 0x34405a, 0x6b5a3a, 0x7a2018, 0x3a4a34, 0x9a9484, 0x54301c, 0x2a2e3a];
const RUST = rgb(0x4a2a1a), DARK = rgb(0x0c0c0d);

// stacks: worldLayout.stacks. Returns the list of cars placed ({ type, m, len }).
export function buildStacks(A, W, rng) {
  const B = A.B;
  const cars = [];
  W.stacks.forEach((s, si) => {
    const alongX = s.x1 - s.x0 >= s.z1 - s.z0;
    const len = alongX ? s.x1 - s.x0 : s.z1 - s.z0;
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    const layers = Math.max(1, Math.round(s.h / 0.7));
    const pitch = layers > 1 ? (s.h - 0.86) / (layers - 1) : 0;
    for (let k = 0; k < layers; k++) {
      // cars nose to tail from one end of the box to the other: as many as fit, each stretched or
      // squeezed a few per cent so the row ends flush with the collider (a pressed car hides it)
      const n = Math.max(1, Math.round(len / 4.7));
      const row = [];
      for (let i = 0; i < n; i++) row.push(n === 1 ? (len > 5.2 ? 'pickup' : len > 4.6 ? 'wagon' : 'hatch') : TYPES[(si * 3 + k * 5 + i * 2 + rng.int(0, 2)) % TYPES.length]);
      const total = row.reduce((t, type) => t + CAR_TYPES[type].L, 0);
      const sx = Math.min(1.22, Math.max(0.84, (len - 0.06) / total));
      const gap = n > 1 ? (len - 0.06 - total * sx) / (n - 1) : 0;
      let at = -(n > 1 ? len - 0.06 : total * sx) / 2;
      row.forEach((type, i) => {
        const L = CAR_TYPES[type].L * sx;
        const mid = at + L / 2;
        const yaw = (rng.next() < 0.5 ? 0 : Math.PI) + rng.range(-0.03, 0.03);
        const y = k * pitch - 0.13 + (k ? rng.range(-0.02, 0.03) : 0);
        const off = rng.range(-0.06, 0.06);
        const m = alongX ? M(cx + mid, y, cz + off, rng.range(-0.03, 0.03), yaw, rng.range(-0.02, 0.02), sx, 1, 1) : M(cx + off, y, cz + mid, rng.range(-0.03, 0.03), yaw + Math.PI / 2, rng.range(-0.02, 0.02), sx, 1, 1);
        const paint = PAINTS[(si * 5 + k * 3 + i * 7 + rng.int(0, 3)) % PAINTS.length];
        cars.push({ type, m, len: L, paint, seed: rng.int(1, 1 << 30), crushed: rng.range(0.74, 0.9), rust: rng.range(0.6, 1), dirt: rng.range(0.5, 0.9) });
        // what the puddles and the tests see of it
        B.add('vcRefl', box(CAR_TYPES[type].L - 0.06, 0.74, CAR_TYPES[type].W - 0.12), { m: m.clone().multiply(M(0, 0.6, 0)), color: rgb(paint, 0.35) });
        at += L + gap;
      });
      // timber bearers between the layers, a little proud of the cars' flanks
      if (k) A.detail(() => {
        for (let b = -len / 2 + 0.9; b < len / 2 - 0.5; b += 2.3) {
          const y = k * pitch + 0.06;
          if (alongX) A.box('wood', [cx + b - 0.07, y - 0.05, s.z0 - 0.04], [cx + b + 0.07, y + 0.05, s.z1 + 0.04], rgb(0x3a2c1e), { par: 2 });
          else A.box('wood', [s.x0 - 0.04, y - 0.05, cz + b - 0.07], [s.x1 + 0.04, y + 0.05, cz + b + 0.07], rgb(0x3a2c1e), { par: 0 });
        }
      });
    }
    // one shadow caster a stack
    B.add('shadow', box(s.x1 - s.x0 - 0.2, s.h - 0.1, s.z1 - s.z0 - 0.2), { m: M(cx, s.h / 2, cz) });
    B.blob(s.x1 - s.x0 + 0.8, s.z1 - s.z0 + 0.8, cx, cz);
  });
  return cars;
}

// The stacks as two geometries for the car-body material: every car pressed at its middle level
// (what stands in the lanes), and a third of the triangles for when the yard is seen from across
// the forecourt or the motel's lot (the far level's plain body, flattened to a pressed car's height).
export function stackGeometries(cars) {
  const full = new VBuf(), low = new VBuf();
  for (const c of cars) {
    const o = { crushed: c.crushed, rust: c.rust, dirt: c.dirt, paint: c.paint, seed: c.seed, damage: 0.5 };
    full.merge(carGeometry(c.type, o, MID).body, c.m);
    low.merge(carGeometry(c.type, { rust: c.rust, dirt: c.dirt, paint: c.paint, seed: c.seed }, FAR).body, c.m.clone().multiply(M(0, 0.12, 0, 0, 0, 0, 1, 0.6, 1)));
  }
  return { full: full.geometry(), low: low.geometry() };
}

// a pile of tyres at the current transform: n rings high, leaning
export function tyrePile(A, n, rng, r = 0.33) {
  for (let i = 0; i < n; i++) {
    A.add('paint', torus(r - 0.1, 0.105, 6, 10).rotateX(Math.PI / 2), { m: M(rng.range(-0.03, 0.03), 0.105 + i * 0.2, rng.range(-0.03, 0.03), 0, rng.range(0, 3), 0), color: YARD.tyre.color, par: 0 });
  }
}

// loose scrap at the foot of a stack: a door on edge, an axle, a bonnet, wheels
export function looseScrap(A, rng, kind) {
  if (kind === 'door') {
    A.box('metal', [-0.5, 0, -0.03], [0.5, 0.62, 0.03], rgb(PAINTS[rng.int(0, PAINTS.length - 1)], 0.5), { par: 1.2, rx: -0.3, bevel: 0.02 });
    A.box('paint', [-0.4, 0.6, -0.2], [0.3, 0.9, -0.17], DARK, { rx: -0.3 });
  } else if (kind === 'axle') {
    A.add('metal', cyl(0.045, 0.045, 1.5, 8).rotateZ(Math.PI / 2), { m: M(0, 0.2, 0), color: RUST, par: 1.6 });
    for (const s of [-1, 1]) A.add('metal', cyl(0.19, 0.19, 0.07, 12).rotateZ(Math.PI / 2), { m: M(s * 0.74, 0.2, 0), color: RUST, par: 1.6 });
    A.add('metal', cyl(0.13, 0.13, 0.26, 10).rotateZ(Math.PI / 2), { m: M(0.1, 0.2, 0), color: RUST, par: 1.4 });
  } else if (kind === 'bonnet') {
    A.box('metal', [-0.7, 0, -0.55], [0.7, 0.04, 0.55], rgb(PAINTS[rng.int(0, PAINTS.length - 1)], 0.5), { par: 1.1, rz: 0.06, bevel: 0.015 });
  } else if (kind === 'engine') {
    A.box('metal', [-0.32, 0, -0.24], [0.32, 0.42, 0.24], rgb(0x2a2622), { par: 1.5, bevel: 0.03 });
    A.box('metal', [-0.36, 0.42, -0.2], [0.36, 0.5, 0.2], rgb(0x3a3632), { par: 1.2, bevel: 0.02 });
    for (let i = 0; i < 4; i++) A.add('metal', cylUp(0.03, 0.03, 0.1, 6), { m: M(-0.24 + i * 0.16, 0.5, 0.0), color: RUST, par: 1.5 });
    A.add('metal', cyl(0.12, 0.12, 0.06, 10).rotateZ(Math.PI / 2), { m: M(0.36, 0.2, 0), color: RUST, par: 1.6 });
  } else {
    A.add('paint', torus(0.23, 0.105, 6, 10), { m: M(0, 0.33, 0, 0, 0, 0.1), color: YARD.tyre.color });
    A.add('metal', cyl(0.2, 0.2, 0.1, 10).rotateX(Math.PI / 2), { m: M(0, 0.33, 0), color: RUST, par: 1.4 });
  }
}

// The crane: a lattice tower beyond the south fence, its jib reaching over the yard with a pressed
// car hanging from the hook, a red lamp at the head. Nothing of it comes within reach: no collider.
export function buildCrane(A, o = {}) {
  const B = A.B;
  const [bx, bz] = o.base || [41, 27.6];
  const H = o.h || 15, R = o.reach || 13, steel = rgb(0x3a2f1a, 0.9), yellow = rgb(0x6a5210, 0.9);
  const bar = (a, b, t, col = steel) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
    const yaw = Math.atan2(-dz, dx), pitch = Math.asin(dy / L);
    A.add('paint', box(L, t, t), { m: M((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 0, yaw, pitch), color: col, par: 0 });
  };
  B.at(M(bx, 0, bz), () => {
    const w = 0.85;
    const corners = [[-w, -w], [w, -w], [w, w], [-w, w]];
    for (const [x, z] of corners) bar([x, -1.5, z], [x, H, z], 0.16, yellow);
    for (let y = 1; y < H; y += 2) for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      bar([a[0], y + 1, a[1]], [b[0], y + 1, b[1]], 0.08, yellow);
      if ((y - 1) / 2 % 2 < 1) bar([a[0], y - 1, a[1]], [b[0], y + 1, b[1]], 0.07, yellow); else bar([b[0], y - 1, b[1]], [a[0], y + 1, a[1]], 0.07, yellow);
    }
    // slewing ring, cab, the jib (toward -z: over the yard) and the counter-jib
    A.add('paint', cylUp(1.3, 1.3, 0.35, 12), { m: M(0, H, 0), color: steel });
    A.box('paint', [-0.75, H + 0.35, -1.9], [0.75, H + 2.0, -0.4], rgb(0x4a3c14, 0.9), { bevel: 0.05 });
    A.box('paint', [-0.6, H + 1.05, -1.93], [0.6, H + 1.75, -1.9], rgb(0x05070a), { par: 1 });
    const top = H + 4.2;
    for (const [x, z] of corners) bar([x * 0.6, H + 0.35, z * 0.6], [0, top, 0], 0.12, yellow);
    const jy = H + 1.2, jl = R + 3;
    for (const sx of [-0.55, 0.55]) bar([sx, jy, 1.0], [sx, jy, -jl], 0.11, yellow);
    bar([0, jy + 1.0, 0.6], [0, jy + 1.0, -jl + 0.6], 0.11, yellow);
    for (let z = 0; z > -jl + 1; z -= 1.3) {
      const k = Math.round(-z / 1.3) % 2 ? 1 : -1;
      bar([0.55 * k, jy, z], [0, jy + 1.0, z - 0.65], 0.055, yellow); bar([0, jy + 1.0, z - 0.65], [-0.55 * k, jy, z - 1.3], 0.055, yellow);
      bar([-0.55, jy, z], [0.55, jy, z - 1.3], 0.05, yellow);
    }
    bar([0, top, 0], [0, jy + 1.0, -jl * 0.55], 0.035, DARK); bar([0, top, 0], [0, jy + 1.0, -jl + 0.8], 0.035, DARK);
    for (const sx of [-0.55, 0.55]) bar([sx, jy, 1.0], [sx, jy, 6.2], 0.11, yellow);
    bar([0, top, 0], [0, jy + 0.1, 6.0], 0.035, DARK);
    A.box('concrete', [-0.9, jy - 1.3, 4.3], [0.9, jy - 0.1, 6.3], rgb(0x4a4844), {});
    // trolley, cable, hook block, chains and the pressed car
    const hz = -R, hy = o.hang || 8.6;
    A.box('paint', [-0.7, jy - 0.28, hz - 0.5], [0.7, jy - 0.02, hz + 0.5], steel);
    for (const sx of [-0.12, 0.12]) bar([sx, jy - 0.1, hz], [sx, hy + 1.9, hz], 0.022, DARK);
    A.box('paint', [-0.22, hy + 1.45, hz - 0.14], [0.22, hy + 1.95, hz + 0.14], rgb(0x7a5a10, 0.9), { bevel: 0.03 });
    A.add('metal', torus(0.14, 0.035, 6, 12, Math.PI * 1.4), { m: M(0, hy + 1.3, hz, 0, 0, 2.2), color: RUST, par: 1.2 });
    for (const [x, z] of [[-1.5, -0.6], [1.5, -0.6], [1.5, 0.6], [-1.5, 0.6]]) bar([0, hy + 1.22, hz], [x, hy + 0.42, hz + z], 0.022, DARK);
    A.light({ pos: [0, H + 4.5, 0], lm: 30, color: A.LIGHT.red, amb: 0, noShadow: true, reach: 3 });
    A.add('glow', cylUp(0.09, 0.09, 0.2, 8), { m: M(0, top, 0), color: [0.3, 0.02, 0.02], glow: [9, 0.5, 0.3] });
    A.add('glow', cylUp(0.07, 0.07, 0.16, 8), { m: M(0, jy + 1.05, -jl + 0.6), color: [0.3, 0.02, 0.02], glow: [9, 0.5, 0.3] });
    // the hanging car is the stacks' kind, in the vehicle layer
    B.at(M(0, hy - 0.45, hz, 0.05, Math.PI / 2 + 0.3, -0.07), () => registerVehicle(B, {
      kind: 'stack', id: 'yard-hung', oneLevel: true, reach: 60,
      build: () => ({ body: carGeometry('sedan', { crushed: 0.82, rust: 0.9, dirt: 0.7, paint: 0x24403f, seed: 4411 }, MID).body, wheels: [], plates: [] }),
    }));
  });
}
