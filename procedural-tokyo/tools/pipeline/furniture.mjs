// Street furniture mapped in OpenStreetMap as points: bus stops, subway entrances, benches, bollards,
// post boxes, phone booths, bicycle parking, statues and wayside shrines.
import fs from 'node:fs';
import { PROP } from '../../src/shared/tileformat.js';
import { SIGN } from './signs.mjs';

// Statues with a model of their own (PROP.STATUE variants); everything else is a figure on a plinth.
const STATUES = [[/ハチ公/, 1], [/モヤイ/, 2]];

function kindOf(t) {
  if (t.highway === 'bus_stop') return PROP.BUS_STOP;
  if (t.railway === 'subway_entrance') return PROP.SUBWAY;
  if (t.amenity === 'bench') return PROP.BENCH;
  if (t.barrier === 'bollard') return PROP.BOLLARD;
  if (t.amenity === 'post_box') return PROP.POST_BOX;
  if (t.amenity === 'telephone') return PROP.PHONE;
  if (t.amenity === 'bicycle_parking' || t.amenity === 'bicycle_rental') return PROP.BIKES;
  if (t.historic === 'wayside_shrine') return PROP.SHRINE;
  if (t.tourism === 'artwork' || t.historic === 'memorial' || t.historic === 'monument') return PROP.STATUE;
  return null;
}

// idx: { building, carriageway } PolyIndex; ground(x, z). Returns { props, signs }.
export function placeFurniture(file, project, idx, ground, inBounds) {
  const { elements } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const props = [], signs = [], count = {};
  // Direction (unit vector) from a point to the nearest carriageway within 10 m, or null.
  const toRoad = (x, z) => {
    let best = null, bd = Infinity;
    for (let a = 0; a < 16; a++) {
      const dx = Math.cos((a * Math.PI) / 8), dz = Math.sin((a * Math.PI) / 8);
      for (let d = 0.75; d <= 10 && d < bd; d += 0.75) if (idx.carriageway.has(x + dx * d, z + dz * d)) { bd = d; best = [dx, dz]; break; }
    }
    return best;
  };
  for (const e of elements) {
    const t = e.tags ?? {}, kind = kindOf(t), lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (kind == null || lon == null) continue;
    let [x, z] = project(lon, lat);
    if (!inBounds(x, z)) continue;
    // Things stand beside the road, not on it or in a wall. OSM puts bus stops on the kerb line and
    // bollards across lanes; nudge those out of the carriageway.
    const road = toRoad(x, z);
    if (idx.carriageway.has(x, z)) {
      if (kind !== PROP.BUS_STOP && kind !== PROP.BOLLARD) continue;
      let moved = false;
      for (let a = 0; a < 16 && !moved; a++) for (const d of [1.2, 2.4, 3.6]) {
        const nx = x + Math.cos((a * Math.PI) / 8) * d, nz = z + Math.sin((a * Math.PI) / 8) * d;
        if (!idx.carriageway.has(nx, nz) && !idx.building.has(nx, nz)) { x = nx; z = nz; moved = true; break; }
      }
      if (!moved) continue;
    }
    if (idx.building.has(x, z) && kind !== PROP.SUBWAY) continue;
    const face = toRoad(x, z) ?? road ?? [0, 1];           // most things face the street
    const rot = Math.atan2(face[0], face[1]);
    const name = t.name ?? '';
    const variant = kind === PROP.STATUE ? (STATUES.find(([re]) => re.test(name))?.[1] ?? 0)
      : kind === PROP.BUS_STOP ? (t.shelter === 'yes' ? 1 : 0) : 0;
    props.push({ kind, variant, rot, x, z, scale: 1 });
    count[kind] = (count[kind] ?? 0) + 1;
    // name plates: the stop's name on the pole, the exit number over the subway stairs
    const y = ground(x, z);
    if (kind === PROP.BUS_STOP && name)
      signs.push({ style: SIGN.FASCIA, color: 4, x: x + face[0] * 0.09, z: z + face[1] * 0.09, y: y + 1.95, nx: face[0], nz: face[1], w: Math.min(1.5, 0.35 + [...name].length * 0.16), h: 0.28, text: name.slice(0, 14) });
    if (kind === PROP.SUBWAY && (t.ref || name))
      signs.push({ style: SIGN.FASCIA, color: 12, x: x + face[0] * 2.5, z: z + face[1] * 2.5, y: y + 2.42, nx: face[0], nz: face[1], w: 2.2, h: 0.34, text: (t.ref ? t.ref + ' ' : '') + name.slice(0, 12) });
  }
  return { props, signs, count };
}
