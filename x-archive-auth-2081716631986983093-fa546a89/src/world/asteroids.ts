/**
 * ASTEROIDS — the resource field: procedural rock geometry, field layout and
 * the instanced renderer that draws it.
 *
 * The field is doing three jobs at once and every decision below serves all
 * three:
 *   1. ECONOMY   — rocks carry resource proportional to their volume and are
 *                  the thing collectors fly to, so their spatial layout is the
 *                  map's economic geography.
 *   2. COMPOSITION — a Homeworld frame is mostly empty vacuum with one dense
 *                  band of rock cutting through it. The belt gives the shot a
 *                  horizon line and the clusters give it depth cues.
 *   3. SCALE     — parallax. Small debris close to camera moving fast against a
 *                  slow, huge belt is the only cheap way to sell kilometres.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ROCKS LOOK THE WAY THEY DO
 * ---------------------------------------------------------------------------
 * A displaced sphere is a potato. Real asteroids are *fractured*: they read as
 * a small number of big flat conchoidal faces meeting at hard edges, punched
 * through by impact craters, with regolith dust settling on whatever faces up.
 * So the builder is a small CSG-ish pipeline:
 *
 *   icosphere -> weld -> low-frequency fbm displacement -> HALF-SPACE PLANE
 *   CUTS (the flat fracture faces) -> ellipsoid squash -> BOOLEAN SPHERE
 *   SUBTRACTION for craters (+ raised rims) -> post-cut jitter -> smooth normals
 *
 * The plane cuts are what make the silhouette angular rather than lumpy. The
 * VERTEX stage owns only the silhouette and stays deliberately low frequency;
 * every crease, grain and hard specular facet is produced per pixel by the
 * fragment shader's surface-gradient bump. See `buildRockGeometry` and
 * `RockParams.ridgeAmp` for why that split is not optional.
 *
 * The amount each vertex was pushed inward is baked into vertex attributes so
 * the fragment shader can darken crevices and expose mineral veins in cracks
 * without any screen-space AO.
 *
 * ---------------------------------------------------------------------------
 * ATTRIBUTE CONTRACT
 * ---------------------------------------------------------------------------
 * Rock geometry emits the standard set from `core/contracts.ts`:
 *   position vec3, normal vec3, aMask vec4, aAO float   (indexed, welded)
 * `uv` is deliberately absent: rocks carry no decals and all their texturing is
 * triplanar/procedural, and keeping it would block vertex welding at the seam.
 * Plus one rock-specific attribute:
 *   aRock vec2   x = crater/dent depth 0..1, y = fracture-face amount 0..1
 * and, per instance:
 *   aInst vec4   x = seed 0..1, y = resource richness 0..1 (0 = depleted),
 *                z = reserved, w = instance radius in metres (triplanar scale)
 *
 * Note `aMask.x` (team paint) is always 0 — rocks never take faction colour.
 */

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../core/config';
import type { RenderContext, RenderSystem, TextureFactory } from '../core/contracts';
import type { Rng } from '../core/rng';
import type { Asteroid, QualitySettings } from '../core/types';
import type { World } from '../sim/world';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** How many distinct rock shapes are baked. Higher = less visible repetition. */
export const ROCK_VARIANTS = 8;

/**
 * Icosphere subdivision per LOD. `IcosahedronGeometry` splits each of the 20
 * base faces into (detail+1)^2 triangles, so these give 5120 / 1280 / 320
 * triangles — roughly the frigate LOD budget, which is the right density for a
 * body you fly a collector right up against.
 */
const LOD_DETAIL: readonly [number, number, number] = [15, 7, 3];

/**
 * Resource units per cubic metre of rock. Asteroid yield is strictly
 * proportional to volume (r^3) so the 300 m monsters genuinely matter, but the
 * constant is small because the volume ratio between a 20 m pebble and a 300 m
 * monster is 3400:1 and the economy cannot absorb that spread raw.
 * Tuned against `ResourceCollector` capacity 620 / rate 26.
 */
const RESOURCE_PER_M3 = 0.0006;
const RESOURCE_MIN = 70;
const RESOURCE_MAX = 12000;

/** Default rock count. Clamped to the world pool cap. */
const DEFAULT_COUNT = 620;

/** LOD switch distances as multiples of the instance's visual radius. */
const LOD_DIST: readonly [number, number] = [58, 210];

/** Debris pebble instance count per quality preset (0 = low .. 3 = ultra). */
const DEBRIS_BY_PRESET: readonly number[] = [0, 1600, 3600, 6400];

/** Fragment-shader fbm octaves per quality preset. */
const OCTAVES_BY_PRESET: readonly number[] = [2, 3, 4, 5];

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Module-scope scratch — the update loop must never allocate.
// ---------------------------------------------------------------------------

const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _mat = new THREE.Matrix4();
const _viewProj = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

// ---------------------------------------------------------------------------
// CPU noise — gradient noise + fbm/ridged, deterministic via integer offsets.
// ---------------------------------------------------------------------------

/** 12 edge-midpoint gradients of a cube — the classic Perlin gradient set. */
const GRAD = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

/**
 * Lattice hash for the displacement noise.
 *
 * NOT `core/rng`'s `hash3`: that one folds z in with `Math.imul(z, 2147483647)`,
 * and 2147483647 = 2^31-1, so modulo 2^32 the z term degenerates to roughly
 * plus-or-minus z. A single avalanche round afterwards does not fully break the
 * resulting axis correlation, and in a ridged fbm — where the (1-|n|)^2 fold
 * turns every cell boundary into a visible crease — the correlation shows up as
 * a grid of axis-aligned rectangular blocks across the rock. Three odd
 * multipliers plus two avalanche rounds decorrelate properly.
 */
function ihash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Dot of the lattice gradient at (ix,iy,iz) with the offset vector. */
function gdot(ix: number, iy: number, iz: number, x: number, y: number, z: number): number {
  const o = (((ihash3(ix, iy, iz) * 12) | 0) % 12) * 3;
  return GRAD[o] * x + GRAD[o + 1] * y + GRAD[o + 2] * z;
}

/** Quintic fade — C2 continuous, so fbm derivatives stay smooth. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 3D gradient noise, returns roughly [-1, 1]. */
function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);

  const n000 = gdot(ix, iy, iz, fx, fy, fz);
  const n100 = gdot(ix + 1, iy, iz, fx - 1, fy, fz);
  const n010 = gdot(ix, iy + 1, iz, fx, fy - 1, fz);
  const n110 = gdot(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz);
  const n001 = gdot(ix, iy, iz + 1, fx, fy, fz - 1);
  const n101 = gdot(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1);
  const n011 = gdot(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1);
  const n111 = gdot(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1);

  const x00 = n000 + u * (n100 - n000);
  const x10 = n010 + u * (n110 - n010);
  const x01 = n001 + u * (n101 - n001);
  const x11 = n011 + u * (n111 - n011);
  const y0 = x00 + v * (x10 - x00);
  const y1 = x01 + v * (x11 - x01);
  return (y0 + w * (y1 - y0)) * 1.35;
}

