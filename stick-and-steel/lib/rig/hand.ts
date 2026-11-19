import { Quaternion, Vector3 } from 'three';
import { vec } from './ik';

export const PALM_GRIP = vec([0, -.035, .165]);
export const WRIST_ANCHOR = vec([0, .035, 0]);
export const HAND_HUB = vec([0, 0, 0]);
export type HandSide = 'left' | 'right';
export type HandPaths = { stem: Vector3[]; fingers: Vector3[][] };

// Little, middle, index: a relaxed cascade, with the outer fingertip most bent.
// Angles are absolute link directions in degrees, not extra knuckle rotations.
const FINGER_PROFILES = [
  { length: .18, rest: [5, 32], grip: [6, 48] },
  { length: .212, rest: [3, 24], grip: [6, 58] },
  { length: .192, rest: [2, 19], grip: [6, 53] },
];

export function neutralHandRotation(side: HandSide) {
  return new Quaternion().setFromAxisAngle(vec([0, 1, 0]), side === 'left' ? Math.PI / 2 : -Math.PI / 2);
}

/** A three-finger fan and shorter opposing thumb. Each digit has two fixed-length links. */
export function handPaths(curl: number, side: HandSide): HandPaths {
  const amount = Math.max(0, Math.min(1, curl));
  // In this drawing frame fingers point along -Y and the palm faces +Z.
  // The RIGHT thumb is +X; after the neutral rotation both thumbs point forward.
  const mirror = side === 'right' ? 1 : -1;
  const stem = [WRIST_ANCHOR.clone(), HAND_HUB.clone()];
  const fingers = [-1, 0, 1].map((fan, i) => {
    const { length, rest, grip } = FINGER_PROFILES[i];
    const points = [HAND_HUB.clone()];
    for (const [j, fraction] of [.6, .4].entries()) {
      // Tips turn gently inward as well as toward the palm, even at zero grip.
      const restSpread = [23, 20][j];
      const spread = fan * (restSpread + (16 - restSpread) * amount) * Math.PI / 180;
      const angle = (rest[j] + (grip[j] - rest[j]) * amount) * Math.PI / 180;
      const direction = vec([Math.sin(spread) * Math.cos(angle), -Math.cos(spread) * Math.cos(angle), Math.sin(angle)]);
      points.push(points[j].clone().addScaledVector(direction, length * fraction));
    }
    return points;
  });
  // The thumb branches nearer the wrist and closes across the side of the ball.
  const thumb = [vec([0, .012, 0])];
  const openDirections = [[.94, -.34, .07], [.72, -.67, .2]];
  const closedDirections = [[.9, -.2, .35], [.75, -.35, .53]];
  for (const [i, length] of [.078, .069].entries()) {
    const direction = vec(openDirections[i]).lerp(vec(closedDirections[i]), amount).normalize();
    thumb.push(thumb[i].clone().addScaledVector(direction, length));
  }
  fingers.push(thumb);
  for (const path of [stem, ...fingers]) for (const p of path) p.x *= mirror;
  return { stem, fingers };
}

/** A cylindrical handle grip: the same two links fold back around the hilt. */
export function handlePaths(side: HandSide): HandPaths {
  const mirror = side === 'right' ? 1 : -1;
  const paths = handPaths(0, side);
  paths.fingers = FINGER_PROFILES.map(({ length }, i) => {
    const points = [HAND_HUB.clone()];
    for (const [j, fraction] of [.6, .4].entries()) {
      const bend = [-8, 135][j] * Math.PI / 180, spread = (i - 1) * .14;
      points.push(points[j].clone().addScaledVector(vec([mirror * Math.sin(spread) * Math.cos(bend), -Math.cos(spread) * Math.cos(bend), Math.sin(bend)]), length * fraction));
    }
    return points;
  });
  const thumb = [vec([0, .012, 0])];
  for (const [i, length] of [.078, .069].entries()) {
    const direction = [vec([mirror * .04, -.062, .025]), vec([-mirror * .005, -.063, .014])][i].normalize();
    thumb.push(thumb[i].clone().addScaledVector(direction, length));
  }
  paths.fingers.push(thumb);
  return paths;
}
