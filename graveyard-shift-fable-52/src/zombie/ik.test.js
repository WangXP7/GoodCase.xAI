import { describe, it, expect } from 'vitest';
import { ik2, qFromTo, vRot, qEuler, qMul, qInvMul, springTo, ikMid } from './ik.js';

const ID = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]);

describe('two-bone IK', () => {
  const solve = (t, pole, alt = [0, 0, 0]) => {
    const q = new Float32Array(8), v = new Float32Array(3);
    ik2(q, 0, q, 4, 0, 1, 0, t[0], t[1], t[2], 0.4, 0.4, pole[0], pole[1], pole[2], 1, ID, 0, 4, alt[0], alt[1], alt[2]);
    // bones hang along -Y at rest: end = root + q1 * (0,-l1,0) + q2 * (0,-l2,0)
    vRot(v, q, 0, 0, -0.4, 0);
    const mid = [v[0], 1 + v[1], v[2]];
    vRot(v, q, 4, 0, -0.4, 0);
    return { end: [mid[0] + v[0], mid[1] + v[1], mid[2] + v[2]], mid, q };
  };
  it('puts the end joint on a reachable target', () => {
    for (const t of [[0.2, 0.5, 0.3], [0, 0.3, 0.1], [-0.3, 0.9, -0.4], [0.5, 1.2, 0]]) {
      const { end } = solve(t, [0, 0, 1]);
      expect(Math.hypot(end[0] - t[0], end[1] - t[1], end[2] - t[2])).toBeLessThan(1e-4);
    }
  });
  it('clamps an unreachable target to full reach along the same line', () => {
    const { end } = solve([0, -2, 0], [0, 0, 1]);
    expect(end[1]).toBeCloseTo(1 - 0.8 * 0.9995, 3);
    expect(Math.hypot(end[0], end[2])).toBeLessThan(1e-3);
  });
  it('bends the middle joint toward the pole', () => {
    expect(solve([0, 0.4, 0], [0, 0, 1]).mid[2]).toBeGreaterThan(0.1);
    expect(solve([0, 0.4, 0], [1, 0, 0]).mid[0]).toBeGreaterThan(0.1);
    expect(ikMid.length).toBe(3);
  });
  it('does not flip when the pole lines up with the limb', () => {
    // pole swept through the limb direction: the middle joint must move continuously
    let prev = null, worst = 0;
    for (let a = -0.3; a <= 0.3001; a += 0.01) {
      const m = solve([0, 0.4, 0], [Math.sin(a) * 0.2, -1, 0.0], [0, 0, 1]).mid;
      if (prev) worst = Math.max(worst, Math.hypot(m[0] - prev[0], m[1] - prev[1], m[2] - prev[2]));
      prev = m;
    }
    expect(worst).toBeLessThan(0.08);
  });
  it('allocates nothing it returns and keeps rotations unit length', () => {
    const { q } = solve([0.1, 0.5, 0.2], [0, 0, 1]);
    expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 5);
    expect(Math.hypot(q[4], q[5], q[6], q[7])).toBeCloseTo(1, 5);
  });
});

describe('quaternion helpers', () => {
  it('qFromTo turns one unit vector into another, including opposite ones', () => {
    const q = new Float32Array(4), v = new Float32Array(3);
    qFromTo(q, 0, 0, -1, 0, 0.6, 0, 0.8);
    vRot(v, q, 0, 0, -1, 0);
    expect(v[0]).toBeCloseTo(0.6, 5); expect(v[2]).toBeCloseTo(0.8, 5);
    qFromTo(q, 0, 0, 1, 0, 0, -1, 0);
    vRot(v, q, 0, 0, 1, 0);
    expect(v[1]).toBeCloseTo(-1, 5);
  });
  it('qInvMul undoes qMul', () => {
    const a = new Float32Array(4), b = new Float32Array(4), c = new Float32Array(4), d = new Float32Array(4);
    qEuler(a, 0, 0.3, -0.7, 0.2); qEuler(b, 0, -0.4, 0.5, 1.1);
    qMul(c, 0, a, 0, b, 0); qInvMul(d, 0, a, 0, c, 0);
    for (let i = 0; i < 4; i++) expect(d[i]).toBeCloseTo(b[i], 5);
  });
  it('springTo settles on its target', () => {
    const s = new Float32Array([1, 0]);
    for (let i = 0; i < 600; i++) springTo(s, 0, 0.25, 10, 0.5, 1 / 60);
    expect(s[0]).toBeCloseTo(0.25, 3);
  });
});

