/**
 * CONTROLS — the full RTS input layer.
 *
 * This is the whole player-facing control scheme: selection, band-box, context
 * orders, the Homeworld move disc, camera driving, control groups, subgroups,
 * formations, stances and command hotkeys. It owns `world.selection` (see
 * `World.selection`) and emits `selection` on the bus whenever it changes.
 *
 * ---------------------------------------------------------------------------
 * MOUSE
 *   LMB click            select (exact hull ray, then a generous screen-space
 *                        fallback so small fighters at range are still clickable)
 *   LMB click + Shift    add to selection      + Ctrl  toggle
 *   LMB drag             band select
 *   LMB double-click     select every visible ship of the same class
 *   LMB on empty space   deselect
 *   RMB click            context order: enemy = attack, friendly carrier = dock,
 *                        friendly = guard, asteroid = harvest (collectors) or
 *                        move, empty = move
 *   RMB drag vertically  MOVE DISC (only with a selection) — raises/lowers the
 *                        tactical plane. `moveGizmo` exposes the line + disc for
 *                        the UI to draw. Release commits the 3D move.
 *   MMB drag             pan            Shift+MMB / Alt+LMB   orbit
 *   RMB drag horizontally orbit (the order is cancelled)
 *   Wheel                multiplicative zoom
 *   SPACE HELD + drag    CAMERA ONLY — LMB pans, RMB orbits, and no selection,
 *                        deselection or order can happen while it is down. Every
 *                        other camera binding doubles as a gameplay binding, so
 *                        this is the one gesture that is safe by construction.
 *
 * KEYBOARD
 *   Arrows / edge        pan            Q / E            yaw
 *   W                    pan forward    Space (tap)      centre on selection
 *   F                    frame selection            Shift+F  cinematic chase
 *   Tab / Shift+Tab      cycle subgroup (by ship class)
 *   Ctrl+1..9            assign control group       1..9   recall (2x = centre)
 *   Ctrl+A               select all
 *   A                    attack-move cursor   S stop   D dock   H harvest
 *   M                    move cursor          G guard cursor
 *   Alt+0..6             formation: None, Delta, Broad, Wall, Sphere, Claw, Line
 *   Alt+7                formation: auto (picked from the selection's makeup)
 *   Z X C V              stance: Aggressive, Neutral, Passive, Evasive
 *   Shift + any order    queue instead of replace
 *   Esc                  cancel cursor mode, else clear selection
 *
 * A / S / D carry both a command and a pan direction. They are disambiguated the
 * way every shipped game does it: a TAP (released inside `TAP_SECONDS`) fires the
 * command, a HOLD pans. Arrow keys and W pan instantly and are never ambiguous,
 * so panning is always available even mid-command.
 *
 * ---------------------------------------------------------------------------
 * ALLOCATION: nothing here allocates inside `update` or inside an event handler.
 * All ray results, band rectangles and gizmo state are preallocated and reused.
 */

import { Vector3 } from 'three';
import { bus } from '../core/bus';
import { CONFIG } from '../core/config';
import { SHIP_SPECS } from '../core/registry';
import { Formation, ShipClass, Stance, Team } from '../core/types';
import type { World } from '../sim/world';
import type { NdcPoint, PickRay } from '../render/cameraRig';
import { TacticalCamera } from '../render/cameraRig';
import {
  commandAttack,
  commandAttackMove,
  commandDock,
  commandHarvest,
  commandMove,
  commandStop,
  defaultFormation,
  orderGuard,
  setStance,
} from '../sim/orders';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Input feel constants. */
export const INPUT = {
  /** Pixels of travel before a click becomes a drag. */
  dragPixels: 5,
  /** Pixels of vertical RMB travel before the move disc engages. */
  gizmoPixels: 16,
  /**
   * Pixels of HORIZONTAL right-drag travel before the gesture becomes a camera
   * orbit and the pending order is cancelled.
   *
   * Deliberately much larger than `gizmoPixels`. Sharing that 7 px threshold
   * meant an ordinary right-CLICK with a few pixels of hand movement was
   * reclassified as an orbit, so the order silently never issued — the reported
   * "once selected I cannot right-click for more actions". An order is the
   * common intent and must win ties; orbiting is a deliberate sweep.
   */
  orbitPixels: 26,
  /** Milliseconds between clicks that still count as a double-click. */
  doubleMs: 330,
  /** Milliseconds between control-group taps that count as a double-tap. */
  groupTapMs: 400,
  /** Seconds a command key may be held and still register as a tap, not a pan. */
  tapSeconds: 0.19,
  /** Screen-space pick radius in CSS pixels, on top of the hull's own footprint. */
  pickPixels: 22,
  /** Extra pixels of slack around the band box when testing hull footprints. */
  bandPad: 3,
  /** Edge-scroll margin in CSS pixels. 0 disables edge scrolling. */
  edgeMargin: 14,
  /** Edge-scroll speed as a fraction of orbit distance per second. */
  edgeRate: 0.62,
  /** Wheel notch normalisation — Firefox reports lines, others pixels. */
  wheelLine: 32,
  /** Keyboard yaw rate, radians per second. */
  keyYawRate: 1.25,
};

/**
 * The control scheme, as data.
 *
 * The header comment above is the prose version and the handlers below are the
 * truth, but the MENU needs a list it can render, and a keymap hand-copied into
 * the UI layer is the kind of thing that is correct exactly once. Keeping it in
 * this file at least puts it under the nose of whoever changes a binding.
 */
export const CONTROL_HELP: readonly { group: string; rows: readonly (readonly [string, string])[] }[] = [
  {
    group: 'Selecting',
    rows: [
      ['Left click', 'select a ship'],
      ['Left drag', 'band select'],
      ['Shift / Ctrl + click', 'add to / toggle in the selection'],
      ['Double click', 'select every visible ship of that class'],
      ['Tab / Shift+Tab', 'cycle subgroup by class'],
      ['Ctrl+A', 'select all'],
      ['Ctrl+1..9 / 1..9', 'assign / recall control group (recall twice to centre)'],
      ['Fleet bar (left edge)', 'select a whole class; double click to frame it'],
      ['Esc', 'cancel an armed order, else clear the selection'],
    ],
  },
  {
    group: 'Ordering',
    rows: [
      ['Right click', 'context order — attack, dock, guard, harvest or move'],
      ['Right drag up / down', 'move disc: set the destination ALTITUDE'],
      ['Shift + any order', 'queue it instead of replacing'],
      ['A / M / G', 'arm attack-move / move / guard, then click'],
      ['S', 'stop'],
      ['D', 'dock'],
      ['H', 'harvest'],
      ['Alt+0..7', 'formation — none, delta, broad, wall, sphere, claw, line, auto'],
      ['Z X C V', 'stance — aggressive, neutral, passive, evasive'],
    ],
  },
  {
    group: 'Camera',
    rows: [
      ['Hold SPACE + drag', 'CAMERA ONLY — left pans, right orbits, no orders fire'],
      ['Middle drag', 'pan'],
      ['Alt + left drag', 'orbit'],
      ['Right drag sideways', 'orbit (cancels the pending order)'],
      ['Wheel', 'zoom'],
      ['Arrows / W / screen edge', 'pan'],
      ['Q / E', 'yaw'],
      ['Hold A / S / D', 'pan (a TAP is the command instead)'],
      ['Space (tap)', 'centre on the selection'],
      ['F / Shift+F', 'frame and follow the selection / cinematic chase'],
    ],
  },
];

