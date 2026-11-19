// tools/city/blocks.mjs — city blocks ("curb islands") from the street network: every at-grade roadway rasterised at its
// curb-to-curb width over the buildable land, then labelling what's left. Each block: curb outline polygon, axis-aligned
// lot rects inside its property line (curb minus sidewalk), frontage frames for islands fronting streets off the grid.
import { Raster, labelComponents, traceLabel, destair, rdpRing, ringArea, bbox } from './geom.mjs';


// --- Greedy axis-aligned lot rects in a component's property region (largest rectangle in a histogram) ---------------
// maskRects: on a w x h 0/1 mask (cleared as it goes), up to maxRects rects [i0, i1, j0, j1] (cells, inclusive) of at
// least minSide x minSide cells and 120 cells, until 93% of the mask is covered
function maskRects(m, w, h, maxRects = 8, minSide = 8) {
  let total = 0;
  for (let k = 0; k < w * h; k++) total += m[k];
  const rects = [];
  const hist = new Int32Array(w);
  const stack = new Int32Array(w + 1);
  let covered = 0;
  for (let it = 0; it < maxRects; it++) {
    hist.fill(0);
    let best = 0, bi0 = 0, bi1 = 0, bj0 = 0, bj1 = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) hist[i] = m[j * w + i] ? hist[i] + 1 : 0;
      let sp = 0;
      for (let i = 0; i <= w; i++) {
        const hh = i < w ? hist[i] : 0;
        while (sp && hist[stack[sp - 1]] >= hh) {
          const top = stack[--sp];
          const height = hist[top];
          const left = sp ? stack[sp - 1] + 1 : 0;
          const width = i - left;
          // lots need some depth both ways: penalise slivers
          if (height >= minSide && width >= minSide) {
            const area = height * width;
            if (area > best) { best = area; bi0 = left; bi1 = i - 1; bj0 = j - height + 1; bj1 = j; }
          }
        }
        stack[sp++] = i;
      }
    }
    if (best < 120 || (rects.length && best < total * 0.06)) break;
    rects.push([bi0, bi1, bj0, bj1]);
    covered += best;
    for (let j = bj0; j <= bj1; j++) for (let i = bi0; i <= bi1; i++) m[j * w + i] = 0;
    if (covered > total * 0.93) break;
  }
  return { rects, total, covered };
}

// --- Frontage frames of irregular islands (Lower Manhattan, Broadway's diagonals...) ---------------------------------
// The street directions an island fronts: its outline's edge directions modulo 90°, length-weighted, in up to 3
// clusters ±7° wide. Every island cell joins the cluster of its nearest outline edge; each cluster's cells are then
// re-rasterised in a frame turned to its direction, eroded by the sidewalk width there (so a diagonal property line
// sits exactly SIDEWALK in from its curb) and covered with lot rects in that frame, which buildings.js fills like a
// grid block and turns back into place. Returns [[θ, px, pz, rects], ...] with world = p + R_y(θ)·(local − p)
// (three.js rotation about +y), or null for an island fronting the grid alone.
const DEG = Math.PI / 180;
const wrap90 = (a) => ((((a + Math.PI / 4) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)) - Math.PI / 4;

// The nearest of `edges` ({ ax, az, bx, bz, L }) to a point in the w x h box at (x0, z0): a ring-by-ring search outwards
// over 16 m buckets of the edges, returning the same edge as testing them all in order (the first of the nearest)
const BUCKET = 16;
function nearestEdgeSearch(edges, x0, z0, w, h) {
  const gx0 = x0 - BUCKET, gz0 = z0 - BUCKET;
  const gw = Math.ceil(w / BUCKET) + 3, gh = Math.ceil(h / BUCKET) + 3;
  const clampI = (v) => (v < 0 ? 0 : v >= gw ? gw - 1 : v);
  const clampJ = (v) => (v < 0 ? 0 : v >= gh ? gh - 1 : v);
  const buckets = Array.from({ length: gw * gh }, () => []);
  edges.forEach((e, n) => {
    const i0 = clampI(Math.floor((Math.min(e.ax, e.bx) - gx0) / BUCKET)), i1 = clampI(Math.floor((Math.max(e.ax, e.bx) - gx0) / BUCKET));
    const j0 = clampJ(Math.floor((Math.min(e.az, e.bz) - gz0) / BUCKET)), j1 = clampJ(Math.floor((Math.max(e.az, e.bz) - gz0) / BUCKET));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * gw + i].push(n);
  });
  return (px, pz) => {
    const bi = clampI(Math.floor((px - gx0) / BUCKET)), bj = clampJ(Math.floor((pz - gz0) / BUCKET));
    let bd = Infinity, bn = -1;
    for (let r = 0; r <= gw + gh; r++) {
      for (let j = bj - r; j <= bj + r; j++) {
        if (j < 0 || j >= gh) continue;
        const edgeRow = j === bj - r || j === bj + r;
        for (let i = bi - r; i <= bi + r; i += edgeRow ? 1 : 2 * r) {
          if (i < 0 || i >= gw) continue;
          for (const n of buckets[j * gw + i]) {
            const e = edges[n];
            const dx = e.bx - e.ax, dz = e.bz - e.az;
            let t = ((px - e.ax) * dx + (pz - e.az) * dz) / (e.L * e.L);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = e.ax + t * dx - px, ez = e.az + t * dz - pz;
            const d = ex * ex + ez * ez;
            if (d < bd || (d === bd && n < bn)) { bd = d; bn = n; }
          }
        }
      }
      // every bucket of a farther ring lies more than r buckets away
      if (bd < (r * BUCKET) ** 2) break;
    }
    return bn;
  };
}

