// ?shot=matboard: every material on a 2 m panel and a sphere, standing on the asphalt, under one
// sodium lamp, a cold fill and a generated night environment (G.sky.envMap is used instead once it
// exists). Stations are laid out in three rows.
//   &mbs=<index|name>   pick a station (default: overview of the whole board)
//   &mbd=mid|near|sphere|graze|far|farzoom   camera distance for that station
//   &mbs=body&mbd=0.5|3|10  the body-part forms (&mbbody=<skin|cloth kind>, &mbwound=1)
//   window.__matboardGpu()  per-material GPU cost
//   &mbwet=<0..1>  &mbrain=<0..1>   override the shared wetness / rain
//   &mblight=white   neutral key light (albedo check)   &mbshadow=0   no lamp shadow
// The overlay reports the number of shader programs and the first-frame (compile) time.
import {
  Group, Mesh, BoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, SpotLight, HemisphereLight,
  DirectionalLight, Color, Scene, ShaderMaterial, MeshBasicMaterial, BackSide, PMREMGenerator,
  SkinnedMesh, Skeleton, Bone, Float32BufferAttribute, Uint16BufferAttribute, InstancedMesh, Matrix4,
  LatheGeometry, Vector2, Vector3, WebGLRenderTarget, MathUtils, MeshStandardMaterial,
} from 'three';

const BODY = [-3, 7.5];

