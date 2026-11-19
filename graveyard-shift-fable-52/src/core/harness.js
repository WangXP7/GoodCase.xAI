// Test/debug surface: window.__ready, __errors, __stats, __passStats, __touch, __step, __G, __setShot.
import { applyShotCam } from './loop.js';

const MAX_ERRORS = 200;

// Install first thing in main.js so boot failures are captured.
export function installErrorCapture() {
  const errors = (window.__errors = []);
  const push = (s) => { if (errors.length < MAX_ERRORS) errors.push(String(s)); };
  window.addEventListener('error', (e) => push(`[error] ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => push(`[unhandledrejection] ${e.reason && e.reason.stack ? e.reason.stack : e.reason}`));
  const origError = console.error;
  console.error = (...args) => { push(`[console.error] ${args.map(String).join(' ')}`); origError.apply(console, args); };
  window.__ready = false;
  return push;
}

// What __stats() reports. Fields owned by later modules read as null/false/0 until those exist.
export function readStats(G, { fps, frameMs }) {
  const info = (G.renderer && G.renderer.info && G.renderer.info.render) || {};
  const alive = G.zombies ? (Array.isArray(G.zombies.alive) ? G.zombies.alive.length : G.zombies.alive) : 0;
  const q = G.quality || {};
  const pw = G.level && G.level.power;
  return {
    fps: Math.round(fps * 10) / 10,
    frameMs: Math.round(frameMs * 100) / 100,
    drawCalls: info.calls || 0,
    triangles: info.triangles || 0,
    state: (G.game && G.game.state) || 'title',
    round: (G.game && G.game.round) || 0,
    alive: alive || 0,
    points: (G.game && G.game.points) || 0,
    tier: q.tier || q.name || null,
    renderScale: q.renderScale ?? 1,
    inputMode: (G.input && G.input.mode) || null,
    zone: (G.level && G.level.zone) || null,
    weapon: (G.weapon && (G.weapon.id || G.weapon.name)) || null,
    power: !!(pw && (typeof pw === 'object' ? pw.on : pw)),
    plates: (G.player && G.player.plates) || 0,
  };
}

// Per-pass draw counts. post.render() resets renderer.info once and every pass adds to it, so the
// counters are read at each boundary (render start, each pass's start and end, render end) and the
// difference goes to whoever was running. Reads and a wrapper per pass: nothing is drawn differently.
export function createPassStats(G) {
  const post = G.post;
  const rows = new Map(); // name -> { pass, calls, triangles }, reused every frame
  const list = []; // the same rows, for an index loop (no iterator per frame)
  const SCENE = 'scene';
  const row = (name) => {
    let r = rows.get(name);
    if (!r) { r = { pass: name, calls: 0, triangles: 0 }; rows.set(name, r); list.push(r); }
    return r;
  };
  if (!post || post.stub || typeof post.render !== 'function' || typeof post.eachPass !== 'function') return { read: () => [] };
  const info = () => (G.renderer && G.renderer.info && G.renderer.info.render) || null;
  let cur = SCENE;
  let markCalls = 0;
  let markTris = 0;
  const flush = () => {
    const i = info();
    if (!i) return;
    const r = row(cur);
    r.calls += i.calls - markCalls; r.triangles += i.triangles - markTris;
    markCalls = i.calls; markTris = i.triangles;
  };
  const wrap = (p) => {
    if (p.__passStats) return;
    p.__passStats = true;
    const orig = p.render;
    if (typeof orig !== 'function') return;
    p.render = function wrapped(arg) { // a pass's render takes one argument (the post chain); no rest array per frame
      flush();
      cur = p.name;
      try { return orig.call(this, arg); } finally { flush(); cur = SCENE; }
    };
  };
  // Nothing is wrapped until the first read(): normal play carries no instrumentation. The first
  // read installs the wrappers and draws one frame so it has something to report.
  let installed = false;
  const install = () => {
    installed = true;
    const origRender = post.render;
    post.render = function render() {
      for (let i = 0; i < list.length; i++) { list[i].calls = 0; list[i].triangles = 0; }
      post.eachPass(wrap); // passes added after the install (the rain, the particles) are picked up here
      cur = SCENE; markCalls = 0; markTris = 0;
      try { return origRender.call(this); } finally { flush(); }
    };
    post.render();
  };
  return {
    read() {
      if (!installed) install();
      return list.filter((r) => r.calls || r.triangles).map((r) => ({ ...r }));
    },
  };
}

export function installHarness(G, loop) {
  window.__G = G;
  window.__step = 0;
  window.__stats = () => readStats(G, loop.stats());
  // Draw calls and triangles of the last frame by named pass ('scene' is everything that is not a
  // pass: the scene render and the chain's own combine and guard blits).
  const passStats = createPassStats(G);
  window.__passStats = () => passStats.read();
  // The on-screen touch controls in CSS px: {sticks:[{x,y,r}], look:{x,y,w,h}|null, buttons:[{name,x,y,r,...}]}.
  Object.defineProperty(window, '__touch', {
    configurable: true,
    get: () => {
      // G.input.touch.layout: the last argument given to setLayout({stick, look, buttons})
      const l = G.input && G.input.touch && G.input.touch.layout;
      return { sticks: l && l.stick ? [l.stick] : [], look: (l && l.look) || null, buttons: (l && l.buttons) || [] };
    },
  });
  // Cost of a frame without the display's refresh in the way: n frames back to back, each followed
  // by gl.finish() so the GPU's work is inside the time. Returns mean and worst ms per frame.
  // `each(i)` runs before every frame (move the camera). For A/B measurements; blocks the page.
  window.__bench = (n = 120, each = null, dt = 1 / 60) => {
    const gl = G.renderer && G.renderer.getContext ? G.renderer.getContext() : null;
    let worst = 0;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      if (each) each(i);
      loop.frame(dt);
      if (gl) gl.finish();
      worst = Math.max(worst, performance.now() - a);
    }
    const ms = (performance.now() - t0) / n;
    return { ms: Math.round(ms * 100) / 100, worstMs: Math.round(worst * 100) / 100, fps: Math.round(10000 / ms) / 10 };
  };
  // Stage a camera: { cam:[x,y,z,yaw,pitch], fov }. Applied every frame just before render.
  window.__setShot = (obj) => {
    G.shotCam = { ...(G.shotCam || {}), ...obj };
    applyShotCam(G, G.shotCam);
  };
}

// Resolve ?shot= / ?cam= / ?fov= into G.shotCam once the level exists.
export function stageShotFromParams(G) {
  const p = G.params;
  const named = p.shot && G.level && G.level.shots && G.level.shots[p.shot];
  if (named) window.__setShot({ cam: named.cam, fov: named.fov, ...(named.fire ? { fire: named.fire } : {}) });
  if (p.cam || p.fov) window.__setShot({ ...(p.cam ? { cam: p.cam } : {}), ...(p.fov ? { fov: p.fov } : {}) });
}
