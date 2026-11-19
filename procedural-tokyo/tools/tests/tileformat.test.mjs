// Tile format round trip, plus sanity checks over the compiled area when it exists.
// Usage: node tools/tests/tileformat.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { encodeTile, decodeTile, AREA, BFLAG, PROP } from '../../src/shared/tileformat.js';
import { meshCode3, meshBounds3, meshBlock } from '../../src/shared/geo.js';
import { ROOT } from '../pipeline/config.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('encode -> decode round trip', () => {
  const square = [[0, 0], [10, 0], [10, -10], [0, -10]], hole = [[2, -2], [2, -8], [8, -8], [8, -2]];
  const tile = {
    tx: -3, tz: 7,
    buildings: [{ usage: 412, storeys: 5, flags: BFLAG.LOD2, base: 31.25, height: 16.5, measuredHeight: 16.9, polygons: [[square, hole]] }],
    areas: [{ kind: AREA.SIDEWALK, code: 2000, polygons: [[square]] }],
    props: [{ kind: PROP.POLE, variant: 1, rot: Math.PI / 2, x: 3.5, z: -4.25, scale: 1.25 }],
    wires: [[0, 0, 30, -2.5]],
  };
  const out = decodeTile(encodeTile(tile).slice().buffer);
  assert.equal(out.tx, -3); assert.equal(out.tz, 7);
  const b = out.buildings[0];
  assert.deepEqual([b.usage, b.storeys, b.flags, b.base, b.height], [412, 5, BFLAG.LOD2, 31.25, 16.5]);
  assert.ok(Math.abs(b.measuredHeight - 16.9) < 1e-5);
  assert.deepEqual([...b.polygons[0][1]], hole.flat());
  assert.deepEqual([out.areas[0].kind, out.areas[0].code, [...out.areas[0].polygons[0][0]]], [AREA.SIDEWALK, 2000, square.flat()]);
  const p = out.props[0];
  assert.deepEqual([p.kind, p.variant, p.x, p.z, p.scale], [PROP.POLE, 1, 3.5, -4.25, 1.25]);
  assert.ok(Math.abs(p.rot - Math.PI / 2) < 1e-3);
  assert.deepEqual([...out.wires], [0, 0, 30, -2.5]);
});

test('JIS mesh codes', () => {
  assert.equal(meshCode3(139.70045, 35.65948), '53393596'); // Shibuya Scramble Crossing
  const b = meshBounds3('53393596');
  assert.ok(b.south <= 35.65948 && 35.65948 < b.north && b.west <= 139.70045 && 139.70045 < b.east);
  const block = meshBlock(139.70045, 35.65948, 1);
  assert.equal(new Set(block).size, 9);
  assert.ok(block.includes('53394506') && block.includes('53393585'));
});

const dir = path.join(ROOT, 'public/tiles/shibuya');
if (fs.existsSync(path.join(dir, 'manifest.json'))) {
  test('compiled shibuya tiles are well formed', () => {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const areaEN = (r) => { let s = 0; for (let i = 0, n = r.length / 2; i < n; i++) { const j = (i + 1) % n; s += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1]; } return s / 2; };
    let nB = 0;
    for (const tl of m.tiles) {
      const t = decodeTile(new Uint8Array(fs.readFileSync(path.join(dir, tl.file))).buffer);
      assert.equal(t.buildings.length, tl.buildings);
      assert.equal(t.props.length, tl.props);
      for (const p of t.props) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && p.scale > 0);
      for (const b of t.buildings) {
        nB++;
        assert.ok(b.height > 0.5 && b.height < 400 && b.base > -10 && b.base < 100, `building height/base ${b.height}/${b.base}`);
        for (const rings of b.polygons) {
          rings.forEach((r, i) => {
            assert.ok(r.length >= 6 && r.every(Number.isFinite));
            assert.ok(i === 0 ? areaEN(r) > 0 : areaEN(r) < 0, 'outer rings CCW, holes CW');
          });
        }
      }
    }
    const terrain = new Float32Array(fs.readFileSync(path.join(dir, m.terrain.file)).buffer.slice(0));
    assert.equal(terrain.length, m.terrain.w * m.terrain.h);
    assert.ok(terrain.every(Number.isFinite));
    const roads = JSON.parse(fs.readFileSync(path.join(dir, m.roads), 'utf8'));
    for (const e of roads.edges) assert.ok(e.a < roads.nodes.length && e.b < roads.nodes.length && e.pts.length >= 6);
    console.log(`      ${m.tiles.length} tiles, ${nB} buildings, ${roads.edges.length} road edges checked`);
  });
} else console.log('skip  compiled tiles (run npm run fetch && npm run compile)');

console.log(`${passed} passed`);
