/**
 * STRIKECRAFT HULLS — hero-quality procedural geometry for the small ships.
 *
 * Covers Scout, Interceptor, Bomber, AssaultCorvette, MissileCorvette and the
 * ResourceCollector. Every hull is built from hard-surface primitives (beveled
 * lofts, faceted tubes, chamfered blocks, struts) so that edges catch a crisp
 * specular line instead of reading as a smooth untextured blob.
 *
 * ROUND-2 CRITIQUE FIXES (see verify/critique-round2.json). The headline
 * round-2 finding was measured, not opinion: our hulls carry MORE
 * high-frequency energy than the Homeworld reference at every band (10.91 vs
 * 6.42 std at 2 px) and still look worse, because our detail is sprayed
 * UNIFORMLY — quietest 24 px tile 1.02-1.70 against the reference's 0.05.
 * The reference is ~70% large smooth armour carrying only scribed panel lines,
 * with greeble concentrated into three or four deliberate clusters.
 *
 *   1. DETAIL IS SPENT, NOT SPRAYED. `greebleLine` — a constant-density
 *      scatter along a line, run 3-8 times per hull over open skin — is gone.
 *      It is replaced by `cluster()`, which may only be called at the three
 *      DETAIL SITES every strikecraft owns: the INTAKE shoulder, the SPINE
 *      root and the ENGINE block. Everything else is bare loft: large smooth
 *      shell panels whose panel lines come from hullMaterial's triplanar
 *      surface maps, not from geometry. Reviewer 1, surface/strikecraft.ts:
 *      "3-5 large smooth shell panels ... panel lines only (no proud greebles
 *      above 0.3 m)".
 *
 *      MEASURED, on the Talon Interceptor portrait capture at 1920x1080 with
 *      the same crop and the same hull mask before and after: 24 px tile
 *      detail energy median 0.996 -> 0.476 (half as much detail) while the
 *      tile-to-tile CoV — the "spent, not sprayed" statistic the review named —
 *      rose 0.77 -> 1.07 against reference hw1840080_1 at 1.58 (that reference
 *      is a 900 m capital, where 24 px covers twenty metres of armour, so it
 *      will always score higher than any 23 m fighter). Framing-controlled
 *      offline over all six hulls: CoV 0.46/0.59/0.60/0.64/0.65/0.66 ->
 *      0.56/0.67/0.69/0.72/0.88/0.89, quiet-tile fraction (interior tiles
 *      under 25% of the hull's own median) 0.09-0.25 -> 0.12-0.36.
 *
 *   2. SILHOUETTE. Reviewer 1: "as a cutout it is a shoe with two flat orange
 *      fins". Pairwise black-cutout IoU at portrait framing measured
 *      AssaultCorvette vs MissileCorvette at 0.759 and Scout vs
 *      MissileCorvette at 0.740 — the two confusable pairs, now 0.684 and
 *      0.590. No pair anywhere in the set now exceeds 0.69 at portrait framing
 *      or 0.67 at 16 px fleet range (was 0.759 / 0.763). Each class is built
 *      around ONE dominant outline idea with real sky gaps between its
 *      masses: Scout = needle (spike fore, tall fin
 *      aft, booms held off the body); Interceptor = dart; Bomber = flat delta
 *      with ordnance slung clear below the wing line; Hammer = hammerhead
 *      brick; Quiver = two tall launcher towers with a valley between them;
 *      Ladle = drum with an open three-prong claw.
 *
 *   3. TEAM PAINT. `M.paint` is authored at 0.75 rather than 1.0 and painted
 *      areas are fringed with `M.paintEdge` (0.46) stations. hullMaterial
 *      resolves paint as smoothstep(0.34, 0.54, mask + jitter) with jitter
 *      spanning +-0.28, so at 1.0 nothing could ever break and every painted
 *      face rendered as a hard-edged flat rectangle; at 0.75 roughly a quarter
 *      of the field falls into partial coverage — weathered patches and a
 *      frayed boundary — while the core stays unambiguously faction-coloured
 *      at fleet range. Reviewer 1: paint must be "masked to LARGE plate
 *      boundaries and always broken by a panel seam, a chamfer and a soot
 *      streak". The per-plate stencilled "squadron digit" bars are deleted:
 *      on a 20-47 m hull those were 0.1-0.3 m features, i.e. exactly the
 *      sprayed micro-detail point 1 is about.
 *
 *   4. NAV LIGHTS. Loose `gem(M.glow)` calls scattered over open hull are
 *      gone. Nav lights exist only at extremities, are cowled by a dark
 *      `navPod` fitting, and sit at aMask.y = 0.62 — the centre of
 *      hullMaterial's documented NAV band (0.46..0.70), never the DRIVE band.
 *      Canopy glass moved 0.30 -> 0.25, the documented WINDOW author value.
 *      Emitter radii were also cut ~30% after re-measuring captures, because
 *      bloom energy is radiance times AREA and a 0.16 m gem still blew a
 *      visible green disc at 1920 wide.
 *
 *   5. BUDGETS AND MOUNTS re-verified offline against SHIP_SPECS after every
 *      change (see the harness numbers quoted on each builder): all six hulls
 *      are inside LOD_BUDGET at every LOD (the Lance was 210/180 at LOD2 and
 *      the Probe 186/180 — both now 178), every hull's bounding radius and
 *      z-extent are inside `spec.radius` / `spec.length`, every hardpoint
 *      muzzle and every engine-mount exit plane still lands on real modelled
 *      geometry, and two builds from the same seed are byte-identical.
 *
 * ROUND-1 CRITIQUE FIXES (see verify/critique-round1.json):
 *   - aAO is no longer a hand-typed guess. `MeshAcc.bakeOcclusion` voxelises the
 *     finished mesh and traces a cosine hemisphere per vertex, so wing roots,
 *     canopy wells, intake mouths and greeble bases carry real contact shadow.
 *   - Every aerofoil is a solid `foilProf` section with a three-facet leading
 *     edge and a floor on thickness, replacing the flat bevelled rectangles the
 *     art director read as "zero-thickness sheets ... flat ribbons".
 *   - Team paint is applied as masked BLOCKS — nose flashes, tail blocks, wing
 *     bands over the outer half-span, launcher cheeks, squadron plates with
 *     stencilled number bars — never as a ruled pinstripe.
 *   - Nav lights moved out of the drive emissive band (they were emitting at
 *     engine-bell intensity) into hullMaterial's nav band, and the ones that
 *     define class at fleet range now survive to LOD2.
 *   - Each class owns silhouette events no other class has: Scout = canted
 *     dorsal scanner plate on outrigger booms; Interceptor = raised canopy
 *     blister + dorsal ram intake + splayed V booms; Bomber = blunt painted
 *     brow over a wide low delta with slung torpedoes; Hammer = slab hull with
 *     four barbettes; Quiver = stepped shoulder launchers + forward radar
 *     panel; Ladle = cargo drum with three forward mandibles.
 *
 * DESIGN LANGUAGE (Kushan/Hiigaran):
 *   - long flat-sided fuselages with visible plate steps and a structural spine
 *   - wings with REAL thickness and a beveled leading edge, never flat sheets
 *   - recessed canopies with a dark glass mask and a raised frame
 *   - ordnance racked on the outside where you can see it
 *   - radiator fins, intake mouths, RCS clusters at the extremities, antenna whips
 *   - engine nozzles are hollow: outer flare, dark throat, incandescent core disc
 *
 * CONVENTIONS
 *   +Z nose, -Z engines, +Y dorsal, +X starboard (see core/registry.ts).
 *   Attributes emitted: position / normal / uv / aMask(vec4) / aAO(float),
 *   indexed, bounding sphere computed (see GEOMETRY ATTRIBUTE CONTRACT).
 *
 * Z-FIGHTING POLICY: there is NO coplanar decal geometry anywhere in this file.
 * Every panel step, strip and greeble is a solid with real thickness that sinks
 * into the parent volume, so nothing ever shares a plane with the hull skin.
 *
 * DETERMINISM: silhouette-defining volumes are hard-coded; only greeble
 * placement, sizes and running-light jitter are drawn from the passed-in `Rng`.
 * Two different seeds therefore give two visually distinct sister ships of the
 * same class — which is exactly what the fleet renderer wants for variants.
 *
 * LOD: `bev` collapses to 0 at LOD2, which makes every chamfer quad degenerate;
 * degenerate faces are dropped by the accumulator, so profiles silently fall
 * from 8-sided to 4-sided without a second code path. Greebles are gated on
 * `hero`, secondary structure on `mid`.
 */

