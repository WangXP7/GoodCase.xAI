/**
 * IN-WORLD SELECTION RENDERING — brackets, drop lines, order lines, move gizmo.
 *
 * WHAT: every piece of "the player has told this ship something" feedback that
 * lives inside the 3D scene rather than in the DOM HUD:
 *
 *   1. selection brackets   four screen-space corner marks that hug the ship's
 *                           *projected* size, so a scout at 200 m and a
 *                           mothership at 30 km both get a legible frame.
 *   2. drop lines           a dashed vertical thread from each selected hull to
 *                           the tactical reference plane — Homeworld's answer to
 *                           "where is that thing actually, in three dimensions".
 *   3. order lines          camera-facing dashed ribbons that flow from the ship
 *                           toward its attack target / move destination.
 *   4. destination markers  a ring at the destination plus an expanding "ping"
 *                           ring that fires the instant a new order lands.
 *   5. the move disc        the translucent banded disc + vertical stalk the
 *                           player drags while issuing a 3D move order. Driven
 *                           entirely by `setMoveGizmo()`; this module never
 *                           reads the mouse.
 *
 * HOW: four instanced draw calls (brackets, rings, drop lines, order lines) plus
 * one disc mesh. Every instance buffer is a preallocated Float32Array that is
 * refilled in place each frame — the update path allocates nothing. All of it is
 * drawn with `depthTest: false` and a high render order: this is HUD that lives
 * in world space, and Homeworld likewise never lets a hull occlude a bracket.
 *
 * The module is strictly read-only with respect to `World`.
 */

import * as THREE from 'three';
import type { RenderContext, RenderSystem } from '../core/contracts';
import { PALETTES } from '../core/palette';
import { SHIP_SPECS } from '../core/registry';
import { TEAM_COUNT, type QualitySettings, type Team } from '../core/types';
import type { World } from '../sim/world';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** Hard cap on decorated selections. Beyond this the tail is silently dropped. */
const MAX_SEL = 256;
/** Expanding order-confirmation rings alive at once. */
const MAX_PINGS = 48;
/** Distinct destination markers drawn per frame (orders are deduplicated). */
const MAX_DESTS = 24;
/** Ring instances: destination markers + pings + the gizmo's two rings. */
const MAX_RINGS = MAX_DESTS + MAX_PINGS + 2;
/** Drop-line instances: one per selection + one per destination + gizmo stalk. */
const MAX_LINES = MAX_SEL + MAX_DESTS + 1;
/** Order-line instances: one per selected ship with an active manual order. */
const MAX_ORDERS = MAX_SEL;

/** Ring tessellation. 72 segments is smooth at full-screen radii. */
const RING_SEGMENTS = 72;
/** Longitudinal subdivisions of an order ribbon (keeps the billboard stable). */
const RIBBON_SEGMENTS = 8;

/** Seconds an order ping takes to expand and fade out. */
const PING_LIFE = 0.9;
/**
 * Minimum seconds between two order pings from the SAME hull. Slightly longer
 * than one ping's life so a hull can never have two of its own rings alive.
 */
const PING_COOLDOWN = 1.0;
/** Seconds the bracket highlight pulse lasts after the selection changes. */
const FLASH_LIFE = 0.34;

/**
 * Smallest hull radius, in metres, that earns a drop line to the tactical plane.
 * Frigate-and-up only; a wing of fighters would otherwise scribble the frame.
 */
const DROPLINE_MIN_RADIUS = 50;

/** Attack-order ribbon colour (hostile amber-red), linear RGB. */
const ATTACK_RGB = new THREE.Color(0xff6b4a).convertSRGBToLinear();

// ---------------------------------------------------------------------------
// Module-scope scratch — nothing below allocates per frame.
// ---------------------------------------------------------------------------

const _v3 = new THREE.Vector3();
const _size = new THREE.Vector2();

// ---------------------------------------------------------------------------
// Shared GLSL
// ---------------------------------------------------------------------------

/**
 * Screen-space sizing preamble.
 *
 * `uProjScale` is pixels-per-metre at one metre of view depth:
 *     uProjScale = drawingBufferHeight / (2 * tan(fovY / 2))
 * so `uProjScale / depth` is the pixels-per-metre at that depth, and a world
 * radius times that is the ship's projected radius in device pixels. Offsets are
 * pushed into clip space as `px * 2 / viewport * w`, which survives the
 * perspective divide unchanged.
 */
const GLSL_SCREEN = /* glsl */ `
uniform vec2 uViewport;
uniform float uProjScale;
float sf_pxPerUnit(float viewZ){ return uProjScale / max(-viewZ, 1.0); }
vec2 sf_pxToClip(vec2 px, float w){ return px * (2.0 / uViewport) * w; }
`;

// ---------------------------------------------------------------------------
// Geometry builders (run once, at construction)
// ---------------------------------------------------------------------------

/**
 * Four corner brackets in unit space.
 *
 * `position.xy` is the corner direction in -1..1 box space (scaled at runtime by
 * the ship's projected radius); `aPx` is a constant device-pixel offset that
 * gives every stroke the same thickness no matter how big the bracket gets.
 */
