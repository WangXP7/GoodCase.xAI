// PLATEAU objects that come as finished 3D models: bridges (brid, LOD2), city furniture (frn, LOD3) and
// vegetation (veg, LOD3). They are triangulated here and written as a static mesh per tile; the bridge
// decks also give the real height of roads and railways that run on them.
import fs from 'node:fs';
import earcut from 'earcut';
import { elements, first, polygons } from './citygml.mjs';

// CityFurniture function code -> colour (sRGB) and whether it stands on the ground.
// 1000s are road markings (we paint our own), 5610 manhole covers.
function furnitureStyle(code) {
  if (code >= 1000 && code < 2000) return null;
  if (code >= 2000 && code < 3000) return [0.82, 0.83, 0.83];      // fences, guard rails, walls
  if (code === 3110) return [0.1, 0.32, 0.62];                      // guide signs (blue)
  if (code >= 3000 && code < 4000) return [0.8, 0.82, 0.84];       // other road signs
  if (code === 4020 || code === 4010) return [0.7, 0.72, 0.72];    // subway entrances, shelters
  if (code === 4200) return [0.45, 0.47, 0.5];                      // lighting
  if (code >= 4800 && code < 4900) return [0.5, 0.5, 0.48];        // poles
  if (code === 4900) return [0.3, 0.32, 0.34];                      // traffic signals
  if (code >= 5600 && code < 5700) return [0.22, 0.22, 0.23];      // manhole covers
  return [0.6, 0.6, 0.6];
}

// One object's polygons ([outer, ...holes] of [lon, lat, h]) -> triangles in world coordinates.
// Returns [[x, y, z] * 3, ny] per triangle (ny: the y of the polygon's unit normal).
function triangulate(polys, project) {
  const out = [];
  for (const rings of polys) {
    const pts = [], holes = [];
    rings.forEach((r, i) => {
      if (i) holes.push(pts.length);
      const n = r.length > 1 && r[0].every((v, k) => Math.abs(v - r.at(-1)[k]) < 1e-9) ? r.length - 1 : r.length;
      for (let k = 0; k < n; k++) { const [x, z] = project(r[k][0], r[k][1]); pts.push([x, r[k][2], z]); }
    });
    if (pts.length < 3) continue;
    // Newell normal of the outline, then earcut in the plane it faces most
    const m = holes[0] ?? pts.length;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < m; i++) { const p = pts[i], q = pts[(i + 1) % m]; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); }
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    nx /= l; ny /= l; nz /= l;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const flat = pts.flatMap((p) => (ay >= ax && ay >= az ? [p[0], p[2]] : ax >= az ? [p[1], p[2]] : [p[0], p[1]]));
    const idx = earcut(flat, holes, 2);
    for (let i = 0; i < idx.length; i += 3) out.push([pts[idx[i]], pts[idx[i + 1]], pts[idx[i + 2]], ny]);
  }
  return out;
}

// Highest height of any upward-facing surface over each 1 m cell: the top of a deck.
export class DeckTops {
  constructor() { this.cells = new Map(); }
  add(a, b, c) {
    const x0 = Math.floor(Math.min(a[0], b[0], c[0])), x1 = Math.floor(Math.max(a[0], b[0], c[0])), z0 = Math.floor(Math.min(a[2], b[2], c[2])), z1 = Math.floor(Math.max(a[2], b[2], c[2]));
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9 || (x1 - x0) * (z1 - z0) > 250000) return;
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const px = i + 0.5, pz = j + 0.5;
      const u = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / d, v = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / d, w = 1 - u - v;
      if (u < -0.02 || v < -0.02 || w < -0.02) continue;
      const y = u * a[1] + v * b[1] + w * c[1], k = i + ',' + j;
      if (!(this.cells.get(k) >= y)) this.cells.set(k, y);
    }
  }
  at(x, z) { return this.cells.get(Math.floor(x) + ',' + Math.floor(z)); }
  // fraction of a polyline's points ([x, y, z, ...]) that lie on a deck
  cover(pts) { let n = 0, c = 0; for (let i = 0; i < pts.length; i += 3) { n++; if (this.at(pts[i], pts[i + 2]) != null) c++; } return n ? c / n : 0; }
}

