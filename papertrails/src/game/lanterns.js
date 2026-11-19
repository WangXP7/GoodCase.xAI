// Lanterns (gameplay pass; owner: lanterns agent). Every lamp of the world - the lantern_post tile, the lamp nodes of
// snow_hamlet / church / manor / market_square, the blossom stone lanterns, the desert camp fire - starts UNLIT: dark
// paper pane, no night pool. When the traveller (who carries a lantern) walks close, the lamp catches and stays lit
// for good (progress.light, key "cx,cz,<lampIndex>").
//
// How it is drawn (no draw call per lamp):
//   - panes: the tile glow batch gets a per-instance colour whose RED channel is the lamp level (1 = three's default,
//     so house windows are untouched). A chained shader hook on the glow material scales the emissive by it, darkens
//     the pane's paper and adds a faint cold glint at night while the level is 0.
//   - pools: life.js owns the six-nearest pool uniforms; it asks lampGate(cx, cz, lampIndex) -> 0..1 for every lamp.
//   - sparks: one small InstancedMesh, only visible while a lamp is catching (the single extra draw call).
import * as THREE from 'three';
import { CONFIG, TILE_SIZE } from '../core/config.js';
import { bus } from '../core/events.js';
import { state } from '../core/state.js';
import * as GAME_CONFIG from '../core/config/game.js';

const DEFAULTS = {
  catchRadius: 0.9, riseDelay: 0.45, ramp: 0.6, overshoot: 0.35, flicker: 0.16,
  dark: '#34333d', glint: '#6f9cff', glintStrength: 0.42,
  sparks: 7, sparkLife: 1.05, sparkRise: 0.55, sparkSize: 0.045, sparkColor: '#ffc45a', sparkGain: 2.2,
};
const LAMP_RE = /(^|_)(lamp|stone_lantern)(_[a-z]|_xf)?$/; // same rule as life.js (pool anchors)
const LAMP_ANY_RE = /(^|_)(lamp|stone_lantern)(_|$)/; // any piece of a lamp (front / back cross planes too)
const HALF_PI = Math.PI / 2;
const NMAX = 48; // lamps registered at once (risen tiles only)
const PANES = 6; // glow instances per lamp, at most
const NS = 28; // spark pieces

