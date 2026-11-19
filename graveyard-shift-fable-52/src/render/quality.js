// Quality tiers. Everything that scales with the tier is read from G.quality FIELDS, never from the
// tier's name and never hard-coded.
//
//   G.quality.tier        'high' | 'medium' | 'low' | 'mobile'   the tier in use
//   G.quality.name        'high' | 'medium' | 'low'   the original name; on `mobile` it reads 'low', so
//                         code that still keys on the name (surface detail, rain) gets its cheapest path.
//                         UI and every gate read `tier` (or better, a field), never `name`.
//   G.quality.auto        true while the tier is the benchmark's choice, false once someone picked one
//   G.quality.renderScale 0.6..1 in steps of 0.1 (dynamic resolution), or the rs= param exactly
//   G.quality.benchMs     the benchmark's median frame time behind an automatic choice, else null
//
//   Per-tier fields (PRESETS):
//   maxHeight        internal render height cap in pixels, before renderScale (the canvas is CSS-scaled)
//   shadowRes        moon shadow map size; shadowed spots use half
//   volSteps         volumetric march steps (the pass divides by 5: beam steps)
//   volFactor        volumetrics resolution divisor (2 = half, 4 = quarter)
//   volLamps         lamps whose cones are marched (the rest have none). 16 everywhere: on the M5, 8 saved
//                    under 0.15 ms of the mobile frame and lost the faint halos (tail lights, flares)
//   aoOn             ambient occlusion (the post chain skips the 'ao' slot when false)
//   msaa             MSAA samples on the HDR scene target
//   bloomMips        bloom chain length
//   reflection       planar reflection of the wet ground (false: the ground keeps its blurred sky term)
//   reflScale        resolution of that reflection against the internal resolution
//   flare            lens flare pass
//   depthPrepass     draw the standalone depth-only meshes (the level's `depth` bucket) before the
//                    colour pass. Saves shading where the GPU shades hidden pixels; costs every
//                    triangle twice. Off on mobile, whose GPUs remove hidden surfaces themselves.
//   shadowedSpots, spots, points   real lights in the pool (lights.js); the rest are ground pools
//   moonShadowEvery  the moon's shadow map is redrawn every n-th frame
//   rain             rain density against `high`. fx/rain.js still sets its density from `name`; until
//                    it reads this field (and sets `G.fx.rain.readsQualityRain`), wrapRainDensity
//                    below scales its pass down to this value where it is lower
//   zombieLodFar     metres beyond which a zombie uses its far mesh (zombie/manager.js)
//   zombieShadowDist metres from a shadowed spot within which zombies are drawn into its shadow map;
//                    0 = zombies cast no real shadow at all and get a contact blob instead
//   zombieShadowMax  most bodies drawn into one shadow map: the nearest to a shadowed spot, and for the
//                    moon the nearest to the camera (render/lights.js). 0 = none (blob shadows only)
//   charTex          character texture size (zombie bake)
//   particles, decals   live caps (fx)
//   propDensity      share of optional level detail (clutter, foliage, backdrop props) to build: 1 = all
//   zoneDepth        zones drawn: those within this many doors of the player's (world.js reachable(zone, n))
//   dynLo, dynHi     dynamic resolution thresholds in ms (see dynres.js)
//   viewDetail       weapon view detail (weapon/viewmodel.js): 1 full, 0.5 reduced, 0 the lite path
//   vehicleNear      metres within which a vehicle uses its near level of detail (level/props/vehicleParts.js)
//
//   set(name)              pick a tier by hand (auto goes off, the choice is remembered)
//   setAuto(bool)          true: measure again and follow the result; false: keep the current tier
//   autoSelect()           the boot benchmark; resolves the tier name. No-op once decided, and on a
//                          touch device, which is never measured: it gets `mobile` unless a manual tier is stored
//   setRenderScale(s)      snap to 0.6..1; false when rs= pins it
//   frame(ms)              one frame's duration, from the post chain: drives dynamic resolution
//   onChange(fn)           after any tier change;  onScale(fn)  after a renderScale change
//   resetFrameTimes()      forget recent frame times (after a context restore: recompiles are not the frame rate)
//   event `quality:tier {name, auto, benchMs}` on every tier change that sticks
//
// Demotion: an automatic tier whose render scale has sat at its floor (0.6) for DEMOTE_MS with the
// mean frame time still above the tier's dynLo drops to the next tier down (TIERS order) and that is
// stored as the automatic pick. Never a manual choice, a q= tier or a harness run. Nothing ever
// promotes during a visit, and the next demotion needs a whole descent of the scale (it starts again
// at 1) plus another DEMOTE_MS, so it cannot bounce. A touch device never auto-picks above `mobile`.
import { store } from '../core/store.js';
import { createDynRes, snapScale, SCALE_MIN } from './dynres.js';
import { TIERS, STORE_KEY, BENCH_TIER, pickTier, benchDecision, parseStored, runBenchmark } from './autotier.js';

