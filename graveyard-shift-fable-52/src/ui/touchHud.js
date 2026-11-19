// On-screen controls for phones and tablets. Two halves:
//  - layoutTouch({w, h, safe, lefty, scale, interact}) -> {stick, look, buttons, ...}: pure maths, CSS px.
//    The same object goes to G.input.touch.setLayout (the machine hits against it) and to the DOM below.
//  - createTouchHud(G, host, opts): draws the buttons. The layer is pointer-events:none and not a
//    touch surface: fingers are the input layer's, so a button that is removed never owns one.
// Everything is measured from the safe-area corner. Diameters are CSS px at scale 1 (phone):
// FIRE 84, ADS 56, RELOAD 52, JUMP 56, MELEE 48, THROW 48, INTERACT 64, SWAP 60, PAUSE 44.
// There is no SPRINT button: it would need a second left-hand finger. Pushing the stick far runs.
// FIRE shows the held weapon's fire mode without changing size or place: one bullet for a gun that
// fires once a tap (semi-automatic, pump, specials), three for one that fires while held.
import { tuning } from '../game/tuning.js';
import { fireModeOf } from '../player/touch.js';
export const BUTTON_SIZES = { fire: 84, ads: 56, reload: 52, jump: 56, melee: 48, throw: 48, interact: 64, swap: 60, pause: 44 };
const MODES = { fire: 'hold', ads: 'toggle', reload: 'tap', jump: 'hold', melee: 'tap', throw: 'tap', interact: 'hold', swap: 'tap', pause: 'tap' };
const MARGIN = 12; // from the safe edge
const GAP = 10; // between rims (the floor is 8)
const STICK_SHARE = 0.42; // of the screen width
const STICK_TOP = 0.3; // of the height
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const touchScale = (w, h) => clamp(Math.min(w, h) / 390, 1, 1.4);

// Right-handed layout; `lefty` is the same layout computed with the insets swapped and mirrored.
function build(w, h, safe, S, interact) {
  const L = safe.left || 0, R = safe.right || 0, T = safe.top || 0, B = safe.bottom || 0;
  const m = MARGIN * S, g = GAP * S;
  const rad = (n) => (BUTTON_SIZES[n] * S) / 2;
  const xr = w - R - m, yb = h - B - m;
  const at = (name, x, y) => ({ name, x, y, r: rad(name), mode: MODES[name] });
  const fire = at('fire', xr - rad('fire'), yb - rad('fire'));
  fire.look = true;
  const around = (name, deg, extra = 0) => { // on a ring round FIRE, 0 deg = straight up, turning left
    const d = rad('fire') + rad(name) + g + extra;
    const a = (deg * Math.PI) / 180;
    return at(name, fire.x - Math.sin(a) * d, fire.y - Math.cos(a) * d);
  };
  const jump = around('jump', 0);
  const ads = around('ads', 50, 6 * S);
  const reload = around('reload', 100, 6 * S);
  const melee = at('melee', jump.x, jump.y - rad('jump') - g - rad('melee'));
  const thr = at('throw', melee.x - rad('melee') - g - rad('throw'), melee.y);
  const out = [fire, ads, reload, jump, melee, thr];
  const pause = at('pause', L + m + rad('pause'), T + m + rad('pause'));
  const stickTop = Math.round(h * STICK_TOP);
  const swap = at('swap', xr - rad('swap'), T + m + 38 * S + rad('swap')); // the chip beside the ammo count
  out.push(swap, pause);
  if (interact) out.push(at('interact', thr.x - rad('throw') - g - rad('interact'), melee.y));
  const stickW = w * STICK_SHARE;
  return {
    stick: { x: 0, y: stickTop, w: stickW, h: h - stickTop },
    look: { x: stickW, y: 0, w: w - stickW, h },
    buttons: out,
  };
}

