// tools/city/mrt.mjs — Singapore's MRT lines, from OpenStreetMap's route relations (tools/data/<city>/mrt/routes.json)
// and its stations and their exits (stations.json), both fetched with tools/overpass.sh (queries in tools/data/<city>/mrt/,
// see the README), for the MRT rides (js/mrt.js).
// usage: node tools/city/mrt.mjs singapore [--fetch]   (--fetch downloads routes.json and stations.json first)
//
// Output: tiles/<city>/mrt.json {
//   lines: [{ id ('NSL'), code ('NS'), name, colour ('#rrggbb'), driverless (its trains have no driver's cab) }],
//   stations: [{ name, codes (['NS25', 'EW13']), x, z (m, the station's own point), exits: [[x, z, 'A'], ...] }],
//   tracks: [{ line (index into lines), towards (the last station's name), pts: [dx, dz, dy, ...] (dm, each point of the
//     line's centre from the one before, the first from the origin; y its height: below the ground in a tunnel, up on
//     the viaduct elevated), stops: [[station index, s (the index of its point in pts), door side (-1 left, 1 right, 0 not known: all, for now)], ...] }]
// }
// A track is one direction of a line's service, with its stops in order. Heights come from the ways' tunnel / bridge
// / layer tags: a tunnel well below the ground, a bridge up on its viaduct, eased between at a rail gradient.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadCity, dataDir } from './config.mjs';
import { makeFrame } from './frame.mjs';

const log = (...a) => console.log('[mrt]', ...a);

// The lines the rides take (in service), each by its relations' ref
const LINES = [
  { id: 'NSL', code: 'NS', name: 'North-South Line', colour: '#d42e12', driverless: false },
  { id: 'EWL', code: 'EW', name: 'East-West Line', colour: '#009645', driverless: false },
  { id: 'NEL', code: 'NE', name: 'North East Line', colour: '#9900aa', driverless: true },
  { id: 'CCL', code: 'CC', name: 'Circle Line', colour: '#fa9e0d', driverless: true },
  { id: 'DTL', code: 'DT', name: 'Downtown Line', colour: '#005ec4', driverless: true },
  { id: 'TEL', code: 'TE', name: 'Thomson-East Coast Line', colour: '#9d5b25', driverless: true }
];
const TUNNEL_Y = -17; // m: an underground line's rails (platforms ~2-3 storeys down)
const VIADUCT_Y = 10; // m: an elevated line's rails
const GROUND_Y = 0.6;
const GRADE = 0.03; // the steepest a line climbs or falls
const STEP = 4; // m between the points of a track

const yes = (v) => v === 'yes' || v === 'true' || v === '1';

