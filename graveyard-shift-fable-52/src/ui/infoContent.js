// What the menu's information panel says. Pure: no DOM. The perks and weapons come from the game's own
// tables (src/game/tuning/*), and every number in a sentence is read from them. The sentences themselves
// are kept here, keyed by id, so each id in the tables must have one (tests/infoPanel.test.js checks).
import { tuning as defaultTuning } from '../game/tuning.js';
import { formatPoints, CONTROLS } from './format.js';
import { crateAmmoPrice } from '../game/purchases.js';

// The use key as the Controls tab shows it: keyboard, then touch.
const useKeys = () => { const c = CONTROLS.find((x) => x.id === 'interact'); return `${c.key} on a keyboard, ${c.touch} on touch`; };

const pts = formatPoints;
const pct = (x) => `${Math.round(x * 100)}%`;
const secs = (n) => `${n} second${n === 1 ? '' : 's'}`;

export const TABS = [
  { id: 'controls', label: 'Controls' },
  { id: 'how', label: 'How it works' },
  { id: 'perks', label: 'Perks' },
  { id: 'weapons', label: 'Weapons' },
];

// ---- perks: one line each on what the machine does, keyed by machine id ----
export const PERK_TEXT = {
  secondHelping: (T) => `Raises your health from ${T.player.health} to ${T.economy.machines.secondHelping.maxHealth}.`,
  shortOrder: (T) => `Reloads take ${pct(1 - T.economy.machines.shortOrder.reloadScale)} less time.`,
  longHaul: (T) => `You walk and sprint ${pct(T.economy.machines.longHaul.speed - 1)} faster.`,
  jumpStart: (T) => {
    const J = T.economy.machines.jumpStart;
    return `A killing hit leaves you on ${J.health} health instead, safe for ${secs(J.invuln)}, and throws back zombies within ${J.radius} m. It is used up when it saves you. Buying it again costs ${pts(J.step)} more each time.`;
  },
};

// ---- power-ups: what each drop does, keyed by power-up id ----
export const POWERUP_TEXT = {
  resupply: () => 'Refills all your ammo and grenades.',
  oneTap: (T) => `Every hit kills for ${secs(T.economy.powerups.seconds.oneTap)}.`,
  doubleTime: (T) => `Points count double for ${secs(T.economy.powerups.seconds.doubleTime)}.`,
  flashover: (T) => `Burns the zombies on the map. Most die at once, a brute loses ${pct(T.economy.powerups.bruteShare)} of its health. You get ${pts(T.economy.powerups.flashoverPoints)} points.`,
};

// ---- weapons: a one-line character per weapon id, and a heading per class ----
export const WEAPON_TEXT = {
  pistol: () => 'Your starting gun. Light and accurate.',
  revolver: () => 'Six heavy shots. Slow to fire, slow to reload.',
  pump: () => 'Wide blast, brutal up close, weak at range. Reloads one shell at a time.',
  autoShotgun: () => 'A shotgun that fires fast. Burns through shells.',
  smg: () => 'Fast and easy to hold on target. Strong up close.',
  rifle: () => 'Full auto with reach and a steady aim.',
  battleRifle: () => 'One shot at a time, each one heavy. Long range.',
  lmg: (T) => `A huge belt and steady fire. Slow to reload, and you move ${pct(1 - T.weapons.table.lmg.moveScale)} slower.`,
  jumper: (T) => `Each hit arcs on to ${T.weapons.table.jumper.special.extra} more zombies close by.`,
  flare: () => 'Lobbed. Bursts into a fire that burns zombies standing in it.',
};
export const CLASS_LABELS = {
  pistol: 'Pistols', revolver: 'Revolvers', shotgun: 'Shotguns', smg: 'SMGs', rifle: 'Rifles', lmg: 'Machine guns', special: 'Specials',
};
const CLASS_ORDER = Object.keys(CLASS_LABELS);

// ---- the ammo crate: every price comes from crateAmmoPrice (src/game/purchases.js) ----
// The crate refills the gun in your hand, at that gun's price. An upgraded gun pays crateUpgraded.scale times it, up to crateUpgraded.max.
const WORDS = { 2: 'twice', 3: 'three times', 4: 'four times' };
export const crateStock = (T = defaultTuning) => T.weapons.ids.map((id) => crateAmmoPrice(id, false));
export function crateText(T = defaultTuning) {
  const stock = crateStock(T);
  const lo = Math.min(...stock), hi = Math.max(...stock);
  const U = T.economy.crateUpgraded;
  let t = `The ammo crate refills the gun in your hand. Each gun has its own price, ${lo === hi ? pts(lo) : `${pts(lo)} to ${pts(hi)}`} points.`;
  if (U) t += ` Once upgraded it costs ${WORDS[U.scale] || `${U.scale} times`} that, up to ${pts(U.max)}.`;
  return t;
}