export { TIERS };

const DESKTOP = {
  volLamps: 16, flare: true, depthPrepass: true, shadowedSpots: 2, spots: 6, points: 3, moonShadowEvery: 1, rain: 1, zombieLodFar: 12, zombieShadowDist: 14,
  charTex: 2048, particles: 4096, decals: 256, propDensity: 1, zoneDepth: 2, dynLo: 20, dynHi: 12,
};
export const PRESETS = {
  high: { maxHeight: 1080, shadowRes: 2048, volSteps: 32, volFactor: 2, aoOn: true, msaa: 4, bloomMips: 7, reflection: true, reflScale: 0.5, ...DESKTOP, viewDetail: 1, vehicleNear: 12, zombieShadowMax: 8 },
  medium: { maxHeight: 900, shadowRes: 1536, volSteps: 20, volFactor: 4, aoOn: true, msaa: 2, bloomMips: 6, reflection: true, reflScale: 0.4, ...DESKTOP, viewDetail: 1, vehicleNear: 10, zombieShadowMax: 6 },
  low: { maxHeight: 720, shadowRes: 1024, volSteps: 12, volFactor: 4, aoOn: false, msaa: 0, bloomMips: 5, reflection: false, reflScale: 0.3, ...DESKTOP, viewDetail: 0.5, vehicleNear: 8, zombieShadowMax: 4 },
  mobile: {
    maxHeight: 648, shadowRes: 1024, volSteps: 8, volFactor: 4, aoOn: false, msaa: 0, bloomMips: 4, reflection: false, reflScale: 0.3,
    volLamps: 16, flare: false, depthPrepass: false, shadowedSpots: 1, spots: 4, points: 2, moonShadowEvery: 4, rain: 0.35, zombieLodFar: 7, zombieShadowDist: 0, zombieShadowMax: 0,
    charTex: 1024, particles: 1536, decals: 96, propDensity: 0.5, zoneDepth: 1, dynLo: 25, dynHi: 18, viewDetail: 0, vehicleNear: 6,
  },
};
const DYN_WARMUP = 120; // frames after boot or a tier change before frame times count (shaders are still linking)
const DEMOTE_MS = 10000; // at the scale floor and still slow for this long: one tier down
const STALL_MS = 250; // a frame longer than this is a tab switch or a hitch: the demotion clock starts again
const TOUCH_AUTO_MAX = 'mobile'; // the highest tier a touch device is given without asking
// G.quality.name for tiers the original did not have.
const PHASE1_NAME = { mobile: 'low' };
// fx/rain.js's density by the original name (its QUALITY_DENSITY). Only used to work out how much further
// to thin the rain where the tier's `rain` field is lower than what rain.js already does.
const RAIN_BY_NAME = { high: 1, medium: 0.65, low: 0.4 };

// An automatic pick for this device: a touch device gets nothing above TOUCH_AUTO_MAX.
const autoTier = (tier, device) => (device && device.touch && TIERS.indexOf(tier) < TIERS.indexOf(TOUCH_AUTO_MAX) ? TOUCH_AUTO_MAX : tier);

// How much the rain pass must thin itself beyond what rain.js does by name (1 = not at all).
export function rainDensityScale(q) {
  const base = RAIN_BY_NAME[q && q.name] ?? 1;
  const want = q && Number.isFinite(q.rain) ? q.rain : 1;
  return want < base ? want / base : 1;
}

