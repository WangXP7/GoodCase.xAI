// Small things that say people left in a hurry. Every builder draws at the current transform with
// its origin on the ground.
import { M, box, boxUp, cyl, cylUp, lathe, extrude, roundPoly, deform, sphere, tube, torus, rgb, quadUV } from '../build.js';

const DARK = rgb(0x15171a);
const BLACK = rgb(0x060607);
const ORANGE = rgb(0xe2500c);
const WHITE = rgb(0xd8d6cc);
const WOOD = [rgb(0x6b5236), rgb(0x7a6040), rgb(0x54412c)];

export function cone(B, tipped = false) {
  const body = lathe([[0.165, 0.03], [0.15, 0.05], [0.04, 0.68], [0.0, 0.7]], 12);
  const band = lathe([[0.118, 0.26], [0.085, 0.44]], 12);
  const m = tipped ? M(0, 0.17, 0, 0, 0, Math.PI / 2 - 0.12) : M();
  B.add('vcGloss', body, { m, color: ORANGE, shadow: true });
  B.add('vcGloss', deform(band, (v) => { v.x *= 1.03; v.z *= 1.03; }), { m, color: WHITE });
  B.add('vcGloss', boxUp(0.36, 0.035, 0.36, 0.012, 1), { m, color: ORANGE });
  if (!tipped) B.collide([-0.16, 0, -0.16], [0.16, 0.28, 0.16], 'cloth', 0.3);
}

// precast wheel stop
export function parkingStop(B) {
  const prof = roundPoly([[-0.1, 0, 0], [0.1, 0, 0], [0.07, 0.11, 0.03], [-0.07, 0.11, 0.03]], 3);
  B.add('concreteKerb', extrude(prof, 1.8, { bevel: 0.015, bevelSeg: 1 }).rotateY(Math.PI / 2), { shadow: false });
  B.collide([-0.9, 0, -0.1], [0.9, 0.11, 0.1], 'concrete', 0.3);
}

// drain grate set in the surface
export function drain(B, w = 0.6, d = 0.45) {
  B.add('vcMatte', box(w + 0.08, 0.012, d + 0.08), { m: M(0, 0.006, 0), color: rgb(0x2b2c2d) });
  B.add('vcMatte', box(w, 0.014, d), { m: M(0, 0.006, 0), color: BLACK });
  for (let i = 0; i < 7; i++) B.add('vcMatte', box(0.035, 0.018, d), { m: M(-w / 2 + (i + 0.5) * (w / 7), 0.008, 0), color: rgb(0x1e1f20) });
}

export function manhole(B) {
  B.add('vcMatte', cylUp(0.38, 0.38, 0.012, 20), { color: rgb(0x242526) });
  B.add('vcMatte', cylUp(0.3, 0.3, 0.016, 20), { color: rgb(0x1a1b1c) });
}

// concrete road barrier, profile extruded along x
export function barrier(B, len = 3) {
  const prof = roundPoly([[-0.3, 0, 0], [0.3, 0, 0], [0.3, 0.08, 0.02], [0.2, 0.26, 0.08], [0.09, 0.82, 0.02], [-0.09, 0.82, 0.02], [-0.2, 0.26, 0.08], [-0.3, 0.08, 0.02]], 3);
  B.add('concrete', extrude(prof, len, { bevel: 0.02, bevelSeg: 1 }).rotateY(Math.PI / 2), { shadow: true });
  B.blob(len + 0.5, 1.1);
  B.refl([-len / 2, 0, -0.2], [len / 2, 0.8, 0.2], rgb(0x8a877f, 0.5));
  B.collide([-len / 2, 0, -0.3], [len / 2, 0.82, 0.3], 'concrete', 0.5);
}

// striped road-closed trestle with a dead flasher
export function trestle(B, w = 2.2) {
  for (const s of [1, -1]) {
    for (const k of [1, -1]) B.add('vcGloss', box(0.05, 1.15, 0.05, 0.01, 1), { m: M(s * (w / 2 - 0.15), 0.52, k * 0.2, k * -0.34, 0, 0), color: DARK, shadow: true });
  }
  for (const y of [0.92, 0.55]) {
    const n = 8;
    for (let i = 0; i < n; i++) B.add('vcGloss', box(w / n, 0.2, 0.03, 0.004, 1), { m: M(-w / 2 + (i + 0.5) * (w / n), y, 0.02), color: i % 2 ? WHITE : ORANGE, shadow: i === 0 });
  }
  B.add('vcGloss', cylUp(0.09, 0.09, 0.06, 10).rotateX(Math.PI / 2), { m: M(w / 2 - 0.2, 1.2, 0.0), color: rgb(0x8a5a08) });
  B.collide([-w / 2, 0, -0.25], [w / 2, 1.1, 0.25], 'metal', 0.4);
}

