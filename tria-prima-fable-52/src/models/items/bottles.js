// Potion bottles. Eight vessels from eight workshops: the outline alone says what is inside.
// Walls go to b.glass() (vertex colour = tint), contents to b.liquid(), fittings to b.add().
// Every bottle stands on y = 0 with +Z as its front. Anchors: grip (middle of the body), mouth.
import { Builder, Rng, Noise, MAT, TAU, THREE, paint, lathe, sphere, torus, tube, box, cyl, flat, deform, mixc, col, leaf, crystal, strokes, circlePath } from '../kit.js';
import { register } from '../registry.js';
import { POTIONS } from '../../game/data.js';
import { gemBox, hopperCube, paintCore, paintFlat, aim, lean, spike, kite, path } from '../flora/_shared.js';

const cl = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sm = (a, b, x) => {
  const t = cl((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const nz = new Noise(907);
const grain = (v, f, o = 0) => 0.5 + 0.5 * nz.n3(v.x * f + o, v.y * f, v.z * f - o);

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------
const IRON = { color: (v) => mixc('#2b2826', '#4d3323', sm(0.35, 0.8, grain(v, 130))), rough: 0.62, metal: 0.7, mat: MAT.METAL };
const BRASS = { color: (v) => mixc('#93722e', '#4a3d1e', sm(0.25, 0.8, grain(v, 140))), rough: 0.4, metal: 0.85, mat: MAT.METAL };
const SILVER = { color: (v) => mixc('#c2c8c9', '#50565a', sm(0.3, 0.85, grain(v, 150))), rough: 0.32, metal: 0.85, mat: MAT.METAL };
const GOLD = { color: (v) => mixc('#c59c38', '#6b4f18', sm(0.3, 0.85, grain(v, 150, 9))), rough: 0.3, metal: 0.9, mat: MAT.METAL };
const HEMP = { color: (v) => mixc('#857657', '#574d3a', grain(v, 400)), rough: 0.95, mat: MAT.CLOTH };
const LINEN = { color: (v) => mixc('#a39d8c', '#6f6a5c', grain(v, 400)), rough: 0.95, mat: MAT.CLOTH };
const CORK = { color: (v) => mixc('#6a4f33', '#3b2a1b', sm(0.2, 0.8, grain(v, 320))), rough: 0.9, mat: MAT.WOOD };

// ---------------------------------------------------------------------------------------------
// Glass blowing
// ---------------------------------------------------------------------------------------------
/** Radius of a [[r, y], ...] profile at height y, read from its rising segments. */
function radiusAt(profile, y) {
  let last = profile[0][0];
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i],
      [r1, y1] = profile[i + 1];
    if (y1 <= y0) continue; // the flat of the base, the rim, the roll back inside the mouth
    if (y >= y0 && y <= y1) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
    if (y > y1) last = r1;
  }
  return last;
}
/** What fills a vessel: its profile pulled in by the wall, flat underneath and flat on top. */
function fillProfile(profile, wall, floor, level) {
  const out = [
    [0, floor],
    [Math.max(0.001, radiusAt(profile, floor) - wall), floor, 'hard'],
  ];
  let top = floor;
  for (const [r, y] of profile) {
    if (y <= top + 1e-4) continue;
    if (y >= level - 1e-4) break;
    out.push([Math.max(0.001, r - wall), y]);
    top = y;
  }
  out.push([Math.max(0.001, radiusAt(profile, level) - wall), level, 'hard'], [0, level]);
  return out;
}
/**
 * Blow a vessel. `profile` runs from the middle of the base up the outside to the lip and back
 * down inside the mouth. `shape(geo, columns)` may push the round section into something else
 * (flutes, a square); `facet` gives it hard faces. The contents follow the same shape.
 */
function blow(b, profile, { radial = 16, facet = false, shape = null, tint = '#c8d2cc', wall = 0.0026, floor = 0.005, level = 0, potion = null, glow = 0.5 } = {}) {
  let g = lathe(profile, radial);
  if (shape) shape(g, radial + 1);
  if (facet) g = flat(g);
  b.glass(paint(g, { color: tint, rough: 0.06 }));
  if (potion && level > floor) {
    let q = lathe(fillProfile(profile, wall, floor, level), radial);
    if (shape) shape(q, radial + 1);
    if (facet) q = flat(q);
    const c1 = col(potion.color),
      c2 = col(potion.color2);
    const y0 = level - (level - floor) * 0.45;
    b.liquid(paint(q, { color: (v) => mixc(c1, c2, sm(y0, level, v.y) * 0.85), emissive: glow, rough: 0.14, mat: MAT.PLAIN }));
  }
}

// ---------------------------------------------------------------------------------------------
// Fittings
// ---------------------------------------------------------------------------------------------
function cork(r0, r1, y0, y1, radial = 10) {
  return paint(
    lathe(
      [
        [0, y0],
        [r0, y0, 'hard'],
        [r1, y1 - 0.0012, 'hard'],
        [r1 - 0.0014, y1, 'hard'],
        [0, y1],
      ],
      radial
    ),
    CORK
  );
}
/** A metal hoop hugging the profile between two heights. */
function hoop(profile, y0, y1, { off = 0.0004, thick = 0.002, radial = 16 } = {}) {
  const r0 = radiusAt(profile, y0) + off,
    r1 = radiusAt(profile, y1) + off;
  return lathe(
    [
      [r0, y0 - 0.0008],
      [r0 + thick, y0, 'hard'],
      [r1 + thick, y1, 'hard'],
      [r1, y1 + 0.0008],
    ],
    radial
  );
}
/** Points of a spiral climbing the profile. */
function wind(profile, y0, y1, turns, { a0 = 0, off = 0.002, n = 0 } = {}) {
  const N = n || Math.ceil(turns * 10);
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N,
      y = y0 + (y1 - y0) * t,
      a = a0 + t * turns * TAU,
      r = radiusAt(profile, y) + off;
    pts.push([Math.cos(a) * r, y, -Math.sin(a) * r]);
  }
  return pts;
}
/**
 * Cord wound round a neck: `wraps` turns at height y, knotted `yaw` radians round from the front,
 * two loose ends. Returns where the knot is.
 */
