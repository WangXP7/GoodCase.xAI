// The Marlow .44: an invented six-shot double-action revolver by "Tallow Creek Arms". Blued steel,
// a five-inch barrel under a flat sight rib with a full-length lug, a fluted cylinder on a crane
// that swings out to the left, a spurred hammer, one-piece walnut grips with a steel medallion.
// The six chambers are real openings: the rims of the rounds show round the recoil shield from
// behind, the bullets from the front, and all six when the cylinder is out.
//
// Model space (metres): bore axis is z, muzzle toward -z, +y up, +x the shooter's right; z = 0 is
// the rear of the top strap. Authored in millimetres.
import { Vector3, Matrix4 } from 'three';
import { Soup, lathe, box, outline, circle, strokeText, sdPoly, sdExtrude, MM, side, sect, pinX, discZ, rodZ, placeText, modelKit, fitments, reflexSight } from '../geo.js';
import { upgradeFinish } from './upgrade.js';

const CYL = { r: 21.6, z0: -62.4, z1: -19.6, y: -14.2, ring: 14.2, hole: 5.95 };
const CRANE = { x: -7.5, y: -36, open: 1.72 }; // hinge line (parallel to the bore) and how far it swings, radians
const HW = 8.6; // half width of the frame
const TRIG = { pivot: [-30, -36], face: [-34.4, -50.5], angle: -0.26, lift: 2.6 };
const HAMMER_PIVOT = [6, -12];

const FRAME = outline([ // (z, y)
  [-72, 13.2, 1.2], [-13, 13.2, 1.5], [-5, 9.5, 2.5], [2.5, 3, 3], [9.5, -8, 6], [11.5, -29, 3],
  [9, -35, 2], [0, -41, 2], [-17, -47, 2], [-22, -39.6, 1.2], [-71, -39.6, 2.5], [-75, -34, 2], [-75, -27, 1], [-72, -25, 1],
]);
const WINDOW = outline([[-63.2, -36.6, 2], [-18.8, -36.6, 2], [-18.8, 8.6, 2], [-63.2, 8.6, 2]]);
const GRIP = outline([
  [10.5, -31, 3], [16, -52, 22], [27.5, -88, 30], [35.5, -116, 7], [28, -128, 6], [1, -129, 7],
  [-6.5, -118, 6], [-9, -101, 12], [-12.5, -82, 12], [-15.5, -65, 8], [-18.5, -50.5, 3], [-9, -44.5, 3], [3, -40, 2],
]);
const GRIP_HW = 14.6;
const GUARD = outline([
  [-63, -39.2], [-65.5, -52, 4], [-60, -68.5, 7], [-27, -68.5, 6], [-17.5, -58, 4], [-16.5, -47],
  [-21.5, -47], [-22.8, -56, 4], [-29.5, -62.8, 4], [-56, -62.8, 6], [-60, -52, 3], [-58.4, -39.2],
]);
const GUARD_HW = 5.6;
const TRIGGER = outline([
  [-33.2, -37.5], [-34.8, -46, 8], [-34.4, -56, 8], [-31.4, -61, 1.2], [-29.2, -60, 1], [-30.4, -52, 8], [-29.6, -44, 6],
  [-26.2, -39.5, 2], [-26.2, -33.5], [-33.2, -33.5],
]);

