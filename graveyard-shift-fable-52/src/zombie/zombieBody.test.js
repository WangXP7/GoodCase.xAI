import { describe, it, expect, vi } from 'vitest';
import { MeshBasicMaterial, Vector2, Vector3, Vector4, Color } from 'three';
import { buildWardrobe, SKIN_ALWAYS, SKIN_BODY } from './bodyGeo.js';
import { makeOutfit, PIECES } from './garments.js';
import { makeLook, VARIANTS } from './variants.js';
import { HAT_LINE } from './hair.js';
import { BUILDS } from './sculpt/figure.js';
import { buildZombie } from './body.js';
import { charUniforms } from '../mats/charBody.js';
import { NB, B, BONES, solveFK } from './skeleton.js';
import { climbKeys, buildClip, clipAt } from './animClips.js';
import { createRagdoll, R } from './ragdoll.js';
import { createRng } from '../core/rng.js';

// the animator, the ragdoll and the gore task all index bones by these names in this order
const BONE_ORDER = ['root', 'hips', 'spine1', 'spine2', 'neck', 'head', 'jaw', 'cap',
  'clavL', 'upperArmL', 'foreArmL', 'handL', 'fingAL', 'fingBL', 'thumbL', 'thighL', 'shinL', 'footL', 'toeL',
  'clavR', 'upperArmR', 'foreArmR', 'handR', 'fingAR', 'fingBR', 'thumbR', 'thighR', 'shinR', 'footR', 'toeR'];

describe('the skeleton', () => {
  it('keeps its bone names and order', () => {
    expect(BONES.map((b) => b.name)).toEqual(BONE_ORDER);
  });
});

describe('the wardrobe', () => {
  const W = {};
  for (const [sex, build] of [['m', 'average'], ['f', 'gaunt'], ['m', 'brute']]) {
    it(`builds for ${sex} ${build}: finite, weighted, indexed, inside the budgets`, () => {
      const w = W[sex + build] = buildWardrobe(sex, build);
      const a = w.arrays;
      expect(w.count).toBeGreaterThan(8000);
      expect(w.count).toBeLessThan(40000);
      for (let i = 0; i < a.position.length; i++) if (!Number.isFinite(a.position[i]) || !Number.isFinite(a.normal[i])) throw new Error(`bad vertex ${i / 3 | 0}`);
      for (let i = 0; i < w.count; i++) {
        const s = a.skinWeight[i * 4] + a.skinWeight[i * 4 + 1] + a.skinWeight[i * 4 + 2] + a.skinWeight[i * 4 + 3];
        if (Math.abs(s - 1) > 1e-3) throw new Error(`weights of vertex ${i} sum to ${s}`);
        for (let k = 0; k < 4; k++) if (a.skinIndex[i * 4 + k] >= NB) throw new Error('bone index out of range');
        const id = a.aSurf[i * 4 + 3];
        if (id < 0 || id > 12 || id !== Math.round(id)) throw new Error(`surface id ${id}`);
        const u = a.uv[i * 2], v = a.uv[i * 2 + 1];
        if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) throw new Error(`uv ${u},${v}`);
      }
      for (const lists of [w.near, w.far]) for (const [, l] of lists) for (const v of l) if (v >= w.farBase && lists === w.near) throw new Error('near index reaches the far level');
      for (const name of [...SKIN_ALWAYS, ...SKIN_BODY, 'earL', 'footR', 'hairTop', 'hairSides', 'hairLong', 'hairBun', 'jeans', 'flannel', 'flannelSlL', 'robe', 'dress', 'apron', 'armour', 'duty', 'campaign', 'capT', 'beanie', 'hood', 'knot', 'boots']) {
        if (!w.near.has(name)) throw new Error(`no near shell ${name}`);
      }
      // both levels of detail carry the same shells (hat type, hair length, feet), except the
      // inside of the mouth and the ears, which the far level has no use for
      for (const name of w.near.keys()) if (!['mouth', 'teeth', 'earL', 'earR'].includes(name) && !w.far.has(name)) throw new Error(`the far level has no ${name}`);
      // hair worn under a hat is rooted under the hat line
      for (const name of ['hairCapLow', 'hairSides', 'hairLongLow']) for (const lists of [w.near, w.far]) {
        const base = lists === w.far ? w.farBase : 0;
        for (const v of lists.get(name)) if (a.position[(v + base) * 3 + 1] > HAT_LINE + 0.012) throw new Error(`${name} reaches ${a.position[(v + base) * 3 + 1].toFixed(3)}, over the hat line`);
      }
      expect(w.garments.used).toBeLessThan(1);
      // every variant, many seeds: shells exist, eight slots, triangle budgets (15 k near, 3.5 k far)
      for (const v of VARIANTS) for (let s = 1; s < 30; s++) {
        const look = makeLook(createRng(s), v, sex, build, {});
        expect(look.slots.length).toBe(8);
        let near = 0, far = 0;
        for (const name of look.shells) {
          const n = w.near.get(name), f = (look.farSkip || []).includes(name) ? null : w.far.get(name);
          if (!n && !f) throw new Error(`${v}: no shell ${name}`);
          if (n) near += n.length / 3;
          if (f) far += f.length / 3;
        }
        if (near > 15000 || far > 3500) throw new Error(`${v} seed ${s}: ${near} near, ${far} far triangles`);
      }
    });
  }
  it('gives the six variants different outfits, and every piece a rectangle in the garment atlas', () => {
    const sig = VARIANTS.map((v) => makeOutfit(createRng(5), v, 'm', 'average', {}).shells.join(','));
    expect(new Set(sig).size).toBe(6);
    expect(makeOutfit(createRng(5), 'trooper', 'm', 'average', {}).armour).toBe(true);
    expect(makeOutfit(createRng(5), 'guest', 'm', 'average', {}).barefoot).toBe(true);
    expect(PIECES.size).toBeGreaterThan(20);
    for (const [, p] of PIECES) { expect(p.rect[0]).toBeGreaterThanOrEqual(0); expect(p.rect[2]).toBeLessThanOrEqual(1.0001); expect(p.rect[3]).toBeLessThanOrEqual(1.0001); }
  });
});

