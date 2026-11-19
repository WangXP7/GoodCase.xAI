// The onboarding hint table. Pure data and predicates: no DOM, no three.js.
//
// A hint is { id, on, when, text:{key, touch}, until?, seconds, priority, target? }.
//   on        the events that make `when` worth asking, or 'tick' (asked four times a second)
//   when      (G, ev, ctx) -> bool: should this hint be offered now
//   text      one line; a string or (G) -> string. [F] draws a key cap, so the keyboard copy says "Hold [F]" and
//             the touch copy names the button: "Hold [SEARCH]". `touch` falls back to `key`.
//   until     (G, a, ctx) -> bool: the player did the thing, take it down. `a` is the live record: a.at is the
//             counters when it appeared (so a.ctx... is "since then"), a.x/a.z/a.yaw where the player stood
//   seconds   how long it stays at most (default 6); priority: higher first when two want the screen
//   target    (G) -> [x, z] | null: where to point the compass while it is up
//
// ids are binding; another module adds one by pushing onto HINTS.
import { tuning } from '../game/tuning.js';
import { crateCostOf } from '../game/purchases.js';

const P = tuning.points || { hit: 10, kill: 60, headshotKill: 100 };
const BENCH_COST = (tuning.economy && tuning.economy.bench && tuning.economy.bench.cost) || 4000;
const BOX_COST = (tuning.economy && tuning.economy.box && tuning.economy.box.cost) || 950;

// ---- tiny readers (nothing here allocates on the hot path) --------------------------------------
export const px = (p) => (p ? (Array.isArray(p) ? p[0] : p.x) : undefined);
export const pz = (p) => (p ? (Array.isArray(p) ? p[2] : p.z) : undefined);
export function dist2(a, b) {
  const dx = px(a) - px(b), dz = pz(a) - pz(b);
  return dx * dx + dz * dz;
}
const playerPos = (G) => (G.player && G.player.pos) || null;
const EMPTY = [];
const list = (v) => (Array.isArray(v) ? v : EMPTY);
const live = (it) => !!it && (typeof it.enabled !== 'function' || it.enabled());
export const interactables = (G) => list(G.level && G.level.interactables);
const powerOn = (G) => !!(G.level && G.level.power && G.level.power.on);

// Nearest enabled interactable of a kind within `r` metres (XZ), or null.
export function nearestOf(G, kind, r) {
  const p = playerPos(G);
  if (!p) return null;
  const its = interactables(G);
  let best = null, bd = r * r;
  for (let i = 0; i < its.length; i++) {
    const it = its[i];
    if (!it || it.kind !== kind || !live(it) || !it.pos) continue;
    const d = dist2(p, it.pos);
    if (d <= bd) { bd = d; best = it; }
  }
  return best;
}
const near = (G, kind, r) => nearestOf(G, kind, r) !== null;
const pointOf = (it) => (it && it.pos ? [px(it.pos), pz(it.pos)] : null);
const focusIs = (G, a, b) => { const f = G.game && G.game.focus; return !!f && (f.kind === a || f.kind === b); };

// The wall to send the player to: the nearest affordable wall that sells for a gun they hold, else the nearest such
// wall, else the nearest affordable wall of any kind. (A wall is an interactable of kind wallAmmo or wallWeapon.)
// The ammo crate (wallAmmo) sells for the gun in hand, at that gun's price; one naming a gun sells for that gun.
const holds = (slots, id) => {
  if (!Array.isArray(slots)) return true;
  for (let i = 0; i < slots.length; i++) if (slots[i] && slots[i].id === id) return true;
  return false;
};
const holdsAny = (slots) => !Array.isArray(slots) || slots.some(Boolean);
export function wallTarget(G) {
  const its = interactables(G), p = playerPos(G);
  const slots = G.weapon && G.weapon.slots, pts = G.game && G.game.points;
  let a = null, ad = Infinity, r = null, rd = Infinity, any = null, nd = Infinity;
  for (let i = 0; i < its.length; i++) {
    const it = its[i];
    if (!it || !it.pos || (it.kind !== 'wallAmmo' && it.kind !== 'wallWeapon') || !live(it)) continue;
    const d = p ? dist2(p, it.pos) : 0;
    const crate = it.kind === 'wallAmmo';
    const cost = crate ? crateCostOf(it, G.weapon) : it.cost;
    const afford = !(pts < cost);
    if (crate && !it.weapon ? holdsAny(slots) : holds(slots, it.weapon)) {
      if (d < rd) { rd = d; r = it; }
      if (afford && d < ad) { ad = d; a = it; }
    }
    if (afford && d < nd) { nd = d; any = it; }
  }
  return a || r || any;
}
const ammoTarget = (G) => pointOf(wallTarget(G));

