const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

class BufferAttribute {
  constructor(array) { this.array = array; }
  setUsage() { return this; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, a) { this.attributes[name] = a; }
}
class LineSegments { constructor(geometry, material) { Object.assign(this, { geometry, material }); } }
class LineBasicNodeMaterial { constructor(o) { Object.assign(this, o); } }
const cityUniforms = { uRoadWetness: { value: 0.3 } };
const { Weather } = loadModule(readFileSync(join(__dirname, '../js/weather.js'), 'utf8'), {
  imports: {
    'three/webgpu': { BufferAttribute, BufferGeometry, LineSegments, LineBasicNodeMaterial, DynamicDrawUsage: 1 },
    './tsl-materials.js': { cityUniforms }
  },
  globals: { Math, Float32Array }
});

function harness() {
  const scene = { added: [], add(o) { this.added.push(o); }, environmentIntensity: 0.5, fog: { density: 0.0002 } };
  const lighting = {
    activePresetId: 'midday',
    sunLight: { intensity: 6 },
    hemiLight: { intensity: 1.2 },
    uFogDensity: { value: 0.0002 },
    sky: { cloudCoverage: { value: 0.3 }, cloudDensity: { value: 0.4 } }
  };
  const strikes = [];
  const weather = new Weather(scene, lighting, { onLightning: (d) => strikes.push(d) });
  const camera = { position: { x: 10, y: 2, z: -30 } };
  return { scene, lighting, strikes, weather, camera };
}

test('a storm rolls in: darker, hazier, wet roads, rain around the camera, lightning with its distance', () => {
  const { lighting, strikes, weather, camera, scene } = harness();
  weather.setStorm(true);
  for (let i = 0; i < 20 * 30; i++) weather.update(1 / 30, camera);
  assert.equal(weather.storm, 1);
  assert.ok(Math.abs(lighting.sunLight.intensity - 6 * 0.18) < 1e-9);
  assert.ok(lighting.uFogDensity.value > 0.0002 * 3);
  assert.ok(cityUniforms.uRoadWetness.value >= 0.95 - 1e-9);
  assert.equal(weather.rain.visible, true);
  assert.ok(scene.added.includes(weather.rain));
  assert.ok(strikes.length >= 1, 'lightning in 20 s of storm');
  for (const d of strikes) assert.ok(d >= 300 && d <= 7300);
  const p = weather.positions;
  for (let i = 0; i < p.length; i += 6) {
    assert.ok(Math.abs(p[i] - camera.position.x) <= 35 && Math.abs(p[i + 2] - camera.position.z) <= 35, 'drops around the camera');
    assert.ok(p[i + 4] < p[i + 1], 'streaks fall downwards');
  }
});

test('when it clears the time of day\'s own light comes back, also when cleared at once', () => {
  for (const immediate of [false, true]) {
    const { lighting, weather, camera } = harness();
    cityUniforms.uRoadWetness.value = 0.3;
    weather.setStorm(true, true);
    weather.update(0.1, camera);
    assert.ok(lighting.sunLight.intensity < 2);
    weather.setStorm(false, immediate);
    for (let i = 0; i < 30 * 30; i++) weather.update(1 / 30, camera);
    assert.equal(weather.storm, 0);
    assert.equal(lighting.sunLight.intensity, 6);
    assert.equal(lighting.uFogDensity.value, 0.0002);
    assert.equal(lighting.sky.cloudCoverage.value, 0.3);
    assert.equal(cityUniforms.uRoadWetness.value, 0.3);
    assert.equal(weather.rain.visible, false);
  }
});
