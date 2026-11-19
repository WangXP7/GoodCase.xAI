/**
 * THE PRODUCTION PANEL — build grid, live queue, rally control, research tree.
 *
 * WHAT: the left-hand command panel. It shows what the currently selected
 * producer (mothership / carrier / refinery) can build, why anything greyed out
 * is greyed out, what is on the line right now with a progress arc per item,
 * where new hulls will fly to, and the research tree as a real dependency graph
 * with a progress bar on the active project.
 *
 * WHY procedural icons: shipping a folder of hand-drawn ship portraits means the
 * icon and the hull drift apart the moment either changes, and it is the single
 * fastest way to make an RTS look like a hobby project. Every icon here is a
 * three-quarter plan view rasterised from that class's own authored silhouette
 * plus its *actual* `ShipSpec` engine mounts — so the icon in the panel and the
 * hull on the battlefield stay in the same family.
 *
 * HOW: the DOM is built once in the constructor and only ever mutated when a
 * value actually changes (every readout keeps its last-written primitive and
 * compares before touching the document). Structural refreshes run at 15 Hz;
 * queue arcs animate every frame because they are three style writes each.
 *
 * The panel is read-only with respect to the sim with exactly two exceptions,
 * both explicit player actions: clearing a rally point, and the three callbacks
 * handed in through `opts`. It never issues orders itself.
 *
 * ---------------------------------------------------------------------------
 * ROUND-1 CRITIQUE FIXES (verify/critique-round1.json, reviewer 1 + 2, axis "ui")
 *
 *  [C1] "Ten of the twelve build tiles are covered by baked-in requirement text
 *       ... the loudest element in the panel is negative information."
 *       -> The per-tile `NEEDS X` overlay is GONE. A research-locked tile now
 *          shows the silhouette dimmed, a hatch wash, a 12 px lock glyph in the
 *          corner and no cost at all. The requirement moved to (a) the tile's
 *          native tooltip and (b) the inspector line under the grid, which is
 *          where the class blurb already lived and had room. Soft blocks
 *          (cannot afford / supply / queue full) keep the tile at FULL strength
 *          and signal through the cost colour + a bottom rule only — reviewer 2
 *          asked us to "pick one" treatment rather than shipping neither.
 *
 *  [C2] "The research DAG is illegible — every dependency is a free bezier
 *       between node centres."
 *       -> {@link BuildPanel.buildResearchGraph} now ranks by depth, orders each
 *          rank barycentrically to cut crossings, and routes every edge
 *          ORTHOGONALLY through a reserved gutter lane with rounded corners and
 *          a chevron head. Node box 34 u tall, type 11 u, panel scales with the
 *          viewport so the type never drops under ~10 px.
 *
 *  [C3] "The ship thumbnails ... are grey clay renders, all front-on and
 *       near-indistinguishable at tile size."
 *       -> {@link ICONS} authors one silhouette PER CLASS (not per size band)
 *          with its own beam ratio, appendages and deck structures, drawn as a
 *          flat-value filled cutout with a modelled thickness so SCT / INT /
 *          COL / CAR separate at 48 px. See the note on {@link IconSpec.aspect}
 *          for why the beam is authored rather than solved from `spec.radius`.
 *
 *  [C4] "The HUD has no shared grid."
 *       -> The panel is now built on the shared `.sf-panel > .sf-in` primitive
 *          from style.css with the `cut-r` chamfer, and its screen inset reads
 *          `--sf-inset` (owned by hud.ts / style.css) with a local fallback.
 *          See panels.css.
 *
 *  [C5] "The build queue needs clear progress, cancel affordances, and a
 *       readable rally-point control."
 *       -> The queue gained a lead-job progress bar with percent + ETA, an
 *          explicit CANCEL hint, and per-slot index badges. Rally moved to a
 *          two-row block so the coordinate never truncates, and CLR disables
 *          itself when there is nothing to clear.
 */

import type { Camera } from 'three';
import { bus } from '../core/bus';
import type { UiLayer } from '../core/contracts';
import { PALETTES, UI } from '../core/palette';
import { RESEARCH, RESEARCH_BY_ID, SHIP_SPECS, STARTING_UNLOCKS } from '../core/registry';
import {
  ALL_SHIP_CLASSES,
  HullSize,
  ShipClass,
  type Producer,
  type ResearchSpec,
  type ShipSpec,
  type Team,
} from '../core/types';
import type { World } from '../sim/world';
import './panels.css';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Queue slots rendered; anything past this collapses into a "+N" chip. */
const QUEUE_SLOTS = 8;
/** Soft cap on queue depth — used only to explain why a tile is disabled. */
const QUEUE_LIMIT = 12;
/**
 * Icon raster size in CSS pixels. Deliberately larger than any tile ever gets
 * (tiles top out near 84 px) so the browser always DOWN-samples: an upscaled
 * icon is the single most obvious "hobby project" tell in a build panel.
 */
const ICON_PX = 96;
/** Structural refresh rate. Progress arcs still animate every frame. */
const REFRESH_HZ = 15;

/** Radius of the queue progress arc, in SVG user units. */
const ARC_R = 15;
const ARC_C = 2 * Math.PI * ARC_R;

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// Buildability
// ---------------------------------------------------------------------------

/** Why a tile is disabled. 0 means it is buildable right now. */
const enum Block {
  None = 0,
  Research = 1,
  Resources = 2,
  Supply = 3,
  QueueFull = 4,
}

// ---------------------------------------------------------------------------
// Procedural ship icons  [C3]
// ---------------------------------------------------------------------------

/**
 * One authored plan-view silhouette. Drawn nose-up, mirrored about the
 * centreline, then extruded down-right by {@link depth} so the thumbnail reads
 * as a solid object under an upper-left key rather than as a decal.
 */
interface IconSpec {
  /**
   * Beam / length.
   *
   * WHY AUTHORED, NOT SOLVED: the previous build inferred beam from the
   * bounding sphere (`sqrt(r^2 - (L/2)^2)`) and then blended it 65% toward a
   * per-band constant. Every class in the game has a bounding sphere that is
   * dominated by its length, so the solved term collapsed to its floor and all
   * twelve icons came out as the same fat bell — exactly the "grey clay renders
   * ... near-indistinguishable at tile size" the critique names. A `ShipSpec`
   * simply does not carry beam, so beam is authored here, next to the profile
   * it has to agree with, and kept honest against the hull by eye.
   */
  aspect: number;
  /** Half-width profile as `[t, w]`, t = 0 nose to 1 tail, w in half-beams. */
  prof: number[][];
  /** Slab thickness as a fraction of drawn length, for the 3/4 extrusion. */
  depth: number;
  /** Appendages under the hull: `[t0, t1, x0, x1, side]`, x in half-beams. */
  pods?: number[][];
  /** Raised deck structures on the top face, same tuple form. */
  deck?: number[][];
  /** `side`: 0 mirrors port+starboard, +1 starboard only, -1 port only. */
}

/**
 * Per-class silhouettes.
 *
 * The design brief for this table is "black-cutout separability at 48 px":
 * pick ONE structural idea per class and push it past the point of taste —
 * needle vs delta vs slab-wing, box launchers vs sponsons, spinal barrel vs
 * broadside, fork-maw vs tank farm vs flight deck. Subtlety does not survive
 * a 48 px box.
 */