// Blocks of the land inside [x0, x1] x [z0, z1]: `fillLand(R)` sets the buildable cells of the res-metre raster R to 1,
// `roads` are capsules { x0, z0, x1, z1, r } (r: half the curb-to-curb width) cut out of it, `sidewalk` the property line's
// distance in from the curb. Returns the blocks, the raster and its labels (block.label) for later per-block lookups.
// With `lawns`, every block also gets the outlines of the land inside its property line (block.lawns: rings).
export function extractBlocks({ x0: X0, z0: Z0, x1: X1, z1: Z1, res: RES = 1, sidewalk: SIDEWALK, fillLand, roads, lawns = false, log = () => {} }) {
  const R = new Raster(X0, Z0, X1, Z1, RES);
  fillLand(R);
  const W = R.w, H = R.h, D = R.d;
  // Stamp each roadway as a capsule
  for (const s of roads) {
    const ix0 = Math.max(0, Math.floor((Math.min(s.x0, s.x1) - s.r - R.x0) / RES));
    const ix1 = Math.min(W - 1, Math.ceil((Math.max(s.x0, s.x1) + s.r - R.x0) / RES));
    const iz0 = Math.max(0, Math.floor((Math.min(s.z0, s.z1) - s.r - R.z0) / RES));
    const iz1 = Math.min(H - 1, Math.ceil((Math.max(s.z0, s.z1) + s.r - R.z0) / RES));
    if (ix0 > ix1 || iz0 > iz1) continue;
    const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
    const L2 = dx * dx + dz * dz || 1e-9;
    const r2 = s.r * s.r;
    for (let j = iz0; j <= iz1; j++) {
      const pz = R.z0 + (j + 0.5) * RES;
      for (let i = ix0; i <= ix1; i++) {
        const k = j * W + i;
        if (!D[k]) continue;
        const px = R.x0 + (i + 0.5) * RES;
        let t = ((px - s.x0) * dx + (pz - s.z0) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = s.x0 + t * dx - px, ez = s.z0 + t * dz - pz;
        if (ex * ex + ez * ez <= r2) D[k] = 0;
      }
    }
  }

  // --- Label curb islands (4-connected) --------------------------------------------------------------------------------
  const { lab, comps } = labelComponents(D, W, H);
  log(`${comps.length} curb islands labelled`);

  // --- Contour of one component -----------------------------------------------------------------------------------------
  const traceComponent = (c) => destair(traceLabel(lab, W, H, c, R.x0, R.z0, RES), RES * 1.5);

  // --- Property line: square erosion of each island by the sidewalk width (keeps grid blocks rectangular) -------------
  const ER = Math.round(SIDEWALK / RES);
  const prop = new Uint8Array(W * H);
  {
    // erosion along x then z with running counts of non-matching cells (same label required)
    const tmp = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) {
      const row = j * W;
      let run = 0; // consecutive same-label cells ending at i
      const left = new Int32Array(W), right = new Int32Array(W);
      for (let i = 0; i < W; i++) {
        const L = lab[row + i];
        run = L && i > 0 && lab[row + i - 1] === L ? run + 1 : L ? 1 : 0;
        left[i] = run;
      }
      run = 0;
      for (let i = W - 1; i >= 0; i--) {
        const L = lab[row + i];
        run = L && i < W - 1 && lab[row + i + 1] === L ? run + 1 : L ? 1 : 0;
        right[i] = run;
      }
      for (let i = 0; i < W; i++) tmp[row + i] = lab[row + i] && left[i] > ER && right[i] > ER ? 1 : 0;
    }
    const up = new Int32Array(H), dn = new Int32Array(H);
    for (let i = 0; i < W; i++) {
      let run = 0;
      for (let j = 0; j < H; j++) {
        const k = j * W + i, L = lab[k];
        run = L && j > 0 && lab[k - W] === L ? run + 1 : L ? 1 : 0;
        up[j] = run;
      }
      run = 0;
      for (let j = H - 1; j >= 0; j--) {
        const k = j * W + i, L = lab[k];
        run = L && j < H - 1 && lab[k + W] === L ? run + 1 : L ? 1 : 0;
        dn[j] = run;
      }
      for (let j = 0; j < H; j++) prop[j * W + i] = tmp[j * W + i] && up[j] > ER && dn[j] > ER ? 1 : 0;
    }
  }

  function lotRects(c, maxRects = 8) {
    const w = c.i1 - c.i0 + 1, h = c.j1 - c.j0 + 1;
    const m = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (c.j0 + j) * W + c.i0 + i;
      if (prop[k] && lab[k] === c.id) m[j * w + i] = 1;
    }
    const { rects, total, covered } = maskRects(m, w, h, maxRects);
    return {
      rects: rects.map(([i0, i1, j0, j1]) => [R.x0 + (c.i0 + i0) * RES, R.x0 + (c.i0 + i1 + 1) * RES, R.z0 + (c.j0 + j0) * RES, R.z0 + (c.j0 + j1 + 1) * RES]),
      propArea: total,
      covered
    };
  }

  function blockFrames(c, poly) {
    const edges = [];
    let per = 0;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      edges.push({ ax, az, bx, bz, L, phi: wrap90(Math.atan2(bz - az, bx - ax)), k: -1 });
      per += L;
    }
    const clusters = [];
    for (let n = 0; n < 3; n++) {
      let seed = null, seedW = 0;
      for (const e of edges) {
        if (e.k >= 0 || e.L < 4) continue;
        let w = 0;
        for (const f of edges) if (f.k < 0 && Math.abs(wrap90(f.phi - e.phi)) <= 7 * DEG) w += f.L;
        if (w > seedW) { seedW = w; seed = e; }
      }
      if (!seed || seedW < 14 || (n > 0 && seedW < per * 0.12)) break;
      const members = edges.filter((f) => f.k < 0 && Math.abs(wrap90(f.phi - seed.phi)) <= 7 * DEG);
      let sx = 0, sy = 0;
      for (const f of members) { sx += f.L * Math.cos(4 * f.phi); sy += f.L * Math.sin(4 * f.phi); }
      for (const f of members) f.k = clusters.length;
      clusters.push({ phi: Math.atan2(sy, sx) / 4 });
    }
    if (!clusters.length || (clusters.length === 1 && Math.abs(clusters[0].phi) < 2 * DEG)) return null;
    for (const e of edges) {
      if (e.k >= 0) continue;
      let bd = Infinity;
      clusters.forEach((cl, k) => { const d = Math.abs(wrap90(e.phi - cl.phi)); if (d < bd) { bd = d; e.k = k; } });
    }

    // Island cells -> cluster of the nearest outline edge
    const w = c.i1 - c.i0 + 1, h = c.j1 - c.j0 + 1;
    const owner = new Int8Array(w * h).fill(-1);
    const nearest = clusters.length > 1 ? nearestEdgeSearch(edges, R.x0 + c.i0 * RES, R.z0 + c.j0 * RES, w * RES, h * RES) : null;
    for (let j = 0; j < h; j++) {
      const pz = R.z0 + (c.j0 + j + 0.5) * RES;
      for (let i = 0; i < w; i++) {
        if (lab[(c.j0 + j) * W + c.i0 + i] !== c.id) continue;
        if (!nearest) { owner[j * w + i] = 0; continue; }
        owner[j * w + i] = edges[nearest(R.x0 + (c.i0 + i + 0.5) * RES, pz)].k;
      }
    }

    const px = R.x0 + ((c.i0 + c.i1 + 1) * RES) / 2;
    const pz = R.z0 + ((c.j0 + c.j1 + 1) * RES) / 2;
    // Each cluster's frame: the island re-rasterised turned to the cluster's direction, eroded by the sidewalk width
    // there (`prop`, square runs along u then v) and its own region (`reg`)
    const views = clusters.map((cl, k) => {
      const th = -cl.phi; // local +x (u) runs along the cluster's edges
      const cs = Math.cos(th), sn = Math.sin(th);
      // local bbox of the island's world bbox
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const [x, z] of [[c.i0, c.j0], [c.i1 + 1, c.j0], [c.i0, c.j1 + 1], [c.i1 + 1, c.j1 + 1]]) {
        const dx = R.x0 + x * RES - px, dz = R.z0 + z * RES - pz;
        const u = px + dx * cs - dz * sn, v = pz + dx * sn + dz * cs; // R_y(-θ)
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      u0 = Math.floor(u0); v0 = Math.floor(v0);
      const lw = Math.ceil(u1 - u0) + 1, lh = Math.ceil(v1 - v0) + 1;
      const isl = new Uint8Array(lw * lh);
      const reg = new Uint8Array(lw * lh);
      const cell = new Int32Array(lw * lh).fill(-1); // island cell (index into the block's w x h raster) under each local cell
      for (let j = 0; j < lh; j++) {
        const dv = v0 + j + 0.5 - pz;
        for (let i = 0; i < lw; i++) {
          const du = u0 + i + 0.5 - px;
          const x = px + du * cs + dv * sn, z = pz - du * sn + dv * cs; // R_y(θ)
          const gi = Math.floor((x - R.x0) / RES) - c.i0, gj = Math.floor((z - R.z0) / RES) - c.j0;
          if (gi < 0 || gj < 0 || gi >= w || gj >= h) continue;
          const o = owner[gj * w + gi];
          if (o < 0) continue;
          isl[j * lw + i] = 1;
          cell[j * lw + i] = gj * w + gi;
          if (o === k) reg[j * lw + i] = 1;
        }
      }
      const tmp = new Uint8Array(lw * lh);
      for (let j = 0; j < lh; j++) {
        let run = 0;
        const left = new Int32Array(lw);
        for (let i = 0; i < lw; i++) { run = isl[j * lw + i] ? run + 1 : 0; left[i] = run; }
        run = 0;
        for (let i = lw - 1; i >= 0; i--) { run = isl[j * lw + i] ? run + 1 : 0; tmp[j * lw + i] = left[i] > ER && run > ER ? 1 : 0; }
      }
      const prop = new Uint8Array(lw * lh);
      for (let i = 0; i < lw; i++) {
        let run = 0;
        const up = new Int32Array(lh);
        for (let j = 0; j < lh; j++) { run = isl[j * lw + i] ? run + 1 : 0; up[j] = run; }
        run = 0;
        for (let j = lh - 1; j >= 0; j--) {
          run = isl[j * lw + i] ? run + 1 : 0;
          prop[j * lw + i] = tmp[j * lw + i] && up[j] > ER && run > ER ? 1 : 0;
        }
      }
      return { th, u0, v0, lw, lh, prop, reg, cell, rects: [] };
    });
    // Pass 1: each cluster's lots inside its own region. Pass 2: corner wedges & seams no region's lots reached, from
    // any frame. Island cells under a lot, grown by a cell (the frames sample the raster at different angles), can't be
    // built on twice.
    const used = new Uint8Array(w * h);
    const markUsed = (k) => {
      const gi = k % w, gj = (k - gi) / w;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = gi + di, j = gj + dj;
        if (i >= 0 && j >= 0 && i < w && j < h) used[j * w + i] = 1;
      }
    };
    for (const pass of [1, 2]) {
      for (const vw of views) {
        const { lw, lh, prop, reg, cell } = vw;
        const m = new Uint8Array(lw * lh);
        for (let k = 0; k < lw * lh; k++) m[k] = prop[k] && (pass === 2 || reg[k]) && cell[k] >= 0 && !used[cell[k]] ? 1 : 0;
        const { rects } = maskRects(m, lw, lh, pass === 1 ? 6 : 4, 12);
        for (const [i0, i1, j0, j1] of rects) {
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (cell[j * lw + i] >= 0) markUsed(cell[j * lw + i]);
          vw.rects.push([vw.u0 + i0, vw.u0 + i1 + 1, vw.v0 + j0, vw.v0 + j1 + 1]);
        }
      }
    }
    const frames = views.filter((vw) => vw.rects.length).map((vw) => [vw.th, px, pz, vw.rects]);
    return frames.length ? frames : null;
  }

  // --- Assemble blocks ---------------------------------------------------------------------------------------------------
  const blocks = [];
  let small = 0;
  for (const c of comps) {
    const area = c.n * RES * RES;
    if (area < 40) { small++; continue; }
    let poly = traceComponent(c);
    poly = rdpRing(poly, 0.5);
    if (poly.length < 3) continue;
    if (ringArea(poly) > 0) poly.reverse();
    const bw = (c.i1 - c.i0 + 1) * RES, bd = (c.j1 - c.j0 + 1) * RES;
    const rectness = area / (bw * bd);
    const { rects, propArea, covered } = area >= 300 ? lotRects(c) : { rects: [], propArea: 0, covered: 0 };
    const frames = rectness <= 0.985 && area >= 300 ? blockFrames(c, poly) : null;
    blocks.push({
      id: blocks.length,
      label: c.id,
      poly,
      area: Math.round(area),
      bbox: [R.x0 + c.i0 * RES, R.x0 + (c.i1 + 1) * RES, R.z0 + c.j0 * RES, R.z0 + (c.j1 + 1) * RES],
      rect: rectness > 0.985,
      rects,
      frames,
      fill: propArea ? Math.round((covered / propArea) * 100) / 100 : 0
    });
  }
  if (lawns) {
    // the property regions' outlines, by the block they lie in (each region a 4-connected component of `prop`)
    const regions = labelComponents(prop, W, H);
    const byLabel = new Map(blocks.map((b) => [b.label, b]));
    for (const b of blocks) b.lawns = [];
    for (const c of regions.comps) {
      if (c.n * RES * RES < 20) continue;
      const b = byLabel.get(lab[c.start]);
      if (!b) continue;
      let ring = rdpRing(destair(traceLabel(regions.lab, W, H, c, R.x0, R.z0, RES), RES * 1.5), 0.6);
      if (ring.length < 3) continue;
      if (ringArea(ring) > 0) ring.reverse();
      b.lawns.push(ring);
    }
  }
  log(`${blocks.length} blocks (${blocks.filter((b) => b.rect).length} rectangular, ${blocks.filter((b) => !b.rects.length).length} without lots); ${small} specks dropped`);
  log(`${blocks.filter((b) => b.frames).length} irregular blocks with frontage frames (${blocks.reduce((t, b) => t + (b.frames ? b.frames.length : 0), 0)} frames)`);
  return { blocks, raster: R, labels: lab };
}

