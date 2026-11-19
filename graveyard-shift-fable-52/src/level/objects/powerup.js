// Power-ups: four floating things off the truck stop's own shelves, each with its own outline and
// its own colour of light, so a drop is known at a glance across the lot in the dark.
//   resupply    green   an ammunition tin with its handle up and a belt of rounds hung over the lid
//   oneTap      red     one big cartridge standing on its base inside a sighting ring with four ticks
//   doubleTime  blue    a timekeeper's stopwatch: lit dial, crown and bow, two pushers
//   flashover   orange  a road crew's smudge pot with a tall flame standing on it
// Each is a dark body picked out by lit trim, with a faint glow of its own colour on the body that
// is stronger on faces that look up (so the shape keeps its form as it turns), and a few hot lines
// that bloom. Geometry is in the object material; `ch` is the glow channel the whole drop pulses on.
import { M, box, cyl, cylUp, lathe, sphere, torus } from '../build.js';
import { createObj } from '../../mats/yard.js';

export const POWERUP_KINDS = ['resupply', 'oneTap', 'doubleTime', 'flashover'];
// chromaticity of each kind's light (the drop's lamp, its burst and its trim all use it)
export const POWERUP_COLOR = {
  resupply: [0.2, 1.0, 0.3],
  oneTap: [1.0, 0.07, 0.1],
  doubleTime: [0.04, 0.42, 1.0],
  flashover: [1.0, 0.5, 0.06],
};
const SIZE = 1.2; // against the authored half metre
const HOT = 3.5; // glow above this (any component) is trim: left as authored

const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function resupply(O, ch, C) {
  const olive = [0.075, 0.1, 0.05], dark = [0.03, 0.04, 0.025], brass = [0.5, 0.36, 0.12];
  const body = mul(C, 0.1);
  // the tin and its lid, a pressed rib round the middle
  O.add(box(0.46, 0.25, 0.2, 0.018), { m: M(0, -0.045, 0), color: olive, glow: body, ch });
  O.add(box(0.48, 0.05, 0.22, 0.012), { m: M(0, 0.1, 0), color: olive, glow: mul(C, 0.16), ch });
  O.add(box(0.468, 0.022, 0.208), { m: M(0, -0.045, 0), color: [0.3, 0.3, 0.2], glow: mul(C, 7), ch });
  // the lid's catch on one end, the hinge on the other
  O.add(box(0.02, 0.15, 0.07), { m: M(0.238, 0.03, 0), color: dark, glow: mul(C, 0.25), ch });
  O.add(box(0.03, 0.03, 0.09), { m: M(0.245, -0.045, 0), color: dark, glow: mul(C, 5), ch });
  O.add(cyl(0.012, 0.012, 0.2, 6).rotateX(Math.PI / 2), { m: M(-0.24, 0.085, 0), color: dark, glow: mul(C, 0.25), ch });
  // the handle, stood up
  O.add(torus(0.085, 0.013, 5, 12, Math.PI), { m: M(0, 0.125, 0, 0, 0, 0, 1.25, 0.85, 1), color: dark, glow: mul(C, 3), ch });
  // a belt of rounds over the lid and down one face
  for (let i = 0; i < 7; i++) {
    const over = i < 4, x = -0.17 + i * 0.058;
    const m = over ? M(x, 0.136, 0, Math.PI / 2, 0, 0) : M(x, 0.02, 0.112, 0.2, 0, 0);
    O.at(m, () => {
      O.add(cyl(0.019, 0.019, 0.15, 7), { color: brass, glow: [0.5, 0.33, 0.07], ch });
      O.add(cyl(0.004, 0.018, 0.05, 7), { m: M(0, 0.1, 0), color: [0.4, 0.2, 0.1], glow: mul(C, 4.5), ch });
    });
  }
}

function oneTap(O, ch, C) {
  const brass = [0.5, 0.34, 0.1], copper = [0.42, 0.16, 0.08], dark = [0.05, 0.02, 0.02];
  // the cartridge: rim, case, shoulder, neck, bullet
  const prof = [[0, -0.3], [0.088, -0.3], [0.088, -0.283], [0.076, -0.275], [0.082, -0.262], [0.08, 0.02], [0.05, 0.075], [0.05, 0.115]];
  O.add(lathe(prof, 14), { color: brass, glow: [0.45, 0.13, 0.03], ch });
  const tip = [[0.049, 0.115], [0.047, 0.17], [0.038, 0.235], [0.022, 0.29], [0.008, 0.318], [0, 0.322]];
  O.add(lathe(tip, 14), { color: copper, glow: mul(C, 8), ch });
  O.add(cyl(0.083, 0.083, 0.018, 14), { m: M(0, -0.18, 0), color: dark, glow: mul(C, 9), ch });
  // the sighting ring and its four ticks, across the turn axis so it opens and closes as it turns
  O.add(torus(0.27, 0.014, 5, 28), { color: dark, glow: mul(C, 7), ch });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    O.add(box(0.11, 0.022, 0.022), { m: M(Math.cos(a) * 0.235, Math.sin(a) * 0.235, 0, 0, 0, a), color: dark, glow: mul(C, 8), ch });
  }
  O.add(torus(0.27, 0.03, 5, 28), { m: M(0, 0, 0, 0, 0, 0, 1, 1, 0.55), color: dark, glow: mul(C, 0.5), ch });
}

