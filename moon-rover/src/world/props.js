/* ============================================================
   THINGS ON THE FLOOR OF ANAXAGORAS
   ------------------------------------------------------------
   Boulder fields (instanced), the descent sled you arrived on,
   what is left of Beacon-9, survey pylons, deployable relays,
   and the lattice itself.
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRNG, vnoise, fbm, clamp, sstep } from '../core/rng.js';
import { PLAYABLE_R } from './terrain.js';

/* ---------------- irregular rock ----------------
   Shattered anorthosite: big conchoidal faces from the fracture that made it,
   then progressively finer chipping on top. Three octaves rather than one, so
   the silhouette is angular at every scale you can see it at. */
function boulderGeo(seed, detail = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.copy(v).normalize();
    let d = 1.0;
    d += (fbm(n.x * 1.7 + seed, n.z * 1.7 - seed, 2, 2.1, 0.5, seed | 0) - 0.5) * 0.66;
    d += (fbm(n.x * 4.3 + seed * 2, n.y * 4.3 - seed, 3, 2.1, 0.5, (seed * 13) | 0) - 0.5) * 0.30;
    d += (vnoise(n.x * 11.0 + seed * 5, n.z * 11.0 - seed * 3, (seed * 31) | 0) - 0.5) * 0.11;
    // facet it: quantising the radius turns smooth lumps into flat fracture planes
    d = Math.round(d * 11) / 11 * 0.34 + d * 0.66;
    d *= 1 - 0.32 * Math.max(0, -n.y);              // flatter where it meets the ground
    v.copy(n).multiplyScalar(d);
    v.y *= 0.76;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.deleteAttribute('uv');                          // triplanar in the shader instead
  return g;
}

/** Procedural rock surface, injected into a standard material.
    Triplanar so it works on an arbitrary lump with no UVs, world-space so
    neighbouring boulders never repeat, and dust settles on the up-faces. */
function rockMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: 0x6a6257, roughness: 0.92, metalness: 0.0, envMapIntensity: 1.5
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockW; varying vec3 vRockN;')
      // After <begin_vertex> both `transformed` and `objectNormal` exist. The
      // instance matrix has to be applied by hand — every boulder carries its
      // own rotation, and without it the detail would sit in the wrong place.
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 rkP = vec4(transformed, 1.0);
          vec3 rkN = objectNormal;
          #ifdef USE_INSTANCING
            rkP = instanceMatrix * rkP;
            rkN = mat3(instanceMatrix) * rkN;
          #endif
          vRockW = (modelMatrix * rkP).xyz;
          vRockN = normalize(mat3(modelMatrix) * rkN);
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRockW; varying vec3 vRockN;
        float rkH(vec2 p){ p = fract(p*vec2(0.1031,0.1030)); p += dot(p,p.yx+33.33); return fract((p.x+p.y)*p.x); }
        float rkN(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(rkH(i),rkH(i+vec2(1,0)),f.x), mix(rkH(i+vec2(0,1)),rkH(i+vec2(1,1)),f.x), f.y); }
        float rkF(vec2 p){ return rkN(p)*0.55 + rkN(p*2.13+7.7)*0.28 + rkN(p*4.31+19.3)*0.17; }
        // triplanar: three planar samples blended by the surface normal
        float rkTri(vec3 w, vec3 n, float s){
          vec3 b = pow(abs(n), vec3(4.0)); b /= (b.x+b.y+b.z);
          return rkF(w.yz*s)*b.x + rkF(w.xz*s)*b.y + rkF(w.xy*s)*b.z;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 rn = normalize(vRockN);
          float rkFade = 1.0 - smoothstep(25.0, 110.0, length(vViewPosition));
          float coarse = rkTri(vRockW, rn, 1.7);
          float fine   = mix(0.5, rkTri(vRockW, rn, 8.0), rkFade);
          // mottled plagioclase, darker in the pits
          diffuseColor.rgb *= 0.72 + 0.34*coarse + 0.16*fine;
          // regolith dust settles on anything facing up and never blows off
          float up = smoothstep(0.12, 0.85, rn.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.148,0.130,0.106)*1.30, up*(0.34 + 0.34*coarse));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 0.84 + 0.24*rkTri(vRockW, normalize(vRockN), 3.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // three's "normal" here is in VIEW space, but the gradient below is
          // derived in WORLD space — they have to be rotated into the same
          // frame or the perturbation swings with the camera and speckles.
          // It also has to fade with distance, or a 0.2 m pebble at 80 m turns
          // into a pixel-sized noise generator.
          vec3 rn = normalize(vRockN);
          float fade = 1.0 - smoothstep(18.0, 85.0, length(vViewPosition));
          if (fade > 0.01) {
            float e = 0.035;
            float h0 = rkTri(vRockW, rn, 6.0);
            vec3 grad = vec3(rkTri(vRockW+vec3(e,0,0), rn, 6.0)-h0,
                             rkTri(vRockW+vec3(0,e,0), rn, 6.0)-h0,
                             rkTri(vRockW+vec3(0,0,e), rn, 6.0)-h0) / e;
            vec3 pert = grad - rn*dot(grad, rn);
            normal = normalize(normal - mat3(viewMatrix) * pert * 0.055 * fade);
          }
        }`);
  };
  m.customProgramCacheKey = () => 'regolith-rock';
  return m;
}

/* The field is always placed at the densest tier's count so that lowering the
   tier hides a suffix rather than re-rolling the scatter. Keep in step with
   QUALITY.ultra.boulders in core/engine.js. */
const MAX_BOULDERS = 2200;

export class Props {
  constructor(scene, terrain, quality) {
    this.scene = scene;
    this.terrain = terrain;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = [];        // {x,z,r,restitution}
    this.curved = [];           // objects that must follow the horizon curve

    this.rockMat = rockMaterial();
    this.buildBoulders();
  }

  /* ---------------- boulder fields ---------------- */
  buildBoulders() {
    const rng = makeRNG(0xB0D1E);
    // Spend the triangles where they show: the big rocks you drive up to get
    // 1280 faces, the pebble scatter gets 320 and leans on the shader instead.
    const variants = [
      { geo: boulderGeo(1.7, 3), min: 1.10, max: 4.60, share: 0.14 },
      { geo: boulderGeo(5.3, 3), min: 0.80, max: 2.60, share: 0.16 },
      { geo: boulderGeo(9.1, 2), min: 0.30, max: 1.10, share: 0.32 },
      { geo: boulderGeo(13.7, 2), min: 0.18, max: 0.60, share: 0.38 }
    ];
    /* Always place the ULTRA field, then show a prefix of it. Density is a
       render knob, but a boulder is also a collider — re-rolling the scatter
       when the tier changes would slide rocks around a player who is driving
       between them, and could drop one inside the rover. Placing once and
       moving only `count` makes every tier a strict subset of the next. */
    const N = MAX_BOULDERS;
    const dummy = new THREE.Object3D();
    this.boulderMeshes = [];
    this._boulderRocks = [];      // per-variant collider lists, in draw order

    for (let vi = 0; vi < variants.length; vi++) {
      const V = variants[vi];
      const per = Math.ceil(N * V.share);
      const rocks = [];
      this._boulderRocks.push(rocks);
      const im = new THREE.InstancedMesh(V.geo, this.rockMat, per);
      im.castShadow = true; im.receiveShadow = true;
      im.frustumCulled = false;
      let k = 0, guard = 0;
      while (k < per && guard++ < per * 40) {
        // ejecta is thickest just inside the rim and around fresh craters
        const a = rng() * Math.PI * 2;
        const band = rng();
        let r;
        if (band < 0.42) r = 30 + rng() * (PLAYABLE_R - 60);
        else if (band < 0.78) r = PLAYABLE_R - 130 + rng() * 130;
        else r = 60 + rng() * 120;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (Math.hypot(x, z) > PLAYABLE_R + 60) continue;
        const slope = this.terrain.slopeAt(x, z);
        if (slope > 34) continue;                              // rocks roll off steep faces
        // keep the landing pad clear
        if (Math.hypot(x - HOME.x, z - HOME.z) < 26) continue;
        const size = V.min + Math.pow(rng(), 1.9) * (V.max - V.min);
        const y = this.terrain.heightAt(x, z) - size * 0.24;
        dummy.position.set(x, y, z);
        dummy.rotation.set(rng() * 6.28, rng() * 6.28, rng() * 6.28);
        dummy.scale.set(size * (0.8 + rng() * 0.4), size * (0.7 + rng() * 0.4), size * (0.8 + rng() * 0.4));
        dummy.updateMatrix();
        im.setMatrixAt(k, dummy.matrix);
        rocks.push(size > 1.05 ? { x, z, r: size * 0.72, kind: 'rock' } : null);
        k++;
      }
      im.userData.placed = k;
      im.userData.share = V.share;
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
      this.boulderMeshes.push(im);
    }
    this.setBoulderDensity(this.quality.boulders);
  }

  /** Show the first N boulders of the field and collide with exactly those.
      Anything the tier hides must not be solid, or you would be stopped by a
      rock that is not there. */
  setBoulderDensity(N) {
    this.colliders = this.colliders.filter(c => c.kind !== 'rock');
    for (let vi = 0; vi < this.boulderMeshes.length; vi++) {
      const im = this.boulderMeshes[vi];
      const show = Math.min(im.userData.placed, Math.ceil(N * im.userData.share));
      im.count = show;
      const rocks = this._boulderRocks[vi];
      for (let i = 0; i < show; i++) if (rocks[i]) this.colliders.push(rocks[i]);
    }
  }

  setQuality(q) {
    this.quality = q;
    this.setBoulderDensity(q.boulders);
  }

  /* ============================================================
     the descent sled — home, recharge, sample drop-off
     ============================================================ */
  buildHome() {
    const g = new THREE.Group();
    const mAlu = new THREE.MeshStandardMaterial({ color: 0xa8a49b, metalness: 0.9, roughness: 0.42 });
    const mGold = new THREE.MeshPhysicalMaterial({ color: 0xffc36b, metalness: 1, roughness: 0.36, clearcoat: 0.2 });
    const mDark = new THREE.MeshStandardMaterial({ color: 0x232427, metalness: 0.6, roughness: 0.6 });
    const mWhite = new THREE.MeshStandardMaterial({ color: 0xdedad0, metalness: 0.05, roughness: 0.75 });

    // octagonal deck
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.6, 0.42, 8), mGold);
    deck.position.y = 1.55; deck.castShadow = deck.receiveShadow = true; g.add(deck);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.62, 2.30, 0.30, 8), mAlu);
    skirt.position.y = 1.25; g.add(skirt);

    // four legs with footpads
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + Math.PI / 4;
      const dx = Math.cos(a), dz = Math.sin(a);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 2.6, 10), mAlu);
      leg.position.set(dx * 2.0, 0.72, dz * 2.0);
      leg.rotation.z = -dx * 0.44; leg.rotation.x = dz * 0.44;
      leg.castShadow = true; g.add(leg);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.40, 0.14, 14), mAlu);
      pad.position.set(dx * 3.30, 0.06, dz * 3.30); pad.castShadow = true; g.add(pad);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.9, 8), mAlu);
      strut.position.set(dx * 2.55, 0.75, dz * 2.55);
      strut.rotation.z = -dx * 1.05; strut.rotation.x = dz * 1.05; g.add(strut);
    }

    // descent engine bells
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2;
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.30, 0.46, 14, 1, true), mDark);
      bell.position.set(Math.cos(a) * 1.35, 1.10, Math.sin(a) * 1.35);
      bell.material.side = THREE.DoubleSide; g.add(bell);
    }

    // charge mast + floodlights + antenna
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.2, 12), mAlu);
    mast.position.y = 3.8; mast.castShadow = true; g.add(mast);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.09, 0.09), mAlu);
    cross.position.y = 5.5; g.add(cross);
    this.homeLights = [];
    for (const s of [-1, 1]) {
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.24, 12), mDark);
      hood.position.set(s * 1.3, 5.36, 0); hood.rotation.x = 0.5; g.add(hood);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16),
        new THREE.MeshBasicMaterial({ color: 0x2a251c }));   // driven by props.update
      lens.position.set(s * 1.3, 5.20, 0.10); lens.rotation.x = -1.05; g.add(lens);
      this.homeLights.push(lens);
    }
    const dishPts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12, r = t * 0.62; dishPts.push(new THREE.Vector2(r, r * r * 0.5)); }
    const dish = new THREE.Mesh(new THREE.LatheGeometry(dishPts, 26),
      new THREE.MeshStandardMaterial({ color: 0xe9e5db, metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide }));
    dish.position.set(0, 5.9, 0); dish.rotation.x = -1.15; dish.castShadow = true; g.add(dish);

    // sample intake + charge pad
    const intake = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.7), mWhite);
    intake.position.set(0, 2.0, 1.9); intake.castShadow = true; g.add(intake);
    const chute = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 16),
      new THREE.MeshBasicMaterial({ color: 0x2ad2ff }));
    chute.position.set(0, 2.28, 1.9); g.add(chute);
    this.homeChute = chute;

    // charge ring painted on the ground
    const ring = new THREE.Mesh(new THREE.RingGeometry(6.0, 6.24, 64),
      new THREE.MeshBasicMaterial({ color: 0x2ad2ff, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    this.homeRing = ring;
    g.add(ring);

    // flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.3, 8), mAlu);
    pole.position.set(3.4, 1.15, -1.2); g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.58, 12, 6), makeFlagMaterial());
    flag.position.set(3.86, 2.02, -1.2); flag.castShadow = true; g.add(flag);
    this.flag = flag;

    const y = this.terrain.heightAt(HOME.x, HOME.z);
    g.position.set(HOME.x, y, HOME.z);
    g.rotation.y = -0.6;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    ring.castShadow = false; ring.receiveShadow = false;
    chute.castShadow = false;
    this.group.add(g);
    this.home = g;
    this.colliders.push({ x: HOME.x, z: HOME.z, r: 3.1, kind: 'home' });
    this.levelPad();
    return g;
  }

  /** Flatten the regolith under the sled's footpads so it never floats. */
  levelPad() {
    for (let i = 0; i < 3; i++) this.terrain.excavate(HOME.x, HOME.z, 7.5, 0.10);
  }

  /* ============================================================
     BEACON-9 — what the night left behind
     ============================================================ */
  buildStation(x, z) {
    const g = new THREE.Group();
    const mHab = new THREE.MeshStandardMaterial({ color: 0xb9b3a6, metalness: 0.25, roughness: 0.82 });
    const mAlu = new THREE.MeshStandardMaterial({ color: 0x8e8b83, metalness: 0.88, roughness: 0.48 });
    const mDark = new THREE.MeshStandardMaterial({ color: 0x1e1f22, metalness: 0.5, roughness: 0.7 });
    const mBurn = new THREE.MeshStandardMaterial({ color: 0x35302a, metalness: 0.3, roughness: 0.95 });

    // habitat cylinder, half buried by 214 days of ejecta and slumping
    const hab = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 6.4, 28, 1, false), mHab);
    hab.rotation.z = Math.PI / 2; hab.rotation.y = 0.22;
    hab.position.set(0, 1.15, 0); hab.castShadow = hab.receiveShadow = true; g.add(hab);
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(2.05, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mHab);
      cap.rotation.z = s * Math.PI / 2; cap.position.set(s * 3.2 * Math.cos(0.22), 1.15, -s * 3.2 * Math.sin(0.22));
      cap.rotation.y = 0.22; cap.castShadow = true; g.add(cap);
    }
    // airlock, door hanging open
    const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.5, 18), mAlu);
    lock.position.set(0.6, 1.5, 2.35); lock.rotation.x = Math.PI / 2; lock.castShadow = true; g.add(lock);
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.12, 18), mDark);
    door.position.set(1.9, 1.5, 3.0); door.rotation.set(Math.PI / 2, 0, 1.1); g.add(door);

    // collapsed solar farm
    for (let i = 0; i < 6; i++) {
      const a = -0.9 + i * 0.34;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x14203f, metalness: 0.5, roughness: 0.35 }));
      panel.position.set(-7 + i * 0.9, 0.35 + (i % 2) * 0.4, 4.5 + Math.sin(a) * 2.2);
      panel.rotation.set(a * 0.7, a, 0.4 + a * 0.5);
      panel.castShadow = panel.receiveShadow = true; g.add(panel);
    }
    // toppled comms mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.14, 9.5, 12), mAlu);
    mast.position.set(5.5, 0.6, -3.2); mast.rotation.set(0, 0.6, Math.PI / 2 - 0.14);
    mast.castShadow = true; g.add(mast);
    const brokenDish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 12, 0, Math.PI * 1.35, 0, Math.PI / 2.4),
      new THREE.MeshStandardMaterial({ color: 0xd8d3c8, metalness: 0.35, roughness: 0.5, side: THREE.DoubleSide }));
    brokenDish.position.set(10.0, 0.9, -3.9); brokenDish.rotation.set(1.3, 0.4, 0.9);
    brokenDish.castShadow = true; g.add(brokenDish);

    // scorch: something discharged out of the ground here
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(9.0, 40), new THREE.MeshBasicMaterial({
      color: 0x0a0a0c, transparent: true, opacity: 0.55, depthWrite: false
    }));
    scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.06; g.add(scorch);

    // scattered debris
    const rng = makeRNG(0x9EAC0);
    for (let i = 0; i < 22; i++) {
      const a = rng() * 6.28, r = 3 + rng() * 13;
      const bit = new THREE.Mesh(
        rng() < 0.5 ? new THREE.BoxGeometry(0.2 + rng() * 0.6, 0.08, 0.15 + rng() * 0.5)
                    : new THREE.CylinderGeometry(0.06, 0.06, 0.3 + rng() * 0.9, 7),
        rng() < 0.4 ? mBurn : mAlu);
      bit.position.set(Math.cos(a) * r, 0.10 + rng() * 0.1, Math.sin(a) * r);
      bit.rotation.set(rng() * 3, rng() * 6, rng() * 3);
      bit.castShadow = true; g.add(bit);
    }

    const y = this.terrain.heightAt(x, z);
    g.position.set(x, y, z);
    g.rotation.y = 1.05;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scorch.castShadow = false; scorch.receiveShadow = false;
    this.group.add(g);
    this.station = g;
    this.colliders.push({ x, z, r: 4.2, kind: 'station' });
    return g;
  }

  /* ---------------- survey pylon ---------------- */
  buildPylon(x, z, idx) {
    const g = new THREE.Group();
    const mAlu = new THREE.MeshStandardMaterial({ color: 0x9d9a92, metalness: 0.9, roughness: 0.4 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.5, 10), mAlu);
    post.position.y = 1.25; post.castShadow = true; g.add(post);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.15, 6), mAlu);
      foot.position.set(Math.cos(a) * 0.32, 0.48, Math.sin(a) * 0.32);
      foot.rotation.z = -Math.cos(a) * 0.55; foot.rotation.x = Math.sin(a) * 0.55;
      g.add(foot);
    }
    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xf2efe6, metalness: 0.2, roughness: 0.3 }));
    refl.position.y = 2.35; refl.castShadow = true; g.add(refl);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a3c }));
    led.position.set(0, 2.62, 0); g.add(led);
    const y = this.terrain.heightAt(x, z);
    g.position.set(x, y, z);
    g.userData.led = led; g.userData.phase = idx * 0.7;
    this.group.add(g);
    this.colliders.push({ x, z, r: 0.5, kind: 'pylon' });
    (this.pylons ||= []).push(g);
    return g;
  }

  /* ---------------- deployable relay ---------------- */
  buildRelay(x, z) {
    const g = new THREE.Group();
    const mAlu = new THREE.MeshStandardMaterial({ color: 0xb0aca2, metalness: 0.85, roughness: 0.35 });
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 7), mAlu);
      leg.position.set(Math.cos(a) * 0.36, 0.62, Math.sin(a) * 0.36);
      leg.rotation.z = -Math.cos(a) * 0.48; leg.rotation.x = Math.sin(a) * 0.48;
      leg.castShadow = true; g.add(leg);
    }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.24, 0.46, 12), mAlu);
    core.position.y = 1.36; core.castShadow = true; g.add(core);
    const emit = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.42, 14),
      new THREE.MeshBasicMaterial({ color: 0x5ce8ff }));
    emit.position.y = 1.80; g.add(emit);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x2ad2ff, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.y = 1.62; g.add(halo);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 40, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x2ad2ff, transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 21.5; g.add(beam);
    const y = this.terrain.heightAt(x, z);
    g.position.set(x, y, z);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    halo.castShadow = false; beam.castShadow = false; emit.castShadow = false;
    g.userData.emit = emit; g.userData.halo = halo;
    this.group.add(g);
    this.colliders.push({ x, z, r: 0.55, kind: 'relay' });
    (this.relays ||= []).push(g);
    return g;
  }

  /* ============================================================
     THE LATTICE — vitrified tubes pushing up through the floor
     ============================================================ */
  buildLatticeNode(x, z, scale = 1, big = false) {
    const g = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x1a3d4a, metalness: 0.0, roughness: 0.08,
      transmission: 0.85, thickness: 1.4, ior: 1.52,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
      emissive: 0x0a3a4a, emissiveIntensity: 0.5,
      envMapIntensity: 2.2, transparent: true, opacity: 0.92
    });
    const shards = [];
    const rng = makeRNG(Math.floor(x * 31 + z * 17) | 1);
    const n = big ? 11 : 5;
    for (let i = 0; i < n; i++) {
      const a = rng() * 6.2832;
      const len = (1.1 + rng() * 2.4) * scale;
      const rad = (0.10 + rng() * 0.20) * scale;
      const tube = new THREE.CylinderGeometry(rad * 0.55, rad, len, 6, 1);
      const m = new THREE.Matrix4();
      const tilt = 0.15 + rng() * 0.75;
      m.makeRotationZ(Math.cos(a) * tilt);
      m.multiply(new THREE.Matrix4().makeRotationX(Math.sin(a) * tilt));
      tube.applyMatrix4(m);
      tube.translate(Math.cos(a) * 0.5 * scale * rng(), len * 0.34, Math.sin(a) * 0.5 * scale * rng());
      shards.push(tube);
    }
    const merged = mergeGeometries(shards, false);
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, glass);
    mesh.castShadow = true; g.add(mesh);

    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.5 * scale, 18, 14),
      new THREE.MeshBasicMaterial({ color: 0x1ea8c8, transparent: true, opacity: 0.055,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = 0.7 * scale; g.add(glow);

    const y = this.terrain.heightAt(x, z);
    g.position.set(x, y - 0.25 * scale, z);
    g.rotation.y = rng() * 6.2832;
    this.group.add(g);
    g.userData.glow = glow; g.userData.mat = glass;
    (this.lattice ||= []).push(g);
    this.colliders.push({ x, z, r: 0.9 * scale, kind: 'lattice' });
    return g;
  }

  /** Remove anything the player deployed, so a restart starts clean. */
  clearDeployables() {
    if (this.relays) {
      for (const r of this.relays) {
        this.group.remove(r);
        r.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      }
      this.relays.length = 0;
    }
    this.colliders = this.colliders.filter(c => c.kind !== 'relay');
  }

  /* ---------------- collision query ---------------- */
  resolve(rover) {
    const px = rover.pos.x, pz = rover.pos.z;
    for (const c of this.colliders) {
      const dx = px - c.x, dz = pz - c.z;
      const d2 = dx * dx + dz * dz;
      const R = c.r + 1.05;
      if (d2 > R * R || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const push = (R - d);
      const nx = dx / d, nz = dz / d;
      rover.pos.x += nx * push; rover.pos.z += nz * push;
      const vn = rover.vel.x * nx + rover.vel.z * nz;
      if (vn < 0) {
        rover.vel.x -= vn * nx * 1.35; rover.vel.z -= vn * nz * 1.35;
        rover.omega.y += (Math.random() - 0.5) * Math.min(-vn, 4) * 0.10;
        return -vn;                      // impact speed, for damage + audio
      }
    }
    return 0;
  }

  update(dt, t, camera) {
    if (this.pylons) for (const p of this.pylons) {
      p.userData.led.visible = ((t * 1.35 + p.userData.phase) % 1) < 0.16;
    }
    if (this.relays) for (const r of this.relays) {
      const k = 0.55 + 0.45 * Math.sin(t * 2.4 + r.position.x);
      r.userData.halo.material.opacity = 0.10 + 0.10 * k;
      r.userData.emit.rotation.y += dt * 1.4;
    }
    if (this.lattice) for (const l of this.lattice) {
      const k = 0.5 + 0.5 * Math.sin(t * 0.9 + l.position.z * 0.3);
      l.userData.mat.emissiveIntensity = 0.30 + 0.55 * k;
      l.userData.glow.material.opacity = 0.035 + 0.045 * k;
    }
    if (this.homeRing) {
      this.homeRing.material.opacity = 0.11 + 0.07 * Math.sin(t * 2.0);
      this.homeRing.position.y = 0.10;
    }
    // The pad floods only come up when the sled itself is in shadow — otherwise
    // they are a bloom-magnet punched into a perfectly sunlit scene.
    if (this.homeLights) {
      const k = this.padLight ?? 0;
      const v = 0.10 + k * 1.5;
      for (const l of this.homeLights) l.material.color.setRGB(v, v * 0.94, v * 0.85);
    }
    if (this.flag) {
      // no wind — but the pole rings for a long time after it is planted
      this.flag.rotation.y = Math.sin(t * 0.7) * 0.02;
    }
    void camera;
  }
}

/** Where the sled put you down. */
export const HOME = { x: 96, z: 214 };

function makeFlagMaterial() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 156;
  const g = c.getContext('2d');
  g.fillStyle = '#0d1220'; g.fillRect(0, 0, 256, 156);
  g.strokeStyle = '#6fe3f5'; g.lineWidth = 3; g.strokeRect(8, 8, 240, 140);
  g.fillStyle = '#d8d2c6';
  g.font = '600 26px ui-monospace, monospace';
  g.fillText('SELENE', 26, 62);
  g.font = '500 14px ui-monospace, monospace';
  g.fillStyle = '#6fe3f5';
  g.fillText('DIRECTORATE', 26, 86);
  g.fillStyle = '#8b8578';
  g.font = '500 11px ui-monospace, monospace';
  g.fillText('AD LUNAM · PER NOCTEM', 26, 116);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.85, metalness: 0.0 });
}

void clamp; void sstep;
