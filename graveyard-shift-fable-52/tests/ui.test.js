import { describe, it, expect } from 'vitest';
import { formatPoints, denyText, promptString, promptParts, interactVerb, qualityLabel, needsQualityConfirm, keyLabel, CONTROLS, ammoView, remaining, sanitizeSettings, SETTING_RANGES } from '../src/ui/format.js';
import { createSettings } from '../src/ui/settings.js';

describe('ui format helpers', () => {
  it('groups points with no-break spaces', () => {
    expect(formatPoints(4350)).toBe('4 350');
    expect(formatPoints(500)).toBe('500');
    expect(formatPoints(1234567)).toBe('1 234 567');
    expect(formatPoints(-250)).toBe('-250');
    expect(formatPoints(undefined)).toBe('0');
  });
  it('builds the interact prompt', () => {
    expect(promptString({ label: 'Ammo', cost: 250 })).toBe('Press F — Ammo · 250');
    expect(promptString({ label: 'Diner', cost: 1500 })).toBe('Press F — Diner · 1 500');
    expect(promptString({ label: 'Door', cost: 0 })).toBe('Press F — Door');
    expect(promptString(null)).toBe('');
    // a door that cannot be bought offers no key and no price
    expect(promptString({ kind: 'lockedDoor', label: 'Diner', cost: 750 })).toBe('Diner — Locked');
  });
  it('maps purchase refusals to copy', () => {
    expect(denyText('points')).toBe('Not enough points');
    expect(denyText('full')).toBe('Ammo full');
    expect(denyText('locked')).toBe('Locked');
    expect(denyText('weird')).toBe('Unavailable');
  });
  it('reads ammo defensively', () => {
    expect(ammoView(undefined)).toEqual({ mag: null, reserve: null, name: 'Pistol' });
    expect(ammoView({ ammo: { mag: 9, reserve: 48 }, name: 'Revolver' })).toEqual({ mag: 9, reserve: 48, name: 'Revolver' });
    expect(ammoView({ ammo: {} }).mag).toBeNull();
  });
  it('counts zombies remaining', () => {
    expect(remaining(undefined)).toBeNull();
    expect(remaining({ total: 10, spawned: 4, alive: 2 })).toBe(8);
    expect(remaining({ total: 10, spawned: 10, alive: 0 })).toBe(0);
  });
  it('clamps and ignores junk settings', () => {
    const s = sanitizeSettings({ quality: 'ultra', sens: 99, fov: 20, volume: '0.4' });
    expect(s.quality).toBeUndefined();
    expect(s.sens).toBe(SETTING_RANGES.sens.max);
    expect(s.fov).toBe(70);
    expect(s.volume).toBe(0.4);
    expect(sanitizeSettings(null)).toEqual({});
    expect(sanitizeSettings({ fov: 'abc', sens: '' })).toEqual({});
  });
});

import { createTitleCam } from '../src/ui/titlecam.js';
describe('title camera ownership', () => {
  const mk = (params = {}, shotCam = { cam: [0, 1.5, 5.2, 0, -0.06], fov: 55 }) => ({
    params, shotCam, level: { shots: { title: { cam: [1, 2, 3, 0.1, 0.2], fov: 50 } } },
  });
  it('applies on title and releases on play', () => {
    const G = mk(); const t = createTitleCam(G);
    t.sync('title');
    expect(G.shotCam.cam).toEqual([1, 2, 3, 0.1, 0.2]);
    t.sync('playing');
    expect(G.shotCam).toBeNull();
  });
  it('releases a spread copy with the same values', () => {
    const G = mk(); const t = createTitleCam(G);
    t.sync('title');
    G.shotCam = { ...G.shotCam, fov: 70 };
    t.sync('playing');
    expect(G.shotCam).toBeNull();
  });
  it('leaves a different camera alone', () => {
    const G = mk(); const t = createTitleCam(G);
    t.sync('title');
    const other = { cam: [9, 9, 9, 0, 0], fov: 40 };
    G.shotCam = other;
    t.sync('playing');
    expect(G.shotCam).toBe(other);
  });
  it('does nothing with shot= or cam= params', () => {
    const G = mk({ shot: 'title' }); const before = G.shotCam; const t = createTitleCam(G);
    t.sync('title'); t.sync('playing');
    expect(G.shotCam).toBe(before);
    const H = mk({ cam: [0, 0, 0, 0, 0] }); const b2 = H.shotCam;
    createTitleCam(H).sync('title');
    expect(H.shotCam).toBe(b2);
  });
});