const ICONS: Partial<Record<ShipClass, IconSpec>> = {
  // SCT — recon needle. Long thin fuselage, tiny wings set right aft.
  [ShipClass.Scout]: {
    aspect: 0.52, depth: 0.06,
    prof: [
      [0.00, 0.05], [0.08, 0.13], [0.22, 0.16], [0.46, 0.16], [0.575, 0.18],
      [0.58, 0.62], [0.70, 0.56], [0.705, 0.20], [0.92, 0.19], [1.00, 0.13],
    ],
    deck: [[0.22, 0.52, 0.00, 0.075, 0]],
  },
  // INT — broad swept delta. Widest fighter; wing peak sits well aft.
  [ShipClass.Interceptor]: {
    aspect: 0.94, depth: 0.06,
    prof: [
      [0.00, 0.05], [0.09, 0.12], [0.24, 0.14], [0.34, 0.15], [0.40, 0.40],
      [0.54, 0.72], [0.68, 1.00], [0.755, 0.96], [0.76, 0.26], [0.90, 0.24],
      [1.00, 0.17],
    ],
    deck: [[0.13, 0.42, 0.00, 0.09, 0]],
  },
  // BMB — cruciform. Straight thick wing block + outboard ordnance pods.
  [ShipClass.Bomber]: {
    aspect: 0.88, depth: 0.09,
    prof: [
      [0.00, 0.20], [0.06, 0.26], [0.18, 0.30], [0.345, 0.32], [0.35, 0.86],
      [0.58, 0.90], [0.585, 0.86], [0.66, 0.86], [0.665, 0.40], [0.86, 0.38],
      [1.00, 0.30],
    ],
    pods: [[0.30, 0.72, 0.58, 0.80, 0]],
    deck: [[0.09, 0.32, 0.00, 0.15, 0]],
  },
  // ACV — faceted brawler block. Parallel flanks, stepped engine deck aft,
  // four blisters standing clear of the hull line.
  [ShipClass.AssaultCorvette]: {
    aspect: 0.72, depth: 0.15,
    prof: [
      [0.00, 0.20], [0.09, 0.46], [0.17, 0.70], [0.175, 0.72], [0.60, 0.76],
      [0.605, 0.96], [0.84, 0.94], [0.845, 0.62], [1.00, 0.56],
    ],
    pods: [[0.16, 0.34, 0.80, 1.24, 0], [0.44, 0.60, 0.82, 1.20, 0]],
    deck: [[0.28, 0.56, 0.00, 0.34, 0]],
  },
  // MCV — narrow tube with two enormous DETACHED box launchers on pylons.
  // The gap between hull and launcher is the whole silhouette idea.
  [ShipClass.MissileCorvette]: {
    aspect: 0.60, depth: 0.11,
    prof: [
      [0.00, 0.14], [0.08, 0.28], [0.20, 0.40], [0.215, 0.40], [0.72, 0.44],
      [0.725, 0.60], [0.90, 0.58], [1.00, 0.42],
    ],
    pods: [[0.24, 0.62, 0.94, 1.56, 0], [0.40, 0.48, 0.38, 0.98, 0]],
    deck: [[0.26, 0.60, 1.04, 1.46, 0]],
  },
  // ION — spinal cannon. Narrow needle hull, barrel running the forward half,
  // drive block flared right at the stern.
  [ShipClass.IonFrigate]: {
    aspect: 0.34, depth: 0.10,
    prof: [
      [0.00, 0.10], [0.06, 0.13], [0.40, 0.15], [0.405, 0.34], [0.60, 0.44],
      [0.70, 0.72], [0.705, 1.00], [0.90, 0.96], [0.905, 0.70], [1.00, 0.58],
    ],
    deck: [[0.02, 0.40, 0.00, 0.075, 0], [0.70, 0.88, 0.00, 0.40, 0]],
  },
  // AFG — hammerhead bow, waist, wide broadside midbody with flat sponsons.
  [ShipClass.AssaultFrigate]: {
    aspect: 0.48, depth: 0.12,
    prof: [
      [0.00, 0.34], [0.02, 0.60], [0.13, 0.62], [0.135, 0.42], [0.32, 0.48],
      [0.325, 0.86], [0.70, 0.90], [0.705, 0.70], [0.90, 0.68], [1.00, 0.50],
    ],
    pods: [[0.36, 0.68, 0.94, 1.30, 0]],
    deck: [[0.40, 0.64, 0.00, 0.36, 0]],
  },
  // DST — capital wedge. Sharp prow, stepped midbody, twin stern fins.
  [ShipClass.Destroyer]: {
    aspect: 0.30, depth: 0.08,
    prof: [
      [0.00, 0.04], [0.06, 0.16], [0.16, 0.30], [0.28, 0.40], [0.475, 0.46],
      [0.48, 0.86], [0.64, 0.94], [0.72, 0.90], [0.725, 0.60], [0.84, 0.74],
      [0.94, 0.66], [1.00, 0.44],
    ],
    deck: [[0.08, 0.62, 0.00, 0.12, 0], [0.38, 0.56, 0.00, 0.32, 0]],
  },
  // HVC — the long one. Two flares along a spinal hull plus full-length
  // outrigger rails standing clear of the beam.
  [ShipClass.HeavyCruiser]: {
    aspect: 0.36, depth: 0.08,
    prof: [
      [0.00, 0.05], [0.05, 0.16], [0.16, 0.26], [0.295, 0.30], [0.30, 0.62],
      [0.50, 0.66], [0.505, 0.40], [0.68, 0.44], [0.685, 0.78], [0.86, 0.80],
      [0.865, 0.52], [1.00, 0.40],
    ],
    pods: [[0.30, 0.90, 1.00, 1.28, 0]],
    deck: [[0.06, 0.72, 0.00, 0.13, 0], [0.32, 0.48, 0.00, 0.40, 0]],
  },
  // COL — the fork. Two forward collection arms around an open maw.
  [ShipClass.ResourceCollector]: {
    aspect: 0.64, depth: 0.15,
    prof: [
      [0.00, 0.26], [0.035, 0.26], [0.04, 0.14], [0.16, 0.20], [0.28, 0.48],
      [0.42, 0.72], [0.56, 0.86], [0.70, 0.94], [0.835, 1.00], [0.84, 0.80],
      [1.00, 0.62],
    ],
    pods: [[0.00, 0.32, 0.42, 0.94, 0]],
    deck: [[0.50, 0.80, 0.00, 0.40, 0]],
  },
  // REF — the squat industrial one. Shortest, widest hull in the set, with
  // intake arms forward and two processing drums on the beam.
  [ShipClass.ResourceRefinery]: {
    aspect: 0.66, depth: 0.16,
    prof: [
      [0.00, 0.24], [0.055, 0.44], [0.295, 0.48], [0.30, 0.80], [0.64, 0.84],
      [0.645, 0.60], [0.88, 0.66], [1.00, 0.48],
    ],
    pods: [[0.08, 0.28, 0.56, 1.36, 0], [0.36, 0.62, 0.88, 1.20, 0]],
    deck: [[0.36, 0.60, 0.90, 1.18, 0], [0.34, 0.58, 0.00, 0.42, 0]],
  },
  // CAR — the slab. Hard parallel flight deck, stern quarter-notch, drive pods
  // aft, and an island MASSED TO STARBOARD: the only asymmetric icon in the set.
  [ShipClass.Carrier]: {
    aspect: 0.52, depth: 0.06,
    prof: [
      [0.00, 0.30], [0.03, 0.62], [0.10, 0.80], [0.105, 0.88],
      [0.86, 0.90], [0.865, 0.62], [0.95, 0.64], [1.00, 0.42],
    ],
    pods: [[0.56, 0.94, 0.84, 1.16, 0], [0.20, 0.58, 0.82, 1.24, 1]],
    deck: [[0.16, 0.64, 0.30, 0.84, 1]],
  },
  // MSH — never in the grid, but the queue can be asked for any class.
  [ShipClass.Mothership]: {
    aspect: 0.44, depth: 0.07,
    prof: [
      [0.00, 0.16], [0.06, 0.38], [0.24, 0.54], [0.245, 0.72], [0.46, 0.78],
      [0.465, 1.00], [0.70, 0.96], [0.705, 0.66], [0.88, 0.74], [1.00, 0.52],
    ],
    pods: [[0.44, 0.92, 0.96, 1.26, 0]],
    deck: [[0.08, 0.74, 0.00, 0.18, 0], [0.30, 0.50, 0.00, 0.46, 0]],
  },
};

/** Fallback silhouette per size band, for any class not authored above. */
const BAND_FALLBACK: Record<HullSize, IconSpec> = {
  [HullSize.Fighter]: ICONS[ShipClass.Interceptor]!,
  [HullSize.Corvette]: ICONS[ShipClass.AssaultCorvette]!,
  [HullSize.Frigate]: ICONS[ShipClass.AssaultFrigate]!,
  [HullSize.Capital]: ICONS[ShipClass.Destroyer]!,
  [HullSize.SuperCapital]: ICONS[ShipClass.Carrier]!,
  [HullSize.Utility]: ICONS[ShipClass.ResourceCollector]!,
};

/**
 * Icon palette. Reviewer 2: "filled silhouettes at ONE consistent value so
 * class reads as a black cutout at 24 px" — so the whole hull sits inside one
 * narrow light band and every piece of internal detail is a DARK recess cut
 * into it. A first pass at this made the decks lighter than the hull, which at
 * 48 px turned into white-on-white mush; a dark groove on a light plate is the
 * only interior detail that survives the downscale.
 */
const ICON_TOP_A = '#cfdae6'; // top face, bow
const ICON_TOP_B = '#8f9fae'; // top face, stern
const ICON_SHADOW = 'rgba(2, 5, 9, 0.55)'; // cast shadow, offset down-right
const ICON_POD = '#7d8b9a'; // appendages, one clear step under the hull
const ICON_DECK = 'rgba(40, 51, 63, 0.88)'; // recessed deck structures
const ICON_EDGE = 'rgba(6, 10, 16, 0.92)'; // cutout outline