import { BufferAttribute, BufferGeometry, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { LOD_BUDGET } from '../core/contracts';
import type { Rng } from '../core/rng';
import { SHIP_SPECS } from '../core/registry';
import { ShipClass } from '../core/types';

// ---------------------------------------------------------------------------
// Surface masks — aMask = (teamPaint, emissive, metalnessBias, roughnessBias)
// ---------------------------------------------------------------------------

/** A single `aMask` vertex value. */
type Mask = readonly [number, number, number, number];

/**
 * The material vocabulary for every strikecraft. Keeping the whole fleet on one
 * short list is what makes a squadron read as built in the same shipyard.
 */
const M = {
  /** Bone-white sunlit plating — the default skin. */
  hull: [0.0, 0.0, 0.2, 0.0],
  /** Same plate, scuffed: used on leading edges and around exhausts. */
  hullWorn: [0.0, 0.0, 0.35, 0.4],
  /**
   * Faction colour, CORE of a painted plate.
   *
   * CRITIQUE (round 2, surface): faction paint must be "masked to LARGE plate
   * boundaries and always broken by a panel seam, a chamfer and a soot streak",
   * never a ruled line and never a dead flat field. hullMaterial computes
   * `paint = smoothstep(0.34, 0.54, maskRaw + jitter * 0.55)` with jitter
   * spanning roughly +-0.5, i.e. +-0.28 on the mask. At the old 1.0 the jitter
   * could not reach the smoothstep at all and every painted face came out as a
   * hard-edged flat rectangle (the "shipping container" read).
   *
   * 0.75 was chosen by capture, not by taste: at 0.82 the jitter floor is 0.54,
   * exactly the top of the smoothstep, so the field still rendered solid edge
   * to edge in verify captures. At 0.75 the floor is 0.47, which puts roughly a
   * quarter of every painted face into partial coverage — sun-bleached patches
   * and a frayed boundary — while the core stays unambiguously faction-coloured
   * at fleet range, which is the other half of the requirement.
   */
  paint: [0.75, 0.0, 0.1, -0.1],
  /**
   * Faction colour, FRINGE of a painted plate — the stations at a plate
   * boundary. 0.46 + jitter straddles the smoothstep (0.18..0.74 against a band
   * of 0.34..0.54), so coverage frays from solid to scattered flecks across the
   * seam and the shader's `wear` term chips it back to bare metal on the
   * chamfer. This is the "broken edge".
   */
  paintEdge: [0.46, 0.0, 0.15, 0.05],
  /** Recessed structure, panel gaps, cavity interiors. */
  graphite: [0.0, 0.0, 0.5, 0.5],
  /** Exposed machinery: pistons, pipe runs, turbo plumbing. */
  mech: [0.0, 0.0, 0.9, 0.2],
  /** Deep machinery in shadow (intake throats, launch tubes). */
  darkMech: [0.0, 0.0, 0.7, 0.6],
  /**
   * Canopy glass. y = 0.25 is the value hullMaterial.ts documents as the
   * author target for the WINDOW band (0.05..0.40) — "target the CENTRE of a
   * band, never a boundary". The previous 0.30 sat close enough to the band's
   * 0.34 roll-off that a future re-band would have started dimming the canopy.
   * CRITIQUE (silhouette / strikecraft.ts): "the fuselage has no readable
   * canopy". At the original 0.12 the window term evaluated to 0.02 and the
   * glass was indistinguishable from bare plate.
   */
  glass: [0.0, 0.25, -1.0, -0.95],
  /** Nozzle flare metal: hot, polished, slightly discoloured. */
  bellLip: [0.0, 0.0, 0.95, -0.3],
  /** Incandescent nozzle core. Allowed to blow out. DRIVE band (> 0.70). */
  bellHot: [0.0, 1.0, 0.3, 0.15],
  /**
   * Running / formation lights.
   * CRITIQUE (surface / M_NAV): y = 0.9 put every nav light in hullMaterial's
   * DRIVE band and multiplied it by 6.5 — every formation light in the fleet
   * was emitting at engine-bell intensity. 0.62 is hullMaterial.ts's
   * documented author value for the NAV band (0.46..0.70), well clear of both
   * the window roll-off at 0.44 and the drive onset at 0.74, so a nav light
   * can never render as drive glow. Round 2 also required COUNT and RHYTHM:
   * nav lights now appear only at extremities and only via `navPod`, which
   * cowls each one in a dark fitting so it reads as a lamp in a housing rather
   * than a chip stuck on the skin.
   */
  glow: [0.0, 0.62, 0.0, 0.1],
  /** Racked ordnance casing. */
  ord: [0.3, 0.0, 0.35, -0.2],
  /** Radiator panel — matte, high metal. */
  rad: [0.0, 0.0, 0.65, 0.35],
} as const satisfies Record<string, Mask>;

/** Metres of hull covered by one unit of UV. Only decals use uv (triplanar does not). */
const UV_SCALE = 0.25;

/** Blocks with a half-extent below this get no chamfer — it would never resolve. */
const MIN_CHAMFER_M = 0.34;

/**
 * Hard floor on aerofoil thickness, metres.
 * CRITIQUE (silhouette / strikecraft.ts): "wings are zero-thickness sheets —
 * visible as flat ribbons with no edge and no thickness cue". Every fin and
 * wing tip is now at least this thick so it has two lit faces and a leading
 * edge chamfer no matter how far the planform tapers.
 */
const MIN_FOIL_THICK = 0.28;

// ---------------------------------------------------------------------------
// BAKED AMBIENT OCCLUSION
//
// CRITIQUE (surface / aAO is hand-typed): every `ao` argument in this file is a
// guessed constant, so nothing sat IN anything — greebles, canopy wells, engine
// collars and wing roots had no contact darkening at all. The authored value is
// kept as the artistic base and multiplied by a real hemisphere-traced
// visibility term computed once, at build time, from the finished triangle soup.
//
// Cost: strike-craft meshes are 200-2500 triangles, so the whole library bakes
// in a few tens of milliseconds behind the existing loading screen. Nothing
// here runs at frame time.
// ---------------------------------------------------------------------------

/** Voxel grid resolution along the mesh's longest axis, per LOD. */
const AO_RES: readonly [number, number, number] = [96, 48, 24];
/** Hemisphere rays fired per vertex, per LOD. */
const AO_RAYS: readonly [number, number, number] = [16, 10, 6];
/** How dark a fully enclosed vertex is allowed to get, as a fraction of the authored value. */
const AO_FLOOR = 0.28;
/** Ray length cap, in voxels. Occlusion past this distance is ambient, not contact. */
const AO_MAX_STEPS = 30;

/** Deterministic 32-bit integer hash -> [0,1). No Rng draw, so bake order is irrelevant. */
function aoHash(x: number): number {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Module-scope scratch — geometry building allocates once, not per primitive.
// ---------------------------------------------------------------------------

const VA = new Vector3();
const VB = new Vector3();
const VC = new Vector3();
const VD = new Vector3();
const V_POS = new Vector3();
const V_DIR = new Vector3();
const V_SCALE = new Vector3(1, 1, 1);
const V_ONE = new Vector3(1, 1, 1);
const AXIS_Z = new Vector3(0, 0, 1);
const M_TMP = new Matrix4();
const Q_TMP = new Quaternion();
const E_TMP = new Euler();
const M_MIRROR = new Matrix4().makeScale(-1, 1, 1);

// ---------------------------------------------------------------------------
// Mesh accumulator
// ---------------------------------------------------------------------------

/**
 * Collects flat-shaded, indexed hard-surface geometry with a transform stack.
 *
 * Flat shading is deliberate: hard-surface hulls want a discrete normal per
 * facet so every chamfer produces its own specular band. Degenerate faces are
 * dropped, which is what lets the LOD system kill chamfers by zeroing a bevel.
 * Winding is auto-reversed under a mirrored transform, so `mirrorX` never
 * produces inside-out normals.
 */
class MeshAcc {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uvs: number[] = [];
  readonly msk: number[] = [];
  readonly occ: number[] = [];
  readonly idx: number[] = [];

  private readonly stack: Matrix4[] = [new Matrix4()];
  private sp = 0;
  private flip = false;

  private readonly q0 = new Vector3();
  private readonly q1 = new Vector3();
  private readonly q2 = new Vector3();
  private readonly q3 = new Vector3();
  private readonly e1 = new Vector3();
  private readonly e2 = new Vector3();
  private readonly nn = new Vector3();
  private readonly n2 = new Vector3();
  /** Private swap temp. MUST NOT be a module-scope vector: callers such as
   *  `fanCap` hold one of those live across a whole triangle loop. */
  private readonly sw = new Vector3();

  /** Concatenate `m` onto the current transform. */
  push(m: Matrix4): void {
    this.sp++;
    if (this.stack.length <= this.sp) this.stack.push(new Matrix4());
    this.stack[this.sp].multiplyMatrices(this.stack[this.sp - 1], m);
    this.flip = this.stack[this.sp].determinant() < 0;
  }

  /** Pop back to the previous transform. */
  pop(): void {
    this.sp--;
    this.flip = this.sp > 0 ? this.stack[this.sp].determinant() < 0 : false;
  }

  /**
   * Emit one quad, vertices given CCW as seen from outside.
   * `aoAB` shades the a/b edge and `aoCD` the c/d edge, which gives free
   * gradient occlusion along lofts (dark at the root, open at the tip).
   */
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, mask: Mask, aoAB: number, aoCD = aoAB): void {
    const x = this.stack[this.sp];
    this.q0.copy(a).applyMatrix4(x);
    this.q1.copy(b).applyMatrix4(x);
    this.q2.copy(c).applyMatrix4(x);
    this.q3.copy(d).applyMatrix4(x);
    let o0 = aoAB, o1 = aoAB, o2 = aoCD, o3 = aoCD;
    if (this.flip) {
      // reverse [a,b,c,d] -> [d,c,b,a] so the face still points outward
      this.sw.copy(this.q0); this.q0.copy(this.q3); this.q3.copy(this.sw);
      this.sw.copy(this.q1); this.q1.copy(this.q2); this.q2.copy(this.sw);
      o0 = aoCD; o1 = aoCD; o2 = aoAB; o3 = aoAB;
    }
    // Test both halves so a chamfer collapsed by LOD degrades to a triangle (or
    // vanishes entirely) instead of leaking zero-area faces into the index buffer.
    this.e1.subVectors(this.q1, this.q0);
    this.e2.subVectors(this.q2, this.q0);
    this.nn.crossVectors(this.e1, this.e2);
    const l1 = this.nn.length();
    this.e1.subVectors(this.q2, this.q0);
    this.e2.subVectors(this.q3, this.q0);
    this.n2.crossVectors(this.e1, this.e2);
    const l2 = this.n2.length();
    if (l1 < 1e-9 && l2 < 1e-9) return;
    const i = this.pos.length / 3;
    if (l1 < 1e-9) {
      this.nn.copy(this.n2).multiplyScalar(1 / l2);
      this.vert(this.q0, o0, mask);
      this.vert(this.q2, o2, mask);
      this.vert(this.q3, o3, mask);
      this.idx.push(i, i + 1, i + 2);
      return;
    }
    this.nn.multiplyScalar(1 / l1);
    if (l2 < 1e-9) {
      this.vert(this.q0, o0, mask);
      this.vert(this.q1, o1, mask);
      this.vert(this.q2, o2, mask);
      this.idx.push(i, i + 1, i + 2);
      return;
    }
    this.vert(this.q0, o0, mask);
    this.vert(this.q1, o1, mask);
    this.vert(this.q2, o2, mask);
    this.vert(this.q3, o3, mask);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** Emit one triangle, CCW as seen from outside. */
  tri(a: Vector3, b: Vector3, c: Vector3, mask: Mask, ao: number): void {
    const x = this.stack[this.sp];
    this.q0.copy(a).applyMatrix4(x);
    this.q1.copy(b).applyMatrix4(x);
    this.q2.copy(c).applyMatrix4(x);
    if (this.flip) { this.sw.copy(this.q0); this.q0.copy(this.q2); this.q2.copy(this.sw); }
    this.e1.subVectors(this.q1, this.q0);
    this.e2.subVectors(this.q2, this.q0);
    this.nn.crossVectors(this.e1, this.e2);
    const len = this.nn.length();
    if (len < 1e-9) return;
    this.nn.multiplyScalar(1 / len);
    const i = this.pos.length / 3;
    this.vert(this.q0, ao, mask);
    this.vert(this.q1, ao, mask);
    this.vert(this.q2, ao, mask);
    this.idx.push(i, i + 1, i + 2);
  }

  /** Triangle count emitted so far (LOD budget bookkeeping). */
  get tris(): number {
    return this.idx.length / 3;
  }

  private vert(v: Vector3, ao: number, mask: Mask): void {
    this.pos.push(v.x, v.y, v.z);
    const n = this.nn;
    this.nrm.push(n.x, n.y, n.z);
    // Box projection off the dominant normal axis keeps decals unstretched.
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ax >= ay && ax >= az) this.uvs.push(v.z * UV_SCALE, v.y * UV_SCALE);
    else if (ay >= az) this.uvs.push(v.x * UV_SCALE, v.z * UV_SCALE);
    else this.uvs.push(v.x * UV_SCALE, v.y * UV_SCALE);
    this.msk.push(mask[0], mask[1], mask[2], mask[3]);
    this.occ.push(ao);
  }

  /**
   * Voxelise the finished mesh and trace a cosine-weighted hemisphere per
   * vertex, folding the result into `occ`.
   *
   * WHAT: builds a solid-surface occupancy grid over the bounding box at
   * `AO_RES[lod]` cells along the longest axis, then fires `AO_RAYS[lod]` rays
   * per vertex and DDA-marches them through the grid. `vis` is the miss
   * fraction; the authored value survives as the base tone and the trace can
   * only darken it, down to `AO_FLOOR`.
   *
   * WHY: fixes the critique's "aAO is hand-typed ... nothing sits IN anything".
   * Wing roots, canopy wells, intake mouths, cell arrays, greeble bases and the
   * gap between a nacelle and the fuselage now pool real shadow.
   *
   * DETERMINISM: ray directions come from a Hammersley sequence rotated by a
   * hash of the vertex index — no Rng draw, so this cannot perturb the caller's
   * random stream and two runs are byte-identical.
   */
  private bakeOcclusion(lod: 0 | 1 | 2): void {
    const P = this.pos, N = this.nrm, O = this.occ, I = this.idx;
    const vcount = P.length / 3;
    if (vcount === 0 || I.length === 0) return;

    // -- bounds --------------------------------------------------------------
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const cell = ext / AO_RES[lod];
    if (!(cell > 1e-6)) return;
    const inv = 1 / cell;
    // Two cells of padding so a ray leaving the hull always exits the grid.
    const ox = minX - cell * 2, oy = minY - cell * 2, oz = minZ - cell * 2;
    const nx = Math.ceil((maxX - minX) * inv) + 5;
    const ny = Math.ceil((maxY - minY) * inv) + 5;
    const nz = Math.ceil((maxZ - minZ) * inv) + 5;
    const grid = new Uint8Array(nx * ny * nz);
    const strideY = nx, strideZ = nx * ny;

    // -- voxelise: point-sample every triangle finer than one cell -----------
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2];
      const bx = P[b], by = P[b + 1], bz = P[b + 2];
      const cx = P[c], cy = P[c + 1], cz = P[c + 2];
      const e0 = Math.abs(bx - ax) + Math.abs(by - ay) + Math.abs(bz - az);
      const e1 = Math.abs(cx - ax) + Math.abs(cy - ay) + Math.abs(cz - az);
      const e2 = Math.abs(cx - bx) + Math.abs(cy - by) + Math.abs(cz - bz);
      const steps = Math.min(24, Math.max(1, Math.ceil(Math.max(e0, e1, e2) * inv * 1.5)));
      for (let u = 0; u <= steps; u++) {
        for (let v = 0; v + u <= steps; v++) {
          const wu = u / steps, wv = v / steps, ww = 1 - wu - wv;
          const px = ax * ww + bx * wu + cx * wv;
          const py = ay * ww + by * wu + cy * wv;
          const pz = az * ww + bz * wu + cz * wv;
          const gx = (px - ox) * inv | 0;
          const gy = (py - oy) * inv | 0;
          const gz = (pz - oz) * inv | 0;
          if (gx < 0 || gy < 0 || gz < 0 || gx >= nx || gy >= ny || gz >= nz) continue;
          grid[gx + gy * strideY + gz * strideZ] = 1;
        }
      }
    }

    // -- trace ---------------------------------------------------------------
    const rays = AO_RAYS[lod];
    // The origin is lifted clear of the vertex's OWN voxel layer (which is one
    // cell thick and can sit entirely above the surface point). At 0.9 cells a
    // grazing ray still marches inside that layer and hits the plate it started
    // on two cells downrange — which blacked out every wing upper surface on
    // the first pass. 1.6 cells guarantees the ray starts above the layer.
    const eps = cell * 1.6;
    const minDist = cell * 1.0;                   // ignore self-adjacent voxels
    for (let i = 0; i < vcount; i++) {
      const p3 = i * 3;
      const nxv = N[p3], nyv = N[p3 + 1], nzv = N[p3 + 2];
      // Orthonormal basis around the vertex normal (Duff et al., branchless).
      const sg = nzv >= 0 ? 1 : -1;
      const ta = -1 / (sg + nzv);
      const tb = nxv * nyv * ta;
      const t0x = 1 + sg * nxv * nxv * ta, t0y = sg * tb, t0z = -sg * nxv;
      const t1x = tb, t1y = sg + nyv * nyv * ta, t1z = -nyv;
      const rot = aoHash(i * 2 + 1) * Math.PI * 2;
      const jit = aoHash(i * 2 + 2);
      const sx = P[p3] + nxv * eps, sy = P[p3 + 1] + nyv * eps, sz = P[p3 + 2] + nzv * eps;
      let miss = 0;
      for (let r = 0; r < rays; r++) {
        // Cosine-weighted hemisphere from a jittered stratified pair.
        const u = (r + jit) / rays;
        const phi = rot + r * 2.399963229728653;   // golden angle azimuth
        const sr = Math.sqrt(u);
        const lz = Math.sqrt(Math.max(0, 1 - u));
        const lx = sr * Math.cos(phi), ly = sr * Math.sin(phi);
        const dx = t0x * lx + t1x * ly + nxv * lz;
        const dy = t0y * lx + t1y * ly + nyv * lz;
        const dz = t0z * lx + t1z * ly + nzv * lz;

        // DDA march.
        let gx = (sx - ox) * inv | 0;
        let gy = (sy - oy) * inv | 0;
        let gz = (sz - oz) * inv | 0;
        if (gx < 0 || gy < 0 || gz < 0 || gx >= nx || gy >= ny || gz >= nz) { miss++; continue; }
        const stx = dx > 0 ? 1 : -1, sty = dy > 0 ? 1 : -1, stz = dz > 0 ? 1 : -1;
        const adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz);
        const tdx = adx > 1e-8 ? cell / adx : 1e30;
        const tdy = ady > 1e-8 ? cell / ady : 1e30;
        const tdz = adz > 1e-8 ? cell / adz : 1e30;
        const fx = (sx - ox) * inv - gx, fy = (sy - oy) * inv - gy, fz = (sz - oz) * inv - gz;
        let tmx = tdx * (dx > 0 ? 1 - fx : fx);
        let tmy = tdy * (dy > 0 ? 1 - fy : fy);
        let tmz = tdz * (dz > 0 ? 1 - fz : fz);
        let hit = false;
        for (let s = 0; s < AO_MAX_STEPS; s++) {
          // Distance at which the ray enters the next cell, in metres (d is unit).
          const tEnter = tmx < tmy ? (tmx < tmz ? tmx : tmz) : (tmy < tmz ? tmy : tmz);
          if (tmx < tmy) {
            if (tmx < tmz) { gx += stx; tmx += tdx; } else { gz += stz; tmz += tdz; }
          } else if (tmy < tmz) { gy += sty; tmy += tdy; } else { gz += stz; tmz += tdz; }
          if (gx < 0 || gy < 0 || gz < 0 || gx >= nx || gy >= ny || gz >= nz) break;
          // Cells adjacent to the vertex's own surface are its own voxel
          // footprint, not an occluder — ignore anything nearer than a cell and
          // a quarter or every flat plate self-shadows into mud.
          if (tEnter < minDist) continue;
          if (grid[gx + gy * strideY + gz * strideZ] !== 0) { hit = true; break; }
        }
        if (!hit) miss++;
      }
      // The 0.7 gamma keeps genuine cavities dark while stopping a merely
      // partly-sheltered plate from crushing: the shader multiplies albedo by
      // `mix(1, ao, 0.85)`, and the round-1 critique's headline complaint was
      // an under-exposed frame. Occlusion has to shape, not subtract.
      const vis = Math.pow(miss / rays, 0.7);
      O[i] *= AO_FLOOR + (1 - AO_FLOOR) * vis;
    }
  }

  /** Bake into an indexed BufferGeometry with the contract attribute set. */
  toGeometry(lod: 0 | 1 | 2 = 0): BufferGeometry {
    this.bakeOcclusion(lod);
    const g = new BufferGeometry();
    const vcount = this.pos.length / 3;
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    g.setAttribute('aMask', new BufferAttribute(new Float32Array(this.msk), 4));
    g.setAttribute('aAO', new BufferAttribute(new Float32Array(this.occ), 1));
    g.setIndex(new BufferAttribute(
      vcount > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1,
    ));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Cross-section profiles
// ---------------------------------------------------------------------------

/** Flat `[x0,y0,x1,y1,...]` ring, wound CCW as seen from +Z. */
type Prof = number[];

/**
 * Beveled rectangle — the workhorse fuselage/wing section. Always 8 points; at
 * `bev = 0` the four chamfer points collapse onto their neighbours and the
 * resulting degenerate faces are dropped, yielding a plain 4-sided box.
 */
function rectProf(hw: number, hh: number, bev: number): Prof {
  const bx = Math.max(0, Math.min(bev, hw * 0.85));
  const by = Math.max(0, Math.min(bev, hh * 0.85));
  return [
    hw, -hh + by, hw, hh - by, hw - bx, hh, -hw + bx, hh,
    -hw, hh - by, -hw, -hh + by, -hw + bx, -hh, hw - bx, -hh,
  ];
}

/**
 * AEROFOIL cross-section — the wing/fin workhorse.
 *
 * CRITIQUE (silhouette / strikecraft.ts): wings built from `rectProf` read as
 * flat ribbons that vanish edge-on. This section is a real solid:
 *
 *   - a THREE-FACET leading edge (upper chamfer, blunt nose face, lower
 *     chamfer) so the LE always holds a bright specular line under a raking key
 *     instead of cutting straight to background;
 *   - maximum thickness at 32% chord, never below `MIN_FOIL_THICK`;
 *   - a blunt trailing edge — a knife edge is invisible and aliases.
 *
 * x runs along the chord with -x LEADING (the wing loft is rotated +90 deg
 * about Y, so local -x maps to world +Z); y is thickness. Wound CCW from +Z to
 * match `rectProf`.
 *
 * Three cost tiers, all of which keep real thickness — that is the whole point
 * of the fix and it is never traded away:
 *   LOD0  8 points, chamfered LE, thickness crest at 32% chord
 *   LOD1  6 points, blunt LE face, thickness crest
 *   LOD2  4 points, blunt LE and TE faces — a tapered slab, still a solid
 */
function foilProf(chord: number, thick: number, leBev: number, coarse = false): Prof {
  const hw = Math.max(0.02, chord * 0.5);
  const hh = Math.max(thick, MIN_FOIL_THICK) * 0.5;
  const teH = hh * 0.30;                       // blunt trailing edge
  const nose = hh * 0.34;                      // blunt leading-edge face
  const xC = -hw + chord * 0.32;               // thickness crest
  const bx = coarse ? 0 : Math.min(leBev, chord * 0.22);
  if (coarse) {
    return [hw, -teH, hw, teH, -hw, hh * 0.8, -hw, -hh * 0.8];
  }
  if (bx <= 0.004) {
    return [hw, -teH, hw, teH, xC, hh, -hw, nose, -hw, -nose, xC, -hh];
  }
  const xN = -hw + bx;
  const yN = hh * 0.84;
  return [
    hw, -teH, hw, teH, xC, hh, xN, yN,
    -hw, nose, -hw, -nose, xN, -yN, xC, -hh,
  ];
}

/** Regular n-gon ring, CCW from +Z. `phase` rotates it (use PI/4 with n=4 for a square). */
function ngonProf(n: number, r: number, phase = 0, ky = 1): Prof {
  const p: Prof = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    p.push(Math.cos(a) * r, Math.sin(a) * r * ky);
  }
  return p;
}

