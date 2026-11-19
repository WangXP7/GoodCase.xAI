import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TIPS, TIP_MS, tipText, tipIndex } from '../src/ui/loading.js';
import { tuning } from '../src/game/tuning.js';

const root = resolve(import.meta.dirname, '..');
const all = (touch) => TIPS.map((t) => tipText(t, touch)).join('\n');

describe('loading screen tips', () => {
  it('has 10 to 12 tips, each a short line, rotating every 4 s', () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(10);
    expect(TIPS.length).toBeLessThanOrEqual(12);
    expect(TIP_MS).toBe(4000);
    for (const t of TIPS) {
      expect(typeof t.key).toBe('string');
      expect(t.key.length).toBeLessThanOrEqual(110);
      if (t.touch) expect(t.touch.length).toBeLessThanOrEqual(110);
    }
  });

  it('quotes the tuning, not made-up numbers', () => {
    const e = tuning.economy, w = tuning.world;
    const text = all(false);
    expect(text).toContain(`hit pays ${e.points.hit} points, a kill ${e.points.kill}, a headshot kill ${e.points.headshotKill}`);
    expect(text).toContain(`Knife kills pay ${e.points.meleeKill}`);
    expect(text).toContain(`weapon box is ${e.box.cost}`);
    expect(text).toContain(`within ${e.box.offer} seconds`);
    expect(text).toContain(`stronger for ${e.bench.cost}`);
    expect(text).toContain(`diner is ${w.doors.d1}`);
    expect(text).toContain(`${w.boards.repairPoints} points a board, up to ${w.boards.repairCapPerRound} a round`);
    expect(text).toContain(`Pistol ammo is ${e.wallAmmo.cost}`);
    expect(text).toContain(`Pistol ammo is ${e.crateAmmo.pistol}`);
    expect(text).toMatch(/ammo crate .*fills whatever gun you're holding/);
    expect(text).toContain(`for ${e.powerups.ttl} seconds`);
    expect(text).toContain(`You can wear ${['zero', 'one', 'two', 'three', 'four'][tuning.touch.maxPlates]}`);
    expect(text).toMatch(/can't shoot while you're sprinting/);
  });

  it('names keys on a keyboard and buttons on touch', () => {
    expect(all(false)).toMatch(/press V/);
    expect(all(false)).toMatch(/Hold F to search/);
    expect(all(false)).toMatch(/Hold Shift/);
    const touch = all(true);
    expect(touch).not.toMatch(/\b(press V|Hold F|Shift)\b/);
    expect(touch).toMatch(/Hold SEARCH/);
    expect(touch).toMatch(/Hold REPAIR/);
    expect(touch).toMatch(/Push the stick/);
  });

  it('starts from the clock and walks every tip in turn', () => {
    const n = TIPS.length;
    expect(tipIndex(0, 0)).toBe(0);
    expect(tipIndex(5000, 0)).toBe(5 % n);
    const seen = new Set();
    for (let s = 0; s < n; s++) seen.add(tipIndex(123456789, s));
    expect(seen.size).toBe(n);
  });
});

describe('loading screen build inputs', () => {
  it('the inlined art is small enough and the placeholder is tiny', () => {
    const art = readFileSync(resolve(root, 'assets/keyart/keyart-1280.webp'));
    const lqip = readFileSync(resolve(root, 'assets/keyart/keyart-lqip.webp'));
    expect(art.subarray(8, 12).toString()).toBe('WEBP');
    expect(art.length).toBeLessThanOrEqual(150 * 1024);
    expect(lqip.length).toBeLessThanOrEqual(2048);
    const og = readFileSync(resolve(root, 'assets/keyart/og.jpg'));
    expect(og[0]).toBe(0xff); expect(og[1]).toBe(0xd8); // JPEG
    expect(og.length).toBeLessThanOrEqual(300 * 1024);
  });

  it('index.html carries the link-preview meta and the hooks main.js and the build need', () => {
    const html = readFileSync(resolve(root, 'src/index.html'), 'utf8');
    for (const s of [
      'property="og:image" content="https://zombies.ethanplus.ai/og.jpg"', 'property="og:image:width" content="1200"',
      'property="og:image:height" content="630"', 'name="twitter:card" content="summary_large_image"',
      'name="twitter:site" content="@ethanplusai"', 'name="twitter:creator" content="@ethanplusai"',
      'property="og:url" content="https://zombies.ethanplus.ai/"', 'name="theme-color"', 'rel="icon" type="image/svg+xml" href="data:',
      'id="boot"', 'id="boot-bar"', 'id="boot-label"', '<!--LOADING_CSS-->', '<!--LOADING_JS-->', '<!--INLINE_JS-->',
    ]) expect(html).toContain(s);
  });
});
