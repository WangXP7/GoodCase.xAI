  // -------- flight target practice: AI stunt-plane drones --------
  // A handful of differently-tinted stunt planes that actually FLY around the
  // player's flight area and can be locked, shot, and destroyed for endless
  // target practice. They reuse the player's GLB + texture via the tinted-plane
  // builder in 34-flight-sim.js (window.__flightBuildTintedPlane), so each drone
  // is the same model in a different colour.
  //
  // Motion is a lightweight kinematic AI (NOT the full flight physics): each
  // plane cruises forward and steers toward a slowly-roaming waypoint, banking
  // (rolling) into its turns and gently bobbing altitude. It flies a bit slower
  // than the player so it stays catchable. The model's nose is +Z (see
  // 34-flight-sim.js line ~25), so orientation is built as a basis with local +Z
  // aligned to the velocity and roll applied about that forward axis.
  //
  // Combat integration: the live drones are exposed as window.__flightTargetPlanes
  // (an array of target adapters matching 41-flight-combat.js's target interface:
  // { id, kind, getWorldPos, radius, isAlive, label, speedKts, applyDamage }).
  // 41 appends them to its per-frame target list. The explosion BURST on a kill
  // is owned by 41's integration (spawnExplosionFX is private to 41's IIFE and
  // not reachable here): gun kills fire it via the !isAlive() check in
  // attemptInstantHit, missile kills via the existing missile-detonation path.
  // This module therefore only handles hp/hide/respawn on death — it does NOT
  // play its own FX, to avoid doubling the burst.
  //
  // Lifecycle: 34-flight-sim.js calls window.__flightTargetPlanesStart() when a
  // flight begins and window.__flightTargetPlanesStop() on exit; stop disposes
  // every mesh + cloned material, stops the rAF, and empties the targets array
  // so nothing leaks after Esc. Self-driven rAF, plus an exposed tick() for
  // deterministic pumping (a backgrounded tab throttles rAF). IIFE — no top-level
  // identifiers leak into the shared engine scope.
  (function targetPlanesBoot() {
    'use strict';
    if (typeof window === 'undefined' || typeof THREE === 'undefined') return;
    if (window.__flightTargetPlanes) return;   // guard against double-install

    // Distinct tints (red / blue / green / amber). Count = number of drones.
    const TINTS = [0xff5a4a, 0x4a7dff, 0x4ad07a, 0xffb648];
    const PLANE_HP = 30;
    const RADIUS = 1.6;                 // combat hit radius (~player jet)
    const RESPAWN_MIN = 4.0, RESPAWN_MAX = 6.0;
    const CRUISE = 5.2;                 // scene units/sec forward (< player cruise)
    const TURN_RATE = 0.7;             // rad/sec max heading change
    const MAX_BANK = 0.85;             // rad, roll at full turn rate
    const WP_REACH = 6;                // switch waypoint within this distance
    const WP_MIN_R = 14, WP_RANGE = 20;  // waypoint ring radius around plane centre
    const SPAWN_MIN_R = 24, SPAWN_RANGE = 16;  // per-plane centre offset from origin
    // Mirror of FLIGHT_SIM_TO_SCENE (34) purely to report a plausible knots
    // figure on the HUD; motion itself is defined directly in scene units.
    const SIM_TO_SCENE = 0.09;

    const planes = [];                 // internal plane records
    const targetAdapters = [];         // stable array exposed to 41 (never reassigned)
    window.__flightTargetPlanes = targetAdapters;

    let running = false;
    let raf = null;
    let last = 0;
    let spawned = false;

    // ---- scratch (allocation-free per frame) ----
    const _toWp = new THREE.Vector3();
    const _fwd = new THREE.Vector3();
    const _R = new THREE.Vector3();
    const _U = new THREE.Vector3();
    const _F = new THREE.Vector3();
    const _up = new THREE.Vector3(0, 1, 0);
    const _basis = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _rollQ = new THREE.Quaternion();
    const _zAxis = new THREE.Vector3(0, 0, 1);
    const _origin = new THREE.Vector3();

    function nowMs() {
      return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }

    // The player jet parents into xrWorldRoot and combat works in that frame
    // (jet.localToWorld muzzles, ghost.getWorldPosition), so drones share it too.
    function parentNode() {
      if (typeof xrWorldRoot !== 'undefined' && xrWorldRoot) return xrWorldRoot;
      return (typeof scene !== 'undefined') ? scene : null;
    }

    // Centre of the flight area: the flight origin (34) if present, else the live
    // jet position, else a plain default. Read fresh on spawn/respawn.
    function flightOrigin(out) {
      if (typeof flightSceneOrigin !== 'undefined' && flightSceneOrigin) return out.copy(flightSceneOrigin);
      if (window.__flightJet && typeof window.__flightJet.getWorldPosition === 'function') {
        return window.__flightJet.getWorldPosition(out);
      }
      return out.set(0, 6, 0);
    }

    function pickWaypoint(p) {
      const a = Math.random() * Math.PI * 2;
      const r = WP_MIN_R + Math.random() * WP_RANGE;
      p.waypoint.set(
        p.center.x + Math.cos(a) * r,
        p.center.y + (Math.random() - 0.5) * 6,
        p.center.z + Math.sin(a) * r
      );
    }

    // Position a plane at a fresh spot around the current flight origin and reset
    // its health/heading. Reused for the initial spawn and every respawn so the
    // mesh + adapter object stay alive across deaths (endless practice).
    function resetPlane(p) {
      flightOrigin(_origin);
      const a = (p.index / TINTS.length) * Math.PI * 2 + Math.random() * 0.6;
      const r = SPAWN_MIN_R + Math.random() * SPAWN_RANGE;
      p.center.set(
        _origin.x + Math.cos(a) * r,
        _origin.y + 2 + Math.random() * 6,
        _origin.z + Math.sin(a) * r
      );
      p.pos.copy(p.center);
      // initial heading tangent to the ring so it starts circling, not diving in
      p.vel.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(CRUISE);
      p.hp = PLANE_HP;
      p.dead = false;
      p.bank = 0;
      p.phase = Math.random() * Math.PI * 2;
      pickWaypoint(p);
      if (p.group) {
        p.group.position.copy(p.pos);
        p.group.visible = true;
        p.group.updateMatrixWorld();
      }
    }

    function killPlane(p) {
      p.dead = true;
      p.respawnTimer = RESPAWN_MIN + Math.random() * (RESPAWN_MAX - RESPAWN_MIN);
      if (p.group) p.group.visible = false;
      // No FX here: the kill burst is produced by 41's combat integration (gun
      // kills via attemptInstantHit's !isAlive() check, missile kills via the
      // missile detonation) so the explosion isn't doubled.
    }

    function makeAdapter(p) {
      return {
        id: p.id,
        kind: 'drone',
        _pos: p.pos,   // live ref; 41's HUD reads _pos.y for the ALT readout
        getWorldPos(out) {
          const v = out || new THREE.Vector3();
          // matrixWorld is refreshed each frame in updatePlane / on spawn, so a
          // cheap read here stays valid even if xrWorldRoot isn't identity.
          return v.setFromMatrixPosition(p.group.matrixWorld);
        },
        radius: RADIUS,
        isAlive() { return p.hp > 0 && !p.dead; },
        label() { return 'DRONE'; },
        speedKts() { return p.speed / SIM_TO_SCENE * 1.94; },
        applyDamage(amount, hitPos, source) {
          if (p.dead) return;
          p.hp -= (amount || 0);
          if (p.hp <= 0) { p.hp = 0; killPlane(p); }
        },
      };
    }

    function makePlane(index, group) {
      const p = {
        id: 'dummy:' + index,
        index,
        group,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        center: new THREE.Vector3(),
        waypoint: new THREE.Vector3(),
        hp: PLANE_HP,
        speed: 0,
        bank: 0,
        phase: 0,
        bobAmp: 1.4 + Math.random() * 1.2,
        bobFreq: 0.4 + Math.random() * 0.3,
        dead: false,
        respawnTimer: 0,
        adapter: null,
      };
      resetPlane(p);
      p.adapter = makeAdapter(p);
      return p;
    }

    // Lazily build the drones once the shared GLB has loaded. For a placed
    // model-stamp plane the spawn assets may not be loaded yet, so the builder
    // returns null and we simply retry on the next tick until it succeeds.
    function trySpawn() {
      if (spawned) return;
      const builder = window.__flightBuildTintedPlane;
      if (typeof builder !== 'function') return;
      const par = parentNode();
      if (!par) return;
      const probe = builder(TINTS[0]);
      if (!probe) return;   // assets still loading; retry next tick
      for (let i = 0; i < TINTS.length; i++) {
        const group = i === 0 ? probe : builder(TINTS[i]);
        if (!group) continue;
        par.add(group);
        const p = makePlane(i, group);
        p.group.position.copy(p.pos);
        p.group.updateMatrixWorld();   // valid getWorldPos before the first rAF tick
        planes.push(p);
        targetAdapters.push(p.adapter);
      }
      spawned = true;
    }

    function updatePlane(p, dt) {
      if (p.dead) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) resetPlane(p);
        return;
      }

      // ---- steer toward the waypoint (horizontal plane) ----
      _toWp.copy(p.waypoint).sub(p.pos); _toWp.y = 0;
      let d = _toWp.length();
      if (d < WP_REACH) {
        pickWaypoint(p);
        _toWp.copy(p.waypoint).sub(p.pos); _toWp.y = 0;
        d = _toWp.length();
      }
      if (d > 1e-4) _toWp.multiplyScalar(1 / d); else _toWp.set(0, 0, 1);

      _fwd.copy(p.vel); _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.copy(_toWp); else _fwd.normalize();

      // signed turn: y of (fwd x toWp) in the XZ plane tells left/right
      const cross = _fwd.x * _toWp.z - _fwd.z * _toWp.x;
      const cosang = Math.max(-1, Math.min(1, _fwd.dot(_toWp)));
      const ang = Math.acos(cosang);
      const maxStep = TURN_RATE * dt;
      const step = ang > 1e-5 ? Math.min(1, maxStep / ang) : 1;
      _fwd.lerp(_toWp, step); _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.copy(_toWp); else _fwd.normalize();

      // ---- altitude bob + gentle seek toward waypoint height ----
      p.phase += dt * p.bobFreq * Math.PI * 2;
      const targetY = p.center.y + Math.sin(p.phase) * p.bobAmp
        + (p.waypoint.y - p.center.y) * 0.35;
      const climb = (targetY - p.pos.y) * 0.9;

      // ---- compose velocity + integrate ----
      p.vel.x = _fwd.x * CRUISE;
      p.vel.z = _fwd.z * CRUISE;
      p.vel.y = Math.max(-CRUISE * 0.5, Math.min(CRUISE * 0.5, climb));
      p.pos.addScaledVector(p.vel, dt);
      p.speed = p.vel.length();

      // ---- bank proportional to the turn rate actually applied ----
      const appliedRate = (ang > 1e-5 ? Math.min(ang, maxStep) : 0) / Math.max(dt, 1e-4);
      const bankTarget = -Math.sign(cross) * Math.min(1, appliedRate / TURN_RATE) * MAX_BANK;
      p.bank += (bankTarget - p.bank) * (1 - Math.exp(-4 * dt));

      // ---- orient: nose (+Z) along velocity, then roll about forward ----
      _F.copy(p.vel);
      if (_F.lengthSq() < 1e-6) _F.set(0, 0, 1); else _F.normalize();
      _R.copy(_up).cross(_F);
      if (_R.lengthSq() < 1e-6) _R.set(1, 0, 0); else _R.normalize();
      _U.copy(_F).cross(_R).normalize();
      _basis.makeBasis(_R, _U, _F);
      _q.setFromRotationMatrix(_basis);
      _q.multiply(_rollQ.setFromAxisAngle(_zAxis, p.bank));

      p.group.position.copy(p.pos);
      p.group.quaternion.copy(_q);
      p.group.updateMatrixWorld();
    }

    function tick(now) {
      const t = (typeof now === 'number') ? now : nowMs();
      if (!last) last = t;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (!spawned) trySpawn();
      if (dt <= 0) return;
      for (let i = 0; i < planes.length; i++) updatePlane(planes[i], dt);
    }

    function startLoop() {
      if (raf) return;
      const loop = (now) => {
        if (!running) { raf = null; return; }
        tick(now);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    function disposeAll() {
      for (const p of planes) {
        const g = p.group;
        if (!g) continue;
        if (g.parent) g.parent.remove(g);
        // Dispose only the cloned tint materials — geometry is shared with the
        // GLB master (userData.cached) and must never be freed here.
        g.traverse(o => {
          if (o.isMesh && o.material) {
            if (Array.isArray(o.material)) o.material.forEach(m => m && m.dispose && m.dispose());
            else if (o.material.dispose) o.material.dispose();
          }
        });
      }
      planes.length = 0;
      targetAdapters.length = 0;
      spawned = false;
      last = 0;
    }

    function start() {
      if (running) return;
      running = true;
      spawned = false;
      last = 0;
      startLoop();
    }

    function stop() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      disposeAll();
    }

    window.__flightTargetPlanesStart = start;
    window.__flightTargetPlanesStop = stop;
    // Expose the array plus tick() for deterministic pumping in verification.
    window.__flightTargetPlanesTick = tick;
  })();