/** Translate a profile in its own plane (used for sweep, dihedral, offsets). */
function offProf(p: Prof, dx: number, dy: number): Prof {
  const o: Prof = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) { o[i] = p[i] + dx; o[i + 1] = p[i + 1] + dy; }
  return o;
}

/** One station of a loft. `mask`/`ao` override the loft defaults from here aft-to-fore. */
interface Sec {
  z: number;
  prof: Prof;
  mask?: Mask;
  ao?: number;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Triangle-fan cap over a profile. `dir` +1 faces +Z, -1 faces -Z. */
function fanCap(a: MeshAcc, s: Sec, dir: 1 | -1, mask: Mask, ao: number): void {
  const p = s.prof;
  const k = p.length >> 1;
  VA.set(p[0], p[1], s.z);
  for (let j = 1; j < k - 1; j++) {
    VB.set(p[j * 2], p[j * 2 + 1], s.z);
    VC.set(p[(j + 1) * 2], p[(j + 1) * 2 + 1], s.z);
    if (dir > 0) a.tri(VA, VB, VC, mask, ao);
    else a.tri(VA, VC, VB, mask, ao);
  }
}

/**
 * Skin a series of cross-sections into a closed hull.
 *
 * INVARIANTS (violating either turns the surface inside out):
 *   - all sections share a point count and CCW-from-+Z winding;
 *   - sections are ordered by ASCENDING z.
 */
function loft(
  a: MeshAcc, secs: Sec[], mask: Mask, ao: number,
  capBack = true, capFront = true,
): void {
  const n = secs.length;
  if (n < 2) return;
  const k = secs[0].prof.length >> 1;
  for (let i = 0; i < n - 1; i++) {
    const A = secs[i], B = secs[i + 1];
    const mk = A.mask ?? mask;
    const oa = A.ao ?? ao, ob = B.ao ?? ao;
    for (let j = 0; j < k; j++) {
      const j2 = (j + 1) % k;
      VA.set(A.prof[j * 2], A.prof[j * 2 + 1], A.z);
      VB.set(A.prof[j2 * 2], A.prof[j2 * 2 + 1], A.z);
      VC.set(B.prof[j2 * 2], B.prof[j2 * 2 + 1], B.z);
      VD.set(B.prof[j * 2], B.prof[j * 2 + 1], B.z);
      a.quad(VA, VB, VC, VD, mk, oa, ob);
    }
  }
  if (capFront) { const s = secs[n - 1]; fanCap(a, s, 1, s.mask ?? mask, s.ao ?? ao); }
  if (capBack) { const s = secs[0]; fanCap(a, s, -1, s.mask ?? mask, (s.ao ?? ao) * 0.85); }
}

/** One station of a circular tube. `ky` squashes the ring vertically. */
interface Ring {
  z: number;
  r: number;
  ky?: number;
  ox?: number;
  oy?: number;
  mask?: Mask;
  ao?: number;
}

/**
 * Faceted tube of revolution about local +Z; rings must ascend in z.
 * `inward` reverses the winding so the surface faces the axis — that is how
 * intake throats and nozzle interiors are built without a second primitive.
 */
function tube(
  a: MeshAcc, rings: Ring[], sides: number, mask: Mask, ao: number,
  inward = false, phase = 0, capBack = false, capFront = false,
): void {
  const secs: Sec[] = [];
  for (const r of rings) {
    let p = ngonProf(sides, r.r, phase, r.ky ?? 1);
    if (r.ox || r.oy) p = offProf(p, r.ox ?? 0, r.oy ?? 0);
    if (inward) {
      // Reverse point order -> faces point at the axis instead of away from it.
      const q: Prof = [];
      for (let i = p.length - 2; i >= 0; i -= 2) q.push(p[i], p[i + 1]);
      p = q;
    }
    secs.push({ z: r.z, prof: p, mask: r.mask, ao: r.ao });
  }
  loft(a, secs, mask, ao, capBack, capFront);
}

/** Flat disc facing +Z (`dir` 1) or -Z (`dir` -1) — nozzle cores, tube bottoms. */
function disc(
  a: MeshAcc, z: number, r: number, sides: number, mask: Mask, ao: number,
  dir: 1 | -1 = 1, ox = 0, oy = 0,
): void {
  fanCap(a, { z, prof: offProf(ngonProf(sides, r), ox, oy) }, dir, mask, ao);
}

/** Cheap axis-aligned solid box: 12 triangles, for small greebles. */
function boxSolid(
  a: MeshAcc, cx: number, cy: number, cz: number,
  hw: number, hh: number, hd: number, mask: Mask, ao: number,
): void {
  loft(a, [
    { z: cz - hd, prof: offProf(rectProf(hw, hh, 0), cx, cy) },
    { z: cz + hd, prof: offProf(rectProf(hw, hh, 0), cx, cy) },
  ], mask, ao);
}

/**
 * Chamfered block — the good box. Every one of its twelve edges gets a bevel,
 * so it holds a specular line from any angle.
 *
 * Two automatic degradations, both about pixels rather than policy: a zero
 * bevel (LOD1/2) and any block whose smallest half-extent is under
 * `MIN_CHAMFER_M` fall back to the 12-triangle `boxSolid`, because a chamfer
 * that thin never resolves on screen.
 */
function boxBev(
  a: MeshAcc, cx: number, cy: number, cz: number,
  hw: number, hh: number, hd: number, bev: number, mask: Mask, ao: number,
): void {
  if (bev <= 0.004 || Math.min(hw, hh, hd) < MIN_CHAMFER_M) {
    boxSolid(a, cx, cy, cz, hw, hh, hd, mask, ao);
    return;
  }
  const e = Math.max(0, Math.min(bev, hw * 0.7, hh * 0.7, hd * 0.7));
  const mid = rectProf(hw, hh, e);
  const end = rectProf(Math.max(0.001, hw - e), Math.max(0.001, hh - e), e * 0.6);
  loft(a, [
    { z: cz - hd, prof: offProf(end, cx, cy) },
    { z: cz - hd + e, prof: offProf(mid, cx, cy) },
    { z: cz + hd - e, prof: offProf(mid, cx, cy) },
    { z: cz + hd, prof: offProf(end, cx, cy) },
  ], mask, ao);
}

/**
 * Tapered tube between two arbitrary points — pylons, struts, mandible limbs,
 * pipe runs, antenna whips. `sides = 4, phase = PI/4` gives a square beam.
 */
function strut(
  a: MeshAcc,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  r0: number, r1: number, sides: number, mask: Mask, ao: number,
  phase = 0, caps = true,
): void {
  V_DIR.set(x1 - x0, y1 - y0, z1 - z0);
  const len = V_DIR.length();
  if (len < 1e-5) return;
  V_DIR.multiplyScalar(1 / len);
  Q_TMP.setFromUnitVectors(AXIS_Z, V_DIR);
  M_TMP.compose(V_POS.set(x0, y0, z0), Q_TMP, V_ONE);
  a.push(M_TMP);
  tube(a, [{ z: 0, r: r0 }, { z: len, r: r1 }], sides, mask, ao, false, phase, caps, caps);
  a.pop();
}

/** Octahedral gem — 8 triangles. Used for running lights and tiny sensor nubs. */
function gem(
  a: MeshAcc, cx: number, cy: number, cz: number, r: number, mask: Mask, ao: number,
): void {
  const eq: Array<[number, number]> = [[r, 0], [0, r], [-r, 0], [0, -r]];
  for (let i = 0; i < 4; i++) {
    const p = eq[i], q = eq[(i + 1) % 4];
    VA.set(cx, cy + r, cz);
    VB.set(cx + q[0], cy, cz + q[1]);
    VC.set(cx + p[0], cy, cz + p[1]);
    a.tri(VA, VB, VC, mask, ao);
    VA.set(cx, cy - r, cz);
    a.tri(VA, VC, VB, mask, ao);
  }
}

// ---------------------------------------------------------------------------
// Build context
// ---------------------------------------------------------------------------

/** Per-build state handed to every part function. */
interface Ctx {
  a: MeshAcc;
  rng: Rng;
  lod: 0 | 1 | 2;
  /** LOD0 — full greeble pass. */
  hero: boolean;
  /** LOD0/1 — secondary structure kept, greebles dropped. */
  mid: boolean;
  /** Facet count for major volumes of revolution. */
  sides: number;
  /** Facet count for small details. */
  fine: number;
  /** Bevel multiplier: 1 for LOD0/1, 0 for LOD2 (chamfers vanish). */
  bev: number;
}

/**
 * Thin out loft stations for the reduced LODs while always keeping both end
 * stations, so overall length and the nose/tail shape never change.
 */
function dec(secs: Sec[], c: Ctx): Sec[] {
  if (c.lod === 0 || secs.length <= 3) return secs;
  const step = c.lod === 1 ? 2 : 4;
  const out: Sec[] = [];
  for (let i = 0; i < secs.length; i += step) out.push(secs[i]);
  if (out[out.length - 1] !== secs[secs.length - 1]) out.push(secs[secs.length - 1]);
  return out;
}

/** Same thinning for tubes of revolution. */
function decRings(rings: Ring[], c: Ctx): Ring[] {
  if (c.lod === 0 || rings.length <= 3) return rings;
  const step = c.lod === 1 ? 2 : 4;
  const out: Ring[] = [];
  for (let i = 0; i < rings.length; i += step) out.push(rings[i]);
  if (out[out.length - 1] !== rings[rings.length - 1]) out.push(rings[rings.length - 1]);
  return out;
}

/** Run `fn` twice: as authored, then mirrored to port. Winding is fixed automatically. */
function mirrorX(a: MeshAcc, fn: () => void): void {
  fn();
  a.push(M_MIRROR);
  fn();
  a.pop();
}

/**
 * Build a translate/rotate/uniform-scale matrix in shared scratch.
 * The result is only valid until the next call — `MeshAcc.push` copies it.
 */
function trs(
  x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0, s = 1,
): Matrix4 {
  Q_TMP.setFromEuler(E_TMP.set(rx, ry, rz));
  return M_TMP.compose(V_POS.set(x, y, z), Q_TMP, V_SCALE.set(s, s, s));
}

// ---------------------------------------------------------------------------
// Shared ship parts
// ---------------------------------------------------------------------------

/**
 * Hollow engine nozzle. The exit plane sits exactly on the `EngineMount` centre
 * with the given exit radius, the flare and throat run forward into the hull,
 * and an incandescent disc caps the throat so the bell reads hot from behind.
 */
function nozzle(c: Ctx, x: number, y: number, z: number, r: number): void {
  const a = c.a;
  // Small bells never justify ten facets; big ones carry the ship's scale.
  const s = Math.max(5, c.sides - (r < 1.5 ? 2 : 0));
  a.push(trs(x, y, z));

  if (!c.mid) {
    // LOD2: silhouette + emissive core only.
    tube(a, [{ z: 0, r: r * 1.18 }, { z: 1.6 * r, r: r * 0.94 }], s, M.bellLip, 0.7);
    disc(a, 0.55 * r, r * 1.0, s, M.bellHot, 0.4, -1);
    a.pop();
    return;
  }

  // Outer flare, aft to fore: lip -> waist -> collar. The lip overhangs the
  // waist so the rim always catches a bright specular arc from behind.
  tube(a, decRings([
    { z: 0.0, r: r * 1.2, ao: 0.9 },
    { z: 0.42 * r, r: r * 1.06, ao: 0.75 },
    { z: 1.5 * r, r: r * 0.9, ao: 0.6 },
    { z: 2.6 * r, r: r * 1.02, ao: 0.55 },
  ], c), s, M.bellLip, 0.8);
  // Rim: a flat annulus so the bell has thickness instead of a paper edge.
  ringAnnulus(a, 0, r * 1.2, r * 0.98, s, M.bellLip, 0.7, -1);
  // Inner throat, facing the axis, darkening forward into the machinery.
  tube(a, decRings([
    { z: 0.0, r: r * 0.98, ao: 0.5 },
    { z: 0.9 * r, r: r * 0.62, ao: 0.3 },
    { z: 1.9 * r, r: r * 0.46, ao: 0.22 },
  ], c), s, M.darkMech, 0.4, true);
  // Incandescent core.
  disc(a, 1.9 * r, r * 0.46, s, M.bellHot, 0.35, -1);
  if (c.hero) {
    // Hot inner ring just inside the lip — reads as light bleeding onto metal.
    tube(a, [
      { z: 0.9 * r, r: r * 0.6 },
      { z: 1.05 * r, r: r * 0.56 },
    ], s, M.bellHot, 0.4, true);
    // Cooling vanes, only where the bell is big enough to show them.
    if (r >= 1.7) {
      const n = 6;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + 0.2;
        boxSolid(a, Math.cos(ang) * r * 1.02, Math.sin(ang) * r * 1.02, 1.9 * r,
          r * 0.1, r * 0.1, r * 0.55, M.mech, 0.5);
      }
    }
  }
  a.pop();
}

/** Flat annulus (washer) in the local XY plane — nozzle rims, collar faces. */
function ringAnnulus(
  a: MeshAcc, z: number, rOuter: number, rInner: number, sides: number,
  mask: Mask, ao: number, dir: 1 | -1,
): void {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    VA.set(Math.cos(a0) * rOuter, Math.sin(a0) * rOuter, z);
    VB.set(Math.cos(a1) * rOuter, Math.sin(a1) * rOuter, z);
    VC.set(Math.cos(a1) * rInner, Math.sin(a1) * rInner, z);
    VD.set(Math.cos(a0) * rInner, Math.sin(a0) * rInner, z);
    if (dir > 0) a.quad(VA, VB, VC, VD, mask, ao);
    else a.quad(VD, VC, VB, VA, mask, ao);
  }
}

/**
 * Recessed cockpit canopy: a graphite well sunk into the hull, a dark glass
 * blister inside it and a raised frame rib down the centre. Never a bare dome.
 */
function canopy(
  c: Ctx, z0: number, z1: number, hw: number, yBase: number, rise: number,
): void {
  const a = c.a;
  const zm = (z0 + z1) * 0.5;
  const b = 0.1 * c.bev;
  if (!c.mid) {
    // LOD2: the glass mask still has to read, the moulding does not.
    boxSolid(a, 0, yBase + rise * 0.45, zm, hw * 0.9, rise * 0.55, (z1 - z0) * 0.42,
      M.glass, 0.85);
    return;
  }
  // Sunken surround (slightly wider than the glass) reads as a recess.
  boxBev(a, 0, yBase - 0.12, zm, hw * 1.28, 0.22, (z1 - z0) * 0.5 + 0.28, b, M.graphite, 0.5);
  // Glass: a low faceted canopy, wide at the base, tapering forward.
  const g: Sec[] = [
    { z: z0, prof: canopyProf(hw * 0.55, rise * 0.35, yBase) },
    { z: z0 + (z1 - z0) * 0.3, prof: canopyProf(hw, rise, yBase) },
    { z: z0 + (z1 - z0) * 0.72, prof: canopyProf(hw * 0.86, rise * 0.9, yBase) },
    { z: z1, prof: canopyProf(hw * 0.4, rise * 0.42, yBase) },
  ];
  loft(a, dec(g, c), M.glass, 0.85);
  if (c.mid) {
    // Frame spine + two ribs so the glass has structure rather than floating.
    boxSolid(a, 0, yBase + rise * 0.72, zm, 0.055, rise * 0.42, (z1 - z0) * 0.5, M.graphite, 0.6);
  }
  if (c.hero) {
    // ONE bow frame, not a ladder of them: a canopy is a cluster site, and a
    // cluster that repeats at even pitch is a carpet again.
    boxSolid(a, 0, yBase + rise * 0.5, z0 + (z1 - z0) * 0.42,
      hw * 0.92, rise * 0.5, 0.05, M.graphite, 0.55);
  }
}