function buildSoups(put) {
  // ---- frame ----
  put('frame', 'blued', side(FRAME, -HW, HW, { holes: [WINDOW], b0: 1.1, b1: 1.1, segs: 2, hb: 0.6 }));
  put('frame', 'blued', side(GUARD, -GUARD_HW, GUARD_HW, { b0: 1.6, b1: 1.6, segs: 2 }));
  // recoil shield: small enough that the outer half of every rim shows past it from behind
  put('frame', 'blued', sect(circle(0, CYL.y, 15.4, 40), -18.6, -11, { b1: 2.4, segs: 2 }));
  put('frame', 'steel', discZ(0, 0, 1.5, -19.0, -18.5, 12)); // firing pin bushing
  // top strap: a milled channel with anti-glare lines, the rear sight let into its end
  for (let i = 0; i < 5; i++) put('frame', 'blued', box(-3.2 + i * 1.6, 13.3, -42, 0.7, 0.45, 44, 0.18));
  const ear = outline([[-21, 12.6], [-5.5, 12.6], [-5.5, 20.4, 0.35, 1], [-9, 20.4, 0.6, 1], [-20, 14.6, 1, 2]]);
  put('frame', 'blued', side(ear, 2.1, 8.2, { b0: 0.4, b1: 0.6 }));
  put('frame', 'blued', side(ear, -8.2, -2.1, { b1: 0.4, b0: 0.6 }));
  put('frame', 'blued', side(outline([[-21, 12.6], [-5.5, 12.6], [-5.5, 16.8, 0.3, 1], [-13, 16.8], [-20, 14.6, 1, 2]]), -2.1, 2.1));
  for (const sx of [-1, 1]) put('frame', 'mark', box(sx * 4.6, 17.4, -5.46, 2.2, 3.4, 0.1, 0.02)); // white outline either side of the notch
  put('frame', 'steel', pinX(-13, 15.2, 1.2, -8.5, 8.5)); // windage screw
  // side plate screws, trigger and hammer pins
  for (const [z, y, r] of [[-30, -36, 1.5], [6, -12, 1.8], [-8, -30, 1.3], [-50, -39, 1.2]]) put('frame', 'steel', pinX(z, y, r, -HW - 0.3, HW + 0.3));
  put('frame', 'mark', placeText(strokeText('TC 44 0172', { h: 2.0, sw: 0.25 }).soup, 'right', HW, -44, -39.0 + 0.4));

  // ---- barrel: tube, shank, sight rib, full lug ----
  put('frame', 'blued', lathe([[5.6, -160], [5.6, -196.4], [6.5, -197.6], [8.9, -197.6], [9.7, -196.6], [9.7, -72], [0, -72]], { segs: 36 }));
  put('frame', 'black', lathe([[0, -160], [5.6, -160]], { segs: 24 }));
  put('frame', 'steel', lathe([[0, -62.9], [6.6, -62.9], [7.0, -63.4], [7.0, -72], [0, -72]], { segs: 24 })); // forcing cone
  const rib = outline([[-4.3, 7.5], [4.3, 7.5], [4.3, 13.6, 0.5, 1], [3.4, 14.5], [-3.4, 14.5], [-4.3, 13.6, 0.5, 1]]);
  put('frame', 'blued', sect(rib, -196.5, -72, { b0: 1.4, f0: (p) => (p[1] > 10 ? 1 : 0.2) }));
  for (let i = 0; i < 4; i++) put('frame', 'blued', box(-2.4 + i * 1.6, 14.6, -122, 0.7, 0.4, 100, 0.15));
  const lug = outline([[-6.7, -6.5], [6.7, -6.5], [6.7, -22, 2.5], [3.6, -27.6, 3], [-3.6, -27.6, 3], [-6.7, -22, 2.5]]);
  put('frame', 'blued', sect(lug, -195.5, -77, { b0: 2.6, b1: 0.8, segs: 2, f0: (p) => (p[1] < -10 ? 1.6 : 0.4) }));
  // front sight: a ramped blade with a painted insert
  put('frame', 'blued', side(outline([[-194, 14.4], [-175.5, 14.4], [-178, 20.4, 0.3, 1], [-182.5, 20.4, 0.5, 1]]), -1.7, 1.7, { b0: 0.35, b1: 0.35 }));
  put('frame', 'insert', side(outline([[-176.72, 16.9], [-177.9, 20.1], [-178.5, 20.1], [-177.3, 16.9]]), -1.35, 1.35).move(0, 0, 0.42));
  put('frame', 'mark', placeText(strokeText('MARLOW .44', { h: 3.4, sw: 0.36 }).soup, 'left', 6.7, -150, -15.6));
  put('frame', 'mark', placeText(strokeText('TALLOW CREEK ARMS', { h: 2.0, sw: 0.25 }).soup, 'left', 6.7, -150, -20.2));
  put('frame', 'mark', placeText(strokeText('.44 MARLOW', { h: 2.6, sw: 0.3 }).soup, 'right', 6.7, -118, -17));

  // ---- grips ----
  // grips: an oval section (the flanks roll right round into the straps), fuller at the palm swell
  // and the butt than where the web of the hand sits
  const swell = (p) => (p[1] > -50 ? 0.62 : p[1] > -100 ? 1 : 0.86);
  put('frame', 'wood', side(GRIP, -GRIP_HW, GRIP_HW, { b0: 10.5, b1: 10.5, segs: 6, f0: swell, f1: swell, user: 'grip' }));
  const med = lathe([[0, GRIP_HW - 0.2], [4.3, GRIP_HW - 0.2], [4.3, GRIP_HW + 0.5], [3.6, GRIP_HW + 0.9], [0, GRIP_HW + 0.9]], { segs: 20, map: 'yzx' }).move(0, -62, 6);
  put('frame', 'steel', med); put('frame', 'steel', med.mirrorX());
  const screw = lathe([[0, GRIP_HW - 0.2], [2.4, GRIP_HW - 0.2], [2.4, GRIP_HW + 0.3], [0, GRIP_HW + 0.3]], { segs: 12, map: 'yzx' }).move(0, -98, 17);
  put('frame', 'steel', screw); put('frame', 'steel', screw.mirrorX());
  put('frame', 'black', box(GRIP_HW + 0.32, -98, 17, 0.1, 0.5, 3.6, 0.02)); put('frame', 'black', box(-GRIP_HW - 0.32, -98, 17, 0.1, 0.5, 3.6, 0.02));

  // ---- cylinder latch (left), hammer, trigger ----
  put('latch', 'blued', side(outline([[-12.5, -6.5, 1.2], [-2, -6.5, 2.2], [0, -13.5, 2], [-12.5, -14.5, 1.2]]), -HW - 3.0, -HW + 0.2, { b0: 0.7 }));
  for (let i = 0; i < 4; i++) put('latch', 'blued', box(-HW - 3.05, -10.4, -10.5 + i * 2.4, 0.5, 6, 1.1, 0.2));
  put('hammer', 'blued', side(outline([ // blued like the frame: bare, its spur was a pale patch under the rear notch when aiming
    [1.5, -24], [1.5, -4, 1], [-5.5, 2.5, 1], [-4.6, 6.2, 1], [2, 7.4, 1.5], [7.5, 11.2, 1.2], [13.6, 10.6, 1.4], [12.8, 7.6, 1], [7.5, 2.5, 3], [7.5, -24],
  ]), -3.0, 3.0, { b0: 0.6, b1: 0.6 }));
  for (let i = 0; i < 5; i++) put('hammer', 'blued', box(0, 11.35 - i * 0.12, 8.4 + i * 1.1, 5.2, 0.45, 0.5, 0.15)); // spur checkering
  put('trigger', 'steel', side(TRIGGER, -3.7, 3.7, { b0: 1.1, b1: 1.1, segs: 2 }));

  // ---- crane, cylinder, ejector (the cylinder's own frame: axis on z through the origin) ----
  const cy = CYL.y;
  put('crane', 'blued', sect(outline([[-4.4, cy + 5, 4], [4.4, cy + 5, 4], [3 + CRANE.x, CRANE.y - 4.6, 4], [-4.6 + CRANE.x, CRANE.y - 4.6, 4], [-4.6 + CRANE.x, CRANE.y + 2, 3]]), -76.6, -72.2, { b0: 0.6, b1: 0.3 }));
  put('crane', 'blued', rodZ(CRANE.x, CRANE.y, 3.2, -76.4, -62.6, 0.4, 16));
  const flute = (a) => { let m = 0; for (let k = 0; k < 6; k++) { let d = a - (Math.PI / 2 + Math.PI / 6 + (k * Math.PI) / 3); d = Math.atan2(Math.sin(d), Math.cos(d)); m = Math.max(m, Math.exp(-((d / 0.2) ** 4))); } return m; };
  const fluted = []; for (let i = 0; i < 120; i++) { const a = (i / 120) * Math.PI * 2, r = CYL.r - 3.3 * flute(a); fluted.push([Math.cos(a) * r, Math.sin(a) * r]); }
  const chambers = []; for (let k = 0; k < 6; k++) { const a = Math.PI / 2 + (k * Math.PI) / 3; chambers.push(circle(Math.cos(a) * CYL.ring, Math.sin(a) * CYL.ring, CYL.hole, 20)); }
  const pin = circle(0, 0, 2.5, 14);
  put('cyl', 'blued', sect(fluted, CYL.z0, -35, { holes: [...chambers, pin], b0: 1.3, hb: 0.45 }));
  put('cyl', 'blued', sect(circle(0, 0, CYL.r, 120), -35, CYL.z1, { holes: [...chambers, pin], b0: 1.6, b1: 0.9, hb: 0.3, f0: (p) => flute(Math.atan2(p[1], p[0])) }));
  for (let k = 0; k < 6; k++) { // stop notches
    const a = Math.PI / 2 + Math.PI / 6 + (k * Math.PI) / 3;
    put('cyl', 'black', new Soup().add(box(0, CYL.r - 0.1, -25.5, 3.2, 0.5, 5, 0.1), new Matrix4().makeRotationZ(a - Math.PI / 2)));
  }
  // ejector: star behind the cylinder, rod running forward into the lug
  const star = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, r = 8.3 + 1.6 * Math.cos(a * 6 + Math.PI); star.push([Math.cos(a + Math.PI / 2) * r, Math.sin(a + Math.PI / 2) * r]); }
  put('rod', 'steel', sect(star, CYL.z1 - 0.2, CYL.z1 + 1.1, { b1: 0.3 }));
  put('rod', 'steel', rodZ(0, 0, 2.3, -121, CYL.z1, 0.4, 14));
  put('rod', 'steel', lathe([[0, -128], [2.6, -128], [3.5, -127], [3.5, -121.6], [2.3, -121], [0, -121]], { segs: 16 }));

  // ---- six rounds (their own frame: the cylinder's rear face at z = 0, +z toward the shooter) ----
  const caseS = lathe([[0, -30], [5.75, -30], [5.75, -0.4], [5.2, 0], [5.2, 0.5], [6.55, 0.5], [6.55, 1.75], [6.1, 2.0], [2.6, 2.0], [2.6, 1.6], [0, 1.6]], { segs: 18 });
  const bulletS = lathe([[0, -41], [2.2, -40.6], [4.4, -38], [5.4, -33.5], [5.6, -30], [0, -30]], { segs: 18 });
  const primer = discZ(0, 0, 2.4, 1.55, 1.85, 12);
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 3, x = Math.cos(a) * CYL.ring, y = Math.sin(a) * CYL.ring;
    put('rounds', 'brass', caseS.clone().move(x, y, 0)); put('rounds', 'steel', primer.clone().move(x, y, 0));
    put('rounds', 'bullet', bulletS.clone().move(x, y, 0));
  }
  // ---- attachments: a reflex sight on the top strap, a ported compensator ----
  const rs = reflexSight(-58, 13.2, 31, 8.6);
  put('att_sight', 'black', rs.body); put('att_sight', 'insert', rs.dot);
  put('att_suppressor', 'blued', lathe([[5.8, -238], [11.2, -238], [12.4, -236.6], [12.4, -199], [11.2, -197.6], [5.8, -197.6]], { segs: 28, closed: true }));
  for (let i = 0; i < 3; i++) put('att_suppressor', 'black', box(0, 12.2, -206 - i * 10, 7, 1, 5.4, 0.4));
  put('case', 'brass', caseS.clone()); put('case', 'steel', primer.clone()); // one spent case, for when the six are thrown clear
  // speed loader: a knurled knob on a disc that holds the six rims
  put('loader', 'black', lathe([[0, 2.2], [20.5, 2.2], [21.2, 2.9], [21.2, 6.4], [20, 7.4], [8.4, 7.4], [8.4, 21], [7.4, 22], [0, 22]], { segs: 30 }));
  for (let i = 0; i < 12; i++) put('loader', 'black', new Soup().add(box(8.5, 0, 14.5, 0.7, 1.4, 11, 0.2), new Matrix4().makeRotationZ((i / 12) * Math.PI * 2)));
}