// wardrobes are a tenth of a second each alone, but this suite shares the machine with others
vi.setConfig({ testTimeout: 40000 });

describe('faces, nose, sleeve heads', () => {
  const w = buildWardrobe('m', 'average');
  const P = (v) => [w.arrays.position[v * 3], w.arrays.position[v * 3 + 1], w.arrays.position[v * 3 + 2]];
  it('has four faces on one cage: head, head1..3 share the topology near and one head far', () => {
    const n = w.near.get('head').length;
    for (const k of [1, 2, 3]) {
      expect(w.near.get(`head${k}`).length).toBe(n);
      expect(w.far.get(`head${k}`)).toBe(w.far.get('head'));
    }
    // and they are different faces: the jaw of the broad one is wider than the plain one's
    const widest = (name) => { let m = 0; for (const v of w.near.get(name)) { const p = P(v); if (p[1] > 1.59 && p[1] < 1.615 && p[2] > 0) m = Math.max(m, Math.abs(p[0])); } return m; };
    expect(widest('head2')).toBeGreaterThan(widest('head') + 0.002);
    const faces = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const look = makeLook(createRng(seed).fork('look'), 'guest', 'm', 'average');
      faces.add(look.face);
      expect(look.shells.filter((x) => /^head\d?$/.test(x)).length).toBe(1);
    }
    expect(faces.size).toBe(4);
  });
  it('meshes the tip of the nose (the face is wrapped from outside) and gives it to the head', () => {
    let tip = -1, z = 0;
    for (const v of w.near.get('head')) { const p = P(v); if (Math.abs(p[0]) < 0.004 && p[1] > 1.63 && p[1] < 1.67 && p[2] > z) { z = p[2]; tip = v; } }
    expect(z).toBeGreaterThan(0.118);
    expect(w.arrays.skinIndex[tip * 4]).toBe(B.head);
    expect(w.arrays.skinWeight[tip * 4]).toBeGreaterThan(0.99);
  });
  it('caps the shoulder with the sleeve: its head reaches over the top of the deltoid', () => {
    let top = 0;
    for (const v of w.near.get('teeSlL')) top = Math.max(top, P(v)[1]);
    let delt = 0;
    for (const v of w.near.get('armL')) { const p = P(v); if (p[0] > 0.2) delt = Math.max(delt, p[1]); }
    expect(top).toBeGreaterThan(delt - 0.004);
  });
  it('tells the shader which hat hides the scalp', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const look = makeLook(createRng(seed).fork('look'), 'mechanic', 'm', 'average');
      expect(look.hatShade).toBe(look.outfit.hat === 'beanie' ? 3 : 0);
    }
  });
});