/** Cursor modes armed by a hotkey and consumed by the next click. */
export type CursorMode = 'none' | 'attackMove' | 'move' | 'guard';

/** Ray-casting hooks supplied by the render layer (hull-accurate picking). */
export interface ControlHooks {
  /** Nearest ship hit by the ray, or -1. */
  raycastShip(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number;
  /** Nearest asteroid hit by the ray, or -1. */
  raycastRock(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number;
}

/** Screen-space band selection rectangle, CSS pixels. */
export interface BandRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Move-disc state: the vertical line from the tactical plane to the destination. */
export interface MoveGizmo {
  /** Destination X (fixed at press time). */
  x: number;
  /** Destination Y after the vertical drag. */
  y: number;
  /** Destination Z (fixed at press time). */
  z: number;
  /** Height of the tactical plane the line rises from. */
  baseY: number;
}

// ---------------------------------------------------------------------------
// Module scratch
// ---------------------------------------------------------------------------

const _hit = new Vector3();
const _ndc: NdcPoint = { x: 0, y: 0 };

/**
 * Rate (1/s) at which the follow's aim point converges on the selection
 * centroid. This is a filter on the TARGET; the rig's own spring then smooths
 * the camera's approach to it. Two gentle stages beat one stiff one.
 */
const FOLLOW_SMOOTH = 3.2;

/** Tap-state sentinels for the dual-purpose A/S/D keys. */
const KEY_UP = -1;
const KEY_PAN = -2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Shared ascending comparator — hoisted so sorting never allocates a closure. */
const ASC = (a: number, b: number): number => a - b;

/** Alt+digit -> formation. Index 7 is the "auto" escape hatch, handled separately. */
const FORMATION_KEYS: Formation[] = [
  Formation.None,
  Formation.Delta,
  Formation.Broad,
  Formation.Wall,
  Formation.Sphere,
  Formation.Claw,
  Formation.Line,
];

/** HUD labels for {@link FORMATION_KEYS}. */
const FORMATION_NAMES = ['NONE', 'DELTA', 'BROAD', 'WALL', 'SPHERE', 'CLAW', 'LINE'];

// ---------------------------------------------------------------------------

type PointerMode = 'none' | 'select' | 'orbit' | 'pan' | 'order';

/**
 * The RTS control scheme. Construct once, call `update(dt)` every frame after
 * the camera rig has been updated, and `dispose()` on teardown.
 */
export class Controls {
  private canvas: HTMLCanvasElement;
  private cam: TacticalCamera;
  private world: World;
  private hooks: ControlHooks;

  // -- cached canvas rect (getBoundingClientRect allocates; never per-move) --
  private rl = 0;
  private rt = 0;
  private rw = 1;
  private rh = 1;

  // -- pointer state -------------------------------------------------------
  private pointerId = -1;
  private mode: PointerMode = 'none';
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private curX = 0;
  private curY = 0;
  private prevHoverX = -1;
  private prevHoverY = -1;
  private moved = false;
  private inside = false;
  private lastClickMs = 0;
  private lastClickX = 0;
  private lastClickY = 0;

  // -- band ----------------------------------------------------------------
  private _band: BandRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private bandActive = false;

  // -- move disc -----------------------------------------------------------
  private _gizmo: MoveGizmo = { x: 0, y: 0, z: 0, baseY: 0 };
  private gizmoActive = false;
  /** Ship / rock the RMB press landed on, resolved once at press time. */
  private orderShip = -1;
  /** True while F-follow is latched; see `trackFollow`. */
  private following = false;
  /** Filtered aim point for the follow — see `trackFollow`. */
  private followX = 0;
  private followY = 0;
  private followZ = 0;
  /** False until the follow has seeded its filter from a real centroid. */
  private followInit = false;
  private orderRock = -1;

  // -- keyboard ------------------------------------------------------------
  private held = new Set<string>();
  /** Tap-vs-hold timers for the dual-purpose keys. See KEY_UP / KEY_PAN. */
  private tapA = KEY_UP;
  private tapS = KEY_UP;
  private tapD = KEY_UP;
  /**
   * Space: tap = centre on selection, hold = camera-drag modifier.
   * KEY_UP when not pressed, otherwise seconds held.
   */
  private tapSpace = KEY_UP;
  /**
   * True once a Space-held drag has actually moved the camera, so releasing the
   * key does not ALSO fire the tap action and re-centre the view.
   */
  private camDragUsed = false;

  // -- selection state -----------------------------------------------------
  /** Control groups 0..9 (index 0 is reachable via the `0` key). */
  readonly groups: number[][] = [[], [], [], [], [], [], [], [], [], []];
  private lastGroupKey = -1;
  private lastGroupMs = 0;
  /** Snapshot the Tab subgroup cycle walks; -1 = whole selection. */
  private tabBase: number[] = [];
  private tabIndex = -1;
  private tabClasses: ShipClass[] = [];

  private scratch: number[] = [];
  private scratch2: number[] = [];
  private selPayload: { ids: number[] };

  private _cursor: CursorMode = 'none';
  private _hover = -1;
  /**
   * Formation the player has dialled in, or null for "auto" (the shape
   * `defaultFormation` picks from the composition of the selection).
   */
  private _formation: Formation | null = null;

  // -------------------------------------------------------------------------

  constructor(canvas: HTMLCanvasElement, camera: TacticalCamera, world: World, opts: ControlHooks) {
    this.canvas = canvas;
    this.cam = camera;
    this.world = world;
    this.hooks = opts;
    this.selPayload = { ids: world.selection };

    this.refreshRect();

    canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    canvas.addEventListener('pointerup', this.onPointerUp, { passive: true });
    canvas.addEventListener('pointercancel', this.onPointerCancel, { passive: true });
    canvas.addEventListener('pointerenter', this.onPointerEnter, { passive: true });
    canvas.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu, { passive: false });
    canvas.addEventListener('auxclick', this.onAuxClick, { passive: false });
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp, { passive: true });
    window.addEventListener('blur', this.onBlur, { passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });
    document.addEventListener('visibilitychange', this.onBlur, { passive: true });
  }

  // -------------------------------------------------------------------------
  // Public read-only state for the UI layer
  // -------------------------------------------------------------------------

  /**
   * Current band-box in CSS pixels for the UI to draw, or null.
   * The object is REUSED between frames — read it, do not retain it.
   */
  get band(): BandRect | null {
    return this.bandActive ? this._band : null;
  }

  /**
   * Move-order gizmo state for the UI: the vertical Z-plane line being dragged,
   * or null. REUSED between frames.
   */
  get moveGizmo(): MoveGizmo | null {
    return this.gizmoActive ? this._gizmo : null;
  }

