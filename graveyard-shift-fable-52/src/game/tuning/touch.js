// Touch controls, aim assist and the player's armour. Design choices, open to tuning.
// line by line. Angles in degrees where the name says so; distances in CSS px or metres.
export const touch = {
  // Stick: anchored where the thumb lands; full deflection at stickRadius from the anchor.
  stickRadius: 56, // CSS px
  deadZone: 0.12, // share of full deflection ignored, the rest rescaled to 0..1
  sprintPush: 0.92, // deflection (forward) that starts auto-sprint ...
  sprintHold: 0.25, // ... once held this long, s
  sprintForward: 0.5, // moveY needed for auto-sprint (the sim only sprints forward)
  // Look: radians per CSS px of drag, times 1 + accel * min(1, speed / accelSpeed).
  look: 0.0052,
  accel: 0.6,
  accelSpeed: 1200, // px/s
  adsScale: 0.55,
  maxLookStep: 0.35, // rad per frame, hypot(yaw, pitch)
  // A tap: no further than tapPx from where it landed, released within tapMs.
  tapPx: 10,
  tapMs: 250,
  // A quick tap in the stick zone jumps: up within stickTapMs of landing, never further than stickTapPx
  // from where it landed (decided on release, so a move never starts with a jump and a fast flick is a move).
  stickTapMs: 180,
  stickTapPx: 12,
  // Aim assist. Levels: 0 off, 1 friction, 2 friction + magnetism. Auto-fire is its own setting.
  frictionScale: 0.55,
  frictionDeg: 2.2,
  magnetDegPerS: 12,
  magnetDeg: 4,
  magnetMaxStepDeg: 0.6, // never across more than this per frame
  autoFireDelay: 0.12, // s continuously on target before auto-fire
  // Auto-fire on a semi-automatic squeezes single shots no faster than a person tapping: at most
  // assistSemiRate a second, and never above the weapon's own rpm. Automatic weapons hold.
  assistSemiRate: 4,
  targetRadius: 0.25, // m: a target point counts as "on target" within this (when no ray is given)
  headY: 1.6, // m above a zombie's feet: aim points
  chestY: 1.2,
  defaultAssist: 2,
  defaultAutoFire: false, // it made semi-automatics feel automatic: opt-in (Settings)
  // Armour plates.
  plate: 50, // hp each
  maxPlates: 3,
};
