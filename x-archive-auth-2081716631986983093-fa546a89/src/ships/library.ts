/**
 * SHIP GEOMETRY LIBRARY — the single owner of every hull BufferGeometry.
 *
 * WHAT: builds and caches `variantCount(cls)` distinct hulls per ship class per
 * LOD level, keyed deterministically off the seed stream handed to the ctor.
 *
 * WHY: a fleet of 300 interceptors that are byte-identical clones reads as a
 * particle system, not a navy. Three hull variants per class — different
 * greeble placement, plate splits, antenna clusters — is enough to kill the
 * clone read at gameplay distances while keeping the draw-call count sane
 * (one instanced draw per class/LOD/variant bucket).
 *
 * The library never touches materials, never adds anything to a scene and never
 * mutates the world. It is pure asset storage: build once, hand out references,
 * dispose at teardown.
 *
 * DETERMINISM: every variant gets a 32-bit seed drawn up-front from the ctor
 * Rng, in a fixed class/variant order, so lazy on-demand building and full
 * preloading produce byte-identical geometry. Each LOD of a given variant is
 * built from a *fresh* Rng on that same seed, so LOD0/1/2 of one variant agree
 * on the coarse design decisions the builder makes first (proportions, engine
 * layout, spine style) and only diverge in the detail passes.
 */

import * as THREE from 'three';
import { Rng } from '../core/rng';
import { SHIP_SPECS } from '../core/registry';
import { ALL_SHIP_CLASSES, HullSize, SHIP_CLASS_COUNT, ShipClass } from '../core/types';
import { buildStrikecraft } from './strikecraft';
import { buildCapital } from './capitals';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of distinct hulls generated per class per LOD. */
export const VARIANTS_PER_CLASS = 3;

/** Number of LOD levels every hull is built at (hero / mid / far). */
export const LOD_COUNT = 3;

/**
 * Upper bound on variants for any class — the fleet renderer sizes its bucket
 * table with this, so it must stay >= every value `variantCount` can return.
 */
export const MAX_VARIANTS = VARIANTS_PER_CLASS;

/**
 * Hero hulls that only ever exist once or twice on the battlefield. Building
 * three 70k-triangle motherships would triple the loading screen for variety
 * nobody can ever see (there is exactly one mothership per team, and the two
 * teams are told apart by paint, not by silhouette).
 */
const VARIANT_OVERRIDE: Partial<Record<ShipClass, number>> = {
  [ShipClass.Mothership]: 1,
  [ShipClass.Carrier]: 2,
  [ShipClass.ResourceRefinery]: 2,
};

/**
 * Which builder owns a class.
 *
 * Frigate/Capital/SuperCapital hulls go to `buildCapital` (slab hulls, spinal
 * mounts, hangar mouths, radiator banks). Everything smaller — including the
 * Utility-sized Ladle collector, which is corvette-scale at 56 m — goes to
 * `buildStrikecraft`.
 */
export function usesCapitalBuilder(cls: ShipClass): boolean {
  const size = SHIP_SPECS[cls].size;
  return size === HullSize.Frigate || size === HullSize.Capital || size === HullSize.SuperCapital;
}

// ---------------------------------------------------------------------------
// Yield helper
// ---------------------------------------------------------------------------

/**
 * Hand control back to the browser long enough for it to actually paint.
 *
 * A bare `await Promise.resolve()` only drains the microtask queue — the frame
 * never composites and the loading bar stays frozen. rAF-then-timeout
 * guarantees we resume *after* a real paint. Falls back to a timeout in
 * non-DOM contexts (tests, workers).
 */
function yieldToPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// ---------------------------------------------------------------------------
// ShipLibrary
// ---------------------------------------------------------------------------

/**
 * Cache of every ship hull geometry in the game, indexed by (class, LOD, variant).
 *
 * Geometry is built lazily on first request so a scenario that never spawns a
 * heavy cruiser never pays for one; `preload` front-loads the whole set behind
 * a progress callback for the loading screen.
 */
export class ShipLibrary {
  /** Flat cache, indexed by `key(cls, lod, variant)`. */
  private readonly geos: (THREE.BufferGeometry | null)[];
  /** Per (class, variant) generation seed. Drawn up-front for determinism. */
  private readonly seeds: Int32Array;
  /** Per-class variant count, resolved once. */
  private readonly counts: Uint8Array;
  /** In-flight preload, so a double call cannot build anything twice. */
  private preloading: Promise<void> | null = null;
  private disposed = false;

