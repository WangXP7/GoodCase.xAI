// The viewmodel rig's pure half: clip timing against each weapon's reload, the play-name ->
// animation mapping, the pump's travel, and the anim kit (springs and keyframes) the view runs on.
import { describe, it, expect } from 'vitest';
import * as RIG from '../src/weapon/rig.js';
import { key, Spring, smoother } from '../src/weapon/anim.js';
import { tuning } from '../src/game/tuning.js';
import { casingLaunch, lastLaunch, KEEPS_CASE } from '../src/fx/casing.js';

const W = tuning.weapons.table;
const GRANT = tuning.weapons.grantFraction;

describe('reload timing follows the weapon table', () => {
  it('every magazine-like reload ends on the Def and seats its magazine before the logic would fall back', () => {
    for (const d of Object.values(W)) {
      if (d.reloadKind === 'shell') continue;
      const p = RIG.reloadPlan(d);
      expect(p.total).toBeCloseTo(d.reload, 9);
      expect(p.at.done).toBe(p.total);
      expect(p.at.magOut).toBeLessThan(p.at.magIn);
      expect(p.at.magIn).toBeLessThan(p.at.slideRelease);
      expect(p.at.slideRelease).toBeLessThan(p.total);
      // the arsenal grants on the view's magIn, or at the end; magIn sits near its own no-view fraction
      expect(Math.abs(p.at.magIn / p.total - GRANT)).toBeLessThan(0.02);
      expect(p.rate * p.total).toBeCloseTo(RIG.CLOCK, 9);
    }
  });
  it('the pistol keeps the original event times', () => {
    const p = RIG.reloadPlan(W.pistol);
    expect(p.at.magOut).toBeCloseTo(0.22, 9);
    expect(p.at.magIn).toBeCloseTo(1.05, 9);
    expect(p.at.slideRelease).toBeCloseTo(1.3, 9);
    expect(p.total).toBeCloseTo(1.6, 9);
  });
  it('a reload scale (Short Order) scales every mark', () => {
    const a = RIG.reloadPlan(W.smg), b = RIG.reloadPlan(W.smg, 0.6);
    expect(b.total).toBeCloseTo(a.total * 0.6, 9);
    expect(b.at.magIn).toBeCloseTo(a.at.magIn * 0.6, 9);
    expect(RIG.reloadPlan(W.smg, 0).total).toBe(a.total); // a bad scale is ignored
  });
  it('shell reloads: one shellIn per period, each before the arsenal\'s late fallback', () => {
    for (const d of [W.pump, W.autoShotgun]) {
      const p = RIG.reloadPlan(d);
      expect(p.kind).toBe('shell');
      expect(p.per).toBeCloseTo(d.reload, 9);
      for (let i = 0; i < d.mag; i++) {
        const t = p.shellAt(i);
        expect(t).toBeGreaterThan(p.start + i * p.per);
        expect(t).toBeLessThan(p.start + (i + 1) * p.per);
        if (i > 0) expect(t - p.shellAt(i - 1)).toBeCloseTo(p.per, 9);
      }
      // firing.js: without a shellIn the first shell arrives at shellStart + 2 periods
      expect(p.shellAt(0)).toBeLessThan((d.shellStart || 0) + 2 * d.reload);
      expect(p.total(d.mag)).toBeCloseTo(p.shellAt(d.mag - 1), 9);
    }
    expect(RIG.reloadPlan(W.autoShotgun).start).toBeCloseTo(0.5, 9);
  });
  it('durations come from the Def', () => {
    for (const d of Object.values(W)) {
      const t = RIG.durationsFor(d);
      expect(t.fire).toBeCloseTo(60 / d.rpm, 9);
      expect(t.reload).toBeCloseTo(d.reload, 9);
      expect(t.draw).toBeGreaterThan(0.3);
      expect(t.pump).toBeLessThanOrEqual(t.fire); // the pump fits inside the shot period
      expect(t.shellIn).toBe(d.reloadKind === 'shell' ? d.reload : 0);
    }
    expect(RIG.durationsFor(W.pistol, { melee: tuning.weapons.melee.axe }).swing).toBe(0.9);
    expect(RIG.durationsFor(W.pistol, { reloadScale: 0.5 }).reload).toBeCloseTo(0.8, 9);
  });
});

