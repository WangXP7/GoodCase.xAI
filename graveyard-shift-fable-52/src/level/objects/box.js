// The weapon box: a haulage line's steel consignment chest, a freight container in small. Yellow
// paint over ribbed sides, corner castings, two top doors hinged on the long edges, a marker beacon
// on a mast at one end. There is one at each of three places; only one holds the goods at a time.
//   gone      a dead chest: doors shut, no light anywhere
//   idle      this is the one: the beacon double-flashes teal, a row of teal lamps under each door,
//             warm light leaking round the doors' seam (it flashes fast for a few seconds on arriving)
//   rolling   the doors are thrown open and stand out past upright, their undersides and the
//             chest's lining lit warm; the real weapons turn over one after another above the
//             opening, rising, slower and slower
//   offering  the weapon on offer hangs there turning slowly in the light, to be taken; through its
//             last seconds it flickers and sinks back toward the chest
//   moving    the doors drop, the beacon and lamps burn red and stutter out
// The chest is static geometry in its zone's object mesh (its collider never changes); the two doors
// are small meshes made when the level installs, and the weapon shown is one mesh from the display
// set every box shares (gunDisplay.js).
import { Group, Mesh } from 'three';
import { M, cyl, cylUp, rgb, sphere } from '../build.js';
import { channel, createObj } from '../../mats/yard.js';
import { sharedGunDisplay, displayScale } from './gunDisplay.js';
import { WEAPONS, WEAPON_IDS } from '../../weapon/defs.js';
import { tuning } from '../../game/tuning.js';

export const BOX = { hx: 0.65, hz: 0.39, h: 0.74, lid: 0.05, swing: 4.55, gunY: 1.24 };
const TB = tuning.economy.box;
const PAINT = [rgb(0xb07d14), rgb(0xa27112), rgb(0xbc8a1c), rgb(0x966a14)], FRAME = rgb(0x7a5a12), DARK = rgb(0x121314), STEEL = rgb(0x6a6e72), RUST = rgb(0x4a2a16);
const TEAL = [0.3, 3.6, 3.0], RED = [7, 0.45, 0.25], WARM = [3.2, 1.9, 0.5];
const STATES = ['gone', 'idle', 'rolling', 'offering', 'moving'];
const WARN = 3; // seconds before an offer lapses in which the weapon flickers and sinks
const BEACON = [-BOX.hx + 0.04, 1.1, 0]; // the lamp at the top of the mast, in the chest's space

