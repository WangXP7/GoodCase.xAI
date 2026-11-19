// Dynamic resolution: a frame-time controller that moves the render scale in steps of 0.1 between
// 0.6 and 1.0. Pure (no DOM, no clock of its own: time is the sum of the frame times it is fed).
//
//   const c = createDynRes({ lo: 20, hi: 12 });
//   const s = c.sample(frameMs);   // a new scale when it changed this frame, otherwise null
//
//   down   the mean of the last 30 frames is above `lo`                     -> one step down
//   up     `need` frames in a row each below `hi` (need = 120)              -> one step up
//   rate   at most one change every 2 s
//   warmup the first `warmup` frames after creation or reset() are not looked at (shader links and
//          uploads right after boot or a tier change are not the frame rate)
// Two things the plain rule gets wrong on a real display, both handled here:
//   - Frames arrive no faster than the display shows them. On a 60 Hz screen every frame is 16.7 ms,
//     which is never "below 12", so a desktop that dropped once could never come back. The shortest
//     frame seen so far is taken as the display's period (`target`, if you already know it), and a
//     frame within 15 % of it counts as good. That allowance stops short of `lo`, so a game stuck at
//     half the refresh rate from its first frame is never called good.
//   - With vsync a step up can halve the frame rate, which steps straight back down, which steps
//     up again two seconds later, for ever. A step up that is undone within 10 s doubles the run of
//     good frames the next one needs (up to 8x); one that holds puts it back to 120.
const WINDOW = 30; // frames averaged for the step down
const UP_FRAMES = 120; // good frames in a row for a step up
const UP_FRAMES_MAX = UP_FRAMES * 8;
const COOL_MS = 2000; // between changes
const UNDO_MS = 10000; // a step down this soon after a step up means the step up was wrong
const STALL_MS = 250; // longer than this is a tab switch or a hitch, not a frame rate
const MIN_PERIOD_MS = 4; // no display is faster; shorter samples are timer noise
const REFRESH_SLACK = 1.15;

export const SCALE_MIN = 0.6;
export const SCALE_MAX = 1;
const TENTHS_MIN = Math.round(SCALE_MIN * 10);
const TENTHS_MAX = Math.round(SCALE_MAX * 10);

// Any number -> the nearest allowed scale.
export function snapScale(s) {
  const t = Math.round((Number.isFinite(s) ? s : 1) * 10);
  return Math.min(TENTHS_MAX, Math.max(TENTHS_MIN, t)) / 10;
}

export function createDynRes({ lo = 20, hi = 12, target = Infinity, scale = 1, warmup = 0 } = {}) {
  const ring = new Float32Array(WINDOW);
  let head = 0; // next slot in the ring
  let filled = 0; // samples in the ring since the last change or stall
  let sum = 0;
  let good = 0; // good frames in a row
  let need = UP_FRAMES;
  let sinceChange = Infinity; // ms
  let sinceUp = Infinity; // ms since the last step up
  let holding = false; // the last change was a step up and it has not been undone
  let period = target > 0 ? target : Infinity; // shortest frame the display has shown
  let tenths = Math.round(snapScale(scale) * 10);
  let skip = warmup; // frames still to ignore

  const restart = () => { head = 0; filled = 0; sum = 0; good = 0; };

  const c = {
    get scale() { return tenths / 10; },
    // Put the controller at a scale chosen elsewhere (a tier change, a setting).
    reset(s = 1) { tenths = Math.round(snapScale(s) * 10); restart(); sinceChange = Infinity; sinceUp = Infinity; need = UP_FRAMES; holding = false; skip = warmup; },
    sample(frameMs) {
      if (!(frameMs > 0)) return null;
      if (skip > 0) { skip--; return null; }
      if (frameMs > STALL_MS) { restart(); return null; }
      sinceChange += frameMs; sinceUp += frameMs;
      if (frameMs >= MIN_PERIOD_MS && frameMs < period) period = frameMs;
      if (holding && sinceUp >= UNDO_MS) { holding = false; need = UP_FRAMES; }

      if (filled === WINDOW) sum -= ring[head]; else filled++;
      ring[head] = frameMs; sum += ring[head]; // the stored (float32) value, so adding and removing cancel exactly
      head = (head + 1) % WINDOW;

      const goodBelow = Math.min(Math.max(hi, period * REFRESH_SLACK), lo * 0.95);
      good = frameMs < goodBelow ? good + 1 : 0;

      if (sinceChange < COOL_MS) return null;
      if (filled === WINDOW && sum / WINDOW > lo) {
        if (tenths <= TENTHS_MIN) return null;
        tenths--;
        if (holding) need = Math.min(need * 2, UP_FRAMES_MAX);
        holding = false;
        sinceChange = 0; restart();
        return tenths / 10;
      }
      if (good >= need && tenths < TENTHS_MAX) {
        tenths++;
        sinceChange = 0; sinceUp = 0; holding = true; restart();
        return tenths / 10;
      }
      return null;
    },
  };
  return c;
}