/**
 * Per-octave domain rotation.
 *
 * Lattice noise always carries some grid signature. Scaling straight up the
 * axes stacks every octave's grid in the same orientation and the signature
 * accumulates into a visible cubic structure; rotating the domain between
 * octaves scatters it instead. Rows are orthonormal so the frequency content is
 * unchanged.
 */
const ROT = [
  0.00, 0.80, 0.60,
  -0.80, 0.36, -0.48,
  -0.60, -0.48, 0.64,
];

/** Fractal brownian motion, returns roughly [-1, 1]. */
function fbm3(x: number, y: number, z: number, oct: number): number {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x, y, z);
    n += a;
    const rx = (ROT[0] * x + ROT[1] * y + ROT[2] * z) * 2.03;
    const ry = (ROT[3] * x + ROT[4] * y + ROT[5] * z) * 2.03;
    const rz = (ROT[6] * x + ROT[7] * y + ROT[8] * z) * 2.03;
    x = rx; y = ry; z = rz;
    a *= 0.5;
  }
  return s / n;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Rock variant parameters
// ---------------------------------------------------------------------------

interface PlaneCut {
  nx: number; ny: number; nz: number;
  /** Half-space offset from the origin, in unit-rock space. */
  d: number;
  /** How "fresh" the exposed face reads: 1 = major conchoidal fracture. */
  fresh: number;
}

interface Crater {
  /** Subtracted sphere centre, in ellipsoid space. */
  cx: number; cy: number; cz: number;
  /** Subtracted sphere radius. */
  r: number;
  /** Unit axis from the rock centre through the crater. */
  ax: number; ay: number; az: number;
  /** Angular radius of the crater as seen from the rock centre, radians. */
  ang: number;
}

interface RockParams {
  /** Ellipsoid semi-axes — nothing in a belt is spherical. */
  sx: number; sy: number; sz: number;
  /** Integer noise-domain offset: this is what makes each variant unique. */
  ox: number; oy: number; oz: number;
  lumpAmp: number; lumpFreq: number;
  /**
   * Second, finer lump layer. Note it is plain fbm, NOT a ridged multifractal.
   *
   * THE VERTEX STAGE OWNS ONLY THE SILHOUETTE, and it is bound by two limits
   * that are easy to blow past:
   *
   *  1. Nyquist. LOD0 samples the surface every ~0.069 units, LOD2 every
   *     ~0.277. Anything above ~3 cycles/unit turns into per-triangle noise —
   *     a chequerboard of light and dark facets that no amount of shader work
   *     can hide, because it is baked into the normals.
   *  2. Sharpness. A ridged multifractal, (1-|n|)^2, makes V-shaped creases.
   *     Even sampled 4-5 times per wavelength — comfortably above Nyquist —
   *     those creases come out as polygonal terraces, like a contour-line
   *     model of a hill. Smooth fbm at the same frequency does not.
   *
   * So all crease and fracture character lives in the FRAGMENT shader, where
   * it is resolved per pixel, costs no memory, and survives every LOD switch.
   */
  ridgeAmp: number; ridgeFreq: number;
  /** Gentle post-cut jitter so shear faces are not mirror-flat. Low frequency. */
  microAmp: number; microFreq: number;
  cuts: PlaneCut[];
  craters: Crater[];
  /**
   * Frequency of the baked mineral-richness mask (`aMask.y`) — large patches
   * marking which parts of the body are ore-bearing. The vein strands
   * themselves are drawn in the fragment shader; this only says where.
   */
  veinFreq: number;
}

/** Roll one deterministic rock recipe. */
function makeRockParams(rng: Rng): RockParams {
  const sx = rng.range(0.86, 1.16);
  const sy = rng.range(0.62, 1.0);
  const sz = rng.range(0.82, 1.18);

  // --- fracture planes ---------------------------------------------------
  // A few deep "major" cuts create the big readable flat faces; a spray of
  // shallow minor cuts chip the edges so the silhouette is never a clean
  // polyhedron.
  // Cuts are deliberately SHALLOW: bite too deep and the rock stops being a
  // rock and becomes a quartz crystal. The job here is to shear off a couple of
  // faces and chip the edges, not to carve a polyhedron.
  const cuts: PlaneCut[] = [];
  const major = rng.int(2, 3);
  const minor = rng.int(8, 14);
  const dir = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < major + minor; i++) {
    rng.onSphere(dir);
    const isMajor = i < major;
    cuts.push({
      nx: dir.x, ny: dir.y, nz: dir.z,
      d: isMajor ? rng.range(0.76, 0.89) : rng.range(0.91, 1.03),
      fresh: isMajor ? 1 : rng.range(0.40, 0.70),
    });
  }

  // --- impact craters ----------------------------------------------------
  // Many shallow craters, not a few deep ones. A subtracted sphere big enough
  // to be a "basin" scoops out a smooth conical bowl that occupies a third of
  // the silhouette and shades as one enormous gradient — the exact "obvious
  // sphere primitive" tell. Real small bodies are pocked, not scooped.
  const craters: Crater[] = [];
  const nCraters = rng.int(6, 13);
  for (let i = 0; i < nCraters; i++) {
    rng.onSphere(dir);
    // One slightly dominant crater per rock reads as an impact history.
    const cr = i === 0 ? rng.range(0.22, 0.34) : rng.range(0.07, 0.19);
    // Ellipsoid radius along this axis — where the surface roughly is.
    const ex = dir.x * sx, ey = dir.y * sy, ez = dir.z * sz;
    const surf = Math.sqrt(ex * ex + ey * ey + ez * ez);
    // Push the sphere centre out so only ~15-35% of it bites into the rock:
    // a wide, shallow pan rather than a deep hemisphere.
    const dist = surf - cr * rng.range(0.15, 0.35);
    craters.push({
      cx: dir.x * dist, cy: dir.y * dist, cz: dir.z * dist,
      r: cr,
      ax: dir.x, ay: dir.y, az: dir.z,
      ang: Math.asin(clamp(cr / Math.max(dist, 1e-3), 0, 1)),
    });
  }

  return {
    sx, sy, sz,
    ox: rng.int(-4000, 4000), oy: rng.int(-4000, 4000), oz: rng.int(-4000, 4000),
    lumpAmp: rng.range(0.20, 0.34), lumpFreq: rng.range(0.80, 1.30),
    ridgeAmp: rng.range(0.14, 0.24), ridgeFreq: rng.range(1.50, 2.30),
    microAmp: rng.range(0.008, 0.014), microFreq: rng.range(2.4, 3.2),
    cuts, craters,
    veinFreq: rng.range(1.6, 3.2),
  };
}

// ---------------------------------------------------------------------------
// Rock geometry builder
// ---------------------------------------------------------------------------