// ---- the animator: states, the AI's timeouts, feet that do not slide, falls ----------------
import { MeshBasicMaterial, Vector2, Vector3, Vector4, Color } from 'three';
import { buildZombie } from './body.js';
import { charUniforms } from '../mats/charBody.js';
import { createAnimator, STATES, DURATION } from './anim.js';
import { animState } from './types.js';
import { tuning } from '../game/tuning.js';
import { windowKeys, climbKeys } from './animClips.js';

const G0 = { mats: { cloth: (o) => { const m = new MeshBasicMaterial(); m.surf = { ...charUniforms(o.body, { toColor: (c, d) => new Color(c ?? d) }, { Vector2, Vector3, Vector4, Color }), uShelter: { value: 0 } }; return m; } } };
const make = (seed, opts) => { const z = buildZombie(seed, G0, opts); return { z, a: createAnimator(z) }; };
// what the manager does: move the root by exactly the speed the animator reports
const run = (z, a, seconds, speed, each) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    a.update(1 / 60, speed, 0);
    z.mesh.position.z += Math.cos(z.mesh.rotation.y) * a.rootSpeed / 60; z.mesh.position.x += Math.sin(z.mesh.rotation.y) * a.rootSpeed / 60;
    if (each) each(t);
  }
};
const KINDS = { walker: { variant: 'drifter', build: 'average' }, runner: { variant: 'guest', build: 'gaunt' }, armoured: { variant: 'trooper' }, bloater: { build: 'bloated', sex: 'm' }, brute: { build: 'brute', sex: 'm' } };

describe('animator states', { timeout: 60000 }, () => {
  it('lists every state the manager asks for, for every type', () => {
    for (const [type, opts] of Object.entries(KINDS)) {
      const { a } = make(5, opts);
      for (const s of ['idle', 'walk', 'run', 'crawl', 'attack', 'slam', 'stagger', 'climb', 'window', 'tear', 'burst', 'dead']) expect(a.states, type).toContain(s);
      // no fallback is taken any more
      for (const s of ['run', 'crawl', 'slam', 'tear', 'window', 'burst']) expect(animState(a, s)).toBe(s);
      // each gait of the type's table is a state
      expect(a.states).toContain(tuning.zombies.types[type].gait);
    }
    expect(STATES).toHaveLength(12);
  });
  it('every clip the AI waits on ends inside its timeout', () => {
    expect(DURATION.window).toBeLessThanOrEqual(tuning.zombies.climbMax);
    expect(DURATION.climb).toBeLessThanOrEqual(tuning.zombies.climbMax);
    expect(windowKeys(1, 0.35, 0.9, 0.09).at(-1).t).toBe(DURATION.window);
    expect(climbKeys(1.2, 0.35, 0.9, 0.09).at(-1).t).toBe(DURATION.climb);
    expect(DURATION.tear).toBeLessThanOrEqual(tuning.world.boards.tearEvery);
    expect(DURATION.burst).toBeLessThanOrEqual(tuning.zombies.types.bloater.burst.fuse);
    // and they really do end where the AI expects: idle and done
    for (const [state, opts, max] of [['window', { sill: 1, depth: 0.35 }, 5], ['climb', { height: 1.2, distance: 0.35 }, 5], ['tear', {}, 0.9], ['attack', {}, 1.7], ['slam', {}, 1.7], ['stagger', {}, 1]]) {
      const { z, a } = make(8, state === 'slam' ? KINDS.brute : KINDS.walker);
      a.set(state, opts);
      const z0 = z.mesh.position.z;
      let ended = -1;
      run(z, a, max, 0, (t) => { if (ended < 0 && a.done && a.state === 'idle') ended = t; });
      expect(ended, state).toBeGreaterThan(0);
      expect(ended, state).toBeLessThanOrEqual(max);
      // the climbs carry the root through to the far side
      if (state === 'window' || state === 'climb') expect(z.mesh.position.z - z0).toBeGreaterThan(0.8);
    }
  });
  it('the strike lands at each type\'s wind-up', () => {
    for (const [type, gait] of [['walker', 'walk'], ['runner', 'run'], ['brute', 'run']]) {
      const { z, a } = make(4, KINDS[type]);
      a.set(gait);
      let hitAt = -1, t = 0;
      a.set('attack', { onHit: () => { hitAt = t; } });
      run(z, a, 1.2, 0, (tt) => { t = tt; });
      const w = tuning.zombies.types[type].windup;
      expect(hitAt, type).toBeGreaterThan(w - 0.02);
      expect(hitAt, type).toBeLessThan(w + 0.14);
    }
  });
  it('planted feet do not slide at any type\'s speed (10 mm)', () => {
    for (const [type, opts] of Object.entries(KINDS)) {
      const T = tuning.zombies.types[type];
      const { z, a } = make(6, opts);
      a.set(T.gait);
      const last = [null, null];
      let worst = 0, moved = 0;
      run(z, a, 6, T.speed[1], (t) => {
        if (t < 2) return;
        moved += Math.abs(a.rootSpeed) / 60;
        a.feet.forEach((f, i) => {
          if (f.planted && last[i] && last[i].planted) worst = Math.max(worst, Math.hypot(f.px - last[i].px, f.pz - last[i].pz));
          last[i] = { planted: f.planted, px: f.px, pz: f.pz };
        });
      });
      expect(worst, type).toBeLessThan(0.01);
      // and the body really covers the ground it is asked to (within a fifth)
      expect(moved / 4, type).toBeGreaterThan(T.speed[1] * 0.8);
      expect(moved / 4, type).toBeLessThan(T.speed[1] * 1.2);
    }
  });
  it('a leg lost mid-walk puts it on the ground and keeps it moving', () => {
    const { z, a } = make(9, KINDS.walker);
    a.set('walk'); run(z, a, 1.5, 1.3);
    z.sever('legL'); a.set('crawl');
    const z0 = z.mesh.position.z;
    run(z, a, 4, tuning.zombies.crawler.speed);
    expect(a.prone).toBe(1);
    expect(z.pose.wp[1 * 3 + 1]).toBeLessThan(0.3);                    // the hips are on the ground
    const v = (z.mesh.position.z - z0) / 4;
    expect(v).toBeGreaterThan(tuning.zombies.crawler.speed * 0.6);
    expect(v).toBeLessThan(tuning.zombies.crawler.speed * 1.25);
    // an ankle grab ends too
    a.set('attack'); run(z, a, 1.6, 0);
    expect(a.done).toBe(true);
  });
  it('a bloater swells, and its second burst is the fall', () => {
    const { z, a } = make(3, KINDS.bloater);
    const s0 = z.pose.scale[2 * 3];
    a.set('burst'); run(z, a, 0.8, 0);
    expect(a.state).toBe('burst');
    expect(z.pose.scale[2 * 3]).toBeGreaterThan(s0 * 1.25);
    a.set('burst');
    expect(a.state).toBe('dead');
    expect(a.deathStyle).toBe('burst');
  });
});

