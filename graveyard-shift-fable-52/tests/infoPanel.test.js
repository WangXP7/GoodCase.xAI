import { describe, it, expect, beforeAll } from 'vitest';
import { tuning } from '../src/game/tuning.js';
import { shortWeaponName, formatPoints } from '../src/ui/format.js';
import { crateAmmoPrice } from '../src/game/purchases.js';
import { CONTROLS } from '../src/ui/format.js';
import { crateText, numbersIn, TABS, infoContent, PERK_TEXT, POWERUP_TEXT, WEAPON_TEXT, CLASS_LABELS, weaponGroups, perkItems, howItems } from '../src/ui/infoContent.js';

describe('info panel content follows the game tables', () => {
  const T = tuning;
  it('has every tab, in order', () => {
    expect(TABS.map((t) => t.id)).toEqual(['controls', 'how', 'perks', 'weapons']);
  });
  it('lists every machine with its name and cost from the table', () => {
    const perks = perkItems();
    expect(perks.map((p) => p.id)).toEqual(T.economy.machineKinds);
    for (const p of perks) {
      expect(p.name).toBe(T.economy.machines[p.id].name);
      expect(p.cost).toBe(T.economy.machines[p.id].cost);
    }
  });
  it('has a sentence for every machine, power-up and weapon id, and a heading for every class', () => {
    for (const id of T.economy.machineKinds) expect(PERK_TEXT[id], `perk text for ${id}`).toBeTypeOf('function');
    for (const id of T.economy.powerups.kinds) expect(POWERUP_TEXT[id], `power-up text for ${id}`).toBeTypeOf('function');
    for (const id of T.weapons.ids) {
      expect(WEAPON_TEXT[id], `weapon text for ${id}`).toBeTypeOf('function');
      expect(CLASS_LABELS[T.weapons.table[id].cls], `class label for ${T.weapons.table[id].cls}`).toBeTruthy();
    }
    for (const p of perkItems()) expect(p.text.length).toBeGreaterThan(10);
  });
  it('lists every weapon once, under its class, with its upgraded name and a source', () => {
    const groups = weaponGroups();
    const seen = groups.flatMap((g) => g.items.map((i) => i.id));
    expect([...seen].sort()).toEqual([...T.weapons.ids].sort());
    for (const g of groups) for (const w of g.items) {
      const d = T.weapons.table[w.id];
      expect(w.cls).toBe(g.cls);
      expect(w.name).toBe(d.name);
      expect(w.upgraded).toBe(d.upgraded.name);
      expect(w.sources.length, `${w.id} has a source`).toBeGreaterThan(0);
      expect(w.text.length).toBeGreaterThan(10);
      for (const k of ['damage', 'rate', 'mag']) {
        expect(w.stats[k].fraction).toBeGreaterThan(0);
        expect(w.stats[k].fraction).toBeLessThanOrEqual(1);
      }
    }
  });
  it('reads where a weapon comes from out of the table', () => {
    const byId = Object.fromEntries(weaponGroups().flatMap((g) => g.items).map((w) => [w.id, w]));
    expect(byId.pistol.sources.map((s) => s.kind)).toContain('start');
    for (const id of T.weapons.ids) {
      const d = T.weapons.table[id];
      const kinds = byId[id].sources.map((s) => s.kind);
      expect(kinds.includes('box')).toBe(d.box > 0);
      expect(kinds.includes('wall')).toBe(!!(d.wall && d.wall.cost > 0));
    }
  });
  it('builds damage bars from the table: every pellet counts', () => {
    const pump = weaponGroups().flatMap((g) => g.items).find((w) => w.id === 'pump');
    expect(pump.stats.damage.value).toBe(T.weapons.table.pump.damage * T.weapons.table.pump.pellets);
    expect(pump.stats.damage.text).toBe(`${T.weapons.table.pump.damage}×${T.weapons.table.pump.pellets}`);
  });
  it('follows a changed table rather than copied numbers', () => {
    const T2 = { ...T, economy: { ...T.economy, box: { ...T.economy.box, cost: 1234 }, machines: { ...T.economy.machines, longHaul: { ...T.economy.machines.longHaul, cost: 4321, speed: 1.5 } } } };
    expect(howItems(T2).find((i) => i.id === 'box').text).toContain('1 234');
    const lh = perkItems(T2).find((p) => p.id === 'longHaul');
    expect(lh.cost).toBe(4321);
    expect(lh.text).toContain('50%');
  });
  it('says nothing about how long an upgrade takes', () => {
    const c = JSON.stringify(infoContent());
    expect(c).not.toMatch(/upgrad\w* (takes|in |after)|seconds? to upgrade/i);
  });
  it('prices the ammo crate from crateAmmoPrice, for any gun', () => {
    const text = crateText();
    expect(text).toMatch(/gun in your hand/);
    expect(text).not.toMatch(/pistol/i);
    const allowed = new Set([T.economy.crateUpgraded.max]);
    for (const id of T.weapons.ids) allowed.add(crateAmmoPrice(id, false));
    const nums = (text.match(/\d[\d\u00a0 ]*\d|\d/g) || []).map((n) => Number(n.replace(/[\u00a0 ]/g, '')));
    expect(nums.length).toBeGreaterThan(1);
    for (const n of nums) expect(allowed.has(n), `${n} is in the tables`).toBe(true);
    expect(text).toContain('three times');
    expect(text).toContain(formatPoints(T.economy.crateUpgraded.max));
  });
  it('shows every gun its stock and upgraded ammo price', () => {
    for (const w of weaponGroups().flatMap((g) => g.items)) {
      expect(w.ammo).toEqual({ stock: crateAmmoPrice(w.id, false), upgraded: crateAmmoPrice(w.id, true) });
      expect(w.ammo.upgraded).toBeLessThanOrEqual(T.economy.crateUpgraded.max);
    }
  });
  it('uses the Controls tab key text for searching, and names the other containers', () => {
    const c = CONTROLS.find((x) => x.id === 'interact');
    const s = howItems().find((i) => i.id === 'search').text;
    expect(s).toContain(c.key);
    expect(s).toContain(c.touch);
    expect(s).toMatch(/locker/);
  });
  it('explains bullets passing through and zombies hitting you as you run past', () => {
    const ids = howItems().map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['pierce', 'swipe']));
  });
  it('shortens an upgraded name to its nickname', () => {
    expect(shortWeaponName('Ostrander 308 "Iron Vigil"')).toBe('Iron Vigil');
    expect(shortWeaponName('Wren 9')).toBe('Wren 9');
    for (const id of T.weapons.ids) expect(shortWeaponName(T.weapons.table[id].upgraded.name).length).toBeLessThan(T.weapons.table[id].upgraded.name.length);
  });
  it('lists the power-ups', () => {
    const drops = howItems().find((i) => i.id === 'drops');
    expect(drops.list.map((p) => p.id)).toEqual(T.economy.powerups.kinds);
    for (const p of drops.list) expect(p.text.length).toBeGreaterThan(5);
  });
});

