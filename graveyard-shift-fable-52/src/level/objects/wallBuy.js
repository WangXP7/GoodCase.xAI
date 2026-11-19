// Wall-buy boards: a slate in a timber frame on the wall, the weapon's own silhouette
// chalked on it in outline, two pegs under it, a clip lamp over it that comes on with the power.
// The chalk carries a little light of its own so it reads in the dark from across a room.
import { M, rgb } from '../build.js';
import { CHALKED } from '../../mats/yard.js';

// spot: { pos }, n: unit [x, z] out of the wall, weapon: a tuning.weapons id; power: the channel
// that follows the power
export function placeWallBuy(ctx, spot, n, weapon, power) {
  const O = ctx.stat(spot.zone);
  const yaw = Math.atan2(n[0], n[1]);
  const id = CHALKED.includes(weapon) ? weapon : 'pump';
  O.at(M(spot.pos[0] + n[0] * 0.012, spot.pos[1], spot.pos[2] + n[1] * 0.012, 0, yaw, 0), () => {
    O.box([-0.74, -0.34, 0], [0.74, 0.34, 0.02], rgb(0x101412));
    for (const s of [-1, 1]) { O.box([-0.78, s * 0.36 - 0.035, 0], [0.78, s * 0.36 + 0.035, 0.04], rgb(0x4a3420)); O.box([s * 0.76 - 0.035, -0.39, 0], [s * 0.76 + 0.035, 0.39, 0.04], rgb(0x4a3420)); }
    O.quad([-0.66, -0.24, 0.022], [1.32, 0, 0], [0, 0.48, 0], { tex: `chalk:${id}`, color: [0.8, 0.8, 0.74], glow: [0.5, 0.5, 0.44] });
    for (const sx of [-0.4, 0.4]) O.box([sx - 0.012, -0.5, 0], [sx + 0.012, -0.48, 0.14], rgb(0x8a8e92));
    // the clip lamp
    O.box([-0.3, 0.42, 0], [0.3, 0.47, 0.1], rgb(0x23262a));
    O.quad([-0.28, 0.42, 0.02], [0.56, 0, 0], [0, 0, 0.07], { color: [0.3, 0.3, 0.3], glow: [9, 7.5, 5], ch: power });
    O.quad([-0.66, -0.24, 0.0225], [1.32, 0, 0], [0, 0.48, 0], { tex: `chalk:${id}`, color: [0.2, 0.2, 0.2], glow: [1.1, 1.0, 0.8], ch: power });
  });
}
