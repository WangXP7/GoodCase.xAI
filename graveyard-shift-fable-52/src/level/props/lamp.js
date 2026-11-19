// Sodium lamp pole: tapered column on a painted footing, swept arm, cobra-head lantern.
// Local origin at the foot; the arm reaches along +x.
import { M, cylUp, box, sphere, deform, tube, rgb } from '../build.js';

// o: { height, reach, state: 'on'|'dead'|'flicker' }
export function buildLamp(B, o = {}) {
  const H = o.height ?? 8.6, R = o.reach ?? 1.9;
  B.add('paintYellow', cylUp(0.3, 0.32, 0.55, 14), { shadow: true });
  B.add('paintGalv', cylUp(0.16, 0.18, 0.06, 12), { m: M(0, 0.55, 0) });
  B.add('paintGalv', cylUp(0.07, 0.115, H - 0.6, 12), { m: M(0, 0.6, 0), shadow: true });
  // access hatch and a stuck-on notice
  B.add('paintGalv', box(0.1, 0.24, 0.02, 0.006, 1), { m: M(0, 1.3, 0.108) });
  const pts = [[0, H - 0.25, 0], [0.02, H + 0.15, 0], [0.3, H + 0.45, 0], [R * 0.6, H + 0.55, 0], [R, H + 0.5, 0]];
  B.add('paintGalv', tube(pts, 0.045, 7, 5), { shadow: true });
  // lantern
  const head = deform(sphere(0.3, 14, 8), (v) => { v.x *= 1.35; v.y *= v.y > 0 ? 0.42 : 0.3; v.z *= 0.62; });
  B.add('paintGalv', head, { m: M(R + 0.25, H + 0.48, 0), shadow: true });
  const state = o.state || 'on';
  const lens = box(0.5, 0.03, 0.26, 0.012, 1);
  if (state === 'flicker') B.add('flickB', lens, { m: M(R + 0.27, H + 0.385, 0) });
  else B.add(state === 'on' ? 'vcGlow' : 'vcGloss', lens, { m: M(R + 0.27, H + 0.385, 0), color: state === 'on' ? B.glow.sodium : rgb(0x1a1814) });
  if (state !== 'dead') B.fixtures.push({ kind: B.far ? 'sodiumFar' : 'sodium', pos: B.point(R + 0.27, H + 0.33, 0), dir: B.dir(0.16, -1, 0), flicker: state === 'flicker' });
  if (B.far) return;
  B.refl([-0.08, 0, -0.08], [0.08, H, 0.08], rgb(0x767c80, 0.6));
  B.collide([-0.3, 0, -0.3], [0.3, 0.55, 0.3], 'concrete');
  B.collide([-0.12, 0.55, -0.12], [0.12, H, 0.12], 'metal');
}
