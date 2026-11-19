// The four roadside machines: Second Helping, Short Order, Long Haul, Jump Start. Each
// is a vending cabinet in its brand's colours with a lit header, a printed front, a coin column, a
// delivery hatch and its own shape on top (a plate and fork, a counter bell, a road shield, a
// battery), so they are told apart in the dark by silhouette. States: `dead` (no power: unlit),
// `live` (header, front and coin column lit, a faint hum of flicker), `bought` (dimmed, the green
// SERVED lamp on). The cabinet is static geometry in its zone's one object mesh; the light it throws
// is a pooled point light.
import { BoxGeometry, CylinderGeometry, TorusGeometry } from 'three';
import { M, rgb } from '../build.js';
import { BRANDS, channel, createObj } from '../../mats/yard.js';

const hex = (s, k = 1) => rgb(parseInt(s.slice(1), 16), k);
const DARK = rgb(0x0b0c0d), STEEL = rgb(0x8a8e92);
export const MACHINE = { w: 0.96, d: 0.8, h: 2.12 };

// geometry of one machine into O at its transform (front +z, origin on the floor); ch: { a, b }
export function machineGeometry(O, kind, ch) {
  const b = BRANDS[kind];
  const body = hex(b.bg, 0.55), ink = hex(b.ink, 0.6), hot = hex(b.hot, 0.6);
  O.box([-0.44, 0, -0.36], [0.44, 0.08, 0.36], DARK);
  O.box([-0.46, 0.08, -0.38], [0.46, 1.86, 0.38], body, { bevel: 0.03 });
  // header light box
  O.box([-0.48, 1.86, -0.34], [0.48, 2.12, 0.4], ink, { bevel: 0.02 });
  O.quad([-0.45, 1.885, 0.402], [0.9, 0, 0], [0, 0.21, 0], { tex: `head:${kind}`, color: [0.5, 0.5, 0.5], glow: [3.2, 3.2, 3.2], ch: ch.a });
  // the printed front, lit from behind
  O.box([-0.43, 0.48, 0.38], [0.23, 1.8, 0.392], DARK);
  O.quad([-0.41, 0.5, 0.394], [0.62, 0, 0], [0, 1.085, 0], { tex: `brand:${kind}`, color: [0.55, 0.55, 0.55], glow: [1.5, 1.5, 1.5], ch: ch.a });
  O.quad([-0.41, 1.6, 0.394], [0.62, 0, 0], [0, 0.18, 0], { color: ink });
  // coin column: display, four buttons, slot, the SERVED lamp
  O.box([0.25, 0.48, 0.38], [0.43, 1.8, 0.394], rgb(0x1a1c1e));
  O.quad([0.27, 1.56, 0.396], [0.14, 0, 0], [0, 0.07, 0], { color: [0.05, 0.05, 0.05], glow: [2.6, 1.5, 0.3], ch: ch.a });
  for (let i = 0; i < 4; i++) O.quad([0.285, 1.36 - i * 0.1, 0.396], [0.11, 0, 0], [0, 0.07, 0], { color: hot, glow: [hot[0] * 2.4, hot[1] * 2.4, hot[2] * 2.4], ch: ch.a });
  O.box([0.31, 0.9, 0.394], [0.37, 0.915, 0.4], STEEL);
  O.box([0.29, 0.86, 0.394], [0.39, 0.96, 0.397], rgb(0x2a2c2e));
  O.quad([0.262, 1.66, 0.396], [0.156, 0, 0], [0, 0.0624, 0], { tex: 'sold', color: [0.12, 0.12, 0.12], glow: [0.6, 3.4, 1.0], ch: ch.b });
  // delivery hatch
  O.box([-0.36, 0.14, 0.38], [0.36, 0.42, 0.39], rgb(0x050505));
  O.box([-0.34, 0.16, 0.39], [0.34, 0.4, 0.398], rgb(0x3a3d40), { rx: -0.12 });
  // side stripes, a vent, the cable
  for (const s of [-1, 1]) {
    O.quad([s * 0.462, 1.2, s > 0 ? 0.3 : -0.3], [0, 0, s > 0 ? -0.6 : 0.6], [0, 0.22, 0], { color: hot });
    O.quad([s * 0.462, 1.46, s > 0 ? 0.3 : -0.3], [0, 0, s > 0 ? -0.6 : 0.6], [0, 0.06, 0], { color: ink });
    for (let i = 0; i < 5; i++) O.quad([s * 0.462, 0.2 + i * 0.05, s > 0 ? 0.25 : -0.25], [0, 0, s > 0 ? -0.5 : 0.5], [0, 0.02, 0], { color: DARK });
  }
  // the brand's shape on top
  if (b.mark === 'plate') {
    O.add(new CylinderGeometry(0.3, 0.3, 0.04, 20).rotateX(Math.PI / 2), { m: M(0, 2.44, 0), color: hex(b.bg, 0.6) });
    O.add(new TorusGeometry(0.3, 0.025, 6, 20), { m: M(0, 2.44, 0), color: ink });
    O.add(new CylinderGeometry(0.2, 0.2, 0.05, 16).rotateX(Math.PI / 2), { m: M(0, 2.44, 0), color: hot, glow: [hot[0] * 1.2, hot[1] * 1.2, hot[2] * 1.2], ch: ch.a });
    O.box([0.36, 2.14, -0.02], [0.4, 2.7, 0.02], STEEL); for (let i = -1; i <= 1; i++) O.box([0.37 + i * 0.035, 2.62, -0.015], [0.39 + i * 0.035, 2.8, 0.015], STEEL);
  } else if (b.mark === 'bell') {
    O.add(new CylinderGeometry(0.02, 0.26, 0.2, 16), { m: M(0, 2.28, 0), color: hot, glow: [hot[0] * 0.9, hot[1] * 0.9, hot[2] * 0.9], ch: ch.a });
    O.add(new CylinderGeometry(0.3, 0.3, 0.05, 16), { m: M(0, 2.145, 0), color: ink });
    O.add(new CylinderGeometry(0.035, 0.035, 0.07, 8), { m: M(0, 2.41, 0), color: STEEL });
  } else if (b.mark === 'road') {
    O.box([-0.02, 2.12, -0.02], [0.02, 2.3, 0.02], STEEL);
    O.box([-0.26, 2.3, -0.025], [0.26, 2.74, 0.025], ink, { bevel: 0.02 });
    O.quad([-0.22, 2.34, 0.027], [0.44, 0, 0], [0, 0.36, 0], { color: hex(b.bg, 0.6) });
    for (let i = 0; i < 3; i++) O.quad([-0.03, 2.37 + i * 0.11, 0.029], [0.06, 0, 0], [0, 0.07, 0], { color: hex(b.hot, 0.8), glow: [2.4, 2.2, 1.6], ch: ch.a });
  } else {
    O.box([-0.3, 2.12, -0.16], [0.3, 2.46, 0.16], hex(b.ink, 1), { bevel: 0.02 });
    O.box([-0.31, 2.36, -0.165], [0.31, 2.4, 0.165], hex(b.bg, 0.7));
    for (const s of [-1, 1]) O.add(new CylinderGeometry(0.045, 0.045, 0.1, 10), { m: M(s * 0.17, 2.5, 0), color: s > 0 ? hex(b.hot, 0.7) : STEEL, glow: s > 0 ? [2.4, 0.4, 0.2] : [0.5, 0.5, 0.5], ch: ch.a });
  }
}

