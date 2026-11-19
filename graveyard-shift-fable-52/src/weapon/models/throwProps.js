// What the off hand throws: the frag, the bottle and the decoy, as they are in the hand during the
// wind-up (the view hides them at the release; fx draws them in flight).
//
//   frag     a cast, segmented body under a steel fuze, the lever down its side, the pin's ring
//   molotov  a green beer bottle held by its neck, a paper label, a rag stuffed in the mouth, alight
//   decoy    a twin-bell alarm clock taped to a road flare stick, two wires between them
//
// Hand props in LEFT-HAND space, millimetres, as knife.js describes (+x out past the thumb, -y out
// of the palm, -z along the fingers). Each returns its own `grip` box for arms.solveCarry, so the
// fist closes round a neck, a stick or the whole body of a grenade.
// `buildThrowProps(G, patch) -> { frag, molotov, decoy: { object, grip }, meshes }`.
import { Matrix4 } from 'three';
import { Soup, box, lathe, tube, modelKit } from '../geo.js';
import { HELD, propMats } from './knife.js';

const X = { map: 'yzx' }; // a lathe whose axis lies across the palm
const Y = { map: 'zxy' }; // ... or stands out of it
const ring = (r, wire, segs = 18) => lathe([[r - wire, -wire], [r + wire, -wire], [r + wire, wire], [r - wire, wire]], { segs, closed: true });

export function throwMats(G, patch) {
  const mats = G.mats, rest = { space: 'rest', shelter: 0.5 };
  return {
    ...propMats(G, patch),
    olive: patch(mats.gunmetal({ finish: 'phosphate', color: 0x343a22, wear: 0.45, oil: 0.15, seed: 139, ...rest }), { occ: true, albedo: 0.7, rough: [1.1, 0.5] }),
    glass: patch(mats.gunmetal({ finish: 'polymer', color: 0x14301c, wear: 0.02, oil: 0.6, seed: 141, ...rest }), { rough: [0.22, 0.05] }),
    label: patch(mats.gunmetal({ finish: 'polymer', color: 0xb9ad8c, wear: 0.5, oil: 0, seed: 142, ...rest }), { rough: [1.3, 0.85] }),
    rag: patch(mats.gunmetal({ finish: 'polymer', color: 0x8d8570, wear: 0.3, oil: 0.3, seed: 143, ...rest }), { occ: true, rough: [1.4, 0.9] }),
    flame: patch(mats.emissive({ color: 0xf06a14, nits: 5 })),
    flameCore: patch(mats.emissive({ color: 0xffc860, nits: 11 })),
    flareRed: patch(mats.gunmetal({ finish: 'polymer', color: 0x9c2218, wear: 0.4, oil: 0.05, seed: 144, ...rest }), { occ: true, rough: [1.2, 0.7] }),
    tape: patch(mats.gunmetal({ finish: 'polymer', color: 0x54585a, wear: 0.2, oil: 0.1, seed: 145, ...rest }), { rough: [0.9, 0.45] }),
    face: patch(mats.gunmetal({ finish: 'polymer', color: 0xcfc8b2, wear: 0.15, oil: 0, seed: 146, ...rest }), { rough: [1, 0.6] }),
    wire: patch(mats.gunmetal({ finish: 'polymer', color: 0xa02018, wear: 0.1, oil: 0.1, seed: 147, ...rest })),
  };
}

