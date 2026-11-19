import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { makeFrame } from '../tools/city/frame.mjs';

const require = createRequire(import.meta.url);
const { loadModule } = require('./helpers/module.cjs');

// js/singapore-landmarks.js's frame & placements, its three.js imports stubbed
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
const { makeToWorld, MBS, FLYER } = loadModule(fs.readFileSync(new URL('../js/singapore-landmarks.js', import.meta.url), 'utf8'), {
  imports: { 'three/webgpu': {}, 'three/tsl': new Proxy({}, { get: () => stub }), './tsl-materials.js': { cityUniforms: {} }, './geodata.js': { GEO: {} } },
  globals: { Math, console, Float32Array, performance }
});

test('the landmarks use the geodata\'s world frame (tools/city/frame.mjs)', () => {
  const frame = { lat0: 1.28405, lon0: 103.85143, bearingDeg: 31.8 };
  const toWorld = makeToWorld(frame);
  const ref = makeFrame({ lat0: frame.lat0, lon0: frame.lon0, theta: (frame.bearingDeg * Math.PI) / 180 });
  for (const [lat, lon] of [...MBS.towers, FLYER.hub, [1.3, 103.8], [1.25, 103.9]]) {
    const [x, z] = toWorld(lat, lon);
    const [rx, rz] = ref.toWorld(lon, lat);
    assert.ok(Math.hypot(x - rx, z - rz) < 1e-6, `${lat}, ${lon}`);
  }
});

test('Marina Bay Sands\' towers stand in a row under the SkyPark, the Flyer east of them by the bay', () => {
  const toWorld = makeToWorld({ lat0: 1.28405, lon0: 103.85143, bearingDeg: 31.8 });
  const towers = MBS.towers.map(([lat, lon]) => toWorld(lat, lon));
  const gaps = towers.slice(1).map(([x, z], i) => Math.hypot(x - towers[i][0], z - towers[i][1]));
  for (const g of gaps) assert.ok(g > 95 && g < 125, `towers ~110 m apart (${g.toFixed(0)})`);
  const park = MBS.skyPark.map(([lat, lon]) => toWorld(lat, lon));
  let len = 0;
  for (let i = 1; i < park.length; i++) len += Math.hypot(park[i][0] - park[i - 1][0], park[i][1] - park[i - 1][1]);
  assert.ok(len > 320 && len < 360, `the SkyPark is ~340 m long (${len.toFixed(0)})`);
  assert.equal(FLYER.hubHeight + FLYER.radius, 165, '165 m to the top of the wheel');
  assert.equal(FLYER.capsules, 28);
});
