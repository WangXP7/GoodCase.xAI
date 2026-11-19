// Chain-link fence: galvanised posts, top rail, tension wire, mesh panels (alpha pattern in the
// material), three strands of barbed wire on outriggers. Runs are axis-aligned in world space.
import { M, cylUp, cyl, box, rgb, quadUV, torus } from '../build.js';
import { BufferGeometry, BufferAttribute } from 'three';

const CELL = 0.055; // diamond pitch, metres

function meshStrip(points) {
  // points: [{ x, z, top }] along the run; a strip from the ground to each top
  const pos = [], uv = [], nrm = [], idx = [];
  let d = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i) d += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    pos.push(p.x, 0.04, p.z, p.x + (p.lean || 0) * p.nx, p.top, p.z + (p.lean || 0) * p.nz);
    uv.push(d / CELL, 0, d / CELL, p.top / CELL);
    nrm.push(p.nx, 0, p.nz, p.nx, 0, p.nz);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}

// a, b: [x, z] ends. o: { height, gaps: [[d0, d1, { torn: false }?]], sags: [{ at, depth, width }],
// out: +1|-1 (which side the barbed-wire outriggers lean to), wire: bool, gates: [{ at, width }] }
// A gap is torn open (mesh flaps peeled back at its sides) unless it says torn: false (a cut
// opening: the alley's mouth, a gate's frame). A gate is a padlocked, chained pair of leaves in the
// run (where a road would carry on): drawn with its own frame, the run's collider covers it.
export function buildFence(B, a, b, o = {}) {
  const H = o.height ?? 2.4;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
  const nx = -uz * (o.out ?? 1), nz = ux * (o.out ?? 1);
  const gaps = o.gaps || [];
  const sags = o.sags || [];
  const inGap = (d) => gaps.some((g) => d > g[0] + 0.01 && d < g[1] - 0.01);
  const topAt = (d) => {
    let t = H;
    for (const s of sags) { const k = Math.abs(d - s.at) / (s.width / 2); if (k < 1) t -= s.depth * (0.5 + 0.5 * Math.cos(k * Math.PI)); }
    return t;
  };
  const leanAt = (d) => {
    let l = 0;
    for (const s of sags) { const k = Math.abs(d - s.at) / (s.width / 2); if (k < 1) l += 0.35 * (0.5 + 0.5 * Math.cos(k * Math.PI)); }
    return l;
  };
  const at = (d) => [a[0] + ux * d, a[1] + uz * d];
  const yaw = Math.atan2(-uz, ux);

  // stretches between gaps
  const cuts = [0, ...gaps.flatMap((g) => [g[0], g[1]]), len];
  for (let s = 0; s < cuts.length; s += 2) {
    const d0 = cuts[s], d1 = cuts[s + 1];
    if (d1 - d0 < 0.2) continue;
    const nPost = Math.max(1, Math.round((d1 - d0) / 2.6));
    const step = (d1 - d0) / nPost;
    // posts
    for (let i = 0; i <= nPost; i++) {
      const d = d0 + i * step;
      const [x, z] = at(d);
      const top = topAt(d), lean = leanAt(d);
      const tilt = Math.atan2(lean, top);
      const end = i === 0 || i === nPost;
      B.add('paintGalv', cylUp(end ? 0.045 : 0.032, end ? 0.045 : 0.032, top + 0.06, 7), { m: M(x, 0, z, nz * tilt, 0, -nx * tilt), shadow: end });
      if (o.wire !== false && lean < 0.05) B.add('paintGalv', cylUp(0.014, 0.014, 0.42, 4), { m: M(x, top + 0.02, z, nz * 0.7, 0, -nx * 0.7) });
    }
    // mesh, top rail, tension wire: sampled finely where the fence sags
    const pts = [];
    const n = Math.max(1, Math.ceil((d1 - d0) / 0.65));
    for (let i = 0; i <= n; i++) {
      const d = d0 + ((d1 - d0) * i) / n;
      const [x, z] = at(d);
      pts.push({ x, z, top: topAt(d), lean: leanAt(d), nx, nz });
    }
    B.add('uvFence', meshStrip(pts));
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[i + 1];
      const px = p.x + p.lean * nx, pz = p.z + p.lean * nz, qx = q.x + q.lean * nx, qz = q.z + q.lean * nz;
      const l = Math.hypot(qx - px, q.top - p.top, qz - pz);
      const pitch = Math.asin((q.top - p.top) / l);
      const yw = Math.atan2(-(qz - pz), qx - px);
      B.add('paintGalv', cyl(0.021, 0.021, l + 0.01, 6).rotateZ(Math.PI / 2), { m: M((px + qx) / 2, (p.top + q.top) / 2, (pz + qz) / 2, 0, yw, pitch) });
      if (o.wire !== false && p.lean < 0.05 && q.lean < 0.05) {
        for (let k = 0; k < 3; k++) B.add('paintGalv', box(l, 0.008, 0.008), { m: M((p.x + q.x) / 2 + nx * (0.1 + k * 0.1), (p.top + q.top) / 2 + 0.14 + k * 0.1, (p.z + q.z) / 2 + nz * (0.1 + k * 0.1), 0, yw, pitch) });
      }
    }
    const [mx, mz] = at((d0 + d1) / 2);
    B.add('paintGalv', box(d1 - d0, 0.008, 0.008), { m: M(mx, 0.09, mz, 0, yaw, 0) });
    const [x0, z0] = at(d0), [x1, z1] = at(d1);
    B.collide([Math.min(x0, x1) - 0.08, 0, Math.min(z0, z1) - 0.08], [Math.max(x0, x1) + 0.08, H, Math.max(z0, z1) + 0.08], 'metal');
  }
  // Razor wire coiled along the top of each sag, up to the fence's full height: the run's collider is
  // the full height all along, so where the rail has been dragged down the wire fills what it left
  // (nothing invisible stands over a sag, and it is still no way over for the player). Rings every
  // 0.13 m, sized to the drop, centred over the leaning rail, each canted a little either way.
  for (const s of sags) {
    for (let d = s.at - s.width / 2, i = 0; d <= s.at + s.width / 2; d += 0.13, i++) {
      if (d < 0 || d > len || inGap(d)) continue;
      const top = topAt(d), drop = H - top;
      if (drop < 0.08) continue;
      const r = drop / 2, lean = leanAt(d);
      const [x, z] = at(d);
      const off = lean * 0.6;
      B.add('paintGalv', torus(r, 0.006, 3, 14).rotateY(Math.PI / 2), { m: M(x + nx * off, top + r, z + nz * off, 0, yaw, (i % 2 ? 0.22 : -0.22)) });
    }
  }
  // padlocked gates: two framed leaves, a chain round the meeting stiles, the lock
  for (const g of o.gates || []) {
    const half = g.width / 2;
    for (const s of [-1, 1]) {
      const [px, pz] = at(g.at + s * half);
      B.add('paintGalv', cylUp(0.06, 0.06, H + 0.1, 8), { m: M(px, 0, pz), shadow: true }); // gate post
      for (const y of [0.15, H - 0.12]) {
        const [cx, cz] = at(g.at + s * half / 2);
        B.add('paintGalv', cyl(0.025, 0.025, half - 0.06, 6).rotateZ(Math.PI / 2), { m: M(cx, y, cz, 0, yaw, 0) });
      }
      const [sx, sz] = at(g.at + s * 0.04);
      B.add('paintGalv', cylUp(0.025, 0.025, H - 0.1, 6), { m: M(sx, 0.08, sz) }); // meeting stile
    }
    const [mx, mz] = at(g.at);
    for (let i = 0; i < 9; i++) B.add('paintGalv', torus(0.03, 0.008, 4, 8), { m: M(mx + nx * 0.03, 1.1 + i * 0.045, mz + nz * 0.03, i % 2 ? Math.PI / 2 : 0, yaw, 0) });
    B.add('paintGalv', box(0.07, 0.09, 0.035, 0.01, 1), { m: M(mx + nx * 0.06, 1.02, mz + nz * 0.06, 0, yaw, 0) });
  }
  // torn edges: a flap of mesh peeled back at each side of a gap
  for (const g of gaps) {
    if (g[2] && g[2].torn === false) continue;
    for (const [d, dir] of [[g[0], -1], [g[1], 1]]) {
      if (d < 0.3 || d > len - 0.3) continue;
      const [x, z] = at(d);
      const flap = [
        { x, z, top: H * 0.92, nx, nz },
        { x: x - ux * dir * 0.5 + nx * 0.25, z: z - uz * dir * 0.5 + nz * 0.25, top: H * 0.7, nx, nz },
        { x: x - ux * dir * 0.75 + nx * 0.7, z: z - uz * dir * 0.75 + nz * 0.7, top: H * 0.38, nx, nz },
      ];
      B.add('uvFence', meshStrip(flap));
    }
  }
}

// notice wired to the mesh. face: +1 or -1 along the fence normal
export function fenceSign(B, x, z, ry, name, w, h) {
  B.add('atlasLit', quadUV(w, h, B.atlas.uv(name)), { m: M(x, 1.55, z, 0, ry, 0) });
  B.add('vcMatte', box(w + 0.02, h + 0.02, 0.004), { m: M(x, 1.55, z, 0, ry, 0).multiply(M(0, 0, -0.004)), color: rgb(0x8d8f8c) });
}
