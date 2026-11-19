// What stands in the garage's service bays: two-post lifts, hung tube fittings, the tool
// wall, tyre racks, drums, the office's furniture. Everything is authored into the garage's art
// (mats/interior.js builder `A`); colliders go through B.collide.
import { box, cyl, cylUp, lathe, M, rgb, torus, tube } from '../build.js';
import { buildCar, CAR_TYPES } from './car.js';

const STEEL = rgb(0x8a8e92), DARK = rgb(0x0e0e0f), RED = rgb(0x8a1c14), BLUE = rgb(0x1c3f7a), YELLOW = rgb(0xb8860f);
export const TUBE_GLOW = [0.8 * 26, 1.0 * 26, 0.9 * 26];

// A two-post lift across z at (x, z): posts, carriages at `lift` m, four arms with pads, the
// overhead cable beam. With a car: the car stands on the pads, its wheels hanging.
export function buildLift(A, x, z, o = {}) {
  const B = A.B;
  const lift = o.lift ?? 0.12, span = 1.52, col = o.color || BLUE;
  B.at(M(x, 0, z), () => {
    for (const s of [-1, 1]) {
      A.box('paint', [-0.15, 0, s * span - 0.14], [0.15, 3.62, s * span + 0.14], col, { par: 1, shadow: true });
      A.box('metal', [-0.3, 0, s * span - 0.32], [0.3, 0.025, s * span + 0.32], STEEL, { par: 0.6 });
      A.box('paint', [-0.19, lift + 0.05, s * (span - 0.17) - 0.05], [0.19, lift + 0.6, s * (span - 0.17) + 0.05], DARK, { par: 1 });
      for (const f of [-1, 1]) {
        // an arm swung in under the sill, a round pad at its end
        const ax = f * 0.72, az = s * (span - 0.75);
        const L = Math.hypot(ax, az - s * (span - 0.2));
        B.at(M(0, lift + 0.1, s * (span - 0.2), 0, Math.atan2(-(az - s * (span - 0.2)), ax), 0), () => {
          A.box('paint', [0, -0.04, -0.045], [L, 0.04, 0.045], col, { par: 1 });
          A.add('paint', cylUp(0.075, 0.075, 0.05, 10), { m: M(L, 0.04, 0), color: DARK });
        });
      }
      A.box('paint', [-0.05, 1.2, s * (span + 0.15)], [0.05, 1.5, s * (span + 0.19)], YELLOW, { par: 1 });
      B.tag('garage:lift', () => B.collide([-0.16, 0, s * span - 0.15], [0.16, 3.7, s * span + 0.15], 'metal'));
    }
    A.box('paint', [-0.09, 3.62, -span - 0.14], [0.09, 3.76, span + 0.14], col, { par: 1 });
    A.detail(() => {
      // the power unit on one post, its hose; yellow hazard paint on the floor
      A.box('paint', [-0.32, 1.0, span + 0.14], [-0.1, 1.5, span + 0.32], rgb(0x23262a), { par: 1, bevel: 0.02 });
      A.add('paint', cylUp(0.07, 0.07, 0.3, 8), { m: M(-0.21, 1.5, span + 0.23), color: rgb(0x2a2d31) });
      for (const s of [-1, 1]) A.quad('paint', [-2.5, 0.006, s * (span + 0.45) - 0.05], [5, 0, 0], [0, 0, 0.1 * -1], YELLOW, { cell: 9, par: 0 });
    });
    if (o.car) {
      const t = CAR_TYPES[o.car.type || 'sedan'], h = t.L / 2, hw = t.W / 2, up = lift + 0.16 - t.sill;
      const before = B.colliders.length;
      B.tag('garage:liftcar', () => {
        B.at(M(0, up, 0), () => buildCar(B, { id: 'garage-lift', noCollide: true, dirt: 0.5, rust: 0.3, ...o.car }));
        B.collide([-h, 0, -hw], [h, up + t.belt, hw], 'metal');
        B.collide([t.roofR - 0.15, up + t.belt, -hw + 0.1], [t.roofF + 0.25, up + t.roofY, hw - 0.1], 'glass');
      });
      // no footing on it, as on any car
      const c0 = B.point(0, 0, 0), c1 = B.point(0, 0, 1);
      for (let i = before; i < B.colliders.length; i++) B.colliders[i].slip = { c: [c0[0], c0[2]], side: [c1[0] - c0[0], c1[2] - c0[2]] };
      // axle stands under the sills, an oil pan under the sump with what ran out of it
      A.detail(() => {
        for (const [sx, sz] of [[-1.1, -0.5], [1.1, 0.5]]) { A.add('paint', lathe([[0.16, 0], [0.05, 0.3], [0.035, up + t.sill - 0.02], [0, up + t.sill - 0.02]], 6), { m: M(sx, 0, sz), color: RED, par: 1 }); }
        A.add('metal', cylUp(0.24, 0.2, 0.07, 14), { m: M(1.2, 0, 0.1), color: rgb(0x2a2c2e), par: 0.4 });
        A.add('paint', cylUp(0.19, 0.19, 0.012, 14), { m: M(1.2, 0.058, 0.1), color: rgb(0x050505), par: 1 });
      });
    }
  });
}