// place a machine: static geometry and collider now, the live object when the level installs.
// spot: { id, zone, pos }; yaw: which way its front faces (front is local +z)
export function placeMachine(ctx, spot, yaw) {
  const B = ctx.B, kind = spot.id;
  const ch = { a: channel(), b: channel() };
  const m = M(spot.pos[0], spot.pos[1], spot.pos[2], 0, yaw, 0);
  ctx.stat(spot.zone).at(m, () => machineGeometry(ctx.stat(spot.zone), kind, ch));
  B.inZone(spot.zone, () => B.at(m, () => {
    B.tag(`machine:${kind}`, () => B.collide([-0.48, 0, -0.4], [0.48, MACHINE.h, 0.4], 'metal'));
    B.blob(1.3, 1.2);
  }));
  const hot = hex(BRANDS[kind].hot === '#f4efe0' ? BRANDS[kind].ink : BRANDS[kind].hot);
  const lp = [spot.pos[0] + Math.sin(yaw) * 0.9, spot.pos[1] + 1.4, spot.pos[2] + Math.cos(yaw) * 0.9];
  ctx.reg({
    id: spot.id, zone: spot.zone,
    make(G, mats) {
      const gain = mats.gain;
      let state = 'dead', light = null, seed = spot.pos[0] * 1.7;
      if (G.lights && typeof G.lights.add === 'function') light = G.lights.add({ type: 'point', pos: lp, color: [0.35 + hot[0], 0.35 + hot[1], 0.35 + hot[2]], lumens: 900, range: 7, priority: 0.7, flicker: 0.04 });
      const obj = {
        kind: 'machine', get state() { return state; },
        setState(s) { if (s === 'dead' || s === 'live' || s === 'bought') state = s; },
        reset() { state = G.level && G.level.power && G.level.power.on ? 'live' : 'dead'; },
        update(dt, t, visible) {
          const a = state === 'live' ? 0.92 + 0.08 * Math.sin(t * 37 + seed) * Math.sin(t * 5.3 + seed) : state === 'bought' ? 0.22 : 0;
          gain[ch.a] = a; gain[ch.b] = state === 'bought' ? 1 : 0;
          if (light) { const on = visible && state !== 'dead'; if (light.enabled !== on) light.set({ enabled: on }); }
        },
      };
      if (G.level && G.level.power && G.level.power.on) state = 'live';
      return obj;
    },
  });
}

// A machine on its own (the standard builder signature): { geometry, channels, setState, update } for a mesh
// with the object material; gains are written into `gain` (createYardMats(G).gain).
export function buildMachine(kind, gain) {
  const ch = { a: channel(), b: channel() };
  const O = createObj();
  machineGeometry(O, kind, ch);
  let state = 'dead';
  return { geometry: O.geometry(), channels: ch, get state() { return state; }, setState(s) { state = s; }, update() { if (gain) { gain[ch.a] = state === 'live' ? 1 : state === 'bought' ? 0.22 : 0; gain[ch.b] = state === 'bought' ? 1 : 0; } } };
}
void BoxGeometry;
