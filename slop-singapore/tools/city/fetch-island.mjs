// tools/city/fetch-island.mjs — downloads OpenStreetMap's buildings and main roads across a city's whole `island` box
// (tools/city/cities/<city>.mjs), cell by cell, plus the island's coastline and inland water, for the streamed outer
// tiles (tools/city/tiles.mjs), and its traffic lights. Into tools/data/<city>/island/ (not committed: tens of megabytes of raw Overpass JSON).
// usage: node tools/city/fetch-island.mjs <city> [--force] [--jobs 2]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCity, dataDir } from './config.mjs';
import { fetchTrees } from './fetch.mjs';

// The Overpass cells (deg) of the island box, [s, w, n, e] each, and the island-wide layers
export function islandQueries(city) {
  const [S, W, N, E] = city.island.box;
  const step = city.island.fetchCell || 0.06;
  const out = {};
  const f = (v) => Math.round(v * 1e4) / 1e4;
  for (let lat = S; lat < N - 1e-9; lat += step) {
    for (let lon = W; lon < E - 1e-9; lon += step) {
      const bb = `(${f(lat)},${f(lon)},${f(Math.min(N, lat + step))},${f(Math.min(E, lon + step))})`;
      const key = `cell_${f(lat).toFixed(2)}_${f(lon).toFixed(2)}`;
      out[key] = `[out:json][timeout:300];(way["building"]${bb};relation["building"]${bb};way["building:part"]${bb};` +
        `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"]${bb};);out geom;`;
    }
  }
  const bb = `(${S},${W},${N},${E})`;
  out.coast = `[out:json][timeout:300];way["natural"="coastline"]${bb};out geom;`;
  // signalised junctions & crossings (traffic lights)
  out.signals = `[out:json][timeout:300];node["highway"="traffic_signals"]${bb};out;`;
  out.water = `[out:json][timeout:300];(way["natural"="water"]${bb};relation["natural"="water"]${bb};way["landuse"="reservoir"]${bb};relation["landuse"="reservoir"]${bb};);out geom;`;
  // what the ground is: parks, woods, grass, farms, industry (js/city-tiles.js shades the island's land by it), in
  // cells twice the size (areas, fewer of them)
  const lu = city.island.landuseCell || step * 2;
  const tags = [
    'landuse~"^(forest|grass|meadow|recreation_ground|cemetery|farmland|farmyard|orchard|plant_nursery|village_green|greenfield|allotments|industrial|commercial|retail|port|railway|construction|brownfield|military|depot|landfill|quarry)$"',
    'leisure~"^(park|garden|golf_course|pitch|nature_reserve|common|playground|recreation_ground|stadium|track|dog_park)$"',
    'natural~"^(wood|scrub|grassland|heath|wetland|beach|sand|bare_rock)$"',
    'aeroway~"^(aerodrome|apron|runway|taxiway)$"',
    'amenity~"^(parking|grave_yard)$"'
  ];
  for (let lat = S; lat < N - 1e-9; lat += lu) {
    for (let lon = W; lon < E - 1e-9; lon += lu) {
      const bb = `(${f(lat)},${f(lon)},${f(Math.min(N, lat + lu))},${f(Math.min(E, lon + lu))})`;
      out[`landuse_${f(lat).toFixed(2)}_${f(lon).toFixed(2)}`] = `[out:json][timeout:600][maxsize:1073741824];(${tags.map((t) => `way[${t}]${bb};relation[${t}]${bb};`).join('')});out geom;`;
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const city = await loadCity(process.argv[2]);
  if (!city.island) throw new Error(`${city.id} has no island box`);
  const force = process.argv.includes('--force');
  const ji = process.argv.indexOf('--jobs');
  const jobs = ji > 0 ? Math.max(1, parseInt(process.argv[ji + 1], 10) || 2) : 2; // Overpass grants ~2 slots per client
  const dir = path.join(dataDir(city), 'island');
  fs.mkdirSync(dir, { recursive: true });
  const overpass = fileURLToPath(new URL('../overpass.sh', import.meta.url));
  const todo = Object.entries(islandQueries(city)).filter(([key]) => force || !fs.existsSync(path.join(dir, `${key}.json`)));
  // the island's trees (NParks' inventory, tools/city/fetch.mjs fetchTrees) across the island box
  if (city.trees && (force || !fs.existsSync(path.join(dir, 'trees.csv')))) {
    console.log(`[island] trees from ${city.trees.url} ...`);
    fs.writeFileSync(path.join(dir, 'trees.csv'), await fetchTrees(city, { box: city.island.box }));
    console.log('[island] trees: wrote trees.csv');
  }
  console.log(`[island] ${todo.length} layers to fetch into ${dir}`);
  let failed = 0;
  let done = 0;
  const run = ([key, ql]) => new Promise((resolve) => {
    const q = path.join(dir, `${key}.overpassql`);
    fs.writeFileSync(q, ql + '\n');
    const child = spawn('bash', [overpass, path.join(dir, `${key}.json`), q, '4'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.on('close', (code) => {
      done++;
      if (code) failed++;
      console.log(`[island] ${done}/${todo.length} ${key}: ${code ? 'FAILED' : log.trim().split('\n').pop()}`);
      fs.rmSync(q, { force: true });
      resolve();
    });
  });
  const queue = [...todo];
  await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await run(queue.shift()); }));
  process.exit(failed ? 1 : 0);
}
