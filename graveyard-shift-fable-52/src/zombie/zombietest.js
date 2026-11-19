// ?shot=zombietest: the stage zombies are judged on. Dark wet ground, one sodium lamp high to
// the side, a cold canopy-like downlight, and a lamp far behind for rim light and silhouettes.
// Wire-up: the zombie manager returns installZombieTest(G) from createZombies when
// G.params.shot === 'zombietest' (the object has update(dt), so the loop drives it).
// Query options (parsed here):
//   zpose=<idle|walk|attack|stagger|climb|dead>   animator state (default idle)
//   zseed=<n>      first variant seed (default 1)     zcount=<n>   zombies in a row (default 1)
//   zvar=<trucker|mechanic>   force the variant
//   zt=<seconds>   advance the animation this long before the first frame
//   zdist=<m>      camera distance (default 3.4)      zturn=<deg>  turn the zombies (0 = facing camera)
//   ztt=1          turntable: the same zombie four times at 0, 45, 90 and 180 degrees
//   zshot=near|far staged groups: 3 at 2-4 m under the canopy light, 8 at 10-25 m backlit
//   zsil=1         silhouette test: lights off, bright fog wall behind
//   zgrid=1        with zcount: rows of six receding from 5 m (performance layout)
//   zsex=m|f  zgap=<m> spacing  zaim=<m> height the camera looks at  zcamx=<m>  ztop=<m> top-down camera  zlamp=cold|sodium
//   zbare=1        no clothing     zlod=0|1  force the near / far LOD (default: by distance, far beyond 18 m)     zspeed=<m/s> walk speed asked for
//   zrest=1        bind pose, no animation     zhit=<part>  fire a hit reaction at zt = 0
//   zdir=<deg>     direction the hit / killing shot travels, 0 = from the front
//   zfollow=1      camera follows the first zombie
//   zwet=<0..1>    zcamh=<m> camera height   zfov=<deg>   zhitbox=1 draw hit capsules
//   zat=x,z,deg;x,z,deg;...   put the zombies at these places in the real level instead of on the stage (deg: the way
//                  each faces, 0 = south, +z), lit by the level; zcam=x,y,z,yaw,pitch is then the camera
//   zbuild=<gaunt|average|heavy|bloated|brute>   zvars=1 the six variants side by side (trucker, waitress, mechanic, guest, trooper, drifter)
//   zwound=<part>[,kind]  shoot that part from the camera (bullet | blast | bite)   zsever=<part>[,part]   zhead=<0..2> damaged head
//   zdbg=<1..4>    show a baked map (slopes, occlusion, colour, thinness)
// window.__ztest.ctl.speed (m/s, null = zspeed) is read every frame, so a script driving the page can
// start, stop and change the pace of a walk; it turns the zombies through their meshes' rotation.y.
//   zvictim=<m>    a victim stands this far in front of each zombie (the look / attack target is its
//                  chest, feet + 1.3 m, as the manager gives it); zeye=1 puts the camera at its eyes (1.7 m)
import { Group, Mesh, PlaneGeometry, BoxGeometry, MeshBasicMaterial, Color, CapsuleGeometry, Matrix4, Vector3 } from 'three';
import { buildZombie, VARIANTS } from './body.js';
import { createAnimator } from './anim.js';
import { solveFK } from './skeleton.js';

