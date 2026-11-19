// Part 6: the street centreline as a graph, for the drivable road network where the Manhattan grid ends (Lower
// Manhattan and the diagonal/curving roads farther north, js/road-network.js). Every at-grade street piece of the CSCL
// runs between two nodes (intersections, dead ends, attribute changes): its ends become graph nodes (merged within
// 1 m) and the piece a link with its curb-to-curb width, travel lanes and direction of travel.
import { cscl, segLines, toWorld, rdp, log } from './geo-base.mjs';
import { STREETS } from './geo-streets.mjs';
import { CUT_Z } from './geo-blocks.mjs';
import { createGraph } from './city/graph.mjs';

const MERGE = 1.0; // m: piece ends this close are the same node
const NORTHERN_ROADS = new Set(['BROADWAY', 'RIVERSIDE DR', 'ST NICHOLAS AVE', 'COLUMBUS CIR']);

export function buildRoadGraph() {
  const st14 = STREETS.find((s) => s.n === 14);
  const zFrom = (st14 ? st14.z : 2219) - 60; // from just north of 14th St down to the Battery
  const g = createGraph({ merge: MERGE });
  let skipped = 0;
  for (const s of cscl) {
    if (s.rw_type !== '1' || s.from_level_code !== '13' || s.to_level_code !== '13') continue; // at-grade streets
    const name = s.full_street_name || '';
    if (/DRIVEWAY|PEDESTRIAN|ALLEY|\bALY\b|CONNECTOR|TRANSVERSE|SERVICE RD/.test(name)) continue;
    const dir = s.trafdir === 'TW' ? 0 : s.trafdir === 'FT' ? 1 : s.trafdir === 'TF' ? -1 : null;
    if (dir === null) { skipped++; continue; } // non-vehicular
    const w = parseFloat(s.streetwidth || '0') * 0.3048;
    const lanes = parseInt(s.number_travel_lanes || '0', 10);
    // These roads do not follow the grid corridors. Keep their real intersection nodes throughout the detailed
    // island, including pieces straddling its northern boundary; ordinary grid streets still start near 14th St.
    const minZ = NORTHERN_ROADS.has(name) ? CUT_Z : zFrom;
    for (const ln of segLines(s)) {
      const pts = ln.map(([lon, lat]) => toWorld(lon, lat));
      if (pts.length < 2 || Math.max(...pts.map((p) => p[1])) < minZ) continue;
      const a = g.nodeAt(...pts[0]);
      const b = g.nodeAt(...pts[pts.length - 1]);
      if (a === b) continue;
      g.addLink(a, b, name, w, lanes, dir, rdp(pts, 0.4));
    }
  }
  const graph = g.build();
  log(`road graph: ${graph.nodes.length / 2} nodes, ${graph.links.length} links in Lower Manhattan and the northern non-grid roads (${skipped} non-vehicular pieces skipped)`);
  return graph;
}