function twine(b, R, radius, y, wraps, { r = 0.0012, look = HEMP, yaw = 0, tails = true } = {}) {
  for (let i = 0; i < wraps; i++) {
    const g = paint(torus(radius + r * 0.7, r, 4, 14), look);
    g.rotateX(R.range(-0.06, 0.06));
    g.rotateZ(R.range(-0.06, 0.06));
    g.translate(0, y + i * r * 1.8, 0);
    b.add(g);
  }
  const d = radius + r * 2.2;
  const k = [Math.sin(yaw) * d, y + (wraps - 1) * r * 0.9, Math.cos(yaw) * d];
  const knot = paint(sphere(r * 2, 5, 4), look);
  knot.translate(k[0], k[1], k[2]);
  b.add(knot);
  if (tails) {
    const out = [Math.sin(yaw), Math.cos(yaw)],
      side = [Math.cos(yaw), -Math.sin(yaw)];
    for (const s of [-1, 1]) {
      const drop = R.range(0.008, 0.016);
      const t = tube(
        [
          k,
          [k[0] + side[0] * s * 0.004 + out[0] * 0.002, k[1] - 0.006, k[2] + side[1] * s * 0.004 + out[1] * 0.002],
          [k[0] + side[0] * s * 0.006 + out[0] * 0.001, k[1] - 0.006 - drop, k[2] + side[1] * s * 0.006 + out[1] * 0.001],
        ],
        r * 0.75,
        3,
        { samples: 4 }
      );
      b.add(paint(t, look));
    }
  }
  return k;
}
/**
 * A tag: a slip w x h, leaning back by rx and turned by ry, centred on `at`. `mark` is stroke paths
 * in a unit box, drawn `markScale` of the width high; `from` is where its string comes from.
 */
