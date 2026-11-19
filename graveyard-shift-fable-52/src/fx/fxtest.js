// ?shot=fxtest: a small stage for looking at particles and decals on their own.
// Dark wet ground, a painted metal panel, a concrete block, a glass pane and one warm lamp.
//   ?shot=fxtest&fx=impact-metal&age=0.08[&size=1][&cam=x,y,z,yaw,pitch&fov=..]
//   window.__setShot({ fx:'muzzle', age:0.02 })
// &ruler=1 lays 1 m rules in 10 cm bands beside the staged effect (along its axis and across it);
// &lamp=0 leaves the lamp out, to see what an effect looks like with no light on it.
// fx names: muzzle, impact-asphalt, impact-concrete, impact-metal, impact-glass, impact-flesh,
// impact-dirt, blood-mist, casing, puff, decal-bullet, decal-blood, decal-scorch; and the combat set
// (combat.js): fx-explosion, fx-firepool, fx-flare, fx-flare-flight, fx-arc, fx-cloud,
// fx-tracer-burst, fx-pellets, fx-gib, fx-blood-ground-wet, fx-blood-wall.
import {
  Group, Mesh, PlaneGeometry, BoxGeometry, CapsuleGeometry, MeshStandardMaterial, MeshBasicMaterial, PointLight, HemisphereLight, Color, Vector3,
} from 'three';

const LAMP = { pos: [0.7, 2.6, 1.7], color: [1.0, 0.6, 0.26], intensity: 60, range: 0 };

// where each effect goes: position, surface normal, direction (fire / spray / ejection velocity)
const ANCHORS = {
  muzzle: { pos: [-0.2, 1.2, 0.3], dir: [1, 0, 0] },
  asphalt: { pos: [0.1, 0, 0.45], normal: [0, 1, 0] },
  concrete: { pos: [1.2, 0.5, -0.15], normal: [0, 0, 1] },
  'concrete-edge': { pos: [1.63, 0.62, -0.15], normal: [0, 0, 1] },
  'concrete-top': { pos: [1.15, 0.9, -0.2], normal: [0, 1, 0] },
  metal: { pos: [-1.3, 0.8, -0.47], normal: [0, 0, 1] },
  glass: { pos: [2.6, 0.75, -0.49], normal: [0, 0, 1] },
  flesh: { pos: [0.17, 1.3, 0.1], normal: [0.82, 0.25, 0.5] },
  mist: { pos: [0.1, 1.5, 0.05], dir: [1, 0.2, 0.25] },
  casing: { pos: [-0.3, 1.1, 0.4], dir: [1.3, 1.7, 0.25] },
};

// rules shown with ?ruler=1: [origin, direction] pairs. The first runs along the effect's axis from
// the surface it leaves, the second across it.
const FLESH_N = [0.82, 0.25, 0.5];
const RULERS = {
  'impact-concrete': [[[1.2, 0.3, -0.15], [0, 0, 1]], [[0.7, 0.3, -0.144], [1, 0, 0]]],
  'impact-asphalt': [[[0.4, 0, 0.45], [0, 1, 0]], [[-0.4, 0.006, 0.75], [1, 0, 0]]],
  'impact-flesh': [[[0.17, 1.1, 0.1], FLESH_N], [[0.17, 1.1, 0.1], [-0.5, 0, 0.82]]],
  'blood-mist': [[[0.1, 1.3, 0.05], [1, 0.2, 0.25]], [[0.1, 1.3, 0.05], [-0.25, 0, 1]]],
};
RULERS['impact-dirt'] = RULERS.puff = RULERS['impact-asphalt'];

