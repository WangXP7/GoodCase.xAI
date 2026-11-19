/**
 * THE HUD — Starfall's DOM interface layer.
 *
 * WHAT: a fixed chrome (top status bar, left selection panel, bottom command
 * bar, right event log) plus a worldspace marker overlay (selection brackets,
 * health pips, attack reticles, off-screen combat arrows) driven from the sim
 * once per rendered frame.
 *
 * WHY DOM AND NOT CANVAS: text is the bulk of an RTS HUD, and the browser's
 * text stack beats anything hand-rolled on a canvas at 4K — subpixel metrics,
 * font fallback, ellipsis, backdrop blur, clip-path chamfers all come free and
 * stay crisp at any device pixel ratio. The cost is DOM churn, which this
 * module avoids by construction: every node is created once in the ctor and
 * `update()` only writes a property when the value it derives has actually
 * changed (see `Txt` / `Bar` / `Marker`, which each cache their last write).
 *
 * The ONE exception is the health-pip overlay, which is a single 2D canvas.
 * Pips are per-hull, unbounded in count and sized from the projected hull
 * radius, so as DOM they were N nodes of fixed size scattering fixed-width
 * dashes over the frame (critique round 1, ui: "the single worst-looking
 * element in the build"). One canvas draws 200 correctly-sized, hull-anchored
 * pips for the cost of 200 fillRects and zero nodes. See `drawPips`.
 *
 * LAYOUT GRID: every region this module owns is placed off the tokens declared
 * at the top of `src/style.css` — `--sf-inset` (screen safe area), `--sf-gut`
 * (gutter), `--sf-topbar` (status strip height), `--sf-col` (right rail width)
 * and the `--sf-safe-*` channel edges. Nothing here hard-codes an inset, and
 * the play area's focal centre is left clear by construction: the status strip
 * hangs off the top edge, the log and selection panel occupy the right rail,
 * the command bar sits on the bottom baseline inside the channel between the
 * production panel and the right rail. (critique round 1, ui: "the HUD has no
 * shared grid".)
 *
 * The HUD is READ-ONLY with respect to the world. It never mutates `World`;
 * player intent leaves through `opts.onCommand` and the caller decides what a
 * command means. The command vocabulary is:
 *
 *   'move' | 'attack' | 'stop' | 'harvest' | 'dock'   arg: undefined
 *   'formation'                                       arg: Formation
 *   'stance'                                          arg: Stance
 *   'select'                                          arg: number[] (ship ids)
 *   'focus'                                           arg: number[] (ship ids)
 *
 * `'move'` and `'attack'` are MODE requests — the caller is expected to arm a
 * targeting cursor, not to teleport anything.
 *
 * Layout, colour and motion live in `src/style.css`; this file only ever
 * toggles class names and writes numbers.
 */

import * as THREE from 'three';
import type { UiLayer } from '../core/contracts';
import { bus } from '../core/bus';
import { authorLinks, iconLink } from './links';
import { CONFIG } from '../core/config';
import { PALETTES, UI } from '../core/palette';
import { SHIP_SPECS } from '../core/registry';
import {
  Formation,
  HullSize,
  SHIP_CLASS_COUNT,
  ShipClass,
  Stance,
  Team,
  type GameEvents,
} from '../core/types';
import type { World } from '../sim/world';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Marker pool sizes. Beyond these the overlay degrades by dropping markers,
 *  never by allocating — 200 selected interceptors still cost a fixed budget. */
const MAX_BRACKETS = 128;
const MAX_RETICLES = 12;
const MAX_ARROWS = 10;

// -- health pips (canvas overlay) -------------------------------------------
// Critique round 1: pips were fixed-size DOM nodes with percentage fills, so a
// 20 px fighter and a 2 km capital both got the same 40 px dash, and 72 of them
// scattered across the frame as disconnected green/amber/red bars. Every number
// below exists to make a pip a function of the hull's PROJECTED size and to
// keep a fleet-scale frame quiet.

/** Hard ceiling on pips drawn in one frame. Capitals are drawn first, so an
 *  overflowing swarm loses fighter pips, never a mothership pip. */
const MAX_PIPS = 96;
/** Small hulls are additionally capped: a 200-fighter furball must not turn
 *  the frame into a bar chart. */
const MAX_SMALL_PIPS = 14;
/** Projected hull radius, px, below which a hull is too small to carry a pip. */
const PIP_MIN_RPX = 7;
/** Bar length clamp, px. Tracks projected hull diameter between these. */
const PIP_W_MIN = 14;
const PIP_W_MAX = 58;
/** Projected diameter → bar length. Well under 1 so the pip always reads
 *  narrower than the hull it belongs to and never becomes the subject. */
const PIP_W_PER_D = 0.66;
/** Gap from the bottom of the projected bounding sphere to the bar, px. Short:
 *  the pip has to read as attached, not as a caption floating nearby. */
const PIP_GAP = 5;
/** Health fraction under which a hull is "damaged enough to be worth a pip".
 *  Strike craft die too fast for a 96% bar to be information. */
const PIP_HURT_SMALL = 0.9;
const PIP_HURT_BIG = 0.985;
/** Above this selection size, undamaged selected hulls stop drawing pips —
 *  a 200-ship box-select must not paint 200 full bars. */
const PIP_SEL_MAX = 24;
/** Bar and rule thicknesses, CSS px, before the 4K scale-up. Deliberately
 *  hairline — the first canvas pass used a 3 px bar inside a padded dark plate
 *  and the unfilled remainder read as a black slab over the battle. */
const PIP_H = 2.2;
const PIP_SH_H = 1.2;

// -- event log ---------------------------------------------------------------
// Critique round 1: "un-aggregated debug spam — five of six lines are '<CLASS>
// LOST' in identical amber". Fewer slots, a merge window that rolls repeats
// into one counted line, severity colour, and a fade that actually completes.

/** Event-log capacity and lifetime, seconds. */
const LOG_LINES = 6;
const LOG_HOLD = 8.0;
/** Short on purpose: a line that sits at 30% opacity for two seconds reads as
 *  a rendering bug, not as decay. */
const LOG_FADE = 0.45;
/** A repeat of the same event key inside this window bumps the live line's
 *  count instead of pushing a new one. */
const LOG_MERGE = 6.0;

/** Seconds between full fleet-strength sweeps (O(ship pool), not per-frame). */
const STRENGTH_PERIOD = 0.3;

/** Seconds a burst of losses is aggregated before it becomes one log line.
 *  Longer than round 1 (1.4 s) so a single engagement produces one line. */
const LOSS_FLUSH = 2.6;

/** Supply ratio at which the supply readout goes amber / red. */
const SUPPLY_WARN = 0.85;
const SUPPLY_FULL = 0.99;

/** Mothership hull fraction below which the critical banner latches on. */
const CRITICAL_HULL = 0.35;

/** Combat hotspot bookkeeping for off-screen indicators. */
const MAX_HOTSPOTS = 8;
const HOTSPOT_MERGE = 2600; // metres — hits inside this reinforce one hotspot
const HOTSPOT_DECAY = 0.55; // weight lost per second
const HOTSPOT_SHOW = 0.35; // weight above which an arrow is drawn

/** Resource counter easing — units per second is wrong (a 5000 delta would
 *  crawl), so ease proportionally with a floor so the last few units land. */
const RES_EASE = 5.5;
const RES_MIN_RATE = 40;

// ---------------------------------------------------------------------------
// Projection — shared, allocation-free
// ---------------------------------------------------------------------------

/** Result of `projectToScreen`. Reused; copy anything you need to keep. */
/** Seconds since a hit that still counts as "under fire" in the ops readout. */
const UNDER_FIRE_WINDOW = 4;
/** Scratch for assembling the ops line — the HUD never allocates per frame. */
const _ops: string[] = [];

export interface ScreenPoint {
  /** Pixel x within the HUD root, valid whenever `behind` is false. */
  x: number;
  /** Pixel y within the HUD root. */
  y: number;
  /** Normalised device x, sign-corrected so it always points at the subject. */
  ndcX: number;
  /** Normalised device y, sign-corrected. */
  ndcY: number;
  /** Distance from the camera along its view axis, metres. */
  dist: number;
  /** True when the point is behind the near plane (x/y are meaningless). */
  behind: boolean;
  /** True when the point lands inside the viewport rectangle. */
  onScreen: boolean;
}

const _pv = new THREE.Vector3();

/**
 * Project a world point into HUD pixels.
 *
 * Two-stage on purpose: the world→view transform tells us the sign of the
 * depth BEFORE the perspective divide, which is the only reliable way to know
 * a point is behind the camera (after the divide, a point at -w mirrors into
 * the frame and looks perfectly valid). Points behind the camera still get a
 * usable direction, sign-flipped back, so edge arrows can point at them.
 *
 * Allocation-free: uses one module-scope scratch vector and writes into `out`.
 * `camera.matrixWorldInverse` must be current — `Hud.update` refreshes it.
 */
export function projectToScreen(
  camera: THREE.Camera,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  out: ScreenPoint,
): ScreenPoint {
  _pv.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  // View space is right-handed with the camera looking down -Z.
  const viewZ = _pv.z;
  const behind = viewZ > -1e-4;
  out.dist = -viewZ;
  out.behind = behind;
  _pv.applyMatrix4(camera.projectionMatrix); // divides by w = -viewZ
  const s = behind ? -1 : 1;
  const nx = _pv.x * s;
  const ny = _pv.y * s;
  out.ndcX = nx;
  out.ndcY = ny;
  out.x = (nx * 0.5 + 0.5) * w;
  out.y = (-ny * 0.5 + 0.5) * h;
  out.onScreen = !behind && nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1;
  return out;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Constructor options for {@link Hud}. */
export interface HudOptions {
  /** Player intent sink. See the module header for the command vocabulary. */
  onCommand(cmd: string, arg?: unknown): void;
}

// ---------------------------------------------------------------------------
// Tiny DOM helpers — every one of these exists to avoid redundant writes.
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.appendChild(n);
  return n;
}

/** A text node whose content is only touched when the string changes. */
class Txt {
  private last: string | null = null;
  constructor(readonly node: HTMLElement) {}
  set(s: string): void {
    if (s === this.last) return;
    this.last = s;
    this.node.textContent = s;
  }
}

/** A fill bar. Width writes are quantised to 0.25% to kill style thrash. */
class Bar {
  private lastW = -1;
  private lastCls: string | null = null;
  readonly fill: HTMLElement;
  constructor(readonly node: HTMLElement, cls = '') {
    this.fill = el('i', cls, node);
  }
  set(frac: number): void {
    const w = Math.round(Math.max(0, Math.min(1, frac)) * 400) * 0.25;
    if (w === this.lastW) return;
    this.lastW = w;
    this.fill.style.width = w + '%';
  }
  /** Swap the state class on the owning bar element ('', 'is-warn', ...). */
  state(cls: string): void {
    if (cls === this.lastCls) return;
    this.lastCls = cls;
    this.node.className = 'sf-bar' + (cls ? ' ' + cls : '');
  }
}

