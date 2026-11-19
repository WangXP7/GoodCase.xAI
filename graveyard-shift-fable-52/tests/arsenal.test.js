import { describe, it, expect } from 'vitest';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';
import { createWeapon } from '../src/weapon/firing.js';
import { WEAPONS, WEAPON_IDS, statsFor, createSlot } from '../src/weapon/defs.js';
import { applyAttachments, ATTACHMENTS } from '../src/weapon/attachments.js';
import { tuning } from '../src/game/tuning.js';

const DT = 1 / 60;

function mockG({ params = {} } = {}) {
  const events = createEvents();
  const log = [];
  for (const n of ['weapon:fire', 'weapon:reload', 'weapon:switch', 'weapon:low', 'weapon:empty', 'hit:zombie', 'hit:world']) {
    events.on(n, (p) => log.push([n, p]));
  }
  const pressed = new Set();
  const G = {
    params, events, rng: createRng(1), time: { t: 0 },
    input: { pressed: (n) => pressed.has(n), ads: false, fire: false },
    player: { eye: [0, 1.7, 0], forward: [0, 0, -1], vel: [0, 0, 0], onGround: true, sprinting: false, alive: true },
    game: { state: 'playing' },
    zombies: { list: [], raycast: () => null, damage: () => ({ killed: false }) },
    level: { raycast: () => null },
  };
  return { G, log, pressed };
}

function setup(opts) {
  const m = mockG(opts);
  const w = createWeapon(m.G, { createView: () => null });
  m.G.weapon = w;
  return { ...m, w };
}

const run = (w, secs) => { for (let i = 0, n = Math.round(secs / DT); i < n; i++) w.update(DT); };

describe('weapon table', () => {
  it('has the ten weapons with the planned numbers', () => {
    expect(WEAPON_IDS).toEqual(['pistol', 'revolver', 'pump', 'autoShotgun', 'smg', 'rifle', 'battleRifle', 'lmg', 'jumper', 'flare']);
    expect(WEAPONS.pistol).toMatchObject({ name: 'Wren 9', mag: 12, reserve: 48, maxReserve: 96, damage: 40, rpm: 400, auto: false, reload: 1.6, range: 60 });
    expect(WEAPONS.smg).toMatchObject({ mag: 30, rpm: 780, auto: true, wall: { cost: 1250, ammo: 500 } });
    expect(WEAPONS.pump).toMatchObject({ pellets: 8, damage: 28, reloadKind: 'shell', reload: 0.55, falloff: [8, 22, 0.35] });
    expect(WEAPONS.lmg.moveScale).toBe(0.9);
    expect(WEAPONS.jumper.box).toBe(1);
    expect(WEAPONS.pistol.box).toBe(0);
    for (const id of WEAPON_IDS) {
      const d = WEAPONS[id];
      expect(d.id).toBe(id);
      expect(d.spread && d.recoil).toBeTruthy();
      expect(d.upgraded.name).toMatch(new RegExp(`^${d.name.replace('.', '\\.')} ".+"$`));
    }
    expect(new Set(WEAPON_IDS.map((id) => WEAPONS[id].upgraded.name)).size).toBe(10);
  });

  it('keeps tuning.pistol in its original shape', () => {
    expect(tuning.pistol).toMatchObject({ mag: 12, reserve: 48, maxReserve: 96, damage: 40, rpm: 400, semiAuto: true, reload: 1.6, range: 60 });
  });

  it('statsFor applies the upgrade and the attachments', () => {
    const s = createSlot('pistol');
    expect(statsFor(s).damage).toBe(40);
    s.upgraded = true;
    expect(statsFor(s)).toMatchObject({ damage: 80, mag: 18, reserve: 72, maxReserve: 144, upgraded: true, name: 'Wren 9 "Night Owl"' });
    s.attachments.add('mag');
    expect(statsFor(s).mag).toBe(27);
    expect(statsFor(createSlot('smg')).upgraded).toBe(false);
  });

  it('each attachment does what it says', () => {
    const base = WEAPONS.rifle;
    expect(ATTACHMENTS).toEqual(['sight', 'mag', 'grip', 'suppressor']);
    const sight = applyAttachments(base, new Set(['sight']));
    expect(sight.spread.ads).toBeCloseTo(base.spread.ads * 0.5);
    expect(sight.zoom).toBe(0.65);
    expect(applyAttachments(base, new Set(['mag'])).mag).toBe(45);
    const grip = applyAttachments(base, new Set(['grip']));
    expect(grip.recoil.pitchMax).toBeCloseTo(base.recoil.pitchMax * 0.7);
    expect(grip.spread.hip).toBeCloseTo(base.spread.hip * 0.8);
    const sup = applyAttachments(base, new Set(['suppressor']));
    expect(sup.range).toBeCloseTo(base.range * 1.15);
    expect(sup.recoil.pitchMax).toBeCloseTo(base.recoil.pitchMax * 0.9);
    expect(sup.suppressed).toBe(true);
    expect(base.spread.ads).toBe(WEAPONS.rifle.spread.ads); // the table is never mutated
  });
});

