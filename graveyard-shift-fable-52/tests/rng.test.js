import { describe, it, expect } from 'vitest';
import { createRng } from '../src/core/rng.js';

const take = (r, n = 5) => Array.from({ length: n }, () => r.next());

describe('createRng', () => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(take(createRng(1))).toEqual(take(createRng(1)));
    expect(take(createRng(1))).not.toEqual(take(createRng(2)));
  });
  it('next is in [0,1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('fork streams differ by label and are stable', () => {
    expect(take(createRng(1).fork('a'))).not.toEqual(take(createRng(1).fork('b')));
    expect(take(createRng(1).fork('a'))).toEqual(take(createRng(1).fork('a')));
  });
  it('fork is unaffected by how much the parent has been consumed', () => {
    const p = createRng(3);
    const before = take(p.fork('x'));
    take(p, 10);
    expect(take(p.fork('x'))).toEqual(before);
  });
  it('range, int, pick stay in bounds', () => {
    const r = createRng(9);
    for (let i = 0; i < 500; i++) {
      const f = r.range(2, 5); expect(f).toBeGreaterThanOrEqual(2); expect(f).toBeLessThan(5);
      const n = r.int(1, 3); expect([1, 2, 3]).toContain(n);
    }
    expect(['a', 'b']).toContain(r.pick(['a', 'b']));
  });
});
