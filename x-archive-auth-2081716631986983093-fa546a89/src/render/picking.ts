/**
 * SHIP PICKING — ray tests against hull GEOMETRY rather than bounding spheres.
 *
 * WHY: the fleet renderer's `raycast` tests the ray against each hull's bounding
 * SPHERE. Hulls in this game are long and thin — the Mothership is 2100 m from
 * nose to tail but only a few hundred metres across — so its bounding sphere has
 * a 1060 m radius and swallows a cylinder of empty space more than a kilometre
 * wide. Clicking anywhere near a capital selected it, and the click-through
 * order (attack / move) landed on the wrong thing. The sphere is the right
 * primitive for frustum culling, where being generous is free and correct; it is
 * the wrong primitive for picking, where being generous is the whole bug.
 *
 * WHAT: every hull class gets an oriented bounding box measured from its real
 * LOD2 geometry, and the ray is transformed into the hull's local frame and slab
 * -tested against that box. For a hull whose box is 2100 x 260 x 300 m the OBB
 * encloses roughly 6% of the volume the sphere did.
 *
 * The box hit is then refined against the actual LOD2 TRIANGLES. A box is still
 * a box, and these hulls are emphatically not boxes: a Mothership's box is 2.1 km
 * long and a few hundred metres on a side, so clicking well off the tapered bow,
 * above the spine or between a carrier's outriggers still selected it — "still
 * like a huge box". The triangle pass is affordable precisely because the two
 * phases before it ran: the sphere rejects almost everything, the box rejects
 * most of the remainder, and a pick is one user gesture, not a per-frame cost.
 *
 * The screen-space fallback for tiny distant ships lives in `input/controls.ts`
 * (`pickScreen`) and is unaffected: this module answers "what solid did the ray
 * actually enter", and that answer stops being useful once a hull is 4 px wide.
 */

import type { BufferGeometry } from 'three';
import { SHIP_SPECS } from '../core/registry';
import { SHIP_CLASS_COUNT, type ShipClass } from '../core/types';
import type { World } from '../sim/world';
import type { ShipLibrary } from '../ships/library';

/**
 * Extra metres added to every local half-extent.
 *
 * Hulls carry antennae, fins and gun barrels that the LOD2 mesh drops, and a
 * pick that requires pixel-exact contact feels broken. This is a fixed forgiving
 * margin rather than the fleet renderer's distance-scaled slop, which grew
 * without bound and made far-away capitals into kilometre-wide click targets.
 */
const PICK_PAD = 3.0;

/**
 * Fraction of the hull radius added as pad for very small hulls, so a 19 m scout
 * stays comfortably clickable without a capital gaining hundreds of metres.
 */
const PICK_PAD_FRAC = 0.04;

export class ShipPicker {
  /** Per-class local half-extents, xyz triples, measured from real geometry. */
  private readonly half = new Float32Array(SHIP_CLASS_COUNT * 3);
  /** Per-class local centre offset, xyz triples (hulls are not centred on 0). */
  private readonly centre = new Float32Array(SHIP_CLASS_COUNT * 3);
  /** LOD2 geometry per class, kept for the optional triangle refinement. */
  private readonly mesh: Array<BufferGeometry | null> = [];

  constructor(library: ShipLibrary) {
    for (let c = 0; c < SHIP_CLASS_COUNT; c++) {
      this.mesh.push(null);
      const spec = SHIP_SPECS[c as ShipClass];
      // Sensible fallback if the geometry cannot be measured: a box as long as
      // the spec says and as wide as a third of it. Still far tighter than the
      // bounding sphere.
      let hx = spec.radius * 0.34;
      let hy = spec.radius * 0.28;
      let hz = spec.length * 0.5;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      try {
        const g = library.geometry(c as ShipClass, 2, 0);
        if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox;
        if (bb) {
          hx = (bb.max.x - bb.min.x) * 0.5;
          hy = (bb.max.y - bb.min.y) * 0.5;
          hz = (bb.max.z - bb.min.z) * 0.5;
          cx = (bb.max.x + bb.min.x) * 0.5;
          cy = (bb.max.y + bb.min.y) * 0.5;
          cz = (bb.max.z + bb.min.z) * 0.5;
          this.mesh[c] = g;
        }
      } catch {
        // Library may not hold this class; the spec fallback above stands.
      }
      const pad = PICK_PAD + spec.radius * PICK_PAD_FRAC;
      const i3 = c * 3;
      this.half[i3] = hx + pad;
      this.half[i3 + 1] = hy + pad;
      this.half[i3 + 2] = hz + pad;
      this.centre[i3] = cx;
      this.centre[i3 + 1] = cy;
      this.centre[i3 + 2] = cz;
    }
  }