export async function buildMrt(cityId, { data, out } = {}) {
  const city = await loadCity(cityId);
  const dir = data || path.join(dataDir(city), 'mrt');
  const outFile = out || fileURLToPath(new URL(`../../tiles/${city.id}/mrt.json`, import.meta.url));
  const GEO = (await import(new URL(`../../js/${city.id}-geodata.js`, import.meta.url).href)).GEO;
  const frame = makeFrame({ lat0: GEO.frame.lat0, lon0: GEO.frame.lon0, theta: (GEO.frame.bearingDeg * Math.PI) / 180 });
  const { toWorld } = frame;
  const routes = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8')).elements;
  const places = JSON.parse(fs.readFileSync(path.join(dir, 'stations.json'), 'utf8')).elements;
  const byId = new Map(routes.map((e) => [`${e.type}${e.id}`, e]));

  // --- Stations: the station nodes / areas with a ref of a line we take ('NS25;EW13'), and their exits --------------
  const lineOfCode = new Map(LINES.map((l, i) => [l.code, i]));
  // (and the branches' codes: the Changi Airport branch of the East-West Line, the Circle Line's Marina Bay extension)
  lineOfCode.set('CG', 1);
  lineOfCode.set('CE', 3);
  const stations = [];
  const stationByName = new Map();
  const norm = (n) => (n || '').toLowerCase().replace(/\s+(mrt|lrt)?\s*(station|interchange)?$/i, '').replace(/[^a-z0-9]/g, '');
  for (const e of places) {
    const t = e.tags || {};
    if (!(t.railway === 'station' || t.public_transport === 'station')) continue;
    const codes = String(t.ref || '').split(/[;/,]\s*/).map((c) => c.trim().toUpperCase()).filter((c) => lineOfCode.has(c.replace(/\d.*$/, '')));
    if (!codes.length || !t.name) continue;
    const lon = e.lon ?? e.center?.lon;
    const lat = e.lat ?? e.center?.lat;
    if (lon === undefined) continue;
    const [x, z] = toWorld(lon, lat);
    const key = norm(t['name:en'] || t.name);
    let s = stationByName.get(key);
    if (!s) {
      s = { name: (t['name:en'] || t.name).replace(/\s+(MRT|LRT)\s+Station$/i, ''), codes: [], x, z, n: 0, exits: [] };
      stationByName.set(key, s);
      stations.push(s);
    }
    // (a station mapped as a node and as an area, or once per line at an interchange: one station, at their middle)
    s.n++;
    s.x += (x - s.x) / s.n;
    s.z += (z - s.z) / s.n;
    for (const c of codes) if (!s.codes.includes(c)) s.codes.push(c);
  }
  for (const e of places) {
    const t = e.tags || {};
    if (t.railway !== 'subway_entrance' || e.lon === undefined) continue;
    const [x, z] = toWorld(e.lon, e.lat);
    let best = null;
    let bd = 260;
    for (const s of stations) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) best.exits.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, String(t.ref || t.name || '').slice(0, 6)]);
  }

  // --- Tracks: each line's route relations (one a direction), their ways chained into one line, their stops on it ---
  const tracks = [];
  const used = new Set();
  for (const r of routes) {
    if (r.type !== 'relation') continue;
    const t = r.tags || {};
    const li = LINES.findIndex((l) => l.id === t.ref);
    if (li < 0 || t.route !== 'subway') continue;
    // the Circle Line's loops overlap its two ends' services: the end to end runs only
    if (/loop/i.test(t.name || '')) continue;
    const ways = r.members.filter((m) => m.type === 'way' && (m.role === '' || m.role === 'route')).map((m) => byId.get(`way${m.ref}`)).filter((w) => w && w.geometry && w.tags && /subway|light_rail|rail/.test(w.tags.railway || ''));
    const stops = r.members.filter((m) => m.type === 'node' && /^stop/.test(m.role)).map((m) => byId.get(`node${m.ref}`)).filter(Boolean);
    if (ways.length < 1 || stops.length < 2) continue;
    // chain the ways end to end, each turned to carry on from the one before (or reaching back to the nearer end)
    const runs = ways.map((w) => ({ pts: w.geometry.map((g) => { const [x, z] = toWorld(g.lon, g.lat); return [x, z]; }), kind: kindOf(w.tags) }));
    const chain = [];
    const kinds = [];
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    for (let i = 0; i < runs.length; i++) {
      let p = runs[i].pts;
      if (i === 0 && runs.length > 1) {
        const n = runs[1].pts;
        const endNear = Math.min(d2(p[p.length - 1], n[0]), d2(p[p.length - 1], n[n.length - 1]));
        const startNear = Math.min(d2(p[0], n[0]), d2(p[0], n[n.length - 1]));
        if (startNear < endNear) p = [...p].reverse();
      } else if (i > 0) {
        const last = chain[chain.length - 1];
        if (d2(last, p[p.length - 1]) < d2(last, p[0])) p = [...p].reverse();
      }
      for (const q of p) {
        const last = chain[chain.length - 1];
        if (last && d2(last, q) < 0.25) continue;
        chain.push(q);
        kinds.push(runs[i].kind);
      }
    }
    // resample every STEP m, carrying each point's kind
    const line = resample(chain, kinds, STEP);
    // heights from the kinds, eased at the gradient
    const y = line.map((p) => (p.kind === 'tunnel' ? TUNNEL_Y : p.kind === 'bridge' ? VIADUCT_Y : GROUND_Y));
    easeHeights(y, STEP, GRADE);
    // the stops, in order along it (each the nearest point at or beyond the one before)
    const out = [];
    let from = 0;
    for (const n of stops) {
      const [x, z] = toWorld(n.lon, n.lat);
      let bi = -1;
      let bd = 80 * 80;
      for (let i = from; i < line.length; i++) {
        const d = (line[i].x - x) ** 2 + (line[i].z - z) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi < 0) continue;
      const name = (n.tags && (n.tags['name:en'] || n.tags.name)) || '';
      // the station: by name, else the nearest
      let si = stations.indexOf(stationByName.get(norm(name)));
      if (si < 0) {
        let sd = 400;
        stations.forEach((s, k) => { const d = Math.hypot(s.x - x, s.z - z); if (d < sd) { sd = d; si = k; } });
      }
      if (si < 0) continue;
      if (out.length && out[out.length - 1][0] === si) continue;
      // (the side the doors open: the data doesn't tell it reliably, a station's point being its building's middle)
      out.push([si, bi * STEP, 0]);
      from = bi;
    }
    if (out.length < 2) continue;
    // (trim the track to a little past its first and last stops: depots and sidings beyond are no part of a ride)
    const i0 = Math.max(0, Math.round(out[0][1] / STEP) - 40);
    const i1 = Math.min(line.length - 1, Math.round(out[out.length - 1][1] / STEP) + 40);
    // the points kept: those a straight run between its neighbours misses by more than 12 cm, across or in height
    const keep = simplify(line, y, i0, i1, 0.12, out.map((st) => Math.round(st[1] / STEP)));
    // each point's x, z, y in dm from the point before (the first from the origin), and its distance along the track
    const pts = [];
    const along = [];
    let px = 0, pz = 0, py = 0;
    for (const i of keep) {
      const qx = Math.round(line[i].x * 10), qz = Math.round(line[i].z * 10), qy = Math.round(y[i] * 10);
      pts.push(qx - px, qz - pz, qy - py);
      px = qx; pz = qz; py = qy;
      along.push(i);
    }
    // (each stop at one of the kept points: by its index among them)
    for (const s of out) s[1] = along.indexOf(Math.round(s[1] / STEP));
    const towards = stations[out[out.length - 1][0]].name;
    const key = `${li}:${out.map((s) => s[0]).join(',')}`;
    if (used.has(key)) continue;
    used.add(key);
    tracks.push({ line: li, towards, pts, stops: out });
    for (const [si] of out) stations[si].used = true;
    log(`${LINES[li].id} towards ${towards}: ${out.length} stops, ${(((i1 - i0) * STEP) / 1000).toFixed(1)} km, ${keep.length} points`);
  }

  const usedStations = stations.filter((s) => s.used);
  const index = new Map(usedStations.map((s, i) => [stations.indexOf(s), i]));
  for (const t of tracks) for (const s of t.stops) s[0] = index.get(s[0]);
  const json = {
    credit: 'MRT lines, stations and exits © OpenStreetMap contributors (ODbL)',
    lines: LINES,
    stations: usedStations.map((s) => ({
      name: s.name,
      codes: s.codes.sort(),
      x: Math.round(s.x * 10) / 10,
      z: Math.round(s.z * 10) / 10,
      exits: s.exits.sort((a, b) => String(a[2]).localeCompare(String(b[2])))
    })),
    tracks
  };
  const text = JSON.stringify(json);
  fs.writeFileSync(outFile, text);
  log(`wrote ${usedStations.length} stations, ${tracks.length} tracks (${(text.length / 1024).toFixed(0)} KB) to ${outFile}`);
  return json;
}