/** Icon raster cache, keyed by `class|accent`. Built lazily, once. */
const ICON_CACHE = new Map<string, string>();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Sample the half-width profile at `t`, linearly interpolated. */
function profileAt(p: number[][], t: number): number {
  if (t <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const a = p[i - 1];
      const b = p[i];
      const k = (t - a[0]) / Math.max(b[0] - a[0], 1e-5);
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return p[p.length - 1][1];
}

/** Trace an axis-aligned box with a small constant corner radius. */
function roundedBox(
  g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, rad: number,
): void {
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1);
  const yb = Math.max(y0, y1);
  const r = Math.min(rad, (xb - xa) * 0.5, (yb - ya) * 0.5);
  g.beginPath();
  g.moveTo(xa, ya + r);
  g.lineTo(xa, yb - r);
  g.quadraticCurveTo(xa, yb, xa + r, yb);
  g.lineTo(xb - r, yb);
  g.quadraticCurveTo(xb, yb, xb, yb - r);
  g.lineTo(xb, ya + r);
  g.quadraticCurveTo(xb, ya, xb - r, ya);
  g.lineTo(xa + r, ya);
  g.quadraticCurveTo(xa, ya, xa, ya + r);
  g.closePath();
}

/**
 * Rasterise the three-quarter plan view of `cls` and return it as a data URL.
 *
 * Five flat passes, no smooth shading anywhere: cast shadow, appendages, lit
 * hull, recessed deck, team paint, engines. Flat is the point — a gradient-shaded
 * "clay render" is exactly what the critique rejected, because at 48 px every
 * class averages to the same grey blob. [C3]
 */
function buildIcon(cls: ShipClass, accent: string): string {
  const key = cls + '|' + accent;
  const cached = ICON_CACHE.get(key);
  if (cached) return cached;

  const spec = SHIP_SPECS[cls];
  const icon = ICONS[cls] ?? BAND_FALLBACK[spec.size];
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const cv = document.createElement('canvas');
  cv.width = Math.round(ICON_PX * dpr);
  cv.height = Math.round(ICON_PX * dpr);
  const g = cv.getContext('2d');
  if (!g) return '';
  g.scale(dpr, dpr);

  // Widest appendage decides the horizontal fit, or the icon clips its own pods.
  let maxX = 1;
  if (icon.pods) for (const p of icon.pods) maxX = Math.max(maxX, p[3]);
  if (icon.deck) for (const p of icon.deck) maxX = Math.max(maxX, p[3]);

  const pad = ICON_PX * 0.09;
  const box = ICON_PX - pad * 2;
  // Fit length and full beam (including appendages) into the padded box, then
  // shrink by the class's place on a log length scale so a 19 m scout does not
  // fill its tile exactly like a 630 m carrier. Log, not linear, because linear
  // would render every fighter as a two-pixel speck. This is the cheapest scale
  // cue in the panel and it is free. [C3]
  const fill = clamp(0.68 + 0.32 * (Math.log(spec.length / 19) / 3.50), 0.66, 1.0);
  const fitL = box / (1 + icon.depth);
  const fitB = box / (icon.aspect * maxX);
  const pxPerL = Math.min(fitL, fitB) * fill;
  const drawL = pxPerL;
  const halfBeam = icon.aspect * 0.5 * pxPerL;
  const dz = icon.depth * pxPerL; // extrusion, down-right

  const top = (ICON_PX - drawL - dz) * 0.5;
  const cx = ICON_PX * 0.5 - dz * 0.16;

  const yAt = (t: number): number => top + t * drawL;
  const xAt = (t: number, side: number): number => cx + side * profileAt(icon.prof, t) * halfBeam;

  const STEPS = 56;
  /** Trace the hull outline, optionally displaced by the extrusion vector. */
  const traceHull = (ox: number, oy: number): void => {
    g.beginPath();
    g.moveTo(cx + ox, yAt(0) + oy);
    for (let i = 0; i <= STEPS; i++) g.lineTo(xAt(i / STEPS, 1) + ox, yAt(i / STEPS) + oy);
    for (let i = STEPS; i >= 0; i--) g.lineTo(xAt(i / STEPS, -1) + ox, yAt(i / STEPS) + oy);
    g.closePath();
  };

  const boxAt = (b: number[], ox: number, oy: number): void => {
    const [t0, t1, x0, x1, side] = b;
    const sgn = side === 0 ? 0 : side;
    if (sgn === 0) {
      for (let s = -1; s <= 1; s += 2) {
        roundedBox(
          g, cx + s * x0 * halfBeam + ox, yAt(t0) + oy,
          cx + s * x1 * halfBeam + ox, yAt(t1) + oy, pxPerL * 0.012,
        );
        g.fill();
      }
    } else {
      roundedBox(
        g, cx + sgn * x0 * halfBeam + ox, yAt(t0) + oy,
        cx + sgn * x1 * halfBeam + ox, yAt(t1) + oy, pxPerL * 0.012,
      );
      g.fill();
    }
  };

  const EDGE_W = 1.2;

  // --- 1. cast shadow -----------------------------------------------------
  // Offset down-right under an upper-left key. This is what lifts the icon off
  // the tile plate; without it the silhouette reads as a printed decal.
  g.fillStyle = ICON_SHADOW;
  traceHull(dz * 0.42, dz);
  g.fill();
  if (icon.pods) for (const p of icon.pods) boxAt(p, dz * 0.42, dz);

  // --- 2. appendages ------------------------------------------------------
  // Drawn UNDER the hull and a clear value step darker, so where a pod stands
  // off the beam (MCV launchers, HVC rails) the gap is unambiguous.
  if (icon.pods) {
    g.fillStyle = ICON_POD;
    for (const p of icon.pods) boxAt(p, 0, 0);
    g.strokeStyle = ICON_EDGE;
    g.lineWidth = EDGE_W;
    for (const p of icon.pods) { boxAt(p, 0, 0); g.stroke(); }
  }

  // --- 3. lit top face ----------------------------------------------------
  traceHull(0, 0);
  const grad = g.createLinearGradient(0, yAt(0), 0, yAt(1));
  grad.addColorStop(0, ICON_TOP_A);
  grad.addColorStop(1, ICON_TOP_B);
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = ICON_EDGE;
  g.lineWidth = EDGE_W;
  g.lineJoin = 'round';
  g.stroke();

  // --- 4. recessed deck structure ----------------------------------------
  // Dark grooves cut into the light plate: spine trenches, hangar mouths, the
  // carrier island. Clipped to the hull for the mirrored cases so a recess can
  // never spill past the silhouette; asymmetric ones (the carrier island) are
  // allowed to overhang, because that overhang IS the read.
  if (icon.deck) {
    g.fillStyle = ICON_DECK;
    for (const p of icon.deck) {
      const mirrored = p[4] === 0;
      if (mirrored) { g.save(); traceHull(0, 0); g.clip(); }
      boxAt(p, 0, 0);
      if (mirrored) g.restore();
    }
  }

  // --- 5. team paint: one accent band across the bow ----------------------
  // The only chroma on the hull. Clipped to the silhouette so it is paint on
  // the plating, not a rectangle floating over it.
  g.save();
  traceHull(0, 0);
  g.clip();
  g.fillStyle = accent;
  g.globalAlpha = 0.9;
  g.fillRect(0, yAt(0.085), ICON_PX, Math.max(1.3, drawL * 0.035));
  g.globalAlpha = 1;
  g.restore();

  // --- 6. engines, from the real spec ------------------------------------
  for (let i = 0; i < spec.engines.length && i < 10; i++) {
    const m = spec.engines[i];
    const t = clamp(0.5 - m.pos[2] / spec.length, 0.02, 1.0);
    const x = cx + clamp(m.pos[0] / Math.max(spec.radius * 0.8, 1), -1, 1) * halfBeam * 0.88;
    const y = yAt(Math.max(t, 0.9));
    const r = clamp(drawL * 0.035, 1.2, 4.0);
    const glow = g.createRadialGradient(x, y, 0, x, y, r * 2.4);
    glow.addColorStop(0, 'rgba(210, 246, 255, 0.85)');
    glow.addColorStop(0.35, 'rgba(120, 215, 255, 0.40)');
    glow.addColorStop(1, 'rgba(120, 215, 255, 0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(x, y, r * 2.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#bff2ff';
    g.beginPath();
    g.arc(x, y, r * 0.55, 0, Math.PI * 2);
    g.fill();
  }

  const url = cv.toDataURL('image/png');
  ICON_CACHE.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.appendChild(n);
  return n;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K, cls?: string, parent?: Element,
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  if (cls) n.setAttribute('class', cls);
  if (parent) parent.appendChild(n);
  return n;
}

/** "Strike Craft Doctrine" -> "STRIKE CRAFT D." so nodes stay one line. */
function shortName(name: string): string {
  const up = name.toUpperCase();
  if (up.length <= 15) return up;
  const words = up.split(' ');
  if (words.length === 1) return up.slice(0, 14) + '.';
  let out = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = out + ' ' + words[i];
    if (next.length <= 15) out = next;
    else { out += ' ' + words[i][0] + '.'; break; }
  }
  return out;
}

