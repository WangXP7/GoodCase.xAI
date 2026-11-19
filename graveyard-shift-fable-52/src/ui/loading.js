// Loading screen. Bundled on its own by scripts/build.mjs and inlined right after the #boot markup
// in index.html, so it runs before the game bundle is even parsed: it shows the key art (a data URI; the
// blurred 24x14 placeholder is already in the CSS), and rotates one gameplay tip every TIP_MS.
// main.js still owns the boot: it sets #boot-bar's width and #boot-label, and adds #boot.done when the game
// is ready. On .done the screen fades (CSS) and this stops its timer; the title screen under it takes the
// first tap or click as before. Nothing here waits on anything, so the game is never held back.
// No unseeded randomness (the build bans it): the first tip comes from the clock.
import './loading.css';
import './wordmark.css'; // the wordmark's look (its markup is in index.html)
import { FONT_URL } from './wordmark.js';
import art from '../../assets/keyart/keyart-1280.webp';
import { detect } from '../core/device.js';

export const TIP_MS = 4000;

// Each tip: { key, touch? } in the player's words; numbers are the tuning's (economy, world, loot, touch).
export const TIPS = [
  { key: 'Every hit pays 10 points, a kill 60, a headshot kill 100. Aim for the head.' },
  { key: 'Knife kills pay 130. When one gets close, press V.', touch: 'Knife kills pay 130. When one gets close, tap the knife.' },
  { key: 'Points open doors. The diner is 750; the way to the motel and the garage costs more.' },
  { key: 'The power switch is in the garage. The machines and the upgrade bench do nothing until it is on.' },
  { key: 'The weapon box is 950 for a random gun. Take it within 10 seconds or it is gone.' },
  { key: 'Hold F to search a car or a crate. Each one can be searched once.', touch: 'Hold SEARCH at a car or a crate. Each one can be searched once.' },
  { key: 'Armour plates take the damage before your health does. You can wear three.' },
  { key: 'With the power on, the upgrade bench makes any gun stronger for 4000.' },
  { key: "Hold Shift to sprint, but you can't shoot while you're sprinting.", touch: "Push the stick all the way to sprint, but you can't shoot while you're sprinting." },
  { key: 'Hold F at a broken window to nail the boards back: 10 points a board, up to 200 a round.', touch: 'Hold REPAIR at a broken window to nail the boards back: 10 points a board, up to 200 a round.' },
  { key: "The ammo crate out front fills whatever gun you're holding. Pistol ammo is 250; bigger guns cost more." },
  { key: 'Power-ups glow on the ground for 25 seconds. Walk over one to take it.' },
];

export const tipText = (tip, touch) => (touch && tip.touch) || tip.key;
// The tip shown `step` changes after the page opened at time `now` (ms): starts somewhere new each visit.
export const tipIndex = (now, step, n = TIPS.length) => (Math.floor(now / 1000) + step) % n;

export function isTouch(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  const nav = win.navigator || {};
  let coarse = false;
  try { coarse = !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches); } catch { coarse = false; }
  let touchParam = false;
  try { touchParam = new URLSearchParams(win.location.search).get('touch') === '1'; } catch { touchParam = false; }
  return detect({ maxTouchPoints: nav.maxTouchPoints || 0, coarse, params: { touch: touchParam } }).touch;
}

// Wires the screen; returns { stop() } (also called by itself when #boot gets .done).
export function startLoading(doc = document, { now = Date.now(), touch = isTouch() } = {}) {
  const boot = doc.getElementById('boot');
  if (!boot) return { stop() {} };
  const reduced = !!(doc.defaultView && doc.defaultView.matchMedia
    && doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // the wordmark's type, asked for now rather than when the HUD is built (hud.js asks for the same stylesheet,
  // which the browser then has); skipped offline like hud.js does
  const nav = doc.defaultView && doc.defaultView.navigator;
  if (doc.head && !(nav && nav.onLine === false)) {
    const link = doc.createElement('link');
    link.id = 'gs-fonts'; // wordmark.js loadFonts() skips its own request when this id exists: one stylesheet
    link.rel = 'stylesheet';
    link.href = FONT_URL;
    doc.head.appendChild(link);
  }

  const img = boot.querySelector('.ld-art img');
  if (img) {
    img.addEventListener('load', () => img.classList.add('on'), { once: true });
    img.decoding = 'async';
    img.src = art;
  }

  const t = boot.querySelector('.ld-tip .t');
  let step = 0, timer = 0, swap = 0;
  const show = () => { if (t) t.textContent = tipText(TIPS[tipIndex(now, step)], touch); };
  show();
  if (t) {
    timer = setInterval(() => {
      step++;
      if (reduced) { show(); return; }
      t.classList.add('out');
      swap = setTimeout(() => { show(); t.classList.remove('out'); }, 350);
    }, TIP_MS);
  }

  let observer = null;
  const stop = () => {
    clearInterval(timer); clearTimeout(swap);
    if (observer) observer.disconnect();
    observer = null;
  };
  const done = () => boot.classList.contains('done');
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => { if (done()) stop(); });
    observer.observe(boot, { attributes: true, attributeFilter: ['class'] });
  }
  return { stop };
}

if (typeof document !== 'undefined' && document.getElementById('boot')) {
  // runs before main.js installs window.__errors (which starts it empty), so a failure is only warned:
  // the plain boot bar still works without this
  try { startLoading(document); } catch (e) { console.warn('[loading]', e); }
}
