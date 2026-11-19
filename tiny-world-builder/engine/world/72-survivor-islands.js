  // -------- survivor islands: endless scatter of the ACTUAL poser isles --------
  // The gravitanium apocalypse tore the planet's surface into a dark flooded
  // crust (71-infinite-surface.js). A few lush "places" survived — those are the
  // detailed voxel-poser islands (57-poser-surface.js). This module scatters
  // those SAME islands endlessly across the flooded scar so the plane keeps
  // finding green survivors dotting the water in every direction, forever.
  //
  // It does NOT model new terrain: it calls the poser's build(), reads its group,
  // and splits the merged island/meadow/foliage meshes into six individual isle
  // TEMPLATES (partitioned by nearest poser SATS centre). A chunk manager around
  // the camera divides world XZ into cells; each cell is seeded deterministically
  // from its integer coords (world-anchored, like 71's noise) and usually EMPTY —
  // survivors are rare — sometimes holding one island biased toward the shader's
  // FLOODED areas (sampled with a JS port of 71's fbm continent field) so isles
  // sit in water, never buried on crust. Instances are pooled + recycled as the
  // camera crosses cell boundaries; total live count stays small and every mesh
  // is frustumCulled so off-screen isles cost nothing.
  //
  // Exposed as window.__tinyworldSurvivorIslands.{show,hide,tick,isActive}.
  // flight-sim (34) calls show()/hide() beside the __tinyworldInfiniteSurface
  // calls on veil begin/end. IIFE — no top-level identifiers leak.
  (function survivorIslandsBoot() {
    'use strict';
    if (typeof window === 'undefined' || typeof THREE === 'undefined') return;
    if (window.__tinyworldSurvivorIslands) return;   // guard against double-install

    // ---- placement (matches the poser + infinite surface so all three agree) ----
    const SEA_Y = -60.3;          // 71's water level
    const ISLAND_Y = -60.0;       // poser DROP: local sea (y=0) -> world -60, bases dip into water
    const SCALE = 1.6;            // poser SCALE (Y_BOOST is 1 -> isotropic)
    const CELL = 180;             // world XZ cell size
    const RADIUS = 2;             // cells around the camera cell (5x5 grid)
    const OCC_PROB = 0.55;        // chance a cell holds a survivor (before the water test)
    const NF = 0.012;             // == 71 uFreq: continent field frequency
    const WATER_MAX = 0.47;       // place only where the field reads flooded (< seaThreshold 0.52)
    const MAX_TOTAL = 14;         // hard cap on live instances (bounded scatter)

    // the six poser isle centres, read verbatim from 57's SATS + the home isle.
    // Used only to PARTITION the merged meshes into individual templates.
    const CENTERS = [[0, 0], [46, 9], [14, -46], [-40, -26], [-44, 22], [10, 50]];

    // ---- shared-scene references (in-scope for engine <script> modules) ----
    function parentNode() {
      if (typeof worldGroup !== 'undefined' && worldGroup) return worldGroup;
      if (typeof xrWorldRoot !== 'undefined' && xrWorldRoot) return xrWorldRoot;
      return (typeof scene !== 'undefined') ? scene : null;
    }
    function cameraRef() { return (typeof camera !== 'undefined') ? camera : null; }

    // ===== JS port of 71's continent field (used ONLY to bias placement toward
    // flooded areas). Precision differs from the GPU float path, but the low-freq
    // continent octaves dominate, so "is this XZ flooded" agrees with the shader. =====
    const _fract = (x) => x - Math.floor(x);
    const _mix = (a, b, t) => a + (b - a) * t;
    function vhash(x, z) { return _fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453); }
    function vnoise(x, z) {
      const ix = Math.floor(x), iz = Math.floor(z);
      let fx = x - ix, fz = z - iz;
      fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
      return _mix(_mix(vhash(ix, iz), vhash(ix + 1, iz), fx),
        _mix(vhash(ix, iz + 1), vhash(ix + 1, iz + 1), fx), fz);
    }
    function fbm(x, z) {
      let a = 0.5, s = 0, px = x, pz = z;
      for (let i = 0; i < 5; i++) { s += a * vnoise(px, pz); px *= 2.02; pz *= 2.02; a *= 0.5; }
      return s;   // ~[0, 0.97]
    }

    // deterministic per-cell PRNG (mulberry32 seeded from integer cell coords) —
    // same cell coord always yields the same island, like 71's world-anchored field.
    function cellRand(ix, iz) {
      let s = ((ix * 73856093) ^ (iz * 19349663)) >>> 0;
      s = (s ^ 0x9e3779b9) >>> 0;
      return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // ===================== state =====================
    let built = false, raf = null, _par = null, lastCellKey = null, createdCount = 0;
    const templates = [];         // Group per isle (owned split geo + shared poser materials)
    const ownedGeoms = [];        // split BufferGeometries we created -> we dispose these
    const allInstances = [];      // every clone ever created (leak/cap check)
    let freeByTemplate = [];      // freeByTemplate[t] = pooled idle clones of template t
    const active = new Map();     // cellKey -> { inst, tIdx }

    // Split a merged geometry into one BufferGeometry per centre, assigning each
    // triangle to its nearest CENTERS point (forgiving; ragged underwater cuts are
    // hidden below the opaque water). Copies whatever attributes are present.
    function splitByCenters(geo) {
      const pos = geo.attributes.position;
      const nrm = geo.attributes.normal;
      const col = geo.attributes.color;
      const uv = geo.attributes.uv;
      const index = geo.index;
      const gi = index ? ((i) => index.getX(i)) : ((i) => i);
      const triCount = (index ? index.count : pos.count) / 3;
      const buckets = CENTERS.map(() => ({
        pos: [], nrm: nrm ? [] : null, col: col ? [] : null, uv: uv ? [] : null,
      }));
      for (let t = 0; t < triCount; t++) {
        const a = gi(t * 3), b = gi(t * 3 + 1), c = gi(t * 3 + 2);
        const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
        const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
        let bi = 0, bd = Infinity;
        for (let k = 0; k < CENTERS.length; k++) {
          const dx = cx - CENTERS[k][0], dz = cz - CENTERS[k][1], d = dx * dx + dz * dz;
          if (d < bd) { bd = d; bi = k; }
        }
        const B = buckets[bi];
        const verts = [a, b, c];
        for (let j = 0; j < 3; j++) {
          const vi = verts[j];
          B.pos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
          if (B.nrm) B.nrm.push(nrm.getX(vi), nrm.getY(vi), nrm.getZ(vi));
          if (B.col) B.col.push(col.getX(vi), col.getY(vi), col.getZ(vi));
          if (B.uv) B.uv.push(uv.getX(vi), uv.getY(vi));
        }
      }
      return buckets.map((B) => {
        if (!B.pos.length) return null;
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
        if (B.nrm) bg.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
        if (B.col) bg.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
        if (B.uv) bg.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
        return bg;
      });
    }

    // Build the six isle templates from the poser's own meshes (lazy, first show).
    function buildTemplates() {
      if (templates.length) return true;
      const poser = window.__tinyworldPoserSurface;
      if (!poser || typeof poser.build !== 'function') return false;
      poser.build();
      const g = poser.group && poser.group();
      if (!g) return false;

      // separate the land isles from the flat sea plane / backdrop ring / foam:
      //   foliage = the 'poserFoliage' merged mesh
      //   meadow  = the only mesh with a texture map (grass)
      //   island  = the opaque vertex-coloured heightfield (sand + seabed)
      let island = null, meadow = null, foliage = null;
      g.children.forEach((ch) => {
        if (ch.name === 'poserFoliage') { foliage = ch; return; }
        if (ch.name === 'poserBackdrop') return;
        if (!ch.isMesh) return;
        const m = ch.material;
        if (m && m.map) { meadow = ch; return; }
        if (m && m.isMeshStandardMaterial && !m.transparent && !m.map && !island) island = ch;
      });
      if (!island) return false;

      const islandB = splitByCenters(island.geometry);
      const meadowB = meadow ? splitByCenters(meadow.geometry) : null;
      const foliageB = foliage ? splitByCenters(foliage.geometry) : null;

      for (let c = 0; c < CENTERS.length; c++) {
        const grp = new THREE.Group();
        grp.name = 'survivorIsle' + c;
        const add = (bucket, mat) => {
          if (!bucket) return;
          bucket.translate(-CENTERS[c][0], 0, -CENTERS[c][1]);   // recentre so rot/scale pivot on the isle
          bucket.computeBoundingSphere();                        // needed for frustum culling of clones
          const m = new THREE.Mesh(bucket, mat);                 // shared poser material (never disposed)
          m.receiveShadow = true;
          grp.add(m);
          ownedGeoms.push(bucket);
        };
        add(islandB[c], island.material);
        if (meadowB) add(meadowB[c], meadow.material);
        if (foliageB) add(foliageB[c], foliage.material);
        if (grp.children.length) templates.push(grp);
      }
      freeByTemplate = templates.map(() => []);
      return templates.length > 0;
    }

    // ---- instance pool (recycle by template; hard-capped) ----
    function getInstance(tIdx) {
      const free = freeByTemplate[tIdx];
      if (free && free.length) return free.pop();
      if (createdCount >= MAX_TOTAL) return null;
      const inst = templates[tIdx].clone();   // shares geometry + material buffers (cheap)
      createdCount++;
      allInstances.push(inst);
      return inst;
    }
    function releaseInstance(entry) {
      const inst = entry.inst;
      if (inst.parent) inst.parent.remove(inst);
      inst.visible = false;
      freeByTemplate[entry.tIdx].push(inst);
    }

    // Reconcile the live instances with the cells now within RADIUS of the camera.
    function updateChunks() {
      const cam = cameraRef();
      if (!cam || !_par) return;
      const cix = Math.floor(cam.position.x / CELL);
      const ciz = Math.floor(cam.position.z / CELL);

      // desired: which in-range cells hold a survivor, and where/how it sits
      const desired = new Map();
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        for (let dz = -RADIUS; dz <= RADIUS; dz++) {
          const ix = cix + dx, iz = ciz + dz;
          const rng = cellRand(ix, iz);
          const rOcc = rng();
          const tIdx = Math.floor(rng() * templates.length);
          const ox = (rng() - 0.5) * CELL * 0.6;
          const oz = (rng() - 0.5) * CELL * 0.6;
          const rot = rng() * Math.PI * 2;
          const scl = SCALE * (0.85 + rng() * 0.5);
          if (rOcc >= OCC_PROB) continue;                       // rare survivors -> mostly empty
          const wx = ix * CELL + CELL / 2 + ox;
          const wz = iz * CELL + CELL / 2 + oz;
          if (fbm(wx * NF, wz * NF) >= WATER_MAX) continue;     // keep survivors in the flooded scar
          desired.set(ix + ',' + iz, { tIdx, wx, wz, rot, scl });
        }
      }

      // recycle instances leaving range
      const stale = [];
      active.forEach((entry, key) => { if (!desired.has(key)) stale.push(key); });
      for (const key of stale) { releaseInstance(active.get(key)); active.delete(key); }

      // place instances for newly-entered cells
      desired.forEach((p, key) => {
        if (active.has(key)) return;
        const inst = getInstance(p.tIdx);
        if (!inst) return;                                      // cap hit -> cell stays empty (bounded)
        inst.position.set(p.wx, ISLAND_Y, p.wz);
        inst.rotation.set(0, p.rot, 0);
        inst.scale.setScalar(p.scl);
        inst.visible = true;
        if (inst.parent !== _par) _par.add(inst);
        active.set(key, { inst, tIdx: p.tIdx });
      });
    }

    // ---- self-driven tick: only reconciles when the camera crosses a cell ----
    function tick() {
      if (!built) return;
      const cam = cameraRef();
      if (!cam) return;
      const key = Math.floor(cam.position.x / CELL) + ',' + Math.floor(cam.position.z / CELL);
      if (key === lastCellKey) return;   // instances are static; nothing to do mid-cell
      lastCellKey = key;
      updateChunks();
    }
    function startTick() {
      if (raf) return;
      const loop = () => { tick(); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    function stopTick() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

    function show() {
      if (!buildTemplates()) return false;
      const par = parentNode();
      if (!par) return false;
      _par = par;
      built = true;
      lastCellKey = null;
      updateChunks();      // immediate first placement
      const cam = cameraRef();
      if (cam) lastCellKey = Math.floor(cam.position.x / CELL) + ',' + Math.floor(cam.position.z / CELL);
      startTick();
      return true;
    }

    function hide() {
      stopTick();
      // remove every instance (active + pooled) from the scene
      active.forEach((entry) => { if (entry.inst.parent) entry.inst.parent.remove(entry.inst); });
      active.clear();
      freeByTemplate.forEach((arr) => {
        arr.forEach((inst) => { if (inst.parent) inst.parent.remove(inst); });
        arr.length = 0;
      });
      // dispose ONLY the split geometries we created (clones share these; poser
      // materials/textures are shared references and are NEVER disposed here)
      ownedGeoms.forEach((geo) => geo.dispose());
      ownedGeoms.length = 0;
      templates.length = 0;
      freeByTemplate = [];
      allInstances.length = 0;
      createdCount = 0;
      built = false;
      _par = null;
      lastCellKey = null;
    }

    function isActive() { return !!built; }

    window.__tinyworldSurvivorIslands = {
      show, hide, tick, isActive,
      count: () => active.size,           // live islands in the scene
      total: () => allInstances.length,   // instances ever created (<= MAX_TOTAL)
      templateCount: () => templates.length,
    };
  })();