/** A 12x14 padlock, as SVG children of `parent`. Used as the locked badge. */
function lockGlyph(parent: Element): SVGSVGElement {
  const s = svg('svg', 'sf-tile-lock', parent);
  s.setAttribute('viewBox', '0 0 12 14');
  const shackle = svg('path', 'sf-lock-shackle', s);
  shackle.setAttribute('d', 'M3.4 6.4 V4.4 A2.6 2.6 0 0 1 8.6 4.4 V6.4');
  const body = svg('rect', 'sf-lock-body', s);
  body.setAttribute('x', '1.7');
  body.setAttribute('y', '6.2');
  body.setAttribute('width', '8.6');
  body.setAttribute('height', '6.6');
  return s;
}

// ---------------------------------------------------------------------------
// Internal view models
// ---------------------------------------------------------------------------

interface Tile {
  cls: ShipClass;
  root: HTMLDivElement;
  cost: HTMLDivElement;
  /** Last written block code, so the DOM is only touched on change. */
  lastBlock: number;
  lastShown: boolean;
  lastOrder: number;
}

interface Slot {
  root: HTMLDivElement;
  icon: HTMLImageElement;
  arc: SVGCircleElement;
  label: HTMLDivElement;
  lastCls: number;
  lastPct: number;
  lastShown: boolean;
}

interface ResNode {
  spec: ResearchSpec;
  group: SVGGElement;
  fill: SVGRectElement;
  width: number;
  lastState: number;
  lastPct: number;
}

/** One orthogonally-routed dependency edge, restyled as its ends change state. */
interface ResEdge {
  from: string;
  to: string;
  path: SVGPathElement;
  head: SVGPathElement;
  lastState: number;
}

// ---------------------------------------------------------------------------
// BuildPanel
// ---------------------------------------------------------------------------

/**
 * Production + research command panel for one team.
 *
 * Construction builds the whole DOM under `root`; `update()` only refreshes
 * values. Player intent leaves through the three callbacks in `opts`.
 */
export class BuildPanel implements UiLayer {
  private root: HTMLElement;
  private world: World;
  private team: Team;
  private onBuild: (cls: ShipClass) => void;
  private onResearch: (id: string) => void;
  private onCancel: (index: number) => void;

  private panel: HTMLDivElement;
  private body: HTMLDivElement;
  private econRes: HTMLSpanElement;
  private econSup: HTMLSpanElement;
  private producerName: HTMLDivElement;
  private grid: HTMLDivElement;
  private detailName: HTMLDivElement;
  private detailStats: HTMLDivElement;
  private detailNote: HTMLDivElement;
  private queueRow: HTMLDivElement;
  private queueMore: HTMLDivElement;
  private queueHint: HTMLDivElement;
  private leadRow: HTMLDivElement;
  private leadName: HTMLDivElement;
  private leadEta: HTMLDivElement;
  private leadFill: HTMLDivElement;
  private rally: HTMLDivElement;
  private rallyVal: HTMLDivElement;
  private rallyClr: HTMLButtonElement;
  private resActive: HTMLDivElement;
  private resActiveText: HTMLDivElement;
  private resActiveFill: HTMLDivElement;

  private tiles: Tile[] = [];
  private tileByCls = new Map<ShipClass, Tile>();
  private slots: Slot[] = [];
  private resNodes: ResNode[] = [];
  private resEdges: ResEdge[] = [];

  /** Ship class each tile's cost/time/supply line describes, for the detail box. */
  private hovered: ShipClass = ShipClass.Interceptor;
  private lastDetail = -1;
  private lastDetailBlock = -1;

  /** Which research each ship class waits on. Built once from RESEARCH. */
  private gateOf = new Map<ShipClass, string>();

  /** Cached producer resolution — re-resolved only when the selection moves. */
  private producer: Producer | null = null;
  private lastSelSig = -1;

  // Cached readouts (primitives, compared before every DOM write).
  private lastRes = -1;
  private lastSup = -1;
  private lastCap = -1;
  private lastProducerId = -2;
  private lastQueueLen = -1;
  private lastRallyKey = '';
  private lastActiveId = '';
  private lastActivePct = -1;
  private lastLeadCls = -2; // -2 = never written; -1 = written as "line idle"
  private lastLeadPct = -1;
  private lastLeadEta = -1;

  private acc = 0;
  /** True while the panel is expanded. See refreshCollapse. */
  private isOpen = true;
  /** True once the player has pinned the panel open by clicking the tab. */
  private pinnedOpen = false;
  private disposers: Array<() => void> = [];

