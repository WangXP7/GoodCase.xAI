import { describe, it, expect } from 'vitest';
import { createAimState, step } from '../src/player/aimAssist.js';
import { tuning } from '../src/game/tuning.js';

const T = tuning.touch;
const DEG = Math.PI / 180;
const CAM = [0, 1.6, 0];
// A point `deg` degrees to the right of straight ahead (-Z) at `dist` metres, at eye height.
const at = (deg, dist = 10, up = 0) => [Math.sin(deg * DEG) * dist, 1.6 + Math.sin(up * DEG) * dist, -Math.cos(deg * DEG) * dist];
const FWD = [0, 0, -1];
const ctx = (targets, extra = {}) => ({ camPos: CAM, camDir: FWD, targets, dt: 1 / 60, moving: false, T, assist: 2, range: 60, ...extra });

describe('aim assist', () => {
  it('friction: 1 deg off a head gives scale 0.55; 5 deg off gives 1', () => {
    expect(step(createAimState(), ctx([at(1)])).scale).toBe(T.frictionScale);
    expect(step(createAimState(), ctx([at(5)])).scale).toBe(1);
  });

  it('magnetism turns toward the nearest target at no more than 12 deg/s, and not with the stick centred', () => {
    const s = createAimState();
    const r = step(s, ctx([at(3), at(-3.5)], { moving: true }));
    expect(r.yaw).toBeLessThan(0); // toward +X: yaw turns right (negative)
    expect(Math.hypot(r.yaw, r.pitch)).toBeLessThanOrEqual(T.magnetDegPerS * DEG / 60 + 1e-9);
    expect(Math.hypot(r.yaw, r.pitch)).toBeGreaterThan(0);
    const still = step(createAimState(), ctx([at(3)], { moving: false }));
    expect(still.yaw).toBe(0);
    expect(still.pitch).toBe(0);
    const outside = step(createAimState(), ctx([at(6)], { moving: true }));
    expect(outside.yaw).toBe(0);
    const up = step(createAimState(), ctx([at(0, 10, 2)], { moving: true }));
    expect(up.pitch).toBeGreaterThan(0);
  });

  it('magnetism never moves more than 0.6 deg in one frame, and never past the target', () => {
    const big = step(createAimState(), ctx([at(3)], { moving: true, dt: 0.1 }));
    expect(Math.hypot(big.yaw, big.pitch)).toBeLessThanOrEqual(T.magnetMaxStepDeg * DEG + 1e-9);
    const close = step(createAimState(), ctx([at(0.05)], { moving: true, dt: 0.1 }));
    expect(Math.abs(close.yaw)).toBeLessThanOrEqual(0.05 * DEG + 1e-9);
  });

  it('fire after 0.12 s continuously on target, false the frame the aim leaves it', () => {
    const s = createAimState();
    let r;
    for (let i = 0; i < 7; i++) r = step(s, ctx([at(0.3)])); // 0.117 s
    expect(r.fire).toBe(false);
    r = step(s, ctx([at(0.3)]));
    expect(r.fire).toBe(true);
    r = step(s, ctx([at(3)]));
    expect(r.fire).toBe(false);
    r = step(s, ctx([at(0.3)]));
    expect(r.fire).toBe(false); // the timer starts over
  });

  it('a given ray result (hit) decides on-target when present', () => {
    const s = createAimState();
    let r;
    for (let i = 0; i < 10; i++) r = step(s, ctx([at(3)], { hit: true }));
    expect(r.fire).toBe(true);
    r = step(s, ctx([at(0)], { hit: false }));
    expect(r.fire).toBe(false);
  });

  it('nothing beyond weapon range', () => {
    const s = createAimState();
    let r;
    for (let i = 0; i < 20; i++) r = step(s, ctx([at(1, 30)], { range: 20, moving: true }));
    expect(r).toMatchObject({ scale: 1, yaw: 0, pitch: 0, fire: false });
  });

  it('assist 0 returns identity; assist 1 has friction but no magnetism', () => {
    const s = createAimState();
    let r;
    for (let i = 0; i < 20; i++) r = step(s, ctx([at(1)], { assist: 0, moving: true }));
    expect(r).toMatchObject({ scale: 1, yaw: 0, pitch: 0, fire: false });
    r = step(createAimState(), ctx([at(1)], { assist: 1, moving: true }));
    expect(r.scale).toBe(T.frictionScale);
    expect(r.yaw).toBe(0);
  });

  it('no targets: identity, and the result object is reused', () => {
    const s = createAimState();
    const a = step(s, ctx([]));
    expect(a).toMatchObject({ scale: 1, yaw: 0, pitch: 0, fire: false });
    expect(step(s, ctx([]))).toBe(a);
  });
});