describe('falls', { timeout: 60000 }, () => {
  const fall = (seed, style, opts = KINDS.walker, speed = 1.3) => {
    const { z, a } = make(seed, opts);
    a.set(speed > 2 ? 'run' : 'walk'); run(z, a, 2.5, speed);
    a.collapse([0, 0, -1], 1, style);
    let n = 0;
    while (!a.settled && n++ < 400) a.update(1 / 60, 0, 0);
    return { z, a, t: n / 60, p: Array.from(a.ragdoll.p) };
  };
  it('every style comes to rest lying down, in time, with nothing through the floor', () => {
    for (const style of ['head', 'crumple', 'spin', 'blast', 'tumble', 'crawl', 'brute', 'burst']) {
      for (const seed of [2, 3, 4]) {
        const f = fall(seed, style, style === 'brute' ? KINDS.brute : KINDS.walker, style === 'tumble' ? 3.8 : 1.3);
        expect(f.a.settled, style).toBe(true);
        expect(f.t, style).toBeLessThan(4.6);
        for (let i = 0; i < 15; i++) { expect(Number.isFinite(f.p[i * 3 + 1])).toBe(true); expect(f.p[i * 3 + 1], style).toBeGreaterThan(-0.01); }
        // lying: neither sat upright nor propped on its knees with the hips in the air
        const size = style === 'brute' ? 1.35 : 1;
        expect((f.p[10] + f.p[13]) / 2, `${style} shoulders`).toBeLessThan(0.62 * size);
        expect((f.p[1] + f.p[4]) / 2, `${style} hips`).toBeLessThan(0.36 * size);
      }
    }
  });
  it('two neighbours killed the same way never fall alike, and each kind of kill falls its own way', () => {
    const a = fall(2, 'crumple').p, b = fall(3, 'crumple').p;
    let d = 0;
    for (let i = 0; i < 45; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    expect(d).toBeGreaterThan(0.15);
    // a blast throws the body well clear; a headshot drops it near where it stood
    const mid = (p) => Math.hypot((p[0] + p[3]) / 2, (p[2] + p[5]) / 2);
    expect(mid(fall(5, 'blast').p)).toBeGreaterThan(mid(fall(5, 'head').p) + 0.8);
  });
  it('the style follows what the body was doing unless one is given', () => {
    const f = (opts, speed) => { const { z, a } = make(7, opts); a.set(speed > 2 ? 'run' : 'walk'); run(z, a, 3, speed); a.collapse([0, 0, -1], 1); return a; };
    expect(f(KINDS.walker, 1.3).deathStyle).toBe('crumple');
    expect(f(KINDS.runner, 3.8).deathStyle).toBe('tumble');
    expect(f(KINDS.brute, 2.2).deathStyle).toBe('brute');
    const w = f(KINDS.walker, 1.3);
    expect(w.restyle('head', [0, 0, -1], 1)).toBe(true);
    expect(w.deathStyle).toBe('head');
    w.update(1 / 60, 0, 0); w.update(1 / 60, 0, 0); w.update(1 / 60, 0, 0); w.update(1 / 60, 0, 0);
    expect(w.restyle('blast')).toBe(false);          // too late: it is already falling
    expect(f(KINDS.brute, 2.2).restyle('blast')).toBe(false);
  });
});

// ---- how the body carries its weight: pelvis, turns, changes of pace ---------------------------
import { B } from './skeleton.js';

describe('weight', { timeout: 60000 }, () => {
  const hipY = (z) => z.pose.wp[B.hips * 3 + 1];
  // which way a bone faces in the zombie's own frame (0 = straight ahead, + to its left)
  const facing = (z, b) => { const v = new Float32Array(3); vRot(v, z.pose.wq, b * 4, 0, 0, 1); return Math.atan2(v[0], v[2]); };
  const pitch = (z, b) => { const v = new Float32Array(3); vRot(v, z.pose.wq, b * 4, 0, 1, 0); return Math.atan2(v[2], v[1]); };
  // the manager's loop with a script: (t) -> { speed, turn (rad/s) }
  const drive = (z, a, seconds, script, each) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      const c = script(t);
      z.mesh.rotation.y += (c.turn || 0) / 60;
      a.update(1 / 60, c.speed || 0, 0);
      z.mesh.position.z += Math.cos(z.mesh.rotation.y) * a.rootSpeed / 60; z.mesh.position.x += Math.sin(z.mesh.rotation.y) * a.rootSpeed / 60;
      if (each) each(t);
    }
  };
  const twist = (z, a) => Math.max(...a.feet.map((f) => Math.abs(Math.atan2(Math.sin(f.yaw - z.mesh.rotation.y), Math.cos(f.yaw - z.mesh.rotation.y)))));

  it('the pelvis rides each step without a jolt: no corner in its height at a footfall', () => {
    for (const type of ['walker', 'armoured', 'bloater']) {
      for (const seed of [3, 6, 11]) {
        const { z, a } = make(seed, KINDS[type]);
        a.set('walk');
        let y1 = 0, y2 = 0, worst = 0, lo = 9, hi = 0;
        drive(z, a, 6, () => ({ speed: tuning.zombies.types[type].speed[1] }), (t) => {
          const y = hipY(z);
          if (t > 2) { worst = Math.max(worst, Math.abs(y - 2 * y1 + y2) * 3600); lo = Math.min(lo, y); hi = Math.max(hi, y); }
          y2 = y1; y1 = y;
        });
        expect(worst, `${type} ${seed}`).toBeLessThan(60);       // m/s^2: a 20 mm drop in one frame is 72
        expect(hi - lo, `${type} ${seed}`).toBeLessThan(0.1);    // and the bob stays a bob
        expect(hi - lo, `${type} ${seed}`).toBeGreaterThan(0.01);
      }
    }
  });
  it('a runner held to a walk walks: its hips stay up through slowing, stopping and setting off again', () => {
    for (const seed of [3, 6]) {
      const { z, a } = make(seed, KINDS.runner);
      a.set('run');
      let stand = 0, lo = 9;
      drive(z, a, 1, () => ({ speed: 0 }), () => { stand = hipY(z); });
      drive(z, a, 10, (t) => ({ speed: t < 2 ? 3.8 : t < 4 ? 1.1 : t < 6 ? 3.8 : t < 8 ? 0 : 3.8 }), () => { lo = Math.min(lo, hipY(z)); });
      expect(lo, `seed ${seed}`).toBeGreaterThan(stand * 0.68);
    }
  });
  it('a walker sets off with a step, not by sliding away from its feet', () => {
    for (const seed of [3, 6, 9]) {
      const { z, a } = make(seed, KINDS.walker);
      a.set('walk');
      let stand = 0, lo = 9, firstLift = -1;
      drive(z, a, 1, () => ({ speed: 0 }), () => { stand = hipY(z); });
      drive(z, a, 2, () => ({ speed: 1.3 }), (t) => { lo = Math.min(lo, hipY(z)); if (firstLift < 0 && a.feet.some((f) => !f.planted)) firstLift = t; });
      expect(firstLift, `seed ${seed}`).toBeLessThan(0.12);
      expect(lo, `seed ${seed}`).toBeGreaterThan(stand * 0.88);
    }
  });
  it('turned by the simulation, it walks its feet round: no leg is left twisted behind', () => {
    for (const [type, speed] of [['walker', 0], ['walker', 0.4], ['brute', 0], ['bloater', 0.3]]) {
      const { z, a } = make(6, KINDS[type]);
      a.set(tuning.zombies.types[type].gait);
      drive(z, a, 1.5, () => ({ speed: 1.2 }));
      let worst = 0;
      drive(z, a, 3, () => ({ speed, turn: 2.4 }), () => { worst = Math.max(worst, twist(z, a)); });
      expect(worst, `${type} at ${speed}`).toBeLessThan(1.4);      // rad: past 1.6 the foot points backward
      drive(z, a, 1.5, () => ({ speed: 0 }));
      expect(twist(z, a), `${type} at rest`).toBeLessThan(0.75);
    }
  });
  it('a turn reaches the chest and the head late, and they settle back afterwards', () => {
    const { z, a } = make(4, KINDS.walker);
    a.set('walk');
    drive(z, a, 3, () => ({ speed: 1.3 }));
    let c0 = 0, h0 = 0, n = 0;
    drive(z, a, 2, () => ({ speed: 1.3 }), () => { c0 += facing(z, B.spine2); h0 += facing(z, B.head); n++; });
    c0 /= n; h0 /= n;
    let c1 = 0, h1 = 0; n = 0;
    drive(z, a, 1.3, () => ({ speed: 1.3, turn: 2 }), (t) => { if (t > 0.9) { c1 += facing(z, B.spine2); h1 += facing(z, B.head); n++; } });
    c1 /= n; h1 /= n;
    // turning to its left, the chest and the head are still turned to the right of where the feet are going
    expect(c1 - c0).toBeLessThan(-0.08);
    expect(h1 - h0).toBeLessThan(c1 - c0 - 0.02);
    let c2 = 0; n = 0;
    drive(z, a, 3, () => ({ speed: 1.3 }), (t) => { if (t > 1.5) { c2 += facing(z, B.spine2); n++; } });
    expect(Math.abs(c2 / n - c0)).toBeLessThan(0.05);
  });
  it('leans into picking up speed and rocks back when it pulls up', () => {
    const { z, a } = make(4, KINDS.walker);
    a.set('walk');
    drive(z, a, 1, () => ({ speed: 0 }));
    const rest = pitch(z, B.spine2);
    let go = 0, n = 0;
    drive(z, a, 0.6, () => ({ speed: 1.6 }), (t) => { if (t > 0.2) { go += pitch(z, B.spine2); n++; } });
    expect(go / n - rest).toBeGreaterThan(0.04);
    drive(z, a, 3, () => ({ speed: 1.6 }));
    let steady = 0; n = 0;
    drive(z, a, 2, () => ({ speed: 1.6 }), () => { steady += pitch(z, B.spine2); n++; });
    steady /= n;
    let stop = 0; n = 0;
    drive(z, a, 0.45, () => ({ speed: 0 }), (t) => { if (t > 0.15) { stop += pitch(z, B.spine2); n++; } });
    expect(stop / n - steady).toBeLessThan(-0.04);
  });
  it('no two walk in step: each seed has its own cadence', () => {
    const cadence = [3, 4, 5, 6, 7, 8].map((seed) => {
      const { z, a } = make(seed, KINDS.walker);
      a.set('walk');
      let steps = 0;
      a.onStep = () => { steps++; };
      drive(z, a, 10, () => ({ speed: 1.3 }));
      return steps / 10;
    });
    for (const c of cadence) { expect(c).toBeGreaterThan(1.4); expect(c).toBeLessThan(2.7); }   // steps a second: long and slow
    expect(Math.max(...cadence) - Math.min(...cadence)).toBeGreaterThan(0.2);
  });
});