/** Half-hex canopy cross-section (flat base, faceted crown). */
function canopyProf(hw: number, rise: number, y: number): Prof {
  return [
    hw, y, hw * 0.86, y + rise * 0.55, hw * 0.44, y + rise,
    -hw * 0.44, y + rise, -hw * 0.86, y + rise * 0.55, -hw, y,
    -hw * 0.6, y - 0.16, hw * 0.6, y - 0.16,
  ];
}

/**
 * Forward-facing intake: a bevelled lip ring with a dark throat behind it.
 * Placed on nacelle noses; gives the hull a real hole instead of a painted one.
 */
function intake(c: Ctx, x: number, y: number, z: number, r: number, depth: number): void {
  const a = c.a;
  if (!c.mid) return; // at LOD2 the mouth is a couple of pixels — skip it
  a.push(trs(x, y, z));
  tube(a, [
    { z: -0.18 * r, r: r * 0.98, ao: 0.7 },
    { z: 0, r: r * 1.06, ao: 0.9 },
  ], c.sides, M.hullWorn, 0.8);
  ringAnnulus(a, -0.18 * r, r * 0.98, r * 0.82, c.sides, M.hullWorn, 0.6, 1);
  tube(a, [
    { z: -depth, r: r * 0.55, ao: 0.2 },
    { z: -0.18 * r, r: r * 0.82, ao: 0.42 },
  ], c.sides, M.darkMech, 0.3, true);
  disc(a, -depth, r * 0.55, c.sides, M.darkMech, 0.16, 1);
  // Splitter vanes across the mouth — only where the mouth is genuinely big.
  // ROUND 2: the threshold was 0.7 m, which fired on every fighter intake and
  // put three 0.03 m slivers in a hole two pixels wide. At 1.0 m only the
  // Collector's mining-scale ducts qualify, which is the point: detail must be
  // spent where it resolves.
  if (c.hero && r >= 1.0) {
    for (let i = 0; i < 3; i++) {
      const t = (i - 1) * r * 0.45;
      boxSolid(a, t, 0, -depth * 0.45, r * 0.045, r * 0.78, depth * 0.42, M.mech, 0.35);
    }
  }
  a.pop();
}

/**
 * Gun barrel whose MUZZLE lands exactly on the hardpoint. The barrel, its
 * shroud and the mount block run aft from there into the hull.
 */
function barrel(
  c: Ctx, x: number, y: number, z: number, len: number, r: number, mask: Mask = M.mech,
): void {
  const a = c.a;
  a.push(trs(x, y, z));
  if (!c.mid) {
    // LOD2: a stub that keeps the barrel in the silhouette, nothing more.
    tube(a, [{ z: -len, r: r * 1.4 }, { z: 0, r: r }], 4, mask, 0.7, false, 0, true, true);
    a.pop();
    return;
  }
  tube(a, decRings([
    { z: -len, r: r * 1.55, ao: 0.5 },
    { z: -len * 0.62, r: r * 1.35, ao: 0.6 },
    { z: -len * 0.5, r: r * 0.95, ao: 0.7 },
    { z: -len * 0.12, r: r * 0.9, ao: 0.85 },
    { z: -len * 0.06, r: r * 1.12, ao: 0.9 },
    { z: 0, r: r * 1.05, ao: 0.95 },
  ], c), c.fine, mask, 0.7, false, 0, true, false);
  // Bore: a dark hole at the muzzle, not a flat cap.
  tube(a, [{ z: -r * 1.6, r: r * 0.6 }, { z: 0, r: r * 0.95 }], c.fine, M.darkMech, 0.2, true);
  disc(a, -r * 1.6, r * 0.6, c.fine, M.darkMech, 0.12, 1);
  a.pop();
}

/**
 * Wing: a real solid with thickness, taper, sweep, dihedral and a three-facet
 * bevelled leading edge (see `foilProf`). Lofted along its own +Z then rotated
 * so span runs to +X.
 */
interface WingOpts {
  x: number; y: number; z: number;
  span: number;
  rootChord: number; tipChord: number;
  rootThick: number; tipThick: number;
  /** World +Z offset of the tip chord centre. Negative = swept back. */
  sweep: number;
  /** World +Y offset of the tip. */
  dihedral: number;
  segments: number;
  mask: Mask;
  /** Optional band applied to the outer third — team paint stripes live here. */
  tipMask?: Mask;
  ao: number;
  bev: number;
  capRoot?: boolean;
}

function wing(c: Ctx, o: WingOpts): void {
  const a = c.a;
  // One spanwise segment at LOD2: sweep and taper are still expressed by the
  // root and tip sections, and a fighter aerofoil is 3 px wide there.
  const segs = c.lod === 0 ? o.segments : c.lod === 1 ? 2 : 1;
  const secs: Sec[] = [];
  // Bevel scale is deliberately NOT allowed to reach zero from taper alone —
  // the section must keep a constant point count along the span or the loft
  // winding breaks. It only collapses when the LOD zeroes `bev` outright.
  const bev = o.bev;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const chord = o.rootChord + (o.tipChord - o.rootChord) * t;
    const thick = o.rootThick + (o.tipThick - o.rootThick) * t;
    // Local x maps to world -Z after the +90 deg Y rotation, hence the sign.
    const prof = offProf(
      foilProf(chord, thick, bev * (1 - 0.4 * t), c.lod === 2),
      -o.sweep * t, o.dihedral * t,
    );
    secs.push({
      z: o.span * t,
      prof,
      // Team paint occupies the outer half of the span as a solid BLOCK — see
      // the critique on paint being ruled lines rather than masked areas.
      // Keyed off the OUTER end of the band this section opens, so the band
      // exists identically at every LOD (at LOD1/2 there are only two spanwise
      // segments and a `t > x` test on the section itself would paint nothing
      // but the tip cap — the paint has to survive to fleet range).
      mask: o.tipMask && (i + 1) / segs > 0.56 ? o.tipMask : undefined,
      ao: o.ao * (0.72 + 0.28 * t),
    });
  }
  a.push(trs(o.x, o.y, o.z, 0, Math.PI * 0.5, 0));
  loft(a, secs, o.mask, o.ao, o.capRoot ?? false, true);
  a.pop();
}

/**
 * RCS thruster cluster: a small chamfered pad with four dark ports.
 * Always placed at extremities — that is where the eye looks for scale cues.
 */
function rcs(c: Ctx, x: number, y: number, z: number, s: number, axis: 'x' | 'y' | 'z'): void {
  const a = c.a;
  const hw = axis === 'x' ? s * 0.32 : s;
  const hh = axis === 'y' ? s * 0.32 : s;
  const hd = axis === 'z' ? s * 0.32 : s;
  boxBev(a, x, y, z, hw, hh, hd, s * 0.22 * c.bev, M.graphite, 0.55);
  if (!c.hero) return;
  const off = s * 0.5;
  // ROUND 2: two ports, always. A four-port cluster on a 0.4 m pad is four
  // sub-decimetre boxes — exactly the sprayed micro-detail the review measured,
  // and at strikecraft scale it never resolves as anything but noise.
  const ports = 2;
  for (let i = 0; i < ports; i++) {
    const dx = (i & 1 ? off : -off);
    const dy = (i & 2 ? off : -off);
    if (axis === 'x') boxSolid(a, x + hw * 0.55, y + dx, z + dy, s * 0.1, s * 0.2, s * 0.2, M.darkMech, 0.3);
    else if (axis === 'y') boxSolid(a, x + dx, y + hh * 0.55, z + dy, s * 0.2, s * 0.1, s * 0.2, M.darkMech, 0.3);
    else boxSolid(a, x + dx, y + dy, z + hd * 0.55, s * 0.2, s * 0.2, s * 0.1, M.darkMech, 0.3);
  }
}

/**
 * TEAM-PAINT PLATE — one contiguous faction-colour armour panel with a frayed,
 * chipped boundary.
 *
 * CRITIQUE (round 2, surface): the previous version stamped 1-3 recessed
 * "squadron digit" bars into every plate. On a 20-47 m hull those bars are
 * 0.1-0.3 m features — precisely the uniform high-frequency spray the round-2
 * review measured, and at fleet range they are sub-pixel noise that only
 * softens the colour block. Reviewer 1 asked instead for "a single 4-8 m
 * team-colour block", "masked to LARGE plate boundaries and always broken by a
 * panel seam".
 *
 * So the plate is now three lofted stations along its long axis: a fringe
 * station at each end in `M.paintEdge` (0.50) and a core in `M.paint` (0.82).
 * hullMaterial's mask jitter is +-0.28, so the core stays solid and only the
 * two boundary bands fray — the plate reads as sprayed paint whose edge has
 * been chipped back to bare metal, which is exactly what the `wear` term in
 * the shader then does to it.
 *
 * The plate is a solid that sinks into the parent volume, so it never shares a
 * plane with the hull skin (see the file's Z-FIGHTING POLICY).
 */
function paintPlate(
  c: Ctx, x: number, y: number, z: number,
  hw: number, hh: number, hd: number,
): void {
  // Hero/mid only: at LOD2 the fleet-range colour signature is carried for free
  // by the painted loft STATIONS (nose flash / tail block / exhaust collar),
  // which cost no triangles and cannot be decimated away.
  if (!c.mid) return;
  const a = c.a;
  const f = 0.22;                                   // fringe fraction of length
  loft(a, [
    { z: z - hd, prof: offProf(rectProf(hw, hh, 0), x, y), mask: M.paintEdge },
    { z: z - hd * (1 - f * 2), prof: offProf(rectProf(hw, hh, 0), x, y), mask: M.paint },
    { z: z + hd * (1 - f * 2), prof: offProf(rectProf(hw, hh, 0), x, y), mask: M.paintEdge },
    { z: z + hd, prof: offProf(rectProf(hw, hh, 0), x, y) },
  ], M.paint, 0.95);
}

/**
 * NAV LIGHT IN A COWL — the only way this file is allowed to place an emissive
 * running light.
 *
 * CRITIQUE (round 2, surface/nav lights): nav lights were "broken in two
 * opposite directions on the same asset" — some blooming into 50 px orbs, some
 * aliasing into hard green chips — and the note "was about COUNT and RHYTHM as
 * much as colour". The fix here is threefold: aMask.y = 0.62 is the centre of
 * hullMaterial's NAV band so the emitter can never fall into DRIVE and bloom;
 * a dark graphite cowl box sits behind and around the lamp so it reads as a
 * fitting; and every loose `gem(M.glow)` on open hull has been deleted, so a
 * strikecraft carries three or four of these, all at extremities.
 *
 * Survives every LOD: the emissive mask is the only thing still resolving at
 * fleet range, and 8 (hero) / 4 (LOD2) triangles fit the 180-triangle budget.
 *
 * SIZE: `r` is capped by convention at 0.13 m even on the 56 m Collector. The
 * band clamp is hullMaterial's job, but total bloom energy is the emitter's
 * AREA times its radiance, and the round-2 captures showed a 0.16 m gem still
 * blowing a visible green disc at 1920 wide. Radii here were cut ~30% after
 * re-measuring verify/scratch captures: a nav light must be a spark, and a
 * spark is one or two pixels wherever the ship is on screen.
 */
function navPod(c: Ctx, x: number, y: number, z: number, r: number): void {
  const a = c.a;
  if (c.mid) {
    // Cowl: a short dark box the lamp is recessed into.
    boxSolid(a, x, y, z - r * 1.6, r * 1.7, r * 1.7, r * 1.6, M.graphite, 0.5);
    gem(a, x, y, z, r, M.glow, 1);
    return;
  }
  // LOD2: a 4-triangle tetrahedron at 1.5x size. Half the cost of `gem` and,
  // being a couple of pixels across, indistinguishable from it.
  const s = r * 1.5;
  const p: Array<[number, number, number]> = [
    [s, s, s], [-s, -s, s], [-s, s, -s], [s, -s, -s],
  ];
  const f: Array<[number, number, number]> = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
  for (const [i, j, k] of f) {
    VA.set(x + p[i][0], y + p[i][1], z + p[i][2]);
    VB.set(x + p[j][0], y + p[j][1], z + p[j][2]);
    VC.set(x + p[k][0], y + p[k][1], z + p[k][2]);
    a.tri(VA, VB, VC, M.glow, 1);
  }
}

/**
 * Antenna whip with a base insulator. Silhouette spice, at most one per hull.
 *
 * CRITIQUE (round 2, nav lights / COUNT): the tip beacon that used to cap every
 * whip put two to four extra emissive points on hulls that were already
 * carrying loose `gem(M.glow)` calls over open skin. Nav emission is now the
 * exclusive job of `navPod`, at extremities only.
 */
function whip(
  c: Ctx, x: number, y: number, z: number, dx: number, dy: number, dz: number, r = 0.05,
): void {
  const a = c.a;
  boxBev(a, x, y, z, r * 3, r * 3, r * 3, r * c.bev, M.graphite, 0.5);
  strut(a, x, y, z, x + dx, y + dy, z + dz, r, r * 0.35, 3, M.mech, 0.7);
}

/** Ribbed radiator panel — thin slab plus fins, angled by the caller. */
function radiator(
  c: Ctx, x: number, y: number, z: number, hw: number, hd: number, ribs: number, rot: number,
): void {
  const a = c.a;
  a.push(trs(x, y, z, 0, 0, rot));
  boxBev(a, 0, 0, 0, hw, hw * 0.09, hd, hw * 0.07 * c.bev, M.rad, 0.55);
  if (c.hero) {
    for (let i = 0; i < ribs; i++) {
      const t = (i + 0.5) / ribs;
      boxSolid(a, 0, 0, -hd + t * hd * 2, hw * 1.02, hw * 0.16, hd * 0.055, M.graphite, 0.45);
    }
  }
  a.pop();
}

/** Low sensor blister / dome — two rings and a cap. */
function blister(
  c: Ctx, x: number, y: number, z: number, r: number, h: number, mask: Mask = M.hull,
): void {
  const a = c.a;
  a.push(trs(x, y, z, -Math.PI * 0.5, 0, 0));
  tube(a, [
    { z: 0, r: r, ao: 0.6 },
    { z: h * 0.55, r: r * 0.86, ao: 0.9 },
    { z: h, r: r * 0.5, ao: 1 },
  ], c.fine + 2, mask, 0.9, false, 0, false, true);
  a.pop();
}

/**
 * MACHINERY CLUSTER — the only proud detail a strikecraft is allowed to carry.
 *
 * CRITIQUE (round 2, headline finding, measured): "our quietest 24 px tile
 * measures 1.02-1.70 of detail energy where the reference measures 0.05 ...
 * the reference is ~70% large smooth armour plate carrying only scribed panel
 * lines, with greeble concentrated into three or four deliberate clusters. The
 * eye reads the silence as armour and the noise as machinery." Reviewer 1 on
 * this file specifically: "panel lines only (no proud greebles above 0.3 m)".
 *
 * The predecessor, `greebleLine`, was a constant-density scatter run along a
 * line — a uniform Poisson process, the same mathematical mistake `dressHull`
 * makes on the capitals — and every hull ran it three to eight times over open
 * skin. This is its replacement and it is deliberately hard to misuse:
 *
 *   - it is a KNOT, not a line: everything lands inside one (hw, hh, hd) box
 *     whose footprint is capped by the caller at roughly 12% of hull length,
 *     so it can never become a carpet;
 *   - each builder may call it at most three times, at the three sites where a
 *     real aircraft actually exposes machinery — the INTAKE shoulder, the
 *     SPINE root and the ENGINE block;
 *   - it emits a single cowl pad, then stacks 3-6 boxes and one pipe run on
 *     top of it, so the cluster is a legible object rather than confetti.
 *
 * Determinism: sizes and offsets are drawn from `c.rng`, so sister ships of the
 * same class differ in their machinery but never in their silhouette.
 */
