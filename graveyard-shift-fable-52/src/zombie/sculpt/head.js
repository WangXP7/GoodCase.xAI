// The head and neck as sculpt primitives. Authored for the figure's left half (x >= 0) plus central
// forms; lower-face forms belong to the jaw bone so the mouth opens. Landmarks other modules need
// (eyes, mouth line, ears, scalp) are written to F.marks.
//
// q: shape parameters { fem 0|1, fat -1 (gaunt) .. 0 .. 1 (heavy) .. 1.6 (bloated), brute 0|1 }.
const L = (a, b, t) => a + (b - a) * t;

export const HEAD_C = [0, 1.676, -0.004];        // the point the head cage's rays leave from
export const EYE = [0.0318, 1.6835, 0.0635];     // centre of the left eyeball
export const EYE_R = 0.0124;
export const MOUTH_Y = 1.6215;                   // lip line at the centre
export const MOUTH_HALF = 0.0255;
export const EAR_GROUP = 32, NECK_GROUP = 64;

// lip line: height and depth across the mouth (x >= 0); corners drop and sit back
export const mouthLine = (x) => {
  const t = Math.min(1, Math.abs(x) / MOUTH_HALF);
  return [MOUTH_Y - 0.0028 * t * t, 0.0965 - 0.0125 * t * t];
};

// Faces. Each is the same head with other bones under the skin: what changes is how far forms
// stand out along the cage's rays (brow, cheekbones, the hollows under them, the jaw's width and
// angle, the chin, the nose's bridge and tip), never where the eyes and the lip line are, so
// every face shares the cage, the UVs and the baked maps.
//   jaw: wider (+) / narrower jaw   chin: [forward, down, wider]   brow: ridge scale   cheek: cheekbone (+ m)
//   hollow: under the cheekbone (0..1)   full: flesh on the cheek (0..1)   nose: [bridge out, tip out, tip up, width scale]
export const FACE = [
  { jaw: 0, chin: [0, 0, 0], brow: 1, cheek: 0, hollow: 0, full: 0, nose: [0, 0, 0, 1] },
  { jaw: -0.03, chin: [0.002, -0.006, -0.002], brow: 1.3, cheek: 0.0035, hollow: 1, full: 0, nose: [0.0045, 0.003, -0.002, 0.9] },      // long and bony, a hooked nose
  { jaw: 0.1, chin: [0.004, -0.002, 0.005], brow: 0.95, cheek: 0.001, hollow: 0, full: 0.8, nose: [-0.001, -0.003, 0, 1.2] },            // broad and heavy-jawed, a flat nose
  { jaw: -0.07, chin: [-0.006, 0.003, -0.003], brow: 0.7, cheek: -0.0015, hollow: 0, full: 0.45, nose: [-0.002, -0.001, 0.003, 0.88] },   // soft, a weak chin, a short upturned nose
];