describe('arsenal', () => {
  it('a new game holds [pistol, null] with the knife and no throwables', () => {
    const { w } = setup();
    expect(w.slots.map((s) => s && s.id)).toEqual(['pistol', null]);
    expect(w.slot).toBe(0);
    expect(w.id).toBe('pistol');
    expect(w.name).toBe('Wren 9');
    expect(w.def.damage).toBe(40);
    expect(w.ammo).toMatchObject({ mag: 12, reserve: 48 });
    expect(w.melee).toBe('knife');
    expect(w.throwables).toEqual({ frag: 0, molotov: 0, decoy: 0 });
    expect(w.mods).toEqual({ reloadScale: 1, instantKill: false });
  });

  it('give fills the empty slot and switches to it', () => {
    const { w, log } = setup();
    expect(w.give('pump')).toEqual({ slot: 1, replaced: null });
    expect(w.slot).toBe(1);
    expect(w.id).toBe('pump');
    expect(w.ammo).toMatchObject({ mag: 6, reserve: 30 });
    expect(log.find((l) => l[0] === 'weapon:switch')[1]).toEqual({ from: 'pistol', to: 'pump', slot: 1 });
    expect(w.has('pump')).toBe(true);
    expect(w.has('smg')).toBe(false);
  });

  it('give with both slots full replaces the held one and says what it replaced', () => {
    const { w } = setup();
    w.give('pump');
    expect(w.give('smg')).toEqual({ slot: 1, replaced: 'pump' });
    expect(w.slots.map((s) => s.id)).toEqual(['pistol', 'smg']);
    w.switchTo(0);
    expect(w.give('rifle')).toEqual({ slot: 0, replaced: 'pistol' });
    expect(w.give('lmg', { slot: 1 })).toEqual({ slot: 1, replaced: 'smg' });
    expect(w.slots.map((s) => s.id)).toEqual(['rifle', 'lmg']);
    expect(w.give('nonsense')).toBe(null);
  });

  it('give of a weapon already held refills it instead of duplicating', () => {
    const { w } = setup();
    w.give('pump');
    w.state.mag = 1; w.state.reserve = 3;
    w.switchTo(0);
    expect(w.give('pump')).toEqual({ slot: 1, replaced: null });
    expect(w.slots.map((s) => s.id)).toEqual(['pistol', 'pump']);
    expect(w.slot).toBe(1);
    expect(w.ammo).toMatchObject({ mag: 6, reserve: 54 });
  });

  it('switchTo during a reload cancels it without granting ammo', () => {
    const { w } = setup();
    w.give('pump');
    w.switchTo(0);
    run(w, 1);
    w.state.mag = 2;
    w.reload();
    expect(w.reloading).toBe(true);
    run(w, 0.9);
    expect(w.switchTo(1)).toBe(true);
    expect(w.reloading).toBe(false);
    w.switchTo(0);
    run(w, 3);
    expect(w.ammo).toMatchObject({ mag: 2, reserve: 48 });
    expect(w.switchTo(0)).toBe(false); // already held
  });

  it('each slot keeps its own magazine across switches, and a switch blocks firing briefly', () => {
    const { w } = setup();
    w.give('smg');
    run(w, 1);
    for (let i = 0; i < 5; i++) { w.fire(); run(w, 0.1); }
    expect(w.ammo.mag).toBe(25);
    w.switchTo(0);
    w.fire();
    expect(w.ammo.mag).toBe(12); // still raising it
    run(w, tuning.weapons.swapTime + 0.05);
    w.fire();
    expect(w.ammo.mag).toBe(11);
    w.switchTo(1);
    expect(w.ammo.mag).toBe(25);
  });

  it('swap, slot1 and slot2 inputs switch', () => {
    const { w, pressed } = setup();
    w.give('smg');
    pressed.add('swap'); w.update(DT); pressed.clear();
    expect(w.slot).toBe(0);
    pressed.add('slot2'); w.update(DT); pressed.clear();
    expect(w.slot).toBe(1);
    pressed.add('slot1'); w.update(DT); pressed.clear();
    expect(w.slot).toBe(0);
  });

  it('addReserve with no id fills the held weapon to its max; with an id, that weapon', () => {
    const { w } = setup();
    expect(w.addReserve()).toBe(48);
    expect(w.ammo.reserve).toBe(96);
    w.give('smg');
    expect(w.addReserve(10, 'pistol')).toBe(0); // full
    w.slots[0].reserve = 50;
    expect(w.addReserve(10, 'pistol')).toBe(10);
    expect(w.slots[0].reserve).toBe(60);
    expect(w.addReserve(5, 'lmg')).toBe(0); // not held
    expect(w.addReserve()).toBe(120);
    expect(w.ammo.reserve).toBe(240);
  });

  it('fillAll fills both slots', () => {
    const { w } = setup();
    w.give('pump');
    w.slots[0].reserve = 0; w.slots[1].reserve = 0;
    expect(w.fillAll()).toBe(96 + 54);
    expect(w.slots.map((s) => s.reserve)).toEqual([96, 54]);
  });

  it('upgrade doubles the damage, fills the weapon, and is refused a second time', () => {
    const { w } = setup();
    expect(statsFor(w.slots[0]).damage).toBe(40);
    expect(w.upgrade()).toBe(true);
    expect(statsFor(w.slots[0]).damage).toBe(80);
    expect(w.def.damage).toBe(80);
    expect(w.name).toBe('Wren 9 "Night Owl"');
    expect(w.ammo).toMatchObject({ mag: 18, reserve: 72 });
    expect(w.upgrade()).toBe(false);
    expect(w.upgrade('smg')).toBe(false); // not held
  });

  it("attach('mag') makes the pistol's magazine 18 and is refused a second time", () => {
    const { w } = setup();
    expect(w.attach('mag')).toBe(true);
    expect(w.def.mag).toBe(18);
    expect(w.attach('mag')).toBe(false);
    expect(w.attach('laser')).toBe(false);
    w.reload();
    run(w, 2);
    expect(w.ammo).toMatchObject({ mag: 18, reserve: 42 });
    // attachments are lost with the slot
    w.give('smg');
    w.give('rifle'); // replaces the held smg
    w.switchTo(0);
    expect(w.give('pump')).toEqual({ slot: 0, replaced: 'pistol' });
    w.give('pistol');
    expect(w.slots[w.slot].attachments.size).toBe(0);
  });

  it('throwables respect the carry limits; melee can be set', () => {
    const { w } = setup();
    expect(w.addThrowable('frag')).toBe(1);
    expect(w.addThrowable('frag', 5)).toBe(2);
    expect(w.addThrowable('molotov', 9)).toBe(2);
    expect(w.addThrowable('decoy', 3)).toBe(2);
    expect(w.addThrowable('bogus')).toBe(0);
    expect(w.throwables).toEqual({ frag: 3, molotov: 2, decoy: 2 });
    w.setMelee('axe');
    expect(w.melee).toBe('axe');
    w.setMelee('spoon');
    expect(w.melee).toBe('axe');
  });

  it('cycle moves the selected throwable to the next kind in hand', () => {
    const { w, pressed } = setup();
    w.addThrowable('decoy');
    expect(w.throwable).toBe('frag');
    pressed.add('cycle'); w.update(DT); pressed.clear();
    expect(w.throwable).toBe('decoy');
    w.addThrowable('molotov');
    pressed.add('cycle'); w.update(DT); pressed.clear();
    expect(w.throwable).toBe('molotov');
  });

  it('reset returns to a fresh pistol, knife, no throwables', () => {
    const { w } = setup();
    w.give('lmg');
    w.upgrade(); w.attach('grip');
    w.setMelee('axe');
    w.addThrowable('frag', 2);
    w.mods.instantKill = true; w.mods.reloadScale = 0.6;
    w.reset();
    expect(w.slots.map((s) => s && s.id)).toEqual(['pistol', null]);
    expect(w.slot).toBe(0);
    expect(w.ammo).toMatchObject({ mag: 12, reserve: 48 });
    expect(w.slots[0].upgraded).toBe(false);
    expect(w.slots[0].attachments.size).toBe(0);
    expect(w.melee).toBe('knife');
    expect(w.throwables).toEqual({ frag: 0, molotov: 0, decoy: 0 });
    expect(w.mods).toEqual({ reloadScale: 1, instantKill: false });
  });

  it('give=<ids> sets the loadout of every new game', () => {
    const one = setup({ params: { give: ['smg'] } });
    expect(one.w.slots.map((s) => s.id)).toEqual(['pistol', 'smg']);
    expect(one.w.id).toBe('smg');
    const two = setup({ params: { give: ['pump', 'lmg', 'nope'] } });
    expect(two.w.slots.map((s) => s.id)).toEqual(['pump', 'lmg']);
    two.w.reset();
    expect(two.w.slots.map((s) => s.id)).toEqual(['pump', 'lmg']);
  });

  it('mods.reloadScale shortens the reload', () => {
    const { w } = setup();
    w.mods.reloadScale = 0.6;
    w.state.mag = 0;
    w.reload();
    run(w, 1.6 * 0.6 + 0.05);
    expect(w.reloading).toBe(false);
    expect(w.ammo.mag).toBe(12);
  });
});