function cluster(
  c: Ctx,
  x: number, y: number, z: number,
  hw: number, hh: number, hd: number,
  up: 'x' | 'y' | 'z',
  mask: Mask = M.graphite,
  ao = 0.55,
): void {
  if (!c.hero) return;                       // machinery is a hero-range read
  const a = c.a, rng = c.rng;
  const ux = up === 'x' ? 1 : 0, uy = up === 'y' ? 1 : 0, uz = up === 'z' ? 1 : 0;
  const sgn = hh < 0 || hw < 0 || hd < 0 ? -1 : 1;
  const aw = Math.abs(hw), ah = Math.abs(hh), ad = Math.abs(hd);
  // Cowl pad: the cluster sits ON something, which is what stops it reading as
  // blocks floating on skin.
  const pad = 0.34;
  boxSolid(a, x + ux * pad * sgn * ah, y + uy * pad * sgn * ah, z + uz * pad * sgn * ah,
    ux ? ah * pad : aw, uy ? ah * pad : ah, uz ? ah * pad : ad, M.graphite, ao * 0.8);
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    // Positions are stratified along the long axis of the box so the knot has
    // internal rhythm without spreading past its own footprint.
    const t = (i + 0.5) / n + rng.sign() * (0.28 / n);
    const ox = ux ? 0 : (uz ? rng.sign() * aw * 0.45 : (t - 0.5) * 2 * aw * 0.8);
    const oz = uz ? 0 : (t - 0.5) * 2 * ad * 0.8;
    const oy = uy ? 0 : rng.sign() * ah * 0.4;
    const h = ah * rng.range(0.55, 1.0) * sgn;
    const w = aw * rng.range(0.16, 0.34);
    const d = ad * rng.range(0.14, 0.30);
    boxSolid(a,
      x + (ux ? h * 0.6 : ox), y + (uy ? h * 0.6 : oy), z + (uz ? h * 0.6 : oz),
      ux ? Math.abs(h) * 0.6 : w, uy ? Math.abs(h) * 0.6 : (uz ? h * 0.5 : ah * 0.55),
      uz ? Math.abs(h) * 0.6 : d,
      i === 0 ? M.mech : mask, ao * rng.range(0.82, 1));
  }
  // One pipe run tying the knot together lengthwise.
  const pr = Math.min(aw, ah) * 0.28;
  if (up === 'y') {
    strut(a, x - aw * 0.5, y + ah * 0.7 * sgn, z - ad * 0.7, x + aw * 0.5, y + ah * 0.8 * sgn, z + ad * 0.7,
      pr, pr, 4, M.mech, ao * 0.9, Math.PI * 0.25);
  } else if (up === 'x') {
    strut(a, x + ah * 0.7 * sgn, y - aw * 0.4, z - ad * 0.7, x + ah * 0.8 * sgn, y + aw * 0.4, z + ad * 0.7,
      pr, pr, 4, M.mech, ao * 0.9, Math.PI * 0.25);
  }
}

/** Torpedo/missile round with a nose cone and tail fins. Tip lands on `z`. */
function round(
  c: Ctx, x: number, y: number, z: number, len: number, r: number, fins: boolean,
): void {
  const a = c.a;
  a.push(trs(x, y, z));
  tube(a, decRings([
    { z: -len, r: r * 0.55, ao: 0.5 },
    { z: -len * 0.88, r: r, ao: 0.6 },
    { z: -len * 0.14, r: r, ao: 0.85 },
    { z: 0, r: r * 0.12, ao: 1 },
  ], c), c.fine, M.ord, 0.8, false, 0, true, true);
  if (c.hero && fins) {
    for (let i = 0; i < 2; i++) {
      const ang = Math.PI * (0.25 + i);
      a.push(trs(0, 0, 0, 0, 0, ang));
      boxSolid(a, r * 1.35, 0, -len * 0.86, r * 0.75, r * 0.06, len * 0.11, M.ord, 0.55);
      a.pop();
    }
  }
  a.pop();
}

/**
 * Grid of recessed launch tubes on a forward-facing block face — the missile
 * corvette's identity. Cell mouths are real holes with a dark throat.
 */
function cellArray(
  c: Ctx, x: number, y: number, z: number, cols: number, rows: number,
  pitch: number, r: number, depth: number,
): void {
  const a = c.a;
  if (!c.mid) return; // LOD2: the launcher block reads, the cells do not
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const cx = x + (i - (cols - 1) * 0.5) * pitch;
      const cy = y + (j - (rows - 1) * 0.5) * pitch;
      a.push(trs(cx, cy, z));
      tube(a, [
        { z: 0, r: r, ao: 0.5 },
        { z: 0.04, r: r * 1.08, ao: 0.65 },
      ], 6, M.graphite, 0.6);
      tube(a, [
        { z: -depth, r: r * 0.9, ao: 0.15 },
        { z: 0, r: r, ao: 0.35 },
      ], 6, M.darkMech, 0.25, true);
      disc(a, -depth, r * 0.9, 6, M.darkMech, 0.12, 1);
      a.pop();
    }
  }
}

// ---------------------------------------------------------------------------
// SCOUT — "Probe Scout", 19 m.
//
// ONE OUTLINE IDEA: a NEEDLE. Everything is subordinated to length-over-mass —
// a slim fuselage that is barely wider than its own probe, a 3 m sensor spike
// off the nose, a tall single fin at the extreme stern, a big canted scanner
// panel standing clear of the spine on a stalk, and two pencil engine booms
// held off the flanks with visible sky between them and the hull.
//
// CRITIQUE (round 2, silhouette, measured): the old Scout's cutout scored IoU
// 0.740 against the MissileCorvette and 0.732 against the AssaultCorvette —
// three classes sharing one lozenge. The mass has been taken OUT (max half
// beam 1.34 -> 1.10, boom half beam 0.86 -> 0.60) rather than added elsewhere,
// because the fix for a blobby cutout is subtraction.
//
// DETAIL SITES (exactly three, per the round-2 headline finding): the boom
// intake shoulder, the spine root under the scanner mast, and the boom engine
// block. The whole of the fuselage flank, the wing surfaces and the dorsal
// deck are bare loft.
// ---------------------------------------------------------------------------

function buildScout(c: Ctx): void {
  const a = c.a, b = c.bev;

  // --- central fuselage: narrow, tall, faceted ---
  // The aft station carries a full-girth TAIL BLOCK of faction colour, fringed
  // by a paintEdge station so the block's forward boundary frays instead of
  // ruling a hard line across the hull.
  loft(a, dec([
    { z: -7.9, prof: rectProf(0.66, 0.62, 0.2 * b), ao: 0.68, mask: M.paint },
    { z: -6.1, prof: rectProf(0.86, 0.80, 0.26 * b), ao: 0.8, mask: M.paintEdge },
    { z: -3.2, prof: rectProf(1.04, 0.94, 0.32 * b), ao: 0.94 },
    { z: -0.4, prof: rectProf(1.10, 0.98, 0.32 * b), ao: 1 },
    { z: 2.6, prof: rectProf(0.96, 0.84, 0.28 * b), ao: 1 },
    { z: 4.9, prof: rectProf(0.66, 0.58, 0.22 * b), ao: 1 },
    { z: 6.5, prof: rectProf(0.36, 0.34, 0.12 * b), ao: 0.95 },
  ], c), M.hull, 1);

  // --- long sensor probe: the single strongest silhouette cue ---
  tube(a, decRings([
    { z: 6.3, r: 0.30, ao: 0.9 },
    { z: 7.2, r: 0.22, ao: 1 },
    { z: 7.45, r: 0.34, ao: 1, mask: M.graphite },
    { z: 7.7, r: 0.19, ao: 1 },
    { z: 9.5, r: 0.05, ao: 1 },
  ], c), c.fine, M.mech, 0.95, false, 0, false, true);

  // --- dorsal sensor mast + canted scanning panel ---
  // Kept at EVERY LOD and now standing 1.2 m clear of the spine on a narrow
  // stalk, so the cutout has real sky UNDER the panel. No other strikecraft has
  // a flat plate hovering off its back, which is what makes the Scout the one
  // fighter you can name from its shadow.
  boxBev(a, 0, 1.75, -1.4, 0.22, 1.35, 0.55, 0.09 * b, M.graphite, 0.6);
  a.push(trs(0, 3.55, -1.6, -0.34, 0, 0));
  boxBev(a, 0, 0, 0, 1.45, 0.15, 1.45, 0.10 * b, M.paint, 0.95);
  a.pop();

  // --- cockpit ---
  canopy(c, 1.9, 4.6, 0.56, 0.80, 0.42);

  // --- canards: small forward-swept planes, moved forward of the booms so the
  //     plan view keeps an open channel between fuselage and boom ---
  mirrorX(a, () => {
    wing(c, {
      x: 0.98, y: -0.05, z: 3.0, span: 2.7,
      rootChord: 2.8, tipChord: 1.3, rootThick: 0.42, tipThick: 0.3,
      sweep: -1.3, dihedral: 0.55, segments: 3,
      mask: M.hull, tipMask: M.paint, ao: 0.95, bev: 0.14 * b,
    });
    navPod(c, 3.72, 0.5, 2.6, 0.085);
  });

  // --- engine booms on thin outrigger stalks (mounts: +-2.1, 0.1, -8.2) ---
  // Half beam 0.60 against a fuselage half beam of 1.10 at x = 2.1 leaves a
  // 0.4 m channel of open sky down each side of the hull.
  mirrorX(a, () => {
    strut(a, 1.0, 0.1, -3.4, 2.1, 0.1, -3.9, 0.17, 0.2, 4, M.mech, 0.55, Math.PI * 0.25);
    // Second stalk is LOD0/1 only — at LOD2 a 0.15 m strut is a third of a
    // pixel and it costs 12 of the 180-triangle fighter budget.
    if (c.mid) strut(a, 1.0, 0.05, 0.2, 2.1, 0.1, -0.4, 0.15, 0.18, 4, M.mech, 0.55, Math.PI * 0.25);
    // Aft boom station is painted, so the exhaust collar is a masked BLOCK that
    // costs no triangles and cannot be decimated away at LOD1/2.
    loft(a, dec([
      { z: -8.3, prof: rectProf(0.56, 0.52, 0.16 * b), ao: 0.6, mask: M.paint },
      { z: -6.6, prof: rectProf(0.60, 0.56, 0.18 * b), ao: 0.75, mask: M.paintEdge },
      { z: -1.6, prof: rectProf(0.58, 0.54, 0.18 * b), ao: 0.9 },
      { z: 0.6, prof: rectProf(0.46, 0.44, 0.14 * b), ao: 1 },
      { z: 1.5, prof: rectProf(0.28, 0.26, 0.08 * b), ao: 1 },
    ], c).map((s) => ({ ...s, prof: offProf(s.prof, 2.1, 0.1) })), M.hull, 0.9);
    intake(c, 2.1, 0.1, 1.5, 0.26, 0.8);
    nozzle(c, 2.1, 0.1, -8.2, 0.85);
    // DETAIL SITE 1 — intake shoulder. DETAIL SITE 2 — engine block.
    cluster(c, 2.1, 0.62, 0.3, 0.34, 0.16, 0.7, 'y', M.mech, 0.7);
    cluster(c, 2.1, 0.62, -6.4, 0.34, 0.18, 1.0, 'y', M.graphite, 0.6);
  });

  // --- single tall tail fin: the aft counterweight to the nose spike ---
  a.push(trs(0, 0, 0, 0, 0, Math.PI * 0.5));
  wing(c, {
    x: 0, y: 0, z: -6.0, span: 3.6,
    rootChord: 4.4, tipChord: 1.25, rootThick: 0.34, tipThick: 0.14,
    sweep: -2.9, dihedral: 0, segments: 3,
    mask: M.hull, tipMask: M.paint, ao: 0.92, bev: 0.12 * b,
  });
  a.pop();

  // --- ventral fins + hardpoints (+-1.6, -0.2, 7.5) ---
  if (c.mid) {
    mirrorX(a, () => {
      boxBev(a, 0.82, -1.05, -4.6, 0.1, 0.62, 1.3, 0.07 * b, M.paintEdge, 0.7);
      boxBev(a, 1.55, -0.25, 6.3, 0.30, 0.28, 1.5, 0.12 * b, M.graphite, 0.75);
      barrel(c, 1.6, -0.2, 7.5, 1.9, 0.13);
    });
  }

  if (c.hero) {
    // DETAIL SITE 3 — spine root under the scanner mast. Nothing else is
    // allowed on the dorsal deck, the flanks or the belly: they are armour.
    cluster(c, 0, 0.94, -3.6, 0.5, 0.20, 1.5, 'y', M.graphite, 0.7);
    mirrorX(a, () => rcs(c, 0.9, 0.44, 5.6, 0.18, 'x'));
    whip(c, 0, 1.0, -5.0, 0, 1.9, -3.9, 0.045);
    navPod(c, 0, 1.35, 3.0, 0.075);
  }
}

// ---------------------------------------------------------------------------
// INTERCEPTOR — "Talon", 23 m.
//
// CRITIQUE (silhouette / hull-Interceptor.png): "an unreadable dark smear ...
// as a black cutout it is a generic delta with two engine dots. Interceptors
// are read at 30 px — the outline has to have four or five distinct convex
// events at that size."
//
// The rebuilt outline carries SIX convex events, all of them silhouette-owning
// volumes present at every LOD:
//   1. chisel nose + chin gun fairing (forward-low mass)
//   2. raised canopy blister on its own fairing (the only dorsal bump forward)
//   3. forward-swept wings with dihedral, tips ABOVE the fuselage line
//   4. splayed engine booms — the plan view is a V, not a solid triangle
//   5. dorsal ram intake between the booms (aft-high mass)
//   6. twin canted tail fins outboard of the intake
// ---------------------------------------------------------------------------

/**
 * Nacelle centreline x for a given z. The boom's exhaust end sits exactly on
 * the SHIP_SPECS engine mount (+-2.6) and the intake end tucks inboard, so the
 * pair splays ~7 degrees outboard going aft and the plan silhouette gains a
 * notch either side of the tail — see critique point "splay the twin engine
 * booms outboard so the plan view is not a solid triangle".
 */
function talonBoomX(z: number): number {
  return 2.6 - (z + 9.7) * 0.118;
}

