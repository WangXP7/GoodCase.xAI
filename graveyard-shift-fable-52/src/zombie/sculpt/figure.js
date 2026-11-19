// A whole figure as one sculpt: trunk, limbs, feet, then the head and hands. Sex and build are
// parameter sets over the same primitives (so the cages, UVs and baked maps are shared):
//   sex    'm' | 'f'
//   build  'gaunt' | 'average' | 'heavy' | 'bloated' | 'brute'
// Everything is in rest space on the base skeleton (skeleton.js REST); a zombie's own height and
// limb lengths still come from bone scales.
import { Figure } from './sdf.js';
import { sculptHead, FACE } from './head.js';
export const FACES = FACE.length;
import { sculptHand, WRIST } from './hands.js';
import { B, SHOULDER, armPoint, ARM_U, ARM_ABDUCT } from '../skeleton.js';

export const BUILDS = ['gaunt', 'average', 'heavy', 'bloated', 'brute'];
const FAT = { gaunt: -1, average: 0, heavy: 1, bloated: 1.6, brute: 0.25 };
export const shapeOf = (sex, build) => ({ fem: sex === 'f' ? 1 : 0, fat: FAT[build] ?? 0, brute: build === 'brute' ? 1 : 0, bloat: build === 'bloated' ? 1 : 0 });

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const ELBOW = armPoint(0, -ARM_U, 0);
export const HIP = [0.094, 0.932, 0], KNEE = [0.1, 0.502, 0.004], ANKLE = [0.104, 0.092, -0.012];