// A twin-tube batten hung on two chains at (x, y, z), along x. state: 'power' | 'dead' | 'always'
export function buildBatten(A, x, y, z, ceil, state = 'power', len = 1.5) {
  A.box('paint', [x - len / 2, y, z - 0.11], [x + len / 2, y + 0.07, z + 0.11], rgb(0xb9b6a8), { par: 1 });
  for (const dz of [-0.055, 0.055]) {
    const g = cyl(0.019, 0.019, len - 0.08, 6).rotateZ(Math.PI / 2);
    if (state === 'dead') A.add('paint', g, { m: M(x, y - 0.02, z + dz), color: rgb(0x55584f), par: 1 });
    else A.add('glow', g, { m: M(x, y - 0.02, z + dz), color: [0.4, 0.42, 0.4], glow: TUBE_GLOW, power: state === 'power' });
  }
  for (const s of [-1, 1]) A.add('paint', cyl(0.006, 0.006, ceil - y - 0.07, 4), { m: M(x + s * (len / 2 - 0.15), (ceil + y + 0.07) / 2, z), color: DARK });
}

// The tool wall: a pegboard on a wall face. origin: its lower-left corner as seen; u: along it to
// the viewer's right (a unit axis), w x h metres. Outlines painted for each tool; some are gone.
export function buildToolWall(A, origin, u, w, h, rng) {
  const B = A.B;
  const yaw = Math.atan2(-u[2], u[0]);
  B.at(M(origin[0], origin[1], origin[2], 0, yaw, 0), () => {
    A.box('wood', [0, 0, 0], [w, h, 0.02], rgb(0x7a6444), { par: 0 });
    A.box('paint', [-0.03, -0.03, 0], [w + 0.03, 0, 0.035], rgb(0x23262a)); A.box('paint', [-0.03, h, 0], [w + 0.03, h + 0.03, 0.035], rgb(0x23262a));
    const tools = [];
    // rows of spanners (longest first), then hammers, saws, a row of screwdrivers, sockets on a rail
    let x = 0.12;
    for (let i = 0; i < 9 && x < w * 0.45; i++) { tools.push(['spanner', x, h - 0.12, 0.34 - i * 0.022]); x += 0.085; }
    x += 0.12;
    for (let i = 0; i < 3 && x < w - 0.5; i++) { tools.push(['hammer', x, h - 0.1, 0.32]); x += 0.2; }
    for (let i = 0; i < 2 && x < w - 0.5; i++) { tools.push(['saw', x + 0.1, h - 0.1, 0.5]); x += 0.36; }
    for (x = 0.14; x < w * 0.5; x += 0.075) tools.push(['driver', x, h - 0.62, 0.2 + ((x * 31) % 3) * 0.02]);
    for (x = w * 0.56; x < w - 0.3; x += 0.34) tools.push(['pliers', x, h - 0.6, 0.2]);
    for (const [kind, tx, ty, len] of tools) {
      const here = rng.next() > 0.3;
      const steel = rgb(0x9a9ea2), out = rgb(0x14161a);
      if (kind === 'spanner') {
        A.box('paint', [tx - 0.022, ty - len, 0.02], [tx + 0.022, ty, 0.022], out);
        if (here) { A.box('metal', [tx - 0.011, ty - len + 0.02, 0.024], [tx + 0.011, ty - 0.03, 0.032], steel); A.add('metal', torus(0.018, 0.008, 4, 8), { m: M(tx, ty - 0.02, 0.028), color: steel }); A.add('metal', torus(0.016, 0.007, 4, 8, 4.4), { m: M(tx, ty - len + 0.012, 0.028, 0, 0, -2.5), color: steel }); }
      } else if (kind === 'hammer') {
        A.box('paint', [tx - 0.02, ty - len, 0.02], [tx + 0.02, ty - 0.04, 0.022], out); A.box('paint', [tx - 0.075, ty - 0.07, 0.02], [tx + 0.075, ty, 0.022], out);
        if (here) { A.box('wood', [tx - 0.014, ty - len + 0.01, 0.024], [tx + 0.014, ty - 0.03, 0.045], rgb(0x7a5a30), { par: 2 }); A.box('metal', [tx - 0.065, ty - 0.06, 0.024], [tx + 0.065, ty - 0.012, 0.062], rgb(0x4a4c50), { bevel: 0.008 }); }
      } else if (kind === 'saw') {
        A.box('paint', [tx - 0.07, ty - len, 0.02], [tx + 0.07, ty, 0.022], out);
        if (here) { A.box('metal', [tx - 0.05, ty - len + 0.01, 0.024], [tx + 0.04, ty - 0.14, 0.027], steel); A.box('wood', [tx - 0.06, ty - 0.14, 0.024], [tx + 0.06, ty - 0.01, 0.046], rgb(0x6a4424), { par: 2, bevel: 0.01 }); }
      } else if (kind === 'driver') {
        if (here) { A.add('paint', cylUp(0.013, 0.013, 0.085, 6), { m: M(tx, ty - 0.085, 0.036), color: [RED, YELLOW, BLUE][Math.floor(tx * 40) % 3], par: 1 }); A.add('metal', cylUp(0.004, 0.004, len - 0.08, 4), { m: M(tx, ty - len, 0.036), color: steel }); }
        else A.box('paint', [tx - 0.012, ty - len, 0.02], [tx + 0.012, ty, 0.022], out);
      } else {
        A.box('paint', [tx - 0.04, ty - len, 0.02], [tx + 0.04, ty, 0.022], out);
        if (here) { for (const s of [-1, 1]) { A.box('paint', [tx + s * 0.018 - 0.008, ty - len + 0.01, 0.024], [tx + s * 0.018 + 0.008, ty - 0.07, 0.036], RED, { par: 1, rz: s * 0.08 }); } A.box('metal', [tx - 0.014, ty - 0.08, 0.024], [tx + 0.014, ty - 0.005, 0.034], steel); }
      }
    }
    A.box('metal', [0.1, h - 0.66, 0.02], [w * 0.5, h - 0.64, 0.05], STEEL);
    // a shelf under it: tins, a coil of airline, a jerry can
    A.box('wood', [0, -0.34, 0], [w, -0.3, 0.32], rgb(0x5a4630), { par: 0 });
    for (const sx of [0.05, w - 0.09]) A.box('metal', [sx, -0.62, 0.0], [sx + 0.04, -0.3, 0.3], STEEL, { par: 0.7 });
    A.detail(() => {
      for (let i = 0; i < 7; i++) { const cx = 0.15 + i * 0.21 + rng.range(-0.03, 0.03), r = rng.range(0.045, 0.075), hh = rng.range(0.1, 0.22); A.add('paint', cylUp(r, r, hh, 10), { m: M(cx, -0.3, 0.14 + rng.range(-0.04, 0.05)), color: [RED, rgb(0x1f4a3a), rgb(0xb9b6a8), YELLOW, rgb(0x23262a)][i % 5], par: 1 }); }
      if (w > 2.2) { A.box('paint', [w - 0.75, -0.3, 0.05], [w - 0.4, 0.14, 0.24], RED, { par: 1, bevel: 0.03 }); A.add('paint', torus(0.14, 0.022, 5, 14), { m: M(w - 1.05, -0.26, 0.17, Math.PI / 2, 0, 0), color: rgb(0xb84a10) }); }
    });
  });
}

