// ?shot=weapontest: a stage for judging a weapon, the hands and the animation.
// Dark wet ground, a sodium lamp and a cold light registered with G.lights, a few blocks for context.
// Options (parsed here; core/params.js is not ours):
//   wweapon = <weapon id>   which weapon (default pistol)
//   wview = fp (default) | side | right | top | under | front | rear | turn    first person, or a product shot
//   wang = <deg>, wel = <deg>, wdist = <m>, wfov = <deg>    orbit for wview=turn, distance and lens for any product view
//   wexp = 1          exploded product view
//   whands = 1        keep the hands on in product views
//   wpose = hip | ads | sprint | walk | empty | fire | reload | emptyreload | inspect | draw | swing | throw | pump | swap (wto = <id>)
//   wt = <seconds into that animation>
//   wwet = <0..1>     world wetness;  wev = <exposure> for product views;  wgrip = <json> grip landmarks
//   whand = open | mag | slap | bind    hand study: the support hand held beside the gun in that pose
// At run time: window.__weapon.weapon(id), .view(name, opts), .stage(pose, t, opts), .grip(cfg), .measure(), .hand(pose)
import { Group, Mesh, PlaneGeometry, BoxGeometry, Vector3 } from 'three';
import { handQuat, BIND_POSE } from './hand.js';

function look(eye, target, fov) {
  const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
  return { cam: [eye[0], eye[1], eye[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))], fov };
}