  /** Armed cursor mode, for the HUD reticle. */
  get cursor(): CursorMode {
    return this._cursor;
  }

  /** Ship id under the pointer this frame, or -1. */
  get hover(): number {
    return this._hover;
  }

  /** Formation the next move order will use, or null when it is automatic. */
  get formation(): Formation | null {
    return this._formation;
  }

  /**
   * Formation to stamp on a move order: the player's choice, or the shape the
   * order layer would pick for this selection's composition.
   */
  private formationFor(ids: number[]): Formation {
    return this._formation !== null ? this._formation : defaultFormation(this.world, ids);
  }

  /** Pointer position in CSS pixels relative to the canvas. */
  get pointerX(): number {
    return this.curX;
  }
  /** Pointer position in CSS pixels relative to the canvas. */
  get pointerY(): number {
    return this.curY;
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  /** Run once per frame, after `TacticalCamera.update`. */
  update(dt: number): void {
    const h = clamp(dt, 0, 0.1);

    this.stepTapTimers(h);
    this.driveCamera(h);
    this.trackFollow(h);
    this.updateHover();
    this.updateGizmo();
    if (this.bandActive) this.updateBandRect();
  }

  /**
   * Keep the camera on the selection while follow is latched by F.
   *
   * Aims at the live centroid rather than re-framing, so the player keeps
   * whatever orbit distance and angle they had — following must not fight the
   * camera, only translate it. Orbiting is deliberately NOT a cancel: swinging
   * around a fleet you are following is exactly what you want to do.
   */
  private trackFollow(dt: number): void {
    if (!this.following) return;
    // Never re-aim while the player has a hand on the camera. Feeding the focus
    // spring a new target on the same frames the drag is moving it is what made
    // following feel like it was fighting the mouse.
    if (this.mode === 'orbit' || this.mode === 'pan' || this.cam.dragging) return;
    const sel = this.world.selection;
    if (sel.length === 0) {
      this.following = false;
      return;
    }
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    for (let i = 0; i < sel.length; i++) {
      const s = this.world.ship(sel[i]);
      if (!s || s.dockedIn >= 0) continue;
      x += s.pos.x;
      y += s.pos.y;
      z += s.pos.z;
      n++;
    }
    if (n === 0) {
      this.following = false;
      return;
    }
    x /= n;
    y /= n;
    z /= n;

    // Re-aim EVERY frame, and let the focus spring do the smoothing.
    //
    // The previous attempt used a dead zone — hold still until the centroid has
    // drifted a few percent of the orbit distance, then re-aim. That is itself
    // the stutter the player then reported: the camera sits, the threshold trips,
    // it lurches, it sits again. A dead zone is the right tool for suppressing
    // jitter in a value you display, and the wrong one for a target you are
    // already smoothing, because it quantises a continuous motion into steps.
    //
    // The rig's focus axis is a critically damped spring, so feeding it a target
    // that moves smoothly produces motion that is smooth by construction and
    // cannot overshoot. The genuine glitch was the drag conflict handled above,
    // where follow and the mouse wrote the same target on the same frame.
    //
    // The centroid is also low-pass filtered here so one hull dying — which
    // steps the average discontinuously — eases in rather than snapping.
    if (!this.followInit) {
      this.followInit = true;
      this.followX = x;
      this.followY = y;
      this.followZ = z;
    } else {
      const k = 1 - Math.exp(-FOLLOW_SMOOTH * dt);
      this.followX += (x - this.followX) * k;
      this.followY += (y - this.followY) * k;
      this.followZ += (z - this.followZ) * k;
    }
    this.cam.moveTo(this.followX, this.followY, this.followZ);
  }

  /**
   * Drop the follow latch. Called by anything that means "I am driving the
   * camera myself now" — panning, a minimap jump, or clearing the selection.
   */
  stopFollow(): void {
    this.following = false;
    this.followInit = false;
  }

  /** Promote held command keys into pan keys once they pass the tap window. */
  private stepTapTimers(dt: number): void {
    if (this.tapA >= 0) {
      this.tapA += dt;
      if (this.tapA > INPUT.tapSeconds) this.tapA = KEY_PAN;
    }
    if (this.tapS >= 0) {
      this.tapS += dt;
      if (this.tapS > INPUT.tapSeconds) this.tapS = KEY_PAN;
    }
    if (this.tapSpace >= 0) this.tapSpace += dt;
    if (this.tapD >= 0) {
      this.tapD += dt;
      if (this.tapD > INPUT.tapSeconds) this.tapD = KEY_PAN;
    }
  }

  /** Keyboard pan/yaw plus edge scrolling. */
  private driveCamera(dt: number): void {
    const k = this.held;
    let right = 0;
    let fwd = 0;

    if (k.has('ArrowUp') || k.has('KeyW')) fwd += 1;
    if (k.has('ArrowDown') || this.tapS === KEY_PAN) fwd -= 1;
    if (k.has('ArrowLeft') || this.tapA === KEY_PAN) right -= 1;
    if (k.has('ArrowRight') || this.tapD === KEY_PAN) right += 1;

    if (right !== 0 || fwd !== 0) {
      // Normalise the diagonal so corner-panning is not 41% faster.
      const inv = right !== 0 && fwd !== 0 ? Math.SQRT1_2 : 1;
      // Panning means the player is driving the camera; drop the F-follow latch.
      this.following = false;
      this.cam.panAxisRate(right * inv, fwd * inv, dt);
    }

    let yaw = 0;
    if (k.has('KeyQ')) yaw += 1;
    if (k.has('KeyE')) yaw -= 1;
    if (yaw !== 0) this.cam.orbit(yaw * INPUT.keyYawRate * dt, 0);

    // Edge scrolling — suppressed while dragging so a band-box near the edge
    // does not fling the camera.
    const m = INPUT.edgeMargin;
    if (m > 0 && this.inside && this.pointerId === -1) {
      let ex = 0;
      let ey = 0;
      if (this.curX < m) ex = -(1 - this.curX / m);
      else if (this.curX > this.rw - m) ex = 1 - (this.rw - this.curX) / m;
      if (this.curY < m) ey = 1 - this.curY / m;
      else if (this.curY > this.rh - m) ey = -(1 - (this.rh - this.curY) / m);
      if (ex !== 0 || ey !== 0) {
        this.following = false;
        this.cam.panAxisRate(clamp(ex, -1, 1), clamp(ey, -1, 1), dt, INPUT.edgeRate);
      }
    }
  }

  /** Refresh the hovered hull id, but only when the pointer actually moved. */
  private updateHover(): void {
    if (this.curX === this.prevHoverX && this.curY === this.prevHoverY) return;
    this.prevHoverX = this.curX;
    this.prevHoverY = this.curY;
    if (!this.inside) {
      this._hover = -1;
      return;
    }
    const r = this.rayAt(this.curX, this.curY);
    let id = this.hooks.raycastShip(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz);
    if (id < 0) id = this.pickScreen(this.curX, this.curY, -1);
    this._hover = id;
  }

  /**
   * Recompute the move-disc height from the accumulated vertical drag.
   *
   * Done every frame rather than on pointermove because the conversion depends
   * on the live orbit distance and pitch, which keep changing under a spring.
   */
  private updateGizmo(): void {
    if (!this.gizmoActive) return;
    const dy = this.curY - this.downY;
    const mpp = this.cam.metresPerPixel();
    // World +Y projects onto the screen scaled by cos(pitch); floor it so a
    // near-top-down camera does not turn the drag into a teleport.
    const cp = Math.max(Math.abs(Math.cos(this.cam.pitch)), 0.2);
    const g = this._gizmo;
    g.y = clamp(g.baseY - (dy * mpp) / cp, -CONFIG.mapHeight, CONFIG.mapHeight);
  }

  private updateBandRect(): void {
    const b = this._band;
    b.x0 = Math.min(this.downX, this.curX);
    b.y0 = Math.min(this.downY, this.curY);
    b.x1 = Math.max(this.downX, this.curX);
    b.y1 = Math.max(this.downY, this.curY);
  }

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------

  private onPointerDown = (e: PointerEvent): void => {
    this.refreshRect();
    this.setPointer(e);
    if (this.pointerId !== -1) return; // one drag at a time
    e.preventDefault();
    this.canvas.focus?.();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort; the window-level fallbacks cover the rest */
    }

    this.pointerId = e.pointerId;
    this.downX = this.curX;
    this.downY = this.curY;
    this.lastX = this.curX;
    this.lastY = this.curY;
    this.moved = false;
    this.cam.nudge();

    // CAMERA-DRAG MODE. While Space is held the mouse only drives the camera:
    // left drag pans, right drag orbits, and neither button can select, deselect
    // or issue an order. Every other camera binding doubles as a gameplay
    // binding — left-drag band-selects, right-drag is an order or the move disc
    // — which is what "it's always messing with me the selection and point"
    // describes. One modifier that suspends gameplay input entirely is the only
    // thing that makes moving the view safe by construction.
    if (this.camDrag) {
      this.mode = e.button === 2 ? 'orbit' : 'pan';
      this.following = false;
      this.camDragUsed = true;
      this.cam.setDragging(true);
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button === 0) {
      if (e.altKey) {
        this.mode = 'orbit';
        this.cam.setDragging(true);
      } else {
        this.mode = 'select';
      }
    } else if (e.button === 1) {
      // MIDDLE DRAG PANS. It used to orbit, with pan hidden behind Shift, which
      // left the game with no plain mouse-drag pan at all: left-drag band-selects
      // and right-drag orders or orbits. Before selecting anything a stray
      // band-drag is harmless, so the gap only shows up once you have a
      // selection — at which point dragging destroys the selection AND does not
      // move the camera, which reads as "once selected I cannot pan".
      //
      // Middle-drag-to-pan is also the convention nearly every RTS and every 3D
      // tool uses. Orbit keeps three bindings (Shift+middle, Alt+left, and a
      // horizontal right-drag), so nothing is lost.
      this.mode = e.shiftKey ? 'orbit' : 'pan';
      this.following = false;
      this.cam.setDragging(true);
    } else if (e.button === 2) {
      if (this._cursor !== 'none') {
        // RMB is the universal "never mind" for an armed cursor mode.
        this.setCursor('none');
        this.mode = 'none';
      } else {
        this.mode = 'order';
        this.primeOrder();
      }
    } else {
      this.mode = 'none';
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.setPointer(e);
    if (this.pointerId !== e.pointerId) return;

    const dx = this.curX - this.lastX;
    const dy = this.curY - this.lastY;
    this.lastX = this.curX;
    this.lastY = this.curY;

    if (!this.moved) {
      const tx = this.curX - this.downX;
      const ty = this.curY - this.downY;
      if (tx * tx + ty * ty > INPUT.dragPixels * INPUT.dragPixels) {
        this.moved = true;
        if (this.mode === 'select') {
          this.bandActive = true;
          this.updateBandRect();
        }
      }
    }

    if (this.mode === 'orbit') {
      this.cam.orbitByPixels(dx, dy);
    } else if (this.mode === 'pan') {
      this.following = false;
      this.cam.panByPixels(dx, dy);
    } else if (this.mode === 'order') {
      // Right-button drag is overloaded, split by the dominant axis:
      //
      //   vertical   -> the Homeworld move disc, lifting the destination off
      //                 the movement plane. Armed on vertical travel only so a
      //                 horizontal wobble while clicking an enemy cannot turn
      //                 the order into a 3D move.
      //   horizontal -> orbit the camera, which is what players reach for first
      //                 and what the rig otherwise only offered on the middle
      //                 button or Alt+left.
      //
      // Whichever axis crosses its threshold first claims the gesture for the
      // rest of the drag, so the two can never fight. Claiming it for the orbit
      // also cancels the pending order — releasing after an orbit must not
      // teleport the fleet to wherever the cursor ended up.
      if (!this.gizmoActive) {
        const tx = this.curX - this.downX;
        const ty = this.curY - this.downY;
        const thresh = INPUT.gizmoPixels * INPUT.gizmoPixels;
        const orbitThresh = INPUT.orbitPixels * INPUT.orbitPixels;
        if (tx * tx > orbitThresh && tx * tx > ty * ty) {
          // Horizontal claims the orbit unconditionally — including when the
          // press landed on a hull. Wanting to swing the camera around a ship
          // you are looking at is the common case, and switching the mode is
          // itself the cancellation: `onPointerUp` only commits an order while
          // the mode is still 'order'.
          this.mode = 'orbit';
          this.cam.setDragging(true);
          this.cam.orbitByPixels(dx, dy);
        } else if (
          this.orderShip < 0
          && this.world.selection.length > 0
          && ty * ty > thresh
        ) {
          // Vertical over empty space arms the move disc — but ONLY with ships
          // selected. The disc dials the altitude of a move order, so with an
          // empty selection it is dialling nothing, and arming it there meant
          // any stray vertical right-drag became a "raise" gesture that ate the
          // drag and left the camera stuck. That is the reported "mis-click felt
          // like I cannot pan, it always defaults to raise".
          this.gizmoActive = true;
          this.cam.setDragging(true);
        } else if (ty * ty > orbitThresh) {
          // Nothing to raise: fall through to orbiting on the vertical axis too,
          // so a right-drag always does SOMETHING with the camera rather than
          // silently swallowing the gesture.
          this.mode = 'orbit';
          this.cam.setDragging(true);
          this.cam.orbitByPixels(dx, dy);
        }
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return;
    this.setPointer(e);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }

    const mode = this.mode;
    const moved = this.moved;
    const shift = e.shiftKey;
    const ctrl = e.ctrlKey || e.metaKey;

    this.pointerId = -1;
    this.mode = 'none';
    this.moved = false;
    this.cam.setDragging(false);
    this.updateCursorClass();

    if (mode === 'select') {
      // An armed cursor mode outranks selection, drag or not — the player is
      // aiming an order, and a two-pixel wobble must not turn it into a band.
      if (this._cursor !== 'none') {
        this.bandActive = false;
        this.consumeCursor(shift);
      } else if (moved) {
        this.bandActive = false;
        this.applyBand(shift, ctrl);
      } else {
        this.clickSelect(shift, ctrl, e.timeStamp);
      }
    } else if (mode === 'order') {
      this.commitOrder(shift);
    }

    this.bandActive = false;
    this.gizmoActive = false;
    this.orderShip = -1;
    this.orderRock = -1;
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return;
    this.resetPointer();
  };

  private onPointerEnter = (): void => {
    this.inside = true;
  };

  private onPointerLeave = (): void => {
    this.inside = false;
    this._hover = -1;
    // A captured drag keeps running outside the canvas; only idle state resets.
    if (this.pointerId === -1) this.prevHoverX = Number.NaN;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // deltaMode 1 = lines, 2 = pages. Normalise everything to "notches".
    const unit = e.deltaMode === 1 ? INPUT.wheelLine : e.deltaMode === 2 ? this.rh : 1;
    const notches = clamp((e.deltaY * unit) / 100, -4, 4);
    this.cam.zoom(notches);
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onAuxClick = (e: Event): void => {
    e.preventDefault();
  };

  private onResize = (): void => {
    this.refreshRect();
  };

  private onBlur = (): void => {
    this.held.clear();
    this.tapA = KEY_UP;
    this.tapS = KEY_UP;
    this.tapD = KEY_UP;
    this.tapSpace = KEY_UP;
    this.resetPointer();
  };

  private resetPointer(): void {
    if (this.pointerId !== -1) {
      try {
        this.canvas.releasePointerCapture(this.pointerId);
      } catch {
        /* nothing to release */
      }
    }
    this.pointerId = -1;
    this.mode = 'none';
    this.moved = false;
    this.bandActive = false;
    this.gizmoActive = false;
    this.orderShip = -1;
    this.orderRock = -1;
    this.cam.setDragging(false);
  }

  /** Cache the pointer position in canvas-local CSS pixels. No allocation. */
  private setPointer(e: PointerEvent): void {
    this.curX = e.clientX - this.rl;
    this.curY = e.clientY - this.rt;
  }

  /**
   * Re-cache the canvas rect. `getBoundingClientRect` allocates and forces
   * layout, so this only runs on resize and on pointer-down — never per frame
   * and never per pointer-move.
   *
   * The canvas's client size is also the authoritative viewport for the camera's
   * pixel <-> metre maths, so it is pushed across here.
   */
  private refreshRect(): void {
    const r = this.canvas.getBoundingClientRect();
    this.rl = r.left;
    this.rt = r.top;
    this.rw = Math.max(1, r.width);
    this.rh = Math.max(1, r.height);
    this.cam.setViewportSize(this.rw, this.rh);
  }

  /** Picking ray for a canvas-local CSS pixel. The result object is reused. */
  private rayAt(px: number, py: number): PickRay {
    const nx = (px / this.rw) * 2 - 1;
    const ny = -((py / this.rh) * 2 - 1);
    return this.cam.ray(nx, ny);
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  /**
   * Screen-space fallback pick: nearest hull whose projected footprint (or a
   * generous pixel radius, whichever is larger) contains the cursor.
   * `team` of -1 accepts any team. Returns a ship id or -1.
   */
  private pickScreen(px: number, py: number, team: number): number {
    const ships = this.world.ships;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (!s.alive || s.dockedIn >= 0) continue;
      if (team >= 0 && s.team !== team) continue;
      if (!this.cam.project(s.pos.x, s.pos.y, s.pos.z, _ndc)) continue;
      const sx = (_ndc.x * 0.5 + 0.5) * this.rw;
      const sy = (1 - (_ndc.y * 0.5 + 0.5)) * this.rh;
      const dx = sx - px;
      const dy = sy - py;
      const d2 = dx * dx + dy * dy;
      const dist = Math.sqrt(this.cam.distanceTo2(s.pos.x, s.pos.y, s.pos.z));
      const rPix = SHIP_SPECS[s.cls].radius * this.cam.pixelsPerMetre(dist);
      // THIS FALLBACK IS ONLY FOR SHIPS TOO SMALL TO HIT PRECISELY.
      //
      // It used to reach `max(rPix, pickPixels)`, i.e. the hull's whole
      // projected BOUNDING-SPHERE radius. For a Mothership at 3 km that is
      // hundreds of pixels, so clicking empty space most of a kilometre from the
      // hull still selected it, and the geometry-accurate ray added in
      // render/picking.ts was overruled by this the moment it correctly missed.
      // That is the reported "selection is not by geometry".
      //
      // Anything whose footprint is already larger than the forgiveness radius
      // must be hit by the ray or not at all.
      if (rPix > INPUT.pickPixels) continue;
      const reach = INPUT.pickPixels;
      if (d2 > reach * reach) continue;
      // Rank by how deep inside the hull's own footprint the cursor sits, then
      // by depth — so a fighter in front of a mothership still wins the click.
      const score = d2 / (reach * reach) + dist * 1e-7;
      if (score < bestScore) {
        bestScore = score;
        best = s.id;
      }
    }
    return best;
  }

  /** Resolve a single LMB click: exact ray first, generous screen pick second. */
  private clickSelect(shift: boolean, ctrl: boolean, timeStamp: number): void {
    const r = this.rayAt(this.curX, this.curY);
    let id = this.hooks.raycastShip(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz);
    if (id < 0) id = this.pickScreen(this.curX, this.curY, Team.Player);

    const dbl =
      timeStamp - this.lastClickMs < INPUT.doubleMs &&
      Math.abs(this.curX - this.lastClickX) < 6 &&
      Math.abs(this.curY - this.lastClickY) < 6;
    this.lastClickMs = timeStamp;
    this.lastClickX = this.curX;
    this.lastClickY = this.curY;

    const s = id >= 0 ? this.world.ship(id) : undefined;
    if (!s || s.team !== Team.Player) {
      if (!shift && !ctrl) this.setSelection(null);
      return;
    }

    if (dbl) {
      this.selectVisibleClass(s.cls, shift);
      return;
    }

    const sel = this.world.selection;
    if (ctrl) {
      const at = sel.indexOf(id);
      this.scratch.length = 0;
      for (let i = 0; i < sel.length; i++) if (sel[i] !== id) this.scratch.push(sel[i]);
      if (at < 0) this.scratch.push(id);
      this.setSelection(this.scratch);
    } else if (shift) {
      if (sel.indexOf(id) < 0) {
        this.scratch.length = 0;
        for (let i = 0; i < sel.length; i++) this.scratch.push(sel[i]);
        this.scratch.push(id);
        this.setSelection(this.scratch);
      }
    } else {
      this.scratch.length = 0;
      this.scratch.push(id);
      this.setSelection(this.scratch);
    }
  }

  /** Collect every player hull whose projected footprint overlaps the band box. */
  private applyBand(shift: boolean, ctrl: boolean): void {
    const b = this._band;
    const out = this.scratch;
    out.length = 0;

    if (shift || ctrl) {
      const sel = this.world.selection;
      for (let i = 0; i < sel.length; i++) out.push(sel[i]);
    }

    const ships = this.world.ships;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (!s.alive || s.team !== Team.Player || s.dockedIn >= 0) continue;
      if (!this.cam.project(s.pos.x, s.pos.y, s.pos.z, _ndc)) continue;
      const sx = (_ndc.x * 0.5 + 0.5) * this.rw;
      const sy = (1 - (_ndc.y * 0.5 + 0.5)) * this.rh;
      const dist = Math.sqrt(this.cam.distanceTo2(s.pos.x, s.pos.y, s.pos.z));
      const pad = SHIP_SPECS[s.cls].radius * this.cam.pixelsPerMetre(dist) + INPUT.bandPad;
      if (sx < b.x0 - pad || sx > b.x1 + pad || sy < b.y0 - pad || sy > b.y1 + pad) continue;

      if (ctrl) {
        const at = out.indexOf(s.id);
        if (at >= 0) out.splice(at, 1);
        else out.push(s.id);
      } else if (out.indexOf(s.id) < 0) {
        out.push(s.id);
      }
    }

    // A band that caught nothing and added nothing is a deselect gesture.
    if (out.length === 0 && !shift && !ctrl) this.setSelection(null);
    else this.setSelection(out);
  }

  /** Double-click behaviour: every on-screen hull of the same class. */
  private selectVisibleClass(cls: ShipClass, additive: boolean): void {
    const out = this.scratch;
    out.length = 0;
    if (additive) {
      const sel = this.world.selection;
      for (let i = 0; i < sel.length; i++) out.push(sel[i]);
    }
    const ships = this.world.ships;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (!s.alive || s.cls !== cls || s.team !== Team.Player || s.dockedIn >= 0) continue;
      if (!this.cam.project(s.pos.x, s.pos.y, s.pos.z, _ndc)) continue;
      if (_ndc.x < -1 || _ndc.x > 1 || _ndc.y < -1 || _ndc.y > 1) continue;
      if (out.indexOf(s.id) < 0) out.push(s.id);
    }
    this.setSelection(out);
  }

  /** Select every living player hull. */
  private selectAll(): void {
    const out = this.scratch;
    out.length = 0;
    const ships = this.world.ships;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (s.alive && s.team === Team.Player && s.dockedIn < 0) out.push(s.id);
    }
    this.setSelection(out);
  }