describe('prompt copy per device', () => {
  const ammo = { kind: 'wallAmmo', label: 'Ammo', cost: 250 };
  it('names the on-screen button on touch', () => {
    expect(promptString(ammo, 'touch')).toBe('Tap BUY: Ammo — 250');
    expect(promptString(ammo)).toBe('Press F — Ammo · 250');
    expect(promptString({ kind: 'power', label: 'Power', cost: 0 }, 'touch')).toBe('Tap USE: Power');
    expect(promptString({ kind: 'door', label: 'Diner', cost: 0 }, 'touch')).toBe('Tap OPEN: Diner');
  });
  it('says Hold for a hold, in both modes', () => {
    const search = { kind: 'search', label: 'Crate', cost: 0, hold: 2 };
    expect(promptString(search, 'touch')).toBe('Hold SEARCH: Crate');
    expect(promptString(search)).toBe('Hold F — Crate');
    expect(promptString({ kind: 'boards', label: 'Boards', cost: 0, hold: 0.6 }, 'touch')).toBe('Hold REPAIR: Boards');
  });
  it('a locked door has no key on either device', () => {
    expect(promptString({ kind: 'lockedDoor', label: 'Diner', cost: 750 }, 'touch')).toBe('Diner — Locked');
    expect(promptParts({ kind: 'lockedDoor', label: 'Diner' }, 'touch').key).toBeNull();
  });
  it('the verb on the interact button', () => {
    expect(interactVerb(ammo)).toBe('BUY');
    expect(interactVerb({ kind: 'search' })).toBe('SEARCH');
    expect(interactVerb(null)).toBe('USE');
  });
  it('keyLabel gives the key on a keyboard and the button on touch', () => {
    expect(keyLabel('interact')).toBe('F');
    expect(keyLabel('reload')).toBe('R');
    expect(keyLabel('reload', true)).toBe('RELOAD');
    expect(keyLabel('interact', true, ammo)).toBe('BUY');
    expect(keyLabel('interact', true)).toBe('USE');
  });
  it('the controls card lists every action', () => {
    const ids = CONTROLS.map((c) => c.id);
    for (const a of ['move', 'look', 'fire', 'ads', 'reload', 'interact', 'jump', 'sprint', 'swap', 'melee', 'throw', 'pause']) expect(ids).toContain(a);
    expect(ids).toContain('hint');
    for (const c of CONTROLS) { expect(c.key).toBeTruthy(); expect(c.touch).toBeTruthy(); }
  });
});