function buildInterceptor(c: Ctx): void {
  const a = c.a, b = c.bev;

  // --- fuselage: chisel-nosed, flat-sided, widest at the wing box ---
  // The two forward stations carry M.paint: a NOSE FLASH covering the whole
  // forward 3.9 m of hull as a solid block, not a stripe (critique: "team paint
  // as masked blocks ... nose flashes, tail blocks, wing bands").
  loft(a, dec([
    { z: -9.9, prof: rectProf(1.0, 0.88, 0.28 * b), ao: 0.6, mask: M.paint },
    { z: -7.4, prof: rectProf(1.36, 1.14, 0.34 * b), ao: 0.76, mask: M.paintEdge },
    { z: -3.4, prof: rectProf(1.66, 1.34, 0.4 * b), ao: 0.92 },
    { z: 0.4, prof: rectProf(1.72, 1.36, 0.42 * b), ao: 1 },
    { z: 4.2, prof: rectProf(1.5, 1.12, 0.36 * b), ao: 1 },
    { z: 7.6, prof: rectProf(1.06, 0.8, 0.28 * b), ao: 1 },
    { z: 10.0, prof: rectProf(0.6, 0.5, 0.2 * b), ao: 0.95, mask: M.paint },
    { z: 11.5, prof: rectProf(0.26, 0.22, 0.09 * b), ao: 0.9, mask: M.paint },
  ], c), M.hull, 1);

  // --- dorsal ram intake between the booms: a FAIRED duct, not a box.
  //
  // CRITIQUE (round 2, surface/strikecraft.ts): "the same slab superstructure
  // box sitting on its spine ... delete the dorsal box." The duct earned its
  // keep as a silhouette event, so it stays — but it is now blended: the aft
  // end tapers to nothing instead of ending in a wall, the section is narrower
  // than the boom gap it fills, and it sits 0.14 m lower, so the dorsal
  // envelope is a continuous spine rather than a deckhouse dropped on a hull.
  loft(a, dec([
    { z: -9.4, prof: rectProf(0.30, 0.10, 0.05 * b), ao: 0.45 },
    { z: -7.4, prof: rectProf(0.52, 0.30, 0.12 * b), ao: 0.55 },
    { z: -4.0, prof: rectProf(0.64, 0.46, 0.16 * b), ao: 0.65 },
    { z: -0.6, prof: rectProf(0.68, 0.50, 0.18 * b), ao: 0.75 },
    { z: 2.0, prof: rectProf(0.60, 0.44, 0.16 * b), ao: 0.85 },
  ], c).map((s) => ({ ...s, prof: offProf(s.prof, 0, 1.20) })), M.graphite, 0.7);
  if (c.mid) intake(c, 0, 1.68, 2.0, 0.40, 1.3);
  // DETAIL SITE 1 — the spine root behind the ram intake. Everything forward of
  // z = -2 on the dorsal deck stays bare armour.
  cluster(c, 0, 1.66, -5.2, 0.42, 0.20, 1.9, 'y', M.mech, 0.6);

  // --- cockpit: a RAISED blister on its own fairing, not a flush window.
  //     The critique called out "no readable canopy"; the fairing gives the
  //     glass a dark frame and puts a bump in the dorsal outline. ---
  if (c.mid) boxBev(a, 0, 1.14, 6.2, 0.98, 0.42, 2.0, 0.2 * b, M.hull, 0.92);
  canopy(c, 4.6, 8.2, 0.82, 1.5, 0.62);
  if (c.mid) {
    loft(a, [
      { z: 2.4, prof: canopyProf(0.86, 0.44, 1.5) },
      { z: 4.6, prof: canopyProf(0.9, 0.6, 1.5) },
    ], M.hull, 0.85, true, false);
  }

  // --- forward-swept main wings ---
  mirrorX(a, () => {
    wing(c, {
      // Root chord lengthened 6.6 -> 7.9 so the wing meets the fuselage over a
      // long fillet instead of needing the separate leading-edge root extension
      // this class used to carry. That extension was a second lofted foil lying
      // on top of the first, and the two of them put a run of chamfer facets
      // across the one large smooth panel a fighter wing is supposed to be:
      // measured 24 px tile CoV on the Talon rose 0.46 -> 0.57 once it went.
      x: 1.5, y: -0.15, z: -0.6, span: 5.0,
      rootChord: 7.9, tipChord: 2.6, rootThick: 0.9, tipThick: 0.34,
      sweep: 2.2, dihedral: 1.15, segments: 3,
      mask: M.hull, tipMask: M.paint, ao: 0.95, bev: 0.2 * b,
    });
    // Wing-tip: canted winglet + pod + nav light. The winglet is kept at LOD2
    // because it is the outermost point of the whole silhouette.
    a.push(trs(6.5, 1.1, 1.35, 0, 0, -0.42));
    boxBev(a, 0, 0.86, 0, 0.14, 1.0, 1.2, 0.09 * b, M.paint, 0.95);
    a.pop();
    if (c.mid) boxBev(a, 6.5, 1.05, 0.5, 0.26, 0.26, 1.5, 0.1 * b, M.graphite, 0.85);
    navPod(c, 6.5, 1.05, 2.05, 0.095);
    // One pylon stub under the wing. The wing surface itself carries nothing:
    // it is one of the three or four large smooth shell panels the round-2
    // critique asked this class to be built from.
    if (c.mid) boxBev(a, 3.4, -0.55, 0.2, 0.4, 0.2, 1.1, 0.08 * b, M.mech, 0.6);
  });

  // --- twin splayed nacelles (exhausts land on the mounts +-2.6, 0.15, -9.6) ---
  mirrorX(a, () => {
    // The aft station is painted: the exhaust collar becomes a masked BLOCK
    // around the whole boom, which costs nothing and survives decimation, and
    // is exactly the "large team-colour field" the fleet-range read needs.
    const nz: Array<[number, number, number, number, Mask | undefined]> = [
      [-9.7, 1.06, 1.0, 0.55, M.paint],
      [-7.8, 1.18, 1.12, 0.7, M.paintEdge],
      [-3.0, 1.1, 1.06, 0.85, undefined],
      [1.0, 0.9, 0.9, 0.95, undefined],
      [3.0, 0.62, 0.62, 1, undefined],
    ];
    loft(a, dec(nz.map(([z, hw, hh, ao, mask]) => ({
      z, ao, mask, prof: offProf(rectProf(hw, hh, 0.3 * b), talonBoomX(z), 0.15),
    })), c), M.hull, 0.9);
    intake(c, talonBoomX(3.0), 0.15, 3.0, 0.58, 1.5);
    nozzle(c, 2.6, 0.15, -9.6, 1.05);
    // The one team-colour block on the boom flank: 3 m long, fringed at both
    // ends so the paint boundary frays rather than ruling a line down the hull.
    paintPlate(c, talonBoomX(-4.6) + 1.02, 0.3, -4.6, 0.1, 0.62, 1.5);
    // DETAIL SITE 2 — engine block. Nothing else on the boom.
    cluster(c, talonBoomX(-6.8), 1.14, -6.8, 0.42, 0.22, 1.4, 'y', M.graphite, 0.6);
  });

  // --- twin canted tail fins, outboard of the dorsal intake ---
  mirrorX(a, () => {
    a.push(trs(1.95, 1.0, -7.0, 0, 0, -0.62));
    wing(c, {
      x: 0, y: 0, z: 0, span: 3.0,
      rootChord: 5.6, tipChord: 1.8, rootThick: 0.44, tipThick: 0.3,
      sweep: -3.4, dihedral: 0, segments: 3,
      mask: M.hull, tipMask: M.paint, ao: 0.9, bev: 0.14 * b,
    });
    a.pop();
  });

  // --- chin gun fairing + barrels at (+-2.4, -0.35, 8.4) ---
  boxBev(a, 0, -0.78, 7.0, 1.2, 0.46, 2.1, 0.16 * b, M.graphite, 0.7);
  if (c.mid) {
    mirrorX(a, () => {
      boxBev(a, 2.4, -0.35, 6.4, 0.36, 0.34, 1.6, 0.12 * b, M.hullWorn, 0.8);
      barrel(c, 2.4, -0.35, 8.4, 2.4, 0.17);
    });
  }

  if (c.hero) {
    // DETAIL SITE 3 — the chin intake shoulder under the gun fairing.
    cluster(c, 0, -1.0, 4.4, 0.9, 0.2, 1.3, 'y', M.mech, 0.55);
    mirrorX(a, () => rcs(c, 1.15, 0.9, 9.2, 0.22, 'x'));
    whip(c, 0, 1.72, -4.4, 0, 2.5, -1.6, 0.05);
    navPod(c, 0, 1.48, 8.2, 0.085);
  }
}

// ---------------------------------------------------------------------------
// BOMBER — "Lance", 27 m.
//
// ONE OUTLINE IDEA: a FLAT DELTA WITH ITS LOAD HUNG UNDER IT. Where the Talon
// is a dart and the Probe is a needle, the Lance is a plank: a wide low wing
// carried on a squat armoured body, a stepped brow hunched over the cockpit,
// and — the event no other class owns — four torpedoes slung on pylons far
// enough BELOW the wing line that open sky shows between the round and the
// wing it hangs from. That gap is what stops the cutout being a lozenge.
//
// CRITIQUE (round 2, silhouette): the old Lance measured only 2 convex outline
// events at portrait framing against the reference's four to five. The brow
// step, the dropped wing, the underslung ordnance and the twin canted outboard
// fins are four, and all four survive to LOD2.
//
// DETAIL SITES: dorsal spine root, engine block, ordnance-rack cradle line.
// The wing panels, the flanks and the belly are bare armour.
// ---------------------------------------------------------------------------

function buildBomber(c: Ctx): void {
  const a = c.a, b = c.bev;

  // --- fuselage: wide, flat, armoured. Deliberately squat vs the interceptor.
  loft(a, dec([
    // FLAT. Max half depth 1.12 against a half beam of 2.95 — a 2.6:1 plank,
    // where the Hammer is 1.3:1 and the Talon 1.25:1. Aspect ratio is doing as
    // much silhouette work here as any appendage: measured cutout IoU against
    // the Hammer falls with every centimetre taken off this number.
    { z: -11.4, prof: rectProf(2.3, 0.92, 0.30 * b), ao: 0.58 },
    { z: -8.4, prof: rectProf(2.66, 1.06, 0.36 * b), ao: 0.72 },
    { z: -3.0, prof: rectProf(2.95, 1.12, 0.40 * b), ao: 0.9 },
    { z: 2.4, prof: rectProf(2.85, 1.06, 0.38 * b), ao: 1 },
    { z: 7.0, prof: rectProf(2.25, 0.92, 0.32 * b), ao: 1 },
    { z: 10.8, prof: rectProf(1.65, 0.78, 0.26 * b), ao: 1 },
    // BLUNT nose. The Interceptor and the Scout both taper to a point; the
    // Lance must not, or the three fighter classes share one cutout at 20 px.
    { z: 13.5, prof: rectProf(1.38, 0.66, 0.22 * b), ao: 0.9 },
  ], c), M.hull, 1);

  // --- bolt-on nose armour: a stepped brow over the cockpit, in faction colour
  //     so the bomber's forward third is ONE contiguous paint block. The aft
  //     station is paintEdge, so the block's trailing boundary frays into the
  //     bare hull instead of ruling a hard line across the spine. Raised and
  //     deepened this round: the brow now stands 0.5 m clear of the dorsal line
  //     so it is a genuine step in the cutout, not a decal. ---
  loft(a, dec([
    { z: 7.9, prof: rectProf(2.0, 0.72, 0.22 * b), mask: M.paintEdge },
    { z: 9.2, prof: rectProf(1.92, 0.80, 0.22 * b) },
    { z: 10.6, prof: rectProf(1.58, 0.60, 0.18 * b) },
    { z: 13.3, prof: rectProf(1.22, 0.40, 0.14 * b) },
  ], c).map((s) => ({ ...s, prof: offProf(s.prof, 0, 1.08), ao: 0.95 })), M.paint, 0.95);

  // --- broad delta wing, dropped below the fuselage centreline so the body
  //     stands proud of it and the pylons have clear air under them ---
  mirrorX(a, () => {
    wing(c, {
      x: 2.3, y: -0.85, z: -1.6, span: 7.2,
      rootChord: 13.2, tipChord: 3.4, rootThick: 1.2, tipThick: 0.4,
      sweep: -3.4, dihedral: 0.35, segments: 3,
      mask: M.hull, tipMask: M.paint, ao: 0.95, bev: 0.26 * b,
    });
    // Outboard fin standing on the wing — breaks the flat delta silhouette.
    // Canted 0.34 rad outboard and 40% taller than round 1 so the pair reads as
    // two verticals at 20 px rather than a thickening of the tip.
    a.push(trs(6.9, -0.5, -3.6, 0, 0, -0.34));
    wing(c, {
      x: 0, y: 0, z: 0, span: 3.8,
      rootChord: 4.2, tipChord: 1.6, rootThick: 0.42, tipThick: 0.3,
      sweep: -1.6, dihedral: 0, segments: 3,
      mask: M.hull, tipMask: M.paint, ao: 0.92, bev: 0.12 * b,
    });
    a.pop();
    navPod(c, 9.2, -0.6, -1.4, 0.10);
  });

  // --- external torpedo racks: tips land exactly on (+-3.2, -1.4, 5.0).
  //     Dropped 0.55 m this round so daylight shows between the round and the
  //     wing above it — the Lance's unique cutout event. ---
  mirrorX(a, () => {
    // Pylon down from the wing root box. LOD0/1 only: at LOD2 it is a 0.3 m
    // sliver behind a torpedo and it costs 12 of the 180-triangle budget.
    if (c.mid) boxBev(a, 3.2, -1.6, 2.4, 0.28, 0.9, 2.6, 0.12 * b, M.graphite, 0.55);
    round(c, 3.2, -2.35, 5.0, 6.4, 0.5, true);
    if (c.mid) {
      // Second round of the pair, staggered aft and outboard.
      boxBev(a, 4.5, -1.5, 1.2, 0.26, 0.8, 2.2, 0.1 * b, M.graphite, 0.5);
      round(c, 4.5, -2.22, 3.6, 5.6, 0.44, true);
    }
    // DETAIL SITE 1 — the rack cradle line, the one busy strip on the belly.
    cluster(c, 3.6, -0.95, 2.4, 0.6, -0.2, 2.2, 'y', M.mech, 0.5);
  });

  // --- ventral bomb bay: a recessed well with a raised door lip ---
  // ROUND 2: the pair of 7 m door leaves that used to sit inside this well are
  // gone. They were two flat slabs across the largest uninterrupted panel on
  // the belly, and the belly is armour.
  if (c.mid) boxBev(a, 0, -1.10, 0.6, 1.24, 0.2, 3.6, 0.1 * b, M.graphite, 0.35);

  // --- armoured cockpit, set AFT of the brow so the dorsal envelope reads
  //     brow -> notch -> canopy -> turret -> rudder: four convex events on a
  //     hull the round-2 review measured only two on ---
  canopy(c, 4.9, 7.6, 0.72, 0.86, 0.46);

  // --- twin heavy engines (mounts +-3.0, 0.2, -11.0) ---
  mirrorX(a, () => {
    // Painted aft station = exhaust collar as a masked block, zero triangles.
    loft(a, dec([
      { z: -11.1, prof: rectProf(1.4, 1.3, 0.3 * b), ao: 0.5, mask: M.paint },
      { z: -9.0, prof: rectProf(1.55, 1.44, 0.34 * b), ao: 0.68, mask: M.paintEdge },
      { z: -4.6, prof: rectProf(1.45, 1.35, 0.32 * b), ao: 0.85 },
      { z: -0.6, prof: rectProf(1.1, 1.05, 0.26 * b), ao: 0.95 },
    ], c).map((s) => ({ ...s, prof: offProf(s.prof, 3.0, 0.2) })), M.hull, 0.9);
    nozzle(c, 3.0, 0.2, -11.0, 1.25);
    // DETAIL SITE 2 — engine block.
    cluster(c, 3.0, 1.5, -7.0, 0.7, 0.26, 2.0, 'y', M.mech, 0.6);
  });

  // --- aft avionics block between the nacelles, plus a tall rudder. The
  //     rudder is the fourth convex event on the dorsal envelope (brow,
  //     canopy, turret blister, rudder) and is kept at every LOD. ---
  if (c.mid) boxBev(a, 0, 0.25, -12.2, 1.55, 0.9, 1.35, 0.28 * b, M.hull, 0.62);
  boxBev(a, 0, 1.95, -12.0, 0.3, 1.6, 1.3, 0.14 * b, M.paintEdge, 0.8);

  // --- dorsal: radiators, turret blister ---
  if (c.mid) {
    mirrorX(a, () => radiator(c, 1.5, 1.35, -6.0, 1.0, 2.4, 2, -0.28));
  }
  if (c.mid) boxBev(a, 0, 1.32, 1.4, 0.66, 0.42, 1.2, 0.14 * b, M.mech, 0.75);

  if (c.hero) {
    // DETAIL SITE 3 — dorsal spine root between the radiators.
    cluster(c, 0, 1.14, -8.0, 0.8, 0.26, 1.6, 'y', M.graphite, 0.6);
    mirrorX(a, () => rcs(c, 1.6, 0.7, 12.0, 0.26, 'x'));
    whip(c, 0.4, 1.2, -4.4, 0.5, 2.1, -2.6, 0.055);
    navPod(c, 0, 3.7, -12.0, 0.10);
  }
}

// ---------------------------------------------------------------------------
// ASSAULT CORVETTE — "Hammer", 44 m.
//
// ONE OUTLINE IDEA: a HAMMERHEAD. The forward third is deliberately the widest
// part of the ship — two 4 m gun sponsons cantilevered out past the hull line
// at the shoulders, with barrels reaching further forward still — and the hull
// then tapers hard aft into a narrow tail spine with the two engine nacelles
// standing off it on trusses, so the aft half of the cutout is pierced by two
// bands of open sky.
//
// CRITIQUE (round 2, silhouette, measured): the Hammer's cutout scored IoU
// 0.759 against the Quiver and 0.732 against the Scout — the worst pair in the
// set. Hammer and Quiver are now built on opposite plans: Hammer is WIDE
// FORWARD and skeletal aft; Quiver is narrow throughout with two tall towers
// on the shoulders. At 16 px one is a T and the other is a battlement.
//
// DETAIL SITES: sponson barbette root, engine block, aft truss bay.
// ---------------------------------------------------------------------------

