// Living animals (owner: animals agent): cats, a dog, sheep, hens, ducks, shy woodland animals and the biome
// animals, as small upright cut-paper cards that stand on RISEN tiles only.
//
// Rendering: ONE InstancedMesh of quads (2 triangles per animal) with the art sheet public/textures/art/animals.png,
// alpha-tested, lit like a card and casting a shadow through a matching depth material: 2 draw calls in all.
// Every frame of the sheet faces right; an animal walking left mirrors its UVs and turns round like a paper flip.
//
// Simulation: which animals a cell holds is a pure function of seed + cell + tile model + biome (CONFIG.animals.spawns).
// A pool of CONFIG.animals.max slots serves the cells around the traveller; a slot is drawn only while the tile
// under it stands (it pops up as the tile settles and hides when it folds). Animals walk only where
// world.clearance allows and never collide with the traveller. Per frame nothing is allocated.
import * as THREE from 'three';
import { CONFIG, TILE_SIZE } from '../core/config.js';
import { hash2f } from '../core/rng.js';
import { biomeAt } from '../core/biomes.js';

const PI = Math.PI;
const ST_IDLE = 0; const ST_WALK = 1; const ST_FOLLOW = 2; const ST_RETURN = 3; const ST_FREEZE = 4; const ST_FLEE = 5;
const ST_FLY = 6; const ST_FLOAT = 7; const ST_PERCH = 8; const ST_SLIDE = 9;
const ST_NAMES = ['idle', 'walk', 'follow', 'return', 'freeze', 'flee', 'fly', 'float', 'perch', 'slide'];
// vignettes (round 3): an animal tied to a piece of its tile - on it, on top of it, beside it, peeking from behind it, by the door, inside a fenced yard
const VIG = { on: 1, top: 2, at: 3, behind: 4, door: 5, in: 6 };
const VIG_NAMES = ['', 'on', 'top', 'at', 'behind', 'door', 'in'];
const HOUSE_FRONT_RX = /^((?:house|cottage|cabin|manor|nave)(?:_[a-z])?)_front(?:_1)?$/;
const TRUNK_RX = /^(tree|pine|birch|pear|palm|dead_tree)/;
const MODE_GROUND = 0; const MODE_FLOAT = 1; const MODE_PERCH = 2; const MODE_BANK = 3;
const FLEE_OFFS = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3];
const EMPTY = [];
const cellKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

const _box = new THREE.Box3();
const _m = new THREE.Matrix4();
const _l = new THREE.Matrix4();