/**
 * Build one rock mesh from a recipe at a given icosphere subdivision.
 *
 * INDEXED, welded, with averaged vertex normals, normalised so the maximum
 * radius is exactly 1 — the renderer scales by the asteroid's metre radius, so
 * every LOD of every variant shares one consistent unit.
 *
 * ---------------------------------------------------------------------------
 * WHY SMOOTH NORMALS ON A MESH THAT IS SUPPOSED TO LOOK FACETED
 * ---------------------------------------------------------------------------
 * `IcosahedronGeometry` is non-indexed, so `computeVertexNormals` on it yields
 * per-face normals: hard flat shading. That sounds right for rock and is
 * completely wrong here. An icosphere is tessellated in long diagonal strips,
 * and under flat shading a smooth radial displacement tilts each strip
 * coherently — the surface comes out as a staircase of light and dark diagonal
 * ribbons that no shader work can remove, because the ribbons ARE the normals.
 *
 * Welding to an indexed mesh and averaging normals kills the ribbons outright.
 * Nothing is lost:
 *   - the plane-cut faces still read as hard flats, because every vertex on a
 *     face genuinely lies on that plane, so their averaged normal IS the plane
 *     normal (only the one-triangle border chamfers, which reads as a wear
 *     bevel catching a highlight line — an improvement);
 *   - all crisp micro-faceting comes from the fragment bump, which resolves per
 *     pixel instead of per triangle.
 * It also cuts vertex count ~6x (2562 instead of 15360 at LOD0) and satisfies
 * the "indexed geometry" clause of the geometry contract.
 *
 * `uv` is dropped before welding: it is unused (all texturing is triplanar and
 * procedural) and its seam would otherwise prevent welding along a whole
 * meridian, leaving a visible normal seam down every rock.
 */
function buildRockGeometry(p: RockParams, detail: number): THREE.BufferGeometry {
  const base = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const geo = mergeVertices(base, 1e-4);
  base.dispose();
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  const n = posAttr.count;

  const aAO = new Float32Array(n);
  const aRock = new Float32Array(n * 2);
  const aMask = new Float32Array(n * 4);

  let maxLen = 0;

  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    // IcosahedronGeometry emits points exactly on the unit sphere, so the raw
    // position IS the surface direction.
    const dx = arr[i3], dy = arr[i3 + 1], dz = arr[i3 + 2];

    // -- 1. base radius: broad lumps + ridged creases -----------------------
    const lump = fbm3(
      dx * p.lumpFreq + p.ox, dy * p.lumpFreq + p.oy, dz * p.lumpFreq + p.oz, 2,
    );
    // Smooth, two octaves, low frequency — see the note on RockParams.ridgeAmp.
    const ridge = fbm3(
      dx * p.ridgeFreq + p.oy, dy * p.ridgeFreq + p.oz, dz * p.ridgeFreq + p.ox, 2,
    ) * 0.5 + 0.5;
    const r0 = 1 + lump * p.lumpAmp + (ridge - 0.5) * p.ridgeAmp;

    // -- 2. half-space plane cuts (the flat fracture faces) -----------------
    // Carve along the vertex's OWN ray instead of projecting onto each plane in
    // turn. For the ray t*dir and the half-space n.x <= d, the constraint is
    // simply t <= d/(n.dir), so the exact convex intersection is the minimum
    // over all binding planes. Projecting sequentially instead (the obvious
    // implementation) is wrong: each projection can push the point outside a
    // plane already handled, and near a corner where several planes meet the
    // vertex marches toward the origin. Its neighbours do not, and you get long
    // black pinwheel spikes fanning out of every corner of the rock.
    // Carving along the ray also keeps the icosphere parameterisation intact,
    // so the facet stays perfectly flat and evenly tessellated.
    let r = r0;
    let fresh = 0;
    for (let c = 0; c < p.cuts.length; c++) {
      const cut = p.cuts[c];
      const nu = dx * cut.nx + dy * cut.ny + dz * cut.nz;
      if (nu <= 1e-3) continue;            // plane faces away from this vertex
      const t = cut.d / nu;
      if (t < r) {
        r = t;
        fresh = cut.fresh;
      }
    }
    // Only mark a face where the cut actually removed material, so the fracture
    // mask fades out along the edge of the facet instead of ending in a line.
    const fracture = fresh * smoothstep(0, 0.02, (r0 - r) / r0);

    // -- 3. ellipsoid squash ------------------------------------------------
    let vx = dx * r * p.sx, vy = dy * r * p.sy, vz = dz * r * p.sz;

    // -- 4. crater subtraction ---------------------------------------------
    // True ray/sphere boolean along the outward ray, blended to zero at the
    // sphere silhouette so the rim is a smooth lip instead of a razor edge
    // that the tessellation cannot represent.
    let len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-6;
    const ux = vx / len, uy = vy / len, uz = vz / len;
    let dent = 0;

    for (let c = 0; c < p.craters.length; c++) {
      const cr = p.craters[c];
      const b = ux * cr.cx + uy * cr.cy + uz * cr.cz;
      const c2 = cr.cx * cr.cx + cr.cy * cr.cy + cr.cz * cr.cz;
      const disc = b * b - c2 + cr.r * cr.r;
      if (disc > 0) {
        const s = Math.sqrt(disc);
        const tNear = b - s;
        if (tNear > 0 && tNear < len) {
          // s -> 0 at the grazing silhouette; fade the boolean in over the
          // outer quarter of the sphere so the bowl lip stays continuous.
          const w = smoothstep(0, cr.r * 0.30, s);
          const nl = len + (tNear - len) * w;
          dent = Math.max(dent, (len - nl) / cr.r);
          len = nl;
        }
      }
      // Raised ejecta rim: a narrow gaussian ring at the crater's angular edge.
      const ca = clamp(ux * cr.ax + uy * cr.ay + uz * cr.az, -1, 1);
      const u = Math.acos(ca) / Math.max(cr.ang, 1e-4);
      if (u > 0.55 && u < 1.6) {
        const g = (u - 1.02) / 0.24;
        len += Math.exp(-g * g) * cr.r * 0.16;
      }
    }

    // A subtracted sphere is, unavoidably, a piece of sphere. Push the base
    // relief back through the floor of the crater so the bowl keeps the same
    // craggy texture as the rest of the body instead of reading as a polished
    // scoop taken out of the rock.
    if (dent > 0) len += (ridge - 0.5) * p.ridgeAmp * 0.55 * Math.min(dent, 1);

    // -- 5. post-cut jitter -------------------------------------------------
    // Warps the shear planes just enough that they are not mirror-flat. Stays
    // well under Nyquist (see the note on RockParams.ridgeFreq).
    const micro = noise3(
      ux * p.microFreq + p.ox, uy * p.microFreq + p.oy, uz * p.microFreq + p.oz,
    );
    len += micro * p.microAmp;

    vx = ux * len; vy = uy * len; vz = uz * len;
    arr[i3] = vx; arr[i3 + 1] = vy; arr[i3 + 2] = vz;
    if (len > maxLen) maxLen = len;

    // -- 6. bake surface data ----------------------------------------------
    const dentC = clamp(dent, 0, 1);
    // Concavity proxy: ridge troughs are the crevices between micro-plates.
    const trough = clamp((0.5 - ridge) * 1.9, 0, 1);
    const ao = clamp(1 - dentC * 0.80 - trough * 0.45, 0.18, 1);

    aAO[i] = ao;
    aRock[i * 2] = dentC;
    aRock[i * 2 + 1] = fracture;

    // Mineral-bearing regions are large patches, so ore reads as geology
    // rather than as uniform sparkle.
    const vein = clamp(
      fbm3(dx * p.veinFreq + p.ox * 0.5, dy * p.veinFreq + p.oy * 0.5, dz * p.veinFreq + p.oz * 0.5, 2) * 0.9 + 0.5,
      0, 1,
    );
    const m4 = i * 4;
    aMask[m4] = 0;                                  // no team paint on rock
    aMask[m4 + 1] = vein;                           // emissive / mineral mask
    aMask[m4 + 2] = -0.25 + vein * 0.55;            // metalness bias
    aMask[m4 + 3] = 0.35 - fracture * 0.45;         // roughness bias
  }

  // Normalise to unit bounding radius.
  const inv = 1 / (maxLen || 1);
  for (let i = 0; i < n * 3; i++) arr[i] *= inv;

  posAttr.needsUpdate = true;
  geo.setAttribute('aAO', new THREE.BufferAttribute(aAO, 1));
  geo.setAttribute('aRock', new THREE.BufferAttribute(aRock, 2));
  geo.setAttribute('aMask', new THREE.BufferAttribute(aMask, 4));

  // Indexed => averaged (smooth) vertex normals. See the note above.
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
// Field generation
// ---------------------------------------------------------------------------

