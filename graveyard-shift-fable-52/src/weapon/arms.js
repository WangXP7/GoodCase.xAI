// Both arms: materials, the firing grip and the support grip, and the hand poses the animation
// blends between. Grip landmarks are in the pistol's model space, millimetres.
//
// Order matters. The grips are solved on bare skeletons first (fingers close joint by joint until
// each phalanx touches the pistol's distance field, or the other hand). Only then is each glove's
// skin built, with the solved grip pressed into it: where the palm, the thumb's pad and the heel
// bear on the grip the skin takes the grip's shape, as a real palm does, instead of sinking into it.
// measure() reports what penetration is left; bakeContact() darkens the creases.
import { Group, Vector3, Quaternion, Matrix4 } from 'three';
import { Arm, buildArmParts, handQuat, DIGITS, POSE_SIZE, POSE_AT } from './hand.js';

const MM = 0.001;
const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const J = [V(), V(), V(), V()];
const _p = V(), _a = V(), _b = V(), _c = V(), _d = V();
export const OCCLUDERS = 34; // capsules the gun's shader darkens under: 17 per hand

// Grip landmarks come from each model (`model.hold`, described in pistolModel.js). The gloves' skins
// are built once, against the pistol; every other weapon gets its own solved finger poses on those
// skins (solveFor), so its hands close on its own shape.
const MAG_BOX = { c: [2, -77.75, -62], h: [17, 60.75, 10.4] }; // the same magazine as a box, left-hand space, mm

const sdBox = (x, y, z, c, h) => {
  const ax = Math.abs(x - c[0]) - h[0], ay = Math.abs(y - c[1]) - h[1], az = Math.abs(z - c[2]) - h[2];
  return Math.min(Math.max(ax, ay, az), 0) + Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(az, 0));
};
const segDist = (px, py, pz, a, b) => {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z, pax = px - a.x, pay = py - a.y, paz = pz - a.z;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1)));
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h);
};

// radius of digit D's skin at parameter t along segment s (matches hand.js's phalanges)
const radiusAt = (D, s, t) => { const r0 = D.r[s], r1 = s < 2 ? D.r[s + 1] : D.tip; return r0 + (r1 - r0) * t; };
const T_SAMPLES = [0.2, 0.45, 0.7, 0.9, 1.0];

// Clearance (mm) of digit d's skin from segment `seg` outward: negative when it is inside the obstacle.
function digitClear(arm, d, seg, sd) {
  const D = DIGITS[d];
  arm.joints(d, J);
  let m = Infinity;
  for (let s = seg; s < 3; s++) {
    const end = s === 2 ? 1 - D.tip / D.L[2] : 1; // the last segment ends in the fingertip's sphere
    for (const t of T_SAMPLES) {
      _p.lerpVectors(J[s], J[s + 1], t * end);
      m = Math.min(m, sd(_p.x / MM, _p.y / MM, _p.z / MM) - radiusAt(D, s, t));
    }
  }
  return m;
}

// Close one digit joint by joint until each phalanx touches. slots: pose indices of the joints,
// nearest the palm first; max: their limits. A joint that starts out touching may keep closing for
// as long as that does not push it further in. The last step is refined to a fraction of a degree.
function closeDigit(arm, pose, d, slots, max, sd, gap = 0.12) {
  for (let k = 0; k < slots.length; k++) {
    const i = slots[k];
    arm.setPose(pose);
    let m = digitClear(arm, d, k, sd);
    let step = 0.03;
    while (pose[i] < max[k] && step > 0.0015) {
      pose[i] += step;
      arm.setPose(pose);
      const m2 = digitClear(arm, d, k, sd);
      if (m2 < gap && m2 < m - 1e-4) { pose[i] -= step; step *= 0.5; } else m = m2;
    }
  }
  arm.setPose(pose);
}

