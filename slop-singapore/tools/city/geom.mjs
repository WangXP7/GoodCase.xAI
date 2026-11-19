// tools/city/geom.mjs — geometry helpers & the raster toolkit shared by every city's geodata build (2-D points [x, z])

const r1 = (x) => Math.round(x * 10) / 10;
function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0, x1, z0, z1 };
}
// Ramer-Douglas-Peucker on an open polyline
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
// RDP on a closed ring (split at the two farthest-apart vertices)
function rdpRing(ring, eps) {
  let i0 = 0;
  let far = 0, i1 = 0;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[i0][0], ring[i][1] - ring[i0][1]);
    if (d > far) { far = d; i1 = i; }
  }
  const a = rdp(ring.slice(i0, i1 + 1), eps);
  const b = rdp([...ring.slice(i1), ring[i0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const centroid = (r) => [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length];

// ---------------------------------------------------------------------------------------------------------------------
// Raster tools (for cutting piers off the shoreline and merging polygons)
// ---------------------------------------------------------------------------------------------------------------------
class Raster {
  constructor(x0, z0, x1, z1, res) {
    this.res = res;
    this.x0 = Math.floor(x0 / res) * res;
    this.z0 = Math.floor(z0 / res) * res;
    this.w = Math.ceil((x1 - this.x0) / res) + 1;
    this.h = Math.ceil((z1 - this.z0) / res) + 1;
    this.d = new Uint8Array(this.w * this.h);
  }
  // Scanline fill of a ring (even-odd) with `val`
  fillRing(ring, val = 1) {
    const { res, x0, z0, w, h, d } = this;
    const bb = bbox(ring);
    const jy0 = Math.max(0, Math.floor((bb.z0 - z0) / res));
    const jy1 = Math.min(h - 1, Math.ceil((bb.z1 - z0) / res));
    const xs = [];
    for (let j = jy0; j <= jy1; j++) {
      const z = z0 + (j + 0.5) * res;
      xs.length = 0;
      for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
        const [xa, za] = ring[k];
        const [xb, zb] = ring[i];
        if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
      }
      xs.sort((p, q) => p - q);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const i0 = Math.max(0, Math.ceil((xs[n] - x0) / res - 0.5));
        const i1 = Math.min(w - 1, Math.floor((xs[n + 1] - x0) / res - 0.5));
        for (let i = i0; i <= i1; i++) d[j * w + i] = val;
      }
    }
  }
  // Squared Euclidean distance (in cells) from every cell to the nearest cell where mask(v) is true (Felzenszwalb)
  edt(isSource) {
    const { w, h, d } = this;
    const INF = 1e20;
    const f = new Float64Array(Math.max(w, h));
    const out = new Float32Array(w * h);
    const v = new Int32Array(Math.max(w, h));
    const zz = new Float64Array(Math.max(w, h) + 1);
    const dt1 = (n, get, set) => {
      for (let q = 0; q < n; q++) f[q] = get(q);
      let k = 0;
      v[0] = 0;
      zz[0] = -INF;
      zz[1] = INF;
      for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= zz[k]) {
          k--;
          s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++;
        v[k] = q;
        zz[k] = s;
        zz[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < n; q++) {
        while (zz[k + 1] < q) k++;
        set(q, (q - v[k]) * (q - v[k]) + f[v[k]]);
      }
    };
    for (let i = 0; i < w * h; i++) out[i] = isSource(d[i]) ? 0 : INF;
    for (let i = 0; i < w; i++) dt1(h, (q) => out[q * w + i], (q, val) => (out[q * w + i] = val));
    for (let j = 0; j < h; j++) dt1(w, (q) => out[j * w + q], (q, val) => (out[j * w + q] = val));
    return out;
  }
  // Morphological opening of the 1-cells with a disc of radius r metres
  open(r) {
    const rc = (r / this.res) ** 2;
    const toWater = this.edt((x) => x === 0);
    const eroded = new Uint8Array(this.d.length);
    for (let i = 0; i < eroded.length; i++) eroded[i] = toWater[i] > rc ? 1 : 0;
    const save = this.d;
    this.d = eroded;
    const toEroded = this.edt((x) => x === 1);
    this.d = save;
    for (let i = 0; i < this.d.length; i++) this.d[i] = this.d[i] && toEroded[i] <= rc + 1e-6 ? 1 : 0;
  }
  // Morphological closing (fills inlets / gaps narrower than 2r)
  close(r) {
    const rc = (r / this.res) ** 2;
    const toLand = this.edt((x) => x === 1);
    const dil = new Uint8Array(this.d.length);
    for (let i = 0; i < dil.length; i++) dil[i] = toLand[i] <= rc ? 1 : 0;
    const save = this.d;
    this.d = dil;
    const toGap = this.edt((x) => x === 0);
    this.d = save;
    for (let i = 0; i < this.d.length; i++) this.d[i] = dil[i] && toGap[i] > rc ? 1 : 0;
  }
  // Keep only the 4-connected component containing the most cells
  keepLargest() {
    const { w, h, d } = this;
    const lab = new Int32Array(w * h);
    let best = 0, bestN = 0, cur = 0;
    const stack = [];
    for (let s = 0; s < w * h; s++) {
      if (!d[s] || lab[s]) continue;
      cur++;
      let n = 0;
      stack.push(s);
      lab[s] = cur;
      while (stack.length) {
        const p = stack.pop();
        n++;
        const i = p % w, j = (p - i) / w;
        if (i > 0 && d[p - 1] && !lab[p - 1]) { lab[p - 1] = cur; stack.push(p - 1); }
        if (i < w - 1 && d[p + 1] && !lab[p + 1]) { lab[p + 1] = cur; stack.push(p + 1); }
        if (j > 0 && d[p - w] && !lab[p - w]) { lab[p - w] = cur; stack.push(p - w); }
        if (j < h - 1 && d[p + w] && !lab[p + w]) { lab[p + w] = cur; stack.push(p + w); }
      }
      if (n > bestN) { bestN = n; best = cur; }
    }
    for (let i = 0; i < w * h; i++) d[i] = lab[i] === best ? 1 : 0;
  }
  // Outer boundary of the (single) region as a ring of cell-corner points (Moore-neighbour style edge walk)
  traceOuter() {
    const { w, h, d, res, x0, z0 } = this;
    const at = (i, j) => (i >= 0 && j >= 0 && i < w && j < h ? d[j * w + i] : 0);
    // Directed boundary edges keep land on the left: start at the first land cell's top edge
    let si = -1, sj = -1;
    outer: for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (at(i, j)) { si = i; sj = j; break outer; }
    // Walk corners: position (cx, cz) in corner coordinates, direction index 0:+x 1:+z 2:-x 3:-z
    const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
    let cx = si, cz = sj, dir = 0; // top edge of cell (si, sj), walking +x with land below (on the right in screen, z down)
    const pts = [];
    const start = `${cx},${cz},${dir}`;
    let guard = 0;
    // For a corner walk with land on the right (z down means right = +z side when walking +x):
    // cells around corner (cx, cz): A=(cx-1,cz-1) B=(cx,cz-1) C=(cx-1,cz) D=(cx,cz)
    do {
      pts.push([x0 + cx * res, z0 + cz * res]);
      cx += DX[dir];
      cz += DZ[dir];
      // Cells ahead-left and ahead-right relative to the walking direction
      const cellAt = (dxl, dzl) => at(cx + dxl, cz + dzl);
      // Determine the cells: for each direction, the two cells in front of the corner
      let left, right;
      if (dir === 0) { left = cellAt(0, -1); right = cellAt(0, 0); }
      else if (dir === 1) { left = cellAt(0, 0); right = cellAt(-1, 0); }
      else if (dir === 2) { left = cellAt(-1, 0); right = cellAt(-1, -1); }
      else { left = cellAt(-1, -1); right = cellAt(0, -1); }
      if (left && right) dir = (dir + 3) % 4; // turn left (land ahead): keep land on the right
      else if (!left && right) { /* straight */ }
      else dir = (dir + 1) % 4; // turn right
      if (++guard > 50000000) throw new Error('trace runaway');
    } while (`${cx},${cz},${dir}` !== start);
    // Merge collinear runs, then take edge midpoints (turns the raster's stairs into 45° runs before simplifying)
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i + pts.length - 1) % pts.length], q = pts[i], n = pts[(i + 1) % pts.length];
      if ((q[0] - p[0]) * (n[1] - q[1]) - (q[1] - p[1]) * (n[0] - q[0]) !== 0) out.push(q);
    }
    return out.map((q, i) => {
      const n = out[(i + 1) % out.length];
      return [(q[0] + n[0]) / 2, (q[1] + n[1]) / 2];
    });
  }
}