const cache = new Map();
// face: 0 = the plain face of this sex and build; 1..FACES-1 = the same person-shaped head with
// other bones under it (head.js: FACE). Only the head's cage is wrapped on those figures.
export function buildFigure(sex = 'm', build = 'average', face = 0) {
  const key = `${sex}:${build}:${face}`;
  let F = cache.get(key);
  if (F) return F;
  const q = { ...shapeOf(sex, build), face: FACE[face] || FACE[0] };
  F = new Figure(B);
  F.shape = q; F.sex = sex; F.build = build;
  const fem = q.fem, g = Math.max(0, -q.fat), h = Math.max(0, q.fat), br = q.brute;
  const tw = 1 + 0.1 * h + 0.17 * br - 0.085 * fem - 0.05 * g;      // trunk width
  const td = 1 + 0.26 * h + 0.16 * br - 0.06 * fem - 0.1 * g;       // trunk depth
  const ag = 1 + 0.2 * h + 0.36 * br - 0.15 * fem - 0.12 * g;       // arm girth
  const lg = 1 + 0.2 * h + 0.24 * br - 0.05 * fem - 0.13 * g;       // leg girth
  const AZ = [0, 0, ARM_ABDUCT];
  F.group = 4;
  // ---- trunk
  F.ell('spine2', [0, 1.3, -0.008], [0.16 * tw, 0.165, 0.106 * td], { k: 0, fall: 0.07 });
  F.ell('spine2', [0, 1.392, -0.02], [0.158 * tw, 0.058, 0.09 * td], { k: 0.04, fall: 0.06 });
  F.ell('spine1', [0, 1.118, 0.004 + 0.02 * h], [(0.138 - 0.012 * fem) * tw * (1 + 0.2 * h), 0.14, 0.096 * td * (1 + 0.25 * h)], { k: 0.05, fall: 0.07 });
  F.ell('hips', [0, 0.975, -0.006], [(0.156 + 0.02 * fem) * tw, 0.102, 0.1 * td], { k: 0.05, fall: 0.07 });
  if (h > 0) F.ell('spine1', [0, 1.075 - 0.02 * q.bloat, 0.05 + 0.045 * h], [0.115 * h + 0.03, 0.12 * h + 0.03, 0.095 * h + 0.03], { k: 0.06, fall: 0.05 });
  if (g > 0) F.ell('spine1', [0, 1.13, 0.115], [0.085, 0.1, 0.03 * g], { k: 0.04, sub: 1 });
  F.ell('hips', [0.078, 0.915, -0.056 * td], [0.08 * (1 + 0.18 * h), 0.088, 0.07 * (1 + 0.22 * h)], { k: 0.03, fall: 0.06 });   // glute
  if (fem) F.ell('spine2', [0.074, 1.305, 0.078], [0.058 + 0.012 * h, 0.06 + 0.01 * h, 0.05 + 0.014 * h], { k: 0.02, fall: 0 });
  else F.ell('spine2', [0.076, 1.338, 0.066 * td], [0.08, 0.05, 0.03 + 0.012 * h + 0.01 * br], { k: 0.022, rot: [0.15, 0.25, 0.1], fall: 0 });
  F.cone('spine2', [0.03, 1.512, -0.036], [0.155, 1.436, -0.028], 0.03 + 0.014 * br, 0.024 + 0.008 * br, { k: 0.035, fall: 0.04 });   // trapezius
  F.cone('clavL', [0.018, 1.453, 0.04], [0.166, 1.448, 0.0], 0.0105, 0.0115, { k: 0.012 + 0.014 * h, fall: 0.03 });
  F.ell('spine2', [0.094, 1.345, -0.09 * td], [0.056, 0.07, 0.022], { k: 0.03, rot: [0, -0.3, 0], fall: 0 });                     // shoulder blade
  F.cone('spine1', [0, 1.02, -0.112 * td], [0, 1.42, -0.118 * td], 0.011, 0.011, { k: 0.022, sub: 1 });                            // spine furrow
  if (!fem) F.cone('spine2', [0, 1.26, 0.104 * td], [0, 1.4, 0.086 * td], 0.006, 0.006, { k: 0.014, sub: 1 });
  if (g > 0) F.ell('clavL', [0.085, 1.468, 0.012], [0.05, 0.012, 0.02], { k: 0.015, sub: 1 });                                     // hollow above the collar bone

  // ---- arm (group 8)
  const S = SHOULDER, E = ELBOW, W = WRIST;
  F.group = 8;
  F.ell('upperArmL', [S[0] + 0.02, S[1] - 0.016, S[2]], [0.054 * ag, 0.07, 0.057 * ag], { k: 0.03, rot: AZ, fall: 0.05 });        // deltoid
  F.group = 8;
  F.cone('upperArmL', S, E, 0.045 * ag, 0.037 * ag, { k: 0.03, fall: 0.06 });
  const bi = mix(S, E, 0.52), tr = mix(S, E, 0.45);
  F.ell('upperArmL', [bi[0], bi[1], bi[2] + 0.014], [0.034 * ag, 0.085, 0.034 * ag], { k: 0.02, rot: AZ, fall: 0 });
  F.ell('upperArmL', [tr[0], tr[1], tr[2] - 0.016], [0.034 * ag, 0.09, 0.032 * ag], { k: 0.02, rot: AZ, fall: 0 });
  F.ell('foreArmL', E, [0.035 * ag, 0.035 * ag, 0.035 * ag], { k: 0.02, fall: 0.045 });
  F.ell('foreArmL', [E[0] + 0.004, E[1] + 0.006, E[2] - 0.03 * ag], [0.012, 0.014, 0.01], { k: 0.012, fall: 0 });                  // point of the elbow
  F.cone('foreArmL', E, W, 0.039 * ag, 0.0255 * (0.6 + 0.4 * ag), { k: 0.02, fall: 0.05 });
  const fm = mix(E, W, 0.26);
  F.ell('foreArmL', [fm[0], fm[1], fm[2] + 0.004], [0.037 * ag, 0.08, 0.041 * ag], { k: 0.02, rot: AZ, fall: 0 });

  // ---- leg (group 16)
  F.group = 16;
  F.cone('thighL', [0.092, 0.9, 0], KNEE, (0.086 + 0.008 * fem) * lg, 0.054 * lg, { k: 0.035, fall: 0.07 });
  F.ell('thighL', [0.099, 0.72, 0.022], [0.062 * lg, 0.17, 0.058 * lg], { k: 0.03, fall: 0 });
  F.ell('thighL', [0.096, 0.72, -0.03], [0.058 * lg, 0.16, 0.05 * lg], { k: 0.03, fall: 0 });
  F.ell('shinL', KNEE, [0.051 * Math.sqrt(lg), 0.05, 0.051 * Math.sqrt(lg)], { k: 0.02, fall: 0.055 });
  F.ell('shinL', [0.1, 0.508, 0.046], [0.026, 0.03, 0.016], { k: 0.012, fall: 0 });                                                // kneecap
  F.cone('shinL', KNEE, ANKLE, 0.052 * lg, 0.034, { k: 0.02, fall: 0.06 });
  F.ell('shinL', [0.102, 0.37, -0.03], [0.045 * lg, 0.11, 0.047 * lg], { k: 0.025, fall: 0 });                                     // calf
  F.cone('shinL', [0.1, 0.47, 0.04], [0.104, 0.13, 0.016], 0.011, 0.011, { k: 0.02, fall: 0 });                                    // shin bone
  F.cone('shinL', [0.104, 0.2, -0.04], [0.104, 0.062, -0.05], 0.013, 0.015, { k: 0.015, fall: 0 });                                // tendon to the heel
  F.ell('footL', [0.134, 0.098, -0.014], [0.013, 0.014, 0.014], { k: 0.01, fall: 0 });
  F.ell('footL', [0.077, 0.104, -0.01], [0.012, 0.014, 0.014], { k: 0.01, fall: 0 });
  // ---- foot
  F.ell('footL', [0.104, 0.038, -0.046], [0.034, 0.037, 0.04], { k: 0.015, fall: 0.04 });
  F.ell('footL', [0.107, 0.04, 0.02], [0.04, 0.034, 0.085], { k: 0.02, rot: [0.14, 0, 0], fall: 0.04 });
  F.ell('toeL', [0.108, 0.024, 0.098], [0.047, 0.021, 0.034], { k: 0.015, fall: 0.03 });
  const toes = [[0.086, 0.158, 0.0132], [0.104, 0.156, 0.0096], [0.118, 0.151, 0.009], [0.13, 0.144, 0.0086], [0.141, 0.136, 0.0082]];
  for (const [x, z, r] of toes) F.cone('toeL', [x + 0.001, 0.02, 0.116], [x, 0.0125 + r * 0.25, z], r, r * 0.9, { k: 0.003, fall: 0 });
  F.group = 31;
  F.box('footL', [0.1, -0.06, 0.03], [0.3, 0.06, 0.4], 0, { k: 0.006, sub: 1 });                                                   // the ground
  F.marks.toes = toes;

  sculptHead(F, q);
  sculptHand(F, q);
  F.pack();
  cache.set(key, F);
  return F;
}