// a rack of tyres against a wall: two shelves of tyres stood on their tread, along +x from the origin
export function buildTyreRack(A, n, rng) {
  A.box('metal', [-0.03, 0, 0], [n * 0.24 + 0.03, 0.03, 0.66], STEEL, { par: 0.8 });
  for (const y of [0.78, 1.56]) { for (const z of [0.05, 0.6]) A.add('metal', cyl(0.018, 0.018, n * 0.24 + 0.06, 5).rotateZ(Math.PI / 2), { m: M(n * 0.12, y, z), color: STEEL, par: 0.8 }); }
  for (const x of [-0.02, n * 0.24 + 0.02]) for (const z of [0.05, 0.6]) A.add('metal', cylUp(0.02, 0.02, 2.3, 5), { m: M(x, 0, z), color: STEEL, par: 0.8 });
  for (const y of [0.03, 0.8, 1.58]) for (let i = 0; i < n; i++) {
    if (y > 1 && rng.next() < 0.3) continue;
    A.add('paint', torus(0.235, 0.105, 6, 10).rotateY(Math.PI / 2), { m: M(0.12 + i * 0.24, y + 0.34, 0.33, rng.range(-0.06, 0.06), 0, 0), color: rgb(0x0a0a0b), par: 0 });
  }
}

