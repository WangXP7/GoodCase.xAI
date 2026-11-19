// js/graphics-settings.js
// The Graphics menu's settings. Tree detail: how far out the island's trees are drawn and how finely (js/city-tiles.js
// TREE_DETAIL), off / low / medium / high, or auto (the default: picked from the frame rate, createAutoTreeDetail),
// kept in localStorage and overridable with ?trees=<choice> in the URL.

const TREE_LEVELS = ['off', 'low', 'medium', 'high'];
const TREE_CHOICES = ['auto', ...TREE_LEVELS];
const TREE_KEY = 'tree-detail';

/** The choice to start at: the URL's, else the one saved, else `fallback` */
function initialTreeDetail({ search = '', storage = null, fallback = 'auto' } = {}) {
  const fromUrl = new URLSearchParams(search).get('trees');
  if (TREE_CHOICES.includes(fromUrl)) return fromUrl;
  let saved = null;
  try { saved = storage?.getItem(TREE_KEY); } catch { /* storage unavailable */ }
  return TREE_CHOICES.includes(saved) ? saved : fallback;
}

/**
 * Auto tree detail: a level a step down when the frame rate stays short of the display's for a few seconds while the
 * trees are a real part of the work (`load()`: the tree triangles drawn, over `minLoad`), a step up after a long run at
 * the display's rate. The display's rate is learned (the fastest second seen, 30-240 fps); the goal is 90% of it, up
 * to 60 fps (a 120 Hz display isn't held to 120). A level stepped down from is barred for `bar` s, twice as long each
 * time it fails again, so it doesn't flip back and forth. Frames over a second (a hidden tab, a long load) are not
 * counted, nor the `settle` s after a change (the meshes swapping); a shorter hitch only slows the second it's in, and
 * it takes `downAfter` slow seconds in a row to step down. update(rawDt) every frame.
 * -> { level, enabled, enable(), disable(), update(dt), state() }
 */
function createAutoTreeDetail({
  start = 'medium', apply = () => {}, load = () => Infinity, minLoad = 150000,
  downAfter = 3, upAfter = 12, settle = 3, bar = 90, maxBar = 600, warmup = 5
} = {}) {
  const levels = TREE_LEVELS;
  let level = start;
  let enabled = false;
  let clock = 0; // s of counted frames
  let quietUntil = warmup;
  let bucketT = 0, bucketN = 0;
  let refresh = 30;
  let slow = 0, fast = 0;
  const barredUntil = {};
  const failures = {};
  const goal = () => Math.min(refresh, 60) * 0.9;
  const go = (next, why) => {
    level = next;
    slow = fast = 0;
    quietUntil = clock + settle;
    apply(next, why);
  };
  const auto = {
    get level() { return level; },
    get enabled() { return enabled; },
    enable() {
      if (enabled) return;
      enabled = true;
      slow = fast = 0;
      quietUntil = clock + settle;
      apply(level, 'auto');
    },
    disable() { enabled = false; },
    state: () => ({ level, enabled, refresh, goal: goal(), slow, fast, barredUntil: { ...barredUntil }, clock }),
    update(rawDt) {
      if (!(rawDt > 0) || rawDt > 1) return; // a stall: not the scene's frame rate
      clock += rawDt;
      bucketT += rawDt;
      bucketN++;
      if (bucketT < 1) return;
      const fps = bucketN / bucketT;
      bucketT = 0;
      bucketN = 0;
      refresh = Math.max(refresh, Math.min(240, fps));
      if (!enabled || clock < quietUntil) return;
      const k = levels.indexOf(level);
      if (fps < goal() * 0.92) {
        fast = 0;
        // only when the trees are much of what's being drawn (in the city centre they aren't drawn at all)
        if (++slow >= downAfter && k > 0 && load() >= minLoad) {
          failures[level] = (failures[level] || 0) + 1;
          barredUntil[level] = clock + Math.min(maxBar, bar * 2 ** (failures[level] - 1));
          go(levels[k - 1], 'slow');
        }
      } else if (fps >= goal()) {
        slow = 0;
        const up = levels[k + 1];
        if (++fast >= upAfter && up && !(barredUntil[up] > clock)) go(up, 'fast');
      } else {
        slow = 0;
        fast = 0;
      }
    }
  };
  return auto;
}

/**
 * Wires the tree-detail choices: `buttons` (each with data-trees="<choice>", role="radio") call `apply(choice)` when
 * picked, are marked (aria-checked, .active) and the choice saved. -> { set(choice), get() }
 */
function bindTreeDetail({ buttons, apply, storage = null, level = 'auto' }) {
  let current = null;
  const set = (next, save = true) => {
    if (!TREE_CHOICES.includes(next)) return false;
    current = next;
    apply(next);
    for (const b of buttons) {
      const on = b.dataset.trees === next;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('active', on);
    }
    if (save) {
      try { storage?.setItem(TREE_KEY, next); } catch { /* storage unavailable */ }
    }
    return true;
  };
  for (const b of buttons) b.addEventListener('click', () => set(b.dataset.trees));
  set(level, false);
  return { set, get: () => current };
}

export { TREE_LEVELS, TREE_CHOICES, TREE_KEY, initialTreeDetail, bindTreeDetail, createAutoTreeDetail };
