import { describe, it, expect } from 'vitest';
import { detect, createDevice } from '../src/core/device.js';

describe('detect', () => {
  it('touch for a touch phone', () => {
    expect(detect({ maxTouchPoints: 5, coarse: true, w: 844, h: 390 }).touch).toBe(true);
  });
  it('a touch laptop with a fine pointer is not touch', () => {
    const d = detect({ maxTouchPoints: 10, coarse: false, w: 1440, h: 900 });
    expect(d.touch).toBe(false);
    expect(d.phone).toBe(false);
  });
  it('params.touch forces touch whatever else', () => {
    expect(detect({ maxTouchPoints: 0, coarse: false, params: { touch: true } }).touch).toBe(true);
    expect(detect({ params: { touch: true } }).touch).toBe(true);
  });
  it('no touch points means no touch even with a coarse pointer', () => {
    expect(detect({ maxTouchPoints: 0, coarse: true }).touch).toBe(false);
  });
  it('phone at 844x390 coarse, not at 1180x820', () => {
    expect(detect({ maxTouchPoints: 5, coarse: true, w: 844, h: 390 }).phone).toBe(true);
    expect(detect({ maxTouchPoints: 5, coarse: true, w: 1180, h: 820 }).phone).toBe(false);
  });
  it('portrait at 390x844 only', () => {
    expect(detect({ w: 390, h: 844 }).portrait).toBe(true);
    expect(detect({ w: 844, h: 390 }).portrait).toBe(false);
  });
  it('ios from the user agent, and an iPad that reports as a Mac', () => {
    expect(detect({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' }).ios).toBe(true);
    expect(detect({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5, coarse: true }).ios).toBe(true);
    expect(detect({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 10, coarse: false }).ios).toBe(false);
    expect(detect({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile' }).ios).toBe(false);
  });
  it('inFrame when not the top window', () => {
    expect(detect({ top: false }).inFrame).toBe(true);
    expect(detect({ top: true }).inFrame).toBe(false);
    expect(detect({}).inFrame).toBe(false);
  });
});

// A window just big enough for createDevice.
function fakeEnv({ maxTouchPoints = 10, coarse = false, w = 1440, h = 900, dpr = 2 } = {}) {
  const listeners = {};
  const win = {
    innerWidth: w, innerHeight: h, devicePixelRatio: dpr,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    matchMedia: () => ({ matches: coarse }),
    getComputedStyle: () => ({ paddingTop: '47px', paddingRight: '0px', paddingBottom: '34px', paddingLeft: '0px' }),
    top: null,
  };
  win.top = win;
  const el = { style: {}, remove() {} };
  const doc = { body: { appendChild() {} }, createElement: () => el };
  const nav = { maxTouchPoints, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
  return { win, doc, nav, listeners, env: { window: win, document: doc, navigator: nav } };
}

describe('createDevice', () => {
  it('reads the environment and the safe-area insets', () => {
    const { env } = fakeEnv({ maxTouchPoints: 5, coarse: true, w: 844, h: 390, dpr: 3 });
    const d = createDevice({ params: {} }, env);
    expect(d).toMatchObject({ touch: true, coarse: true, phone: true, portrait: false, dpr: 3, inFrame: false });
    expect(d.safe).toEqual({ top: 47, right: 0, bottom: 34, left: 0 });
  });
  it('a touch laptop flips to touch on its first touchstart and tells listeners once', () => {
    const { env, listeners } = fakeEnv({ maxTouchPoints: 10, coarse: false });
    const d = createDevice({ params: {} }, env);
    const seen = [];
    d.onChange((x) => seen.push(x.touch));
    expect(d.touch).toBe(false);
    listeners.touchstart.forEach((f) => f({}));
    listeners.touchstart?.forEach((f) => f({})); // a second one changes nothing
    expect(d.touch).toBe(true);
    expect(seen).toEqual([true]);
  });
  it('a machine with no touch points never listens for touchstart', () => {
    const { env, listeners } = fakeEnv({ maxTouchPoints: 0, coarse: false });
    createDevice({ params: {} }, env);
    expect(listeners.touchstart || []).toHaveLength(0);
  });
  it('a resize that turns the phone upright fires onChange', () => {
    const { env, win, listeners } = fakeEnv({ maxTouchPoints: 5, coarse: true, w: 844, h: 390, dpr: 3 });
    const d = createDevice({ params: {} }, env);
    const seen = [];
    d.onChange((x) => seen.push(x.portrait));
    win.innerWidth = 390; win.innerHeight = 844;
    listeners.resize.forEach((f) => f({}));
    expect(d.portrait).toBe(true);
    expect(seen).toEqual([true]);
  });
});