export function layoutTouch({ w, h, safe = {}, lefty = false, scale, interact = false } = {}) {
  const S = scale ?? touchScale(w, h);
  const s = lefty ? { left: safe.right || 0, right: safe.left || 0, top: safe.top || 0, bottom: safe.bottom || 0 } : safe;
  const L = build(w, h, s, S, interact);
  if (lefty) {
    L.stick = { ...L.stick, x: w - L.stick.x - L.stick.w };
    L.look = { ...L.look, x: w - L.look.x - L.look.w };
    for (const b of L.buttons) b.x = w - b.x;
  }
  return { ...L, width: w, height: h, scale: S, lefty: !!lefty };
}

// ---------------------------------------------------------------- icons (24-unit boxes, signage-square strokes)
export const ICONS = {
  fire: '<path d="M12 2.5c-2.6 2.8-3.8 5.6-3.8 8.2V19h7.6v-8.3c0-2.6-1.2-5.4-3.8-8.2z" fill="currentColor" stroke="none"/><path d="M7 21.5h10"/>',
  fireAuto: '<path d="M5 5c-1.6 1.8-2.3 3.5-2.3 5.2V19h4.6v-8.8C7.3 8.5 6.6 6.8 5 5zM12 2.5c-1.6 1.8-2.3 3.5-2.3 5.2V19h4.6V7.7c0-1.7-.7-3.4-2.3-5.2zM19 5c-1.6 1.8-2.3 3.5-2.3 5.2V19h4.6v-8.8c0-1.7-.7-3.4-2.3-5.2z" fill="currentColor" stroke="none"/><path d="M2 21.5h20"/>',
  ads: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.5 3.5v5h-5"/>',
  jump: '<path d="M5 13.5l7-7 7 7M5 20l7-7 7 7"/>',
  melee: '<path d="M20.5 3.5L10 14l-1.5-1.5L19 2z" fill="currentColor" stroke="none"/><path d="M20 4L9.5 14.5M8 13l3 3M10.5 15.5L5 21"/><path d="M4 22l3-3" stroke-width="3"/>',
  throw: '<circle cx="11" cy="14.5" r="6"/><path d="M9 7.5h4M11 7.5V5M13.5 5H19"/><path d="M8.2 14.5h5.6"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  swap: '<path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/>',
};
const SVG = 'http://www.w3.org/2000/svg';
// The FIRE glyph and its title for a fire mode ('auto' holds; anything else is a tap a shot).
export const fireGlyph = (mode) => (mode === 'auto' ? 'fireAuto' : 'fire');
const FIRE_TITLES = { fire: 'Fire: tap to shoot', fireAuto: 'Fire: hold to keep shooting' };
const LABELS = { fire: 'Fire', ads: 'Aim', reload: 'Reload', jump: 'Jump', melee: 'Melee', throw: 'Throw', pause: 'Pause', swap: 'Swap weapon', interact: 'Use' };

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ---------------------------------------------------------------- pure helpers
// The drawn stick: a base under the thumb and a knob at the current deflection. `key` changes only
// when a whole pixel does, so a still frame writes nothing to the DOM.
export function stickView(st, radius) {
  if (!st || !st.active) return { on: false, cx: 0, cy: 0, kx: 0, ky: 0, key: 'off' };
  const cx = Math.round(st.cx), cy = Math.round(st.cy);
  const kx = Math.round(st.x * radius), ky = Math.round(st.y * radius);
  return { on: true, cx, cy, kx, ky, key: `${cx},${cy},${kx},${ky}` };
}

// A toggle (ADS) left on would survive a death or a pause. The machine has no "clear toggle" call, so
// the layer taps it: a tap flips a toggle. Call while the layout is still the machine's.
export function clearToggles(tl) {
  if (!tl) return;
  try { if (tl.cancelAll) tl.cancelAll(); } catch { /* nothing to cancel */ }
  const m = tl.machine; const L = tl.layout;
  if (!m || !L || !L.buttons || !tl.state) return;
  for (const name of ['ads']) {
    if (!tl.state.buttons[name]) continue;
    const b = L.buttons.find((x) => x.name === name);
    if (!b) continue;
    m.down(9000, b.x, b.y, 0); m.up(9000, 0);
    m.frame(0);
  }
}

