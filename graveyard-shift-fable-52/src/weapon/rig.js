// The viewmodel rig's data: poses by weapon class, how each kind of action behaves, and the reload
// clips by reload kind (`mag`, `shell`, `cylinder`, `belt`, `cell`). Pure: no three.js, no G, so
// vitest runs it. viewmodel.js plays what is described here; models/*.js supply the geometry and
// may override any pose or clip field with their own (`model.pose`, `model.clip`).
//
// Spaces. View space: +x right, +y up, -z forward, metres. A pose is the gun's model origin in view
// space and [pitch, yaw, roll] about its grip anchor.
//
// (tuning.js is plain data: this file still needs no three.js and no G.)
//
// Clips. Every magazine-like reload (mag, cylinder, belt, cell) is authored on ONE clock, CLOCK
// seconds long, with the same marks: the old magazine leaves at `magOut`, the fresh one is in the
// support hand from `spareOn`, lined up at `align`, home at `magIn`, the action is closed at
// `slideRelease`. A weapon's reload plays that clock at CLOCK / (def.reload x reloadScale), so the
// marks land at the same fractions of any reload time (magIn at 0.656 of it). What differs by kind
// is where the gun goes (pos, rot, mix) and which extra model states move (`tracks`: any name the
// model's `state` understands, e.g. the revolver's `crane` and `rod`). A shell reload is a loop:
// one shell every def.reload, `shellIn` at SHELL_IN of each period.

import { tuning } from '../game/tuning.js';

export const CLOCK = 1.6;
export const MARKS = { magOut: 0.22, magFree: 0.36, spareOn: 0.34, rise: 0.36, align: 0.84, open: 0.98, magIn: 1.05, slideRelease: 1.3, done: CLOCK };
// an empty gun with a charging handle (model.charge): the support hand goes to it, pulls, lets go at slideRelease, comes back
export const CHARGE = { reach: 1.1, grasp: 1.24, back: 1.36, home: 1.58 };
export const SHELL_IN = 0.78; // fraction of a shell period at which the shell is home
export const SHELL_OUT = 0.3; // seconds the gun takes to come back down after the last shell
export const SWAP_LOWER = 0.2; // seconds to lower the weapon being put away
export const FLASH_TIME = 0.06; // seconds the viewmodel carries its own muzzle-flash light

// ---- actions: what the moving parts do on a shot ---------------------------------------------------
// cycles: the slide or bolt runs back and home inside the shot period. eject: when the case leaves
// ('fire': with the shot; 'pump': when the forend comes back; 'reload': all at once). locksOpen:
// held open on the last round. follow: the overlay that plays after the recoil.
export const ACTIONS = {
  slide: { cycles: true, eject: 'fire', locksOpen: true, follow: null },
  bolt: { cycles: true, eject: 'fire', locksOpen: true, follow: null },
  pump: { cycles: false, eject: 'pump', locksOpen: false, follow: 'pump' },
  revolver: { cycles: false, eject: 'reload', locksOpen: false, follow: 'index' },
  single: { cycles: false, eject: 'reload', locksOpen: false, follow: null },
};
export const actionOf = (name) => ACTIONS[name] || ACTIONS.slide;

// Which animation a `view.play(name)` runs. kind: 'overlay' (runs over whatever else is playing),
// 'clip' (the one exclusive animation slot), 'none'. For a clip, `clip` names the timeline.
export const PLAY_NAMES = ['draw', 'fire', 'reload', 'shellIn', 'empty', 'inspect', 'swing', 'throw', 'pump'];
export function animFor(name, def = {}, action = 'slide') {
  const A = actionOf(action);
  switch (name) {
    case 'fire': return { kind: 'overlay', clip: 'fire', follow: A.follow };
    case 'empty': return A.locksOpen ? { kind: 'overlay', clip: 'lock' } : { kind: 'none' };
    case 'pump': return A.follow === 'pump' ? { kind: 'overlay', clip: 'pump' } : { kind: 'none' };
    case 'reload': return { kind: 'clip', clip: def.reloadKind === 'shell' ? 'shell' : 'reload' };
    case 'shellIn': return def.reloadKind === 'shell' ? { kind: 'clip', clip: 'shell', shells: 1 } : { kind: 'none' };
    case 'draw': case 'inspect': case 'swing': case 'throw': return { kind: 'clip', clip: name };
    default: return { kind: 'none' };
  }
}

