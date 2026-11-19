import { describe, it, expect } from 'vitest';
import { createPassStats, readStats } from '../src/core/harness.js';

// A post chain that draws like the real one: scene render, then passes, with renderer.info counting.
function fakePost() {
  const info = { render: { calls: 0, triangles: 0 } };
  const draw = (calls, tris) => { info.render.calls += calls; info.render.triangles += tris; };
  const passes = [
    { name: 'ao', render() { draw(1, 2); } },
    { name: 'bloom', render() { draw(6, 12); } },
  ];
  const post = {
    passes,
    eachPass(fn) { for (const p of passes) fn(p); },
    render() {
      info.render.calls = 0; info.render.triangles = 0; // renderer.info.reset()
      draw(100, 5000); // the scene
      passes[0].render(post);
      draw(1, 1); // the combine blit between passes
      passes[1].render(post);
    },
  };
  return { post, info };
}

describe('createPassStats', () => {
  it('attributes each pass its own draw calls and triangles, the rest to scene', () => {
    const { post, info } = fakePost();
    const G = { post, renderer: { info } };
    const ps = createPassStats(G);
    post.render();
    const by = Object.fromEntries(ps.read().map((r) => [r.pass, r]));
    expect(by.ao).toEqual({ pass: 'ao', calls: 1, triangles: 2 });
    expect(by.bloom).toEqual({ pass: 'bloom', calls: 6, triangles: 12 });
    expect(by.scene.calls).toBe(101); // the scene plus the combine blit (not a pass of its own)
    expect(ps.read().reduce((s, r) => s + r.calls, 0)).toBe(info.render.calls);
  });
  it('forgets the previous frame', () => {
    const { post, info } = fakePost();
    const ps = createPassStats({ post, renderer: { info } });
    post.render(); post.render();
    expect(ps.read().find((r) => r.pass === 'ao').calls).toBe(1);
  });
  it('does nothing when the post chain is a stub', () => {
    const ps = createPassStats({ post: { stub: true, render() {} }, renderer: { info: { render: {} } } });
    expect(ps.read()).toEqual([]);
  });
});

describe('readStats', () => {
  it('adds the extended fields with safe defaults when the modules do not exist yet', () => {
    const s = readStats({ quality: { name: 'high' } }, { fps: 60, frameMs: 5 });
    expect(s).toMatchObject({ tier: 'high', renderScale: 1, inputMode: null, zone: null, weapon: null, power: false, plates: 0 });
  });
  it('reads them from the modules that own them', () => {
    const G = {
      quality: { name: 'mobile', tier: 'mobile', renderScale: 0.75 }, input: { mode: 'touch' },
      level: { zone: 'diner', power: { on: true } }, weapon: { id: 'smg' }, player: { plates: 2 },
    };
    expect(readStats(G, { fps: 30, frameMs: 9 })).toMatchObject({ tier: 'mobile', renderScale: 0.75, inputMode: 'touch', zone: 'diner', weapon: 'smg', power: true, plates: 2 });
  });
});
