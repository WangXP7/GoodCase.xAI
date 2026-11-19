// The zombie side of blood and gore: how a body dies by what killed it, wounds where it was shot, a
// head that bursts, limbs that leave, stumps that keep bleeding, a pool that grows under the corpse
// and the smear a crawler drags. The particles and decals themselves are the fx module's (src/fx);
// what to ask it for is decided by the pure planners in src/fx/blood.js.
//
// Nothing in the boot order knows this module, so the animator installs it the first time one is
// made (ensureGore): it finds G on the harness global, as body.js does. createLevel may instead call
// createGore(G) from main.js after the zombies and the ui exist; both are safe together.
//
// Every effect reads G.fx.gore (1 full, 0.3 reduced) at the moment it fires.
import { tuning } from '../game/tuning.js';
import { createBlood } from '../fx/blood.js';

const RECENT = 12;

export function goreLevel(G) {
  const g = G && G.fx ? G.fx.gore : undefined;
  if (typeof g === 'number') return g;
  const s = G && G.ui && G.ui.settings ? G.ui.settings.gore : undefined;
  return s === 'reduced' ? 0.3 : 1;
}

// How a killed zombie goes down, from the hit report. Returns '' to leave what the animator chose
// (a crumple, a tumble at a run, the crawler's and the brute's own).
// e: hit:zombie payload; near: metres from the shooter; cls: the weapon's class.
export function deathStyle(e, near, cls) {
  if (!e || !e.killed) return '';
  if (e.source === 'explosion') return 'blast';
  if (cls === 'shotgun' && near <= 5) return 'spin';
  if (e.headshot || e.part === 'head') return 'head';
  return '';
}

export function createGore(G) {
  if (G.gore) return G.gore;
  const on = (name, fn) => { if (G.events && typeof G.events.on === 'function') G.events.on(name, fn); };
  // the last few to die: the hit report for a kill arrives after the manager has let the body go
  const deadId = new Int32Array(RECENT).fill(-1), deadZ = new Array(RECENT).fill(null);
  let deadAt = 0;
  const bodyOf = (id) => {
    for (let k = 0; k < RECENT; k++) if (deadId[k] === id) return deadZ[k];
    return G.zombies && typeof G.zombies.bodyOf === 'function' ? G.zombies.bodyOf(id) : null;
  };
  const playerDist = (pos) => {
    const p = G.player && G.player.pos ? G.player.pos : G.camera ? G.camera.position : null;
    if (!p || !pos) return 99;
    const px = p.x ?? p[0], pz = p.z ?? p[2], x = pos.x ?? pos[0], z = pos.z ?? pos[2];
    return Math.hypot(px - x, pz - z);
  };
  const clsOf = (weapon) => { const t = tuning.weapons && tuning.weapons.table && tuning.weapons.table[weapon]; return t ? t.cls : ''; };

  on('zombie:die', (e) => {
    if (!e) return;
    const z = G.zombies && typeof G.zombies.bodyOf === 'function' ? G.zombies.bodyOf(e.id) : null;
    deadId[deadAt] = e.id; deadZ[deadAt] = z; deadAt = (deadAt + 1) % RECENT;
    // a bloater shot dead while it swells: the manager leaves a body in 'burst' alone, so it falls here
    if (z && z.anim && z.anim.state === 'burst') z.anim.collapse(null, 1, 'burst');
    for (const h of api.hooks.die) h(e, z);
  });
  on('hit:zombie', (e) => {
    if (!e) return;
    const z = bodyOf(e.id);
    if (e.killed && z && z.anim && typeof z.anim.restyle === 'function') {
      const style = deathStyle(e, playerDist(e.pos), clsOf(e.weapon));
      if (style) z.anim.restyle(style, e.dir, Math.min(1.5, Math.max(0.6, (e.damage || 40) / 60)));
    }
    for (const h of api.hooks.hit) h(e, z);
  });
  on('zombie:sever', (e) => { if (e) for (const h of api.hooks.sever) h(e, bodyOf(e.id)); });
  on('zombie:burst', (e) => { if (e) for (const h of api.hooks.burst) h(e, bodyOf(e.id)); });

  const api = {
    // listeners added by the blood module (src/fx/blood.js): (event, zombie | null)
    hooks: { hit: [], die: [], sever: [], burst: [], frame: [], settle: [], drag: [] },
    bodyOf,
    level: () => goreLevel(G),
    // called by every animator each frame it updates (near level of detail), and once when a corpse comes to rest
    frame(zombie, anim, dt) { for (const h of api.hooks.frame) h(zombie, anim, dt); },
    settle(zombie, anim) { for (const h of api.hooks.settle) h(zombie, anim); },
    // a crawler has dragged itself another stretch: (zombie, x, y, z, yaw)
    drag(zombie, x, y, z, yaw) { for (const h of api.hooks.drag) h(zombie, x, y, z, yaw); },
  };
  api.playerDist = playerDist;
  // zombie -> id, for what the animator reports (it knows its body, not its id)
  const idOf = new WeakMap();
  on('zombie:spawn', (e) => { const z = e && G.zombies && typeof G.zombies.bodyOf === 'function' ? G.zombies.bodyOf(e.id) : null; if (z) idOf.set(z, e.id); });
  // A footfall. One payload object is reused for every step (24 zombies make about 50 a second):
  // listeners must not keep it. heavy: the brute, whose steps shake the camera inside 6 m.
  const stepEv = { id: -1, pos: { x: 0, y: 0, z: 0 }, kind: 'walk', heavy: false, foot: 0 };
  api.step = (zombie, x, y, z, kind, footIndex) => {
    stepEv.id = idOf.get(zombie) ?? -1; stepEv.pos.x = x; stepEv.pos.y = y; stepEv.pos.z = z; stepEv.kind = kind; stepEv.foot = footIndex;
    stepEv.heavy = zombie.build === 'brute';
    if (stepEv.heavy) shake(stepEv.pos, 6, 0.22);
    if (G.events) G.events.emit('zombie:step', stepEv);
  };
  // the camera shakes with what lands near it: amount at no distance, falling to nothing at `reach` m
  function shake(pos, reach, amount) {
    const d = playerDist(pos);
    if (d < reach && G.player && typeof G.player.addShake === 'function') G.player.addShake(amount * (1 - d / reach));
  }
  api.shake = shake;
  // the brute's fists reach the ground one wind-up after the slam starts (the animator reports it)
  const slamEv = { id: -1, pos: { x: 0, y: 0, z: 0 } };
  api.slam = (zombie, x, y, z) => {
    slamEv.id = idOf.get(zombie) ?? -1; slamEv.pos.x = x; slamEv.pos.y = y; slamEv.pos.z = z;
    shake(slamEv.pos, 9, 0.7);
    if (G.fx && typeof G.fx.puff === 'function') { try { G.fx.puff(slamEv.pos, 1.2); } catch { /* the fx module's call may differ */ } }
    if (G.events) G.events.emit('zombie:slam', slamEv);
  };
  // a dead brute hitting the ground
  api.thud = (zombie, x, y, z) => { slamEv.pos.x = x; slamEv.pos.y = y; slamEv.pos.z = z; shake(slamEv.pos, 8, 0.45); };
  G.gore = api;
  api.blood = createBlood(G, api);
  return api;
}

// The animator's way in. Returns the gore module once the game context exists, else null.
let cached = null;
export function ensureGore() {
  if (cached) return cached;
  const G = typeof globalThis !== 'undefined' ? globalThis.__G : null;
  if (!G || !G.events) return null;
  cached = createGore(G);
  return cached;
}
// tests build more than one context
export function forgetGore() { cached = null; }