// ---- timing ---------------------------------------------------------------------------------------
// Draw times by class are gameplay numbers: tuning.weapons.drawTime when the weapon table
// defines it; these are the values it should carry (and what is used until it does).
const DRAW = { pistol: 0.5, revolver: 0.5, smg: 0.5, shotgun: 0.6, rifle: 0.6, lmg: 0.8, special: 0.6, ...((tuning.weapons && tuning.weapons.drawTime) || null) };
export const FIXED = { empty: 0.06, inspect: 3.6, swing: 0.7, throw: 0.8 };

// Seconds each animation of this weapon takes. melee: the melee Def ({ time }) for `swing`.
export function durationsFor(def, o = {}) {
  const scale = o.reloadScale > 0 ? o.reloadScale : 1;
  const fire = 60 / (def.rpm || 400);
  const shell = def.reloadKind === 'shell';
  return {
    draw: DRAW[def.cls] || 0.5,
    fire,
    reload: (def.reload || CLOCK) * scale, // one magazine, or one shell
    shellIn: shell ? (def.reload || 0.5) * scale : 0,
    pump: Math.min(0.5, fire * 0.72),
    empty: FIXED.empty, inspect: FIXED.inspect,
    swing: (o.melee && o.melee.time) || FIXED.swing,
    throw: FIXED.throw,
  };
}

// When a reload's events fire, in seconds from its start.
// Magazine-like: { kind, rate (clock seconds per second), total, at: { magOut, magIn, slideRelease, done } }.
// Shell: { kind: 'shell', per, start, shellAt(i), total(n) }: shell i (from 0) is home at shellAt(i);
// n shells take total(n) to the last shellIn (the gun is ready then; coming back down is cosmetic).
export function reloadPlan(def, reloadScale = 1) {
  const scale = reloadScale > 0 ? reloadScale : 1;
  if (def.reloadKind === 'shell') {
    const per = (def.reload || 0.5) * scale, start = (def.shellStart || 0) * scale;
    return { kind: 'shell', per, start, shellAt: (i) => start + (i + SHELL_IN) * per, total: (n) => start + (n - 1 + SHELL_IN) * per };
  }
  const total = (def.reload || CLOCK) * scale, k = total / CLOCK;
  return {
    kind: def.reloadKind || 'mag', rate: 1 / k, total,
    at: { magOut: MARKS.magOut * k, magIn: MARKS.magIn * k, slideRelease: MARKS.slideRelease * k, done: total },
  };
}

// The pump (and the revolver's index) inside a shot period, as fractions of it: the forend waits out
// the recoil, comes back (the hull leaves at `eject`), and goes forward.
export const PUMP = { back0: 0.22, back1: 0.44, eject: 0.4, fwd0: 0.5, fwd1: 0.72 };
export function pumpAt(u) { // u: 0..1 of the pump overlay -> forend travel 0..1
  if (u <= PUMP.back0 || u >= PUMP.fwd1) return 0;
  if (u < PUMP.back1) { const t = (u - PUMP.back0) / (PUMP.back1 - PUMP.back0); return 1 - (1 - t) * (1 - t); }
  if (u < PUMP.fwd0) return 1;
  const t = (u - PUMP.fwd0) / (PUMP.fwd1 - PUMP.fwd0);
  return 1 - t * t;
}

// ---- the shot's blast, by class ---------------------------------------------------------------------
// size: metres across the flame at the muzzle; light: strength of the flash term on the viewmodel;
// fall: its falloff (1 / (1 + fall d^2)): a long gun's blast has to reach back along its barrel.
export const FLASH = {
  pistol: { size: 0.2, light: 1.0, fall: 34 },
  revolver: { size: 0.3, light: 1.5, fall: 26 },
  smg: { size: 0.17, light: 0.85, fall: 22 },
  shotgun: { size: 0.44, light: 2.6, fall: 7 },
  rifle: { size: 0.24, light: 1.2, fall: 12 },
  lmg: { size: 0.26, light: 1.3, fall: 12 },
  special: { size: 0.3, light: 1.5, fall: 12 },
};
export const flashFor = (cls) => FLASH[cls] || FLASH.pistol;

