// The diner's kitchen fittings and the plain searchable containers. The containers are
// stand-ins until buildContainer replaces them: each is drawn in the area's art mesh inside the
// collider worldLayout.standIns gives it, carries the orange tag that marks a searchable, and has a
// lid, drawer or flap that moves when it has been searched (G.level.props[searchable.prop]).
import { M, box, cyl, cylUp, extrude, lathe, rgb, sphere, torus } from '../build.js';

const STEEL = rgb(0x9a9ea2);
const DARK = rgb(0x121210);
const TAG = rgb(0xd9741a);
const WOODS = [rgb(0x6b5236), rgb(0x7a6040), rgb(0x54412c)];

// s: the searchable; st: [x, z, w, d, h, y0]. Drawn about the stand-in's centre; yaw from the searchable.
export function buildStandIn(A, s, st, o = {}) {
  const B = A.B;
  const [x, z, w, d, h, y0 = 0] = st;
  const tagged = (fn) => B.tag(`search:${s.id}`, fn);
  tagged(() => B.collide([x - w / 2, y0, z - d / 2], [x + w / 2, y0 + h, z + d / 2], s.kind === 'barrel' || s.kind === 'bin' ? 'metal' : 'cloth'));
  B.at(M(x, y0, z), () => {
    if (!o.noBlob) B.blob(w + 0.5, d + 0.5);
    if (s.kind === 'barrel') {
      const col = o.color || rgb(0x1c4384);
      A.add('paint', lathe([[0, 0], [0.285, 0], [0.285, 0.28], [0.298, 0.3], [0.285, 0.32], [0.285, 0.58], [0.298, 0.6], [0.285, 0.62], [0.285, 0.85], [0.29, 0.87]], 16), { color: col, par: 1, shadow: true });
      A.add('paint', cylUp(0.27, 0.27, 0.01, 16), { m: M(0, 0.845, 0), color: rgb(0x0a0a0a) });
      A.box('paint', [-0.03, 0.5, 0.288], [0.03, 0.58, 0.3], TAG, { ry: 0 });
      A.movable(s.prop, M(0.36, -0.6, 0.1, 0, 0.4, 1.3), () => {
        A.add('paint', cylUp(0.288, 0.288, 0.025, 16), { m: M(0, 0.865, 0), color: col, par: 1 });
        A.add('metal', torus(0.29, 0.012, 5, 16).rotateX(Math.PI / 2), { m: M(0, 0.875, 0), color: STEEL });
      });
    } else if (s.kind === 'bin') {
      const col = o.color || rgb(0x1f3a2a);
      A.add('paint', cylUp(0.25, 0.21, h - 0.1, 14), { color: col, par: 1, shadow: true });
      A.add('paint', cylUp(0.262, 0.262, 0.03, 14), { m: M(0, h - 0.13, 0), color: DARK });
      A.box('paint', [-0.03, h - 0.4, 0.238], [0.03, h - 0.32, 0.25], TAG);
      A.movable(s.prop, M(0.1, 0.02, -0.28, -1.0, 0, 0), () => {
        A.add('paint', lathe([[0.265, 0], [0.265, 0.03], [0.2, 0.075], [0.04, 0.09], [0, 0.09]], 14), { m: M(0, h - 0.1, 0), color: col, par: 1 });
        A.add('metal', torus(0.035, 0.008, 5, 10), { m: M(0, h, 0), color: STEEL });
      });
    } else if (s.kind === 'suitcase') {
      // lies flat across the stand-in's long side; the lid lifts
      const lx = Math.max(w, d), lz = Math.min(w, d), ry = w >= d ? 0 : Math.PI / 2;
      const col = o.color || rgb(0x5a3a22);
      B.at(M(0, 0, 0, 0, ry, 0), () => {
        A.box('vinyl', [-lx / 2, 0, -lz / 2], [lx / 2, h * 0.55, lz / 2], col, { bevel: 0.03, shadow: true });
        A.box('paint', [-0.03, 0.05, lz / 2], [0.03, 0.13, lz / 2 + 0.012], TAG);
        A.movable(s.prop, M(0, h * 0.55, -lz / 2, -1.9, 0, 0).multiply(M(0, -h * 0.55, lz / 2)), () => {
          A.box('vinyl', [-lx / 2, h * 0.55, -lz / 2], [lx / 2, h, lz / 2], col, { bevel: 0.03 });
          A.add('metal', torus(0.05, 0.008, 5, 10, Math.PI), { m: M(0, h * 0.8, lz / 2 + 0.005), color: STEEL });
          for (const sx of [-0.22, 0.22]) A.box('metal', [sx - 0.02, h * 0.5, lz / 2], [sx + 0.02, h * 0.62, lz / 2 + 0.01], STEEL);
        });
        A.box('curtain', [-lx / 2 + 0.04, h * 0.5, -lz / 2 + 0.03], [lx / 2 - 0.04, h * 0.56, lz / 2 - 0.03], o.cloth || rgb(0x6a7a8a), { par: 1 });
      });
    } else if (s.kind === 'dresser') {
      // long side against the wall; the drawers face the room (o.face: unit [x, z] toward the room)
      const f = o.face || [0, 1];
      const ry = Math.atan2(f[0], f[1]);
      const L = Math.max(w, d), D = Math.min(w, d);
      B.at(M(0, 0, 0, 0, ry, 0), () => {
        A.box('wood', [-L / 2, 0.06, -D / 2], [L / 2, h, D / 2], o.color || rgb(0x4a3020), { par: 0, shadow: true });
        A.box('paint', [-L / 2 + 0.03, 0, -D / 2 + 0.03], [L / 2 - 0.03, 0.06, D / 2 - 0.04], DARK);
        A.box('laminate', [-L / 2 - 0.015, h, -D / 2], [L / 2 + 0.015, h + 0.025, D / 2 + 0.015], o.top || rgb(0x3a2618));
        for (let r = 0; r < 3; r++) for (const sx of [-1, 1]) {
          const x0 = sx < 0 ? -L / 2 + 0.03 : 0.015, x1 = sx < 0 ? -0.015 : L / 2 - 0.03, ya = 0.1 + r * 0.245, yb = ya + 0.225;
          const draw = () => {
            A.box('wood', [x0, ya, D / 2 - 0.3], [x1, yb, D / 2 + 0.018], o.color2 || rgb(0x5a3b26), { par: 0 });
            A.add('metal', cyl(0.012, 0.012, 0.03, 6).rotateX(Math.PI / 2), { m: M((x0 + x1) / 2, (ya + yb) / 2, D / 2 + 0.03), color: rgb(0xb89a48) });
          };
          if (r === 2 && sx > 0) { A.movable(s.prop, M(0, 0, 0.22), draw); A.box('paint', [x1 - 0.1, ya + 0.06, D / 2 + 0.018], [x1 - 0.04, ya + 0.14, D / 2 + 0.03], TAG); } else draw();
        }
      });
    } else if (s.kind === 'crate' && o.desk) {
      // the motel office's desk: the drawer on the hand's side
      const f = o.face || [0, 1];
      B.at(M(0, 0, 0, 0, Math.atan2(f[0], f[1]), 0), () => {
        A.box('wood', [-w / 2, h - 0.05, -d / 2], [w / 2, h, d / 2], rgb(0x5a3b26), { par: 0, shadow: true });
        for (const sx of [-1, 1]) A.box('wood', [sx * w / 2 - (sx > 0 ? 0.42 : 0), 0, -d / 2 + 0.03], [sx * w / 2 + (sx > 0 ? 0 : 0.42), h - 0.05, d / 2 - 0.03], rgb(0x4a3020), { par: 2 });
        A.box('wood', [-w / 2 + 0.42, 0.25, -d / 2 + 0.03], [w / 2 - 0.42, h - 0.05, -d / 2 + 0.05], rgb(0x4a3020), { par: 0 });
        A.box('paint', [w / 2 - 0.12, h - 0.2, d / 2 - 0.03], [w / 2 - 0.06, h - 0.12, d / 2 - 0.015], TAG);
        A.movable(s.prop, M(0, 0, 0.2), () => {
          A.box('wood', [w / 2 - 0.4, h - 0.24, d / 2 - 0.35], [w / 2 - 0.02, h - 0.07, d / 2 - 0.01], rgb(0x6a4a30), { par: 0 });
          A.add('metal', cyl(0.012, 0.012, 0.03, 6).rotateX(Math.PI / 2), { m: M(w / 2 - 0.21, h - 0.155, d / 2), color: rgb(0xb89a48) });
        });
      });
    } else {
      // crate: slatted box, the lid prised off
      const c = (i) => WOODS[i % 3];
      A.box('wood', [-w / 2 + 0.02, 0.02, -d / 2 + 0.02], [w / 2 - 0.02, h - 0.03, d / 2 - 0.02], c(1), { par: 0, shadow: true });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) A.box('wood', [sx * (w / 2 - 0.03) - 0.03, 0, sz * (d / 2 - 0.03) - 0.03], [sx * (w / 2 - 0.03) + 0.03, h - 0.02, sz * (d / 2 - 0.03) + 0.03], c(2), { par: 2 });
      for (const y of [0.1, h - 0.14]) for (const sz of [-1, 1]) A.box('wood', [-w / 2, y, sz * d / 2 - 0.012], [w / 2, y + 0.07, sz * d / 2 + 0.012], c(0), { par: 0 });
      A.box('paint', [-0.03, h * 0.45, d / 2 + 0.012], [0.03, h * 0.45 + 0.08, d / 2 + 0.024], TAG);
      A.movable(s.prop, M(w * 0.45, -h * 0.35, d * 0.5, 0.9, 0.5, 0.2), () => {
        for (let i = 0; i < 4; i++) A.box('wood', [-w / 2 + (i * w) / 4 + 0.005, h - 0.03, -d / 2], [-w / 2 + ((i + 1) * w) / 4 - 0.005, h, d / 2], c(i), { par: 1 });
      });
    }
  });
}