interface Cluster {
  x: number; y: number; z: number;
  /** Knot radius in metres. */
  r: number;
  /** Relative share of the clustered rock budget. */
  weight: number;
}

/**
 * Populate `world.asteroids` with a believable field. Called once at map gen.
 *
 * Layout is a broad, gently warped belt disc (density peaking mid-band, falling
 * off toward both edges and vertically) with 3-6 dense knots sitting on it.
 * Sizes follow a steep power law so the field is overwhelmingly small rock with
 * a handful of 300 m+ monsters anchoring the knots — that contrast is what
 * makes the belt read as huge.
 *
 * Existing asteroids are cleared first. Deterministic for a given `rng`.
 */
export function generateAsteroidField(
  world: World,
  rng: Rng,
  opts?: { count?: number; clusters?: number },
): void {
  const total = Math.min(CONFIG.maxAsteroids, Math.max(0, opts?.count ?? DEFAULT_COUNT));
  const clusterCount = Math.max(1, opts?.clusters ?? rng.int(3, 6));

  world.asteroids.reset();
  if (total === 0) return;

  const R = CONFIG.mapRadius;
  // A narrow band beats a broad one: spread the same rock count over the whole
  // map and you get uniform emptiness, concentrate it and you get a horizon.
  const beltInner = R * 0.30;
  const beltOuter = R * 0.66;
  const beltHalf = CONFIG.mapHeight * 0.20;

  // A perfectly planar ring looks like a CAD model. Warp the belt plane with a
  // low-order sinusoid so the horizon line curves as the camera pans.
  const warpAmp = beltHalf * 1.9;
  const warpFreq = rng.int(1, 3);
  const warpPhase = rng.range(0, TAU);
  const beltY = (a: number): number => Math.sin(a * warpFreq + warpPhase) * warpAmp;

  // --- clusters -----------------------------------------------------------
  const clusters: Cluster[] = [];
  let weightSum = 0;
  for (let i = 0; i < clusterCount; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(beltInner * 1.15, beltOuter * 0.92);
    const c: Cluster = {
      x: Math.cos(a) * rr,
      y: beltY(a) + rng.gauss() * beltHalf * 0.35,
      z: Math.sin(a) * rr,
      r: rng.range(520, 1700),
      weight: rng.range(0.6, 1.5),
    };
    weightSum += c.weight;
    clusters.push(c);
  }

  const dir = { x: 0, y: 0, z: 0 };

  /** Write one asteroid. Returns false when the pool is exhausted. */
  const place = (
    x: number, y: number, z: number, radius: number, sizeBoost: number,
  ): boolean => {
    const a: Asteroid | null = world.asteroids.spawn();
    if (!a) return false;
    const rad = clamp(radius * sizeBoost, 9, 420);
    a.pos.set(x, y, z);
    a.radius = rad;
    const vol = rad * rad * rad;
    a.amountMax = Math.round(clamp(RESOURCE_PER_M3 * vol, RESOURCE_MIN, RESOURCE_MAX));
    a.amount = a.amountMax;
    // Angular momentum scales down with mass — big rocks barely move, pebbles
    // spin visibly. Same trick the eye uses to judge size in a Homeworld shot.
    const w = rng.range(0.012, 0.14) * Math.pow(36 / rad, 0.45);
    rng.onSphere(dir);
    const wc = clamp(w, 0.003, 0.24);
    a.spin.set(dir.x * wc, dir.y * wc, dir.z * wc);
    a.rot.set(rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU));
    a.variant = rng.int(0, ROCK_VARIANTS - 1);
    a.seed = rng.next();
    return true;
  };

  // --- monsters first: one per knot, they anchor the composition -----------
  const monsters = Math.min(clusterCount, rng.int(3, 5) + 1);
  for (let i = 0; i < monsters; i++) {
    const c = clusters[i % clusters.length];
    rng.onSphere(dir);
    const d = c.r * 0.22 * rng.next();
    if (!place(
      c.x + dir.x * d, c.y + dir.y * d * 0.5, c.z + dir.z * d,
      rng.range(190, 380), 1,
    )) return;
  }

  // --- the rest -----------------------------------------------------------
  const remaining = total - monsters;
  const clusteredShare = 0.76;

  for (let i = 0; i < remaining; i++) {
    // Steep power law: u^4 means ~70% of rocks are under 40 m.
    const u = rng.next();
    let radius = 18 + 132 * Math.pow(u, 3.6);
    // A thin tail of genuinely big rock outside the monster set.
    if (rng.chance(0.010)) radius = rng.range(150, 240);

    let x: number, y: number, z: number, boost = 1;

    if (rng.next() < clusteredShare) {
      // Weighted knot pick.
      let pick = rng.next() * weightSum;
      let ci = 0;
      for (; ci < clusters.length - 1; ci++) {
        pick -= clusters[ci].weight;
        if (pick <= 0) break;
      }
      const c = clusters[ci];
      rng.onSphere(dir);
      // pow < 1 concentrates samples toward the knot centre.
      const d = c.r * Math.pow(rng.next(), 0.45);
      x = c.x + dir.x * d;
      y = c.y + dir.y * d * 0.55;
      z = c.z + dir.z * d;
      // Grade sizes up toward the knot core so knots read as dense and heavy.
      boost = 1 + 0.60 * (1 - d / c.r);
    } else {
      // Belt: triangular radial density peaking mid-band, gaussian vertically.
      const t = (rng.next() + rng.next() + rng.next()) / 3;
      const rr = beltInner + (beltOuter - beltInner) * t;
      const a = rng.range(0, TAU);
      x = Math.cos(a) * rr;
      z = Math.sin(a) * rr;
      y = beltY(a) + rng.gauss() * beltHalf * 0.55;
    }

    if (!place(x, y, z, radius, boost)) return;
  }
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