// Closed doors that border the area the player can already reach (the first side is the forecourt).
const reach = Object.create(null);
export function nextDoor(G) {
  const doors = list(G.level && G.level.doors);
  if (!doors.length) return null;
  for (const k in reach) delete reach[k];
  reach.forecourt = true;
  const first = G.level && G.level.startZone;
  if (first) reach[first] = true;
  for (let pass = 0; pass < doors.length; pass++) {
    let grew = false;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (!d.open) continue;
      if (reach[d.a] && !reach[d.b]) { reach[d.b] = true; grew = true; } else if (reach[d.b] && !reach[d.a]) { reach[d.a] = true; grew = true; }
    }
    if (!grew) break;
  }
  let best = null;
  for (let i = 0; i < doors.length; i++) {
    const d = doors[i];
    if (d.open || !(reach[d.a] !== reach[d.b])) continue;
    if (!best || d.cost < best.cost) best = d;
  }
  return best;
}
export function anyDoorOpen(G) {
  const ds = list(G.level && G.level.doors);
  for (let i = 0; i < ds.length; i++) if (ds[i].open) return true;
  return false;
}

export const doorName = (d) => (/\b(door|gate)\b/i.test(d.label) ? d.label : `${d.label} door`);
export const noun = (it) => String((it && it.label) || 'Search').replace(/^Search\s+/i, '') || 'car';

// ---- copy parts: "Hold [F] to search" -> [{t:'Hold ', key:false}, {t:'F', key:true}, ...] -----------
export function parseCopy(s) {
  const out = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0, m;
  const str = String(s == null ? '' : s);
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ t: str.slice(last, m.index), key: false });
    if (m[1][0] === '@') out.push({ t: m[1].slice(1), key: true, icon: m[1].slice(1) });
    else out.push({ t: m[1], key: true });
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push({ t: str.slice(last), key: false });
  return out;
}
// [@melee] is the melee button's own icon; read aloud it is "the melee button"
export const plainCopy = (s) => String(s == null ? '' : s).replace(/\[@([^\]]+)\]/g, 'the $1 button').replace(/\[([^\]]+)\]/g, '$1');

// ---- the table --------------------------------------------------------------------------------
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
const slotsEmpty = (G) => {
  const w = G.weapon;
  if (!w) return false;
  if (Array.isArray(w.slots)) {
    let any = false;
    for (let i = 0; i < w.slots.length; i++) { const s = w.slots[i]; if (s && (s.mag > 0 || s.reserve > 0)) any = true; }
    return !any;
  }
  return !!(w.ammo && w.ammo.mag === 0 && w.ammo.reserve === 0);
};
const typeHint = (type, text, priority = 65) => ({ id: type, on: ['zombie:spawn'], when: (G, ev) => !!ev && ev.type === type, text: { key: text }, seconds: 6, priority });