// Park land over the blocks: each block's covered share (b.park, 0..1, by scanline-filling every park ring over the block
// raster R / labels lab) and the park covering most of it (b.parkName, when it covers over a quarter of the block).
// `parks`: [{ name, rings }]; `labelOf(b)`: the block's raster label
export function parkCoverage(blocks, R, lab, parks, labelOf = (b) => b.label) {
  const W = R.w, H = R.h;
  const byLab = new Map(blocks.map((b) => [labelOf(b), b]));
  const parkOf = new Map(); // block -> { name, cells }
  for (const pk of parks) {
    for (const ring of pk.rings) {
      const bb = bbox(ring);
      const j0 = Math.max(0, Math.floor((bb.z0 - R.z0) / R.res)), j1 = Math.min(H - 1, Math.ceil((bb.z1 - R.z0) / R.res));
      const counts = new Map();
      const xs = [];
      for (let j = j0; j <= j1; j++) {
        const z = R.z0 + (j + 0.5) * R.res;
        xs.length = 0;
        for (let a = 0, k = ring.length - 1; a < ring.length; k = a++) {
          const [xa, za] = ring[k], [xb, zb] = ring[a];
          if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
        }
        xs.sort((p, q) => p - q);
        for (let n = 0; n + 1 < xs.length; n += 2) {
          const i0 = Math.max(0, Math.ceil((xs[n] - R.x0) / R.res - 0.5)), i1 = Math.min(W - 1, Math.floor((xs[n + 1] - R.x0) / R.res - 0.5));
          for (let i = i0; i <= i1; i++) {
            const L = lab[j * W + i];
            if (L) counts.set(L, (counts.get(L) || 0) + 1);
          }
        }
      }
      for (const [L, n] of counts) {
        const b = byLab.get(L);
        if (!b) continue;
        b.parkCells = (b.parkCells || 0) + n;
        const prev = parkOf.get(b);
        if (!prev || n > prev.cells) parkOf.set(b, { name: pk.name, cells: n });
      }
    }
  }
  for (const b of blocks) {
    b.park = b.parkCells ? Math.min(1, Math.round((b.parkCells / b.area) * 100) / 100) : 0;
    const po = parkOf.get(b);
    if (po && b.park > 0.25) b.parkName = po.name;
    delete b.parkCells;
  }
}
