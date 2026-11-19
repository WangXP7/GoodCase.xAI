// A motel room and a bay of the motel's front, authored into the area's art mesh.
// Local frame of both: origin on the face of the front wall at the room's left edge (seen from the
// lot) and at floor level; +x along the front, +z out toward the lot, so the room lies at z < 0:
// from the front wall's inner face (z -0.3) to the back wall's (z -5.7).
import { M, box, cyl, cylUp, lathe, rgb, sphere } from '../build.js';

const D0 = -0.3, D1 = -5.7;
const BRASS = rgb(0xb89a48), DARK = rgb(0x141412), WHITE = rgb(0xd8d4c6), STEEL = rgb(0x9a9ea2);

// The eight looks. wall, carpet, spread: colours; state: how the bed was left; tv: 'static' | 'bars' | 'dead' | 'smashed'.
export const ROOM_STYLES = {
  n1: { wall: 0xb9a888, carpet: 0x4a2a22, spread: 0x7a3a2a, state: 'messy', tv: 'static', art: 'art1', lamp: true, stripe: 1.2 },
  n2: { wall: 0x8fa39a, carpet: 0x24423c, spread: 0x2f5a52, state: 'made', tv: 'dead', art: 'art2', lamp: true, clothes: true },
  n3: { wall: 0xa89a9a, carpet: 0x3a2a3a, spread: 0x6a4a6a, state: 'stripped', tv: 'smashed', art: 'art3', lamp: false, bottles: true },
  n4: { wall: 0xb8b090, carpet: 0x4a4424, spread: 0xa88a3a, state: 'camp', tv: 'dead', art: 'art2', lamp: false, candles: true, stripe: 0.9 },
  e1: { wall: 0x9aa0a8, carpet: 0x2a3444, spread: 0x9a9488, state: 'blood', tv: 'bars', art: 'art1', lamp: true, lantern: true },
  e2: { wall: 0xb09a80, carpet: 0x5a3a24, spread: 0xa8562a, state: 'made', tv: 'static', art: 'art3', lamp: true, stripe: 1.5 },
  e3: { wall: 0x98a888, carpet: 0x34442a, spread: 0x4a6a3a, state: 'messy', tv: 'dead', art: 'art2', lamp: true, bottles: true },
  e4: { wall: 0xa890a0, carpet: 0x44243a, spread: 0x3a4a7a, state: 'made', tv: 'smashed', art: 'art1', lamp: false, clothes: true },
};

// Lights of a room: call inside A.room(...) and before any of its geometry. Returns where they are.
// o: { W, H, style, flip, window (local x of a back window, or null), power-less extras by style }
export function roomLights(A, o) {
  const { W, H, style: st, flip } = o;
  const hx = flip ? 0.3 : W - 0.3;
  A.light({ pos: [W / 2, H - 0.4, -3.0], lm: 900, color: A.LIGHT.warm, power: true, real: true, range: 6.5, priority: 0.8 });
  if (st.lamp) A.light({ pos: [hx, 0.95, -1.2], lm: 260, color: A.LIGHT.warm, power: true, amb: 0.002, noShadow: true });
  if (st.tv === 'static' || st.tv === 'bars') A.light({ pos: [flip ? W - 0.6 : 0.6, 0.9, -2.25], lm: 220, color: A.LIGHT.tv, power: true, amb: 0.002, noShadow: true });
  if (st.candles) A.light({ pos: [W / 2 - 0.4, 0.25, -3.6], lm: 60, color: A.LIGHT.candle, amb: 0.002, noShadow: true });
  if (st.lantern) A.light({ pos: [hx, 0.8, -3.25], lm: 130, color: A.LIGHT.tube, amb: 0.002 });
  if (o.window != null) A.light({ pos: [o.window, 1.6, D1 + 0.3], lm: 70, color: A.LIGHT.moon, amb: 0.002, r0: 0.5 });
  A.light({ pos: [(o.door[0] + o.door[1]) / 2, 1.7, D0 + 0.25], lm: 150, color: A.LIGHT.sodium, amb: 0.0015, r0: 0.6 }); // the lot's lamp in at the door
}