  /**
   * Write the new selection into `world.selection` in place and announce it.
   * Pass null to clear. The emitted payload's `ids` aliases `world.selection`,
   * so consumers must copy it if they intend to keep it.
   *
   * `src` must not be `world.selection` itself.
   */
  private assignSelection(src: number[] | null): void {
    const sel = this.world.selection;
    const had = sel.length;
    sel.length = 0;
    if (src) for (let i = 0; i < src.length; i++) sel.push(src[i]);
    bus.emit('selection', this.selPayload);
    // Acknowledge a selection the player GAINED. Clearing is deliberately
    // silent: an empty selection is the resting state, and beeping on the way
    // back to it turns every misclick into a complaint.
    if (sel.length > 0 && sel.length !== had) {
      bus.emit('ack', { kind: 'select', count: sel.length });
    }
  }

  /** As {@link assignSelection}, but also drops the Tab subgroup cycle state. */
  private setSelection(src: number[] | null): void {
    // Changing the selection cancels follow. Otherwise clicking a ship while
    // following silently re-aimed the camera at the new selection and flew it
    // in — "clicking on mothership will zoom into it". Follow is a mode the
    // player enters with F, and picking a different unit is not a request to
    // fly there.
    this.following = false;
    this.followInit = false;
    this.tabIndex = -1;
    this.tabBase.length = 0;
    this.tabClasses.length = 0;
    this.assignSelection(src);
  }