  constructor(
    root: HTMLElement,
    world: World,
    opts: {
      team: Team;
      onBuild(cls: ShipClass): void;
      onResearch(id: string): void;
      onCancel(index: number): void;
    },
  ) {
    this.root = root;
    this.world = world;
    this.team = opts.team;
    this.onBuild = opts.onBuild;
    this.onResearch = opts.onResearch;
    this.onCancel = opts.onCancel;

    for (const r of RESEARCH) {
      for (const u of r.unlocks) if (!this.gateOf.has(u)) this.gateOf.set(u, r.id);
    }

    const accent = PALETTES[this.team].uiCss;

    // ---- shell -----------------------------------------------------------
    // [C4] Built on the SHARED panel primitive from style.css: `.sf-panel`
    // paints the hairline + chamfer, `.sf-in` paints the fill. hud.ts builds
    // every one of its panels exactly this way, so the build panel now carries
    // the same corner treatment and the same edge weight as the rest of the
    // HUD instead of inventing its own border.
    this.panel = el('div', 'sf-panel sf-build cut-r', root);
    this.panel.style.setProperty('--sf-accent', accent);
    this.panel.style.setProperty('--sf-font', UI.font);
    this.panel.style.setProperty('--sf-mono', UI.mono);
    this.body = el('div', 'sf-in sf-build-in', this.panel);

    // Collapsed tab. Always present; CSS shows it only in the collapsed state,
    // so toggling costs one class change and never touches layout otherwise.
    const tab = el('button', 'sf-build-tab', this.panel) as HTMLButtonElement;
    tab.type = 'button';
    tab.title = 'Production (select a carrier or mothership, or click to pin)';
    tab.innerHTML = '<span class="sf-build-tab-glyph">&#9635;</span>'
      + '<span class="sf-build-tab-label">PROD</span>';
    const onTab = (): void => {
      this.pinnedOpen = true;
      this.isOpen = true;
      this.panel.classList.remove('is-collapsed');
    };
    tab.addEventListener('click', onTab);
    this.disposers.push(() => tab.removeEventListener('click', onTab));

    // Close control, only meaningful while pinned open with nothing selected.
    const close = el('button', 'sf-build-close', this.panel) as HTMLButtonElement;
    close.type = 'button';
    close.title = 'Collapse production panel';
    close.textContent = '–';
    const onClose = (): void => {
      this.pinnedOpen = false;
      this.isOpen = false;
      this.panel.classList.add('is-collapsed');
    };
    close.addEventListener('click', onClose);
    this.disposers.push(() => close.removeEventListener('click', onClose));

    const head = el('div', 'sf-build-head', this.body);
    const title = el('div', 'sf-build-title', head);
    title.textContent = 'PRODUCTION';
    const econ = el('div', 'sf-build-econ', head);
    this.econRes = el('span', 'sf-econ-res', econ);
    el('span', 'sf-econ-sep', econ).textContent = '·';
    this.econSup = el('span', 'sf-econ-sup', econ);

    this.producerName = el('div', 'sf-build-producer', this.body);

    // ---- build grid ------------------------------------------------------
    this.grid = el('div', 'sf-grid', this.body);
    for (const cls of ALL_SHIP_CLASSES) {
      const spec = SHIP_SPECS[cls];
      if (cls === ShipClass.Mothership) continue; // never produced
      const tileEl = el('div', 'sf-tile', this.grid);
      tileEl.dataset.cls = String(cls);
      tileEl.style.display = 'none';

      const img = el('img', 'sf-tile-icon', tileEl);
      img.src = buildIcon(cls, accent);
      img.alt = spec.name;
      img.draggable = false;

      // [C1] The class code gets its own chamfered backing plate so it is never
      // read *through* the silhouette (the COL tile was unreadable before).
      const tag = el('div', 'sf-tile-tag', tileEl);
      tag.textContent = spec.tag;

      const cost = el('div', 'sf-tile-cost', tileEl);
      cost.textContent = String(spec.cost);

      // [C1] The whole of the old requirement overlay is replaced by this.
      lockGlyph(tileEl);

      const tile: Tile = { cls, root: tileEl, cost, lastBlock: -1, lastShown: false, lastOrder: -1 };
      this.tiles.push(tile);
      this.tileByCls.set(cls, tile);
    }

    const onGridClick = (e: MouseEvent): void => {
      const t = (e.target as HTMLElement).closest('.sf-tile') as HTMLElement | null;
      if (!t || t.classList.contains('is-gated')) return;
      this.onBuild(Number(t.dataset.cls) as ShipClass);
      bus.emit('ack', { kind: 'queued' });
    };
    const onGridOver = (e: MouseEvent): void => {
      const t = (e.target as HTMLElement).closest('.sf-tile') as HTMLElement | null;
      if (!t) return;
      this.hovered = Number(t.dataset.cls) as ShipClass;
    };
    this.grid.addEventListener('click', onGridClick);
    this.grid.addEventListener('mouseover', onGridOver);
    this.disposers.push(() => this.grid.removeEventListener('click', onGridClick));
    this.disposers.push(() => this.grid.removeEventListener('mouseover', onGridOver));

    // ---- detail ----------------------------------------------------------
    // [C1] This is where the requirement text now lives, on hover, at a size
    // you can actually read — instead of stamped over twelve thumbnails.
    const detail = el('div', 'sf-detail', this.body);
    this.detailName = el('div', 'sf-detail-name', detail);
    this.detailStats = el('div', 'sf-detail-stats', detail);
    this.detailNote = el('div', 'sf-detail-note', detail);

    // ---- queue -----------------------------------------------------------
    const qWrap = el('div', 'sf-section', this.body);
    const qHead = el('div', 'sf-section-head', qWrap);
    el('div', 'sf-section-label', qHead).textContent = 'BUILD QUEUE';
    // [C5] The cancel affordance, stated rather than discovered.
    this.queueHint = el('div', 'sf-section-hint', qHead);
    this.queueHint.textContent = '';

    // [C5] Lead-job progress: name, percent, ETA, and a real bar. The arcs are
    // good for queue *order*; they are hopeless for reading "how long".
    this.leadRow = el('div', 'sf-lead', qWrap);
    const leadTop = el('div', 'sf-lead-top', this.leadRow);
    this.leadName = el('div', 'sf-lead-name', leadTop);
    this.leadEta = el('div', 'sf-lead-eta', leadTop);
    const leadBar = el('div', 'sf-lead-bar', this.leadRow);
    this.leadFill = el('div', 'sf-lead-fill', leadBar);

    this.queueRow = el('div', 'sf-queue', qWrap);
    for (let i = 0; i < QUEUE_SLOTS; i++) {
      const slotEl = el('div', 'sf-slot', this.queueRow);
      slotEl.dataset.idx = String(i);
      slotEl.style.display = 'none';
      slotEl.title = 'Cancel this order';

      const s = svg('svg', 'sf-slot-arc', slotEl);
      s.setAttribute('viewBox', '0 0 36 36');
      const track = svg('circle', 'sf-arc-track', s);
      track.setAttribute('cx', '18');
      track.setAttribute('cy', '18');
      track.setAttribute('r', String(ARC_R));
      const arc = svg('circle', 'sf-arc-fill', s);
      arc.setAttribute('cx', '18');
      arc.setAttribute('cy', '18');
      arc.setAttribute('r', String(ARC_R));
      arc.setAttribute('stroke-dasharray', String(ARC_C));
      arc.setAttribute('stroke-dashoffset', String(ARC_C));

      const icon = el('img', 'sf-slot-icon', slotEl);
      icon.draggable = false;
      const label = el('div', 'sf-slot-label', slotEl);

      this.slots.push({ root: slotEl, icon, arc, label, lastCls: -1, lastPct: -1, lastShown: false });
    }
    this.queueMore = el('div', 'sf-queue-more', this.queueRow);
    this.queueMore.style.display = 'none';

    const onQueueClick = (e: MouseEvent): void => {
      const t = (e.target as HTMLElement).closest('.sf-slot') as HTMLElement | null;
      if (!t || t.style.display === 'none') return;
      this.onCancel(Number(t.dataset.idx));
      bus.emit('ack', { kind: 'deny' });
    };
    this.queueRow.addEventListener('click', onQueueClick);
    this.disposers.push(() => this.queueRow.removeEventListener('click', onQueueClick));

    // ---- rally -----------------------------------------------------------
    // [C5] Two rows. The old single row put a 3-axis coordinate, a label and
    // two buttons on one 344 px line, so the coordinate always ellipsised to
    // "17.9k …" — i.e. the control never actually told you where the rally was.
    this.rally = el('div', 'sf-rally', this.body);
    const rallyTop = el('div', 'sf-rally-top', this.rally);
    el('span', 'sf-rally-label', rallyTop).textContent = 'RALLY';
    const rallySpacer = el('span', 'sf-rally-gap', rallyTop);
    rallySpacer.textContent = '';
    const setBtn = el('button', 'sf-btn', rallyTop);
    setBtn.type = 'button';
    setBtn.textContent = 'SET';
    setBtn.title = 'Arm rally placement, then click a point in space';
    const clrBtn = el('button', 'sf-btn', rallyTop);
    clrBtn.type = 'button';
    clrBtn.textContent = 'CLEAR';
    clrBtn.title = 'Clear the rally point — new hulls hold at the hangar';
    this.rallyClr = clrBtn;
    this.rallyVal = el('div', 'sf-rally-val', this.rally);

    const onSet = (): void => {
      if (!this.producer) return;
      // The panel does not own the pointer. It publishes intent; the input
      // layer may listen for this event on `root` and arm placement mode.
      this.root.dispatchEvent(new CustomEvent('sf-rally-request', {
        bubbles: true,
        detail: { shipId: this.producer.shipId, team: this.team },
      }));
      bus.emit('notice', { text: 'RALLY: select a destination', kind: 'info' });
    };
    const onClr = (): void => {
      if (!this.producer) return;
      this.producer.rally = null;
      bus.emit('notice', { text: 'RALLY POINT CLEARED', kind: 'info' });
    };
    setBtn.addEventListener('click', onSet);
    clrBtn.addEventListener('click', onClr);
    this.disposers.push(() => setBtn.removeEventListener('click', onSet));
    this.disposers.push(() => clrBtn.removeEventListener('click', onClr));

    // ---- research --------------------------------------------------------
    //
    // COLLAPSIBLE, and collapsed by default. The tree is the last section in a
    // bottom-anchored column, so it sat below the grid, the lead item, the
    // queue and the rally controls — "tech tree GUI is super below and when
    // build queue is there I can scroll down". Stacking a tall graph under four
    // other sections inside a capped panel means it is the thing that gets
    // pushed out of reach, every time. It is also the section a player opens
    // occasionally rather than watches, which is exactly the section that
    // should be behind a toggle.
    const resWrap = el('div', 'sf-section sf-research is-closed', this.body);
    const resHead = el('button', 'sf-res-head', resWrap) as HTMLButtonElement;
    resHead.type = 'button';
    el('span', 'sf-section-label', resHead).textContent = 'RESEARCH';
    const caret = el('span', 'sf-res-caret', resHead);
    caret.textContent = '▸';
    this.resActive = el('div', 'sf-res-active', resWrap);
    this.resActiveText = el('div', 'sf-res-active-text', this.resActive);
    const resBar = el('div', 'sf-res-active-bar', this.resActive);
    this.resActiveFill = el('div', 'sf-res-active-fill', resBar);
    const scroll = el('div', 'sf-res-scroll', resWrap);
    this.buildResearchGraph(scroll);

    const onResToggle = (): void => {
      const closed = resWrap.classList.toggle('is-closed');
      caret.textContent = closed ? '▸' : '▾';
      // Opening scrolls the tree into view, so the section the player just
      // asked for is not opened somewhere below the fold.
      if (!closed) resWrap.scrollIntoView({ block: 'nearest' });
    };
    resHead.addEventListener('click', onResToggle);
    this.disposers.push(() => resHead.removeEventListener('click', onResToggle));
  }

  // -------------------------------------------------------------------------
  // Research graph  [C2]
  // -------------------------------------------------------------------------