export const HINTS = [
  {
    id: 'move', on: ['round:start'], priority: 100, seconds: 6,
    when: (G, ev) => !!ev && ev.n === 1,
    text: { key: '[W][A][S][D] to move, mouse to look', touch: 'Left thumb moves, a tap there jumps. Drag the right side to look' },
    until: (G, a) => {
      const p = playerPos(G);
      if (!p) return false;
      a.turn = Math.max(a.turn || 0, angDiff(G.player.yaw || 0, a.yaw || 0));
      const dx = px(p) - a.x, dz = pz(p) - a.z;
      return dx * dx + dz * dz >= 9 && a.turn >= Math.PI / 3;
    },
  },
  {
    id: 'shoot', on: 'tick', priority: 90, seconds: 8,
    when: (G, ev, c) => {
      if (c.hits > 0) return false;
      const p = G.player, zs = G.zombies && G.zombies.list;
      if (!p || !p.pos || !Array.isArray(zs)) return false;
      const f = p.forward;
      let fx = f ? f[0] : -Math.sin(p.yaw || 0), fz = f ? f[2] : -Math.cos(p.yaw || 0);
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl; fz /= fl;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (!z || z.alive === false || !z.pos) continue;
        const dx = px(z.pos) - p.pos[0], dz = pz(z.pos) - p.pos[2];
        const d2 = dx * dx + dz * dz;
        if (d2 > 900 || d2 < 0.01) continue; // within 30 m (the plan says 25: a spawn at the tree line is 28 m out)
        if ((dx * fx + dz * fz) / Math.sqrt(d2) > 0.5) return true; // and in view (60 degrees either side)
      }
      return false;
    },
    text: { key: 'Click to shoot, right-click to aim', touch: 'Crosshair on them, tap [@fire] to shoot. Hold it with automatic guns' },
    until: (G, a, c) => c.hits > a.at.hits,
  },
  {
    id: 'points', on: ['points:add'], priority: 80, seconds: 8,
    when: (G, ev) => !!ev && ev.amount > 0,
    text: { key: `Points: ${P.hit} a hit, ${P.kill} a kill, ${P.headshotKill} a headshot kill. Spend them at the wall` },
  },
  {
    id: 'rounds', on: ['round:start'], priority: 30, seconds: 7,
    when: (G, ev) => !!ev && ev.n === 2,
    text: { key: 'The big number is the round. Each one brings more, and tougher' },
  },
  {
    id: 'sprint', on: ['round:start'], priority: 28,
    when: (G, ev) => !!ev && ev.n === 3,
    text: { key: "Hold [Shift] to sprint — you can't shoot while sprinting", touch: 'Push the stick all the way to sprint' },
    until: (G) => !!(G.input && G.input.sprint),
  },
  {
    id: 'reload', on: 'tick', priority: 70, seconds: 7,
    when: (G) => {
      const a = G.weapon && G.weapon.ammo;
      return !!a && a.mag <= 3 && a.reserve > 0 && !G.weapon.reloading;
    },
    text: { key: '[R] to reload', touch: 'Tap [@reload] to reload' },
    until: (G, a, c) => c.reloads > a.at.reloads,
  },
  {
    id: 'lowAmmo', on: ['weapon:low'], priority: 75, seconds: 8,
    when: (G, ev) => !!ev && ev.reserve > 0,
    text: { key: 'Low on ammo. Buy more at the marked wall' },
    until: (G, a, c) => c.buys > a.at.buys,
    target: ammoTarget,
  },
  {
    id: 'noAmmo', on: ['weapon:empty'], priority: 95, seconds: 14,
    when: (G) => slotsEmpty(G),
    text: {
      key: (G) => `Out of ammo. Buy at the wall${G.weapon && G.weapon.melee ? ', or press [V] to knife them' : ''}`,
      touch: (G) => `Out of ammo. Buy at the wall${G.weapon && G.weapon.melee ? ', or tap [@melee]' : ''}`,
    },
    until: (G, a, c) => c.buys > a.at.buys || !slotsEmpty(G),
    target: ammoTarget,
  },
  {
    id: 'wallBuy', on: 'tick', priority: 50,
    when: (G) => focusIs(G, 'wallAmmo', 'wallWeapon'),
    text: { key: 'Press [F] to buy here', touch: 'Tap [BUY]' },
    until: (G, a, c) => c.buys > a.at.buys || !focusIs(G, 'wallAmmo', 'wallWeapon'),
  },
  {
    id: 'switchGuns', on: 'tick', priority: 48, seconds: 7,
    when: (G) => {
      const s = G.weapon && G.weapon.slots;
      return Array.isArray(s) && !!s[0] && !!s[1];
    },
    text: { key: '[Q] or [1] / [2] switches guns', touch: 'Tap [@swap] to switch guns' },
    until: (G, a, c) => c.switches > a.at.switches,
  },
  {
    id: 'melee', on: 'tick', priority: 68, seconds: 6,
    when: (G) => {
      const p = playerPos(G), zs = G.zombies && G.zombies.list;
      if (!p || !Array.isArray(zs)) return false;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z && z.alive !== false && z.pos && dist2(p, z.pos) <= 4) return true;
      }
      return false;
    },
    text: { key: 'Too close? [V] swings your knife', touch: 'Too close? Tap [@melee]' },
    until: (G, a, c) => c.swings > a.at.swings,
  },
  {
    id: 'door', on: 'tick', priority: 60, seconds: 8,
    when: (G) => {
      if (!G.game || !Number.isFinite(G.game.points)) return false;
      const d = nextDoor(G);
      return !!d && G.game.points >= d.cost;
    },
    text: {
      key: (G) => { const d = nextDoor(G); return d ? `You can afford the ${doorName(d)}: ${d.cost}` : 'You can afford a door'; },
    },
    until: (G, a, c) => c.opened > a.at.opened,
    target: (G) => pointOf(nextDoor(G)),
  },
  {
    id: 'power', on: ['door:open'], priority: 62, seconds: 8,
    when: (G) => !powerOn(G),
    text: { key: 'The power is off. The switch is in the garage' },
    until: (G, a, c) => c.powered > a.at.powered,
    target: (G) => (G.level && G.level.power && G.level.power.pos ? [px(G.level.power.pos), pz(G.level.power.pos)] : null),
  },
  {
    id: 'needsPower', on: 'tick', priority: 55,
    when: (G) => !powerOn(G) && focusIs(G, 'bench', 'machine'),
    text: { key: 'No power yet. The switch is in the garage' },
    until: (G, a, c) => c.powered > a.at.powered || !focusIs(G, 'bench', 'machine'),
    target: (G) => (G.level && G.level.power && G.level.power.pos ? [px(G.level.power.pos), pz(G.level.power.pos)] : null),
  },
  {
    id: 'bench', on: 'tick', priority: 52, seconds: 8,
    when: (G) => {
      if (!powerOn(G) || !G.game || !(G.game.points >= BENCH_COST)) return false;
      const b = nearestOf(G, 'bench', 14);
      return !!b && G.game.points >= (b.cost || BENCH_COST);
    },
    text: { key: `Upgrade bench: ${BENCH_COST}` },
    until: (G, a, c) => c.upgrades > a.at.upgrades || c.buys > a.at.buys,
    target: (G) => pointOf(nearestOf(G, 'bench', 99)),
  },
  {
    id: 'box', on: 'tick', priority: 50,
    when: (G) => near(G, 'box', 8),
    text: { key: `The weapon box: ${BOX_COST} for a random gun` },
    until: (G, a, c) => c.rolls > a.at.rolls || !near(G, 'box', 12),
  },
  {
    id: 'search', on: 'tick', priority: 45, seconds: 7,
    when: (G) => near(G, 'search', 5),
    text: {
      key: (G) => `Hold [F] to search the ${noun(nearestOf(G, 'search', 12)) || 'car'} — once only`,
      touch: (G) => `Hold [SEARCH]. One search per ${noun(nearestOf(G, 'search', 12)) || 'car'}`,
    },
    until: (G, a, c) => c.searches > a.at.searches || !near(G, 'search', 8),
  },
  {
    id: 'powerup', on: ['powerup:drop'], priority: 66, seconds: 6,
    when: () => true,
    text: { key: 'Walk over the glow to grab it' },
    until: (G, a, c) => c.pups > a.at.pups,
  },
  {
    id: 'plates', on: ['armor:change'], priority: 35,
    when: (G, ev) => !!ev && ev.plates > 0,
    text: { key: 'Armour plates soak damage before your health' },
  },
  {
    id: 'throw', on: 'tick', priority: 35,
    when: (G) => {
      const t = G.weapon && G.weapon.throwables;
      return !!t && ((t.frag | 0) + (t.molotov | 0) + (t.decoy | 0)) > 0;
    },
    text: { key: '[G] to throw, [3] to change', touch: 'Tap [@throw] to throw' },
    until: (G, a, c) => c.throws > a.at.throws,
  },
  {
    id: 'boards', on: 'tick', priority: 40,
    when: (G) => {
      const p = playerPos(G), ws = G.level && G.level.windows;
      if (!p || !Array.isArray(ws)) return false;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        if (w && w.boards < w.max && w.pos && dist2(p, w.pos) <= 16) return true;
      }
      return false;
    },
    text: { key: 'Hold [F] at a broken window: 10 a board', touch: 'Hold [REPAIR] at a broken window: 10 a board' },
    until: (G, a, c) => c.repairs > a.at.repairs,
  },
  typeHint('runner', 'Runners: keep moving'),
  typeHint('armoured', 'Armoured: shoot the head or the back'),
  typeHint('bloater', 'Bloaters burst: kill them at range'),
  typeHint('brute', 'Brute: huge health. Keep your distance, aim at the head', 88),
  {
    id: 'revive', on: ['revive'], priority: 92, seconds: 7,
    when: () => true,
    text: { key: 'Jump Start saved you. Buy another' },
  },
];

export const HINT_IDS = HINTS.map((h) => h.id);
export const hintById = (id) => HINTS.find((h) => h.id === id) || null;