// o: { W, H, door: [x0, x1], style, flip (bed on the left wall), window: { x, w, sill, head } | null, id }
export function buildRoom(A, o) {
  const B = A.B, { W, H, style: st, flip, door } = o, r = A.rng;
  const wall = rgb(st.wall, 0.75), carpet = rgb(st.carpet), spread = rgb(st.spread);
  const wopt = { ao: true, cell: 0.35, par: st.stripe || 0 };
  // shell of the room
  A.quad('carpet', [0, 0.004, D0], [W, 0, 0], [0, 0, D1 - D0], carpet, { par: 1, cell: 0.25, ao: true, wetAt: o.wetAt });
  A.quad('plaster', [0, H - 0.004, D1], [W, 0, 0], [0, 0, D0 - D1], rgb(0xa8a494), { cell: 0.6 });
  A.wall('plaster', '+z', D1 + 0.012, 0, W, 0, H, wall, wopt, o.window ? [{ a: o.window.x - o.window.w / 2, b: o.window.x + o.window.w / 2, y0: o.window.sill, y1: o.window.head }] : []);
  A.wall('plaster', '-z', D0 - 0.012, 0, W, 0, H, wall, wopt, [{ a: door[0], b: door[1], y0: 0, y1: 2.1 }]);
  A.wall('plaster', '+x', 0.012, D1, D0, 0, H, wall, wopt);
  A.wall('plaster', '-x', W - 0.012, D1, D0, 0, H, wall, wopt);
  for (const [x0, x1, z0, z1] of [[0, W, D1 + 0.012, D1 + 0.03], [0, door[0], D0 - 0.03, D0 - 0.012], [door[1], W, D0 - 0.03, D0 - 0.012], [0.012, 0.03, D1, D0], [W - 0.03, W - 0.012, D1, D0]]) A.box('wood', [x0, 0, z0], [x1, 0.09, z1], rgb(0x3a2a1c), { par: x1 - x0 > 0.1 ? 0 : 1 });
  // ceiling light
  A.add('paint', cylUp(0.17, 0.2, 0.03, 14), { m: M(W / 2, H - 0.035, -3.0), color: WHITE });
  A.add('glow', lathe([[0, -0.07], [0.1, -0.05], [0.16, 0]], 14), { m: M(W / 2, H - 0.035, -3.0), color: [0.35, 0.33, 0.28], glow: [9, 6.4, 3.6], power: true });

  // the door, pushed back flat against the inside of the front wall; its frame
  const hingeLeft = door[0] > 1.0;
  const dw = door[1] - door[0] - 0.06;
  {
    const x0 = hingeLeft ? door[0] - dw - 0.02 : door[1] + 0.02;
    A.box('paint', [x0, 0.02, D0 - 0.075], [x0 + dw, 2.07, D0 - 0.03], rgb(o.doorColor || 0x1f5a52), { par: 1 });
    A.add('metal', sphere(0.03, 8, 6), { m: M(hingeLeft ? x0 + 0.08 : x0 + dw - 0.08, 1.0, D0 - 0.1), color: BRASS });
    A.sign('rates', [x0 + dw / 2 + 0.12, 1.25, D0 - 0.077], [-0.24, 0, 0], [0, 0.3, 0]);
    for (const x of door) A.box('paint', [x - 0.04, 0, D0 - 0.02], [x + 0.04, 2.1, 0.03], rgb(0xbdb39a), { par: 1 });
    A.box('paint', [door[0] - 0.04, 2.1, D0 - 0.02], [door[1] + 0.04, 2.17, 0.03], rgb(0xbdb39a), { par: 1 });
    A.quad('metal', [door[0], 0.006, 0.0], [door[1] - door[0], 0, 0], [0, 0, D0], rgb(0x7a7e82));
  }
  // the front window from inside: drawn curtains on a rail
  const wx = hingeLeft ? Math.max(0.5, door[0] - dw - 1.9) : Math.min(W - 2.0, door[1] + dw + 0.4);
  if (wx > 0.2 && wx + 1.5 < W - 0.1 && !(wx < door[1] && wx + 1.5 > door[0])) curtain(A, wx, 0.8, 1.5, 1.45, D0 - 0.05, -1, rgb(st.spread, 0.7), r);

  // bed against a side wall, nightstands either side of its head
  const bx0 = flip ? 0.06 : W - 2.06, hx = flip ? 0.012 : W - 0.012, s = flip ? 1 : -1;
  const z0 = -3.0, z1 = -1.5;
  A.box('wood', [bx0, 0.05, z0 + 0.03], [bx0 + 2.0, 0.27, z1 - 0.03], rgb(0x3a2a1c), { par: 0 });
  A.box('wood', [Math.min(hx, hx + s * 0.06), 0, z0 - 0.08], [Math.max(hx, hx + s * 0.06), 1.05, z1 + 0.08], rgb(0x4a3020), { par: 2, shadow: true });
  B.blob(2.6, 2.1, bx0 + 1.0, (z0 + z1) / 2);
  B.tag(`motel:bed:${o.id}`, () => B.collide([bx0, 0, z0], [bx0 + 2.0, 0.56, z1], 'cloth'));
  const head = flip ? bx0 : bx0 + 2.0; // x of the pillow end
  if (st.state === 'camp') {
    // the mattress is up against the back wall as a barricade; they slept on the floor by the candles
    A.box('curtain', [W / 2 - 1.0, 0.02, D1 + 0.05], [W / 2 + 1.0, 1.5, D1 + 0.3], rgb(0xb0aa98), { bevel: 0.06, rx: 0.1 });
    A.box('curtain', [W / 2 - 1.4, 0.006, -4.3], [W / 2 + 0.5, 0.07, -3.3], spread, { bevel: 0.03, ry: 0.15, par: 1 });
    for (let i = 0; i < 4; i++) { const cx = W / 2 - 0.7 + i * 0.22, cz = -3.2 - (i % 2) * 0.1; A.add('paint', cylUp(0.022, 0.025, 0.06 + i * 0.02, 6), { m: M(cx, 0.005, cz), color: WHITE }); A.add('glow', sphere(0.012, 5, 4), { m: M(cx, 0.085 + i * 0.02, cz, 0, 0, 0, 1, 1.8, 1), color: [1, 0.6, 0.2], glow: [30, 15, 4] }); }
    A.detail(() => { for (let i = 0; i < 6; i++) A.add('paint', cylUp(0.037, 0.037, 0.11, 8), { m: M(W / 2 + 0.7 + (i % 3) * 0.1, 0.005, -3.5 - Math.floor(i / 3) * 0.1), color: rgb([0xc8281c, 0x2c8a43, 0xe8b023][i % 3]), par: 1 }); });
  } else {
    A.box('curtain', [bx0, 0.27, z0], [bx0 + 2.0, 0.5, z1], rgb(0xb0aa98), { bevel: 0.05, shadow: true });
    if (st.state !== 'stripped') {
      const messy = st.state === 'messy';
      A.box('curtain', [bx0 + (flip ? 0.45 : -0.02) + (messy ? s * -0.25 : 0), 0.3, z0 - 0.03], [bx0 + (flip ? 2.02 : 1.55) + (messy ? s * -0.25 : 0), 0.56, z1 + 0.03], spread, { bevel: 0.05, par: 1, ry: messy ? 0.12 : 0 });
    } else A.sign('splat', [bx0 + 0.5, 0.503, z1 - 0.2], [1.0, 0, 0], [0, 0, -1.0], { color: [0.2, 0.16, 0.08] });
    for (const pz of [z0 + 0.4, z1 - 0.4]) {
      if (st.state === 'messy' && pz > -2) { A.box('curtain', [bx0 + (flip ? 2.2 : -0.75), 0.01, pz - 0.2], [bx0 + (flip ? 2.75 : -0.2), 0.14, pz + 0.2], WHITE, { bevel: 0.06, ry: 0.5 }); continue; }
      A.box('curtain', [head - (flip ? -0.05 : 0.5), 0.5, pz - 0.28], [head - (flip ? -0.5 : 0.05), 0.64, pz + 0.28], WHITE, { bevel: 0.06 });
    }
    if (st.state === 'blood') {
      A.sign('splat', [bx0 + 0.4, 0.563, z1 - 0.1], [1.3, 0, 0], [0, 0, -1.3], { color: [0.14, 0.006, 0.005], par: 1 });
      A.sign('smear', [1.0, 0.009, -0.9], [2.6, 0, 0], [0, 0, -1.1], { color: [0.13, 0.006, 0.005], par: 1 });
      if (flip) A.sign('splat', [0.02, 0.7, -1.6], [0, 0, -1.1], [0, 1.1, 0], { color: [0.13, 0.006, 0.005], par: 1 });
      else A.sign('splat', [W - 0.02, 0.7, -2.9], [0, 0, 1.1], [0, 1.1, 0], { color: [0.13, 0.006, 0.005], par: 1 });
    }
  }
  for (const nz of [z0 - 0.3, z1 + 0.3]) {
    const nx0 = flip ? 0.03 : W - 0.48;
    A.box('wood', [nx0, 0, nz - 0.22], [nx0 + 0.45, 0.52, nz + 0.22], rgb(0x4a3020), { par: 0, shadow: true });
    A.add('metal', cyl(0.012, 0.012, 0.03, 6).rotateZ(Math.PI / 2), { m: M(nx0 + (flip ? 0.46 : -0.01), 0.36, nz), color: BRASS });
    B.tag(`motel:stand:${o.id}`, () => B.collide([nx0, 0, nz - 0.22], [nx0 + 0.45, 0.52, nz + 0.22], 'cloth'));
    if (nz > -2) {
      if (st.lamp) { A.add('paint', cylUp(0.07, 0.09, 0.03, 10), { m: M(nx0 + 0.22, 0.52, nz), color: BRASS }); A.add('metal', cylUp(0.012, 0.012, 0.25, 6), { m: M(nx0 + 0.22, 0.55, nz), color: BRASS }); A.add('glow', lathe([[0.09, 0.2], [0.15, 0]], 12), { m: M(nx0 + 0.22, 0.74, nz), color: [0.45, 0.4, 0.3], glow: [5.5, 3.8, 2.0], power: true }); }
      else A.add('paint', lathe([[0.09, 0.2], [0.15, 0]], 12), { m: M(nx0 + 0.3, 0.6, nz + 0.05, 1.4, 0, 0.3), color: rgb(0xa89a80) });
    } else if (st.lantern) {
      A.add('paint', cylUp(0.06, 0.07, 0.05, 10), { m: M(nx0 + 0.22, 0.52, nz), color: rgb(0x2a5a3a), par: 1 });
      A.add('glow', cylUp(0.045, 0.045, 0.12, 10), { m: M(nx0 + 0.22, 0.57, nz), color: [0.5, 0.5, 0.5], glow: [10, 12.5, 11] });
      A.add('paint', cylUp(0.065, 0.05, 0.03, 10), { m: M(nx0 + 0.22, 0.69, nz), color: rgb(0x2a5a3a), par: 1 });
    }
  }

  // television on a stand against the other wall
  {
    const tx0 = flip ? W - 0.5 : 0.03, tz = -2.25, f = flip ? -1 : 1; // f: the way the screen looks
    A.box('wood', [tx0, 0, tz - 0.5], [tx0 + 0.47, 0.55, tz + 0.5], rgb(0x4a3020), { par: 1, shadow: true });
    const sx = flip ? tx0 + 0.02 : tx0 + 0.45; // the screen's face
    A.box('paint', [Math.min(sx, sx - f * 0.42), 0.55, tz - 0.33], [Math.max(sx, sx - f * 0.42), 1.05, tz + 0.33], rgb(0x1c1a18), { par: 1, bevel: 0.03 });
    const scr = [sx + f * 0.003, 0.63, tz + f * 0.21];
    if (st.tv === 'static' || st.tv === 'bars') A.sign(st.tv === 'static' ? 'tvstatic' : 'tvbars', scr, [0, 0, -f * 0.42], [0, 0.34, 0], { glow: st.tv === 'static' ? [3.2, 3.8, 4.6] : [3.5, 3.5, 3.5], power: true, color: [0.04, 0.05, 0.05], par: 1 });
    else A.quad('paint', scr, [0, 0, -f * 0.42], [0, 0.34, 0], rgb(0x060808), { par: 1, cell: 9 });
    if (st.tv === 'smashed') A.sign('splat', [sx + f * 0.005, 0.62, tz + f * 0.18], [0, 0, -f * 0.36], [0, 0.36, 0], { color: [0.5, 0.55, 0.55] });
    for (const k of [-1, 1]) A.add('metal', cyl(0.004, 0.004, 0.45, 4), { m: M(sx - f * 0.2, 1.25, tz + k * 0.1, k * 0.35, 0, 0), color: STEEL });
    B.blob(1.0, 1.5, tx0 + 0.23, tz);
    B.tag(`motel:tv:${o.id}`, () => B.collide([tx0, 0, tz - 0.5], [tx0 + 0.47, 1.05, tz + 0.5], 'cloth'));
  }
  // bathroom door in the back wall, a picture over the bed
  A.box('paint', [0.32, 0, D1 + 0.012], [1.14, 2.05, D1 + 0.05], rgb(0xc4bca4), { par: 1 });
  for (const x of [0.28, 1.14]) A.box('paint', [x, 0, D1 + 0.012], [x + 0.04, 2.09, D1 + 0.065], rgb(0x8a8068), { par: 1 });
  A.box('paint', [0.28, 2.05, D1 + 0.012], [1.18, 2.1, D1 + 0.065], rgb(0x8a8068), { par: 1 });
  A.add('metal', sphere(0.03, 8, 6), { m: M(1.04, 1.0, D1 + 0.08), color: BRASS });
  A.box('glow', [0.34, 0.004, D1 + 0.05], [1.12, 0.02, D1 + 0.055], [0.1, 0.1, 0.1], { glow: st.lamp ? [6, 6.5, 5.6] : [0, 0, 0], power: true });
  if (flip) A.sign(st.art, [0.02, 1.25, -1.8], [0, 0, -0.9], [0, 0.68, 0]); else A.sign(st.art, [W - 0.02, 1.25, -2.7], [0, 0, 0.9], [0, 0.68, 0]);
  // fittings every room has: a cornice, the air conditioner under the front window, a mirror by the
  // television, the telephone and the clock radio, a folded blanket, the switch by the door
  A.detail(() => {
    for (const [x0, x1, z0c, z1c] of [[0, W, D1 + 0.012, D1 + 0.05], [0, W, D0 - 0.05, D0 - 0.012], [0.012, 0.05, D1, D0], [W - 0.05, W - 0.012, D1, D0]]) A.box('paint', [x0, H - 0.07, z0c], [x1, H - 0.004, z1c], rgb(0xb8b29c), { par: 0 });
    if (wx > 0.2 && wx + 1.5 < W - 0.1 && !(wx < door[1] && wx + 1.5 > door[0])) {
      A.box('metal', [wx + 0.3, 0.3, D0 - 0.2], [wx + 1.1, 0.74, D0 - 0.012], rgb(0xa8a494), { par: 0.3, bevel: 0.02 });
      for (let i = 0; i < 6; i++) A.box('paint', [wx + 0.36, 0.36 + i * 0.055, D0 - 0.206], [wx + 0.86, 0.385 + i * 0.055, D0 - 0.2], DARK);
      A.box('paint', [wx + 0.9, 0.5, D0 - 0.206], [wx + 1.05, 0.66, D0 - 0.2], rgb(0x2a2a28));
      A.box('wood', [wx - 0.08, 2.27, D0 - 0.14], [wx + 1.58, 2.4, D0 - 0.012], rgb(0x3a2a1c), { par: 0 }); // the pelmet
    }
    {
      const mx = flip ? W - 0.014 : 0.014, f = flip ? -1 : 1;
      A.box('wood', [Math.min(mx, mx + f * 0.03), 0.95, -4.35], [Math.max(mx, mx + f * 0.03), 1.85, -3.45], rgb(0x3a2a1c), { par: 1 });
      A.box('metal', [Math.min(mx + f * 0.03, mx + f * 0.034), 1.0, -4.3], [Math.max(mx + f * 0.03, mx + f * 0.034), 1.8, -3.5], rgb(0xaab4b8));
      if (st.state === 'blood' || st.tv === 'smashed') A.sign('splat', [mx + f * 0.036, 1.1, flip ? -4.25 : -3.55], [0, 0, flip ? 0.7 : -0.7], [0, 0.7, 0], { color: [0.5, 0.55, 0.55] }); // starred
      A.box('paint', [door[0] - 0.22, 1.2, D0 - 0.02], [door[0] - 0.12, 1.34, D0 - 0.012], rgb(0xd8d4c6), { par: 1 });
    }
    {
      const nx0 = flip ? 0.03 : W - 0.48, nz = -3.3; // the far nightstand: telephone and clock radio
      A.box('paint', [nx0 + 0.06, 0.52, nz - 0.16], [nx0 + 0.26, 0.58, nz - 0.02], rgb(0xb8b29c), { par: 1, bevel: 0.012 });
      A.add('paint', cyl(0.02, 0.02, 0.2, 6).rotateZ(Math.PI / 2), { m: M(nx0 + 0.16, 0.6, nz - 0.09), color: rgb(0xb8b29c), par: 1 });
      if (!st.lantern) {
        A.box('paint', [nx0 + 0.1, 0.52, nz + 0.04], [nx0 + 0.34, 0.6, nz + 0.16], rgb(0x1a1612), { par: 1 });
        A.box('glow', flip ? [nx0 + 0.34, 0.54, nz + 0.06] : [nx0 + 0.094, 0.54, nz + 0.06], flip ? [nx0 + 0.346, 0.585, nz + 0.14] : [nx0 + 0.1, 0.585, nz + 0.14], [0.2, 0.02, 0.01], { glow: [5, 0.5, 0.25], power: true });
      }
    }
  });
  if (st.state === 'made' || st.state === 'messy') A.box('curtain', [bx0 + (flip ? 1.55 : 0.05), 0.56, z0 + 0.1], [bx0 + (flip ? 1.95 : 0.45), 0.64, z1 - 0.1], rgb(st.carpet, 1.6), { bevel: 0.03, par: 1 });
  if (st.state === 'camp') {
    // the mattress is tied up with its own sheet; a radio on batteries, a bat within reach, tins eaten cold
    for (const dx of [-0.5, 0.5]) A.box('curtain', [W / 2 + dx - 0.04, 0.03, D1 + 0.04], [W / 2 + dx + 0.04, 1.5, D1 + 0.32], rgb(0x6a6458), { rx: 0.1 });
    A.box('paint', [W / 2 + 0.75, 0.005, -3.95], [W / 2 + 1.05, 0.17, -3.83], rgb(0x1c1c1a), { par: 1, bevel: 0.015 });
    A.box('glow', [W / 2 + 0.8, 0.1, -3.83], [W / 2 + 0.92, 0.14, -3.826], [0.05, 0.2, 0.08], { glow: [0.6, 3.2, 1.0] });
    A.add('metal', cyl(0.003, 0.003, 0.5, 4), { m: M(W / 2 + 1.02, 0.4, -3.9, 0, 0, -0.3), color: STEEL });
    A.add('wood', cyl(0.03, 0.018, 0.85, 8), { m: M(W / 2 - 1.5, 0.42, -4.45, 0.25, 0, 0.12), color: rgb(0x8a6a40) });
  }
  if (st.state === 'stripped' || st.state === 'blood') {
    A.sign('hand', [0.55, 1.2, D1 + 0.052], [0.19, 0, 0], [0, 0.24, 0], { color: [0.14, 0.007, 0.005], par: 1 });
    A.sign('hand', [0.8, 1.02, D1 + 0.052], [0.19, 0, 0.0], [0.03, 0.24, 0], { color: [0.12, 0.006, 0.005], par: 1 });
    A.sign('smear', [0.5, 1.0, D1 + 0.053], [0.5, 0, 0], [0, -0.85, 0], { color: [0.12, 0.006, 0.005], par: 1 });
  }
  // what was left on the floor
  A.detail(() => {
    A.sign('splat', [W / 2 - 1.2 + (st.wall & 3) * 0.5, H - 0.006, -4.6 + (st.carpet & 3) * 0.6], [1.6, 0, 0], [0, 0, 1.3], { color: [0.3, 0.24, 0.14] }); // a damp ring on the ceiling
    if (st.state === 'messy') { A.box('paint', [W / 2 - 0.2, 0.006, -4.5], [W / 2 + 0.2, 0.05, -4.1], rgb(0xb9a878), { ry: 0.4 }); A.box('paint', [W / 2 - 0.1, 0.05, -4.45], [W / 2 + 0.25, 0.09, -4.08], rgb(0xb09a68), { ry: 0.7 }); }
    if (st.clothes) for (let i = 0; i < 5; i++) { const cx = 1.2 + r.next() * (W - 2.4), cz = -0.8 - r.next() * 1.0; A.box('curtain', [cx, 0.006, cz], [cx + 0.3 + 0.3 * r.next(), 0.03, cz + 0.25], rgb([0x3a4a6a, 0x8a8478, 0x6a2a2a][i % 3]), { ry: r.range(0, 3), bevel: 0.012 }); }
    if (st.bottles) for (let i = 0; i < 7; i++) { const cx = 0.8 + r.next() * (W - 1.6), cz = -3.4 - r.next() * 1.6, lay = r.next() < 0.6; A.add('paint', cylUp(0.033, 0.033, 0.2, 8), { m: M(cx, lay ? 0.037 : 0.005, cz, lay ? Math.PI / 2 : 0, r.range(0, 3), 0), color: rgb(i % 2 ? 0x2a4a2a : 0x4a2a12), par: 1 }); }
    A.sign('guest', [W / 2 + 0.6, 0.008, -0.7], [0.3, 0, 0.1], [-0.07, 0, -0.21]);
  });
}

