// Fixed update order (Contracts -> Loop order), then post.render().
export const LOOP_ORDER = ['input', 'game', 'player', 'weapon', 'zombies', 'level', 'fx', 'audio', 'lights', 'sky', 'ui', 'hints'];
// The simulation. These get dt = 0 while the game is not running (title, paused), so a pause is
// one decision made here rather than eight made by each module. Everything else (lights, sky,
// audio, ui, the render) always gets the frame's dt: rain keeps falling behind the pause menu.
export const GAMEPLAY = new Set(['game', 'player', 'weapon', 'zombies', 'level', 'fx']);
const MAX_DT = 0.05;

// Does the simulation advance this frame? 'dead' keeps running so the death slump, falling bodies
// and effects in flight finish behind the death screen (nothing can act: the modules gate on
// 'playing' for input, attacks and spawns). With no real game (stub) only the input's own pause counts.
export function simRunning(G) {
  const g = G.game;
  if (!g || g.stub) return !(G.input && G.input.paused);
  return g.state === 'playing' || g.state === 'dead';
}

export function createLoop(G, { onError }) {
  const times = [];
  let fps = 0;
  let frameMs = 0;

  const resolveDt = (rawDt) => (G.params.dt !== undefined ? G.params.dt : Math.min(rawDt, MAX_DT));

  function updateAll(dt) {
    const T = G.time;
    T.t += dt; T.dt = dt; T.frame++;
    // T.t is the frame clock (never stops: flicker, rain, sky). T.sim is the simulation clock: it
    // stops with the game, so gameplay timers (attack cooldowns, the stuck guard) do not jump on resume.
    let simDt = simRunning(G) ? dt : 0;
    for (const name of LOOP_ORDER) {
      const m = G[name];
      if (name === 'player') {
        // game.update has run: a start, pause or death this frame takes effect for the rest of it
        simDt = simRunning(G) ? dt : 0;
        T.simDt = simDt; T.sim = (T.sim || 0) + simDt;
      }
      if (!m || typeof m.update !== 'function') continue;
      // second argument: the frame's real dt, for the parts of a gameplay module that are only
      // picture (fx ticks the rain with it)
      try { m.update(GAMEPLAY.has(name) ? simDt : dt, dt); } catch (e) { onError(`[loop] ${name}.update: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
    }
  }

  function render() {
    if (G.shotCam) applyShotCam(G, G.shotCam);
    try { G.post.render(); } catch (e) { onError(`[loop] post.render: ${e && e.message}`); }
  }

  return {
    // A frame in two halves, for the boot: the simulation step, then (after the shaders are warm) its picture.
    update(rawDt) {
      G.time.real = performance.now() / 1000;
      updateAll(resolveDt(rawDt));
    },
    render,
    // One full frame: update + render. rawDt in seconds.
    frame(rawDt) {
      const t0 = performance.now();
      G.time.real = t0 / 1000;
      updateAll(resolveDt(rawDt));
      render();
      frameMs = performance.now() - t0;
      times.push(t0); if (times.length > 60) times.shift();
      if (times.length > 1) fps = ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]);
    },
    // Simulate without rendering (adv=<seconds>).
    // Step is params.dt when set, else 1/60; total simulated time is `seconds` within one step.
    advance(seconds, step = 1 / 60) {
      const dt = G.params.dt !== undefined ? G.params.dt : step;
      const n = dt > 0 ? Math.ceil(seconds / dt - 1e-9) : 0;
      for (let i = 0; i < n; i++) updateAll(dt);
    },
    stats: () => ({ fps, frameMs }),
  };
}

export function applyShotCam(G, { cam, fov }) {
  const c = G.camera;
  if (!c) return;
  if (cam) {
    c.position.set(cam[0], cam[1], cam[2]);
    c.rotation.order = 'YXZ';
    c.rotation.set(cam[4], cam[3], 0);
  }
  if (fov && c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); }
}