/** Deep basalt shadow tone — lifted off black so shadows keep volume. */
const ROCK_DARK = new THREE.Color(0x2b2d33).convertSRGBToLinear();
/** Sunlit fracture face — warm grey, never pure white. */
const ROCK_LIGHT = new THREE.Color(0xbdb6ab).convertSRGBToLinear();
/** Settled regolith dust — paler, slightly warm, very rough. */
const ROCK_DUST = new THREE.Color(0xcfc6b6).convertSRGBToLinear();
/** Mineral vein — matches the HUD resource cyan so ore reads at a glance. */
const ROCK_VEIN = new THREE.Color(0x8fe4ff).convertSRGBToLinear();

const VERT_HEAD = /* glsl */ `
attribute float aAO;
attribute vec2 aRock;
attribute vec4 aInst;
varying vec3 vRockPos;
varying vec3 vRockNrm;
varying vec4 vRockData;
varying vec3 vRockView;
varying vec2 vRockSS;
`;

const VERT_BODY = /* glsl */ `
// Object space scaled to METRES: procedural detail then has a fixed PHYSICAL
// grain size, so a 300 m monster shows the same size gravel as a 20 m pebble.
// That single fact is most of the sense of scale in the frame.
vRockPos = position * aInst.w;
vRockNrm = normal;
vRockData = vec4(aRock.x, aRock.y, aAO, aInst.y);
vRockSS = vec2(aInst.x, aInst.w);
`;

/** Injected after <project_vertex>, where `mvPosition` is in scope. */
const VERT_VIEW = /* glsl */ `
vRockView = mvPosition.xyz;
`;

/**
 * Precision-safe procedural noise.
 *
 * `GLSL_NOISE` in core/contracts hashes with `sin(x) * 43758.5453`, which is
 * fine for the unit-ish domains ship and fx shaders use. Asteroid object space
 * is measured in METRES though, and a 340 m rock sampled at 5 cycles/m reaches
 * |p| ~ 1800; the hash argument then lands around 5e5 where a 24-bit mantissa
 * cannot resolve `sin` any more and the noise collapses into hard rectangular
 * cells. (It shows up as a blocky "QR code" over the whole rock, and because
 * the cells are flat with step edges, derivative-based bump mapping on top of
 * it goes to infinity at every boundary.)
 *
 * These use a fract-based hash evaluated on the integer lattice, which stays
 * exact over the whole range we need. Output range and character are matched to
 * the sf_* functions so the rocks still sit next to the ships tonally.
 */
const GLSL_ROCK_NOISE = /* glsl */ `
vec3 rk_hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}
float rk_noise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(rk_hash33(i + vec3(0,0,0)), f - vec3(0,0,0)),
                     dot(rk_hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                 mix(dot(rk_hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
                     dot(rk_hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(rk_hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
                     dot(rk_hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                 mix(dot(rk_hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
                     dot(rk_hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z) * 0.75 + 0.5;
}
float rk_fbm(vec3 p, int oct, float gain){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += a * rk_noise(p); n += a; p *= 2.03; a *= gain;
  }
  return s / max(n, 1e-4);
}
float rk_ridge(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    float v = 1.0 - abs(rk_noise(p) * 2.0 - 1.0);
    s += a * v * v; n += a; p *= 2.07; a *= 0.5;
  }
  return s / max(n, 1e-4);
}
`;

const FRAG_HEAD = /* glsl */ `
uniform sampler2D uBlueNoise;
uniform vec2 uBlueNoiseSize;
uniform float uOct;
uniform float uVeinGlow;
uniform float uBump;
uniform vec3 uRockDark;
uniform vec3 uRockLight;
uniform vec3 uRockDust;
uniform vec3 uRockVein;
varying vec3 vRockPos;
varying vec3 vRockNrm;
varying vec4 vRockData;
varying vec3 vRockView;
varying vec2 vRockSS;   // x = per-instance seed, y = instance radius (metres)

// One triplanar plate sample. The domain is stretched ~1:6 so the fbm reads as
// bedding/stratification rather than isotropic mush; blending three of these by
// the normal wraps strata around the whole rock with no UV and no seam.
// The stretch ratio is what makes this read as bedding rather than as mush,
// but it is also a trap: stretching means one axis is sampled far more finely
// than the other, and if that fine axis goes past a few cycles per metre the
// three blended planes cross-hatch into axis-aligned rectangles — a digital
// camouflage pattern crawling over the rock. Bands here are 20 m x 3.5 m.
float rk_plate(vec2 q, float k){
  return rk_fbm(vec3(q.x * 0.050, q.y * 0.285, k), 4, 0.52);
}
`;

/**
 * Albedo / roughness / vein / bump-height evaluation. Injected at
 * <map_fragment>, which runs before the roughness, metalness, normal and
 * emissive chunks, so everything declared here is visible to all of them.
 */