// an oil drum standing at the current transform (dressing: the caller adds the collider)
export function buildDrum(A, color, lid = true) {
  A.add('paint', lathe([[0, 0], [0.285, 0], [0.285, 0.28], [0.298, 0.3], [0.285, 0.32], [0.285, 0.58], [0.298, 0.6], [0.285, 0.62], [0.285, 0.87], [0.27, 0.88], [0.27, 0.86], [0, 0.86]], 14), { color, par: 1, shadow: true });
  if (lid) A.add('metal', cylUp(0.03, 0.03, 0.03, 6), { m: M(0.16, 0.86, 0.05), color: STEEL });
}

// The office in the bays' corner. (x0..x1, z0..z1) its inside, h its ceiling. The power switch is
// the caller's (props/powerSwitch.js); this is the desk, cabinet, chair, safe-keeping board, lamp.
export function buildOffice(A, x0, x1, z0, z1, h, rng) {
  const B = A.B;
  // desk against the east wall, a swivel chair pushed back, the lamp
  B.at(M(x1 - 0.42, 0, z0 + 2.75), () => {
    A.box('laminate', [-0.38, 0.72, -0.8], [0.38, 0.76, 0.8], rgb(0x4a3a2a), { shadow: true });
    for (const s of [-1, 1]) A.box('metal', [-0.36, 0, s * 0.78 - 0.02], [0.36, 0.72, s * 0.78 + 0.02], rgb(0x4a4e52), { par: 0.6 });
    A.box('metal', [-0.34, 0.2, 0.3], [0.36, 0.72, 0.78], rgb(0x4a4e52), { par: 0.6 });
    for (let i = 0; i < 3; i++) A.box('metal', [-0.36, 0.24 + i * 0.16, 0.34], [-0.345, 0.37 + i * 0.16, 0.74], rgb(0x5a5e62), { par: 0.4 });
    B.tag('garage:desk', () => B.collide([-0.38, 0, -0.8], [0.38, 0.76, 0.8], 'cloth'));
    A.detail(() => {
      A.add('paint', cylUp(0.07, 0.09, 0.02, 10), { m: M(0.18, 0.76, -0.55), color: DARK });
      A.add('metal', tube([[0.18, 0.78, -0.55], [0.2, 1.0, -0.55], [0.1, 1.16, -0.48], [-0.02, 1.12, -0.42]], 0.008, 5, 4), { color: STEEL });
      A.add('paint', lathe([[0.02, 0.08], [0.075, 0], [0.07, 0], [0.018, 0.07]], 10), { m: M(-0.03, 1.06, -0.4, 0.5, 0, 0.4), color: rgb(0x1f4a3a), par: 1 });
      A.add('glow', cylUp(0.025, 0.025, 0.03, 8), { m: M(-0.04, 1.06, -0.41), color: [0.4, 0.3, 0.2], glow: [22, 15, 8], power: true });
      for (let i = 0; i < 5; i++) A.box('paint', [-0.3 + rng.range(0, 0.3), 0.761 + i * 0.002, -0.3 + rng.range(-0.2, 0.3)], [-0.09 + rng.range(0, 0.3), 0.763 + i * 0.002, 0.0 + rng.range(-0.2, 0.3)], rgb(0xcfc8b4), { ry: rng.range(-0.5, 0.5) });
      A.box('paint', [-0.05, 0.76, 0.42], [0.2, 0.86, 0.66], rgb(0x23262a), { par: 1, bevel: 0.02 }); // a telephone
      A.add('paint', cylUp(0.04, 0.035, 0.1, 10), { m: M(-0.22, 0.76, 0.2), color: rgb(0xb9b6a8), par: 1 });
    });
  });
  B.at(M(x1 - 1.35, 0, z0 + 2.5, 0, 0.9, 0), () => {
    A.add('metal', cylUp(0.02, 0.02, 0.42, 6), { color: STEEL });
    for (let i = 0; i < 5; i++) A.box('metal', [0, 0.03, -0.015], [0.3, 0.06, 0.015], STEEL, { ry: (i * Math.PI * 2) / 5 });
    A.box('vinyl', [-0.24, 0.42, -0.24], [0.24, 0.5, 0.24], rgb(0x23261f), { bevel: 0.03 });
    A.box('vinyl', [-0.22, 0.56, -0.27], [0.22, 0.98, -0.21], rgb(0x23261f), { bevel: 0.03, rx: -0.1 });
  });
  // filing cabinet and a key cabinet on the south wall
  B.at(M(x0 + 0.5, 0, z1 - 0.34), () => {
    A.box('metal', [-0.24, 0, -0.3], [0.24, 1.32, 0.3], rgb(0x5a6258), { par: 0.5, shadow: true, bevel: 0.01 });
    for (let i = 0; i < 4; i++) { A.box('metal', [-0.22, 0.05 + i * 0.32, -0.315], [0.22, 0.34 + i * 0.32, -0.3], rgb(0x666e64), { par: 0.4 }); A.box('metal', [-0.06, 0.2 + i * 0.32, -0.33], [0.06, 0.22 + i * 0.32, -0.315], STEEL); }
    B.tag('garage:cabinet', () => B.collide([-0.24, 0, -0.3], [0.24, 1.32, 0.3], 'metal'));
  });
  A.detail(() => {
    // a coat on a hook, a waste bin, a fan heater, a floor mat inside the door
    A.box('curtain', [x0 + 1.6, 1.0, z1 - 0.1], [x0 + 2.0, 1.75, z1 - 0.03], rgb(0x2a3a2a), { bevel: 0.03 });
    A.add('paint', cylUp(0.13, 0.1, 0.3, 10), { m: M(x1 - 0.3, 0, z0 + 1.6), color: rgb(0x23262a), par: 1 });
    A.quad('carpet', [x0 + 0.1, 0.008, z0 + 2.6], [0.9, 0, 0], [0, 0, -1.4], rgb(0x2a1c14), { cell: 9 });
  });
}