  /**
   * Lay the research list out as a layered DAG that flows DOWNWARD: rank =
   * dependency depth, column = barycentric order within that rank.
   *
   * Downward rather than rightward because the panel is a tall narrow column:
   * a left-to-right tree with four depth levels has to scale to ~55% to fit,
   * which drops the labels below 5 px and makes the whole thing decorative.
   *
   * THREE THINGS THE OLD LAYOUT GOT WRONG (critique: "the research DAG is
   * illegible ... every dependency is a free bezier between node centres"):
   *
   *  1. ORDER. Nodes were placed in `RESEARCH` declaration order inside each
   *     rank, so `capships -> shields` had to cross `guidance` to get there.
   *     Now each rank is sorted by the mean column of its prerequisites, which
   *     for this graph removes every crossing outright.
   *
   *  2. ROUTING. A cubic bezier between two centres travels diagonally through
   *     whatever happens to be in the way. Every edge is now three straight
   *     runs — down out of the source, across a RESERVED horizontal lane in the
   *     row gutter, down into the target — with 5 u rounded corners. Gutter
   *     raised from 16 to 30 u so the lanes have somewhere to live.
   *
   *  3. DIRECTION. There were no arrowheads at all, so nothing said which way a
   *     dependency pointed. Every edge now lands in a chevron.
   *
   * Each edge gets its own lane offset inside its gutter, longest span nearest
   * the source, so parallel runs never sit on top of each other.
   */
  private buildResearchGraph(parent: HTMLElement): void {
    const NODE_W = 92;
    const NODE_H = 34;
    const COL_GAP = 10;
    const ROW_GAP = 30;

    // --- rank by dependency depth -----------------------------------------
    const depth = new Map<string, number>();
    const depthOf = (id: string): number => {
      const cached = depth.get(id);
      if (cached !== undefined) return cached;
      const r = RESEARCH_BY_ID.get(id);
      if (!r) return 0;
      depth.set(id, 0); // cycle guard
      let d = 0;
      for (const req of r.requires) d = Math.max(d, depthOf(req) + 1);
      depth.set(id, d);
      return d;
    };

    const ranks: string[][] = [];
    for (const r of RESEARCH) {
      const d = depthOf(r.id);
      (ranks[d] ??= []).push(r.id);
    }
    for (let i = 0; i < ranks.length; i++) ranks[i] ??= [];

    // --- barycentric column order (one downward sweep; the graph is shallow) -
    const col = new Map<string, number>();
    for (let i = 0; i < ranks[0].length; i++) col.set(ranks[0][i], i);
    const bary = new Map<string, number>();
    for (let d = 1; d < ranks.length; d++) {
      const band = ranks[d];
      for (const id of band) {
        const reqs = RESEARCH_BY_ID.get(id)!.requires;
        let sum = 0;
        let n = 0;
        for (const q of reqs) {
          const c = col.get(q);
          if (c !== undefined) { sum += c; n++; }
        }
        bary.set(id, n > 0 ? sum / n : 1e6);
      }
      band.sort((a, b) => bary.get(a)! - bary.get(b)!);
      for (let i = 0; i < band.length; i++) col.set(band[i], i);
    }

    let maxCols = 0;
    for (const band of ranks) maxCols = Math.max(maxCols, band.length);
    const fullW = maxCols * (NODE_W + COL_GAP) - COL_GAP;

    // Centre each rank so a lone capstone sits under the tree, not at the margin.
    const xs = new Map<string, number>();
    const ys = new Map<string, number>();
    for (let d = 0; d < ranks.length; d++) {
      const band = ranks[d];
      const bandW = band.length * (NODE_W + COL_GAP) - COL_GAP;
      const off = (fullW - bandW) * 0.5;
      for (let i = 0; i < band.length; i++) {
        xs.set(band[i], off + i * (NODE_W + COL_GAP));
        ys.set(band[i], d * (NODE_H + ROW_GAP));
      }
    }

    const rows = ranks.length;
    const w = fullW;
    const h = rows * (NODE_H + ROW_GAP) - ROW_GAP;

    const s = svg('svg', 'sf-res-svg', parent);
    s.setAttribute('viewBox', `-3 -3 ${w + 6} ${h + 6}`);
    s.setAttribute('preserveAspectRatio', 'xMidYMin meet');

    // --- gather edges and bucket them by the gutter they run in ------------
    interface Pending { from: string; to: string; x0: number; y0: number; x1: number; y1: number }
    const gutters: Pending[][] = [];
    for (const r of RESEARCH) {
      const x1 = xs.get(r.id)! + NODE_W * 0.5;
      const y1 = ys.get(r.id)!;
      const d = depthOf(r.id);
      for (const req of r.requires) {
        const x0 = (xs.get(req) ?? 0) + NODE_W * 0.5;
        const y0 = (ys.get(req) ?? 0) + NODE_H;
        (gutters[d] ??= []).push({ from: req, to: r.id, x0, y0, x1, y1 });
      }
    }

    const edgeG = svg('g', 'sf-res-edges', s); // edges first, nodes paint over
    for (let d = 0; d < gutters.length; d++) {
      const bucket = gutters[d];
      if (!bucket) continue;
      // Longest horizontal run takes the lane nearest the source row, so short
      // hops never have to step over a long one.
      bucket.sort((a, b) => Math.abs(b.x1 - b.x0) - Math.abs(a.x1 - a.x0));
      const gutterBot = d * (NODE_H + ROW_GAP);
      const gutterTop = gutterBot - ROW_GAP;
      const n = bucket.length;
      for (let i = 0; i < n; i++) {
        const e = bucket[i];
        const lane = gutterTop + ((i + 1) / (n + 1)) * ROW_GAP;
        const dx = e.x1 - e.x0;
        const sgn = dx >= 0 ? 1 : -1;
        const r = Math.min(5, Math.abs(dx) * 0.5, ROW_GAP * 0.3);

        let dAttr: string;
        if (Math.abs(dx) < 1.0) {
          // Straight drop — no lane needed, and an elbow here would be noise.
          dAttr = `M ${e.x0} ${e.y0} L ${e.x1} ${e.y1}`;
        } else {
          dAttr =
            `M ${e.x0} ${e.y0}` +
            ` L ${e.x0} ${(lane - r).toFixed(2)}` +
            ` Q ${e.x0} ${lane} ${(e.x0 + sgn * r).toFixed(2)} ${lane}` +
            ` L ${(e.x1 - sgn * r).toFixed(2)} ${lane}` +
            ` Q ${e.x1} ${lane} ${e.x1} ${(lane + r).toFixed(2)}` +
            ` L ${e.x1} ${e.y1}`;
        }
        const p = svg('path', 'sf-res-edge', edgeG);
        p.setAttribute('d', dAttr);
        p.dataset.from = e.from;
        p.dataset.to = e.to;

        // Chevron head — states the direction the bezier never did.
        const head = svg('path', 'sf-res-head', edgeG);
        head.setAttribute(
          'd',
          `M ${(e.x1 - 3.2).toFixed(2)} ${(e.y1 - 4.6).toFixed(2)}` +
          ` L ${e.x1} ${e.y1}` +
          ` L ${(e.x1 + 3.2).toFixed(2)} ${(e.y1 - 4.6).toFixed(2)}`,
        );

        this.resEdges.push({ from: e.from, to: e.to, path: p, head, lastState: -1 });
      }
    }

    // --- nodes -------------------------------------------------------------
    for (const r of RESEARCH) {
      const g = svg('g', 'sf-res-node', s);
      g.dataset.id = r.id;
      g.setAttribute('transform', `translate(${xs.get(r.id)} ${ys.get(r.id)})`);

      const box = svg('rect', 'sf-res-box', g);
      box.setAttribute('width', String(NODE_W));
      box.setAttribute('height', String(NODE_H));

      const fill = svg('rect', 'sf-res-fill', g);
      fill.setAttribute('x', '1');
      fill.setAttribute('y', '1');
      fill.setAttribute('height', String(NODE_H - 2));
      fill.setAttribute('width', '0');

      // Marching-ants ring, visible only on the active project. One extra rect
      // per node and a pure-CSS animation, so it costs nothing per frame.
      const ring = svg('rect', 'sf-res-ring', g);
      ring.setAttribute('x', '-2');
      ring.setAttribute('y', '-2');
      ring.setAttribute('width', String(NODE_W + 4));
      ring.setAttribute('height', String(NODE_H + 4));

      // Two lines: name above, cost + time below. Stacking them lets the name
      // use the full node width instead of fighting the cost for horizontal room.
      const label = svg('text', 'sf-res-text', g);
      label.setAttribute('x', '6');
      label.setAttribute('y', '14');
      const short = shortName(r.name);
      label.textContent = short;
      // A 15-character short-name overruns the node at 11 u in Rajdhani (and
      // the fallback faces are wider still), which is how "GUIDED ORDNANCE"
      // ended up printed across its neighbour. `textLength` pins the run to the
      // box instead of trusting the metrics of whatever font actually loaded.
      if (short.length >= 14) {
        label.setAttribute('textLength', String(NODE_W - 12));
        label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }

      const cost = svg('text', 'sf-res-cost', g);
      cost.setAttribute('x', '6');
      cost.setAttribute('y', '26');
      cost.textContent = `${r.cost} RU · ${r.time}s`;

      // NB: no separate "done" glyph — a completed node is already a solid
      // green plate with green type, and a tick at this width would collide
      // with the longest short-name ("STRIKE CRAFT D.").
      const tip = svg('title', undefined, g);
      tip.textContent = `${r.name} — ${r.desc} (${r.cost} RU, ${r.time}s)`;

      this.resNodes.push({ spec: r, group: g, fill, width: NODE_W - 2, lastState: -1, lastPct: -1 });
    }

    const onClick = (e: MouseEvent): void => {
      const n = (e.target as Element).closest('.sf-res-node') as SVGGElement | null;
      if (!n || !n.dataset.id) return;
      if (n.classList.contains('is-locked') || n.classList.contains('is-done')) return;
      this.onResearch(n.dataset.id);
      bus.emit('ack', { kind: 'research' });
    };
    s.addEventListener('click', onClick);
    this.disposers.push(() => s.removeEventListener('click', onClick));
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(world: World, camera: Camera, dt: number): void {
    void camera;
    this.resolveProducer(world);
    this.refreshQueueProgress();

    this.acc += dt;
    if (this.acc < 1 / REFRESH_HZ) return;
    this.acc = 0;

    this.refreshCollapse(world);

    this.refreshEconomy(world);
    this.refreshProducer(world);
    this.refreshGrid(world);
    this.refreshDetail(world);
    this.refreshQueueStructure();
    this.refreshRally();
    this.refreshResearch(world);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.panel.remove();
  }

  // -------------------------------------------------------------------------
  // Refresh passes
  // -------------------------------------------------------------------------

  /**
   * Collapse the panel to a tab unless the player is actually looking at a
   * production hull.
   *
   * The panel is large and bottom-left anchored, so leaving it open permanently
   * costs a serious slice of the play area (and used to swallow right-clicks) to
   * show controls that are irrelevant while a wing of interceptors is selected.
   * It expands when a hull that owns a build queue is in the selection, and
   * otherwise sits as a labelled tab that can be clicked to pin it open.
   *
   * The pin is sticky: once the player opens it by hand it stays open until they
   * close it again, so this never fights someone who wants it visible.
   */
  private refreshCollapse(world: World): void {
    let hasProducer = false;
    for (const id of world.selection) {
      if (world.producers.has(id)) { hasProducer = true; break; }
    }
    const open = hasProducer || this.pinnedOpen;
    if (open === this.isOpen) return;
    this.isOpen = open;
    this.panel.classList.toggle('is-collapsed', !open);
  }

  /**
   * Pick the producer whose queue the panel drives: the first selected hull that
   * owns a queue, else the team mothership, else any owned producer. Re-resolved
   * only when the selection changes or the cached producer dies, so the hot path
   * never iterates the producer map.
   */
  private resolveProducer(world: World): void {
    const sel = world.selection;
    let sig = sel.length * 0x9e3779b1;
    for (let i = 0; i < sel.length; i++) sig = (sig ^ Math.imul(sel[i] + 1, 0x85ebca6b)) | 0;
    const stale = this.producer !== null && !world.producers.has(this.producer.shipId);
    if (sig === this.lastSelSig && !stale) return;
    this.lastSelSig = sig;

    for (let i = 0; i < sel.length; i++) {
      const p = world.producers.get(sel[i]);
      if (!p) continue;
      const s = world.ship(p.shipId);
      if (s && s.team === this.team) { this.producer = p; return; }
    }
    const mid = world.motherships[this.team];
    if (mid >= 0) {
      const p = world.producers.get(mid);
      if (p) { this.producer = p; return; }
    }
    this.producer = null;
    world.producers.forEach((p) => {
      if (this.producer) return;
      const s = world.ship(p.shipId);
      if (s && s.team === this.team) this.producer = p;
    });
  }

  private refreshEconomy(world: World): void {
    const f = world.factions[this.team];
    const res = f.resources | 0;
    if (res !== this.lastRes) {
      this.lastRes = res;
      this.econRes.textContent = `${res} RU`;
    }
    const sup = f.supply | 0;
    const cap = f.supplyCap | 0;
    if (sup !== this.lastSup || cap !== this.lastCap) {
      this.lastSup = sup;
      this.lastCap = cap;
      this.econSup.textContent = `${sup}/${cap} SUP`;
      this.econSup.style.color = sup >= cap ? UI.bad : sup > cap * 0.85 ? UI.warn : '';
    }
  }

  private refreshProducer(world: World): void {
    const p = this.producer;
    const id = p ? p.shipId : -1;
    if (id === this.lastProducerId) return;
    this.lastProducerId = id;
    const s = p ? world.ship(p.shipId) : undefined;
    if (!s) {
      this.producerName.textContent = 'NO PRODUCTION FACILITY';
      this.panel.classList.add('is-idle');
    } else {
      this.producerName.textContent = SHIP_SPECS[s.cls].name.toUpperCase();
      this.panel.classList.remove('is-idle');
    }
    // Tile visibility follows the producer's build list.
    const builds = s ? SHIP_SPECS[s.cls].builds : null;
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      const order = builds ? builds.indexOf(t.cls) : -1;
      const shown = order >= 0;
      if (shown !== t.lastShown) {
        t.lastShown = shown;
        t.root.style.display = shown ? '' : 'none';
      }
      if (shown && order !== t.lastOrder) {
        t.lastOrder = order;
        t.root.style.order = String(order);
      }
    }
  }