  // -------------------------------------------------------------------------
  // Subgroup cycling (Tab)
  // -------------------------------------------------------------------------

  /**
   * Cycle the selection through its constituent ship classes, Homeworld-style.
   * The full set is snapshotted on the first Tab and restored when the cycle
   * wraps, so Tab is always reversible.
   */
  private cycleSubgroup(back: boolean): void {
    const sel = this.world.selection;
    if (this.tabIndex === -1) {
      this.tabBase.length = 0;
      for (let i = 0; i < sel.length; i++) this.tabBase.push(sel[i]);
      this.tabClasses.length = 0;
      for (let i = 0; i < this.tabBase.length; i++) {
        const s = this.world.ship(this.tabBase[i]);
        if (s && this.tabClasses.indexOf(s.cls) < 0) this.tabClasses.push(s.cls);
      }
      this.tabClasses.sort(ASC);
    }
    const n = this.tabClasses.length;
    if (n <= 1 || this.tabBase.length === 0) return;

    // Indices 0..n-1 are single-class subgroups; n wraps back to the full set.
    let next = this.tabIndex + (back ? -1 : 1);
    if (next > n - 1) next = -1;
    if (next < -1) next = n - 1;

    const out = this.scratch2;
    out.length = 0;
    for (let i = 0; i < this.tabBase.length; i++) {
      const s = this.world.ship(this.tabBase[i]);
      if (!s) continue;
      if (next < 0 || s.cls === this.tabClasses[next]) out.push(s.id);
    }
    if (out.length === 0) return;

    // Assign WITHOUT resetting the snapshot — that is what makes Tab a cycle.
    this.assignSelection(out);
    this.tabIndex = next;
  }

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  /** Resolve what the RMB press landed on, once, at press time. */
  private primeOrder(): void {
    const r = this.rayAt(this.curX, this.curY);
    this.orderShip = this.hooks.raycastShip(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz);
    if (this.orderShip < 0) this.orderShip = this.pickScreen(this.curX, this.curY, -1);
    this.orderRock = this.orderShip >= 0
      ? -1
      : this.hooks.raycastRock(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz);

    // The move disc rises from the tactical plane through the selection's
    // centroid — that is the plane the fleet is already flying on.
    const baseY = this.selectionCentroidY();
    this.cam.rayPlaneY(r, baseY, _hit);
    const g = this._gizmo;
    g.x = _hit.x;
    g.z = _hit.z;
    g.baseY = baseY;
    g.y = baseY;
  }