export function installZombieTest(G) {
  const q = new URLSearchParams(window.location.search);
  const num = (k, d) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  const root = new Group();
  root.name = 'zombietest';
  // clear of the real level once it exists
  const at = q.has('zat') ? q.get('zat').split(';').map((t) => t.split(',').map(Number)) : null;
  const OX = at ? 0 : G.level && !G.level.stub ? 700 : 0;
  root.position.set(OX, 0, 0);
  const L = G.lights;
  const sil = q.get('zsil') === '1';

  const ground = new Mesh(new PlaneGeometry(120, 120), G.mats.asphalt({ bounds: [OX - 60, -60, OX + 60, 60], puddles: [{ x: OX + 1.2, z: 1.5, r: 1.6, depth: 0.5 }, { x: OX - 2.5, z: -3, r: 2.2, depth: 0.6 }] }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  if (!at) root.add(ground);

  const lamps = [];
  if (L && L.add && !at) {
    const glow = (c, k, x, y, z, sx, sz) => { const m = new Mesh(new BoxGeometry(sx, 0.04, sz), new MeshBasicMaterial({ color: new Color().copy(c).multiplyScalar(k) })); m.position.set(x, y, z); root.add(m); };
    lamps.push(L.add({ type: 'spot', pos: [OX - 4.2, 7.8, 3.2], dir: [0.3, -1, -0.2], color: L.colors.sodium, lumens: 28000, range: 30, cone: 1.15, size: 0.3, flicker: 0.03, castShadow: true }));
    glow(L.colors.sodium, 90, -4.2, 7.84, 3.2, 0.5, 0.26);
    lamps.push(L.add({ type: 'spot', pos: [OX + 1.6, 4.95, 0.4], dir: [0, -1, 0], color: L.colors.canopy, lumens: 11000, range: 16, cone: 1.0, size: 0.3, castShadow: true }));
    glow(L.colors.canopy, 60, 1.6, 4.98, 0.4, 0.6, 0.6);
    lamps.push(L.add({ type: 'spot', pos: [OX + 2, 6.5, -24], dir: [-0.08, -0.35, 1], color: L.colors.sodium, lumens: 9000, range: 60, cone: 0.8, size: 0.4, castShadow: true }));
    glow(L.colors.sodium, 140, 2, 6.5, -24.1, 0.5, 0.3);
    if (sil) for (const h of lamps) h.set({ enabled: false });
    // zlamp=cold: the cold downlight only (hue reads); zlamp=sodium: the sodium lamps only
    if (q.get('zlamp') === 'cold') { lamps[0].set({ enabled: false }); lamps[2].set({ enabled: false }); }
    if (q.get('zlamp') === 'sodium') lamps[1].set({ enabled: false });
  }
  if (sil) {
    const wall = new Mesh(new PlaneGeometry(160, 60), new MeshBasicMaterial({ color: new Color(0.5, 0.52, 0.56) }));
    wall.position.set(0, 20, -40);
    root.add(wall);
  }
  if (q.get('zpose') === 'climb') {
    // a rail to climb, where the animator expects it (0.35 m ahead of a zombie at the origin)
    const h = num('zfence', 1.2), tn = (num('zturn', 0) * Math.PI) / 180;
    const rail = new Mesh(new BoxGeometry(2.4, h, 0.05), G.mats.paintedMetal({ color: 0x4a5258, wear: 0.6 }));
    rail.position.set(Math.sin(tn) * 0.36, h / 2 - 0.015, Math.cos(tn) * 0.36); rail.rotation.y = tn;
    rail.castShadow = true; root.add(rail);
  }
  G.scene.add(root);

  const shot = q.get('zshot');
  const seed0 = num('zseed', 1);
  const tt = q.get('ztt') === '1';
  const vars = q.get('zvars') === '1';
  let count = tt ? 4 : vars ? 6 : num('zcount', 1);
  const turn = (num('zturn', 0) * Math.PI) / 180;
  const pose = q.get('zpose') || 'idle';
  const speed = num('zspeed', 1.3);
  const placed = [];
  if (at) {
    for (const [x, z, deg] of at) placed.push([x, z, ((deg || 0) * Math.PI) / 180]);
  } else if (shot === 'near') {
    placed.push([-0.85, 0.2, 0.2], [0.35, -0.9, -0.1], [1.25, 0.6, -0.35]);
  } else if (shot === 'far') {
    const pts = [[-3, -7], [1.5, -9], [-0.5, -12], [4, -13], [-5, -15], [2, -17], [-2, -20], [6, -22]];
    for (const [x, z] of pts) placed.push([x, z, Math.atan2(-x, 3.2 - z)]);
  } else if (q.get('zgrid') === '1') {
    // performance layout: rows of six from 5 m back
    for (let i = 0; i < count; i++) placed.push([((i % 6) - 2.5) * 1.5, -2 - Math.floor(i / 6) * 4.5, 0]);
  } else {
    const gap = num('zgap', tt ? 1.0 : 0.95);
    for (let i = 0; i < count; i++) placed.push([(i - (count - 1) / 2) * gap, 0, tt ? [0, Math.PI / 4, Math.PI / 2, Math.PI][i] : turn]);
  }
  count = placed.length;

  const zombies = [], anims = [];
  const variant = q.get('zvar') || undefined;
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    const z = buildZombie(tt ? seed0 : seed0 + i, G, { variant: vars ? VARIANTS[i % 6] : variant, sex: q.get('zsex') || undefined, build: q.get('zbuild') || undefined, bare: q.get('zbare') === '1' });
    z.mesh.position.set(OX + placed[i][0], 0, placed[i][1]);
    z.mesh.rotation.y = placed[i][2];
    if (q.get('zlod') === '1') z.setLod(1);
    if (q.get('zshadow') === '0') z.mesh.castShadow = false;      // zshadow=0: the zombies cast no shadows (to tell shadow faults from shading)
    if (q.has('zwet')) z.setWet(num('zwet', 1));
    if (q.has('zdbg')) z.materials.char.surf.uChDebug.value = num('zdbg', 0);
    G.scene.add(z.mesh);
    zombies.push(z);
    const a = createAnimator(z);
    anims.push(a);
  }
  const buildMs = performance.now() - t0;

  const rest = q.get('zrest') === '1';
  const autoLod = !q.has('zlod');
  const hitDir = (num('zdir', 0) * Math.PI) / 180;
  const start = () => {
    anims.forEach((a, i) => {
      const m = zombies[i].mesh;
      const fwd = [Math.sin(m.rotation.y), 0, Math.cos(m.rotation.y)];
      // a shot "from the front" travels opposite to the way the zombie faces
      const hd = hitDir + (i * num('zspread', 0) * Math.PI) / 180;   // zspread=<deg>: each zombie is hit from a different side
      const c = Math.cos(hd), s = Math.sin(hd);
      const dir = [-(fwd[0] * c + fwd[2] * s), 0, -(fwd[2] * c - fwd[0] * s)];
      if (q.has('zvictim')) a.setTarget([m.position.x + fwd[0] * num('zvictim', 1), 1.3, m.position.z + fwd[2] * num('zvictim', 1)]);
      if (pose === 'dead') a.collapse(dir, 1);
      else a.set(pose, { height: num('zfence', 1.2), ...(q.has('zvictim') ? {} : { target: shot ? [OX, 1.5, 3.2] : null }) });
      if (q.has('zvictim')) { /* target already set */ } else if (shot || q.get('zreach') === '1') a.setTarget([OX + (q.get('zreach') === '1' ? m.position.x - OX + fwd[0] * 1.2 : 0), 1.5, q.get('zreach') === '1' ? m.position.z + fwd[2] * 1.2 : 3.2]);
      if (q.has('zhit')) a.hitReact(q.get('zhit'), dir);
    });
  };

  const ctl = { speed: null };
  const step = (dt) => {
    for (let i = 0; i < count; i++) {
      const a = anims[i], m = zombies[i].mesh;
      if (!rest) {
        // what the manager should do: animation and mesh LOD from the distance to the camera
        const cd = Math.hypot(m.position.x - G.camera.position.x, m.position.z - G.camera.position.z);
        if (autoLod) zombies[i].setLod(cd > 18 ? 1 : 0);
        a.update(dt, ctl.speed !== null ? ctl.speed : pose === 'walk' ? speed + (i % 3) * 0.12 : 0, autoLod ? cd : 0);
        m.position.x += Math.sin(m.rotation.y) * a.rootSpeed * dt;
        m.position.z += Math.cos(m.rotation.y) * a.rootSpeed * dt;
      }
    }
  };
  if (rest) {
    for (const z of zombies) {
      const m = z.mesh;
      solveFK(z.skeleton.bones, z.pose, [m.position.x, m.position.y, m.position.z], [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w]);
    }
  } else {
    start();
    const zt = num('zt', 0);
    for (let t = 0; t < zt - 1e-6; t += 1 / 60) step(1 / 60);
    step(0);
  }

  // damage, applied to the posed figure
  if (q.has('zsever')) for (const z of zombies) for (const part of q.get('zsever').split(',')) z.sever(part);
  if (q.has('zhead')) for (const z of zombies) z.headDamage(num('zhead', 1));
  if (q.has('zwound')) {
    const [part, kind] = q.get('zwound').split(',');
    for (const z of zombies) {
      const hb = z.parts[part] && z.parts[part].hitboxes[0];
      if (!hb) continue;
      const m = z.mesh, e = hb.bone.matrixWorld.elements, f = [Math.sin(m.rotation.y), 0, Math.cos(m.rotation.y)];
      const c = new Vector3(hb.center[0], hb.center[1], hb.center[2]).applyMatrix4(hb.bone.matrixWorld);
      void e;
      // from in front of the part, straight in
      const hit = z.raycast([c.x + f[0] * 2, c.y, c.z + f[2] * 2], [-f[0], 0, -f[2]], 5);
      if (hit) z.addWound(hit.pos, kind === 'blast' ? 0.07 : 0.035, kind || 'bullet', [-f[0], 0, -f[2]]);
    }
  }

  // hit capsule overlay
  let caps = null;
  if (q.get('zhitbox') === '1') {
    caps = [];
    const mat = new MeshBasicMaterial({ color: 0x30ff60, wireframe: true });
    for (const z of zombies) for (const h of z.hitboxes) {
      const c = new Mesh(new CapsuleGeometry(h.radius, h.halfHeight * 2, 3, 8), mat);
      c.matrixAutoUpdate = false;
      G.scene.add(c);
      caps.push([c, h]);
    }
  }
  const _m = new Matrix4(), _v = new Vector3();

  const dist = num('zdist', shot === 'far' ? 3.2 : shot === 'near' ? 3.2 : 3.4);
  const camH = num('zcamh', shot ? 1.6 : 1.25);
  G.shotCam = { cam: [OX + num('zcamx', 0), camH, shot ? 3.2 : dist, 0, shot ? -0.06 : -Math.atan((camH - num('zaim', 0.95)) / dist)], fov: num('zfov', shot === 'far' ? 50 : shot === 'near' ? 62 : 40) };
  // ztop=<m>: look straight down from that height (resting poses)
  if (q.has('ztop')) G.shotCam = { cam: [OX + num('zcamx', 0), num('ztop', 6), num('zcamz', 0.01), 0, -Math.PI / 2 + 0.001], fov: num('zfov', 40) };

  if (q.has('zcam')) { const c = q.get('zcam').split(',').map(Number); G.shotCam = { cam: [c[0], c[1], c[2], c[3] || 0, c[4] || 0], fov: num('zfov', 62) }; }
  // zeye=1: what the victim sees (first zombie, facing +z)
  if (q.get('zeye') === '1') G.shotCam = { cam: [OX + placed[0][0], 1.7, placed[0][1] + num('zvictim', 1), 0, num('zpitch', -0.1)], fov: num('zfov', 70) };

  // zfollow=1: the camera rides along with the first zombie (single frames of a walk)
  const follow = q.get('zfollow') === '1';
  const cam0 = G.shotCam.cam.slice(), p0 = [OX + placed[0][0], placed[0][1]];
  const track = () => {
    if (!follow) return;
    const m = zombies[0].mesh.position;
    G.shotCam.cam[0] = cam0[0] + m.x - p0[0]; G.shotCam.cam[2] = cam0[2] + m.z - p0[1];
  };
  track();
  window.__ztest = { zombies, anims, buildMs, step, root, ctl };
  return {
    stub: false, alive: count, list: zombies, zombies, anims,
    update(dt) {
      if (!rest) step(dt);
      track();
      if (caps) for (const [c, h] of caps) {
        const e = h.bone.matrixWorld.elements;
        const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]), sz = Math.hypot(e[8], e[9], e[10]);
        _m.set(e[0] / sx, e[4] / sy, e[8] / sz, e[12], e[1] / sx, e[5] / sy, e[9] / sz, e[13], e[2] / sx, e[6] / sy, e[10] / sz, e[14], 0, 0, 0, 1);
        _v.set(h.center[0], h.center[1], h.center[2]).applyMatrix4(_m);
        c.matrix.copy(_m).setPosition(_v);
        c.matrixWorld.copy(c.matrix);
      }
    },
  };
}