export function sculptHead(F, q) {
  const fem = q.fem, g = Math.max(0, -q.fat), h = Math.max(0, q.fat), br = q.brute;
  const fc = q.face || FACE[0];
  const HD = 'head', JW = 'jaw', NK = 'neck';
  F.group = 1;
  // ---- cranium: a long egg, widest behind the ears, with the forehead a separate plane
  F.ell(HD, [0, 1.712, -0.02], [0.0755, 0.089, 0.096], { k: 0, fall: 0.06 });
  F.ell(HD, [0, 1.722, 0.026], [0.066 - 0.003 * fem, 0.062, 0.062], { k: 0.05, fall: 0.05 });
  F.ell(HD, [0, 1.676, -0.07], [0.058, 0.05, 0.034], { k: 0.03, fall: 0.04 });               // occiput
  // ---- the face block: maxilla and the muzzle the mouth sits on
  F.ell(HD, [0, 1.652, 0.03], [0.0585 + 0.004 * h, 0.058, 0.0585], { k: 0.025, fall: 0.035 });
  F.ell(HD, [0, 1.632, 0.06], [0.03, 0.022, 0.029], { k: 0.026, fall: 0.02 });
  // ---- jaw: the mandible as a broad horseshoe, an angle under each ear, a chin
  const jw = 1 + 0.07 * br - 0.07 * fem + 0.05 * h + fc.jaw;
  F.ell(JW, [0, 1.602, 0.024], [0.053 * jw, 0.031, 0.062], { k: 0.022, rot: [0.2, 0, 0], fall: 0.035 });
  F.ell(JW, [0.047 * jw, 1.611, -0.006], [0.016, 0.026, 0.02], { k: 0.02, fall: 0.02 });                       // angle of the jaw
  F.cone(JW, [0.046 * jw, 1.598, 0.004], [0.02, 1.583, 0.066], 0.012, 0.0125, { k: 0.016, fall: 0.02 });       // jaw line
  F.ell(JW, [0, 1.5815 - 0.003 * br + fc.chin[1], 0.071 + 0.003 * br + fc.chin[0]], [0.024 - 0.004 * fem + 0.004 * br + fc.chin[2], 0.0185, 0.019], { k: 0.016, fall: 0.025 });
  if (h > 0) {
    F.ell(JW, [0, 1.572, 0.03], [0.05 * h + 0.012, 0.03 * h + 0.008, 0.05], { k: 0.03, fall: 0.02 });            // double chin
    F.ell(HD, [0.044, 1.622, 0.05], [0.026 * h, 0.03 * h, 0.028 * h], { k: 0.03, fall: 0 });                      // jowl
  }
  // ---- neck: column, the two straps running from behind the ear to the notch, larynx, nape
  const nk = 1 + 0.22 * h + 0.2 * br - 0.12 * fem - 0.08 * g;
  F.group = 1 | NECK_GROUP;      // the neck is also a group of its own: collars are cut on it, not on the jaw over it
  F.cone(NK, [0, 1.47, -0.03], [0, 1.6, -0.016], 0.058 * nk, 0.051 * nk, { k: 0.03, fall: 0.07 });
  F.cone(NK, [0.058, 1.632, -0.03], [0.016, 1.468, 0.032], 0.012 * nk, 0.012 * nk, { k: 0.012 + 0.012 * h, fall: 0 });
  F.ell(NK, [0, 1.548, 0.028 * nk + 0.002], [0.011, 0.017, 0.011], { k: 0.012, fall: 0 });
  F.ell(NK, [0, 1.56, -0.062 * nk], [0.04, 0.06, 0.02], { k: 0.03, fall: 0 });
  if (g > 0) F.ell(NK, [0.03, 1.535, 0.02], [0.012, 0.035, 0.012], { k: 0.02, sub: 1 });                         // hollow beside the windpipe

  F.group = 1;
  // ---- brow: ridge over each eye, meeting at the glabella; temples fall away behind it
  const bw = (1 + 0.5 * br - 0.45 * fem) * fc.brow;
  F.cone(HD, [0.011, 1.7015, 0.089], [0.052, 1.7015, 0.071], 0.0085 * bw, 0.0065 * bw, { k: 0.012, fall: 0 });
  F.ell(HD, [0, 1.699, 0.092], [0.012, 0.009, 0.006 * bw], { k: 0.01, fall: 0 });
  F.ell(HD, [0.071, 1.7, 0.036], [0.01, 0.03, 0.03], { k: 0.025, sub: 1 });
  // ---- cheekbone and the hollow under it
  F.ell(HD, [0.05, 1.663, 0.054], [0.021 + fc.cheek, 0.0125 + 0.003 * g + fc.cheek, 0.024 + fc.cheek], { k: 0.016, rot: [0, 0.5, -0.12], fall: 0 });
  if (fc.hollow > 0) F.ell(HD, [0.049, 1.632, 0.05], [0.016 * fc.hollow, 0.024 * fc.hollow, 0.018 * fc.hollow], { k: 0.02, sub: 1 });
  if (fc.full > 0) F.ell(HD, [0.042, 1.64, 0.058], [0.021 * fc.full, 0.024 * fc.full, 0.02 * fc.full], { k: 0.03, fall: 0 });
  F.cone(HD, [0.056, 1.666, 0.03], [0.07, 1.672, -0.004], 0.0075, 0.006, { k: 0.016, fall: 0 });                 // zygomatic arch
  if (h < 0.5) F.ell(HD, [0.047, 1.628, 0.054], [0.012, 0.02, 0.014], { k: 0.024, sub: 1, rot: [0, 0.4, 0.2] });
  if (g > 0) F.ell(HD, [0.05, 1.63, 0.048], [0.02 * g, 0.03 * g, 0.022 * g], { k: 0.02, sub: 1 });
  if (h > 0) F.ell(HD, [0.043, 1.648, 0.062], [0.022 * h, 0.024 * h, 0.02 * h], { k: 0.03, fall: 0 });

  // ---- eye: socket cut, the ball, lids as two shells that leave an almond open
  F.ell(HD, [EYE[0], EYE[1] + 0.001, EYE[2] + 0.017], [0.0205, 0.0145, 0.016], { k: 0.01, sub: 1 });
  F.ell(HD, EYE, [EYE_R, EYE_R, EYE_R], { k: 0.0006, fall: 0 });
  F.ell(HD, [EYE[0], EYE[1] + 0.0061, EYE[2] - 0.0002], [0.0153, 0.0089, 0.0136], { k: 0.0012, rot: [0.12, 0, -0.06], fall: 0 });   // upper lid, heavy
  F.ell(HD, [EYE[0], EYE[1] - 0.0084, EYE[2] - 0.001], [0.0148, 0.0074, 0.0133], { k: 0.0012, rot: [-0.1, 0, 0.05], fall: 0 });    // lower lid
  F.ell(HD, [EYE[0] + 0.001, EYE[1] - 0.0155, EYE[2] + 0.009], [0.013, 0.0045, 0.005], { k: 0.008, fall: 0 });                         // bag under the eye

  // ---- nose: bridge, tip, wings, nostrils
  const ns = (1 - 0.12 * fem + 0.08 * br) * fc.nose[3], nb = fc.nose[0], nt = fc.nose[1], nu = fc.nose[2];
  F.cone(HD, [0, 1.69, 0.0905 + nb * 0.3], [0, 1.654, 0.109 * L(1, 1.02, br) + nb * 0.6 + nt * 0.4], 0.0072 * ns, 0.0088 * ns, { k: 0.009, fall: 0 });
  if (nb > 0.002) F.ell(HD, [0, 1.672, 0.1 + nb], [0.006, 0.009, 0.006], { k: 0.008, fall: 0 });                                        // the hump of a hooked bridge
  F.ell(HD, [0, 1.6475 + nu, 0.1135 + nt], [0.0105 * ns, 0.0098 * ns, 0.0112 * ns], { k: 0.007, fall: 0 });
  F.ell(HD, [0.0148 * ns, 1.6445 + nu * 0.5, 0.0995 + nt * 0.5], [0.009 * ns, 0.0084 * ns, 0.0112], { k: 0.006, rot: [0, 0.35, 0], fall: 0 });
  F.ell(HD, [0.0072 * ns, 1.6378, 0.1035], [0.0044, 0.0042, 0.0072], { k: 0.0022, sub: 1, rot: [0.5, 0.25, 0] });
  F.ell(HD, [0.0235, 1.647, 0.089], [0.005, 0.009, 0.006], { k: 0.008, sub: 1, rot: [0, 0, 0.35] });                                   // crease round the wing

  // ---- mouth: lips on the muzzle (upper on the head, lower on the jaw), corners tucked in
  const lp = 1 + 0.25 * fem + 0.2 * h;
  F.ell(HD, [0, 1.6262, 0.0915], [0.0245, 0.0047 * lp, 0.0078], { k: 0.006, rot: [-0.2, 0, 0], fall: 0.014 });
  F.ell(HD, [0, 1.6315, 0.0975], [0.005, 0.0045, 0.004], { k: 0.005, sub: 1 });                                                        // philtrum
  F.ell(JW, [0, 1.6162, 0.0898], [0.0215, 0.0054 * lp, 0.0082], { k: 0.006, rot: [0.25, 0, 0], fall: 0.014 });
  F.ell(JW, [0, 1.6035, 0.0915], [0.018, 0.0055, 0.006], { k: 0.008, sub: 1 });                                                        // crease over the chin
  F.ell(HD, [MOUTH_HALF + 0.002, 1.6185, 0.0855], [0.004, 0.0045, 0.005], { k: 0.006, sub: 1 });

  // ---- ear: a dished shell standing off the skull, rim, lobe, tragus
  const ex = 0.0775, er = [0.26, -0.42, -0.1];
  F.group = EAR_GROUP;      // a group of its own: the head's cage is wrapped without it, the ear has its own cage
  F.ell(HD, [ex + 0.0045, 1.681, -0.014], [0.0052, 0.031, 0.0185], { k: 0.006, rot: er, fall: 0 });
  F.ell(HD, [ex + 0.0085, 1.682, -0.0105], [0.0048, 0.0235, 0.0125], { k: 0.004, sub: 1, rot: er });
  F.cone(HD, [ex + 0.0075, 1.69, -0.0135], [ex + 0.0065, 1.672, -0.0105], 0.0034, 0.0028, { k: 0.003, fall: 0 });                      // antihelix
  F.ell(HD, [ex + 0.0075, 1.676, -0.006], [0.004, 0.0085, 0.006], { k: 0.003, sub: 1 });                                               // concha
  F.ell(HD, [ex - 0.0005, 1.6545, -0.006], [0.0048, 0.0085, 0.0068], { k: 0.005, fall: 0 });
  F.ell(HD, [ex - 0.001, 1.6765, 0.0065], [0.0042, 0.0052, 0.0042], { k: 0.004, fall: 0 });

  F.group = 1;
  F.marks.eye = EYE; F.marks.eyeR = EYE_R;
  F.marks.ear = { c: [ex + 0.003, 1.681, -0.012], rot: er };
}