describe('sanitizeSettings, extended keys', () => {
  it('accepts the touch settings and clamps them', () => {
    expect(sanitizeSettings({ touchSens: 0.1 }).touchSens).toBe(0.5);
    expect(sanitizeSettings({ touchSens: 9 }).touchSens).toBe(2);
    expect(sanitizeSettings({ touchSens: '1.25' }).touchSens).toBe(1.25);
    expect(sanitizeSettings({ autoFire: false }).autoFire).toBe(false);
    expect(sanitizeSettings({ autoFire: 'yes' }).autoFire).toBeUndefined();
    expect(sanitizeSettings({ assist: 1 }).assist).toBe(1);
    expect(sanitizeSettings({ assist: 7 }).assist).toBe(2);
    expect(sanitizeSettings({ assist: -3 }).assist).toBe(0);
    expect(sanitizeSettings({ lefty: true }).lefty).toBe(true);
    expect(sanitizeSettings({ lefty: 1 }).lefty).toBeUndefined();
  });
  it('quality, resolution and gore take only their values', () => {
    for (const q of ['auto', 'mobile', 'low', 'medium', 'high']) expect(sanitizeSettings({ quality: q }).quality).toBe(q);
    expect(sanitizeSettings({ quality: 'ultra' }).quality).toBeUndefined();
    expect(sanitizeSettings({ resolution: 'auto' }).resolution).toBe('auto');
    expect(sanitizeSettings({ resolution: 0.8 }).resolution).toBe(0.8);
    expect(sanitizeSettings({ resolution: 0.2 }).resolution).toBe(0.6);
    expect(sanitizeSettings({ resolution: 4 }).resolution).toBe(1);
    expect(sanitizeSettings({ resolution: 'high' }).resolution).toBeUndefined();
    expect(sanitizeSettings({ gore: 'reduced' }).gore).toBe('reduced');
    expect(sanitizeSettings({ gore: 'full' }).gore).toBe('full');
    expect(sanitizeSettings({ gore: 'lots' }).gore).toBeUndefined();
  });
});

// A window whose localStorage works, or one that throws on every call (a sandboxed frame).
const withStorage = (ls, fn) => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prev = globalThis.window;
  globalThis.window = { localStorage: ls };
  try { return fn(); } finally { if (had) globalThis.window = prev; else delete globalThis.window; }
};
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const fakeG = (extra = {}) => ({
  params: {}, input: { sensitivity: 0.002, touch: { autoFire: true, assist: 2, sensitivity: 1, lefty: false } },
  quality: { auto: false, tier: 'high', calls: [], set(n) { this.calls.push(['set', n]); this.tier = n; return true; }, setAuto(on) { this.calls.push(['auto', on]); this.auto = on; return Promise.resolve('high'); }, setRenderScale(v) { this.calls.push(['rs', v]); return true; } },
  fx: {}, game: { state: 'title' }, ...extra,
});