describe('buildZombie', () => {
  // a stand-in for the mats library: the character uniforms on a plain material, no renderer (no bake)
  const G = { mats: { cloth: (o) => { const m = new MeshBasicMaterial(); m.surf = { ...charUniforms(o.body, { toColor: (c, d) => new Color(c ?? d) }, { Vector2, Vector3, Vector4, Color }), uShelter: { value: 0 } }; return m; } } };
  const pose = (z) => solveFK(z.skeleton.bones, z.pose, [0, 0, 0], [0, 0, 0, 1]);
  it('keeps the contract: one mesh, 13 capsules, parts, both levels, builds', () => {
    const z = buildZombie(7, G, { variant: 'trooper', sex: 'm', build: 'average' });
    expect(z.mesh.isSkinnedMesh).toBe(true);
    expect(z.hitboxes.length).toBe(13);
    expect(Object.keys(z.parts)).toEqual(['head', 'torso', 'armL', 'armR', 'legL', 'legR']);
    expect(Object.keys(z.bones)).toEqual(BONE_ORDER);
    expect(z.triangles[0]).toBeGreaterThan(z.triangles[1]);
    expect(z.gear).toEqual({ armour: true, helmet: false });
    for (const f of ['raycast', 'setBlood', 'getBlood', 'setWet', 'setLod', 'dispose', 'addWound', 'headDamage', 'sever']) expect(typeof z[f]).toBe('function');
    pose(z);
    expect(z.raycast([0, 1.62, 3], [0, 0, -1], 10).part).toBe('head');
    expect(z.raycast([0, 1.3, 3], [0, 0, -1], 10).part).toBe('torso');
    expect(z.raycast([0, 2.3, 3], [0, 0, -1], 10)).toBe(null);
    // builds: the brute is 1.35 times a person and its capsules grow with it
    const b = buildZombie(7, G, { variant: 'drifter', sex: 'm', build: 'brute' });
    expect(b.proportions.height).toBeGreaterThan(1.28);
    expect(b.hitboxes[2].radius).toBeGreaterThan(z.hitboxes[2].radius * 1.3);
    for (const build of BUILDS) expect(buildZombie(3, G, { build }).build).toBe(build);
    expect(buildZombie(9, G, { bare: true }).look.outfit.shells.length).toBe(0);
  });
  it('takes wounds where it is hit: up to eight, the oldest new one replaced, an exit larger than the entry', () => {
    const z = buildZombie(11, G, { variant: 'drifter', sex: 'm', build: 'average' });
    pose(z);
    const W = z.materials.char.surf.uChWound.value, K = z.materials.char.surf.uChWoundK.value;
    const base = W.filter((w) => w.w > 0).length;
    expect(base).toBe(z.look.wounds.length);
    expect(z.addWound([0.02, 1.3, 0.2], 0.03, 'bullet', [0, 0, -1])).toBe(true);
    const live = W.filter((w) => w.w > 0);
    expect(live.length).toBe(base + 2);
    const entry = W[base], exit = W[base + 1];
    expect(entry.z).toBeGreaterThan(0.05);            // on the chest
    expect(exit.z).toBeLessThan(-0.05);               // on the back
    expect(exit.w).toBeGreaterThan(entry.w * 1.5);
    expect(Math.abs(entry.y - 1.3)).toBeLessThan(0.09);   // (rest space: the zombie's own hunch moves it a few centimetres)
    for (let i = 0; i < 12; i++) z.addWound({ x: 0.1, y: 1.0 + i * 0.03, z: 0.2 }, 0.03, i % 2 ? 'blast' : 'bite');
    expect(W.filter((w) => w.w > 0).length).toBe(8);
    for (let i = 0; i < base; i++) expect(K[i]).toBe(2);   // the wounds it arrived with are still there
    expect(z.addWound([NaN, 0, 0])).toBe(false);
  });
  it('severs parts, damages the head, and clears it all when the pool reuses the body', () => {
    const z = buildZombie(12, G, { variant: 'mechanic', sex: 'm', build: 'gaunt' });
    pose(z);
    const S = z.materials.char.surf.uChSever.value;
    expect(z.sever('legL')).toBe(true);
    expect(z.sever('legL')).toBe(false);
    expect(z.sever('tail')).toBe(false);
    expect(z.severed.has('legL')).toBe(true);
    expect(z.pose.hide[B.shinL]).toBe(1); expect(z.pose.hide[B.toeL]).toBe(1); expect(S[3]).toBe(1);
    pose(z);
    expect(z.raycast([0.1, 0.3, 3], [0, 0, -1], 10)).toBe(null);          // nothing left to hit below the knee
    expect(z.headDamage(1)).toBe(1); expect(z.pose.hide[B.jaw]).toBe(1);
    expect(z.headDamage(2)).toBe(2);
    expect(z.sever('head')).toBe(true); expect(z.pose.hide[B.cap]).toBe(1);
    z.setBlood('torso', 0.5);
    expect(z.getBlood('torso')).toBeCloseTo(0.5, 5);
    for (const p of ['head', 'torso', 'armL', 'armR', 'legL', 'legR']) z.setBlood(p, 0);      // what the manager does on spawn
    expect(z.severed.size).toBe(z.look.severed ? 1 : 0);
    expect(z.pose.hide[B.shinL]).toBe(0); expect(z.pose.hide[B.jaw]).toBe(0); expect(S[0]).toBe(0);
    expect(z.materials.char.surf.uChWound.value.filter((w) => w.w > 0).length).toBe(z.look.wounds.length);
  });
});

