// The upgrade station: the garage's rework rig. A steel welding table under a gantry; on its
// left end an old arc welder set (finned case, two gauges, a current wheel, heavy leads); in the
// middle a jig holding a stripped receiver inside the turns of an induction coil, with the welder's
// torch hung over it from an arm; on the right the grinder; over it all a hooded work lamp and the
// REWORK board.
//   dead      no power: nothing lit, cold iron
//   ready     the board and the lamp are on, the gauges glow, the coil breathes a dull orange round
//             the receiver and throws that colour on the table and the floor
//   working   an upgrade: for under a second an arc cracks between torch and receiver, the coil
//             goes white, sparks pour off the jig and the grinder, the stack light's amber flashes;
//             then the coil cools back to ready
// The solid parts are static art in the garage's mesh; everything that lights up is in the object
// mesh on glow channels, and the light it throws is one pooled point light.
import { box, cyl, cylUp, M, rgb, torus, tube } from '../build.js';
import { channel } from '../../mats/yard.js';

const STEEL = rgb(0x8a8e92), DARK = rgb(0x0e0e0f), IRON = rgb(0x2c2f33), CASE = rgb(0x7a2a12), FRAME = rgb(0x26302c), COPPER = rgb(0x9a5a2a);
const WORK = 0.8; // seconds of arc and sparks: as long as the weapon takes to change in the hands
const COOL = 1.6; // seconds for the coil to fall back to its ready glow afterwards
export const BENCH = { coil: [0.12, 1.085, 0.02], torch: [0.12, 1.24, 0.02], wheel: [0.86, 1.05, -0.05] };