/**
 * A pooled worldspace marker. Holds its own last-written transform so a static
 * camera writes nothing at all. Transform strings are the one unavoidable
 * per-frame allocation in this module — the change gate keeps them rare.
 */
class Marker {
  visible = false;
  private lx = -1e9;
  private ly = -1e9;
  private ls = -1e9;
  private lrot = -1e9;
  constructor(readonly node: HTMLElement) {}

  place(x: number, y: number, scale: number): void {
    if (!this.visible) {
      this.visible = true;
      this.node.style.visibility = 'visible';
    }
    // Sub-half-pixel and sub-1% moves are invisible; skip the write.
    if (Math.abs(x - this.lx) < 0.4 && Math.abs(y - this.ly) < 0.4 && Math.abs(scale - this.ls) < 0.01) return;
    this.lx = x;
    this.ly = y;
    this.ls = scale;
    this.node.style.transform =
      scale === 1
        ? `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`
        : `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${scale.toFixed(3)})`;
  }

  /** Rotate an inner child (arrows) without disturbing the outer translate. */
  rotate(child: HTMLElement, deg: number): void {
    if (Math.abs(deg - this.lrot) < 1) return;
    this.lrot = deg;
    child.style.transform = `rotate(${deg.toFixed(0)}deg)`;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.node.style.visibility = 'hidden';
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Thousands-separated integer, e.g. 12 400 → "12 400". Thin space, no comma:
 *  commas read as decimal points to half the planet and this is a HUD. */
function fmtInt(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  const s = String(v);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
    out += s[i];
  }
  return out;
}

/** Compact strength readout: 940, 12.4k, 180k. */
function fmtCompact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n / 1000) + 'k';
}

/** mm:ss elapsed clock. Hours roll into the minute field on purpose — a match
 *  that runs past 99 minutes is a stalemate, not a formatting problem. */
function fmtClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

// ---------------------------------------------------------------------------
// Static tables
// ---------------------------------------------------------------------------

/** Selection-panel ordering: heaviest hull first, economy last. Homeworld's
 *  reading order — you scan for capitals, then strike craft, then collectors. */
const GROUP_ORDER: ShipClass[] = [
  ShipClass.Mothership,
  ShipClass.Carrier,
  ShipClass.HeavyCruiser,
  ShipClass.Destroyer,
  ShipClass.AssaultFrigate,
  ShipClass.IonFrigate,
  ShipClass.MissileCorvette,
  ShipClass.AssaultCorvette,
  ShipClass.Bomber,
  ShipClass.Interceptor,
  ShipClass.Scout,
  ShipClass.ResourceRefinery,
  ShipClass.ResourceCollector,
];

/** How long a now-playing credit stays on screen, seconds. */
const NOW_PLAYING_SECONDS = 7;

const SVG_HEAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">';

/**
 * Line glyph per hull, drawn head-on so silhouettes stay distinguishable.
 * Exported because the fleet bar needs the SAME glyph the selection rail uses —
 * a second set drawn to a different key would teach the player two vocabularies
 * for one thing.
 */
export const SHIP_GLYPHS: Record<ShipClass, string> = {
  [ShipClass.Scout]: SVG_HEAD + '<path d="M12 4 L20 19 L12 15.5 L4 19 Z"/></svg>',
  [ShipClass.Interceptor]: SVG_HEAD + '<path d="M12 3 L21 19 L12 15 L3 19 Z"/><path d="M12 8 V15"/></svg>',
  [ShipClass.Bomber]: SVG_HEAD + '<path d="M12 4 L20 18 L12 16 L4 18 Z"/><path d="M8 18 V21 M16 18 V21"/></svg>',
  [ShipClass.AssaultCorvette]: SVG_HEAD + '<path d="M12 3 L17 9 V20 H7 V9 Z"/><path d="M7 13 H3 M17 13 H21"/></svg>',
  [ShipClass.MissileCorvette]: SVG_HEAD + '<path d="M12 3 L17 9 V20 H7 V9 Z"/><path d="M7 11 H3 V16 M17 11 H21 V16"/></svg>',
  [ShipClass.IonFrigate]: SVG_HEAD + '<path d="M12 2 L16 7 V17 L12 22 L8 17 V7 Z"/><path d="M12 2 V22"/></svg>',
  [ShipClass.AssaultFrigate]: SVG_HEAD + '<path d="M12 2 L16 7 V17 L12 22 L8 17 V7 Z"/><path d="M8 10 H16 M8 14 H16"/></svg>',
  [ShipClass.Destroyer]: SVG_HEAD + '<path d="M12 2 L15 8 V20 H9 V8 Z"/><path d="M9 10 L4 13 V19 H9"/><path d="M15 10 L20 13 V19 H15"/></svg>',
  [ShipClass.HeavyCruiser]: SVG_HEAD + '<path d="M12 2 L15.5 8 V21 H8.5 V8 Z"/><path d="M8.5 10 L3 14 V21 H8.5"/><path d="M15.5 10 L21 14 V21 H15.5"/><path d="M12 5 V21"/></svg>',
  [ShipClass.ResourceCollector]: SVG_HEAD + '<path d="M6 7 H18 V14 H6 Z"/><path d="M9 14 V19 H15 V14"/><path d="M12 3 V7"/></svg>',
  [ShipClass.ResourceRefinery]: SVG_HEAD + '<path d="M3 21 V11 L9 14 V11 L15 14 V6 H21 V21 Z"/><path d="M7 21 V17 M13 21 V17"/></svg>',
  [ShipClass.Carrier]: SVG_HEAD + '<path d="M12 2 L16 9 V21 H8 V9 Z"/><path d="M8 11 H3 V20 H8"/><path d="M16 11 H21 V20 H16"/></svg>',
  [ShipClass.Mothership]: SVG_HEAD + '<path d="M12 1 L17 8 V22 H7 V8 Z"/><path d="M7 12 H2 V21 H7"/><path d="M17 12 H22 V21 H17"/><path d="M9.5 8 H14.5 M9.5 15 H14.5"/></svg>',
};

/** Glyph header for the command-bar vector icons. Filled shapes are avoided:
 *  the whole HUD is hairline stroke work and a solid icon would out-shout the
 *  panel rules. */
const GLY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">';
/** Formation/stance glyphs read as arrangements, so those DO use dots. */
const GLYF = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">';

interface CmdDef {
  cmd: string;
  key: string;
  label: string;
  /** 24×24 vector face. Critique round 1: "fourteen visually identical
   *  buttons ... no icons, no state, no context". */
  icon: string;
  tipTitle: string;
  tipBody: string;
}

/**
 * KEY HINTS ARE DISPLAY ONLY.
 *
 * `src/input/controls.ts` owns every keyboard binding in the game; the HUD
 * deliberately installs no `keydown` handler of its own, because two listeners
 * on the same key would issue every order twice. The strings below mirror the
 * bindings that module already implements — if a binding moves there, move the
 * label here too.
 */

const ORDER_BUTTONS: CmdDef[] = [
  {
    cmd: 'move', key: 'M', label: 'Move',
    icon: GLY + '<path d="M12 3 V19"/><path d="M8 15 L12 19 L16 15"/><path d="M5 21 H19"/></svg>',
    tipTitle: 'Move',
    tipBody: 'Fly the selection to a point. Hold and drag vertically at the cursor to set altitude before releasing.',
  },
  {
    cmd: 'attack', key: 'A', label: 'Attack',
    icon: GLY + '<circle cx="12" cy="12" r="7"/><path d="M12 1 V6 M12 18 V23 M1 12 H6 M18 12 H23"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
    tipTitle: 'Attack',
    tipBody: 'Force-fire a target, or attack-move to a point and engage anything hostile on the way.',
  },
  {
    cmd: 'stop', key: 'S', label: 'Stop',
    icon: GLY + '<rect x="5" y="5" width="14" height="14"/><path d="M9 9 H15 V15 H9 Z"/></svg>',
    tipTitle: 'Stop',
    tipBody: 'Cancel every queued order and hold station. Stance still governs whether they return fire.',
  },
  {
    cmd: 'harvest', key: 'H', label: 'Harvest',
    icon: GLY + '<path d="M12 3 L18 7 L16 14 H8 L6 7 Z"/><path d="M9 14 V19 H15 V14"/><path d="M4 21 H20"/></svg>',
    tipTitle: 'Harvest',
    tipBody: 'Send collectors to the nearest worked resource field and cycle cargo automatically.',
  },
  {
    cmd: 'dock', key: 'D', label: 'Dock',
    icon: GLY + '<path d="M4 4 V9 M4 4 H9 M20 4 V9 M20 4 H15 M4 20 V15 M4 20 H9 M20 20 V15 M20 20 H15"/><path d="M12 8 V16 M9 13 L12 16 L15 13"/></svg>',
    tipTitle: 'Dock',
    tipBody: 'Return to the nearest carrier or mothership to repair, rearm and refuel.',
  },
];

/** Formation glyphs are literal dot arrangements — the shape of the formation
 *  is the icon, which is why the three-letter tags could be demoted to the
 *  tooltip and the current name promoted to the group header. */
const FORMATIONS: Array<{ f: Formation; tag: string; key: string; name: string; body: string; icon: string }> = [
  {
    f: Formation.Delta, tag: 'DLT', key: '1', name: 'Delta',
    body: 'Tight arrowhead. Best transit speed, poor spread against splash.',
    icon: GLYF + '<circle cx="12" cy="6" r="2"/><circle cx="7" cy="13" r="2"/><circle cx="17" cy="13" r="2"/><circle cx="12" cy="18" r="2"/></svg>',
  },
  {
    f: Formation.Broad, tag: 'BRD', key: '2', name: 'Broad',
    body: 'Wide echelon. Every hull keeps a clean firing arc forward.',
    icon: GLYF + '<circle cx="12" cy="8" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="2.6" cy="16" r="1.7"/><circle cx="21.4" cy="16" r="1.7"/></svg>',
  },
  {
    f: Formation.Wall, tag: 'WAL', key: '3', name: 'Wall',
    body: 'Flat line abreast. Maximum broadside, minimum depth.',
    icon: GLYF + '<circle cx="4" cy="12" r="2"/><circle cx="9.3" cy="12" r="2"/><circle cx="14.7" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>',
  },
  {
    f: Formation.Sphere, tag: 'SPH', key: '4', name: 'Sphere',
    body: 'Shell around the centre of mass. Escort posture for capitals.',
    icon: GLYF + '<circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="4.6" r="1.7"/><circle cx="12" cy="19.4" r="1.7"/><circle cx="4.6" cy="12" r="1.7"/><circle cx="19.4" cy="12" r="1.7"/><circle cx="6.8" cy="6.8" r="1.4"/><circle cx="17.2" cy="17.2" r="1.4"/><circle cx="17.2" cy="6.8" r="1.4"/><circle cx="6.8" cy="17.2" r="1.4"/></svg>',
  },
  {
    f: Formation.Claw, tag: 'CLW', key: '5', name: 'Claw',
    body: 'Split pincer. Splits fire across two approach vectors.',
    icon: GLYF + '<circle cx="4" cy="6" r="1.8"/><circle cx="8" cy="11" r="1.8"/><circle cx="11" cy="17" r="1.8"/><circle cx="20" cy="6" r="1.8"/><circle cx="16" cy="11" r="1.8"/><circle cx="13.6" cy="17" r="1.4"/></svg>',
  },
  {
    f: Formation.Line, tag: 'LIN', key: '6', name: 'Line',
    body: 'Column astern. Narrow profile through contested space.',
    icon: GLYF + '<circle cx="12" cy="4" r="2"/><circle cx="12" cy="9.3" r="2"/><circle cx="12" cy="14.7" r="2"/><circle cx="12" cy="20" r="2"/></svg>',
  },
];