const FRAG_ALBEDO = /* glsl */ `
  int rockOct = int(uOct);
  vec3 rn = normalize(vRockNrm);
  float rockSeed = vRockSS.x;
  // Unit-sphere coords: features defined here scale WITH the rock, which is
  // what you want for structural things like vein systems (every rock gets a
  // few, regardless of size). Metre coords are used for the regolith, which
  // must NOT scale, or the sense of size collapses.
  vec3 pUnit = vRockPos / max(vRockSS.y, 1e-3);

  // --- how many metres does this pixel cover? ------------------------------
  // Everything finer than the pixel footprint has to be faded out or it turns
  // into shimmering confetti at distance. This one term is the difference
  // between "detailed rock" and "noise".
  vec3 dPdx = dFdx(vRockView);
  vec3 dPdy = dFdy(vRockView);
  float footprint = length(dPdx) + length(dPdy);

  // Per-layer weights: a detail layer whose features are smaller than the pixel
  // footprint must be faded out, or it aliases. Procedural noise has no mip
  // chain, so this IS the mip chain — and a layer at 2 m features viewed from
  // 1.5 km (where a pixel covers ~2 m) is exactly the case that turns a rock
  // into a moire chequerboard. Everything below is gated on it, which is also
  // why the surface "resolves" as you fly in rather than just getting bigger.
  #define RK_FADE(sz) (1.0 - smoothstep((sz) * 0.9, (sz) * 3.2, footprint))
  float fMacro  = RK_FADE(14.0);
  float fCoarse = RK_FADE(3.2);
  float fMid    = RK_FADE(0.85);
  float fFine   = RK_FADE(0.22);

  // --- triplanar blend weights (sharpened so the transition band is narrow) --
  vec3 bw = abs(rn);
  bw = bw * bw; bw = bw * bw;              // pow(|n|, 4)
  bw /= max(bw.x + bw.y + bw.z, 1e-4);

  float strat = 0.5;
  if (fCoarse > 0.01) {
    strat = bw.x * rk_plate(vRockPos.zy, 11.0)
          + bw.y * rk_plate(vRockPos.xz, 23.0)
          + bw.z * rk_plate(vRockPos.xy, 37.0);
  }

  // --- regolith stack, all in metres, all seamless 3D ----------------------
  // Skipping faded-out layers is also the single biggest fragment-cost saving
  // for the belt, where most rocks are a handful of pixels.
  float macro  = rk_fbm(vRockPos * 0.075 + rockSeed * 11.0, 3, 0.52);
  float grain  = 0.5, gravel = 0.5, fine = 0.5;
  if (fCoarse > 0.01) grain  = rk_fbm(vRockPos * 0.33 + rockSeed * 19.0, rockOct, 0.52);
  if (fMid    > 0.01) gravel = rk_fbm(vRockPos * 1.25 + rockSeed * 27.0, 3, 0.55);
  if (fFine   > 0.01) fine   = rk_noise(vRockPos * 5.0 + rockSeed * 31.0);

  float value = 0.5
              + (macro  - 0.5) * 0.80 * fMacro
              + (strat  - 0.5) * 0.46 * fCoarse
              + (grain  - 0.5) * 0.50 * fCoarse
              + (gravel - 0.5) * 0.26 * fMid;
  // Tight remap: bone-light plate against graphite shadow is the whole point of
  // the palette. A wide remap gives the muddy mid-grey of a hobby demo.
  vec3 rockAlb = mix(uRockDark, uRockLight, smoothstep(0.33, 0.67, value));
  rockAlb *= 1.0 + (fine - 0.5) * 0.34 * fFine;

  // --- cavity: baked crater depth + baked concavity darkens crevices --------
  float cav  = vRockData.x;
  float frac = vRockData.y;
  float ao   = vRockData.z;
  float crev = clamp(cav * 0.45 + (1.0 - ao) * 0.85, 0.0, 1.0);
  rockAlb = mix(rockAlb, uRockDark * 0.85, crev * 0.62);

  // --- fresh fracture faces: cleaner, slightly darker, undusted ------------
  rockAlb = mix(rockAlb, uRockDark * 1.55, frac * 0.22);

  // --- dust settles on locally up-facing surfaces --------------------------
  // Local (not world) up: the dust bonded when the rock formed, then the rock
  // started tumbling. Tying it to world up would make it slide as rocks spin.
  float dust = smoothstep(0.20, 0.85, rn.y) * (0.45 + 0.55 * macro);
  dust *= (0.35 + 0.65 * ao) * (1.0 - frac * 0.55);
  // Regolith also ponds in crater floors regardless of which way they face —
  // without this the bowls read as clean dark holes punched in the rock.
  dust = clamp(dust + cav * 0.45, 0.0, 1.0);
  rockAlb = mix(rockAlb, uRockDust, dust * 0.72);

  // --- mineral veins -------------------------------------------------------
  // A couple of host patches per rock gate a ridged strand network. Both live
  // in UNIT space so a pebble shows one vein and a monster shows a system of
  // them, instead of every rock being dusted with the same glitter.
  float veinRegion = smoothstep(0.48, 0.68, rk_fbm(pUnit * 1.15 + rockSeed * 3.0, 3, 0.5));
  float veinNet = rk_ridge(pUnit * 2.6 + rockSeed * 11.0, 3);
  float vein = smoothstep(0.845, 0.975, veinNet) * veinRegion;
  // Ore survives in cracks, gets buried by dust, and must fade to nothing once
  // a strand is thinner than a pixel.
  // Vein strands are unit-space, so their physical width scales with the rock;
  // fade them against a footprint threshold derived from the instance radius.
  vein *= (0.25 + 0.75 * crev) * (1.0 - dust * 0.8) * RK_FADE(vRockSS.y * 0.16);
  vein = clamp(vein, 0.0, 1.0);

  rockAlb = mix(rockAlb, uRockVein * 0.38, vein * 0.45);

  // --- bump height, in METRES, for the surface-gradient perturbation -------
  // ABSOLUTE metres, deliberately NOT scaled by rock size: the noise features
  // are metric too, so the slope (and therefore the apparent roughness) stays
  // physically constant from pebble to monster.
  float bumpH = (strat  - 0.5) * 0.30 * fCoarse
              + (grain  - 0.5) * 0.34 * fCoarse
              + (gravel - 0.5) * 0.10 * fMid
              + (fine   - 0.5) * 0.022 * fFine;

  // --- blue-noise dither: kills the fbm banding in the dark half -----------
  float bn = texture2D(uBlueNoise, gl_FragCoord.xy / max(uBlueNoiseSize, vec2(1.0))).r;
  rockAlb += (bn - 0.5) * 0.014;
`;

/**
 * Mikkelsen surface-gradient bump mapping, injected after
 * <normal_fragment_maps>. Works from an arbitrary procedural height with no
 * tangent frame and no normal map, which is exactly what we have.
 *
 * `normal` is view space here, and `vRockView` is view space, so the screen
 * derivatives of the two are in the same basis and the gradient is valid.
 * Without this the plane-cut facets shade as perfectly flat polygons — the
 * single biggest "untextured primitive" tell.
 */
const FRAG_BUMP = /* glsl */ `
  {
    float hx = dFdx(bumpH);
    float hy = dFdy(bumpH);
    vec3 R1 = cross(dPdy, normal);
    vec3 R2 = cross(normal, dPdx);
    float det = dot(dPdx, R1);
    vec3 surfGrad = sign(det) * (hx * R1 + hy * R2);
    // Hard clamp: a single noisy sample must never be able to invert the
    // normal, which would punch a black hole in the middle of a lit facet.
    float gm = length(surfGrad);
    surfGrad *= min(gm, abs(det) * 0.85) / max(gm, 1e-6);
    // bumpH is already footprint-faded layer by layer, so the gradient cannot
    // run away at distance; frac keeps big fracture planes flatter than the rest.
    float amt = uBump * (1.0 - frac * 0.45);
    normal = normalize(abs(det) * normal - amt * surfGrad);
  }
`;

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface Bucket {
  mesh: THREE.InstancedMesh;
  inst: THREE.InstancedBufferAttribute;
  cap: number;
}

/**
 * Draws the whole asteroid field: one InstancedMesh per (variant, LOD) plus a
 * single cheap debris mesh for parallax.
 *
 * The renderer is strictly read-only with respect to the World. Tumble is
 * derived as `rot + spin * time` rather than integrated, so the renderer never
 * mutates asteroid state and the field is identical after a save/load.
 */