// Body-part forms for judging skin and cloth: a torso-like barrel, a forearm-like tapered tube with
// a hand-sized end, a head-sized ellipsoid. &mbbody=skin|denim|flannel|canvas|hivis|jersey|leather
// dresses the torso and sleeve; &mbwound=1 adds placed wounds, blood, a rip and wear.
function bodyForms(mats, q) {
  const what = q.get('mbbody') || 'skin';
  const hurt = q.get('mbwound') === '1';
  const g = new Group();
  const lathe = (pts, squash) => {
    const fine = [];
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 8; k++) fine.push(new Vector2(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / 8, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / 8));
    fine.push(new Vector2(...pts[pts.length - 1]));
    const geo = new LatheGeometry(fine, 64);
    geo.scale(1, 1, squash);
    geo.computeVertexNormals();
    // metric UVs: u = distance around, v = distance up
    const rAvg = pts.reduce((a, b) => a + b[0], 0) / pts.length * (1 + squash) / 2;
    const w = 2 * Math.PI * rAvg, h = pts[pts.length - 1][1] - pts[0][1];
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
    return { geo, w, h };
  };
  const torso = lathe([[0.13, -0.3], [0.165, -0.22], [0.16, -0.02], [0.185, 0.16], [0.2, 0.25], [0.15, 0.3], [0.07, 0.32]], 0.72);
  const arm = lathe([[0.027, -0.14], [0.03, -0.1], [0.04, 0.0], [0.047, 0.1], [0.044, 0.14]], 0.9);
  const near = (x, y, z, c, r) => Math.max(0, 1 - Math.hypot(x - c[0], y - c[1], z - c[2]) / r);
  const armDown = new Vector3(0, -1, 0).applyAxisAngle(new Vector3(0, 0, 1), -0.5);
  const skin = (o) => mats.skin({ rot: 0.45, seed: 31, ...o });
  let torsoMat, armMat;
  if (what === 'skin') {
    torsoMat = skin({ lividity: [-0.3, 0.1], wounds: hurt ? [{ pos: [0.05, 0.1, 0.125], r: 0.08 }] : [], stains: hurt ? [{ pos: [-0.07, 0.2, 0.12], r: 0.05 }] : [] });
    armMat = skin({ lividity: [-0.2, 0.02], down: armDown.toArray(), wounds: hurt ? [{ pos: [0.01, 0.03, 0.04], r: 0.045 }] : [] });
  } else {
    const c = (o) => mats.cloth({ kind: what, seed: 17, uv: true, ...o });
    torsoMat = c({ panel: [torso.w, torso.h], pockets: [{ u: torso.w - 0.2, v: 0.2, w: 0.11, h: 0.12 }], stripes: { y: [-0.12, 0.08], halfWidth: 0.025, x: 0 },
      stains: hurt ? [{ pos: [-0.07, 0.12, 0.115], r: 0.09 }] : [] });
    armMat = c({ panel: [arm.w, arm.h], down: armDown.toArray(), wearAt: hurt ? [{ u: arm.w * 0.25, v: 0.2, r: 0.07, amount: 0.9 }] : [], stripes: { y: [0, 0], halfWidth: 0 } });
    mats.bakeRest(torso.geo, { masks: {
      tear: hurt ? (x, y, z) => Math.min(1, 1.6 * near(x, y, z, [-0.04, -0.17, 0.105], 0.1)) : 0,
      fold: (x, y) => Math.max(0, 1 - Math.abs(y + 0.1) / 0.05) * 0.8,
    } });
    mats.bakeRest(arm.geo, { masks: { fold: (x, y) => Math.max(0, 1 - Math.abs(y - 0.02) / 0.03) } });
  }
  const tm = new Mesh(torso.geo, torsoMat); tm.position.set(0, 1.3, 0);
  if (what !== 'skin') {    // a body under the clothes, so rips show flesh rather than the inside of the shirt
    const under = new Mesh(torso.geo.clone().scale(0.96, 1, 0.96), skin({ lividity: [-0.3, 0.1] }));
    under.position.copy(tm.position); g.add(under);
  }
  const am = new Mesh(arm.geo, armMat); am.position.set(0.34, 1.12, 0.06); am.rotation.z = 0.5;
  const handGeo = new SphereGeometry(1, 40, 24); handGeo.scale(0.042, 0.085, 0.022);
  const hand = new Mesh(handGeo, skin({ lividity: [-0.1, 0.05], down: armDown.toArray(), stains: hurt ? [{ pos: [0.0, -0.05, 0.02], r: 0.05 }] : [] }));
  hand.position.copy(am.position).add(new Vector3(0, -0.215, 0).applyAxisAngle(new Vector3(0, 0, 1), 0.5)); hand.rotation.z = 0.5;
  const headGeo = new SphereGeometry(1, 64, 40); headGeo.scale(0.092, 0.118, 0.1);
  // the head takes its wound from the vertex attribute path (a torn cheek), blood from a sphere (mouth)
  mats.bakeRest(headGeo, { masks: { wound: hurt ? (x, y, z) => Math.min(1, 1.5 * near(x, y, z, [0.065, -0.03, 0.07], 0.06)) : 0 } });
  const head = new Mesh(headGeo, skin({ lividity: [-0.12, 0.0], stains: hurt ? [{ pos: [0.0, -0.07, 0.09], r: 0.045 }] : [] }));
  head.position.set(0, 1.76, 0);
  for (const m of [tm, am, hand, head]) { m.castShadow = true; m.receiveShadow = true; mats.castCutShadows(m); g.add(m); }
  g.position.set(BODY[0], 0, BODY[1]);
  return g;
}