function buildAssaultCorvette(c: Ctx): void {
  const a = c.a, b = c.bev;

  // --- main hull: heavy forward slab tapering into a narrow tail spine ---
  // Aft station carries a painted tail block fringed by a paintEdge station.
  loft(a, dec([
    { z: -15.0, prof: rectProf(1.25, 1.25, 0.26 * b), ao: 0.55, mask: M.paint },
    { z: -12.4, prof: rectProf(1.5, 1.45, 0.3 * b), ao: 0.62, mask: M.paintEdge },
    { z: -8.0, prof: rectProf(1.85, 1.85, 0.38 * b), ao: 0.78 },
    { z: -2.0, prof: rectProf(3.3, 2.6, 0.6 * b), ao: 0.92 },
    { z: 2.0, prof: rectProf(3.8, 2.85, 0.66 * b), ao: 1 },
    { z: 8.0, prof: rectProf(3.5, 2.6, 0.6 * b), ao: 1 },
    { z: 13.0, prof: rectProf(2.6, 2.0, 0.48 * b), ao: 1 },
    { z: 17.5, prof: rectProf(1.7, 1.4, 0.36 * b), ao: 0.95 },
    { z: 22.0, prof: rectProf(0.7, 0.62, 0.2 * b), ao: 0.9 },
  ], c), M.hull, 1);

  // --- ram prow: an armour wedge bolted over the nose ---
  if (c.mid) {
    loft(a, dec([
      { z: 10.5, prof: rectProf(2.5, 1.05, 0.34 * b), ao: 0.9, mask: M.paintEdge },
      { z: 15.0, prof: rectProf(1.9, 0.85, 0.28 * b), ao: 0.95 },
      { z: 19.0, prof: rectProf(1.15, 0.6, 0.2 * b), ao: 1 },
      { z: 21.8, prof: rectProf(0.42, 0.32, 0.1 * b), ao: 1 },
    ], c).map((s) => ({ ...s, prof: offProf(s.prof, 0, 0.5) })), M.paint, 0.95);
    loft(a, dec([
      { z: 10.5, prof: rectProf(2.3, 0.8, 0.3 * b), ao: 0.6 },
      { z: 16.0, prof: rectProf(1.6, 0.6, 0.22 * b), ao: 0.7 },
      { z: 20.5, prof: rectProf(0.7, 0.34, 0.12 * b), ao: 0.75 },
    ], c).map((s) => ({ ...s, prof: offProf(s.prof, 0, -1.3) })), M.hullWorn, 0.7);
  }

  // --- dorsal command block: LOW and wide, so nothing on this class competes
  //     with the Quiver's towers for the same read ---
  boxBev(a, 0, 2.85, 5.6, 2.1, 0.85, 4.2, 0.42 * b, M.hull, 0.95);
  canopy(c, 7.2, 9.6, 1.0, 3.45, 0.5);
  if (c.mid) {
    blister(c, 0, 3.3, -2.0, 0.9, 0.6, M.graphite);
    boxBev(a, 0, 3.4, -8.4, 0.5, 1.0, 1.4, 0.16 * b, M.mech, 0.6);
  }

  // --- HAMMERHEAD sponsons + dorsal gun pods at (+-4.6, 2.2, 9.0), size 1.6.
  //     The sponson mass now runs out to x = 6.9 against a hull half beam of
  //     3.5 at the same station, so 3.4 m of it is cantilevered clear of the
  //     hull line and the plan view is a T. ---
  mirrorX(a, () => {
    boxBev(a, 4.9, 2.2, 8.6, 2.0, 1.05, 3.8, 0.32 * b, M.paint, 0.85);
    boxBev(a, 5.3, 0.4, 8.2, 1.5, 0.95, 2.8, 0.26 * b, M.hull, 0.7);
    // Barbette ring centred on the hardpoint, twin barrels forward of it.
    a.push(trs(4.6, 2.2, 9.0));
    tube(a, [
      { z: -1.5, r: 1.5, ao: 0.6 },
      { z: -0.5, r: 1.55, ao: 0.75 },
      { z: 0.1, r: 1.25, ao: 0.9 },
    ], c.sides, M.graphite, 0.8, false, 0, false, true);
    a.pop();
    barrel(c, 4.1, 2.35, 11.6, 2.9, 0.24);
    barrel(c, 5.1, 2.35, 11.6, 2.9, 0.24);
    // Sponson nav light survives to LOD2, so at fleet range the Hammer reads
    // as a wide dark slab with two shoulder sparks well outboard of the hull.
    navPod(c, 6.5, 2.6, 6.4, 0.11);
    // DETAIL SITE 1 — the barbette root, the busiest square metre on the ship.
    cluster(c, 4.6, 3.25, 7.4, 1.1, 0.3, 1.8, 'y', M.mech, 0.6);
  });

  // --- ventral gun pods at (+-3.9, -2.4, 2.0), deliberately smaller than the
  //     dorsal pair so the class reads top-heavy ---
  if (c.mid) {
    mirrorX(a, () => {
      boxBev(a, 3.5, -2.2, 1.4, 1.0, 0.85, 3.0, 0.26 * b, M.paintEdge, 0.8);
      a.push(trs(3.9, -2.4, 2.0));
      tube(a, [
        { z: -1.4, r: 1.4, ao: 0.5 },
        { z: -0.4, r: 1.45, ao: 0.65 },
        { z: 0.1, r: 1.15, ao: 0.8 },
      ], c.sides, M.graphite, 0.7, false, 0, false, true);
      a.pop();
      barrel(c, 3.55, -2.4, 4.4, 2.6, 0.22);
      barrel(c, 4.35, -2.4, 4.4, 2.6, 0.22);
    });
  }

  // --- engines (mounts +-4.4, 0.4, -18.0) on nacelles standing OFF the tail
  //     spine. Nacelle inner face x = 2.5 against a tail half beam of 1.9-2.5,
  //     so there is a real channel of sky down each side of the aft hull —
  //     the round-2 note that every candidate cutout was a solid blob. ---
  mirrorX(a, () => {
    loft(a, dec([
      { z: -18.2, prof: rectProf(1.95, 1.95, 0.4 * b), ao: 0.5, mask: M.paint },
      { z: -15.0, prof: rectProf(2.05, 2.05, 0.44 * b), ao: 0.65, mask: M.paintEdge },
      { z: -8.0, prof: rectProf(1.45, 1.6, 0.34 * b), ao: 0.8 },
      { z: -2.0, prof: rectProf(1.2, 1.35, 0.3 * b), ao: 0.92 },
      { z: 1.6, prof: rectProf(0.8, 0.9, 0.22 * b), ao: 1 },
    ], c).map((s) => ({ ...s, prof: offProf(s.prof, 5.0, 0.4) })), M.hull, 0.9);
    intake(c, 5.0, 0.4, 1.6, 0.78, 2.2);
    nozzle(c, 4.4, 0.4, -18.0, 1.9);
    // DETAIL SITE 2 — engine block.
    cluster(c, 5.0, 2.0, -11.0, 1.1, 0.34, 3.0, 'y', M.mech, 0.6);
  });

  // --- the one flank paint block, on the largest clean face on the ship ---
  mirrorX(a, () => paintPlate(c, 3.84, 1.1, -1.0, 0.12, 1.05, 3.4));

  // --- exposed aft structure: trusses bridging the sky gap ---
  if (c.mid) {
    mirrorX(a, () => {
      strut(a, 1.4, 1.3, -12.0, 5.0, 1.4, -12.4, 0.26, 0.26, 4, M.mech, 0.5, Math.PI * 0.25);
      strut(a, 1.7, -1.2, -8.0, 5.0, -1.0, -8.4, 0.24, 0.24, 4, M.mech, 0.5, Math.PI * 0.25);
      strut(a, 1.2, 0.4, -15.0, 5.0, 0.4, -14.6, 0.2, 0.2, 4, M.mech, 0.45, Math.PI * 0.25);
      radiator(c, 3.4, 2.6, -15.0, 1.5, 3.0, 4, -0.5);
    });
    // Aft armour cap + docking bumper carries the hull back to -22.
    boxBev(a, 0, 0.2, -18.0, 1.15, 1.15, 3.0, 0.28 * b, M.graphite, 0.5);
    boxBev(a, 0, 0.2, -21.4, 0.8, 0.75, 0.5, 0.16 * b, M.mech, 0.45);
  }

  if (c.hero) {
    // DETAIL SITE 3 — the aft truss bay between the nacelles and the spine.
    mirrorX(a, () => cluster(c, 2.1, 1.3, -10.0, 0.7, 0.3, 2.4, 'y', M.graphite, 0.55));
    mirrorX(a, () => rcs(c, 2.4, 2.6, 15.0, 0.4, 'y'));
    whip(c, 0, 3.9, -8.4, 0, 5.6, -7.4, 0.08);
    blister(c, 0, -3.0, 4.0, 0.7, 0.5, M.graphite);
  }
}

// ---------------------------------------------------------------------------
// MISSILE CORVETTE — "Quiver", 47 m.
//
// ONE OUTLINE IDEA: TWO TOWERS. A slim, low, unremarkable hull exists only to
// carry two tall stepped launcher blocks on the shoulders — the aft one 7.4 m
// tall, the forward one 6.0 m, with a deep open valley between them across the
// centreline and a long sensor boom running out to 23.5 m off the nose. At any
// framing the cutout is a battlement: two square masses with a notch between.
//
// CRITIQUE (round 2, silhouette, measured): the Quiver's cutout scored IoU
// 0.759 against the Hammer. The two classes now diverge by construction — see
// the note on buildAssaultCorvette — and the launcher blocks have been raised
// from 5.3 m to 7.4 m maximum height, roughly three times the hull's own half
// depth, so the towers dominate rather than decorate.
//
// DETAIL SITES: launcher deck, engine block, nose radar root.
// ---------------------------------------------------------------------------

function buildMissileCorvette(c: Ctx): void {
  const a = c.a, b = c.bev;

  // --- fuselage: long, narrow and LOW — deliberately unremarkable, because
  //     the towers are the class read and nothing may compete with them ---
  // Aft station carries a painted tail block fringed by a paintEdge station.
  loft(a, dec([
    { z: -19.8, prof: rectProf(2.0, 1.55, 0.38 * b), ao: 0.55, mask: M.paint },
    { z: -15.4, prof: rectProf(2.35, 1.8, 0.44 * b), ao: 0.68, mask: M.paintEdge },
    { z: -7.0, prof: rectProf(2.5, 1.9, 0.48 * b), ao: 0.85 },
    { z: 1.0, prof: rectProf(2.45, 1.85, 0.46 * b), ao: 1 },
    { z: 8.0, prof: rectProf(2.15, 1.6, 0.42 * b), ao: 1 },
    { z: 14.0, prof: rectProf(1.55, 1.2, 0.32 * b), ao: 1 },
    { z: 18.6, prof: rectProf(0.9, 0.76, 0.24 * b), ao: 0.95 },
    { z: 21.4, prof: rectProf(0.46, 0.4, 0.14 * b), ao: 0.9 },
  ], c), M.hull, 1);

  // --- long nose sensor boom out to the 23.5 m mark ---
  tube(a, [
    { z: 21.2, r: 0.42, ao: 0.9 },
    { z: 22.2, r: 0.3, ao: 1 },
    { z: 22.5, r: 0.44, ao: 1, mask: M.graphite },
    { z: 22.8, r: 0.24, ao: 1 },
    { z: 23.5, r: 0.07, ao: 1 },
  ], c.fine, M.mech, 0.95, false, 0, false, true);

  // --- forward phased-array radar panel: unmistakable class marker ---
  a.push(trs(0, 2.7, 12.0, -0.3, 0, 0));
  boxBev(a, 0, 0, 0, 2.0, 0.2, 1.5, 0.16 * b, M.graphite, 0.85);
  boxBev(a, 0, 0.24, 0, 1.75, 0.1, 1.28, 0.1 * b, M.paintEdge, 1);
  a.pop();
  boxBev(a, 0, 2.0, 12.0, 0.7, 0.8, 0.9, 0.2 * b, M.mech, 0.6);

  // --- cockpit, low and forward ---
  canopy(c, 14.4, 17.2, 0.86, 1.15, 0.5);

  // --- STEPPED SHOULDER LAUNCHER TOWERS. Front faces land on the hardpoints:
  //     block A front face z = +1.0, block B front face z = -4.0 (both y = 3.0,
  //     which is inside both blocks). Block A tops out at 6.0 m and block B at
  //     7.4 m against a hull that is only 1.9 m deep, so the pair reads as two
  //     towers with a valley, not as shoulder pads. ---
  mirrorX(a, () => {
    // Shoulder pylon tying the launcher to the hull.
    boxBev(a, 4.0, 1.9, -3.0, 1.3, 1.0, 5.4, 0.3 * b, M.paintEdge, 0.75);
    // Block A (forward, shorter) — its front face is hardpoint 1.
    boxBev(a, 5.2, 3.6, -2.2, 1.55, 2.4, 3.2, 0.3 * b, M.hull, 0.95);
    cellArray(c, 5.2, 3.2, 1.02, 2, 2, 1.4, 0.5, 1.1);
    // Block B (aft, taller, so the pair steps up going aft).
    boxBev(a, 5.2, 4.2, -7.9, 1.7, 3.2, 3.9, 0.32 * b, M.hull, 0.88);
    cellArray(c, 5.2, 5.3, -3.98, 2, 1, 1.4, 0.5, 1.1);
    cellArray(c, 5.2, 3.1, -3.98, 2, 1, 1.4, 0.5, 1.1);
    // Outboard launcher cheek: ONE contiguous 5.6 m team-colour face per tower
    // spanning the whole outer wall, fringed top and bottom by the block's own
    // chamfer so the shader's wear term chips its edges.
    boxBev(a, 6.95, 4.2, -6.4, 0.18, 2.8, 3.4, 0.1 * b, M.paint, 0.9);
    navPod(c, 5.2, 7.5, -6.6, 0.11);
    if (c.mid) {
      // Blast deflector rails on top of the launchers.
      boxSolid(a, 5.2, 6.1, -2.4, 1.5, 0.12, 3.0, M.graphite, 0.6);
    }
    // DETAIL SITE 1 — the launcher deck between the two towers.
    cluster(c, 5.2, 7.4, -9.4, 1.2, 0.3, 2.0, 'y', M.mech, 0.6);
  });

  // --- dorsal spine running through the valley between the towers ---
  if (c.mid) {
    loft(a, dec([
      { z: -14.0, prof: rectProf(0.9, 0.5, 0.18 * b), ao: 0.6 },
      { z: -4.0, prof: rectProf(1.1, 0.62, 0.22 * b), ao: 0.7 },
      { z: 6.0, prof: rectProf(0.95, 0.54, 0.2 * b), ao: 0.8 },
    ], c).map((s) => ({ ...s, prof: offProf(s.prof, 0, 2.1) })), M.graphite, 0.7);
  }

  // --- engines (mounts +-4.8, 0.3, -19.5), buried in the hull sides so the
  //     aft cutout stays a solid slim block — the opposite of the Hammer's
  //     skeletal tail ---
  mirrorX(a, () => {
    loft(a, dec([
      { z: -19.7, prof: rectProf(2.2, 2.1, 0.44 * b), ao: 0.5, mask: M.paint },
      { z: -16.6, prof: rectProf(2.45, 2.3, 0.5 * b), ao: 0.66, mask: M.paintEdge },
      { z: -9.0, prof: rectProf(2.3, 2.15, 0.46 * b), ao: 0.82 },
      { z: -3.0, prof: rectProf(1.8, 1.7, 0.4 * b), ao: 0.94 },
      { z: 0.6, prof: rectProf(1.2, 1.15, 0.3 * b), ao: 1 },
    ], c).map((s) => ({ ...s, prof: offProf(s.prof, 4.8, 0.3) })), M.hull, 0.9);
    intake(c, 4.8, 0.3, 0.6, 1.1, 2.6);
    nozzle(c, 4.8, 0.3, -19.5, 2.0);
    paintPlate(c, 7.18, 0.3, -11.0, 0.12, 1.1, 3.4);
    // DETAIL SITE 2 — engine block.
    cluster(c, 4.8, 2.5, -13.0, 1.3, 0.34, 3.0, 'y', M.mech, 0.6);
  });

  // --- ventral fins + aft structure back to -23.5 ---
  if (c.mid) {
    mirrorX(a, () => {
      a.push(trs(1.8, -1.6, -13.0, 0, 0, 0.5));
      wing(c, {
        x: 0, y: 0, z: 0, span: 2.8,
        rootChord: 6.0, tipChord: 2.2, rootThick: 0.42, tipThick: 0.16,
        sweep: -2.4, dihedral: 0, segments: 3,
        mask: M.hull, tipMask: M.paint, ao: 0.85, bev: 0.14 * b,
      });
      a.pop();
      radiator(c, 3.0, 2.2, -16.0, 1.3, 2.6, 4, -0.45);
    });
    boxBev(a, 0, 0.3, -21.4, 1.9, 1.5, 1.7, 0.36 * b, M.graphite, 0.5);
    boxBev(a, 0, 0.3, -23.0, 1.1, 0.9, 0.5, 0.18 * b, M.mech, 0.45);
  }

  if (c.hero) {
    // DETAIL SITE 3 — the radar/sensor root on the nose deck.
    cluster(c, 0, 1.5, 15.5, 0.7, 0.24, 1.8, 'y', M.graphite, 0.6);
    mirrorX(a, () => rcs(c, 1.8, 1.3, 19.0, 0.36, 'x'));
    whip(c, 0, 2.7, -11.0, 0, 4.5, -9.4, 0.07);
    blister(c, 0, -2.1, 10.0, 0.8, 0.55, M.graphite);
  }
}