const STANCES: Array<{ s: Stance; tag: string; key: string; name: string; body: string; icon: string }> = [
  {
    s: Stance.Aggressive, tag: 'AGR', key: 'Z', name: 'Aggressive',
    body: 'Break formation to chase anything in sensor range.',
    icon: GLY + '<path d="M5 16 L12 7 L19 16"/><path d="M5 21 L12 12 L19 21"/></svg>',
  },
  {
    s: Stance.Neutral, tag: 'NEU', key: 'X', name: 'Neutral',
    body: 'Hold the order, engage whatever comes inside weapons range.',
    icon: GLY + '<path d="M5 15 L12 8 L19 15"/><path d="M4 20 H20"/></svg>',
  },
  {
    s: Stance.Passive, tag: 'PAS', key: 'C', name: 'Passive',
    body: 'Return fire only. Never breaks off to pursue.',
    icon: GLY + '<path d="M12 3 L20 6 V12 C20 17 16 20 12 21.5 C8 20 4 17 4 12 V6 Z"/></svg>',
  },
  {
    s: Stance.Evasive, tag: 'EVA', key: 'V', name: 'Evasive',
    body: 'Do not fire. Run from contact and rejoin the fleet.',
    icon: GLY + '<path d="M4 19 C9 19 8 5 13 5 H20"/><path d="M17 2 L20 5 L17 8"/><path d="M4 12 H9"/></svg>',
  },
];

const ORDER_LABEL: Record<string, string> = {
  idle: 'holding',
  move: 'moving',
  attackMove: 'attack move',
  attack: 'engaging',
  guard: 'guarding',
  harvest: 'harvesting',
  dock: 'docking',
  launch: 'launching',
  formUp: 'forming up',
};

/** Fleet value of a hull. The mothership costs nothing to build but is worth
 *  the whole match, so it gets a synthetic value or strength reads as zero. */
function shipValue(cls: ShipClass): number {
  const sp = SHIP_SPECS[cls];
  return sp.cost > 0 ? sp.cost : 8000;
}

/** True if the hull is small enough to dock inside a carrier or mothership. */
function dockable(cls: ShipClass): boolean {
  const sz = SHIP_SPECS[cls].size;
  return sz === HullSize.Fighter || sz === HullSize.Corvette || sz === HullSize.Utility;
}

// ---------------------------------------------------------------------------
// Internal row / line records
// ---------------------------------------------------------------------------

interface GroupRow {
  cls: ShipClass;
  node: HTMLElement;
  name: Txt;
  count: Txt;
  bar: Bar;
  shown: boolean;
}

interface LogLine {
  node: HTMLElement;
  time: Txt;
  /** "3×" repeat badge, blank while count === 1. */
  tally: Txt;
  text: Txt;
  born: number;
  used: boolean;
  lastOpacity: number;
  kind: string;
  /** Aggregation identity — repeats of the same key merge. */
  key: string;
  /** Times this line's event has fired inside the merge window. */
  count: number;
  /** Message without the count prefix, so a merge can re-render it. */
  base: string;
}

interface Hotspot {
  x: number;
  y: number;
  z: number;
  w: number;
}

// ---------------------------------------------------------------------------
// Hud
// ---------------------------------------------------------------------------

/**
 * The main heads-up display. Construct once against the `#ui` root, call
 * `update` every rendered frame, `dispose` on teardown.
 */
export class Hud implements UiLayer {
  private readonly root: HTMLElement;
  private readonly opts: HudOptions;
  private world: World;

  // -- layers --
  private readonly worldLayer: HTMLElement;
  private nowPlaying!: HTMLElement;
  /** Seconds the now-playing credit stays up. Counted down in `update`. */
  private nowPlayingTimer = 0;
  private readonly hitFlash: HTMLElement;
  private readonly alertBanner: HTMLElement;
  private readonly alertTxt: Txt;

  // -- top bar --
  private readonly resTxt: Txt;
  private readonly resGain: HTMLElement;
  private readonly gainTxt: Txt;
  private readonly supplyCell: HTMLElement;
  private readonly supplyTxt: Txt;
  private readonly supplyBar: Bar;
  private readonly clockTxt: Txt;
  private readonly fleetTxt: Txt;
  private readonly opsTxt: Txt;
  private readonly opsEl: HTMLElement;

  // -- selection --
  private readonly selPanel: HTMLElement;
  private readonly selCount: Txt;
  private readonly selTitle: Txt;
  private readonly rows: GroupRow[] = [];
  private readonly soloBox: HTMLElement;
  private readonly soloName: Txt;
  private readonly soloHull: Txt;
  private readonly soloShield: Txt;
  private readonly soloOrder: Txt;
  private readonly soloHullBar: Bar;
  private readonly soloShieldBar: Bar;
  private soloOn = false;
  private selOn = false;

  // -- command bar --
  private readonly cmdPanel: HTMLElement;
  private readonly modsWrap: HTMLElement;
  private readonly orderBtns: HTMLButtonElement[] = [];
  private readonly formBtns: HTMLButtonElement[] = [];
  private readonly stanceBtns: HTMLButtonElement[] = [];
  private readonly formState: Txt;
  private readonly stanceState: Txt;
  private cmdIdle = true;
  private modsOn = true;
  private readonly tip: HTMLElement;
  private readonly tipTitle: Txt;
  private readonly tipBody: Txt;
  private readonly tips = new WeakMap<HTMLElement, { t: string; b: string }>();
  private tipOn = false;
  private lastDisabled = new Int8Array(ORDER_BUTTONS.length).fill(-1);
  private lastFormation = -2;
  private lastStance = -2;

  // -- log --
  private readonly logRoot: HTMLElement;
  private readonly logLines: LogLine[] = [];

  // -- marker pools --
  private readonly brackets: Marker[] = [];
  private readonly bracketCls: string[] = [];
  private readonly reticles: Marker[] = [];
  private readonly arrows: Marker[] = [];
  private readonly arrowHead: HTMLElement[] = [];

  // -- scratch (module-lifetime, never reallocated) --
  private readonly sp: ScreenPoint = { x: 0, y: 0, ndcX: 0, ndcY: 0, dist: 0, behind: true, onScreen: false };
  private readonly grpCount = new Int32Array(SHIP_CLASS_COUNT);
  private readonly grpHp = new Float64Array(SHIP_CLASS_COUNT);
  private readonly grpHpMax = new Float64Array(SHIP_CLASS_COUNT);
  private readonly retTargets = new Int32Array(MAX_RETICLES);
  private readonly losses = new Int32Array(SHIP_CLASS_COUNT);
  private readonly kills = new Int32Array(SHIP_CLASS_COUNT);
  private readonly hotspots: Hotspot[] = [];

  // -- health-pip canvas overlay --
  private readonly pipCanvas: HTMLCanvasElement;
  private readonly pipCtx: CanvasRenderingContext2D | null;
  /** Backing-store scale. Capped at 2 — pips are 1-3 px rules, so a 3x buffer
   *  buys nothing and costs fill rate on a 4K display. */
  private pipDpr = 1;
  /** Pips drawn last frame. 0 means the canvas is already clear and the
   *  per-frame clearRect can be skipped entirely. */
  private pipDrawn = -1;
  /** Team bar colours, resolved once (no per-frame string building). */
  private readonly pipTeamCss: string[] = [];
  /** id → 1 when selected this frame, plus the id list needed to clear it
   *  again without touching the whole array. */
  private readonly selMark = new Uint8Array(CONFIG.maxShips + 16);
  private readonly selMarked = new Int32Array(1024);
  private selMarkedN = 0;

  // -- running state --
  private vw = 1;
  private vh = 1;
  private pxPerM = 500;
  private resShown = -1;
  private resGainPending = 0;
  private resGainTimer = 0;
  private strengthT = 0;
  private fleetStr = '';
  private opsStr = '';
  private opsAlert = false;
  private lossT = 0;
  private lastMotherPool = -1;
  private flash = 0;
  private lastFlashWritten = -1;
  private alertOn = false;
  private sawMothership = false;
  private now = 0;
  private booted = false;

  private readonly offs: Array<() => void> = [];
  private readonly onResize = (): void => this.measure();
  /** Top-level nodes this HUD appended to the shared root, for a clean
   *  teardown that leaves sibling UI layers (build panel, tactical) intact. */
  private readonly owned: HTMLElement[] = [];

