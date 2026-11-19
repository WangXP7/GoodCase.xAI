/**
 * THE SENSORS MANAGER — Homeworld's fullscreen tactical view, plus its minimap.
 *
 * WHAT: press the key bound to `toggle()` and the battle stops being a picture
 * of spaceships and becomes a *chart*. Hulls collapse to team-coloured glyphs
 * sized by class, each one hanging on a vertical drop-line above the y = 0
 * reference plane; the asteroid field becomes a stipple of survey dots; the
 * whole thing sits over a projected polar grid with labelled range rings.
 *
 * WHY a drop-line: a 2D screen cannot show a 3D position. Homeworld solved this
 * in 1999 by drawing the ship at its true projected location and a thread down
 * to where it sits on the plane — the eye reads the pair as one depth cue. Every
 * later space RTS copied it because nothing else works as well.
 *
 * HOW: a single 2D canvas painted over the WebGL frame, with the perspective
 * projection done by hand against the live camera matrices. That keeps the
 * glyphs pixel-crisp (no texture filtering, no MSAA smear on a 1px line), keeps
 * the whole overlay in one draw, and means zero interaction with the 3D
 * pipeline. Projection maths runs against a cached `Float64Array` copy of the
 * view-projection matrix, so a frame with 1600 ships allocates nothing.
 *
 * The corner minimap is a second, always-on canvas showing a top-down plan of
 * the whole battlespace with the camera's view wedge. It uses an orthographic
 * XZ plot rather than the game camera, because a minimap that swims around with
 * the camera is useless for orientation.
 *
 * This module never mutates `World` and never captures pointer input.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { UiLayer } from '../core/contracts';
import { PALETTES, UI } from '../core/palette';
import { SHIP_SPECS } from '../core/registry';
import { HullSize, ShipClass, Team } from '../core/types';
import type { World } from '../sim/world';
import './panels.css';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Glyph half-size in CSS pixels, indexed by HullSize. */
const GLYPH_PX: number[] = [3.4, 4.6, 6.4, 9.0, 13.5, 5.2];

/** Range rings drawn on the reference plane, metres. */
const RANGE_RINGS = [6000, 12000, 20000, 30000, 42000];
/** Pre-baked ring labels — building these per frame would allocate strings. */
const RANGE_LABELS = ['6 km', '12 km', '20 km', '30 km', '42 km'];
/** Points used to tessellate one projected ring. */
const RING_STEPS = 128;
/** Radial spokes on the grid. */
const SPOKES = 16;

/** Fullscreen wash drawn under the chart when the sensors view is active. */
const WASH = 'rgba(3, 7, 14, 0.90)';

/** Minimap edge length in CSS pixels. */
const MINIMAP_PX = 176;

// ---------------------------------------------------------------------------
// Module-scope scratch
// ---------------------------------------------------------------------------

const _m4 = new THREE.Matrix4();
const _fwd = new THREE.Vector3();

// ---------------------------------------------------------------------------

/**
 * Fullscreen tactical chart + persistent corner minimap.
 *
 * Both canvases are appended to `container` (which must be a positioned
 * element) and are `pointer-events: none` — this layer is pure readout.
 */
export class TacticalOverlay implements UiLayer {
  private container: HTMLElement;
  private world: World;

  private full: HTMLCanvasElement;
  private fullCtx: CanvasRenderingContext2D;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private frame: HTMLDivElement;
  private banner: HTMLDivElement;

  /** 0 = fully minimap, 1 = fully sensors view. Animated on toggle. */
  private blend = 0;
  private on = false;

  private dpr = 1;
  private fullW = 0;
  private fullH = 0;

  /** Cached view-projection matrix, row-major-free (three's column order). */
  private vp = new Float64Array(16);
  /** Last successful projection result, in CSS pixels. */
  private px = 0;
  private py = 0;

  /** Per-team CSS colour strings, resolved once. */
  private teamCss: string[] = [];
  private teamCssDim: string[] = [];