// drawn curtains on a rail: x0, y0, w, h; z of the wall face; n: -1 inside (faces -z), +1 outside
function curtain(A, x0, y0, w, h, z, n, col, r) {
  const folds = Math.round(w / 0.09);
  for (let i = 0; i < folds; i++) {
    const a = x0 + (w * i) / folds, b = x0 + (w * (i + 1)) / folds, d = (i % 2 ? 0.035 : 0) * n, e = (i % 2 ? 0 : 0.035) * n;
    if (n < 0) A.quad('curtain', [b, y0, z + e], [a - b, 0, d - e], [0, h, 0], col, { cell: 0.5 });
    else A.quad('curtain', [a, y0, z + d], [b - a, 0, e - d], [0, h, 0], col, { cell: 0.5 });
  }
  A.add('metal', cyl(0.012, 0.012, w + 0.2, 6).rotateZ(Math.PI / 2), { m: M(x0 + w / 2, y0 + h + 0.02, z + n * 0.03), color: BRASS });
  void r;
}

// One bay of the motel's front, outside. o: { W, H (height of this storey's wall), door: [x0, x1] | null
// (an open doorway), fake: [x0, x1] | null (a shut door), win: [x0, x1] | null, number: '101', wet,
// lamp: true (a lit lamp by the door), glow: the curtains are lit from inside when there is power,
// doorColor }
export function buildBay(A, o) {
  const { W, H } = o;
  const wall = rgb(o.wall || 0xb9a98a, 0.7);
  const holes = o.door ? [{ a: o.door[0], b: o.door[1], y0: 0, y1: 2.1 }] : [];
  A.wall('stucco', '+z', 0.014, 0, W, 0.3, H, wall, { wet: o.wet ?? 0.1, cell: 0.5, ao: true }, holes);
  A.wall('stucco', '+z', 0.014, 0, W, 0, 0.3, rgb(0x1d4a44, 0.8), { wet: o.wet ?? 0.1, cell: 0.5, ao: true }, holes);
  const d = o.door || o.fake;
  if (d) {
    const teal = rgb(o.doorColor || 0x1f5a52);
    for (const x of d) A.box('paint', [x - 0.05, 0, 0.0], [x + 0.05, 2.12, 0.05], rgb(0xbdb39a), { par: 1 });
    A.box('paint', [d[0] - 0.05, 2.1, 0.0], [d[1] + 0.05, 2.2, 0.05], rgb(0xbdb39a), { par: 1 });
    if (o.fake) {
      A.box('paint', [d[0] + 0.05, 0.01, 0.0], [d[1] - 0.05, 2.1, 0.03], teal, { par: 1 });
      for (const [py0, py1] of [[0.25, 0.95], [1.1, 1.9]]) A.box('paint', [d[0] + 0.2, py0, 0.03], [d[1] - 0.2, py1, 0.038], [teal[0] * 0.8, teal[1] * 0.8, teal[2] * 0.8], { par: 1 });
      A.add('metal', sphere(0.032, 8, 6), { m: M(d[1] - 0.14, 1.0, 0.06), color: BRASS });
      A.box('metal', [d[0] + 0.05, 0.01, 0.03], [d[1] - 0.05, 0.2, 0.036], BRASS);
    }
    // the number, in brass, and the lamp over the door
    if (o.number) {
      const cx = (d[0] + d[1]) / 2, n = o.number.length;
      for (let i = 0; i < n; i++) { const k = +o.number[i]; A.sign('nums', [cx - n * 0.05 + i * 0.1, 2.26, 0.02], [0.095, 0, 0], [0, 0.12, 0], { sub: [k / 10, 0, (k + 1) / 10, 1] }); }
    }
    const lx = d[1] + 0.3;
    A.box('paint', [lx - 0.06, 1.95, 0.014], [lx + 0.06, 2.0, 0.1], DARK);
    if (o.lamp) A.add('glow', cylUp(0.055, 0.045, 0.16, 8), { m: M(lx, 1.78, 0.085), color: [0.4, 0.36, 0.26], glow: [9, 6.2, 3.2], power: true });
    else A.add('paint', cylUp(0.055, 0.045, 0.16, 8), { m: M(lx, 1.78, 0.085), color: rgb(0x55584f), par: 1 });
  }
  if (o.win) {
    const [a, b] = o.win, y0 = 0.9, y1 = 2.05;
    A.quad('paint', [a, y0, 0.02], [b - a, 0, 0], [0, y1 - y0, 0], rgb(0x050607), { par: 1, cell: 9, lit: 0.25 });
    const col = rgb(o.curtain || 0x7a6a50, 0.6);
    const folds = Math.round((b - a) / 0.1);
    for (let i = 0; i < folds; i++) {
      const p = a + ((b - a) * i) / folds, q = a + ((b - a) * (i + 1)) / folds;
      const opt = o.glow ? { glow: [col[0] * 3.2, col[1] * 2.4, col[2] * 1.6].map((v) => v * (i % 2 ? 0.8 : 1.1)), power: true, cell: 9 } : { cell: 9, lit: 0.6 };
      if (o.gap && i > folds * 0.42 && i < folds * 0.58) continue; // the curtains are parted
      A.quad(o.glow ? 'glow' : 'curtain', [p, y0 + 0.03, 0.021], [q - p, 0, 0], [0, y1 - y0 - 0.06, 0], o.glow ? [col[0] * 0.5, col[1] * 0.5, col[2] * 0.5] : [col[0] * (i % 2 ? 0.7 : 1), col[1] * (i % 2 ? 0.7 : 1), col[2] * (i % 2 ? 0.7 : 1)], opt);
    }
    for (const [x0, x1, ya, yb] of [[a - 0.06, b + 0.06, y0 - 0.06, y0], [a - 0.06, b + 0.06, y1, y1 + 0.06], [a - 0.06, a, y0, y1], [b, b + 0.06, y0, y1], [(a + b) / 2 - 0.02, (a + b) / 2 + 0.02, y0, y1]]) A.box('paint', [x0, ya, 0.014], [x1, yb, 0.06], rgb(0xbdb39a), { par: 1 });
    A.glass([a, y0, 0.046], [b - a, 0, 0], [0, y1 - y0, 0]);
    A.box('paint', [a - 0.1, y0 - 0.1, 0.014], [b + 0.1, y0 - 0.06, 0.1], rgb(0xbdb39a), { par: 1 });
    // through-wall air conditioner under it
    A.box('metal', [a + 0.25, 0.32, 0.014], [a + 0.95, 0.72, 0.13], rgb(0x7a7e80), { par: 0.5, bevel: 0.015 });
    for (let i = 0; i < 6; i++) A.box('paint', [a + 0.29, 0.36 + i * 0.055, 0.13], [a + 0.91, 0.385 + i * 0.055, 0.135], DARK);
    A.detail(() => A.sign('splat', [a + 0.3, 0.0, 0.016], [0.6, 0, 0], [0, 0.33, 0], { color: [0.12, 0.09, 0.05] }));
  }
}

export { box };