function buildBracketGeometry(armFrac: number, thickPx: number): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  const px: number[] = [];
  const idx: number[] = [];

  const quad = (
    bx0: number, by0: number, px0: number, py0: number,
    bx1: number, by1: number, px1: number, py1: number,
    bx2: number, by2: number, px2: number, py2: number,
    bx3: number, by3: number, px3: number, py3: number,
  ): void => {
    const base = pos.length / 3;
    pos.push(bx0, by0, 0, bx1, by1, 0, bx2, by2, 0, bx3, by3, 0);
    px.push(px0, py0, px1, py1, px2, py2, px3, py3);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const dim: number[] = [];
  /** Push `n` copies of a brightness weight, one per vertex the quad emitted. */
  const weight = (v: number): void => { dim.push(v, v, v, v); };

  for (let c = 0; c < 4; c++) {
    const sx = c & 1 ? 1 : -1;
    const sy = c & 2 ? 1 : -1;
    const ix = sx - sx * armFrac; // inboard end of the horizontal arm
    const iy = sy - sy * armFrac; // inboard end of the vertical arm
    // Horizontal arm — thickness runs inward along y.
    quad(sx, sy, 0, 0, ix, sy, 0, 0, ix, sy, 0, -sy * thickPx, sx, sy, 0, -sy * thickPx);
    weight(1);
    // Vertical arm — thickness runs inward along x.
    quad(sx, sy, 0, 0, sx, iy, 0, 0, sx, iy, -sx * thickPx, 0, sx, sy, -sx * thickPx, 0);
    weight(1);
  }

  // ---- what ties the four corners into ONE shape --------------------------
  //
  // Corner arms alone read as four unrelated ticks floating near a ship, which
  // at fleet zoom is indistinguishable from debris — the reported "the select
  // outline is not good". Two additions fix it without adding visual noise:
  //
  //   1. A faint full-perimeter hairline. The eye completes the rectangle from
  //      the bright corners, and the dim edge gives it something to complete
  //      ALONG, so the reticle reads as one object at any size.
  //   2. A short bright tick at the middle of each edge, which is what makes a
  //      targeting reticle look aimed rather than merely drawn.
  const HAIRLINE = 0.16;   // brightness of the connecting edge
  const TICK = 0.30;       // half-length of a mid-edge tick, in box space
  const hair = Math.max(1, thickPx * 0.5);

  for (let e = 0; e < 4; e++) {
    // e: 0 = bottom, 1 = top, 2 = left, 3 = right.
    const horizontal = e < 2;
    const s = e & 1 ? 1 : -1;
    if (horizontal) {
      // Perimeter hairline along the full edge.
      quad(-1, s, 0, 0, 1, s, 0, 0, 1, s, 0, -s * hair, -1, s, 0, -s * hair);
      weight(HAIRLINE);
      // Centre tick, drawn inboard so it points at the hull.
      quad(-TICK, s, 0, 0, TICK, s, 0, 0, TICK, s, 0, -s * thickPx, -TICK, s, 0, -s * thickPx);
      weight(0.85);
    } else {
      quad(s, -1, 0, 0, s, 1, 0, 0, s, 1, -s * hair, 0, s, -1, -s * hair, 0);
      weight(HAIRLINE);
      quad(s, -TICK, 0, 0, s, TICK, 0, 0, s, TICK, -s * thickPx, 0, s, -TICK, -s * thickPx, 0);
      weight(0.85);
    }
  }

  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPx', new THREE.Float32BufferAttribute(px, 2));
  g.setAttribute('aDim', new THREE.Float32BufferAttribute(dim, 1));
  g.setIndex(idx);
  return g;
}

/**
 * An annulus of unit radius. `position.xy` is the unit circle direction (scaled
 * by the instance radius) and `aPx` pushes the two rims apart by a fixed pixel
 * thickness, so the stroke never thins out at distance.
 */
