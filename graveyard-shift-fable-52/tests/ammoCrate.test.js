// The forecourt ammo crate: it refills the weapon in hand, whatever it is, at that weapon's price
// (its wall-ammo price, else its class's, 4500 once upgraded), and its prompt says which and how much.
// The other carried weapon is left as it is.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { econG, memoryStorage } from './fakes/econ.js';
import { tuning } from '../src/game/tuning.js';
import { WEAPONS, statsFor } from '../src/weapon/defs.js';
import { ammoCost, crateAmmoPrice } from '../src/game/purchases.js';
import { promptString, formatPoints } from '../src/ui/format.js';

let saved;
beforeEach(() => { saved = globalThis.window; globalThis.window = memoryStorage(); });
afterEach(() => { globalThis.window = saved; });

const TE = tuning.economy;

// A game holding `give` (one id beside the pistol, held; two ids replace it), standing at the crate.
function atCrate(give, { points = 20000, upgraded = false } = {}) {
  const g = econG({ points, params: give ? { give } : {} });
  const crate = g.find('ammo-store');
  g.G.player.pos = [crate.pos[0] - 0.8, 0, crate.pos[2]];
  if (upgraded) g.G.weapon.upgrade();
  g.step();
  return g;
}
// Press the use button for one frame (F on a keyboard, BUY on a phone: both are the `interact` action).
function press(g) { g.G.input.press('interact'); g.step(); g.G.input.release('interact'); }

const held = (g) => g.G.weapon.slots[g.G.weapon.slot];
const other = (g) => g.G.weapon.slots[1 - g.G.weapon.slot];
const max = (s) => statsFor(s).maxReserve;

// one weapon of each class, with the price the crate asks for it
const CASES = [
  ['pistol', 'pistol', 250],
  ['revolver', 'revolver', TE.crateAmmo.revolver],
  ['pump', 'shotgun', WEAPONS.pump.wall.ammo],
  ['autoShotgun', 'shotgun', WEAPONS.autoShotgun.wall.ammo],
  ['smg', 'smg', WEAPONS.smg.wall.ammo],
  ['rifle', 'rifle', WEAPONS.rifle.wall.ammo],
  ['battleRifle', 'rifle', TE.crateAmmo.rifle],
  ['lmg', 'lmg', TE.crateAmmo.lmg],
  ['jumper', 'special', TE.crateAmmo.special],
  ['flare', 'special', TE.crateAmmo.special],
];