  /** Mean Y of the current selection, falling back to the camera focus plane. */
  private selectionCentroidY(): number {
    const sel = this.world.selection;
    let y = 0;
    let n = 0;
    for (let i = 0; i < sel.length; i++) {
      const s = this.world.ship(sel[i]);
      if (!s) continue;
      y += s.pos.y;
      n++;
    }
    return n > 0 ? y / n : this.cam.focus.y;
  }

  /** RMB release: commit the move disc, or issue a context-sensitive order. */
  private commitOrder(queue: boolean): void {
    const sel = this.world.selection;
    if (sel.length === 0) return;

    if (this.gizmoActive) {
      const g = this._gizmo;
      commandMove(this.world, sel, g.x, g.y, g.z, queue, this.formationFor(sel));
      bus.emit('notice', { text: 'MOVE ORDER CONFIRMED', kind: 'info' });
      return;
    }

    // Re-cast at the release point: the pointer may have crept a few pixels.
    const r = this.rayAt(this.curX, this.curY);
    let shipId = this.hooks.raycastShip(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz);
    if (shipId < 0) shipId = this.pickScreen(this.curX, this.curY, -1);
    const rockId = shipId >= 0 ? -1 : this.hooks.raycastRock(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz);

    if (shipId >= 0) {
      const t = this.world.ship(shipId);
      if (t && t.team !== Team.Player) {
        commandAttack(this.world, sel, shipId, queue);
        bus.emit('ack', { kind: 'attack', count: sel.length });
        bus.emit('notice', { text: 'ATTACKING', kind: 'warn' });
        return;
      }
      if (t && sel.indexOf(t.id) < 0) {
        if (SHIP_SPECS[t.cls].hangar > 0) commandDock(this.world, sel, shipId);
        else orderGuard(this.world, sel, shipId);
        bus.emit('ack', { kind: SHIP_SPECS[t.cls].hangar > 0 ? 'dock' : 'order', count: sel.length });
        return;
      }
    }

    if (rockId >= 0) {
      const rock = this.world.asteroids.get(rockId);
      if (rock) {
        if (this.selectionHasCollector()) {
          commandHarvest(this.world, sel, rockId);
          bus.emit('ack', { kind: 'order', count: sel.length });
          bus.emit('notice', { text: 'HARVESTING', kind: 'info' });
        } else {
          commandMove(
            this.world, sel, rock.pos.x, rock.pos.y, rock.pos.z, queue, this.formationFor(sel),
          );
        }
        return;
      }
    }

    this.cam.rayPlaneY(r, this.selectionCentroidY(), _hit);
    commandMove(this.world, sel, _hit.x, _hit.y, _hit.z, queue, this.formationFor(sel));
    bus.emit('ack', { kind: 'order', count: sel.length });
  }

