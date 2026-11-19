import { describe, it, expect } from 'vitest';
import { createLoop, LOOP_ORDER, GAMEPLAY } from '../src/core/loop.js';

function mockG(params = {}, overrides = {}) {
  const calls = [];
  const G = { params, time: { t: 0, dt: 0, frame: 0, real: 0 }, post: { render: () => calls.push('render') }, calls };
  for (const n of LOOP_ORDER) G[n] = { update: (dt) => calls.push([n, dt]) };
  Object.assign(G, overrides);
  return G;
}

describe('loop', () => {
  it('hints runs last, after ui', () => {
    expect(LOOP_ORDER.at(-1)).toBe('hints');
    expect(LOOP_ORDER.at(-2)).toBe('ui');
  });
  it('a throwing hints.update does not stop the frame', () => {
    const errors = [];
    const G = mockG({}, { hints: { update() { throw new Error('hint boom'); } } });
    createLoop(G, { onError: (m) => errors.push(m) }).frame(0.016);
    expect(G.calls).toContain('render');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('hints');
  });
  it('hints is not a gameplay module: it keeps its dt while paused', () => {
    const G = mockG();
    let got = null;
    G.game = { state: 'paused', update() {} };
    G.hints = { update: (dt) => { got = dt; } };
    createLoop(G, { onError() {} }).frame(0.016);
    expect(got).toBe(0.016);
  });
  it('updates modules in contract order, then renders', () => {
    const G = mockG();
    createLoop(G, { onError() {} }).frame(0.016);
    expect(G.calls.map((c) => (Array.isArray(c) ? c[0] : c))).toEqual([...LOOP_ORDER, 'render']);
  });
  it('clamps dt to 0.05', () => {
    const G = mockG();
    createLoop(G, { onError() {} }).frame(1.5);
    expect(G.time.dt).toBe(0.05);
    expect(G.calls[0][1]).toBe(0.05);
  });
  it('params.dt overrides the clamp', () => {
    const G = mockG({ dt: 0.2 });
    createLoop(G, { onError() {} }).frame(0.001);
    expect(G.time.dt).toBe(0.2);
  });
  it('a throwing module does not stop the others and is reported', () => {
    const errors = [];
    const G = mockG({}, { player: { update() { throw new Error('boom'); } } });
    createLoop(G, { onError: (m) => errors.push(m) }).frame(0.016);
    const ran = G.calls.map((c) => (Array.isArray(c) ? c[0] : c));
    expect(ran).toContain('weapon'); expect(ran).toContain('ui'); expect(ran).toContain('render');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('player');
  });
  it('advance simulates `seconds` total with the default step', () => {
    const G = mockG();
    createLoop(G, { onError() {} }).advance(5);
    expect(Math.abs(G.time.t - 5)).toBeLessThanOrEqual(1 / 60);
  });
  it('advance with params.dt simulates `seconds`, not more (adv=5&dt=0.1)', () => {
    const G = mockG({ dt: 0.1 });
    createLoop(G, { onError() {} }).advance(5);
    expect(Math.abs(G.time.t - 5)).toBeLessThanOrEqual(0.1);
    expect(G.time.frame).toBe(50);
  });
  it('advance does not render', () => {
    const G = mockG();
    createLoop(G, { onError() {} }).advance(0.1);
    expect(G.calls).not.toContain('render');
  });

  describe('central pause', () => {
    const dts = (G) => Object.fromEntries(G.calls.filter(Array.isArray));
    const run = (state, extra = {}) => {
      const G = mockG({}, extra);
      G.game = { state, update: (dt) => G.calls.push(['game', dt]) };
      createLoop(G, { onError() {} }).frame(0.016);
      return G;
    };
    it('playing: every module gets the frame dt and the sim clock advances', () => {
      const G = run('playing');
      for (const n of LOOP_ORDER) expect(dts(G)[n]).toBe(0.016);
      expect(G.time.sim).toBeCloseTo(0.016);
      expect(G.time.simDt).toBe(0.016);
    });
    for (const state of ['paused', 'title']) {
      it(`${state}: gameplay modules get dt 0, the rest keep running, the frame still renders`, () => {
        const G = run(state);
        const d = dts(G);
        for (const n of LOOP_ORDER) expect(d[n]).toBe(GAMEPLAY.has(n) ? 0 : 0.016);
        expect([...GAMEPLAY].sort()).toEqual(['fx', 'game', 'level', 'player', 'weapon', 'zombies']);
        expect(G.calls).toContain('render');
        expect(G.time.t).toBeCloseTo(0.016); // frame clock: flicker and rain go on
        expect(G.time.sim).toBe(0); // simulation clock: stopped
      });
    }
    it('dead: the simulation keeps running so the death slump and falling bodies finish', () => {
      const d = dts(run('dead'));
      expect(d.zombies).toBe(0.016); expect(d.player).toBe(0.016);
    });
    it('gameplay modules also get the real frame dt as a second argument while paused', () => {
      const G = mockG();
      let got = null;
      G.game = { state: 'paused', update() {} };
      G.fx = { update: (dt, real) => { got = [dt, real]; } };
      createLoop(G, { onError() {} }).frame(0.016);
      expect(got).toEqual([0, 0.016]);
    });
    it('a game that starts during its own update runs the rest of that frame', () => {
      const G = mockG();
      G.game = { state: 'title', update() { this.state = 'playing'; } };
      createLoop(G, { onError() {} }).frame(0.016);
      expect(dts(G).player).toBe(0.016);
    });
    it('a pause over 10 s does not move the sim clock; resume continues from where it stopped', () => {
      const G = mockG();
      G.game = { state: 'playing', update() {} };
      const loop = createLoop(G, { onError() {} });
      loop.frame(0.016);
      G.game.state = 'paused';
      for (let i = 0; i < 600; i++) loop.frame(0.016);
      G.game.state = 'playing';
      loop.frame(0.016);
      expect(G.time.sim).toBeCloseTo(0.032);
      expect(G.time.t).toBeCloseTo(0.016 * 602);
    });
    it('stub game: runs unless the input itself is paused', () => {
      expect(dts(run('title', { }))).toBeTruthy();
      const G = mockG();
      G.game = { stub: true, state: 'title', update() {} };
      createLoop(G, { onError() {} }).frame(0.016);
      expect(dts(G).zombies).toBe(0.016);
      const H = mockG();
      H.game = { stub: true, state: 'title', update() {} };
      H.input = { paused: true, update: (dt) => H.calls.push(['input', dt]) };
      createLoop(H, { onError() {} }).frame(0.016);
      expect(dts(H).zombies).toBe(0);
    });
  });
});