// ---- frag: gripped whole, so its axis sits a body's radius out of the palm ---------------------------
const FRAG_AT = [20, -43, -70]; // (and out past the thumb: the fuze and the top of the body stand clear of the fist)
const FRAG = [[0, -37], [13, -37], [23, -31], [28.4, -16], [29.6, 0], [27.6, 15], [21.5, 27], [14, 33], [11.5, 35], [0, 35]];
const fragR = (w) => { for (let i = 1; i < FRAG.length; i++) if (w <= FRAG[i][1]) { const a = FRAG[i - 1], b = FRAG[i], t = (w - a[1]) / (b[1] - a[1] || 1); return a[0] + (b[0] - a[0]) * t; } return 11; };
function fragSoups(put) {
  put('olive', lathe(FRAG, { ...X, segs: 28 }));
  // the cast segments: five rows of eight raised lozenges, following the body's swell
  for (let j = 0; j < 5; j++) {
    const w = -24 + j * 11.4, r = fragR(w);
    for (let i = 0; i < 8; i++) {
      const lug = box(w, r - 1.1, 0, 8.6, 3.6, r * 0.6, 1.5);
      put('olive', new Soup().add(lug, new Matrix4().makeRotationX(((i + (j % 2) * 0.5) / 8) * Math.PI * 2)));
    }
  }
  // fuze body, its collar, the striker housing
  put('steel', lathe([[0, 35], [11, 35], [12, 36.5], [12, 40], [9, 41], [9, 54], [7.5, 56], [0, 56]], { ...X, segs: 18 }));
  put('dark', lathe([[9.1, 44], [10.2, 44.6], [10.2, 47.4], [9.1, 48]], { ...X, segs: 18, closed: true }));
  // the lever: off the fuze's head and down the body, on the side that lies under the heel of the hand
  put('olive', tube([[55, 0, 5], [57, 0, 11], [50, 0, 19], [30, 0, 27.5], [4, 0, 33.4], [-12, 0, 32.4]], 5.2, { radial: 8, squash: 0.28, up: [0, 1, 0] }));
  // the pin through the fuze and its ring
  put('edge', lathe([[0, -12], [1, -12], [1, 12], [0, 12]], { segs: 8 }).move(50, 0, 0));
  put('edge', ring(10.5, 1.05).move(50, -9, -21));
}

// ---- bottle: held by the neck, the body out past the little finger, the mouth past the thumb ------------
function bottleSoups(put) {
  put('glass', lathe([[0, -176], [8, -178], [27, -178], [31, -173], [31.4, -84], [29.5, -68], [21, -47], [15, -31], [13.4, -8], [13, 46], [15.2, 48.5], [15.2, 55], [13.6, 58], [10.5, 58]], { ...X, segs: 28 }));
  put('label', lathe([[31.7, -158], [31.9, -157], [31.9, -103], [31.7, -102]], { ...X, segs: 28, closed: true }));
  put('dark', box(-130, 0, -31.95, 30, 22, 0.5, 0.2));
  put('label', lathe([[13.8, 10], [14, 11], [14, 34], [13.8, 35]], { ...X, segs: 20, closed: true }));
  // the rag: stuffed down the neck, out of the mouth and hanging over the back of the hand, wet with fuel
  put('rag', lathe([[0, 40], [10.4, 40], [11, 57], [9, 63], [0, 64]], { ...X, segs: 12 }));
  put('rag', tube([[56, 0, 0], [70, 1, 1], [84, 5, 4], [96, 13, 9], [104, 25, 13], [107, 40, 15]], 9.5, { radial: 8, squash: 0.5, up: [0, 0, 1] }));
  put('rag', tube([[60, 0, -3], [74, -2, -8], [86, 2, -15], [93, 11, -20], [95, 22, -22]], 7, { radial: 7, squash: 0.5, up: [0, 0, 1] }));
  // alight: tongues along the rag's upper side (out of the back of the hand)
  const tongue = (h, r) => lathe([[0, 0], [r * 0.7, h * 0.08], [r, h * 0.3], [r * 0.72, h * 0.6], [r * 0.3, h * 0.86], [0, h]], { ...Y, segs: 8 });
  for (const [x, y, z, h, r, lean] of [[84, 6, 4, 30, 7, 0.25], [97, 16, 9, 42, 9, -0.1], [106, 34, 14, 28, 6.5, 0.3], [90, 8, -16, 24, 6, -0.3], [100, 22, 2, 20, 5, 0.5]]) {
    const m = new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationZ(lean));
    put('flame', new Soup().add(tongue(h, r), m));
    put('flameCore', new Soup().add(tongue(h * 0.5, r * 0.5), m));
  }
}