describe('climb clip', () => {
  it('starts on the live pose and ends past the fence', () => {
    const first = { t: 0, e: 0, pel: [0, 0.9, 0, 0, 0, 0], sp: [0, 0, 0, 0, 0], hd: [0, 0, 0, 0, 0], hand: [[0.2, 0.8, 0, 0, 0], [-0.2, 0.8, 0, 0, 0]], foot: [[0.1, 0.09, 0, 0, 0, 0, 0], [-0.1, 0.09, 0, 0, 0, 0, 0]] };
    const clip = buildClip(climbKeys(1.2, 0.35, 0.9, 0.09), first, 1, false);
    expect(clip[0]).toBe(first);
    const res = {};
    clipAt(clip, 0, res); expect(res.a).toBe(first);
    clipAt(clip, 99, res); expect(res.u).toBe(1);
    expect(res.b.pel[2]).toBeGreaterThan(0.35);
    const m = buildClip(climbKeys(1.2, 0.35, 0.9, 0.09), first, 1, true);
    expect(m[2].pel[0]).toBeCloseTo(-clip[2].pel[0], 6);
  });
});

describe('collapse', () => {
  // a standing figure: joint positions in the order the ragdoll reads them from the skeleton
  const stand = () => {
    const wp = new Float32Array(NB * 3), wq = new Float32Array(NB * 4);
    const put = (b, x, y, z) => { wp[b * 3] = x; wp[b * 3 + 1] = y; wp[b * 3 + 2] = z; wq[b * 4 + 3] = 1; };
    put(B.thighL, 0.09, 0.93, 0); put(B.thighR, -0.09, 0.93, 0); put(B.spine1, 0, 1.08, -0.02); put(B.upperArmL, 0.19, 1.4, 0); put(B.upperArmR, -0.19, 1.4, 0);
    put(B.neck, 0, 1.49, -0.03); put(B.head, 0, 1.6, 0); put(B.foreArmL, 0.24, 1.1, 0); put(B.handL, 0.27, 0.85, 0.02); put(B.foreArmR, -0.24, 1.1, 0); put(B.handR, -0.27, 0.85, 0.02);
    put(B.shinL, 0.1, 0.5, 0.02); put(B.footL, 0.1, 0.09, 0); put(B.shinR, -0.1, 0.5, 0.02); put(B.footR, -0.1, 0.09, 0);
    return { wp, wq };
  };
  const len = (rag, a, b) => Math.hypot(rag.p[a * 3] - rag.p[b * 3], rag.p[a * 3 + 1] - rag.p[b * 3 + 1], rag.p[a * 3 + 2] - rag.p[b * 3 + 2]);
  // throw the figure along (vx, vz), shoulders and head hardest, and run it to rest
  const fall = (rag, vx, vz, seconds = 5) => {
    const { wp, wq } = stand();
    rag.start(wp, wq, (i, out) => { const k = i === R.head ? 2.5 : i >= R.kneeL ? 0.2 : i <= R.hipR ? 0.6 : 1.5; out[0] = vx * k; out[1] = 0; out[2] = vz * k; }, 0.2);
    let frames = 0;
    for (; frames < seconds * 60 && !rag.settled; frames++) rag.update(1 / 60);
    return frames / 60;
  };

  it('falls, stays above the ground, keeps its bone lengths and comes to rest', () => {
    const rag = createRagdoll();
    const { wp, wq } = stand();
    rag.start(wp, wq, (i, out) => { out[0] = 0.2; out[1] = 0; out[2] = i === R.head ? -2 : -0.8; }, 0.2);
    const thigh = len(rag, R.hipL, R.kneeL), upper = len(rag, R.shL, R.elbL);
    for (let i = 0; i < 300 && !rag.settled; i++) rag.update(1 / 60);
    expect(rag.settled).toBe(true);
    expect(rag.time).toBeLessThan(2.25);
    for (let i = 0; i < 15; i++) { expect(rag.p[i * 3 + 1]).toBeGreaterThan(0.03); expect(Number.isFinite(rag.p[i * 3])).toBe(true); }
    expect(rag.p[R.head * 3 + 1]).toBeLessThan(0.4);
    expect(len(rag, R.hipL, R.kneeL)).toBeCloseTo(thigh, 1);
    expect(len(rag, R.shL, R.elbL)).toBeCloseTo(upper, 1);
  });

  it('comes to rest within about two seconds whichever way it is thrown, and then does not move', () => {
    for (let n = 0; n < 12; n++) {
      const rag = createRagdoll();
      const a = (n / 12) * Math.PI * 2;
      const secs = fall(rag, Math.sin(a) * 1.6, Math.cos(a) * 1.6);
      expect(rag.settled).toBe(true);
      expect(secs).toBeLessThan(2.25);
      const before = Array.from(rag.p);
      for (let i = 0; i < 120; i++) rag.update(1 / 60);
      expect(Array.from(rag.p)).toEqual(before);
    }
  });

  it('is a body, not a rope: knees and elbows do not fold shut, limbs stay out of the trunk and each other', () => {
    for (let n = 0; n < 12; n++) {
      const rag = createRagdoll();
      const a = (n / 12) * Math.PI * 2 + 0.3;
      const { wp, wq } = stand();
      // a hard, lopsided throw with the arms flung across the body
      rag.start(wp, wq, (i, out) => { out[0] = Math.sin(a) * (i === R.handL ? -3 : i === R.handR ? 3 : 1.8); out[1] = i === R.kneeL ? 2 : 0; out[2] = Math.cos(a) * (i === R.head ? 3 : 1.8); }, 0.15);
      const leg = len(rag, R.hipL, R.kneeL) + len(rag, R.kneeL, R.footL), arm = len(rag, R.shL, R.elbL) + len(rag, R.elbL, R.handL);
      for (let i = 0; i < 300 && !rag.settled; i++) rag.update(1 / 60);
      expect(len(rag, R.hipL, R.footL)).toBeGreaterThan(leg * 0.47);
      expect(len(rag, R.hipR, R.footR)).toBeGreaterThan(leg * 0.47);
      expect(len(rag, R.shL, R.handL)).toBeGreaterThan(arm * 0.37);
      expect(len(rag, R.shR, R.handR)).toBeGreaterThan(arm * 0.37);
      // hands and elbows outside the chest and the pelvis
      const mid = (i, j, k) => (rag.p[i * 3 + k] + rag.p[j * 3 + k]) * 0.5;
      for (const [i, j] of [[R.shL, R.shR], [R.hipL, R.hipR]]) for (const h of [R.handL, R.handR, R.elbL, R.elbR]) {
        expect(Math.hypot(rag.p[h * 3] - mid(i, j, 0), rag.p[h * 3 + 1] - mid(i, j, 1), rag.p[h * 3 + 2] - mid(i, j, 2))).toBeGreaterThan(0.11);
      }
      expect(len(rag, R.kneeL, R.kneeR)).toBeGreaterThan(0.1);
      expect(len(rag, R.footL, R.footR)).toBeGreaterThan(0.08);
      expect(len(rag, R.head, R.handL)).toBeGreaterThan(0.1);
    }
  });

  it('collects the level boxes near the root in its own frame, an oriented prop once', () => {
    const rag = createRagdoll();
    const obb = { c: [3, 0.5, 0], ax: [Math.SQRT1_2, 0, Math.SQRT1_2], ay: [0, 1, 0], az: [-Math.SQRT1_2, 0, Math.SQRT1_2], half: [0.5, 0.5, 0.2] };
    const colliders = [
      { min: [-1, 0, 0.6], max: [3, 2, 0.8] },                 // a wall 0.6 m south of the root
      { min: [2.4, 0, -0.6], max: [3, 1, 0], obb }, { min: [3, 0, 0], max: [3.6, 1, 0.6], obb },   // two slices of one rotated prop
      { min: [30, 0, 30], max: [31, 1, 31] },                  // far away
      { min: [-5, -1, -5], max: [5, 0, 5] },                   // flush with the ground
    ];
    expect(rag.world(colliders, 2, 0, 0, 0)).toBe(2);
    // facing south (+z): the wall is 0.6 m ahead
    expect(rag.ray(0, 1, 0, 0, 1, 1.2)).toBeCloseTo(0.6, 5);
    expect(rag.ray(0, 1, 0, 0, -1, 1.2)).toBe(1.2);
    // turned to face east (+x), the wall is on the right (-x in its own frame)
    rag.world(colliders, 2, 0, 0, Math.PI / 2);
    expect(rag.ray(0, 1, 0, -1, 0, 1.2)).toBeCloseTo(0.6, 5);
    expect(rag.world(null, 0, 0, 0, 0)).toBe(0);
    expect(rag.world([], 0, 0, 0, 0)).toBe(0);
  });

  it('slumps against a wall instead of passing through it', () => {
    for (const gap of [0.35, 0.6, 0.9]) {
      const rag = createRagdoll();
      rag.world([{ min: [-3, 0, gap], max: [3, 2.5, gap + 0.1] }], 0, 0, 0, 0);
      const secs = fall(rag, 0.2, 2.2);
      expect(rag.settled).toBe(true);
      expect(secs).toBeLessThan(2.25);
      for (let i = 0; i < 15; i++) {
        expect(rag.p[i * 3 + 2]).toBeLessThan(gap - 0.04);
        expect(rag.p[i * 3 + 1]).toBeGreaterThan(0.03);
      }
    }
  });

  it('falls round a bollard and across a kerb without ending inside either', () => {
    const rag = createRagdoll();
    const post = { min: [-0.08, 0, 0.45], max: [0.08, 1.0, 0.61] }, kerb = { min: [-4, 0, -1.2], max: [4, 0.18, -0.5] };
    rag.world([post, kerb], 0, 0, 0, 0);
    fall(rag, 0, 2);
    const inside = (b, i, pad) => rag.p[i * 3] > b.min[0] - pad && rag.p[i * 3] < b.max[0] + pad && rag.p[i * 3 + 1] < b.max[1] + pad && rag.p[i * 3 + 2] > b.min[2] - pad && rag.p[i * 3 + 2] < b.max[2] + pad;
    for (let i = 0; i < 15; i++) expect(inside(post, i, 0.03)).toBe(false);
    const rag2 = createRagdoll();
    rag2.world([kerb], 0, 0, 0, 0);
    fall(rag2, 0, -2);     // backwards, over the kerb
    for (let i = 0; i < 15; i++) expect(inside(kerb, i, 0.03)).toBe(false);
    expect(rag2.p[R.head * 3 + 2]).toBeLessThan(-0.5);
  });
});