// GPU cost per material: a view-filling quad at 1 m, 1920x1080, timed over 20 frames with a
// readback to force completion, minus the same loop with an unlit material.
function gpuCost(G, mats, root, ground, dist = 1) {
  const r = G.renderer, cam = G.camera;
  const rt = new WebGLRenderTarget(1920, 1080);
  const buf = new Uint8Array(4);
  cam.updateMatrixWorld();
  const quad = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0x202020 }));
  const h = 2 * Math.tan(MathUtils.degToRad(cam.fov) / 2);
  quad.scale.set(h * cam.aspect * 1.05, h * 1.05, 1);
  quad.quaternion.copy(cam.quaternion);
  quad.position.copy(cam.position).add(new Vector3(0, 0, -dist).applyQuaternion(cam.quaternion));
  quad.scale.multiplyScalar(dist);
  const hidden = root.children.filter((c) => (c.isMesh || c.isGroup) && c.visible);
  for (const c of hidden) c.visible = false;
  root.add(quad);
  const time = (mat) => {
    quad.material = mat;
    const run = (n) => { for (let i = 0; i < n; i++) { r.setRenderTarget(rt); r.clear(); r.render(G.scene, cam); } r.readRenderTargetPixels(rt, 0, 0, 1, 1, buf); };
    run(2);
    const t0 = performance.now(); run(20);
    return (performance.now() - t0) / 20;
  };
  const base = time(quad.material);
  const list = { 'plain MeshStandardMaterial (reference)': new MeshStandardMaterial({ color: 0x808080, roughness: 0.6 }), asphalt: ground, concrete: mats.concrete({ panel: 1 }), 'concrete painted': mats.concrete({ paint: 0xc8a416 }), paintedMetal: mats.paintedMetal({}),
    glass: mats.glass({}), rubber: mats.rubber({}), chrome: mats.chrome({}), 'gunmetal phosphate': mats.gunmetal({}), 'gunmetal polymer': mats.gunmetal({ finish: 'polymer' }),
    skin: mats.skin({ wounds: [{ pos: [0.2, 0.1, 0], r: 0.2 }] }), 'cloth denim': mats.cloth({ kind: 'denim' }), 'cloth flannel torn': mats.cloth({ kind: 'flannel', torn: 0.5 }),
    'cloth leather': mats.cloth({ kind: 'leather' }), neon: mats.neon({}) };
  const out = { baselineMs: +base.toFixed(2) };
  for (const [name, mat] of Object.entries(list)) out[name] = +(time(mat) - base).toFixed(2);
  root.remove(quad);
  for (const c of hidden) c.visible = true;
  r.setRenderTarget(null);
  rt.dispose();
  return out;
}

// A two-bone bending limb: proves the surface shaders compile with skinning and that rest-space
// detail stays put on a deforming mesh.
function bendingLimb(mat) {
  const geo = new CylinderGeometry(0.09, 0.07, 1.0, 32, 24);
  geo.translate(0, 0.5, 0);
  const pos = geo.getAttribute('position');
  const idx = [], wgt = [];
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - 0.35) / 0.3));
    idx.push(0, 1, 0, 0); wgt.push(1 - t, t, 0, 0);
  }
  geo.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute(wgt, 4));
  const b0 = new Bone(), b1 = new Bone();
  b1.position.y = 0.5; b0.add(b1);
  const mesh = new SkinnedMesh(geo, mat);
  mesh.add(b0);
  mesh.bind(new Skeleton([b0, b1]));
  mesh.frustumCulled = false;
  mesh.userData.elbow = b1;
  return mesh;
}

const COLS = 7, DX = 3.2, DZ = 6;

function stations(mats) {
  return [
    ['asphalt', null],
    ['concrete', () => mats.concrete({ age: 0.7, panel: [1.0, 1.0] })],
    ['concrete painted', () => mats.concrete({ age: 0.5, paint: 0xc8a416, paintWear: 0.6 })],
    ['paintedMetal red', () => mats.paintedMetal({ color: 0xa01c14, wear: 0.4, rust: 0.5 })],
    ['paintedMetal white worn', () => mats.paintedMetal({ color: 0xd8d6cf, wear: 0.85, rust: 0.9, dirt: 0.8 })],
    ['paintedMetal blue fresh', () => mats.paintedMetal({ color: 0x1d3f8a, wear: 0.1, rust: 0.2, dirt: 0.2, roughness: 0.22 })],
    ['glass', () => mats.glass({})],
    ['rubber', () => mats.rubber({})],
    ['chrome', () => mats.chrome({})],
    ['gunmetal phosphate', () => mats.gunmetal({ finish: 'phosphate', wear: 0.55 })],
    ['gunmetal bare', () => mats.gunmetal({ finish: 'bare', brushDir: [1, 0, 0] })],
    ['gunmetal polymer', () => mats.gunmetal({ finish: 'polymer', gripZones: [{ min: [-0.5, -0.2, -1], max: [0.5, 0.6, 1] }] })],
    ['skin', () => mats.skin({ rot: 0.3, seed: 11 })],
    ['skin rotten bloody', () => mats.skin({ tone: 0x8a5a44, rot: 0.85, seed: 23, wounds: [{ pos: [-0.3, 0.35, 0.04], r: 0.3 }, { pos: [0.1, 0.1, 0.4], r: 0.15 }], stains: [{ pos: [0.45, 0.6, 0.04], r: 0.2 }] })],
    ['cloth denim', () => mats.cloth({ kind: 'denim', seed: 3 })],
    ['cloth flannel', () => mats.cloth({ kind: 'flannel', seed: 5 })],
    ['cloth canvas torn', () => mats.cloth({ kind: 'canvas', torn: 0.5, seed: 7 })],
    ['cloth hivis', () => mats.cloth({ kind: 'hivis', seed: 9, stripes: { y: [-0.35, 0.35], halfWidth: 0.025, x: 0.5 } })],
    ['cloth jersey bloody', () => mats.cloth({ kind: 'jersey', seed: 13, stains: [{ pos: [0.2, 0.3, 0.04], r: 0.45 }, { pos: [0, 0.1, 0.4], r: 0.3 }] })],
    ['cloth leather', () => mats.cloth({ kind: 'leather', seed: 15 })],
    ['neon / emissive', null],
  ];
}