// The indices from i0 to i1 that keep the line within `tol` m (across and in height) of all the points (Douglas-Peucker)
function simplify(line, y, i0, i1, tol, must = []) {
  const keep = new Uint8Array(line.length);
  keep[i0] = keep[i1] = 1;
  for (const i of must) keep[i] = 1;
  const fixed = [i0, ...must.filter((i) => i > i0 && i < i1).sort((a, b) => a - b), i1];
  const stack = [];
  for (let k = 0; k + 1 < fixed.length; k++) stack.push([fixed[k], fixed[k + 1]]);
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = line[a].x, az = line[a].z, ay = y[a];
    const ex = line[b].x - ax, ez = line[b].z - az, ey = y[b] - ay;
    const L2 = ex * ex + ez * ez || 1e-9;
    let worst = -1, wd = tol;
    for (let i = a + 1; i < b; i++) {
      const t = ((line[i].x - ax) * ex + (line[i].z - az) * ez) / L2;
      const d = Math.max(Math.hypot(line[i].x - ax - ex * t, line[i].z - az - ez * t), Math.abs(y[i] - ay - ey * t));
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  const out = [];
  for (let i = i0; i <= i1; i++) if (keep[i]) out.push(i);
  return out;
}

function kindOf(t) {
  if (yes(t.tunnel) || t.tunnel === 'building_passage' || Number(t.layer) < 0 || Number(t.level) < 0) return 'tunnel';
  if (yes(t.bridge) || t.bridge === 'viaduct' || Number(t.layer) > 0 || t.embankment === 'yes') return 'bridge';
  return 'ground';
}

// A point every `step` m along the polyline, each with the kind of the stretch it falls on
function resample(pts, kinds, step) {
  const out = [];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    let s = carry;
    while (s < L) {
      const t = s / L;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, kind: kinds[i + 1] });
      s += step;
    }
    carry = s - L;
  }
  const last = pts[pts.length - 1];
  out.push({ x: last[0], z: last[1], kind: kinds[kinds.length - 1] });
  return out;
}