describe('play name -> animation', () => {
  it('maps every name the arsenal sends', () => {
    expect(RIG.animFor('fire', W.pistol, 'slide')).toEqual({ kind: 'overlay', clip: 'fire', follow: null });
    expect(RIG.animFor('fire', W.pump, 'pump').follow).toBe('pump');
    expect(RIG.animFor('fire', W.revolver, 'revolver').follow).toBe('index');
    expect(RIG.animFor('reload', W.pistol, 'slide')).toEqual({ kind: 'clip', clip: 'reload' });
    expect(RIG.animFor('reload', W.revolver, 'revolver').clip).toBe('reload');
    expect(RIG.animFor('reload', W.pump, 'pump').clip).toBe('shell');
    expect(RIG.animFor('shellIn', W.pump, 'pump')).toEqual({ kind: 'clip', clip: 'shell', shells: 1 });
    expect(RIG.animFor('shellIn', W.pistol, 'slide').kind).toBe('none');
    expect(RIG.animFor('empty', W.pistol, 'slide').clip).toBe('lock');
    expect(RIG.animFor('empty', W.smg, 'bolt').clip).toBe('lock');
    expect(RIG.animFor('empty', W.revolver, 'revolver').kind).toBe('none');
    expect(RIG.animFor('empty', W.pump, 'pump').kind).toBe('none');
    expect(RIG.animFor('pump', W.pump, 'pump').kind).toBe('overlay');
    expect(RIG.animFor('pump', W.pistol, 'slide').kind).toBe('none');
    for (const n of ['draw', 'inspect', 'swing', 'throw']) expect(RIG.animFor(n, W.pistol, 'slide')).toEqual({ kind: 'clip', clip: n });
    expect(RIG.animFor('dance', W.pistol, 'slide').kind).toBe('none');
    for (const n of RIG.PLAY_NAMES) expect(['overlay', 'clip', 'none']).toContain(RIG.animFor(n, W.pump, 'pump').kind);
  });
  it('an unknown action behaves as a slide', () => {
    expect(RIG.actionOf('nope')).toBe(RIG.ACTIONS.slide);
    expect(RIG.ACTIONS.pump.eject).toBe('pump');
    expect(RIG.ACTIONS.revolver.eject).toBe('reload');
  });
  it('every weapon has a pose and a clip with the fields the view reads', () => {
    for (const d of Object.values(W)) {
      const pose = RIG.poseFor(d.cls);
      for (const k of ['hip', 'sprint', 'lowered']) { expect(pose[k].pos).toHaveLength(3); expect(pose[k].rot).toHaveLength(3); }
      expect(pose.kick).toHaveLength(5);
      expect(pose.ads).toBeGreaterThan(0);
      const c = RIG.clipFor(d);
      if (d.reloadKind === 'shell') { expect(c.pos).toHaveLength(3); expect(c.carry[0]).toBeLessThan(c.carry[1]); expect(c.carry[1]).toBeLessThan(RIG.SHELL_IN); }
      else {
        for (const k of ['pos', 'rot', 'mix', 'thumb', 'magRel', 'spare']) expect(Array.isArray(c[k])).toBe(true);
        expect(c.spare[c.spare.length - 1][0]).toBe(RIG.MARKS.magIn); // the fresh magazine is home exactly at magIn
        expect(c.spare[c.spare.length - 1][1]).toBe(0);
        expect(c.spare[0][1]).toBe(c.wellStart);
      }
    }
    expect(RIG.clipFor(W.revolver).tracks.crane).toBeTruthy();
    expect(RIG.clipFor(W.revolver).release).toBe('always');
    expect(RIG.clipFor(W.pistol).release).toBe('locked');
    expect(RIG.clipFor(W.pistol, { wellStart: 0.3 }).wellStart).toBe(0.3); // a model's override wins
    expect(RIG.poseFor('pistol', { ads: 0.5 }).ads).toBe(0.5);
    expect(RIG.poseFor('nope')).toBe(RIG.POSES.pistol);
  });
  it('the revolver\'s cylinder is out for the whole exchange and shut before the end', () => {
    const c = RIG.clipFor(W.revolver).tracks.crane;
    expect(key(c, RIG.MARKS.magOut)).toBeGreaterThan(0.99);
    expect(key(c, RIG.MARKS.magIn)).toBe(1);
    expect(key(c, RIG.MARKS.slideRelease + 0.05)).toBe(0);
  });
});

