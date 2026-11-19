// The power switch: a big knife switch in an open steel enclosure on the office wall.
// The enclosure, its conduit, the DANGER plate and the pilot lamps are static; the blade and its
// handle are one small mesh that is thrown up through an eighth of a second when the power comes
// on, with a burst of arcing at the jaws (slivers of glow on their own channel and a short blue
// light). Red pilot without power, green with.
import { CylinderGeometry, Group, Mesh } from 'three';
import { M, rgb } from '../build.js';
import { channel, createObj } from '../../mats/yard.js';

const STEEL = rgb(0x8a8e92), COPPER = rgb(0xb8703a), DARK = rgb(0x0e0f10);

// pos: on the wall's face; n: unit [x, z] out of the wall. power / noPower: channels
export function placePowerSwitch(ctx, zone, pos, n, power, noPower) {
  const O = ctx.stat(zone), arc = channel();
  const yaw = Math.atan2(n[0], n[1]);
  const m = M(pos[0] + n[0] * 0.004, pos[1], pos[2] + n[1] * 0.004, 0, yaw, 0);
  O.at(m, () => {
    // backboard, enclosure (a tray with side walls), conduit up the wall and a junction box
    O.box([-0.42, -0.62, 0], [0.42, 0.62, 0.02], rgb(0x3a3024));
    O.box([-0.26, -0.44, 0.02], [0.26, 0.44, 0.05], rgb(0x4a5258));
    for (const s of [-1, 1]) { O.box([s * 0.26 - 0.012, -0.44, 0.02], [s * 0.26 + 0.012, 0.44, 0.15], rgb(0x4a5258)); O.box([-0.26, s * 0.44 - 0.012, 0.02], [0.26, s * 0.44 + 0.012, 0.15], rgb(0x4a5258)); }
    O.add(new CylinderGeometry(0.03, 0.03, 1.2, 8), { m: M(0, 1.04, 0.05), color: STEEL });
    O.box([-0.1, 1.5, 0.0], [0.1, 1.72, 0.1], rgb(0x4a5258));
    // slate base, three pairs of copper jaws (top: the live side), hinge posts at the bottom
    O.box([-0.2, -0.36, 0.05], [0.2, 0.36, 0.075], rgb(0x16181a));
    for (const x of [-0.13, 0, 0.13]) {
      for (const s of [-1, 1]) O.box([x + s * 0.014 - 0.005, 0.2, 0.075], [x + s * 0.014 + 0.005, 0.3, 0.13], COPPER);
      O.box([x - 0.02, -0.3, 0.075], [x + 0.02, -0.24, 0.12], COPPER);
      O.add(new CylinderGeometry(0.012, 0.012, 0.02, 6).rotateX(Math.PI / 2), { m: M(x, 0.33, 0.085), color: STEEL });
    }
    // pilot lamps and the plates
    O.add(new CylinderGeometry(0.022, 0.022, 0.03, 10).rotateX(Math.PI / 2), { m: M(-0.34, 0.5, 0.035), color: [0.2, 0.02, 0.02], glow: [14, 0.8, 0.4], ch: noPower });
    O.add(new CylinderGeometry(0.022, 0.022, 0.03, 10).rotateX(Math.PI / 2), { m: M(0.34, 0.5, 0.035), color: [0.02, 0.15, 0.04], glow: [1.2, 14, 3], ch: power });
    O.quad([0.29, -0.4, 0.022], [0.11, 0, 0], [0, 0.3, 0], { tex: 'onoff', color: [0.8, 0.8, 0.8] });
    O.quad([-0.92, -0.2, 0.004], [0.42, 0, 0], [0, 0.525, 0], { tex: 'danger', color: [0.8, 0.8, 0.8], glow: [0.12, 0.12, 0.12] });
    // the arc: jagged slivers between the jaws and the blades as they close
    for (let i = 0; i < 18; i++) {
      const x = [-0.13, 0, 0.13][i % 3] + (((i * 37) % 9) - 4) * 0.008, a = ((i * 53) % 11) * 0.5, l = 0.05 + ((i * 29) % 7) * 0.018;
      O.quad([x, 0.24, 0.13], [Math.cos(a) * l, Math.sin(a) * l, 0.03], [0.004, 0.004, 0.006], { color: [0, 0, 0], glow: [40, 60, 110], ch: arc });
      O.quad([x, 0.24, 0.13], [0.004, 0.004, 0.006], [Math.cos(a) * l, Math.sin(a) * l, 0.03], { color: [0, 0, 0], glow: [40, 60, 110], ch: arc });
    }
  });
  ctx.reg({
    id: 'power-switch', zone,
    make(G, mats) {
      const group = new Group();
      group.matrixAutoUpdate = false; group.matrix.copy(m);
      // the blades: pivot at the hinge posts, local +y along the blade
      const bo = createObj();
      for (const x of [-0.13, 0, 0.13]) bo.box([x - 0.006, 0, -0.02], [x + 0.006, 0.56, 0.02], COPPER);
      bo.box([-0.17, 0.4, -0.016], [0.17, 0.44, 0.016], DARK);
      bo.add(new CylinderGeometry(0.02, 0.02, 0.2, 8), { m: M(0, 0.42, 0.1, Math.PI / 2, 0, 0), color: DARK });
      bo.add(new CylinderGeometry(0.03, 0.03, 0.14, 10).rotateZ(Math.PI / 2), { m: M(0, 0.42, 0.21), color: rgb(0x8a1c14) });
      const blade = new Mesh(bo.geometry(), mats.object);
      blade.position.set(0, -0.27, 0.1); blade.castShadow = false; blade.userData.noReflect = true; blade.frustumCulled = false;
      group.add(blade);
      let light = null, on = false, tThrow = -10, ang = 1.75;
      const lp = [pos[0] + n[0] * 0.5, pos[1] + 0.2, pos[2] + n[1] * 0.5];
      if (G.lights && typeof G.lights.add === 'function') { light = G.lights.add({ type: 'point', pos: lp, color: [0.5, 0.7, 1.0], lumens: 5000, range: 7, priority: 2 }); light.set({ enabled: false }); }
      return {
        kind: 'power', group, state: 'off', setState() {}, reset() { on = false; ang = 1.75; tThrow = -10; },
        update(dt, t) {
          const p = !!(G.level && G.level.power && G.level.power.on);
          if (p && !on) tThrow = t;
          on = p;
          const want = on ? 0 : 1.75; // radians from upright: open, the handle hangs out and down
          ang += (want - ang) * Math.min(1, dt * 22);
          blade.rotation.x = ang;
          const a = t - tThrow;
          const arcing = a >= 0.05 && a < 0.75;
          mats.gain[arc] = arcing ? (Math.sin(t * 173) * Math.sin(t * 97) > -0.25 ? 1 - a : 0.1) : 0;
          if (light) { const e = arcing && Math.sin(t * 131) > -0.4; if (light.enabled !== e) light.set({ enabled: e }); }
        },
      };
    },
  });
}
