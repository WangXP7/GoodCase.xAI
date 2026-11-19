/**
 * shutter - a motion blur's exposure relative to the motion one frame spans, from the time between rendered frames
 *
 * A velocity buffer holds the motion between two rendered frames, dt apart. A shutter open for `exposure` seconds
 * sees `shutterScale = exposure / dt` of it:
 *
 *   exposure = (shutterAngle / 360) · frameTime
 *   frameTime = targetFrameRate > 0 ? 1 / targetFrameRate : dtSmooth   (a fixed exposure, or one frame of the cadence)
 *
 * dtSmooth is an exponential average of dt (weight 0.1, input clamped to [0.5, 2]·dtSmooth), so a hitch frame keeps a
 * normal-length streak and a cadence change settles in about 30 frames. It re-seeds after 3 frames in a row out of that
 * band, and at once on a faster frame while no in-band frame has confirmed the seed (a slow first interval, such as a
 * shader compile). A frame is a cut (shutterScale 0, dtSmooth untouched) when it is the first, when `cut` is passed,
 * when the measured gap exceeds maxFrameGap, or when dt isn't positive.
 *
 *   let state = null
 *   state = advanceShutter(state, { time, shutterAngle: 180 }) // once per rendered frame
 *   const radius = (state.shutterScale / 2) * displacementPerFrame
 */

const SMOOTHING = 0.1 // the average's weight of a new frame
const BAND = 2 // dt outside [dtSmooth / BAND, dtSmooth · BAND] is out of band, and clamped into it
const RESEED = 3 // frames in a row out of band after which the next frame re-seeds the average

/**
 * One rendered frame of the shutter. Pure: returns the next state, which is also the frame's result.
 *
 * @param {?object} state - The previous call's result, or null before the first frame.
 * @param {object} frame
 * @param {number} frame.time - Seconds, increasing (three's `frame.time`).
 * @param {?number} [frame.deltaTime=null] - The wall-clock interval the rendered motion spans (s), instead of the
 *   measured gap (frame caps, captures); the gap still decides cuts.
 * @param {number} [frame.shutterAngle=180] - Degrees: the fraction of the frame the shutter is open.
 * @param {number} [frame.targetFrameRate=0] - 0: frame-relative; N > 0: a fixed exposure of shutterAngle/360/N s.
 * @param {number} [frame.maxFrameGap=0.25] - Seconds; a longer measured gap is a cut.
 * @param {boolean} [frame.cut=false] - A cut decided elsewhere (reset, resize, camera cut).
 * @returns {{lastTime: number, smoothedDeltaTime: ?number, outOfBand: number, confirmed: number, cut: boolean,
 *   shutterScale: number}} `confirmed`: in-band frames since the average's (re)seed.
 */
export function advanceShutter(
  state,
  { time, deltaTime = null, shutterAngle = 180, targetFrameRate = 0, maxFrameGap = 0.25, cut = false },
) {
  const lastTime = state?.lastTime ?? null
  let smoothedDeltaTime = state?.smoothedDeltaTime ?? null
  let outOfBand = state?.outOfBand ?? 0
  let confirmed = state?.confirmed ?? 0

  const first = lastTime === null
  const gap = first ? Number.NaN : time - lastTime
  const dt = deltaTime ?? gap
  // NaN-safe
  const isCut = cut === true || first || !(gap <= maxFrameGap) || !(dt > 0)

  if (!isCut) {
    // a seed no in-band frame has confirmed may be a hitch: a faster frame replaces it at once
    if (smoothedDeltaTime === null || outOfBand >= RESEED || (confirmed === 0 && dt < smoothedDeltaTime / BAND)) {
      smoothedDeltaTime = dt
      outOfBand = 0
      confirmed = 0
    } else {
      const low = smoothedDeltaTime / BAND
      const high = smoothedDeltaTime * BAND
      const inBand = dt >= low && dt <= high
      outOfBand = inBand ? 0 : outOfBand + 1
      if (inBand) confirmed++
      smoothedDeltaTime += SMOOTHING * (Math.min(Math.max(dt, low), high) - smoothedDeltaTime)
    }
  }

  let shutterScale = 0
  if (!isCut) {
    const frameTime = targetFrameRate > 0 ? 1 / targetFrameRate : smoothedDeltaTime
    shutterScale = (Math.max(0, shutterAngle) / 360) * (frameTime / dt)
    if (!Number.isFinite(shutterScale)) shutterScale = 0
  }

  return { lastTime: time, smoothedDeltaTime, outOfBand, confirmed, cut: isCut, shutterScale }
}