function chest(O0, ch) {
  const { hx, hz, h } = BOX;
  // (boxes here are given by two opposite corners in either order)
  const O = Object.create(O0);
  O.box = (a, b, color, o) => O0.box(a.map((v, i) => Math.min(v, b[i])), a.map((v, i) => Math.max(v, b[i])), color, o);
  // two skids and the floor frame
  for (const s of [-1, 1]) O.box([-hx + 0.03, 0, s * 0.25 - 0.05], [hx - 0.03, 0.07, s * 0.25 + 0.05], DARK);
  O.box([-hx, 0.07, -hz], [hx, 0.13, hz], FRAME);
  // corner posts with a casting top and bottom
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    O.box([sx * (hx - 0.03) - 0.03, 0.13, sz * (hz - 0.03) - 0.03], [sx * (hx - 0.03) + 0.03, h - 0.05, sz * (hz - 0.03) + 0.03], FRAME);
    for (const y of [0.07, h - 0.07]) O.box([sx * (hx - 0.035) - 0.045, y, sz * (hz - 0.035) - 0.045], [sx * (hx - 0.035) + 0.045, y + 0.07, sz * (hz - 0.035) + 0.045], DARK, { bevel: 0.008 });
  }
  // the top rail: the rim the doors shut onto
  for (const s of [-1, 1]) {
    O.box([-hx, h - 0.06, s * hz - (s > 0 ? 0.05 : 0)], [hx, h, s * hz + (s > 0 ? 0 : 0.05)], FRAME);
    O.box([s * hx - (s > 0 ? 0.05 : 0), h - 0.06, -hz], [s * hx + (s > 0 ? 0 : 0.05), h, hz], FRAME);
  }
  // long sides: a panel set back, nine pressed ribs, rust along the foot
  for (const s of [-1, 1]) {
    const z = s * (hz - 0.035), u = s > 0 ? 1 : -1;
    O.quad([-hx * u, 0.13, z], [2 * hx * u, 0, 0], [0, h - 0.19, 0], { color: PAINT[1] });
    for (let i = 0; i < 9; i++) {
      const x = -0.52 + i * 0.13;
      O.box([x - 0.032, 0.14, z - 0.002], [x + 0.032, h - 0.075, z + s * 0.03 + 0.002 * s], PAINT[(i * 3 + (s > 0 ? 0 : 2)) % 4], { bevel: 0.006 });
      if (i % 2 === 0) O.quad([(x - 0.034) * u, 0.132, z + s * 0.0325], [0.068 * u, 0, 0], [0, 0.05 + (i % 3) * 0.025, 0], { color: RUST });
    }
    O.quad([-hx * u, 0.13, z + s * 0.001], [2 * hx * u, 0, 0], [0, 0.035, 0], { color: RUST });
    // the line's plate over the ribs
    O.box([-0.31, 0.3, z], [0.31, 0.56, z + s * 0.037], DARK);
    O.quad([-0.3 * u, 0.325, z + s * 0.0385], [0.6 * u, 0, 0], [0, 0.21, 0], { tex: 'freight', color: [0.75, 0.6, 0.2] });
    // five teal lamps under the door, four red between them
    const zl = s * (hz + 0.0015);
    O.quad([-0.5 * u, h - 0.052, zl], [1.0 * u, 0, 0], [0, 0.044, 0], { color: [0.015, 0.015, 0.015] });
    for (let i = 0; i < 9; i++) {
      const red = i % 2 === 1, x0 = (-0.47 + i * 0.105) * u;
      O.quad([x0, h - 0.046, zl + s * 0.001], [(red ? 0.05 : 0.09) * u, 0, 0], [0, 0.032, 0], { color: [0.02, 0.02, 0.02], glow: red ? RED : TEAL, ch: red ? ch.move : ch.idle });
    }
    // black and yellow along the foot
    for (let i = 0; i < 10; i++) O.quad([(-0.6 + i * 0.125) * u, 0.072, s * (hz + 0.001)], [0.06 * u, 0, 0], [0.03 * u, 0.056, 0], { color: [0.012, 0.012, 0.012] });
  }
  // the ends: a panel, four ribs, the way-up arrows
  for (const s of [-1, 1]) {
    const x = s * (hx - 0.035), w = s > 0 ? -1 : 1;
    O.quad([x, 0.13, -hz * w], [0, 0, 2 * hz * w], [0, h - 0.19, 0], { color: PAINT[3] });
    for (let i = 0; i < 4; i++) {
      const z = -0.24 + i * 0.16;
      O.box([x - 0.002, 0.14, z - 0.032], [x + s * 0.032, h - 0.075, z + 0.032], PAINT[(i + (s > 0 ? 1 : 3)) % 4], { bevel: 0.006 });
    }
    if (s > 0) {
      O.box([x, 0.24, -0.15], [x + 0.037, 0.56, 0.15], DARK);
      O.quad([x + 0.0385, 0.25, 0.15], [0, 0, -0.3], [0, 0.3, 0], { tex: 'arrows', color: [0.75, 0.6, 0.2] });
    }
    O.quad([x + s * 0.001, 0.13, -hz * w], [0, 0, 2 * hz * w], [0, 0.035, 0], { color: RUST });
  }
  // the lining: dark walls that take the light, a lit bed with a cradle across it
  const ix = hx - 0.05, iz = hz - 0.05, fy = 0.3;
  for (const s of [-1, 1]) {
    O.quad([s > 0 ? ix : -ix, fy, s * iz], [s > 0 ? -2 * ix : 2 * ix, 0, 0], [0, h - fy, 0], { color: [0.03, 0.028, 0.025], glow: [0.5, 0.28, 0.07], ch: ch.roll });
    O.quad([s * ix, fy, s > 0 ? -iz : iz], [0, 0, s > 0 ? 2 * iz : -2 * iz], [0, h - fy, 0], { color: [0.03, 0.028, 0.025], glow: [0.4, 0.22, 0.05], ch: ch.roll });
  }
  O.quad([-ix, fy, iz], [2 * ix, 0, 0], [0, 0, -2 * iz], { color: [0.02, 0.02, 0.02], glow: [0.9, 0.5, 0.12], ch: ch.roll });
  for (let i = 0; i < 6; i++) O.quad([-0.5 + i * 0.18, fy + 0.002, iz - 0.05], [0.1, 0, 0], [0, 0, -2 * iz + 0.1], { color: [0.1, 0.08, 0.04], glow: [9, 5.6, 1.6], ch: ch.roll });
  for (const x of [-0.3, 0.3]) O.box([x - 0.03, fy, -0.2], [x + 0.03, fy + 0.2, 0.2], DARK);
  // the seam: a line of the inside's light where the two doors meet and along each hinge
  O.quad([-hx + 0.06, h + BOX.lid + 0.0012, 0.012], [2 * hx - 0.12, 0, 0], [0, 0, -0.024], { color: [0, 0, 0], glow: [5, 3, 0.9], ch: ch.seam });
  // the beacon: a bracket and mast on the left end, a red band, a teal dome
  const [bx, by] = BEACON;
  O.box([-hx - 0.012, h - 0.2, -0.05], [-hx + 0.012, h - 0.04, 0.05], DARK);
  O.add(cylUp(0.014, 0.014, by - h + 0.12, 6), { m: M(bx - 0.065, h - 0.16, 0), color: STEEL });
  O.add(cylUp(0.034, 0.034, 0.03, 10), { m: M(bx - 0.065, by - 0.07, 0), color: DARK });
  O.add(cylUp(0.03, 0.03, 0.022, 10), { m: M(bx - 0.065, by - 0.04, 0), color: [0.05, 0.01, 0.01], glow: RED, ch: ch.move });
  O.add(cylUp(0.032, 0.032, 0.045, 10), { m: M(bx - 0.065, by - 0.018, 0), color: [0.02, 0.06, 0.06], glow: [0.8, 11, 9], ch: ch.idle });
  O.add(sphere(0.032, 10, 5).scale(1, 0.7, 1), { m: M(bx - 0.065, by + 0.027, 0), color: [0.02, 0.06, 0.06], glow: [0.8, 11, 9], ch: ch.idle });
}

