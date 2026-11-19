import * as THREE from 'three/webgpu';
import { Fn, uv, vec3, float, mix, step, fract, abs, smoothstep, sin, attribute } from 'three/tsl';
import { GEO } from './geodata.js';

// js/airbases.js
// Singapore's runways, for the F-15SG (js/jet-flight.js) to take off from and land on: Paya Lebar Air Base (home of
// the RSAF's two F-15SG squadrons, 142 and 149), Tengah Air Base, Changi's three and Seletar, from OpenStreetMap's
// aeroway=runway ways (their ends, as surveyed). Each is drawn as one flat strip painted in the shader: edge lines,
// the centreline's 30 m dashes, threshold piano keys and aiming-point bars at both ends, a little rubber in the
// touchdown zones. All in one mesh.
// createAirbases(scene) returns { group, runways: [{ id, name, x, z, heading, length, width, ends }], home } or
// null for a city without them; `home` is where the jet starts (Paya Lebar's runway 02 threshold).

const RUNWAYS = {
  singapore: [
    { id: 'paya-lebar', name: 'Paya Lebar Air Base', ref: '02/20', a: [1.344663, 103.9028186], b: [1.3761572, 103.9162087], width: 61, home: true },
    { id: 'tengah', name: 'Tengah Air Base', ref: '18/36', a: [1.3998739, 103.7093005], b: [1.3752884, 103.7072131], width: 46 },
    { id: 'changi-02l', name: 'Changi Airport', ref: '02L/20R', a: [1.348954, 103.9774596], b: [1.3822403, 103.9914946], width: 60 },
    { id: 'changi-02c', name: 'Changi Airport', ref: '02C/20C', a: [1.3287993, 103.9849668], b: [1.3619499, 103.9989657], width: 60 },
    { id: 'changi-02r', name: 'Changi Airport', ref: '02R/20L', a: [1.3223944, 103.9998434], b: [1.3561785, 104.0141068], width: 60 },
    { id: 'changi-east', name: 'Changi East', ref: '03/21', a: [1.3154817, 104.0125677], b: [1.3458933, 104.0254191], width: 60 },
    { id: 'seletar', name: 'Seletar Airport', ref: '03/21', a: [1.4082235, 103.8619483], b: [1.4228058, 103.8714888], width: 43 }
  ]
};

// lat/lon -> the world frame (tools/city/frame.mjs; as js/singapore-landmarks.js): x grid east, z grid south
function makeToWorld(frame) {
  const A = 6378137.0, E2 = 6.69437999014e-3;
  const phi = (frame.lat0 * Math.PI) / 180;
  const s0 = Math.sin(phi);
  const KX = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * s0 * s0)) * Math.cos(phi);
  const KY = (Math.PI / 180) * ((A * (1 - E2)) / Math.pow(1 - E2 * s0 * s0, 1.5));
  const th = ((frame.bearingDeg || 0) * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  return (lat, lon) => {
    const e = (lon - frame.lon0) * KX, n = (lat - frame.lat0) * KY;
    return [e * c - n * s, -(e * s + n * c)];
  };
}

/** The runways of a city in the world frame (pure: for tests) */
function runwaysFor(cityId, frame) {
  const list = RUNWAYS[cityId];
  if (!list || !frame) return [];
  const toWorld = makeToWorld(frame);
  return list.map((r) => {
    const [ax, az] = toWorld(...r.a), [bx, bz] = toWorld(...r.b);
    const length = Math.hypot(bx - ax, bz - az);
    return {
      id: r.id, name: r.name, ref: r.ref, width: r.width, home: !!r.home, length,
      x: (ax + bx) / 2, z: (az + bz) / 2,
      heading: Math.atan2(bx - ax, bz - az), // from end a towards end b
      ends: [[ax, az], [bx, bz]]
    };
  });
}

function runwayMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  const paint = Fn(() => {
    const p = uv(); // x across (m, from the centreline), y along (m, from end a)
    const len = attribute('runwayLength', 'float');
    const half = attribute('runwayHalf', 'float');
    const u = abs(p.x), v = p.y;
    const fromEnd = v.min(len.sub(v));
    const edge = step(half.sub(1.6), u).mul(step(u, half.sub(0.7)));
    const centre = step(u, 0.45).mul(step(fract(v.div(50)), 0.6)).mul(step(140, fromEnd));
    const keys = step(fromEnd, 54).mul(step(6, fromEnd)).mul(step(fract(u.div(3.6)), 0.5)).mul(step(u, half.sub(4))).mul(step(1.8, u));
    const aiming = step(400, fromEnd).mul(step(fromEnd, 460)).mul(step(6, u)).mul(step(u, 15));
    const white = edge.add(centre).add(keys).add(aiming).min(1);
    // rubber in the touchdown zones, and a little mottling
    const rubber = smoothstep(900, 300, fromEnd).mul(smoothstep(14, 2, u)).mul(0.5);
    const mottle = sin(v.mul(0.13).add(sin(p.x.mul(0.7)))).mul(0.015);
    const asphalt = vec3(0.2, 0.2, 0.21).mul(float(1).sub(rubber)).add(mottle);
    return mix(asphalt, vec3(0.86, 0.87, 0.86), white);
  });
  m.colorNode = paint();
  return m;
}

function createAirbases(scene, cityId = 'singapore', frame = GEO.frame) {
  const runways = runwaysFor(cityId, frame);
  if (!runways.length) return null;
  const pos = [], uvs = [], len = [], half = [], idx = [];
  for (const r of runways) {
    const [[ax, az], [bx, bz]] = r.ends;
    const dx = (bx - ax) / r.length, dz = (bz - az) / r.length;
    const w = r.width / 2;
    // across: (dz, -dx), uv x positive that way
    const base = pos.length / 3;
    for (const [s, t] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      const ex = ax + (bx - ax) * t, ez = az + (bz - az) * t;
      pos.push(ex + dz * w * s, 0.03, ez - dx * w * s);
      uvs.push(w * s, r.length * t);
      len.push(r.length);
      half.push(w);
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('runwayLength', new THREE.Float32BufferAttribute(len, 1));
  g.setAttribute('runwayHalf', new THREE.Float32BufferAttribute(half, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, runwayMaterial());
  mesh.name = 'Runways';
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = 'Airbases';
  group.add(mesh);
  scene.add(group);
  const homeRunway = runways.find((r) => r.home) || runways[0];
  const [[hx, hz]] = homeRunway.ends;
  // lined up on the threshold, 80 m in
  const home = {
    x: hx + Math.sin(homeRunway.heading) * 80, z: hz + Math.cos(homeRunway.heading) * 80,
    heading: homeRunway.heading, name: `${homeRunway.name}, runway ${homeRunway.ref.split('/')[0]}`
  };
  return { group, runways, home };
}

export { createAirbases, runwaysFor, RUNWAYS };
