import { describe, it, expect } from 'vitest';
import { layoutTouch, touchScale, BUTTON_SIZES, stickView, clearToggles, watchInsets, holdProgressOf } from '../src/ui/touchHud.js';
import { createTouchMachine } from '../src/player/touch.js';
import { tuning } from '../src/game/tuning.js';

const VIEWS = [
  { name: '844x390 notch', w: 844, h: 390, safe: { left: 47, right: 47, top: 0, bottom: 21 } },
  { name: '667x375', w: 667, h: 375, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
  { name: '812x375 notch', w: 812, h: 375, safe: { left: 44, right: 44, top: 0, bottom: 21 } },
  { name: '640x360 small', w: 640, h: 360, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
  { name: '1180x820 tablet', w: 1180, h: 820, safe: { left: 0, right: 0, top: 24, bottom: 20 } },
  { name: '932x430 big phone', w: 932, h: 430, safe: { left: 59, right: 59, top: 0, bottom: 21 } },
];
const NAMES = ['fire', 'ads', 'reload', 'jump', 'melee', 'throw', 'swap', 'pause'];

const inside = (b, w, h, s) => b.x - b.r >= s.left - 1e-6 && b.x + b.r <= w - s.right + 1e-6 && b.y - b.r >= s.top - 1e-6 && b.y + b.r <= h - s.bottom + 1e-6;
const circleHitsRect = (b, r) => {
  const cx = Math.max(r.x, Math.min(b.x, r.x + r.w)); const cy = Math.max(r.y, Math.min(b.y, r.y + r.h));
  return Math.hypot(b.x - cx, b.y - cy) < b.r;
};

describe('layoutTouch', () => {
  for (const v of VIEWS) for (const lefty of [false, true]) for (const interact of [false, true]) {
    const tag = `${v.name}${lefty ? ' lefty' : ''}${interact ? ' +interact' : ''}`;
    const L = layoutTouch({ w: v.w, h: v.h, safe: v.safe, lefty, interact });
    it(`${tag}: every button is inside the safe rectangle`, () => {
      for (const b of L.buttons) expect(inside(b, v.w, v.h, v.safe), `${b.name} ${JSON.stringify(b)}`).toBe(true);
    });
    it(`${tag}: no overlaps (8 px between rims) and no target under 44 px`, () => {
      for (const b of L.buttons) expect(b.r * 2).toBeGreaterThanOrEqual(44);
      for (let i = 0; i < L.buttons.length; i++) for (let j = i + 1; j < L.buttons.length; j++) {
        const a = L.buttons[i]; const b = L.buttons[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r, `${a.name} / ${b.name}`).toBeGreaterThanOrEqual(8 - 1e-6);
      }
    });
    it(`${tag}: nothing in the centre third, nothing in the stick zone, look zone clear of the stick`, () => {
      for (const b of L.buttons) expect(b.x + b.r <= v.w / 3 + 1e-6 || b.x - b.r >= (2 * v.w) / 3 - 1e-6, `${b.name} in the centre third`).toBe(true);
      for (const b of L.buttons) expect(circleHitsRect(b, L.stick), `${b.name} in the stick zone`).toBe(false);
      if (lefty) expect(L.look.x + L.look.w).toBeLessThanOrEqual(L.stick.x + 1e-6);
      else expect(L.look.x).toBeGreaterThanOrEqual(L.stick.x + L.stick.w - 1e-6);
      expect(L.stick.w).toBeCloseTo(v.w * 0.42, 5);
    });
  }

  it('lists the buttons with their sizes at phone scale', () => {
    const L = layoutTouch({ w: 844, h: 390, safe: { left: 47, right: 47, top: 0, bottom: 21 } });
    expect(L.buttons.map((b) => b.name).sort()).toEqual([...NAMES].sort());
    const d = Object.fromEntries(L.buttons.map((b) => [b.name, b.r * 2]));
    expect(d).toMatchObject({ fire: 84, ads: 56, reload: 52, jump: 56, melee: 48, throw: 48, pause: 44 });
    const withUse = layoutTouch({ w: 844, h: 390, safe: { left: 47, right: 47, top: 0, bottom: 21 }, interact: true });
    expect(withUse.buttons.find((b) => b.name === 'interact').r * 2).toBe(64);
    expect(BUTTON_SIZES.fire).toBe(84);
  });

  it('modes: fire is a hold that also looks, aim toggles, the rest tap or hold', () => {
    const L = layoutTouch({ w: 844, h: 390, safe: { left: 0, right: 0, top: 0, bottom: 0 }, interact: true });
    const m = Object.fromEntries(L.buttons.map((b) => [b.name, b]));
    expect(m.fire).toMatchObject({ mode: 'hold', look: true });
    expect(m.ads.mode).toBe('toggle'); expect(m.sprint).toBeUndefined();
    expect(m.reload.mode).toBe('tap'); expect(m.melee.mode).toBe('tap'); expect(m.throw.mode).toBe('tap');
    expect(m.swap.mode).toBe('tap'); expect(m.pause.mode).toBe('tap');
    expect(m.jump.mode).toBe('hold'); expect(m.interact.mode).toBe('hold');
  });

  it('fire sits in the bottom-right corner, pause top-left; lefty mirrors x', () => {
    const safe = { left: 47, right: 47, top: 0, bottom: 21 };
    const R = layoutTouch({ w: 844, h: 390, safe });
    const Lf = layoutTouch({ w: 844, h: 390, safe, lefty: true });
    const by = (L, n) => L.buttons.find((b) => b.name === n);
    expect(by(R, 'fire').x).toBeGreaterThan(844 / 2); expect(by(R, 'fire').y).toBeGreaterThan(390 / 2);
    expect(by(R, 'pause').x).toBeLessThan(844 / 3); expect(by(R, 'pause').y).toBeLessThan(390 / 3);
    for (const n of NAMES) { expect(by(Lf, n).x).toBeCloseTo(844 - by(R, n).x, 5); expect(by(Lf, n).y).toBeCloseTo(by(R, n).y, 5); }
    expect(Lf.stick.x).toBeCloseTo(844 - R.stick.x - R.stick.w, 5);
    expect(Lf.look.x).toBeCloseTo(0, 5);
  });

  it('an uneven notch is honoured when mirrored (insets swap sides)', () => {
    const safe = { left: 80, right: 10, top: 0, bottom: 0 };
    const L = layoutTouch({ w: 800, h: 380, safe, lefty: true });
    for (const b of L.buttons) expect(inside(b, 800, 380, safe), b.name).toBe(true);
  });

  it('scales up on a tablet and never below phone size', () => {
    expect(touchScale(844, 390)).toBe(1);
    expect(touchScale(667, 375)).toBe(1);
    expect(touchScale(1180, 820)).toBeGreaterThan(1.2);
    expect(touchScale(2000, 1500)).toBeLessThanOrEqual(1.4);
    const T = layoutTouch({ w: 1180, h: 820, safe: { left: 0, right: 0, top: 0, bottom: 0 } });
    expect(T.buttons.find((b) => b.name === 'fire').r * 2).toBeGreaterThan(100);
  });

  it('works in portrait without throwing and keeps buttons on screen', () => {
    const L = layoutTouch({ w: 390, h: 844, safe: { left: 0, right: 0, top: 47, bottom: 34 }, interact: true });
    for (const b of L.buttons) expect(inside(b, 390, 844, { left: 0, right: 0, top: 47, bottom: 34 }), b.name).toBe(true);
  });

  it('the machine accepts it: a finger on FIRE fires and looks, the stick zone starts a stick', () => {
    const L = layoutTouch({ w: 844, h: 390, safe: { left: 47, right: 47, top: 0, bottom: 21 } });
    const m = createTouchMachine(L, tuning.touch, {});
    const fire = L.buttons.find((b) => b.name === 'fire');
    m.down(1, fire.x, fire.y, 0);
    m.move(1, fire.x - 30, fire.y, 16);
    m.down(2, 100, 300, 0); // left side: the stick
    m.move(2, 100, 250, 16);
    const f = m.frame(1 / 60);
    expect(f.held.has('fire')).toBe(true);
    expect(f.lookDx).toBe(-30);
    expect(f.moveY).toBeGreaterThan(0.5);
    // a finger in the look zone away from every button looks
    m.down(3, 500, 100, 0);
    expect(m.has(3)).toBe(true);
  });
});

describe('stick drawing', () => {
  it('is hidden when idle and sits under the thumb with the knob offset when active', () => {
    expect(stickView({ active: false, cx: 5, cy: 5, x: 1, y: 1 }, 56).on).toBe(false);
    const v = stickView({ active: true, cx: 120.4, cy: 300.6, x: 0.5, y: -1 }, 56);
    expect(v).toMatchObject({ on: true, cx: 120, cy: 301, kx: 28, ky: -56 });
  });
  it('changes only when a whole pixel changes (so unchanged frames write nothing)', () => {
    const a = stickView({ active: true, cx: 100, cy: 100, x: 0.5, y: 0 }, 56);
    const b = stickView({ active: true, cx: 100.2, cy: 99.9, x: 0.5004, y: 0 }, 56);
    expect(b.key).toBe(a.key);
    expect(stickView({ active: true, cx: 100, cy: 100, x: 0.6, y: 0 }, 56).key).not.toBe(a.key);
  });
});

describe('clearToggles', () => {
  it('turns a toggled ADS off through the machine so it does not survive a restart', () => {
    const safe = { left: 0, right: 0, top: 0, bottom: 0 };
    const L = layoutTouch({ w: 844, h: 390, safe });
    const m = createTouchMachine(L, tuning.touch, {});
    const ads = L.buttons.find((b) => b.name === 'ads');
    m.down(1, ads.x, ads.y, 0); m.up(1, 50);
    m.frame(1 / 60);
    expect(m.state.buttons.ads).toBe(true);
    const tl = { machine: m, state: m.state, layout: L, cancelAll: () => m.cancelAll() };
    clearToggles(tl);
    m.frame(1 / 60);
    expect(m.state.buttons.ads).toBe(false);
    clearToggles(tl); m.frame(1 / 60); // off stays off
    expect(m.state.buttons.ads).toBe(false);
  });
  it('does nothing without a layout or machine', () => {
    expect(() => clearToggles(null)).not.toThrow();
    expect(() => clearToggles({ state: { buttons: { ads: true } }, layout: null })).not.toThrow();
  });
});

describe('watchInsets (a 180 degree flip fires orientationchange, not resize)', () => {
  const mk = () => {
    const listeners = {}; const rafs = [];
    const win = { addEventListener: (t, f) => { (listeners[t] ||= []).push(f); } };
    const scr = { orientation: { addEventListener: (t, f) => { (listeners['so:' + t] ||= []).push(f); } } };
    const device = { safe: { left: 47, right: 0, top: 0, bottom: 21 } };
    let relayouts = 0;
    const refresh = () => { device.safe = { left: 0, right: 47, top: 0, bottom: 21 }; };
    watchInsets({ win, screen: scr, device, raf: (f) => rafs.push(f), refresh, relayout: () => { relayouts++; } });
    return { listeners, rafs, device, relayouts: () => relayouts };
  };
  it('re-reads after a frame and relays out when the insets swapped sides', () => {
    const t = mk();
    t.listeners.orientationchange[0]();
    expect(t.relayouts()).toBe(0); // not before the frame
    t.rafs.shift()();
    expect(t.relayouts()).toBe(1);
    expect(t.device.safe.right).toBe(47);
  });
  it('listens to screen.orientation change too, and skips a relayout when nothing changed', () => {
    const t = mk();
    t.listeners['so:change'][0](); t.rafs.shift()();
    expect(t.relayouts()).toBe(1);
    t.listeners.orientationchange[0](); t.rafs.shift()(); // refresh gives the same insets again
    expect(t.relayouts()).toBe(1);
  });
});

describe('hold progress source', () => {
  it('prefers G.game.hold, then the search, then an estimate for board repairs', () => {
    expect(holdProgressOf({ game: { hold: { progress: 0.4 }, loot: { progress: 0.9 } } }, null, 0)).toBeCloseTo(0.4);
    expect(holdProgressOf({ game: { loot: { progress: 0.7 } } }, null, 0)).toBeCloseTo(0.7);
    expect(holdProgressOf({ game: { loot: { progress: 0 } } }, { kind: 'boards' }, 0.3, 0.6)).toBeCloseTo(0.5);
    expect(holdProgressOf({ game: { loot: { progress: 0 } } }, { kind: 'wallAmmo' }, 0.3)).toBe(0);
    expect(holdProgressOf({}, null, 0)).toBe(0);
  });
});