export class AsteroidRenderer implements RenderSystem {
  private readonly scene: THREE.Scene;
  private readonly group = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly buckets: Bucket[] = [];
  private readonly counts = new Uint16Array(ROCK_VARIANTS * 3);

  private debris: THREE.InstancedMesh | null = null;
  private debrisGeo: THREE.BufferGeometry | null = null;
  private debrisCap = 0;

  private quality: QualitySettings;
  private lod0 = LOD_DIST[0];
  private lod1 = LOD_DIST[1];

  /**
   * Uniforms are owned here (not by the compiled shader) so `setQuality` can
   * poke them without waiting for or triggering a recompile.
   */
  private readonly uniforms = {
    uBlueNoise: { value: null as THREE.Texture | null },
    uBlueNoiseSize: { value: new THREE.Vector2(64, 64) },
    uOct: { value: 4 },
    uVeinGlow: { value: 1.0 },
    uBump: { value: 1.0 },
    uRockDark: { value: ROCK_DARK },
    uRockLight: { value: ROCK_LIGHT },
    uRockDust: { value: ROCK_DUST },
    uRockVein: { value: ROCK_VEIN },
  };

  constructor(
    scene: THREE.Scene,
    world: World,
    textures: TextureFactory,
    rng: Rng,
    quality: QualitySettings,
  ) {
    this.scene = scene;
    this.quality = quality;
    this.group.name = 'asteroids';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);

    // --- blue noise for dithering ----------------------------------------
    const bn = textures.blueNoise(64);
    bn.wrapS = THREE.RepeatWrapping;
    bn.wrapT = THREE.RepeatWrapping;
    this.uniforms.uBlueNoise.value = bn;
    if (bn.image) {
      const w = (bn.image as { width?: number }).width ?? 64;
      const h = (bn.image as { height?: number }).height ?? 64;
      this.uniforms.uBlueNoiseSize.value.set(w, h);
    }

    this.material = this.makeMaterial();

    // --- geometry: variants x LODs, all from one forked stream ------------
    const geoRng = rng.fork(0x51ce);
    const params: RockParams[] = [];
    for (let v = 0; v < ROCK_VARIANTS; v++) params.push(makeRockParams(geoRng));
    for (let v = 0; v < ROCK_VARIANTS; v++) {
      for (let l = 0; l < 3; l++) {
        this.geometries.push(buildRockGeometry(params[v], LOD_DETAIL[l]));
      }
    }

    // --- instance buffers, sized from the live field ----------------------
    const perVariant = new Uint16Array(ROCK_VARIANTS);
    const rocks = world.asteroids;
    for (let i = 0; i < rocks.count; i++) {
      const a = rocks.items[i];
      if (a.alive) perVariant[a.variant % ROCK_VARIANTS]++;
    }
    for (let v = 0; v < ROCK_VARIANTS; v++) {
      // +30% headroom so a later top-up spawn does not silently drop rocks.
      const cap = Math.max(16, Math.ceil(perVariant[v] * 1.3));
      for (let l = 0; l < 3; l++) {
        this.buckets.push(this.makeBucket(this.geometries[v * 3 + l], cap));
      }
    }

