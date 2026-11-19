// What a seed decides about one zombie: which of the six people it was, its build, its skin, hair,
// eyes, old wounds and clothes. Geometry is shared; a look is a list of shells (index ranges of the
// wardrobe) and the uniforms of its one material.
import { makeOutfit } from './garments.js';
import { SKIN_ALWAYS, SKIN_BODY } from './bodyGeo.js';

export const VARIANTS = ['trucker', 'waitress', 'mechanic', 'guest', 'trooper', 'drifter'];
const TONES = [0xc49a7c, 0xb98c6e, 0xa87856, 0x8d6244, 0x6e4a34, 0xd0a890];
const HAIR = [0x1a1510, 0x2b1d12, 0x3a3128, 0x58524a, 0x120f0d, 0x4a2c16, 0x6a6660, 0x7a6a4a];
const EYES = [0x8a8f6a, 0x6f8494, 0x7a6a48, 0x9a9a8a, 0x5a6a52];

export function pickVariant(rng) { return rng.pick(VARIANTS); }
export function pickSex(rng, variant) { const f = { waitress: 0.92, trooper: 0.15, trucker: 0.1, mechanic: 0.2, guest: 0.45, drifter: 0.3 }[variant] ?? 0.3; return rng.next() < f ? 'f' : 'm'; }
export function pickBuild(rng, variant) {
  const r = rng.next();
  if (variant === 'trucker') return r < 0.62 ? 'heavy' : r < 0.92 ? 'average' : 'gaunt';
  if (variant === 'trooper') return r < 0.25 ? 'heavy' : r < 0.85 ? 'average' : 'gaunt';
  return r < 0.34 ? 'gaunt' : r < 0.82 ? 'average' : 'heavy';
}