export function drum(B, key = 'paintDrum', tipped = false) {
  const g = lathe([[0, 0], [0.29, 0], [0.295, 0.02], [0.285, 0.04], [0.285, 0.28], [0.298, 0.3], [0.285, 0.32], [0.285, 0.58], [0.298, 0.6], [0.285, 0.62], [0.285, 0.85], [0.295, 0.87], [0.29, 0.89], [0.27, 0.89], [0.27, 0.87], [0, 0.87]], 18);
  B.blob(1.0, 1.0);
  if (tipped) { B.add(key, g, { m: M(0, 0.295, 0, 0, 0, Math.PI / 2), shadow: true }); B.collide([-0.45, 0, -0.3], [0.45, 0.59, 0.3], 'metal', 0.3); }
  else { B.add(key, g, { shadow: true }); B.collide([-0.29, 0, -0.29], [0.29, 0.89, 0.29], 'metal', 0.3); }
}

export function tyreStack(B, n = 3, rng) {
  for (let i = 0; i < n; i++) {
    const t = lathe([[0.2, -0.1], [0.3, -0.1], [0.33, -0.06], [0.33, 0.06], [0.3, 0.1], [0.2, 0.1]], 16);
    B.add('rubber', t, { m: M(rng.range(-0.04, 0.04), 0.1 + i * 0.2, rng.range(-0.04, 0.04)), shadow: true });
  }
  B.collide([-0.33, 0, -0.33], [0.33, n * 0.2, 0.33], 'cloth', 0.3);
}

export function pallet(B, lean = 0) {
  const m = lean ? M(0, 0.02, 0, lean, 0, 0) : M();
  for (const z of [-0.45, 0, 0.45]) B.add('vcMatte', boxUp(1.2, 0.09, 0.09), { m: m.clone().multiply(M(0, 0, z)), color: WOOD[2] });
  for (let i = 0; i < 6; i++) B.add('vcMatte', boxUp(0.14, 0.022, 1.0), { m: m.clone().multiply(M(-0.53 + i * 0.212, 0.09, 0)), color: WOOD[i % 3], shadow: i % 2 === 0 });
  if (!lean) B.collide([-0.6, 0, -0.5], [0.6, 0.12, 0.5], 'cloth', 0.4);
}

export function dumpster(B, lidOpen = 0.5) {
  const prof = roundPoly([[-0.85, 0.12, 0.03], [0.85, 0.12, 0.03], [1.0, 1.15, 0.03], [-0.85, 1.3, 0.03]], 3);
  B.add('paintDumpster', extrude(prof, 1.9, { bevel: 0.03, bevelSeg: 2 }), { shadow: true });
  for (const z of [-0.7, 0.7]) for (const x of [-0.6, 0.6]) B.add('rubber', cyl(0.09, 0.09, 0.07, 10).rotateX(Math.PI / 2), { m: M(x, 0.09, z) });
  for (const z of [-0.98, 0.98]) B.add('paintDumpster', box(1.2, 0.1, 0.08, 0.02, 1), { m: M(0, 0.85, z) });
  B.add('vcGloss', box(1.95, 0.04, 0.96, 0.015, 1).translate(0.97, 0, 0), { m: M(-0.88, 1.31, -0.48, 0, 0, lidOpen), color: rgb(0x0e0f10), shadow: true });
  B.add('vcGloss', box(1.95, 0.04, 0.96, 0.015, 1).translate(0.97, 0, 0), { m: M(-0.88, 1.31, 0.48, 0, 0, -0.07), color: rgb(0x0e0f10), shadow: true });
  B.blob(2.7, 2.7);
  B.refl([-0.85, 0.1, -0.95], [0.9, 1.25, 0.95], rgb(0x1f4632, 0.6));
  B.collide([-0.9, 0, -0.97], [1.0, 1.3, 0.97], 'metal', 0.4);
}