function doubleTime(O, ch, C) {
  const steel = [0.2, 0.22, 0.25], dark = [0.02, 0.03, 0.04];
  const R = 0.215;
  // the case: a thick disc on edge, a raised bezel each side
  O.add(cyl(R, R, 0.085, 28).rotateX(Math.PI / 2), { color: steel, glow: mul(C, 0.35), ch });
  for (const s of [-1, 1]) {
    O.add(torus(R - 0.012, 0.016, 6, 28), { m: M(0, 0, s * 0.042), color: steel, glow: mul(C, 6), ch });
    // the dial, lit, with twelve marks and two hands at ten to two
    O.add(cyl(R - 0.026, R - 0.026, 0.004, 28).rotateX(Math.PI / 2), { m: M(0, 0, s * 0.044), color: [0.3, 0.34, 0.38], glow: [0.35, 1.25, 2.6], ch });
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, long = i % 3 === 0;
      O.add(box(long ? 0.04 : 0.022, long ? 0.014 : 0.008, 0.004), { m: M(Math.cos(a) * (R - 0.055), Math.sin(a) * (R - 0.055), s * 0.047, 0, 0, a), color: dark });
    }
    for (const [a, l, w] of [[2.2, 0.1, 0.02], [0.95, 0.15, 0.014]]) O.add(box(l, w, 0.005), { m: M(Math.cos(a) * l * 0.42, Math.sin(a) * l * 0.42, s * 0.049, 0, 0, a), color: dark });
    O.add(cyl(0.016, 0.016, 0.012, 8).rotateX(Math.PI / 2), { m: M(0, 0, s * 0.05), color: dark });
  }
  // crown, bow and the two pushers
  O.add(cylUp(0.026, 0.03, 0.06, 10), { m: M(0, R - 0.005, 0), color: steel, glow: mul(C, 1.2), ch });
  O.add(cylUp(0.04, 0.04, 0.03, 12), { m: M(0, R + 0.05, 0), color: steel, glow: mul(C, 5), ch });
  O.add(torus(0.062, 0.011, 5, 16), { m: M(0, R + 0.125, 0), color: steel, glow: mul(C, 6), ch });
  for (const s of [-1, 1]) O.add(cylUp(0.02, 0.02, 0.055, 8), { m: M(Math.sin(s * 0.62) * (R - 0.004), Math.cos(0.62) * (R - 0.004), 0, 0, 0, -s * 0.62), color: steel, glow: mul(C, 4.5), ch });
}

function flashover(O, ch, C) {
  const iron = [0.035, 0.03, 0.028];
  // the pot: a round oil burner on a foot, a collar, a carrying bail
  O.add(sphere(0.15, 14, 9), { m: M(0, -0.2, 0, 0, 0, 0, 1, 0.78, 1), color: iron, glow: mul(C, 0.45), ch });
  O.add(cyl(0.1, 0.12, 0.03, 12), { m: M(0, -0.318, 0), color: iron, glow: mul(C, 0.3), ch });
  O.add(cyl(0.062, 0.075, 0.07, 12), { m: M(0, -0.075, 0), color: iron, glow: mul(C, 1.5), ch });
  O.add(torus(0.064, 0.012, 5, 14).rotateX(Math.PI / 2), { m: M(0, -0.04, 0), color: iron, glow: mul(C, 9), ch });
  O.add(torus(0.152, 0.01, 5, 20).rotateX(Math.PI / 2), { m: M(0, -0.2, 0), color: iron, glow: mul(C, 5), ch });
  // the flame: three skins, hotter and paler toward the middle, and three loose tongues
  const flame = (r, h, lean) => lathe([[0, 0], [r * 0.62, h * 0.06], [r, h * 0.26], [r * 0.86, h * 0.48], [r * 0.5, h * 0.72], [r * 0.2, h * 0.9], [0, h]], 10).applyMatrix4(M(0, 0, 0, 0, 0, lean));
  O.add(flame(0.125, 0.47, 0.07), { m: M(0, -0.05, 0), color: [0.2, 0.05, 0.01], glow: [6, 1.3, 0.08], ch });
  O.add(flame(0.085, 0.36, -0.05), { m: M(0.004, -0.04, 0.004), color: [0.3, 0.14, 0.02], glow: [8.5, 3.4, 0.25], ch });
  O.add(flame(0.045, 0.22, 0.03), { m: M(0, -0.03, 0), color: [0.5, 0.4, 0.2], glow: [11, 7, 1.6], ch });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.4;
    O.add(flame(0.035, 0.15, 0), { m: M(Math.cos(a) * 0.085, 0.12 + i * 0.07, Math.sin(a) * 0.085, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3), color: [0.2, 0.06, 0.01], glow: [7, 1.9, 0.1], ch });
  }
}

const BUILD = { resupply, oneTap, doubleTime, flashover };

// One kind's geometry, centred on its own middle, about 0.7 m tall. ch: the glow channel.
export function powerupGeometry(kind, ch = 0) {
  const O = createObj();
  (BUILD[kind] || flashover)(O, ch, POWERUP_COLOR[kind] || POWERUP_COLOR.flashover);
  const g = O.geometry();
  g.scale(SIZE, SIZE, SIZE);
  // the body's own glow: full on faces that look up, a third on those that look down
  const n = g.getAttribute('normal'), gl = g.getAttribute('aGlow');
  for (let i = 0; i < gl.count; i++) {
    const r = gl.getX(i), gg = gl.getY(i), b = gl.getZ(i);
    if (r > HOT || gg > HOT || b > HOT) continue;
    const k = 0.34 + 0.66 * (n.getY(i) * 0.5 + 0.5);
    gl.setXYZ(i, r * k, gg * k, b * k);
  }
  return g;
}