// Reads every brid / frn / veg file in `dir`. Returns
//   objects  [{ type: 'brid' | 'frn' | 'veg', code, x, z, tris: [{ a, b, c, color }] }]  in world coordinates
//            (code: the CityFurniture function; x, z: the middle of the object)
//   tops     DeckTops over the bridge decks
export function readModels(dir, project, ground) {
  const objects = [], tops = new DeckTops(), seen = new Set(), count = {};
  const files = (type) => fs.readdirSync(dir).filter((f) => new RegExp(`^\\d{8}_${type}(_\\d+)?\\.gml$`).test(f)).sort();
  const each = (type, tag, fn) => {
    for (const f of files(type)) {
      const s = fs.readFileSync(`${dir}/${f}`, 'utf8');
      for (const o of elements(s, tag)) {
        const id = /gml:id="([^"]+)"/.exec(o)?.[1];
        if (seen.has(id)) continue;
        seen.add(id);
        fn(o);
        count[tag] = (count[tag] ?? 0) + 1;
      }
    }
  };
  // lowest and highest point and the middle of a list of triangles
  const extent = (t) => {
    let lo = Infinity, hi = -Infinity, x = 0, z = 0, n = 0;
    for (const [a, b, c] of t) for (const p of [a, b, c]) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); x += p[0]; z += p[2]; n++; }
    return { lo, hi, x: x / n, z: z / n };
  };

  each('brid', 'brid:Bridge', (o) => {
    const t = triangulate(polygons(o), project);
    if (!t.length) return;
    for (const [a, b, c, ny] of t) if (ny > 0.7) tops.add(a, b, c);
    const { x, z } = extent(t);
    objects.push({ type: 'brid', code: 0, x, z, tris: t.map(([a, b, c, ny]) => ({ a, b, c, color: ny > 0.7 ? [0.5, 0.5, 0.5] : [0.63, 0.63, 0.61] })) });
  });

  each('frn', 'frn:CityFurniture', (o) => {
    const code = Number(/<frn:function[^>]*>(\d+)</.exec(o)?.[1] ?? 0), color = furnitureStyle(code);
    if (!color) return;
    const t = triangulate(polygons(first(o, 'frn:lod3Geometry') ?? first(o, 'frn:lod2Geometry') ?? first(o, 'frn:lod1Geometry') ?? ''), project);
    if (!t.length) return;
    const { lo, x, z } = extent(t);
    // Stand it on our ground (or on the bridge deck it is on): the two terrain models differ by a few decimetres.
    const base = tops.at(x, z) ?? ground(x, z), dy = Math.abs(base - lo) < 2.5 ? base + (code >= 5600 && code < 5700 ? 0.17 : 0.1) - lo : 0;
    objects.push({ type: 'frn', code, x, z, tris: t.map(([a, b, c]) => ({ a: [a[0], a[1] + dy, a[2]], b: [b[0], b[1] + dy, b[2]], c: [c[0], c[1] + dy, c[2]], color })) });
  });

  for (const tag of ['veg:SolitaryVegetationObject', 'veg:PlantCover']) each('veg', tag, (o) => {
    const t = triangulate(polygons(first(o, 'veg:lod3Geometry') ?? first(o, 'veg:lod3MultiSurface') ?? ''), project);
    if (!t.length) return;
    const { lo, hi, x, z } = extent(t);
    const dy = Math.abs(ground(x, z) - lo) < 2.5 ? ground(x, z) - lo : 0;
    // darker low down (trunk and shade), lighter towards the top of the crown
    objects.push({ type: 'veg', code: tag === 'veg:PlantCover' ? 1 : 0, x, z, tris: t.map(([a, b, c]) => {
      const k = Math.max(0, Math.min(1, ((a[1] + b[1] + c[1]) / 3 - lo) / (hi - lo || 1)));
      return { a: [a[0], a[1] + dy, a[2]], b: [b[0], b[1] + dy, b[2]], c: [c[0], c[1] + dy, c[2]], color: [0.12 + 0.16 * k, 0.2 + 0.26 * k, 0.09 + 0.08 * k] };
    }) });
  });
  return { objects, tops, count };
}

// Static mesh file: u32 vertex count | f32 x, y, z per vertex | u8 r, g, b per vertex (sRGB).
export function encodeMesh(tris) {
  const n = tris.length * 3, buf = Buffer.alloc(4 + n * 12 + n * 3);
  buf.writeUInt32LE(n, 0);
  let o = 4;
  for (const t of tris) for (const p of [t.a, t.b, t.c]) { buf.writeFloatLE(p[0], o); buf.writeFloatLE(p[1], o + 4); buf.writeFloatLE(p[2], o + 8); o += 12; }
  for (const t of tris) for (let k = 0; k < 3; k++) { buf[o++] = Math.round(t.color[0] * 255); buf[o++] = Math.round(t.color[1] * 255); buf[o++] = Math.round(t.color[2] * 255); }
  return buf;
}