  constructor(root: HTMLElement, world: World, opts: HudOptions) {
    this.root = root;
    this.world = world;
    this.opts = opts;

    this.applyPaletteVars();
    root.classList.add('sf-root');
    // The root is shared with the other UI layers; remember where our nodes
    // start so `dispose` can remove ours and only ours.
    const ownedFrom = root.children.length;

    // -- screen-edge scrim -------------------------------------------------
    // Sits under everything the HUD draws and darkens only the top strip, the
    // bottom baseline and the far corners — the bands the panels live in — so
    // HUD type never sits on raw nebula. The focal centre is untouched.
    // (critique round 1, ui: "add a subtle screen-edge vignette behind all HUD
    // regions so panel type never sits on raw nebula".)
    el('div', 'sf-edge', root);

    // -- experiment attribution --------------------------------------------
    // A quiet mark in the two dead corners of the layout: the top strip already
    // ends before the ELAPSED clock, and the bottom-left below the production
    // tab is empty at every supported size. Pointer-events stay off so neither
    // can eat a click.
    el('div', 'sf-mark sf-mark-t', root).textContent = 'E01.AI EXPERIMENT';
    // NOW PLAYING. The score is streamed and shuffled, so the only moment
    // anything can know what is on is when a deck starts a track. Crediting it
    // while it plays is how a score is normally attributed — the menu list is
    // the reference, this is the one the player actually reads.
    this.nowPlaying = el('div', 'sf-nowplaying', root);

    const markB = el('div', 'sf-mark sf-mark-b', root);
    markB.textContent = 'e01.ai';
    markB.title = 'Controls, credits and audio (F1)';
    // No explicit teardown: `dispose` removes every node this HUD owns, and a
    // listener on a removed node goes with it.
    markB.addEventListener('click', () => {
      opts.onCommand('menu');
      bus.emit('ack', { kind: 'click' });
    });

    // -- worldspace overlay sits under the chrome ---------------------------
    this.worldLayer = el('div', 'sf-world', root);
    // One canvas for every health pip in the frame. Created before the marker
    // pools so brackets and reticles composite above it.
    this.pipCanvas = el('canvas', 'sf-pipc', this.worldLayer);
    this.pipCtx = this.pipCanvas.getContext('2d', { alpha: true, desynchronized: true });
    this.pipTeamCss[Team.Player] = PALETTES[Team.Player].uiCss;
    this.pipTeamCss[Team.Enemy] = PALETTES[Team.Enemy].uiCss;
    this.pipTeamCss[Team.Neutral] = PALETTES[Team.Neutral].uiCss;
    this.hitFlash = el('div', 'sf-hit', root);

    this.buildMarkerPools();

    // -- chrome ------------------------------------------------------------
    const top = this.buildTop(root);
    this.resTxt = top.res;
    this.resGain = top.gain;
    this.gainTxt = top.gainTxt;
    this.supplyCell = top.supplyCell;
    this.supplyTxt = top.supply;
    this.supplyBar = top.supplyBar;
    this.clockTxt = top.clock;
    this.fleetTxt = top.fleet;
    this.opsTxt = top.ops;
    this.opsEl = top.opsEl;

    const sel = this.buildSelection(root);
    this.selPanel = sel.panel;
    this.selCount = sel.count;
    this.selTitle = sel.title;
    this.soloBox = sel.soloBox;
    this.soloName = sel.soloName;
    this.soloHull = sel.soloHull;
    this.soloShield = sel.soloShield;
    this.soloOrder = sel.soloOrder;
    this.soloHullBar = sel.soloHullBar;
    this.soloShieldBar = sel.soloShieldBar;

    const cmd = this.buildCommandBar(root);
    this.cmdPanel = cmd.panel;
    this.modsWrap = cmd.mods;
    this.formState = cmd.formState;
    this.stanceState = cmd.stanceState;

    this.logRoot = el('div', 'sf-log', root);
    for (let i = 0; i < LOG_LINES; i++) {
      const node = el('div', 'sf-log-line', this.logRoot);
      node.style.display = 'none';
      const t = el('span', 't', node);
      const n = el('span', 'n', node);
      const x = el('span', 'x', node);
      this.logLines.push({
        node, time: new Txt(t), tally: new Txt(n), text: new Txt(x),
        born: -1e9, used: false, lastOpacity: -1, kind: '',
        key: '', count: 0, base: '',
      });
    }

    // -- alerts ------------------------------------------------------------
    this.alertBanner = el('div', 'sf-alert', root);
    this.alertTxt = new Txt(this.alertBanner);

    // -- tooltip -----------------------------------------------------------
    this.tip = el('div', 'sf-tip', root);
    this.tipTitle = new Txt(el('b', '', this.tip));
    this.tipBody = new Txt(el('span', '', this.tip));

    // -- texture layers on top of everything, non-interactive --------------
    el('div', 'sf-scan', root);
    el('div', 'sf-grain', root);

    for (let i = 0; i < MAX_HOTSPOTS; i++) this.hotspots.push({ x: 0, y: 0, z: 0, w: 0 });

    for (let i = ownedFrom; i < root.children.length; i++) {
      this.owned.push(root.children[i] as HTMLElement);
    }

    // -- wiring ------------------------------------------------------------
    this.offs.push(bus.on('notice', (p) => this.onNotice(p)));
    this.offs.push(bus.on('death', (p) => this.onDeath(p)));
    this.offs.push(bus.on('delivered', (p) => this.onDelivered(p)));
    this.offs.push(bus.on('hit', (p) => this.onHit(p)));

    window.addEventListener('resize', this.onResize);
    this.measure();
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /** Push the palette module's colours into CSS custom properties so
   *  `src/core/palette.ts` stays the single source of truth for HUD colour. */
  private applyPaletteVars(): void {
    const s = document.documentElement.style;
    s.setProperty('--ui-bg', UI.bg);
    s.setProperty('--ui-bg-solid', UI.bgSolid);
    s.setProperty('--ui-line', UI.line);
    s.setProperty('--ui-line-bright', UI.lineBright);
    s.setProperty('--ui-text', UI.text);
    s.setProperty('--ui-dim', UI.textDim);
    s.setProperty('--ui-good', UI.good);
    s.setProperty('--ui-warn', UI.warn);
    s.setProperty('--ui-bad', UI.bad);
    s.setProperty('--ui-res', UI.resource);
    s.setProperty('--font', UI.font);
    s.setProperty('--mono', UI.mono);
    s.setProperty('--team-player', PALETTES[Team.Player].uiCss);
    s.setProperty('--team-enemy', PALETTES[Team.Enemy].uiCss);
  }

  private panel(parent: HTMLElement, cls: string): HTMLElement {
    const p = el('div', 'sf-panel ' + cls, parent);
    return el('div', 'sf-in', p);
  }

  private buildTop(root: HTMLElement): {
    res: Txt; gain: HTMLElement; gainTxt: Txt;
    supplyCell: HTMLElement; supply: Txt; supplyBar: Bar;
    clock: Txt; fleet: Txt; ops: Txt; opsEl: HTMLElement;
  } {
    const inner = this.panel(root, 'sf-top cut-b');

    // resources
    const resCell = el('div', 'sf-cell', inner);
    el('div', 'sf-cap', resCell).textContent = 'Resource Units';
    const resWrap = el('div', 'sf-res-wrap', resCell);
    const resVal = el('div', 'sf-val res', resWrap);
    const gain = el('div', 'sf-gain', resWrap);

    el('div', 'sf-rule', inner);

    // supply
    const supplyCell = el('div', 'sf-cell sf-supply', inner);
    el('div', 'sf-cap', supplyCell).textContent = 'Fleet Supply';
    const supplyVal = el('div', 'sf-val', supplyCell);
    const supplyBarEl = el('div', 'sf-bar', supplyCell);
    const supplyBar = new Bar(supplyBarEl);

    el('div', 'sf-rule', inner);

    // FLEET COMPOSITION + OPS (grows).
    //
    // This slot used to be a player-vs-hostile strength bar. Two numbers whose
    // ratio the player can do nothing about is not a command interface — it is a
    // scoreboard, and it told you least exactly when you needed it most. The
    // strip now carries what a commander acts on: what the fleet is MADE of, and
    // what currently wants attention.
    const strCell = el('div', 'sf-cell grow', inner);

    const fleetRow = el('div', 'sf-strength sf-fleetrow', strCell);
    el('div', 'sf-cap', fleetRow).textContent = 'Fleet';
    const fleetVal = el('div', 'sf-cap sf-num sf-fleetval', fleetRow);

    const opsRow = el('div', 'sf-strength sf-opsrow', strCell);
    el('div', 'sf-cap', opsRow).textContent = 'Ops';
    const opsVal = el('div', 'sf-cap sf-num sf-opsval', opsRow);

    el('div', 'sf-rule', inner);

    // clock
    const clockCell = el('div', 'sf-cell', inner);
    el('div', 'sf-cap', clockCell).textContent = 'Elapsed';
    const clockVal = el('div', 'sf-clock sf-num', clockCell);

    el('div', 'sf-rule', inner);

    // MENU + CREDITS. The game had no way in to the controls list or the
    // attributions, and a keyboard shortcut nobody is told about is not a way
    // in either. Credits gets its own button rather than living one click
    // deeper: it is the thing a viewer looks for first, and it is where the
    // people whose work is in the build are named.
    const menuCell = el('div', 'sf-cell sf-menu-cell', inner);
    for (const [cmd, label, title] of [
      ['menu', 'Menu', 'Controls, credits and audio (F1)'],
      ['credits', 'Credits', 'Who made this, and whose music and sound it uses'],
    ] as [string, string, string][]) {
      const b = el('button', 'sf-menu-btn', menuCell) as HTMLButtonElement;
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => {
        this.opts.onCommand(cmd);
        bus.emit('ack', { kind: 'click' });
      });
    }

    // The author's marks sit in the same row, after a hairline: MENU, CREDITS,
    // then X and (once the repository is public) GitHub. They are the only
    // outbound links in the interface, so they belong beside the only other
    // things in the strip that are not game state.
    if (authorLinks().length > 0) {
      el('span', 'sf-menu-sep', menuCell);
      for (const l of authorLinks()) iconLink(menuCell, l.url, l.svg, l.title);
    }

    return {
      res: new Txt(resVal), gain, gainTxt: new Txt(gain),
      supplyCell, supply: new Txt(supplyVal), supplyBar,
      clock: new Txt(clockVal),
      fleet: new Txt(fleetVal), ops: new Txt(opsVal), opsEl: opsVal,
    };
  }