  /** Live counts for the header readout, refreshed at 4 Hz. */
  private countTimer = 0;
  private lastBanner = '';

  // Cached style state, so a steady frame writes nothing to the DOM.
  private lastBannerOpacity = -1;
  private lastFrameOpacity = -1;
  private fullShown = true;
  private miniShown = true;

  /**
   * @param container element the two canvases are appended to.
   * @param world     read-only sim state.
   * @param camera    the game camera; used for the perspective projection.
   */
  constructor(container: HTMLElement, world: World, camera: THREE.PerspectiveCamera) {
    this.container = container;
    this.world = world;

    for (const t of [Team.Player, Team.Enemy, Team.Neutral]) {
      const c = PALETTES[t].ui;
      const r = Math.round(c.r * 255);
      const g = Math.round(c.g * 255);
      const b = Math.round(c.b * 255);
      this.teamCss[t] = `rgb(${r},${g},${b})`;
      this.teamCssDim[t] = `rgba(${r},${g},${b},0.42)`;
    }

    this.full = document.createElement('canvas');
    this.full.className = 'sf-tac-full';
    const fc = this.full.getContext('2d', { alpha: true });
    if (!fc) throw new Error('TacticalOverlay: 2D context unavailable');
    this.fullCtx = fc;

    this.banner = document.createElement('div');
    this.banner.className = 'sf-tac-banner';
    this.banner.textContent = 'SENSORS MANAGER';

    this.frame = document.createElement('div');
    this.frame.className = 'sf-minimap';
    this.mini = document.createElement('canvas');
    this.mini.className = 'sf-minimap-canvas';
    const mc = this.mini.getContext('2d', { alpha: true });
    if (!mc) throw new Error('TacticalOverlay: 2D context unavailable');
    this.miniCtx = mc;
    this.frame.appendChild(this.mini);

    // The minimap is the one part of this layer that ACCEPTS input: clicking or
    // dragging on it jumps the camera, which is the whole point of having a plan
    // view in an RTS. Everything else in the overlay stays pointer-transparent.
    this.mini.style.pointerEvents = 'auto';
    this.mini.style.cursor = 'crosshair';
    this.mini.addEventListener('pointerdown', this.onMiniPointer);
    this.mini.addEventListener('pointermove', this.onMiniPointer);
    this.mini.addEventListener('contextmenu', (e) => e.preventDefault());

    container.appendChild(this.full);
    container.appendChild(this.banner);
    container.appendChild(this.frame);

    this.resize();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Toggle the Homeworld "sensors manager" fullscreen tactical view. */
  toggle(): void {
    this.on = !this.on;
  }

  /** True while the fullscreen sensors view is engaged. */
  get active(): boolean {
    return this.on;
  }

  update(world: World, camera: THREE.Camera, dt: number): void {
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    const cam = camera as THREE.PerspectiveCamera;

    // Ease the chart in/out; a hard cut reads as a bug, not a mode change.
    const target = this.on ? 1 : 0;
    const k = 1 - Math.exp(-dt * 11);
    this.blend += (target - this.blend) * k;
    if (Math.abs(this.blend - target) < 0.003) this.blend = target;

    this.resize();
    this.updateViewProj(cam);

    this.countTimer -= dt;
    if (this.countTimer <= 0) {
      this.countTimer = 0.25;
      this.recount(world);
    }

    this.drawFull(world);
    this.drawMini(world, cam);

    // Quantise before writing — an opacity that changes by 1/1000 costs a style
    // recalc and buys nothing the eye can see.
    const bo = Math.round(this.blend * 20) / 20;
    if (bo !== this.lastBannerOpacity) {
      this.lastBannerOpacity = bo;
      this.banner.style.opacity = String(bo);
    }
    const fo = Math.round((1 - this.blend) * 20) / 20;
    if (fo !== this.lastFrameOpacity) {
      this.lastFrameOpacity = fo;
      this.frame.style.opacity = String(fo);
    }
  }

  /**
   * Called when the player clicks or drags on the corner minimap, with the
   * world-space point under the cursor on the y = 0 plane.
   *
   * Assigned by the integrator; the overlay itself never moves the camera, so
   * this module keeps its "never mutates the world" property.
   */
  onMinimapJump: ((x: number, y: number, z: number) => void) | null = null;

  /**
   * Convert a minimap pointer event into a world point and report it.
   *
   * Shares the exact projection `drawMini` uses — centre of the canvas is the
   * origin and the usable radius is `CONFIG.mapRadius` inset by the 6 px frame —
   * so the point the player clicks is the point the camera goes to. Handles both
   * the initial press and drags (buttons held) so scrubbing across the map
   * sweeps the camera.
   */
  private onMiniPointer = (e: PointerEvent): void => {
    if (e.type === 'pointermove' && e.buttons === 0) return;
    e.preventDefault();
    if (!this.onMinimapJump) return;
    const r = this.mini.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const S = MINIMAP_PX;
    const c = S * 0.5;
    const scale = (S * 0.5 - 6) / CONFIG.mapRadius;
    // Pointer -> canvas CSS pixels -> the drawMini plot space.
    const px = ((e.clientX - r.left) / r.width) * S;
    const py = ((e.clientY - r.top) / r.height) * S;
    const wx = (px - c) / scale;
    const wz = (py - c) / scale;
    // Clamp into the battlespace so a click on the frame corner is still valid.
    const d = Math.hypot(wx, wz);
    const lim = CONFIG.mapRadius;
    const k = d > lim ? lim / d : 1;
    this.onMinimapJump(wx * k, 0, wz * k);
  };

  dispose(): void {
    this.mini.removeEventListener('pointerdown', this.onMiniPointer);
    this.mini.removeEventListener('pointermove', this.onMiniPointer);
    this.full.remove();
    this.frame.remove();
    this.banner.remove();
  }

  // -------------------------------------------------------------------------
  // Projection
  // -------------------------------------------------------------------------

  /** Cache `projection * viewInverse` for this frame. */
  private updateViewProj(cam: THREE.PerspectiveCamera): void {
    cam.updateMatrixWorld();
    _m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const e = _m4.elements;
    for (let i = 0; i < 16; i++) this.vp[i] = e[i];
  }

  /**
   * Project a world point to CSS-pixel canvas coordinates.
   * Returns false when the point is behind the eye; `px`/`py` then hold junk.
   */
  private project(x: number, y: number, z: number): boolean {
    const m = this.vp;
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 1e-6) return false;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const inv = 1 / cw;
    this.px = (cx * inv * 0.5 + 0.5) * this.fullW;
    this.py = (1 - (cy * inv * 0.5 + 0.5)) * this.fullH;
    return true;
  }

