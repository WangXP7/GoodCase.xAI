  // -------- grazing animal animation --------
  // Cow/sheep meshes built by makeVoxelAnimal (09b) register here. Each frame the grazer
  // swings their legs, bobs the body, dips the head, folds the front legs to graze, and
  // lets them amble around their home tile or lie down for a short rest — so a meadow of
  // animals feels alive. Movement is purely cosmetic (a small wander around the tile the
  // animal was placed on); the grid/harvest model is untouched.
  //
  // Driven from the main loop in 25-animation-loop-schema.js via window.__tinyworldAnimalTick.
  (function wireAnimalAnimation() {
    'use strict';
    if (typeof window === 'undefined') return;

    const herd = new Set();

    const R = 0.34;       // wander radius in world units — lively, but inside the 1-unit tile
    const SPEED = 0.36;   // amble speed (units/sec)

    function rand(min, max) {
      return min + Math.random() * (max - min);
    }

    function ease(current, target, rate, dt) {
      return current + (target - current) * Math.min(1, rate * dt);
    }

    function setPhase(st, phase) {
      st.phase = phase;
      if (phase === 'graze') st.timer = rand(2.0, 4.8);
      else if (phase === 'lie') st.timer = rand(3.0, 7.0);
      else if (phase === 'idle') st.timer = rand(0.5, 1.5);
      else st.timer = rand(1.2, 2.4);
    }

    function pickWalkTarget(g, st) {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = R * rand(0.35, 1);
        const tx = st.homeX + Math.cos(a) * r;
        const tz = st.homeZ + Math.sin(a) * r;
        if (Math.hypot(tx - g.position.x, tz - g.position.z) > 0.08 || i === 3) {
          st.tx = tx;
          st.tz = tz;
          break;
        }
      }
      st.targetHeading = Math.atan2(st.tx - g.position.x, st.tz - g.position.z);
      setPhase(st, 'walk');
    }

    function register(group) {
      const st = group && group.userData && group.userData.anim;
      if (!st) return;
      st.homeSet = false;            // home captured lazily, after the tile renderer positions it
      st.phase = 'idle';
      st.timer = rand(0.4, 1.6);
      st.walkPhase = Math.random() * Math.PI * 2;
      st.restPhase = Math.random() * Math.PI * 2;
      st.heading = group.rotation.y || 0;
      st.targetHeading = st.heading;
      st.tx = 0; st.tz = 0;
      st.dip = 0;
      st.fold = 0;
      st.lie = 0;
      herd.add(group);
    }

    function tick(t, dt) {
      if (!dt || !herd.size) return;
      const stepDt = Math.min(dt, 0.05);
      for (const g of herd) {
        const st = g && g.userData && g.userData.anim;
        if (!g.parent || !st) { herd.delete(g); continue; }   // mesh removed / re-rendered → drop it
        if (!st.homeSet) {
          st.homeX = g.position.x; st.homeZ = g.position.z;
          st.tx = g.position.x; st.tz = g.position.z;
          st.homeY = g.position.y;
          st.homeSet = true;
        }

        st.timer -= stepDt;
        if (st.phase === 'idle') {
          st.dip = ease(st.dip, 0, 5, stepDt);
          st.fold = ease(st.fold, 0, 5, stepDt);
          st.lie = ease(st.lie, 0, 4, stepDt);
          if (st.timer <= 0) {
            const roll = Math.random();
            if (roll < 0.48) setPhase(st, 'graze');
            else if (roll < 0.86) pickWalkTarget(g, st);
            else setPhase(st, 'lie');
          }
        } else if (st.phase === 'graze') {
          st.dip = ease(st.dip, 1, 4.5, stepDt);             // ease the head down to nibble
          st.fold = ease(st.fold, 1, 5.5, stepDt);           // front knees bend as the head drops
          st.lie = ease(st.lie, 0, 4, stepDt);
          if (st.timer <= 0) {
            if (Math.random() < 0.72) pickWalkTarget(g, st);
            else setPhase(st, 'idle');
          }
        } else if (st.phase === 'lie') {
          st.dip = ease(st.dip, 0.25, 3, stepDt);
          st.fold = ease(st.fold, 0.15, 4, stepDt);
          st.lie = ease(st.lie, 1, 3.5, stepDt);
          if (st.timer <= 0) {
            if (Math.random() < 0.55) pickWalkTarget(g, st);
            else setPhase(st, 'graze');
          }
        } else {                                               // walking
          st.dip = ease(st.dip, 0, 6, stepDt);                 // lift the head back up
          st.fold = ease(st.fold, 0, 7, stepDt);
          st.lie = ease(st.lie, 0, 5, stepDt);
          const dx = st.tx - g.position.x, dz = st.tz - g.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.01) {
            const stepLen = Math.min(dist, SPEED * stepDt);
            g.position.x += (dx / dist) * stepLen;
            g.position.z += (dz / dist) * stepLen;
            st.walkPhase += stepDt * 9.5;
          }
          if (dist <= 0.02 || st.timer <= 0) {                 // arrived / gave up → choose a rest action
            if (Math.random() < 0.72) setPhase(st, 'graze');
            else setPhase(st, 'idle');
          }
        }

        // ease the facing toward the walk direction
        let dh = st.targetHeading - st.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        st.heading += dh * Math.min(1, stepDt * 5);
        g.rotation.y = st.heading;

        // pose the moving parts
        const walking = st.phase === 'walk';
        const swing = walking ? Math.sin(st.walkPhase) * 0.55 : 0;
        const lie = st.lie || 0;
        const grazeFold = st.fold || 0;
        const legs = st.legs || [];
        for (let i = 0; i < legs.length; i++) {
          const entry = legs[i];
          const leg = entry && entry.hip ? entry.hip : entry;
          if (!leg) continue;
          const front = entry && entry.front;
          const diag = (i === 0 || i === 3) ? 1 : -1;          // diagonal gait
          const fold = front ? grazeFold * 0.55 : -grazeFold * 0.12;
          const tucked = front ? -lie * 1.05 : lie * 0.9;
          leg.rotation.x = swing * diag + fold + tucked;
          leg.rotation.z = (front ? -0.18 : 0.14) * lie * (i % 2 ? -1 : 1);
        }
        if (st.body) {
          st.body.position.y = (walking ? Math.abs(Math.sin(st.walkPhase)) * 0.024 : 0) - lie * 0.115 - grazeFold * 0.018;
          st.body.rotation.z = -lie * 0.18;
          st.body.rotation.x = lie * 0.10;
        }
        if (st.head) {
          st.head.rotation.z = -st.dip * 0.82 + lie * 0.18;
          st.head.rotation.x = lie * 0.18 + Math.sin(t * 3 + st.restPhase) * 0.025 * Math.max(st.dip, lie);
        }
      }
    }

    window.__tinyworldRegisterAnimal = register;
    window.__tinyworldAnimalTick = tick;
  })();
