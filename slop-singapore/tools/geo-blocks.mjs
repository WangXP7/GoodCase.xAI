// Part 3: real Manhattan blocks ("curb islands") from the street centerline, by rasterising every at-grade roadway at
// its curb-to-curb width over the land (minus a waterfront strip), then labelling what's left.
// Each block: curb outline polygon, axis-aligned lot rects inside its property line (curb minus sidewalk), metadata.
import { geo, Raster, rdpRing, bbox, log } from './geo-base.mjs';
import { extractBlocks } from './city/blocks.mjs';
import { pieces } from './geo-streets.mjs';

export const CUT_Z = -7090; // detailed island south of here (≈ 129th St); Upper Manhattan beyond is low-detail
export const STRIP = 20; // waterfront strip kept clear of blocks (esplanade + shore highway), metres in from the bulkhead
export const SIDEWALK = 4.6; // property line in from the curb (15 ft)
const RES = 1;

// --- Roadways that bound blocks ----------------------------------------------------------------------------------------
const PARK_ROADS = /^(EAST DR|WEST DR|CENTER DR|\d+ ST TRANSVERSE|CENTRAL PARK GREAT HL|CENTRAL RD)$/;
const HIGHWAYS = /^(FRANKLIN D ROOSEVELT DR|FDR DR {2}VIADUCT|HARLEM RIVER DR|HARLEM RIVER DY|HENRY HUDSON PKWY|BATTERY PARK UNDERPASS)$/;
function roadWidth(p) {
  if (p.w > 3) return p.w;
  if (/AVE|BLVD|BROADWAY|DR$/.test(p.name)) return 18;
  return 9.1;
}
const roads = [];
for (const p of pieces) {
  if (p.level !== '13') continue; // at grade (from-level; ramps & viaducts drop out below)
  const atGradeStreet = p.rw === '1' && !PARK_ROADS.test(p.name) && !HIGHWAYS.test(p.name) && !/DRIVEWAY|PEDESTRIAN|ALLEY/.test(p.name);
  const surface9A = p.rw === '2' && /^(WEST ST|12 AVE|11 AVE)$/.test(p.name); // Route 9A at grade bounds the west side blocks
  const plaza = p.rw === '6' && p.name === 'BROADWAY'; // Broadway's pedestrian plazas (Times Sq, Herald Sq...)
  if (!atGradeStreet && !surface9A && !plaza) continue;
  roads.push({ x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1, r: roadWidth(p) / 2, name: p.name });
}
// Broadway's pedestrian plazas aren't in the centerline (Times Square 42nd-47th St, Herald & Greeley Squares
// 33rd-35th St): bridge each gap with a straight piece between the Broadway ends on either side
export const PLAZAS = [];
{
  const bw = roads.filter((s) => s.name === 'BROADWAY');
  const ends = [];
  for (const s of bw) ends.push([s.x0, s.z0], [s.x1, s.z1]);
  const nearestEnd = (z, below) => {
    let best = null;
    for (const e of ends) {
      if (below ? e[1] < z - 3 || e[1] > z + 40 : e[1] > z + 3 || e[1] < z - 40) continue;
      if (!best || Math.abs(e[1] - z) < Math.abs(best[1] - z)) best = e;
    }
    return best;
  };
  for (const [name, zN, zS] of [['Times Square', -402, 0], ['Herald Square', 556, 726]]) {
    const a = nearestEnd(zN, false), b = nearestEnd(zS, true);
    if (!a || !b) continue;
    roads.push({ x0: a[0], z0: a[1], x1: b[0], z1: b[1], r: 9, name: 'BROADWAY', plaza: name });
    PLAZAS.push({ name, a, b, w: 18 });
  }
}
log(`${roads.length} at-grade roadway pieces`);

// --- Land: the bulkhead ring eroded by the waterfront strip ------------------------------------------------------------
const mb = bbox(geo.manhattan);
const land2 = new Raster(mb.x0 - 10, Math.max(mb.z0, CUT_Z - 400) - 10, mb.x1 + 10, mb.z1 + 10, 2);
land2.fillRing(geo.manhattan, 1);
{
  const toWater = land2.edt((v) => v === 0);
  const rc = (STRIP / 2) ** 2;
  for (let i = 0; i < land2.d.length; i++) land2.d[i] = toWater[i] > rc ? 1 : 0;
}
land2.keepLargest();
const innerRing = rdpRing(land2.traceOuter(), 1.0);
log(`inner land ring (strip ${STRIP} m): ${innerRing.length} pts`);

// --- 1 m buildable raster: the inner land ring minus every roadway, labelled into blocks (tools/city/blocks.mjs) ---------
const { blocks, raster: R, labels: lab } = extractBlocks({
  x0: Math.floor(mb.x0) - 4, z0: CUT_Z, x1: Math.ceil(mb.x1) + 4, z1: Math.ceil(mb.z1) + 4,
  res: RES, sidewalk: SIDEWALK, fillLand: (r) => r.fillRing(innerRing, 1), roads, log
});

export { blocks, innerRing, roads, R as blockRaster, lab as blockLabels };
