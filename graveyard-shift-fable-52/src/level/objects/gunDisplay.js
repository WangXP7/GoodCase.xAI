// The weapons as things standing in the world: each of the first-person weapon models baked down
// to one small mesh (one draw call, vertex colours, one shared material), for the weapon box to
// show what it is turning over and what it offers.
//
// A weapon model is built once with the weapons' own factory, at rest; every part that shows is
// copied into one geometry in the model's own space (muzzle toward -z, up +y, metres), coloured
// by what the part is made of, centred on its middle, and the model and its materials are thrown
// away. `cell` > 0 welds vertices on a grid of that size and drops what collapses: the cheaper
// meshes the `low` and `mobile` tiers use.
//
// Building a model takes tens of milliseconds, so when it happens is owned here and nowhere else:
// tick(dt, playing), called once a frame by one caller (the loot layer), builds at most one model
// a frame while no game is being played (the title screen, menus), and during play builds nothing
// unless a box has said this frame that a roll is under way (`wanted`), then one every WARM_GAP
// seconds. ensure(id) builds one now, for a weapon that has to be shown this frame.
//
// What the display cannot show: the upgraded finish. That is drawn by the first-person view's own
// material patch (a shader flag on the viewmodel), not by the model, so a weapon here always wears
// its stock finish. Not a fault of the bake.
//
// The weapon factories make no textures of their own (their materials sample the shared noise
// textures the material system owns), so throwing a model away is its geometries and materials
// only. The baked meshes keep their arrays on the CPU: after a lost WebGL context three.js uploads
// them again on the next draw, like any other mesh.
import { BufferAttribute, BufferGeometry, Group, Matrix3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { MODELS, hasModel, STAND_IN } from '../../weapon/models/index.js';
import { WEAPON_IDS as GUN_IDS } from '../../weapon/defs.js';

const LITE_CELL = 0.0045; // metres: the grid the cheaper meshes are welded on
const WARM_GAP = 0.2; // seconds between builds while a roll is under way

// what a part is made of -> its colour here (linear). Read from the material the model put on it.
const FINISH = { 0: [0.085, 0.09, 0.1], 1: [0.36, 0.37, 0.39], 3: [0.05, 0.06, 0.095] }; // phosphate, bare, blued
function colourOf(mat, out) {
  const kind = mat && mat.userData && mat.userData.surfDef ? mat.userData.surfDef.kind : '';
  const u = (mat && mat.surf) || {};
  let c = null;
  if (kind === 'gunmetal') {
    const f = u.uGFinish ? u.uGFinish.value : 0;
    if (FINISH[f]) c = FINISH[f];
    else if (u.uGPoly && u.uGPoly.value) { const p = u.uGPoly.value; out[0] = p.r ?? p.x ?? 0.03; out[1] = p.g ?? p.y ?? 0.03; out[2] = p.b ?? p.z ?? 0.03; if (f === 4) { out[0] *= 0.55; out[1] *= 0.4; out[2] *= 0.28; } else { out[0] = Math.max(out[0] * 2.2, 0.055); out[1] = Math.max(out[1] * 2.2, 0.057); out[2] = Math.max(out[2] * 2.2, 0.06); } return out; }
  }
  if (!c) {
    // anything else that carries a colour of its own (brass, a rubber pad, a lit dot)
    for (const k of ['uColor', 'uTint', 'uBase', 'uAlbedo']) if (u[k] && u[k].value && u[k].value.r !== undefined) { const p = u[k].value; out[0] = p.r; out[1] = p.g; out[2] = p.b; return out; }
    if (mat && mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.01) { out[0] = mat.emissive.r; out[1] = mat.emissive.g; out[2] = mat.emissive.b; return out; }
    c = kind === 'rubber' ? [0.02, 0.02, 0.022] : kind === 'chrome' ? [0.5, 0.42, 0.26] : [0.09, 0.09, 0.1];
  }
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}

const _p = new Vector3(), _n = new Vector3(), _nm = new Matrix3(), _c = [0, 0, 0];

// model: what a weapon factory returned. Returns { geometry, length, height, triangles }.
export function bakeModel(model, cell = 0) {
  const root = model.root;
  root.updateMatrixWorld(true);
  const skip = new Set([model.spare, model.casing, ...(model.casings || [])].filter(Boolean));
  const shown = (o) => { for (let q = o; q; q = q.parent) { if (!q.visible || skip.has(q)) return false; if (q === root) break; } return true; };
  const pos = [], nrm = [], col = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !shown(o)) return;
    const g = o.geometry, p = g.getAttribute('position'), nr = g.getAttribute('normal'), ix = g.getIndex();
    if (!p) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    colourOf(mat, _c);
    _nm.getNormalMatrix(o.matrixWorld);
    const n = ix ? ix.count : p.count;
    for (let i = 0; i < n; i++) {
      const v = ix ? ix.getX(i) : i;
      _p.fromBufferAttribute(p, v).applyMatrix4(o.matrixWorld);
      pos.push(_p.x, _p.y, _p.z);
      if (nr) { _n.fromBufferAttribute(nr, v).applyMatrix3(_nm).normalize(); nrm.push(_n.x, _n.y, _n.z); } else nrm.push(0, 1, 0);
      col.push(_c[0], _c[1], _c[2]);
    }
  });
  // centre it on the middle of its box
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 1] -= cy; pos[i + 2] -= cz; }
  const geometry = new BufferGeometry();
  if (cell > 0) {
    // weld on a grid: one vertex a cell (the mean of what fell in it, its colour the first's)
    const at = new Map(), wp = [], wc = [], cnt = [], idx = [];
    const k = 1 / cell;
    for (let i = 0; i < pos.length; i += 3) {
      const key = `${Math.round(pos[i] * k)},${Math.round(pos[i + 1] * k)},${Math.round(pos[i + 2] * k)}`;
      let v = at.get(key);
      if (v === undefined) { v = cnt.length; at.set(key, v); wp.push(0, 0, 0); wc.push(col[i], col[i + 1], col[i + 2]); cnt.push(0); }
      wp[v * 3] += pos[i]; wp[v * 3 + 1] += pos[i + 1]; wp[v * 3 + 2] += pos[i + 2]; cnt[v]++;
      idx.push(v);
    }
    for (let v = 0; v < cnt.length; v++) { wp[v * 3] /= cnt[v]; wp[v * 3 + 1] /= cnt[v]; wp[v * 3 + 2] /= cnt[v]; }
    const tri = [];
    for (let i = 0; i < idx.length; i += 3) { const a = idx[i], b = idx[i + 1], c = idx[i + 2]; if (a !== b && b !== c && a !== c) tri.push(a, b, c); }
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(wp), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(wc), 3));
    geometry.setIndex(cnt.length > 65535 ? new BufferAttribute(new Uint32Array(tri), 1) : new BufferAttribute(new Uint16Array(tri), 1));
    geometry.computeVertexNormals();
  } else {
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  }
  geometry.computeBoundingSphere();
  const triangles = (geometry.getIndex() ? geometry.getIndex().count : geometry.getAttribute('position').count) / 3;
  return { geometry, length: z1 - z0, height: y1 - y0, triangles };
}