// default framing per effect: [eye, target, fov]
const FRAMES = {
  muzzle: [[0.05, 1.27, 1.45], [0.02, 1.2, 0.3], 34],
  'impact-asphalt': [[0.1, 0.5, 1.9], [0.1, 0.22, 0.45], 40],
  'impact-concrete': [[0.0, 0.85, 0.75], [1.1, 0.5, 0.0], 42],
  'impact-metal': [[-0.75, 0.95, 1.0], [-1.2, 0.75, -0.47], 42],
  'impact-glass': [[2.25, 0.95, 0.9], [2.6, 0.75, -0.49], 40],
  'impact-dirt': [[0.1, 0.5, 1.9], [0.1, 0.22, 0.45], 40],
  'impact-flesh': [[1.6, 1.45, 2.0], [0.25, 1.3, 0.1], 40],
  'blood-mist': [[0.35, 1.5, 1.8], [0.45, 1.4, 0.05], 40],
  casing: [[0.1, 0.75, 2.1], [0.15, 0.55, 0.45], 36],
  puff: [[0.1, 0.7, 2.6], [0.1, 0.4, 0.45], 40],
  'decal-bullet': [[0.65, 1.15, 2.7], [0.65, 0.5, -0.3], 52],
  'decal-blood': [[0.55, 1.25, 2.2], [0.65, 0.3, 0.0], 46],
  'decal-scorch': [[0.1, 0.9, 1.9], [0.1, 0, 0.45], 40],
  'fx-explosion': [[0.1, 1.6, 9.5], [0.1, 1.3, 0.45], 46],
  'fx-firepool': [[0.1, 1.6, 8.5], [0.1, 0.7, 0.45], 46],
  'fx-flare': [[0.1, 1.6, 8.5], [0.1, 0.7, 0.45], 46],
  'fx-flare-flight': [[2.5, 1.5, 6.5], [2.8, 1.3, 0.3], 46],
  'fx-arc': [[2.2, 1.5, 5.5], [2.2, 1.2, 0.3], 46],
  'fx-cloud': [[0.1, 1.6, 8.5], [0.1, 1.0, 0.45], 46],
  'fx-tracer-burst': [[-1.2, 1.5, 1.6], [6, 1.15, 0.2], 50],
  'fx-pellets': [[-1.2, 1.5, 1.6], [6, 1.15, 0.2], 50],
  'fx-gib': [[0.35, 1.5, 2.6], [0.6, 1.1, 0.05], 44],
  'fx-blood-ground-wet': [[0.4, 2.7, 3.6], [0.4, 0.0, 1.0], 44],
  'fx-blood-wall': [[0.55, 1.0, 1.9], [1.2, 0.5, -0.15], 40],
};

const X_AXIS = new Vector3(1, 0, 0); const RV = new Vector3();
// The stage stands on an empty stretch of the lot (the level is loaded round it: at the origin its
// cameras looked into a pump). Everything above is in stage coordinates and is moved by this.
const OFF = [-14, 0, 5];
const off = (p) => [p[0] + OFF[0], p[1] + OFF[1], p[2] + OFF[2]];

function look(eye, target, fov) {
  const dx = target[0] - eye[0]; const dy = target[1] - eye[1]; const dz = target[2] - eye[2];
  return { cam: [eye[0] + OFF[0], eye[1] + OFF[1], eye[2] + OFF[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))], fov };
}

// A 1 m rule along +X from the origin: ten 10 cm bands, pale and blue by turns, 12 mm square. Unlit.
function makeRuler() {
  const g = new Group();
  const geo = new BoxGeometry(0.1, 0.012, 0.012);
  const pale = new MeshBasicMaterial({ color: new Color(0.3, 0.3, 0.3) });
  const blue = new MeshBasicMaterial({ color: new Color(0.02, 0.07, 0.3) });
  for (let i = 0; i < 10; i++) { const m = new Mesh(geo, i % 2 ? blue : pale); m.position.x = 0.05 + i * 0.1; g.add(m); }
  g.visible = false;
  return g;
}