// holdall dropped mid-stride, zip open, what was in it across the tarmac
export function duffel(B, rng) {
  const bag = deform(box(0.72, 0.3, 0.34, 0.12, 4), (v) => { v.y *= 1 - 0.25 * Math.abs(v.x); v.y += 0.03 * Math.sin(v.x * 9) * (v.y > 0 ? 1 : 0); });
  B.add('vcMatte', bag, { m: M(0, 0.15, 0), color: rgb(0x2b3a2c), shadow: true });
  B.add('vcMatte', box(0.5, 0.012, 0.05), { m: M(0, 0.292, 0), color: BLACK });
  B.add('vcMatte', tube([[-0.3, 0.2, 0.17], [-0.42, 0.06, 0.34], [-0.2, 0.02, 0.5], [0.15, 0.02, 0.46], [0.3, 0.2, 0.17]], 0.014, 5, 5), { color: rgb(0x14180f) });
  const tins = [0xc8281c, 0x2c8a43, 0xe8b023];
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, 6.28), r = rng.range(0.45, 1.3);
    B.add('vcGloss', cyl(0.037, 0.037, 0.11, 10).rotateZ(Math.PI / 2), { m: M(Math.cos(a) * r, 0.037, Math.sin(a) * r, 0, rng.range(0, 3), 0), color: rgb(tins[i % 3]) });
  }
  B.add('vcMatte', box(0.3, 0.012, 0.22), { m: M(0.55, 0.008, -0.35, 0, 0.5, 0), color: rgb(0xb9b4a4) });
  B.add('vcMatte', box(0.26, 0.09, 0.1, 0.04, 2), { m: M(-0.62, 0.045, 0.3, 0, 1.0, 0), color: rgb(0x2a2018) }); // a shoe
  B.collide([-0.36, 0, -0.17], [0.36, 0.3, 0.17], 'cloth', 0.3);
}

// suitcase burst open
export function suitcase(B) {
  B.add('vcGloss', boxUp(0.7, 0.13, 0.46, 0.03, 2), { color: rgb(0x3b1e22), shadow: true });
  B.add('vcGloss', boxUp(0.7, 0.13, 0.46, 0.03, 2).translate(0, 0, -0.23), { m: M(0, 0.13, -0.23, -1.9, 0, 0), color: rgb(0x3b1e22), shadow: true });
  B.add('vcMatte', box(0.56, 0.05, 0.34, 0.02, 1), { m: M(0.02, 0.15, 0), color: rgb(0x8f8a7a) });
  B.add('vcMatte', box(0.4, 0.012, 0.5), { m: M(0.5, 0.01, 0.3, 0, 0.8, 0), color: rgb(0x53565c) });
}

// litter: paper and flattened cartons scattered over a radius
export function litter(B, rng, n, radius) {
  const cols = [0xbdb8a8, 0x8f8a7a, 0x6d6a60, 0xb8a070, 0x9aa3a8];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, 6.28), r = radius * Math.sqrt(rng.next());
    const w = rng.range(0.08, 0.26), d = rng.range(0.06, 0.2);
    B.add('vcMatte', box(w, 0.006, d), { m: M(Math.cos(a) * r, 0.006, Math.sin(a) * r, rng.range(-0.04, 0.04), rng.range(0, 6.28), rng.range(-0.04, 0.04)), color: rgb(cols[rng.int(0, cols.length - 1)], rng.range(0.2, 0.55)) });
  }
}

// wire hand basket on its side, a few tins rolled out of it
export function shoppingBasket(B) {
  const red = rgb(0x7a1410);
  B.at(M(0, 0.16, 0, 0, 0, 1.35), () => {
    for (const y of [0, 0.1, 0.2]) for (const [w, d] of [[0.44, 0.3]]) {
      for (const z of [-d / 2, d / 2]) B.add('vcGloss', box(w, 0.012, 0.012), { m: M(0, y, z), color: red });
      for (const x of [-w / 2, w / 2]) B.add('vcGloss', box(0.012, 0.012, d), { m: M(x, y, 0), color: red });
    }
    for (let i = 0; i < 7; i++) for (const z of [-0.15, 0.15]) B.add('vcGloss', box(0.008, 0.2, 0.008), { m: M(-0.21 + i * 0.07, 0.1, z), color: red });
    B.add('vcGloss', box(0.44, 0.012, 0.3), { m: M(0, 0, 0), color: red, shadow: true });
    B.add('vcGloss', torus(0.14, 0.008, 4, 10, Math.PI), { m: M(0, 0.2, 0, 0, 0, 0), color: rgb(0x111111) });
  });
  for (const [x, z] of [[0.35, 0.2], [0.5, -0.1]]) B.add('vcGloss', cyl(0.037, 0.037, 0.11, 10).rotateZ(Math.PI / 2), { m: M(x, 0.037, z, 0, x * 5, 0), color: rgb(0x2c8a43) });
}