// free a model that has been baked: its geometries and every material it made
function discard(model) {
  const mats = new Set();
  model.root.traverse((o) => {
    if (o.geometry && typeof o.geometry.dispose === 'function') o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) mats.add(m);
  });
  for (const m of Object.values(model.materials || {})) if (m && typeof m.dispose === 'function') mats.add(m);
  for (const m of mats) if (typeof m.dispose === 'function') m.dispose();
}

// The material of a displayed weapon: its baked colours, lit by whatever stands near, and three
// lights of its own so it reads in the dark: a little all over (lift.x), a warm edge where the
// surface turns away (lift.y), and a soft key from over the viewer's left shoulder with a sheen
// (lift.z), so the finish shows whichever way the weapon is turned.
function displayMaterial(lift) {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uGunLift = lift;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGunLift;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 gn = normalize(vNormal), gv = normalize(vViewPosition), gl = normalize(vec3(-0.45, 0.6, 0.66));
          float rim = pow(1.0 - clamp(dot(gn, gv), 0.0, 1.0), 3.0);
          float key = 0.25 + 0.75 * clamp(dot(gn, gl), 0.0, 1.0);
          float sheen = pow(clamp(dot(gn, normalize(gl + gv)), 0.0, 1.0), 28.0);
          totalEmissiveRadiance += (diffuseColor.rgb * 3.0 + vec3(0.02)) * uGunLift.x + vec3(1.0, 0.62, 0.22) * rim * uGunLift.y
            + (diffuseColor.rgb * 2.4 * key + vec3(1.0, 0.93, 0.8) * sheen * 0.5) * uGunLift.z; }`);
  };
  mat.customProgramCacheKey = () => 'level:gunDisplay';
  return mat;
}

/**
 * @param {object} G
 * @param {object} [o]
 * @param {string[]} [o.ids]   the weapons to show (default: every weapon with a model)
 * @param {boolean} [o.lite]   weld the meshes down (the cheap tiers)
 */
export function createGunDisplay(G, o = {}) {
  const lite = !!o.lite;
  const ids = (o.ids || Object.keys(MODELS)).filter((id) => hasModel(id));
  const lift = { value: new Vector3(0.08, 0.6, 0.8) }; // x: its own light, y: the warm edge, z: the key
  const material = displayMaterial(lift);
  const root = new Group();
  root.name = 'gunDisplay';
  const entries = new Map(); // id -> { mesh, length, height, triangles }
  const stats = { built: 0, triangles: 0, ms: 0, lite };
  let shown = null, gap = 0;

  function build(id) {
    if (entries.has(id)) return entries.get(id);
    const src = hasModel(id) ? id : STAND_IN;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let e = null;
    // without the weapons' materials (a test, a headless build) there is nothing to make a model of
    if (!G || !G.mats) { e = { mesh: null, length: 0, height: 0, triangles: 0 }; entries.set(id, e); return e; }
    try {
      const model = MODELS[src](G);
      const b = bakeModel(model, lite ? LITE_CELL : 0);
      discard(model);
      const mesh = new Mesh(b.geometry, material);
      mesh.name = `gun:${id}`; mesh.visible = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false; mesh.userData.noReflect = true;
      root.add(mesh);
      e = { mesh, length: b.length, height: b.height, triangles: b.triangles };
      stats.built++; stats.triangles += b.triangles;
    } catch (err) {
      // a model that will not build leaves the display empty for that weapon; the box still works
      if (typeof console !== 'undefined') console.warn(`[gunDisplay] ${id}: ${err && err.message}`);
      e = { mesh: null, length: 0, height: 0, triangles: 0 };
    }
    if (typeof performance !== 'undefined') stats.ms += performance.now() - t0;
    entries.set(id, e);
    return e;
  }

  return {
    root, ids, stats, lift, material,
    // set by a box on every frame of a roll: models may be built during play this frame
    wanted: false,
    // build the next weapon nobody has asked for yet; false when there is nothing left to build
    warm() { for (const id of ids) if (!entries.has(id)) { build(id); return true; } return false; },
    // once a frame, from one caller: never more than one model built
    tick(dt, playing) {
      const roll = this.wanted;
      this.wanted = false;
      if (!playing) { gap = 0; return this.warm(); }
      if (!roll) return false;
      gap -= dt;
      if (gap > 0) return false;
      gap = WARM_GAP;
      return this.warm();
    },
    ensure: build,
    // the baked mesh's geometry, for a mesh of one's own (null when it could not be built)
    geometryOf(id) { const e = build(id); return e.mesh ? e.mesh.geometry : null; },
    // a material of one's own with its own lights: { material, lift }
    newMaterial(x = 0.1, y = 0.5, z = 0.8) { const l = { value: new Vector3(x, y, z) }; return { material: displayMaterial(l), lift: l }; },
    has: (id) => entries.has(id),
    // show one weapon (null: none). Returns its entry.
    show(id) {
      if (shown === id) return id ? entries.get(id) : null;
      if (shown && entries.get(shown) && entries.get(shown).mesh) entries.get(shown).mesh.visible = false;
      shown = id || null;
      if (!shown) return null;
      const e = build(shown);
      if (e.mesh) e.mesh.visible = true;
      return e;
    },
    get shown() { return shown; },
  };
}

// The one display set a game shares (the weapon box and the weapons lying about to be picked up):
// every weapon that has a model, welded down on the tiers that cannot afford the full meshes.
const SHARED = new WeakMap();
export function sharedGunDisplay(G) {
  let d = SHARED.get(G);
  if (!d) {
    const q = G.quality || {};
    d = createGunDisplay(G, { ids: GUN_IDS, lite: (q.viewDetail ?? (q.depthPrepass === false ? 0 : 1)) < 1 });
    SHARED.set(G, d);
  }
  return d;
}
// How large a weapon of this length (metres) is shown: `gain` times life size, never shorter than
// `min` metres nor longer than `max` (small arms come out larger than life, long ones fit the stage).
export const displayScale = (len, gain, min, max) => (len > 0 ? Math.min(max, Math.max(min, len * gain)) / len : 1);