// Cyclic coordinate descent: turn the listed joints so a point fixed to one of digit d's bones
// reaches `target` (arm space, metres). eff: { bone: 0..2, at: [x, y, z] mm in that bone's space }.
// joints: [{ bone, axis: 'flex' | 'spread' | 'twist', slot }], outermost first. limits: { slot: [min, max] }.
// Returns the remaining distance (metres).
function reach(arm, pose, d, eff, target, joints, limits, iterations = 50) {
  const { bones, rest } = arm.digits[d];
  const e = V(), axis = V(), q = new Quaternion(), q2 = new Quaternion();
  const o = d === 0 ? 0 : 1 + d * 4;
  const effector = () => { arm.setPose(pose); arm.group.updateMatrixWorld(true); return e.set(eff.at[0] * MM * arm.side, eff.at[1] * MM, eff.at[2] * MM).applyMatrix4(bones[eff.bone].matrixWorld); };
  for (let it = 0; it < iterations; it++) {
    for (const j of joints) {
      effector();
      const bone = bones[j.bone];
      _a.setFromMatrixPosition(bone.matrixWorld);
      let k = -1;
      if (j.axis === 'twist') { axis.setFromMatrixColumn(bone.matrixWorld, 2).normalize(); k = arm.side; }
      else if (j.bone > 0) axis.setFromMatrixColumn(bone.matrixWorld, 0).normalize();
      else {
        bone.parent.getWorldQuaternion(q).multiply(rest);
        if (j.axis === 'spread') { axis.set(0, 1, 0).applyQuaternion(q); k = arm.side; }
        else axis.set(1, 0, 0).applyQuaternion(q.multiply(q2.setFromAxisAngle(_d.set(0, 1, 0), pose[o + 1] * arm.side)));
      }
      _b.copy(e).sub(_a); _c.copy(target).sub(_a);
      _b.addScaledVector(axis, -_b.dot(axis)); _c.addScaledVector(axis, -_c.dot(axis));
      if (_b.lengthSq() < 1e-10 || _c.lengthSq() < 1e-10) continue;
      const ang = Math.atan2(_d.crossVectors(_b, _c).dot(axis), _b.dot(_c));
      const lim = limits[j.slot];
      pose[j.slot] = Math.min(lim[1], Math.max(lim[0], pose[j.slot] + ang * k * 0.5));
    }
  }
  return effector().distanceTo(target);
}

export const lerpPose = (a, b, t, out) => { for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; };
const poseOf = (o) => {
  const p = new Float32Array(POSE_SIZE);
  for (const [name, v] of Object.entries(o)) p.set(v, POSE_AT[name]);
  return p;
};

// A posed skin as a point cloud with normals, for distance queries against the other hand (mm).
function makeCloud() {
  const CELL = 8;
  let P = [], N = [], grid = new Map(), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  const keyOf = (i, j, k) => (i + 512) + (j + 512) * 1024 + (k + 512) * 1048576;
  return {
    clear() { P = []; N = []; grid = new Map(); lo = [1e9, 1e9, 1e9]; hi = [-1e9, -1e9, -1e9]; },
    add(arm, bucket) {
      arm.eachSkinned(bucket, (v, p, n) => {
        const id = P.length / 3;
        P.push(p.x / MM, p.y / MM, p.z / MM); N.push(n.x, n.y, n.z);
        for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[id * 3 + c]); hi[c] = Math.max(hi[c], P[id * 3 + c]); }
        const k = keyOf(Math.floor(P[id * 3] / CELL), Math.floor(P[id * 3 + 1] / CELL), Math.floor(P[id * 3 + 2] / CELL));
        const cell = grid.get(k);
        if (cell) cell.push(id); else grid.set(k, [id]);
      });
    },
    get size() { return P.length / 3; },
    // signed distance estimate: negative inside the skin; `far` when nothing is within a cell or two
    sd(x, y, z, far = 9) {
      if (x < lo[0] - far || y < lo[1] - far || z < lo[2] - far || x > hi[0] + far || y > hi[1] + far || z > hi[2] + far) return far;
      const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL), ck = Math.floor(z / CELL);
      let best = -1, bd = far * far;
      for (let k = ck - 1; k <= ck + 1; k++) for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
        const cell = grid.get(keyOf(i, j, k));
        if (!cell) continue;
        for (const id of cell) {
          const dx = x - P[id * 3], dy = y - P[id * 3 + 1], dz = z - P[id * 3 + 2], d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bd) { bd = d2; best = id; }
        }
      }
      if (best < 0) return far;
      const dn = (x - P[best * 3]) * N[best * 3] + (y - P[best * 3 + 1]) * N[best * 3 + 1] + (z - P[best * 3 + 2]) * N[best * 3 + 2];
      return dn < 0 ? dn : Math.max(dn, Math.sqrt(bd) - 1.6);
    },
  };
}

