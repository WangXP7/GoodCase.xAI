// tools/city/fetch.mjs — downloads a city's OpenStreetMap layers from Overpass (tools/overpass.sh), and its trees where
// its config names a tree inventory, into tools/data/<city>/
// usage: node tools/city/fetch.mjs <city> [--force]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCity, dataDir } from './config.mjs';

// The Overpass queries of a city's layers, over its detail box grown by its margin
export function queries(city) {
  const [s, w, n, e] = city.detail;
  const m = city.margin;
  const bb = `(${s - m},${w - m},${n + m},${e + m})`;
  const area = (filter) => `way${filter}${bb};relation${filter}${bb};`;
  return {
    roads: `[out:json][timeout:240];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)(_link)?$"]${bb};out geom;`,
    coast: `[out:json][timeout:180];way["natural"="coastline"]${bb};out geom;`,
    water: `[out:json][timeout:180];(${area('["natural"="water"]')}${area('["waterway"="riverbank"]')}${area('["landuse"~"^(reservoir|basin)$"]')});out geom;`,
    parks: `[out:json][timeout:180];(${area('["leisure"~"^(park|garden|nature_reserve|common)$"]')}${area('["landuse"="recreation_ground"]')});out geom;`,
    buildings: `[out:json][timeout:300];(${area('["building"]')}${area('["building:part"]')});out geom;`,
    // road pricing gantries, speed & red light cameras
    enforcement: `[out:json][timeout:180];(node["highway"~"^(toll_gantry|speed_camera)$"]${bb};way["highway"="toll_gantry"]${bb};node["enforcement"]${bb};relation["type"="enforcement"]${bb};);out geom;`
  };
}

// The city's trees inside its detail box grown by its margin (or `box` [s, w, n, e]: tools/city/fetch-island.mjs asks
// for the whole island's), as CSV: lng, lat, height (m), family. From cheeaun/sgtreesdata's trees.csv (id, tree_id,
// species_id, girth, girth_size, height, height_est, age, lng, lat) and its families-species.json ({ family: [species
// ids] })
export async function fetchTrees(city, { box = null } = {}) {
  if (city.trees.source !== 'sgtreesdata') throw new Error(`unknown tree source ${city.trees.source}`);
  const get = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.text();
  };
  const familyOf = new Map();
  for (const [family, ids] of Object.entries(JSON.parse(await get(city.trees.families)))) for (const id of ids) familyOf.set(String(id), family);
  const [s, w, n, e] = box || city.detail;
  const m = box ? 0 : city.margin;
  const lines = (await get(city.trees.url)).split('\n');
  const col = Object.fromEntries(lines[0].split(',').map((k, i) => [k.trim(), i]));
  const out = ['lng,lat,height,family'];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    const lng = parseFloat(f[col.lng]), lat = parseFloat(f[col.lat]);
    if (!(lat > s - m && lat < n + m && lng > w - m && lng < e + m)) continue;
    const family = (familyOf.get(f[col.species_id]) || '').replace(/"/g, '');
    out.push(`${lng},${lat},${parseFloat(f[col.height_est]) || 0},"${family}"`);
  }
  if (out.length < 2) throw new Error('no trees inside the box');
  return out.join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const city = await loadCity(process.argv[2]);
  const force = process.argv.includes('--force');
  const dir = dataDir(city);
  fs.mkdirSync(dir, { recursive: true });
  const overpass = fileURLToPath(new URL('../overpass.sh', import.meta.url));
  let failed = 0;
  if (city.trees) {
    const out = path.join(dir, 'trees.csv');
    if (fs.existsSync(out) && !force) console.log(`[fetch] trees: have ${out}`);
    else {
      console.log(`[fetch] trees from ${city.trees.url} ...`);
      try { fs.writeFileSync(out, await fetchTrees(city)); console.log(`[fetch] trees: wrote ${out}`); } catch (e) { console.error(`[fetch] trees: ${e.message}`); failed++; }
    }
  }
  for (const [layer, ql] of Object.entries(queries(city))) {
    const q = path.join(dir, `q_${layer}.overpassql`);
    const out = path.join(dir, `osm_${layer}.json`);
    fs.writeFileSync(q, ql + '\n');
    if (fs.existsSync(out) && !force) { console.log(`[fetch] ${layer}: have ${out}`); continue; }
    console.log(`[fetch] ${layer} ...`);
    const r = spawnSync('bash', [overpass, out, q, '4'], { stdio: 'inherit' });
    if (r.status !== 0) failed++;
  }
  process.exit(failed ? 1 : 0);
}
