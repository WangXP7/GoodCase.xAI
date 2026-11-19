// Automatic quality tier: a short benchmark at boot, and the rule that turns its result into a tier.
// quality.js owns the state (G.quality.autoSelect); this file is the measuring and the deciding.
//
//   pickTier(medianMs, device)   pure: median frame time at `medium` -> tier name
//   benchDecision({params, stored, ua})   pure: 'param' | 'harness' | 'stored' | 'run'
//   runBenchmark(G)              draws the title view back to back and returns { ms, frames }
import { applyShotCam } from '../core/loop.js';

export const TIERS = ['high', 'medium', 'low', 'mobile'];
export const STORE_KEY = 'graveyard-shift.tier';
export const BENCH_TIER = 'medium'; // the settings the benchmark draws at

const FRAMES = 45;
const KEEP = 30; // the median is over the last KEEP frames; the first ones carry shader links and uploads
const BATCH = 5; // frames between read-backs
const BUDGET_MS = 1500; // the whole benchmark, warm-up frame included: no frame is started that would end past it

// Median frame time (ms) of the benchmark -> tier. A phone that happens to be quick still never
// gets `high`: its screen is small and its battery is not.
export function pickTier(medianMs, device) {
  if (!(medianMs >= 0)) return 'mobile';
  if (device && device.touch) return medianMs < 6 ? 'medium' : medianMs < 11 ? 'low' : 'mobile';
  return medianMs < 7 ? 'high' : medianMs < 12 ? 'medium' : medianMs < 22 ? 'low' : 'mobile';
}

export function median(values) {
  if (!values.length) return Infinity;
  const s = Array.from(values).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// What was stored on an earlier visit: { tier, ua, auto, benchMs } or null.
export function parseStored(text) {
  if (!text) return null;
  try {
    const o = JSON.parse(text);
    if (!o || !TIERS.includes(o.tier) || typeof o.ua !== 'string') return null;
    return { tier: o.tier, ua: o.ua, auto: o.auto !== false, benchMs: Number.isFinite(o.benchMs) ? o.benchMs : null };
  } catch { return null; }
}

// Does this page load measure? 'param': q= names the tier. 'harness': a shot, a stepped run or the
// bot, which use `high` unless autotier=1. 'stored': a choice made by this same browser on an earlier
// visit. 'run': measure.
export function benchDecision({ params = {}, stored = null, ua = '' } = {}) {
  if (TIERS.includes(params.q)) return 'param';
  if (params.autotier) return 'run';
  if (params.shot || params.step || params.bot) return 'harness';
  if (stored && stored.ua === ua) return 'stored';
  return 'run';
}

// Draws the title view FRAMES times and returns the median frame time of the last KEEP. A 1x1
// readPixels forces the GPU to finish so its work is inside the time, but it is issued after every
// BATCH-th frame, not every frame: the read-back itself stalls the pipeline (3.7 ms a time on the
// M5, against 3.2 ms for the frame it was timing), and the tier thresholds are about what a frame
// costs, not what a read-back costs. Each batch gives one sample, its time / BATCH.
// Time bound: before each batch the frames that fit in what is left of budgetMs are worked out from
// the last measured frame time (the warm-up frame's at first, which carries shader links and so
// over-estimates), and the batch is cut to those; none fit, it stops. If not even one timed frame
// fits, the warm-up frame's time is the answer (it is a slow device either way). Only a single
// frame longer than budgetMs can overrun it.
// Synchronous (it runs behind the boot bar, and a hidden tab cannot interleave). The camera and
// the frame counter are put back afterwards. Throws if nothing can be drawn. `now` is for tests.
export function runBenchmark(G, { frames = FRAMES, keep = KEEP, batch = BATCH, budgetMs = BUDGET_MS, now = () => performance.now() } = {}) {
  const post = G.post; const renderer = G.renderer; const cam = G.camera;
  if (!post || post.stub || !renderer || renderer.stub || !cam) throw new Error('nothing to draw with');
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const time = G.time || { frame: 0 };
  const frame0 = time.frame;
  // the frame number moves on as in play: passes that work every other frame (the reflection) do so here too
  const draw = () => { time.frame++; post.render(); };
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const pos = cam.position.clone(); const rot = cam.rotation.clone(); const fov = cam.fov;
  const title = G.level && G.level.shots && G.level.shots.title;
  const times = []; // one per batch: ms per frame
  const batches = Math.max(1, Math.round(frames / batch));
  let warm = 0;
  let drawn = 0;
  try {
    if (title) applyShotCam(G, title);
    const start = now();
    draw(); sync(); // links this tier's shaders; not counted
    warm = now() - start;
    let perFrame = Math.max(warm, 1e-3);
    for (let b = 0; b < batches; b++) {
      const a = now();
      const n = Math.min(batch, Math.floor((budgetMs - (a - start)) / perFrame));
      if (n < 1) break;
      for (let i = 0; i < n; i++) draw();
      sync();
      perFrame = Math.max((now() - a) / n, 1e-3);
      times.push(perFrame);
      drawn += n;
    }
    if (gl.isContextLost()) throw new Error('graphics context lost during the benchmark');
  } finally {
    time.frame = frame0;
    cam.position.copy(pos); cam.rotation.copy(rot);
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
  if (!times.length) return { ms: Math.round(warm * 100) / 100, frames: 1 };
  // the last two thirds, as with the full run (30 frames of 45)
  const tail = times.slice(-Math.max(1, Math.round((times.length * keep) / frames)));
  return { ms: Math.round(median(tail) * 100) / 100, frames: drawn };
}