    this.buildDebris(world, rng.fork(0xdeb1), quality);
    this.applyQuality();
  }

  // -- construction helpers ------------------------------------------------

  private makeMaterial(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.03,
      // Emissive is driven entirely from the shader; the base contributes 0.
      emissive: 0x000000,
      emissiveIntensity: 1,
      // Geometry normals are smooth by design (see buildRockGeometry); the
      // faceting comes from the fragment bump, which resolves per pixel instead
      // of per triangle. Turning flatShading on here would reintroduce exactly
      // the tessellation ribbons the welding step exists to remove.
      flatShading: false,
      dithering: true,
    });

    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_VIEW}`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_ROCK_NOISE}\n${FRAG_HEAD}`)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>\n${FRAG_ALBEDO}\n  diffuseColor.rgb *= rockAlb;`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
  // Fracture faces are polished conchoidal glass; dust is matte; metallic
  // veins are the only thing allowed a tight highlight.
  roughnessFactor = clamp(mix(0.92, 0.68, frac) + dust * 0.12 - vein * 0.34
                          - (gravel - 0.5) * 0.12 * fMid, 0.20, 1.0);`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
  metalnessFactor = clamp(0.02 + vein * 0.65 + frac * 0.05 - dust * 0.02, 0.0, 1.0);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>\n${FRAG_BUMP}`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
  // Hot core with falloff: the vein term is already smoothstepped, squaring it
  // concentrates the glow into the crack itself so bloom bleeds off a line
  // rather than a flat blob. vRockData.w is 0 for depleted rock.
  totalEmissiveRadiance += uRockVein * (vein * vein) * uVeinGlow * vRockData.w;`,
        );
    };
    // Distinguish this program from a stock MeshStandardMaterial in the cache.
    m.customProgramCacheKey = () => 'starfall-rock';
    return m;
  }

  private makeBucket(geo: THREE.BufferGeometry, cap: number): Bucket {
    // Each (variant, LOD) needs its OWN geometry object because the per-instance
    // attribute lives on the geometry; sharing would alias the instance data.
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    // Culling is done per-asteroid below; three's own test would use a bogus
    // bounding sphere derived from the unit-radius geometry.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;

    const inst = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    inst.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInst', inst);

    this.group.add(mesh);
    return { mesh, inst, cap };
  }

  /**
   * Tiny non-collectable pebbles. They exist purely for parallax: fast-moving
   * near-field specks against the slow belt is the cheapest possible cue that
   * the camera is moving through kilometres of space.
   *
   * They are seeded FROM the live asteroids so the debris follows whatever
   * layout `generateAsteroidField` produced, rather than duplicating it.
   */
  private buildDebris(world: World, rng: Rng, quality: QualitySettings): void {
    const cap = DEBRIS_BY_PRESET[DEBRIS_BY_PRESET.length - 1];
    this.debrisCap = cap;

    // One 80-triangle chunk; variety comes from rotation and squash.
    const pebbleParams = makeRockParams(rng);
    const geo = buildRockGeometry(pebbleParams, 1);
    this.debrisGeo = geo;

    const inst = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    geo.setAttribute('aInst', inst);

    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'asteroidDebris';

    // Collect live rocks to anchor the debris to.
    const anchors: Asteroid[] = [];
    for (let i = 0; i < world.asteroids.count; i++) {
      const a = world.asteroids.items[i];
      if (a.alive) anchors.push(a);
    }

    const R = CONFIG.mapRadius;
    const dir = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < cap; i++) {
      let px: number, py: number, pz: number, size: number;
      if (anchors.length > 0 && rng.next() < 0.78) {
        // Halo around a real rock — debris belongs to its parent body.
        const a = anchors[rng.int(0, anchors.length - 1)];
        rng.onSphere(dir);
        const d = a.radius * rng.range(1.4, 9.0);
        px = a.pos.x + dir.x * d;
        py = a.pos.y + dir.y * d * 0.7;
        pz = a.pos.z + dir.z * d;
        size = clamp(a.radius * rng.range(0.02, 0.10), 1.2, 9);
      } else {
        const ang = rng.range(0, TAU);
        const rr = R * rng.range(0.24, 0.9);
        px = Math.cos(ang) * rr;
        pz = Math.sin(ang) * rr;
        py = rng.gauss() * CONFIG.mapHeight * 0.22;
        size = rng.range(1.5, 7);
      }

      _pos.set(px, py, pz);
      _euler.set(rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU));
      _quat.setFromEuler(_euler);
      _scl.set(
        size * rng.range(0.7, 1.35),
        size * rng.range(0.7, 1.35),
        size * rng.range(0.7, 1.35),
      );
      _mat.compose(_pos, _quat, _scl);
      mesh.setMatrixAt(i, _mat);
      // richness 0 -> pebbles never glow; they are not harvestable.
      inst.setXYZW(i, rng.next(), 0, 0, size);
    }
    mesh.instanceMatrix.needsUpdate = true;
    inst.needsUpdate = true;
    mesh.count = DEBRIS_BY_PRESET[quality.preset];
    mesh.visible = mesh.count > 0;

    this.debris = mesh;
    this.group.add(mesh);
  }

  private applyQuality(): void {
    const q = this.quality;
    const bias = Math.max(0.25, q.lodBias || 1);
    this.lod0 = LOD_DIST[0] * bias;
    this.lod1 = LOD_DIST[1] * bias;
    this.uniforms.uOct.value = OCTAVES_BY_PRESET[q.preset];
    // Without bloom the veins need a stronger raw value to read at all.
    this.uniforms.uVeinGlow.value = q.bloom ? 3.4 : 1.8;
    this.uniforms.uBump.value = q.preset === 0 ? 0.6 : 1.0;
    if (this.debris) {
      this.debris.count = Math.min(this.debrisCap, DEBRIS_BY_PRESET[q.preset]);
      this.debris.visible = this.debris.count > 0;
    }
  }

  // -- RenderSystem --------------------------------------------------------

  /**
   * Per-frame: cull, pick a LOD, and compose the tumble transform for every
   * live asteroid into the right instance bucket. Zero allocations.
   */
  update(ctx: RenderContext, world: World): void {
    const cam = ctx.camera;
    _viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProj);

    this.counts.fill(0);

    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const t = ctx.time;
    const rocks = world.asteroids;

    for (let i = 0; i < rocks.count; i++) {
      const a = rocks.items[i];
      if (!a.alive) continue;

      // Mined-out rocks shrink slightly — enough to notice over a match,
      // small enough that the sim collision radius stays honest.
      const frac = a.amountMax > 0 ? clamp(a.amount / a.amountMax, 0, 1) : 1;
      const vis = a.radius * (0.86 + 0.14 * frac);

      _sphere.center.copy(a.pos);
      _sphere.radius = vis * 1.16;          // covers the per-instance squash
      if (!_frustum.intersectsSphere(_sphere)) continue;

      const dx = a.pos.x - cx, dy = a.pos.y - cy, dz = a.pos.z - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const lod = dist < vis * this.lod0 ? 0 : dist < vis * this.lod1 ? 1 : 2;
      const b = (a.variant % ROCK_VARIANTS) * 3 + lod;
      const bucket = this.buckets[b];
      const n = this.counts[b];
      if (n >= bucket.cap) continue;

      // Tumble = initial phase + angular velocity * elapsed. Derived, never
      // integrated, so this stays a pure read of the World.
      _euler.set(
        a.rot.x + a.spin.x * t,
        a.rot.y + a.spin.y * t,
        a.rot.z + a.spin.z * t,
      );
      _quat.setFromEuler(_euler);

      // Cheap deterministic per-instance squash from the stored seed; mean 1.0
      // so `vis` remains the honest average radius.
      const s = a.seed;
      const j0 = s * 13.31 - Math.floor(s * 13.31);
      const j1 = s * 7.71 - Math.floor(s * 7.71);
      const j2 = s * 3.37 - Math.floor(s * 3.37);
      _scl.set(
        vis * (0.86 + 0.28 * j0),
        vis * (0.86 + 0.28 * j1),
        vis * (0.86 + 0.28 * j2),
      );
      _mat.compose(a.pos, _quat, _scl);
      bucket.mesh.setMatrixAt(n, _mat);

      // Depleted rock loses its glow entirely; a partly mined rock dims.
      const richness = a.amount <= 0 ? 0 : 0.32 + 0.68 * frac;
      bucket.inst.setXYZW(n, s, richness, 0, vis);

      this.counts[b] = n + 1;
    }

    for (let b = 0; b < this.buckets.length; b++) {
      const bucket = this.buckets[b];
      const n = this.counts[b];
      bucket.mesh.count = n;
      bucket.mesh.visible = n > 0;
      if (n > 0) {
        bucket.mesh.instanceMatrix.needsUpdate = true;
        bucket.inst.needsUpdate = true;
      }
    }
  }

  /** Apply new quality settings — LOD bias, shader octaves, debris density. */
  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.applyQuality();
  }

  /**
   * Ray/sphere test against the field. Returns the id of the nearest asteroid
   * the ray enters, or -1. Direction need not be normalised.
   */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    world: World,
  ): number {
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 1e-9) return -1;
    const nx = dx / dl, ny = dy / dl, nz = dz / dl;

    let best = -1;
    let bestT = Infinity;
    const rocks = world.asteroids;
    for (let i = 0; i < rocks.count; i++) {
      const a = rocks.items[i];
      if (!a.alive) continue;
      const ex = a.pos.x - ox, ey = a.pos.y - oy, ez = a.pos.z - oz;
      const proj = ex * nx + ey * ny + ez * nz;
      if (proj <= 0) continue;                 // behind the ray origin
      // Pick radius is padded a touch so small rocks stay clickable.
      const r = a.radius * 1.12;
      const perp2 = ex * ex + ey * ey + ez * ez - proj * proj;
      const rr = r * r;
      if (perp2 > rr) continue;
      const t = proj - Math.sqrt(rr - perp2);
      if (t < bestT) {
        bestT = t;
        best = a.id;
      }
    }
    return best;
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const b of this.buckets) {
      b.mesh.dispose();
      this.group.remove(b.mesh);
    }
    this.buckets.length = 0;
    if (this.debris) {
      this.debris.dispose();
      this.group.remove(this.debris);
      this.debris = null;
    }
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    if (this.debrisGeo) {
      this.debrisGeo.dispose();
      this.debrisGeo = null;
    }
    this.material.dispose();
    // uBlueNoise belongs to the TextureFactory — not ours to dispose.
    this.uniforms.uBlueNoise.value = null;
  }
}