export function installWeaponTest(G, view) {
  const q = new URLSearchParams(window.location.search);
  const num = (k, d) => { const n = Number(q.get(k)); return q.has(k) && Number.isFinite(n) ? n : d; };

  const root = new Group();
  root.name = 'weapontest';
  const M = G.mats, L = G.lights;
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; root.add(m); return m; };

  const ground = add(new PlaneGeometry(80, 80), M.asphalt({
    bounds: [-40, -40, 40, 40],
    puddles: [{ x: 1.2, z: -4.5, r: 1.6, depth: 0.7 }, { x: -3, z: -9, r: 2.4, depth: 0.6 }, { x: 5, z: -12, r: 2, depth: 0.5 }],
    marks: [{ x: -1.5, z: -7, length: 9, width: 0.12, rot: 0.25, kind: 'white', wear: 0.6 }],
  }), 0, 0, 0);
  ground.rotation.x = -Math.PI / 2;
  ground.castShadow = false;
  L.poolAlbedo = 0.045; L.poolRoughness = 0.35;
  // context: a kerb-height plinth, a concrete wall and a steel cabinet (no bollard and no lamp post: placed over a
  // loaded level they stood in the bottom centre of every weapon shot)
  add(new BoxGeometry(5, 0.18, 1.2), M.concrete({ age: 0.6 }), -2.4, 0.09, -6.2, 0.2);
  add(new BoxGeometry(9, 3.2, 0.3), M.concrete({ age: 0.5, panel: 1.2 }), -1, 1.6, -13.5, -0.12);
  add(new BoxGeometry(1.1, 1.7, 0.6), M.paintedMetal({ color: 0x2f4f55, wear: 0.5, rust: 0.4 }), 3.6, 0.85, -8.5, -0.5);

  // sodium lamp ahead and to the right, a cold light from the left
  add(new BoxGeometry(1.6, 0.1, 0.1), M.paintedMetal({ color: 0x4b4f52 }), 3.4, 7.95, -7.5).castShadow = false;
  add(new BoxGeometry(0.5, 0.05, 0.26), M.emissive({ color: L.colors.sodium, nits: 90 }), 2.6, 7.86, -7.5).castShadow = false;
  L.add({ type: 'spot', pos: [2.6, 7.8, -7.5], dir: [-0.15, -1, 0.28], color: L.colors.sodium, lumens: 28000, range: 30, cone: 1.15, size: 0.3, flicker: 0.03, castShadow: true });
  add(new BoxGeometry(0.6, 0.04, 0.6), M.emissive({ color: L.colors.canopy, nits: 60 }), -4.5, 4.6, -1.5).castShadow = false;
  L.add({ type: 'spot', pos: [-4.5, 4.55, -1.5], dir: [0.5, -1, 0.1], color: L.colors.canopy, lumens: 9000, range: 16, cone: 1.05, size: 0.3, castShadow: true });
  G.scene.add(root);

  const C = [0, 1.4, 0]; // where the gun floats for product shots (model origin)
  const midOf = () => { const A = view.model.anchors; return [C[0], C[1] + A.grip.y * 0.9, C[2] + (A.muzzle.z + 0.015) / 2]; };
  let studio = null;
  const DIRS = { side: [-1, 0.03, 0], right: [1, 0.03, 0], top: [0.001, 1, 0.12], under: [0.001, -1, 0.12], front: [0.12, 0.08, -1], rear: [0.1, 0.16, 1] };

  // name: fp or a product view. o: { ang, el (degrees, for 'turn'), dist, fov, exp, hands, ev }
  function setView(name = 'fp', o = {}) {
    let shot;
    if (name === 'fp') {
      view.setProduct(null);
      shot = { cam: [0, 1.7, 0, 0.08, -0.05], fov: G.params.fov ?? 70 };
      if (G.post && G.post.uniforms) { G.post.uniforms.adaptOn = 1; G.post.uniforms.exposure = 1; }
    } else {
      const d = o.dist ?? (o.exp ? 0.78 : 0.5) * Math.max(1, -view.model.anchors.muzzle.z / 0.2);
      let dir = DIRS[name];
      if (!dir) { const a = ((o.ang ?? 35) * Math.PI) / 180, e = ((o.el ?? 18) * Math.PI) / 180; dir = [-Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)]; }
      const l = Math.hypot(...dir);
      const at = o.at || midOf();
      shot = look([at[0] + (dir[0] / l) * d, at[1] + (dir[1] / l) * d, at[2] + (dir[2] / l) * d], at, o.fov ?? 28);
      view.setProduct({ pos: C, explode: o.exp ? 1 : 0, hands: !!o.hands });
      // product shots hold a fixed exposure close to what the lamp-lit forecourt settles at
      if (G.post && G.post.uniforms) { G.post.uniforms.adaptOn = 0; G.post.uniforms.exposure = o.ev ?? 0.6; }
      if (!studio) {
        const s = { range: 6, cone: 0.5, size: 0.12, castShadow: false, pool: false, priority: 50, type: 'spot' };
        studio = [
          L.add({ ...s, pos: [C[0] - 0.9, C[1] + 1.3, C[2] - 0.9], dir: [0.55, -0.8, 0.5], color: L.colors.sodium, lumens: 50 }),
          L.add({ ...s, pos: [C[0] + 1.1, C[1] + 0.7, C[2] + 0.5], dir: [-0.8, -0.45, -0.4], color: L.colors.canopy, lumens: 45 }),
          L.add({ ...s, pos: [C[0] - 0.4, C[1] + 0.2, C[2] + 1.2], dir: [0.3, -0.1, -1], color: L.colors.fluorescent, lumens: 30 }),
        ];
      }
    }
    G.shotCam = shot;
    G.camera.position.set(shot.cam[0], shot.cam[1], shot.cam[2]);
    G.camera.rotation.order = 'YXZ';
    G.camera.rotation.set(shot.cam[4], shot.cam[3], 0);
    view.update(0);
  }

  const api = {
    view: setView,
    weapon: (id) => { view.use(id); view.stage('hip', 0); return view.weapon; },
    stage: (pose, t = 0, o) => view.stage(pose, t, o),
    grip: (cfg) => {
      const H = view.model.hold;
      view.regrip({ ...H, right: { ...H.right, ...(cfg.right || {}) }, left: { ...H.left, ...(cfg.left || {}) } });
      view.update(0);
      return view.model === view.pistol ? { ...view.arms.solve, measure: view.arms.measure(), ...view.arms.dump() } : {};
    },
    measure: (detail) => view.arms.measure(detail),
    // hand study: hold the support hand beside the gun in a named pose (open | mag | slap | bind | lGrip), or null
    hand: (pose, at = [-0.16, -0.03, -0.06], back = [0, 0.15, 1], thumb = [1, 0.25, 0]) => {
      view.setStudy(pose ? { pose: pose === 'bind' ? BIND_POSE : view.arms.poses[pose], pos: new Vector3(...at), quat: handQuat(-1, new Vector3(...back), new Vector3(...thumb)) } : null);
      view.update(0);
    },
  };
  window.__weapon = api;

  if (q.has('wweapon')) view.use(q.get('wweapon'));
  if (q.has('wgrip')) { try { api.grip(JSON.parse(q.get('wgrip'))); } catch (e) { console.error(`[weapontest] bad wgrip: ${e.message}`); } }
  setView(q.get('wview') || 'fp', { ang: num('wang'), el: num('wel'), dist: num('wdist'), fov: num('wfov'), exp: q.get('wexp') === '1', hands: q.get('whands') === '1', ev: num('wev') });
  if (G.params.cam) G.shotCam.cam = G.params.cam;
  if (q.has('wwet')) G.mats.shared.uWetness.value = num('wwet', 0.85);
  if (q.has('whand')) api.hand(q.get('whand'));
  view.stage(q.get('wpose') || 'hip', num('wt', 0), { to: q.get('wto') || undefined });
  return { root };
}