// A 180 degree flip of a notched phone fires orientationchange (and screen.orientation change) with
// no resize: the insets change sides but nothing re-lays out. Wait a frame, ask the device to
// re-read the insets, and relay out if they differ.
const sameInsets = (a, b) => a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
export function watchInsets({ win, screen, device, raf, refresh, relayout }) {
  let last = { ...device.safe };
  const check = () => raf(() => {
    try { refresh(); } catch { /* keep the old insets */ }
    if (!sameInsets(last, device.safe)) { last = { ...device.safe }; relayout(); }
  });
  if (win && win.addEventListener) win.addEventListener('orientationchange', check);
  const so = screen && screen.orientation;
  if (so && so.addEventListener) so.addEventListener('change', check);
  return { check, sync() { last = { ...device.safe }; } };
}

// Progress of the hold on the use button, 0..1. Order: a generic G.game.hold.progress, the search
// (G.game.loot.progress), then an estimate for rebuilding boards from how long interact has been held
// (state.js repairs one board every `repairEvery` s of hold; it exposes no progress of its own).
export function holdProgressOf(G, focus, heldSeconds, repairEvery = 0.6) {
  const g = G && G.game;
  if (!g) return 0;
  if (g.hold && Number.isFinite(g.hold.progress)) return g.hold.progress;
  if (g.loot && Number.isFinite(g.loot.progress) && g.loot.progress > 0) return g.loot.progress;
  if (focus && focus.kind === 'boards' && heldSeconds > 0) return (heldSeconds % repairEvery) / repairEvery;
  return 0;
}