// A: the garage art, at the bench's transform (long axis x, the working side +z)
export function buildBenchArt(A, rng) {
  const B = A.B;
  // the table: a steel slab on square legs, a shelf, a drawer under the front edge
  A.box('metal', [-1.0, 0.84, -0.4], [1.0, 0.92, 0.4], rgb(0x3c4044), { par: 0.5, shadow: true, bevel: 0.012 });
  for (const sx of [-0.92, 0.92]) for (const sz of [-0.33, 0.33]) A.box('metal', [sx - 0.04, 0, sz - 0.04], [sx + 0.04, 0.84, sz + 0.04], FRAME, { par: 0.6 });
  A.box('metal', [-0.95, 0.18, -0.36], [0.95, 0.21, 0.36], FRAME, { par: 0.7 });
  A.box('metal', [-0.95, 0.74, -0.37], [0.95, 0.84, 0.37], FRAME, { par: 0.5 });
  A.box('metal', [-0.3, 0.56, 0.3], [0.5, 0.74, 0.375], rgb(0x33443e), { par: 0.5 });
  A.box('metal', [0.0, 0.64, 0.375], [0.2, 0.66, 0.395], STEEL);
  for (const x of [-0.96, 0.96]) A.box('paint', [x - 0.045, 0.02, -0.41], [x + 0.045, 0.1, 0.41], rgb(0xb8860f), { par: 1 });
  // the gantry: two posts off the back edge, a beam, a diagonal brace each side
  for (const x of [-0.94, 0.94]) {
    A.box('metal', [x - 0.03, 0.92, -0.39], [x + 0.03, 1.98, -0.33], FRAME, { par: 0.8 });
    A.box('metal', [x - 0.02, 1.5, -0.38], [x + 0.02, 1.54, -0.02], FRAME, { par: 0.8, rx: 0.9 });
  }
  A.box('metal', [-0.98, 1.92, -0.4], [0.98, 1.99, -0.3], FRAME, { par: 0.8 });
  // the welder set, left: a finned case on rubber feet, a top handle, the current wheel, two lugs
  B.at(M(-0.66, 0.92, -0.1), () => {
    for (const sx of [-0.2, 0.2]) for (const sz of [-0.18, 0.18]) A.add('paint', cylUp(0.025, 0.025, 0.02, 8), { m: M(sx, 0, sz), color: DARK, par: 0 });
    A.box('paint', [-0.25, 0.02, -0.23], [0.25, 0.6, 0.23], CASE, { par: 1.2, bevel: 0.02, shadow: true });
    for (let i = 0; i < 7; i++) A.box('metal', [-0.21, 0.07 + i * 0.045, 0.228], [0.02, 0.09 + i * 0.045, 0.244], DARK, { par: 0.3 });
    for (let i = 0; i < 9; i++) A.box('metal', [-0.256, 0.08, -0.19 + i * 0.047], [-0.248, 0.52, -0.165 + i * 0.047], DARK, { par: 0.3 });
    A.box('metal', [0.05, 0.3, 0.228], [0.23, 0.56, 0.24], rgb(0x1a1c1e), { par: 0.3 });
    A.add('metal', cyl(0.055, 0.06, 0.03, 14).rotateX(Math.PI / 2), { m: M(0.14, 0.16, 0.245), color: DARK, par: 0.2 });
    A.box('metal', [0.132, 0.16, 0.26], [0.148, 0.215, 0.268], STEEL);
    for (const x of [0.07, 0.21]) A.add('metal', cyl(0.018, 0.018, 0.04, 8).rotateX(Math.PI / 2), { m: M(x, 0.06, 0.25), color: COPPER, par: 0.4 });
    for (const x of [-0.16, 0.16]) A.box('metal', [x - 0.012, 0.6, -0.012], [x + 0.012, 0.68, 0.012], STEEL);
    A.add('metal', cyl(0.014, 0.014, 0.36, 6).rotateZ(Math.PI / 2), { m: M(0, 0.68, 0), color: STEEL });
  });
  // its two leads: one up to the torch arm, one along the table to the jig's clamp
  A.add('paint', tube([[-0.59, 0.98, 0.16], [-0.5, 0.95, 0.3], [-0.3, 1.25, 0.2], [-0.1, 1.66, 0.0], [0.04, 1.775, -0.12], [0.1, 1.77, -0.02]], 0.014, 6, 5), { color: DARK, par: 0 });
  A.add('paint', tube([[-0.45, 0.98, 0.16], [-0.36, 0.94, 0.28], [-0.2, 0.935, 0.26], [-0.14, 0.94, 0.12]], 0.014, 6, 5), { color: DARK, par: 0 });
  // the torch arm: a hanger off the beam, a boom out over the table, the torch hung from its end
  const tx = BENCH.torch[0];
  A.box('metal', [tx - 0.02, 1.72, -0.35], [tx + 0.02, 1.92, -0.31], STEEL, { par: 0.4 });
  A.box('metal', [tx - 0.018, 1.72, -0.35], [tx + 0.018, 1.756, 0.05], STEEL, { par: 0.4 });
  A.add('metal', cyl(0.028, 0.028, 0.05, 8).rotateZ(Math.PI / 2), { m: M(tx, 1.738, 0.02), color: DARK, par: 0.3 });
  A.add('metal', cylUp(0.011, 0.011, 0.3, 6), { m: M(tx, 1.44, 0.02), color: STEEL, par: 0.4 });
  A.add('paint', cylUp(0.03, 0.026, 0.16, 10), { m: M(tx, 1.3, 0.02), color: DARK, par: 0 });
  A.add('metal', cylUp(0.008, 0.017, 0.065, 8), { m: M(tx, BENCH.torch[1], 0.02), color: COPPER, par: 0.3 });
  // the stack light on the right-hand post
  A.add('metal', cylUp(0.012, 0.012, 0.1, 6), { m: M(0.94, 1.99, -0.36), color: STEEL });
  // the jig: a ground plate, two vee blocks, a clamp; a stripped receiver and barrel lying in them
  A.box('metal', [-0.2, 0.92, -0.16], [0.46, 0.945, 0.2], IRON, { par: 0.6, bevel: 0.006 });
  for (const x of [-0.12, 0.38]) {
    A.box('metal', [x - 0.025, 0.945, -0.05], [x + 0.025, 1.04, 0.09], rgb(0x1f3f6a), { par: 0.5 });
    A.box('metal', [x - 0.027, 1.035, -0.02], [x + 0.027, 1.05, 0.06], STEEL);
  }
  A.box('metal', [-0.17, 0.945, 0.09], [-0.1, 1.0, 0.13], COPPER, { par: 0.4 });
  A.box('metal', [-0.16, 1.05, -0.012], [0.2, 1.12, 0.052], rgb(0x1c1e22), { par: 0.2, bevel: 0.008 });
  A.add('metal', cyl(0.014, 0.014, 0.42, 8).rotateZ(Math.PI / 2), { m: M(0.3, 1.09, 0.02), color: rgb(0x1c1e22), par: 0.2 });
  A.box('metal', [-0.12, 0.99, 0.004], [-0.07, 1.05, 0.036], rgb(0x1c1e22), { par: 0.2, rz: 0.25 });
  // the grinder, right: motor, two wheels with guards, a rest
  B.at(M(0.72, 0.92, -0.05), () => {
    A.box('metal', [-0.1, 0, -0.09], [0.1, 0.03, 0.09], DARK);
    A.add('paint', cyl(0.085, 0.085, 0.2, 12).rotateZ(Math.PI / 2), { m: M(0, 0.13, 0), color: rgb(0x23322c), par: 1 });
    for (const s of [-1, 1]) {
      A.add('metal', cyl(0.09, 0.09, 0.03, 14).rotateZ(Math.PI / 2), { m: M(s * 0.14, 0.13, 0), color: rgb(0x6a6660), par: 1.2 });
      A.add('paint', torus(0.095, 0.02, 5, 12, Math.PI * 1.3).rotateY(Math.PI / 2), { m: M(s * 0.14, 0.13, 0, 0.9, 0, 0), color: rgb(0x23322c), par: 1 });
      A.box('metal', [s * 0.14 - 0.03, 0.09, 0.08], [s * 0.14 + 0.03, 0.1, 0.13], STEEL);
    }
  });
  // what is lying about: a rag, punches, a tin of oil, a parts tray, crates on the shelf
  A.detail(() => {
    A.box('curtain', [-0.25, 0.92, 0.2], [0.1, 0.932, 0.38], rgb(0x6a2a20), { ry: 0.15 });
    for (let i = 0; i < 4; i++) A.add('metal', cyl(0.006, 0.006, 0.12, 5).rotateX(Math.PI / 2), { m: M(0.52 + i * 0.03, 0.927, 0.26 + rng.range(-0.02, 0.02), 0, rng.range(-0.3, 0.3), 0), color: STEEL });
    A.add('paint', cylUp(0.035, 0.035, 0.11, 10), { m: M(0.5, 0.92, -0.28), color: rgb(0xb8860f), par: 1 });
    A.box('metal', [0.52, 0.92, 0.1], [0.8, 0.95, 0.22], rgb(0x4a4e52), { par: 0.4 });
    for (let i = 0; i < 6; i++) A.add('metal', cylUp(0.012, 0.012, 0.02, 6), { m: M(0.55 + rng.range(0, 0.2), 0.95, 0.12 + rng.range(0, 0.08)), color: rgb(0xb89a48) });
    for (let i = 0; i < 3; i++) A.box('wood', [-0.6 + i * 0.5, 0.21, -0.25], [-0.25 + i * 0.5, 0.42, 0.2], rgb([0x6b5236, 0x4a4e52, 0x54412c][i]), { par: 0 });
  });
  // the work lamp: a long hooded tube under the beam
  A.box('paint', [-0.86, 1.86, -0.44], [0.86, 1.92, -0.18], rgb(0x23322c), { par: 1 });
  A.add('glow', cyl(0.018, 0.018, 1.5, 6).rotateZ(Math.PI / 2), { m: M(0, 1.845, -0.3), color: [0.4, 0.36, 0.3], glow: [26, 21, 13], power: true });
  B.tag('bench', () => B.collide([-1.0, 0, -0.4], [1.0, 0.92, 0.4], 'cloth'));
}