  private buildSelection(root: HTMLElement): {
    panel: HTMLElement; count: Txt; title: Txt;
    soloBox: HTMLElement; soloName: Txt; soloHull: Txt; soloShield: Txt; soloOrder: Txt;
    soloHullBar: Bar; soloShieldBar: Bar;
  } {
    // Docked to the RIGHT rail (above the minimap), so its chamfer points at
    // the right screen edge. Round 1 had it left-anchored at 22vh where it
    // overlapped the production panel outright at 720p.
    const p = el('div', 'sf-panel sf-sel cut-l', root);
    const inner = el('div', 'sf-in', p);

    const head = el('div', 'sf-sel-head', inner);
    const title = el('div', 'sf-cap', head);
    const count = el('div', 'sf-cap sf-num', head);

    // Single-ship detail block.
    const soloBox = el('div', 'sf-solo', inner);
    const nameRow = el('div', 'sf-solo-row', soloBox);
    const soloName = el('span', '', nameRow);
    soloName.style.color = 'var(--ui-text)';
    soloName.style.fontWeight = '600';
    const soloOrder = el('b', '', nameRow);
    const hullRow = el('div', 'sf-solo-row', soloBox);
    hullRow.appendChild(document.createTextNode('Hull'));
    const soloHull = el('b', '', hullRow);
    const hullBar = new Bar(el('div', 'sf-bar', soloBox));
    const shRow = el('div', 'sf-solo-row', soloBox);
    shRow.appendChild(document.createTextNode('Shield'));
    const soloShield = el('b', '', shRow);
    const shBar = new Bar(el('div', 'sf-bar', soloBox), 'sh-full');

    // Grouped rows — one per class, created once and shown/hidden.
    const list = el('div', 'sf-sel-list sf-scroll', inner);
    for (const cls of GROUP_ORDER) {
      const row = el('div', 'sf-grp hidden', list);
      const ico = el('div', 'sf-grp-ico', row);
      ico.innerHTML = SHIP_GLYPHS[cls];
      const name = el('div', 'sf-grp-name', row);
      const n = el('div', 'sf-grp-n', row);
      const bar = new Bar(el('div', 'sf-bar sf-grp-bar', row));
      row.addEventListener('click', () => this.selectSubgroup(cls));
      row.addEventListener('dblclick', () => this.focusSubgroup(cls));
      this.rows.push({
        cls, node: row, name: new Txt(name), count: new Txt(n), bar, shown: false,
      });
    }

    return {
      panel: p, count: new Txt(count), title: new Txt(title),
      soloBox, soloName: new Txt(soloName), soloHull: new Txt(soloHull),
      soloShield: new Txt(soloShield), soloOrder: new Txt(soloOrder),
      soloHullBar: hullBar, soloShieldBar: shBar,
    };
  }

  /**
   * The command bar.
   *
   * Critique round 1: "the bottom bar is not a command interface — it is a
   * permanently displayed keyboard cheat sheet. Fourteen visually identical
   * buttons ... no icons, no state, no context." The repair is hierarchy, not
   * a redesign:
   *
   *   1. ORDERS are the primary verbs. They keep the full-size chamfered tile,
   *      gain a 24 px vector face, and the hotkey drops to a 9-10 px glyph in
   *      the tile's bottom-right corner instead of being the tile's largest
   *      element.
   *   2. FORMATION and STANCE become two compact SEGMENTED groups — one strip
   *      of icon-only cells each, half the height of an order tile — and each
   *      group's header carries the CURRENT STATE by name ("Formation ·
   *      Delta"), which the old bar never showed anywhere.
   *   3. Both modifier groups live in one wrapper that is hidden outright when
   *      there is nothing selected to modify, and the whole strip dims when the
   *      selection is empty (see `updateCommands`).
   */
  private buildCommandBar(root: HTMLElement): {
    panel: HTMLElement; mods: HTMLElement; formState: Txt; stanceState: Txt;
  } {
    const panel = el('div', 'sf-panel sf-cmd cut-t', root);
    const inner = el('div', 'sf-in', panel);

    const orders = el('div', 'sf-cmd-grp', inner);
    for (const d of ORDER_BUTTONS) {
      const b = el('button', 'sf-btn verb', orders);
      b.type = 'button';
      const g = el('i', 'g', b);
      g.innerHTML = d.icon;
      el('span', 'l', b).textContent = d.label;
      el('span', 'k', b).textContent = d.key;
      this.tips.set(b, { t: d.tipTitle, b: d.tipBody + '  [' + d.key + ']' });
      this.bindTip(b);
      b.addEventListener('click', () => {
        if (!b.disabled) { this.opts.onCommand(d.cmd); bus.emit('ack', { kind: 'click' }); }
      });
      this.orderBtns.push(b);
    }

    const mods = el('div', 'sf-cmd-mods', inner);
    el('div', 'sf-rule', mods);

    const formCol = el('div', 'sf-cmd-col', mods);
    const formHead = el('div', 'sf-cmd-head', formCol);
    el('span', 'sf-cap', formHead).textContent = 'Formation';
    const formState = new Txt(el('b', 'sf-state', formHead));
    const formRow = el('div', 'sf-seg', formCol);
    for (const f of FORMATIONS) {
      const b = el('button', 'sf-seg-b', formRow);
      b.type = 'button';
      b.innerHTML = f.icon;
      b.setAttribute('aria-label', f.name + ' formation');
      this.tips.set(b, { t: f.name + ' formation', b: f.body + '  [alt + ' + f.key + ']' });
      this.bindTip(b);
      b.addEventListener('click', () => {
        if (!b.disabled) { this.opts.onCommand('formation', f.f); bus.emit('ack', { kind: 'click' }); }
      });
      this.formBtns.push(b);
    }

    el('div', 'sf-rule', mods);

    const stanceCol = el('div', 'sf-cmd-col', mods);
    const stanceHead = el('div', 'sf-cmd-head', stanceCol);
    el('span', 'sf-cap', stanceHead).textContent = 'Stance';
    const stanceState = new Txt(el('b', 'sf-state', stanceHead));
    const stanceRow = el('div', 'sf-seg', stanceCol);
    for (const s of STANCES) {
      const b = el('button', 'sf-seg-b', stanceRow);
      b.type = 'button';
      b.innerHTML = s.icon;
      b.setAttribute('aria-label', s.name + ' stance');
      this.tips.set(b, { t: s.name + ' stance', b: s.body + '  [' + s.key + ']' });
      this.bindTip(b);
      b.addEventListener('click', () => {
        if (!b.disabled) { this.opts.onCommand('stance', s.s); bus.emit('ack', { kind: 'click' }); }
      });
      this.stanceBtns.push(b);
    }

    return { panel, mods, formState, stanceState };
  }

  private bindTip(b: HTMLElement): void {
    b.addEventListener('mouseenter', () => this.showTip(b));
    b.addEventListener('mouseleave', () => this.hideTip());
  }

  private buildMarkerPools(): void {
    for (let i = 0; i < MAX_BRACKETS; i++) {
      const n = el('div', 'sf-mark sf-brk', this.worldLayer);
      for (let k = 0; k < 4; k++) el('s', '', n);
      this.brackets.push(new Marker(n));
      this.bracketCls.push('sf-mark sf-brk');
    }
    // Health pips have no pool: they are drawn into `pipCanvas`. See drawPips.
    for (let i = 0; i < MAX_RETICLES; i++) {
      const n = el('div', 'sf-mark sf-ret', this.worldLayer);
      el('u', '', n);
      for (let k = 0; k < 4; k++) el('s', '', n);
      this.reticles.push(new Marker(n));
    }
    for (let i = 0; i < MAX_ARROWS; i++) {
      const n = el('div', 'sf-mark sf-arrow', this.worldLayer);
      const head = el('p', '', n);
      this.arrows.push(new Marker(n));
      this.arrowHead.push(head);
    }
  }

  private measure(): void {
    this.vw = this.root.clientWidth || window.innerWidth;
    this.vh = this.root.clientHeight || window.innerHeight;

    // Resize the pip canvas to match. The backing store is device pixels so a
    // 1 px leader tick stays 1 px on a retina panel; capped at 2x because pips
    // are hairline rules and a 3x buffer is pure fill-rate cost at 4K.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(this.vw * dpr));
    const ch = Math.max(1, Math.round(this.vh * dpr));
    if (this.pipCanvas.width !== cw || this.pipCanvas.height !== ch) {
      this.pipCanvas.width = cw;
      this.pipCanvas.height = ch;
      this.pipDrawn = -1; // buffer is new; force one clear on the next frame
    }
    this.pipDpr = dpr;
    if (this.pipCtx) {
      // Draw in CSS pixels; the transform does the device-pixel scale-up.
      this.pipCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.pipCtx.lineCap = 'butt';
    }
  }

  // -------------------------------------------------------------------------
  // Bus handlers
  // -------------------------------------------------------------------------

  private onNotice(p: GameEvents['notice']): void {
    // The text IS the identity for free-form notices, so a repeated notice
    // ("fleet under attack") counts up instead of stacking.
    this.pushLog(p.text, p.kind, 'N' + p.text);
  }

  private onDeath(p: GameEvents['death']): void {
    // Payload objects are reused by the emitter — read fields, keep nothing.
    if (p.team === Team.Player) {
      this.losses[p.cls]++;
      this.flash = Math.min(1, this.flash + (SHIP_SPECS[p.cls].size >= HullSize.Frigate ? 0.5 : 0.14));
    } else if (p.team === Team.Enemy) {
      this.kills[p.cls]++;
    }
    this.addHotspot(p.x, p.y, p.z, 1.2);
  }

  private onDelivered(p: GameEvents['delivered']): void {
    if (p.team !== Team.Player) return;
    this.resGainPending += p.amount;
  }

  private onHit(p: GameEvents['hit']): void {
    // Weight by impact scale so a torpedo hit outranks a pulse tracer.
    this.addHotspot(p.x, p.y, p.z, 0.18 + Math.min(0.5, p.scale * 0.1));
  }

  /** Fold a combat event into the hotspot table (fixed size, no allocation). */
  private addHotspot(x: number, y: number, z: number, w: number): void {
    const merge2 = HOTSPOT_MERGE * HOTSPOT_MERGE;
    let weakest = 0;
    for (let i = 0; i < MAX_HOTSPOTS; i++) {
      const h = this.hotspots[i];
      if (h.w > 0.01) {
        const dx = h.x - x, dy = h.y - y, dz = h.z - z;
        if (dx * dx + dy * dy + dz * dz < merge2) {
          // Drift the centroid towards the new event rather than jumping.
          const k = Math.min(0.5, w / (h.w + w));
          h.x += (x - h.x) * k;
          h.y += (y - h.y) * k;
          h.z += (z - h.z) * k;
          h.w = Math.min(4, h.w + w);
          return;
        }
      }
      if (h.w < this.hotspots[weakest].w) weakest = i;
    }
    const h = this.hotspots[weakest];
    h.x = x; h.y = y; h.z = z; h.w = w;
  }

  // -------------------------------------------------------------------------
  // Log
  // -------------------------------------------------------------------------

