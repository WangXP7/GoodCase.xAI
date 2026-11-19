// The diner's counter: an island the player can circle. Drawn in world space inside the
// structure box worldLayout gives it; the till on it is the searchable 'diner:till'.
import { M, box, cyl, cylUp, lathe, rgb, sphere, tube } from '../build.js';

const CHROME = rgb(0xb9bec2);
const CREAM = rgb(0xcfc6a8);
const RED = rgb(0x8f1c16);
const DARK = rgb(0x14140f);

// c: the structure box { min, max }; o: { till: searchable record, menu: bool }
export function buildCounter(A, c, o = {}) {
  const B = A.B;
  const [x0, , z0] = c.min, [x1, h, z1] = c.max; // z1 is the customers' side (south)
  const cx = (x0 + x1) / 2;
  // body: cream panels between chrome ribs, a red band, a dark kick, the foot rail
  A.box('paint', [x0 + 0.04, 0.12, z0 + 0.04], [x1 - 0.04, h - 0.05, z1 - 0.04], CREAM, { par: 1, shadow: true });
  A.box('paint', [x0 + 0.08, 0, z0 + 0.08], [x1 - 0.08, 0.12, z1 - 0.1], DARK);
  A.box('paint', [x0 + 0.03, 0.62, z1 - 0.045], [x1 - 0.03, 0.8, z1 - 0.025], RED, { par: 1 });
  for (let i = 0; i < 6; i++) A.box('metal', [x0 + 0.03, 0.2 + i * 0.06, z1 - 0.045], [x1 - 0.03, 0.225 + i * 0.06, z1 - 0.02], CHROME);
  for (const x of [x0, x1]) A.box('metal', [x - 0.03, 0.12, z0], [x + 0.03, h - 0.05, z1], CHROME, { bevel: 0.02 });
  A.add('metal', cyl(0.022, 0.022, x1 - x0 - 0.2, 8).rotateZ(Math.PI / 2), { m: M(cx, 0.2, z1 + 0.1), color: CHROME });
  for (let x = x0 + 0.3; x < x1; x += 1.1) A.add('metal', cyl(0.014, 0.014, 0.14, 6).rotateX(Math.PI / 2), { m: M(x, 0.2, z1 + 0.04), color: CHROME });
  // top: laminate with a ribbed chrome edge
  A.box('laminate', [x0 - 0.04, h - 0.05, z0 - 0.02], [x1 + 0.04, h, z1 + 0.06], rgb(0x9db3a2), { bevel: 0.012 });
  A.box('metal', [x0 - 0.05, h - 0.045, z0 - 0.03], [x1 + 0.05, h - 0.012, z1 + 0.07], CHROME);
  // the service side: open shelving under the top
  A.wall('paint', '-z', z0 + 0.035, x0 + 0.1, x1 - 0.1, 0.14, h - 0.08, rgb(0x0c0c0a), { lit: 0.4 });
  for (const y of [0.42, 0.7]) A.box('metal', [x0 + 0.1, y, z0 + 0.0], [x1 - 0.1, y + 0.02, z0 + 0.3], rgb(0x8a8f92));
  for (let x = x0 + 0.1; x <= x1 - 0.05; x += (x1 - x0 - 0.2) / 4) A.box('metal', [x - 0.015, 0.12, z0], [x + 0.015, h - 0.06, z0 + 0.3], rgb(0x8a8f92));
  B.tag('diner:counter', () => B.collide(c.min, c.max, 'metal'));

  // the till: a heavy mechanical register, its drawer the thing to search
  const tx = o.till ? o.till.pos[0] : cx, tz = z1 - 0.45;
  B.at(M(tx, h, tz), () => {
    A.box('paint', [-0.23, 0, -0.22], [0.23, 0.11, 0.2], rgb(0x2b3a34), { par: 1, bevel: 0.015 });
    A.box('paint', [-0.21, 0.11, -0.22], [0.21, 0.36, 0.02], rgb(0x2b3a34), { par: 1, bevel: 0.03 });
    A.box('paint', [-0.19, 0.11, 0.0], [0.19, 0.2, 0.18], rgb(0x1a221f), { rx: -0.5 });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) A.add('paint', cylUp(0.014, 0.014, 0.02, 6), { m: M(-0.12 + i * 0.08, 0.2 - j * 0.028, 0.06 + j * 0.045, 0.5, 0, 0), color: (i + j) % 4 === 0 ? RED : rgb(0xd8d4c6), par: 1 });
    A.box('glow', [-0.15, 0.27, 0.021], [0.15, 0.33, 0.024], [0.02, 0.05, 0.03], { glow: [0.5, 2.6, 1.2], power: true });
    A.add('metal', cyl(0.008, 0.008, 0.2, 6).rotateX(0.4), { m: M(0.26, 0.2, -0.06), color: CHROME });
    // Searched: the drawer is sprung right out over the counter's edge, its tray emptied but for a
    // few coins and a torn note, the NO SALE flag is up in the window, and the orange tag has gone
    // down with the drawer front.
    if (o.till) {
      A.movable(o.till.prop, M(0, 0, 0.36), () => {
        A.box('paint', [-0.2, 0.012, -0.2], [0.2, 0.03, 0.2], rgb(0x202b27), { par: 1 }); // the drawer's floor
        for (const x of [-0.2, 0.19]) A.box('metal', [x, 0.012, -0.2], [x + 0.01, 0.092, 0.2], rgb(0xa8acb0));
        A.box('paint', [-0.2, 0.012, -0.2], [0.2, 0.092, -0.19], rgb(0x202b27), { par: 1 });
        A.box('paint', [-0.21, 0.008, 0.2], [0.21, 0.1, 0.218], rgb(0x2b3a34), { par: 1, bevel: 0.006 }); // its front
        A.box('metal', [-0.07, 0.045, 0.218], [0.07, 0.062, 0.24], CHROME);
        A.box('paint', [-0.03, 0.066, 0.218], [0.03, 0.094, 0.228], rgb(0xd9741a)); // the tag that marks a searchable
        A.box('paint', [-0.185, 0.03, -0.185], [0.185, 0.036, 0.19], rgb(0xe6dfc4)); // the tray, bare
        for (let i = 1; i < 5; i++) A.box('paint', [-0.19 + i * 0.076, 0.03, -0.185], [-0.184 + i * 0.076, 0.085, 0.06], rgb(0x9a927a));
        A.box('paint', [-0.185, 0.03, 0.06], [0.185, 0.085, 0.066], rgb(0x9a927a));
        for (const [cx, cz, r] of [[-0.12, 0.12, 0.012], [-0.09, 0.14, 0.01], [0.05, 0.11, 0.012], [0.13, 0.15, 0.009], [0.1, 0.1, 0.01]]) A.add('metal', cylUp(r, r, 0.003, 8), { m: M(cx, 0.037, cz), color: rgb(0xc8a84a) });
        A.box('paint', [-0.15, 0.037, -0.12], [-0.06, 0.039, -0.02], rgb(0x4a6a4a), { ry: 0.5 });
      });
      // what whoever emptied it dropped on the counter: under the top until the drawer opens
      A.movable(o.till.prop, M(0, 0.05, 0), () => {
        for (const [x, z, ry, c] of [[0.42, 0.2, 0.4, 0x4a6a4a], [0.55, 0.05, -0.3, 0x5a7a56], [-0.45, 0.25, 1.1, 0x4a6a4a]]) A.box('paint', [x - 0.075, -0.048, z - 0.033], [x + 0.075, -0.046, z + 0.033], rgb(c), { ry });
        A.box('paint', [0.3, -0.048, 0.28], [0.34, -0.046, 0.62], rgb(0xe6e2d6), { ry: 0.15 }); // till roll
        for (const [x, z] of [[0.36, 0.32], [0.48, 0.3], [-0.38, 0.12], [0.6, 0.22]]) A.add('metal', cylUp(0.012, 0.012, 0.003, 8), { m: M(x, -0.048, z), color: rgb(0xc8a84a) });
      });
      A.movable(o.till.prop, M(0, 0.1, 0), () => {
        A.box('paint', [-0.11, 0.262, 0.0], [0.11, 0.348, 0.014], rgb(0xe6e0c8), { par: 1 });
        A.box('paint', [-0.09, 0.285, 0.014], [0.09, 0.325, 0.016], rgb(0x8f1c16));
      });
    }
  });
  // along the top
  A.detail(() => {
    for (const x of [x0 + 0.5, x0 + 1.8, x1 - 1.6]) {
      A.box('metal', [x - 0.07, h, z1 - 0.3], [x + 0.07, h + 0.13, z1 - 0.19], CHROME, { bevel: 0.01 });
      A.add('paint', cylUp(0.027, 0.03, 0.15, 8), { m: M(x + 0.14, h, z1 - 0.24), color: rgb(0x9a1410), par: 1 });
      A.add('paint', cylUp(0.022, 0.025, 0.09, 8), { m: M(x - 0.14, h, z1 - 0.26), color: rgb(0xe6e2d6), par: 1 });
    }
    // plates where people were eating, one stool's worth knocked across
    for (const [x, tip] of [[x0 + 1.25, 0], [x0 + 2.05, 1], [x1 - 0.8, 0]]) {
      A.add('paint', lathe([[0, 0], [0.07, 0], [0.125, 0.018], [0.13, 0.022], [0, 0.012]], 14), { m: M(x, h + (tip ? 0.13 : 0), z1 - 0.3, tip ? 1.35 : 0, 0.4, 0), color: rgb(0xd8d4c6), par: 1 });
      A.add('paint', lathe([[0, 0], [0.03, 0], [0.04, 0.07], [0.036, 0.07], [0.028, 0.012], [0, 0.012]], 10), { m: M(x + 0.2, h, z1 - 0.2), color: rgb(0xc9c4b4), par: 1 });
    }
    A.sign('splat', [x0 + 1.7, h + 0.003, z1 - 0.05], [0.7, 0, 0], [0, 0, -0.7], { color: [0.03, 0.02, 0.012], par: 1 }); // coffee
    // pie stand under a cover, the coffee station
    A.add('metal', cylUp(0.03, 0.09, 0.1, 10), { m: M(x1 - 0.55, h, z0 + 0.4), color: CHROME });
    A.add('metal', cylUp(0.17, 0.17, 0.012, 16), { m: M(x1 - 0.55, h + 0.1, z0 + 0.4), color: CHROME });
    A.add('paint', cylUp(0.13, 0.14, 0.04, 14), { m: M(x1 - 0.55, h + 0.112, z0 + 0.4), color: rgb(0x8a5a22) });
    A.box('metal', [x0 + 0.25, h, z0 + 0.15], [x0 + 0.85, h + 0.4, z0 + 0.5], rgb(0x9a9ea2), { bevel: 0.02 });
    for (const dx of [0.4, 0.7]) { A.add('paint', sphere(0.075, 10, 8), { m: M(x0 + dx, h + 0.1, z0 + 0.62), color: rgb(0x120a06), par: 1 }); A.add('paint', cylUp(0.05, 0.05, 0.02, 10), { m: M(x0 + dx, h + 0.17, z0 + 0.62), color: rgb(0xd9741a) }); }
    A.box('glow', [x0 + 0.3, h + 0.3, z0 + 0.501], [x0 + 0.36, h + 0.33, z0 + 0.504], [0.2, 0.02, 0.01], { glow: [6, 0.4, 0.2], power: true });
    // check spike and bell by the till
    A.add('metal', cylUp(0.002, 0.004, 0.16, 5), { m: M(tx + 0.55, h, tz), color: CHROME });
    A.add('metal', sphere(0.04, 10, 6), { m: M(tx - 0.5, h + 0.01, tz + 0.1, 0, 0, 0, 1, 0.6, 1), color: CHROME });
    A.sign('ticket', [tx + 0.5, h + 0.06, tz + 0.03], [0.09, 0, 0.02], [0, 0.02, -0.12]);
  });
  // the menu board hung over it, lit from inside when there is power
  if (o.menu) {
    const w = 3.5, mh = w * 400 / 1152, y = 2.2, z = (z0 + z1) / 2;
    A.box('paint', [cx - w / 2 - 0.06, y - 0.06, z - 0.09], [cx + w / 2 + 0.06, y + mh + 0.06, z + 0.07], DARK, { shadow: true });
    A.sign('menu', [cx - w / 2, y, z + 0.075], [w, 0, 0], [0, mh, 0], { glow: [1.5, 1.45, 1.25], power: true, color: [0.5, 0.5, 0.5] });
    A.sign('specials', [cx + w / 2, y + 0.06, z - 0.095], [-0.8, 0, 0], [0, 1.1, 0]);
    for (const x of [cx - w / 2 + 0.3, cx + w / 2 - 0.3]) A.add('metal', cyl(0.012, 0.012, 3.5 - y - mh, 6), { m: M(x, (3.5 + y + mh) / 2, z), color: CHROME });
  }
}

export { box, tube };