// Applies G.quality.rain through G.fx.rain: around the rain pass's render, the rain's intensity is
// lowered by rainDensityScale (rain.js: density = min(1, intensity / 0.7) x its table), and put
// back afterwards, so wetness and everything else that reads the intensity is untouched. Steps
// aside when rain.js says it reads the field itself (`G.fx.rain.readsQualityRain`). The post chain
// wraps the pass named 'rain' when it is added.
export function wrapRainDensity(pass, G) {
  if (!pass || pass.qualityDensity) return pass;
  const render = pass.render;
  pass.qualityDensity = true;
  pass.render = function renderAtTierDensity(p) {
    const rain = G.fx && G.fx.rain;
    const k = rainDensityScale(G.quality);
    if (!rain || rain.readsQualityRain || k >= 1) return render.call(this, p);
    const i = rain.intensity;
    rain.intensity = Math.min(i, 0.7) * k;
    try { return render.call(this, p); } finally { rain.intensity = i; }
  };
  return pass;
}

// Internal resolution for a window: height capped by the tier, never above what the display can
// show, then scaled by the render scale.
export function internalSize(cssW, cssH, dpr, maxHeight, scale = 1) {
  const h = Math.max(2, Math.round(Math.min(maxHeight, Math.round(cssH * dpr)) * scale));
  const w = Math.max(2, Math.round((h * cssW) / Math.max(1, cssH)));
  return { w, h };
}

const defaultEnv = () => ({
  store,
  ua: typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
  bench: runBenchmark,
  hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  warn: (m) => console.warn(m),
  // one frame at the chosen tier, still behind the boot bar, so its shaders are linked before play
  settle: (G) => { if (G.post && !G.post.stub && typeof G.post.render === 'function') G.post.render(); },
});