export function makeLook(rng, variant, sex, build, opts = {}) {
  const r = rng;
  const outfit = makeOutfit(r.fork('outfit'), variant, sex, build, opts);
  const shells = [];
  // outermost first: clothing, then hair, then skin (so depth rejects what is covered)
  for (const s of outfit.shells) shells.push(s);
  // hair: bald, balding (sides only), short, long and matted, or tied up
  const hr = r.next();
  let style = hr < 0.12 ? 'bald' : hr < (sex === 'f' ? 0.15 : 0.34) ? 'balding' : hr < (sex === 'f' ? 0.4 : 0.8) ? 'short' : 'long';
  if (outfit.hair) style = outfit.hair;
  const hat = outfit.hat, hood = outfit.hood;
  if (hood) style = 'hood';
  const hairAmt = style === 'bald' || style === 'hood' ? [0.1, 0.04] : style === 'balding' ? [1, 0.1] : [1, 1];
  if (style !== 'bald' && style !== 'hood') {
    // under a hat (and on a balding head) only what grows below the hat line; both levels of
    // detail carry the same shells, so the far one keeps the same hair
    if (hat || style === 'balding') { shells.push('hairCapLow', 'hairSides'); if (style === 'long') shells.push('hairLongLow'); }
    else if (style === 'bun') shells.push('hairCap', 'hairBun');
    else { shells.push('hairCap', 'hairTop', 'hairSides'); if (style === 'long') shells.push('hairLong'); }
  }
  // damage it arrived with, one side or the other
  const sev = r.next();
  const severed = sev < 0.05 ? 'L' : sev < 0.1 ? 'R' : null;
  const side = () => (r.next() < 0.5 ? 1 : -1);
  const ear = r.next() < 0.14 ? side() : 0;
  // which of the faces of its sex and build (bodyGeo.js: head, head1, head2, head3)
  const face = r.fork('face').int(0, 3);
  shells.push(...SKIN_ALWAYS.map((n) => (n === 'head' && face ? `head${face}` : n)));
  if (ear !== 1) shells.push('earL');
  if (ear !== -1) shells.push('earR');
  if (opts.bare || outfit.barefoot) shells.push('footL', 'footR');
  shells.push(...SKIN_BODY);
  // old wounds: bites and gouges at plausible places [x, y, z, radius, kind]
  const wounds = [];
  if (ear) wounds.push([ear * 0.078, 1.68, -0.012, 0.03, 2]);
  if (r.next() < 0.3) wounds.push([side() * 0.046, 1.628, 0.06, 0.028, 2]);                       // torn cheek
  const SITES = [[0.1, 1.3, 0.1, 0.06], [-0.12, 1.12, 0.08, 0.065], [0.2, 1.43, 0.0, 0.06], [-0.1, 0.7, 0.07, 0.06], [0.05, 1.52, 0.045, 0.04],
    [0.32, 1.2, 0.0, 0.05], [0.0, 1.3, -0.11, 0.07], [0.11, 0.42, 0.04, 0.05], [-0.15, 0.98, 0.06, 0.06], [0.42, 1.03, 0.01, 0.045]];
  const n = r.int(1, 3);
  for (let i = 0; i < n && wounds.length < 4; i++) {
    const s = r.pick(SITES), m = side();
    wounds.push([s[0] * m + r.range(-0.02, 0.02), s[1] + r.range(-0.03, 0.03), s[2], s[3] * r.range(0.8, 1.2), 2]);
  }
  // carriage: how this one holds itself. Each variant leans its own way and each zombie adds to
  // it, so a crowd is not one stiff forward lean: a hunch or a sway back, a list to one side, the
  // head hung, cocked or twisted, one shoulder dropped. [bone, pitch (+ = forward), yaw, roll]
  const pr = r.fork('posture');
  const P = { trucker: [-0.07, 0.03], waitress: [0.02, 0.1], mechanic: [0.05, 0.05], guest: [0.13, 0.12], trooper: [-0.05, -0.04], drifter: [0.1, 0.16] }[variant] || [0.03, 0.05];
  const hunch = P[0] * 0.6 + pr.range(-0.07, 0.05), list = pr.range(-0.09, 0.09), cock = pr.range(-0.2, 0.2), drop = pr.next() < 0.6 ? (pr.next() < 0.5 ? 1 : -1) * pr.range(0.06, 0.16) : 0;
  const posture = [
    ['spine1', hunch * 0.5, 0, list * 0.6], ['spine2', hunch, pr.range(-0.06, 0.06), list * 0.6],
    ['neck', P[1] * 0.4 + pr.range(-0.1, 0.05), cock * 0.4, cock * 0.5], ['head', pr.range(-0.14, 0.03), cock * 0.5, cock * 0.6],
    ['clavL', 0, 0, drop > 0 ? -drop : 0], ['clavR', 0, 0, drop < 0 ? -drop : 0],
  ];
  const tone = r.pick(TONES);
  const tr = ((tone >> 16) & 255) / 255, tg = ((tone >> 8) & 255) / 255, tb = (tone & 255) / 255;
  const lum = 0.3 * tr + 0.6 * tg + 0.1 * tb, k = 0.45, bright = 0.72 + 0.5 * lum;
  return {
    // at the far level, skin under clothing is not drawn
    farSkip: opts.bare || !outfit.shells.length ? null : SKIN_BODY.filter((n) => (n === 'torso' ? true
      : n.startsWith('leg') ? outfit.shells.some((x) => x === 'jeans' || x === 'work' || x === 'slacks')
        : outfit.shells.some((x) => /^(flannel|hoodie|robe|shirtLong)SlL$/.test(x)))),
    posture, variant, sex, build, face, shells, slots: outfit.slots, stripes: outfit.stripes, outfit, wounds, severed, style, hairAmt,
    gear: { armour: !!outfit.armour, helmet: !!outfit.helmet },
    hatShade: hat === 'capT' ? 1 : hat === 'campaign' ? 2 : hat === 'beanie' ? 3 : 0,       // 1, 2: the shade a brim lays on the face; any: the scalp under it is not drawn
    tint: [(1 + (tr / lum - 1) * k) * bright, (1 + (tg / lum - 1) * k) * bright, (1 + (tb / lum - 1) * k) * bright],
    fresh: r.range(0.35, 0.9), rot: r.range(0.2, 0.75), grime: r.range(0.35, 0.8), dirt: r.range(0.45, 0.85), hair: r.pick(HAIR), eye: r.pick(EYES), glow: r.range(0.35, 0.7),
    // blood it starts with: mouth and chin, both hands
    blood: { head: r.range(0.2, 0.45), armL: r.range(0.15, 0.45), armR: r.range(0.15, 0.45), torso: r.range(0, 0.3) },
    capTilt: [r.range(-0.07, 0.05), r.range(-0.3, 0.3), r.range(-0.06, 0.06)],
    seed: 1 + r.next() * 500,
  };
}