  /**
   * Nearest ship whose oriented box the ray enters, or -1.
   *
   * `teamFilter` of -1 accepts any team. Docked hulls are never picked.
   * Allocation-free.
   */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    world: World,
    teamFilter = -1,
  ): number {
    let l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-9) return -1;
    l = 1 / l;
    const ux = dx * l;
    const uy = dy * l;
    const uz = dz * l;

    let best = -1;
    let bestT = Infinity;
    const pool = world.ships;

    for (let i = 0; i < pool.count; i++) {
      const s = pool.items[i];
      if (!s.alive || s.dockedIn >= 0) continue;
      if (teamFilter >= 0 && s.team !== teamFilter) continue;

      // Broad phase against the bounding sphere: cheap, and it rejects almost
      // everything before we pay for the basis.
      const rx = s.pos.x - ox;
      const ry = s.pos.y - oy;
      const rz = s.pos.z - oz;
      const tc = rx * ux + ry * uy + rz * uz;
      const spec = SHIP_SPECS[s.cls];
      const br = spec.radius + PICK_PAD;
      if (tc <= -br || tc - br >= bestT) continue;
      const perp2 = rx * rx + ry * ry + rz * rz - tc * tc;
      if (perp2 > br * br) continue;

      // Narrow phase: slab test in the hull's own frame.
      // Basis is [right, up, forward] with right = up x forward, matching the
      // convention in core/registry.ts and the fleet renderer.
      const fx = s.fwd.x, fy = s.fwd.y, fz = s.fwd.z;
      const upx = s.up.x, upy = s.up.y, upz = s.up.z;
      const gx = upy * fz - upz * fy;
      const gy = upz * fx - upx * fz;
      const gz = upx * fy - upy * fx;

      const i3 = (s.cls as number) * 3;
      // Ray origin relative to the box centre, in local axes.
      const ocx = rx - (gx * this.centre[i3] + upx * this.centre[i3 + 1] + fx * this.centre[i3 + 2]);
      const ocy = ry - (gy * this.centre[i3] + upy * this.centre[i3 + 1] + fy * this.centre[i3 + 2]);
      const ocz = rz - (gz * this.centre[i3] + upz * this.centre[i3 + 1] + fz * this.centre[i3 + 2]);

      // Project both origin and direction onto the local axes. Note the sign:
      // `oc` currently points from the eye TO the hull, so negate to get the
      // origin in hull space.
      const px = -(ocx * gx + ocy * gy + ocz * gz);
      const py = -(ocx * upx + ocy * upy + ocz * upz);
      const pz = -(ocx * fx + ocy * fy + ocz * fz);
      const vx = ux * gx + uy * gy + uz * gz;
      const vy = ux * upx + uy * upy + uz * upz;
      const vz = ux * fx + uy * fy + uz * fz;

      let tmin = 0;
      let tmax = bestT;

      // X slab
      if (Math.abs(vx) < 1e-9) {
        if (Math.abs(px) > this.half[i3]) continue;
      } else {
        const inv = 1 / vx;
        let t1 = (-this.half[i3] - px) * inv;
        let t2 = (this.half[i3] - px) * inv;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Y slab
      if (Math.abs(vy) < 1e-9) {
        if (Math.abs(py) > this.half[i3 + 1]) continue;
      } else {
        const inv = 1 / vy;
        let t1 = (-this.half[i3 + 1] - py) * inv;
        let t2 = (this.half[i3 + 1] - py) * inv;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Z slab
      if (Math.abs(vz) < 1e-9) {
        if (Math.abs(pz) > this.half[i3 + 2]) continue;
      } else {
        const inv = 1 / vz;
        let t1 = (-this.half[i3 + 2] - pz) * inv;
        let t2 = (this.half[i3 + 2] - pz) * inv;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }

      // NARROW PHASE 2: the actual triangles.
      //
      // The box alone is still a box, and these hulls are emphatically not
      // boxes: a Mothership's box is 2.1 km long and a few hundred metres on a
      // side, so clicking well off the tapered bow, above the spine or between
      // the outriggers still selected it — reported as "still like a huge box".
      // Having survived the box we now test the real LOD2 surface, so a click
      // lands on the ship only where the ship actually is.
      //
      // This is affordable precisely BECAUSE the two phases above ran: the
      // sphere rejects almost everything, the box rejects most of the rest, and
      // a pick is a single user gesture, not a per-frame cost.
      const geo = this.mesh[s.cls as number];
      const tTri = geo ? this.rayMesh(geo, px, py, pz, vx, vy, vz, bestT) : tmin;
      if (tTri < bestT) {
        bestT = tTri;
        best = s.id;
      }
    }
    return best;
  }

  /**
   * Ray vs. the hull's LOD2 triangle soup, in the hull's LOCAL frame.
   *
   * Moller-Trumbore, single-sided test disabled (hulls are closed but the ray
   * may enter through an open hangar mouth, and a back face there is still a
   * legitimate hit). Returns the nearest hit distance, or `limit` if none is
   * closer than `limit`.
   *
   * Allocation-free: reads straight out of the geometry's typed arrays.
   */
  private rayMesh(
    geo: BufferGeometry,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    limit: number,
  ): number {
    const posAttr = geo.getAttribute('position');
    if (!posAttr) return limit;
    const pos = posAttr.array as ArrayLike<number>;
    const index = geo.getIndex();
    const idx = index ? (index.array as ArrayLike<number>) : null;
    const triCount = (idx ? idx.length : posAttr.count) / 3;

    let best = limit;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] * 3 : t * 9;
      const i1 = idx ? idx[t * 3 + 1] * 3 : t * 9 + 3;
      const i2 = idx ? idx[t * 3 + 2] * 3 : t * 9 + 6;

      const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
      const e1x = pos[i1] - ax, e1y = pos[i1 + 1] - ay, e1z = pos[i1 + 2] - az;
      const e2x = pos[i2] - ax, e2y = pos[i2 + 1] - ay, e2z = pos[i2 + 2] - az;

      // p = d x e2
      const pxv = dy * e2z - dz * e2y;
      const pyv = dz * e2x - dx * e2z;
      const pzv = dx * e2y - dy * e2x;
      const det = e1x * pxv + e1y * pyv + e1z * pzv;
      if (det > -1e-9 && det < 1e-9) continue; // ray parallel to the triangle
      const inv = 1 / det;

      const tx = ox - ax, ty = oy - ay, tz = oz - az;
      const u = (tx * pxv + ty * pyv + tz * pzv) * inv;
      if (u < 0 || u > 1) continue;

      // q = t x e1
      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;

      const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (hit > 0 && hit < best) best = hit;
    }
    return best;
  }
}
