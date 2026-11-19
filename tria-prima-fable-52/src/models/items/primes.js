// The three Primes and the Stone: relics that hover and turn. Each is centred on x = z = 0 with its
// lowest point at y = 0, carries one light and a `glow` emitter, and lives entirely in `opaque`.
import { Builder, Rng, Noise, MAT, TAU, THREE, paint, lathe, sphere, torus, tube, mat4, deform, mixc, col } from '../kit.js';
import { register } from '../registry.js';
import { PRIME_ITEMS } from '../../game/data.js';
import { gemBox, hopperCube, facetSolid, paintCore, paintFlat, aim, lean, spike } from '../flora/_shared.js';

const cl = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sm = (a, b, x) => {
  const t = cl((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ONE = V(1, 1, 1);
const place = (g, q, t) => mat4(g, new THREE.Matrix4().compose(V(t[0], t[1], t[2]), q, ONE));

// ---------------------------------------------------------------------------------------------
// Prime Salt: body without flaw. Two clear cubes grown through one another on a shared diagonal
// (the penetration twin of the cubic salts), standing on one corner. Something white and cold sits
// at the middle, and shows through every face where the crystal is thinnest.
// ---------------------------------------------------------------------------------------------
/**
 * A flawless cube, half edge h. Its faces are cut into nested squares only so that the light of the
 * heart can fade toward the edges: the face centre is the nearest the surface comes to the middle.
 */
function clearCube(h, glow, rings = [0.84, 0.68, 0.52, 0.36, 0.2]) {
  const g = hopperCube(
    h,
    rings.map((s) => [s, 0])
  );
  const k = (v) => 1 - sm(1.0, 1.42, Math.hypot(v.x, v.y, v.z) / h);
  return paint(g, {
    color: (v) => mixc('#6f7a88', '#f1f6ff', Math.pow(k(v), 0.7)),
    emissive: (v) => 0.03 + glow * Math.pow(k(v), 1.9),
    rough: 0.06,
    mat: MAT.CRYSTAL,
  });
}
/** A small hopper cube: stepped hollows in every face, lit from the bottom of each hollow. */
function hopper(h, glow) {
  const g = hopperCube(h, [
    [0.72, 0.14],
    [0.46, 0.32],
  ]);
  return paintFlat(
    g,
    (cx, cy, cz, nx, ny, nz) => {
      const ax = Math.abs(cx),
        ay = Math.abs(cy),
        az = Math.abs(cz);
      const m = Math.max(ax, ay, az);
      const d = cl((h - m) / (h * 0.32)); // 0 on the face, 1 on the floor of the hollow
      const riser = (ax === m ? Math.abs(nx) : ay === m ? Math.abs(ny) : Math.abs(nz)) < 0.5;
      return {
        color: riser ? mixc('#5d6877', '#c9d6e6', d) : mixc('#a9b1bb', '#f4f8ff', d),
        emissive: 0.03 + glow * Math.pow(d, 2.2) * (riser ? 0.45 : 1),
        rough: riser ? 0.2 : 0.08,
      };
    },
    { mat: MAT.CRYSTAL }
  );
}

register(
  'prime_salt',
  (seed = 1) => {
    const R = new Rng(977 + seed * 13);
    const b = new Builder();
    const h = 0.08; // half edge of the greater cube
    const cy = h * Math.sqrt(3); // height of its centre when it stands on a corner
    const C = [0, cy, 0];
    const latA = new THREE.Quaternion().setFromUnitVectors(V(1, 1, 1).normalize(), V(0, 1, 0));
    // the twin: the same lattice turned a sixth of a circle about the shared diagonal
    const latB = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 3).multiply(latA);
    const hB = h * 0.84;

    b.add(place(clearCube(h, 2.5), latA, C));
    b.add(place(clearCube(hB, 1.9), latB, C));

    // lesser cubes grown on the free corners of both, each keeping the lattice of its parent
    const free = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) if (Math.abs(sx + sy + sz) < 3) free.push([sx, sy, sz]);
    const pickFrom = (list, n) => {
      const pool = list.slice(),
        out = [];
      while (pool.length && out.length < n) out.push(pool.splice(R.int(0, pool.length - 1), 1)[0]);
      return out;
    };
    const grow = (q, hp, c, geo, k) => {
      const p = V(c[0] * hp * k, c[1] * hp * k, c[2] * hp * k).applyQuaternion(q);
      b.add(place(geo, q, [p.x, p.y + cy, p.z]));
    };
    for (const c of pickFrom(free, 3)) {
      const hh = h * R.range(0.26, 0.36);
      grow(latA, h, c, hopper(hh, 1.5), R.range(0.86, 0.98));
    }
    for (const c of pickFrom(free, 3)) {
      const hh = hB * R.range(0.2, 0.3);
      grow(latB, hB, c, clearCube(hh, 1.2, [0.62, 0.3]), R.range(0.84, 0.96));
    }
    // and along the edges of the greater cube
    const edges = [
      [1, 1, 0],
      [-1, 0, 1],
      [0, 1, -1],
      [1, 0, 1],
      [0, -1, 1],
      [-1, 1, 0],
      [0, 1, 1],
      [1, -1, 0],
    ];
    for (const c of pickFrom(edges, 3)) {
      const hh = h * R.range(0.15, 0.22);
      grow(latA, h, c, hopper(hh, 1.2), R.range(0.94, 1.02));
    }
    // seed crystals
    for (let i = 0; i < 10; i++) {
      const onB = i % 3 === 2;
      const q = onB ? latB : latA,
        hp = onB ? hB : h;
      const ax = R.int(0, 2);
      const c = [R.sign(), R.sign(), R.sign()];
      c[ax] = R.range(-0.8, 0.8);
      const s = h * R.range(0.06, 0.13);
      const p = V(c[0] * hp, c[1] * hp, c[2] * hp).applyQuaternion(q);
      if (p.y + cy < s * 2.2) continue;
      const g = gemBox(s * 2, s * 2, s * 2, 0);
      paintCore(g, { color: '#8e99a6', emissive: 0.03, rough: 0.16 }, { color: '#eef3fb', emissive: 0.55, rough: 0.06 }, { mat: MAT.CRYSTAL });
      b.add(place(g, q, [p.x, p.y + cy, p.z]));
    }

    b.anchor('core', 0, cy, 0);
    b.light(0, cy, 0, '#eef4ff', 0.9, 3.2);
    b.emitter('glow', 0, cy, 0, { color: PRIME_ITEMS.salt.color, size: 0.34 });
    return b.build();
  },
  { kind: 'prime', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// Prime Mercury: spirit without rest. A mirror drop that will not fall, watched by an armillary
// of tarnished silver whose needles never quite touch it.
// ---------------------------------------------------------------------------------------------
register(
  'prime_mercury',
  (seed = 1) => {
    const R = new Rng(331 + seed * 7);
    const nz = new Noise(41 + seed);
    const b = new Builder();
    const RO = 0.124; // outer radius of the meridian ring
    const FOOT = 0.034;
    const cy = FOOT + RO;
    const at = (g, x = 0, y = 0, z = 0) => {
      g.translate(x, cy + y, z);
      return g;
    };

    const silver = col('#c3c9c8'),
      black = col('#33383a'),
      stain = col('#7d6a45');
    // tarnish: black in the lows, a brown bloom here and there, bright metal only where it is handled
    const tarnish = (off, bright = 0.5) => (v) => {
      const n = 0.5 + 0.5 * nz.fbm3(v.x * 22 + off, v.y * 22, v.z * 22 - off, 3);
      const n2 = 0.5 + 0.5 * nz.n3(v.x * 60 - off, v.y * 60, v.z * 60);
      return mixc(black, silver, cl(n * 1.5 - 0.3 + bright - 0.5)).lerp(stain, cl(n2 * 1.6 - 0.9) * 0.6);
    };
    const band = (rin, rout, w, radial = 32) =>
      lathe(
        [
          [rin, -w / 2, 'hard'],
          [rout, -w / 2, 'hard'],
          [rout, w / 2, 'hard'],
          [rin, w / 2, 'hard'],
          [rin, -w / 2],
        ],
        radial
      );
    const metal = { rough: 0.36, metal: 0.8, mat: MAT.METAL };

    // the meridian: a flat ring graduated on its face
    {
      const g = band(RO - 0.014, RO, 0.0036);
      const tc = tarnish(0, 0.6);
      paint(g, {
        color: (v) => {
          const c = tc(v);
          // graduation: every other station cut dark along the inner edge of the face
          const k = Math.round((Math.atan2(-v.z, v.x) / TAU) * 32);
          const inner = Math.hypot(v.x, v.z) < RO - 0.007;
          return ((k % 2) + 2) % 2 === 0 && inner ? c.multiplyScalar(0.3) : c;
        },
        ...metal,
      });
      g.rotateX(Math.PI / 2);
      b.add(at(g));
    }
    // the colure, crossing it at the poles
    {
      const g = band(RO - 0.0125, RO - 0.0025, 0.003);
      paint(g, { color: tarnish(7, 0.5), ...metal });
      g.rotateX(Math.PI / 2);
      g.rotateY(Math.PI / 2);
      b.add(at(g));
    }
    // the equator: a hoop standing on edge
    {
      const g = band(0.1005, 0.1032, 0.011);
      paint(g, { color: tarnish(13, 0.45), ...metal });
      b.add(at(g));
    }
    // the ecliptic, tilted
    {
      const g = band(0.0885, 0.0912, 0.007);
      paint(g, { color: tarnish(21, 0.65), ...metal });
      g.rotateZ(0.41);
      g.rotateY(R.range(0.5, 1.1));
      b.add(at(g));
    }
    // rivets where the hoop meets the uprights
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      const g = sphere(0.0046, 6, 4);
      paint(g, { color: '#d0d5d3', rough: 0.3, metal: 0.9, mat: MAT.METAL });
      b.add(at(g, Math.cos(a) * 0.1068, 0, Math.sin(a) * 0.1068));
    }

    // the needles: one from each pole, stopping short of the drop
    const DROP = 0.05;
    for (const s of [-1, 1]) {
      const len = RO - 0.014 - DROP - 0.013;
      const g = lathe(
        [
          [0, 0],
          [0.0016, len * 0.3],
          [0.0034, len * 0.86],
          [0.006, len * 0.93],
          [0.0052, len],
        ],
        6
      );
      paint(g, { color: tarnish(31 + s, 0.7), rough: 0.32, metal: 0.85, mat: MAT.METAL });
      // built point down at the origin: the point stops a finger's width from the drop
      if (s < 0) g.rotateX(Math.PI);
      b.add(at(g, 0, s * (DROP + 0.013), 0));
    }
    // a ring to hang it by, and a foot that is only a point
    {
      const g = torus(0.0105, 0.0028, 5, 12);
      paint(g, { color: tarnish(51, 0.55), ...metal });
      g.rotateX(Math.PI / 2);
      b.add(at(g, 0, RO + 0.0085, 0));
      const f = lathe(
        [
          [0, 0],
          [0.0026, FOOT * 0.42],
          [0.0072, FOOT * 0.76],
          [0.0044, FOOT * 0.9],
          [0.0058, FOOT + 0.002],
        ],
        6
      );
      paint(f, { color: tarnish(61, 0.55), ...metal });
      b.add(f);
    }

    // the drop: never quite a sphere
    const mirror = { color: PRIME_ITEMS.mercury.color, rough: 0.03, metal: 1, emissive: 0.07, mat: MAT.PLAIN };
    {
      const g = sphere(DROP, 22, 14);
      deform(g, (p) => {
        const k = 1 + 0.035 * Math.sin(p.x * 60 + 1) * Math.sin(p.z * 50) + 0.03 * Math.sin(p.y * 45 + 2);
        p.multiplyScalar(k);
        p.y *= 0.95;
      });
      paint(g, mirror);
      b.add(at(g));
    }
    // beads that have left it and not yet decided to come back
    for (let i = 0; i < 4; i++) {
      const a = R.range(0, TAU),
        e = R.range(-0.9, 0.9),
        d = DROP + R.range(0.012, 0.03);
      const g = sphere(R.range(0.004, 0.009), 8, 5);
      paint(g, mirror);
      b.add(at(g, Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d * 0.8, Math.sin(a) * Math.cos(e) * d));
    }

    b.anchor('core', 0, cy, 0);
    b.light(0, cy, 0, PRIME_ITEMS.mercury.color, 0.7, 3);
    b.emitter('glow', 0, cy, 0, { color: PRIME_ITEMS.mercury.color, size: 0.3 });
    return b.build();
  },
  { kind: 'prime', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// Prime Sulfur: soul without ash. A spray of rhombic bipyramids, the habit native sulfur always
// takes, grown from one point and thrown upward like a flame that set. The tallest points have
// begun to melt into the dark red liquid sulfur becomes, and burn blue; they never get shorter.
// ---------------------------------------------------------------------------------------------
/**
 * A faceted solid along +Y: rings of `sides` corners at [radius, y] stations, the section squashed
 * by xz. Returns the geometry and edge(i, y, out): the position of corner column i at height y.
 */
function bipyramid(stations, { sides = 4, xz = [1, 0.78], yaw = 0 } = {}) {
  const dirs = [];
  for (let i = 0; i < sides; i++) {
    const a = yaw + (i / sides) * TAU;
    dirs.push([Math.cos(a) * xz[0], Math.sin(a) * xz[1]]);
  }
  const rings = stations.map(([r, y]) => dirs.map((d) => [d[0] * r, y, d[1] * r]));
  const faces = [];
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < sides; i++) faces.push([rings[j][i], rings[j][(i + 1) % sides], rings[j + 1][(i + 1) % sides], rings[j + 1][i]]);
  faces.push(rings[0].slice().reverse(), rings[rings.length - 1]);
  const y0 = stations[0][1],
    y1 = stations[stations.length - 1][1];
  const radiusAt = (y) => {
    for (let j = 0; j < stations.length - 1; j++) {
      if (y <= stations[j + 1][1] || j === stations.length - 2) {
        const t = cl((y - stations[j][1]) / (stations[j + 1][1] - stations[j][1]));
        return stations[j][0] + (stations[j + 1][0] - stations[j][0]) * t;
      }
    }
    return 0;
  };
  return { geo: facetSolid(faces, [0, (y0 + y1) / 2, 0]), edge: (i, y, out = 1) => [dirs[i][0] * radiusAt(y) * out, y, dirs[i][1] * radiusAt(y) * out] };
}
/** The sulfur habit: the steep bipyramid, the flatter one that blunts each end, and a small end face. */
const sulfurHabit = (len, rm) => [
  [rm * 0.07, 0],
  [rm * 0.44, len * 0.075],
  [rm, len * 0.5],
  [rm * 0.44, len * 0.925],
  [rm * 0.07, len],
];
/** The same without the blunting: for the small points, which are only eight faces. */
const sulfurPoint = (len, rm) => [
  [0, 0],
  [rm, len * 0.5],
  [0, len],
];

register(
  'prime_sulfur',
  (seed = 1) => {
    const R = new Rng(613 + seed * 11);
    const b = new Builder();
    const DRIP = 0.028; // what hangs below the lowest crystal
    const amber = col('#7c6312'),
      lemon = col('#e6d033'),
      moltenEdge = col('#1f0504'),
      molten = col('#7d1f0a');

    // facets: resinous amber along the edges, lit yellow in the middle of each face. Where a crystal
    // burns it has gone dark, red and wet.
    const paintSulfur = (geo, len, { tone = 0, glow = 0.4, burnTop = 0, burnFoot = 0 } = {}) => {
      const burn = (y) => Math.max(burnTop * sm(0.74, 0.9, y / len), burnFoot * sm(0.16, 0.03, y / len));
      const edge = mixc(amber, '#6a4a0c', tone),
        core = mixc(lemon, '#d3a920', tone);
      return paintCore(
        geo,
        { color: (x, y) => mixc(edge, moltenEdge, burn(y)), emissive: 0.03, rough: (x, y) => 0.3 - 0.2 * burn(y) },
        {
          color: (x, y) => mixc(core, molten, burn(y)),
          emissive: (x, y) => glow * (1 - 0.45 * burn(y)),
          rough: (x, y) => 0.16 - 0.1 * burn(y),
        },
        { mat: MAT.CRYSTAL }
      );
    };
    const shard = (stations, len, dir, root, opts) => {
      const c = bipyramid(stations, { yaw: R.range(0, TAU), xz: [1, R.range(0.7, 0.86)] });
      paintSulfur(c.geo, len, opts);
      const roll = R.range(0, TAU);
      const put = (g) => aim(g, dir, root, roll);
      b.add(put(c.geo));
      return { edge: c.edge, put, len, dir, tip: [root[0] + dir[0] * len, root[1] + dir[1] * len, root[2] + dir[2] * len] };
    };

    // the tallest: nearly upright, standing on its lower point
    const L = 0.268;
    const mainDir = lean(0.05, R.range(0, TAU));
    const main = shard(sulfurHabit(L, 0.042), L, mainDir, [0, DRIP, 0], { glow: 0.45, burnTop: 1, burnFoot: 1 });
    const axis = (y) => [mainDir[0] * y, DRIP + mainDir[1] * y, mainDir[2] * y];

    // the spray: crystals that share its root and lean out of it, each a different height
    const burning = [main];
    const a0 = R.range(0, TAU);
    for (let i = 0; i < 5; i++) {
      const len = [0.225, 0.2, 0.17, 0.21, 0.155][i] * R.range(0.95, 1.05);
      const dir = lean(R.range(0.3, 0.58), a0 + (i / 5) * TAU + R.range(-0.3, 0.3));
      const s = shard(sulfurHabit(len, len * R.range(0.15, 0.175)), len, dir, axis(R.range(0.03, 0.085)), { tone: R.range(0, 0.5), glow: 0.4, burnTop: i < 2 ? 0.85 : 0 });
      if (i < 2) burning.push(s);
    }
    // shorter ones lower down, leaning further
    for (let i = 0; i < 7; i++) {
      const len = R.range(0.08, 0.125);
      const dir = lean(R.range(0.7, 1.25), a0 + 0.6 + (i / 7) * TAU + R.range(-0.35, 0.35));
      const p = axis(R.range(0.07, 0.15));
      shard(sulfurHabit(len, len * R.range(0.16, 0.19)), len, dir, [p[0] + dir[0] * 0.014, p[1] + dir[1] * 0.014, p[2] + dir[2] * 0.014], { tone: R.range(0.1, 0.7), glow: 0.36 });
    }
    // and small points wherever there was room, some of them hanging
    for (let i = 0; i < 11; i++) {
      const len = R.range(0.04, 0.07);
      const dir = lean(i < 5 ? R.range(1.7, 2.3) : R.range(0.5, 1.4), R.range(0, TAU));
      const p = axis(i < 5 ? R.range(0.07, 0.12) : R.range(0.1, 0.19));
      const d = i < 5 ? 0.02 : R.range(0.022, 0.038);
      shard(sulfurPoint(len, len * R.range(0.2, 0.26)), len, dir, [p[0] + dir[0] * d, p[1] + dir[1] * d, p[2] + dir[2] * d], { tone: R.range(0.2, 0.8), glow: 0.3 });
    }

    // what melts runs down the edges and sets again
    const run = { color: '#3f0e06', emissive: 0.12, rough: 0.1, mat: MAT.PLAIN };
    for (const i of [0, 1, 3]) {
      const yTop = L * 0.9,
        yEnd = L * R.range(0.62, 0.74);
      const pts = [];
      for (let k = 0; k <= 4; k++) pts.push(main.edge(i, yTop + (yEnd - yTop) * (k / 4), 1.03));
      const g = tube(pts, (t) => 0.0019 - 0.0005 * t + 0.0026 * sm(0.82, 1, t), 5, { samples: 7 });
      paint(g, run);
      b.add(main.put(g));
    }
    // and gathers at the lowest point, where it hangs
    {
      const g = lathe(
        [
          [0, 0],
          [0.0056, 0.0046],
          [0.0076, 0.0115],
          [0.005, 0.02],
          [0.0034, DRIP * 0.82],
          [0.007, DRIP + 0.009],
        ],
        7
      );
      paint(g, { ...run, color: (v) => mixc('#8a2409', '#4a1006', sm(0, 0.02, v.y)), emissive: (v) => 0.5 - 0.3 * sm(0, 0.02, v.y) });
      b.add(g);
    }

    // the roots of the flame: blue, low, almost too thin to see
    burning.forEach((s, n) => {
      for (let i = 0; i < (n ? 3 : 6); i++) {
        const len = R.range(0.012, 0.03) * (n ? 0.7 : 1);
        const g = spike(R.range(0.003, 0.0052) * (n ? 0.8 : 1), len, 4);
        paint(g, { color: (v) => mixc('#3f63ff', '#2433c8', cl(v.y / len)), emissive: (v) => 2.2 - 1.5 * cl(v.y / len), rough: 0.5, mat: MAT.GLOW });
        // on the end face and a little way down the faces below it
        const back = R.range(0, 0.035);
        const p = [s.tip[0] - s.dir[0] * back, s.tip[1] - s.dir[1] * back, s.tip[2] - s.dir[2] * back];
        const out = back * 0.34;
        const a = R.range(0, TAU);
        b.add(aim(g, [R.range(-0.2, 0.2), 1, R.range(-0.2, 0.2)], [p[0] + Math.cos(a) * out, p[1] - 0.002, p[2] + Math.sin(a) * out], R.range(0, TAU)));
      }
    });

    const core = axis(0.125);
    b.anchor('core', core[0], core[1], core[2]);
    b.anchor('flame', main.tip[0], main.tip[1], main.tip[2]);
    b.light(core[0], core[1] + 0.03, core[2], PRIME_ITEMS.sulfur.color, 0.8, 3);
    b.emitter('glow', core[0], core[1], core[2], { color: PRIME_ITEMS.sulfur.color, size: 0.3 });
    b.emitter('fire', main.tip[0], main.tip[1], main.tip[2], { color: '#4f7cff', size: 0.07 });
    return b.build();
  },
  { kind: 'prime', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// The Stone: blood-red, cut by hand a long time ago. Dark toward the table and the point, and in
// the belly of it a slow fire that some facets show and others swallow.
// ---------------------------------------------------------------------------------------------
register(
  'stone',
  (seed = 1) => {
    const R = new Rng(131 + seed * 5);
    const b = new Builder();
    const N = 10,
      H = 0.12;
    // a ring of corners: radius, height, turned half a step or not, jitter in radius and height
    const ringAt = (r, y, half, jr, jy) => {
      const out = [];
      for (let i = 0; i < N; i++) {
        const a = ((i + (half ? 0.5 : 0)) / N) * TAU;
        const k = 1 + R.range(-jr, jr);
        out.push([Math.cos(a) * r * k + 0.002, y + R.range(-jy, jy), Math.sin(a) * r * k * 0.84]);
      }
      return out;
    };
    const tip = [0.002, 0, 0];
    const P1 = ringAt(0.0215, 0.031, true, 0.06, 0.002);
    const G0 = ringAt(0.0405, 0.0715, false, 0.035, 0);
    const G1 = G0.map((p) => [p[0], p[1] + 0.0055, p[2]]);
    const C1 = ringAt(0.0315, 0.0995, true, 0.05, 0.0015);
    const T = ringAt(0.0165, H, false, 0.05, 0);

    const centre = [0, H * 0.55, 0];
    const fire = (y) => Math.exp(-Math.pow((y - 0.066) / 0.031, 2));
    const facet = (face) => {
      let y = 0;
      for (const p of face) y += p[1] / face.length;
      const f = fire(y);
      const u = R.next();
      let edge, core, e0, e1;
      if (u < 0.17) {
        // a facet that swallows the light
        edge = '#090102';
        core = '#26040a';
        e0 = 0;
        e1 = 0.12 * f;
      } else if (u > 0.78) {
        // a facet that throws it back
        edge = mixc('#3a0509', '#6e0b0e', f);
        core = mixc('#96111a', '#ec3a1e', f);
        e0 = 0.15;
        e1 = 0.6 + 1.7 * f;
      } else {
        edge = '#190205';
        core = mixc('#4c060c', '#a50f17', f);
        e0 = 0.04;
        e1 = 0.2 + 0.95 * f;
      }
      const g = facetSolid([face], centre);
      paintCore(g, { color: edge, emissive: e0, rough: 0.16 }, { color: core, emissive: e1, rough: 0.05 }, { mat: MAT.CRYSTAL });
      b.add(g);
    };
    // a belt of triangles between two rings, one of them turned half a step from the other
    const belt = (lower, upper, lowerIsHalf) => {
      for (let i = 0; i < N; i++) {
        const i1 = (i + 1) % N;
        if (lowerIsHalf) {
          facet([lower[i], upper[i1], upper[i]]);
          facet([lower[i], lower[i1], upper[i1]]);
        } else {
          facet([lower[i], lower[i1], upper[i]]);
          facet([upper[i], lower[i1], upper[i1]]);
        }
      }
    };
    for (let i = 0; i < N; i++) facet([tip, P1[i], P1[(i + 1) % N]]);
    belt(P1, G0, true);
    for (let i = 0; i < N; i++) facet([G0[i], G0[(i + 1) % N], G1[(i + 1) % N], G1[i]]);
    belt(G1, C1, false);
    belt(C1, T, true);
    // the table: a window onto the fire
    {
      const g = facetSolid([T], centre);
      paintCore(g, { color: '#210306', emissive: 0.05, rough: 0.1 }, { color: '#b3161a', emissive: 1.3, rough: 0.04 }, { mat: MAT.CRYSTAL });
      b.add(g);
    }

    b.anchor('core', 0, 0.066, 0);
    b.light(0, 0.066, 0, '#ff2a1a', 0.7, 2.6);
    b.emitter('glow', 0, 0.066, 0, { color: '#ff3a20', size: 0.16 });
    return b.build();
  },
  { kind: 'stone', variants: 1 }
);
