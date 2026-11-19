// Player movement and follow-camera settings.
export const player = {
  speed: 1.15, // world units / s (a tile is 2 units). User 2026-11-17: half of the old 2.3
  runMul: 1.8, // Shift held: 1.8 x 1.15 = 2.07 (0.9 x the old speed)
  slowMul: 0.6, // Ctrl toggles a slow stroll: 0.6 x 1.15 = 0.69 (0.3 x the old speed)
  accel: 17, // units / s^2 toward the desired velocity (0 -> 90 % speed in ~0.13 s)
  radius: 0.12, // collision radius: room (world.clearance) the feet keep from blockers (was an 8-probe ring at 0.16)
  slideMin: 0.6, // fraction of the speed kept while sliding along / walking round an obstacle hit head-on
  // shortfall pass: held against an obstacle for roundAfter seconds he walks round it (follows its outline at roundSpeed x
  // speed) until the way on is free, for at most roundMax world units. round: false = he just stops, as before.
  round: true, roundAfter: 0.3, roundMax: 4, roundSpeed: 0.8,
  stallFlipSteps: 24, // sub-steps fully wedged before the other way round is tried
  turnRate: 13, // rad / s heading smoothing
  stepLength: 0.35, // distance between 'step' events (6.6 footfalls / s at full speed)
  hopHeight: 0.02, // peak of the per-step paper hop (world units)
  arriveRadius: 0.12, // click-to-walk arrival distance

  // --- paper-puppet walk cycle (all rotations in degrees; nothing is ever scaled or stretched) ---
  legSwingDeg: 34, // leg_l / leg_r swing about the hip pivot
  armSwingDeg: 22, // free arm swing (opposite phase to the legs)
  holdArmFactor: 0.22, // swing factor of the arm that carries the lantern
  staffArmFactor: 0.4, // swing factor of an arm whose cut-out reaches the ground (walking staff)
  leanDeg: 3.5, // forward lean at full speed
  leanHz: 3.4, // lean spring frequency: under-damped so the card rocks once when it stops
  leanDamping: 0.75, // damping ratio of that spring (overshoot ~30 % => ~2 deg back-rock on stop)
  turnLeanDeg: 4, // max roll into a turn
  turnLeanGain: 0.035, // roll (rad) per rad/s of yaw rate
  waddleDeg: 1.6, // side-to-side rock per step (towards the stance foot)
  twistDeg: 2.2, // yaw twist of the card per step
  headNodDeg: 1.8, // hat bob, delayed by hatLag behind the torso
  torsoLagDeg: 1.8, // pack / upper card rocks about the hips twice per stride, lagging the hop
  secondaryLag: 1.2, // rad of step phase (2*phase) the torso lags the footfall
  hatLag: 0.7, // extra rad the head lags the torso (~1 frame at 30 fps)
  gaitRate: 16, // 1/s blend between idle and walk poses
  idleSwayDeg: 0.9, // idle breathing sway
  idleHz: 0.32,
  lanternHz: 1.5, // pendulum frequency of the lantern
  lanternDamping: 0.22,
  lanternDrive: 0.03, // rad of lag per unit/s^2 of acceleration
  lanternGaitDeg: 5, // extra swing injected by each step
  lanternMaxDeg: 28,
  heightRate: 45, // was 18: the feet lagged a bridge ramp by 4-6 cm; 45 = under 2 cm. // 1/s smoothing of the ground height (bridge decks)

  // --- click / tap / drag to walk ---
  targetStuckTime: 1.2, // s without real movement before the click target is dropped
  targetNoProgressTime: 1.0, // s without getting closer (while hugging an obstacle) before it is dropped
  routeCell: 0.15, // grid cell (world units) of the click-to-walk route finder
  routeSpan: 12, // side (world units) of the square it searches, centred between traveller and target
  targetProbe: 0.45, // look-ahead (world units) for steering around obstacles on the way to the target
  markerSize: 0.13, // radius of the inked target mark on the page
  markerFade: 0.9, // s for the mark to fade after arrival / cancel
  markerOpacity: 0.5,
};

// Framing maths (16:9): half-height of the frame at the look target = distance * tan(fov / 2).
// distance 17 / fov 27 / pitch 53 => 8.2 units of frame height, a tile is ~230 px wide at 1600 px,
// the ground is visible from ~4.4 units south to ~6.2 units north of the look target. The look target
// sits `screenUp` units north of the traveller (plus look-ahead), so the far edge of the reveal ring
// (REVEAL_RADIUS 3 tiles around a point 1.25 tiles ahead) starts inside the top of the frame.
export const camera = {
  fov: 27,
  pitchDeg: 42, /* fixer (gold pass): 46 -> 42, lower three-quarter view like the gold image */ // degrees below horizontal (high-angle; 53+ flattened the cut-outs and turned the traveller into a hat disc)
  yawDeg: 0, // 0 = looking toward -Z (north is up on screen)
  distance: 10.8, /* fixer (gold pass): 12.6 -> 10.8 */ // integrator (gold pass): 14.8 -> 12.6, the gold frame is about 1.5x tighter (traveller 15 % of frame height, game 9.7 %); this is a 1.17x step toward it
  lookAhead: 1.0, // world units the camera leads in the movement direction (steady state)
  lookAheadSouth: 2.4, // lead when walking toward the camera (down the screen): the near ground is foreshortened away, so lead more
  smoothTime: 0.4, // critically damped follow time constant (s)
  near: 0.5,
  far: 120,
  // extra keys (all may be overridden per pose through follow.setPose):
  screenUp: 0.6, // world units the look target is pushed toward the top of the screen (traveller sits below centre)
  screenRight: 0, // same, toward screen right
  targetHeight: 0, // world Y of the look target above the traveller's ground height
  focusHeight: 0.6, // focus point = traveller feet + focusHeight * TRAVELLER_HEIGHT (chest)
  driftAmp: 0.035, // world units of very slow camera drift (0 = locked off)
  driftHz: 0.07,
  // round 3: sight assist (camera/follow.js). A large piece (house, tower ...) hiding the traveller for `delay` s eases the lens up by
  // at most pitchMax and / or round by at most yawMax degrees (first candidate that clears him); back after `release` s of clear view.
  // ease = time constant (s) of the critically damped offset; interval = s between sight tests; rethink = s before a held offset is re-chosen.
  // Camera window (user 2026-11-18): a still zone round the traveller where the camera does not move at all, a soft zone where it
  // picks up his speed gradually (0 at the still edge -> 100 % at the hard edge, which he can never cross), and after `leadAfter`
  // seconds of steady walking one way the window slides ahead so he has room in front (lookAhead / lookAheadSouth, as before).
  // All sizes are world units on the ground at the default distance (scaled with pose.distance): r = screen right, up / down.
  // enabled: false = the old always-chasing spring. Poses with zone: false and steep poses (map, > 60 deg) also use the spring.
  zone: { enabled: true, stillR: 1.0, stillUp: 0.4, stillDown: 0.6, hardR: 2.2, hardUp: 1.1, hardDown: 1.4, leadAfter: [0.35, 1.1], leadTau: 0.7, leadRate: 1.2, smoothTime: 0.28 },
  assist: { enabled: true, delay: 0.4, release: 0.6, pitchMax: 10, yawMax: 14, ease: 0.8, interval: 0.1, rethink: 1.2, far: 1.3 }, // far: a second, slightly wider tier (x far: 13 / 18 degrees) only when the first still leaves part of him hidden
};