  /** Why can this team not build `cls` right now? */
  private blockOf(world: World, cls: ShipClass): Block {
    const f = world.factions[this.team];
    const spec = SHIP_SPECS[cls];
    const gate = this.gateOf.get(cls);
    const startable = STARTING_UNLOCKS.indexOf(cls) >= 0;
    if (!startable && gate !== undefined && !f.research.has(gate)) return Block.Research;
    if (this.producer && this.producer.queue.length >= QUEUE_LIMIT) return Block.QueueFull;
    if (f.resources < spec.cost) return Block.Resources;
    if (f.supply + spec.supply > f.supplyCap) return Block.Supply;
    return Block.None;
  }

  /**
   * Long-form reason, for the inspector line and the tile tooltip. [C1]
   *
   * Deliberately verbose: it is read one at a time in a 300 px box, not twelve
   * at once inside 62 px tiles, so it can spell the prerequisite out in full.
   */
  private reasonText(block: Block, cls: ShipClass): string {
    switch (block) {
      case Block.Research: {
        const gate = this.gateOf.get(cls);
        const r = gate ? RESEARCH_BY_ID.get(gate) : undefined;
        return r ? `LOCKED · REQUIRES ${r.name.toUpperCase()}` : 'LOCKED';
      }
      case Block.Resources: return 'INSUFFICIENT RESOURCES';
      case Block.Supply: return 'SUPPLY CAP REACHED';
      case Block.QueueFull: return 'BUILD QUEUE FULL';
      default: return '';
    }
  }