// One door, hinged along the top of its outer long edge: local z = 0, y = 0 is the hinge line, the
// door reaches to z = -hz (the middle of the chest) when shut and its top face is at y = 0. Thrown
// open it swings right over and hangs down the chest's side, its underside (and the lamps on it)
// facing out.
function door(O, ch) {
  const { hx, hz, lid: t } = BOX;
  const d = hz - 0.004;
  O.box([-hx - 0.012, -t, -d], [hx + 0.012, 0, 0.012], PAINT[0], { bevel: 0.006 });
  // an edge frame, three ribs pressed across, black and yellow along the meeting edge
  for (const x of [-hx + 0.02, hx - 0.02]) O.box([x - 0.03, 0, -d], [x + 0.03, 0.012, 0.01], FRAME);
  for (let i = 0; i < 3; i++) { const x = -0.34 + i * 0.34; O.box([x - 0.04, -0.002, -d + 0.03], [x + 0.04, 0.016, -0.03], PAINT[(i + 2) % 4], { bevel: 0.006 }); }
  for (let i = 0; i < 12; i++) O.quad([-0.6 + i * 0.105, 0.0005, -d + 0.062], [0.05, 0, 0], [0.03, 0, -0.05], { color: [0.012, 0.012, 0.012] });
  // three hinge knuckles, a grab handle by the meeting edge
  for (const x of [-0.45, 0, 0.45]) O.add(cyl(0.016, 0.016, 0.12, 8).rotateZ(Math.PI / 2), { m: M(x, -0.012, 0.014), color: DARK });
  for (const x of [-0.08, 0.08]) O.box([x - 0.008, 0, -d + 0.1], [x + 0.008, 0.045, -d + 0.116], STEEL);
  O.box([-0.09, 0.036, -d + 0.098], [0.09, 0.052, -d + 0.118], STEEL, { bevel: 0.006 });
  // the underside: a dark liner in a painted frame, two long lamps, three stiffeners across
  O.quad([-hx + 0.05, -t - 0.001, -d + 0.03], [2 * hx - 0.1, 0, 0], [0, 0, d - 0.06], { color: [0.03, 0.028, 0.025], glow: [0.5, 0.28, 0.07], ch: ch.roll });
  for (const z of [-0.12, -0.26]) {
    O.box([-0.52, -t - 0.016, z - 0.03], [0.52, -t, z + 0.03], DARK, { bevel: 0.005 });
    O.quad([-0.5, -t - 0.0165, z - 0.018], [1.0, 0, 0], [0, 0, 0.036], { color: [0.1, 0.08, 0.04], glow: [10, 6.2, 1.8], ch: ch.roll });
  }
  for (const x of [-0.58, 0, 0.58]) O.box([x - 0.014, -t - 0.022, -d + 0.03], [x + 0.014, -t, -0.03], FRAME);
}