// `env` is for tests: { store, ua, bench(G) -> {ms}, hidden() -> bool, warn(msg), settle(G) }.
export function createQuality(G, env) {
  const E = { ...defaultEnv(), ...env };
  const params = G.params || {};
  const listeners = [];
  const scaleListeners = [];
  const stored = parseStored(E.store.get(STORE_KEY, null));
  const decision = benchDecision({ params, stored, ua: E.ua });
  // only a normal page load is remembered: never a q= run or a harness run
  const persist = !TIERS.includes(params.q) && !params.shot && !params.step && !params.bot;
  const pinned = params.rs !== undefined;
  const dynamic = !pinned && !params.step; // stepped runs draw at the harness's pace, not the display's
  // A touch device is never measured: every result would come out `mobile` (TOUCH_AUTO_MAX is the
  // lowest tier), and the benchmark costs up to 1.5 s of boot. It goes straight to `mobile`.
  const touch = !!(G.device && G.device.touch);
  let pending = decision === 'run' && !touch; // the benchmark has yet to run
  let benching = false;
  let dyn = createDynRes();
  let floorMs = 0; let floorFrames = 0; // time and frames spent at the scale floor (demotion)
  const resetFloor = () => { floorMs = 0; floorFrames = 0; };
  const scaleChanged = () => { resetFloor(); for (const fn of scaleListeners) fn(q); };

  // Called with every frame time while dynamic resolution runs (see the header: demotion).
  function watchFloor(ms) {
    if (!q.auto || q.renderScale > SCALE_MIN || ms > STALL_MS) { resetFloor(); return; }
    floorMs += ms; floorFrames++;
    if (floorMs < DEMOTE_MS) return;
    const mean = floorMs / floorFrames;
    resetFloor();
    const next = TIERS[TIERS.indexOf(q.tier) + 1];
    if (!(mean > q.dynLo) || !next) return;
    E.warn(`[quality] ${q.tier} averaged ${mean.toFixed(1)} ms at the lowest render scale: dropping to ${next}`);
    apply(next, { benchMs: q.benchMs });
    save(next, true, q.benchMs);
  }

  const save = (tier, auto, benchMs) => { if (persist) E.store.set(STORE_KEY, JSON.stringify({ tier, ua: E.ua, auto, benchMs })); };

  function apply(name, announce) {
    const p = PRESETS[name];
    Object.assign(q, p, { tier: name, name: PHASE1_NAME[name] || name, scale: p.maxHeight / 1080 });
    if (!pinned) q.renderScale = 1;
    dyn = createDynRes({ lo: p.dynLo, hi: p.dynHi, scale: q.renderScale, warmup: DYN_WARMUP });
    resetFloor();
    for (const fn of listeners) fn(q);
    if (announce && G.events) G.events.emit('quality:tier', { name, auto: q.auto, benchMs: announce.benchMs ?? null });
  }

  const q = {
    tier: '', name: '', auto: false, benchMs: null, renderScale: pinned ? params.rs : 1,
    set(name) {
      if (!PRESETS[name]) return false;
      pending = false;
      q.auto = false; q.benchMs = null;
      apply(name, { benchMs: null });
      save(name, false, null);
      return true;
    },
    setAuto(on) {
      if (on && touch) { q.auto = true; q.benchMs = null; pending = false; apply(TOUCH_AUTO_MAX, { benchMs: null }); save(TOUCH_AUTO_MAX, true, null); return Promise.resolve(q.tier); }
      if (on) { q.auto = true; pending = true; return q.autoSelect(); }
      q.auto = false; q.benchMs = null; pending = false;
      save(q.tier, false, null);
      return Promise.resolve(q.tier);
    },
    // Measures and picks. Synchronous inside (main.js calls it between the first frame and hiding
    // the boot bar); the promise is there so callers need not care. { settle: false } skips the one
    // frame drawn at the chosen tier: the caller draws it with settle() once that tier's shaders are ready.
    get benchPending() { return pending; },
    settle() { try { E.settle(G); } catch { /* the frame loop will report it */ } },
    autoSelect(opts = {}) {
      if (!pending) return Promise.resolve(q.tier);
      pending = false;
      let ms = null; let tier;
      benching = true;
      try {
        if (E.hidden()) throw new Error('the tab is hidden');
        // a software renderer (no graphics card in use): the benchmark could only say `mobile`, after
        // seconds per frame. Not stored, so a visit with hardware acceleration back on measures again.
        if (opts.software) throw new Error('software renderer');
        if (q.tier !== BENCH_TIER) apply(BENCH_TIER, null);
        ms = E.bench(G).ms;
        if (E.hidden()) throw new Error('the tab was hidden while it ran');
        tier = autoTier(pickTier(ms, G.device), G.device);
        save(tier, true, ms);
      } catch (e) {
        // nothing stored: the next visit measures again
        ms = null;
        tier = G.device && G.device.touch ? 'mobile' : opts.software ? 'mobile' : 'low';
        E.warn(`[quality] tier benchmark did not finish (${e && e.message}): using ${tier} for this visit`);
      }
      benching = false;
      q.auto = true; q.benchMs = ms;
      apply(tier, { benchMs: ms });
      if (opts.settle !== false) q.settle();
      return Promise.resolve(tier);
    },
    setRenderScale(s) {
      if (pinned) return false;
      const v = snapScale(s);
      if (v !== q.renderScale) {
        q.renderScale = v; dyn.reset(v);
        scaleChanged();
      }
      return true;
    },
    frame(ms) {
      if (!dynamic || benching) return;
      const s = dyn.sample(ms);
      if (s !== null) { q.renderScale = s; scaleChanged(); return; }
      watchFloor(ms);
    },
    resetFrameTimes() { dyn.reset(q.renderScale); resetFloor(); },
    onChange(fn) { listeners.push(fn); },
    onScale(fn) { scaleListeners.push(fn); },
  };

  if (decision === 'param') apply(params.q, null);
  else if (decision === 'stored') {
    q.auto = stored.auto; q.benchMs = stored.auto ? stored.benchMs : null;
    apply(stored.auto ? autoTier(stored.tier, G.device) : stored.tier, null);
  } else if (decision === 'run') {
    // The world is built at this tier (texture sizes and the like are read at build time). A touch
    // device stays there with no benchmark; elsewhere autoSelect measures at BENCH_TIER.
    q.auto = true;
    apply(G.device && G.device.touch ? TOUCH_AUTO_MAX : BENCH_TIER, null);
  }
  else apply('high', null);
  return q;
}
