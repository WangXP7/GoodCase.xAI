// The objective line: always the next useful thing. `objective(G)` is pure; `createObjectiveView`
// puts it in the top-centre column and drives the compass tick on the screen edge.
import { px, pz, dist2, nextDoor, anyDoorOpen, doorName, wallTarget } from './hintDefs.js';

const EMPTY = [];
const list = (v) => (Array.isArray(v) ? v : EMPTY);

function bruteAlive(G) {
  const zs = list(G.zombies && G.zombies.list);
  for (let i = 0; i < zs.length; i++) { const z = zs[i]; if (z && z.type === 'brute' && z.alive !== false) return z; }
  return null;
}
function nearestAlive(G) {
  const zs = list(G.zombies && G.zombies.list), p = G.player && G.player.pos;
  let best = null, bd = Infinity;
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (!z || z.alive === false || !z.pos) continue;
    const d = p ? dist2(p, z.pos) : 0;
    if (d < bd) { bd = d; best = z; }
  }
  return best;
}
function noAmmoAnywhere(G) {
  const w = G.weapon;
  if (!w) return false;
  if (Array.isArray(w.slots)) {
    let held = false, empty = true;
    for (let i = 0; i < w.slots.length; i++) { const s = w.slots[i]; if (!s) continue; held = true; if (s.mag > 0 || s.reserve > 0) empty = false; }
    return held && empty;
  }
  return !!(w.ammo && w.ammo.mag === 0 && w.ammo.reserve === 0);
}
// into `buf` when the caller owns one (the view: no allocation per call), else a fresh [x, z]
function aim(p, buf) {
  if (!p) return null;
  const t = buf || [0, 0];
  t[0] = px(p); t[1] = pz(p);
  return t;
}

// objective(G, out?, tbuf?) -> { text, target }. `out` and `tbuf` are reused by the view; a plain call allocates.
export function objective(G, out, tbuf) {
  const o = out || { text: 'Survive', target: null };
  o.text = 'Survive'; o.target = null;
  if (!G) return o;
  const game = G.game || {};
  const d = game.director;
  const n = Math.max(1, game.round || (d && d.n) || 1);
  if (d && d.boss) { const b = bruteAlive(G); if (b) { o.text = 'Bring down the brute'; o.target = aim(b.pos, tbuf); return o; } }
  // the last few, once everything has spawned (round:straggler announces the same moment from the zombie side)
  if (d && d.phase === 'active' && d.total > 0 && d.spawned >= d.total && d.alive > 0 && d.alive <= 2) {
    o.text = d.alive === 1 ? 'Find the last one' : `Find the last ${d.alive}`;
    const z = nearestAlive(G);
    const sg = G.hints && G.hints.straggler;
    o.target = aim(z ? z.pos : sg && sg.pos, tbuf);
    return o;
  }
  if (d && d.phase === 'lull') { o.text = `Round ${n} cleared: restock (${Math.max(0, Math.ceil(d.timer || 0))}s)`; return o; }
  if (noAmmoAnywhere(G)) { const w = wallTarget(G); o.text = 'Out of ammo: buy at the wall'; o.target = aim(w && w.pos, tbuf); return o; }
  const door = nextDoor(G);
  const afford = !!door && Number.isFinite(game.points) && game.points >= door.cost;
  const power = G.level && G.level.power;
  if (afford && !anyDoorOpen(G)) { o.text = `Open the ${doorName(door)} — ${door.cost}`; o.target = aim(door.pos, tbuf); return o; }
  if (anyDoorOpen(G) && power && !power.on) { o.text = 'Find the power switch in the garage'; o.target = aim(power.pos, tbuf); return o; }
  if (afford) { o.text = `Open the ${doorName(door)} — ${door.cost}`; o.target = aim(door.pos, tbuf); return o; }
  if (d && d.total > 0) { o.text = `Survive round ${n} — ${Math.max(0, d.total - d.spawned + (d.alive || 0))} left`; return o; }
  if (d) o.text = `Survive round ${n}`;
  return o;
}

// ---- compass: where the target is relative to where you look -------------------------------------
// -> { show, x: 0..1 across the screen, side: -1 | 0 | 1 (pinned left / free / pinned right), dist }
export function compassFor(player, target, out = { show: false, x: 0.5, side: 0, dist: 0 }) {
  out.show = false;
  if (!player || !player.pos || !target) return out;
  const dx = target[0] - player.pos[0], dz = target[1] - player.pos[2];
  const dist = Math.hypot(dx, dz);
  out.dist = dist;
  if (dist < 5) return out;
  // forward is (-sin yaw, -cos yaw); the signed angle to the target, positive to the right
  const yaw = player.yaw || 0;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rel = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
  const lim = (75 * Math.PI) / 180;
  out.show = true;
  if (Math.abs(rel) <= lim) { out.x = 0.5 + (rel / lim) * 0.46; out.side = 0; } else { out.side = rel > 0 ? 1 : -1; out.x = out.side > 0 ? 0.97 : 0.03; }
  return out;
}

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export function createObjectiveView(G, { sample = null, overlay, addPanel }) {
  const line = h('div', 'gs-obj');
  const mark = h('i', 'mark');
  const txt = h('span', 't');
  line.append(mark, txt);
  const remove = addPanel('objective', line, { corner: 'tc', order: 0 });
  const tick = h('div', 'gs-compass');
  const arrow = h('i', 'a');
  const dist = h('span', 'd');
  tick.append(arrow, dist);
  overlay.appendChild(tick);

  let acc = 1, last = null, lastTarget = null;
  const own = { text: '', target: null }, tbuf = [0, 0];
  let cur = own;
  let vw = window.innerWidth;
  window.addEventListener('resize', () => { vw = window.innerWidth; lastX = null; });
  const c = { show: false, x: 0.5, side: 0, dist: 0 };
  let lastX = null, lastShow = null, lastSide = null, lastDist = null;

  function paintCompass(target) {
    compassFor(G.player, target, c);
    if (c.show !== lastShow) { lastShow = c.show; tick.classList.toggle('on', c.show); }
    if (!c.show) return;
    const x = Math.round(c.x * vw);
    if (x !== lastX) { lastX = x; tick.style.transform = `translateX(${x}px)`; }
    if (c.side !== lastSide) { lastSide = c.side; tick.dataset.side = String(c.side); }
    const dm = Math.round(c.dist);
    if (dm !== lastDist) { lastDist = dm; dist.textContent = `${dm} m`; }
  }

  return {
    get current() { return cur; },
    // hintTarget: the active hint's compass target wins while it is up
    update(dt, hintTarget) {
      acc += dt;
      if (acc >= 0.25 || sample) {
        acc = 0;
        cur = sample || objective(G, own, tbuf);
        if (cur.text !== last) { last = cur.text; txt.textContent = cur.text; }
        lastTarget = cur.target;
      }
      paintCompass(hintTarget || lastTarget);
    },
    remove() { remove(); tick.remove(); },
  };
}