const stationPos = (i) => [((i % COLS) - (COLS - 1) / 2) * DX, -Math.floor(i / COLS) * DZ];

function buildEnvironment(renderer) {
  const s = new Scene();
  // night sky: near-black overhead, a low sodium-stained haze at the horizon, dark ground
  s.add(new Mesh(new SphereGeometry(50, 32, 16), new ShaderMaterial({
    side: BackSide,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vD; void main(){
      float y = vD.y;
      vec3 sky = mix(vec3(0.09, 0.06, 0.035), vec3(0.016, 0.02, 0.03), smoothstep(0.0, 0.45, y));
      vec3 gnd = vec3(0.004, 0.004, 0.005);
      gl_FragColor = vec4(mix(gnd, sky, smoothstep(-0.05, 0.02, y)), 1.0); }`,
  })));
  const card = (w, h, col, k, x, y, z) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(col).multiplyScalar(k) }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  card(30, 2.6, 0xdfeaff, 8, 5, 8, -30);       // lit canopy edge
  card(3, 3, 0xff9a3c, 24, 28, 16, 14);          // sodium lamp heads
  card(2.5, 2.5, 0xff9a3c, 18, -30, 13, 22);
  card(9, 3, 0xff2a3a, 2.5, 30, 5, -22);         // a red sign
  const pmrem = new PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0.02, 0.1, 100);
  pmrem.dispose();
  renderer.setRenderTarget(null);
  return rt.texture;
}

export function installMatboard(G, mats) {
  const t0 = performance.now();
  const q = new URLSearchParams(window.location.search);
  if (q.has('mbwet')) mats.shared.uWetness.value = Number(q.get('mbwet'));
  if (q.has('mbrain')) mats.shared.uRain.value = Number(q.get('mbrain'));

  const root = new Group();
  root.name = 'matboard';
  const list = stations(mats);
  const spin = [], limbs = [];

  // ground: lanes, bay lines, a hatched box, skid marks, an oil patch and a puddle at station 0
  const [gx, gz] = stationPos(0);
  const ground = mats.asphalt({
    bounds: [-60, -60, 60, 80],
    puddles: [{ x: gx + 0.3, z: gz + 1.6, r: 1.1, depth: 0.7 }, { x: 2, z: 5, r: 2.2, depth: 0.6 }],
    oil: [{ x: gx - 0.6, z: gz + 1.9, r: 0.7, amount: 1 }],
    lanes: [{ x: 0, z: 4.2, hx: 14, hz: 1.2, amount: 0.9 }],
    marks: [
      { x: gx - 1.1, z: gz + 0.6, length: 2.4, width: 0.12, rot: Math.PI / 2, kind: 'white', wear: 0.45 },
      { x: gx + 1.1, z: gz + 0.6, length: 2.4, width: 0.12, rot: Math.PI / 2, kind: 'white', wear: 0.2 },
      { x: gx, z: gz - 0.9, length: 2.2, width: 0.9, rot: 0, kind: 'hatch', wear: 0.4 },
      { x: 0, z: 3.0, length: 24, width: 0.14, rot: 0, kind: 'yellow', wear: 0.5 },
      { x: gx + 0.4, z: gz + 2.6, length: 4.5, width: 1.5, rot: 0.25, kind: 'skid', wear: 0.2 },
    ],
  });
  const floor = new Mesh(new PlaneGeometry(120, 140), ground);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 10);
  floor.receiveShadow = true;
  root.add(floor);

  const panelGeo = new BoxGeometry(2, 2, 0.08);
  const sphereGeo = new SphereGeometry(0.4, 96, 48);
  list.forEach(([name, make], i) => {
    const [x, z] = stationPos(i);
    if (name === 'asphalt') return;
    if (name === 'neon / emissive') {
      const back = new Mesh(panelGeo, mats.paintedMetal({ color: 0x15171a, wear: 0.3, rust: 0.4 }));
      back.position.set(x, 1, z); root.add(back);
      const tube = new CylinderGeometry(0.012, 0.012, 1.5, 16, 1);
      [[0xff2a3a, 0, 1.55, 0], [0x2ad0ff, 0, 1.25, 0.6], [0xff8a1e, 1, 0.95, 0], [0xff2a3a, 1, 0.65, 0]].forEach(([c, on, y, flicker], k) => {
        const m = new Mesh(tube, mats.neon({ color: c, on: k === 3 ? 0 : 1, flicker, nits: 40, seed: k }));
        m.rotation.z = Math.PI / 2; m.position.set(x, y, z + 0.09); root.add(m);
      });
      const lens = new Mesh(new BoxGeometry(0.9, 0.22, 0.04), mats.emissive({ color: 0xe8f1ff, nits: 50 }));
      lens.position.set(x, 0.3, z + 0.08); root.add(lens);
      return;
    }
    const mat = make();
    const local = !!mat.defines.SURF_LOCAL;
    const panel = new Mesh(panelGeo, mat);
    panel.position.set(x, 1, z);
    panel.castShadow = true; panel.receiveShadow = true;
    const ball = new Mesh(sphereGeo, mat);
    ball.position.set(x - 0.55, 0.4, z + 1.1);
    ball.castShadow = true; ball.receiveShadow = true;
    if (local) spin.push(ball);     // object-space detail must stay glued while this turns
    root.add(panel, ball);
    if (name === 'cloth canvas torn') { mats.castCutShadows(panel); mats.castCutShadows(ball); }
    if (name === 'skin' || name === 'cloth denim') {
      const limb = bendingLimb(mat);
      limb.position.set(x + 0.75, 0, z + 1.1);
      limb.castShadow = true;
      limbs.push(limb);
      root.add(limb);
    }
    if (name === 'concrete painted') {
      const posts = new InstancedMesh(new CylinderGeometry(0.07, 0.07, 0.9, 24, 1), mat, 3);
      for (let k = 0; k < 3; k++) posts.setMatrixAt(k, new Matrix4().makeTranslation(x + 0.45 + k * 0.3, 0.45, z + 1.1));
      posts.castShadow = true;
      root.add(posts);
    }
  });

  // one sodium lamp above and to the side, a cold fill, a trace of moon
  // &mblight=white swaps the sodium key for a neutral one, to judge albedo
  const lamp = new SpotLight(q.get('mblight') === 'white' ? new Color(1.0, 0.96, 0.9) : new Color(1.0, 0.55, 0.16), 2600, 0, 1.0, 0.6, 2);
  lamp.position.set(-7, 10, 9);
  lamp.target.position.set(0, 0.5, -5);
  lamp.castShadow = q.get('mbshadow') !== '0';
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 2; lamp.shadow.camera.far = 60;
  lamp.shadow.bias = -0.003; lamp.shadow.normalBias = 0.12;
  const moon = new DirectionalLight(new Color(0.55, 0.68, 1.0), 0.12);
  moon.position.set(8, 12, -6);
  // cold light from behind the board (stands in for the lit canopy): this is what wet ground and
  // every glossy surface throws back at the camera
  const back = new SpotLight(new Color(0.72, 0.85, 1.0), 1500, 0, 1.1, 0.7, 2);
  back.position.set(5, 7.5, -30);
  back.target.position.set(0, 0, 0);
  if (q.get('mbback') === '0') back.intensity = 0;
  root.add(lamp, lamp.target, back, back.target, moon, new HemisphereLight(0x8fa6c8, 0x08090c, 0.35));

  let env = null;
  const compile = { totalMs: 0, surfaceMs: 0, list: [] };
  if (G.renderer && !G.renderer.stub) {
    G.renderer.shadowMap.enabled = true;
    env = buildEnvironment(G.renderer);
    // Time each program: three links, then blocks on the first status query at first use.
    const gl = G.renderer.getContext();
    const linked = new Map();
    const link = gl.linkProgram.bind(gl), log = gl.getProgramInfoLog.bind(gl), par = gl.getProgramParameter.bind(gl);
    const done = (p) => {
      if (!linked.has(p)) return;
      const ms = performance.now() - linked.get(p);
      linked.delete(p);
      const tp = (G.renderer.info.programs || []).find((x) => x.program === p);
      const key = tp ? String(tp.cacheKey) : '';
      const m = key.match(/surf:(\w+)/);
      const name = m ? `surf:${m[1]}${/SURF_LOCAL/.test(key) ? ':local' : ''}` : (tp && tp.name) || 'other';
      compile.totalMs += ms;
      if (m) compile.surfaceMs += ms;
      compile.list.push([name, Math.round(ms)]);
    };
    gl.linkProgram = (p) => { linked.set(p, performance.now()); link(p); };
    gl.getProgramInfoLog = (p) => { const r = log(p); done(p); return r; };
    gl.getProgramParameter = (p, n) => { const r = par(p, n); done(p); return r; };
  }
  const boot = document.getElementById('boot');
  if (boot) boot.style.display = 'none';
  root.add(bodyForms(mats, q));
  G.scene.add(root);

  // camera
  const pick = q.get('mbs');
  let idx = -1;
  if (pick !== null) idx = /^\d+$/.test(pick) ? Number(pick) : list.findIndex(([n]) => n.replace(/\W+/g, '').toLowerCase().includes(pick.replace(/\W+/g, '').toLowerCase()));
  const dist = q.get('mbd') || 'mid';
  const cx = 0, cz = -DZ;
  let cam = [cx, 6.5, 13.5, 0, -0.42], fov = 62, label = 'overview';
  if (dist === 'far' || dist === 'farzoom') { cam = [cx, 1.7, 60 + cz, 0, 0.0]; fov = dist === 'far' ? 55 : 14; label = `60 m (${dist})`; }
  if (idx >= 0) {
    const [x, z] = stationPos(idx);
    const ground0 = idx === 0;
    label = `${idx} ${list[idx][0]} — ${dist}`;
    if (dist === 'mid') { cam = ground0 ? [x, 1.6, z + 4.6, 0, -0.5] : [x - 0.1, 1.15, z + 3.5, 0, -0.06]; fov = 50; }
    else if (dist === 'near') { cam = ground0 ? [x - 0.9, 0.13, z + 1.0, -0.6, -0.95] : [x + 0.3, 1.2, z + 0.17, 0, 0]; fov = 60; }
    else if (dist === 'sphere') { cam = ground0 ? [x + 0.3, 0.12, z + 2.6, 0.2, -0.3] : [x - 0.55, 0.5, z + 1.1 + 0.4 + 0.13, 0, -0.25]; fov = 60; }
    else if (dist === 'graze') { cam = ground0 ? [x, 0.25, z + 4.0, 0, -0.08] : [x - 0.7, 1.2, z + 0.16, -1.32, 0]; fov = 60; }
    else if (dist === 'far') { cam = [x, 1.7, z + 60, 0, 0]; }
    else if (dist === 'farzoom') { cam = [x, 1.7, z + 60, 0, -0.012]; fov = 5; }
  }
  if (pick === 'body') {
    const d = Number(dist) || 3;
    label = `body ${q.get('mbbody') || 'skin'}${q.get('mbwound') === '1' ? ' wounded' : ''} at ${d} m`;
    cam = d < 1 ? [BODY[0] + 0.2, 1.32, BODY[1] + 0.13 + d, 0, -0.06] : [BODY[0] + 0.08, 1.45, BODY[1] + d, 0, -0.04];
    fov = d < 1 ? 55 : 40;
  }
  G.shotCam = { cam, fov };
  window.__matboardGpu = (dist) => gpuCost(G, mats, root, ground, dist);
  // Do the shadow-pass twins cut the same pixels as the colour pass? Renders the torn canvas panel
  // alone with each and compares coverage.
  window.__matboardCutCheck = () => {
    const mesh = root.children.find((c) => c.isMesh && c.customDepthMaterial);
    const r = G.renderer, rt = new WebGLRenderTarget(512, 512), buf = new Uint8Array(512 * 512 * 4);
    const cam = G.camera.clone();
    cam.position.set(mesh.position.x, mesh.position.y, mesh.position.z + 2.6); cam.rotation.set(0, 0, 0); cam.fov = 45; cam.aspect = 1;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const hidden = root.children.filter((c) => c !== mesh && !c.isLight && c.visible);
    for (const c of hidden) c.visible = false;
    const bg = G.scene.background; G.scene.background = null;
    const cover = (mat) => {
      const keep = mesh.material; mesh.material = mat;
      r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(G.scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, 512, 512, buf);
      mesh.material = keep;
      const m = new Uint8Array(512 * 512);
      for (let i = 0; i < m.length; i++) m[i] = buf[i * 4 + 3] > 127 ? 1 : 0;
      return m;
    };
    const a = cover(mesh.material), b = cover(mesh.customDepthMaterial);
    let na = 0, nb = 0, dab = 0;
    for (let i = 0; i < a.length; i++) { na += a[i]; nb += b[i]; dab += a[i] ^ b[i]; }
    for (const h of hidden) h.visible = true;
    G.scene.background = bg; r.setClearColor(0x000000, 1); r.setRenderTarget(null); rt.dispose();
    return { colourPx: na, depthPx: nb, differ: dab, of: 512 * 512 };
  };

  // overlay
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:10px;top:10px;z-index:50;font:12px/1.45 ui-monospace,Menlo,monospace;color:#e8e3d6;'
    + 'background:rgba(5,7,10,.72);padding:8px 10px;border-radius:4px;white-space:pre;pointer-events:none';
  document.body.appendChild(hud);
  const buildMs = performance.now() - t0;

  // Hide whatever else is in the scene (the level, sky, other lights) while this shot is up, time
  // the first frames, and keep the environment current.
  const prevBefore = G.scene.onBeforeRender, prevAfter = G.scene.onAfterRender;
  let tStart = 0, frame = 0, first = 0, steady = Infinity;
  G.scene.onBeforeRender = function (...a) {
    for (const c of G.scene.children) if (c !== root) c.visible = false;
    const e = (G.sky && G.sky.envMap) || env;
    if (e && G.scene.environment !== e) { G.scene.environment = e; G.scene.background = e; G.scene.backgroundBlurriness = 0.25; }
    for (const b of spin) b.rotation.y = G.time.t * 0.35;
    for (const l of limbs) l.userData.elbow.rotation.z = 0.9 * Math.sin(G.time.t * 1.3);
    tStart = performance.now();
    prevBefore.apply(this, a);
  };
  G.scene.onAfterRender = function (...a) {
    prevAfter.apply(this, a);
    const ms = performance.now() - tStart;
    frame++;
    if (frame === 1) first = ms; else steady = Math.min(steady, ms);
    if (frame <= 3 || frame % 30 === 0) {
      const progs = (G.renderer.info.programs || []);
      const surf = progs.filter((p) => String(p.cacheKey).includes('surf:')).length;
      hud.textContent = `matboard: ${label}\nprograms ${progs.length} (surface ${surf})   compile: surface ${compile.surfaceMs.toFixed(0)} ms, all ${compile.totalMs.toFixed(0)} ms   first frame ${first.toFixed(0)} ms   steady ${Number.isFinite(steady) ? steady.toFixed(1) : '-'} ms cpu\n`
        + `board build ${buildMs.toFixed(0)} ms   wetness ${mats.shared.uWetness.value}  rain ${mats.shared.uRain.value}`;
      window.__matboard = { programs: progs.length, surface: surf, firstFrameMs: first, steadyMs: steady, buildMs, compile };
    }
  };
  return root;
}