// 4-connected components of the non-zero cells of a w x h mask: labels (1..n, 0 = background) and, per component,
// its cell count, cell bbox and first cell
function labelComponents(D, W, H) {
  const lab = new Int32Array(W * H);
  const comps = [];
  const stack = new Int32Array(W * H > 4e7 ? 4e7 : W * H);
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!D[s0] || lab[s0]) continue;
    const id = comps.length + 1;
    let sp = 0, n = 0, i0 = W, i1 = -1, j0 = H, j1 = -1;
    stack[sp++] = s0;
    lab[s0] = id;
    while (sp) {
      const p = stack[--sp];
      n++;
      const i = p % W, j = (p - i) / W;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
      if (i > 0 && D[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (i < W - 1 && D[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (j > 0 && D[p - W] && !lab[p - W]) { lab[p - W] = id; stack[sp++] = p - W; }
      if (j < H - 1 && D[p + W] && !lab[p + W]) { lab[p + W] = id; stack[sp++] = p + W; }
    }
    comps.push({ id, n, i0, i1, j0, j1, start: s0 });
  }
  return { lab, comps };
}

// Contour of one labelled component (corner walk keeping the component on the right, as Raster.traceOuter), as the
// corner points where the walk turns
function traceLabel(lab, W, H, c, x0, z0, res) {
  const at = (i, j) => (i >= 0 && j >= 0 && i < W && j < H && lab[j * W + i] === c.id ? 1 : 0);
  const si = c.start % W, sj = (c.start - si) / W;
  const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
  let cx = si, cz = sj, dir = 0;
  const pts = [];
  const start = cx + ',' + cz + ',' + dir;
  let guard = 0;
  do {
    pts.push([x0 + cx * res, z0 + cz * res]);
    cx += DX[dir];
    cz += DZ[dir];
    let left, right;
    if (dir === 0) { left = at(cx, cz - 1); right = at(cx, cz); }
    else if (dir === 1) { left = at(cx, cz); right = at(cx - 1, cz); }
    else if (dir === 2) { left = at(cx - 1, cz); right = at(cx - 1, cz - 1); }
    else { left = at(cx - 1, cz - 1); right = at(cx, cz - 1); }
    if (left && right) dir = (dir + 3) % 4;
    else if (!right) dir = (dir + 1) % 4;
    if (++guard > 4e6) break;
  } while (cx + ',' + cz + ',' + dir !== start);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i + pts.length - 1) % pts.length], q = pts[i], n = pts[(i + 1) % pts.length];
    if ((q[0] - p[0]) * (n[1] - q[1]) - (q[1] - p[1]) * (n[0] - q[0]) !== 0) out.push(q);
  }
  return out;
}

// Raster stairs -> lines: short edges (stair steps) are replaced by their midpoints, vertices between two long edges
// (true corners) are kept
function destair(out, short) {
  const n = out.length;
  const len = (i) => { const a = out[i], b = out[(i + 1) % n]; return Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]); };
  const res = [];
  for (let i = 0; i < n; i++) {
    const prevLong = len((i + n - 1) % n) > short;
    const nextLong = len(i) > short;
    if (prevLong && nextLong) res.push(out[i]);
    if (!nextLong) { const a = out[i], b = out[(i + 1) % n]; res.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
  }
  return res;
}

export { r1, ringArea, bbox, rdp, rdpRing, pointInRing, centroid, Raster, labelComponents, traceLabel, destair };