// ---- decoy: a road flare stick across the palm, an alarm clock taped to its end ------------------------
function decoySoups(put) {
  put('flareRed', lathe([[0, -62], [12, -62], [13.4, -60], [13.4, 44], [0, 44]], { ...X, segs: 20 }));
  put('label', lathe([[13.6, -30], [13.8, -29], [13.8, 6], [13.6, 7]], { ...X, segs: 20, closed: true }));
  put('dark', lathe([[0, -76], [9, -76], [14.4, -72], [14.4, -60], [13.4, -59], [0, -59]], { ...X, segs: 20 })); // striker cap
  // the clock: a brass drum, its face out of the back of the hand, two bells and the hammer between them
  const cx = 72;
  put('brass', lathe([[0, -12], [25, -12], [27.5, -9.5], [27.5, 9.5], [25, 12], [0, 12]], { ...Y, segs: 28 }).move(cx, 0, 0));
  put('face', lathe([[0, 12.2], [22.5, 12.2], [22.5, 12.6], [0, 12.6]], { ...Y, segs: 28 }).move(cx, 0, 0));
  put('steel', lathe([[22.6, 12], [25.4, 12], [25.4, 14.6], [22.6, 14.6]], { ...Y, segs: 28, closed: true }).move(cx, 0, 0)); // bezel
  for (let i = 0; i < 12; i++) put('dark', new Soup().add(box(0, 12.8, -19.5, i % 3 ? 0.9 : 1.6, 0.3, 4, 0.1), new Matrix4().makeRotationY((i / 12) * Math.PI * 2)).move(cx, 0, 0));
  put('dark', new Soup().add(box(0, 13, -7, 1.6, 0.4, 15, 0.2), new Matrix4().makeRotationY(0.9)).move(cx, 0, 0));
  put('dark', new Soup().add(box(0, 13.1, -5, 2, 0.4, 11, 0.2), new Matrix4().makeRotationY(-1.3)).move(cx, 0, 0));
  put('wire', new Soup().add(box(0, 13.2, -9, 0.8, 0.3, 19, 0.1), new Matrix4().makeRotationY(2.6)).move(cx, 0, 0)); // the alarm hand
  for (const sz of [-1, 1]) {
    put('steel', lathe([[0, 0], [12.5, 0], [12.8, 3], [10.5, 9], [5.5, 12.4], [0, 13]], { ...X, segs: 18 }).move(cx + 27, 0, sz * 15));
    put('dark', lathe([[0, -5], [1.6, -5], [1.6, 0], [0, 0]], { ...X, segs: 8 }).move(cx + 27, 0, sz * 15));
    put('brass', lathe([[0, -8], [3, -8], [3.6, -4], [2, 0], [0, 0]], { ...X, segs: 10 }).move(cx - 27, 0, sz * 14)); // feet
  }
  put('dark', lathe([[0, 0], [1.3, 0], [1.3, 13], [3.4, 14], [3.4, 19], [0, 19]], { ...X, segs: 10 }).move(cx + 26, 0, 0)); // hammer
  // tape round both, and the two wires from the clock's back into the stick
  put('tape', lathe([[13.7, 26], [14.3, 27], [14.3, 42], [13.7, 43]], { ...X, segs: 20, closed: true }));
  put('tape', box(cx - 6, 0, 0, 13, 25.2, 56.4, 2.4));
  put('tape', lathe([[13.7, -52], [14.2, -51], [14.2, -40], [13.7, -39]], { ...X, segs: 20, closed: true }));
  put('wire', tube([[cx - 8, -12.5, 8], [cx - 22, -19, 10], [30, -19, 8], [14, -14.5, 4], [6, -13.6, 2]], 1.3, { radial: 6 }));
  put('dark', tube([[cx - 4, -12.5, -8], [cx - 20, -20, -11], [26, -20, -9], [8, -15, -5], [-2, -13.6, -2]], 1.3, { radial: 6 }));
}

export function buildThrowProps(G, patch = (m) => m, M = throwMats(G, patch)) {
  const kit = modelKit(G, M, 'throwProps');
  const at = (o) => (soup) => soup.move(o[0], o[1], o[2]);
  const f = at(FRAG_AT), h = at(HELD);
  fragSoups((mat, soup) => kit.put('frag', mat, f(soup)));
  bottleSoups((mat, soup) => kit.put('molotov', mat, h(soup)));
  decoySoups((mat, soup) => kit.put('decoy', mat, h(soup)));
  const out = { meshes: kit.meshes };
  const grips = {
    frag: { c: [FRAG_AT[0] - 2, FRAG_AT[1], FRAG_AT[2]], h: [34, 27, 27] },
    molotov: { c: [HELD[0], HELD[1], HELD[2]], h: [50, 13.4, 13.4] },
    decoy: { c: [HELD[0] - 8, HELD[1], HELD[2]], h: [52, 13.6, 13.6] },
  };
  for (const name of ['frag', 'molotov', 'decoy']) {
    const object = kit.part(name);
    object.visible = false; object.matrixAutoUpdate = false;
    out[name] = { object, grip: grips[name] };
  }
  return out;
}