export function createAnimals({ scene, renderer, world, traveller, daynight, assets, seed = 0 }) {
  const C = CONFIG.animals;
  const N = Math.max(4, Math.min(64, C.max | 0));
  const HA = ((seed | 0) ^ 0x41a7c3) >>> 0;
  const HB = ((seed | 0) ^ 0x9e3779b1) >>> 0;

  // ---- mesh ----------------------------------------------------------------------------------------------------
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const rectArr = new Float32Array(N * 4);
  const rectAttr = new THREE.InstancedBufferAttribute(rectArr, 4);
  rectAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aRect', rectAttr);

  const cardN = { value: new THREE.Vector2(C.normal[0], C.normal[1]) };
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, alphaTest: C.alphaTest });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCardN = cardN;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRect;\nuniform vec2 uCardN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv = aRect.xy + uv * aRect.zw;')
      // a card facing the camera would lose the key light: light it with a normal tipped up toward the sky
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n\ttransformedNormal = normalize( ( viewMatrix * vec4( 0.0, uCardN.x, uCardN.y, 0.0 ) ).xyz );');
  };
  mat.customProgramCacheKey = () => 'life-animals';
  const depthMat = new THREE.MeshDepthMaterial({ alphaTest: C.alphaTest });
  depthMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv = aRect.xy + uv * aRect.zw;');
  };
  depthMat.customProgramCacheKey = () => 'life-animals-depth';

  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.name = 'life_animals';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = C.shadows !== false;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = depthMat;
  mesh.visible = false; // until the sheet is in
  const M = mesh.instanceMatrix.array;
  M.fill(0);
  for (let i = 0; i < N; i++) { M[i * 16 + 10] = 1; M[i * 16 + 15] = 1; }
  scene.add(mesh);

  // ---- sprite sheet -> pose records ----------------------------------------------------------------------------
  let tex = null;
  let loaded = false;
  let disposed = false;
  const SETS = {}; // species -> [pose set per coat]
  const SPEC = {}; // species -> config (with defaults)
  let artNames = [];

  function buildPoses(json) {
    const W = json.size[0]; const H = json.size[1];
    const art = {};
    for (const name of Object.keys(json.animals)) {
      const a = json.animals[name];
      const o = (art[name] = {});
      for (const pn of Object.keys(a.poses)) {
        const r = a.poses[pn];
        const e = 0.5;
        o[pn] = {
          name: pn, u0: (r.x + e) / W, v0: 1 - (r.y + r.h) / H, du: (r.w - 2 * e) / W, dv: (r.h - e) / H,
          w: r.w / a.unit, h: r.h / a.unit, a: (r.ax !== undefined ? r.ax : r.w / 2) / r.w, air: !!r.air,
        };
      }
    }
    artNames = Object.keys(art);
    for (const id of Object.keys(C.species)) {
      const sp = C.species[id];
      const coats = sp.coats || [sp.art || id];
      const sets = [];
      for (const cn of coats) {
        const P = art[cn];
        if (!P) continue;
        const first = P[Object.keys(P)[0]];
        const get = (n, fb) => (n && P[n]) || fb;
        const stand = get('stand', get('sit', get('perched', first)));
        const walk = [get(sp.walk && sp.walk[0], stand), get(sp.walk && sp.walk[1], stand)];
        const idle = [];
        for (const n of sp.idle || []) if (P[n]) idle.push(P[n]);
        if (!idle.length) idle.push(stand);
        sets.push({ art: cn, stand, walk, idle, air: get(sp.air, null), sit: get(sp.sit, stand), sleep: get(sp.sleep, null), float: get(sp.float, null), stretch: get('stretch', null), alert: get('tail_up', null) });
      }
      if (sets.length) { SETS[id] = sets; SPEC[id] = sp; }
    }
  }

  const ready = (async () => {
    try {
      const res = await fetch('./textures/art/animals.json');
      if (!res.ok) return false;
      const json = await res.json();
      const t = await new THREE.TextureLoader().loadAsync('./textures/art/' + (json.image || 'animals.png'));
      if (disposed) { t.dispose(); return false; }
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = Math.min(4, (renderer && renderer.capabilities.getMaxAnisotropy && renderer.capabilities.getMaxAnisotropy()) || 1);
      tex = t;
      mat.map = t; mat.needsUpdate = true;
      depthMat.map = t; depthMat.needsUpdate = true;
      buildPoses(json);
      if (renderer && renderer.initTexture) renderer.initTexture(t); // upload now, not in the first frame that shows a cat
      loaded = true;
      mesh.visible = true;
      dirty = true;
      return true;
    } catch (err) {
      console.warn('[animals] no sprite sheet:', err && err.message ? err.message : err);
      return false;
    }
  })();

  // ---- world queries -------------------------------------------------------------------------------------------
  /** Fold progress of the tile under (x, z) when it stands or is rising, else -1. */
  function riseAt(x, z) {
    const r = world.tileRecord(Math.round(x / TILE_SIZE), Math.round(z / TILE_SIZE));
    if (r === null || !r.shown || r.fold.target !== 1) return -1;
    const pr = r.fold.progress;
    return pr === undefined ? 1 : pr;
  }
  const isWater = (x, z) => world.surfaceAt(x, z) === 'water';
  function okGround(x, z) { return world.clearance(x, z) > C.minClear && riseAt(x, z) >= 0; }
  function okWater(x, z) { return isWater(x, z) && riseAt(x, z) >= 0; }
  // a follower squeezes through wherever the traveller's own feet fit (he keeps CONFIG.player.radius of room himself)
  // and stays with him over a tile that is still flat (held under his feet, or rising late)
  const okAt = (sl, x, z) => (sl.mode === MODE_FLOAT ? okWater(x, z) : sl.st === ST_FOLLOW ? world.clearance(x, z) > 0.012 : okGround(x, z));

  // ---- perches: tops of stumps / logs / rocks of a tile model (tile space, rot 0) -------------------------------
  const perchCache = new Map();
  function perchesFor(model) {
    let out = perchCache.get(model);
    if (out !== undefined) return out;
    out = [];
    try {
      const proto = assets && assets.getTilePrototype ? assets.getTilePrototype(model) : null;
      const re = new RegExp(C.perch.names, 'i');
      if (proto) proto.traverse((o) => {
        if (!o.isMesh || !o.geometry || !re.test(o.name || '')) return;
        const pos = o.geometry.getAttribute('position');
        if (!pos) return;
        _m.identity();
        for (let a = o; a && a !== proto; a = a.parent) { _l.compose(a.position, a.quaternion, a.scale); _m.premultiply(_l); }
        _box.setFromBufferAttribute(pos).applyMatrix4(_m);
        if (_box.max.y < C.perch.top[0] || _box.max.y > C.perch.top[1]) return;
        out.push((_box.min.x + _box.max.x) / 2, _box.max.y, _box.max.z, o.name);
      });
    } catch { out = []; }
    perchCache.set(model, out);
    return out;
  }

  // ---- vignette anchors (round 3): the pieces of a tile model AS DRAWN (world.standSpecs / standFix: cards turned to
  // the camera and scaled, houses grown; thinned cards left out), in tile space at rot 0; parity = cell.rot & 1 ------
  const pieceCache = new Map();
  function piecesFor(model, parity) {
    const key = parity ? model + '/1' : model;
    let out = pieceCache.get(key);
    if (out !== undefined) return out;
    out = [];
    try {
      const proto = assets && assets.getTilePrototype ? assets.getTilePrototype(model) : null;
      if (proto) {
        const list = [];
        proto.traverse((o) => { if (o.isMesh && o.geometry && !/^base/i.test(o.name || '') && o.geometry.getAttribute('position')) list.push(o); });
        const sp = world.standSpecs ? world.standSpecs(model, proto, list) : null;
        list.forEach((o, li) => {
          if (sp && sp.thin[li] === 1) return;
          _m.identity();
          for (let a = o; a && a !== proto; a = a.parent) { _l.compose(a.position, a.quaternion, a.scale); _m.premultiply(_l); }
          if (sp && world.standFix) world.standFix(sp, li, parity, _m);
          _box.setFromBufferAttribute(o.geometry.getAttribute('position'));
          const e = _m.elements;
          const sx = _box.max.x - _box.min.x; const sy = _box.max.y - _box.min.y; const sz = _box.max.z - _box.min.z;
          const mx = (_box.min.x + _box.max.x) / 2; const my = (_box.min.y + _box.max.y) / 2; const mz = (_box.min.z + _box.max.z) / 2;
          const px = e[0] * mx + e[4] * my + e[8] * mz + e[12]; const pz = e[2] * mx + e[6] * my + e[10] * mz + e[14];
          const hx = [e[0] * sx, e[4] * sy, e[8] * sz]; const hz = [e[2] * sx, e[6] * sy, e[10] * sz]; // horizontal span of each local axis
          let j = 0;
          for (let i = 1; i < 3; i++) if (hx[i] * hx[i] + hz[i] * hz[i] > hx[j] * hx[j] + hz[j] * hz[j]) j = i;
          _box.applyMatrix4(_m);
          if (_box.max.y < 0.1) return; // a flat print
          // x, z = middle of the piece's base line, (hx, hz) = half of that line, top = its highest point
          out.push({ name: String(o.name || '').replace(/^.*__/, ''), x: px, z: pz, hx: hx[j] / 2, hz: hz[j] / 2, top: _box.max.y });
        });
      }
    } catch { out = []; }
    pieceCache.set(key, out);
    return out;
  }
  const rxCache = new Map();
  function rxFor(src) { let r = rxCache.get(src); if (r === undefined) { r = new RegExp('^(?:' + src + ')'); rxCache.set(src, r); } return r; }
  const _anc = { x: 0, y: 0, z: 0, face: 0, spread: 0 };
  const _cand = [];
  const spotOk = (x, z, room) => world.clearance(x, z) >= room && world.surfaceAt(x, z) !== 'water' && world.surfaceAt(x, z) !== 'bridge';
  // a sitter up on a piece shows on screen where the ground about 1.1 x its height further north would be (camera pitch
  // ~42 degrees): test both its feet and that point, so a cat on the hay does not cover the dog sitting behind it
  function taken(list, x, z, r, y = 0) {
    const zy = z - 1.1 * y;
    for (let k = 0; k < list.length; k++) {
      const q = list[k]; const dx = q.x - x; const zq = q.z - 1.1 * (q.y || 0);
      let dz = q.z - z; if (dx * dx + dz * dz < r * r) return true;
      dz = zq - zy; if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
  /**
   * The spot of a vignette on cell (cx, cz): _anc = world x / y / z (+ face, or spread for 'in'); false when the tile has
   * no such piece or no room there (the caller falls back to the plain rule). Pure function of the cell.
   */
  function resolveAnchor(vig, re, cell, cx, cz, rot, biome, h1, h2, list) {
    const pieces = piecesFor(cell.model, rot & 1);
    if (!pieces.length) return false;
    const bare = biome === 'desert' || biome === 'snow';
    const ox = cx * TILE_SIZE; const oz = cz * TILE_SIZE;
    const c4 = rot === 0 ? 1 : rot === 2 ? -1 : 0; const s4 = rot === 1 ? 1 : rot === 3 ? -1 : 0; // tile (u, v) -> world (u c - v s, u s + v c)
    if (vig === VIG.door) {
      _cand.length = 0;
      for (const pc of pieces) if (HOUSE_FRONT_RX.test(pc.name)) _cand.push(pc);
      for (let k = 0; k < _cand.length; k++) {
        const f = _cand[(Math.floor(h1 * _cand.length) + k) % _cand.length];
        const base = HOUSE_FRONT_RX.exec(f.name)[1];
        let b = null;
        for (const pc of pieces) if (pc.name === base + '_back' || pc.name === base + '_back_1') { b = pc; break; }
        if (b === null) continue;
        let nu = f.x - b.x; let nv = f.z - b.z; const nl = Math.hypot(nu, nv) || 1; nu /= nl; nv /= nl;
        const half = Math.hypot(f.hx, f.hz) || 0.1; const side = h2 < 0.5 ? -1 : 1;
        const along = side * Math.min(0.17, half * 0.6);
        const nwz = nu * s4 + nv * c4; // world z of the outward normal: < 0 = the door looks away from the camera
        if (nwz > -0.3) {
          for (let d = 0.1; d < 0.34; d += 0.04) {
            const u = f.x + nu * d + (f.hx / half) * along; const v = f.z + nv * d + (f.hz / half) * along;
            const x = ox + u * c4 - v * s4; const z = oz + u * s4 + v * c4;
            if (!spotOk(x, z, 0.04) || taken(list, x, z, 0.2)) continue;
            _anc.x = x; _anc.z = z; _anc.y = 0; _anc.face = side; return true;
          }
        }
        // door on the far side: at the foot of the wall that faces the camera instead
        const mu = (f.x + b.x) / 2; const mv = (f.z + b.z) / 2;
        const hxw = ox + mu * c4 - mv * s4 + side * 0.12; const hzw = oz + mu * s4 + mv * c4;
        let wasIn = false;
        for (let d = 0.05; d < 0.9; d += 0.04) {
          const okk = spotOk(hxw, hzw + d, 0.04);
          if (!okk) { wasIn = true; continue; }
          if (!wasIn || taken(list, hxw, hzw + d, 0.2)) continue;
          _anc.x = hxw; _anc.z = hzw + d + 0.02; _anc.y = 0; _anc.face = side; return true;
        }
      }
      return false;
    }
    _cand.length = 0;
    const lo = vig === VIG.top ? 0.6 : vig === VIG.on ? 0.13 : 0.1; const hi = vig === VIG.top ? 2.4 : vig === VIG.on ? 0.75 : 9;
    for (const pc of pieces) {
      if (!re.test(pc.name) || /_x[bf]?$|_rear$|_roof|_side_/.test(pc.name) || pc.top < lo || pc.top > hi) continue;
      if (bare && /^(bush|tuft|flowers|hay)/.test(pc.name)) continue; // heartland soft cards do not rise on sand and snow
      if (biome === 'desert' && /^fence/.test(pc.name)) continue;
      _cand.push(pc);
    }
    const n = _cand.length;
    if (n === 0) return false;
    if (vig === VIG.in) {
      if (n < 2) return false;
      let x0 = 9; let z0 = 9; let x1 = -9; let z1 = -9;
      // the box of the whole runs (ends, not middles): an L of two runs (a yard corner) encloses its inside too
      for (const pc of _cand) { const ex = Math.abs(pc.hx); const ez = Math.abs(pc.hz); x0 = Math.min(x0, pc.x - ex); x1 = Math.max(x1, pc.x + ex); z0 = Math.min(z0, pc.z - ez); z1 = Math.max(z1, pc.z + ez); }
      const w = Math.min(x1 - x0, z1 - z0);
      if (w < 0.3) return false;
      const u = (x0 + x1) / 2; const v = (z0 + z1) / 2;
      _anc.x = ox + u * c4 - v * s4; _anc.z = oz + u * s4 + v * c4; _anc.y = 0; _anc.face = 0; _anc.spread = Math.max(0.12, w * 0.3);
      return true;
    }
    for (let k = 0; k < n; k++) {
      const pc = _cand[(Math.floor(h1 * n) + k) % n];
      const half = Math.hypot(pc.hx, pc.hz);
      const wx = ox + pc.x * c4 - pc.z * s4; const wz = oz + pc.x * s4 + pc.z * c4;
      const ax = pc.hx * c4 - pc.hz * s4; const az = pc.hx * s4 + pc.hz * c4; // half base line in world space
      if (vig === VIG.on || vig === VIG.top) {
        if (vig === VIG.on && half < 0.07) continue;
        const t = vig === VIG.top ? 0 : (h2 - 0.5) * 0.9;
        const x = wx + ax * t; const z = wz + az * t + 0.02;
        if (taken(list, x, z, 0.16, pc.top)) continue;
        _anc.x = x; _anc.z = z; _anc.y = vig === VIG.top ? pc.top * C.vignettes.topK : pc.top - C.vignettes.sink; _anc.face = h2 < 0.5 ? -1 : 1;
        return true;
      }
      const s0 = h2 < 0.5 ? -1 : 1;
      if (vig === VIG.at) {
        const trunk = TRUNK_RX.test(pc.name);
        const reach = (trunk ? 0.08 : Math.abs(ax)) + 0.14;
        for (let q = 0; q < 4; q++) {
          const sd = q & 1 ? -s0 : s0;
          const x = wx + sd * (q < 2 ? reach : reach * 0.4); const z = wz + (q < 2 ? 0.07 : 0.2);
          if (!spotOk(x, z, 0.06) || taken(list, x, z, 0.22)) continue;
          _anc.x = x; _anc.z = z; _anc.y = 0; _anc.face = sd; return true;
        }
      } else { // behind: the body north of the card (hidden by it), the head out past its edge
        const off = TRUNK_RX.test(pc.name) ? 0.1 : Math.max(0.08, Math.abs(ax) * 0.8);
        for (let q = 0; q < 2; q++) {
          const sd = q ? -s0 : s0;
          const x = wx + sd * off; const z = wz - 0.05;
          if (!spotOk(x, z, 0.03) || taken(list, x, z, 0.22)) continue;
          _anc.x = x; _anc.z = z; _anc.y = 0; _anc.face = sd; return true;
        }
      }
    }
    return false;
  }

  // ---- who lives where: pure function of seed + cell -----------------------------------------------------------
  const cache = new Map(); // cellKey -> [spec]
  const _spot = { x: 0, z: 0 };
  function nearWater(x, z, r) {
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; if (isWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true; }
    return false;
  }
  /** A standing spot in the cell around the tile-space-free offset (ax, az); false when the tile has none. */
  function findSpot(cx, cz, salt, mode, ax, az, spread, list) {
    for (let i = 0; i < 26; i++) {
      let ox = ax + (hash2f(cx * 3 + i * 7 + salt, cz * 3 + 1 - salt, HB) - 0.5) * 2 * spread * (i > 16 ? 1.6 : 1);
      let oz = az + (hash2f(cx * 3 + 2 + salt, cz * 3 + i * 5 - salt, HB + 31) - 0.5) * 2 * spread * (i > 16 ? 1.6 : 1);
      ox = Math.max(-0.84, Math.min(0.84, ox)); oz = Math.max(-0.84, Math.min(0.84, oz));
      const x = cx * TILE_SIZE + ox; const z = cz * TILE_SIZE + oz;
      if (mode === MODE_FLOAT) {
        if (!(isWater(x, z) && isWater(x + 0.15, z) && isWater(x - 0.15, z) && isWater(x, z + 0.15) && isWater(x, z - 0.15))) continue;
      } else {
        if (world.clearance(x, z) < (mode === MODE_BANK ? 0.09 : 0.14)) continue;
        if (world.surfaceAt(x, z) === 'bridge') continue;
        if (mode === MODE_BANK && !nearWater(x, z, 0.3)) continue;
        // not in the strip a standing prop hides from the camera (it looks north: the strip lies behind the prop)
        if (i < 16 && mode !== MODE_BANK && (world.clearance(x, z + 0.2) <= 0.02 || world.clearance(x, z + 0.42) <= 0.02)) continue;
      }
      let close = false;
      for (let k = 0; k < list.length && !close; k++) { const dx = list[k].x - x; const dz = list[k].z - z; close = i < 18 ? dx * dx + dz * dz * 3.2 < 0.3 * 0.3 : dx * dx + dz * dz < 0.15 * 0.15; } // shortfall fixer: side by side they must not overlap into one two-headed card (first 18 tries: 0.3 wide, 0.17 deep)
      if (close) continue;
      _spot.x = x; _spot.z = z;
      return true;
    }
    return false;
  }

  function specsFor(cx, cz) {
    const k = cellKey(cx, cz);
    let list = cache.get(k);
    if (list !== undefined) return list;
    list = EMPTY;
    const cell = world.tileAt(cx, cz);
    const biome = (cell && cell.biome) || biomeAt(seed, cx, cz);
    const table = cell ? ((C.spawns[biome] && C.spawns[biome][cell.model]) || C.spawns.all[cell.model]) : null;
    if (table) {
      list = [];
      const rot = (((cell.rot | 0) % 4) + 4) % 4;
      for (let e = 0; e < table.length; e++) {
        const [id, chance, lo, hi, flags = ''] = table[e];
        const sp = SPEC[id];
        if (!sp) continue;
        if (hash2f(cx * 5 + e * 3, cz * 7 - e, HA) >= chance * C.density) continue;
        const n = lo + Math.floor(hash2f(cx * 5 - e, cz * 7 + e * 3, HA + 7) * (hi - lo + 1));
        const when = flags.includes('d') ? 1 : flags.includes('n') ? 2 : 0;
        const mode = flags.includes('w') ? MODE_FLOAT : flags.includes('p') ? MODE_PERCH : flags.includes('b') ? MODE_BANK : MODE_GROUND;
        const group = flags.includes('h') || flags.includes('c');
        let ax = 0; let az = 0; let spread = 0.78;
        if (flags.includes('o')) {
          // by the door: house in the north half, door + path to the south (tile space), turned with the tile
          let u = (hash2f(cx, cz, HA + 3) < 0.5 ? -1 : 1) * 0.3; let v = 0.28;
          for (let i = 0; i < rot; i++) { const t = u; u = -v; v = t; }
          ax = u; az = v; spread = 0.22;
        }
        // 6th item: [east, south, spread] in tile space (turned with the tile), or a vignette 'kind:piece names'
        // (round 3; then an optional 7th item is the [east, south, spread] used when the tile has no such piece)
        const a5 = table[e][5];
        const anc = Array.isArray(a5) ? a5 : Array.isArray(table[e][6]) ? table[e][6] : null;
        let vk = 0; let vre = null;
        if (typeof a5 === 'string' && C.vignettes.enabled !== false) { const c = a5.indexOf(':'); vk = VIG[c < 0 ? a5 : a5.slice(0, c)] || 0; vre = c < 0 ? null : rxFor(a5.slice(c + 1)); }
        // fixer (round 3): life was stamped - a cat perched on a prop in every settled tile (3-4 per frame). Only one
        // cell of each perchEvery x perchEvery block may seat its cat on a prop; elsewhere that cat sleeps at the door
        // (dropped when the tile already has a door cat, or a plain wanderer on tiles without a door).
        const PE = C.vignettes.perchEvery | 0;
        if (vk === VIG.on && id === 'cat' && PE > 1) {
          const bx = Math.floor(cx / PE); const bz = Math.floor(cz / PE);
          const pick = Math.floor(hash2f(bx * 3 + 1, bz * 5 - 2, HA + 29) * PE * PE);
          if ((cx - bx * PE) + (cz - bz * PE) * PE !== pick) {
            if (table.some((r) => r[0] === 'cat' && r[5] === 'door')) continue;
            vk = VIG.door; vre = null;
          }
        }
        let fixed = false;
        if (anc !== null) {
          let u = anc[0]; let v = anc[1];
          for (let i = 0; i < rot; i++) { const t = u; u = -v; v = t; }
          ax = u; az = v; spread = anc[2] || 0.2; fixed = true;
        }
        if (vk === VIG.in && resolveAnchor(vk, vre, cell, cx, cz, rot, biome, 0, 0, list)) { ax = _anc.x - cx * TILE_SIZE; az = _anc.z - cz * TILE_SIZE; spread = _anc.spread; fixed = true; }
        let prev = null;
        for (let j = 0; j < n; j++) {
          const salt = e * 17 + j * 5;
          let x; let z; let y = 0; let vig = 0; let face = 0; let m = mode;
          if (vk !== 0 && vk !== VIG.in && resolveAnchor(vk, vre, cell, cx, cz, rot, biome, hash2f(cx * 7 + salt, cz * 3 - salt, HA + 17), hash2f(cx * 3 - salt, cz * 7 + salt, HA + 19), list)) {
            x = _anc.x; z = _anc.z; y = _anc.y; vig = vk; face = _anc.face; m = vk === VIG.on || vk === VIG.top ? MODE_PERCH : MODE_GROUND;
          } else if (mode === MODE_PERCH) {
            const ps = perchesFor(cell.model);
            if (!ps.length) break;
            const pi = Math.floor(hash2f(cx + salt, cz - salt, HA + 11) * (ps.length / 4)) * 4;
            let u = ps[pi]; let v = ps[pi + 2] + 0.015;
            for (let i = 0; i < rot; i++) { const t = u; u = -v; v = t; }
            x = cx * TILE_SIZE + u; z = cz * TILE_SIZE + v; y = ps[pi + 1];
            if (rot !== 0) z += 0.03;
          } else {
            if (!findSpot(cx, cz, salt, mode, ax, az, spread, list)) break;
            x = _spot.x; z = _spot.z;
            if (group && j === 0 && !fixed) { ax = x - cx * TILE_SIZE; az = z - cz * TILE_SIZE; spread = mode === MODE_BANK ? 0.3 : 0.2 + 0.09 * n; }
          }
          const spec = {
            key: k * 32 + list.length, id, sp, set: SETS[id][Math.floor(hash2f(cx * 11 + salt, cz * 13 + salt, HA + 5) * SETS[id].length)],
            x, y, z, when, mode: m, vig: vig || (vk === VIG.in && fixed ? VIG.in : 0), face, lead: flags.includes('c') ? prev : null,
            seed: (hash2f(cx * 17 + salt, cz * 19 - salt, HB + 9) * 4294967296) >>> 0,
          };
          list.push(spec);
          prev = spec;
          if (list.length >= 8) break;
        }
        if (list.length >= 8) break;
      }
      if (!list.length) list = EMPTY;
    }
    if (cache.size > 5000) cache.clear();
    cache.set(k, list);
    return list;
  }

  // ---- slots ----------------------------------------------------------------------------------------------------
  const slots = [];
  for (let i = 0; i < N; i++) {
    slots.push({
      i, live: false, spec: null, sp: null, set: null, mode: 0, st: 0, st0: 0, x: 0, y: 0, z: 0, hx: 0, hz: 0, tx: 0, tz: 0, fx: 0, fz: 0,
      t: 0, dur: 0, v: 0, air: false, idle: null, face: 1, faceK: 1, s: 0, ph: 0, rock: 0, lift: 0, r: 1, mv: false, stuck: 0,
      cool: 0, ft: 0, fmax: 0, side: 1, ang: 0, rad: 0, dir: 1, stale: false, seen: 0, comp: false, leave: false, nap: 0, wake: 0, bio: 0, unset: 0, fy: 0,
    });
  }
  const byKey = new Map(); // spec.key -> slot
  let scanId = 0;
  let lastCx = NaN; let lastCz = NaN;
  let dirty = true;
  let night = !!(daynight && daynight.night);
  let clock = 0;
  let live = 0; let shown = 0; let followers = 0; let spawned = 0;

  function rnd(sl) { sl.r = (Math.imul(sl.r, 1664525) + 1013904223) >>> 0; return sl.r / 4294967296; }
  function hide(sl) { const o = sl.i * 16; M[o] = M[o + 1] = M[o + 4] = M[o + 5] = 0; M[o + 13] = -50; }
  function release(sl) {
    if (byKey.get(sl.spec.key) === sl) byKey.delete(sl.spec.key);
    if (comp === sl) comp = null;
    sl.live = false; sl.spec = null; sl.s = 0; sl.comp = false; sl.leave = false;
    hide(sl);
  }
  /** Back to where the cell's own rule puts it (also the start state). */
  function reset(sl) {
    const sc = sl.spec;
    sl.x = sl.hx = sc.x; sl.z = sl.hz = sc.z; sl.y = sc.y;
    sl.r = sc.seed || 1;
    sl.mode = sc.mode; // a bank duck that slid into the water is a bank duck again
    sl.st = sl.st0 = sc.mode === MODE_FLOAT ? ST_FLOAT : sc.mode === MODE_PERCH ? ST_PERCH : ST_IDLE;
    sl.t = 0; sl.dur = rnd(sl) * 4; sl.v = 0; sl.air = false; sl.stuck = 0; sl.cool = 0; sl.ft = 0; sl.ph = 0; sl.rock = 0; sl.lift = 0;
    sl.face = rnd(sl) < 0.5 ? -1 : 1; sl.faceK = sl.face;
    sl.side = rnd(sl) < 0.5 ? -1 : 1;
    sl.idle = sl.set.idle[(rnd(sl) * sl.set.idle.length) | 0];
    if (sc.mode === MODE_FLOAT) {
      const arc = sl.sp.arc || [0.1, 0.25];
      sl.rad = arc[0] + rnd(sl) * (arc[1] - arc[0]);
      sl.ang = rnd(sl) * PI * 2; sl.dir = rnd(sl) < 0.5 ? -1 : 1;
      sl.fx = sc.x - Math.cos(sl.ang) * sl.rad; sl.fz = sc.z - Math.sin(sl.ang) * sl.rad;
      sl.idle = sl.set.float || sl.set.stand;
    } else if (sc.mode !== MODE_PERCH) sl.y = world.heightAt(sc.x, sc.z) || 0;
    if (sc.vig > 0 && sc.vig !== VIG.in) {
      // a vignette starts in its pose: asleep (or sitting) by the door, sitting on the rail / by the cart, peeking out
      if (sc.face) sl.face = sl.faceK = sc.face;
      if (sc.vig === VIG.door) { sl.idle = sl.set.sleep !== null && rnd(sl) < C.vignettes.doorSleep ? sl.set.sleep : sl.set.sit; sl.dur = 14 + rnd(sl) * 20; }
      else if (sc.vig !== VIG.top) { sl.idle = sl.set.sit; sl.dur = 6 + rnd(sl) * 10; }
    }
  }
  function spawn(spec) {
    let sl = null;
    for (let i = 0; i < N; i++) if (!slots[i].live) { sl = slots[i]; break; }
    if (!sl) return null;
    sl.live = true; sl.spec = spec; sl.sp = spec.sp; sl.set = spec.set; sl.mode = spec.mode; sl.s = 0; sl.stale = false;
    sl.comp = false; sl.leave = false; sl.nap = 0; sl.wake = 0; sl.bio = 0; sl.unset = 0; sl.fy = 0;
    reset(sl);
    byKey.set(spec.key, sl);
    spawned++;
    return sl;
  }

  /** Give every animal of the cells in range a slot (nearest cells first); mark the others stale. */
  function rescan() {
    dirty = false;
    scanId++;
    const p = traveller.position;
    const tcx = Math.round(p.x / TILE_SIZE); const tcz = Math.round(p.z / TILE_SIZE);
    lastCx = tcx; lastCz = tcz;
    const R = Math.ceil(C.range / TILE_SIZE);
    const r2 = (C.range + TILE_SIZE * 0.5) * (C.range + TILE_SIZE * 0.5);
    for (let r = 0; r <= R; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = tcx + dx; const cz = tcz + dz;
          const ex = cx * TILE_SIZE - p.x; const ez = cz * TILE_SIZE - p.z;
          if (ex * ex + ez * ez > r2) continue;
          const list = specsFor(cx, cz);
          for (let k = 0; k < list.length; k++) {
            const sc = list[k];
            if ((sc.when === 1 && night) || (sc.when === 2 && !night)) continue;
            let sl = byKey.get(sc.key);
            if (sl === undefined) sl = spawn(sc);
            if (sl) { sl.seen = scanId; sl.stale = false; }
          }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const sl = slots[i];
      if (!sl.live || sl.seen === scanId) continue;
      if (sl.comp || sl.spec.key < 0) continue; // the companion belongs to no cell
      // a cat that is walking with him (or back home) lives on while he is near
      if (sl.st === ST_FOLLOW || sl.st === ST_RETURN) { const dx = sl.x - p.x; const dz = sl.z - p.z; if (dx * dx + dz * dz < 36) continue; }
      sl.stale = true;
    }
  }

  // ---- movement -------------------------------------------------------------------------------------------------
  /** One step toward (tx, tz): 0 = under way, 1 = there, 2 = blocked. Slides along blockers on one axis. */
  function advance(sl, tx, tz, speed, dt) {
    const ex = tx - sl.x; const ez = tz - sl.z;
    const el = Math.sqrt(ex * ex + ez * ez);
    if (el < 0.02) return 1;
    const st = Math.min(el, speed * dt);
    if (st <= 0) return 0;
    const nx = sl.x + (ex / el) * st; const nz = sl.z + (ez / el) * st;
    if (okAt(sl, nx, nz)) { sl.x = nx; sl.z = nz; }
    else if (Math.abs(ex) > 0.03 && okAt(sl, sl.x + Math.sign(ex) * st, sl.z)) sl.x += Math.sign(ex) * st;
    else if (Math.abs(ez) > 0.03 && okAt(sl, sl.x, sl.z + Math.sign(ez) * st)) sl.z += Math.sign(ez) * st;
    else return 2;
    sl.ph += Math.min(st / sl.sp.step, dt * C.stepRate); // a trot swaps frames no faster than paper can flap
    sl.mv = true;
    if (Math.abs(ex) > 0.3 * el) sl.face = ex > 0 ? 1 : -1;
    if (sl.mode !== MODE_FLOAT) sl.y = world.heightAt(sl.x, sl.z) || 0;
    return st >= el ? 1 : 0;
  }
  function wander(sl) {
    const sp = sl.sp;
    if (!(sp.roam > 0) || !(sp.speed > 0)) return false;
    const tx = sl.hx + (rnd(sl) - 0.5) * 2 * sp.roam; const tz = sl.hz + (rnd(sl) - 0.5) * 2 * sp.roam;
    if (!okAt(sl, tx, tz)) return false;
    sl.tx = tx; sl.tz = tz; sl.st = ST_WALK; sl.t = 0; sl.stuck = 0;
    const frisky = sp.frisky && rnd(sl) < sp.frisky;
    sl.v = frisky ? sp.run : sp.speed; sl.air = !!frisky || (!!sl.set.air && sp.b === 'shy');
    return true;
  }
  function think(sl) {
    const sp = sl.sp; const b = sp.b; const set = sl.set;
    sl.t = 0;
    if (b === 'perch') { sl.dur = 9; return; }
    const vg = sl.spec.vig;
    if (vg >= VIG.at && vg <= VIG.door && rnd(sl) < C.vignettes.stay) {
      const hx = sl.x - sl.spec.x; const hz = sl.z - sl.spec.z;
      if (hx * hx + hz * hz < 0.01) { // still at its prop: the same pose again
        if (vg !== VIG.door || sl.idle !== set.sleep) sl.idle = set.sit;
        if (sl.spec.face) sl.face = sl.spec.face;
        sl.dur = 6 + rnd(sl) * 10;
        return;
      }
      if (sp.speed > 0 && okAt(sl, sl.spec.x, sl.spec.z)) { sl.tx = sl.spec.x; sl.tz = sl.spec.z; sl.st = ST_WALK; sl.v = sp.speed; sl.air = false; sl.stuck = 0; return; } // back to it
    }
    let walkP = b === 'pet' ? 0.45 : b === 'graze' ? 0.55 : b === 'peck' ? 0.25 : 0.3;
    if (night) { if (b === 'graze' && !sp.restless) walkP = 0.04; else if (b === 'pet') walkP = 0.22; }
    if (sp.restless) walkP = 0.8;
    if (sl.idle !== set.sleep || rnd(sl) < 0.5) { if (rnd(sl) < walkP && wander(sl)) return; }
    let pose = set.idle[(rnd(sl) * set.idle.length) | 0];
    if (night) { if (b === 'pet' && set.sleep && rnd(sl) < 0.5) pose = set.sleep; else if (b === 'graze') pose = set.stand; }
    sl.idle = pose;
    sl.dur = pose === set.sleep ? 12 + rnd(sl) * 16 : b === 'peck' ? 0.35 + rnd(sl) * 1.3 : sp.restless ? 0.6 + rnd(sl) * 1.6 : b === 'graze' ? 3 + rnd(sl) * 6 : 2.5 + rnd(sl) * 5;
  }
  /** Away from the traveller (dx, dz = vector to him): a free spot `dist` off, tried at widening angles. */
  function startFlee(sl, dx, dz, dist, fly) {
    const base = Math.atan2(-dz, -dx);
    for (let sc = 0; sc < 2; sc++) {
      const d = dist * (sc ? 0.6 : 1);
      for (let k = 0; k < FLEE_OFFS.length; k++) {
        const a = base + FLEE_OFFS[k] * (sl.side || 1);
        const tx = sl.x + Math.cos(a) * d; const tz = sl.z + Math.sin(a) * d;
        if (!okAt(sl, tx, tz)) continue;
        if (!fly && !okAt(sl, (sl.x + tx) / 2, (sl.z + tz) / 2)) continue;
        sl.tx = tx; sl.tz = tz; sl.t = 0; sl.stuck = 0;
        if (fly) { sl.st = ST_FLY; sl.fx = sl.x; sl.fz = sl.z; sl.dur = 1.3 + d * 0.5; }
        else { sl.st = ST_FLEE; sl.v = sl.sp.run || sl.sp.speed; sl.air = !!sl.set.air || !!sl.sp.leap; }
        return true;
      }
    }
    return false;
  }
  function tryFollow(sl, d2, tsp) {
    const sp = sl.sp;
    if (!(sp.follow > 0) || sl.leave || sl.cool > 0 || d2 > sp.notice * sp.notice || tsp < 0.4 || (sl.st === ST_IDLE && sl.idle === sl.set.sleep)) return false;
    if (followers >= C.maxFollowers || rnd(sl) >= sp.follow) { sl.cool = 8; return false; }
    sl.st = ST_FOLLOW; sl.t = 0; sl.ft = 0; sl.stuck = 0; sl.air = false; sl.rad = 0;
    sl.fmax = sp.followTime[0] + rnd(sl) * (sp.followTime[1] - sp.followTime[0]);
    followers++;
    return true;
  }
  function endFollow(sl) {
    sl.cool = C.followCool; sl.st = ST_RETURN; sl.t = 0; sl.stuck = 0; sl.air = false;
    sl.tx = sl.hx; sl.tz = sl.hz; sl.v = sl.sp.speed * 1.7;
  }
  function settleDown(sl, dx) {
    const was = sl.st;
    sl.st = ST_IDLE; sl.t = 0; sl.stuck = 0; sl.air = false;
    if (was === ST_FLEE || was === ST_FLY) {
      // peek back at him from the new cover, which is home from now on
      sl.cool = 5; sl.hx = sl.x; sl.hz = sl.z;
      sl.idle = was === ST_FLY ? sl.set.walk[0] : sl.set.sit;
      if (Math.abs(dx) > 0.1) sl.face = dx > 0 ? 1 : -1;
      sl.dur = 2.5 + rnd(sl) * 3;
    } else if (was === ST_RETURN) { sl.idle = sl.set.sit; sl.dur = 3 + rnd(sl) * 4; }
    else { sl.idle = sl.set.idle[(rnd(sl) * sl.set.idle.length) | 0]; sl.dur = sl.sp.b === 'pet' ? 2 + rnd(sl) * 5 : 0.6 + rnd(sl) * 2.5; }
  }

  /** A bank duck slides into the water next to it, away from the traveller (dx, dz = vector to him). */
  function startSlide(sl, dx, dz) {
    const base = Math.atan2(-dz, -dx);
    for (let ri = 0; ri < 4; ri++) {
      const r = 0.3 + ri * 0.14;
      for (let k = 0; k < FLEE_OFFS.length; k++) {
        const a = base + FLEE_OFFS[k] * (sl.side || 1);
        const tx = sl.x + Math.cos(a) * r; const tz = sl.z + Math.sin(a) * r;
        if (!okWater(tx, tz) || !isWater(tx + 0.13, tz) || !isWater(tx - 0.13, tz) || !isWater(tx, tz + 0.13) || !isWater(tx, tz - 0.13)) continue;
        sl.fx = sl.x; sl.fz = sl.z; sl.tx = tx; sl.tz = tz; sl.st = ST_SLIDE; sl.t = 0; sl.dur = 0.45 + r * 1.3; sl.stuck = 0; sl.air = false;
        return true;
      }
    }
    sl.cool = 2.5; // no water within reach: look again later
    return false;
  }

  // ---- the companion (round 3): ONE cat adopts the traveller ---------------------------------------------------------
  let comp = null; // its slot
  let compWait = (C.companion && C.companion.after) || 5; // seconds until it may appear
  let compSearch = 0; // seconds spent waiting for a cat of the place to notice him
  let compSeen = -1; // clock at the first adoption
  const compSpec = { key: -7, id: '', sp: null, set: null, x: 0, y: 0, z: 0, when: 0, mode: MODE_GROUND, vig: 0, face: 0, lead: null, seed: 1 };
  function settledAt(x, z) {
    const K = C.companion;
    if (!K.biomes) return true;
    const cx = Math.round(x / TILE_SIZE); const cz = Math.round(z / TILE_SIZE);
    const cell = world.tileAt(cx, cz);
    return K.biomes.includes((cell && cell.biome) || biomeAt(seed, cx, cz));
  }
  function adopt(sl, quick) {
    // never more than maxFollowers in all: another cat that is following goes home
    let nf = 0;
    for (let i = 0; i < N; i++) if (slots[i].live && slots[i] !== sl && slots[i].st === ST_FOLLOW) nf++;
    for (let i = 0; i < N && nf >= C.maxFollowers; i++) { const o = slots[i]; if (o.live && o !== sl && o.st === ST_FOLLOW && !o.comp) { endFollow(o); nf--; } }
    if (sl.st !== ST_FOLLOW) followers++;
    comp = sl; sl.comp = true; sl.leave = false; sl.stale = false;
    sl.st = ST_FOLLOW; sl.t = 0; sl.ft = 0; sl.stuck = 0; sl.air = false; sl.rad = 0; sl.nap = 0; sl.unset = 0; sl.bio = 1; sl.dur = 0;
    sl.wake = quick ? 0 : 0.6; // tail up: it has noticed him
    if (compSeen < 0) compSeen = clock;
  }
  /** The companion lets him go: it walks home (a cat of the place), sits and watches him leave, or folds away. */
  let compLeft = ''; // why it last left (checks)
  function dismiss(sl, gap, sit, why) {
    const K = C.companion; compLeft = why + '@' + clock.toFixed(1);
    sl.comp = false; comp = null; compWait = gap; compSearch = Math.max(0, (K.spawnAfter || 12) - (K.back || 4));
    if (sl.spec.key < 0) {
      if (sit) { sl.st = ST_IDLE; sl.idle = sl.set.sit; sl.t = 0; sl.dur = 1e9; sl.hx = sl.x; sl.hz = sl.z; sl.leave = true; }
      else sl.stale = true;
    } else endFollow(sl);
  }
  /** Its own cat pops up `near` him (r = 0: right beside him, for stills) and comes over. */
  function spawnCompanion(p, mdx, mdz, beside) {
    const K = C.companion; const id = K.species || 'cat';
    if (!SETS[id] || byKey.has(compSpec.key)) return false;
    const base = Math.atan2(mdz, mdx); // ahead of him, so he walks up to it (a cat behind a walking man never catches up in time)
    let fx = 0; let fz = 0; let found = false;
    for (let ri = 0; ri < 4 && !found; ri++) {
      const r = beside ? 0.3 + ri * 0.07 : [2.2, 1.7, 2.7, 1.3][ri];
      for (let k = 0; k < FLEE_OFFS.length && !found; k++) {
        const a = beside ? (k & 1 ? PI : 0) + (k >> 1) * 0.5 - 0.25 : base + FLEE_OFFS[(k + 1) % FLEE_OFFS.length] * 0.8;
        const x = p.x + Math.cos(a) * r; const z = p.z + Math.sin(a) * r + (beside ? 0.06 : 0);
        if (beside ? world.clearance(x, z) > 0.03 && !isWater(x, z) : okGround(x, z) && riseAt(x, z) >= C.riseAt) { fx = x; fz = z; found = true; }
      }
    }
    if (!found) return false;
    const sets = SETS[id]; let set = sets[0];
    for (let i = 0; i < sets.length; i++) if (sets[i].art === K.coat) set = sets[i];
    compSpec.id = id; compSpec.sp = SPEC[id]; compSpec.set = set; compSpec.x = fx; compSpec.z = fz; compSpec.y = 0;
    compSpec.seed = ((Math.floor(clock * 977) ^ HA) >>> 0) || 1;
    let sl = spawn(compSpec);
    if (!sl) {
      // pool full: the animal farthest from him makes room
      let far = null; let fd = 4;
      for (let i = 0; i < N; i++) { const o = slots[i]; if (!o.live || o.comp || o.st === ST_FOLLOW) continue; const dx = o.x - p.x; const dz = o.z - p.z; if (dx * dx + dz * dz > fd) { fd = dx * dx + dz * dz; far = o; } }
      if (far === null) return false;
      release(far);
      sl = spawn(compSpec);
      if (!sl) return false;
    }
    adopt(sl, beside);
    return true;
  }
  function companionTick(dt, p, tsp, mdx, mdz) {
    const K = C.companion;
    if (!K || K.enabled === false) { if (comp !== null) dismiss(comp, 0, false, 'off'); return; }
    if (comp !== null) { if (comp.live && comp.comp) return; comp = null; }
    compWait -= dt;
    if (compWait > 0) return;
    compWait = 0.4; // look again a few times a second
    if (!settledAt(p.x, p.z)) return;
    const id = K.species || 'cat';
    let best = null; let bd = K.notice * K.notice;
    for (let i = 0; i < N; i++) {
      const sl = slots[i];
      if (!sl.live || sl.s < 0.9 || sl.spec.id !== id || sl.spec.lead !== null) continue;
      // a cat up on a rail / bench / woodpile may adopt him too (it hops down to him); not from the tower top or the water
      const up = sl.mode === MODE_PERCH && sl.spec.vig === VIG.on;
      if (sl.mode !== MODE_GROUND && !up) continue;
      if (sl.st !== ST_IDLE && sl.st !== ST_WALK && sl.st !== ST_FOLLOW && sl.st !== ST_RETURN && !(up && sl.st === ST_PERCH)) continue;
      if (sl.st === ST_IDLE && sl.idle === sl.set.sleep) continue; // let sleeping cats lie
      const dx = sl.x - p.x; const dz = sl.z - p.z; const d2 = (dx * dx + dz * dz) * (up ? 2 : 1); // a percher notices him closer
      if (d2 < bd) { bd = d2; best = sl; }
    }
    if (best !== null) {
      const up = best.mode === MODE_PERCH;
      adopt(best, false);
      if (up) { best.mode = MODE_GROUND; best.rad = 1; best.ang = 0; best.fx = best.x; best.fz = best.z; best.fy = best.y; } // down from its seat in one paper leap
      return;
    }
    compSearch += 0.4;
    if (compSearch >= (K.spawnAfter || 12) && spawnCompanion(p, mdx, mdz, false)) compSearch = 0;
  }

  function write(sl, pose) {
    const o = sl.i * 16;
    const u = sl.s; const k1 = u - 1;
    const k = (1 + 2.4 * k1 * k1 * k1 + 1.4 * k1 * k1) * C.scale * (sl.sp.size || 1); // pop: overshoot a little, like a card springing up
    const fk = Math.abs(sl.faceK);
    const w = pose.w * k * (fk < 0.1 ? 0.1 : fk); const h = pose.h * k;
    const c = Math.cos(sl.rock); const s = Math.sin(sl.rock);
    const left = sl.faceK < 0;
    const a = left ? 1 - pose.a : pose.a;
    M[o] = w * c; M[o + 1] = w * s; M[o + 4] = -h * s; M[o + 5] = h * c;
    M[o + 12] = sl.x - a * w * c; M[o + 13] = sl.y + sl.lift + C.lift - a * w * s; M[o + 14] = sl.z;
    const q = sl.i * 4;
    if (left) { rectArr[q] = pose.u0 + pose.du; rectArr[q + 2] = -pose.du; } else { rectArr[q] = pose.u0; rectArr[q + 2] = pose.du; }
    rectArr[q + 1] = pose.v0; rectArr[q + 3] = pose.dv;
  }

  // ---- per frame -------------------------------------------------------------------------------------------------
  function update(dt) {
    if (!loaded) return;
    clock += dt;
    const nowNight = !!(daynight && daynight.night);
    if (nowNight !== night) { night = nowNight; dirty = true; }
    const p = traveller.position;
    const tcx = Math.round(p.x / TILE_SIZE); const tcz = Math.round(p.z / TILE_SIZE);
    if (dirty || tcx !== lastCx || tcz !== lastCz) rescan();
    cardN.value.set(C.normal[0], C.normal[1]);
    mat.color.setScalar(C.tint ?? 1);
    const tsp = traveller.speed || 0;
    const md = traveller.moveDir;
    const mdx = md ? md.x : 0; const mdz = md ? md.z : 1;
    const flipK = Math.min(1, dt * C.flipRate);
    if (dt > 0) companionTick(dt, p, tsp, mdx, mdz);
    const KC = C.companion;
    let nLive = 0; let nShown = 0; let nFollow = 0;
    for (let i = 0; i < N; i++) {
      const sl = slots[i];
      if (!sl.live) continue;
      nLive++;
      const sp = sl.sp; const set = sl.set;
      const want = !sl.stale && (sl.st === ST_FOLLOW || riseAt(sl.x, sl.z) >= C.riseAt);
      if (want) sl.s = Math.min(1, sl.s + dt * C.popRate); else sl.s = Math.max(0, sl.s - dt * C.hideRate);
      if (sl.s <= 0) {
        if (sl.stale || sl.spec.key < 0) { release(sl); continue; }
        if (sl.x !== sl.spec.x || sl.z !== sl.spec.z || sl.st !== sl.st0) reset(sl); // its tile folded: back home
        hide(sl);
        continue;
      }
      nShown++;
      const dx = p.x - sl.x; const dz = p.z - sl.z;
      const d2 = dx * dx + dz * dz;
      sl.t += dt;
      if (sl.cool > 0) sl.cool -= dt;
      sl.mv = false;
      if (sl.leave && d2 > 12) sl.stale = true; // the cat he left behind folds away once he is well gone
      let pose = sl.idle;
      let rock = 0; let lift = 0;
      const leader = sl.spec.lead !== null ? byKey.get(sl.spec.lead.key) : undefined;
      if (leader !== undefined && leader.live && leader.s > 0) {
        // walks in a line behind the one in front
        const ex = leader.x - sl.x; const ez = leader.z - sl.z;
        if (ex * ex + ez * ez > sp.gap * sp.gap) advance(sl, leader.x, leader.z, sp.speed * 1.2, dt);
        pose = set.stand;
      } else switch (sl.st) {
        case ST_IDLE: {
          const b = sp.b;
          if (b === 'pet') {
            if (tryFollow(sl, d2, tsp)) break;
            if (sp.wag && d2 < C.wag * C.wag && pose !== set.sleep) { pose = set.stand; rock = Math.sin(clock * 13 + i) * 0.07; if (Math.abs(dx) > 0.15) sl.face = dx > 0 ? 1 : -1; } // up on its feet, wagging
          } else if (b === 'graze') {
            if (sl.mode === MODE_BANK && set.float !== null && sl.cool <= 0 && d2 < C.slide * C.slide && startSlide(sl, dx, dz)) break;
            if (sp.shuffle > 0 && sl.cool <= 0 && d2 < C.shuffle * C.shuffle && startFlee(sl, dx, dz, sp.shuffle, false)) { sl.st = ST_WALK; sl.v = sp.speed * 2.4; sl.air = false; sl.cool = 3; break; } // a few steps aside
            if (d2 < C.headsUp * C.headsUp) { pose = set.stand; if (Math.abs(dx) > 0.2) sl.face = dx > 0 ? 1 : -1; }
          } else if (b === 'peck') {
            if (d2 < C.scatter * C.scatter && startFlee(sl, dx, dz, sp.flee, !!sp.fly)) break;
          } else if (b === 'shy') {
            const ar = sp.alert * (sl.cool > 0 ? 0.55 : 1);
            if (d2 < ar * ar) { sl.st = ST_FREEZE; sl.t = 0; sl.dur = 0.35 + rnd(sl) * 0.4; sl.idle = pose = set.stand; if (Math.abs(dx) > 0.1) sl.face = dx > 0 ? 1 : -1; break; }
          }
          if (sl.t >= sl.dur) think(sl);
          break;
        }
        case ST_WALK: case ST_RETURN: case ST_FLEE: {
          if (sl.st === ST_WALK) {
            const b = sp.b;
            if (b === 'pet') { if (tryFollow(sl, d2, tsp)) break; }
            else if (b === 'peck') { if (d2 < C.scatter * C.scatter && startFlee(sl, dx, dz, sp.flee, !!sp.fly)) break; }
            else if (b === 'shy' && sl.cool <= 0 && d2 < sp.alert * sp.alert) { sl.st = ST_FREEZE; sl.t = 0; sl.dur = 0.3 + rnd(sl) * 0.3; sl.idle = set.stand; break; }
          }
          let gx = sl.tx; let gz = sl.tz;
          if (sl.st === ST_FLEE && sp.zig > 0) {
            // bolts in zig-zags: the aim swings from side to side until the last stretch
            const ex = sl.tx - sl.x; const ez = sl.tz - sl.z; const el = Math.hypot(ex, ez);
            if (el > 0.3) { const w = (Math.sin(sl.t * 13 + i) > 0 ? 1 : -1) * sp.zig * el; gx += (-ez / el) * w; gz += (ex / el) * w; }
          }
          let r = advance(sl, gx, gz, sl.v, dt);
          if (r === 2 && (gx !== sl.tx || gz !== sl.tz)) r = advance(sl, sl.tx, sl.tz, sl.v, dt);
          if (r === 2) sl.stuck += dt; else sl.stuck = 0;
          if (r === 1 || sl.stuck > 0.5 || sl.t > 14) settleDown(sl, dx);
          break;
        }
        case ST_FREEZE: {
          if (sl.t >= sl.dur) {
            const ar = sp.alert * 1.25;
            if (sp.flee > 0 && d2 < ar * ar) { if (!startFlee(sl, dx, dz, sp.flee, false)) sl.dur = sl.t + 1.2; } // cornered: stays frozen
            else if (d2 >= ar * ar || !(sp.flee > 0)) { if (d2 >= sp.alert * sp.alert) { sl.st = ST_IDLE; sl.t = 0; sl.dur = 1.5 + rnd(sl) * 2; sl.cool = 2; } }
          }
          break;
        }
        case ST_FOLLOW: {
          sl.ft += dt;
          const hx = sl.x - sl.hx; const hz = sl.z - sl.hz;
          if (sl.comp) {
            if (d2 > KC.lost * KC.lost || sl.stuck > 2.5) { dismiss(sl, KC.away, false, sl.stuck > 2.5 ? 'stuck' : 'lost'); break; } // lost him: back after a short while
            sl.bio -= dt;
            if (sl.bio <= 0) { sl.bio = 1; if (settledAt(p.x, p.z)) sl.unset = 0; else if (++sl.unset >= KC.wild) { dismiss(sl, KC.away, true, 'wild'); break; } }
          } else if (sl.ft > sl.fmax || hx * hx + hz * hz > C.followFar * C.followFar || d2 > C.followLost * C.followLost || sl.stuck > 1.2) { endFollow(sl); break; }
          nFollow++;
          if (sl.wake > 0) {
            // noticing him (tail up), or stretching after a nap, then one hop and off
            sl.wake -= dt;
            pose = sl.nap > KC.nap ? (set.stretch || set.sit) : (set.alert || set.sit);
            if (Math.abs(dx) > 0.08) sl.face = dx > 0 ? 1 : -1;
            if (sl.wake < 0.18) lift = Math.sin(Math.max(0, sl.wake) / 0.18 * PI) * 0.05;
            if (sl.wake <= 0) sl.nap = 0;
            break;
          }
          if (sl.comp && tsp > 0.25 && sl.nap > 0) { if (sl.nap > KC.nap) { sl.wake = 0.55; break; } sl.nap = 0; }
          if (sl.rad > 0) {
            // boxed in behind a post or a wall: one paper leap over it, to the spot just behind him
            sl.ang += dt / 0.42;
            const u = Math.min(1, sl.ang);
            const lx = p.x - mdx * 0.2; const lz = p.z - mdz * 0.2;
            sl.x = sl.fx + (lx - sl.fx) * u; sl.z = sl.fz + (lz - sl.fz) * u;
            if (sl.fy > 0.02) sl.y = sl.fy + ((world.heightAt(sl.x, sl.z) || 0) - sl.fy) * u * u; // down from a seat
            if (Math.abs(lx - sl.fx) > 0.1) sl.face = lx > sl.fx ? 1 : -1;
            lift = Math.sin(u * PI) * 0.2; rock = (0.5 - u) * 0.5 * sl.face;
            pose = set.walk[0];
            if (u >= 1) { sl.rad = 0; sl.stuck = 0; sl.fy = 0; sl.y = world.heightAt(sl.x, sl.z) || 0; }
            break;
          }
          let tx; let tz;
          if (tsp > 0.25) {
            // beside him, a little ahead of his feet so the trot ends level with him
            // (on the camera's side of him when he walks east or west: behind him the cat would be hidden)
            const sd = Math.abs(mdx) > 0.35 ? (mdx > 0 ? 1 : -1) : sl.side;
            tx = p.x - mdz * sd * C.followSide + mdx * 0.22; tz = p.z + mdx * sd * C.followSide + mdz * 0.22;
          } else {
            if (d2 < 0.45 * 0.45) { // he stopped: sit by him; the companion naps when he stands for long
              if (sl.comp) sl.nap += dt;
              pose = sl.idle = sl.comp && sl.nap > KC.nap && set.sleep !== null ? set.sleep : set.sit;
              if (pose === set.sit && Math.abs(dx) > 0.08) sl.face = dx > 0 ? 1 : -1;
              break;
            }
            const d = Math.sqrt(d2);
            tx = p.x - (dx / d) * 0.32; tz = p.z - (dz / d) * 0.32;
          }
          const ex = tx - sl.x; const ez = tz - sl.z;
          const el = Math.sqrt(ex * ex + ez * ez);
          sl.v = Math.max(0.4, Math.min(sl.comp && el > 0.8 ? sp.run * 1.3 : sp.run, el * 7)); // the companion sprints to catch up
          let r = el > 0.04 ? advance(sl, tx, tz, sl.v, dt) : 1;
          if (r === 2) {
            // no room beside him: fall in behind (where he just walked) and try his other side next
            sl.side = -sl.side;
            r = advance(sl, p.x - mdx * 0.2, p.z - mdz * 0.2, Math.max(sl.v, sp.run * 0.8), dt);
          }
          if (r === 2) sl.stuck += dt; else sl.stuck = 0;
          // the companion also leaps when it has fallen behind for a second (he crossed a bridge, rounded a yard ...)
          if (sl.comp) sl.dur = d2 > KC.behind * KC.behind ? sl.dur + dt : 0;
          if ((sl.stuck > 0.3 || (sl.comp && sl.dur > 0.45)) && world.clearance(p.x - mdx * 0.2, p.z - mdz * 0.2) > 0.012) { sl.rad = 1; sl.ang = 0; sl.fx = sl.x; sl.fz = sl.z; sl.dur = 0; }
          pose = set.walk[0];
          break;
        }
        case ST_FLY: {
          const u = Math.min(1, sl.t / sl.dur);
          const e = u * u * (3 - 2 * u);
          const nx = sl.fx + (sl.tx - sl.fx) * e;
          if (Math.abs(sl.tx - sl.fx) > 0.1) sl.face = sl.tx > sl.fx ? 1 : -1;
          sl.x = nx; sl.z = sl.fz + (sl.tz - sl.fz) * e;
          lift = Math.sin(u * PI) * (0.35 + 0.25 * sl.dur * 0.4);
          rock = Math.sin(clock * 38 + i) * 0.3 * Math.sin(u * PI) + 0.25 * Math.sin(u * PI) * (1 - 2 * u);
          pose = set.walk[0];
          if (u >= 1) { sl.y = world.heightAt(sl.x, sl.z) || 0; settleDown(sl, dx); }
          break;
        }
        case ST_FLOAT: {
          const w = (sp.drift || 0.07) / Math.max(0.08, sl.rad);
          const na = sl.ang + sl.dir * w * dt;
          const nx = sl.fx + Math.cos(na) * sl.rad; const nz = sl.fz + Math.sin(na) * sl.rad;
          const vx = -Math.sin(na) * sl.dir; const vz = Math.cos(na) * sl.dir;
          if (okWater(nx, nz) && isWater(nx + vx * 0.13, nz + vz * 0.13)) {
            sl.ang = na; sl.x = nx; sl.z = nz;
            if (Math.abs(vx) > 0.45) sl.face = vx > 0 ? 1 : -1;
          } else if (sl.t > 0.5) { sl.dir = -sl.dir; sl.t = 0; }
          rock = Math.sin(clock * 0.9 + i * 1.7) * 0.035;
          lift = Math.sin(clock * 1.4 + i) * 0.003 - C.lift;
          pose = set.float || set.stand;
          break;
        }
        case ST_SLIDE: {
          const u = Math.min(1, sl.t / sl.dur);
          const e = u * u * (3 - 2 * u);
          sl.x = sl.fx + (sl.tx - sl.fx) * e; sl.z = sl.fz + (sl.tz - sl.fz) * e;
          if (Math.abs(sl.tx - sl.fx) > 0.08) sl.face = sl.tx > sl.fx ? 1 : -1;
          const wet = isWater(sl.x, sl.z);
          pose = wet ? set.float : set.walk[Math.floor(sl.t * 9) & 1];
          rock = Math.sin(sl.t * 15) * 0.09 * (1 - u);
          lift = wet ? -C.lift : Math.abs(Math.sin(sl.t * 9 * PI)) * sp.hop;
          if (wet) sl.y = 0;
          if (u >= 1) {
            // afloat from now on (until its tile folds: reset() puts it back on the bank)
            sl.mode = MODE_FLOAT; sl.st = ST_FLOAT; sl.t = 0; sl.y = 0; sl.idle = set.float;
            const arc = sp.arc || [0.1, 0.25];
            sl.rad = arc[0] + rnd(sl) * (arc[1] - arc[0]); sl.ang = rnd(sl) * PI * 2; sl.dir = rnd(sl) < 0.5 ? -1 : 1;
            sl.fx = sl.x - Math.cos(sl.ang) * sl.rad; sl.fz = sl.z - Math.sin(sl.ang) * sl.rad;
          }
          break;
        }
        default: // perch
          rock = Math.sin(clock * 0.7 + i) * (sp.rock || 0);
          if (sp.b === 'pet') {
            // a cat on a rail watches him go by
            if (d2 < 4 && Math.abs(dx) > 0.2) sl.face = dx > 0 ? 1 : -1;
            if (sl.t >= sl.dur) { sl.t = 0; sl.dur = 4 + rnd(sl) * 7; sl.idle = set.alert !== null && d2 < 2.2 && rnd(sl) < 0.5 ? set.alert : set.sit; }
          }
      }
      if (sl.mv) {
        const ph = sl.ph;
        if (sl.air) {
          const f = ph - Math.floor(ph);
          if (f < 0.76) { pose = set.air || set.walk[0]; lift = Math.sin((f / 0.76) * PI) * sp.hop; rock = (0.38 - f) * 0.25; } else pose = set.walk[0];
        } else {
          pose = set.walk[Math.floor(ph) & 1];
          const fast = sl.v > sp.speed * 1.8 ? 1.8 : 1;
          lift = Math.abs(Math.sin(ph * PI)) * sp.hop * fast;
          rock = Math.sin(ph * PI) * sp.rock;
        }
      } else if (sl.st === ST_IDLE && pose !== set.sleep) rock += Math.sin(clock * 1.1 + i * 2.3) * 0.012; // a breath of life
      sl.rock = rock; sl.lift = lift;
      sl.faceK += (sl.face - sl.faceK) * flipK;
      write(sl, pose);
    }
    live = nLive; shown = nShown; followers = nFollow;
    mesh.instanceMatrix.needsUpdate = true;
    rectAttr.needsUpdate = true;
  }

  const api = {
    /** Resolves (true / false) when the sprite sheet is in. Never rejects. */
    ready,
    mesh,
    update,
    /** Deterministic stills: every animal of the cells in range stands at its own spot, shown where its tile stands. */
    settle() {
      if (!loaded) return;
      for (let i = 0; i < N; i++) if (slots[i].live) release(slots[i]);
      followers = 0;
      night = !!(daynight && daynight.night);
      rescan();
      comp = null; compWait = (C.companion && C.companion.after) || 5; compSearch = 0;
      const K = C.companion; const p = traveller.position;
      if (K && K.enabled !== false && K.stills !== false && settledAt(p.x, p.z)) spawnCompanion(p, 0, 1, true);
      for (let i = 0; i < N; i++) { const sl = slots[i]; if (sl.live) sl.s = sl.st === ST_FOLLOW || riseAt(sl.x, sl.z) >= C.riseAt ? 1 : 0; }
      update(0);
    },
    dispose() {
      disposed = true;
      scene.remove(mesh);
      geo.dispose(); mat.dispose(); depthMat.dispose();
      if (tex) tex.dispose();
      mesh.dispose();
    },
    /** Slots in use / drawn right now / walking with the traveller / ever spawned. */
    stats() { return { loaded, pool: N, live, shown, followers, spawned, cells: cache.size, art: artNames.length, companion: comp !== null, companionAt: compSeen, companionLeft: compLeft }; },
    /** Debug: every live animal: { id, art, x, y, z, state, pose, shown, mode, home }. Allocates. */
    list() {
      const out = [];
      for (let i = 0; i < N; i++) {
        const sl = slots[i];
        if (!sl.live) continue;
        out.push({ slot: i, id: sl.spec.id, art: sl.set.art, x: sl.x, y: sl.y + sl.lift, z: sl.z, state: ST_NAMES[sl.st], pose: sl.mv ? 'moving' : sl.idle ? sl.idle.name : '', shown: sl.s > 0.5, s: sl.s, mode: sl.mode, face: sl.face, hx: sl.hx, hz: sl.hz, cool: sl.cool, chain: sl.spec.lead !== null, comp: sl.comp, vig: VIG_NAMES[sl.spec.vig | 0], nap: sl.nap });
      }
      return out;
    },
    /** Debug: what the rule puts on the cells of a square window: [{ id, x, z, when, mode, cx, cz, model }]. */
    debugCells(cx, cz, r = 4) {
      const out = [];
      if (!loaded) return out;
      for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) {
        const cell = world.tileAt(x, z);
        for (const sc of specsFor(x, z)) out.push({ id: sc.id, x: sc.x, y: sc.y, z: sc.z, when: sc.when, mode: sc.mode, vig: VIG_NAMES[sc.vig | 0], cx: x, cz: z, model: cell.model, biome: cell.biome });
      }
      return out;
    },
    debugPerches(model) { return perchesFor(model).slice(); },
    /** Debug: the pieces a vignette can anchor to: [{ name, x, z, hx, hz, top }] in tile space (rot 0; parity = rot & 1). */
    debugPieces(model, parity = 0) { return piecesFor(model, parity).map((q) => ({ ...q })); },
    /** Debug: force the rule cache to be rebuilt (after editing CONFIG.animals.spawns / density live). */
    refresh() { cache.clear(); pieceCache.clear(); for (let i = 0; i < N; i++) if (slots[i].live) release(slots[i]); comp = null; compSeen = -1; compSearch = 0; compWait = (C.companion && C.companion.after) || 5; dirty = true; },
  };
  return api;
}
