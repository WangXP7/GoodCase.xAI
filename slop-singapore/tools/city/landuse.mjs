// tools/city/landuse.mjs — what the island's ground is, from OpenStreetMap's land use (tools/city/fetch-island.mjs's
// landuse_* downloads), as an image the island's land is shaded by (js/city-tiles.js): one pixel per `res` metres of the
// world frame (RGBA), its red the share of it under trees, green under grass (parks, playing fields, golf courses,
// farms, cemeteries, an airfield's grass), blue paved or built over at ground level (industry, ports, depots, car parks,
// aprons) and alpha sand (beaches). What is left (homes, schools, roadside verges...) the land's own mix of grass and
// paving.
import { Raster, bbox, ringArea } from './geom.mjs';
import { areaPolygons } from './osm.mjs';

export const LANDUSE = ['wood', 'grass', 'paved', 'sand'];

const WOOD = { landuse: ['forest'], natural: ['wood', 'scrub', 'wetland', 'heath'], leisure: ['nature_reserve'] };
const GRASS = {
  landuse: ['grass', 'meadow', 'recreation_ground', 'cemetery', 'farmland', 'orchard', 'plant_nursery', 'village_green', 'greenfield', 'allotments'],
  leisure: ['park', 'garden', 'golf_course', 'pitch', 'common', 'playground', 'recreation_ground', 'dog_park'],
  natural: ['grassland'],
  amenity: ['grave_yard'],
  aeroway: ['aerodrome']
};
const PAVED = {
  landuse: ['industrial', 'port', 'railway', 'construction', 'brownfield', 'depot', 'landfill', 'quarry', 'farmyard'],
  natural: ['bare_rock'],
  leisure: ['stadium', 'track'],
  amenity: ['parking'],
  aeroway: ['apron']
};
const SAND = { natural: ['beach', 'sand'] };
const is = (t, table) => Object.entries(table).some(([k, vs]) => vs.includes(t[k]));

/** The class of an area's tags: 0 wood, 1 grass, 2 paved, 3 sand, or -1 (none of them: left to the land's own mix) */
export function landuseClass(t = {}) {
  // the most specific tag first: a park's woods are woods, a car park in a park paved
  if (is(t, SAND)) return 3;
  if (is(t, { natural: WOOD.natural, landuse: WOOD.landuse })) return 0;
  if (is(t, { amenity: PAVED.amenity, aeroway: PAVED.aeroway, leisure: PAVED.leisure, natural: PAVED.natural })) return 2;
  if (is(t, GRASS)) return 1;
  if (is(t, PAVED)) return 2;
  if (is(t, WOOD)) return 0;
  return -1;
}

/**
 * The land-use image over [x0, z0, x1, z1]: areas painted largest first, so the smaller inside them win (a pitch in a
 * park, a car park in an industrial estate, woods in a nature reserve), each counted at `res / sub` and shared out
 * per pixel. -> { x0, z0, res, w, h, rgba (Uint8Array w * h * 4, rows from z0 down), counts }
 */
export function landuseImage(elements, toWorld, [x0, z0, x1, z1], { res = 20, sub = 2 } = {}) {
  const fine = new Raster(x0, z0, x1, z1, res / sub);
  fine.d.fill(255);
  const seen = new Set();
  const areas = [];
  const counts = [0, 0, 0, 0];
  for (const e of elements) {
    const key = `${e.type}${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = landuseClass(e.tags);
    if (c < 0) continue;
    for (const { outer, holes } of areaPolygons(e, toWorld, 100)) {
      const b = bbox(outer);
      if (b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1) continue;
      areas.push({ c, outer, holes, area: Math.abs(ringArea(outer)) });
      counts[c]++;
    }
  }
  areas.sort((a, b) => b.area - a.area);
  const mark = new Raster(x0, z0, x1, z1, res / sub); // (scratch: an area with its holes)
  for (const a of areas) {
    if (!a.holes.length) {
      fine.fillRing(a.outer, a.c);
      continue;
    }
    // with holes: its cells less its holes', then those
    const bb = bbox(a.outer);
    mark.fillRing(a.outer, 1);
    for (const h of a.holes) mark.fillRing(h, 0);
    const { w, res: r } = mark;
    const i0 = Math.max(0, Math.floor((bb.x0 - mark.x0) / r)), i1 = Math.min(w - 1, Math.ceil((bb.x1 - mark.x0) / r));
    const j0 = Math.max(0, Math.floor((bb.z0 - mark.z0) / r)), j1 = Math.min(mark.h - 1, Math.ceil((bb.z1 - mark.z0) / r));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        if (mark.d[k]) fine.d[k] = a.c;
        mark.d[k] = 0;
      }
    }
  }
  // each pixel: the share of its sub × sub cells of each class
  const w = Math.ceil(fine.w / sub), h = Math.ceil(fine.h / sub);
  const rgba = new Uint8Array(w * h * 4);
  const n = sub * sub;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const tally = [0, 0, 0, 0];
      for (let b = 0; b < sub; b++) {
        for (let a = 0; a < sub; a++) {
          const fi = i * sub + a, fj = j * sub + b;
          if (fi >= fine.w || fj >= fine.h) continue;
          const v = fine.d[fj * fine.w + fi];
          if (v < 4) tally[v]++;
        }
      }
      for (let c = 0; c < 4; c++) rgba[(j * w + i) * 4 + c] = Math.round((tally[c] / n) * 255);
    }
  }
  return { x0: fine.x0, z0: fine.z0, res, w, h, rgba, counts };
}