describe('the ammo crate refills the weapon in hand', () => {
  for (const [id, cls, price] of CASES) {
    it(`${id} (${cls}): ${price} points, the ${id}'s reserve to its max, the other weapon untouched`, () => {
      const g = atCrate(id === 'pistol' ? ['pistol'] : [id]);
      expect(g.G.weapon.id).toBe(id);
      expect(WEAPONS[id].cls).toBe(cls);
      const focus = g.game.focus;
      expect(focus.id).toBe('ammo-store');
      expect(focus.cost).toBe(price);
      expect(focus.label).toBe(`${WEAPONS[id].name} ammo`);
      held(g).reserve = 0;
      const o = other(g);
      if (o) o.reserve = 1;
      press(g);
      expect(g.game.lastUse).toMatchObject({ id: 'ammo-store', ok: true });
      expect(held(g).reserve).toBe(max(held(g)));
      if (o) expect(o.reserve).toBe(1);
      expect(g.game.points).toBe(20000 - price);
      expect(g.events('buy').at(-1)).toEqual({ item: 'wallAmmo', cost: price, id: 'ammo-store' });
      // full now: refused with `full`, nothing spent
      press(g);
      expect(g.game.lastUse).toMatchObject({ ok: false, reason: 'full' });
      expect(g.game.points).toBe(20000 - price);
    });
  }

  it('an upgraded weapon: 3x its stock price (2100 for the rifle), filled to the upgraded max, named by its upgraded name', () => {
    const g = atCrate(['rifle'], { upgraded: true });
    const s = held(g);
    expect(s.upgraded).toBe(true);
    expect(g.game.focus.cost).toBe(2100);
    expect(g.game.focus.label).toBe(`${statsFor(s).name} ammo`);
    s.reserve = 0;
    press(g);
    expect(s.reserve).toBe(statsFor(s).maxReserve);
    expect(s.reserve).toBeGreaterThan(WEAPONS.rifle.maxReserve);
    expect(g.game.points).toBe(20000 - 2100);
    expect(promptString(g.game.focus)).toBe(`Press F — ${statsFor(s).name} ammo · ${formatPoints(2100)}`);
  });

  it('upgraded crate prices: 3x stock, at most 3000, below the 4000 upgrade', () => {
    const want = { pistol: 750, pump: 1200, smg: 1500, revolver: 1500, rifle: 2100, battleRifle: 2250, autoShotgun: 2400, lmg: 3000, jumper: 3000, flare: 3000 };
    for (const [id, price] of Object.entries(want)) {
      expect(crateAmmoPrice(id, true)).toBe(price);
      expect(crateAmmoPrice(id, true)).toBe(Math.min(TE.crateUpgraded.max, TE.crateUpgraded.scale * crateAmmoPrice(id, false)));
      expect(price).toBeLessThan(TE.bench.cost);
    }
  });

  it('an upgraded LMG at the crate: 3000, through the game', () => {
    const g = atCrate(['lmg'], { upgraded: true });
    held(g).reserve = 0;
    expect(g.game.focus.cost).toBe(3000);
    press(g);
    expect(g.game.points).toBe(20000 - 3000);
  });

  it('two box weapons and no pistol: it refills whichever is held, and follows a swap', () => {
    const g = atCrate(['lmg', 'smg']);
    expect(g.G.weapon.has('pistol')).toBe(false);
    for (const s of g.G.weapon.slots) s.reserve = 0;
    expect(g.G.weapon.id).toBe('lmg');
    expect(g.game.focus.cost).toBe(TE.crateAmmo.lmg);
    press(g);
    expect(g.G.weapon.slots[0].reserve).toBe(WEAPONS.lmg.maxReserve);
    expect(g.G.weapon.slots[1].reserve).toBe(0);
    g.G.weapon.switchTo(1);
    g.run(1);
    expect(g.game.focus.cost).toBe(WEAPONS.smg.wall.ammo);
    expect(g.game.focus.label).toBe(`${WEAPONS.smg.name} ammo`);
    press(g);
    expect(g.G.weapon.slots[1].reserve).toBe(WEAPONS.smg.maxReserve);
    expect(g.game.points).toBe(20000 - TE.crateAmmo.lmg - WEAPONS.smg.wall.ammo);
  });

  it('short of the price: refused with points, nothing changes', () => {
    const g = atCrate(['lmg'], { points: TE.crateAmmo.lmg - 1 });
    held(g).reserve = 0;
    press(g);
    expect(g.game.lastUse).toMatchObject({ ok: false, reason: 'points' });
    expect(held(g).reserve).toBe(0);
  });

  it('the prompt says what and how much, on a keyboard and on a phone', () => {
    const g = atCrate(['rifle']);
    const f = g.game.focus;
    expect(promptString(f)).toBe(`Press F — ${WEAPONS.rifle.name} ammo · ${WEAPONS.rifle.wall.ammo}`);
    expect(promptString(f, 'touch')).toBe(`Tap BUY: ${WEAPONS.rifle.name} ammo — ${WEAPONS.rifle.wall.ammo}`);
    // the label is the same string every frame (the HUD compares it to redraw only on a change)
    expect(g.game.focus.label).toBe(f.label);
    g.step();
    expect(g.game.focus).toBe(f);
  });

  it('ammoCost (walls and the crate): wall price, else class price; upgraded 3x that, at most 3000', () => {
    const g = atCrate(['battleRifle']);
    expect(ammoCost(g.G.weapon, 'battleRifle')).toBe(TE.crateAmmo.rifle);
    expect(ammoCost(g.G.weapon, 'pistol')).toBe(250);
    expect(ammoCost(g.G.weapon, 'rifle')).toBe(WEAPONS.rifle.wall.ammo);
    g.G.weapon.upgrade();
    expect(ammoCost(g.G.weapon, 'battleRifle')).toBe(2250);
  });
});