function tag(b, { w, h, t = 0.0014, at, rx = 0, ry = 0, color = '#9c8e70', dirt = '#4d4333', mark = null, markScale = 0.8, markColor = '#2a1c14', from = null, string = HEMP }) {
  const put = (g) => {
    g.rotateX(rx);
    g.rotateY(ry);
    g.translate(at[0], at[1], at[2]);
    return g;
  };
  // grubbier toward the bottom, where it has been handled
  b.add(put(paint(box(w, h, t), { color: (v) => mixc(color, dirt, v.y < 0 ? 0.5 : 0.15), rough: 0.95, mat: MAT.CLOTH })));
  if (mark) {
    const s = w * markScale;
    const m = strokes(
      mark.map((p) => p.map(([x, y]) => [x * s, y * s])),
      Math.max(0.0009, s * 0.085),
      0.0005
    );
    if (m) {
      m.translate(0, 0, t / 2);
      b.add(put(paint(m, { color: markColor, rough: 0.8, mat: MAT.PLAIN })));
    }
  }
  if (from) {
    const top = new THREE.Vector3(0, h / 2 - 0.0015, 0).applyEuler(new THREE.Euler(rx, ry, 0, 'YXZ'));
    b.add(paint(tube([from, [at[0] + top.x, at[1] + top.y, at[2] + top.z]], 0.0006, 3), string));
  }
}
/** A run of something thick down a wall: from radius r0 at yTop, hugging radius r1 below. */
function drip(a, r0, r1, yTop, len, rad, look) {
  const c = Math.cos(a),
    s = Math.sin(a);
  const g = tube(
    [
      [c * r0, yTop, s * r0],
      [c * r1, yTop - len * 0.45, s * r1],
      [c * r1, yTop - len, s * r1],
    ],
    (t) => rad * (0.75 + 0.6 * sm(0.65, 1, t)),
    5,
    { samples: 5 }
  );
  return paint(g, look);
}
/** A strip of cloth lying along a path, flat to the vessel. */
function ribbon(points, width, { samples = 8, taper = 1 } = {}) {
  const P = path(points);
  const pos = [],
    idx = [];
  const d3 = new THREE.Vector3(),
    out = new THREE.Vector3(),
    s = new THREE.Vector3();
  for (let j = 0; j <= samples; j++) {
    const t = j / samples;
    const p = P.at(t),
      d = P.dir(t);
    out.set(p[0], 0, p[2]).normalize();
    s.copy(d3.set(d[0], d[1], d[2])).cross(out).normalize();
    const w = (width / 2) * (1 - (1 - taper) * t);
    pos.push(p[0] - s.x * w, p[1] - s.y * w, p[2] - s.z * w, p[0] + s.x * w, p[1] + s.y * w, p[2] + s.z * w);
  }
  for (let j = 0; j < samples; j++) {
    const a = j * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Finish a bottle: the two anchors every bottle has. */
function done(b, gripY, mouthY) {
  b.anchor('grip', 0, gripY, 0);
  b.anchor('mouth', 0, mouthY, 0);
  return b.build();
}

// ---------------------------------------------------------------------------------------------
// Ember: a squat flask smoked black by what it holds, kept in an iron cage because the glass
// alone has been known to give. Sealed with dark wax that never quite sets.
// ---------------------------------------------------------------------------------------------
register(
  'bottle_ember',
  (seed = 1) => {
    const R = new Rng(4101 + seed * 17);
    const b = new Builder();
    const P = [
      [0, 0.002],
      [0.022, 0, 'hard'],
      [0.031, 0.001],
      [0.046, 0.012],
      [0.0555, 0.031],
      [0.0575, 0.052],
      [0.053, 0.073],
      [0.041, 0.091],
      [0.027, 0.103],
      [0.0185, 0.111],
      [0.0158, 0.121],
      [0.0158, 0.143],
      [0.0195, 0.149, 'hard'],
      [0.0195, 0.153, 'hard'],
      [0.0128, 0.153],
      [0.0125, 0.143],
    ];
    // clear brown glass low down, soot from the shoulder up
    blow(b, P, { radial: 18, tint: (v) => mixc('#b08a5c', '#17110f', sm(0.062, 0.112, v.y)), wall: 0.003, floor: 0.006, level: 0.08, potion: POTIONS.ember, glow: 2.0 });

    // the cage: four straps from a foot ring to a collar, a band round the widest part
    const ys = [0.004, 0.012, 0.031, 0.052, 0.073, 0.091, 0.103, 0.11];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const pts = ys.map((y) => {
        const r = radiusAt(P, y) + 0.0019;
        return [Math.cos(a) * r, y, Math.sin(a) * r];
      });
      b.add(paint(tube(pts, 0.0021, 4, { samples: 12 }), IRON));
      for (const [y, lift] of [
        [0.052, 0.0036],
        [0.1095, 0.0042],
      ]) {
        const r = radiusAt(P, y) + lift;
        const rivet = paint(sphere(0.0027, 5, 3), IRON);
        rivet.translate(Math.cos(a) * r, y, Math.sin(a) * r);
        b.add(rivet);
      }
    }
    b.add(paint(hoop(P, 0.047, 0.057, { off: 0.0005, thick: 0.0021, radial: 18 }), IRON));
    b.add(paint(hoop(P, 0.106, 0.113, { off: 0.0004, thick: 0.0024, radial: 12 }), IRON));
    b.add(paint(hoop(P, 0.002, 0.009, { off: 0.0004, thick: 0.0022, radial: 16 }), IRON));
    // a ring to carry it by, hanging from the collar
    {
      const g = paint(torus(0.0078, 0.0014, 4, 10), IRON);
      g.rotateX(Math.PI / 2);
      g.rotateZ(-0.55);
      g.translate(0.0285, 0.1015, 0);
      b.add(g);
    }

    b.add(cork(0.0124, 0.0148, 0.139, 0.165));
    const wax = { color: (v) => mixc('#4d100c', '#1b0605', sm(0.2, 0.9, grain(v, 200))), rough: 0.32, mat: MAT.PLAIN };
    {
      const g = lathe(
        [
          [0.02, 0.1445],
          [0.0214, 0.15],
          [0.0196, 0.1565],
          [0.0166, 0.164],
          [0.0118, 0.17],
          [0, 0.1722],
        ],
        12
      );
      // the skirt of it hangs lower in some places than others
      deform(
        g,
        (p) => {
          if (p.y < 0.151) {
            const a = Math.atan2(p.z, p.x);
            p.y -= 0.004 * Math.max(0, Math.sin(a * 3 + 1) * Math.sin(a * 2 + 0.3));
          }
        },
        false
      );
      b.add(paint(g, wax));
      for (let i = 0; i < 4; i++) b.add(drip(0.4 + i * 1.6 + R.range(-0.3, 0.3), 0.0203, 0.0172, 0.146, R.range(0.012, 0.03), R.range(0.0019, 0.0026), wax));
    }
    return done(b, 0.052, 0.153);
  },
  { kind: 'bottle', potion: 'ember', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// Verdance: a green gourd of two bulbs. The briar it was bound with died long ago; whatever is
// inside has since put out one new shoot through the cork.
// ---------------------------------------------------------------------------------------------
register(
  'bottle_verdance',
  (seed = 1) => {
    const R = new Rng(4203 + seed * 17);
    const b = new Builder();
    const P = [
      [0, 0.002],
      [0.016, 0, 'hard'],
      [0.024, 0.001],
      [0.036, 0.01],
      [0.0425, 0.029],
      [0.043, 0.047],
      [0.038, 0.067],
      [0.027, 0.082],
      [0.0215, 0.091],
      [0.0235, 0.101],
      [0.0285, 0.113],
      [0.029, 0.125],
      [0.0245, 0.139],
      [0.0155, 0.151],
      [0.0115, 0.159],
      [0.0105, 0.171],
      [0.0135, 0.176, 'hard'],
      [0.0135, 0.1795, 'hard'],
      [0.0088, 0.1795],
      [0.0085, 0.171],
    ];
    blow(b, P, { radial: 16, tint: (v) => mixc('#3a5c3f', '#6a9660', sm(0, 0.13, v.y)), wall: 0.0028, floor: 0.006, level: 0.119, potion: POTIONS.verdance, glow: 0.45 });

    // the briar
    const bark = { color: (v) => mixc('#3b3622', '#5a4b2b', grain(v, 260)), rough: 0.9, mat: MAT.WOOD };
    const vine = wind(P, 0.008, 0.15, 2.4, { a0: 0.6, off: 0.0026, n: 30 });
    b.add(paint(tube(vine, (t) => 0.0027 - 0.0014 * t, 5, { samples: 44 }), bark));
    const along = path(vine);
    for (let i = 0; i < 16; i++) {
      const p = along.at((i + R.range(0.2, 0.8)) / 16);
      const o = Math.hypot(p[0], p[2]) || 1;
      const len = R.range(0.006, 0.011);
      const g = spike(0.0016, len, 3);
      paint(g, { color: (v) => mixc('#4a3f26', '#a08f5f', v.y / len), rough: 0.7, mat: MAT.WOOD });
      b.add(aim(g, [p[0] / o + R.range(-0.4, 0.4), R.range(-0.5, 0.7), p[2] / o + R.range(-0.4, 0.4)], p, R.range(0, TAU)));
    }
    for (const t of [0.18, 0.43, 0.66, 0.86]) {
      const p = along.at(t + R.range(-0.03, 0.03));
      const o = Math.hypot(p[0], p[2]) || 1;
      const g = leaf(0.021, 0.012, { segs: 3, curl: 1.2, fold: 0.5, belly: 0.4 });
      paint(g, { color: (v) => mixc('#4f3d20', '#2c2413', v.y / 0.021), rough: 0.9, mat: MAT.PLANT });
      b.add(aim(g, [p[0] / o, -0.5, p[2] / o], p, R.range(-0.6, 0.6)));
    }
    twine(b, R, 0.0226, 0.0895, 3, { yaw: 0.5 });

    // the shoot
    b.add(cork(0.0086, 0.0104, 0.167, 0.189, 9));
    const green = { color: '#6c9a3e', emissive: 0.3, rough: 0.6, mat: MAT.PLANT };
    b.add(
      paint(
        tube(
          [
            [0.001, 0.188, 0],
            [0.0022, 0.196, 0.001],
            [0.0004, 0.203, 0.003],
          ],
          0.0009,
          4,
          { samples: 4 }
        ),
        green
      )
    );
    for (const s of [-1, 1]) {
      const g = leaf(0.012, 0.0075, { segs: 3, curl: 0.5, fold: 0.3 });
      paint(g, { ...green, color: (v) => mixc('#57833a', '#8cb657', v.y / 0.012) });
      b.add(aim(g, [s * 0.75, 0.6, 0.12], [0.0004, 0.2028, 0.003], s > 0 ? 1.4 : -1.4));
    }
    return done(b, 0.047, 0.1795);
  },
  { kind: 'bottle', potion: 'verdance', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// Rime: a tall fluted vial on a silver foot, capped in silver with a point of clear ice. It is
// colder than the room; frost grows on the metal and small icicles hang from the cap.
// ---------------------------------------------------------------------------------------------
register(
  'bottle_rime',
  (seed = 1) => {
    const R = new Rng(4307 + seed * 17);
    const b = new Builder();
    const P = [
      [0, 0.0125],
      [0.0175, 0.0115, 'hard'],
      [0.0195, 0.0145, 'hard'],
      [0.0265, 0.15, 'hard'],
      [0.0225, 0.16, 'hard'],
      [0.0128, 0.168, 'hard'],
      [0.0112, 0.184],
      [0.0135, 0.188, 'hard'],
      [0.0135, 0.191, 'hard'],
      [0.0088, 0.191],
      [0.0085, 0.184],
    ];
    // twelve flutes: every other column pulled in, dying out above the shoulder
    const flute = (g, cols) =>
      deform(g, (p, n, i) => {
        if ((i % cols) % 2 === 0) return;
        const k = 1 - 0.1 * (1 - sm(0.15, 0.168, p.y));
        p.x *= k;
        p.z *= k;
      });
    blow(b, P, { radial: 24, facet: true, shape: flute, tint: (v) => mixc('#7fb0cf', '#bcdcea', sm(0.01, 0.15, v.y)), wall: 0.0028, floor: 0.017, level: 0.116, potion: POTIONS.rime, glow: 0.6 });

    // foot and cap
    b.add(
      paint(
        lathe(
          [
            [0, 0],
            [0.0305, 0, 'hard'],
            [0.0312, 0.003, 'hard'],
            [0.0245, 0.0065],
            [0.0205, 0.0095, 'hard'],
            [0.0222, 0.0125, 'hard'],
            [0.0222, 0.0165, 'hard'],
            [0.02, 0.0172],
          ],
          16
        ),
        SILVER
      )
    );
    b.add(
      paint(
        lathe(
          [
            [0.0142, 0.1835],
            [0.0152, 0.1855, 'hard'],
            [0.0152, 0.1935, 'hard'],
            [0.0108, 0.1972],
            [0.0064, 0.1985, 'hard'],
            [0.0064, 0.2005, 'hard'],
            [0.0082, 0.2012, 'hard'],
            [0.0082, 0.2022, 'hard'],
            [0, 0.2022],
          ],
          16
        ),
        SILVER
      )
    );
    {
      const g = crystal(0.0068, 0.0165, { sides: 6, tip: 0.5, foot: 0.75, irregular: 0.05, rng: R });
      paint(g, { color: (v) => mixc('#b7dff2', '#f4fcff', v.y / 0.0165), emissive: 0.6, rough: 0.08, mat: MAT.CRYSTAL });
      g.translate(0, 0.2018, 0);
      b.add(g);
    }

    // frost: standing up from the foot, hanging from the shoulder and from the cap
    const ice = (len) => ({ color: (v) => mixc('#cfe8f5', '#ffffff', cl(v.y / len)), emissive: 0.3, rough: 0.1, mat: MAT.CRYSTAL });
    const frost = (n, radius, y, tilt0, tilt1, len0, len1, thick) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + R.range(-0.25, 0.25);
        const len = R.range(len0, len1);
        const g = paint(spike(thick * R.range(0.8, 1.2), len, 4), ice(len));
        b.add(aim(g, lean(R.range(tilt0, tilt1), a), [Math.sin(a) * radius, y, Math.cos(a) * radius], R.range(0, TAU)));
      }
    };
    frost(9, 0.0218, 0.0165, 0.25, 0.9, 0.007, 0.017, 0.0024);
    frost(8, 0.026, 0.151, 2.3, 2.9, 0.006, 0.014, 0.0022);
    frost(6, 0.0148, 0.184, 2.9, 3.14, 0.006, 0.015, 0.002);

    // a charm on a silver thread: six arms, the way water freezes
    b.add(paint(torus(0.012, 0.0007, 3, 12).translate(0, 0.1775, 0), SILVER));
    b.add(
      paint(
        tube(
          [
            [0, 0.1775, 0.0127],
            [0, 0.168, 0.0146],
            [0, 0.16, 0.0238],
            [0, 0.151, 0.0279],
            [0, 0.1455, 0.0284],
          ],
          0.00055,
          3,
          { samples: 10 }
        ),
        SILVER
      )
    );
    for (let k = 0; k < 3; k++) {
      const g = paint(box(0.0135, 0.0015, 0.0011), { ...SILVER, color: '#dfe9ee', emissive: 0.15 });
      g.rotateZ((k * Math.PI) / 3 + Math.PI / 2);
      g.translate(0, 0.1385, 0.0283);
      b.add(g);
    }
    return done(b, 0.085, 0.191);
  },
  { kind: 'bottle', potion: 'rime', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// Levity: a matrass, all neck, with a glass ball for a stopper. Silver wire is wound up the neck
// and two feathers are bound to it, which is either a label or a superstition.
// ---------------------------------------------------------------------------------------------
register(
  'bottle_levity',
  (seed = 1) => {
    const R = new Rng(4409 + seed * 17);
    const b = new Builder();
    const P = [
      [0, 0.0015],
      [0.01, 0, 'hard'],
      [0.016, 0.0008],
      [0.027, 0.008],
      [0.0345, 0.023],
      [0.0358, 0.038],
      [0.0315, 0.054],
      [0.0215, 0.066],
      [0.0128, 0.074],
      [0.0098, 0.084],
      [0.0092, 0.13],
      [0.0096, 0.168],
      [0.0126, 0.174, 'hard'],
      [0.0126, 0.177, 'hard'],
      [0.0079, 0.177],
      [0.0076, 0.168],
    ];
    const tint = (v) => mixc('#a195cf', '#cdc6e8', sm(0.02, 0.17, v.y));
    blow(b, P, { radial: 16, tint, wall: 0.0024, floor: 0.005, level: 0.058, potion: POTIONS.levity, glow: 0.7 });
    {
      const g = sphere(0.0118, 12, 8);
      g.translate(0, 0.1868, 0);
      b.glass(paint(g, { color: '#bdb2e6', rough: 0.06 }));
    }

    const wire = wind(P, 0.086, 0.166, 7, { off: 0.0011, n: 70 });
    b.add(paint(tube(wire, 0.0008, 3, { samples: 84, caps: false }), SILVER));

    // the feathers, bound by the quill
    const yaw = 1.15;
    const feather = (len, width, tilt, turn, y) => {
      const dir = lean(tilt, yaw + turn);
      const r = radiusAt(P, y) + 0.0016;
      const root = [Math.sin(yaw + turn) * r, y, Math.cos(yaw + turn) * r];
      const at = (k) => [root[0] + dir[0] * k, root[1] + dir[1] * k, root[2] + dir[2] * k];
      b.add(paint(tube([at(-0.012), at(len * 0.5), at(len + 0.01)], (t) => 0.0008 - 0.0005 * t, 3, { samples: 4 }), { color: '#cfc9bd', rough: 0.6, mat: MAT.PLAIN }));
      const g = leaf(len, width, { segs: 6, belly: 0.5, point: 1.1, curl: 0.3, fold: 0.1, base: 0.12 });
      paint(g, { color: (v) => mixc(mixc('#2e2b3a', '#8c87a4', cl(v.y / len)), '#d6d1e0', Math.abs(v.x) < 1e-6 ? 0.7 : 0), rough: 0.85, mat: MAT.CLOTH });
      b.add(aim(g, dir, at(0.01), 0));
    };
    feather(0.058, 0.019, 0.5, 0, 0.15);
    feather(0.04, 0.014, 0.8, 0.45, 0.147);
    twine(b, R, 0.0094, 0.1455, 3, { r: 0.001, yaw: yaw + 0.2 });
    return done(b, 0.04, 0.177);
  },
  { kind: 'bottle', potion: 'levity', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// Fulminate: a square case bottle strapped in brass at every corner, the cork wired down, a
// length of slow match pushed through it. The mark on the front is a warning, not a decoration.
// ---------------------------------------------------------------------------------------------
register(
  'bottle_fulminate',
  (seed = 1) => {
    const R = new Rng(4513 + seed * 17);
    const b = new Builder();
    const RB = 0.034; // corner radius of the body
    const P = [
      [0, 0.002],
      [0.03, 0, 'hard'],
      [RB, 0.003, 'hard'],
      [RB, 0.116, 'hard'],
      [0.027, 0.128, 'hard'],
      [0.0165, 0.136, 'hard'],
      [0.015, 0.154],
      [0.018, 0.158, 'hard'],
      [0.018, 0.162, 'hard'],
      [0.0118, 0.162],
      [0.0115, 0.154],
    ];
    // sixteen columns gathered four to a corner: flat sides, turned corners; the neck comes out round
    const D = 0.15;
    const spread = (y) => D + ((3 * Math.PI) / 16 - D) * sm(0.116, 0.137, y);
    const square = (g, cols) =>
      deform(g, (p, n, i) => {
        const r = Math.hypot(p.x, p.z);
        if (r < 1e-6) return;
        const c = i % cols;
        const k = Math.floor(c / 4),
          j = c % 4;
        const a = Math.PI / 4 + (Math.PI / 2) * k + ((j - 1.5) / 1.5) * spread(p.y);
        p.x = Math.cos(a) * r;
        p.z = -Math.sin(a) * r;
      });
    blow(b, P, { radial: 16, facet: true, shape: square, tint: '#cdc78f', wall: 0.003, floor: 0.006, level: 0.085, potion: POTIONS.fulminate, glow: 1.1 });
    const FACE = RB * Math.cos(Math.PI / 4 - D); // from the axis to the middle of a side

    // brass: a strap up each corner, a band low and a band high, riveted where they cross
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const dx = Math.cos(a),
        dz = -Math.sin(a);
      const g = paint(box(0.0118, 0.117, 0.0018), BRASS);
      g.rotateY(Math.atan2(dx, dz));
      g.translate(dx * (RB + 0.0012), 0.0595, dz * (RB + 0.0012));
      b.add(g);
      for (const y of [0.007, 0.0595, 0.109]) {
        const rivet = paint(sphere(0.0021, 5, 3), BRASS);
        rivet.translate(dx * (RB + 0.0026), y, dz * (RB + 0.0026));
        b.add(rivet);
      }
    }
    for (const [y0, y1] of [
      [0.0012, 0.0125],
      [0.103, 0.115],
    ]) {
      let g = lathe(
        [
          [RB + 0.0002, y0 - 0.0007],
          [RB + 0.0016, y0, 'hard'],
          [RB + 0.0016, y1, 'hard'],
          [RB + 0.0002, y1 + 0.0007],
        ],
        16
      );
      square(g, 17);
      g = flat(g);
      b.add(paint(g, BRASS));
    }
    // the mark
    {
      const s = 0.05;
      const g = strokes(
        [
          [
            [-0.13 * s, 0.5 * s],
            [0.17 * s, 0.07 * s],
            [-0.12 * s, 0.0],
            [0.14 * s, -0.5 * s],
          ],
        ],
        0.0032,
        0.0012
      );
      g.translate(0, 0.06, FACE + 0.0002);
      b.add(paint(g, { ...BRASS, color: '#b3913f', rough: 0.3 }));
    }

    // the cork, wired down
    b.add(cork(0.0112, 0.0136, 0.15, 0.1755, 8));
    const wire = { color: '#3a3733', rough: 0.5, metal: 0.8, mat: MAT.METAL };
    b.add(paint(torus(0.0158, 0.0009, 4, 12).translate(0, 0.1525, 0), wire));
    for (const turn of [0, Math.PI / 2]) {
      const g = tube(
        [
          [0.0162, 0.153, 0],
          [0.015, 0.17, 0],
          [0, 0.1775, 0],
          [-0.015, 0.17, 0],
          [-0.0162, 0.153, 0],
        ],
        0.0008,
        3,
        { samples: 10 }
      );
      g.rotateY(turn);
      b.add(paint(g, wire));
    }
    // the match: tarred cord, unlit, frayed at the end
    const fuse = [
      [0.0015, 0.172, 0.001],
      [0.0035, 0.184, 0.003],
      [0.0105, 0.1915, 0.006],
      [0.019, 0.188, 0.009],
      [0.0235, 0.178, 0.011],
    ];
    b.add(
      paint(tube(fuse, 0.0015, 5, { samples: 10 }), {
        color: (v) => mixc(mixc('#2c241b', '#4d3f2b', 0.5 + 0.5 * Math.sin((v.x + v.y + v.z) * 2400)), '#b7a274', sm(0.185, 0.178, v.y) * (v.x > 0.018 ? 1 : 0)),
        rough: 0.95,
        mat: MAT.CLOTH,
      })
    );
    for (let i = 0; i < 4; i++) {
      const len = R.range(0.004, 0.007);
      const g = paint(spike(0.0006, len, 3), { color: '#b7a274', rough: 0.95, mat: MAT.CLOTH });
      b.add(aim(g, [R.range(-0.5, 0.7), -1, R.range(-0.5, 0.5)], fuse[4], 0));
    }

    const k = twine(b, R, 0.0152, 0.1415, 2, { yaw: -0.5 });
    tag(b, { w: 0.016, h: 0.024, at: [-0.012, 0.11, FACE + 0.0036], rx: -0.12, ry: -0.15, color: '#7d6a48', dirt: '#231b14', from: k });
    return done(b, 0.06, 0.162);
  },
  { kind: 'bottle', potion: 'fulminate', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// Saltspire: a cone flask the salt has been climbing out of for years. It crusts the foot, creeps
// up one side and has closed the mouth with a single cube that nobody put there.
// ---------------------------------------------------------------------------------------------
register(
  'bottle_saltspire',
  (seed = 1) => {
    const R = new Rng(4621 + seed * 17);
    const b = new Builder();
    const P = [
      [0, 0.002],
      [0.04, 0, 'hard'],
      [0.0485, 0.0015],
      [0.0505, 0.006],
      [0.0495, 0.013],
      [0.0455, 0.025],
      [0.03, 0.09],
      [0.019, 0.126],
      [0.0148, 0.136],
      [0.0145, 0.156],
      [0.0185, 0.161, 'hard'],
      [0.0185, 0.165, 'hard'],
      [0.0115, 0.165],
      [0.0112, 0.156],
    ];
    blow(b, P, { radial: 18, tint: (v) => mixc('#c4b3b6', '#ddd3d3', sm(0, 0.16, v.y)), wall: 0.0028, floor: 0.006, level: 0.094, potion: POTIONS.saltspire, glow: 0.3 });

    // the crust: cubes, because salt has no other idea
    const cube = (a, y, s) => {
      const g = gemBox(s, s, s, 0);
      paintCore(g, { color: '#a59797', emissive: 0.02, rough: 0.3 }, { color: '#f3ecea', emissive: 0.16, rough: 0.12 }, { mat: MAT.CRYSTAL });
      g.rotateX(R.range(0, 1.5));
      g.rotateZ(R.range(0, 1.5));
      g.rotateY(R.range(0, TAU));
      const r = radiusAt(P, y) + s * 0.28;
      g.translate(Math.sin(a) * r, Math.max(y, s * 0.87), Math.cos(a) * r);
      b.add(g);
    };
    for (let i = 0; i < 10; i++) cube(R.range(0, TAU), R.range(0.138, 0.164), R.range(0.004, 0.0085));
    for (let i = 0; i < 10; i++) cube((i / 10) * TAU + R.range(-0.25, 0.25), R.range(0.002, 0.014), R.range(0.005, 0.011));
    const side = 2.3;
    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      cube(side + R.range(-0.5, 0.5) * (1 - 0.5 * t), 0.02 + 0.105 * t + R.range(-0.006, 0.006), 0.0095 - 0.005 * t + R.range(-0.001, 0.001));
    }
    // the stopper
    {
      const h = 0.0122;
      const g = hopperCube(h, [
        [0.72, 0.14],
        [0.46, 0.3],
      ]);
      paintFlat(
        g,
        (cx, cy, cz, nx, ny, nz2) => {
          const ax = Math.abs(cx),
            ay = Math.abs(cy),
            az = Math.abs(cz);
          const m = Math.max(ax, ay, az);
          const d = cl((h - m) / (h * 0.3));
          const riser = (ax === m ? Math.abs(nx) : ay === m ? Math.abs(ny) : Math.abs(nz2)) < 0.5;
          return { color: riser ? mixc('#8f7f80', '#d9cccc', d) : mixc('#d8c6c5', '#fbf5f3', d), emissive: 0.03 + 0.35 * d, rough: riser ? 0.25 : 0.12 };
        },
        { mat: MAT.CRYSTAL }
      );
      g.rotateY(0.5);
      g.rotateZ(0.06);
      g.translate(0.0006, 0.165 + h - 0.0012, 0);
      b.add(g);
    }

    // a linen tie and a bone tag, scratched with the sign for salt
    const k = twine(b, R, 0.0147, 0.143, 2, { r: 0.0014, look: LINEN, yaw: 0.25 });
    const ring = circlePath(0, 0, 0.36, 10);
    tag(b, {
      w: 0.017,
      h: 0.027,
      at: [0.0035, 0.106, radiusAt(P, 0.106) + 0.0034],
      rx: -0.29,
      ry: 0.12,
      color: '#b5aa8f',
      dirt: '#6d634f',
      mark: [
        ring,
        [
          [-0.36, 0],
          [0.36, 0],
        ],
      ],
      markScale: 0.72,
      markColor: '#2c1e16',
      from: k,
      string: LINEN,
    });
    return done(b, 0.05, 0.165);
  },
  { kind: 'bottle', potion: 'saltspire', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// Vitae: a small amphora with two handles, banded in gold and sealed in red under a signet. The
// only bottle on the shelf that somebody wanted to be beautiful.
// ---------------------------------------------------------------------------------------------
register(
  'bottle_vitae',
  (seed = 1) => {
    const R = new Rng(4729 + seed * 17);
    const b = new Builder();
    const P = [
      [0, 0.003],
      [0.015, 0.0015],
      [0.0195, 0, 'hard'],
      [0.0212, 0.003],
      [0.0198, 0.0075, 'hard'],
      [0.0138, 0.0135],
      [0.015, 0.02],
      [0.0215, 0.03],
      [0.0318, 0.048],
      [0.0372, 0.07],
      [0.0362, 0.09],
      [0.0288, 0.11],
      [0.0182, 0.126],
      [0.0126, 0.136],
      [0.0115, 0.158],
      [0.0128, 0.168],
      [0.0186, 0.1755, 'hard'],
      [0.0186, 0.1785, 'hard'],
      [0.0106, 0.1785],
      [0.01, 0.166],
    ];
    const tint = (v) => mixc('#c4a05e', '#e0cc9a', sm(0.02, 0.17, v.y));
    blow(b, P, { radial: 16, tint, wall: 0.0026, floor: 0.021, level: 0.106, potion: POTIONS.vitae, glow: 0.9 });
    for (const s of [-1, 1]) {
      const g = tube(
        [
          [s * 0.0272, 0.112, 0],
          [s * 0.0425, 0.128, 0],
          [s * 0.0405, 0.152, 0],
          [s * 0.0126, 0.1655, 0],
        ],
        0.0031,
        6,
        { samples: 10 }
      );
      b.glass(paint(g, { color: '#d2b478', rough: 0.06 }));
    }

    // gold
    b.add(paint(hoop(P, 0.0665, 0.0725, { thick: 0.0012, radial: 16 }), GOLD));
    b.add(paint(hoop(P, 0.1325, 0.1375, { thick: 0.0014, radial: 12 }), GOLD));
    b.add(paint(hoop(P, 0.0034, 0.0072, { thick: 0.0012, radial: 14 }), GOLD));
    // the sun, low on the front
    {
      const y = 0.0795,
        z = radiusAt(P, 0.0795) + 0.0009;
      const sun = { ...GOLD, emissive: 0.12 };
      const d = paint(cyl(0.0058, 0.0058, 0.0014, 10), sun);
      d.rotateX(Math.PI / 2);
      d.translate(0, y, z);
      b.add(d);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        const g = paint(spike(0.0015, k % 2 ? 0.0045 : 0.0062, 3), sun);
        b.add(aim(g, [Math.cos(a), Math.sin(a), 0], [Math.cos(a) * 0.0064, y + Math.sin(a) * 0.0064, z], 0));
      }
    }

    // cork, wax and the signet pressed into it
    b.add(cork(0.0098, 0.0118, 0.166, 0.185, 9));
    const wax = { color: (v) => mixc('#7a1218', '#3d080b', sm(0.2, 0.9, grain(v, 220))), rough: 0.3, mat: MAT.PLAIN };
    {
      const g = lathe(
        [
          [0.0192, 0.1735],
          [0.0204, 0.179],
          [0.0188, 0.185],
          [0.015, 0.1905, 'hard'],
          [0.0146, 0.193, 'hard'],
          [0, 0.193],
        ],
        12
      );
      deform(
        g,
        (p) => {
          if (p.y < 0.18) {
            const a = Math.atan2(p.z, p.x);
            p.y -= 0.0035 * Math.max(0, Math.sin(a * 2 + 2) * Math.sin(a * 3 + 0.7));
          }
        },
        false
      );
      b.add(paint(g, wax));
      b.add(paint(torus(0.0088, 0.0011, 4, 12).translate(0, 0.1931, 0), wax));
      b.add(paint(sphere(0.003, 6, 4).scale(1, 0.4, 1).translate(0, 0.1932, 0), wax));
      for (let i = 0; i < 3; i++) b.add(drip(2.4 + i * 1.9 + R.range(-0.3, 0.3), 0.0196, 0.0128, 0.1745, R.range(0.01, 0.022), R.range(0.0017, 0.0023), wax));
    }
    // two tails of ribbon from under the seal
    for (const s of [-1, 1]) {
      const g = ribbon(
        [
          [s * 0.003, 0.1745, 0.0195],
          [s * 0.007, 0.16, 0.0142],
          [s * 0.011, 0.138, 0.0128],
          [s * 0.016, 0.118, 0.0218],
          [s * 0.0205, s > 0 ? 0.098 : 0.106, s > 0 ? 0.0292 : 0.0262],
        ],
        0.0075,
        { samples: 10, taper: 0.8 }
      );
      b.add(paint(g, { color: (v) => mixc('#7c131a', '#4a0b10', sm(0.17, 0.1, v.y)), rough: 0.8, mat: MAT.CLOTH }));
    }
    return done(b, 0.075, 0.1785);
  },
  { kind: 'bottle', potion: 'vitae', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// Empty: a plain apothecary vial, hand-blown and not quite straight. The cork hangs from the neck
// on its string, the label has lost whatever it said, and something small died at the bottom.
// ---------------------------------------------------------------------------------------------
register(
  'bottle_empty',
  (seed = 1) => {
    const R = new Rng(4831 + seed * 17);
    const b = new Builder();
    const P = [
      [0, 0.0075],
      [0.012, 0.0058],
      [0.0212, 0],
      [0.0252, 0.003],
      [0.0262, 0.012],
      [0.0262, 0.122],
      [0.0238, 0.134],
      [0.0152, 0.143],
      [0.0136, 0.149],
      [0.0136, 0.164],
      [0.0172, 0.168, 'hard'],
      [0.0172, 0.172, 'hard'],
      [0.0108, 0.172],
      [0.0105, 0.162],
    ];
    // the lean of something made by eye
    const wonky = (g) =>
      deform(
        g,
        (p) => {
          const k = sm(0.01, 0.17, p.y);
          p.x += 0.0016 * Math.sin(p.y * 38) * k;
          p.z += 0.0012 * Math.sin(p.y * 29 + 1) * k;
        },
        false
      );
    blow(b, P, { radial: 24, shape: wonky, tint: (v) => mixc('#84917f', '#bcc8bd', sm(0, 0.09, v.y)) });

    // what was in it: a dry tide line, and a moth
    b.add(
      paint(
        lathe(
          [
            [0, 0.0082],
            [0.0125, 0.0066],
            [0.0205, 0.0036],
            [0.0232, 0.0085],
            [0.0236, 0.017],
          ],
          14
        ),
        { color: (v) => mixc('#1d1812', '#5c5340', sm(0.006, 0.017, v.y)), rough: 0.95, mat: MAT.PLAIN }
      )
    );
    {
      const dead = { color: '#5d5545', rough: 0.9, mat: MAT.CLOTH };
      const body = paint(sphere(0.0019, 5, 4).scale(1, 0.8, 2.6), { ...dead, color: '#3a352b' });
      body.rotateY(0.7);
      body.translate(0.006, 0.0088, -0.003);
      b.add(body);
      for (const s of [-1, 1]) {
        const g = paint(kite(0.0105, 0.008, 0.45, 0.1), dead);
        g.rotateX(Math.PI / 2 - 0.25);
        g.rotateY(0.7 + s * 1.15);
        g.translate(0.006, 0.0092, -0.003);
        b.add(g);
      }
    }

    // the label: paper pasted round the front, one corner lifting
    {
      const r = 0.0262 + 0.0005,
        arc = 2.2;
      const g = lathe(
        [
          [r, 0.05],
          [r, 0.096],
        ],
        10,
        { arc }
      );
      g.rotateY((3 * Math.PI) / 2 - arc / 2);
      deform(
        g,
        (p) => {
          // the upper corner on the +X side has come unstuck
          const k = sm(0.014, 0.024, p.x) * sm(0.08, 0.096, p.y);
          p.x += 0.004 * k;
          p.z += 0.005 * k;
        },
        true
      );
      b.add(paint(g, { color: (v) => mixc('#a4977a', '#6b6048', sm(0.25, 0.8, grain(v, 160)) * 0.55 + 0.3 * sm(0.062, 0.05, v.y)), rough: 0.95, mat: MAT.CLOTH }));
    }

    // twine round the neck, the cork hanging from it
    const k = twine(b, R, 0.0138, 0.153, 3, { yaw: -1.0 });
    {
      const yaw = -1.0;
      const out = [Math.sin(yaw), Math.cos(yaw)];
      const c = [out[0] * 0.039, 0.118, out[1] * 0.039]; // middle of the cork
      const g = cork(0.0104, 0.0126, -0.012, 0.012, 10);
      const loop = paint(torus(0.0122, 0.001, 4, 12), HEMP);
      for (const part of [g, loop]) {
        part.rotateZ(0.3);
        part.rotateY(yaw + 0.4);
        part.translate(c[0], c[1], c[2]);
        b.add(part);
      }
      b.add(paint(tube([k, [out[0] * 0.03, 0.142, out[1] * 0.03], [c[0] * 0.95, c[1] + 0.006, c[2] * 0.95]], 0.0007, 3, { samples: 5 }), HEMP));
    }
    return done(b, 0.07, 0.172);
  },
  { kind: 'bottle', potion: null, variants: 1 }
);