describe('pump travel', () => {
  it('waits out the recoil, comes back, throws the hull while back, and is home at the end', () => {
    expect(RIG.pumpAt(0)).toBe(0);
    expect(RIG.pumpAt(RIG.PUMP.back0)).toBe(0);
    expect(RIG.pumpAt(RIG.PUMP.back1)).toBe(1);
    expect(RIG.pumpAt(RIG.PUMP.eject)).toBeGreaterThan(0.9);
    expect(RIG.pumpAt((RIG.PUMP.back1 + RIG.PUMP.fwd0) / 2)).toBe(1);
    expect(RIG.pumpAt(RIG.PUMP.fwd1)).toBe(0);
    expect(RIG.pumpAt(1)).toBe(0);
    let prev = 0;
    for (let u = RIG.PUMP.back0; u <= RIG.PUMP.back1; u += 0.01) { const v = RIG.pumpAt(u); expect(v).toBeGreaterThanOrEqual(prev - 1e-9); prev = v; }
  });
});

describe('anim kit (the original Spring / key tests)', () => {
  it('key: clamps outside the table, eases inside, writes vectors into out without allocating', () => {
    const k = [[0, 0], [1, 10, 'lin'], [2, 10], [3, 0, 'in']];
    expect(key(k, -1)).toBe(0);
    expect(key(k, 0.5)).toBe(5);
    expect(key(k, 1.5)).toBe(10);
    expect(key(k, 2.5)).toBeCloseTo(7.5, 9); // 'in' = t^2 into the last key
    expect(key(k, 9)).toBe(0);
    const out = [0, 0, 0];
    const v = [[0, [1, 2, 3]], [2, [3, 6, 9], 'lin']];
    expect(key(v, 1, out)).toBe(out);
    expect(out).toEqual([2, 4, 6]);
    // the default ease is smooth: flat at both ends
    const s = [[0, 0], [1, 1]];
    expect(key(s, 0.5)).toBe(0.5);
    expect(key(s, 0.1)).toBeLessThan(0.1);
  });
  it('Spring: a kick rings and dies; the result does not depend on the frame time', () => {
    const run = (dt) => { const s = new Spring(6, 0.55); s.kick(1); let peak = 0; for (let t = 0; t < 1.5 - 1e-9; t += dt) { s.step(dt); peak = Math.max(peak, Math.abs(s.x)); } return { x: s.x, peak }; };
    const a = run(1 / 240), b = run(1 / 30), c = run(1 / 144);
    expect(a.peak).toBeGreaterThan(0.01);
    expect(Math.abs(a.x)).toBeLessThan(1e-3);
    expect(Math.abs(b.peak - a.peak) / a.peak).toBeLessThan(0.12); // the peak is sampled at frame ends
    expect(Math.abs(c.peak - a.peak) / a.peak).toBeLessThan(0.12);
    const s = new Spring(6, 0.55); s.kick(3); s.step(0.1); s.reset();
    expect(s.x).toBe(0); expect(s.v).toBe(0);
    expect(s.step(0)).toBe(0); // a paused frame moves nothing
  });
  it('smoother is clamped and symmetric', () => {
    expect(smoother(-1)).toBe(0); expect(smoother(2)).toBe(1); expect(smoother(0.5)).toBe(0.5);
  });
});

describe('spent cases', () => {
  const rng = { range: (a, b) => (a + b) / 2 };
  it('records each launch for the viewmodel\'s case, and throws nothing for weapons that keep theirs', () => {
    const n = lastLaunch[6];
    const out = casingLaunch({ pos: [0, 1.5, -1], dir: [0, 0, -1], eject: [0.1, 1.4, -0.3], weapon: 'smg' }, rng, null);
    expect(lastLaunch[6]).toBe(n + 1);
    expect(Array.from(lastLaunch).slice(0, 6)).toEqual(out);
    expect(out.slice(0, 3)).toEqual([0.1, 1.4, -0.3]); // it starts at the port
    for (const id of Object.keys(KEEPS_CASE)) expect(casingLaunch({ pos: [0, 1.5, -1], dir: [0, 0, -1], eject: [0, 1, 0], weapon: id }, rng, null)).toBe(null);
    expect(lastLaunch[6]).toBe(n + 1);
    expect(KEEPS_CASE.pistol).toBeUndefined();
  });
});