  private refreshGrid(world: World): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (!t.lastShown) continue;
      const block = this.blockOf(world, t.cls);
      if (block === t.lastBlock) continue;
      t.lastBlock = block;
      // [C1] TWO states, not one mush:
      //   is-gated  — hard research lock. Silhouette dimmed + hatched, lock
      //               badge lit, cost suppressed (it is not the reason).
      //   is-short  — soft block (money / supply / queue). Tile stays at FULL
      //               strength; only the cost figure goes amber.
      const gated = block === Block.Research;
      t.root.classList.toggle('is-gated', gated);
      t.root.classList.toggle('is-short', !gated && block !== Block.None);
      const spec = SHIP_SPECS[t.cls];
      t.root.title = block === Block.None
        ? `${spec.name.toUpperCase()} — ${spec.cost} RU`
        : `${spec.name.toUpperCase()} — ${this.reasonText(block, t.cls)}`;
    }
  }

  private refreshDetail(world: World): void {
    const cls = this.hovered;
    const tile = this.tileByCls.get(cls);
    const block = tile && tile.lastShown ? tile.lastBlock : this.blockOf(world, cls);
    if (cls === this.lastDetail && block === this.lastDetailBlock) return;
    this.lastDetail = cls;
    this.lastDetailBlock = block;

    const spec = SHIP_SPECS[cls];
    this.detailName.textContent = spec.name.toUpperCase();
    this.detailStats.textContent =
      `${spec.cost} RU   ·   ${spec.buildTime}s   ·   ${spec.supply} SUP   ·   ${spec.maxHp} HP`;
    const note = this.reasonText(block as Block, cls);
    this.detailNote.textContent = note || describeRole(spec);
    this.detailNote.classList.toggle('is-bad', !!note);
  }

  /**
   * Structural queue refresh — which slots exist and what class they hold.
   * Compares per slot rather than trusting the queue length, because a job can
   * complete and another be enqueued inside one refresh window.
   */
  private refreshQueueStructure(): void {
    const q = this.producer ? this.producer.queue : null;
    const len = q ? q.length : 0;
    for (let i = 0; i < QUEUE_SLOTS; i++) {
      const slot = this.slots[i];
      const shown = q !== null && i < len;
      if (shown !== slot.lastShown) {
        slot.lastShown = shown;
        slot.root.style.display = shown ? '' : 'none';
      }
      if (!shown) continue;
      const job = q![i];
      if (job.cls !== slot.lastCls) {
        slot.lastCls = job.cls;
        slot.lastPct = -1; // force the arc to re-sync to the new job
        slot.icon.src = buildIcon(job.cls, PALETTES[this.team].uiCss);
        slot.label.textContent = SHIP_SPECS[job.cls].tag;
        slot.root.title = `CANCEL ${SHIP_SPECS[job.cls].name.toUpperCase()}`;
      }
    }
    if (len === this.lastQueueLen) return;
    this.lastQueueLen = len;
    const extra = len - QUEUE_SLOTS;
    this.queueMore.style.display = extra > 0 ? '' : 'none';
    if (extra > 0) this.queueMore.textContent = `+${extra}`;
    this.queueRow.classList.toggle('is-empty', len === 0);
    this.leadRow.classList.toggle('is-idle', len === 0);
    // [C5] Only advertise the cancel affordance when there is something to cancel.
    this.queueHint.textContent = len > 0 ? 'CLICK TO CANCEL' : '';
  }

  /**
   * Per-frame progress. Three attribute writes per visible slot at most, plus
   * the lead bar, and every one of them is gated on an integer changing — so a
   * steady frame does zero DOM work and allocates nothing. [C5]
   */
  private refreshQueueProgress(): void {
    const q = this.producer ? this.producer.queue : null;
    if (!q) return;
    const n = Math.min(q.length, QUEUE_SLOTS);
    for (let i = 0; i < n; i++) {
      const slot = this.slots[i];
      const job = q[i];
      const pct = job.total > 0 ? Math.round((1 - job.remaining / job.total) * 100) : 0;
      if (pct === slot.lastPct) continue;
      slot.lastPct = pct;
      slot.arc.setAttribute('stroke-dashoffset', String(ARC_C * (1 - pct / 100)));
    }

    if (q.length === 0) {
      if (this.lastLeadCls !== -1) {
        this.lastLeadCls = -1;
        this.lastLeadPct = -1;
        this.lastLeadEta = -1;
        this.leadName.textContent = 'LINE IDLE';
        this.leadEta.textContent = '';
        this.leadFill.style.width = '0%';
      }
      return;
    }
    const job = q[0];
    const pct = job.total > 0 ? Math.round((1 - job.remaining / job.total) * 100) : 0;
    const eta = Math.ceil(job.remaining);
    if (job.cls !== this.lastLeadCls) {
      this.lastLeadCls = job.cls;
      this.leadName.textContent = SHIP_SPECS[job.cls].name.toUpperCase();
    }
    if (pct !== this.lastLeadPct) {
      this.lastLeadPct = pct;
      this.leadFill.style.width = pct + '%';
    }
    if (eta !== this.lastLeadEta) {
      this.lastLeadEta = eta;
      this.leadEta.textContent = `${pct}%  ·  ${eta}s`;
    }
  }

  private refreshRally(): void {
    const p = this.producer;
    const r = p ? p.rally : null;
    const key = r ? `${r.x | 0}:${r.y | 0}:${r.z | 0}` : p ? 'hold' : 'none';
    if (key === this.lastRallyKey) return;
    this.lastRallyKey = key;
    this.rally.classList.toggle('is-set', !!r);
    this.rallyClr.disabled = !r;
    if (!p) this.rallyVal.textContent = 'NO FACILITY';
    else if (!r) this.rallyVal.textContent = 'HOLD AT HANGAR';
    else {
      this.rallyVal.textContent =
        `X ${(r.x / 1000).toFixed(1)}k   Y ${(r.y / 1000).toFixed(1)}k   Z ${(r.z / 1000).toFixed(1)}k`;
    }
  }

  private refreshResearch(world: World): void {
    const f = world.factions[this.team];
    const active = f.researching;

    // Header line for the project in progress. [C2] "make the active project
    // unmistakable" — it now has a name, a percent, an ETA and a real bar, and
    // the node itself carries a marching-ants ring.
    const aid = active ? active.id : '';
    const apct = active && active.total > 0
      ? Math.round((1 - active.remaining / active.total) * 100)
      : -1;
    if (aid !== this.lastActiveId || apct !== this.lastActivePct) {
      this.lastActiveId = aid;
      this.lastActivePct = apct;
      if (!active) {
        this.resActiveText.textContent = 'NO ACTIVE PROJECT';
        this.resActive.classList.remove('is-active');
        this.resActiveFill.style.width = '0%';
      } else {
        const r = RESEARCH_BY_ID.get(active.id);
        this.resActiveText.textContent =
          `${(r ? r.name : active.id).toUpperCase()}   ${apct}%  ·  ${Math.ceil(active.remaining)}s`;
        this.resActive.classList.add('is-active');
        this.resActiveFill.style.width = Math.max(apct, 0) + '%';
      }
    }

    for (let i = 0; i < this.resNodes.length; i++) {
      const n = this.resNodes[i];
      const id = n.spec.id;
      const done = f.research.has(id);
      let ready = true;
      for (let k = 0; k < n.spec.requires.length; k++) {
        if (!f.research.has(n.spec.requires[k])) { ready = false; break; }
      }
      const isActive = active !== null && active.id === id;
      // 0 locked, 1 available, 2 unaffordable-but-available, 3 active, 4 done
      const state = done ? 4
        : isActive ? 3
          : !ready ? 0
            : f.resources < n.spec.cost ? 2 : 1;

      if (state !== n.lastState) {
        n.lastState = state;
        const g = n.group;
        g.classList.toggle('is-done', state === 4);
        g.classList.toggle('is-active', state === 3);
        g.classList.toggle('is-locked', state === 0);
        g.classList.toggle('is-poor', state === 2);
        if (state === 4) n.fill.setAttribute('width', String(n.width));
      }
      const pct = state === 3 && active && active.total > 0
        ? (1 - active.remaining / active.total)
        : state === 4 ? 1 : 0;
      const q = Math.round(pct * 100);
      if (q !== n.lastPct) {
        n.lastPct = q;
        n.fill.setAttribute('width', String(n.width * pct));
      }
    }

    // Edge state follows its endpoints: a satisfied dependency is a live wire.
    for (let i = 0; i < this.resEdges.length; i++) {
      const e = this.resEdges[i];
      const srcDone = f.research.has(e.from);
      const dstDone = f.research.has(e.to);
      const state = srcDone && dstDone ? 2 : srcDone ? 1 : 0;
      if (state === e.lastState) continue;
      e.lastState = state;
      const cls = state === 2 ? 'sf-res-edge is-done'
        : state === 1 ? 'sf-res-edge is-live'
          : 'sf-res-edge';
      e.path.setAttribute('class', cls);
      e.head.setAttribute('class', cls.replace('sf-res-edge', 'sf-res-head'));
    }
  }
}

// ---------------------------------------------------------------------------

/** One-line role blurb, derived from the spec so it never goes stale. */
function describeRole(spec: ShipSpec): string {
  if (spec.harvest) return 'RESOURCE COLLECTION';
  if (spec.builds.length > 0) return `PRODUCTION · HANGAR ${spec.hangar}`;
  if (spec.weapons.length === 0) return 'SUPPORT';
  const w = spec.weapons[0];
  const best = pickBestTarget(spec);
  return `${w.kind.toUpperCase()} · ${Math.round(w.range)} m · BEST VS ${best}`;
}

/** Which hull band the primary weapon's damage table favours. */
function pickBestTarget(spec: ShipSpec): string {
  const names = ['FIGHTERS', 'CORVETTES', 'FRIGATES', 'CAPITALS', 'SUPERCAPS', 'UTILITY'];
  const vs = spec.weapons[0].vs;
  if (!vs) return 'ALL HULLS';
  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < names.length; i++) {
    const v = vs[i as HullSize] ?? 1;
    if (v > bestVal) { bestVal = v; bestIdx = i; }
  }
  return names[bestIdx];
}