  /**
   * Post one event.
   *
   * Critique round 1: "un-aggregated debug spam: five of six lines are '<CLASS>
   * LOST' in identical amber, three of them the same class". Two mechanisms fix
   * that here. `flushLosses` batches a burst inside one tick, and this function
   * MERGES across ticks: a repeat of the same `key` while a live line already
   * carries it bumps that line's count badge and refreshes its age instead of
   * consuming another slot. Six interceptor deaths spread over ten seconds are
   * now one line reading "6× TALON INTERCEPTOR LOST", not six lines.
   *
   * `kind` is a severity, not a category: 'alert' (capital/mothership loss,
   * red), 'loss' (strike-craft loss, muted red), 'warn' (amber), 'info'
   * (completion, cyan), '' (neutral).
   */
  private pushLog(base: string, kind: string, key: string, count = 1): void {
    const cls = 'sf-log-line' + (kind && kind !== 'info' ? ' ' + kind : kind === 'info' ? ' info' : '');
    const txt = base.toUpperCase();

    // 1. Merge into a live line carrying the same key.
    for (let i = 0; i < this.logLines.length; i++) {
      const l = this.logLines[i];
      if (!l.used || l.key !== key) continue;
      if (this.now - l.born > LOG_MERGE) break;
      l.count += count;
      l.born = this.now;
      l.tally.set(l.count > 1 ? l.count + '×' : '');
      l.time.set(fmtClock(this.world.time));
      if (l.kind !== cls) {
        l.kind = cls;
        l.node.className = cls;
      }
      l.node.style.opacity = '1';
      l.lastOpacity = 1;
      // A pulse, not a re-entry: the line is already in place and re-running
      // the slide would read as a new event.
      l.node.classList.remove('bump');
      void l.node.offsetWidth;
      l.node.classList.add('bump');
      return;
    }

    // 2. Otherwise recycle the oldest slot rather than creating nodes.
    let oldest = 0;
    for (let i = 1; i < this.logLines.length; i++) {
      if (this.logLines[i].born < this.logLines[oldest].born) oldest = i;
    }
    const l = this.logLines[oldest];
    l.born = this.now;
    l.used = true;
    l.key = key;
    l.count = count;
    l.base = base;
    l.text.set(txt);
    l.tally.set(count > 1 ? count + '×' : '');
    l.time.set(fmtClock(this.world.time));
    if (l.kind !== cls) {
      l.kind = cls;
      l.node.className = cls;
    }
    l.node.style.display = 'flex';
    l.node.style.opacity = '1';
    l.lastOpacity = 1;
    // Restart the slide-in without a reflow-forcing class dance.
    l.node.classList.remove('in');
    l.node.classList.remove('bump');
    void l.node.offsetWidth;
    l.node.classList.add('in');
    this.logRoot.prepend(l.node);
  }

  /**
   * Roll the aggregated loss/kill counters into readable log lines.
   *
   * Severity, not one amber for everything: a capital loss is red and loud, a
   * strike-craft loss is muted red, an enemy kill is cyan and only reported at
   * all when it is worth reporting.
   */
  private flushLosses(): void {
    for (let c = 0; c < SHIP_CLASS_COUNT; c++) {
      const n = this.losses[c];
      if (n <= 0) continue;
      this.losses[c] = 0;
      const sp = SHIP_SPECS[c as ShipClass];
      const big = sp.size >= HullSize.Frigate;
      this.pushLog(sp.name + ' lost', big ? 'alert' : 'loss', 'L' + c, n);
    }
    for (let c = 0; c < SHIP_CLASS_COUNT; c++) {
      const n = this.kills[c];
      if (n <= 0) continue;
      this.kills[c] = 0;
      const sp = SHIP_SPECS[c as ShipClass];
      // Fighter kills are the loudest, least informative event in the game.
      if (sp.size < HullSize.Frigate && n < 4) continue;
      this.pushLog('hostile ' + sp.name + ' destroyed', 'info', 'K' + c, n);
    }
  }