export function installFxTest(G, lights) {
  const root = new Group();
  root.name = 'fxtest';
  root.position.fromArray(OFF);
  const add = (geo, mat, x, y, z) => { const m = new Mesh(geo, mat); m.position.set(x, y, z); root.add(m); return m; };

  const ground = add(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: 0x343538, roughness: 0.28 }), 0, 0, 0);
  ground.rotation.x = -Math.PI / 2;
  add(new BoxGeometry(1.4, 1.4, 0.06), new MeshStandardMaterial({ color: 0x2c5661, roughness: 0.45, metalness: 0.35 }), -1.3, 0.7, -0.5);
  add(new BoxGeometry(0.9, 0.9, 0.9), new MeshStandardMaterial({ color: 0x77746d, roughness: 0.92 }), 1.2, 0.45, -0.6);
  add(new BoxGeometry(0.9, 1.3, 0.02), new MeshStandardMaterial({ color: 0x1b2b2c, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.55, depthWrite: true }), 2.6, 0.65, -0.5);
  // stand-ins, shown only for the effects they give scale to
  const barrel = add(new BoxGeometry(0.2, 0.028, 0.024), new MeshStandardMaterial({ color: 0x18191b, roughness: 0.4, metalness: 0.8 }), -0.3, 1.2, 0.3);
  const torso = add(new CapsuleGeometry(0.17, 0.5, 6, 16), new MeshStandardMaterial({ color: 0x2f3a30, roughness: 0.9 }), 0, 1.2, 0);

  // One sodium lamp, registered with the light pool like any fixture in the level (the pool owns
  // every three light; fx reads it back through G.lights.shadowed). Sky and moon come from G.sky.
  const q = new URLSearchParams(window.location.search);
  const L = G.lights;
  if (q.get('lamp') === '0') { // no lamp: sky and moon only
  } else if (L && typeof L.add === 'function') {
    L.add({ type: 'spot', pos: off([0.7, 5.5, 2.2]), dir: [0, -1, -0.12], color: L.colors.sodium, lumens: 28000, range: 30, cone: 1.15, size: 0.3, castShadow: true });
    for (const m of root.children) { m.castShadow = true; m.receiveShadow = true; }
    ground.castShadow = false;
  } else { // no light module: a plain three lamp, mirrored into the fx light list
    const lamp = new PointLight(new Color(...LAMP.color), LAMP.intensity, 0, 2);
    lamp.position.set(...LAMP.pos);
    root.add(lamp, new HemisphereLight(0x8fa6c8, 0x05070a, 0.03));
    lights.fallbackLights.push({ ...LAMP, pos: off(LAMP.pos) });
  }
  const rulers = q.get('ruler') === '1' ? [makeRuler(), makeRuler()] : [];
  if (rulers.length) root.add(...rulers);
  G.scene.add(root);

  // staged effect from the URL; the harness merges ?cam / ?fov on top afterwards
  const num = (k) => { const n = Number(q.get(k)); return q.has(k) && Number.isFinite(n) ? n : undefined; };
  const shot = { ...look(...FRAMES['decal-bullet']) };
  if (q.get('fx')) { shot.fx = q.get('fx'); shot.age = num('age') ?? 0; shot.size = num('size'); }
  G.shotCam = shot;

  let ownCam = shot.cam;
  const anchors = (key, A) => {
    const a = ANCHORS[key];
    if (!a) return false;
    A.pos.fromArray(off(a.pos));
    A.normal.fromArray(a.normal || [0, 1, 0]).normalize();
    A.dir.fromArray(a.dir || a.normal || [0, 1, 0]);
    return true;
  };
  // Called when an effect is staged: show its stand-in and frame it, unless a camera was given.
  anchors.frame = (name) => {
    barrel.visible = name === 'muzzle';
    torso.visible = name === 'impact-flesh' || name === 'blood-mist' || name === 'fx-gib';
    const rl = RULERS[name];
    rulers.forEach((r, i) => {
      r.visible = !!(rl && rl[i]);
      if (!r.visible) return;
      r.position.fromArray(rl[i][0]); // (a child of the stage: already moved)
      r.quaternion.setFromUnitVectors(X_AXIS, RV.fromArray(rl[i][1]).normalize());
    });
    const f = FRAMES[name];
    const sc = G.shotCam;
    if (!f || !sc || (sc.cam && sc.cam !== ownCam) || G.params.cam) return;
    const l = look(...f);
    sc.cam = ownCam = l.cam;
    if (!G.params.fov) sc.fov = l.fov;
  };
  anchors.frame(shot.fx || '');
  return anchors;
}