// ---- poses ----------------------------------------------------------------------------------------
// hip / sprint / lowered: { pos, rot }. ads: metres from the eye to the model's sight anchor (the
// gun is then square to the view with the sight line on the axis; adsRot, optional, tips it: a
// shotgun's eye sits above the receiver and the muzzle comes up to put the bead on the axis). elbow / elbowAds: view-space
// points the forearms run toward. kick: recoil impulse scales [back, pitch, up, yaw, roll].
// fov: the viewmodel's own vertical field of view at hip and when aiming.
// The hip hold differs by class, and in every one the bore runs toward the crosshair (a few degrees
// inward of it, never across the view): a pistol out in front of the chest; an SMG compact and high;
// a rifle at low ready off the shoulder; a shotgun low at the hip, canted; an LMG slung lowest, heavy
// and rolled over; the specials low like a shotgun (the Jumper) or out like a pistol (the flare gun).
const PISTOL_POSE = {
  hip: { pos: [0.15, -0.075, -0.35], rot: [0.06, 0.2, 0.12] },
  sprint: { pos: [0.08, -0.105, -0.3], rot: [-0.55, 0.55, 0.25] },
  lowered: { pos: [0.17, -0.362, -0.225], rot: [-0.85, 0.8, -0.3] },
  ads: 0.34,
  elbow: { right: [0.6, -0.24, -0.14], left: [-0.02, -0.42, -0.16] },
  elbowAds: { right: [0.3, -0.42, 0.06], left: [-0.2, -0.45, 0.02] },
  kick: [0.8, 4.6, 0.32, 1.1, 1.6],
  fov: [55, 46],
};
const LONG_POSE = {
  hip: { pos: [0.15, -0.135, -0.215], rot: [0.02, 0.08, 0.05] },
  sprint: { pos: [0.16, -0.225, -0.2], rot: [0.2, 0.7, 0.15] }, // a low carry across the body, muzzle a little up and to the left: the gun runs under the middle of the view, never through it (tests/viewmodel.test.js)
  lowered: { pos: [0.13, -0.4, -0.12], rot: [-0.8, 0.5, -0.2] },
  ads: 0.2,
  elbow: { right: [0.5, -0.34, 0.1], left: [-0.1, -0.5, -0.2] },
  elbowAds: { right: [0.34, -0.4, 0.16], left: [-0.22, -0.46, -0.1] },
  kick: [1.5, 3.2, 0.2, 0.8, 1.0],
  fov: [55, 46],
};
export const POSES = {
  pistol: PISTOL_POSE,
  revolver: { ...PISTOL_POSE, ads: 0.25, hip: { pos: [0.15, -0.08, -0.345], rot: [0.06, 0.2, 0.12] }, kick: [1.2, 9.5, 0.5, 1.6, 2.4] },
  smg: { ...LONG_POSE, hip: { pos: [0.13, -0.092, -0.235], rot: [0.015, 0.09, 0.05] }, ads: 0.17, kick: [0.5, 1.5, 0.1, 0.6, 0.8] },
  shotgun: { ...LONG_POSE, hip: { pos: [0.19, -0.195, -0.25], rot: [0.035, 0.085, 0.12] }, ads: 0.08, adsRot: [0.02, 0, 0], kick: [2.6, 6.5, 0.4, 1.2, 1.6] },
  rifle: { ...LONG_POSE, kick: [0.7, 1.9, 0.12, 0.6, 0.8] },
  lmg: { ...LONG_POSE, hip: { pos: [0.195, -0.205, -0.225], rot: [0.045, 0.09, 0.2] }, kick: [0.8, 1.7, 0.12, 0.7, 0.9] },
  special: { ...LONG_POSE, hip: { pos: [0.15, -0.11, -0.3], rot: [0.05, 0.14, 0.1] }, kick: [1.2, 3.0, 0.2, 0.8, 1.0] },
};
export const poseFor = (cls, over) => (over ? { ...(POSES[cls] || PISTOL_POSE), ...over } : POSES[cls] || PISTOL_POSE);

