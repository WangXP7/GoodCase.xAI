// Minimal PLATEAU CityGML reader. The files are large (30–100 MB) but regular, so plain string
// scanning is fast and has no dependencies. Coordinates are EPSG:6697: latitude, longitude, TP height.
import fs from 'node:fs';
import { AREA } from '../../src/shared/tileformat.js';

// Yields the text of every <tag ...>...</tag> element in `s` (non-nested tags only).
export function* elements(s, tag, from = 0, to = s.length) {
  const open = `<${tag}`, close = `</${tag}>`;
  let i = s.indexOf(open, from);
  while (i !== -1 && i < to) {
    const after = s.charCodeAt(i + open.length);
    if (after !== 32 && after !== 62 && after !== 9 && after !== 10 && after !== 13) { i = s.indexOf(open, i + 1); continue; }
    const j = s.indexOf(close, i);
    if (j === -1 || j > to) return;
    yield s.slice(i, j + close.length);
    i = s.indexOf(open, j);
  }
}
export const first = (s, tag) => { for (const e of elements(s, tag)) return e; return null; };
const text = (s, tag) => {
  const e = first(s, tag);
  return e ? e.slice(e.indexOf('>') + 1, e.lastIndexOf('<')).trim() : null;
};
const num = (v) => (v == null || v === '' ? null : Number(v));

function posList(s) {
  const a = s.slice(s.indexOf('>') + 1, s.lastIndexOf('<')).trim().split(/\s+/).map(Number);
  const pts = [];
  for (let i = 0; i + 2 < a.length; i += 3) pts.push([a[i + 1], a[i], a[i + 2]]); // -> [lon, lat, h]
  return pts;
}

// Every gml:Polygon inside `s` as [outer, ...holes], each ring [[lon, lat, h], ...].
export function polygons(s) {
  const out = [];
  if (!s) return out;
  for (const poly of elements(s, 'gml:Polygon')) {
    const ext = first(poly, 'gml:exterior');
    if (!ext) continue;
    const outer = first(ext, 'gml:posList');
    if (!outer) continue;
    const rings = [posList(outer)];
    for (const int of elements(poly, 'gml:interior')) {
      const pl = first(int, 'gml:posList');
      if (pl) rings.push(posList(pl));
    }
    out.push(rings);
  }
  return out;
}

// Like polygons(), with the photo texture of each: { rings, image, uv: [[u, v, ...] per ring] } (image and
// uv null where the polygon has none). tex: ring id -> { image, uv }.
function texturedPolygons(s, tex) {
  const out = [];
  for (const poly of elements(s, 'gml:Polygon')) {
    const rings = [], uv = [];
    let image = null, ok = true;
    for (const tag of ['gml:exterior', 'gml:interior']) for (const r of elements(poly, tag)) {
      const pl = first(r, 'gml:posList');
      if (!pl) continue;
      const pts = posList(pl), t = tex.get(/<gml:LinearRing gml:id="([^"]+)"/.exec(r)?.[1]);
      rings.push(pts);
      if (t && t.uv.length === pts.length * 2 && (image == null || image === t.image)) { image = t.image; uv.push(t.uv); } else ok = false;
    }
    if (rings.length) out.push(ok ? { rings, image, uv } : { rings, image: null, uv: null });
  }
  return out;
}

export function readBuildings(file) {
  const s = fs.readFileSync(file, 'utf8');
  const out = [];
  // appearance: ring id -> { image, uv } for the roof and wall photos (texture coordinates from the bottom left)
  const tex = new Map();
  for (const t of elements(s, 'app:ParameterizedTexture')) {
    const image = text(t, 'app:imageURI');
    if (!/(Roof|Wall)SurfaceTexture/.test(image ?? '')) continue;
    for (const m of t.matchAll(/<app:textureCoordinates ring="#([^"]+)">([^<]*)</g)) tex.set(m[1], { image, uv: m[2].trim().split(/\s+/).map(Number) });
  }
  for (const b of elements(s, 'bldg:Building')) {
    const id = /gml:id="([^"]+)"/.exec(b)?.[1];
    const solid = polygons(first(b, 'bldg:lod1Solid'));
    const lod0 = polygons(first(b, 'bldg:lod0FootPrint') ?? first(b, 'bldg:lod0RoofEdge'));
    out.push({
      id,
      usage: num(text(b, 'bldg:usage')),
      storeys: num(text(b, 'bldg:storeysAboveGround')),
      measuredHeight: num(text(b, 'bldg:measuredHeight')),
      lod2: b.includes('<bldg:lod2Solid') || b.includes('<bldg:lod2MultiSurface'),
      // LOD2 shell: [{ roof: boolean, rings: [outer, ...holes], image, uv }], rings of [lon, lat, h]
      surfaces: [['bldg:RoofSurface', true], ['bldg:WallSurface', false]].flatMap(([tag, roof]) =>
        [...elements(b, tag)].flatMap((s) => texturedPolygons(s, tex).map((p) => ({ roof, ...p })))),
      parts: b.includes('<bldg:BuildingPart'),
      solid, lod0,
    });
  }
  return out;
}

// PLATEAU TrafficArea / AuxiliaryTrafficArea function codes -> coarse surface kind.
function trafficKind(code) {
  if (code >= 1000 && code < 2000) return AREA.CARRIAGEWAY;
  if (code >= 2000 && code < 3000) return AREA.SIDEWALK;
  return AREA.OTHER;
}
function auxKind(code) {
  if (code >= 1060 && code < 2000) return AREA.CARRIAGEWAY; // shoulders, stopping bays, bus stops
  if (code >= 3000 && code < 6000) return AREA.ISLAND;      // islands, medians, planting strips
  return AREA.OTHER;
}

// Roads: the LOD1 road outline, plus the LOD2/3 split into carriageway / sidewalk / islands where mapped.
export function readRoads(file) {
  const s = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const r of elements(s, 'tran:Road')) {
    const id = /gml:id="([^"]+)"/.exec(r)?.[1];
    const road = { id, func: num(text(r, 'tran:function')), outline: polygons(first(r, 'tran:lod1MultiSurface')), areas: [] };
    for (const [tag, kindOf] of [['tran:TrafficArea', trafficKind], ['tran:AuxiliaryTrafficArea', auxKind]])
      for (const t of elements(r, tag)) {
        const code = num(text(t, 'tran:function')) ?? 0;
        const polys = polygons(first(t, 'tran:lod2MultiSurface') ?? first(t, 'tran:lod3MultiSurface'));
        if (polys.length) road.areas.push({ kind: kindOf(code), code, polygons: polys });
      }
    out.push(road);
  }
  return out;
}