// ---- how it works ----
// Each entry builds its sentence from the tables; one that needs a table the game no longer has is dropped.
const HOW = [
  { id: 'points', title: 'Points', text: (T) => `A hit pays ${pts(T.economy.points.hit)}. A kill pays ${pts(T.economy.points.kill)}, a headshot kill ${pts(T.economy.points.headshotKill)}, a melee kill ${pts(T.economy.points.meleeKill)}. Spend them on everything below.` },
  { id: 'doors', title: 'Doors', text: (T) => {
    const v = Object.values(T.world.doors);
    return `Buy a door to open the next area. They cost ${pts(Math.min(...v))} to ${pts(Math.max(...v))}.`;
  } },
  { id: 'power', title: 'Power', text: () => 'Find the power switch and turn it on. It is free. Perks and the upgrade bench do nothing without it.' },
  { id: 'wall', title: 'Wall weapons', text: () => 'Buy a gun from the wall. Stand at one you own to buy its ammo, which costs less.' },
  { id: 'box', title: 'Weapon box', text: (T) => `${pts(T.economy.box.cost)} points for a random gun you are not carrying. Take it within ${secs(T.economy.box.offer)} or it is gone. The box moves after a few uses. It works without power.` },
  { id: 'crate', title: 'Ammo crate', text: (T) => crateText(T) },
  { id: 'upgrade', title: 'Upgrading', text: (T) => `Take a gun to the upgrade bench${T.economy.bench ? ` for ${pts(T.economy.bench.cost)} points` : ''}. It hits harder and holds more. Needs power.` },
  { id: 'armour', title: 'Armour', text: (T) => `Each plate soaks ${T.touch.plate} damage. You can carry ${T.touch.maxPlates}.` },
  { id: 'search', title: 'Searching', text: (T) => `Hold the use button (${useKeys()}) at a car, barrel, bin, crate, locker, dresser, suitcase or other container for ${T.loot.hold} seconds. Each can be searched once per game and gives a random find: ammo, points, health, armour, a grenade, an attachment, a power-up or a rare gun, or nothing.` },
  { id: 'pierce', title: 'Through the line', text: () => 'Bullets pass through zombies standing in a line, weaker each time. Only the first one pays hit points.' },
  { id: 'swipe', title: 'Running past', text: () => 'Zombies can hit you as you run past them.' },
  { id: 'boards', title: 'Windows', text: (T) => `Zombies tear boards off windows to get in. Put them back for ${T.world.boards.repairPoints} points each.` },
  { id: 'drops', title: 'Power-up drops', text: () => 'Kills sometimes drop a power-up. Walk over it before it fades.', list: true },
  { id: 'rounds', title: 'Rounds', text: (T) => `Every round brings more zombies, and tougher kinds turn up as you go. You get ${secs(T.round.lull)} to breathe between rounds.` },
];

// ---- build ----
export function howItems(T = defaultTuning) {
  const out = [];
  for (const e of HOW) {
    let text;
    try { text = e.text(T); } catch { continue; }
    const item = { id: e.id, title: e.title, text };
    if (e.list) {
      item.list = T.economy.powerups.kinds.map((id) => ({
        id, name: T.economy.powerups.names[id] || id, text: POWERUP_TEXT[id] ? POWERUP_TEXT[id](T) : '',
      }));
    }
    out.push(item);
  }
  return out;
}

export function perkItems(T = defaultTuning) {
  const M = T.economy.machines;
  return T.economy.machineKinds.map((id) => ({
    id, name: M[id].name, cost: M[id].cost, text: PERK_TEXT[id] ? PERK_TEXT[id](T) : '',
  }));
}

// Where a weapon comes from, as short labels: the start, the wall (with its price), the box, a rare find in a search.
export function weaponSources(d, T = defaultTuning) {
  const s = [];
  if (d.wall && d.wall.cost == null) s.push({ kind: 'start', text: 'Start' });
  else if (d.wall && d.wall.cost > 0) s.push({ kind: 'wall', text: `Wall ${pts(d.wall.cost)}` });
  if (d.box > 0) s.push({ kind: 'box', text: 'Box' });
  if (T.loot.weapons.includes(d.id)) s.push({ kind: 'find', text: 'Rare find' });
  return s;
}

// The three bars. Damage counts every pellet of a hit. Each bar is the square root of the value over the
// table's highest, so a 40 and a 140 are both readable beside a 600; the number is printed next to it.
export function weaponStats(d) {
  return {
    damage: { label: 'Damage', value: d.damage * d.pellets, text: d.pellets > 1 ? `${d.damage}×${d.pellets}` : String(d.damage) },
    rate: { label: 'Fire rate', value: d.rpm, text: String(d.rpm) },
    mag: { label: 'Magazine', value: d.mag, text: String(d.mag) },
  };
}

export function weaponGroups(T = defaultTuning) {
  const table = T.weapons.table;
  const ids = T.weapons.ids;
  const max = { damage: 0, rate: 0, mag: 0 };
  for (const id of ids) {
    const st = weaponStats(table[id]);
    for (const k of Object.keys(max)) max[k] = Math.max(max[k], st[k].value);
  }
  const byClass = new Map();
  for (const id of ids) {
    const d = table[id];
    const stats = weaponStats(d);
    for (const k of Object.keys(stats)) stats[k].fraction = max[k] > 0 ? Math.sqrt(stats[k].value / max[k]) : 0;
    const item = {
      id, name: d.name, cls: d.cls, sources: weaponSources(d, T), text: WEAPON_TEXT[id] ? WEAPON_TEXT[id](T) : '',
      upgraded: d.upgraded ? d.upgraded.name : null, stats,
      ammo: { stock: crateAmmoPrice(id, false), upgraded: crateAmmoPrice(id, true) },
    };
    if (!byClass.has(d.cls)) byClass.set(d.cls, []);
    byClass.get(d.cls).push(item);
  }
  const order = [...CLASS_ORDER, ...[...byClass.keys()].filter((c) => !CLASS_ORDER.includes(c))];
  return order.filter((c) => byClass.has(c)).map((c) => ({ cls: c, label: CLASS_LABELS[c] || c, items: byClass.get(c) }));
}

export function infoContent(T = defaultTuning) {
  return { how: howItems(T), perks: perkItems(T), weapons: weaponGroups(T) };
}
