import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// js/geodata.js picks the city when it loads (from CITY outside a browser), so each city runs in its own process
function inCity(city, body) {
  const script = `
    const nyc = await import('./js/nyc-config.js');
    const config = await import('./js/city-config.js');
    const { buildRoadNetwork } = await import('./js/road-network.js');
    const out = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CITY: city }, timeout: 120000
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('Singapore is the default city and New York is ?city=nyc', () => {
  assert.equal(inCity('', 'return config.CITY.id;'), 'singapore');
  assert.equal(inCity('atlantis', 'return config.CITY.id;'), 'singapore', 'an unknown city falls back to the default');
  const out = inCity('nyc', 'const { vehicles, ...city } = config.CITY; return { city, taxi: vehicles.taxis[0], blocks: config.BLOCKS.length, same: config.BLOCKS === nyc.BLOCKS };');
  assert.deepEqual(out.city, { id: 'nyc', name: 'New York', short: 'NY', open: false, driveSide: 'right', units: 'imperial' });
  assert.equal(out.taxi, 0xffbe14, 'yellow cabs');
  assert.ok(out.same && out.blocks > 2000);
});

test('a city built from OpenStreetMap serves the whole city-config.js interface', () => {
  const out = inCity('singapore', `
    const names = (m) => Object.keys(m).sort();
    const { SPAWN } = config;
    return {
      sameNames: JSON.stringify(names(nyc)) === JSON.stringify(names(config)),
      missing: names(config).filter((k) => config[k] === undefined),
      city: (({ vehicles, ...c }) => c)(config.CITY),
      taxis: config.CITY.vehicles.taxis,
      blocks: config.BLOCKS.length,
      roads: config.ROADS.length,
      land: config.LAND_REGIONS.length,
      spawnInBlock: !!config.blockAt(SPAWN.x, SPAWN.z),
      spawnShore: config.getIslandBoundsAtZ(SPAWN.z),
      spawnX: SPAWN.x,
      label: config.getLocationLabel(SPAWN.x, SPAWN.z),
      teleports: Object.entries(config.TELEPORT_LOCATIONS).map(([id, t]) => ({ id, name: t.name, inBlock: !!config.blockAt(t.x, t.z), heading: t.heading })),
      styled: config.BLOCKS.filter((b) => b.district !== 'generic').length
    };
  `);
  assert.ok(out.sameNames, 'the same exports as nyc-config.js');
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.city, { id: 'singapore', name: 'Singapore', short: 'SG', open: true, driveSide: 'left', units: 'metric' });
  assert.ok(out.taxis.length > 1 && !out.taxis.includes(0xffbe14), "Singapore's taxi fleet");
  assert.ok(out.blocks > 1000 && out.roads > 500 && out.land > 0);
  assert.equal(out.spawnInBlock, false, 'the start is on a street');
  assert.ok(out.spawnX > out.spawnShore.westX && out.spawnX < out.spawnShore.eastX, 'the start is on land');
  assert.match(out.label, /\w+ & \w+|\w+/);
  assert.ok(out.teleports.length >= 8, 'a teleport to each place');
  for (const t of out.teleports) {
    assert.equal(t.inBlock, false, `${t.name} arrives on a street`);
    assert.ok(Number.isFinite(t.heading));
  }
  assert.ok(out.styled > 300, 'neighbourhoods give blocks their building styles');
});

test("Singapore's lawns stay inside its blocks, off the roads", () => {
  const out = inCity('singapore', `
    const { GEO } = await import('./js/geodata.js');
    const L = GEO.lawns;
    let rings = 0, points = 0, outside = 0;
    for (let i = 0, fx = 0, fz = 0; i < L.length;) {
      const n = L[i++];
      rings++;
      let px = fx, pz = fz;
      for (let k = 0; k < n; k++) {
        px += L[i++]; pz += L[i++];
        if (!k) { fx = px; fz = pz; }
        points++;
        if (!config.blockAt(px / 10, pz / 10)) outside++;
      }
    }
    return { rings, points, outside };
  `);
  assert.ok(out.rings > 500, `${out.rings} lawns`);
  // a corner can sit on its curb's raster step, a hair outside the traced outline
  assert.ok(out.outside / out.points < 0.01, `${out.outside} of ${out.points} lawn corners outside every block`);
});

test("every building style a city's neighbourhoods name is one buildings.js builds", async () => {
  const buildings = fs.readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
  const styles = buildings.match(/const OPEN_STYLES = \{([^]*?)\n  \};/)[1];
  for (const file of fs.readdirSync(new URL('../tools/city/cities/', import.meta.url))) {
    const city = (await import(new URL(`../tools/city/cities/${file}`, import.meta.url).href)).default;
    for (const d of city.districts || []) assert.match(styles, new RegExp(`(^|\\s|')${d.style}'?:`), `${city.id}: ${d.name} (${d.style})`);
  }
});

test("Singapore's streets drive as one network", () => {
  // the curbs city-grid.js bounds the roads with in an open city: rectangular blocks, the outlines of irregular ones
  // with lots (medians & traffic islands bound none)
  const out = inCity('singapore', `
    const sidewalks = [];
    for (const b of config.BLOCKS) {
      if (b.median) continue;
      if (b.rect) sidewalks.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
      else if (b.rects.length) sidewalks.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, poly: b.poly });
    }
    console.info = () => {};
    const net = buildRoadNetwork(sidewalks, []);
    const uturns = net.edges.reduce((n, e) => n + e.moves.filter((m) => m.uturn).length, 0);
    return { edges: net.edges.length, uturns, signals: net.nodes.filter((n) => n.signal).length };
  `);
  assert.ok(out.edges > 8000, `${out.edges} connected edges`);
  assert.ok(out.uturns > 0, 'dead ends turn round');
  assert.ok(out.signals >= 20, 'the junctions its red light cameras watch have signals');
});
