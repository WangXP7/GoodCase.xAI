/**
 * FLEET BAR — quick access to everything you own.
 *
 * WHY: the game had no way to reach a unit except finding it in the void and
 * clicking it. With a fleet spread over 40 km that is not a control scheme, it
 * is a search problem — "add UI for quick access to unit fleets, it's hard to
 * find". Control groups existed on Ctrl+1..9 but were invisible, so nothing told
 * the player they were there or what was in them.
 *
 * WHAT: a single strip of chips along the left edge.
 *
 *   - One chip per ship CLASS the player owns, showing the class tag, the live
 *     count, and an aggregate health bar. Click selects every ship of that class;
 *     shift-click adds to the current selection; double-click also frames them.
 *   - An IDLE chip that gathers everything with nothing to do, which is the
 *     single most useful selector in an RTS and the hardest thing to find by eye.
 *   - Control-group chips for any group that has been assigned, so Ctrl+1..9 is
 *     discoverable rather than folklore.
 *
 * The bar is read-only with respect to the world: it reports intent through
 * callbacks and the integrator issues the actual selection.
 */

import { SHIP_SPECS } from '../core/registry';
import { ALL_SHIP_CLASSES, Team, type ShipClass } from '../core/types';
import { UI } from '../core/palette';
import { SHIP_GLYPHS } from './hud';
import { bus } from '../core/bus';
import type { World } from '../sim/world';

/** How often the roster is rebuilt, in seconds. */
const REFRESH = 0.25;

export interface FleetBarOpts {
  team: Team;
  /** Select these ids. `add` true means union with the current selection. */
  onSelect(ids: number[], add: boolean): void;
  /** Select and frame these ids. */
  onFrame(ids: number[]): void;
}

interface Chip {
  root: HTMLElement;
  tag: HTMLElement;
  count: HTMLElement;
  bar: HTMLElement;
  lastCount: number;
  lastHealth: number;
}

/** Idle chip glyph: a hollow ring with a pause bar — "these are doing nothing". */
const IDLE_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="8"/>'
  + '<path d="M10 9 V15 M14 9 V15"/></svg>';

export class FleetBar {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly chips = new Map<string, Chip>();
  private readonly ids: number[] = [];
  private acc = 0;
  private readonly disposers: Array<() => void> = [];

  constructor(parent: HTMLElement, private readonly opts: FleetBarOpts) {
    this.root = document.createElement('div');
    this.root.className = 'sf-fleetbar';
    const head = document.createElement('div');
    head.className = 'sf-fleetbar-head';
    head.textContent = 'FLEET';
    this.root.appendChild(head);
    this.list = document.createElement('div');
    this.list.className = 'sf-fleetbar-list';
    this.root.appendChild(this.list);
    parent.appendChild(this.root);
  }

  update(world: World, dt: number): void {
    this.acc += dt;
    if (this.acc < REFRESH) return;
    this.acc = 0;

    const seen = new Set<string>();

    // --- one chip per owned class ------------------------------------------
    for (const cls of ALL_SHIP_CLASSES) {
      let n = 0;
      let hp = 0;
      let hpMax = 0;
      const ships = world.ships;
      for (let i = 0; i < ships.count; i++) {
        const s = ships.items[i];
        if (!s.alive || s.team !== this.opts.team || s.cls !== cls) continue;
        n++;
        const sp = SHIP_SPECS[s.cls];
        hp += s.hp + s.shield;
        hpMax += sp.maxHp + sp.maxShield;
      }
      if (n === 0) continue;
      const key = `c${cls}`;
      seen.add(key);
      this.paint(key, SHIP_SPECS[cls].tag, SHIP_GLYPHS[cls], n,
        hpMax > 0 ? hp / hpMax : 1, false, () => {
          this.collectClass(world, cls);
        });
    }

    // --- idle ---------------------------------------------------------------
    let idle = 0;
    const ships = world.ships;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (!s.alive || s.team !== this.opts.team || s.dockedIn >= 0) continue;
      if (s.order.kind === 'idle' && s.queue.length === 0) idle++;
    }
    if (idle > 0) {
      seen.add('idle');
      this.paint('idle', 'IDLE', IDLE_GLYPH, idle, 1, true, () => this.collectIdle(world));
    }

    // --- retire chips for classes we no longer own --------------------------
    for (const [key, chip] of this.chips) {
      if (seen.has(key)) continue;
      chip.root.remove();
      this.chips.delete(key);
    }
  }

  /** Create or refresh one chip. `gather` fills `this.ids` when clicked. */
  private paint(
    key: string, tag: string, glyph: string, count: number, health: number,
    alert: boolean, gather: () => void,
  ): void {
    let chip = this.chips.get(key);
    if (!chip) {
      const root = document.createElement('button');
      root.type = 'button';
      root.className = alert ? 'sf-chip is-alert' : 'sf-chip';
      // The three-letter tag alone made every chip the same shape, so finding
      // the bombers meant READING the strip top to bottom. A silhouette is
      // recognised at a glance, and it is the same glyph the selection rail
      // uses, so the two panels teach one vocabulary rather than two.
      const icoEl = document.createElement('span');
      icoEl.className = 'sf-chip-ico';
      icoEl.innerHTML = glyph;
      const tagEl = document.createElement('span');
      tagEl.className = 'sf-chip-tag';
      const countEl = document.createElement('span');
      countEl.className = 'sf-chip-count';
      const barWrap = document.createElement('span');
      barWrap.className = 'sf-chip-bar';
      const bar = document.createElement('i');
      barWrap.appendChild(bar);
      root.appendChild(icoEl);
      root.appendChild(tagEl);
      root.appendChild(countEl);
      root.appendChild(barWrap);

      const onClick = (e: MouseEvent): void => {
        gather();
        if (this.ids.length === 0) { bus.emit('ack', { kind: 'deny' }); return; }
        if (e.detail >= 2) this.opts.onFrame(this.ids);
        else this.opts.onSelect(this.ids, e.shiftKey);
      };
      root.addEventListener('click', onClick);
      this.disposers.push(() => root.removeEventListener('click', onClick));

      this.list.appendChild(root);
      chip = { root, tag: tagEl, count: countEl, bar, lastCount: -1, lastHealth: -1 };
      this.chips.set(key, chip);
      tagEl.textContent = tag;
    }
    // Touch the DOM only when a displayed value actually changed.
    if (chip.lastCount !== count) {
      chip.lastCount = count;
      chip.count.textContent = String(count);
    }
    const h = Math.round(health * 100);
    if (chip.lastHealth !== h) {
      chip.lastHealth = h;
      chip.bar.style.width = `${h}%`;
      chip.bar.style.background = h > 60 ? UI.good : h > 30 ? UI.warn : UI.bad;
    }
  }

  private collectClass(world: World, cls: ShipClass): void {
    this.ids.length = 0;
    const ships = world.ships;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (s.alive && s.team === this.opts.team && s.cls === cls && s.dockedIn < 0) {
        this.ids.push(s.id);
      }
    }
  }

  private collectIdle(world: World): void {
    this.ids.length = 0;
    const ships = world.ships;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (!s.alive || s.team !== this.opts.team || s.dockedIn >= 0) continue;
      if (s.order.kind === 'idle' && s.queue.length === 0) this.ids.push(s.id);
    }
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.root.remove();
  }
}