export function createLanterns(ctx) {
  const { scene, world, wfc, traveller, progress, assets, life, daynight } = ctx;
  const C = { ...DEFAULTS, ...((GAME_CONFIG.game && GAME_CONFIG.game.lanterns) || {}) };

  // ---- registry of the lamps on risen tiles ------------------------------------------------------
  const on = new Uint8Array(NMAX); const lit = new Uint8Array(NMAX);
  const lCx = new Int32Array(NMAX); const lCz = new Int32Array(NMAX); const lK = new Uint8Array(NMAX);
  const lX = new Float32Array(NMAX); const lY = new Float32Array(NMAX); const lZ = new Float32Array(NMAX);
  const lT = new Float32Array(NMAX).fill(-1); // seconds since it caught (-1 = steady)
  const lLevel = new Float32Array(NMAX); const lSince = new Float64Array(NMAX);
  const lKey = new Array(NMAX).fill('');
  const pN = new Uint8Array(NMAX); const pMesh = new Array(NMAX * PANES).fill(null); const pId = new Int32Array(NMAX * PANES);
  let anyAnim = false;
  const _col = new THREE.Color();

  // ---- which glow panes belong to which lamp (per model, from the prototype) ---------------------------
  const modelCache = new Map();
  function ownOffsets(model) { // fallback when the life module is off (?life=0): same rule as life.lampOffsets
    const list = [];
    const proto = assets.getTilePrototype(model);
    proto.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(proto.matrixWorld).invert();
    const box = new THREE.Box3(); const c = new THREE.Vector3();
    proto.traverse((n) => {
      if (!n.name || !LAMP_RE.test(n.name)) return;
      box.setFromObject(n);
      if (box.isEmpty()) return;
      box.applyMatrix4(inv); box.getCenter(c);
      for (const q of list) if (Math.abs(q[0] - c.x) + Math.abs(q[2] - c.z) < 0.15) return;
      list.push([c.x, Math.max(0.22, box.max.y * 0.72), c.z]);
    });
    const extra = (CONFIG.lights.pools && CONFIG.lights.pools.offsets && CONFIG.lights.pools.offsets[model]) || null;
    if (extra) for (const q of extra) list.push(q);
    return list;
  }
  function modelInfo(model) {
    let info = modelCache.get(model);
    if (info) return info;
    info = { offs: [], panes: [] }; // panes: [geometry uuid, lamp index] of every glow mesh, in traversal order
    try {
      info.offs = (life && life.lampOffsets ? life.lampOffsets(model) : ownOffsets(model)) || [];
      if (info.offs.length) {
        const proto = assets.getTilePrototype(model);
        proto.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(proto.matrixWorld).invert();
        const box = new THREE.Box3(); const c = new THREE.Vector3();
        const nearest = (maxD) => {
          let best = -1; let bd = maxD;
          for (let i = 0; i < info.offs.length; i++) {
            const d = Math.abs(info.offs[i][0] - c.x) + Math.abs(info.offs[i][2] - c.z);
            if (d < bd) { bd = d; best = i; }
          }
          return best;
        };
        proto.traverse((n) => {
          if (!n.isMesh || !n.userData.glow || !n.geometry) return;
          let k = -1;
          for (let a = n; a && k < 0; a = a.parent) {
            if (!a.name || !LAMP_ANY_RE.test(a.name)) continue;
            box.setFromObject(a);
            if (box.isEmpty()) continue;
            box.applyMatrix4(inv); box.getCenter(c);
            k = nearest(0.3);
          }
          if (k < 0) { // glow with no lamp node above it (camp fire embers): only right at an anchor
            box.setFromObject(n);
            if (!box.isEmpty()) { box.applyMatrix4(inv); box.getCenter(c); k = nearest(0.16); }
          }
          info.panes.push([n.geometry.uuid, k]);
        });
      }
    } catch (err) { console.warn('[lanterns] model scan failed', model, err); }
    modelCache.set(model, info);
    return info;
  }
  const recCache = new WeakMap(); // tile record -> Int8Array lamp index per batch instance (-1 = not a lamp pane)
  function recPanes(rec, info) {
    let map = recCache.get(rec);
    if (map) return map;
    map = new Int8Array(rec.meshes.length).fill(-1);
    let p = 0;
    for (let i = 0; i < rec.meshes.length; i++) {
      const m = rec.meshes[i];
      if (!m.userData.glow) continue;
      let q = p;
      while (q < info.panes.length && info.panes[q][0] !== m.geometry.uuid) q++;
      if (q >= info.panes.length) continue;
      map[i] = info.panes[q][1];
      p = q + 1;
    }
    recCache.set(rec, map);
    return map;
  }

  // ---- glow material: per-instance lamp level ----------------------------------------------------------
  const lampUniforms = { uLampCold: { value: new THREE.Color(0, 0, 0) }, uLampDark: { value: new THREE.Color(C.dark) } };
  const cGlint = new THREE.Color(C.glint);
  const hooked = new Set();
  function hookGlow(mesh) {
    if (!mesh._colorsTexture && mesh._initColorsTexture) mesh._initColorsTexture(); // all white = level 1
    const m = mesh.material;
    if (hooked.has(m)) return;
    hooked.add(m);
    const prev = m.onBeforeCompile; const prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (shader, renderer) => {
      if (prev) prev.call(m, shader, renderer);
      const stock = 'vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );';
      let vs = shader.vertexShader;
      if (!vs.includes(stock)) vs = vs.replace('#include <color_vertex>', THREE.ShaderChunk.color_vertex);
      if (!vs.includes(stock) || !shader.fragmentShader.includes('#include <emissivemap_fragment>')) { console.warn('[lanterns] glow hook not applied (unexpected shader)'); return; }
      Object.assign(shader.uniforms, lampUniforms);
      shader.vertexShader = vs.replace(stock, 'vLampK = getBatchingColor( getIndirectIndex( gl_DrawID ) ).r;')
        .replace('void main() {', 'void main() {\n\tvLampK = 1.0;')
        .replace('#include <common>', '#include <common>\nvarying float vLampK;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vLampK;\nuniform vec3 uLampCold;\nuniform vec3 uLampDark;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ // lanterns: an unlit lamp pane is dark paper with a faint cold glint at night
  float lampK = clamp( vLampK, 0.0, 1.0 );
  totalEmissiveRadiance = totalEmissiveRadiance * vLampK + uLampCold * ( 1.0 - lampK );
  diffuseColor.rgb *= mix( uLampDark, vec3( 1.0 ), lampK );
}`);
    };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|lamp-level-v1';
    m.needsUpdate = true;
  }
  // the glow batches exist from the start: hook them now so the first lamp does not cause a shader compile mid-walk
  if (world.group) world.group.traverse((o) => {
    const e = o.isBatchedMesh && o.material && o.material.emissive;
    if (e && e.r + e.g + e.b > 0 && o.material.emissiveIntensity > 0) hookGlow(o);
  });

  function paint(e) {
    const n = pN[e];
    if (!n) return;
    _col.setRGB(lLevel[e], 1, 1);
    for (let j = 0; j < n; j++) pMesh[e * PANES + j].setColorAt(pId[e * PANES + j], _col);
  }

  // ---- tiles rising / folding away ------------------------------------------------------------------------
  function drop(cx, cz) {
    for (let e = 0; e < NMAX; e++) {
      if (!on[e] || lCx[e] !== cx || lCz[e] !== cz) continue;
      on[e] = 0; lT[e] = -1;
      for (let j = 0; j < pN[e]; j++) pMesh[e * PANES + j] = null;
      pN[e] = 0;
    }
  }
  function onRise(ev) {
    const rec = world.tileRecord ? world.tileRecord(ev.x, ev.z) : null;
    const cell = rec ? rec.cell : wfc.get(ev.x, ev.z);
    if (!cell) return;
    const info = modelInfo(cell.model);
    if (!info.offs.length) return;
    drop(ev.x, ev.z);
    const panes = rec ? recPanes(rec, info) : null;
    const ry = -(cell.rot || 0) * HALF_PI; const c = Math.cos(ry); const s = Math.sin(ry);
    for (let k = 0; k < info.offs.length; k++) {
      let e = 0;
      while (e < NMAX && on[e]) e++;
      if (e >= NMAX) return;
      const u = info.offs[k][0]; const v = info.offs[k][2];
      on[e] = 1; lCx[e] = ev.x; lCz[e] = ev.z; lK[e] = k; lSince[e] = state.time; lT[e] = -1;
      lX[e] = ev.x * TILE_SIZE + u * c + v * s; lY[e] = info.offs[k][1]; lZ[e] = ev.z * TILE_SIZE - u * s + v * c;
      lKey[e] = ev.x + ',' + ev.z + ',' + k;
      lit[e] = progress.lit(lKey[e]) ? 1 : 0;
      lLevel[e] = lit[e];
      pN[e] = 0;
      if (panes) for (let i = 0; i < panes.length && pN[e] < PANES; i++) {
        if (panes[i] !== k) continue;
        const inst = rec.inst[i];
        hookGlow(inst.b.mesh);
        pMesh[e * PANES + pN[e]] = inst.b.mesh; pId[e * PANES + pN[e]] = inst.id; pN[e]++;
      }
      paint(e);
    }
  }
  const offRise = bus.on('tile:rise', onRise);
  const offFlat = bus.on('tile:flat', (ev) => drop(ev.x, ev.z));
  const offGone = bus.on('tile:despawn', (ev) => drop(ev.x, ev.z));
  const offReset = bus.on('game:reset', () => {
    for (let e = 0; e < NMAX; e++) if (on[e]) { lit[e] = progress.lit(lKey[e]) ? 1 : 0; lLevel[e] = lit[e]; lT[e] = -1; paint(e); }
  });

  /** Night pools (life.js): strength of one lamp, 0 = no pool. */
  function gate(cx, cz, k) {
    for (let e = 0; e < NMAX; e++) if (on[e] && lK[e] === k && lCx[e] === cx && lCz[e] === cz) return lit[e] ? Math.min(1.3, lLevel[e]) : 0;
    return 0;
  }
  if (life && life.setLampGate) life.setLampGate(gate);

  // ---- sparks: a few warm paper bits rise from a lamp that catches (one instanced draw, hidden otherwise) ----
  const sparkGeo = new THREE.PlaneGeometry(1, 1);
  const cSpark = new THREE.Color(C.sparkColor);
  const sparkMat = new THREE.MeshBasicMaterial({ color: cSpark.clone().multiplyScalar(C.sparkGain), side: THREE.DoubleSide, fog: false });
  const sparks = new THREE.InstancedMesh(sparkGeo, sparkMat, NS);
  sparks.name = 'game:lantern-sparks';
  sparks.frustumCulled = false; sparks.castShadow = false; sparks.receiveShadow = false; sparks.visible = false;
  sparks.count = 0;
  scene.add(sparks);
  const sT = new Float32Array(NS).fill(-1); const sX = new Float32Array(NS); const sY = new Float32Array(NS); const sZ = new Float32Array(NS);
  const sVx = new Float32Array(NS); const sVy = new Float32Array(NS); const sVz = new Float32Array(NS); const sPh = new Float32Array(NS); const sLife = new Float32Array(NS);
  let sparkLive = 0; let sparkSeed = 1;
  const rnd = () => { sparkSeed = (Math.imul(sparkSeed, 1664525) + 1013904223) >>> 0; return sparkSeed / 4294967296; };
  const _m = new THREE.Matrix4(); const _p = new THREE.Vector3(); const _q = new THREE.Quaternion(); const _qz = new THREE.Quaternion(); const _s = new THREE.Vector3();
  const _zAxis = new THREE.Vector3(0, 0, 1);
  function burst(x, y, z) {
    let left = C.sparks;
    for (let i = 0; i < NS && left > 0; i++) {
      if (sT[i] >= 0) continue;
      const a = rnd() * Math.PI * 2; const r = 0.04 + rnd() * 0.07;
      sT[i] = 0; sLife[i] = C.sparkLife * (0.7 + 0.5 * rnd());
      sX[i] = x + Math.cos(a) * r; sY[i] = y + (rnd() - 0.3) * 0.08; sZ[i] = z + Math.sin(a) * r;
      sVx[i] = Math.cos(a) * 0.16 * rnd(); sVz[i] = Math.sin(a) * 0.16 * rnd(); sVy[i] = C.sparkRise * (0.6 + 0.8 * rnd());
      sPh[i] = rnd() * 6.283;
      left--; sparkLive++;
    }
  }
  function updateSparks(dt) {
    if (!sparkLive) { if (sparks.visible) { sparks.visible = false; sparks.count = 0; } return; }
    const cam = ctx.follow && ctx.follow.camera;
    let n = 0;
    for (let i = 0; i < NS; i++) {
      if (sT[i] < 0) continue;
      sT[i] += dt;
      const u = sT[i] / sLife[i];
      if (u >= 1) { sT[i] = -1; sparkLive--; continue; }
      sVy[i] *= 1 - 0.9 * dt; sVx[i] *= 1 - 1.5 * dt; sVz[i] *= 1 - 1.5 * dt;
      const w = Math.sin(sPh[i] + sT[i] * 7);
      sX[i] += (sVx[i] + w * 0.05) * dt; sY[i] += sVy[i] * dt; sZ[i] += (sVz[i] + Math.cos(sPh[i] * 1.7 + sT[i] * 6) * 0.05) * dt;
      const k = Math.min(1, u * 8) * (1 - u * u) * C.sparkSize;
      _p.set(sX[i], sY[i], sZ[i]);
      _qz.setFromAxisAngle(_zAxis, sPh[i] + sT[i] * 3.2);
      if (cam) _q.copy(cam.quaternion).multiply(_qz); else _q.copy(_qz);
      _s.set(k, k * (0.55 + 0.45 * Math.abs(w)), k); // flutter: the bit turns edge-on now and then
      _m.compose(_p, _q, _s);
      sparks.setMatrixAt(n++, _m);
    }
    sparks.count = n; sparks.visible = n > 0;
    sparks.instanceMatrix.needsUpdate = true;
  }

  // ---- catching -------------------------------------------------------------------------------------------
  function level(t) {
    const T = C.ramp;
    if (t < T) { const u = t / T; return u * u * (3 - 2 * u) + C.overshoot * Math.sin(Math.PI * u) * u; }
    const a = t - T;
    return 1 + C.flicker * Math.exp(-3.5 * a) * Math.sin(26 * a);
  }
  function catchLamp(e) {
    if (lit[e]) return false;
    lit[e] = 1; lT[e] = 0; anyAnim = true;
    burst(lX[e], lY[e] + 0.05, lZ[e]);
    progress.light(lKey[e], lX[e], lZ[e]);
    if (ctx.music && ctx.music.chime) ctx.music.chime('lantern');
    return true;
  }

  let nightK = daynight && daynight.night ? 1 : 0;

  return {
    update(dt) {
      const tgt = daynight && daynight.night ? 1 : 0;
      if (dt <= 0) nightK = tgt;
      else if (nightK !== tgt) nightK = tgt > nightK ? Math.min(1, nightK + dt / 1.6) : Math.max(0, nightK - dt / 1.6);
      const g = nightK * nightK * (3 - 2 * nightK) * C.glintStrength * (0.82 + 0.18 * Math.sin(state.time * 1.7));
      lampUniforms.uLampCold.value.setRGB(cGlint.r * g, cGlint.g * g, cGlint.b * g);
      const sg = C.sparkGain * (0.55 + 0.45 * nightK); // by day the bits are warm paper, at night they glow
      sparkMat.color.setRGB(cSpark.r * sg, cSpark.g * sg, cSpark.b * sg);

      const p = traveller.position; const r2 = C.catchRadius * C.catchRadius; const now = state.time;
      let anim = false;
      for (let e = 0; e < NMAX; e++) {
        if (!on[e]) continue;
        if (!lit[e]) {
          const dx = lX[e] - p.x; const dz = lZ[e] - p.z;
          if (dt > 0 && dx * dx + dz * dz < r2 && now - lSince[e] >= C.riseDelay && ctx.game.armed !== false) catchLamp(e); // armed: not before his first steps (index.js)
        }
        if (lT[e] >= 0) {
          lT[e] += dt;
          if (lT[e] > C.ramp + 1.4) { lT[e] = -1; lLevel[e] = 1; } else { lLevel[e] = level(lT[e]); anim = true; }
          paint(e);
        }
      }
      anyAnim = anim;
      updateSparks(dt);
    },
    /** Finish every running catch animation (captures). */
    settle() {
      for (let e = 0; e < NMAX; e++) if (on[e] && lT[e] >= 0) { lT[e] = -1; lLevel[e] = 1; paint(e); }
      for (let i = 0; i < NS; i++) sT[i] = -1;
      sparkLive = 0; sparks.visible = false; sparks.count = 0; anyAnim = false;
    },
    /** Lamps on the risen tiles around the traveller: [{key, x, z, lit}]. */
    lamps() {
      const a = [];
      for (let e = 0; e < NMAX; e++) if (on[e]) a.push({ key: lKey[e], x: +lX[e].toFixed(2), y: +lY[e].toFixed(2), z: +lZ[e].toFixed(2), lit: !!lit[e], panes: pN[e] });
      return a;
    },
    get animating() { return anyAnim || sparkLive > 0; },
    /** Debug: light the nearest unlit lamp whatever the distance. @returns its key or null */
    debugLightNearest() {
      const p = traveller.position; let best = -1; let bd = 1e9;
      for (let e = 0; e < NMAX; e++) {
        if (!on[e] || lit[e]) continue;
        const d = (lX[e] - p.x) * (lX[e] - p.x) + (lZ[e] - p.z) * (lZ[e] - p.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (best < 0) return null;
      catchLamp(best);
      return lKey[best];
    },
    dispose() {
      offRise(); offFlat(); offGone(); offReset();
      if (life && life.setLampGate) life.setLampGate(null);
      for (let e = 0; e < NMAX; e++) if (on[e]) { lLevel[e] = 1; paint(e); on[e] = 0; }
      lampUniforms.uLampCold.value.setRGB(0, 0, 0);
      scene.remove(sparks);
      sparkGeo.dispose(); sparkMat.dispose(); sparks.dispose();
    },
  };
}