// loader space -> left-hand space (metres): the loader's axis (knob toward +z) lies along the hand's x
// (out past the thumb); LOADER_TURN turns the hand about that axis (where the wrist is, seen from the eye)
const LOADER_TURN = -0.9;
const LOADER_IN_HAND = new Matrix4().set(
  0, 0, 1, 0.0133,
  Math.cos(LOADER_TURN), -Math.sin(LOADER_TURN), 0, -0.064,
  Math.sin(LOADER_TURN), Math.cos(LOADER_TURN), 0, -0.113,
  0, 0, 0, 1,
);
export function buildRevolver(G, patch = (m) => m) {
  const mats = G.mats;
  const rest = { space: 'rest', shelter: 0.3 };
  const M = {
    blued: patch(mats.gunmetal({ finish: 'blued', wear: 0.34, oil: 0.4, seed: 61, ...rest }), { occ: true, rough: [1, 0.16] }),
    steel: patch(mats.gunmetal({ finish: 'bare', wear: 0.3, oil: 0.3, seed: 63, ...rest }), { occ: true, albedo: 0.6 }),
    wood: patch(mats.gunmetal({ finish: 'wood', color: 0x4a2a18, wear: 0.3, oil: 0.25, brushDir: [0, -0.94, 0.34], seed: 67, space: 'rest', shelter: 0.8 }), { occ: true, rough: [1.15, 0.5] }),
    mark: patch(mats.gunmetal({ finish: 'bare', wear: 0, oil: 0, seed: 9, ...rest })),
    black: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.1, oil: 0, seed: 11, ...rest }), { albedo: 0.35 }),
    brass: patch(mats.chrome({ color: 0xb08a48, roughness: 0.2, age: 0.12, dust: 0, ...rest })),
    bullet: patch(mats.chrome({ color: 0x8e8a84, roughness: 0.42, age: 0.25, dust: 0, ...rest })),
    insert: patch(mats.emissive({ color: 0xff5a1e, nits: 0.5 })),
  };
  const kit = modelKit(G, M, 'revolver');
  buildSoups(kit.put);
  const { parts, root } = kit;
  kit.part('frame');
  kit.part('latch');
  kit.part('hammer', [0, HAMMER_PIVOT[1], HAMMER_PIVOT[0]]);
  kit.part('trigger', [0, TRIG.pivot[1], TRIG.pivot[0]]);
  // crane at its hinge; the cylinder (and the ejector) at the cylinder's axis inside it
  kit.part('crane', [CRANE.x, CRANE.y, 0]);
  const cylAt = [0 - CRANE.x, CYL.y - CRANE.y, 0];
  for (const n of ['cyl', 'rod']) { kit.part(n, [0, 0, 0], parts.crane); parts[n].position.set(cylAt[0] * MM, cylAt[1] * MM, 0); }
  // the cylinder soups were authored about their own axis; the crane's about the gun
  const rounds = (name) => {
    const g = name === 'mag' ? kit.part('rounds') : kit.copy('rounds', name);
    g.name = name;
    const bullets = g.children.filter((m) => m.userData.mat === 'bullet');
    g.userData.setRounds = (n) => { for (const b of bullets) b.visible = n > 0; };
    return g;
  };
  const mag = rounds('mag'), spare = rounds('spare');
  parts.mag = mag; parts.spare = spare;
  // the six spent cases, each its own piece: once the rod has thrown them clear they part company
  const seated = mag.children.slice();
  const cases = [];
  for (let k = 0; k < 6; k++) {
    const g = k === 0 ? kit.part('case', [0, 0, 0], mag) : kit.copy('case', `case${k}`, mag);
    const a = Math.PI / 2 + (k * Math.PI) / 3;
    g.userData.at = [Math.cos(a) * CYL.ring * MM, Math.sin(a) * CYL.ring * MM];
    // each leaves a little differently: outward, along the axis, and tumbling about its own axis
    g.userData.v = [0.16 + 0.05 * ((k * 5) % 6), 0.1 * (((k * 7) % 6) - 2.5), 3 + 2.2 * ((k * 3) % 5), ((k * 11) % 7) - 3];
    g.visible = false;
    cases.push(g);
  }
  // t: seconds since the cases fell clear of the cylinder (negative: they are in it, as one piece)
  function scatter(t) {
    const free = t >= 0;
    for (let i = 0; i < seated.length; i++) if (seated[i].userData.mat !== 'bullet') seated[i].visible = !free;
    for (let k = 0; k < 6; k++) {
      const g = cases[k], at = g.userData.at, v = g.userData.v;
      g.visible = free;
      if (!free) continue;
      g.position.set(at[0] * (1 + v[0] * t * 9), at[1] * (1 + v[0] * t * 9), v[1] * t);
      g.rotation.set(v[2] * t * (k % 2 ? 1 : -1), v[3] * t, 0);
    }
  }
  kit.part('loader', [0, 0, 0], spare);
  kit.part('att_sight'); kit.part('att_suppressor');
  spare.visible = false;

  const state = { trigger: 0, hammer: 1, cyl: 0, crane: 0, rod: 0, magRelease: 0, magD: 0, slide: 0, stop: 0 };
  const _m = new Matrix4(), _r = new Matrix4(), _s = new Vector3(1, 1, 1);
  // where the six rounds sit: in the cylinder, wherever the crane and the index have taken it; d
  // metres drawn out of the chambers toward the shooter
  const seatM = (crane, cyl, d, out) => out.makeTranslation(CRANE.x * MM, CRANE.y * MM, 0)
    .multiply(_r.makeRotationZ(CRANE.open * crane))
    .multiply(_m.makeTranslation(cylAt[0] * MM, cylAt[1] * MM, 0))
    .multiply(_r.makeRotationZ((cyl * Math.PI) / 3))
    .multiply(_m.makeTranslation(0, 0, CYL.z1 * MM + d));
  const _seat = new Matrix4();
  function set(s) {
    if (s) Object.assign(state, s);
    parts.trigger.rotation.x = TRIG.angle * state.trigger;
    parts.hammer.rotation.x = 0.82 * state.hammer;
    parts.latch.position.z = -0.0028 * state.magRelease;
    parts.crane.rotation.z = CRANE.open * state.crane;
    parts.cyl.rotation.z = (state.cyl * Math.PI) / 3;
    parts.rod.rotation.z = parts.cyl.rotation.z;
    parts.rod.position.z = 0.02 * state.rod;
    seatM(state.crane, state.cyl, state.magD + 0.02 * state.rod, _seat).decompose(mag.position, mag.quaternion, _s);
  }
  set();

  const bx = (x, y, z, cx, cy, cz, hx, hy, hz) => { const ax = Math.abs(x - cx) - hx, ay = Math.abs(y - cy) - hy, az = Math.abs(z - cz) - hz; return Math.min(Math.max(ax, ay, az), 0) + Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(az, 0)); };
  // signed distance in mm (see pistolModel.js): grips, frame, guard, cylinder, barrel and lug, hammer, trigger
  function sdf(x, y, z, o = {}) {
    let d = sdExtrude(sdPoly(GRIP, z, y) + 8, x, GRIP_HW - 8) - 8;
    d = Math.min(d, sdExtrude(sdPoly(FRAME, z, y) + 1, x, HW - 1) - 1);
    d = Math.min(d, sdExtrude(sdPoly(GUARD, z, y) + 1.5, x, GUARD_HW - 1.5) - 1.5);
    const rc = Math.hypot(x, y - CYL.y) - CYL.r, zc = Math.abs(z - (CYL.z0 + CYL.z1) / 2) - (CYL.z1 - CYL.z0) / 2;
    d = Math.min(d, Math.min(Math.max(rc, zc), 0) + Math.hypot(Math.max(rc, 0), Math.max(zc, 0)));
    d = Math.min(d, bx(x, y, z, 0, -6.5, -134, 9.7, 21, 63), bx(x, y, z, 0, -4, 8, 3.2, 19, 8), bx(x, y, z, -HW - 1.5, -10.5, -6.5, 1.6, 4, 6.5));
    if (!o.noTrigger) {
      const a = -TRIG.angle * (o.trigger || 0), dy = y - TRIG.pivot[1], dz = z - TRIG.pivot[0];
      const ry = dy * Math.cos(a) - dz * Math.sin(a), rz = dy * Math.sin(a) + dz * Math.cos(a);
      d = Math.min(d, sdExtrude(sdPoly(TRIGGER, rz + TRIG.pivot[0], ry + TRIG.pivot[1]), x, 3.7));
    }
    return d;
  }

  const model = {
    id: 'revolver', cls: 'revolver', action: 'revolver', root, parts, meshes: kit.meshes, materials: M, state, set, sdf,
    get triangles() { return kit.triangles; },
    travel: 0, lock: 0,
    mag, spare,
    magAxis: new Vector3(0, 0, 1),
    magRest: seatM(1, 0, 0, new Matrix4()).clone(), // seated with the cylinder swung out
    // the loader in the support hand: held from the side by its knob, across the pads of the thumb and
    // the index finger (pose `knob`). The knob's axis runs across the hand, out past the thumb, so the
    // hand is edge-on beside the cylinder, not over it: the loader's back and the chambers stay in view.
    magInHand: LOADER_IN_HAND,
    spareHand: 'knob',
    scatter,
    casing: null, // the cases leave together on the reload
    anchors: {
      muzzle: new Vector3(0, 0, -0.1976),
      eject: new Vector3(-0.03, -0.02, -0.02),
      grip: new Vector3(0, -0.07, 0.012),
      support: new Vector3(-0.02, -0.08, -0.03),
      sight: new Vector3(0, 0.0201, -0.0055),
      mag: new Vector3(CRANE.x * MM - 0.02, CRANE.y * MM, CYL.z1 * MM),
    },
    hold: {
      twoHand: true, trigger: TRIG,
      right: { at: [27.5, -75, -10.5], back: [-0.24, 0.3, 0.92], thumb: [0, 0.95, -0.31], elbow: [150, -210, 330], thumbKnuckle: [-22, -31, 12], thumbPad: [-16.5, -22, -14], cup: -0.15 },
      left: { at: [-45.5, -88.5, -43], back: [-0.1, 0.45, 0.88], thumb: [0, 0.88, -0.47], elbow: [-190, -330, 190], thumbPad: [-15, -44, -52], cup: 0.1 },
    },
    finish(up) { upgradeFinish(model, !!up, G, patch); },
  };
  model.attach = fitments(model, { // six chambers: no magazine to extend; nothing under the barrel to hold
    sight: { parts: [parts.att_sight], anchors: { sight: new Vector3(0, 0.031, -0.058) } },
    suppressor: { parts: [parts.att_suppressor], anchors: { muzzle: new Vector3(0, 0, -0.238) } }, // a revolver's gap cannot be silenced: a compensator
  });
  return model;
}