const tuningStickRadius = tuning.touch.stickRadius;
export function createTouchHud(G, host) {
  const layer = h('div', 'gs-touchhud');
  layer.setAttribute('aria-hidden', 'true');
  host.appendChild(layer);
  const els = Object.create(null); // name -> element
  const cache = { ring: -1 };
  // class toggles remembered on the element itself: no string building in the frame loop
  const flag = (el, prop, cls, on) => { if (el[prop] !== on) { el[prop] = on; el.classList.toggle(cls, on); } };
  let ringC = 0;
  let layout = null;
  let shown = false;
  let ring = null, verbEl = null, priceEl = null, ringOverride = null;
  // The stick: a faint idle ring in the zone (where to put the left thumb), and while a finger is
  // down a base under it with a knob at the deflection.
  const idle = h('div', 'gs-stick-idle');
  const base = h('div', 'gs-stick');
  const knob = h('i', 'knob');
  base.appendChild(knob);
  layer.append(idle, base);
  let stickKey = 'off';
  const stickR = tuningStickRadius;
  let glyph = 'fire'; // the icon FIRE shows now

  function make(name) {
    const b = h('div', `gs-tb gs-tb-${name}`);
    b.dataset.btn = name;
    if (name === 'interact') {
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'ring'); svg.setAttribute('viewBox', '0 0 100 100');
      const track = document.createElementNS(SVG, 'circle');
      track.setAttribute('cx', '50'); track.setAttribute('cy', '50'); track.setAttribute('r', '46'); track.setAttribute('class', 'track');
      ring = document.createElementNS(SVG, 'circle');
      ring.setAttribute('cx', '50'); ring.setAttribute('cy', '50'); ring.setAttribute('r', '46'); ring.setAttribute('class', 'fill');
      ringC = 2 * Math.PI * 46;
      ring.style.strokeDasharray = `${ringC.toFixed(1)}`; ring.style.strokeDashoffset = `${ringC.toFixed(1)}`;
      ring.setAttribute('transform', 'rotate(-90 50 50)');
      svg.appendChild(track); svg.appendChild(ring);
      verbEl = h('span', 'verb', 'USE'); priceEl = h('span', 'price');
      b.appendChild(svg); b.appendChild(verbEl); b.appendChild(priceEl);
    } else {
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'ico'); svg.setAttribute('viewBox', '0 0 24 24');
      svg.innerHTML = ICONS[name === 'fire' ? glyph : name];
      b.appendChild(svg);
    }
    b.title = name === 'fire' ? FIRE_TITLES[glyph] : LABELS[name];
    layer.appendChild(b);
    els[name] = b;
    return b;
  }

  // Positions are written when the layout changes (resize, handedness, the use button), never per frame.
  function paint(L) {
    layout = L;
    layer.style.setProperty('--s', String(L.scale));
    const keep = new Set();
    for (const b of L.buttons) {
      keep.add(b.name);
      const el = els[b.name] || make(b.name);
      el.style.width = el.style.height = `${(b.r * 2).toFixed(1)}px`;
      el.style.transform = `translate(${(b.x - b.r).toFixed(1)}px, ${(b.y - b.r).toFixed(1)}px)`;
      el.hidden = false;
    }
    for (const n in els) if (!keep.has(n)) els[n].hidden = true;
    const z = L.stick;
    if (z) { // the idle ring sits low in the zone, where a left thumb rests
      idle.style.transform = `translate(${(z.x + z.w * 0.5 - 56).toFixed(0)}px, ${(z.y + z.h * 0.62 - 56).toFixed(0)}px)`;
      idle.hidden = false;
    } else idle.hidden = true;
  }

  const api = {
    layer,
    get layout() { return layout; },
    paint,
    setShown(on) {
      if (on === shown) return;
      shown = on;
      layer.classList.toggle('on', on);
    },
    // The labels on the interact button; called when the focus (or its price) changes.
    setFocus(verb, price, hold) {
      if (!els.interact) make('interact');
      verbEl.textContent = verb;
      flag(els.interact, '_long', 'long', verb.length > 4);
      priceEl.textContent = price || '';
      flag(els.interact, '_hold', 'hold', !!hold);
    },
    // 0..1; null hands it back to G.game.loot.progress.
    setProgress(p) { ringOverride = p; },
    update() {
      if (!shown) return;
      const st = G.input && G.input.touch && G.input.touch.state;
      if (st && st.stick) {
        const v = stickView(st.stick, stickR);
        if (v.key !== stickKey) {
          stickKey = v.key;
          base.classList.toggle('on', v.on);
          idle.classList.toggle('away', v.on);
          if (v.on) { base.style.transform = `translate(${v.cx - 56}px, ${v.cy - 56}px)`; knob.style.transform = `translate(${v.kx}px, ${v.ky}px)`; }
        }
      }
      if (st) for (const n in els) { if (!els[n].hidden) flag(els[n], '_down', 'down', !!st.buttons[n]); }
      if (els.interact && !els.interact.hidden && ring) {
        const g = G.game;
        const repairEvery = (tuning.world && tuning.world.boards && tuning.world.boards.repairEvery) || 0.6;
        const p = ringOverride !== null ? ringOverride : holdProgressOf(G, g && g.focus, G.input && G.input.held ? G.input.held('interact') : 0, repairEvery);
        const q = Math.round(clamp(p, 0, 1) * 200) / 200;
        if (cache.ring !== q) { cache.ring = q; ring.style.strokeDashoffset = (ringC * (1 - q)).toFixed(1); flag(els.interact, '_busy', 'busy', q > 0); }
      }
      const w = G.weapon;
      if (els.reload) flag(els.reload, '_needs', 'needs', !!(w && w.ammo && w.ammo.mag === 0 && w.ammo.reserve > 0 && !w.reloading));
      // FIRE's glyph follows the held weapon's fire mode (the DOM is written only when it changes)
      const g = fireGlyph(fireModeOf(w && w.def));
      if (g !== glyph && els.fire) {
        glyph = g;
        const svg = els.fire.querySelector('svg');
        if (svg) svg.innerHTML = ICONS[g];
        els.fire.title = FIRE_TITLES[g];
        flag(els.fire, '_auto', 'auto', g === 'fireAuto');
      }
    },
  };
  return api;
}