// the display set all the boxes of one game share, and which box has it
const KITS = new WeakMap();
function kitOf(G) {
  let k = KITS.get(G);
  if (!k) {
    const ids = WEAPON_IDS.filter((id) => WEAPONS[id] && WEAPONS[id].box > 0);
    k = { display: sharedGunDisplay(G), ids, owner: null };
    KITS.set(G, k);
  }
  return k;
}
const SWAY = 0.35; // radians the shown weapon swings either side of broadside
const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

export function placeBox(ctx, spot, yaw) {
  const B = ctx.B;
  const ch = { idle: channel(), roll: channel(), move: channel(), seam: channel() };
  const m = M(spot.pos[0], spot.pos[1], spot.pos[2], 0, yaw, 0);
  const O = ctx.stat(spot.zone);
  O.at(m, () => chest(O, ch));
  B.inZone(spot.zone, () => B.at(m, () => {
    B.tag(`box:${spot.id}`, () => B.collide([-BOX.hx, 0, -BOX.hz], [BOX.hx, BOX.h + 0.06, BOX.hz], 'cloth'));
    B.blob(BOX.hx * 2 + 0.6, BOX.hz * 2 + 0.6);
  }));
  // where its two lamps stand in the world: the beacon, and the light out of the open chest
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const world = (x, y, z) => [spot.pos[0] + x * cy + z * sy, spot.pos[1] + y, spot.pos[2] - x * sy + z * cy];
  const beaconAt = world(BEACON[0] - 0.065, BEACON[1] + 0.1, BEACON[2]), openAt = world(0, BOX.h - 0.3, 0);
  ctx.reg({
    id: spot.id, zone: spot.zone,
    make(G, mats) {
      const group = new Group();
      group.matrixAutoUpdate = false; group.matrix.copy(m); group.name = `box:${spot.id}`;
      const dg = createObj();
      door(dg, ch);
      const geo = dg.geometry();
      const doors = [];
      for (const s of [1, -1]) {
        const pivot = new Group();
        pivot.position.set(0, BOX.h + BOX.lid, s * BOX.hz); pivot.rotation.y = s > 0 ? 0 : Math.PI;
        const mesh = new Mesh(geo, mats.object);
        mesh.castShadow = false; mesh.receiveShadow = true; mesh.userData.noReflect = true; mesh.frustumCulled = false;
        pivot.add(mesh); group.add(pivot); doors.push(mesh);
      }
      const kit = kitOf(G);
      const D = kit.display;
      const gain = mats.gain;
      const cycle = kit.ids.length ? kit.ids : WEAPON_IDS;
      let light = null;
      if (G.lights && typeof G.lights.add === 'function') { light = G.lights.add({ type: 'point', pos: beaconAt, color: TEAL, lumens: 0, range: 6, priority: 0.6 }); light.set({ enabled: false }); }
      // what the lamp does in each state (set once on a change of state, never per frame)
      const LAMP = {
        idle: { pos: beaconAt, color: [0.25, 1, 0.85], lumens: 420, range: 6, enabled: true },
        open: { pos: openAt, color: [1, 0.66, 0.3], lumens: 1300, range: 7, enabled: true },
        moving: { pos: beaconAt, color: [1, 0.12, 0.08], lumens: 320, range: 5, enabled: true },
        off: { enabled: false },
      };
      let lamp = 'off';
      const setLamp = (k) => { if (k === lamp || !light) return; lamp = k; light.set(LAMP[k]); };
      let state = 'gone', open = 0, vel = 0, tState = 0, next = 0, at = 0, offer = null, shownAt = 0, hold = false, arrive = 0, sink = 0, face = Math.PI / 2;
      D.root.rotation.order = 'YXZ';
      // the turn that puts the weapon's flank square to whoever stands at the box (the player, or
      // the staged camera), eased so it follows a walk round the chest without snapping
      const facing = (dt) => {
        const c = G.shotCam && G.shotCam.cam, p = c || (G.player && G.player.pos);
        if (p) {
          const dx = p[0] - spot.pos[0], dz = p[2] - spot.pos[2];
          const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
          if (lx * lx + lz * lz > 0.04) face += wrap(Math.atan2(-lz, lx) - face) * Math.min(1, dt * 5);
        }
        return face;
      };
      const mine = () => kit.owner === obj;
      const take = () => { if (mine()) return; kit.owner = obj; group.add(D.root); };
      const drop = () => { if (!mine()) return; D.show(null); kit.owner = null; };
      const put = (id, t) => { const e = D.show(id); shownAt = t; return e; };
      const obj = {
        kind: 'box', group, display: D,
        get state() { return state; },
        get open() { return open; },
        get showing() { return mine() ? D.shown : null; },
        setState(s) {
          if (!STATES.includes(s) || s === state) return;
          if (s === 'idle' && (state === 'gone' || state === 'moving')) arrive = TB.move;
          if (s === 'rolling') { take(); hold = false; sink = 0; }
          if (s === 'offering') { take(); hold = true; }
          state = s; tState = 0; next = 0;
        },
        setWeapon(id) { offer = WEAPON_IDS.includes(id) ? id : null; },
        // the weapon was taken out of the light: it is gone at once
        taken() { hold = false; drop(); },
        reset() { state = 'gone'; open = 0; vel = 0; arrive = 0; hold = false; drop(); setLamp('off'); },
        update(dt, t) {
          tState += dt;
          if (arrive > 0) arrive -= dt;
          const rolling = state === 'rolling', offering = state === 'offering';
          const want = rolling || offering ? 1 : 0;
          // sprung doors: thrown open with one bounce, dropped shut
          const k = want ? 90 : 150, c = want ? 9 : 20;
          vel += ((want - open) * k - vel * c) * dt; open += vel * dt;
          if (open < 0) { open = 0; vel = 0; } else if (open > 1.1) { open = 1.1; vel = 0; }
          // (past fully open a door has met the chest's side: it comes back off it)
          const swung = (open > 1 ? 2 - open : open) * BOX.swing;
          for (let i = 0; i < 2; i++) doors[i].rotation.x = swung;
          const lit = Math.min(1, open * 1.5);
          // ---- the weapon above the opening
          if (mine()) {
            const g = D.root;
            const yaw = facing(dt);
            if (rolling) {
              D.wanted = true;
              // like a reel settling: quick at first, each weapon held longer than the last
              const u = Math.min(1, tState / TB.roll);
              next -= dt;
              if (next <= 0) {
                // the next weapon round that is already built (while the rest are still being
                // made the reel turns over what there is); only with none at all is one built now
                at = (at + Math.floor(t * 7) % 3) % cycle.length;
                let id = null;
                for (let i = 0; i < cycle.length && !id; i++) { at = (at + 1) % cycle.length; if (D.has(cycle[at])) id = cycle[at]; }
                put(id || cycle[at], t);
                next = 0.11 + 0.5 * u * u;
              }
              const a = Math.min(1, (t - shownAt) / 0.12);
              g.position.set(0, BOX.h + 0.12 + (BOX.gunY - BOX.h - 0.12) * (1 - (1 - u) * (1 - u)), 0);
              g.rotation.set(0, yaw + 0.2 * Math.sin(t * 2.3), (1 - a) * -1.3);
              sizeTo(g, D, 0.75 + 0.25 * a);
              D.lift.value.x = 0.1; D.lift.value.y = 0.8 * lit; D.lift.value.z = 0.9 * lit;
            } else if (offering && hold) {
              if (D.shown !== offer && offer) put(offer, t);
              const a = Math.min(1, (t - shownAt) / 0.3), left = TB.offer - tState;
              sink = left < WARN ? Math.min(1, sink + dt / WARN) : 0;
              // it lands with a small dip, hangs broadside swaying, and near the end flickers and sinks
              g.position.set(0, BOX.gunY - 0.1 * Math.sin(a * Math.PI) * (1 - a) + 0.02 * Math.sin(t * 1.9) - 0.26 * sink * sink, 0);
              g.rotation.set(0.05 * Math.sin(t * 1.3), yaw + SWAY * Math.sin(tState * 0.9), 0.06);
              sizeTo(g, D, 1);
              const fl = left < WARN ? (Math.sin(t * (14 + 22 * sink)) > 0 ? 1 : 0.35) : 1;
              D.lift.value.x = (0.1 + 0.12 * (1 - a)) * fl; D.lift.value.y = (0.7 + 0.6 * (1 - a)) * fl; D.lift.value.z = (0.8 + 0.5 * (1 - a)) * fl;
            } else {
              // the offer ran out: it drops back in as the doors come down
              g.position.y -= dt * 2.4;
              D.lift.value.y = Math.max(0, D.lift.value.y - dt * 4); D.lift.value.z = Math.max(0, D.lift.value.z - dt * 5);
              if (g.position.y < BOX.h - 0.25 || open < 0.25) drop();
            }
          }
          // ---- lamps
          const arriving = state === 'idle' && arrive > 0;
          const flash = arriving ? (Math.sin(t * 26) > 0 ? 1.15 : 0.15) : (t * 0.8) % 1 < 0.07 || ((t * 0.8) % 1 > 0.14 && (t * 0.8) % 1 < 0.21) ? 1.25 : 0.5 + 0.08 * Math.sin(t * 2.2);
          gain[ch.idle] = state === 'idle' ? flash : want ? 0.45 : 0;
          gain[ch.roll] = rolling ? (0.8 + 0.2 * Math.sin(t * 40)) * lit : offering ? (1.1 + 0.12 * Math.sin(t * 5)) * lit : lit * 0.6;
          gain[ch.seam] = state === 'idle' ? (0.5 + 0.3 * Math.sin(t * 1.7)) * (1 - lit) : 0;
          const leaving = state === 'moving' ? Math.max(0, 1 - tState / (TB.move - 0.5)) : 0;
          gain[ch.move] = leaving > 0 ? (Math.sin(t * 23) > -0.3 ? 1 : 0.1) * leaving : 0;
          setLamp(want ? 'open' : state === 'idle' ? 'idle' : leaving > 0.05 ? 'moving' : 'off');
        },
      };
      if (G.events) {
        G.events.on('box:take', (e) => { if (e && e.spot === spot.id) obj.taken(); });
        G.events.on('box:expire', (e) => { if (e && e.spot === spot.id) hold = false; });
      }
      return obj;
    },
  });
}

// the shown weapon at a share of its display size: long guns half as large again as life (about
// the chest's own width), small arms brought up to two thirds of a metre
function sizeTo(g, D, k) {
  const e = D.shown ? D.ensure(D.shown) : null;
  g.scale.setScalar(k * displayScale(e && e.length > 0 ? e.length : 0.6, 1.5, 0.66, 1.42));
}

// The box on its own (the standard builder signature), for a stage or a test: { geometry, make }.
export function buildBox(mats) {
  let made = null;
  const ctx = { B: { inZone: (z, fn) => fn(), at: (m, fn) => fn(), tag: (n, fn) => fn(), collide() {}, blob() {} }, stat: () => O, reg: (d) => { made = d; } };
  const O = createObj();
  placeBox(ctx, { id: 'box', zone: 'stage', pos: [0, 0, 0] }, 0);
  return { geometry: O.geometry(), make: (G) => made.make(G, mats) };
}