  /** Consume an armed cursor mode (A / M / G) at the click point. */
  private consumeCursor(queue: boolean): void {
    const sel = this.world.selection;
    const mode = this._cursor;
    this.setCursor('none');
    if (sel.length === 0) return;

    const r = this.rayAt(this.curX, this.curY);
    let shipId = this.hooks.raycastShip(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz);
    if (shipId < 0) shipId = this.pickScreen(this.curX, this.curY, -1);

    if (mode === 'guard') {
      if (shipId >= 0) { orderGuard(this.world, sel, shipId); bus.emit('ack', { kind: 'order', count: sel.length }); }
      return;
    }
    if (mode === 'attackMove' && shipId >= 0) {
      const t = this.world.ship(shipId);
      if (t && t.team !== Team.Player) {
        commandAttack(this.world, sel, shipId, queue);
        return;
      }
    }

    this.cam.rayPlaneY(r, this.selectionCentroidY(), _hit);
    const f = this.formationFor(sel);
    if (mode === 'attackMove') {
      commandAttackMove(this.world, sel, _hit.x, _hit.y, _hit.z, queue, f);
      bus.emit('ack', { kind: 'attack', count: sel.length });
      bus.emit('notice', { text: 'ATTACK MOVE', kind: 'warn' });
    } else {
      commandMove(this.world, sel, _hit.x, _hit.y, _hit.z, queue, f);
    }
  }

  private selectionHasCollector(): boolean {
    const sel = this.world.selection;
    for (let i = 0; i < sel.length; i++) {
      const s = this.world.ship(sel[i]);
      if (s && s.cls === ShipClass.ResourceCollector) return true;
    }
    return false;
  }

  /** Nearest friendly hull with hangar space, for the D hotkey. Returns -1 if none. */
  private nearestHangar(x: number, y: number, z: number): number {
    const ships = this.world.ships;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (!s.alive || s.team !== Team.Player || SHIP_SPECS[s.cls].hangar <= 0) continue;
      const dx = s.pos.x - x, dy = s.pos.y - y, dz = s.pos.z - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    return best;
  }

  /** Centroid of the selection, written into `_hit`. Returns false when empty. */
  private selectionCentroid(): boolean {
    const sel = this.world.selection;
    let x = 0, y = 0, z = 0, n = 0;
    for (let i = 0; i < sel.length; i++) {
      const s = this.world.ship(sel[i]);
      if (!s) continue;
      x += s.pos.x; y += s.pos.y; z += s.pos.z;
      n++;
    }
    if (n === 0) return false;
    _hit.set(x / n, y / n, z / n);
    return true;
  }

  private setCursor(mode: CursorMode): void {
    this._cursor = mode;
    this.updateCursorClass();
  }

  /** True while Space is held: the mouse drives the camera and nothing else. */
  private get camDrag(): boolean {
    return this.tapSpace >= 0;
  }

