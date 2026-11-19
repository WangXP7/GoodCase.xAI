// Shared by shot.mjs and smoke.mjs.
import { chromium } from 'playwright';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

export const root = resolve(import.meta.dirname, '..');
export const distDir = resolve(root, process.env.GS_DIST || 'dist');
export const scratch = join(process.env.TMPDIR || tmpdir(), 'graveyard-shift');

export function pageUrl(params = '') {
  const q = String(params).replace(/^\?/, '');
  return `${pathToFileURL(join(distDir, 'index.html')).href}${q ? `?${q}` : ''}`;
}

// Device presets for mobile emulation. CSS px viewport, DPR, and touch.
export const DEVICES = {
  phone: { width: 844, height: 390, dpr: 3, kind: 'phone' },
  tablet: { width: 1180, height: 820, dpr: 2, kind: 'tablet' },
};

// A current mobile Chrome user agent, using the launched Chromium's own major version.
// Phone UAs say "Mobile"; tablet ones do not (that is how Chrome tells them apart).
export function mobileUserAgent(kind, version) {
  const major = String(version || '140').split('.')[0];
  const model = kind === 'tablet' ? 'Pixel Tablet' : 'Pixel 7';
  return `Mozilla/5.0 (Linux; Android 14; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 ${kind === 'tablet' ? '' : 'Mobile '}Safari/537.36`;
}

// Context options for a device preset: { viewport, deviceScaleFactor, hasTouch, isMobile, userAgent }.
// `size` ("WxH") and `dpr` override the preset's. Without a device: a desktop context.
export function contextOptions({ device, size, dpr, version } = {}) {
  const d = device ? DEVICES[device] : null;
  if (device && !d) throw new Error(`unknown device "${device}" (use ${Object.keys(DEVICES).join(' or ')})`);
  const [w, h] = size ? String(size).split('x').map(Number) : d ? [d.width, d.height] : [1920, 1080];
  const o = { viewport: { width: w, height: h }, deviceScaleFactor: dpr ? Number(dpr) : d ? d.dpr : 1 };
  if (d) Object.assign(o, { hasTouch: true, isMobile: true, userAgent: mobileUserAgent(d.kind, version) });
  return o;
}

// GPU on (Metal via ANGLE), new headless mode (channel 'chromium' = full Chromium, not headless-shell).
// launch({ device: 'phone' | 'tablet' }) makes browser.newPage() default to that device's context
// (touch, DPR, mobile user agent); options passed to newPage() still win.
export async function launch({ device, args = [] } = {}) {
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', ...args],
  });
  if (device) {
    const base = contextOptions({ device, version: browser.version() });
    const newPage = browser.newPage.bind(browser);
    browser.newPage = (opts = {}) => newPage({ ...base, ...opts });
  }
  return browser;
}

// Several fingers at once over CDP Input.dispatchTouchEvent. Every event carries all the fingers
// that are down, so a move of one finger leaves the others where they are.
//   down(id,x,y)  move(id,x,y)  up(id)  cancel(id)   (ids are your own small integers)
//   tap(x,y)                    down and up on a spare id
//   drag(id, from, to, ms, {hold})   down at from, glide to `to` over ms in ~16 ms steps, then up
//                                    (hold:true leaves the finger down: a stick held over)
// Positions are CSS px in the viewport. Needs a page from a hasTouch context (launch({device})).
export async function touchDriver(page) {
  const cdp = await page.context().newCDPSession(page);
  const fingers = new Map(); // id -> {x, y}
  const points = () => [...fingers].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 1 }));
  const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points() });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = {
    async down(id, x, y) { fingers.set(id, { x, y }); await send('touchStart'); },
    async move(id, x, y) { if (!fingers.has(id)) throw new Error(`touch ${id} is not down`); fingers.set(id, { x, y }); await send('touchMove'); },
    async up(id) { if (!fingers.delete(id)) return; await send('touchEnd'); },
    async cancel(id) {
      if (!fingers.has(id)) return;
      // CDP's touchCancel takes no points and ends the whole sequence: cancel, then put the survivors back down
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      fingers.delete(id);
      if (fingers.size) await send('touchStart');
    },
    async tap(x, y, id = 99) { await api.down(id, x, y); await wait(40); await api.up(id); },
    async drag(id, from, to, ms = 300, { hold = false } = {}) {
      await api.down(id, from[0], from[1]);
      const steps = Math.max(1, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        await api.move(id, from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k);
        await wait(ms / steps);
      }
      if (!hold) await api.up(id);
    },
    async releaseAll() { for (const id of [...fingers.keys()]) await api.up(id); },
    async close() { await api.releaseAll(); await cdp.detach(); },
  };
  return api;
}

// Collects console/page errors outside __errors (e.g. before the harness installs).
export function watchPage(page) {
  const seen = [];
  page.on('pageerror', (e) => seen.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') seen.push(`[console.error] ${m.text()}`); });
  return seen;
}