// patch(material, opts) is the viewmodel's material hook (projection, relief scale, contact darkening).
export function createArms(G, patch, pistol) {
  const mats = G.mats;
  const rest = { space: 'rest' };
  // Each arm has its own materials: `contact` (0..1) scales that arm's baked contact darkening.
  const makeMats = () => {
    const contact = { value: 1 };
    const o = (relief, extra = {}) => ({ relief, contact, ...extra });
    return {
      contact,
      // thin knit back, synthetic-suede palm, moulded knuckle panel (it takes the rain's sheen),
      // stitched trim, webbing strap, waxed-canvas sleeve
      // The glove is dark fabric under every lamp: low albedo and next to no nap. (With the knit's
      // full nap the back of the hand took the lamp's colour whole: mustard under sodium, grey under
      // the canopy, black in the dark. Now the light tints a dark glove.) The weave is raised instead.
      // The glove is colour-blocked so its construction reads at arm's length: a slate
      // ripstop back with a woven grid you can count (`weave`: pitch in metres, relief), tan suede
      // on the palm, the fingertips and the thumb, pale thread in every seam, a matt moulded
      // knuckle guard, a webbing strap.
      back: patch(mats.cloth({ kind: 'jersey', color: 0x2b3136, dirt: 0.12, wet: 0.3, seed: 31, ...rest }), o(1.6, { fuzz: 0.22, spec: 0.3, weave: [0.0046, 0.24], seam: 1 })),
      palm: patch(mats.cloth({ kind: 'leather', color: 0x211f1d, colorB: 0x282522, dirt: 0.06, wet: 0.12, seed: 37, ...rest }), o(0.7, { rough: [1, 0.74], fuzz: 0.6, spec: 0.4, seam: 1 })),
      pad: patch(mats.cloth({ kind: 'leather', color: 0x15171a, colorB: 0x24272a, dirt: 0.08, seed: 41, ...rest }), o(0.25, { rough: [1, 0.46], spec: 0.8 })),
      trim: patch(mats.cloth({ kind: 'canvas', color: 0x5a5548, dirt: 0.12, wet: 0.4, seed: 53, ...rest }), o(0.4, { spec: 0.5 })),
      strap: patch(mats.cloth({ kind: 'canvas', color: 0x16181b, dirt: 0.15, wet: 0.5, seed: 43, ...rest }), o(1.3, { spec: 0.4, weave: [0.0042, 0.35] })),
      sleeve: patch(mats.cloth({ kind: 'canvas', color: 0x2f271c, dirt: 0.4, wet: 0.6, seed: 47, ...rest }), o(0.9, { fuzz: 0.5, spec: 0.4 })),
    };
  };
  const right = new Arm(1), left = new Arm(-1);
  const M = { right: makeMats(), left: makeMats() };
  const root = new Group();
  root.name = 'arms';
  root.add(right.group, left.group);
  let triangles = 0;

  const gripP = {
    right: { pos: V(), quat: new Quaternion(), elbow: V() },
    left: { pos: V(), quat: new Quaternion(), elbow: V() },
  };
  const grip = gripP; // the pistol's grip (the skins are built in it)
  const posesP = {
    rGrip: new Float32Array(POSE_SIZE), rFire: new Float32Array(POSE_SIZE), lGrip: new Float32Array(POSE_SIZE),
    // six rounds on a loader held by its knob; a shell pinched between the thumb and two fingers
    cup: poseOf({ thumb: [0.2, 0.2, 0, 0.35, 0.3], index: [0.55, 0.05, 0.75, 0.4], middle: [0.6, 0, 0.8, 0.45], ring: [0.65, 0, 0.85, 0.5], pinky: [0.7, -0.05, 0.9, 0.5], cup: [0.25] }),
    pinch: poseOf({ thumb: [0.3, 0.15, 0, 0.3, 0.35], index: [0.5, 0.02, 0.85, 0.5], middle: [0.55, 0, 0.9, 0.55], ring: [0.9, 0, 1.2, 0.7], pinky: [1.0, -0.05, 1.25, 0.7], cup: [0.2] }),
    // a speed loader held by its knob from the side: the knob lies across the pads of the thumb and the
    // index finger, the other fingers folded into the palm clear of the disc and the rounds
    knob: poseOf({ thumb: [0.3, 0.1, 0, 0.36, 0.3], index: [0.5, 0, 1.02, 0.55], middle: [1.15, 0.02, 1.4, 0.9], ring: [1.2, 0, 1.45, 0.9], pinky: [1.25, -0.05, 1.45, 0.9], cup: [0.3] }),
    open: poseOf({ thumb: [0.12, 0.5, 0, 0.2, 0.2], index: [0.22, 0.04, 0.38, 0.22], middle: [0.28, 0, 0.44, 0.28], ring: [0.33, 0, 0.5, 0.3], pinky: [0.38, -0.06, 0.5, 0.3], cup: [0.06] }),
    // the heel of the palm drives the magazine home: the fingers stay curled round its base, a cupped
    // hand under the grip (they come down off the magazine's front only as far as the grip's toe needs)
    slap: poseOf({ thumb: [0.3, 0.35, 0, 0.35, 0.3], index: [0.62, 0.02, 0.95, 0.5], middle: [0.66, 0, 1.0, 0.55], ring: [0.7, 0, 1.02, 0.55], pinky: [0.74, -0.05, 1.0, 0.5], cup: [0.3] }),
    mag: new Float32Array(POSE_SIZE),
  };
  const poses = posesP;
  const solveP = {}, solve = solveP;
  const lim = [1.6, 1.9, 1.3];
  const fingerSlots = (d) => [1 + d * 4, 3 + d * 4, 4 + d * 4];
  const padOf = (d) => [0, -DIGITS[d].tip * 0.9, -DIGITS[d].L[2] + DIGITS[d].tip * 1.1];
  const thumbLim = { 0: [-0.5, 1.1], 1: [-0.9, 1.0], 2: [-2.8, 2.8], 3: [-0.1, 0.9], 4: [-0.1, 0.9] };
  const parallel = (d) => -(DIGITS[d].splay || 0); // spread that lays a finger alongside its neighbour
  const cloudP = makeCloud(), cloud = cloudP; // the firing hand in its grip, pistol space

  const detached = (fn) => { // solve with the arms at the origin of the pistol's space
    const parent = root.parent;
    if (parent) parent.remove(root);
    root.position.set(0, 0, 0); root.quaternion.identity();
    root.updateMatrixWorld(true);
    const r = fn();
    if (parent) parent.add(root);
    return r;
  };
  const toGrip = () => {
    right.place(grip.right.pos, grip.right.quat, grip.right.elbow); right.setPose(poses.rGrip);
    left.place(grip.left.pos, grip.left.quat, grip.left.elbow); left.setPose(poses.lGrip);
  };

  function attach(arm, m, carve) {
    for (const mesh of arm.meshes) { arm.group.remove(mesh); mesh.geometry.dispose(); }
    arm.meshes.length = 0;
    const parts = buildArmParts(carve);
    arm.attach(parts, m);
    for (const p of Object.values(parts)) triangles += p.triCount;
  }

  // Both grips, solved in the pistol's model space, then both skins.
  function regrip(cfg = pistol.hold) { detached(() => solveGrips(cfg)); }
  // Finger poses and grip transforms for another model, on the skins the pistol built. Returns
  // { right, left: { pos, quat, elbow }, rGrip, rFire, lGrip, solve }.
  const tmpCloud = makeCloud();
  function solveFor(model, cfg = model.hold) {
    return detached(() => {
      const out = {
        right: { pos: V(), quat: new Quaternion(), elbow: V() }, left: { pos: V(), quat: new Quaternion(), elbow: V() },
        rGrip: new Float32Array(POSE_SIZE), rFire: new Float32Array(POSE_SIZE), lGrip: new Float32Array(POSE_SIZE), solve: {},
      };
      solveGrips(cfg, model, out);
      toGrip();
      return out;
    });
  }
  function solveGrips(cfg, model = pistol, out = null) {
    const skin = !out; // the pistol's solve also builds the skins
    const grip = out || gripP, poses = out || posesP, solve = out ? out.solve : solveP;
    const cloud = skin ? cloudP : tmpCloud;
    if (skin) triangles = 0;
    const gunSd = (x, y, z) => model.sdf(x, y, z, { noTrigger: true });
    const setup = (arm, c, g) => {
      handQuat(arm.side, V(...c.back), V(...c.thumb), g.quat);
      const b = DIGITS[2].base;
      g.pos.set(b[0] * arm.side * MM, b[1] * MM, b[2] * MM).applyQuaternion(g.quat).multiplyScalar(-1).add(V(...c.at).multiplyScalar(MM));
      g.elbow.set(...c.elbow).multiplyScalar(MM);
      arm.place(g.pos, g.quat, g.elbow);
    };
    // ---- firing hand ----
    setup(right, cfg.right, grip.right);
    const r = poses.rGrip;
    r.set(poseOf({
      thumb: [0.1, 0.1, 0, 0.15, 0.1], index: [0.3, parallel(1) * 0.5, 0.9, 0.5], middle: [0.3, parallel(2), 0.1, 0.05],
      ring: [0.3, parallel(3), 0.1, 0.05], pinky: [0.3, parallel(4) * 0.9, 0.1, 0.05], cup: [cfg.right.cup ?? 0.25],
    }));
    for (const d of [2, 3, 4]) closeDigit(right, r, d, fingerSlots(d), lim, gunSd);
    // thumb: first carry its knuckle round behind the grip to the left side, then lay it along the frame
    const tm = V(...cfg.right.thumbKnuckle).multiplyScalar(MM), tp = V(...cfg.right.thumbPad).multiplyScalar(MM);
    solve.rThumbKnuckle = reach(right, r, 0, { bone: 1, at: [0, 0, 0] }, tm, [{ bone: 0, axis: 'flex', slot: 0 }, { bone: 0, axis: 'spread', slot: 1 }], thumbLim);
    solve.rThumb = reach(right, r, 0, { bone: 2, at: padOf(0) }, tp, [{ bone: 2, axis: 'flex', slot: 4 }, { bone: 1, axis: 'flex', slot: 3 }, { bone: 0, axis: 'twist', slot: 2 }], thumbLim);
    // trigger finger: pad on the trigger's face, at rest and at full pull
    const T = cfg.trigger || { pivot: [-56, -25.5], face: [-64.2, -44.5], angle: -0.2, lift: 3.4 };
    const triggerFace = (pull) => {
      // just proud of the face, so the pad rests on it; a little higher at full pull, clear of the guard's floor
      const a = T.angle * pull, py = T.pivot[1], pz = T.pivot[0], y = T.face[1] + T.lift * pull - py, z = T.face[0] - pz;
      return V(0.0008, (py + y * Math.cos(a) - z * Math.sin(a)) * MM, (pz + y * Math.sin(a) + z * Math.cos(a)) * MM);
    };
    const idxLim = { 5: [0.0, 0.9], 6: [-0.5, 0.4], 7: [0.2, 1.7], 8: [0.05, 1.2] };
    const fingerJoints = (o) => [{ bone: 2, axis: 'flex', slot: o + 3 }, { bone: 1, axis: 'flex', slot: o + 2 }, { bone: 0, axis: 'flex', slot: o }, { bone: 0, axis: 'spread', slot: o + 1 }];
    solve.rIndex = reach(right, r, 1, { bone: 2, at: padOf(1) }, triggerFace(0), fingerJoints(5), idxLim);
    poses.rFire.set(r);
    solve.rIndexPull = reach(right, poses.rFire, 1, { bone: 2, at: padOf(1) }, triggerFace(1), fingerJoints(5), idxLim);
    right.setPose(r);

    // the firing hand's skin, pressed against the pistol where it bears on it
    right.updateSkinMats();
    if (skin) attach(right, M.right, (x, y, z, w) => { right.skinPoint(x * MM, y * MM, z * MM, w, _p); return gunSd(_p.x / MM, _p.y / MM, _p.z / MM); });
    const two = cfg.twoHand !== false; // the support hand wraps the firing hand (handguns) or holds the gun elsewhere
    cloud.clear();
    if (two) for (const b of ['back', 'pad']) cloud.add(right, b);
    const bothSd = two ? (x, y, z) => Math.min(model.sdf(x, y, z, { trigger: 0 }), cloud.sd(x, y, z)) : (x, y, z) => model.sdf(x, y, z, { trigger: 0 });

    // ---- support hand: wrapped over the firing fingers, index up under the guard ----
    setup(left, cfg.left, grip.left);
    const l = poses.lGrip;
    l.set(poseOf({
      thumb: [0.1, 0.1, 0, 0.1, 0.1], index: [0.2, parallel(1), 0.05, 0.05], middle: [0.2, parallel(2), 0.05, 0.05],
      ring: [0.2, parallel(3), 0.05, 0.05], pinky: [0.2, parallel(4) * 0.9, 0.05, 0.05], cup: [cfg.left.cup ?? 0.2],
    }));
    for (const d of [1, 2, 3, 4]) closeDigit(left, l, d, fingerSlots(d), lim, bothSd);
    solve.lThumb = reach(left, l, 0, { bone: 2, at: padOf(0) }, V(...cfg.left.thumbPad).multiplyScalar(MM),
      [{ bone: 2, axis: 'flex', slot: 4 }, { bone: 1, axis: 'flex', slot: 3 }, { bone: 0, axis: 'flex', slot: 0 }, { bone: 0, axis: 'spread', slot: 1 }], thumbLim);
    left.setPose(l);
    if (!skin) return;
    left.updateSkinMats();
    attach(left, M.left, (x, y, z, w) => { left.skinPoint(-x * MM, y * MM, z * MM, w, _p); return bothSd(_p.x / MM, _p.y / MM, _p.z / MM); });

    bakeContact();
  }

  // The hand that carries a magazine: fingers closed against the magazine's box in hand space.
  // The magazine stands on the palm (box: { c, h } in left-hand space, mm) and the fingers come up
  // round its front; or (fist) it lies across the palm and every finger wraps it.
  function solveMagPose(box = MAG_BOX, p = poses.mag, fist = false) {
    left.place(V(), new Quaternion(), V(0, 0, 0.3));
    const sd = (x, y, z) => sdBox(x, y, z, box.c, box.h);
    p.set(poseOf({ thumb: [0.15, 0.3, 0, 0.1, 0.1], index: [0.5, parallel(1), 0.1, 0.05], middle: [0.5, parallel(2), 0.1, 0.05], ring: [0.5, parallel(3), 0.1, 0.05], pinky: [0.5, parallel(4), 0.1, 0.05], cup: [fist ? 0.3 : 0.1] }));
    if (fist) for (const d of [1, 2, 3, 4]) closeDigit(left, p, d, fingerSlots(d), lim, sd);
    else {
      for (const d of [2, 3]) closeDigit(left, p, d, fingerSlots(d), lim, sd);
      // the outer fingers lie alongside, off the edges of the magazine
      for (const [d, from, k] of [[1, 2, 0.94], [4, 3, 1.04]]) for (const j of [0, 2, 3]) p[1 + d * 4 + j] = p[1 + from * 4 + j] * k;
    }
    closeDigit(left, p, 0, [0, 3, 4], [0.9, 0.8, 0.9], sd);
    return p;
  }
  // A carrying pose for another model's magazine (model.magBox), on the same skins.
  const solveCarry = (box, fist) => detached(() => { const p = solveMagPose(box, new Float32Array(POSE_SIZE), fist); toGrip(); return p; });

  // ---- measurements ----------------------------------------------------------------------------
  const SKIN = ['back', 'pad', 'trim', 'strap'];
  // Worst penetration in the two-handed grip (mm, positive = inside): every skin vertex of both hands
  // against the pistol's distance field, and the support hand's against the firing hand's skin.
  function measure(detail = false) {
    return detached(() => {
      toGrip();
      const out = { gun: 0, gunAt: null, hands: 0, handsAt: null, verts: 0, over1mm: 0 };
      const list = [];
      const sdGun = (arm, p) => pistol.sdf(p.x / MM, p.y / MM, p.z / MM, arm === right ? { noTrigger: true } : { trigger: 0 });
      for (const arm of [right, left]) for (const b of SKIN) {
        arm.eachSkinned(b, (v, p) => {
          out.verts++;
          const c = -sdGun(arm, p);
          if (c > out.gun) { out.gun = c; out.gunAt = [arm === right ? 'R' : 'L', b, Math.round(p.x / MM), Math.round(p.y / MM), Math.round(p.z / MM)]; }
          if (c > 1) out.over1mm++;
          if (detail && c > 1) { const g = arm.geometry[b].getAttribute('position'); list.push([+c.toFixed(1), arm === right ? 'R' : 'L', b, Math.round(g.getX(v) / MM), Math.round(g.getY(v) / MM), Math.round(g.getZ(v) / MM)]); }
          if (arm === left) {
            const h = -cloud.sd(p.x / MM, p.y / MM, p.z / MM);
            if (h > out.hands) { out.hands = h; out.handsAt = [b, Math.round(p.x / MM), Math.round(p.y / MM), Math.round(p.z / MM)]; }
            if (h > 1) out.over1mm++;
          }
        });
      }
      out.gun = +out.gun.toFixed(2); out.hands = +out.hands.toFixed(2);
      if (detail) out.worst = list.sort((p, q) => q[0] - p[0]).slice(0, 40); // [mm, arm, bucket, bind x, y, z]
      return out;
    });
  }

  // Contact darkening baked into aSurf.w for the grip: how closed-in each skin vertex is by the
  // pistol, the other hand and its own neighbouring fingers. The viewmodel's depth range is too
  // compressed for the screen-space AO pass to find these creases.
  function bakeContact() {
    toGrip();
    const caps = { R: [], L: [] };
    for (const [name, arm] of [['R', right], ['L', left]]) for (let d = 0; d < 5; d++) {
      arm.joints(d, J);
      for (let s = 0; s < 3; s++) caps[name].push({ d, s, a: J[s].clone().multiplyScalar(1 / MM), b: J[s + 1].clone().multiplyScalar(1 / MM), r: (radiusAt(DIGITS[d], s, 0) + radiusAt(DIGITS[d], s, 1)) / 2 });
    }
    const leftCloud = makeCloud();
    leftCloud.add(left, 'back');
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (const arm of [right, left]) {
      const own = arm === right ? caps.R : caps.L, other = arm === right ? leftCloud : cloud;
      for (const b of ['back', 'pad', 'trim', 'strap', 'sleeve']) {
        const g = arm.geometry[b];
        if (!g) continue;
        const surf = g.getAttribute('aSurf'), si = g.getAttribute('skinIndex').array, sw = g.getAttribute('skinWeight').array;
        arm.eachSkinned(b, (v, p, n) => {
          // probe a little way out along the normal, so only what the surface faces darkens it
          const x = p.x / MM + n.x * 2.5, y = p.y / MM + n.y * 2.5, z = p.z / MM + n.z * 2.5;
          let ao = 1 - smooth(1.0, 8.5, pistol.sdf(x, y, z, { trigger: 0 }));
          ao = Math.max(ao, 1 - smooth(1.0, 7.5, other.sd(x, y, z, 12)));
          // own fingers: the digit this vertex belongs to is left out; the palm sees fingertips only
          let top = 0, tw = 0;
          for (let k = 0; k < 4; k++) if (sw[v * 4 + k] > tw) { tw = sw[v * 4 + k]; top = si[v * 4 + k]; }
          const mine = top >= 2 && top <= 16 ? Math.floor((top - 2) / 3) : -1;
          for (const c of own) {
            if (c.d === mine || (mine < 0 && c.s === 0)) continue;
            ao = Math.max(ao, 0.8 * (1 - smooth(0.6, 5.5, segDist(x, y, z, c.a, c.b) - c.r)));
          }
          surf.setW(v, ao);
        });
        surf.needsUpdate = true;
      }
    }
  }

  // The hands as capsules in the pistol's space, for the gun shader's contact darkening.
  // gunInv: arm space -> pistol space. Writes [ax, ay, az, radius] to A and [bx, by, bz, 1] to B (metres).
  const PALM_CAPS = [[-8, -1, -30, -8, -1, -92, 12.5], [26, -7, -22, 26, -7, -72, 11.5]];
  const _toGun = new Matrix4();
  let occN = 0, occA = null, occB = null;
  const putOcc = (a, b, r) => {
    const n = occN++;
    a.applyMatrix4(_toGun); b.applyMatrix4(_toGun);
    occA[n * 4] = a.x; occA[n * 4 + 1] = a.y; occA[n * 4 + 2] = a.z; occA[n * 4 + 3] = r * MM;
    occB[n * 4] = b.x; occB[n * 4 + 1] = b.y; occB[n * 4 + 2] = b.z; occB[n * 4 + 3] = 1;
  };
  function occluders(gunInv, A, B) {
    // bone matrices are world matrices: take them back through the arms' own root, then into the pistol
    root.updateMatrixWorld(true);
    _toGun.copy(root.matrixWorld).invert().premultiply(gunInv);
    occN = 0; occA = A; occB = B;
    const put = putOcc;
    for (let k = 0; k < 2; k++) {
      const arm = k === 0 ? right : left;
      for (let d = 0; d < 5; d++) {
        const { D, bones } = arm.digits[d];
        for (let s = 0; s < 3; s++) {
          _a.setFromMatrixPosition(bones[s].matrixWorld);
          if (s < 2) _b.setFromMatrixPosition(bones[s + 1].matrixWorld); else _b.set(0, 0, -(D.L[2] - D.tip) * MM).applyMatrix4(bones[2].matrixWorld);
          put(_a, _b, (radiusAt(D, s, 0) + radiusAt(D, s, 1)) / 2);
        }
      }
      for (let i = 0; i < PALM_CAPS.length; i++) {
        const c = PALM_CAPS[i];
        _a.set(c[0] * arm.side * MM, c[1] * MM, c[2] * MM).applyMatrix4(arm.hand.matrixWorld);
        _b.set(c[3] * arm.side * MM, c[4] * MM, c[5] * MM).applyMatrix4(arm.hand.matrixWorld);
        put(_a, _b, c[6]);
      }
    }
    return occN;
  }

  const t0 = performance.now();
  solveMagPose();
  regrip();
  solve.buildMs = Math.round(performance.now() - t0);
  // joint positions of both hands in the grip (pistol space, mm): for tuning the landmarks
  function dump() {
    return detached(() => {
      const out = {};
      for (const [name, arm, pose] of [['R', right, poses.rGrip], ['L', left, poses.lGrip]]) {
        const g = name === 'R' ? grip.right : grip.left;
        arm.place(g.pos, g.quat, g.elbow); arm.setPose(pose);
        out[`${name}wrist`] = g.pos.toArray().map((v) => Math.round(v / MM));
        for (let d = 0; d < 5; d++) { arm.joints(d, J); out[name + DIGITS[d].name] = J.map((v) => v.toArray().map((x) => Math.round(x / MM))); }
        out[`${name}pose`] = Array.from(pose).map((v) => +v.toFixed(2));
      }
      return out;
    });
  }
  return {
    root, right, left, poses, grip, regrip, solveFor, solveCarry, solve, dump, measure, occluders, materials: M,
    get triangles() { return triangles; },
  };
}
