// engine/world/41-flight-combat.js
// -------- flight combat: guns, targeting HUD, missiles --------
// Scene-space combat for the stunt plane. Hooked from 34-flight-sim.js via
// optional globals (same pattern as window.__tinyworldMultiplayer.broadcastFlight).
// Reads the rendered plane transform off window.__flightJet each tick; never
// touches the sim-space flight physics.
(function flightCombatModule() {
  'use strict';
  if (typeof THREE === 'undefined') return;

  // Step 1 muzzle-flash path: 23-particles-clouds.js exposes only weather/splash
  // emitters (emitSplash, emitWeatherBuildSurface, emitRainSurface, etc.) via
  // module-private closures — none are published as globals. No reusable burst
  // emitter is reachable from this module. Tracer meshes carry the visual for
  // now; muzzle flash deferred to a later refinement task.

  let active = false;
  let jet = null; // window.__flightJet while flying

  const MAX_HEALTH = 100;
  let health = MAX_HEALTH;
  let healthEl = null;

  // ---- target adapter ----
  // Uniform target interface so guns/missiles/HUD never special-case kinds:
  //   { id, kind, getWorldPos(out), radius, isAlive(), label(), speedKts(),
  //     applyDamage(amount, hitScenePos, source) }
  const targets = [];                 // rebuilt each frame
  const _prevGhostPos = new Map();    // id -> THREE.Vector3 (last frame) for speed est

  function makeGhostTarget(g, dt) {
    const pos = new THREE.Vector3();
    g.group.getWorldPosition(pos);
    let speed = 0;
    const prev = _prevGhostPos.get(g.id);
    if (prev && dt > 0) speed = prev.distanceTo(pos) / dt;
    if (prev) prev.copy(pos); else _prevGhostPos.set(g.id, pos.clone());
    return {
      id: 'ghost:' + g.id,
      kind: 'player',
      _pos: pos,
      getWorldPos(out) { return (out || new THREE.Vector3()).copy(this._pos); },
      radius: 1.6,
      isAlive() { return true; }, // players don't die locally; handled by hit messaging later
      label() { return g.name || 'PLAYER'; },
      speedKts() { return speed * 1.94; },
      applyDamage(amount, hitPos, source) { onHitPlayer(g.id, amount, source); },
    };
  }

  function onHitPlayer(peerId, amount, source) {
    const mp = window.__tinyworldMultiplayer;
    if (mp && typeof mp.send === 'function') {
      mp.send({ type: 'combat.hit', to: peerId, damage: amount, source: source || 'gun' });
    }
  }

  // Rough distance attenuation for positional combat one-shots: full within
  // ~20 scene units of the viewpoint, fading to a floor by ~140. Uses the
  // camera when available (falls back to the jet), never zero so a far hit
  // still registers faintly.
  const _fcAudioRef = new THREE.Vector3();
  function combatAudioGain(pos) {
    if (!pos) return 1;
    let ref = null;
    if (typeof camera !== 'undefined' && camera) { camera.getWorldPosition(_fcAudioRef); ref = _fcAudioRef; }
    else if (jet) { jet.getWorldPosition(_fcAudioRef); ref = _fcAudioRef; }
    if (!ref) return 1;
    const d = ref.distanceTo(pos);
    return Math.max(0.12, Math.min(1, 1 - (d - 20) / 120));
  }

  function onIncomingHit(msg) {
    if (!active) return;
    const dmg = Math.max(0, Number(msg.damage) || 0);
    health = Math.max(0, Math.min(MAX_HEALTH, health - dmg));
    // Local player took a hit: metallic clank on the hull, full level.
    if (window.__flightCombatAudio) window.__flightCombatAudio.impact();
    if (jet) { jet.getWorldPosition(_fcSparkTmp); spawnHitSparks(_fcSparkTmp); }
    if (health <= 0) { health = 0; doDeathAndRelaunch(); }
  }
  function spawnExplosionFX(pos) {
    ensureSparkPool();
    ensureExplosionPool();
    if (window.__flightCombatAudio) window.__flightCombatAudio.explosion({ gain: combatAudioGain(pos) });
    for (let k = 0; k < 2; k++) spawnHitSparks(pos);
    for (let k = 0; k < 5; k++) spawnExplosionParticle(pos, 'fire');
    for (let k = 0; k < 9; k++) spawnExplosionParticle(pos, 'smoke');
    for (let k = 0; k < 5; k++) spawnExplosionParticle(pos, 'ember');
  }
  function doDeathAndRelaunch() {
    if (jet) { jet.getWorldPosition(_fcSparkTmp); spawnExplosionFX(_fcSparkTmp); }
    health = MAX_HEALTH;
    missilesAmmo = MISSILE_COUNT;
    gunAmmo = GUN_AMMO_MAX;
    missileCooldown = 0;
    missileSide = -1;
    _fcXPrev = false;
    for (const m of missiles) deactivateMissile(m);
    if (typeof window.__flightRelaunch === 'function') window.__flightRelaunch();
  }

  function collectTargets(dt) {
    targets.length = 0;
    const mp = window.__tinyworldMultiplayer;
    if (mp && typeof mp.flightGhosts === 'function') {
      const ghosts = mp.flightGhosts();
      for (const g of ghosts) targets.push(makeGhostTarget(g, dt));
      // prune stale speed-estimate entries for ghosts that vanished
      if (_prevGhostPos.size > ghosts.length + 4) {
        const live = new Set(ghosts.map(g => g.id));
        for (const id of Array.from(_prevGhostPos.keys())) if (!live.has(id)) _prevGhostPos.delete(id);
      }
    }
    // AI target-practice drones (module 73). Exposed as an array (or a function
    // returning one) of the same target adapter shape; only live ones are shot.
    const dp = window.__flightTargetPlanes;
    const arr = typeof dp === 'function' ? dp() : dp;
    if (Array.isArray(arr)) for (const t of arr) if (t && t.isAlive && t.isAlive()) targets.push(t);
  }

  // ---- tracers ----
  const TRACER_POOL = 48;
  const TRACER_SPEED = 46;     // scene units/sec
  const TRACER_LIFE = 0.55;
  const FIRE_COOLDOWN = 0.11;
  const GUN_AMMO_MAX = 220;
  const GUN_REWARD_AMMO = 120;
  let gunAmmo = GUN_AMMO_MAX;
  let tracerGroup = null;
  const tracers = [];
  let fireCooldown = 0;
  let shotsFired = 0;
  const gunMuzzleL = new THREE.Vector3(); // jet-local offsets, set in onEnter
  const gunMuzzleR = new THREE.Vector3();
  const _muzzleWorld = new THREE.Vector3();
  const _fireDir = new THREE.Vector3();
  const _tracerQuat = new THREE.Quaternion();
  const _projForward = new THREE.Vector3(0, 0, 1);

  function ensureTracerPool() {
    if (tracerGroup) return;
    tracerGroup = new THREE.Group();
    tracerGroup.name = 'tw_flight_tracers';
    scene.add(tracerGroup);
    const geo = new THREE.BoxGeometry(0.03, 0.03, 0.6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffce6a, toneMapped: false, transparent: true,
      opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < TRACER_POOL; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      m.renderOrder = 30;
      m.raycast = () => {};
      tracerGroup.add(m);
      tracers.push({ mesh: m, vel: new THREE.Vector3(), life: 0, active: false });
    }
  }

  function spawnTracer(origin, dir) {
    const t = tracers.find(s => !s.active);
    if (!t) return;
    t.active = true;
    t.life = TRACER_LIFE;
    t.vel.copy(dir).multiplyScalar(TRACER_SPEED);
    t.mesh.position.copy(origin);
    t.mesh.quaternion.copy(_tracerQuat.setFromUnitVectors(_projForward, dir));
    t.mesh.visible = true;
  }

  function updateTracers(dt) {
    for (const t of tracers) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) { t.active = false; t.mesh.visible = false; continue; }
      t.mesh.position.addScaledVector(t.vel, dt);
    }
  }

  // side: 'left' fires the left wing gun, 'right' the right, anything else both.
  function fireGuns(side) {
    if (!jet || gunAmmo <= 0) return;
    const dir = window.__flightSceneForward
      ? window.__flightSceneForward(_fireDir)
      : _fireDir.set(0, 0, -1);
    const muzzles = side === 'left' ? [gunMuzzleL]
      : side === 'right' ? [gunMuzzleR]
      : [gunMuzzleL, gunMuzzleR];
    for (const local of muzzles) {
      _muzzleWorld.copy(local);
      jet.localToWorld(_muzzleWorld);
      spawnTracer(_muzzleWorld, dir);
      attemptInstantHit(_muzzleWorld, dir);
    }
    gunAmmo = Math.max(0, gunAmmo - muzzles.length);
    shotsFired++;
    if (window.__flightCombatAudio) window.__flightCombatAudio.gun();
    // Recoil: a brief speed dip (handled in 34), no roll/pitch.
    if (window.__flightRecoil) window.__flightRecoil();
  }

  // ---- hitscan ----
  const _fcHitToTarget = new THREE.Vector3();
  const _fcHitNearest = new THREE.Vector3();
  const _fcHitPos = new THREE.Vector3();
  const GUN_DAMAGE = 8;
  let gunHits = 0;
  function attemptInstantHit(origin, dir) {
    let best = null, bestAlong = Infinity;
    for (const tgt of targets) {
      if (!tgt.isAlive()) continue;
      tgt.getWorldPos(_fcHitToTarget); _fcHitToTarget.sub(origin);
      const along = _fcHitToTarget.dot(dir);
      if (along < 0 || along > 400) continue;
      _fcHitNearest.copy(dir).multiplyScalar(along).add(origin);
      tgt.getWorldPos(_fcHitPos);
      const miss = _fcHitNearest.distanceTo(_fcHitPos);
      // aim magnet: a locked / locking target is more forgiving to hit
      const magnet = (tgt.id === lockId ? 1.4 : 0.4) + lockAmount * 1.2;
      if (miss > tgt.radius + magnet) continue;
      if (along < bestAlong) { bestAlong = along; best = tgt; }
    }
    if (best) {
      best.getWorldPos(_fcHitPos);
      best.applyDamage(GUN_DAMAGE, _fcHitPos, 'gun');
      // Guns don't normally boom, but a target that this shot destroys (e.g. a
      // drone) explodes — the missile path already does this on its own hits.
      if (!best.isAlive()) spawnExplosionFX(_fcHitPos);
      spawnHitSparks(_fcHitPos);
      if (window.__flightCombatAudio) window.__flightCombatAudio.impact({ gain: combatAudioGain(_fcHitPos) });
      gunHits++;
    } else {
      attemptSceneryHit(origin, dir, GUN_DAMAGE);
    }
  }

  // ---- destructible scenery ----
  const _fcRay = new THREE.Raycaster();
  _fcRay.far = 400;
  const _fcRayDir = new THREE.Vector3();
  const _fcCellBox = new THREE.Box3();
  const _fcObjCenter = new THREE.Vector3();
  const _fcSeenObjs = new Set();
  const cellHealth = new Map(); // 'x,z' -> remaining hp

  // Flat cache of all entries from cellMeshesGrid + cellMeshes. Rebuilt lazily
  // on the next objectMeshCandidates call after a 'tinyworld:world-changed' event.
  // The per-origin distance filter is still applied per-call (origin-dependent).
  let _fcAllEntriesCache = null;
  window.addEventListener('tinyworld:world-changed', function () {
    _fcAllEntriesCache = null;
  });

  function _fcRebuildAllEntries() {
    const entries = [];
    const seen = new Set();
    const add = (entry) => {
      if (!entry || !entry.object) return;
      if (seen.has(entry.object)) return;
      seen.add(entry.object);
      entries.push(entry);
    };
    // in-grid objects: 2D array cellMeshesGrid[x][z]
    if (typeof cellMeshesGrid !== 'undefined' && cellMeshesGrid) {
      for (let gx = 0; gx < cellMeshesGrid.length; gx++) {
        const col = cellMeshesGrid[gx];
        if (!col) continue;
        for (let gz = 0; gz < col.length; gz++) add(col[gz]);
      }
    }
    // out-of-grid objects: string-keyed map cellMeshes
    if (typeof cellMeshes !== 'undefined' && cellMeshes) {
      for (const key in cellMeshes) add(cellMeshes[key]);
    }
    return entries;
  }

  function objectMeshCandidates(origin) {
    if (!_fcAllEntriesCache) _fcAllEntriesCache = _fcRebuildAllEntries();
    const out = [];
    _fcSeenObjs.clear();
    for (let i = 0; i < _fcAllEntriesCache.length; i++) {
      const entry = _fcAllEntriesCache[i];
      if (!entry || !entry.object || !entry.object.visible) continue;
      if (entry.object === jet) continue; // never the player plane
      if (_fcSeenObjs.has(entry.object)) continue;
      entry.object.getWorldPosition(_fcObjCenter);
      if (_fcObjCenter.distanceToSquared(origin) > 60 * 60) continue;
      _fcSeenObjs.add(entry.object);
      out.push(entry);
    }
    return out;
  }

  function cellMaxHealth(entry) {
    _fcCellBox.setFromObject(entry.object);
    if (_fcCellBox.isEmpty()) return 20;
    const s = new THREE.Vector3(); _fcCellBox.getSize(s);
    const vol = Math.max(0.05, s.x * s.y * s.z);
    return Math.min(120, 12 + vol * 120); // small props pop fast, big builds tank
  }

  function damageCell(x, z, damage, hitPoint) {
    const key = x + ',' + z;
    let hp = cellHealth.has(key) ? cellHealth.get(key) : null;
    if (hp == null) {
      const entry = (typeof cellMeshes !== 'undefined') ? cellMeshes[key] : null;
      hp = entry && entry.object ? cellMaxHealth(entry) : 20;
    }
    hp -= damage;
    spawnHitSparks(hitPoint);
    // Real projectile striking scenery: metallic impact. If this shot destroys
    // the cell, destroyCell -> spawnExplosionFX plays the boom instead.
    if (hp > 0 && window.__flightCombatAudio) window.__flightCombatAudio.impact({ gain: combatAudioGain(hitPoint) });
    if (hp <= 0) { cellHealth.delete(key); destroyCell(x, z, hitPoint); }
    else cellHealth.set(key, hp);
  }

  function destroyCell(x, z, hitPoint) {
    const cell = (typeof getWorldCell === 'function') ? getWorldCell(x, z) : null;
    if (!cell || !cell.kind) return; // only object kinds; never carve terrain
    const mp = window.__tinyworldMultiplayer;
    const allowed = !mp || typeof mp.canEdit !== 'function' || mp.canEdit(x, z);
    if (!allowed) { spawnHitSparks(hitPoint); return; } // role-blocked: cue only, no destroy
    spawnExplosionFX(hitPoint);
    // Clear the object, preserve terrain. Reuses the erase path: setCell
    // broadcasts (sendCellSnapshot), persists, and pushes undo history.
    setCell(x, z, {
      terrain: cell.terrain,
      terrainFloors: (typeof terrainLevelForCell === 'function') ? terrainLevelForCell(cell) : undefined,
      kind: null,
      floors: 1,
    });
  }

  // Returns true if a scenery object was hit (and damaged), so callers can stop.
  function attemptSceneryHit(origin, dir, damage, maxDist) {
    if (typeof getWorldCell !== 'function' || typeof setCell !== 'function') return false;
    _fcRay.set(origin, _fcRayDir.copy(dir).normalize());
    if (typeof camera !== 'undefined') _fcRay.camera = camera;
    const cands = objectMeshCandidates(origin);
    let nearestDist = Infinity, nearestEntry = null, nearestPoint = null;
    for (const entry of cands) {
      const obj = entry.object;
      let hits = null;
      try {
        hits = _fcRay.intersectObject(obj, true);
      } catch (_) {
        // Some cell object trees contain a null child (factory artifact) which
        // makes THREE's recursive raycast throw. Skip that object rather than
        // letting it break the combat tick.
        continue;
      }
      if (hits && hits.length && hits[0].distance < nearestDist) {
        nearestDist = hits[0].distance; nearestEntry = entry; nearestPoint = hits[0].point;
      }
    }
    const limit = (maxDist != null) ? maxDist : 400;
    if (!nearestEntry || nearestDist > limit) return false;
    damageCell(nearestEntry.x, nearestEntry.z, damage, nearestPoint);
    return true;
  }

  // ---- hit sparks ----
  const SPARK_POOL = 40;
  let sparkGroup = null;
  const sparks = [];
  const _fcSparkTmp = new THREE.Vector3();
  function ensureSparkPool() {
    if (sparkGroup) return;
    sparkGroup = new THREE.Group();
    sparkGroup.name = 'tw_flight_sparks';
    scene.add(sparkGroup);
    const mat = new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true,
      opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < SPARK_POOL; i++) {
      const s = new THREE.Sprite(mat.clone());
      s.scale.setScalar(0.18);
      s.visible = false;
      s.raycast = () => {};
      sparkGroup.add(s);
      sparks.push({ sprite: s, vel: new THREE.Vector3(), life: 0, active: false });
    }
  }
  function spawnHitSparks(pos) {
    let emitted = 0;
    for (const sp of sparks) {
      if (sp.active) continue;
      sp.active = true;
      sp.life = 0.25;
      sp.sprite.position.copy(pos);
      sp.sprite.scale.setScalar(0.18);
      sp.vel.set((Math.random()-0.5)*6, (Math.random()-0.5)*6, (Math.random()-0.5)*6);
      sp.sprite.visible = true;
      if (++emitted >= 8) break;
    }
  }
  function updateSparks(dt) {
    for (const sp of sparks) {
      if (!sp.active) continue;
      sp.life -= dt;
      if (sp.life <= 0) { sp.active = false; sp.sprite.visible = false; continue; }
      sp.sprite.position.addScaledVector(sp.vel, dt);
      sp.sprite.material.opacity = Math.max(0, sp.life / 0.25) * 0.9;
    }
  }

  // ---- fireball / smoke bursts ----
  const EXPLOSION_POOL = 96;
  let explosionGroup = null;
  let explosionFireTexture = null;
  let explosionSmokeTexture = null;
  const explosions = [];

  function makeExplosionTexture(stops) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    stops.forEach(stop => g.addColorStop(stop[0], stop[1]));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function ensureExplosionPool() {
    if (explosionGroup) return;
    explosionGroup = new THREE.Group();
    explosionGroup.name = 'tw_flight_explosions';
    scene.add(explosionGroup);
    explosionFireTexture = makeExplosionTexture([
      [0, 'rgba(255,255,230,1)'],
      [0.22, 'rgba(255,186,48,0.95)'],
      [0.55, 'rgba(255,72,20,0.62)'],
      [1, 'rgba(255,50,0,0)'],
    ]);
    explosionSmokeTexture = makeExplosionTexture([
      [0, 'rgba(95,92,82,0.72)'],
      [0.42, 'rgba(45,43,39,0.55)'],
      [1, 'rgba(18,17,15,0)'],
    ]);
    for (let i = 0; i < EXPLOSION_POOL; i++) {
      const mat = new THREE.SpriteMaterial({
        map: explosionFireTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.raycast = () => {};
      explosionGroup.add(sprite);
      explosions.push({
        sprite,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        baseScale: 1,
        grow: 1,
        type: 'fire',
        active: false,
      });
    }
  }

  function spawnExplosionParticle(pos, type) {
    const p = explosions.find(item => !item.active);
    if (!p) return null;
    const fire = type === 'fire';
    const smoke = type === 'smoke';
    const ember = type === 'ember';
    p.active = true;
    p.type = type;
    p.maxLife = fire ? 0.42 + Math.random() * 0.14 : smoke ? 1.15 + Math.random() * 0.65 : 0.34 + Math.random() * 0.20;
    p.life = p.maxLife;
    p.baseScale = fire ? 0.55 + Math.random() * 0.60 : smoke ? 0.38 + Math.random() * 0.42 : 0.16 + Math.random() * 0.16;
    p.grow = fire ? 2.2 + Math.random() * 1.6 : smoke ? 2.4 + Math.random() * 2.2 : 1.1 + Math.random() * 0.8;
    p.sprite.position.copy(pos);
    p.sprite.position.x += (Math.random() - 0.5) * (smoke ? 0.8 : 0.35);
    p.sprite.position.y += (Math.random() - 0.35) * (smoke ? 0.55 : 0.28);
    p.sprite.position.z += (Math.random() - 0.5) * (smoke ? 0.8 : 0.35);
    p.vel.set(
      (Math.random() - 0.5) * (fire ? 3.8 : smoke ? 1.7 : 6.0),
      (fire ? 1.2 : smoke ? 2.2 : 2.8) + Math.random() * (smoke ? 2.1 : 2.8),
      (Math.random() - 0.5) * (fire ? 3.8 : smoke ? 1.7 : 6.0)
    );
    p.sprite.material.map = smoke ? explosionSmokeTexture : explosionFireTexture;
    p.sprite.material.blending = smoke ? THREE.NormalBlending : THREE.AdditiveBlending;
    p.sprite.material.color.setHex(ember ? 0xffd06b : fire ? 0xff8a24 : 0x4f4a42);
    p.sprite.material.opacity = fire ? 0.98 : smoke ? 0.48 : 0.86;
    p.sprite.material.needsUpdate = true;
    p.sprite.scale.setScalar(p.baseScale);
    p.sprite.visible = true;
    return p;
  }

  function spawnMissileTrail(pos) {
    ensureExplosionPool();
    const puff = spawnExplosionParticle(pos, 'smoke');
    if (puff && puff.active && puff.type === 'smoke') {
      puff.maxLife = 0.55;
      puff.life = 0.55;
      puff.baseScale = 0.18;
      puff.grow = 1.8;
      puff.sprite.scale.setScalar(0.18);
      puff.vel.multiplyScalar(0.35);
    }
  }

  function updateExplosionFX(dt) {
    for (const p of explosions) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const age = 1 - p.life / p.maxLife;
      p.sprite.position.addScaledVector(p.vel, dt);
      if (p.type === 'smoke') p.vel.y += dt * 0.45;
      else p.vel.multiplyScalar(Math.max(0.88, 1 - dt * 1.5));
      p.sprite.scale.setScalar(p.baseScale * (1 + age * p.grow));
      const fade = p.type === 'smoke' ? Math.pow(1 - age, 1.45) * 0.52 : Math.pow(1 - age, 1.9) * 0.98;
      p.sprite.material.opacity = Math.max(0, fade);
    }
  }

  // ---- bbox-derived muzzle offsets ----
  // _bbox yields WORLD-space extents. Because fireGuns uses jet.localToWorld
  // (which re-applies the jet's world scale), we convert the world extents to
  // LOCAL units by dividing out that scale before storing them as offsets.
  // deriveMuzzles() also guards the GLB load race: a not-yet-loaded model gives
  // a tiny placeholder box (<0.3 world units); in that case it returns false and
  // tick() retries each frame until the real geometry is present.
  const _bbox = new THREE.Box3();
  const _bsize = new THREE.Vector3();
  const _bscale = new THREE.Vector3();
  let muzzlesReady = false;
  const _fcMissileL = new THREE.Vector3();
  const _fcMissileR = new THREE.Vector3();

  function deriveMuzzles() {
    if (!jet) return false;
    jet.updateMatrixWorld(true);
    _bbox.setFromObject(jet);
    if (_bbox.isEmpty()) return false;
    _bbox.getSize(_bsize);
    // Guard the load race: a not-yet-loaded GLB gives a tiny placeholder box.
    const maxDim = Math.max(_bsize.x, _bsize.y, _bsize.z);
    if (maxDim < 0.3) return false; // model not loaded yet; retry next tick
    // _bsize is WORLD size; convert to LOCAL units by dividing out the jet's
    // world scale, because fireGuns applies jet.localToWorld (which re-applies
    // that scale). Storing world-size as a local offset would double-count it.
    jet.getWorldScale(_bscale);
    const localX = _bsize.x / (Math.abs(_bscale.x) || 1);
    const localY = _bsize.y / (Math.abs(_bscale.y) || 1);
    const localZ = _bsize.z / (Math.abs(_bscale.z) || 1);
    // jet carries FLIGHT_MODEL_FWD_FIX so the VISUAL nose is +Z in jet-local.
    // Muzzles sit out along local X (wings), toward the visual nose (+Z),
    // slightly below center.
    const halfSpan = localX * 0.5 * 0.62;
    const noseZ = localZ * 0.5 * 0.55;
    const dropY = -localY * 0.05;
    gunMuzzleL.set(-halfSpan, dropY, noseZ);
    gunMuzzleR.set(halfSpan, dropY, noseZ);
    const railSpan = localX * 0.5 * 0.5;
    const railDrop = -localY * 0.18;
    const railZ = localZ * 0.5 * 0.4;
    _fcMissileL.set(-railSpan, railDrop, railZ);
    _fcMissileR.set(railSpan, railDrop, railZ);
    return true;
  }

  // ---- HUD overlay + reticle ----
  let overlayEl = null, reticleEl = null;

  // ---- target HUD pool ----
  const HUD_TARGET_LIMIT = 6;
  const hudPool = [];
  let lockId = ''; // set by the lock system below
  function ensureHudPool() {
    if (hudPool.length || !overlayEl) return;
    for (let i = 0; i < HUD_TARGET_LIMIT; i++) {
      const bracket = document.createElement('div');
      bracket.className = 'fc-target-bracket';
      bracket.style.display = 'none';
      const card = document.createElement('div');
      card.className = 'fc-target-card';
      card.style.display = 'none';
      overlayEl.appendChild(bracket);
      overlayEl.appendChild(card);
      hudPool.push({ bracket, card });
    }
  }

  const _tpos = new THREE.Vector3();
  const _tproj = new THREE.Vector3();
  const _camPos = new THREE.Vector3();
  function updateTargetHud() {
    if (!overlayEl) return;
    camera.getWorldPosition(_camPos);
    let used = 0;
    for (const tgt of targets) {
      if (used >= HUD_TARGET_LIMIT) break;
      tgt.getWorldPos(_tpos);
      _tproj.copy(_tpos).project(camera);
      if (_tproj.z > 1) continue; // behind camera / beyond far plane
      const sx = (_tproj.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-_tproj.y * 0.5 + 0.5) * window.innerHeight;
      const dist = _camPos.distanceTo(_tpos);
      const px = Math.max(18, Math.min(160, (tgt.radius * 2 / Math.max(0.001, dist)) * window.innerHeight * 0.9));
      const slot = hudPool[used++];
      slot.bracket.style.display = 'block';
      slot.bracket.style.left = (sx - px / 2) + 'px';
      slot.bracket.style.top = (sy - px / 2) + 'px';
      slot.bracket.style.width = px + 'px';
      slot.bracket.style.height = px + 'px';
      slot.bracket.classList.toggle('locked', tgt.id === lockId);
      slot.card.style.display = 'block';
      slot.card.style.left = (sx + px / 2 + 4) + 'px';
      slot.card.style.top = (sy - px / 2) + 'px';
      const altU = Math.round(tgt._pos ? tgt._pos.y : 0);
      slot.card.textContent =
        tgt.label() + '\nDST ' + Math.round(dist) +
        '\nSPD ' + Math.round(tgt.speedKts()) + 'kt' +
        '\nALT ' + altU;
    }
    for (let i = used; i < hudPool.length; i++) {
      hudPool[i].bracket.style.display = 'none';
      hudPool[i].card.style.display = 'none';
    }
  }
  const reticleState = { x: 0, y: 0, vx: 0, vy: 0, init: false };
  const _aimWorld = new THREE.Vector3();
  const _aimProj = new THREE.Vector3();
  const _aimUp = new THREE.Vector3();

  function ensureOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'flight-combat-overlay';
    reticleEl = document.createElement('div');
    reticleEl.id = 'flight-reticle';
    overlayEl.appendChild(reticleEl);
    healthEl = document.createElement('div');
    healthEl.id = 'flight-combat-health';
    healthEl.style.cssText = 'position:absolute;left:14px;bottom:64px;font:12px/1.4 ui-monospace,Menlo,monospace;color:#9ff;background:rgba(8,14,25,0.6);padding:3px 8px;border:1px solid #1f2a44;border-radius:4px;';
    overlayEl.appendChild(healthEl);
    document.body.appendChild(overlayEl);
  }

  function updateReticle(dt) {
    if (!jet || !reticleEl) return;
    const dir = window.__flightSceneForward(_fireDir);
    jet.getWorldPosition(_aimWorld);
    // Aim point: lookahead along the fire dir, biased slightly up so the sight
    // sits above the nose for practical gunnery.
    _aimWorld.addScaledVector(dir, 60).add(_aimUp.set(0, 1.2, 0));
    _aimProj.copy(_aimWorld).project(camera); // NDC -1..1
    const tx = (_aimProj.x * 0.5 + 0.5) * window.innerWidth;
    const ty = (-_aimProj.y * 0.5 + 0.5) * window.innerHeight;
    if (!reticleState.init) { reticleState.x = tx; reticleState.y = ty; reticleState.init = true; }
    // critically-damped-ish spring for natural lag
    const k = 90, c = 18;
    reticleState.vx += (-(reticleState.x - tx) * k - reticleState.vx * c) * dt;
    reticleState.vy += (-(reticleState.y - ty) * k - reticleState.vy * c) * dt;
    reticleState.x += reticleState.vx * dt;
    reticleState.y += reticleState.vy * dt;
    const behind = _aimProj.z > 1;
    reticleEl.style.display = behind ? 'none' : 'block';
    reticleEl.style.left = reticleState.x + 'px';
    reticleEl.style.top = reticleState.y + 'px';
  }

  // ---- lock ----
  let lockAmount = 0;        // 0..1
  let lockCandidateId = '';
  const LOCK_TIME = 1.1;     // seconds on-target to full lock
  const _lpos = new THREE.Vector3();
  const _lproj = new THREE.Vector3();
  function updateLock(dt) {
    // nearest target to the reticle in screen space, in front of camera
    let best = null, bestD = Infinity;
    for (const tgt of targets) {
      tgt.getWorldPos(_lpos); _lproj.copy(_lpos).project(camera);
      if (_lproj.z > 1) continue;
      const sx = (_lproj.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-_lproj.y * 0.5 + 0.5) * window.innerHeight;
      const d = Math.hypot(sx - reticleState.x, sy - reticleState.y);
      if (d < bestD && d < 120) { bestD = d; best = tgt; }
    }
    if (best && best.id === lockCandidateId) {
      lockAmount = Math.min(1, lockAmount + dt / LOCK_TIME);
    } else {
      lockCandidateId = best ? best.id : '';
      lockAmount = best ? Math.max(0, lockAmount - dt / LOCK_TIME) : 0;
    }
    lockId = lockAmount >= 1 ? lockCandidateId : '';
    updateLockTone(lockAmount, !!best);
  }

  let _lockAudioCtx = null, _lockToneOsc = null, _lockToneGain = null;
  function updateLockTone(amount, hasCandidate) {
    if (!hasCandidate || amount <= 0.02) { stopLockTone(); return; }
    try {
      if (!_lockAudioCtx) _lockAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (!_lockToneOsc) {
        _lockToneOsc = _lockAudioCtx.createOscillator();
        _lockToneGain = _lockAudioCtx.createGain();
        _lockToneOsc.type = 'square';
        _lockToneGain.gain.value = 0.0;
        _lockToneOsc.connect(_lockToneGain).connect(_lockAudioCtx.destination);
        _lockToneOsc.start();
      }
      _lockToneOsc.frequency.value = 420 + amount * 520;
      _lockToneGain.gain.value = amount >= 1 ? 0.05 : 0.02;
    } catch (_) { /* no audio: silent */ }
  }
  function stopLockTone() {
    if (_lockToneGain) { try { _lockToneGain.gain.value = 0; } catch (_) {} }
  }

  // ---- missiles ----
  const MISSILE_COUNT = 6;
  const MISSILE_REWARD_COUNT = 2;
  let missilesAmmo = MISSILE_COUNT;
  let missileGroup = null;
  const missiles = [];
  let missileCooldown = 0;
  let missileSide = -1;
  let _fcXPrev = false;
  let _fcFrame = 0;
  const MISSILE_SPEED = 70, MISSILE_LIFE = 5.5, MISSILE_TURN = 2.4, MISSILE_DAMAGE = 40;
  const _fcMForward = new THREE.Vector3();
  const _fcMToTarget = new THREE.Vector3();
  const _fcMDesired = new THREE.Vector3();
  const _fcMTgtPos = new THREE.Vector3();
  const _fcMq = new THREE.Quaternion();
  const _fcMTrailTmp = new THREE.Vector3();
  function ensureMissilePool() {
    if (missileGroup) return;
    missileGroup = new THREE.Group();
    missileGroup.name = 'tw_flight_missiles';
    scene.add(missileGroup);
    const bodyGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.5, 8);
    const noseGeo = new THREE.ConeGeometry(0.05, 0.14, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.5, metalness: 0.3 });
    for (let i = 0; i < MISSILE_COUNT; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(bodyGeo, mat.clone()); b.rotation.x = Math.PI / 2;
      const n = new THREE.Mesh(noseGeo, mat.clone()); n.rotation.x = -Math.PI / 2; n.position.z = -0.3;
      g.add(b, n); g.visible = false; g.raycast = () => {};
      missileGroup.add(g);
      missiles.push({ mesh: g, vel: new THREE.Vector3(), pos: new THREE.Vector3(),
        targetId: '', life: 0, active: false, sceneryPhase: i % 4, trailClock: 0 });
    }
  }
  function findTargetById(id) { for (const t of targets) if (t.id === id) return t; return null; }
  function fireMissile() {
    if (missileCooldown > 0 || missilesAmmo <= 0 || !jet) return;
    const m = missiles.find(s => !s.active);
    if (!m) return;
    const side = missileSide > 0 ? 1 : -1; missileSide = -side;
    missilesAmmo--; missileCooldown = 0.7;
    const dir = window.__flightSceneForward(_fcMForward);
    const local = side < 0 ? _fcMissileL : _fcMissileR;
    m.pos.copy(local); jet.localToWorld(m.pos);
    m.vel.copy(dir).multiplyScalar(MISSILE_SPEED);
    m.targetId = (lockAmount > 0.3 && lockId) ? lockId : '';
    m.life = MISSILE_LIFE; m.active = true; m.trailClock = 0;
    m.mesh.visible = true; m.mesh.position.copy(m.pos);
    m.mesh.quaternion.copy(_fcMq.setFromUnitVectors(_projForward, dir));
    spawnHitSparks(m.pos); // launch puff
    if (window.__flightCombatAudio) window.__flightCombatAudio.missile();
  }
  function deactivateMissile(m) { m.active = false; m.mesh.visible = false; m.targetId = ''; }

  // ---- airborne resupply rewards ----
  const RESUPPLY_COUNT = 7;
  const RESUPPLY_RADIUS = 1.05;
  let resupplyGroup = null;
  const resupplies = [];
  const _fcRewardPos = new THREE.Vector3();
  const _fcRewardJetPos = new THREE.Vector3();
  const _fcRewardForward = new THREE.Vector3();
  const _fcRewardRight = new THREE.Vector3();
  const _fcRewardUp = new THREE.Vector3(0, 1, 0);
  function makeResupplyRing(index) {
    const g = new THREE.Group();
    const hue = index % 2 ? 0xffc85a : 0x6ee7ff;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.035, 8, 28),
      new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.9, toneMapped: false })
    );
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.18, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, toneMapped: false })
    );
    ring.rotation.x = Math.PI / 2;
    g.add(ring, core);
    g.userData.ring = ring;
    g.userData.core = core;
    g.raycast = () => {};
    g.visible = false;
    return g;
  }
  function ensureResupplyPool() {
    if (resupplyGroup) return;
    resupplyGroup = new THREE.Group();
    resupplyGroup.name = 'tw_flight_resupply_rewards';
    scene.add(resupplyGroup);
    for (let i = 0; i < RESUPPLY_COUNT; i++) {
      const mesh = makeResupplyRing(i);
      resupplyGroup.add(mesh);
      resupplies.push({ mesh, active: false, collected: 0, seed: i * 19 + 3 });
    }
  }
  function placeResupply(slot, distance, side, lift) {
    if (!jet) return;
    jet.getWorldPosition(_fcRewardJetPos);
    const forward = window.__flightSceneForward
      ? window.__flightSceneForward(_fcRewardForward)
      : _fcRewardForward.set(0, 0, -1);
    _fcRewardRight.copy(forward).cross(_fcRewardUp).normalize();
    if (_fcRewardRight.lengthSq() < 0.001) _fcRewardRight.set(1, 0, 0);
    _fcRewardPos.copy(_fcRewardJetPos)
      .addScaledVector(forward, distance)
      .addScaledVector(_fcRewardRight, side)
      .addScaledVector(_fcRewardUp, lift);
    slot.mesh.position.copy(_fcRewardPos);
    slot.mesh.visible = true;
    slot.active = true;
  }
  function spawnResupplyField() {
    ensureResupplyPool();
    for (let i = 0; i < resupplies.length; i++) {
      placeResupply(resupplies[i], 34 + i * 18, ((i % 3) - 1) * 4.6, 1.1 + ((i * 7) % 5) * 0.48);
    }
  }
  function grantResupply(slot) {
    gunAmmo = Math.min(GUN_AMMO_MAX, gunAmmo + GUN_REWARD_AMMO);
    missilesAmmo = Math.min(MISSILE_COUNT, missilesAmmo + MISSILE_REWARD_COUNT);
    slot.active = false;
    slot.collected = 1.6;
    slot.mesh.visible = false;
    placeResupply(slot, 105 + (slot.seed % 5) * 16, ((slot.seed % 3) - 1) * 6.2, 1.4 + (slot.seed % 4) * 0.55);
    slot.seed += 11;
  }
  function updateResupplies(dt) {
    if (!jet) return;
    jet.getWorldPosition(_fcRewardJetPos);
    for (const slot of resupplies) {
      if (slot.collected > 0) {
        slot.collected = Math.max(0, slot.collected - dt);
        continue;
      }
      if (!slot.active) continue;
      slot.mesh.rotation.y += dt * 1.8;
      if (slot.mesh.userData.ring) slot.mesh.userData.ring.rotation.z += dt * 2.4;
      if (slot.mesh.userData.core) slot.mesh.userData.core.rotation.y -= dt * 2.2;
      if (slot.mesh.position.distanceToSquared(_fcRewardJetPos) <= RESUPPLY_RADIUS * RESUPPLY_RADIUS) {
        grantResupply(slot);
      }
    }
  }

  function updateMissiles(dt) {
    for (const m of missiles) {
      if (!m.active) continue;
      m.life -= dt;
      const tgt = m.targetId ? findTargetById(m.targetId) : null;
      if (tgt) {
        tgt.getWorldPos(_fcMTgtPos);
        _fcMToTarget.copy(_fcMTgtPos).sub(m.pos).normalize();
        _fcMDesired.copy(m.vel).normalize();
        const maxStep = MISSILE_TURN * dt;
        _fcMDesired.lerp(_fcMToTarget, Math.min(1, maxStep)).normalize();
        m.vel.copy(_fcMDesired).multiplyScalar(MISSILE_SPEED);
        if (m.pos.distanceTo(_fcMTgtPos) < (tgt.radius + 0.8)) {
          tgt.applyDamage(MISSILE_DAMAGE, _fcMTgtPos, 'missile');  // applyDamage ignores hitPos; no clone needed
          spawnExplosionFX(_fcMTgtPos);
          deactivateMissile(m); continue;
        }
      }
      // scenery knockdown (throttled per-missile to avoid scanning all cells every frame)
      if ((_fcFrame % 4) === (m.sceneryPhase || 0) &&
          attemptSceneryHit(m.pos, _fcMTrailTmp.copy(m.vel).normalize(), 60, 1.2)) {
        spawnExplosionFX(m.pos);
        deactivateMissile(m); continue;
      }
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.copy(_fcMq.setFromUnitVectors(_projForward, _fcMTrailTmp.copy(m.vel).normalize()));
      m.trailClock -= dt;
      if (m.trailClock <= 0) {
        spawnMissileTrail(m.pos);
        m.trailClock = 0.055;
      }
      if (m.life <= 0) deactivateMissile(m);
    }
  }

  function onEnter(flyingJet) {
    jet = flyingJet || window.__flightJet || null;
    active = true;
    fireCooldown = 0;
    shotsFired = 0;
    ensureTracerPool();
    ensureSparkPool();
    ensureExplosionPool();
    ensureMissilePool();
    ensureResupplyPool();
    for (const m of missiles) deactivateMissile(m);
    missilesAmmo = MISSILE_COUNT; missileCooldown = 0; missileSide = -1; _fcXPrev = false;
    gunAmmo = GUN_AMMO_MAX;
    window.__flightMissilePressed = false;
    window.__flightMissileHeld = false;
    ensureOverlay();
    ensureHudPool();
    reticleState.init = false;
    muzzlesReady = deriveMuzzles();
    lockAmount = 0; lockCandidateId = ''; lockId = '';
    health = MAX_HEALTH;
    cellHealth.clear();
    spawnResupplyField();
  }

  function onExit() {
    active = false;
    jet = null;
    stopLockTone();
    lockAmount = 0; lockCandidateId = ''; lockId = '';
    for (const slot of hudPool) { slot.bracket.style.display = 'none'; slot.card.style.display = 'none'; }
    for (const m of missiles) deactivateMissile(m);
    for (const tr of tracers) { tr.active = false; if (tr.mesh) tr.mesh.visible = false; }
    for (const sp of sparks) { sp.active = false; if (sp.sprite) sp.sprite.visible = false; }
    for (const ex of explosions) { ex.active = false; if (ex.sprite) ex.sprite.visible = false; }
    for (const slot of resupplies) { slot.active = false; slot.collected = 0; if (slot.mesh) slot.mesh.visible = false; }
    window.__flightMissilePressed = false;
    window.__flightMissileHeld = false;
  }

  function tick(dt) {
    if (!active || !(dt > 0)) return;
    _fcFrame++;
    fireCooldown = Math.max(0, fireCooldown - dt);
    if (!muzzlesReady) muzzlesReady = deriveMuzzles();
    collectTargets(dt);
    const keys = window.__flightKeys || {};
    // Per-wing triggers: Comma = left gun, Period = right gun, both held (or
    // Space / left mouse) = both barrels.
    const bothTrigger = !!keys['Space'] || !!window.__flightFireHeld;
    const leftTrigger = !!keys['Comma'];
    const rightTrigger = !!keys['Period'];
    let fireSide = null;
    if (bothTrigger || (leftTrigger && rightTrigger)) fireSide = 'both';
    else if (leftTrigger) fireSide = 'left';
    else if (rightTrigger) fireSide = 'right';
    if (fireSide && fireCooldown <= 0) {
      fireGuns(fireSide);
      fireCooldown = FIRE_COOLDOWN;
    }
    const missilePressed = !!window.__flightMissilePressed;
    const xDown = !!(window.__flightKeys && window.__flightKeys['KeyX']);
    if ((xDown && !_fcXPrev) || missilePressed) fireMissile();
    _fcXPrev = xDown;
    window.__flightMissilePressed = false;
    missileCooldown = Math.max(0, missileCooldown - dt);
    updateMissiles(dt);
    updateResupplies(dt);
    updateTracers(dt);
    updateSparks(dt);
    updateExplosionFX(dt);
    updateReticle(dt);
    updateLock(dt);
    updateTargetHud();
    if (healthEl) healthEl.textContent = 'HULL ' + Math.max(0, Math.round(health)) + '%  GUN ' + gunAmmo + '  MSL ' + missilesAmmo;
  }

  function telemetry() {
    const dir = (active && window.__flightSceneForward)
      ? window.__flightSceneForward(_fireDir).clone() : null;
    return {
      active, hasJet: !!jet, shotsFired, gunHits, health: health,
      fireDir: dir ? { x: dir.x, y: dir.y, z: dir.z } : null,
      muzzleL: jet ? jet.localToWorld(gunMuzzleL.clone()).toArray() : null,
      muzzleR: jet ? jet.localToWorld(gunMuzzleR.clone()).toArray() : null,
      reticle_x: reticleState.x,
      reticle_y: reticleState.y,
      targetCount: targets.length,
      target_lock: lockAmount,
      target_lock_label: (function(){ const tg = targets.find(t => t.id === lockCandidateId); return tg ? tg.label() : ''; })(),
      target_lock_distance: (function(){
        const tg = targets.find(t => t.id === lockCandidateId);
        if (!tg) return null;
        const cp = new THREE.Vector3(); camera.getWorldPosition(cp);
        const tp = new THREE.Vector3(); tg.getWorldPos(tp);
        return +cp.distanceTo(tp).toFixed(1);
      })(),
      missilesAmmo: missilesAmmo,
      gunAmmo: gunAmmo,
      activeMissiles: missiles.filter(m => m.active).length,
      trackedCells: cellHealth.size,
    };
  }

  window.__flightCombat = { onEnter, onExit, tick, telemetry, onIncomingHit };
})();