  /**
   * The pointer cursor. Camera-drag mode outranks an armed order cursor,
   * because while it is on the order cursor cannot fire anyway.
   */
  private updateCursorClass(): void {
    this.canvas.style.cursor = this.camDrag
      ? 'grab'
      : this._cursor === 'none' ? '' : 'crosshair';
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
    const sel = this.world.selection;
    if (e.code === 'KeyA') {
      const t = this.tapA;
      this.tapA = KEY_UP;
      if (t >= 0 && t <= INPUT.tapSeconds && sel.length > 0) this.setCursor('attackMove');
    } else if (e.code === 'KeyS') {
      const t = this.tapS;
      this.tapS = KEY_UP;
      if (t >= 0 && t <= INPUT.tapSeconds && sel.length > 0) {
        commandStop(this.world, sel);
        bus.emit('ack', { kind: 'order', count: sel.length });
        bus.emit('notice', { text: 'HOLDING POSITION', kind: 'info' });
      }
    } else if (e.code === 'KeyD') {
      const t = this.tapD;
      this.tapD = KEY_UP;
      if (t >= 0 && t <= INPUT.tapSeconds && sel.length > 0) this.orderDock();
    } else if (e.code === 'Space') {
      const t = this.tapSpace;
      this.tapSpace = KEY_UP;
      // A tap that was never used to drag the camera still centres the view.
      if (t >= 0 && t <= INPUT.tapSeconds && !this.camDragUsed && sel.length > 0) {
        this.cam.frame(sel, this.world);
      }
      this.camDragUsed = false;
      this.updateCursorClass();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    const ctrl = e.ctrlKey || e.metaKey;
    const alt = e.altKey;
    const shift = e.shiftKey;

    // Never steal keys from a focused text field (dev console, chat, cheats).
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) {
      return;
    }

    if (e.repeat) {
      // Auto-repeat only matters for pan keys, which we drive off `held`.
      return;
    }
    this.held.add(code);
    this.cam.nudge();

    const sel = this.world.selection;

    // -- dual-purpose command/pan keys: defer to keyup ----------------------
    if (!ctrl && !alt) {
      if (code === 'KeyA') {
        this.tapA = 0;
        e.preventDefault();
        return;
      }
      if (code === 'KeyS') {
        this.tapS = 0;
        e.preventDefault();
        return;
      }
      if (code === 'KeyD') {
        this.tapD = 0;
        e.preventDefault();
        return;
      }
    }

    // -- control groups ------------------------------------------------------
    if (code.length === 6 && code.startsWith('Digit')) {
      const n = code.charCodeAt(5) - 48;
      e.preventDefault();
      if (alt) {
        this.applyFormationKey(n, sel);
      } else if (ctrl) {
        this.assignGroup(n);
      } else {
        this.recallGroup(n, shift, e.timeStamp);
      }
      return;
    }

    switch (code) {
      case 'Escape':
        e.preventDefault();
        if (this._cursor !== 'none') this.setCursor('none');
        else if (this.gizmoActive) this.resetPointer();
        else this.setSelection(null);
        return;

      case 'Tab':
        e.preventDefault();
        this.cycleSubgroup(shift);
        return;

      case 'Space':
        // Deferred to keyup, exactly like A / S / D: a TAP centres on the
        // selection, a HOLD turns the mouse into a camera controller (see
        // `camDrag` in onPointerDown). Reported as "it's always messing with me
        // the selection and point" — every drag binding the camera had was
        // also a gameplay binding, so there was no way to move the view
        // without risking an order or losing a selection.
        e.preventDefault();
        this.tapSpace = 0;
        return;

      case 'KeyF':
        e.preventDefault();
        if (sel.length === 0) return;
        if (shift) {
          this.cam.focusOn(sel[0], this.world);
          this.following = false;
        } else {
          // F frames the selection AND latches follow, so the camera keeps the
          // fleet in frame as it flies. Framing once and then letting the ships
          // sail out of shot is what "focus" was doing before, which is not what
          // the verb means in any RTS.
          this.cam.frame(sel, this.world);
          this.following = true;
          this.followInit = false;
        }
        return;

      case 'KeyM':
        e.preventDefault();
        if (sel.length > 0) this.setCursor('move');
        return;

      case 'KeyG':
        e.preventDefault();
        if (sel.length > 0) this.setCursor('guard');
        return;

      case 'KeyH':
        e.preventDefault();
        this.orderHarvest();
        return;

      // -- stances -----------------------------------------------------------
      case 'KeyZ':
        if (sel.length > 0) setStance(this.world, sel, Stance.Aggressive);
        return;
      case 'KeyX':
        if (sel.length > 0) setStance(this.world, sel, Stance.Neutral);
        return;
      case 'KeyC':
        if (sel.length > 0) setStance(this.world, sel, Stance.Passive);
        return;
      case 'KeyV':
        if (sel.length > 0) setStance(this.world, sel, Stance.Evasive);
        return;

      default:
        break;
    }

    if (ctrl && code === 'KeyA') {
      e.preventDefault();
      this.selectAll();
      return;
    }

    // Swallow the browser's own bindings for the camera keys.
    if (
      code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight'
    ) {
      e.preventDefault();
    }
  };

  /**
   * Alt+digit formation hotkey.
   *
   * `orders.ts` takes the formation as an argument to the move command rather
   * than exposing a setter, so the choice is latched here and stamped onto every
   * subsequent move. Any squad the selection is already flying in is retagged
   * immediately, so the shape visibly reflows without needing a new move order.
   */
  private applyFormationKey(n: number, sel: number[]): void {
    if (n === 7) {
      this._formation = null;
      bus.emit('notice', { text: 'FORMATION: AUTO', kind: 'info' });
      return;
    }
    if (n < 0 || n >= FORMATION_KEYS.length) return;
    const f = FORMATION_KEYS[n];
    this._formation = f;
    bus.emit('notice', { text: `FORMATION: ${FORMATION_NAMES[n]}`, kind: 'info' });
    if (sel.length === 0) return;
    for (let i = 0; i < sel.length; i++) {
      const s = this.world.ship(sel[i]);
      if (!s || s.squad < 0) continue;
      const sq = this.world.squad(s.squad);
      if (sq) sq.formation = f;
    }
  }

  private assignGroup(n: number): void {
    const g = this.groups[n];
    g.length = 0;
    const sel = this.world.selection;
    for (let i = 0; i < sel.length; i++) g.push(sel[i]);
    bus.emit('notice', { text: `GROUP ${n} SET (${g.length})`, kind: 'info' });
  }

  private recallGroup(n: number, additive: boolean, timeStamp: number): void {
    const g = this.groups[n];
    // Prune the dead in place so a group never resurrects a recycled id.
    let w = 0;
    for (let i = 0; i < g.length; i++) {
      const s = this.world.ship(g[i]);
      if (s && s.team === Team.Player) g[w++] = g[i];
    }
    g.length = w;
    if (g.length === 0) return;

    const out = this.scratch;
    out.length = 0;
    if (additive) {
      const sel = this.world.selection;
      for (let i = 0; i < sel.length; i++) out.push(sel[i]);
    }
    for (let i = 0; i < g.length; i++) if (out.indexOf(g[i]) < 0) out.push(g[i]);
    this.setSelection(out);

    const dbl = this.lastGroupKey === n && timeStamp - this.lastGroupMs < INPUT.groupTapMs;
    this.lastGroupKey = n;
    this.lastGroupMs = timeStamp;
    if (dbl) this.cam.frame(this.world.selection, this.world);
  }

  private orderHarvest(): void {
    const sel = this.world.selection;
    if (sel.length === 0 || !this.selectionHasCollector()) return;
    if (!this.selectionCentroid()) return;
    const rock = this.world.nearestRock(_hit.x, _hit.y, _hit.z, CONFIG.mapRadius * 2);
    if (rock < 0) {
      bus.emit('notice', { text: 'NO RESOURCES IN RANGE', kind: 'warn' });
      return;
    }
    commandHarvest(this.world, sel, rock);
    bus.emit('ack', { kind: 'order', count: sel.length });
    bus.emit('notice', { text: 'HARVESTING', kind: 'info' });
  }

  private orderDock(): void {
    const sel = this.world.selection;
    if (sel.length === 0 || !this.selectionCentroid()) return;
    const bay = this.nearestHangar(_hit.x, _hit.y, _hit.z);
    if (bay < 0) {
      bus.emit('notice', { text: 'NO DOCKING BAY AVAILABLE', kind: 'warn' });
      return;
    }
    commandDock(this.world, sel, bay);
    bus.emit('ack', { kind: 'dock', count: sel.length });
    bus.emit('notice', { text: 'DOCKING', kind: 'info' });
  }

  // -------------------------------------------------------------------------

  /** Detach every listener. Safe to call twice. */
  dispose(): void {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerCancel);
    c.removeEventListener('pointerenter', this.onPointerEnter);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onContextMenu);
    c.removeEventListener('auxclick', this.onAuxClick);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.held.clear();
    this.setCursor('none');
  }
}