// A just-enough DOM so the panel can be built and driven in node.
class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.attrs = {}; this.listeners = {}; this.dataset = {}; this.style = {}; this.className = ''; this._text = ''; this.hidden = false; this.tabIndex = -1; this.scrollTop = 0; this.clientHeight = 300; this.scrollHeight = 900; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  set textContent(v) { this._text = v; this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  get firstChild() { return this.children[0]; }
  after() {}
  focus() { global.__focus = this; }
  scrollBy({ top }) { this.scrollTop = Math.max(0, this.scrollTop + top); }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matches(sel)) return n; return null; }
  matches(sel) { return sel.startsWith('.') && this.className.split(' ').includes(sel.slice(1)); }
  all(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) c.all?.(pred, out); return out; }
}
class Text_ { constructor(t) { this._t = t; } get textContent() { return this._t; } }
const fire = (target, root, type, props) => {
  const e = { target, type, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...props };
  for (let n = target; n; n = n.parent) for (const fn of n.listeners[type] || []) fn(e);
  return e;
};

describe('info panel DOM', () => {
  let panel; let root;
  beforeAll(async () => {
    globalThis.Element = Node_;
    globalThis.document = { createElement: (t) => new Node_(t), createTextNode: (t) => new Text_(t) };
    const { createInfoPanel } = await import('../src/ui/infoPanel.js');
    panel = createInfoPanel();
    root = panel.el;
  });
  const tabs = () => root.all((n) => n.attrs.role === 'tab');
  const sheets = () => root.all((n) => n.attrs.role === 'tabpanel');

  it('has tab roles wired to their panels', () => {
    expect(root.all((n) => n.attrs.role === 'tablist')).toHaveLength(1);
    expect(tabs().map((t) => t.textContent)).toEqual(TABS.map((t) => t.label));
    for (const t of tabs()) {
      const s = sheets().find((x) => x.id === t.attrs['aria-controls']);
      expect(s, `panel for ${t.textContent}`).toBeTruthy();
      expect(s.attrs['aria-labelledby']).toBe(t.id);
    }
    expect(root.all((n) => n.attrs['aria-label'] === 'Game information')).toHaveLength(1);
  });
  it('shows Controls first, one tab in the tab order', () => {
    expect(tabs().map((t) => t.attrs['aria-selected'])).toEqual(['true', 'false', 'false', 'false']);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(sheets().map((s) => s.hidden)).toEqual([false, true, true, true]);
  });
  it('moves between tabs with the arrow keys and wraps', () => {
    const t = tabs();
    let e = fire(t[0], root, 'keydown', { key: 'ArrowRight' });
    expect(e.defaultPrevented && e.stopped).toBe(true);
    expect(panel.selected).toBe('how');
    expect(global.__focus).toBe(t[1]);
    fire(t[1], root, 'keydown', { key: 'End' });
    expect(panel.selected).toBe('weapons');
    fire(t[3], root, 'keydown', { key: 'ArrowRight' });
    expect(panel.selected).toBe('controls');
    fire(t[0], root, 'keydown', { key: 'ArrowLeft' });
    expect(panel.selected).toBe('weapons');
    expect(sheets().map((s) => s.hidden)).toEqual([true, true, true, false]);
  });
  it('opens a tab on click and remembers it for the next panel', async () => {
    fire(tabs()[2], root, 'click', {});
    expect(panel.selected).toBe('perks');
    const { createInfoPanel } = await import('../src/ui/infoPanel.js');
    const other = createInfoPanel();
    expect(other.el.all((n) => n.attrs.role === 'tab').map((t) => t.attrs['aria-selected'])).toEqual(['false', 'false', 'true', 'false']);
    fire(other.el.all((n) => n.attrs.role === 'tab')[1], other.el, 'click', {});
    expect(tabs().map((t) => t.attrs['aria-selected'])).toEqual(['false', 'true', 'false', 'false']);
  });
  it('scrolls a focused panel with the arrows and returns to the tabs from the top', () => {
    const s = sheets()[1];
    let e = fire(s, root, 'keydown', { key: 'ArrowDown' });
    expect(e.defaultPrevented && e.stopped).toBe(true);
    expect(s.scrollTop).toBeGreaterThan(0);
    s.scrollTop = 0;
    fire(s, root, 'keydown', { key: 'ArrowUp' });
    expect(global.__focus).toBe(tabs()[1]);
  });
  it('prints every weapon, perk and class in the panel text', () => {
    const text = root.textContent;
    for (const id of tuning.weapons.ids) {
      expect(text).toContain(tuning.weapons.table[id].name);
      expect(text).toContain(tuning.weapons.table[id].upgraded.name);
    }
    for (const id of tuning.economy.machineKinds) expect(text).toContain(tuning.economy.machines[id].name);
    for (const id of tuning.economy.powerups.kinds) expect(text).toContain(tuning.economy.powerups.names[id]);
    for (const w of root.all((n) => n.matches('.gs-weap'))) expect(tuning.weapons.ids).toContain(w.dataset.weapon);
    expect(root.all((n) => n.matches('.gs-weap'))).toHaveLength(tuning.weapons.ids.length);
  });
});
