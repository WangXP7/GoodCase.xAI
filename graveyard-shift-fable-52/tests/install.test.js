// Launch fix: modules that used to install themselves through window.__G are wired once by the boot
// (gore in main.js; the vehicle and area-art layers in createLevel, checked in the browser by the
// smoke's layer check). Here: gore made by the boot is the one the animators' own way in returns.
import { describe, it, expect, afterEach } from 'vitest';
import { createGore, ensureGore, forgetGore } from '../src/zombie/gore.js';
import { createEvents } from '../src/core/events.js';
import { createRng } from '../src/core/rng.js';

afterEach(() => { forgetGore(); delete globalThis.__G; });

describe('gore is installed once', () => {
  it('a second createGore returns the first; ensureGore hands back the boot-wired module', () => {
    const G = { params: {}, events: createEvents((e) => { throw e; }), rng: createRng(1), time: { t: 0, dt: 0, frame: 0 } };
    const g = createGore(G);
    expect(G.gore).toBe(g);
    expect(createGore(G)).toBe(g);
    globalThis.__G = G;
    expect(ensureGore()).toBe(g);
    expect(ensureGore()).toBe(g);
  });
});
