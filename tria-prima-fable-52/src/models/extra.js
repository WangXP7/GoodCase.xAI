// Small world pieces the layout needs that belong to no model family: the broken causeway of
// Quickmere and the basalt stepping stones of the Scar.
import { Builder, Rng, MAT, PAL, paint, box, cyl, xf, noisy, shade, mixc, ao, rock } from './kit.js';
import { register } from './registry.js';

// One pier of the drowned causeway. Origin at the waterline, deck top at y = 0.9, 2.6 m along Z
// (the way you walk), 3 m wide, footing down to y = -7.
register(
  'causeway_pier',
  (seed) => {
    const r = new Rng(seed * 77 + 5);
    const b = new Builder();
    const TOP = 0.9;
    // courses of rough blocks, each a little out of true
    let y = -7;
    let w = 3.5,
      d = 3.1;
    let k = 0;
    while (y < TOP - 0.01) {
      const h = Math.min(TOP - y, r.range(0.55, 0.8));
      const last = y + h >= TOP - 0.01;
      const n = last ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const bw = w / n - 0.03;
        const g = noisy(box(bw, h - 0.02, d - (i % 2) * 0.08, 0.05, 2), 0.035, 1.7, seed * 13 + k * 7 + i, 2);
        const wet = y < 0.25;
        const cc = mixc(PAL.stoneDark, PAL.stone, r.range(0.1, 0.9));
        paint(g, {
          color: (v) => {
            // weed and slime below the tide mark, pale lichen on top
            const wy = v.y + y + h / 2;
            const c = cc.clone();
            if (wy < 0.3) c.lerp(mixc(PAL.moss, '#0c120e', 0.55), Math.min(1, (0.3 - wy) * 2.2));
            else if (v.ny > 0.6) c.lerp(mixc(PAL.lichen, PAL.stoneLight, 0.5), 0.25);
            return c;
          },
          rough: wet ? 0.45 : 0.92,
          mat: MAT.STONE,
        });
        xf(g, { t: [-w / 2 + bw / 2 + i * (w / n) + r.range(-0.03, 0.03), y + h / 2, r.range(-0.04, 0.04)], r: [r.range(-0.012, 0.012), r.range(-0.03, 0.03), r.range(-0.012, 0.012)] });
        b.add(g);
      }
      y += h;
      w = Math.max(3.0, w - 0.09);
      d = Math.max(2.6, d - 0.09);
      k++;
    }
    // what is left of the parapet: a few kerb stones along the sides
    for (const sx of [-1, 1]) {
      let z = -1.2;
      while (z < 1.2) {
        const len = r.range(0.45, 0.8);
        if (r.chance(0.6)) {
          const g = noisy(box(0.3, r.range(0.16, 0.34), len, 0.04, 2), 0.03, 2.2, seed * 31 + k++, 2);
          paint(g, { color: mixc(PAL.stoneDark, PAL.stoneLight, r.range(0.2, 0.7)), rough: 0.95, mat: MAT.STONE });
          xf(g, { t: [sx * 1.33, TOP + 0.1, z + len / 2], r: [0, r.range(-0.1, 0.1), r.range(-0.08, 0.08)] });
          b.add(g);
        }
        z += len + 0.05;
      }
    }
    b.boxCollider(0, (TOP - 7) / 2, 0, 1.5, (TOP + 7) / 2, 1.3);
    b.anchor('top', 0, TOP, 0);
    const m = b.build();
    ao(m.opaque, { ground: -7, height: 1.5, strength: 0.4, under: 0.3 });
    return m;
  },
  { kind: 'structure', variants: 4 }
);

// A knot of basalt columns standing out of the lava. Origin at the lava surface; the walkable
// top is at y = 0.45, about 2.4 m across; the columns go down to y = -5.
register(
  'stepping_stone',
  (seed) => {
    const r = new Rng(seed * 131 + 9);
    const b = new Builder();
    const cells = [[0, 0]];
    const R = 0.52;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      cells.push([Math.cos(a) * R * 1.76, Math.sin(a) * R * 1.76]);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rr = i % 2 ? R * 3.05 : R * 3.5;
      if (r.chance(0.7)) cells.push([Math.cos(a) * rr, Math.sin(a) * rr, 1]);
    }
    for (const [x, z, outer] of cells) {
      const top = outer ? r.range(-0.9, 0.1) : 0.45 - r.range(0, 0.07);
      const h = top + 5;
      const g = cyl(R * 1.0, R * 1.04, h, 6, 1);
      paint(g, {
        color: (v) => {
          // hot at the foot, cold black at the top
          const wy = v.y + top - h / 2;
          const c = mixc(PAL.basalt, PAL.slate, r.range(0, 0.5) * (v.ny > 0.5 ? 1.6 : 1));
          if (wy < 0.5) c.lerp(shade('#ff5a1a', 1), Math.max(0, (0.5 - wy) * 0.5));
          return c;
        },
        emissive: (v) => Math.max(0, 0.3 - (v.y + top - h / 2)) * 1.6,
        rough: 0.72,
        mat: MAT.STONE,
      });
      xf(g, { t: [x, top - h / 2, z], r: [0, r.range(0, 1), 0] });
      b.add(g);
    }
    b.cylCollider(0, 0.45 - 2.75, 0, 1.3, 5.5);
    b.anchor('top', 0, 0.45, 0);
    return b.build();
  },
  { kind: 'structure', variants: 4 }
);

// Rubble ramp where the causeway meets the shore: a tumble of blocks, walkable. 3 m wide,
// 2.6 m along Z, top at y = 0.9 like the piers.
register(
  'causeway_rubble',
  (seed) => {
    const r = new Rng(seed * 51 + 3);
    const b = new Builder();
    for (let i = 0; i < 9; i++) {
      const g = rock(r.range(0.35, 0.7), { seed: seed * 17 + i, detail: 1, rough: 0.16, squash: [1.2, 0.6, 1], facet: true, sink: 0.4 });
      paint(g, { color: mixc(PAL.stoneDark, PAL.stone, r.range(0.1, 0.9)), rough: 0.9, mat: MAT.STONE });
      xf(g, { t: [r.range(-1.6, 1.6), r.range(-0.3, 0.2), r.range(-1.4, 1.4)], r: [r.range(-0.3, 0.3), r.range(0, 6), r.range(-0.3, 0.3)] });
      b.add(g);
    }
    return b.build();
  },
  { kind: 'deco', variants: 4 }
);