// ---- the kitchen ------------------------------------------------------------------------------------
// table: the prep table's structure box. Everything else is placed against the kitchen's walls
// (x 20.3..26.3, z -31.7..-20.3) clear of the window at x 23.3, the doors and the fixed positions.
export function buildKitchen(A, table) {
  const B = A.B;
  // prep table: steel top, legs, an undershelf
  {
    const [x0, , z0] = table.min, [x1, h, z1] = table.max;
    A.box('metal', [x0, h - 0.045, z0], [x1, h, z1], STEEL, { bevel: 0.01, shadow: true });
    A.box('metal', [x0 + 0.05, 0.22, z0 + 0.05], [x1 - 0.05, 0.245, z1 - 0.05], STEEL);
    for (const x of [x0 + 0.05, x1 - 0.05]) for (const z of [z0 + 0.05, z1 - 0.05]) A.box('metal', [x - 0.025, 0, z - 0.025], [x + 0.025, h - 0.04, z + 0.025], STEEL);
    B.tag('diner:prep', () => B.collide(table.min, table.max, 'metal'));
    A.detail(() => {
      A.box('wood', [x0 + 0.3, h, z0 + 0.2], [x0 + 0.9, h + 0.03, z1 - 0.25], rgb(0x8a6a40), { par: 0 });
      A.box('metal', [x0 + 0.95, h + 0.002, z0 + 0.45], [x0 + 1.25, h + 0.006, z0 + 0.49], rgb(0xc8ccd0), { ry: 0.5 }); // the knife
      A.sign('splat', [x0 + 0.25, h + 0.033, z1 - 0.2], [0.7, 0, 0], [0, 0, -0.55], { color: [0.15, 0.008, 0.006], par: 1 });
      for (const [px, r, hh] of [[x1 - 0.5, 0.17, 0.2], [x1 - 0.95, 0.12, 0.13]]) { A.add('metal', cylUp(r, r, hh, 14, true), { m: M(px, h, (z0 + z1) / 2), color: STEEL }); A.add('metal', cylUp(r, r, 0.004, 14), { m: M(px, h + 0.002, (z0 + z1) / 2), color: rgb(0x55585a) }); }
      for (let i = 0; i < 3; i++) A.add('metal', cylUp(0.16 - i * 0.02, 0.16 - i * 0.02, 0.14, 12), { m: M(x0 + 0.5 + i * 0.6, 0.245, (z0 + z1) / 2), color: rgb(0x7a7e82), par: 0.4 });
    });
  }
  // the line along the front wall: griddle, burners, fryer, ovens below, the hood above
  {
    const x0 = 21.5, x1 = 24.9, z0 = -21.1, z1 = -20.3, h = 0.92;
    A.box('metal', [x0, 0.1, z0], [x1, h, z1], STEEL, { shadow: true });
    A.box('paint', [x0 + 0.03, 0, z0 + 0.05], [x1 - 0.03, 0.1, z1], DARK);
    A.box('metal', [x0, h, z1 - 0.06], [x1, h + 0.5, z1 - 0.015], STEEL, { par: 0.5 }); // splashback
    A.box('paint', [x0 + 0.05, h, z0 + 0.08], [x0 + 1.3, h + 0.02, z1 - 0.1], rgb(0x161412), { par: 1 }); // griddle
    for (let i = 0; i < 4; i++) {
      const bx = x0 + 1.65 + (i % 2) * 0.42, bz = z0 + 0.22 + Math.floor(i / 2) * 0.36;
      A.add('paint', torus(0.11, 0.022, 5, 12).rotateX(Math.PI / 2), { m: M(bx, h + 0.02, bz), color: rgb(0x0c0c0c) });
      A.add('paint', cylUp(0.05, 0.05, 0.012, 8), { m: M(bx, h + 0.005, bz), color: rgb(0x1a1a1a) });
    }
    A.add('metal', cylUp(0.18, 0.16, 0.22, 14, true), { m: M(x0 + 1.86, h + 0.04, z0 + 0.58), color: rgb(0x8a8e92), par: 0.6 }); // a stock pot left on
    A.box('paint', [x0 + 2.6, h - 0.02, z0 + 0.1], [x1 - 0.06, h + 0.01, z1 - 0.12], rgb(0x1a1408), { par: 1 }); // fryer oil
    for (const fx of [x0 + 2.8, x0 + 3.15]) A.box('metal', [fx - 0.13, h - 0.01, z0 + 0.16], [fx + 0.13, h + 0.1, z0 + 0.5], rgb(0x6a6e72), { par: 0.6 });
    for (let i = 0; i < 3; i++) {
      const ox = x0 + 0.1 + i * 1.1;
      A.box('metal', [ox, 0.16, z0 - 0.012], [ox + 1.0, h - 0.14, z0], rgb(0x7f8387), { par: 0.3 });
      A.add('metal', cyl(0.014, 0.014, 0.8, 6).rotateZ(Math.PI / 2), { m: M(ox + 0.5, h - 0.2, z0 - 0.05), color: rgb(0xc8ccd0) });
      A.box('paint', [ox + 0.2, 0.3, z0 - 0.016], [ox + 0.8, 0.55, z0 - 0.011], rgb(0x08080a), { par: 1 });
    }
    for (let i = 0; i < 8; i++) A.add('paint', cylUp(0.02, 0.024, 0.03, 8), { m: M(x0 + 0.25 + i * 0.4, h - 0.09, z0 - 0.02, Math.PI / 2, 0, 0), color: i % 3 ? DARK : rgb(0x8f1c16) });
    B.tag('diner:range', () => B.collide([x0, 0, z0], [x1, h, z1], 'metal'));
    // hood: a canopy with a raked front, baffle filters inside its lip, a grease trough, two lamps,
    // and the duct up through the ceiling
    {
      const hx0 = x0 - 0.15, hx1 = x1 + 0.15, zl = z0 - 0.32; // zl: its lip, out over the cook
      const prof = [[-z1, 2.02], [-zl, 2.02], [-zl, 2.2], [-(z0 + 0.22), 2.78], [-z1, 2.78]].reverse();
      A.add('metal', extrude(prof, hx1 - hx0, { smooth: false }).rotateY(Math.PI / 2), { m: M((hx0 + hx1) / 2, 0, 0), color: STEEL, par: 0.25, shadow: true });
      A.box('metal', [hx0 - 0.012, 2.0, zl - 0.012], [hx1 + 0.012, 2.045, zl + 0.02], rgb(0xc8ccd0)); // the lip's rolled edge
      A.box('metal', [x0 + 0.9, 2.78, z0 + 0.2], [x1 - 0.9, 3.5, z1 - 0.06], rgb(0x80848a), { par: 0.4 });
      A.box('metal', [x0 + 0.86, 2.78, z0 + 0.16], [x1 - 0.86, 2.83, z1 - 0.02], rgb(0x9a9ea2));
      for (const y of [3.05, 3.3]) A.box('metal', [x0 + 0.89, y, z0 + 0.19], [x1 - 0.89, y + 0.02, z1 - 0.05], rgb(0x6a6e72));
      // filters: a dark slot along the underside with slanted steel baffles in it
      A.quad('paint', [hx0 + 0.06, 2.018, z1 - 0.05], [hx1 - hx0 - 0.12, 0, 0], [0, 0, zl + 0.1 - z1], rgb(0x0a0b0c), { cell: 9, lit: 0.3 });
      for (let x = hx0 + 0.12; x < hx1 - 0.3; x += 0.47) for (let k = 0; k < 6; k++) A.box('metal', [x + k * 0.07, 2.0, z0 + 0.02], [x + k * 0.07 + 0.012, 2.02, z1 - 0.2], rgb(0x7a7e82), { rz: 0.5, par: 0.5 });
      A.box('metal', [hx0 + 0.05, 1.985, zl + 0.03], [hx1 - 0.05, 2.02, zl + 0.09], rgb(0x6a6e72), { par: 0.6 });
      for (const lx of [x0 + 0.9, x1 - 0.9]) { A.box('paint', [lx - 0.16, 1.985, z0 + 0.22], [lx + 0.16, 2.02, z0 + 0.5], rgb(0x2a2c2e), { par: 1 }); A.box('glow', [lx - 0.13, 1.978, z0 + 0.25], [lx + 0.13, 1.986, z0 + 0.47], [0.3, 0.28, 0.22], { glow: [18, 12.5, 6.5], power: true }); }
      A.detail(() => {
        for (const x of [x0 + 0.4, x0 + 1.9, x1 - 0.7]) A.sign('smear', [x, 2.19, zl - 0.004], [0.5, 0, 0], [0, -0.16, 0], { color: [0.05, 0.035, 0.015], par: 1 });
        // the ticket rail on the lip, three orders still clipped to it
        for (let i = 0; i < 3; i++) A.sign('ticket', [x0 + 1.1 + i * 0.3, 1.86 + (i % 2) * 0.015, zl - 0.006], [0.11, 0, 0], [0, 0.17, 0]);
      });
    }
    // the burner under the stock pot is still alight
    A.add('glow', torus(0.085, 0.012, 4, 14).rotateX(Math.PI / 2), { m: M(x0 + 1.86, h + 0.03, z0 + 0.58), color: [0.1, 0.2, 0.6], glow: [1.2, 2.6, 12] });
  }
  // dish sink on the divider, south of the door
  {
    const x0 = 20.3, x1 = 20.92, z0 = -23.2, z1 = -21.5, h = 0.9;
    A.box('metal', [x0, h - 0.3, z0], [x1, h, z1], STEEL, { shadow: true });
    A.box('paint', [x0 + 0.07, h - 0.005, z0 + 0.1], [x1 - 0.07, h + 0.003, z1 - 0.1], rgb(0x1c2220), { par: 1 });
    for (const z of [z0 + 0.04, z1 - 0.04]) A.box('metal', [x1 - 0.06, 0, z - 0.02], [x1 - 0.02, h - 0.3, z + 0.02], STEEL);
    A.add('metal', lathe([[0.012, 0], [0.012, 0.3], [0.02, 0.32]], 6), { m: M(x0 + 0.1, h, (z0 + z1) / 2), color: rgb(0xc8ccd0) });
    A.detail(() => { for (let i = 0; i < 5; i++) A.add('paint', lathe([[0, 0], [0.07, 0], [0.125, 0.018], [0.13, 0.022], [0, 0.012]], 12), { m: M(x0 + 0.33, h + 0.01 + i * 0.016, z0 + 0.45, 0.05 * i, 0, 0), color: rgb(0xd8d4c6), par: 1 }); });
    B.tag('diner:sink', () => B.collide([x0, 0, z0], [x1, h, z1], 'metal'));
  }
  // dry-goods rack on the east wall, south of the back door
  {
    const x0 = 25.84, x1 = 26.3, z0 = -26.3, z1 = -22.6, h = 1.9;
    for (const z of [z0 + 0.02, (z0 + z1) / 2, z1 - 0.02]) for (const x of [x0 + 0.02, x1 - 0.02]) A.box('metal', [x - 0.015, 0, z - 0.015], [x + 0.015, h, z + 0.015], STEEL);
    for (const y of [0.15, 0.62, 1.1, 1.58]) A.box('metal', [x0, y, z0], [x1, y + 0.02, z1], rgb(0x8a8e92), { shadow: y > 1.5 });
    const r = A.rng;
    A.detail(() => {
      const cols = [0xc8281c, 0xe8b023, 0x1f4fa6, 0x2c8a43, 0xf0ece0, 0x8a7550];
      for (const y of [0.17, 0.64, 1.12, 1.6]) for (let z = z0 + 0.15; z < z1 - 0.1; z += 0.26) {
        const k = r.next();
        if (k < 0.3) continue; // looted
        if (k < 0.65) A.add('paint', cylUp(0.08, 0.08, 0.2 + 0.08 * r.next(), 10), { m: M(x0 + 0.2 + 0.08 * r.next(), y, z), color: rgb(cols[r.int(0, 5)]), par: 1 });
        else A.box('paint', [x0 + 0.06, y, z - 0.1], [x1 - 0.08, y + 0.18 + 0.1 * r.next(), z + 0.1], rgb(cols[r.int(3, 5)], 0.8));
      }
      for (let i = 0; i < 5; i++) A.add('paint', cylUp(0.08, 0.08, 0.2, 10), { m: M(x0 - 0.3 - 0.5 * r.next(), 0.08, z0 + 0.4 + i * 0.6 + 0.2 * r.next(), Math.PI / 2, r.range(0, 3), 0), color: rgb(cols[r.int(0, 3)]), par: 1 });
    });
    B.tag('diner:rack', () => B.collide([x0, 0, z0], [x1, h, z1], 'metal'));
  }
  // walk-in cooler door on the divider's north end, the pass hatch (shut) between it and the door
  A.box('metal', [20.3, 0.05, -31.45], [20.36, 2.05, -30.25], STEEL, { par: 0.3 });
  A.box('metal', [20.36, 1.0, -30.45], [20.42, 1.08, -30.3], rgb(0xc8ccd0));
  for (const y of [0.4, 1.7]) A.box('metal', [20.36, y, -31.42], [20.4, y + 0.12, -31.34], rgb(0xc8ccd0));
  A.sign('ticket', [20.365, 1.35, -30.7], [0, 0, -0.16], [0, 0.26, 0]);
  passHatch(A, 20.3, 1, -29.0, -26.2);
  // wall shelf over the crates, pans hanging
  A.box('metal', [20.5, 1.55, -31.7], [22.3, 1.575, -31.4], STEEL);
  A.detail(() => {
    for (let i = 0; i < 4; i++) A.add('metal', cylUp(0.13 - i * 0.012, 0.11 - i * 0.01, 0.16, 12), { m: M(20.75 + i * 0.42, 1.575, -31.55), color: rgb(0x7a7e82), par: 0.5 });
    for (let i = 0; i < 3; i++) { A.add('paint', cyl(0.15 - i * 0.02, 0.15 - i * 0.02, 0.03, 12).rotateX(Math.PI / 2), { m: M(24.55 + i * 0.4, 1.75 - i * 0.03, -31.66), color: rgb(0x121212), par: 1 }); A.box('paint', [24.54 + i * 0.4, 1.9 - i * 0.03, -31.68], [24.56 + i * 0.4, 2.1, -31.66], rgb(0x121212)); }
    A.box('metal', [24.3, 2.1, -31.7], [25.6, 2.13, -31.64], STEEL);
  });
  // rubber mats where the cook and the dishwasher stood
  A.box('vinyl', [21.6, 0.004, -22.05], [24.8, 0.022, -21.2], rgb(0x101112), { ao: true });
  A.box('vinyl', [20.95, 0.004, -23.1], [21.6, 0.022, -21.6], rgb(0x101112));
  // a rack of pans hung over the prep table from the ceiling (everything above head height)
  A.detail(() => {
    const cx = 23.0, cz = -25.1, y = 2.42;
    for (const z of [cz - 0.3, cz + 0.3]) A.box('metal', [cx - 1.15, y, z - 0.012], [cx + 1.15, y + 0.024, z + 0.012], STEEL);
    for (const x of [cx - 1.15, cx + 1.15]) A.box('metal', [x - 0.012, y, cz - 0.3], [x + 0.012, y + 0.024, cz + 0.3], STEEL);
    for (const x of [cx - 1.1, cx + 1.1]) for (const z of [cz - 0.3, cz + 0.3]) A.add('metal', cyl(0.006, 0.006, 3.5 - y, 4), { m: M(x, (3.5 + y) / 2, z), color: rgb(0x5a5e60) });
    const r = A.rng;
    for (let i = 0; i < 9; i++) {
      const x = cx - 1.0 + i * 0.25, z = i % 2 ? cz - 0.3 : cz + 0.3, rad = 0.09 + 0.05 * r.next(), drop = 0.12 + 0.06 * r.next();
      A.add('metal', cyl(0.004, 0.004, drop, 4), { m: M(x, y - drop / 2, z), color: rgb(0x5a5e60) });
      if (i % 3 === 2) A.add('metal', cyl(0.01, 0.014, 0.3, 6), { m: M(x, y - drop - 0.15, z, 0, 0, 0.05), color: rgb(0xc8ccd0) }); // a ladle
      else { A.add(i % 2 ? 'paint' : 'metal', cyl(rad, rad * 0.9, 0.05, 12).rotateX(Math.PI / 2), { m: M(x, y - drop - rad, z, 0, r.range(-0.3, 0.3), 0), color: i % 2 ? rgb(0x121212) : rgb(0x8a6a3a), par: 1 }); A.box(i % 2 ? 'paint' : 'metal', [x - 0.012, y - drop - 0.02, z - 0.006], [x + 0.012, y - drop + 0.02, z + 0.006], rgb(0x121212)); }
    }
  });
  // a speed rack went over in the rush: on its side across the floor, trays thrown out of it
  B.at(M(22.1, 0, -28.4, 0, 0.32, 0), () => {
    for (const z of [-0.3, 0.3]) for (const y of [0.02, 0.58]) A.box('metal', [-0.85, y, z - 0.015], [0.85, y + 0.03, z + 0.015], STEEL);
    for (const x of [-0.85, 0.85]) for (const z of [-0.3, 0.3]) A.box('metal', [x - 0.015, 0.02, z - 0.015], [x + 0.015, 0.61, z + 0.015], STEEL);
    for (const x of [-0.85, 0.85]) for (const y of [0.02, 0.58]) A.box('metal', [x - 0.015, y, -0.3], [x + 0.015, y + 0.03, 0.3], STEEL);
    for (let i = 0; i < 6; i++) { A.box('metal', [-0.7 + i * 0.27, 0.03, -0.3], [-0.69 + i * 0.27, 0.6, -0.28], rgb(0x8a8e92)); A.box('metal', [-0.7 + i * 0.27, 0.03, 0.28], [-0.69 + i * 0.27, 0.6, 0.3], rgb(0x8a8e92)); }
    for (const [x, rz] of [[-0.45, 0.0], [0.1, 0.0], [0.5, 0.0]]) A.box('metal', [x, 0.05, -0.28], [x + 0.012, 0.57, 0.28], rgb(0x9a9ea2), { rz, par: 0.3 });
    for (const x of [-0.85, 0.85]) for (const z of [-0.3, 0.3]) A.add('paint', cyl(0.04, 0.04, 0.03, 8).rotateZ(Math.PI / 2), { m: M(x + Math.sign(x) * 0.03, z < 0 ? 0.05 : 0.56, z), color: rgb(0x0c0c0c) });
    B.tag('diner:speedrack', () => B.collide([-0.87, 0, -0.32], [0.87, 0.62, 0.32], 'metal'));
  });
  A.detail(() => {
    const r = A.rng;
    // trays and bread rolls thrown from it, a stock pot on its side in what it held
    for (const [x, z, ry] of [[23.3, -27.6, 0.4], [23.9, -28.5, -0.7], [22.9, -29.3, 1.2]]) A.box('metal', [x - 0.23, 0.006, z - 0.33], [x + 0.23, 0.022, z + 0.33], rgb(0x9a9ea2), { ry, par: 0.3 });
    for (let i = 0; i < 14; i++) A.add('paint', sphere(0.045, 6, 4), { m: M(22.7 + r.range(0, 2.2), 0.03, -29.5 + r.range(0, 2.6), 0, r.range(0, 3), 0, 1.3, 0.75, 1), color: rgb(i % 3 ? 0x9a6a2a : 0x7a4a1a) });
    A.add('metal', cylUp(0.2, 0.18, 0.3, 14, true), { m: M(24.9, 0.2, -23.6, Math.PI / 2, 0.5, 0), color: rgb(0x8a8e92), par: 0.6 });
    A.sign('splat', [24.3, 0.008, -23.1], [1.5, 0, 0.2], [0.2, 0, -1.4], { color: [0.09, 0.05, 0.015], par: 1 });
    // a sack of flour split against the back wall, hand prints out of it
    A.box('curtain', [24.25, 0, -31.62], [24.85, 0.36, -31.25], rgb(0xb9b09a), { bevel: 0.09, rz: 0.1 });
    A.sign('splat', [23.95, 0.008, -30.6], [1.2, 0, 0], [0, 0, -1.0], { color: [0.62, 0.6, 0.55] });
    for (const [x, y] of [[20.34, 1.25], [20.34, 1.05]]) A.sign('hand', [x + 0.025, y, -30.55 - (y - 1.05) * 0.6], [0, 0, -0.17], [0, 0.21, 0], { color: [0.14, 0.007, 0.005], par: 1 });
    // on the walls: the hand-wash notice, the knife strip over the sink, an extinguisher by the back door, a clock stopped
    A.sign('wash', [20.315, 1.5, -21.75], [0, 0, -0.42], [0, 0.3, 0]);
    A.box('paint', [20.312, 1.32, -23.1], [20.33, 1.36, -22.3], rgb(0x101010));
    for (let i = 0; i < 4; i++) A.box('metal', [20.33, 1.12 + (i % 2) * 0.04, -23.0 + i * 0.18], [20.336, 1.36, -22.96 + i * 0.18], rgb(0xc8ccd0));
    A.add('paint', cylUp(0.065, 0.065, 0.42, 10), { m: M(26.2, 0.75, -26.3), color: rgb(0xb0180f), par: 1 });
    A.add('paint', cylUp(0.02, 0.03, 0.08, 6), { m: M(26.2, 1.17, -26.3), color: rgb(0x101010) });
    A.sign('clock', [26.285, 2.35, -24.0], [0, 0, 0.44], [0, 0.44, 0]);
    A.sign('calendar', [26.285, 1.4, -21.9], [0, 0, 0.36], [0, 0.5, 0]);
    // mop and bucket by the pass
    A.add('paint', cylUp(0.17, 0.14, 0.3, 10, true), { m: M(20.62, 0.004, -25.55), color: rgb(0xc9a416), par: 1 });
    A.add('paint', cylUp(0.14, 0.14, 0.01, 10), { m: M(20.62, 0.2, -25.55), color: rgb(0x1a1c1a), par: 1 });
    A.add('wood', cyl(0.014, 0.014, 1.35, 5), { m: M(20.48, 0.7, -25.5, 0.1, 0, 0.2), color: rgb(0x7a6040) });
  });
  // floor drain
  A.box('metal', [23.0, 0.004, -23.4], [23.4, 0.012, -23.0], rgb(0x4a4d50), { par: 0.6 });
}