  // -------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w === this.fullW && h === this.fullH && dpr === this.dpr) return;
    this.fullW = w;
    this.fullH = h;
    this.dpr = dpr;
    this.full.width = Math.max(1, Math.round(w * dpr));
    this.full.height = Math.max(1, Math.round(h * dpr));
    this.fullCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.mini.width = Math.round(MINIMAP_PX * dpr);
    this.mini.height = Math.round(MINIMAP_PX * dpr);
    this.miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private recount(world: World): void {
    let own = 0;
    let foe = 0;
    const ships = world.ships;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (!s.alive || s.dockedIn >= 0) continue;
      if (s.team === Team.Player) own++;
      else if (s.team === Team.Enemy) foe++;
    }
    const txt = `SENSORS MANAGER  ·  FRIENDLY ${own}  ·  HOSTILE ${foe}`;
    if (txt !== this.lastBanner) {
      this.lastBanner = txt;
      this.banner.textContent = txt;
    }
  }

  // -------------------------------------------------------------------------
  // Fullscreen chart
  // -------------------------------------------------------------------------

  private drawFull(world: World): void {
    const g = this.fullCtx;
    const w = this.fullW;
    const h = this.fullH;
    if (this.blend <= 0.005) {
      if (this.fullShown) {
        this.fullShown = false;
        g.clearRect(0, 0, w, h);
        this.full.style.display = 'none';
      }
      return;
    }
    g.clearRect(0, 0, w, h);
    if (!this.fullShown) {
      this.fullShown = true;
      this.full.style.display = 'block';
    }
    const a = this.blend;

    // Wash out the rendered scene so the chart owns the screen.
    g.globalAlpha = a;
    g.fillStyle = WASH;
    g.fillRect(0, 0, w, h);

    // Fine vignette + scan tint, sold as sensor hardware rather than decoration.
    g.globalAlpha = a * 0.5;
    g.strokeStyle = 'rgba(120, 200, 255, 0.10)';
    g.lineWidth = 1;
    g.beginPath();
    for (let y = 0; y < h; y += 4) {
      g.moveTo(0, y + 0.5);
      g.lineTo(w, y + 0.5);
    }
    g.stroke();

    g.globalAlpha = a;
    this.drawGrid(g);
    this.drawAsteroids(g, world);
    this.drawShips(g, world);
    this.drawRangeRings(g, world);
    g.globalAlpha = 1;
  }

  /** Projected polar grid on the y = 0 reference plane. */
  private drawGrid(g: CanvasRenderingContext2D): void {
    g.lineWidth = 1;
    for (let r = 0; r < RANGE_RINGS.length; r++) {
      const rad = RANGE_RINGS[r];
      g.strokeStyle = r === RANGE_RINGS.length - 1
        ? 'rgba(120, 190, 240, 0.30)'
        : 'rgba(110, 175, 225, 0.16)';
      g.beginPath();
      let started = false;
      for (let i = 0; i <= RING_STEPS; i++) {
        const t = (i / RING_STEPS) * Math.PI * 2;
        if (!this.project(Math.cos(t) * rad, 0, Math.sin(t) * rad)) { started = false; continue; }
        if (!started) { g.moveTo(this.px, this.py); started = true; }
        else g.lineTo(this.px, this.py);
      }
      g.stroke();

      // Label on the +X radial, offset so it never sits under the line.
      if (this.project(rad, 0, 0)) {
        g.fillStyle = 'rgba(150, 205, 245, 0.55)';
        g.font = `600 10px ${UI.mono}`;
        g.fillText(RANGE_LABELS[r], this.px + 5, this.py - 4);
      }
    }

    const outer = RANGE_RINGS[RANGE_RINGS.length - 1];
    g.strokeStyle = 'rgba(110, 175, 225, 0.11)';
    for (let s = 0; s < SPOKES; s++) {
      const t = (s / SPOKES) * Math.PI * 2;
      const cx = Math.cos(t);
      const cz = Math.sin(t);
      g.beginPath();
      let started = false;
      // Segment the spoke so it curves correctly under perspective.
      for (let i = 0; i <= 24; i++) {
        const d = (i / 24) * outer;
        if (!this.project(cx * d, 0, cz * d)) { started = false; continue; }
        if (!started) { g.moveTo(this.px, this.py); started = true; }
        else g.lineTo(this.px, this.py);
      }
      g.stroke();
    }
  }

  /** The asteroid field as a survey stipple with plane shadows. */
  private drawAsteroids(g: CanvasRenderingContext2D, world: World): void {
    const rocks = world.asteroids;
    g.fillStyle = 'rgba(160, 178, 200, 0.55)';
    for (let i = 0; i < rocks.count; i++) {
      const a = rocks.items[i];
      if (!a.alive) continue;
      if (!this.project(a.pos.x, a.pos.y, a.pos.z)) continue;
      const sx = this.px;
      const sy = this.py;
      if (sx < -40 || sy < -40 || sx > this.fullW + 40 || sy > this.fullH + 40) continue;
      // Depleted rocks fade toward the plane colour — economy at a glance.
      const rich = a.amountMax > 0 ? a.amount / a.amountMax : 0;
      const r = a.amount > 0 ? 1.5 + rich * 1.3 : 1.0;
      g.globalAlpha = (0.28 + rich * 0.5) * this.blend;
      g.fillRect(sx - r, sy - r, r * 2, r * 2);
      // Plane shadow dot: half the story of where the field actually sits.
      if (this.project(a.pos.x, 0, a.pos.z)) {
        g.globalAlpha = 0.16 * this.blend;
        g.fillRect(this.px - 0.8, this.py - 0.8, 1.6, 1.6);
      }
    }
    g.globalAlpha = this.blend;
  }

  /** Every hull as a class-sized glyph with a drop-line to the plane. */
  private drawShips(g: CanvasRenderingContext2D, world: World): void {
    const ships = world.ships;
    const sel = world.selection;

    // Pass 1: drop lines, so no thread ever paints over a glyph.
    g.lineWidth = 1;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (!s.alive || s.dockedIn >= 0) continue;
      if (!this.project(s.pos.x, s.pos.y, s.pos.z)) continue;
      const tx = this.px;
      const ty = this.py;
      if (tx < -60 || ty < -60 || tx > this.fullW + 60 || ty > this.fullH + 60) continue;
      if (!this.project(s.pos.x, 0, s.pos.z)) continue;
      g.strokeStyle = this.teamCssDim[s.team];
      g.globalAlpha = this.blend * 0.55;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(this.px, this.py);
      g.stroke();
      // Foot tick on the plane.
      g.globalAlpha = this.blend * 0.4;
      g.beginPath();
      g.moveTo(this.px - 2.5, this.py);
      g.lineTo(this.px + 2.5, this.py);
      g.stroke();
    }

    // Pass 2: glyphs, neutral first so combatants sit on top.
    g.globalAlpha = this.blend;
    for (let pass = 0; pass < 3; pass++) {
      const team = pass === 0 ? Team.Neutral : pass === 1 ? Team.Enemy : Team.Player;
      g.strokeStyle = this.teamCss[team];
      g.fillStyle = this.teamCss[team];
      for (let i = 0; i < ships.count; i++) {
        const s = ships.items[i];
        if (!s.alive || s.team !== team || s.dockedIn >= 0) continue;
        if (!this.project(s.pos.x, s.pos.y, s.pos.z)) continue;
        const x = this.px;
        const y = this.py;
        if (x < -30 || y < -30 || x > this.fullW + 30 || y > this.fullH + 30) continue;
        const spec = SHIP_SPECS[s.cls];
        const r = GLYPH_PX[spec.size];
        this.glyph(g, x, y, r, spec.size, s.cls);
        // Health notch under capitals — a chart that hides damage is a lie.
        if (spec.size >= HullSize.Frigate) {
          const frac = Math.max(0, Math.min(1, s.hp / spec.maxHp));
          if (frac < 0.999) {
            const bw = r * 2.4;
            g.globalAlpha = this.blend * 0.35;
            g.fillRect(x - bw * 0.5, y + r + 3, bw, 1.6);
            g.globalAlpha = this.blend;
            g.fillRect(x - bw * 0.5, y + r + 3, bw * frac, 1.6);
          }
        }
      }
    }

    // Pass 3: selection reticles.
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.4;
    for (let i = 0; i < sel.length; i++) {
      const s = world.ship(sel[i]);
      if (!s || s.dockedIn >= 0) continue;
      if (!this.project(s.pos.x, s.pos.y, s.pos.z)) continue;
      const r = GLYPH_PX[SHIP_SPECS[s.cls].size] + 4.5;
      const x = this.px;
      const y = this.py;
      const arm = r * 0.55;
      g.beginPath();
      for (let c = 0; c < 4; c++) {
        const sx = c & 1 ? 1 : -1;
        const sy = c & 2 ? 1 : -1;
        g.moveTo(x + sx * r, y + sy * r - sy * arm);
        g.lineTo(x + sx * r, y + sy * r);
        g.lineTo(x + sx * r - sx * arm, y + sy * r);
      }
      g.stroke();
    }
    g.lineWidth = 1;
  }

  /** One class glyph. Shape encodes the size band, so classes read at a blink. */
  private glyph(
    g: CanvasRenderingContext2D, x: number, y: number, r: number,
    size: HullSize, cls: ShipClass,
  ): void {
    g.beginPath();
    switch (size) {
      case HullSize.Fighter:
        // Filled dart — fast, small, disposable.
        g.moveTo(x, y - r);
        g.lineTo(x + r * 0.8, y + r * 0.8);
        g.lineTo(x - r * 0.8, y + r * 0.8);
        g.closePath();
        g.fill();
        return;
      case HullSize.Corvette:
        // Hollow diamond.
        g.moveTo(x, y - r);
        g.lineTo(x + r, y);
        g.lineTo(x, y + r);
        g.lineTo(x - r, y);
        g.closePath();
        g.stroke();
        return;
      case HullSize.Frigate:
        // Hollow square with a bar — the first "real warship" tier.
        g.rect(x - r, y - r, r * 2, r * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(x - r * 0.55, y);
        g.lineTo(x + r * 0.55, y);
        g.stroke();
        return;
      case HullSize.Capital:
        // Hexagon.
        for (let i = 0; i < 6; i++) {
          const t = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = x + Math.cos(t) * r;
          const py = y + Math.sin(t) * r;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
        g.stroke();
        g.beginPath();
        g.arc(x, y, r * 0.28, 0, Math.PI * 2);
        g.fill();
        return;
      case HullSize.SuperCapital: {
        // Double hexagon; motherships get a filled core.
        for (let ring = 0; ring < 2; ring++) {
          const rr = ring === 0 ? r : r * 0.62;
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const t = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const px = x + Math.cos(t) * rr;
            const py = y + Math.sin(t) * rr;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.closePath();
          g.stroke();
        }
        if (cls === ShipClass.Mothership) {
          g.beginPath();
          g.arc(x, y, r * 0.30, 0, Math.PI * 2);
          g.fill();
        }
        return;
      }
      default:
        // Utility: circle with a cross — logistics, not combat.
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(x - r * 0.6, y);
        g.lineTo(x + r * 0.6, y);
        g.moveTo(x, y - r * 0.6);
        g.lineTo(x, y + r * 0.6);
        g.stroke();
        return;
    }
  }

  /** Weapon-envelope rings around selected capitals, drawn on their own plane. */
  private drawRangeRings(g: CanvasRenderingContext2D, world: World): void {
    const sel = world.selection;
    let drawn = 0;
    g.lineWidth = 1;
    for (let i = 0; i < sel.length && drawn < 4; i++) {
      const s = world.ship(sel[i]);
      if (!s) continue;
      const spec = SHIP_SPECS[s.cls];
      if (spec.size < HullSize.Frigate || spec.weapons.length === 0) continue;
      let range = 0;
      for (let k = 0; k < spec.weapons.length; k++) {
        if (spec.weapons[k].range > range) range = spec.weapons[k].range;
      }
      if (range <= 0) continue;
      drawn++;
      g.strokeStyle = this.teamCssDim[s.team];
      g.beginPath();
      let started = false;
      for (let k = 0; k <= 64; k++) {
        const t = (k / 64) * Math.PI * 2;
        if (!this.project(s.pos.x + Math.cos(t) * range, s.pos.y, s.pos.z + Math.sin(t) * range)) {
          started = false;
          continue;
        }
        if (!started) { g.moveTo(this.px, this.py); started = true; }
        else g.lineTo(this.px, this.py);
      }
      g.stroke();
    }
  }

  // -------------------------------------------------------------------------
  // Corner minimap — orthographic top-down plan of the whole battlespace.
  // -------------------------------------------------------------------------

  private drawMini(world: World, cam: THREE.PerspectiveCamera): void {
    if (this.blend > 0.995) {
      if (this.miniShown) {
        this.miniShown = false;
        this.frame.style.display = 'none';
      }
      return;
    }
    if (!this.miniShown) {
      this.miniShown = true;
      this.frame.style.display = 'block';
    }

    const g = this.miniCtx;
    const S = MINIMAP_PX;
    const c = S * 0.5;
    const scale = (S * 0.5 - 6) / CONFIG.mapRadius;
    g.clearRect(0, 0, S, S);

    // Chart furniture.
    g.strokeStyle = 'rgba(120, 190, 240, 0.22)';
    g.lineWidth = 1;
    for (let r = 1; r <= 3; r++) {
      g.beginPath();
      g.arc(c, c, (S * 0.5 - 6) * (r / 3), 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = 'rgba(120, 190, 240, 0.13)';
    g.beginPath();
    g.moveTo(c, 6); g.lineTo(c, S - 6);
    g.moveTo(6, c); g.lineTo(S - 6, c);
    g.stroke();

    // Camera view wedge — where am I looking, in map space.
    cam.getWorldDirection(_fwd);
    const camX = c + cam.position.x * scale;
    const camY = c + cam.position.z * scale;
    const fx = _fwd.x;
    const fz = _fwd.z;
    const flen = Math.hypot(fx, fz);
    if (flen > 1e-4) {
      const ux = fx / flen;
      const uz = fz / flen;
      const half = Math.tan((cam.fov * Math.PI) / 360) * cam.aspect;
      const reach = 16000 * scale;
      const lx = -uz * half * reach;
      const lz = ux * half * reach;
      g.fillStyle = 'rgba(140, 210, 255, 0.10)';
      g.beginPath();
      g.moveTo(camX, camY);
      g.lineTo(camX + ux * reach + lx, camY + uz * reach + lz);
      g.lineTo(camX + ux * reach - lx, camY + uz * reach - lz);
      g.closePath();
      g.fill();
    }

    // Asteroids as a faint dust cloud.
    const rocks = world.asteroids;
    g.fillStyle = 'rgba(150, 168, 190, 0.30)';
    for (let i = 0; i < rocks.count; i++) {
      const a = rocks.items[i];
      if (!a.alive) continue;
      g.fillRect(c + a.pos.x * scale - 0.5, c + a.pos.z * scale - 0.5, 1, 1);
    }

    // Ships, hostiles last so they never hide under a friendly blip.
    const ships = world.ships;
    for (let pass = 0; pass < 3; pass++) {
      const team = pass === 0 ? Team.Neutral : pass === 1 ? Team.Player : Team.Enemy;
      g.fillStyle = this.teamCss[team];
      for (let i = 0; i < ships.count; i++) {
        const s = ships.items[i];
        if (!s.alive || s.team !== team || s.dockedIn >= 0) continue;
        const spec = SHIP_SPECS[s.cls];
        const x = c + s.pos.x * scale;
        const y = c + s.pos.z * scale;
        if (spec.size >= HullSize.Capital) {
          const r = spec.size === HullSize.SuperCapital ? 3 : 2.2;
          g.fillRect(x - r, y - r, r * 2, r * 2);
        } else {
          const r = spec.size >= HullSize.Frigate ? 1.6 : 1.1;
          g.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
    }

    // Selection halo.
    g.strokeStyle = '#ffffff';
    for (let i = 0; i < world.selection.length && i < 96; i++) {
      const s = world.ship(world.selection[i]);
      if (!s) continue;
      g.strokeRect(c + s.pos.x * scale - 2.5, c + s.pos.z * scale - 2.5, 5, 5);
    }
  }
}