  private updateLog(): void {
    for (let i = 0; i < this.logLines.length; i++) {
      const l = this.logLines[i];
      if (!l.used) continue;
      const age = this.now - l.born;
      let o: number;
      if (age <= LOG_HOLD) o = 1;
      else if (age >= LOG_HOLD + LOG_FADE) o = 0;
      else o = 1 - (age - LOG_HOLD) / LOG_FADE;
      if (Math.abs(o - l.lastOpacity) < 0.02 && o > 0) continue;
      l.lastOpacity = o;
      if (o <= 0) {
        // Fully gone, not parked at 30%: the slot is released and hidden so
        // the block never carries an unreadable half-state line.
        l.used = false;
        l.key = '';
        l.count = 0;
        l.node.style.display = 'none';
      } else {
        l.node.style.opacity = o.toFixed(2);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private selectSubgroup(cls: ShipClass): void {
    const ids: number[] = [];
    const sel = this.world.selection;
    for (let i = 0; i < sel.length; i++) {
      const s = this.world.ship(sel[i]);
      if (s && s.cls === cls) ids.push(s.id);
    }
    if (ids.length) this.opts.onCommand('select', ids);
  }

  private focusSubgroup(cls: ShipClass): void {
    const ids: number[] = [];
    const sel = this.world.selection;
    for (let i = 0; i < sel.length; i++) {
      const s = this.world.ship(sel[i]);
      if (s && s.cls === cls) ids.push(s.id);
    }
    if (ids.length) this.opts.onCommand('focus', ids);
  }

  private showTip(b: HTMLElement): void {
    const d = this.tips.get(b);
    if (!d) return;
    this.tipTitle.set(d.t);
    this.tipBody.set(d.b);
    // Layout read only happens on hover, never in the frame loop.
    const r = b.getBoundingClientRect();
    this.tip.style.left = '0px';
    this.tip.style.top = '0px';
    this.tip.style.visibility = 'hidden';
    this.tip.classList.add('on');
    const tw = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    const x = Math.max(8, Math.min(this.vw - tw - 8, r.left + r.width * 0.5 - tw * 0.5));
    const y = Math.max(8, r.top - th - 10);
    this.tip.style.left = x.toFixed(0) + 'px';
    this.tip.style.top = y.toFixed(0) + 'px';
    this.tip.style.visibility = 'visible';
    this.tipOn = true;
  }

  private hideTip(): void {
    if (!this.tipOn) return;
    this.tipOn = false;
    this.tip.classList.remove('on');
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  /** Drive the whole HUD. Call once per rendered frame, after the sim step. */
  update(world: World, camera: THREE.Camera, dt: number): void {
    if (this.nowPlayingTimer > 0) {
      this.nowPlayingTimer -= dt;
      if (this.nowPlayingTimer <= 0) this.nowPlaying.classList.remove('is-on');
    }
    this.world = world;
    this.now += dt;

    if (!this.booted) {
      this.booted = true;
      const boot = document.getElementById('boot');
      if (boot) boot.classList.add('done');
    }

    // The renderer refreshes these too, but the HUD may run before it.
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const persp = camera as THREE.PerspectiveCamera;
    this.pxPerM = persp.isPerspectiveCamera
      ? this.vh / (2 * Math.tan((persp.fov * Math.PI) / 360))
      : this.vh * 0.5;

    this.updateTop(world, dt);
    this.updateSelection(world);
    this.updateCommands(world);

    this.lossT += dt;
    if (this.lossT >= LOSS_FLUSH) {
      this.lossT = 0;
      this.flushLosses();
    }
    this.updateLog();

    this.updateOverlay(world, camera, dt);
    this.updateAlerts(world, dt);
  }

  // -- top bar --------------------------------------------------------------

  private updateTop(world: World, dt: number): void {
    const f = world.factions[Team.Player];

    // Resource count-up. Proportional easing with a floor so the tail lands.
    if (this.resShown < 0) this.resShown = f.resources;
    const diff = f.resources - this.resShown;
    if (diff !== 0) {
      const step = Math.max(Math.abs(diff) * RES_EASE, RES_MIN_RATE) * dt;
      if (Math.abs(diff) <= step) this.resShown = f.resources;
      else this.resShown += Math.sign(diff) * step;
    }
    this.resTxt.set(fmtInt(this.resShown));

    // Delivery chips are coalesced so five collectors landing together read as
    // one number instead of five overlapping ghosts.
    if (this.resGainPending > 0) {
      this.resGainTimer -= dt;
      if (this.resGainTimer <= 0) {
        this.gainTxt.set('+' + fmtInt(this.resGainPending));
        this.resGainPending = 0;
        this.resGainTimer = 1.5;
        this.resGain.classList.remove('play');
        void this.resGain.offsetWidth;
        this.resGain.classList.add('play');
      }
    } else if (this.resGainTimer > 0) {
      this.resGainTimer -= dt;
    }

    // Supply.
    const cap = Math.max(1, f.supplyCap);
    const ratio = f.supply / cap;
    this.supplyTxt.set(Math.round(f.supply) + ' / ' + Math.round(f.supplyCap));
    this.supplyBar.set(ratio);
    this.supplyBar.state(ratio >= SUPPLY_FULL ? 'is-bad' : ratio >= SUPPLY_WARN ? 'is-warn' : '');
    const supplyCls = 'sf-cell sf-supply' + (ratio >= SUPPLY_FULL ? ' full' : ratio >= SUPPLY_WARN ? ' near' : '');
    if (this.supplyCell.className !== supplyCls) this.supplyCell.className = supplyCls;

    this.clockTxt.set(fmtClock(world.time));

    // Fleet composition and operational alerts. O(ship pool), so it runs on its
    // own slow cadence rather than every frame.
    this.strengthT -= dt;
    if (this.strengthT <= 0) {
      this.strengthT = STRENGTH_PERIOD;
      let strike = 0;
      let line = 0;
      let support = 0;
      let underFire = 0;
      let idleHarvest = 0;
      const ships = world.ships;
      for (let i = 0; i < ships.count; i++) {
        const s = ships.items[i];
        if (!s.alive || s.team !== Team.Player) continue;
        const sp = SHIP_SPECS[s.cls];
        if (sp.harvest) {
          support++;
          // "Idle" means carrying nothing and not on a rock — the state that
          // actually costs income, as opposed to merely being in transit.
          if (s.cargo <= 0 && s.harvestPhase === 0) idleHarvest++;
        } else if (sp.size === HullSize.Fighter || sp.size === HullSize.Corvette) {
          strike++;
        } else if (sp.size === HullSize.Utility) {
          support++;
        } else {
          line++;
        }
        if (s.sinceHit < UNDER_FIRE_WINDOW) underFire++;
      }
      let queued = 0;
      for (const p of world.producers.values()) {
        const owner = world.ship(p.shipId);
        if (owner && owner.team === Team.Player) queued += p.queue.length;
      }
      this.fleetStr = `STRIKE ${strike}  LINE ${line}  SUPPORT ${support}`;

      // Ops reads as a priority list: threats first, then idle capacity, then
      // work in progress. Empty means genuinely nothing needs the player.
      _ops.length = 0;
      if (underFire > 0) _ops.push(`${underFire} UNDER FIRE`);
      if (idleHarvest > 0) _ops.push(`${idleHarvest} COLLECTOR IDLE`);
      if (queued > 0) _ops.push(`${queued} IN BUILD`);
      this.opsStr = _ops.length > 0 ? _ops.join('   ') : 'NOMINAL';
      this.opsAlert = underFire > 0;
    }
    this.fleetTxt.set(this.fleetStr);
    this.opsTxt.set(this.opsStr);
    const opsCls = this.opsAlert ? 'sf-cap sf-num sf-opsval is-alert' : 'sf-cap sf-num sf-opsval';
    if (this.opsEl.className !== opsCls) this.opsEl.className = opsCls;
  }

  // -- selection panel ------------------------------------------------------

  private updateSelection(world: World): void {
    const sel = world.selection;
    const n = sel.length;

    if ((n > 0) !== this.selOn) {
      this.selOn = n > 0;
      this.selPanel.classList.toggle('on', this.selOn);
    }
    if (n === 0) {
      this.hideAllRows();
      if (this.soloOn) {
        this.soloOn = false;
        this.soloBox.classList.remove('on');
      }
      return;
    }

    this.selTitle.set('Selection');
    this.selCount.set(n + (n === 1 ? ' unit' : ' units'));

    // Single hull: show the detail block instead of a one-row list.
    if (n === 1) {
      const s = world.ship(sel[0]);
      if (s) {
        if (!this.soloOn) {
          this.soloOn = true;
          this.soloBox.classList.add('on');
        }
        const sp = SHIP_SPECS[s.cls];
        this.soloName.set(sp.name);
        this.soloOrder.set(ORDER_LABEL[s.order.kind] ?? s.order.kind);
        const hf = sp.maxHp > 0 ? s.hp / sp.maxHp : 0;
        this.soloHull.set(Math.round(hf * 100) + '%');
        this.soloHullBar.set(hf);
        this.soloHullBar.state(hf < 0.3 ? 'is-bad' : hf < 0.6 ? 'is-warn' : 'is-good');
        if (sp.maxShield > 0) {
          const sf = s.shield / sp.maxShield;
          this.soloShield.set(Math.round(sf * 100) + '%');
          this.soloShieldBar.set(sf);
        } else {
          this.soloShield.set('none');
          this.soloShieldBar.set(0);
        }
      }
    } else if (this.soloOn) {
      this.soloOn = false;
      this.soloBox.classList.remove('on');
    }

    // Aggregate by class. Linear in the selection; 200 hulls is a rounding
    // error next to a single draw call, so no throttling is needed.
    this.grpCount.fill(0);
    this.grpHp.fill(0);
    this.grpHpMax.fill(0);
    for (let i = 0; i < n; i++) {
      const s = world.ship(sel[i]);
      if (!s) continue;
      const sp = SHIP_SPECS[s.cls];
      this.grpCount[s.cls]++;
      this.grpHp[s.cls] += s.hp + s.shield;
      this.grpHpMax[s.cls] += sp.maxHp + sp.maxShield;
    }

    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const c = this.grpCount[r.cls];
      const show = c > 0 && n > 1;
      if (show !== r.shown) {
        r.shown = show;
        r.node.className = show ? 'sf-grp' : 'sf-grp hidden';
      }
      if (!show) continue;
      const sp = SHIP_SPECS[r.cls];
      r.name.set(sp.name);
      r.count.set(String(c));
      const max = this.grpHpMax[r.cls];
      const frac = max > 0 ? this.grpHp[r.cls] / max : 0;
      r.bar.set(frac);
      r.bar.state(frac < 0.3 ? 'is-bad' : frac < 0.6 ? 'is-warn' : 'is-good');
    }
  }

  private hideAllRows(): void {
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (!r.shown) continue;
      r.shown = false;
      r.node.className = 'sf-grp hidden';
    }
  }

  // -- command bar ----------------------------------------------------------

  private currentFormation(): Formation {
    const sel = this.world.selection;
    for (let i = 0; i < sel.length; i++) {
      const s = this.world.ship(sel[i]);
      if (!s || s.squad < 0) continue;
      const sq = this.world.squad(s.squad);
      if (sq) return sq.formation;
    }
    return Formation.None;
  }

  private currentStance(): Stance {
    const sel = this.world.selection;
    for (let i = 0; i < sel.length; i++) {
      const s = this.world.ship(sel[i]);
      if (s) return s.stance;
    }
    return Stance.Aggressive;
  }

  private updateCommands(world: World): void {
    const sel = world.selection;
    const n = sel.length;
    let canHarvest = false;
    let canDock = false;
    let canAttack = false;
    let canMove = n > 0;

    for (let i = 0; i < n; i++) {
      const s = world.ship(sel[i]);
      if (!s) continue;
      const sp = SHIP_SPECS[s.cls];
      if (sp.harvest) canHarvest = true;
      if (dockable(s.cls)) canDock = true;
      if (sp.weapons.length > 0) canAttack = true;
      if (canHarvest && canDock && canAttack) break;
    }

    this.setDisabled(0, !canMove);
    this.setDisabled(1, !canAttack);
    this.setDisabled(2, n === 0);
    this.setDisabled(3, !canHarvest);
    this.setDisabled(4, !canDock);

    // The bar is CONTEXTUAL, not a cheat sheet: with nothing selected the whole
    // strip drops back to a hint and the two modifier groups leave entirely,
    // so the bottom of the frame is quiet until the player has a fleet in hand.
    const idle = n === 0;
    if (idle !== this.cmdIdle) {
      this.cmdIdle = idle;
      this.cmdPanel.classList.toggle('idle', idle);
    }
    const mods = canMove;
    if (mods !== this.modsOn) {
      this.modsOn = mods;
      this.modsWrap.classList.toggle('off', !mods);
    }

    const form = n > 0 ? this.currentFormation() : -1;
    if (form !== this.lastFormation) {
      this.lastFormation = form;
      let name = '';
      for (let i = 0; i < this.formBtns.length; i++) {
        const b = this.formBtns[i];
        const on = FORMATIONS[i].f === form;
        b.disabled = n === 0;
        b.classList.toggle('on', on);
        if (on) name = FORMATIONS[i].name;
      }
      // The header carries the current state by name — the round-1 bar showed
      // it nowhere at all.
      this.formState.set(n === 0 ? '—' : name || 'free');
    } else if (n === 0 && !this.formBtns[0].disabled) {
      for (const b of this.formBtns) b.disabled = true;
    }

    const stance = n > 0 ? this.currentStance() : -1;
    if (stance !== this.lastStance) {
      this.lastStance = stance;
      let name = '';
      for (let i = 0; i < this.stanceBtns.length; i++) {
        const b = this.stanceBtns[i];
        const on = STANCES[i].s === stance;
        b.disabled = n === 0;
        b.classList.toggle('on', on);
        if (on) name = STANCES[i].name;
      }
      this.stanceState.set(n === 0 ? '—' : name || 'mixed');
    } else if (n === 0 && !this.stanceBtns[0].disabled) {
      for (const b of this.stanceBtns) b.disabled = true;
    }
  }

  private setDisabled(i: number, off: boolean): void {
    const v = off ? 1 : 0;
    if (this.lastDisabled[i] === v) return;
    this.lastDisabled[i] = v;
    this.orderBtns[i].disabled = off;
    if (off) this.hideTip();
  }

  // -- worldspace overlay ---------------------------------------------------

  private updateOverlay(world: World, camera: THREE.Camera, dt: number): void {
    const w = this.vw;
    const h = this.vh;
    const sp = this.sp;

    let brk = 0;
    let ret = 0;
    let retN = 0;

    // 0. Refresh the selected-id lookup the pip pass needs. Cleared by walking
    //    the ids we set last frame, so this is O(selection), never O(maxShips).
    for (let i = 0; i < this.selMarkedN; i++) this.selMark[this.selMarked[i]] = 0;
    this.selMarkedN = 0;

    // 1. Selection brackets + attack reticles for whatever the selection is
    //    shooting at. Brackets first: they are the thing the player is
    //    tracking with their eyes.
    const sel = world.selection;
    for (let i = 0; i < sel.length && this.selMarkedN < this.selMarked.length; i++) {
      const id = sel[i];
      if (id < 0 || id >= this.selMark.length) continue;
      this.selMark[id] = 1;
      this.selMarked[this.selMarkedN++] = id;
    }
    for (let i = 0; i < sel.length && brk < MAX_BRACKETS; i++) {
      const s = world.ship(sel[i]);
      if (!s || s.dockedIn >= 0) continue;
      projectToScreen(camera, s.pos.x, s.pos.y, s.pos.z, w, h, sp);
      if (!sp.onScreen) continue;
      const spec = SHIP_SPECS[s.cls];
      const rpx = (spec.radius * this.pxPerM) / Math.max(1, sp.dist);
      const scale = Math.max(0.28, Math.min(3.2, (rpx * 2.5) / 64));
      const m = this.brackets[brk];
      const cls = 'sf-mark sf-brk' + (s.team === Team.Enemy ? ' enemy' : s.team === Team.Neutral ? ' neutral' : '');
      if (this.bracketCls[brk] !== cls) {
        this.bracketCls[brk] = cls;
        m.node.className = cls;
      }
      m.place(sp.x, sp.y, scale);
      brk++;

      // Collect distinct attack targets for reticles.
      if (s.order.kind === 'attack' && s.target >= 0 && retN < MAX_RETICLES) {
        let dup = false;
        for (let k = 0; k < retN; k++) if (this.retTargets[k] === s.target) { dup = true; break; }
        if (!dup) this.retTargets[retN++] = s.target;
      }
    }
    for (let i = brk; i < MAX_BRACKETS; i++) this.brackets[i].hide();

    for (let i = 0; i < retN && ret < MAX_RETICLES; i++) {
      const t = world.ship(this.retTargets[i]);
      if (!t) continue;
      projectToScreen(camera, t.pos.x, t.pos.y, t.pos.z, w, h, sp);
      if (!sp.onScreen) continue;
      const spec = SHIP_SPECS[t.cls];
      const rpx = (spec.radius * this.pxPerM) / Math.max(1, sp.dist);
      this.reticles[ret].place(sp.x, sp.y, Math.max(0.4, Math.min(3.4, (rpx * 3.2) / 72)));
      ret++;
    }
    for (let i = ret; i < MAX_RETICLES; i++) this.reticles[i].hide();

    // 2. Health / shield pips, drawn into one canvas.
    this.drawPips(world, camera, w, h);

    // 3. Off-screen combat arrows.
    let arrow = 0;
    for (let i = 0; i < MAX_HOTSPOTS; i++) {
      const hs = this.hotspots[i];
      if (hs.w <= 0) continue;
      hs.w = Math.max(0, hs.w - HOTSPOT_DECAY * dt);
      if (hs.w < HOTSPOT_SHOW || arrow >= MAX_ARROWS) continue;
      projectToScreen(camera, hs.x, hs.y, hs.z, w, h, sp);
      if (sp.onScreen) continue;
      // Push the NDC direction out to the viewport edge, keeping a margin so
      // the arrow never half-hangs off the screen.
      const mx = 0.94;
      let dx = sp.ndcX;
      let dy = sp.ndcY;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) continue;
      dx /= len;
      dy /= len;
      const tx = Math.abs(dx) > 1e-4 ? mx / Math.abs(dx) : 1e9;
      const ty = Math.abs(dy) > 1e-4 ? mx / Math.abs(dy) : 1e9;
      const t = Math.min(tx, ty);
      const ex = dx * t;
      const ey = dy * t;
      const px = (ex * 0.5 + 0.5) * w;
      const py = (-ey * 0.5 + 0.5) * h;
      const m = this.arrows[arrow];
      m.place(px, py, Math.max(0.7, Math.min(1.5, 0.7 + hs.w * 0.3)));
      // Screen y grows downward, so the angle is negated against NDC y.
      m.rotate(this.arrowHead[arrow], (Math.atan2(-dy, dx) * 180) / Math.PI);
      arrow++;
    }
    for (let i = arrow; i < MAX_ARROWS; i++) this.arrows[i].hide();
  }

  // -- health pips ----------------------------------------------------------

  /**
   * Draw every health pip for the frame into one canvas.
   *
   * Critique round 1 called the old DOM pips "the single worst-looking element
   * in the build": fixed-size nodes with percentage fills, so hull size never
   * reached the bar; a green/amber/red ramp that appears nowhere else in a
   * cyan/amber HUD; and no attachment to the hull, so three bars floated over
   * a fireball with nothing to belong to. Everything here answers one of those:
   *
   *   SIZE follows the projected hull diameter (`PIP_W_PER_D`), clamped to a
   *   legible band — a 2 km capital gets a 76 px bar, a fighter gets 16 px.
   *   POSITION is the bottom of the projected bounding sphere plus a fixed gap,
   *   with a leader tick back up to the hull, so the relationship is the same
   *   for every class at every distance.
   *   COLOUR is the team accent for the hull bar and pale cyan for shields —
   *   the HUD's own language. Damage is signalled by fill fraction plus a red
   *   rule under 30%, not by three unrelated hues.
   *   POPULATION is bounded: only damaged or selected hulls qualify, small
   *   hulls have their own cap, and alpha falls off with projected size so a
   *   distant swarm recedes instead of stippling the frame.
   *
   * Two passes so an over-budget furball drops fighter pips, never capitals.
   * Allocation-free: no arrays, no strings, no closures per frame.
   */
  private drawPips(world: World, camera: THREE.Camera, w: number, h: number): void {
    const ctx = this.pipCtx;
    if (!ctx) return;

    // Skip the clear when the canvas is already empty (idle camera, no damage).
    if (this.pipDrawn !== 0) ctx.clearRect(0, 0, w, h);

    const selN = world.selection.length;
    const allowSel = selN > 0 && selN <= PIP_SEL_MAX;
    let n = this.pipPass(world, camera, w, h, ctx, true, allowSel, 0, MAX_PIPS);
    n = this.pipPass(world, camera, w, h, ctx, false, allowSel, n, Math.min(MAX_PIPS, n + MAX_SMALL_PIPS));
    ctx.globalAlpha = 1;
    this.pipDrawn = n;
  }

  /**
   * One pip pass. `big` selects frigate-and-up on the first pass and everything
   * below it on the second, so the budget is spent on the hulls that matter.
   * Returns the running pip count.
   */
  private pipPass(
    world: World,
    camera: THREE.Camera,
    w: number,
    h: number,
    ctx: CanvasRenderingContext2D,
    big: boolean,
    allowSel: boolean,
    from: number,
    limit: number,
  ): number {
    const sp = this.sp;
    const ships = world.ships;
    // 4K needs thicker rules or the pip vanishes; 720p must not get fatter.
    const k = Math.max(1, Math.min(1.7, this.vh / 1000));
    const barH = Math.max(2, Math.round(PIP_H * k));
    const shH = Math.max(1, Math.round(PIP_SH_H * k));
    let n = from;

    for (let i = 0; i < ships.count && n < limit; i++) {
      const s = ships.items[i];
      if (!s.alive || s.dockedIn >= 0) continue;
      const spec = SHIP_SPECS[s.cls];
      if ((spec.size >= HullSize.Frigate) !== big) continue;

      const hf = spec.maxHp > 0 ? Math.max(0, Math.min(1, s.hp / spec.maxHp)) : 0;
      const sf = spec.maxShield > 0 ? Math.max(0, Math.min(1, s.shield / spec.maxShield)) : -1;
      const selected = this.selMark[s.id] === 1;
      const hurt = hf < (big ? PIP_HURT_BIG : PIP_HURT_SMALL) || (sf >= 0 && sf < 0.985);
      // Only damaged or selected hulls carry a pip — an intact fleet cruising
      // in formation shows nothing at all.
      if (!hurt && !(selected && allowSel)) continue;

      projectToScreen(camera, s.pos.x, s.pos.y, s.pos.z, w, h, sp);
      if (!sp.onScreen) continue;
      const rpx = (spec.radius * this.pxPerM) / Math.max(1, sp.dist);
      if (rpx < PIP_MIN_RPX && !selected) continue;

      const bw = Math.max(PIP_W_MIN, Math.min(PIP_W_MAX, rpx * 2 * PIP_W_PER_D));
      const x = Math.round(sp.x - bw * 0.5);
      const hullBottom = sp.y + rpx;
      const y = Math.round(hullBottom + PIP_GAP * k);

      // Recede with projected size so a distant swarm does not stipple the
      // frame; selected hulls always read at full strength.
      let a = selected ? 1 : 0.35 + Math.min(0.6, (rpx - PIP_MIN_RPX) * 0.05);
      if (a > 0.95) a = 0.95;
      ctx.globalAlpha = a;

      const cx = Math.round(sp.x);
      const bwi = Math.round(bw);

      // Dark keyline. One pixel proud of the bar on each side — enough to hold
      // the pip against a fireball, small enough that the UNFILLED remainder
      // never reads as a black slab.
      // Four rects, NOT one filled rect: the keyline has to be an OUTLINE. A
      // filled backing plate is exactly what made the unfilled remainder read
      // as a grey slab dropped over the battle.
      ctx.fillStyle = 'rgba(3,7,12,0.5)';
      ctx.fillRect(x - 1, y - 1, bwi + 2, 1);
      ctx.fillRect(x - 1, y + barH, bwi + 2, 1);
      ctx.fillRect(x - 1, y, 1, barH);
      ctx.fillRect(x + bwi, y, 1, barH);
      // Leader tick down from the hull with a 1 px shadow beside it, so the
      // attachment survives a bright backdrop without reading as a rail.
      const ty = Math.round(hullBottom);
      const tickH = Math.max(2, y - 1 - ty);
      ctx.fillRect(cx + 1, ty, 1, tickH);

      // Track: barely there — the outline already carries the pip's length, so
      // an empty bar is a hairline rectangle, not a block of value.
      ctx.fillStyle = 'rgba(10,18,28,0.22)';
      ctx.fillRect(x, y, bwi, barH);
      ctx.fillStyle = 'rgba(205,231,250,0.75)';
      ctx.fillRect(cx, ty, 1, tickH);

      // Hull fill in the team accent.
      ctx.fillStyle = this.pipTeamCss[s.team] ?? UI.text;
      ctx.fillRect(x, y, Math.max(1, Math.round(bwi * hf)), barH);

      // Critical: the bar itself goes red under 30%. One extra state, no ramp.
      if (hf < 0.3) {
        ctx.fillStyle = UI.bad;
        ctx.fillRect(x, y, Math.max(1, Math.round(bwi * hf)), barH);
      }

      // Shield sits ABOVE the hull bar as a thinner pale-cyan line, matching
      // the selection panel's shield language.
      if (sf > 0.001) {
        ctx.globalAlpha = a * 0.7;
        ctx.fillStyle = UI.resource;
        ctx.fillRect(x, y - shH - 2, Math.max(1, Math.round(bwi * sf)), shH);
        ctx.globalAlpha = a;
      }
      n++;
    }
    return n;
  }

  // -- alerts ---------------------------------------------------------------

  private updateAlerts(world: World, dt: number): void {
    const mid = world.motherships[Team.Player];
    const ms = mid >= 0 ? world.ship(mid) : undefined;

    if (ms) {
      this.sawMothership = true;
      const spec = SHIP_SPECS[ms.cls];
      const pool = ms.hp + ms.shield;
      if (this.lastMotherPool >= 0 && pool < this.lastMotherPool - 0.5) {
        // Scale the flash so a torpedo salvo reads harder than point defence
        // chip damage, but any hit at all is instantly visible.
        const frac = (this.lastMotherPool - pool) / Math.max(1, spec.maxHp * 0.01);
        this.flash = Math.min(1, this.flash + 0.12 + Math.min(0.6, frac * 0.35));
      }
      this.lastMotherPool = pool;

      const hf = ms.hp / spec.maxHp;
      const crit = hf < CRITICAL_HULL;
      if (crit !== this.alertOn) {
        this.alertOn = crit;
        this.alertBanner.classList.toggle('on', crit);
      }
      if (crit) this.alertTxt.set('Mothership hull critical — ' + Math.max(0, Math.round(hf * 100)) + '%');
    } else {
      // Only mourn a mothership we actually saw. Sandbox / turntable
      // scenarios start with an empty map and must not raise the banner.
      this.lastMotherPool = -1;
      const lost = this.sawMothership;
      if (lost !== this.alertOn) {
        this.alertOn = lost;
        this.alertBanner.classList.toggle('on', lost);
      }
      if (lost) this.alertTxt.set('Mothership lost');
    }

    // Exponential falloff: sharp attack, readable tail.
    this.flash *= Math.exp(-dt * 3.4);
    if (this.flash < 0.004) this.flash = 0;
    const o = Math.round(this.flash * 100) / 100;
    if (o !== this.lastFlashWritten) {
      this.lastFlashWritten = o;
      this.hitFlash.style.opacity = o === 0 ? '0' : o.toFixed(2);
    }
  }

  // -------------------------------------------------------------------------

  /** Detach every listener and remove this HUD's DOM. Sibling UI layers that
   *  share the root are left alone. Safe to call twice. */
  /**
   * Credit a track for a few seconds. Called by the integrator when the score
   * starts one; the HUD does not know or care what the score is doing
   * otherwise.
   */
  showNowPlaying(title: string, author: string): void {
    this.nowPlaying.textContent = `\u266a  ${title} — ${author}`;
    this.nowPlaying.classList.add('is-on');
    this.nowPlayingTimer = NOW_PLAYING_SECONDS;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    window.removeEventListener('resize', this.onResize);
    for (const n of this.owned) if (n.parentNode === this.root) this.root.removeChild(n);
    this.owned.length = 0;
    this.rows.length = 0;
    this.brackets.length = 0;
    this.reticles.length = 0;
    this.arrows.length = 0;
    this.logLines.length = 0;
  }
}