// supermarket trolley on its side: the basket is real wire (thin bars, a grid on every face, the
// heavier rim round the top), on a tube frame with castors, the child seat flap hanging open
export function trolley(B) {
  const WIRE = 'paintGalv';
  // a wire panel in the plane spanned by u (length a) and v (length b), centred on m
  const mesh = (a, b, m, pitchA = 0.055, pitchB = 0.11) => {
    const na = Math.round(a / pitchA), nb = Math.round(b / pitchB);
    for (let i = 0; i <= na; i++) B.add(WIRE, box(0.007, b, 0.007), { m: m.clone().multiply(M(-a / 2 + (a * i) / na, 0, 0)) });
    for (let i = 0; i <= nb; i++) B.add(WIRE, box(a, i === 0 || i === nb ? 0.012 : 0.007, i === 0 || i === nb ? 0.012 : 0.007), { m: m.clone().multiply(M(0, -b / 2 + (b * i) / nb, 0)) });
  };
  B.at(M(0, 0.3, 0, Math.PI / 2 - 0.08, 0, 0), () => {
    mesh(0.86, 0.5, M(0, 0.78, 0.27)); mesh(0.86, 0.5, M(0, 0.78, -0.27));
    mesh(0.54, 0.5, M(0.43, 0.78, 0, 0, Math.PI / 2, 0)); mesh(0.5, 0.42, M(-0.43, 0.8, 0, 0, Math.PI / 2, 0.12));
    mesh(0.86, 0.54, M(0, 0.53, 0, Math.PI / 2, 0, 0), 0.055, 0.09);
    mesh(0.4, 0.3, M(-0.6, 0.86, 0, 0, Math.PI / 2, 0.9), 0.05, 0.1); // the seat flap, fallen open
    for (const z of [-0.28, 0.28]) {
      B.add('chrome', tube([[-0.5, 1.08, z], [-0.44, 1.03, z], [0.44, 1.03, z], [0.44, 0.55, z], [0.3, 0.2, z], [-0.42, 0.14, z]], 0.012, 5, 3));
      for (const x of [-0.4, 0.34]) { B.add('rubber', cyl(0.05, 0.05, 0.03, 8).rotateX(Math.PI / 2), { m: M(x, 0.06, z) }); B.add('paintGalv', box(0.03, 0.1, 0.045), { m: M(x, 0.1, z) }); }
    }
    for (const x of [-0.42, 0.3]) B.add('chrome', cyl(0.01, 0.01, 0.56, 5).rotateX(Math.PI / 2), { m: M(x, 0.16, 0) });
    B.add('vcGloss', cyl(0.016, 0.016, 0.6, 6).rotateX(Math.PI / 2), { m: M(-0.5, 1.08, 0), color: rgb(0x7a1410) });
    B.add('vcGloss', box(0.1, 0.05, 0.02, 0.008, 1), { m: M(-0.5, 1.08, 0.12), color: rgb(0x0e8f88) }); // the coin lock
  });
  B.blob(1.3, 1.1);
  B.collide([-0.5, 0, -0.05], [0.5, 0.56, 0.95], 'metal', 0.3);
}

// What somebody dragged in front of a door they meant to hold: pallets on edge propped against
// each other, a trestle, cones, a drum. Local: runs along x, the door behind it (-z).
export function barricade(B, rng) {
  B.at(M(-1.5, 0, 0.1, 0, 0.12, 0), () => pallet(B, -1.32));
  B.at(M(-0.25, 0, -0.05, 0, -0.08, 0), () => pallet(B, -1.25));
  B.at(M(0.95, 0.0, 0.25, 0, 0.3, 0), () => pallet(B, -1.45));
  B.at(M(-0.6, 0, 0.75, 0, 0.5, 0), () => pallet(B));
  B.at(M(2.3, 0, 0.2, 0, -0.25, 0), () => trestle(B, 1.9));
  B.at(M(3.9, 0, 0.1), () => drum(B, 'paintDrum'));
  B.at(M(-2.2, 0, 1.0, 0, 1.1, 0), () => cone(B, true));
  B.at(M(1.6, 0, 1.1, 0, 0.4, 0), () => cone(B, false));
  B.at(M(3.4, 0, 0.8, 0, 2.0, 0), () => cone(B, true));
  // props to wedge it: a length of timber and a tyre
  B.add('vcMatte', box(2.4, 0.09, 0.09), { m: M(-0.2, 0.42, 0.55, 0, 0.15, 0.32), color: WOOD[1], shadow: true });
  B.at(M(0.6, 0, 1.0), () => tyreStack(B, 1, rng));
  B.collide([-2.1, 0, -0.25], [1.5, 1.05, 0.3], 'cloth', 0.5);
}

// road flare burning on the tarmac: the rod, a hot tip (its own bucket so it can gutter), spent ash
export function flare(B, lit = true) {
  B.add('vcGloss', cyl(0.014, 0.014, 0.24, 6).rotateZ(Math.PI / 2), { m: M(0, 0.016, 0), color: rgb(0x7a1a14) });
  if (lit) {
    B.add('flickE', sphere(0.035, 8, 6), { m: M(0.13, 0.03, 0) });
    B.fixtures.push({ kind: 'flare', pos: B.point(0.13, 0.12, 0) });
  } else B.add('vcMatte', box(0.06, 0.008, 0.04), { m: M(0.13, 0.006, 0), color: rgb(0x8a8a86) });
}