function buildRingGeometry(segments: number, thickPx: number): THREE.InstancedBufferGeometry {
  const n = segments + 1;
  const pos = new Float32Array(n * 2 * 3);
  const px = new Float32Array(n * 2 * 2);
  const idx: number[] = [];
  const half = thickPx * 0.5;
  for (let i = 0; i < n; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    const inner = i * 2;
    const outer = inner + 1;
    pos[inner * 3] = cx; pos[inner * 3 + 1] = cy;
    pos[outer * 3] = cx; pos[outer * 3 + 1] = cy;
    px[inner * 2] = -cx * half; px[inner * 2 + 1] = -cy * half;
    px[outer * 2] = cx * half; px[outer * 2 + 1] = cy * half;
    if (i < segments) {
      const a0 = inner, b0 = outer, a1 = inner + 2, b1 = outer + 2;
      idx.push(a0, b0, a1, b0, b1, a1);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPx', new THREE.BufferAttribute(px, 2));
  g.setIndex(idx);
  return g;
}

/**
 * A ribbon strip along a segment. `position.x` is the 0..1 parameter from the
 * `from` endpoint to the `to` endpoint, `position.y` is the -1..1 side.
 */
function buildRibbonGeometry(segments: number): THREE.InstancedBufferGeometry {
  const n = segments + 1;
  const pos = new Float32Array(n * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / segments;
    const lo = i * 2;
    const hi = lo + 1;
    pos[lo * 3] = t; pos[lo * 3 + 1] = -1;
    pos[hi * 3] = t; pos[hi * 3 + 1] = 1;
    if (i < segments) idx.push(lo, hi, lo + 2, hi, hi + 2, lo + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Attach a dynamic per-instance attribute of `itemSize` floats to `g`. */
function addInstanceAttr(
  g: THREE.InstancedBufferGeometry, name: string, data: Float32Array, itemSize: number,
): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(data, itemSize);
  a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(name, a);
  return a;
}

// ---------------------------------------------------------------------------
// SelectionVisuals
// ---------------------------------------------------------------------------

/**
 * Renders every in-world selection and order affordance for the local player.
 *
 * Owns five scene objects; add once at construction, remove in `dispose()`.
 * `update()` reads `world.selection`, the selected ships' orders, and whatever
 * the caller last pushed through `setMoveGizmo()`.
 */
export class SelectionVisuals implements RenderSystem {
  private scene: THREE.Scene;
  private quality: QualitySettings;

  // -- brackets ------------------------------------------------------------
  private brMesh: THREE.Mesh;
  private brGeo: THREE.InstancedBufferGeometry;
  private brMat: THREE.ShaderMaterial;
  private brCenter = new Float32Array(MAX_SEL * 3);
  private brRadius = new Float32Array(MAX_SEL);
  private brColor = new Float32Array(MAX_SEL * 3);
  private brFlash = new Float32Array(MAX_SEL);
  private brAttrs: THREE.InstancedBufferAttribute[] = [];

  // -- rings (destination markers, order pings, gizmo rims) -----------------
  private rgMesh: THREE.Mesh;
  private rgGeo: THREE.InstancedBufferGeometry;
  private rgMat: THREE.ShaderMaterial;
  private rgCenter = new Float32Array(MAX_RINGS * 3);
  private rgRadius = new Float32Array(MAX_RINGS);
  private rgColor = new Float32Array(MAX_RINGS * 3);
  private rgAlpha = new Float32Array(MAX_RINGS);
  private rgAttrs: THREE.InstancedBufferAttribute[] = [];

  // -- drop lines ----------------------------------------------------------
  private dlMesh: THREE.Mesh;
  private dlGeo: THREE.InstancedBufferGeometry;
  private dlMat: THREE.ShaderMaterial;
  private dlTop = new Float32Array(MAX_LINES * 3);
  private dlBottom = new Float32Array(MAX_LINES * 3);
  private dlColor = new Float32Array(MAX_LINES * 3);
  private dlAlpha = new Float32Array(MAX_LINES);
  private dlDash = new Float32Array(MAX_LINES);
  private dlAttrs: THREE.InstancedBufferAttribute[] = [];

  // -- order ribbons -------------------------------------------------------
  private olMesh: THREE.Mesh;
  private olGeo: THREE.InstancedBufferGeometry;
  private olMat: THREE.ShaderMaterial;
  private olFrom = new Float32Array(MAX_ORDERS * 3);
  private olTo = new Float32Array(MAX_ORDERS * 3);
  private olColor = new Float32Array(MAX_ORDERS * 3);
  private olSpeed = new Float32Array(MAX_ORDERS);
  private olAttrs: THREE.InstancedBufferAttribute[] = [];

  // -- move disc gizmo -----------------------------------------------------
  private disc: THREE.Mesh;
  private discMat: THREE.ShaderMaterial;
  private gizmoOn = false;
  private gizmoX = 0;
  private gizmoY = 0;
  private gizmoZ = 0;
  private gizmoBase = 0;

  // -- order-change detection (drives the expanding pings) -----------------
  private lastDestX: Float32Array;
  private lastDestY: Float32Array;
  private lastDestZ: Float32Array;
  private lastDestKind: Uint8Array;
  /**
   * Seconds until this ship may fire another order ping.
   *
   * Belt and braces on top of the order-kind test below: whatever else changes,
   * one hull can contribute at most one ping per PING_COOLDOWN, so no future
   * order type can ever reintroduce the ring storm.
   */
  private pingCool: Float32Array;

  // -- ping pool -----------------------------------------------------------
  private pingX = new Float32Array(MAX_PINGS);
  private pingY = new Float32Array(MAX_PINGS);
  private pingZ = new Float32Array(MAX_PINGS);
  private pingR = new Float32Array(MAX_PINGS);
  private pingT = new Float32Array(MAX_PINGS);
  private pingRgb = new Float32Array(MAX_PINGS * 3);
  private pingHead = 0;

  /** Deduplication scratch for destination markers, xyz triples. */
  private destScratch = new Float32Array(MAX_DESTS * 3);

  /** Per-team UI colour in linear space, 3 floats per team. */
  private teamRgb = new Float32Array(TEAM_COUNT * 3);

  private flash = 0;
  private selSig = 0;

  /**
   * @param scene   the main render scene; five objects are added to it.
   * @param world   read-only source of selection + orders.
   * @param quality drives stroke weights and whether drop lines are drawn.
   */
  constructor(scene: THREE.Scene, world: World, quality: QualitySettings) {
    this.scene = scene;
    this.quality = quality;

    const maxShips = world.ships.cap;
    this.lastDestX = new Float32Array(maxShips);
    this.lastDestY = new Float32Array(maxShips);
    this.lastDestZ = new Float32Array(maxShips);
    this.lastDestKind = new Uint8Array(maxShips);
    this.pingCool = new Float32Array(maxShips);

    for (let t = 0; t < TEAM_COUNT; t++) {
      const c = PALETTES[t as Team].ui;
      // `ui` is authored in sRGB for CSS; the scene works in linear.
      this.teamRgb[t * 3] = c.r <= 0.04045 ? c.r / 12.92 : Math.pow((c.r + 0.055) / 1.055, 2.4);
      this.teamRgb[t * 3 + 1] = c.g <= 0.04045 ? c.g / 12.92 : Math.pow((c.g + 0.055) / 1.055, 2.4);
      this.teamRgb[t * 3 + 2] = c.b <= 0.04045 ? c.b / 12.92 : Math.pow((c.b + 0.055) / 1.055, 2.4);
    }

    const hairline = quality.preset >= 2 ? 1.6 : 2.0;

    // ---- brackets --------------------------------------------------------
    this.brGeo = buildBracketGeometry(0.34, hairline * 2.1);
    this.brAttrs.push(addInstanceAttr(this.brGeo, 'aCenter', this.brCenter, 3));
    this.brAttrs.push(addInstanceAttr(this.brGeo, 'aRadius', this.brRadius, 1));
    this.brAttrs.push(addInstanceAttr(this.brGeo, 'aColor', this.brColor, 3));
    this.brAttrs.push(addInstanceAttr(this.brGeo, 'aFlash', this.brFlash, 1));
    this.brMat = new THREE.ShaderMaterial({
      uniforms: {
        uViewport: { value: new THREE.Vector2(1920, 1080) },
        uProjScale: { value: 1000 },
        uMinPx: { value: 9 },
        uMaxPx: { value: 460 },
        uPad: { value: 1.30 },
        uOpacity: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        ${GLSL_SCREEN}
        attribute vec2 aPx;
        attribute float aDim;
        attribute vec3 aCenter;
        attribute float aRadius;
        attribute vec3 aColor;
        attribute float aFlash;
        uniform float uMinPx, uMaxPx, uPad;
        varying vec3 vColor;
        varying float vFlash;
        varying float vDim;
        void main(){
          vColor = aColor;
          vFlash = aFlash;
          vDim = aDim;
          vec4 vpos = modelViewMatrix * vec4(aCenter, 1.0);
          float rPx = clamp(aRadius * sf_pxPerUnit(vpos.z) * uPad, uMinPx, uMaxPx);
          // The flash pulse pushes the brackets outward a few pixels on grab.
          rPx += aFlash * 9.0;
          vec4 clip = projectionMatrix * vpos;
          clip.xy += sf_pxToClip(position.xy * rPx + aPx, clip.w);
          gl_Position = clip;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vFlash;
        varying float vDim;
        void main(){
          float boost = 1.0 + vFlash * 2.2;
          // vDim carries the per-stroke weight from the geometry: 1 for the
          // corner arms, 0.85 for the mid-edge ticks, 0.16 for the connecting
          // hairline. Additive blending means this is the only control over how
          // strongly each stroke reads.
          gl_FragColor = vec4(vColor * boost * vDim, uOpacity * vDim * (0.72 + 0.28 * vFlash));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.brMesh = new THREE.Mesh(this.brGeo, this.brMat);
    this.brMesh.frustumCulled = false;
    this.brMesh.renderOrder = 950;
    this.brMesh.name = 'sf-selection-brackets';
    scene.add(this.brMesh);

    // ---- rings -----------------------------------------------------------
    this.rgGeo = buildRingGeometry(RING_SEGMENTS, hairline);
    this.rgAttrs.push(addInstanceAttr(this.rgGeo, 'aCenter', this.rgCenter, 3));
    this.rgAttrs.push(addInstanceAttr(this.rgGeo, 'aRadius', this.rgRadius, 1));
    this.rgAttrs.push(addInstanceAttr(this.rgGeo, 'aColor', this.rgColor, 3));
    this.rgAttrs.push(addInstanceAttr(this.rgGeo, 'aAlpha', this.rgAlpha, 1));
    this.rgMat = new THREE.ShaderMaterial({
      uniforms: {
        uViewport: { value: new THREE.Vector2(1920, 1080) },
        uProjScale: { value: 1000 },
        uMinPx: { value: 3 },
        uMaxPx: { value: 100000 },
      },
      vertexShader: /* glsl */ `
        ${GLSL_SCREEN}
        attribute vec2 aPx;
        attribute vec3 aCenter;
        attribute float aRadius;
        attribute vec3 aColor;
        attribute float aAlpha;
        uniform float uMinPx, uMaxPx;
        varying vec3 vColor;
        varying float vAlpha;
        void main(){
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 vpos = modelViewMatrix * vec4(aCenter, 1.0);
          float rPx = clamp(aRadius * sf_pxPerUnit(vpos.z), uMinPx, uMaxPx);
          vec4 clip = projectionMatrix * vpos;
          clip.xy += sf_pxToClip(position.xy * rPx + aPx, clip.w);
          gl_Position = clip;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        varying vec3 vColor;
        varying float vAlpha;
        void main(){ gl_FragColor = vec4(vColor * vAlpha, vAlpha); }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.rgMesh = new THREE.Mesh(this.rgGeo, this.rgMat);
    this.rgMesh.frustumCulled = false;
    this.rgMesh.renderOrder = 946;
    this.rgMesh.name = 'sf-selection-rings';
    scene.add(this.rgMesh);

    // ---- drop lines ------------------------------------------------------
    this.dlGeo = buildRibbonGeometry(1);
    this.dlAttrs.push(addInstanceAttr(this.dlGeo, 'aTop', this.dlTop, 3));
    this.dlAttrs.push(addInstanceAttr(this.dlGeo, 'aBottom', this.dlBottom, 3));
    this.dlAttrs.push(addInstanceAttr(this.dlGeo, 'aColor', this.dlColor, 3));
    this.dlAttrs.push(addInstanceAttr(this.dlGeo, 'aAlpha', this.dlAlpha, 1));
    this.dlAttrs.push(addInstanceAttr(this.dlGeo, 'aDash', this.dlDash, 1));
    this.dlMat = new THREE.ShaderMaterial({
      uniforms: {
        uViewport: { value: new THREE.Vector2(1920, 1080) },
        uProjScale: { value: 1000 },
        uWidthPx: { value: 1.5 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        ${GLSL_SCREEN}
        attribute vec3 aTop;
        attribute vec3 aBottom;
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute float aDash;
        uniform float uWidthPx;
        varying vec3 vColor;
        varying float vAlpha, vT, vRun, vSide, vDash;
        void main(){
          vColor = aColor;
          vAlpha = aAlpha;
          vT = position.x;
          vSide = position.y;
          vDash = aDash;
          vec3 wp = mix(aBottom, aTop, position.x);
          vRun = distance(aBottom, aTop) * position.x;
          vec4 vpos = modelViewMatrix * vec4(wp, 1.0);
          vec4 clip = projectionMatrix * vpos;
          // Drop lines are near-vertical on screen, so a pure horizontal
          // widening is both correct enough and perfectly stable.
          clip.x += sf_pxToClip(vec2(position.y * uWidthPx * 0.5, 0.0), clip.w).x;
          gl_Position = clip;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha, vT, vRun, vSide, vDash;
        void main(){
          // Bright at the hull, dissolving into the reference plane.
          float grad = mix(0.15, 1.0, vT);
          float a = vAlpha * grad * (1.0 - vSide * vSide * 0.35);
          if (vDash > 0.0) {
            float d = fract(vRun / vDash - uTime * 0.35);
            a *= smoothstep(0.62, 0.48, d);
          }
          gl_FragColor = vec4(vColor * a, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.dlMesh = new THREE.Mesh(this.dlGeo, this.dlMat);
    this.dlMesh.frustumCulled = false;
    this.dlMesh.renderOrder = 944;
    this.dlMesh.name = 'sf-selection-droplines';
    scene.add(this.dlMesh);

    // ---- order ribbons ---------------------------------------------------
    this.olGeo = buildRibbonGeometry(RIBBON_SEGMENTS);
    this.olAttrs.push(addInstanceAttr(this.olGeo, 'aFrom', this.olFrom, 3));
    this.olAttrs.push(addInstanceAttr(this.olGeo, 'aTo', this.olTo, 3));
    this.olAttrs.push(addInstanceAttr(this.olGeo, 'aColor', this.olColor, 3));
    this.olAttrs.push(addInstanceAttr(this.olGeo, 'aSpeed', this.olSpeed, 1));
    this.olMat = new THREE.ShaderMaterial({
      uniforms: {
        uViewport: { value: new THREE.Vector2(1920, 1080) },
        uProjScale: { value: 1000 },
        uWidthPx: { value: 2.6 },
        uDashWorld: { value: 60 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        ${GLSL_SCREEN}
        attribute vec3 aFrom;
        attribute vec3 aTo;
        attribute vec3 aColor;
        attribute float aSpeed;
        uniform float uWidthPx, uDashWorld, uTime;
        varying vec3 vColor;
        varying float vT, vSide, vDash;
        void main(){
          vColor = aColor;
          vT = position.x;
          vSide = position.y;
          vec3 wp = mix(aFrom, aTo, position.x);
          vec4 vpos = modelViewMatrix * vec4(wp, 1.0);
          vec3 a = (modelViewMatrix * vec4(aFrom, 1.0)).xyz;
          vec3 b = (modelViewMatrix * vec4(aTo, 1.0)).xyz;
          vec3 dir = b - a;
          float len = max(length(dir), 1e-4);
          dir /= len;
          // Camera-facing ribbon: widen along dir x (eye -> point).
          vec3 toEye = normalize(-vpos.xyz);
          vec3 side = cross(dir, toEye);
          float sl = length(side);
          side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
          float worldPerPx = 1.0 / sf_pxPerUnit(vpos.z);
          vpos.xyz += side * (position.y * uWidthPx * 0.5 * worldPerPx);
          gl_Position = projectionMatrix * vpos;
          vDash = len * position.x / uDashWorld - uTime * aSpeed;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        varying vec3 vColor;
        varying float vT, vSide, vDash;
        void main(){
          float d = fract(vDash);
          // Chevron-ish dash: hard leading edge, soft trailing edge.
          float dash = smoothstep(0.0, 0.10, d) * smoothstep(0.62, 0.40, d);
          float edge = 1.0 - vSide * vSide;
          // Energy accumulates toward the target — reads as "flowing into it".
          float head = mix(0.28, 1.0, vT * vT);
          float a = dash * edge * head;
          gl_FragColor = vec4(vColor * a, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.olMesh = new THREE.Mesh(this.olGeo, this.olMat);
    this.olMesh.frustumCulled = false;
    this.olMesh.renderOrder = 942;
    this.olMesh.name = 'sf-order-lines';
    scene.add(this.olMesh);

    // ---- move disc -------------------------------------------------------
    const discGeo = new THREE.CircleGeometry(1, quality.preset >= 2 ? 128 : 64);
    this.discMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x5fd0ff).convertSRGBToLinear() },
        uTime: { value: 0 },
        uAlpha: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main(){
          vP = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform vec3 uColor;
        uniform float uTime, uAlpha;
        varying vec2 vP;
        const float TAU = 6.28318530718;
        void main(){
          float r = length(vP);
          if (r > 1.0) discard;
          // Translucent body, brighter toward the rim.
          float body = 0.055 * (0.35 + 0.65 * r * r);
          // Concentric bands at 1/3 and 2/3 plus the outer rim.
          float rings = 0.0;
          rings += smoothstep(0.016, 0.0, abs(r - 0.34));
          rings += smoothstep(0.016, 0.0, abs(r - 0.67));
          rings += smoothstep(0.020, 0.0, abs(r - 0.985)) * 2.0;
          // 24 radial ticks around the rim, slowly rotating.
          float ang = atan(vP.y, vP.x) / TAU + uTime * 0.02;
          float tick = smoothstep(0.055, 0.0, abs(fract(ang * 24.0) - 0.5));
          rings += tick * smoothstep(0.80, 0.95, r) * 0.9;
          float a = (body + rings * 0.55) * uAlpha;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.disc = new THREE.Mesh(discGeo, this.discMat);
    this.disc.rotation.x = -Math.PI / 2; // CircleGeometry is XY; lay it on XZ.
    this.disc.frustumCulled = false;
    this.disc.renderOrder = 940;
    this.disc.visible = false;
    this.disc.name = 'sf-move-disc';
    scene.add(this.disc);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Position the Homeworld move-disc gizmo.
   *
   * @param x,y,z   the 3D destination the player is currently dialling in.
   * @param baseY   the height of the reference plane the disc sits on — the
   *                stalk spans `baseY -> y` and communicates the vertical offset.
   * @param visible pass `false` (or call {@link clearMoveGizmo}) to hide it.
   */
  setMoveGizmo(x: number, y: number, z: number, baseY: number, visible = true): void {
    this.gizmoX = x;
    this.gizmoY = y;
    this.gizmoZ = z;
    this.gizmoBase = baseY;
    this.gizmoOn = visible;
  }

  /** Hide the move-disc gizmo. Equivalent to `setMoveGizmo(0,0,0,0,false)`. */
  clearMoveGizmo(): void {
    this.gizmoOn = false;
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.olMat.uniforms.uWidthPx.value = q.preset >= 2 ? 2.6 : 3.2;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(ctx: RenderContext, world: World): void {
    const cam = ctx.camera;
    const sel = world.selection;
    const dt = ctx.dt;

    // --- shared screen-space constants -----------------------------------
    ctx.renderer.getDrawingBufferSize(_size);
    const vpH = Math.max(1, _size.y);
    const projScale = vpH / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this.setScreenUniforms(this.brMat, _size.x, vpH, projScale);
    this.setScreenUniforms(this.rgMat, _size.x, vpH, projScale);
    this.setScreenUniforms(this.dlMat, _size.x, vpH, projScale);
    this.setScreenUniforms(this.olMat, _size.x, vpH, projScale);
    this.dlMat.uniforms.uTime.value = ctx.time;
    this.olMat.uniforms.uTime.value = ctx.time;
    this.discMat.uniforms.uTime.value = ctx.time;

    // --- selection-change flash ------------------------------------------
    let sig = sel.length * 0x9e3779b1;
    for (let i = 0; i < sel.length && i < MAX_SEL; i++) sig = (sig ^ Math.imul(sel[i] + 1, 0x85ebca6b)) | 0;
    if (sig !== this.selSig) {
      this.selSig = sig;
      this.flash = 1;
    }
    this.flash = Math.max(0, this.flash - dt / FLASH_LIFE);
    const flashCurve = this.flash * this.flash;

    // The reference plane every drop line falls to. y = 0 is Starfall's
    // battle plane (CONFIG.mapHeight is the soft band around it).
    const planeY = 0;

    // Dash period and marker radii are tied to view distance so the HUD keeps a
    // constant apparent density from cockpit range out to strategic zoom.
    //
    // THE DISTANCE MUST BE TO THE MARKER, NOT TO THE ORIGIN. This used to read
    // `cam.position.length()`, which is the camera's distance from world zero.
    // Starfall's battle is nowhere near world zero — a skirmish sits tens of
    // kilometres out — so a camera 2 km from the action reported a "view
    // distance" of 20 km and every marker was sized for a viewer ten times
    // further away than the actual one. A destination ring came out as a
    // 700 px circle across half the screen. Sizing off the distance to the
    // point being marked is what the comment above always claimed was
    // happening.
    const camX = cam.position.x, camY = cam.position.y, camZ = cam.position.z;
    const viewDist = (x: number, y: number, z: number): number => {
      const ax = x - camX, ay = y - camY, az = z - camZ;
      return Math.max(120, Math.sqrt(ax * ax + ay * ay + az * az));
    };

    // The order-line dash period is ONE uniform for the whole batch, so it gets
    // the selection's own range rather than a per-line value.
    let selDist = 0;
    {
      let cx = 0, cy = 0, cz = 0, n = 0;
      for (let i = 0; i < Math.min(sel.length, MAX_SEL); i++) {
        const s = world.ship(sel[i]);
        if (!s) continue;
        cx += s.pos.x; cy += s.pos.y; cz += s.pos.z; n++;
      }
      selDist = n > 0 ? viewDist(cx / n, cy / n, cz / n) : 1200;
    }
    this.olMat.uniforms.uDashWorld.value = selDist * 0.018;
    // Dedup tolerance only — the ring each destination actually draws is sized
    // from its own range below.
    const destRadius = selDist * 0.020;

    let nBr = 0;
    let nRg = 0;
    let nDl = 0;
    let nOl = 0;
    let nDest = 0;

    const drawDrops = this.quality.preset > 0;
    const dest = this.destScratch;

    // --- per-selected-ship pass -------------------------------------------
    const count = Math.min(sel.length, MAX_SEL);
    for (let i = 0; i < count; i++) {
      const s = world.ship(sel[i]);
      if (!s || s.dockedIn >= 0) continue;
      const spec = SHIP_SPECS[s.cls];
      const t3 = s.team * 3;
      const cr = this.teamRgb[t3];
      const cg = this.teamRgb[t3 + 1];
      const cb = this.teamRgb[t3 + 2];

      // brackets
      const b3 = nBr * 3;
      this.brCenter[b3] = s.pos.x;
      this.brCenter[b3 + 1] = s.pos.y;
      this.brCenter[b3 + 2] = s.pos.z;
      this.brRadius[nBr] = spec.radius;
      this.brColor[b3] = cr;
      this.brColor[b3 + 1] = cg;
      this.brColor[b3 + 2] = cb;
      this.brFlash[nBr] = flashCurve;
      nBr++;

      // Drop line to the reference plane.
      //
      // Only for hulls big enough to be worth locating in three dimensions. A
      // 14-ship selection of fighters previously drew 14 vertical threads that
      // read as loose cyan scratches across the frame with no discernible owner
      // — the drop line answers "where is that thing really", which is a
      // question you ask about a capital, not about one interceptor in a wing.
      if (drawDrops && spec.radius >= DROPLINE_MIN_RADIUS && nDl < MAX_LINES) {
        const d3 = nDl * 3;
        this.dlTop[d3] = s.pos.x;
        this.dlTop[d3 + 1] = s.pos.y;
        this.dlTop[d3 + 2] = s.pos.z;
        this.dlBottom[d3] = s.pos.x;
        this.dlBottom[d3 + 1] = planeY;
        this.dlBottom[d3 + 2] = s.pos.z;
        this.dlColor[d3] = cr;
        this.dlColor[d3 + 1] = cg;
        this.dlColor[d3 + 2] = cb;
        this.dlAlpha[nDl] = 0.72;
        this.dlDash[nDl] = viewDist(s.pos.x, s.pos.y, s.pos.z) * 0.010;
        nDl++;
      }

      // --- orders ---------------------------------------------------------
      const o = s.order;
      let dx = 0, dy = 0, dz = 0;
      let hasDest = false;
      let kind = 0;

      if (o.kind === 'attack' && o.target !== undefined && o.target >= 0) {
        const tgt = world.ship(o.target);
        if (tgt) {
          if (nOl < MAX_ORDERS) {
            const o3 = nOl * 3;
            this.olFrom[o3] = s.pos.x;
            this.olFrom[o3 + 1] = s.pos.y;
            this.olFrom[o3 + 2] = s.pos.z;
            this.olTo[o3] = tgt.pos.x;
            this.olTo[o3 + 1] = tgt.pos.y;
            this.olTo[o3 + 2] = tgt.pos.z;
            this.olColor[o3] = ATTACK_RGB.r;
            this.olColor[o3 + 1] = ATTACK_RGB.g;
            this.olColor[o3 + 2] = ATTACK_RGB.b;
            this.olSpeed[nOl] = 1.5;  // attack ribbons flow fastest
            nOl++;
          }
          kind = 2;
        }
      } else if (o.kind === 'harvest') {
        // HARVEST ROUTE. A collector's order carries no destination of its own —
        // the economy drives it through a rock/haul cycle — so selecting one
        // previously showed nothing at all and the player had no way to see
        // where their income was going. Draw the leg it is currently flying:
        // outbound to the rock, or homebound to the dropoff.
        const outbound = s.harvestPhase !== 3;
        let tx = 0;
        let ty = 0;
        let tz = 0;
        let have = false;
        if (outbound) {
          const rock = o.rock !== undefined ? world.asteroids.get(o.rock) : undefined;
          if (rock) { tx = rock.pos.x; ty = rock.pos.y; tz = rock.pos.z; have = true; }
        } else {
          const home = world.ship(world.nearestDropoff(s.pos.x, s.pos.y, s.pos.z, s.team));
          if (home) { tx = home.pos.x; ty = home.pos.y; tz = home.pos.z; have = true; }
        }
        if (have) {
          dx = tx; dy = ty; dz = tz;
          hasDest = true;
          kind = 1;
          if (nOl < MAX_ORDERS) {
            const o3 = nOl * 3;
            this.olFrom[o3] = s.pos.x;
            this.olFrom[o3 + 1] = s.pos.y;
            this.olFrom[o3 + 2] = s.pos.z;
            this.olTo[o3] = tx;
            this.olTo[o3 + 1] = ty;
            this.olTo[o3 + 2] = tz;
            // Outbound runs in the team colour; the loaded haul home is green,
            // so a glance at the field says how much income is actually inbound.
            const g = outbound ? 0 : 1;
            this.olColor[o3] = outbound ? cr * 0.7 : 0.34;
            this.olColor[o3 + 1] = outbound ? cg * 0.7 : 0.88 * g + cg * (1 - g);
            this.olColor[o3 + 2] = outbound ? cb * 0.7 : 0.62;
            this.olSpeed[nOl] = outbound ? 0.7 : 1.1;
            nOl++;
          }
        }
      } else if ((o.kind === 'move' || o.kind === 'attackMove' || o.kind === 'formUp')
        && o.x !== undefined && o.y !== undefined && o.z !== undefined) {
        dx = o.x; dy = o.y; dz = o.z;
        hasDest = true;
        kind = o.kind === 'attackMove' ? 3 : 1;
        if (nOl < MAX_ORDERS) {
          const o3 = nOl * 3;
          this.olFrom[o3] = s.pos.x;
          this.olFrom[o3 + 1] = s.pos.y;
          this.olFrom[o3 + 2] = s.pos.z;
          this.olTo[o3] = dx;
          this.olTo[o3 + 1] = dy;
          this.olTo[o3 + 2] = dz;
          const em = kind === 3 ? 1.5 : 1.15;
          this.olColor[o3] = kind === 3 ? ATTACK_RGB.r * em : cr * em;
          this.olColor[o3 + 1] = kind === 3 ? ATTACK_RGB.g * em : cg * em;
          this.olColor[o3 + 2] = kind === 3 ? ATTACK_RGB.b * em : cb * em;
          this.olSpeed[nOl] = 0.85;
          // Overlays are instruction, not decoration: they must survive a bright
          // planet behind them. Ribbon, drop line and marker strengths were all
          // authored against the near-black sky of round 1 and were washed out
          // the moment the backdrop gained real luminance.
          nOl++;
        }
      }

      // --- new-order detection -> expanding ping ---------------------------
      //
      // The ping is a one-shot confirmation that an order LANDED, so it may only
      // fire on a genuinely new order. Comparing this frame's destination with
      // last frame's is not enough on its own: an `attack` or `guard` order's
      // "destination" is a live enemy hull, which moves every single frame, so
      // the naive test reported "changed" 60 times a second and buried the
      // screen in expanding rings for as long as anything was selected.
      //
      // Two guards. Only STATIC-destination orders may ping — a point the player
      // actually clicked — and any one hull may ping at most once per cooldown.
      const id = s.id;
      if (id < this.lastDestKind.length) {
        if (this.pingCool[id] > 0) this.pingCool[id] -= dt;
        const staticDest = kind === 1 || kind === 3; // move / attackMove / formUp
        const changed = this.lastDestKind[id] !== kind
          || Math.abs(this.lastDestX[id] - dx) > 1
          || Math.abs(this.lastDestY[id] - dy) > 1
          || Math.abs(this.lastDestZ[id] - dz) > 1;
        if (changed) {
          this.lastDestKind[id] = kind;
          this.lastDestX[id] = dx;
          this.lastDestY[id] = dy;
          this.lastDestZ[id] = dz;
          if (hasDest && o.manual && staticDest && this.pingCool[id] <= 0) {
            this.pingCool[id] = PING_COOLDOWN;
            this.spawnPing(dx, dy, dz, viewDist(dx, dy, dz) * 0.055, cr, cg, cb);
          }
        }
      }

      // --- destination marker (deduplicated across the selection) ----------
      if (hasDest && nDest < MAX_DESTS) {
        let dup = false;
        for (let k = 0; k < nDest; k++) {
          const kx = dest[k * 3] - dx;
          const ky = dest[k * 3 + 1] - dy;
          const kz = dest[k * 3 + 2] - dz;
          if (kx * kx + ky * ky + kz * kz < destRadius * destRadius * 0.6) { dup = true; break; }
        }
        if (!dup) {
          dest[nDest * 3] = dx;
          dest[nDest * 3 + 1] = dy;
          dest[nDest * 3 + 2] = dz;
          nDest++;
          if (nRg < MAX_RINGS) {
            const r3 = nRg * 3;
            this.rgCenter[r3] = dx;
            this.rgCenter[r3 + 1] = dy;
            this.rgCenter[r3 + 2] = dz;
            this.rgRadius[nRg] = viewDist(dx, dy, dz) * 0.020;
            const em = kind === 3 ? 1.6 : 1.4;
            this.rgColor[r3] = kind === 3 ? ATTACK_RGB.r : cr;
            this.rgColor[r3 + 1] = kind === 3 ? ATTACK_RGB.g : cg;
            this.rgColor[r3 + 2] = kind === 3 ? ATTACK_RGB.b : cb;
            this.rgAlpha[nRg] = 0.85 * em;
            nRg++;
          }
          if (drawDrops && nDl < MAX_LINES) {
            const d3 = nDl * 3;
            this.dlTop[d3] = dx;
            this.dlTop[d3 + 1] = dy;
            this.dlTop[d3 + 2] = dz;
            this.dlBottom[d3] = dx;
            this.dlBottom[d3 + 1] = planeY;
            this.dlBottom[d3 + 2] = dz;
            this.dlColor[d3] = cr;
            this.dlColor[d3 + 1] = cg;
            this.dlColor[d3 + 2] = cb;
            this.dlAlpha[nDl] = 0.62;
            this.dlDash[nDl] = viewDist(dx, dy, dz) * 0.010;
            nDl++;
          }
        }
      }
    }

    // --- pings --------------------------------------------------------------
    for (let i = 0; i < MAX_PINGS; i++) {
      if (this.pingT[i] <= 0) continue;
      this.pingT[i] -= dt;
      const life = Math.max(0, this.pingT[i]) / PING_LIFE;
      if (nRg >= MAX_RINGS) continue;
      // Ease-out expansion, linear-ish fade — reads as a shockwave, not a blob.
      const grow = 1 - life;
      const r3 = nRg * 3;
      this.rgCenter[r3] = this.pingX[i];
      this.rgCenter[r3 + 1] = this.pingY[i];
      this.rgCenter[r3 + 2] = this.pingZ[i];
      this.rgRadius[nRg] = this.pingR[i] * (0.08 + grow * (2.0 - grow));
      this.rgColor[r3] = this.pingRgb[i * 3];
      this.rgColor[r3 + 1] = this.pingRgb[i * 3 + 1];
      this.rgColor[r3 + 2] = this.pingRgb[i * 3 + 2];
      this.rgAlpha[nRg] = life * life * 0.9;
      nRg++;
    }

    // --- move disc gizmo ----------------------------------------------------
    if (this.gizmoOn) {
      _v3.set(this.gizmoX, this.gizmoBase, this.gizmoZ);
      const gd = Math.max(60, _v3.distanceTo(cam.position));
      const discR = gd * 0.055;
      this.disc.position.set(this.gizmoX, this.gizmoBase, this.gizmoZ);
      this.disc.scale.setScalar(discR);
      this.disc.visible = true;
      this.discMat.uniforms.uAlpha.value = 1;
      // Stalk from the plane up (or down) to the commanded altitude.
      if (nDl < MAX_LINES) {
        const d3 = nDl * 3;
        this.dlTop[d3] = this.gizmoX;
        this.dlTop[d3 + 1] = this.gizmoY;
        this.dlTop[d3 + 2] = this.gizmoZ;
        this.dlBottom[d3] = this.gizmoX;
        this.dlBottom[d3 + 1] = this.gizmoBase;
        this.dlBottom[d3 + 2] = this.gizmoZ;
        this.dlColor[d3] = this.teamRgb[0];
        this.dlColor[d3 + 1] = this.teamRgb[1];
        this.dlColor[d3 + 2] = this.teamRgb[2];
        this.dlAlpha[nDl] = 0.95;
        this.dlDash[nDl] = 0; // solid — this one is being actively dragged
        nDl++;
      }
      // Cap ring at the commanded altitude.
      if (nRg < MAX_RINGS) {
        const r3 = nRg * 3;
        this.rgCenter[r3] = this.gizmoX;
        this.rgCenter[r3 + 1] = this.gizmoY;
        this.rgCenter[r3 + 2] = this.gizmoZ;
        this.rgRadius[nRg] = discR * 0.20;
        this.rgColor[r3] = this.teamRgb[0];
        this.rgColor[r3 + 1] = this.teamRgb[1];
        this.rgColor[r3 + 2] = this.teamRgb[2];
        this.rgAlpha[nRg] = 0.9;
        nRg++;
      }
    } else {
      this.disc.visible = false;
    }

    // --- upload -------------------------------------------------------------
    this.commit(this.brMesh, this.brGeo, this.brAttrs, nBr);
    this.commit(this.rgMesh, this.rgGeo, this.rgAttrs, nRg);
    this.commit(this.dlMesh, this.dlGeo, this.dlAttrs, nDl);
    this.commit(this.olMesh, this.olGeo, this.olAttrs, nOl);
  }

  dispose(): void {
    for (const m of [this.brMesh, this.rgMesh, this.dlMesh, this.olMesh, this.disc]) {
      this.scene.remove(m);
    }
    this.brGeo.dispose();
    this.rgGeo.dispose();
    this.dlGeo.dispose();
    this.olGeo.dispose();
    this.disc.geometry.dispose();
    this.brMat.dispose();
    this.rgMat.dispose();
    this.dlMat.dispose();
    this.olMat.dispose();
    this.discMat.dispose();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private setScreenUniforms(m: THREE.ShaderMaterial, w: number, h: number, projScale: number): void {
    const vp = m.uniforms.uViewport.value as THREE.Vector2;
    vp.set(w, h);
    m.uniforms.uProjScale.value = projScale;
  }

  /** Flag the instance buffers dirty and set the draw count for this frame. */
  private commit(
    mesh: THREE.Mesh, geo: THREE.InstancedBufferGeometry,
    attrs: THREE.InstancedBufferAttribute[], n: number,
  ): void {
    mesh.visible = n > 0;
    geo.instanceCount = n;
    if (n === 0) return;
    for (let i = 0; i < attrs.length; i++) attrs[i].needsUpdate = true;
  }

  /** Claim a ping slot (ring buffer — the oldest is overwritten when full). */
  private spawnPing(
    x: number, y: number, z: number, radius: number, r: number, g: number, b: number,
  ): void {
    const i = this.pingHead;
    this.pingHead = (this.pingHead + 1) % MAX_PINGS;
    this.pingX[i] = x;
    this.pingY[i] = y;
    this.pingZ[i] = z;
    this.pingR[i] = radius;
    this.pingT[i] = PING_LIFE;
    this.pingRgb[i * 3] = r;
    this.pingRgb[i * 3 + 1] = g;
    this.pingRgb[i * 3 + 2] = b;
  }
}