  constructor(rng: Rng) {
    const slots = SHIP_CLASS_COUNT * LOD_COUNT * MAX_VARIANTS;
    this.geos = new Array<THREE.BufferGeometry | null>(slots).fill(null);
    this.seeds = new Int32Array(SHIP_CLASS_COUNT * MAX_VARIANTS);
    this.counts = new Uint8Array(SHIP_CLASS_COUNT);

    // Fixed draw order: class index ascending, variant ascending. Never make
    // this order depend on what has been requested.
    for (const cls of ALL_SHIP_CLASSES) {
      const n = VARIANT_OVERRIDE[cls] ?? VARIANTS_PER_CLASS;
      this.counts[cls] = n;
      for (let v = 0; v < MAX_VARIANTS; v++) {
        // Draw for every slot even when unused, so changing VARIANT_OVERRIDE
        // does not reshuffle the seeds of unrelated classes.
        this.seeds[cls * MAX_VARIANTS + v] = rng.int(0, 0x7fffffff);
      }
    }
  }

  // -- queries -------------------------------------------------------------

  /** Number of distinct hulls generated for `cls`. Always >= 1. */
  variantCount(cls: ShipClass): number {
    return this.counts[cls];
  }

  /**
   * Geometry for one (class, LOD, variant). Built on demand and cached
   * forever; the caller must NOT dispose the result — the library owns it.
   *
   * `variant` is taken modulo the class's variant count so callers can hash a
   * ship seed straight into this without bounds-checking.
   */
  geometry(cls: ShipClass, lod: 0 | 1 | 2, variant: number): THREE.BufferGeometry {
    const n = this.counts[cls];
    let v = variant % n;
    if (v < 0) v += n;
    const k = key(cls, lod, v);
    const cached = this.geos[k];
    if (cached) return cached;
    const geo = this.build(cls, lod, v);
    this.geos[k] = geo;
    return geo;
  }

  /** Total number of geometries a full `preload` will build. */
  totalBuilds(): number {
    let total = 0;
    for (const cls of ALL_SHIP_CLASSES) total += this.counts[cls] * LOD_COUNT;
    return total;
  }

  // -- preload -------------------------------------------------------------

  /**
   * Build every hull up-front, yielding to the browser between hulls so the
   * loading screen animates. Safe to call twice — the second call awaits the
   * first rather than rebuilding.
   *
   * `onProgress(done, total, label)` fires BEFORE each hull is built, so the
   * label describes the work about to happen (the bar reads as responsive
   * rather than lagging one item behind).
   */
  preload(onProgress: (done: number, total: number, label: string) => void): Promise<void> {
    if (this.preloading) return this.preloading;
    this.preloading = this.runPreload(onProgress);
    return this.preloading;
  }

  private async runPreload(
    onProgress: (done: number, total: number, label: string) => void,
  ): Promise<void> {
    const total = this.totalBuilds();
    let done = 0;

    // Cheap hulls first: the player sees the bar move immediately and the
    // multi-second capital builds land at the end where a stall is expected.
    const order = ALL_SHIP_CLASSES.slice().sort(
      (a, b) => SHIP_SPECS[a].length - SHIP_SPECS[b].length,
    );

    for (const cls of order) {
      const spec = SHIP_SPECS[cls];
      const n = this.counts[cls];
      for (let v = 0; v < n; v++) {
        for (let l = 0; l < LOD_COUNT; l++) {
          const lod = l as 0 | 1 | 2;
          if (this.disposed) return;
          const label = n > 1
            ? `${spec.name}  LOD${lod}  v${v + 1}`
            : `${spec.name}  LOD${lod}`;
          onProgress(done, total, label);
          // Let the bar repaint before the (potentially long) build.
          await yieldToPaint();
          if (this.disposed) return;
          const k = key(cls, lod, v);
          if (!this.geos[k]) this.geos[k] = this.build(cls, lod, v);
          done++;
        }
      }
    }
    onProgress(total, total, 'fleet ready');
  }

  // -- build ---------------------------------------------------------------

  private build(cls: ShipClass, lod: 0 | 1 | 2, variant: number): THREE.BufferGeometry {
    // Fresh Rng on the variant seed for every LOD: the builder's first draws
    // (proportions, engine count, spine style) therefore match across LODs, so
    // LOD2 reads as the same ship as LOD0.
    const rng = new Rng(this.seeds[cls * MAX_VARIANTS + variant] >>> 0);
    const geo = usesCapitalBuilder(cls)
      ? buildCapital(cls, lod, rng)
      : buildStrikecraft(cls, lod, rng);

    // Contract insurance: the fleet renderer disables per-object frustum
    // culling, but shadow-map and debug paths still read the bounding sphere.
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    geo.name = `${SHIP_SPECS[cls].tag}_L${lod}_v${variant}`;
    return geo;
  }

  // -- teardown ------------------------------------------------------------

  /** Dispose every cached geometry. The library is unusable afterwards. */
  dispose(): void {
    this.disposed = true;
    this.preloading = null;
    for (let i = 0; i < this.geos.length; i++) {
      const g = this.geos[i];
      if (g) g.dispose();
      this.geos[i] = null;
    }
  }
}

/** Flat cache index. Kept module-local so the layout can change freely. */
function key(cls: ShipClass, lod: number, variant: number): number {
  return (cls * LOD_COUNT + lod) * MAX_VARIANTS + variant;
}
