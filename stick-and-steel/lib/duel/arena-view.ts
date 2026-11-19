import * as T from 'three';
import { PIT_SPIKES, SPIKE_RADIUS, SPIKE_HEIGHT } from './hazards';
import { ARENAS } from './arena';

/** The pit is scenery around one continuous, unguarded physical fighting surface. */
export function createPitArena() {
  const group = new T.Group(), geometries: T.BufferGeometry[] = [], materials: T.Material[] = [];
  group.name = 'The Splinter Pit';
  const instances: T.InstancedMesh[] = [];
  const pencil: number[] = [], crowdInk: number[] = [];
  const spectators: { a: number; r: number; y: number; scale: number; phase: number; lift: number }[] = [];
  function stroke(points: number[][], target = pencil) {
    for (let i = 1; i < points.length; i++) target.push(...points[i - 1], ...points[i]);
  }
  function inkMesh(points: number[], color: string, opacity: number) {
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
    const mat = new T.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const lines = new T.LineSegments(geometry, mat);
    geometries.push(geometry); materials.push(mat); group.add(lines); return lines;
  }
  const material = (color: string, roughness = .9) => { const m = new T.MeshStandardMaterial({ color, roughness }); materials.push(m); return m; };
  const stone = material('#f0eee9'), darkStone = material('#d6d4d0'), sand = material('#e1dfda');
  const timber = material('#e3e0d9'), timberLight = material('#f4f1ea'), endgrain = material('#c5c2ba');
  const iron = material('#aaa79e', .64), red = material('#9e392d'), ochre = material('#ba945d');
  function mesh(g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0) {
    geometries.push(g); const object = new T.Mesh(g, m); object.position.set(x, y, z); object.castShadow = object.receiveShadow = true; group.add(object); return object;
  }
  function box(w: number, h: number, d: number, x: number, y: number, z: number, m: T.Material) { return mesh(new T.BoxGeometry(w, h, d), m, x, y, z); }
  const { halfX, halfZ } = ARENAS.bridge;
  // The deck and its support must not share side faces. The support is inset
  // and its top is below the underside of the planks (previously both overlapped).
  box(halfX * 2, .40, halfZ * 2 - .06, 0, -.28, 0, endgrain).name = 'inset deck support';
  const count = 30, width = halfX * 2 / count;
  for (let i = 0; i < count; i++) {
    const x = -halfX + width * (i + .5);
    box(width - .012, .07, halfZ * 2, x, -.035, 0, i % 4 === 0 ? timberLight : timber).name = 'deck plank';
    for (const z of [-halfZ + .07, halfZ - .07]) mesh(new T.CylinderGeometry(.012, .012, .006, 7), iron, x, .003, z);
    // Sparse pen marks sit above the surface; no coplanar decal planes.
    for (let j = 0; j < 3; j++) {
      const sx = x + (j - 1) * width * .21, start = -.39 + ((i * 7 + j * 3) % 8) * .035;
      stroke([[sx, .011, start], [sx + .007, .011, start + .18], [sx - .004, .011, start + .32 + (i % 3) * .07]]);
    }
    if (i % 3 === 0) stroke([[x - .10, .011, .22], [x - .08, .011, .30], [x - .10, .011, .36]]);
    for (const z of [-halfZ - .003, halfZ + .003]) stroke([[x - width * .4, -.02, z], [x, -.018, z], [x + width * .4, -.022, z]]);
  }
  for (const z of [-halfZ + .06, halfZ - .06]) box(halfX * 2, .17, .09, 0, -.48, z, timber);
  // Iron straps and low diagonal braces stay below the playable edge.
  for (const x of [-3.5, -1.7, 1.7, 3.5]) {
    box(.08, .025, halfZ * 2 + .025, x, -.495, 0, iron);
    for (const z of [-.27, .27]) box(.19, 5.7, .19, x, -3.3, z, timber);
    const brace = box(.13, 1.1, .13, x, -1.1, 0, timberLight); brace.rotation.z = Math.PI / 4;
  }
  mesh(new T.CylinderGeometry(12, 12, .3, 80), sand, 0, -7.15, 0);
  for (let tier = 0; tier < 4; tier++) {
    const radius = 8.8 + tier * .85, y = -.8 + tier * .65;
    const tread = mesh(new T.RingGeometry(radius, radius + .85, 96), stone, 0, y, 0); tread.rotation.x = -Math.PI / 2;
    mesh(new T.CylinderGeometry(radius, radius, .65, 96, 1, true), tier % 2 ? stone : darkStone, 0, y - .325, 0);
    // Quiet, solid terraces: no drawn seat boxes or double lines around people.
  }
  // Individual stone courses break up the tall arena wall without per-block draw calls.
  const blockGeometry = new T.BoxGeometry(.99, .59, .34); geometries.push(blockGeometry);
  const blocks = new T.InstancedMesh(blockGeometry, stone, 54 * 10), dummy = new T.Object3D();
  let index = 0;
  for (let row = 0; row < 10; row++) for (let i = 0; i < 54; i++) {
    const a = (i + (row % 2) * .5) / 54 * Math.PI * 2;
    dummy.position.set(Math.sin(a) * 8.6, -6.75 + row * .61, Math.cos(a) * 8.6); dummy.rotation.set(0, a, 0); dummy.updateMatrix();
    blocks.setMatrixAt(index, dummy.matrix); blocks.setColorAt(index++, new T.Color().setHSL(.10, .02, .90 + ((i * 17 + row * 7) % 9) * .008));
  }
  blocks.castShadow = blocks.receiveShadow = true; group.add(blocks); instances.push(blocks);
  // Small cracks and hatched corners make the stone read like an ink drawing.
  for (let row = 0; row < 10; row++) for (let j = 0; j < 27; j++) {
    const a = (j * 2 + (row % 2) * .5) / 54 * Math.PI * 2, y = -6.55 + row * .61;
    const point = (side: number, height: number) => [Math.sin(a) * 8.405 + Math.cos(a) * side, y + height, Math.cos(a) * 8.405 - Math.sin(a) * side];
    for (let h = 0; h < 3; h++) stroke([point(-.38 + h * .065, -.40), point(-.27 + h * .065, -.29)]);
    if ((j + row) % 4 === 0) stroke([point(.04, -.06), point(.12, -.15), point(.08, -.21), point(.16, -.26)]);
  }
  // Banners above the ring echo the fighters' simple, graphic silhouettes.
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, x = Math.sin(a) * 10.9, z = Math.cos(a) * 10.9;
    box(.06, 2.4, .06, x, 2.7, z, iron);
    const flag = new T.Shape(); flag.moveTo(-.31, .55); flag.lineTo(.31, .55); flag.lineTo(.29, -.40); flag.lineTo(0, -.62); flag.lineTo(-.30, -.39); flag.closePath();
    const flagMat = (i % 2 ? ochre : red).clone(); flagMat.side = T.DoubleSide; materials.push(flagMat);
    const banner = mesh(new T.ShapeGeometry(flag), flagMat, x, 2.8, z); banner.rotation.y = a;
    const poleTop = mesh(new T.SphereGeometry(.075, 8, 6), iron, x, 3.96, z); poleTop.castShadow = false;
    const local = (sx: number, sy: number, sz = -.025) => [x + Math.cos(a) * sx + Math.sin(a) * sz, 2.8 + sy, z - Math.sin(a) * sx + Math.cos(a) * sz];
    stroke([local(-.25, .48), local(.24, .48), local(.22, -.33), local(0, -.51), local(-.24, -.33), local(-.25, .48)]);
  }
  for (const x of [-6.6, 6.6]) {
    box(1.7, 7, 2.7, x, -3.5, 0, darkStone);
    box(1.8, .18, 2.85, x, .04, 0, stone);
    for (const z of [-1.05, 1.05]) box(.42, 2.2, .42, x, 1.1, z, stone);
    // Eleven separate voussoirs form an actual arch above the two entry piers.
    for (let i = 0; i < 11; i++) {
      const a = i / 10 * Math.PI;
      const block = box(.5, .32, .39, x, 2.12 + Math.sin(a) * 1.04, Math.cos(a) * 1.04, i % 3 ? stone : timberLight);
      block.rotation.x = -a;
    }
    for (const z of [-1.05, 1.05]) {
      box(.58, .14, .60, x, .15, z, stone); box(.58, .16, .60, x, 2.04, z, timberLight);
      for (let j = 1; j < 5; j++) stroke([[x - Math.sign(x) * .218, j * .39, z - .19], [x - Math.sign(x) * .218, j * .39 + .005, z + .19]]);
    }
  }
  // A frustum + tip meet at one ring. The old full cone underneath the tip
  // duplicated every red face, causing the checkerboard seen from above.
  const tipHeight = SPIKE_HEIGHT * .22, baseHeight = SPIKE_HEIGHT - tipHeight;
  const spikeGeo = new T.CylinderGeometry(SPIKE_RADIUS * .22, SPIKE_RADIUS, baseHeight, 5, 1, true), tipGeo = new T.ConeGeometry(SPIKE_RADIUS * .22, tipHeight, 5, 1, true);
  geometries.push(spikeGeo, tipGeo);
  const spikes = new T.InstancedMesh(spikeGeo, material('#a6a5a1'), PIT_SPIKES.length);
  const tips = new T.InstancedMesh(tipGeo, material('#913c36'), PIT_SPIKES.length);
  PIT_SPIKES.forEach((p, i) => { dummy.position.set(p.x, p.y - tipHeight / 2, p.z); dummy.rotation.set(0, (i % 5) * .4, 0); dummy.updateMatrix(); spikes.setMatrixAt(i, dummy.matrix); dummy.position.y = p.y + baseHeight / 2; dummy.updateMatrix(); tips.setMatrixAt(i, dummy.matrix); });
  spikes.name = 'spike bases'; tips.name = 'spike tips';
  spikes.castShadow = spikes.receiveShadow = true; tips.castShadow = true; group.add(spikes, tips); instances.push(spikes, tips);

  // Low stone plinths organize the hazards and give the pit a deliberate shape.
  for (const z of [-3.35, 3.35]) box(10.9, .13, .17, 0, -6.935, z, darkStone);
  for (const x of [-5.45, 5.45]) box(.17, .13, 6.7, x, -6.935, 0, darkStone);
  // Drain channels, scattered chips and fallen practice shafts below the span.
  for (let i = 0; i < 34; i++) {
    const a = i * 2.39996, r = 5.7 + (i % 5) * .36;
    const chip = box(.08 + (i % 3) * .07, .04, .13, Math.sin(a) * r, -6.97, Math.cos(a) * r, i % 2 ? stone : darkStone); chip.rotation.y = a;
  }
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * .96;
    stroke([[x, -6.987, -5.8], [x + .03, -6.987, -4.7], [x - .02, -6.987, -3.8]]);
  }

  // Bodies stay in one quiet ink batch; only the arm buffer moves.
  for (let row = 0; row < 3; row++) for (let i = 0; i < 48; i++) {
    if ((i + row * 3) % 7 === 0 || i % 12 === 0) continue; // aisles + empty seats
    const a = (i + row * .33) / 48 * Math.PI * 2, r = 8.9 + row * .85;
    const scale = .85 + (i % 4) * .06;
    // Hips rest on the actual tread; feet hang over its inner edge.
    const y = -.8 + row * .65 + .025 - .26 * scale;
    const p = (x: number, h: number, depth = 0) => [Math.sin(a) * (r + depth) + Math.cos(a) * x * scale, y + h * scale, Math.cos(a) * (r + depth) - Math.sin(a) * x * scale];
    const draw = (pts: number[][]) => stroke(pts, crowdInk);
    draw(Array.from({ length: 17 }, (_, j) => p(Math.cos(j / 16 * Math.PI * 2) * .085, .61 + Math.sin(j / 16 * Math.PI * 2) * .10)));
    draw([p(0, .50), p((i % 3 - 1) * .03, .26), p(-.10, .12, -.10), p(-.12, -.09, -.17)]);
    draw([p(0, .26), p(.10, .12, -.10), p(.12, -.09, -.17)]);
    spectators.push({ a, r, y, scale, phase: i * 2.39996 + row * 1.7, lift: 0 });
  }
  // Rope bunting around the upper ring, scalloped between the banner poles.
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, b = (i + 1) / 8 * Math.PI * 2;
    const start = new T.Vector3(Math.sin(a) * 10.9, 3.75, Math.cos(a) * 10.9), end = new T.Vector3(Math.sin(b) * 10.9, 3.75, Math.cos(b) * 10.9);
    stroke(Array.from({ length: 25 }, (_, j) => { const t = j / 24, p = start.clone().lerp(end, t); p.y -= Math.sin(t * Math.PI) * .65; return p.toArray(); }));
    for (let j = 1; j < 10; j++) {
      const t = j / 10, p = start.clone().lerp(end, t); p.y -= Math.sin(t * Math.PI) * .65;
      const flag = new T.BufferGeometry().setFromPoints([new T.Vector3(-.11, 0, 0), new T.Vector3(.11, 0, 0), new T.Vector3(.015, -.28, 0)]);
      flag.computeVertexNormals();
      const mat = (j % 3 === 0 ? red : j % 3 === 1 ? ochre : timberLight).clone(); mat.side = T.DoubleSide; materials.push(mat);
      const pennant = mesh(flag, mat, p.x, p.y, p.z); pennant.rotation.y = (a + b) / 2; pennant.castShadow = false;
    }
  }
  inkMesh(pencil, '#6d675a', .27); inkMesh(crowdInk, '#817d72', .66).name = 'crowd bodies';
  const arms = inkMesh(Array.from({ length: spectators.length * 24 }, () => 0), '#817d72', .66); arms.name = 'crowd arms'; arms.frustumCulled = false;
  const armPositions = arms.geometry.getAttribute('position') as T.BufferAttribute; armPositions.setUsage(T.DynamicDrawUsage);
  let crowdTime = 0, reaction = 0, crowdTick = 0;
  function update(dt: number, animate = true) {
    crowdTime += dt; reaction *= Math.exp(-dt * 1.1); crowdTick += dt;
    if (dt > 0 && crowdTick < .05) return;
    const elapsed = crowdTick; crowdTick = 0;
    let index = 0;
    for (const person of spectators) {
      const { a, r, y, scale, phase } = person, t = animate ? crowdTime : 0;
      const wave = Math.pow(Math.max(0, Math.sin(t * .48 + phase)), 6);
      const target = animate ? Math.max(wave * .85, reaction * (.7 + .3 * Math.sin(phase) ** 2)) : wave * .6;
      person.lift = dt && animate ? T.MathUtils.lerp(person.lift, target, 1 - Math.exp(-elapsed * 5)) : target;
      const vertex = (x: number, h: number, depth: number) => armPositions.setXYZ(index++, Math.sin(a) * (r + depth) + Math.cos(a) * x * scale, y + h * scale, Math.cos(a) * (r + depth) - Math.sin(a) * x * scale);
      for (const side of [-1, 1]) {
        const upper = .75 + person.lift * (1.58 + Math.sin(t * 2.8 + phase + side) * .13);
        const lower = -.10 + person.lift * (3.05 + Math.sin(t * 3.4 + phase - side) * .27);
        const ex = side * Math.sin(upper) * .22, ey = .44 - Math.cos(upper) * .22;
        const hx = ex + side * Math.sin(lower) * .19, hy = ey - Math.cos(lower) * .19;
        vertex(0, .44, 0); vertex(ex, ey, -.025);
        vertex(ex, ey, -.025); vertex(hx, hy, -.05);
      }
    }
    armPositions.needsUpdate = true;
  }
  update(0);
  // Ivory miniature scenery keeps the colored ink figures legible. Generated
  // texture originals remain in assets for future material experiments.
  return { group, timber, stone, sand, update, react(strength = 1) { reaction = Math.max(reaction, T.MathUtils.clamp(strength, 0, 1)); }, dispose() { instances.forEach(m => m.dispose()); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } };
}