// the board and everything that glows, in the object mesh; the live object
export function placeBench(ctx, spot, yaw, power) {
  const O = ctx.stat(spot.zone), heat = channel(), busy = channel();
  const [cx, cy, cz] = BENCH.coil;
  O.at(M(spot.pos[0], 0, spot.pos[2], 0, yaw, 0), () => {
    O.box([-0.62, 1.99, -0.42], [0.62, 2.41, -0.39], rgb(0x101412));
    O.quad([-0.6, 2.01, -0.388], [1.2, 0, 0], [0, 0.375, 0], { tex: 'upgrade', color: [0.5, 0.5, 0.5], glow: [1.6, 1.6, 1.6], ch: power });
    // the welder's two gauges and its pilot lamp
    for (const x of [-0.565, -0.475]) O.add(cyl(0.036, 0.036, 0.008, 14).rotateX(Math.PI / 2), { m: M(x, 1.4, 0.146), color: [0.3, 0.28, 0.2], glow: [2.2, 1.7, 0.7], ch: power });
    for (const x of [-0.565, -0.475]) O.quad([x - 0.003, 1.4, 0.151], [0.006, 0, 0], [0.012, 0.03, 0], { color: [0.01, 0.01, 0.01] });
    O.add(cylUp(0.012, 0.012, 0.012, 8), { m: M(-0.84, 1.54, 0), color: [0.05, 0.2, 0.05], glow: [0.6, 7, 1.2], ch: power });
    // the induction coil: six turns round the receiver, and the glow it puts on the plate under it
    for (let i = 0; i < 6; i++) O.add(torus(0.085, 0.011, 5, 14).rotateY(Math.PI / 2), { m: M(cx - 0.15 + i * 0.06, cy, cz), color: [0.3, 0.14, 0.06], glow: [5.2, 1.5, 0.22], ch: heat });
    for (const s of [-1, 1]) O.add(cyl(0.009, 0.009, 0.16, 6), { m: M(cx + s * 0.18, cy - 0.08, cz - 0.07, 0.5, 0, 0), color: [0.3, 0.14, 0.06], glow: [3, 0.8, 0.1], ch: heat });
    O.quad([cx - 0.26, 0.9465, cz + 0.16], [0.52, 0, 0], [0, 0, -0.32], { color: [0.02, 0.015, 0.01], glow: [0.9, 0.24, 0.03], ch: heat });
    // the stack light: green while it stands ready, amber over it while it works
    O.add(cylUp(0.034, 0.034, 0.07, 10), { m: M(0.94, 2.09, -0.36), color: [0.04, 0.16, 0.05], glow: [0.5, 7.5, 1.4], ch: power });
    O.add(cylUp(0.034, 0.034, 0.07, 10), { m: M(0.94, 2.165, -0.36), color: [0.2, 0.12, 0.02], glow: [14, 7, 0.8], ch: busy });
    O.add(cylUp(0.038, 0.038, 0.012, 10), { m: M(0.94, 2.235, -0.36), color: [0.02, 0.02, 0.02] });
  });
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const world = (p) => [spot.pos[0] + p[0] * c + p[2] * s, p[1], spot.pos[2] - p[0] * s + p[2] * c];
  const coilAt = world([cx, cy + 0.25, cz + 0.25]), jigAt = world([cx, cy + 0.05, cz]), wheelAt = world(BENCH.wheel), tipAt = world(BENCH.torch);
  // the working side and the table's long axis, in the world (which way sparks are thrown)
  const out = [s, 0, c], along = [c, 0, -s];
  ctx.reg({
    id: spot.id || 'bench', zone: spot.zone,
    make(G, mats) {
      const gain = mats.gain;
      let since = 1e9, state = 'dead', lamp = '', owed = 0;
      let light = null;
      if (G.lights && typeof G.lights.add === 'function') { light = G.lights.add({ type: 'point', pos: coilAt, color: [1, 0.42, 0.12], lumens: 0, range: 6, priority: 0.65 }); light.set({ enabled: false }); }
      const LAMP = { ready: { color: [1, 0.42, 0.12], lumens: 520, range: 6, enabled: true }, working: { color: [0.75, 0.85, 1], lumens: 9000, range: 11, enabled: true }, cooling: { color: [1, 0.6, 0.3], lumens: 1500, range: 7, enabled: true }, dead: { enabled: false } };
      const setLamp = (k) => { if (k === lamp || !light) return; lamp = k; light.set(LAMP[k]); };
      const d = { kind: 'spark', pos: [0, 0, 0], vel: [0, 0, 0], life: 0, size: [0, 0], color: [1, 0.9, 0.7, 1], drag: 2.2, gravity: 1, floorY: 0, emissive: 0, cell: 'streak', stretch: 0.02 };
      let n = 0;
      // k sparks from p, thrown mostly toward `dir` and up, fanned by a fixed pattern
      const throwSparks = (p, k, dir, speed) => {
        const fx = G.fx;
        if (!fx || typeof fx.emit !== 'function') return;
        for (let i = 0; i < k; i++, n++) {
          const a = n * 2.39996, r = 0.35 + ((n * 7) % 10) * 0.065, sp = speed * (0.5 + ((n * 13) % 8) * 0.1);
          d.pos[0] = p[0]; d.pos[1] = p[1]; d.pos[2] = p[2];
          d.vel[0] = (dir[0] + Math.cos(a) * r * along[0] + Math.sin(a) * r * 0.5 * out[0]) * sp;
          d.vel[1] = (0.55 + Math.sin(a) * r * 0.9) * sp;
          d.vel[2] = (dir[2] + Math.cos(a) * r * along[2] + Math.sin(a) * r * 0.5 * out[2]) * sp;
          d.life = 0.35 + ((n * 5) % 7) * 0.09; d.size[0] = 0.007 + (n % 3) * 0.002; d.size[1] = 0.004; d.emissive = 20 + (n % 5) * 5;
          fx.emit(d);
        }
      };
      // the arc: two jagged strokes from the torch's tip down to the receiver and a glare where it lands,
      // drawn afresh every frame it burns
      const b = { kind: 'bolt', pos: [0, 0, 0], vel: [0, 0, 0], life: 0.05, size: 0.02, color: [0.62, 0.78, 1, 1], emissive: 60, cell: 'streak' };
      const gl = { kind: 'glint', pos: [0, 0, 0], vel: [0, 0, 0], life: 0.06, size: [0.3, 0.5], color: [0.7, 0.82, 1, 1], emissive: 26 };
      const strike = (t) => {
        const fx = G.fx;
        if (!fx || typeof fx.emit !== 'function') return;
        const kx = 0.03 * Math.sin(t * 211), kz = 0.03 * Math.sin(t * 157 + 1), my = (tipAt[1] + jigAt[1]) / 2;
        b.pos[0] = tipAt[0]; b.pos[1] = tipAt[1]; b.pos[2] = tipAt[2];
        b.vel[0] = kx; b.vel[1] = my - tipAt[1]; b.vel[2] = kz;
        fx.emit(b);
        b.pos[0] = tipAt[0] + kx; b.pos[1] = my; b.pos[2] = tipAt[2] + kz;
        b.vel[0] = -kx; b.vel[1] = jigAt[1] - 0.015 - my; b.vel[2] = -kz;
        fx.emit(b);
        gl.pos[0] = jigAt[0]; gl.pos[1] = jigAt[1]; gl.pos[2] = jigAt[2];
        fx.emit(gl);
      };
      const start = () => { since = 0; owed = 0; throwSparks(jigAt, 26, out, 3.2); throwSparks(wheelAt, 14, along, 3.6); };
      if (G.events) G.events.on('bench:upgrade', start);
      return {
        kind: 'bench',
        get state() { return state; },
        setState(s) { if (s === 'working') start(); },
        reset() { since = 1e9; },
        update(dt, t) {
          since += dt;
          const on = !!(G.level && G.level.power && G.level.power.on);
          const working = since < WORK, cooling = !working && since < WORK + COOL;
          state = working ? 'working' : on ? 'ready' : 'dead';
          if (working) {
            // the arc gutters like a struck rod; sparks keep coming off the jig and the wheel while it burns
            if (Math.sin(t * 173) * Math.sin(t * 97) > -0.35) strike(t);
            gain[heat] = 2.2 + 2.2 * Math.min(1, since / 0.15);
            gain[busy] = Math.sin(t * 40) > 0 ? 1 : 0.2;
            owed += dt * 60;
            if (owed >= 1) { const m = Math.floor(owed); owed -= m; throwSparks(jigAt, m - (m >> 2), out, 2.6); throwSparks(wheelAt, m >> 2, along, 3.4); }
          } else {
            gain[busy] = 0;
            const hot = cooling ? 1 - (since - WORK) / COOL : 0;
            gain[heat] = hot * hot * 3.6 + (on ? 0.42 + 0.14 * Math.sin(t * 1.6) : 0);
          }
          setLamp(working ? 'working' : cooling ? 'cooling' : on ? 'ready' : 'dead');
        },
      };
    },
  });
}
void box;