// ---- reload clips -----------------------------------------------------------------------------------
// Keyframes are [time, value, easeIntoThisKey?] on the CLOCK. Fields:
//   pos, rot   the gun's absolute pose while reloading (same layout as a pose)
//   mix        0..1 blend from the held pose to pos/rot
//   thumb      firing thumb reaching for the release;  magRel: the release itself (model state `magRelease`)
//   spare      metres the fresh magazine still has to travel, from `align` to `magIn`
//   wellStart  metres out of its seat that the fresh magazine lines up
//   drop       m/s2 the old magazine runs out of its well at (and keeps when it is clear)
//   tracks     { stateName: keyframes } written to the model's state every frame of the clip
//   release    'locked' (the action is released at slideRelease only if it was held open) | 'always'
//   knock      [up, pitch] nudge on the recoil springs when the magazine goes home
const PISTOL_MAG = {
  pos: [[0, [0.035, 0.005, -0.34]], [1.02, [0.035, 0.005, -0.34]], [1.05, [0.037, 0.017, -0.34], 'out'], [1.16, [0.035, 0.003, -0.34]], [1.6, [0.035, 0.005, -0.34]]],
  rot: [[0, [0.52, 0.3, -0.72]], [1.02, [0.52, 0.3, -0.72]], [1.05, [0.56, 0.3, -0.75], 'out'], [1.16, [0.5, 0.3, -0.7]], [1.24, [0.5, 0.3, -0.7]], [1.6, [0.5, 0.3, -0.7]]],
  mix: [[0, 0], [0.24, 1, 'io'], [1.26, 1], [1.56, 0, 'io']],
  thumb: [[0.08, 0], [0.17, 1, 'out'], [0.32, 1], [0.44, 0], [1.2, 0], [1.3, 0.8, 'in'], [1.38, 0.8], [1.5, 0]],
  magRel: [[0.13, 0], [0.18, 1, 'out'], [0.34, 1], [0.44, 0]],
  spare: [[MARKS.align, 0.125], [0.94, 0.06, 'io'], [MARKS.open, 0.05], [MARKS.magIn, 0, 'in3']],
  wellStart: 0.125, drop: 12.5, tracks: null, release: 'locked', knock: [0.18, 0.7],
};
// a long gun stays low and rolls its magazine well toward the support hand
const LONG_MAG = {
  ...PISTOL_MAG,
  pos: [[0, [0.07, -0.035, -0.27]], [1.02, [0.07, -0.035, -0.27]], [1.05, [0.07, -0.026, -0.27], 'out'], [1.16, [0.07, -0.037, -0.27]], [1.6, [0.07, -0.035, -0.27]]],
  rot: [[0, [0.46, 0.2, -0.66]], [1.02, [0.46, 0.2, -0.66]], [1.05, [0.49, 0.2, -0.68], 'out'], [1.16, [0.45, 0.2, -0.64]], [1.6, [0.46, 0.2, -0.66]]],
  thumb: [[0, 0], [1.6, 0]],
  spare: [[MARKS.align, 0.2], [0.94, 0.09, 'io'], [MARKS.open, 0.07], [MARKS.magIn, 0, 'in3']],
  wellStart: 0.2, knock: [0.12, 0.45],
};
export const CLIPS = {
  mag: { pistol: PISTOL_MAG, long: LONG_MAG },
  // muzzle up and rolled out so the opened cylinder faces the eye: latch, swing out, the rod throws
  // the six cases clear; then muzzle down, a loader drops six fresh rounds in from behind (the hand
  // that brings it is between the eye and the cylinder), and the cylinder is swung shut
  cylinder: {
    ...PISTOL_MAG,
    pos: [[0, [0.03, -0.01, -0.33]], [0.3, [0.03, 0.0, -0.33]], [0.36, [0.03, -0.012, -0.33], 'in'], [0.56, [0.085, 0.0, -0.31], 'io'], [1.02, [0.085, 0.0, -0.31]], [1.05, [0.085, -0.006, -0.312], 'out'], [1.2, [0.085, 0.0, -0.31]], [1.6, [0.05, -0.035, -0.35]]],
    rot: [[0, [0.75, 0.25, -0.5]], [0.3, [0.95, 0.25, -0.55]], [0.58, [-0.55, 0.05, 0.0], 'io'], [1.22, [-0.55, 0.05, 0.0]], [1.36, [-0.1, 0.3, -0.2], 'io'], [1.6, [-0.1, 0.3, -0.2]]],
    mix: [[0, 0], [0.2, 1, 'io'], [1.32, 1], [1.58, 0, 'io']],
    thumb: [[0.02, 0], [0.1, 1, 'out'], [0.22, 1], [0.34, 0], [1.6, 0]],
    magRel: [[0.05, 0], [0.1, 1, 'out'], [0.22, 1], [0.34, 0]],
    spare: [[MARKS.align, 0.09], [0.96, 0.03, 'io'], [MARKS.magIn, 0, 'in']],
    wellStart: 0.09, drop: 8, release: 'always', knock: [0.05, 0.2],
    tracks: {
      crane: [[0.1, 0], [0.22, 1, 'out'], [1.24, 1], [1.33, 0, 'in']],
      rod: [[0.24, 0], [0.3, 1, 'out'], [0.37, 1], [0.44, 0]],
    },
  },
  belt: { ...LONG_MAG, tracks: { cover: [[0.1, 0], [0.24, 1, 'out'], [1.2, 1], [1.34, 0, 'in']] }, release: 'always' },
  cell: { ...LONG_MAG },
  // shells through the loading gate: the gun rolls over so the gate faces the support hand
  shell: {
    pos: [0.05, -0.085, -0.24], rot: [0.34, 0.16, -0.95],
    mixIn: 0.22, // seconds to reach the loading pose (inside the first shell's period)
    carry: [0.12, 0.56], // fractions of a period: the hand with the shell leaves the pouch .. is at the gate
    push: 0.058, // metres the shell is pushed through the gate, between carry[1] and SHELL_IN
  },
};
// The clip for a weapon: by reload kind, then by frame size, then the model's own overrides.
export function clipFor(def, over) {
  const kind = def.reloadKind || 'mag';
  let c = CLIPS[kind] || CLIPS.mag;
  if (kind === 'mag') c = def.cls === 'pistol' || def.cls === 'revolver' ? c.pistol : c.long;
  return over ? { ...c, ...over } : c;
}