// ---------------------------------------------------------------------------
// RESOURCE COLLECTOR — "Ladle", 56 m.
//
// ONE OUTLINE IDEA: a DRUM WITH AN OPEN CLAW. Not a fighter — a working tug —
// and the only round hull in the fleet, which is most of the class read on its
// own. The three mining mandibles are splayed to a 9 m radius this round, so
// the forward third of the cutout is three separate prongs with sky between
// them instead of a fused cone.
//
// The plumbing on the drum flanks is retained because it is not a carpet: it
// is a small number of long continuous pipe runs, which is the same visual
// device as a scribed panel line and reads as one object, not as noise. The
// pipe CLAMPS — three per pipe, seven pipes, twenty-one identical cubes at
// even pitch — were the uniform spray on this hull and are gone.
// ---------------------------------------------------------------------------

function buildCollector(c: Ctx): void {
  const a = c.a, b = c.bev;
  const S = c.lod === 0 ? 12 : c.lod === 1 ? 9 : 6;

  // --- cargo drum: the body of the ship, a fat faceted cylinder ---
  tube(a, decRings([
    { z: -19.0, r: 4.2, ao: 0.5 },
    { z: -17.2, r: 5.0, ao: 0.6 },
    { z: -10.0, r: 5.2, ao: 0.8 },
    { z: 0.0, r: 5.3, ao: 0.95 },
    { z: 5.0, r: 5.0, ao: 1 },
    { z: 7.2, r: 4.3, ao: 1 },
  ], c), S, M.hull, 0.9, false, 0, true, false);

  // --- hoop ribs: the drum must read as a pressure vessel, not a pipe ---
  if (c.mid) {
    const hoops = [-14.5, -7.0, 0.5, 5.4];
    for (let i = 0; i < hoops.length; i++) {
      const hz = hoops[i];
      const rr = hz > 4 ? 5.05 : hz > -12 ? 5.35 : 5.15;
      // One hoop carries the faction stripe around the cargo drum.
      tube(a, [
        { z: hz - 0.45, r: rr },
        { z: hz - 0.3, r: rr + 0.34 },
        { z: hz + 0.3, r: rr + 0.34 },
        { z: hz + 0.45, r: rr },
      ], S, i === 1 ? M.paint : M.graphite, 0.62);
    }
  }

  // --- longitudinal plumbing: FOUR long continuous runs, clustered on the
  //     dorsal quarter rather than wrapped evenly round the drum, so the belly
  //     and the lower flanks stay smooth armour ---
  if (c.mid) {
    for (let i = 0; i < 4; i++) {
      const ang = 0.45 + (i / 3) * 1.9;
      const px = Math.cos(ang) * 5.5, py = Math.sin(ang) * 5.5;
      strut(a, px, py, -16.0, px * 1.02, py * 1.02, 4.4, 0.24, 0.2, 5, M.mech, 0.6);
    }
  }

  // --- mining head: armoured collar then a flared intake funnel ---
  tube(a, decRings([
    { z: 7.0, r: 4.4, ao: 0.85 },
    { z: 8.6, r: 4.6, ao: 0.9 },
    { z: 11.6, r: 4.3, ao: 0.95 },
    { z: 13.0, r: 4.6, ao: 1 },
    { z: 16.0, r: 5.4, ao: 1 },
    { z: 17.4, r: 5.9, ao: 1 },
  ], c), S, M.hullWorn, 0.9);
  // Funnel throat: an actual hole with a hot conveyor glow at the bottom.
  tube(a, decRings([
    { z: 9.5, r: 2.6, ao: 0.16 },
    { z: 13.0, r: 3.3, ao: 0.3 },
    { z: 17.4, r: 5.6, ao: 0.55 },
  ], c), S, M.darkMech, 0.3, true);
  ringAnnulus(a, 17.4, 5.9, 5.6, S, M.paint, 0.95, 1);
  disc(a, 9.5, 2.6, S, M.bellHot, 0.3, 1);
  if (c.mid) {
    // Grinder teeth ringing the funnel mouth.
    const teeth = c.hero ? 12 : 6;
    for (let i = 0; i < teeth; i++) {
      const ang = (i / teeth) * Math.PI * 2;
      const px = Math.cos(ang), py = Math.sin(ang);
      a.push(trs(px * 5.5, py * 5.5, 17.2, 0, 0, ang));
      boxBev(a, 0, 0, 0, 0.3, 0.42, 0.7, 0.12 * b, M.mech, 0.75);
      a.pop();
    }
  }

  // --- three articulated mandibles reaching to +28 m, splayed to a 9 m radius
  //     at the elbow so the claw is OPEN and the three prongs read separately
  //     at fleet range (round-2 silhouette note: every candidate cutout was a
  //     fused blob with no sky through it) ---
  const arms = [Math.PI * 0.5, Math.PI * 1.17, Math.PI * 1.83];
  for (let i = 0; i < arms.length; i++) {
    a.push(trs(0, 0, 0, 0, 0, arms[i]));
    // Shoulder housing on the collar.
    boxBev(a, 0, 5.3, 12.6, 0.85, 0.9, 1.6, 0.28 * b, M.paintEdge, 0.7);
    // Upper limb: outward and forward, opening to 9.0 m.
    strut(a, 0, 5.5, 13.4, 0, 9.0, 19.4, 0.62, 0.5, 5, M.mech, 0.75);
    if (c.mid) {
      // Elbow pivot drum, cross-axled.
      a.push(trs(0, 9.0, 19.4, 0, Math.PI * 0.5, 0));
      tube(a, [{ z: -0.75, r: 0.62 }, { z: 0.75, r: 0.62 }],
        c.fine + 1, M.darkMech, 0.55, false, 0, true, true);
      a.pop();
      // Hydraulic ram bridging the joint — the "articulated" read.
      strut(a, 0.42, 5.7, 14.2, 0.42, 8.2, 18.2, 0.2, 0.16, 4, M.mech, 0.6, Math.PI * 0.25);
    }
    // Forearm: converging back toward the axis.
    strut(a, 0, 9.0, 19.4, 0, 4.6, 25.4, 0.5, 0.34, 5, M.hull, 0.85);
    // Claw tip + a warning strobe on it. The three claw sparks at the extreme
    // forward end are the Collector's fleet-range signature and must survive
    // every LOD (critique: emissive masks have to read at 5-20 px).
    strut(a, 0, 4.6, 25.4, 0, 2.6, 27.8, 0.36, 0.1, 4, M.mech, 0.95);
    navPod(c, 0, 2.6, 27.8, 0.13);
    a.pop();
  }

  // --- cockpit blister, offset to starboard on a short pylon ---
  boxBev(a, 4.4, 3.3, 4.2, 0.7, 0.9, 1.0, 0.26 * b, M.graphite, 0.6);
  a.push(trs(5.3, 4.3, 5.4, 0, 0.28, 0.22));
  boxBev(a, 0, 0, 0, 1.15, 0.95, 1.7, 0.34 * b, M.hull, 0.95);
  canopy(c, -0.4, 1.9, 0.85, 0.85, 0.55);
  a.pop();

  // --- twin engine nacelles on outriggers (mounts +-6.0, -1.0, -23.0) ---
  mirrorX(a, () => {
    strut(a, 3.6, -2.4, -12.0, 6.0, -1.0, -12.6, 0.55, 0.6, 4, M.mech, 0.5, Math.PI * 0.25);
    strut(a, 3.4, -1.0, -17.0, 6.0, -1.0, -17.4, 0.45, 0.5, 4, M.mech, 0.45, Math.PI * 0.25);
    loft(a, dec([
      { z: -23.2, prof: rectProf(2.7, 2.6, 0.5 * b), ao: 0.5, mask: M.paint },
      { z: -20.4, prof: rectProf(3.0, 2.85, 0.56 * b), ao: 0.65 },
      { z: -14.0, prof: rectProf(2.85, 2.7, 0.52 * b), ao: 0.82 },
      { z: -9.0, prof: rectProf(2.3, 2.2, 0.44 * b), ao: 0.94 },
      { z: -6.6, prof: rectProf(1.5, 1.5, 0.32 * b), ao: 1 },
    ], c).map((s) => ({ ...s, prof: offProf(s.prof, 6.0, -1.0) })), M.hull, 0.9);
    intake(c, 6.0, -1.0, -6.6, 1.35, 3.0);
    nozzle(c, 6.0, -1.0, -23.0, 2.6);
    // DETAIL SITE 1 — engine block. The nacelle flank and belly stay bare.
    cluster(c, 6.0, 1.7, -16.0, 1.6, 0.4, 3.6, 'y', M.mech, 0.6);
  });

  // --- aft frame, docking collar and industrial clutter ---
  if (c.mid) {
    tube(a, [
      { z: -22.6, r: 3.6, ao: 0.4 },
      { z: -20.5, r: 4.1, ao: 0.5 },
    ], S, M.graphite, 0.5, false, 0, true, false);
    boxBev(a, 0, 0, -25.0, 2.6, 2.6, 2.4, 0.5 * b, M.mech, 0.45);
    mirrorX(a, () => {
      strut(a, 1.9, 1.9, -22.8, 2.4, 2.4, -26.6, 0.28, 0.22, 4, M.mech, 0.5, Math.PI * 0.25);
      strut(a, 1.9, -1.9, -22.8, 2.4, -2.4, -26.6, 0.28, 0.22, 4, M.mech, 0.5, Math.PI * 0.25);
    });
    // Ventral docking collar for offloading at the refinery.
    a.push(trs(0, -5.2, -4.0, Math.PI * 0.5, 0, 0));
    tube(a, [
      { z: 0, r: 2.3, ao: 0.7 },
      { z: 0.7, r: 2.5, ao: 0.6 },
      { z: 1.1, r: 2.1, ao: 0.5 },
    ], c.fine + 4, M.graphite, 0.6);
    tube(a, [{ z: 0.2, r: 1.6 }, { z: 1.1, r: 2.1 }], c.fine + 4, M.darkMech, 0.25, true);
    disc(a, 0.2, 1.6, c.fine + 4, M.bellHot, 0.3, 1);
    a.pop();
    // Dorsal machinery stack + radiators.
    boxBev(a, 0, 5.6, -6.0, 1.6, 1.1, 4.4, 0.36 * b, M.mech, 0.7);
    mirrorX(a, () => radiator(c, 3.0, 6.4, -12.0, 1.6, 3.2, 4, -0.7));
  }

  if (c.hero) {
    // DETAIL SITE 2 — the dorsal machinery stack. DETAIL SITE 3 — the ventral
    // offload gallery beside the docking collar. Nothing on the drum flanks,
    // the mining head or the nacelle skins: those are the smooth shell panels.
    cluster(c, 0, 6.8, -6.0, 1.5, 0.4, 4.0, 'y', M.graphite, 0.6);
    cluster(c, 0, -5.3, -11.0, 1.4, -0.36, 2.6, 'y', M.mech, 0.45);
    mirrorX(a, () => {
      boxBev(a, 3.6, 4.0, 1.0, 0.9, 0.6, 1.4, 0.2 * b, M.mech, 0.7);
      rcs(c, 4.2, 4.2, 10.4, 0.44, 'y');
      navPod(c, 5.4, 1.6, 8.6, 0.11);
    });
    whip(c, 1.2, 6.5, -3.0, 1.6, 8.6, -1.6, 0.09);
    blister(c, -4.0, 3.6, 3.0, 1.0, 0.7, M.graphite);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The hulls this module owns. Anything else must go to another ship builder. */
export const STRIKECRAFT_CLASSES: ShipClass[] = [
  ShipClass.Scout,
  ShipClass.Interceptor,
  ShipClass.Bomber,
  ShipClass.AssaultCorvette,
  ShipClass.MissileCorvette,
  ShipClass.ResourceCollector,
];

/**
 * Build a strikecraft hull.
 *
 * WHAT: returns an indexed `BufferGeometry` carrying position/normal/uv/aMask/aAO
 * for `cls` at `lod` (0 = hero, 1 ≈ 35% tris, 2 ≈ 10%), sized to
 * `SHIP_SPECS[cls].length` with every engine mount and hardpoint landing on real
 * modelled geometry (nozzle bells and gun muzzles respectively).
 *
 * WHY: the fleet renderer instances one geometry per (class, lod, variant); the
 * `rng` seed selects a variant, changing greeble/light placement but never the
 * silhouette, so a squadron reads as sister ships rather than clones.
 *
 * Throws for classes this module does not own — see `STRIKECRAFT_CLASSES`.
 */
export function buildStrikecraft(cls: ShipClass, lod: 0 | 1 | 2, rng: Rng): BufferGeometry {
  const a = new MeshAcc();
  const c: Ctx = {
    a,
    rng,
    lod,
    hero: lod === 0,
    mid: lod <= 1,
    sides: lod === 0 ? 10 : lod === 1 ? 6 : 5,
    fine: lod === 0 ? 6 : 4,
    // Chamfers are sub-pixel past the LOD0 switch distance, so they are the
    // first thing to go: zeroing this collapses every bevel quad automatically.
    bev: lod === 0 ? 1 : 0,
  };

  switch (cls) {
    case ShipClass.Scout: buildScout(c); break;
    case ShipClass.Interceptor: buildInterceptor(c); break;
    case ShipClass.Bomber: buildBomber(c); break;
    case ShipClass.AssaultCorvette: buildAssaultCorvette(c); break;
    case ShipClass.MissileCorvette: buildMissileCorvette(c); break;
    case ShipClass.ResourceCollector: buildCollector(c); break;
    default:
      throw new Error(`buildStrikecraft: ${ShipClass[cls]} is not a strikecraft hull`);
  }

  const g = a.toGeometry(lod);

  if (import.meta.env?.DEV) {
    const s = SHIP_SPECS[cls];
    const budget = LOD_BUDGET[s.size][lod];
    if (a.tris > budget * 1.3) {
      console.warn(`[strikecraft] ${s.name} LOD${lod}: ${a.tris} tris over budget ${budget}`);
    }
    // Picking and collision use a sphere centred on the hull origin, so that is
    // what must fit inside `spec.radius` — not three's optimal bounding sphere.
    let maxR2 = 0;
    const pa = g.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      const d = pa.getX(i) ** 2 + pa.getY(i) ** 2 + pa.getZ(i) ** 2;
      if (d > maxR2) maxR2 = d;
    }
    if (Math.sqrt(maxR2) > s.radius) {
      console.warn(
        `[strikecraft] ${s.name} LOD${lod}: reaches ${Math.sqrt(maxR2).toFixed(1)}m, ` +
        `spec radius is ${s.radius}m`,
      );
    }
  }

  return g;
}