// The order pass between dining room and kitchen, shuttered: a steel roller in a frame with a
// shelf. side: +1 on a wall face looking +x, -1 looking -x; c: the face's x.
export function passHatch(A, c, side, z0, z1) {
  const y0 = 1.05, y1 = 1.95, t = side * 0.012;
  const lo = Math.min(c, c + t * 3), hi = Math.max(c, c + t * 3);
  A.box('metal', [lo, y0 - 0.06, z0 - 0.06], [hi, y1 + 0.06, z1 + 0.06], STEEL);
  for (let y = y0; y < y1 - 0.01; y += 0.075) A.box('metal', [Math.min(c + t * 3, c + t * 4.5), y + 0.006, z0], [Math.max(c + t * 3, c + t * 4.5), y + 0.069, z1], rgb(0x8a8e92), { par: 0.35 });
  A.box('metal', [Math.min(c, c + side * 0.28), y0 - 0.09, z0 - 0.1], [Math.max(c, c + side * 0.28), y0 - 0.06, z1 + 0.1], STEEL, { shadow: true });
  if (side < 0) {
    // dining side: the ticket rail and what never went out
    A.box('metal', [c - 0.05, y1 + 0.1, z0], [c - 0.02, y1 + 0.13, z1], rgb(0xc8ccd0));
    for (let i = 0; i < 5; i++) A.sign('ticket', [c - 0.052, y1 - 0.1 + (i % 2) * 0.02, z0 + 0.3 + i * 0.45], [0, 0, 0.13], [0, 0.21, 0]);
    A.add('metal', sphere(0.04, 10, 6), { m: M(c - 0.14, y0 - 0.05, z1 - 0.3, 0, 0, 0, 1, 0.6, 1), color: rgb(0xc8ccd0) });
  }
}

export { box };