// ---- small additive clips -----------------------------------------------------------------------
// { pos, rot }: keyframes on 0..1 of the clip, added to the held pose (metres; pitch, yaw, roll).
// swing: the gun is pulled aside and down while the off hand strikes (the melee blade is drawn elsewhere).
// throw: the gun drops to the right while the support hand comes up and through.
export const SWING = {
  pos: [[0, [0, 0, 0]], [0.12, [0.09, -0.08, 0.05], 'out'], [0.6, [0.09, -0.09, 0.05]], [1, [0, 0, 0], 'io']],
  rot: [[0, [0, 0, 0]], [0.12, [-0.25, 0.5, -0.35], 'out'], [0.6, [-0.3, 0.55, -0.4]], [1, [0, 0, 0], 'io']],
};
// The off hand's strike. Times in seconds from the press: the damage is dealt on the press
// (firing.js), so the wind-up is as short as a movement that still reads can be. Each key is the
// hand in view space: pos (metres), x the way the blade or the haft points, y the back of the hand.
//   knife: a thrust from the hip up to the crosshair; on a hit it stops dead in the body, is driven in
//          a little further and wrenched out; on a miss it carries on across the view.
//   axe:   lifted over the left shoulder and brought down across the crosshair; on a hit the bit
//          stays in for a moment and is levered free.
export const MELEE = {
  knife: {
    wind: 0.07, hit: 0.15, hold: 0.3, back: 0.56,
    cock: { pos: [-0.14, -0.2, -0.22], x: [0.3, 0.35, -0.89], y: [-0.3, 0.5, 0.8] },
    strike: { pos: [-0.045, -0.07, -0.47], x: [0.45, 0.35, -0.82], y: [-0.3, 0.5, 0.8] },
    hitEnd: { pos: [-0.035, -0.062, -0.51], x: [0.4, 0.3, -0.87], y: [-0.55, 0.45, 0.7] },
    missEnd: { pos: [0.07, -0.1, -0.45], x: [0.8, 0.2, -0.55], y: [-0.2, 0.6, 0.75] },
    gun: [0.012, -0.004, 0.02], // the gun's jolt on a hit
  },
  axe: {
    wind: 0.15, hit: 0.27, hold: 0.47, back: 0.76,
    cock: { pos: [-0.16, 0.0, -0.22], x: [-0.25, 0.9, 0.35], y: [-0.9, -0.3, 0.2] },
    strike: { pos: [-0.07, -0.13, -0.42], x: [0.32, 0.5, -0.8], y: [-0.9, 0.3, -0.2] },
    hitEnd: { pos: [-0.07, -0.15, -0.43], x: [0.3, 0.42, -0.86], y: [-0.9, 0.3, -0.2] },
    missEnd: { pos: [0.0, -0.3, -0.36], x: [0.5, -0.2, -0.84], y: [-0.85, 0.1, -0.5] },
    gun: [0.02, -0.01, 0.035],
  },
};
export const THROW = {
  pos: [[0, [0, 0, 0]], [0.25, [0.05, -0.09, 0.03], 'out'], [0.7, [0.05, -0.09, 0.03]], [1, [0, 0, 0], 'io']],
  rot: [[0, [0, 0, 0]], [0.25, [-0.3, 0.3, -0.25], 'out'], [0.7, [-0.3, 0.3, -0.25]], [1, [0, 0, 0], 'io']],
};