describe('settings', () => {
  it('gore defaults to full; reduced sets G.fx.gore to 0.3 and emits nothing', () => {
    withStorage(memory(), () => {
      const emitted = [];
      const G = fakeG({ events: { emit: (...a) => emitted.push(a), on() {} } });
      const s = createSettings(G);
      s.applyAll();
      expect(s.gore).toBe('full'); expect(G.fx.gore).toBe(1);
      s.set('gore', 'reduced');
      expect(s.gore).toBe('reduced'); expect(G.fx.gore).toBe(0.3);
      s.set('gore', 'full');
      expect(G.fx.gore).toBe(1);
      expect(emitted).toEqual([]);
    });
  });
  it('persists through the store and reads back on the next boot', () => {
    const ls = memory();
    withStorage(ls, () => {
      const a = createSettings(fakeG());
      a.set('gore', 'reduced'); a.set('touchSens', 1.5); a.set('autoFire', false); a.set('assist', 1); a.set('lefty', true); a.set('resolution', 0.8); a.set('quality', 'low');
    });
    withStorage(ls, () => {
      const G = fakeG();
      const b = createSettings(G);
      b.applyAll();
      expect(b.gore).toBe('reduced'); expect(G.fx.gore).toBe(0.3);
      expect(b.touchSens).toBe(1.5); expect(G.input.touch.sensitivity).toBe(1.5);
      expect(b.autoFire).toBe(false); expect(G.input.touch.autoFire).toBe(false);
      expect(b.assist).toBe(1); expect(G.input.touch.assist).toBe(1);
      expect(b.lefty).toBe(true); expect(G.input.touch.lefty).toBe(true);
      expect(G.quality.calls).toContainEqual(['rs', 0.8]);
      expect(G.quality.calls).toContainEqual(['set', 'low']);
    });
  });
  it('survives a store that throws on every call', () => {
    const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    withStorage(boom, () => {
      const G = fakeG();
      const s = createSettings(G);
      expect(() => s.applyAll()).not.toThrow();
      expect(() => s.set('gore', 'reduced')).not.toThrow();
      expect(s.gore).toBe('reduced'); expect(G.fx.gore).toBe(0.3); // this visit only
      s.set('lefty', true);
      expect(G.input.touch.lefty).toBe(true);
    });
  });
  it('junk in storage is ignored', () => {
    const ls = memory(); ls.setItem('graveyard-shift.settings', '{"gore":"gruesome","assist":99,"lefty":"x"}');
    withStorage(ls, () => {
      const s = createSettings(fakeG());
      expect(s.gore).toBe('full'); expect(s.assist).toBe(2); expect(s.lefty).toBe(false);
    });
    const bad = memory(); bad.setItem('graveyard-shift.settings', 'not json');
    withStorage(bad, () => { expect(createSettings(fakeG()).gore).toBe('full'); });
  });
  it('a ?gore= harness param wins over the saved value', () => {
    const ls = memory(); ls.setItem('graveyard-shift.settings', '{"gore":"full"}');
    withStorage(ls, () => {
      const G = fakeG(); G.params.gore = 'reduced';
      const s = createSettings(G); s.applyAll();
      expect(G.fx.gore).toBe(0.3);
    });
  });
  it('Auto quality runs at once on the title, but waits for the next idle screen mid-round', () => {
    withStorage(memory(), () => {
      const G = fakeG();
      const s = createSettings(G);
      s.set('quality', 'auto');
      expect(G.quality.calls).toContainEqual(['auto', true]);
      const H = fakeG({ game: { state: 'paused' } });
      const t = createSettings(H);
      t.set('quality', 'auto');
      expect(H.quality.calls).toEqual([]);
      expect(t.autoPending).toBe(true);
      H.game.state = 'dead'; t.onState();
      expect(H.quality.calls).toContainEqual(['auto', true]);
      expect(t.autoPending).toBe(false);
    });
  });
  it('picking a tier by hand turns auto off through the quality module', () => {
    withStorage(memory(), () => {
      const G = fakeG(); const s = createSettings(G);
      s.set('quality', 'mobile');
      expect(G.quality.calls).toEqual([['set', 'mobile']]);
    });
  });
  it('tells listeners what changed', () => {
    withStorage(memory(), () => {
      const s = createSettings(fakeG()); const seen = [];
      s.onChange((k, v) => seen.push([k, v]));
      s.set('lefty', true); s.set('lefty', 'nope');
      expect(seen).toEqual([['lefty', true]]);
    });
  });
});

describe('quality labels', () => {
  it('maps the real tier, not the original name', () => {
    expect(qualityLabel('mobile', true)).toBe('Auto (Phone)');
    expect(qualityLabel('mobile', false)).toBe('Phone');
    expect(qualityLabel('high', true)).toBe('Auto (High)');
    expect(qualityLabel('low', false)).toBe('Low');
  });
  it('asks for a second tap before a phone leaves Auto or Phone for a heavier tier', () => {
    expect(needsQualityConfirm('auto', 'low', true)).toBe(true);
    expect(needsQualityConfirm('mobile', 'high', true)).toBe(true);
    expect(needsQualityConfirm('mobile', 'auto', true)).toBe(false);
    expect(needsQualityConfirm('mobile', 'mobile', true)).toBe(false);
    expect(needsQualityConfirm('low', 'high', true)).toBe(false);
    expect(needsQualityConfirm('auto', 'low', false)).toBe(false); // desktop: one tap
  });
  it('settings reports the tier by hand-pick vs auto', () => {
    withStorage(memory(), () => {
      const G = fakeG(); G.quality.tier = 'mobile'; G.quality.name = 'low'; G.quality.auto = true;
      expect(createSettings(G).quality).toBe('auto');
      G.quality.auto = false;
      expect(createSettings(G).quality).toBe('mobile');
    });
  });
});