// Ease the heights so no stretch climbs or falls faster than `grade`, without moving a station's level much: each
// height may change from the one before by step * grade at most, eased both ways (taking the nearer to its target)
function easeHeights(y, step, grade) {
  const dmax = step * grade;
  const target = y.slice();
  // forward and backward limits on how far from each target the line may be, from the ends of each run
  const up = target.slice();
  for (let i = 1; i < y.length; i++) up[i] = Math.min(target[i], up[i - 1] + dmax); // can't rise faster
  for (let i = y.length - 2; i >= 0; i--) up[i] = Math.min(up[i], up[i + 1] + dmax);
  const down = target.slice();
  for (let i = 1; i < y.length; i++) down[i] = Math.max(target[i], down[i - 1] - dmax);
  for (let i = y.length - 2; i >= 0; i--) down[i] = Math.max(down[i], down[i + 1] - dmax);
  // a tunnel's target pulls down, a viaduct's up: meet halfway where they conflict, then smooth once more
  for (let i = 0; i < y.length; i++) y[i] = target[i] < GROUND_Y ? up[i] : target[i] > GROUND_Y ? down[i] : (up[i] + down[i]) / 2;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < y.length; i++) if (y[i] - y[i - 1] > dmax) y[i] = y[i - 1] + dmax; else if (y[i - 1] - y[i] > dmax) y[i] = y[i - 1] - dmax;
    for (let i = y.length - 2; i >= 0; i--) if (y[i] - y[i + 1] > dmax) y[i] = y[i + 1] + dmax; else if (y[i + 1] - y[i] > dmax) y[i] = y[i + 1] - dmax;
  }
}

// Downloads the lines (their route relations, ways and stop nodes, with geometry) and the stations and their exits,
// with tools/overpass.sh, from the queries kept beside them (q_routes.overpassql, q_stations.overpassql)
export async function fetchMrt(cityId) {
  const city = await loadCity(cityId);
  const dir = path.join(dataDir(city), 'mrt');
  const overpass = fileURLToPath(new URL('../overpass.sh', import.meta.url));
  for (const key of ['routes', 'stations']) {
    log(`fetching ${key} ...`);
    const r = spawnSync('bash', [overpass, path.join(dir, `${key}.json`), path.join(dir, `q_${key}.overpassql`), '4'], { stdio: 'inherit' });
    if (r.status) throw new Error(`${key}: overpass failed`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const id = process.argv[2] || 'singapore';
  if (process.argv.includes('--fetch')) await fetchMrt(id);
  await buildMrt(id);
}
