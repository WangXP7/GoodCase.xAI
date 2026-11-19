/**
 * WEAPON FX — everything that comes out of a gun.
 *
 * ---------------------------------------------------------------------------
 * WHAT LIVES HERE
 * ---------------------------------------------------------------------------
 *   tracers   pulse / massdriver / flak bolts, velocity-stretched, one draw
 *   darts     missile & torpedo bodies, lit, one draw, plus smoke trails
 *   plasma    pulsing noise-warped blobs, one draw
 *   beams     ion lances, screen-facing ribbons, one draw
 *   flares    muzzle flashes, impact flashes, motor flares, beam end caps
 *   shields   hex-cell ripple shells raised by a shielded hit
 *
 * Seven draw calls total, regardless of how many things are shooting.
 *
 * ---------------------------------------------------------------------------
 * DESIGN
 * ---------------------------------------------------------------------------
 * There are two kinds of effect and they are pooled differently.
 *
 *   PERSISTENT effects mirror sim state that already exists — a live projectile,
 *   a live beam. They are rewritten from scratch every frame: the batch is
 *   rewound to slot 0, the world is walked, and `instanceCount` ends up equal to
 *   the number of live entities. No lifetime bookkeeping, no leaks, no drift
 *   between what the sim thinks is flying and what the player sees.
 *
 *   TRANSIENT effects are raised by a `bus` event and outlive the frame that
 *   spawned them — muzzle flashes, impact flashes, shield ripples. They go into
 *   a ring buffer with a birth timestamp; the vertex shader animates and then
 *   collapses them, and the CPU never touches the slot again. The whole ring
 *   rewinds once every instance in it has expired.
 *
 * Both live in the same `Batch` class; `ring` picks the policy.
 *
 * The one piece of real per-frame state is the missile/torpedo smoke trail. A
 * trail must be laid down at a fixed spacing in METRES, not once per frame, or
 * it thins out when the framerate rises and beads when it drops. Two flat arrays
 * indexed by projectile id (pool slot) hold the last emit point and the distance
 * owed; a frame stamp detects slot reuse. Zero allocation, framerate-independent
 * trails.
 *
 * ---------------------------------------------------------------------------
 * INTEGRATOR NOTES
 * ---------------------------------------------------------------------------
 *  - Construct AFTER the ParticleSystem; this module emits through it.
 *  - `update` must be called every rendered frame; it is what draws projectiles
 *    and beams at all.
 *  - `hit.team` / `fire.team` are read as the FIRING team. For a shielded hit
 *    the victim (and therefore the shield colour and bubble radius) is recovered
 *    from the spatial hash, so the sim does not need to widen the event.
 *  - `flak` is drawn as a fat, short, warm tracer. It is not in the brief but it
 *    is in the registry, and an unhandled weapon kind would be invisible.
 *  - Every material writes log-depth, matching the renderer's
 *    `logarithmicDepthBuffer` setting used by the hull pass.
 */

import * as THREE from 'three';
import { bus } from '../core/bus';
import { CONFIG } from '../core/config';
import {
  GLSL_NOISE,
  GLSL_UTIL,
  type RenderContext,
  type RenderSystem,
  type TextureFactory,
} from '../core/contracts';
import { PALETTES } from '../core/palette';
import { SHIP_SPECS } from '../core/registry';
import { Rng } from '../core/rng';
import { Team, TEAM_COUNT, type GameEvents, type QualitySettings, type WeaponKind } from '../core/types';
import type { World } from '../sim/world';
import { P, type ParticleSystem } from './particles';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Segments along a beam ribbon. Enough that perspective stays honest when a
 *  lance passes close to the camera; a flat quad would visibly pivot. */
const BEAM_SEGS = 14;

/**
 * Minimum angular half-width of a tracer, radians. Below roughly this a bolt is
 * sub-pixel and a firefight reads as empty space. At the 45 deg vertical FOV
 * this build uses, 1 px is ~7.7e-4 rad at 1080p, so 0.0018 is ~2.3 px
 * half-width; the sheath lobe reaches ~1.3 half-widths, i.e. a 6 px line.
 *
 * CRITIQUE ROUND 2 (weapons.ts, blocker) asked to "raise MIN_ANGLE_BODY ... so a
 * bolt at 3 km is at least 40 px LONG". That budget is deliberately NOT spent on
 * width: measured on verify/ref/hw244160_3.jpg the reference tracers are 4-6 px
 * ACROSS and 400-1400 px ALONG. Width stays near 6 px and the whole increase
 * goes into `WeaponLook.minLen` below. A fatter core is what made round 1's
 * bolts read as lozenges in the first place.
 */
const MIN_ANGLE = 0.0018;

/**
 * Minimum angular HALF-width of a beam, radians. Beams are a separate floor from
 * tracers because they are the money shot: 0.0085 rad is ~11 px half-core, so an
 * ion lance at any range is a ~30 px bar of light inside a ~180 px glow.
 *
 * CRITIQUE ROUND 2: "make beams genuinely enormous and dominant when they fire" —
 * verify/ref/hw244160_2.jpg's beam is ~60 px across and spans 1200 px. The old
 * floor (MIN_ANGLE * 1.15 = 0.0018 rad) drew a 5 px hairline.
 */
const MIN_ANGLE_BEAM = 0.0085;

/** Minimum angular length of a missile body, radians — same argument, applied to
 *  the dart mesh, and capped so it never inflates into a flying bus. */
const MIN_ANGLE_BODY = 0.011;
const BODY_MAX_INFLATE = 4.2;

/** Instance capacities. Tracers must cover the whole projectile pool. */
const CAP_TRACER = CONFIG.maxProjectiles;
const CAP_DART = 1024;
const CAP_PLASMA = 512;
const CAP_BEAM = CONFIG.maxBeams;
const CAP_FLASH = 1024;
const CAP_LIVE_FLARE = 2560;
const CAP_SHIELD = 96;

/** Render order. Particles occupy 20 (alpha) and 21 (additive). */
const ORDER_DART = 2;
const ORDER_TRACER = 16;
const ORDER_PLASMA = 17;
const ORDER_SHIELD = 18;
const ORDER_BEAM = 19;
const ORDER_FLARE = 22;

/** Ember hue that warm weapons are tinted toward, linear RGB. */
const EMBER_R = 1.0, EMBER_G = 0.26, EMBER_B = 0.04;

/** Max smoke puffs a single missile may lay down in one frame (spike guard). */
const TRAIL_BUDGET = 16;

/** Flare sprite variants — see the fragment shader. */
const FLARE_CORE = 0;
const FLARE_STAR = 1;
const FLARE_SOFT = 2;
const FLARE_RING = 3;

// ---------------------------------------------------------------------------
// Per-weapon art direction
// ---------------------------------------------------------------------------

/**
 * Everything the look of one weapon kind needs, in one row.
 *
 * CRITIQUE ROUND 1 (weapons.ts, blocker): "zero readable tracers ... ~30
 * identical soft white-orange capsules with no hot core and no colour
 * separation by weapon type". Four axes now separate the kinds, and every one
 * of them is legible at battle range:
 *
 *   LENGTH     `streak` x muzzle velocity, floored by `minLen` in ANGLE, so a
 *              massdriver slug is a 200 m lance and a flak shell is a stub —
 *              and both stay that ratio however far the camera is.
 *   THICKNESS  `width` / `widthAng`: flak is four times the core width of a
 *              pulse bolt at the same range.
 *   COLOUR     `mix*` + `sat`: each kind pulls the team hue toward its own
 *              chroma target and is then re-saturated, so gold slugs, cyan
 *              repeater bolts, orange flak and violet plasma never collapse to
 *              the same white-orange.
 *   BEHAVIOUR  `tail` sets how fast the streak bleeds off behind the round.
 */
interface WeaponLook {
  /** Tracer core HALF-WIDTH, metres (world-space, close range). */
  width: number;
  /** Minimum angular core half-width, in units of `MIN_ANGLE`. */
  widthAng: number;
  /** Seconds of travel the streak spans — the stretch is `speed * streak`. */
  streak: number;
  /**
   * Minimum angular HALF-length, radians. This is what makes a tracer a LINE.
   *
   * KIND MUST READ AS KIND. Round 3: "the weapon system is not good in terms of
 * type — like bullet, laser — now felt like light pillars." Every kind had a
 * long angular floor and a slow tail, so a repeater bolt, a mass-driver slug and
 * a torpedo all rendered as the same uniform glowing bar and only the hue
 * differed. Kinetics are now SHORT and dense with a hard bright head and a fast
 * tail falloff (high `tail`), so they read as rounds in flight; the ion beam
 * keeps its long continuous form, which is what makes it read as a beam BY
 * CONTRAST. Length is no longer the axis that separates them — behaviour is.
 *
 * CALIBRATION WARNING. These are ANGULAR floors, so they set a tracer's length
   * in PIXELS irrespective of range — that is the point, but it means they must
   * be judged against how big the SHIPS are on screen, not in isolation. Round 2
   * asked for "a bolt at 3 km at least 40 px long" and the floors were set to
   * 0.020-0.105 rad, which at a 45 degree vertical FOV over 1440 px is 73-385 px
   * per tracer. Measured on a framed engagement where hulls were ~10 px, that
   * put a 38:1 ratio between a bolt and the ship that fired it: the frame became
   * a starburst of yellow bars and the entire fleet was invisible behind it.
   * Scaled to 0.009-0.0285 rad (~33-105 px), which still reads as a line at any
   * range without eating the fleet.
   *
   * It also, with `widthAng`, DEFINES the kind's aspect ratio: the shader clamps
   * the core width to `halfLen * (widthAng * MIN_ANGLE / minLen)`, so a
   * massdriver slug holds ~50:1 and a flak stub ~4:1 at every distance, near or
   * far. Critique round 2: "the reference tracers are constant-width rules with
   * a hard tail cut, and that constancy is precisely what separates a shot from
   * an exhaust."
   */
  minLen: number;
  /** HDR multiplier on the searing white core. */
  core: number;
  /** Tail falloff exponent; higher = shorter, harder tail. */
  tail: number;
  /**
   * PEAK linear radiance of the coloured sheath. `buildTints` normalises every
   * tint so `max(r, g, b) === gain`, which makes this the single number that
   * decides whether a bolt keeps its chroma or clips to white: below ~1.1 the
   * strongest channel lands at ACES ~0.86 and the weaker ones stay well under
   * it, so the line reads as GOLD or CYAN; above ~2 every channel saturates and
   * every weapon on the field is the same white smear again. Round 2 measured
   * the failure: 99.6% of our bright pixels had chroma < 0.10.
   */
  gain: number;
  /** 0 = pure team colour, 1 = pure `mix` target. */
  warm: number;
  /** Per-kind chroma target, linear RGB (see `warm`). */
  mixR: number; mixG: number; mixB: number;
  /** Chroma boost applied after the mix; 1 = untouched, >1 = more saturated. */
  sat: number;
  /** Muzzle flash radius in metres at event scale 1. */
  flash: number;
  /** Muzzle sparks at quality 2, per shot. */
  sparks: number;
  /** Impact spark multiplier — beams tick every step and must be damped. */
  impact: number;
}

/** Chroma targets. Distinct enough that a still frame parses the weapon mix. */
const GOLD_R = 1.0, GOLD_G = 0.82, GOLD_B = 0.18;
const VIOLET_R = 0.80, VIOLET_G = 0.20, VIOLET_B = 1.0;
const ICE_R = 0.30, ICE_G = 0.88, ICE_B = 1.0;

/**
 * CRITIQUE ROUND 2 (weapons.ts, blocker), two measured notes drive this table.
 *
 * LENGTH. "I find exactly two tracers in a 92-ship engagement and both read as
 * comets." Measured on verify/ref/hw244160_3.jpg the reference lances run
 * 400-1400 px long on a 1920-wide frame at 4-6 px across. Round 2's `minLen`
 * floors (0.024 rad half for pulse, 0.042 for massdriver) drew 62 px and 110 px
 * FULL length at 1080p — an order of magnitude short. They are now 0.055 and
 * 0.105 rad, i.e. ~145 px and ~275 px full length at 3 km, and the near-field
 * `streak` seconds were raised to match so a close pass streaks too.
 *
 * COLOUR. "Pulse and massdriver are currently the same warm white ... split the
 * palette by weapon kind so the frame parses by colour alone." The `warm` mix
 * toward each kind's own chroma target is now the DOMINANT term (0.72-0.90) for
 * every kind, so the KIND owns the hue and the team owns only a lean inside it:
 *
 *   pulse       cool white-cyan, the thinnest line on the field
 *   massdriver  yellow-gold, the longest
 *   flak        deep red-orange, a stub
 *   plasma      violet / magenta, a fat slow blob with a short wake
 *   ion         ice cyan, and enormous
 *
 * This is a deliberate trade against round 1's "a player massdriver is still
 * recognisably blue next to an enemy one". Mixing a cyan team hue with a gold
 * kind hue lands on neutral: measured through ACES, the old table gave player
 * massdriver a chroma of 0.23 and enemy ion 0.18 — i.e. white, which is exactly
 * the failure being reported. Kind-dominant mixes measure 0.84-0.96 for the same
 * pairs. Team identity is carried by hull paint, engine plume and HUD, all of
 * which are legible in the same frame.
 */
const LOOKS: Record<WeaponKind, WeaponLook> = {
  none: {
    width: 0.40, widthAng: 1.0, streak: 0.070, minLen: 0.0105,
    core: 0.90, tail: 1.5, gain: 0.72, warm: 0.45,
    mixR: EMBER_R, mixG: EMBER_G, mixB: EMBER_B, sat: 1.1,
    flash: 1.4, sparks: 3, impact: 0.6,
  },
  /** Repeater: the thinnest line on the field, cool white-cyan, team-leaning. */
  pulse: {
    width: 0.34, widthAng: 0.80, streak: 0.055, minLen: 0.0058,
    core: 1.90, tail: 2.60, gain: 0.86, warm: 0.72,
    mixR: ICE_R, mixG: ICE_G, mixB: ICE_B, sat: 1.55,
    flash: 2.4, sparks: 6, impact: 1.0,
  },
  /** Slug: the LONGEST, thinnest, hottest thing on the field — a gold lance. */
  massdriver: {
    width: 0.60, widthAng: 0.95, streak: 0.085, minLen: 0.0092,
    core: 2.30, tail: 2.20, gain: 0.94, warm: 0.85,
    mixR: GOLD_R, mixG: GOLD_G, mixB: GOLD_B, sat: 1.45,
    flash: 5.0, sparks: 11, impact: 1.5,
  },
  /** Flak: a stubby, fat, warm airburst slug. Short on purpose. */
  flak: {
    width: 1.75, widthAng: 2.40, streak: 0.030, minLen: 0.0042,
    core: 1.45, tail: 2.40, gain: 0.98, warm: 0.88,
    mixR: EMBER_R, mixG: EMBER_G, mixB: EMBER_B, sat: 1.35,
    flash: 4.4, sparks: 8, impact: 1.2,
  },
  ion: {
    width: 5.0, widthAng: 1.10, streak: 0.0, minLen: 0.0,
    core: 3.0, tail: 1.0, gain: 0.82, warm: 0.90,
    mixR: ICE_R, mixG: ICE_G, mixB: ICE_B, sat: 1.60,
    flash: 7.0, sparks: 0, impact: 0.16,
  },
  missile: {
    width: 0.40, widthAng: 0.85, streak: 0.040, minLen: 0.0050,
    core: 1.45, tail: 2.80, gain: 0.80, warm: 0.75,
    mixR: EMBER_R, mixG: EMBER_G, mixB: EMBER_B, sat: 1.35,
    flash: 3.2, sparks: 4, impact: 1.8,
  },
  torpedo: {
    width: 0.62, widthAng: 0.95, streak: 0.048, minLen: 0.0060,
    core: 1.60, tail: 2.60, gain: 0.86, warm: 0.78,
    mixR: EMBER_R, mixG: EMBER_G, mixB: EMBER_B, sat: 1.35,
    flash: 5.5, sparks: 6, impact: 2.6,
  },
  /** Plasma: slow, fat, violet-shifted, with a short bright wake. */
  plasma: {
    width: 2.2, widthAng: 1.15, streak: 0.115, minLen: 0.0165,
    core: 1.25, tail: 0.9, gain: 0.92, warm: 0.82,
    mixR: VIOLET_R, mixG: VIOLET_G, mixB: VIOLET_B, sat: 1.50,
    flash: 8.0, sparks: 10, impact: 2.4,
  },
};

/** Dense integer index for `WeaponKind`, used to key the precomputed colours. */
const KIND_INDEX: Record<WeaponKind, number> = {
  none: 0, pulse: 1, massdriver: 2, flak: 3, ion: 4, missile: 5, torpedo: 6, plasma: 7,
};
const KIND_COUNT = 8;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** A unit quad centred on the origin; the vertex shader supplies the basis. */
function quadGeom(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * A ribbon strip: x spans -0.5..0.5 (across), y spans 0..1 (along). Subdivided
 * so each vertex can rebuild its own camera-facing side vector.
 */
function stripGeom(segs: number): THREE.BufferGeometry {
  const pos = new Float32Array((segs + 1) * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const o = i * 6;
    pos[o] = -0.5; pos[o + 1] = t; pos[o + 2] = 0;
    pos[o + 3] = 0.5; pos[o + 4] = t; pos[o + 5] = 0;
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * A missile/torpedo body: a faceted tapered dart of unit length lying along +Z,
 * spanning z = -0.5 (motor) .. +0.5 (nose tip), radius ~0.11.
 *
 * Built non-indexed so `computeVertexNormals` yields flat facets — a smooth
 * capsule at this size reads as a sausage, facets read as machined ordnance.
 */
function dartGeom(): THREE.BufferGeometry {
  const SIDES = 7;
  // (z, radius) rings, nose last. The slight skirt at the tail is the motor bell.
  const rings: Array<[number, number]> = [
    [-0.50, 0.075],
    [-0.44, 0.125],
    [-0.30, 0.108],
    [0.16, 0.104],
    [0.50, 0.0],
  ];
  const verts: number[] = [];
  const push = (z: number, r: number, s: number): void => {
    const a = (s / SIDES) * Math.PI * 2;
    verts.push(Math.cos(a) * r, Math.sin(a) * r, z);
  };
  for (let k = 0; k < rings.length - 1; k++) {
    const [z0, r0] = rings[k];
    const [z1, r1] = rings[k + 1];
    for (let s = 0; s < SIDES; s++) {
      const s1 = (s + 1) % SIDES;
      // Two triangles per quad; the nose ring is degenerate (r1 = 0) and simply
      // produces a sliver that computeVertexNormals still handles.
      push(z0, r0, s); push(z0, r0, s1); push(z1, r1, s1);
      push(z0, r0, s); push(z1, r1, s1); push(z1, r1, s);
    }
  }
  // Tail cap so the motor bell is not see-through from behind.
  for (let s = 0; s < SIDES; s++) {
    const s1 = (s + 1) % SIDES;
    verts.push(0, 0, -0.5);
    push(-0.5, 0.075, s1);
    push(-0.5, 0.075, s);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Batch — one instanced draw, one pooling policy
// ---------------------------------------------------------------------------

/**
 * A pool of `vec4` instance attributes over a shared base geometry.
 *
 * Two policies:
 *   `ring = false`  persistent mirror. Call `rewind()` at frame start, `claim()`
 *                   once per live entity, `flush()` at the end.
 *   `ring = true`   transient events. `claim()` walks a ring and recycles the
 *                   oldest slot under pressure; `keepUntil(t)` records the death
 *                   time so the ring can rewind wholesale once it drains.
 */
class Batch {
  readonly cap: number;
  /** One Float32Array per declared attribute, `cap * 4` long. */
  readonly f: Float32Array[];
  readonly geom: THREE.InstancedBufferGeometry;
  readonly mesh: THREE.Mesh;

  private readonly attrs: THREE.InstancedBufferAttribute[];
  private head = 0;
  private used = 0;
  /** Dirty slot span written since the last flush. */
  private lo = 0x7fffffff;
  private hi = -1;
  /** Ring only: latest absolute death time written into the pool. */
  private expiry = -1;
  private readonly ring: boolean;

  constructor(
    base: THREE.BufferGeometry,
    names: readonly string[],
    material: THREE.Material,
    cap: number,
    ring: boolean,
    renderOrder: number,
    name: string,
  ) {
    this.cap = Math.max(1, cap | 0);
    this.ring = ring;

    const g = new THREE.InstancedBufferGeometry();
    const bp = base.getAttribute('position');
    g.setAttribute('position', bp);
    const bn = base.getAttribute('normal');
    if (bn) g.setAttribute('normal', bn);
    const bi = base.getIndex();
    if (bi) g.setIndex(bi);

    this.f = [];
    this.attrs = [];
    for (let i = 0; i < names.length; i++) {
      const arr = new Float32Array(this.cap * 4);
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(names[i], a);
      this.f.push(arr);
      this.attrs.push(a);
    }

    g.instanceCount = 0;
    // FX are scattered across the whole battlespace; never cull the draw itself.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.geom = g;

    const mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    this.mesh = mesh;
  }

  /** Persistent policy: drop last frame's contents and write from slot 0. */
  rewind(): void {
    this.head = 0;
    this.used = 0;
  }

  /**
   * Claim a slot. Returns the float offset (`slot * 4`) into every array in
   * `f`, or -1 when a persistent batch is full.
   */
  claim(): number {
    if (this.head >= this.cap) {
      if (!this.ring) return -1;
      this.head = 0;
    }
    const s = this.head++;
    if (s + 1 > this.used) this.used = s + 1;
    if (s < this.lo) this.lo = s;
    if (s + 1 > this.hi) this.hi = s + 1;
    return s * 4;
  }

  /** Ring policy: record when the just-claimed instance stops being visible. */
  keepUntil(t: number): void {
    if (t > this.expiry) this.expiry = t;
  }

  /** Upload the dirty span and publish the draw count. */
  flush(now: number): void {
    if (this.hi > this.lo) {
      const start = this.lo * 4;
      const count = (this.hi - this.lo) * 4;
      for (let i = 0; i < this.attrs.length; i++) {
        const a = this.attrs[i];
        a.addUpdateRange(start, count);
        a.needsUpdate = true;
      }
    }
    this.lo = 0x7fffffff;
    this.hi = -1;

    // A drained ring collapses back to nothing so a single early muzzle flash
    // does not leave 1024 degenerate instances in the draw for the whole match.
    if (this.ring && this.used > 0 && now > this.expiry) {
      this.used = 0;
      this.head = 0;
    }
    this.geom.instanceCount = this.used;
  }

  /** Kill everything immediately. */
  clear(): void {
    for (let i = 0; i < this.f.length; i++) this.f[i].fill(0);
    for (let i = 0; i < this.attrs.length; i++) this.attrs[i].needsUpdate = true;
    this.head = 0;
    this.used = 0;
    this.expiry = -1;
    this.geom.instanceCount = 0;
  }

  dispose(): void {
    this.geom.dispose();
  }
}

// ---------------------------------------------------------------------------
// Shared GLSL
// ---------------------------------------------------------------------------

/** Camera-facing billboard prologue shared by the quad batches. */
const GLSL_BILLBOARD = /* glsl */ `
/**
 * Offset a view-space centre into a camera-facing quad corner.
 *   corner  quad corner in -0.5..0.5
 *   halfW   half width, metres     halfL  half length, metres
 *   axis    view-space direction the quad's +y is stretched along (may be 0)
 *   bias    extra along-axis shift in units of halfL (-1 pins the head at the
 *           centre and trails the body behind it)
 */
vec2 sf_billboard(vec2 corner, float halfW, float halfL, vec3 axis, float bias) {
  vec2 ax = vec2(0.0, 1.0);
  float l = length(axis.xy);
  if (l > 1e-5) ax = axis.xy / l;
  vec2 pp = vec2(-ax.y, ax.x);
  return pp * (corner.x * 2.0 * halfW) + ax * ((corner.y * 2.0 + bias) * halfL);
}
`;

/** Hexagonal lattice, iq-style: nearest cell centre + its integer id. */
const GLSL_HEX = /* glsl */ `
/** Returns xy = offset from the cell centre, zw = cell id. */
vec4 sf_hexCell(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hc.xy) : vec4(h.zw, hc.zw + 0.5);
}
/** Hexagonal distance metric — 0.5 at the cell edge. */
float sf_hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}
`;

/** The `#include` set every FX material needs to sit correctly in the frame. */
const PARS_V = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
`;
const PARS_F = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
`;
// NOTE: three injects <tonemapping_pars_fragment> and <colorspace_pars_fragment>
// into every fragment prefix. Declaring them here would redefine toneMapping()
// and fail to link — only the *_fragment chunks are included, at the end.

// ---------------------------------------------------------------------------
// Tracers — pulse / massdriver / flak
// ---------------------------------------------------------------------------

/** Tracer quad half-width, in core half-widths. Sets how far the glow reaches. */
const TRACER_GLOW = 2.6;

const TRACER_V = /* glsl */ `
${PARS_V}
${GLSL_BILLBOARD}

attribute vec4 aPos;  // xyz world position (head of the bolt)   w core half-width, m
attribute vec4 aVel;  // xyz world velocity, m/s                 w streak seconds
attribute vec4 aCol;  // rgb sheath colour, linear HDR           a master intensity
attribute vec4 aInf;  // x core boost  y tail exponent
                      // z min angular half-WIDTH   w min angular half-LENGTH

varying vec2 vQ;      // x across in core half-widths;  y along, 0 tail .. 1 head
varying vec4 vCol;
varying vec3 vInf;    // core boost, tail exponent, aspect (halfLen / coreWidth)

const float GLOW = ${TRACER_GLOW.toFixed(2)};

void main() {
  vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);
  float depth = max(-mv.z, 1.0);

  // Core half-width: never thinner than a couple of pixels, however far away.
  float w = max(aPos.w, depth * aInf.z);

  // VELOCITY-STRETCH FROM ACTUAL VELOCITY. The streak spans the distance the
  // bolt covers in aVel.w seconds, PROJECTED onto the screen plane, so a round
  // fired at the camera correctly foreshortens into a dot instead of smearing
  // off-screen, and a broadside round streaks its full length.
  vec3 vv = (modelViewMatrix * vec4(aVel.xyz, 0.0)).xyz;
  float vxy = length(vv.xy);
  float vlen = max(length(vv), 1e-4);
  float fore = vxy / vlen;          // 1 = broadside, 0 = coming straight at us

  // ...plus a minimum ANGULAR length, so a tracer is still a LINE at 6 km. This
  // is the fix for "zero readable tracers": previously the only floor was the
  // width floor, which turned every distant bolt into a round blob. Faded by
  // "fore" so a head-on round is never stretched along an arbitrary axis.
  float halfLen = max(vxy * aVel.w * 0.5, depth * aInf.w * fore);
  halfLen = max(halfLen, w);

  // ASPECT LOCK (critique round 2: "constant-width rules ... that constancy is
  // precisely what separates a shot from an exhaust"). The kind's designed
  // aspect is exactly its angular width floor over its angular length floor, so
  // reusing that ratio holds a massdriver at ~50:1 and a flak stub at ~4:1 at
  // EVERY distance — near field, where the real velocity streak is in charge,
  // as well as far field, where the angular floors are.
  float aspectW = aInf.w > 1e-6 ? clamp(aInf.z / aInf.w, 0.02, 0.60) : 0.333;
  w = min(w, halfLen * aspectW);

  // bias -1 pins the head at the projectile and lays the body out behind it.
  mv.xy += sf_billboard(position.xy, w * GLOW, halfLen, vv, -1.0);

  vQ = vec2(position.x * 2.0 * GLOW, position.y + 0.5);
  vCol = aCol;
  vInf = vec3(aInf.x, aInf.y, halfLen / max(w, 1e-4));

  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const TRACER_F = /* glsl */ `
${PARS_F}
${GLSL_UTIL}

varying vec2 vQ;
varying vec4 vCol;
varying vec3 vInf;

const float GLOW = ${TRACER_GLOW.toFixed(2)};

void main() {
  #include <logdepthbuf_fragment>

  float k = max(vInf.z, 1.0);           // aspect: half-length in core half-widths

  // Capsule SDF in core half-width units. The along coordinate runs 0 at the
  // head to -2k at the tail. The NOSE keeps its round cap; the TAIL is a FLAT
  // CUT — the segment runs all the way to -2k, so the body's cross-section is
  // identical from the nose cap to the last texel and then simply stops.
  //
  // CRITIQUE ROUND 2 (blocker): "the sheath falls off continuously behind the
  // nose, so the silhouette is a teardrop ... the reference tracers are
  // constant-width rules with a hard tail cut."
  float px = vQ.x;
  float py = (vQ.y - 1.0) * 2.0 * k;
  float cy = clamp(py, -2.0 * k, -min(1.0, k));
  float d = length(vec2(px, py - cy));

  // Three lobes: a searing white filament down the axis, a tight SATURATED
  // sheath around it, and a wide soft bloom that carries the colour outward.
  // Separating them is what gives the bolt a hot core inside a coloured sheath
  // instead of one soft blob that clips to white. The core lobe is deliberately
  // NARROW (sigma ~0.14 core half-widths, so roughly one pixel of a six-pixel
  // bolt): any wider and the white swallows the chroma and every weapon on the
  // field goes back to being the same white-orange smear.
  // The white filament is narrowed from sigma 0.14 to 0.11 core half-widths
  // (~1 px of a 6 px bolt): round 2 measured 99.6% of bright weapon pixels at
  // chroma < 0.10, i.e. the white lobe was eating the coloured one.
  // ROUND 3: "laser beams should be sharp and straight, tracers sharp."
  //
  // A tracer is a hard round travelling fast; it should read as a RULE with a
  // hot centre, not as a glow with a bright bit inside. The wide lobe was
  // reaching 2.6 core half-widths at meaningful amplitude and, with the bloom
  // gate previously sitting just above white, it then got blurred again in
  // screen space. All three lobes tighten and the widest loses most of its
  // weight below.
  float core   = exp(-d * d * 70.0);
  float sheath = exp(-d * d * 4.2);
  float bloom  = exp(-d * d * 0.95);

  // LONGITUDINAL profile. The ENTIRE brightness gradient lives here, never in
  // the width: nose 1.0 falling to 0.25 at the tail, then a hard cut ~1.2 core
  // half-widths long so the line ends rather than evaporating. 'tail' only bends
  // how quickly the fall happens, it can no longer close the line to a point.
  float s = clamp(vQ.y, 0.0, 1.0);
  float lon = 0.25 + 0.75 * pow(s, vInf.y * 0.55);
  lon *= smoothstep(0.0, 0.6 / k, s);
  // The nose is the hottest part of a tracer — a bright tip inside the sheath,
  // a couple of core widths long, so the round reads as travelling FORWARD.
  float tip = exp(-pow((1.0 - s) * k * 0.85, 2.0));

  // The head is hotter than the body but must not balloon into a comet: the
  // reference tracers are near-constant-width lines with a bright nose, so the
  // tip only lifts the CORE, and barely touches the sheath.
  vec3 c = vec3(core * (0.62 + 0.70 * tip)) * vInf.x
         + vCol.rgb * (sheath * 1.34 + bloom * 0.09 + tip * sheath * 0.30);
  c *= lon * vCol.a;

  // Kill the glow before it can reach the quad edge and show a seam.
  c *= 1.0 - smoothstep(GLOW * 0.74, GLOW, d);

  float lum = max(c.r, max(c.g, c.b));
  if (lum < 0.002) discard;

  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Plasma — pulsing, noise-warped blob
// ---------------------------------------------------------------------------

const PLASMA_V = /* glsl */ `
${PARS_V}
${GLSL_BILLBOARD}

attribute vec4 aPos;  // xyz world position   w outer radius (halo included), m
attribute vec4 aCol;  // rgb tint             a master intensity
attribute vec4 aInf;  // x core boost  y seed  z age seconds  w spare

uniform float uMinAngle;

varying vec2 vP;      // -1..1 across the sprite
varying vec4 vCol;
varying vec3 vInf;

void main() {
  vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);
  float depth = max(-mv.z, 1.0);
  float r = max(aPos.w, depth * uMinAngle * 2.1);
  mv.xy += sf_billboard(position.xy, r, r, vec3(0.0, 1.0, 0.0), 0.0);

  vP = position.xy * 2.0;
  vCol = aCol;
  vInf = aInf.xyz;

  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const PLASMA_F = /* glsl */ `
${PARS_F}
${GLSL_NOISE}
${GLSL_UTIL}

uniform float uTime;
uniform float uDetail;

varying vec2 vP;
varying vec4 vCol;
varying vec3 vInf;

void main() {
  #include <logdepthbuf_fragment>

  float r = length(vP);
  if (r > 1.0) discard;

  float seed = vInf.y;
  // Domain scrolls in z so the cell structure boils; the seed decorrelates bolts.
  int oct = uDetail > 0.75 ? 4 : (uDetail > 0.25 ? 3 : 2);
  float n = sf_fbm(vec3(vP * 2.4, uTime * 0.85 + seed * 41.0), oct, 2.03, 0.55);
  // fbm sits tightly around 0.5; expand it before it is any use as a warp.
  float nn = clamp((n - 0.5) * 2.6, -1.0, 1.0);

  // Warp the radial coordinate by the noise: the containment field is ragged.
  // A second, finer octave breaks the lobes into filaments.
  float n2 = sf_noise(vec3(vP * 7.0, uTime * 1.7 + seed * 17.0));
  float rw = r * (1.0 + nn * 0.42 + (n2 - 0.5) * 0.18);

  // Two beats: a fast flicker and a slower breathing pulse.
  float pulse = 0.86
    + 0.09 * sin(uTime * 17.0 + seed * 43.0)
    + 0.09 * sin(uTime * 5.3 + seed * 11.0);

  float core = exp(-pow(rw / (0.20 * pulse), 2.4));
  // A hard body edge is what makes the noise warp visible at all; a soft
  // gaussian swallows it and the bolt reads as a smooth ball. The body gain is
  // also kept under saturation, or the warped silhouette clips to flat white.
  float body = exp(-pow(rw / 0.44, 3.6));
  float halo = exp(-r * r * 6.5) * 0.15;

  // Filaments licking off the containment edge.
  float edge = exp(-pow((rw - 0.44) / 0.12, 2.0)) * (0.25 + 0.90 * n) * 1.7;

  vec3 c = vec3(core * core) * vInf.x
         + vCol.rgb * (body * 0.80 + halo + edge);
  c *= vCol.a * (1.0 - smoothstep(0.86, 1.0, r));

  float lum = max(c.r, max(c.g, c.b));
  if (lum < 0.002) discard;

  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Beams — the money shot
// ---------------------------------------------------------------------------

/** Beam quad half-width, in core half-widths. The glow lobe must fit inside. */
const BEAM_GLOW = 5.4;

const BEAM_V = /* glsl */ `
${PARS_V}

attribute vec4 aA;    // xyz muzzle (world)   w core half-width, m
attribute vec4 aB;    // xyz impact (world)   w master intensity 0..1
attribute vec4 aCol;  // rgb beam colour      a seed 0..1

uniform float uMinAngleBeam;

varying vec2 vQ;      // x across in core half-widths, y along 0..1
varying vec4 vCol;
varying vec2 vInf;    // intensity, beam length (metres)

const float GLOW = ${BEAM_GLOW.toFixed(2)};

void main() {
  float t = position.y;
  vec3 wp = mix(aA.xyz, aB.xyz, t);
  vec4 mv = modelViewMatrix * vec4(wp, 1.0);

  // Cylindrical billboard: the ribbon's side vector is rebuilt per vertex as the
  // axis crossed with the eye vector, so the strip always presents its face to
  // the camera even when it sweeps past close by.
  vec3 seg = (modelViewMatrix * vec4(aB.xyz - aA.xyz, 0.0)).xyz;
  float segLen = length(seg);
  vec3 dirV = segLen > 1e-5 ? seg / segLen : vec3(0.0, 0.0, 1.0);
  vec3 toEye = normalize(-mv.xyz);
  vec3 side = cross(dirV, toEye);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : normalize(cross(dirV, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));

  float depth = max(-mv.z, 1.0);
  // Core half-width, floored in ANGLE. CRITIQUE ROUND 2: "make beams genuinely
  // enormous and dominant when they fire". At 0.0085 rad this is ~11 px
  // half-core at 1080p, so the lit bar is ~29 px across and the glow lobe
  // reaches 5.4x that — a lance you cannot miss at any range.
  float w = max(aA.w, depth * uMinAngleBeam);

  mv.xyz += side * (position.x * 2.0 * w * GLOW);

  vQ = vec2(position.x * 2.0 * GLOW, t);
  vCol = aCol;
  vInf = vec2(aB.w, length(aB.xyz - aA.xyz));

  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const BEAM_F = /* glsl */ `
${PARS_F}
${GLSL_NOISE}
${GLSL_UTIL}

uniform float uTime;
uniform float uDetail;

varying vec2 vQ;
varying vec4 vCol;
varying vec2 vInf;

const float GLOW = ${BEAM_GLOW.toFixed(2)};

void main() {
  #include <logdepthbuf_fragment>

  float x = vQ.x;            // across, in core half-widths
  float t = vQ.y;            // 0 muzzle .. 1 impact
  float seed = vCol.a;
  float len = max(vInf.y, 1.0);

  // -- heat ripple: the lance shimmers laterally, two beats at different
  //    spatial frequencies tied to real length so a 4 km lance is not a 40 m one
  //    stretched. Amplitudes are in core half-widths.
  float sMetres = t * len;
  // The ripple was +-0.49 core half-widths, i.e. the beam visibly snaked. A
  // lance is a straight line that SHIMMERS; it does not wander. Amplitudes cut
  // to a third, so the motion is in the brightness and the edge, not the axis.
  float rip = sin(sMetres * 0.055 - uTime * 26.0 + seed * 39.0) * 0.10
            + sin(sMetres * 0.017 + uTime * 11.0 + seed * 17.0) * 0.06;
  float xr = x + rip * uDetail;

  // -- noise-modulated flicker: broadband along the beam, never fully dark.
  //    Two octaves at different rates so it boils rather than strobes.
  float flick = mix(1.0,
    0.70 + 0.34 * sf_noise(vec3(t * 9.0, uTime * 15.0, seed * 23.0))
         + 0.16 * sf_noise(vec3(t * 31.0, uTime * 41.0, seed * 7.0)),
    uDetail);

  // -- the sheath itself breathes in WIDTH, not just brightness, so the lance
  //    has a ragged, unstable edge instead of a printed constant-width bar.
  float wob = 1.0 + 0.16 * (sf_noise(vec3(t * 5.0, uTime * 6.0, seed * 51.0)) - 0.5) * uDetail;

  // -- surges racing down the beam toward the target
  float ph = fract(t * 1.6 - uTime * 1.15 + seed);
  float surge = exp(-pow((ph - 0.5) * 5.0, 2.0)) * 0.6;

  // -- radial profile: a SEARING white filament, a tight saturated sheath, a
  //    wide coloured glow, and — new in round 2 — an ATMOSPHERIC lobe that
  //    reaches the full 5.4 core half-widths of the quad. The reference beam in
  //    verify/ref/hw244160_2.jpg is a ~60 px white bar sitting inside a ~400 px
  //    wash of its own colour; without the outer lobe an ion lance is a decal.
  // Same argument as the tracer, and more so: an ion lance is the straightest
  // thing in the game and it was wearing a 5.4-half-width atmospheric wash that
  // made it a stripe of fog with a line in it. In vacuum there is nothing for a
  // beam to scatter off, so the wash was never physical either — it was there to
  // make the beam feel big, and length and a hard core do that better.
  float core  = exp(-xr * xr * 30.0);
  float inner = exp(-xr * xr * 3.0 / (wob * wob));
  float glow  = exp(-xr * xr * 0.60);
  float wash  = exp(-xr * xr * 0.14);

  // -- taper: the strike end stays hot, the muzzle end blends into the flare
  float ends = smoothstep(0.0, 0.03, t) * (0.72 + 0.28 * smoothstep(0.0, 0.4, t));

  // The white filament is deliberately WEAK relative to the coloured sheath:
  // an ion lance must read as a COLOURED lance with a white thread down it,
  // not as a white bar with a faint tint (critique round 1, beams). The gains
  // are raised over round 2 because the frame's exposure is coming down at the
  // same time: an additive effect is a CONTRAST budget, so the beam has to hold
  // 3-4x the sky it is drawn on (measured reference ratio, hw244160_3: 3.92x).
  vec3 c = vec3(core * core) * (3.8 + surge * 3.0)
         + vCol.rgb * (inner * 2.70 + glow * 0.55 + wash * 0.10 + surge * inner * 1.3);
  c *= vInf.x * flick * ends;

  // Kill the glow before the quad edge so no seam is ever visible.
  c *= 1.0 - smoothstep(GLOW * 0.80, GLOW, abs(xr));

  float lum = max(c.r, max(c.g, c.b));
  if (lum < 0.002) discard;

  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Flares — muzzle flashes, impact flashes, motor flares, beam end caps
// ---------------------------------------------------------------------------

const FLARE_V = /* glsl */ `
${PARS_V}
${GLSL_BILLBOARD}

attribute vec4 aPos;   // xyz world position   w radius, m
attribute vec4 aAxis;  // xyz orientation axis (world)  w stretch (0 = round)
attribute vec4 aCol;   // rgb colour, linear HDR        a alpha
attribute vec4 aT;     // x birth time  y 1/life (0 = this frame only)
                       // z variant     w seed 0..1

uniform float uTime;
uniform float uMinAngle;

varying vec2 vP;
varying vec4 vCol;
varying vec3 vInf;     // normalised age, variant, seed

void main() {
  float u = (aT.y > 0.0) ? (uTime - aT.x) * aT.y : 0.0;
  if (u < 0.0 || u >= 1.0) {
    // Dead: collapse every corner onto the same off-screen clip position.
    vP = vec2(0.0); vCol = vec4(0.0); vInf = vec3(0.0);
    #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
      vFragDepth = 1.0;
      vIsPerspective = 0.0;
    #endif
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // Growth is per variant: a shock ring blooms outward, a flash barely swells.
  float grow = (aT.z > 2.5) ? 3.4 : ((aT.z < 0.5) ? 1.55 : 1.18);
  float sc = mix(1.0, grow, u);

  vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);
  float depth = max(-mv.z, 1.0);
  float r = max(aPos.w * sc, depth * uMinAngle * 2.0);

  vec3 axV = (modelViewMatrix * vec4(aAxis.xyz, 0.0)).xyz;
  float halfL = r * (1.0 + aAxis.w * 2.0);
  mv.xy += sf_billboard(position.xy, r, halfL, axV, 0.0);

  vP = position.xy * 2.0;
  vCol = aCol;
  vInf = vec3(u, aT.z, aT.w);

  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const FLARE_F = /* glsl */ `
${PARS_F}
${GLSL_UTIL}

varying vec2 vP;
varying vec4 vCol;
varying vec3 vInf;

void main() {
  #include <logdepthbuf_fragment>

  float u = vInf.x;
  float variant = vInf.y;
  float r = length(vP);
  if (r > 1.0) discard;

  float a;
  if (variant < 0.5) {
    // CORE: a blown-out centre inside a soft halo.
    a = exp(-r * r * 26.0) + 0.42 * exp(-r * r * 3.2);
  } else if (variant < 1.5) {
    // STAR: core plus a four-armed diffraction cross, aligned to the quad — and
    // therefore to the barrel once the quad is stretched along it.
    float halo = exp(-r * r * 3.0);
    float sx = exp(-vP.x * vP.x * 260.0);
    float sy = exp(-vP.y * vP.y * 120.0);
    a = exp(-r * r * 30.0) + (sx + sy) * halo * 0.72 + 0.3 * halo;
  } else if (variant < 2.5) {
    // SOFT: a hot centre inside a broad glow — motor flares.
    a = exp(-r * r * 11.0) + 0.34 * exp(-r * r * 2.8);
  } else {
    // RING: an expanding shock hoop that thins as it grows.
    float rr = (r - 0.62) / max(0.30 * (1.0 - u * 0.7), 0.03);
    a = exp(-rr * rr) * (1.0 - u * 0.35);
  }

  // Hard-edge kill so no sprite shows its quad boundary.
  a *= 1.0 - smoothstep(0.82, 1.0, r);
  // Fast attack, quadratic decay — a flash is over before it is understood.
  a *= pow(max(0.0, 1.0 - u), 1.8);

  vec3 c = vCol.rgb * (a * vCol.a);
  float lum = max(c.r, max(c.g, c.b));
  if (lum < 0.002) discard;

  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Missile / torpedo bodies
// ---------------------------------------------------------------------------

const DART_V = /* glsl */ `
${PARS_V}

attribute vec4 aPos;   // xyz world position  w body length, m
attribute vec4 aFwd;   // xyz unit forward    w roll seed 0..1
attribute vec4 aCol;   // rgb tint            a motor intensity

uniform float uMinAngleBody;
uniform float uMaxInflate;

varying vec3 vN;
varying vec3 vV;
varying vec3 vTint;
varying vec2 vInf;    // local z (-0.5 motor .. 0.5 nose), motor intensity

void main() {
  vec3 f = normalize(aFwd.xyz);
  // Orthonormal basis about the flight axis; the world axis least aligned with
  // the axis seeds the cross product so it can never degenerate.
  vec3 up = abs(f.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 rr = normalize(cross(up, f));
  vec3 uu = cross(f, rr);
  float ang = aFwd.w * 6.2831853;
  float cs = cos(ang), sn = sin(ang);
  vec3 bx = rr * cs + uu * sn;
  vec3 by = -rr * sn + uu * cs;
  mat3 B = mat3(bx, by, f);

  // A 6 m missile 4 km out is sub-pixel. Inflate it toward a readable angular
  // size, capped so a close pass still reads as ordnance and not a shuttle.
  float depth = max(-(modelViewMatrix * vec4(aPos.xyz, 1.0)).z, 1.0);
  float len = max(aPos.w, 0.01);
  float k = clamp(depth * uMinAngleBody / len, 1.0, uMaxInflate);

  vec3 wp = aPos.xyz + B * (position * len * k);
  vec4 mv = modelViewMatrix * vec4(wp, 1.0);

  vN = normalize(B * normal);
  vV = normalize(cameraPosition - wp);
  vTint = aCol.rgb;
  vInf = vec2(position.z, aCol.a);

  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const DART_F = /* glsl */ `
${PARS_F}
${GLSL_UTIL}

uniform vec3 uSunDir;
uniform vec3 uAmbient;

varying vec3 vN;
varying vec3 vV;
varying vec3 vTint;
varying vec2 vInf;

void main() {
  #include <logdepthbuf_fragment>

  vec3 N = normalize(vN);
  float ndl = max(dot(N, uSunDir), 0.0);

  // Ordnance is painted matte graphite: it should read as a dark chip against
  // space, legible only by its rim and its motor.
  vec3 base = vec3(0.052, 0.055, 0.062);
  vec3 c = base * (0.30 + 1.25 * ndl) + uAmbient * base * 6.0;

  // Rim in the weapon tint pulls the silhouette off the black.
  float rim = pow(1.0 - abs(dot(N, normalize(vV))), 3.2);
  c += vTint * rim * 0.55;

  // Incandescent motor: the last sixth of the body glows white-hot.
  float motor = smoothstep(-0.30, -0.46, vInf.x);
  c += vTint * motor * vInf.y * 3.6 + vec3(motor * vInf.y * 1.1);

  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Shield ripple
// ---------------------------------------------------------------------------

const SHIELD_V = /* glsl */ `
${PARS_V}

attribute vec4 aSph;  // xyz centre (world)   w bubble radius, m
attribute vec4 aDir;  // xyz impact normal    w birth time
attribute vec4 aCol;  // rgb shield colour    a 1/life

uniform float uTime;

varying vec3 vN;
varying vec3 vD;
varying vec3 vV;
varying vec4 vCol;
varying float vU;

void main() {
  float u = (uTime - aDir.w) * aCol.a;
  if (u < 0.0 || u >= 1.0) {
    vN = vec3(0.0); vD = vec3(0.0); vV = vec3(0.0); vCol = vec4(0.0); vU = 0.0;
    #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
      vFragDepth = 1.0;
      vIsPerspective = 0.0;
    #endif
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec3 n = normalize(position);
  // The whole shell flexes outward a touch on impact then settles.
  float flex = 1.0 + 0.045 * exp(-u * 6.0) * max(0.0, dot(n, normalize(aDir.xyz)));
  vec3 wp = aSph.xyz + n * (aSph.w * flex);

  vN = n;
  vD = normalize(aDir.xyz);
  vV = normalize(cameraPosition - wp);
  vCol = aCol;
  vU = u;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const SHIELD_F = /* glsl */ `
${PARS_F}
${GLSL_HEX}
${GLSL_UTIL}

uniform float uDetail;
uniform float uHexScale;

varying vec3 vN;
varying vec3 vD;
varying vec3 vV;
varying vec4 vCol;
varying float vU;

void main() {
  #include <logdepthbuf_fragment>

  if (vU <= 0.0) discard;

  // Angular distance from the impact point, radians.
  float ang = acos(clamp(dot(vN, vD), -1.0, 1.0));

  // The ring front sweeps the shell in one lifetime. It must stay NARROW: a wide
  // band lights the whole shell at once and the bubble reads as a solid ball.
  float front = vU * 3.3;
  float wide = 0.11 + 0.17 * vU;
  float band = exp(-pow((ang - front) / wide, 2.0));
  // A second, faster ghost ring gives the front a hard leading edge.
  float lead = exp(-pow((ang - front * 1.18) / (wide * 0.40), 2.0)) * 1.35;
  // A bright cap right on the strike point anchors the ripple to the impact —
  // without it the hex front reads as an unrelated hoop drifting off the hull.
  float cap = exp(-pow(ang / 0.26, 2.0)) * exp(-vU * 4.5) * 1.6;

  float cells = 1.0;
  float edge = 0.0;
  if (uDetail > 0.25) {
    // Azimuthal-equidistant projection about the impact axis: undistorted where
    // it matters (near the strike) and only smearing at the antipode.
    vec3 t = vN - vD * dot(vN, vD);
    float tl = length(t);
    vec3 tn = tl > 1e-5 ? t / tl : vec3(0.0);
    // Any fixed pair of tangents will do; the pattern only needs to be stable.
    vec3 e1 = normalize(cross(vD, abs(vD.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(vD, e1);
    vec2 q = vec2(dot(tn, e1), dot(tn, e2)) * ang * uHexScale;

    vec4 hc = sf_hexCell(q);
    float hd = sf_hexDist(hc.xy);
    // Bright cell borders over a LIT cell fill — the lattice must read as
    // structure, not as dither, so the cells stay large and the edges hard.
    // Fill raised from 0.10: at battle range a frigate bubble is ~20 px across
    // and a hairline-only lattice simply did not survive (critique round 1:
    // "shield hits need the hex ripple to actually be visible").
    edge = smoothstep(0.36, 0.47, hd);
    // Per-cell ignition delay so the lattice lights up raggedly, not as a disc.
    float rnd = fract(sin(dot(hc.zw, vec2(12.9898, 78.233))) * 43758.5453);
    cells = 0.35 + 0.65 * rnd;
  }

  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);

  float i = (band + lead + cap) * cells * (0.34 + 1.15 * edge)
          + band * fres * 0.85
          + cap * 0.5
          + fres * 0.16 * exp(-vU * 7.0);   // the whole bubble ghosts on impact
  // Round 2 brief: "shield hex ripple must be visible". At fleet range a frigate
  // bubble is ~20 px across, so the lattice only survives if the ring front is
  // genuinely bright — this is a CONTRAST budget against the sky, not a
  // brightness one, and 1.55 put the front inside the haze.
  i *= 2.10;

  // Fades fast — a shield flash must not linger or every capital looks bubbled.
  i *= pow(max(0.0, 1.0 - vU), 2.0);
  // The far hemisphere is seen through the near one; damp it so it reads as depth.
  if (!gl_FrontFacing) i *= 0.22;

  vec3 c = vCol.rgb * i;
  float lum = max(c.r, max(c.g, c.b));
  if (lum < 0.002) discard;

  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Module-scope scratch — nothing in the hot path allocates.
// ---------------------------------------------------------------------------

const _sun = new THREE.Vector3(...CONFIG.sunDir).normalize();
const _scratchIds: number[] = [];
/** Recovered shield host: centre, radius, team. */
const _host = { x: 0, y: 0, z: 0, r: 0, team: Team.Neutral, found: false };

// ---------------------------------------------------------------------------
// WeaponFx
// ---------------------------------------------------------------------------

/**
 * Draws every projectile, beam, muzzle flash and impact in the game.
 *
 * ```ts
 * const weapons = new WeaponFx(scene, particles, textures, quality);
 * // per frame, after the sim:
 * weapons.update(ctx, world);
 * ```
 *
 * Subscribes to `fire` and `hit` on the global bus in the constructor and
 * unsubscribes in `dispose`.
 */
export class WeaponFx implements RenderSystem {
  private readonly scene: THREE.Scene;
  private readonly particles: ParticleSystem;
  private quality: QualitySettings;

  // -- shared uniforms (the same objects are wired into every material) ------
  private readonly uTime: THREE.IUniform<number> = { value: 0 };
  private readonly uDetail: THREE.IUniform<number> = { value: 1 };
  private readonly uMinAngle: THREE.IUniform<number> = { value: MIN_ANGLE };
  private readonly uMinAngleBeam: THREE.IUniform<number> = { value: MIN_ANGLE_BEAM };

  // -- materials -------------------------------------------------------------
  private readonly matTracer: THREE.ShaderMaterial;
  private readonly matPlasma: THREE.ShaderMaterial;
  private readonly matBeam: THREE.ShaderMaterial;
  private readonly matFlare: THREE.ShaderMaterial;
  private readonly matDart: THREE.ShaderMaterial;
  private readonly matShield: THREE.ShaderMaterial;

  // -- batches ---------------------------------------------------------------
  private readonly tracers: Batch;
  private readonly plasma: Batch;
  private readonly beams: Batch;
  private readonly darts: Batch;
  /** Persistent flares: motor glow, beam end caps. Rewritten every frame. */
  private readonly liveFlares: Batch;
  /** Transient flashes raised by `fire` / `hit`. */
  private readonly flashes: Batch;
  private readonly shields: Batch;

  // -- base geometries (owned, disposed here) --------------------------------
  private readonly geoQuad: THREE.BufferGeometry;
  private readonly geoStrip: THREE.BufferGeometry;
  private readonly geoDart: THREE.BufferGeometry;
  private readonly geoSphere: THREE.BufferGeometry;

  // -- precomputed colour table: [team][kind] -> linear RGB ------------------
  private readonly tint = new Float32Array(TEAM_COUNT * KIND_COUNT * 3);
  private readonly shieldTint = new Float32Array(TEAM_COUNT * 3);

  // -- missile trail state, indexed by projectile pool slot ------------------
  private readonly trailPrev = new Float32Array(CONFIG.maxProjectiles * 3);
  private readonly trailAcc = new Float32Array(CONFIG.maxProjectiles);
  private readonly trailStamp = new Int32Array(CONFIG.maxProjectiles);
  /** Beam impact-spark accumulators, indexed by beam pool slot. */
  private readonly beamAcc = new Float32Array(CONFIG.maxBeams);
  private frame = 0;

  // -- quality-derived multipliers -------------------------------------------
  private qSpark = 1;
  private qSmoke = 1;
  private qTrail = true;

  private readonly rng = new Rng(0x7c31ab);
  /** Cached from `update`, so bus handlers raised mid-step can query the world. */
  private world: World | null = null;
  private time = 0;
  private readonly unsub: Array<() => void> = [];

  /**
   * @param scene     where the seven FX meshes are parented
   * @param particles the shared particle engine; sparks, smoke and vent gas go here
   * @param textures  procedural texture factory (currently unused by the analytic
   *                  FX shaders; accepted so the constructor signature is stable
   *                  and so a future sheet-based muzzle flash needs no rewiring)
   * @param quality   drives spark counts, smoke trails and shader detail
   */
  constructor(
    scene: THREE.Scene,
    particles: ParticleSystem,
    textures: TextureFactory,
    quality: QualitySettings,
  ) {
    void textures;
    this.scene = scene;
    this.particles = particles;
    this.quality = quality;

    this.geoQuad = quadGeom();
    this.geoStrip = stripGeom(BEAM_SEGS);
    this.geoDart = dartGeom();
    // detail 4: the silhouette of a shield bubble is a hard circle on screen and
    // any facet on it is instantly visible.
    this.geoSphere = new THREE.IcosahedronGeometry(1, 4);

    // -- materials ----------------------------------------------------------
    const additive: THREE.ShaderMaterialParameters = {
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    };

    this.matTracer = new THREE.ShaderMaterial({
      ...additive,
      uniforms: { uMinAngle: this.uMinAngle },
      vertexShader: TRACER_V,
      fragmentShader: TRACER_F,
    });
    this.matTracer.name = 'fx.weapons.tracer';

    this.matPlasma = new THREE.ShaderMaterial({
      ...additive,
      uniforms: { uMinAngle: this.uMinAngle, uTime: this.uTime, uDetail: this.uDetail },
      vertexShader: PLASMA_V,
      fragmentShader: PLASMA_F,
    });
    this.matPlasma.name = 'fx.weapons.plasma';

    this.matBeam = new THREE.ShaderMaterial({
      ...additive,
      uniforms: { uMinAngleBeam: this.uMinAngleBeam, uTime: this.uTime, uDetail: this.uDetail },
      vertexShader: BEAM_V,
      fragmentShader: BEAM_F,
    });
    this.matBeam.name = 'fx.weapons.beam';

    this.matFlare = new THREE.ShaderMaterial({
      ...additive,
      uniforms: { uMinAngle: this.uMinAngle, uTime: this.uTime },
      vertexShader: FLARE_V,
      fragmentShader: FLARE_F,
    });
    this.matFlare.name = 'fx.weapons.flare';

    this.matShield = new THREE.ShaderMaterial({
      ...additive,
      uniforms: { uTime: this.uTime, uDetail: this.uDetail, uHexScale: { value: 5.0 } },
      vertexShader: SHIELD_V,
      fragmentShader: SHIELD_F,
    });
    this.matShield.name = 'fx.weapons.shield';

    this.matDart = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: _sun },
        uAmbient: { value: new THREE.Color(CONFIG.ambientColour).convertSRGBToLinear() },
        uMinAngleBody: { value: MIN_ANGLE_BODY },
        uMaxInflate: { value: BODY_MAX_INFLATE },
      },
      vertexShader: DART_V,
      fragmentShader: DART_F,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    this.matDart.name = 'fx.weapons.dart';

    // -- batches ------------------------------------------------------------
    this.tracers = new Batch(this.geoQuad, ['aPos', 'aVel', 'aCol', 'aInf'],
      this.matTracer, CAP_TRACER, false, ORDER_TRACER, 'fx.weapons.tracer');
    this.plasma = new Batch(this.geoQuad, ['aPos', 'aCol', 'aInf'],
      this.matPlasma, CAP_PLASMA, false, ORDER_PLASMA, 'fx.weapons.plasma');
    this.beams = new Batch(this.geoStrip, ['aA', 'aB', 'aCol'],
      this.matBeam, CAP_BEAM, false, ORDER_BEAM, 'fx.weapons.beam');
    this.darts = new Batch(this.geoDart, ['aPos', 'aFwd', 'aCol'],
      this.matDart, CAP_DART, false, ORDER_DART, 'fx.weapons.dart');
    this.liveFlares = new Batch(this.geoQuad, ['aPos', 'aAxis', 'aCol', 'aT'],
      this.matFlare, CAP_LIVE_FLARE, false, ORDER_FLARE, 'fx.weapons.flare.live');
    this.flashes = new Batch(this.geoQuad, ['aPos', 'aAxis', 'aCol', 'aT'],
      this.matFlare, CAP_FLASH, true, ORDER_FLARE, 'fx.weapons.flare.flash');
    this.shields = new Batch(this.geoSphere, ['aSph', 'aDir', 'aCol'],
      this.matShield, CAP_SHIELD, true, ORDER_SHIELD, 'fx.weapons.shield');

    scene.add(this.darts.mesh);
    scene.add(this.tracers.mesh);
    scene.add(this.plasma.mesh);
    scene.add(this.shields.mesh);
    scene.add(this.beams.mesh);
    scene.add(this.liveFlares.mesh);
    scene.add(this.flashes.mesh);

    this.buildTints();
    this.applyQuality();

    this.unsub.push(bus.on('fire', this.onFire));
    this.unsub.push(bus.on('hit', this.onHit));
  }

  // -------------------------------------------------------------------------
  // Colour table
  // -------------------------------------------------------------------------

  /**
   * Bake `team x kind -> linear RGB`.
   *
   * Each weapon kind pulls the team's tracer colour toward its OWN chroma
   * target (gold for slugs, ember for flak, violet for plasma, ice for ion),
   * then the result is re-saturated about its own luminance and scaled by the
   * look's gain. That gives real colour separation by weapon type — critique
   * round 1, "no colour separation by weapon type" — while keeping the team hue
   * as the dominant signal, so a player massdriver is still recognisably blue
   * next to an enemy one.
   */
  private buildTints(): void {
    for (let t = 0; t < TEAM_COUNT; t++) {
      const pal = PALETTES[t as Team];
      const w = pal.weapon;
      for (const key of Object.keys(LOOKS) as WeaponKind[]) {
        const look = LOOKS[key];
        const k = KIND_INDEX[key];
        const o = (t * KIND_COUNT + k) * 3;
        const m = look.warm;
        let r = w.r * (1 - m) + look.mixR * m;
        let g = w.g * (1 - m) + look.mixG * m;
        let b = w.b * (1 - m) + look.mixB * m;
        // Re-saturate about luminance: additive HDR fire that is not saturated
        // at source clips to white the moment two bolts overlap.
        const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
        const s = look.sat;
        r = Math.max(0, lum + (r - lum) * s);
        g = Math.max(0, lum + (g - lum) * s);
        b = Math.max(0, lum + (b - lum) * s);
        // PEAK NORMALISATION. Round 2 measured that 99.6% of our bright weapon
        // pixels carried chroma below 0.10 — everything clipped to white. The
        // cause was that `gain` multiplied an already-supersaturated colour, so
        // the absolute radiance of a bolt depended on its hue and every kind
        // ended up over the ACES knee. Scaling so the strongest channel lands
        // exactly on `gain` makes the peak radiance explicit and hue-independent:
        // one number per weapon decides clip vs chroma.
        const mx = Math.max(r, g, b, 1e-4);
        const norm = look.gain / mx;
        this.tint[o] = r * norm;
        this.tint[o + 1] = g * norm;
        this.tint[o + 2] = b * norm;
      }
      const s = pal.shield;
      this.shieldTint[t * 3] = s.r;
      this.shieldTint[t * 3 + 1] = s.g;
      this.shieldTint[t * 3 + 2] = s.b;
    }
  }

  // -------------------------------------------------------------------------
  // Quality
  // -------------------------------------------------------------------------

  /** Recompute the spark/smoke multipliers and the shader detail level. */
  private applyQuality(): void {
    const p = this.quality.preset;
    this.qSpark = p === 0 ? 0.3 : p === 1 ? 0.62 : p === 2 ? 1 : 1.35;
    this.qSmoke = p === 0 ? 0 : p === 1 ? 0.55 : p === 2 ? 1 : 1.25;
    this.qTrail = p >= 1;
    this.uDetail.value = p === 0 ? 0 : p === 1 ? 0.5 : 1;
  }

  /** Swap quality presets at runtime; safe to call every frame. */
  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.applyQuality();
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /**
   * Muzzle flash: an instanced star flare stretched along the barrel plus a
   * cone of sparks. Missiles and torpedoes get a launch smoke puff instead of
   * sparks; ion mounts get a fat charge bloom and nothing else, because the
   * beam that follows is doing the talking.
   */
  private readonly onFire = (e: GameEvents['fire']): void => {
    const look = LOOKS[e.kind] ?? LOOKS.none;
    const scale = e.scale > 1e-3 ? e.scale : 1;
    const ki = KIND_INDEX[e.kind] ?? 0;
    const o = (e.team * KIND_COUNT + ki) * 3;
    const cr = this.tint[o], cg = this.tint[o + 1], cb = this.tint[o + 2];

    // Normalise the barrel direction; a zero vector falls back to +Z.
    let dx = e.dx, dy = e.dy, dz = e.dz;
    const dl = Math.hypot(dx, dy, dz);
    if (dl < 1e-5) { dx = 0; dy = 0; dz = 1; } else { dx /= dl; dy /= dl; dz /= dl; }

    const isBeam = e.kind === 'ion';
    const isOrd = e.kind === 'missile' || e.kind === 'torpedo';

    // -- the flash sprite ---------------------------------------------------
    const life = isBeam ? 0.22 : isOrd ? 0.13 : 0.075 + look.flash * 0.004;
    const size = look.flash * scale * (isBeam ? 1.6 : 1);
    this.flash(
      e.x + dx * size * 0.35, e.y + dy * size * 0.35, e.z + dz * size * 0.35,
      size, dx, dy, dz, isBeam ? 0.35 : 0.85,
      cr * 2.2 + 1.1, cg * 2.2 + 1.1, cb * 2.2 + 1.1, 1,
      life, isBeam ? FLARE_CORE : FLARE_STAR,
    );

    // -- particles ----------------------------------------------------------
    if (isBeam) {
      // Charge motes drifting back into the emitter.
      const n = Math.round(6 * this.qSpark);
      if (n > 0) {
        P.vx = -dx; P.vy = -dy; P.vz = -dz;
        this.particles.burst(e.x, e.y, e.z, n, 'ionMotes', size * 0.5, cr, cg, cb);
      }
      return;
    }

    // Two populations, deliberately different sprites: a hot gas puff (fire
    // sheet) plus a cone of STREAKS thrown down the barrel. One preset alone is
    // what made every muzzle event the same round gaussian.
    const sparks = Math.round(look.sparks * this.qSpark);
    if (sparks > 0) {
      P.vx = dx; P.vy = dy; P.vz = dz;
      this.particles.burst(e.x, e.y, e.z, sparks, 'muzzle', scale * 0.9, cr, cg, cb);
      // Second population costs particles, so it scales with the preset.
      const streaks = this.quality.preset >= 1 ? Math.round(sparks * 0.7) : 0;
      if (streaks > 0) {
        P.vx = dx; P.vy = dy; P.vz = dz;
        this.particles.burst(
          e.x + dx * scale * 0.4, e.y + dy * scale * 0.4, e.z + dz * scale * 0.4,
          streaks, 'hullSpark', scale * 0.7,
          cr * 0.5 + 1.6, cg * 0.5 + 0.95, cb * 0.5 + 0.35,
        );
      }
    }

    if (isOrd && this.qSmoke > 0) {
      const puffs = Math.round(4 * this.qSmoke);
      P.vx = -dx; P.vy = -dy; P.vz = -dz;
      this.particles.burst(
        e.x - dx * scale, e.y - dy * scale, e.z - dz * scale,
        puffs, 'smoke', scale * 1.4,
      );
    }
  };

  /**
   * Impact. A shielded hit raises a hex ripple on the victim's bubble and a
   * skidding spray of shield spray; an unshielded hit is a hull strike: white
   * flash, a spark cone about the surface normal, vented atmosphere and, at
   * high quality, tumbling embers.
   */
  private readonly onHit = (e: GameEvents['hit']): void => {
    const look = LOOKS[e.kind] ?? LOOKS.none;
    const scale = e.scale > 1e-3 ? e.scale : 1;
    const mult = look.impact * this.qSpark;

    // Surface normal; degenerate normals fall back to +Y so cones still open.
    let nx = e.nx, ny = e.ny, nz = e.nz;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-5) { nx = 0; ny = 1; nz = 0; } else { nx /= nl; ny /= nl; nz /= nl; }

    if (e.shielded) {
      this.shieldHit(e, scale, nx, ny, nz, mult);
      return;
    }

    const ki = KIND_INDEX[e.kind] ?? 0;
    const o = (e.team * KIND_COUNT + ki) * 3;
    const cr = this.tint[o], cg = this.tint[o + 1], cb = this.tint[o + 2];

    // -- flash: white-hot, immediately behind it a coloured bloom -----------
    if (e.kind !== 'ion') {
      this.flash(
        e.x, e.y, e.z, scale * 2.6, nx, ny, nz, 0,
        2.6 + cr, 2.1 + cg, 1.7 + cb, 1,
        0.085 + scale * 0.004, FLARE_CORE,
      );
      // A second flare STRETCHED ALONG THE SURFACE NORMAL. The spark cone below
      // is thrown along the same axis, and without a lit spike at its root the
      // cone reads as an unrelated scatter of dots rather than as spall coming
      // OUT of the plate (round 2 brief: "hull hits need a directional spark
      // cone along the surface normal").
      this.flash(
        e.x + nx * scale * 0.5, e.y + ny * scale * 0.5, e.z + nz * scale * 0.5,
        scale * 1.7, nx, ny, nz, 1.25,
        2.2 + cr * 0.6, 1.3 + cg * 0.6, 0.55 + cb * 0.6, 0.95,
        0.13 + scale * 0.006, FLARE_STAR,
      );
      // Splash weapons throw a shock hoop.
      if (look.impact >= 1.8) {
        this.flash(
          e.x, e.y, e.z, scale * 3.4, nx, ny, nz, 0,
          cr * 1.4 + 0.5, cg * 1.4 + 0.4, cb * 1.4 + 0.3, 0.85,
          0.30 + scale * 0.01, FLARE_RING,
        );
      }
    }

    // -- directional spark cone along the surface normal ---------------------
    // Critique round 1: "hull hits need a directional spark cone along the
    // surface normal". `hullSpark` is a tight cone of NEEDLES with a real
    // colour-temperature spread; `spall` throws hard-edged lit chips out of the
    // same crater so the event is not one sprite repeated; and a thin
    // omnidirectional `spark` scatter stops the cone looking stamped.
    const cone = Math.round(13 * mult);
    if (cone > 0) {
      P.vx = nx; P.vy = ny; P.vz = nz;
      this.particles.burst(e.x, e.y, e.z, cone, 'hullSpark', scale * 1.15);
    }
    const chips = this.quality.preset >= 1 ? Math.round(5 * mult) : 0;
    if (chips > 0) {
      P.vx = nx; P.vy = ny; P.vz = nz;
      this.particles.burst(e.x, e.y, e.z, chips, 'spall', scale * 1.3);
    }
    const scatter = Math.round(5 * mult);
    if (scatter > 0) {
      this.particles.burst(e.x, e.y, e.z, scatter, 'spark', scale);
    }

    // -- vented atmosphere ---------------------------------------------------
    if (this.qSmoke > 0) {
      const vent = Math.round(4 * look.impact * this.qSmoke);
      if (vent > 0) {
        P.vx = nx; P.vy = ny; P.vz = nz;
        this.particles.burst(
          e.x + nx * scale * 0.2, e.y + ny * scale * 0.2, e.z + nz * scale * 0.2,
          vent, 'vent', scale * 1.2,
        );
      }
    }

    // -- tumbling embers, high quality only ---------------------------------
    if (this.quality.preset >= 2 && look.impact >= 1.5) {
      this.particles.burst(e.x, e.y, e.z, Math.round(5 * mult), 'debrisTrail', scale * 1.3);
    }
  };

  /** Shielded impact: hex ripple + skidding spray, coloured by the victim. */
  private shieldHit(
    e: GameEvents['hit'], scale: number,
    nx: number, ny: number, nz: number, mult: number,
  ): void {
    this.findHost(e.x, e.y, e.z);

    // Fall back to a bubble inferred from the event scale when no hull is found
    // (a splash hit on a ship that died in the same step, typically).
    const cx = _host.found ? _host.x : e.x - nx * scale * 6;
    const cy = _host.found ? _host.y : e.y - ny * scale * 6;
    const cz = _host.found ? _host.z : e.z - nz * scale * 6;
    const rad = (_host.found ? _host.r : scale * 6) * 1.14;
    const team = _host.found ? _host.team : e.team;

    const so = team * 3;
    const sr = this.shieldTint[so], sg = this.shieldTint[so + 1], sb = this.shieldTint[so + 2];

    // The ripple axis is the impact point as seen from the bubble centre, which
    // is more stable than the surface normal when the hit lands on a hull edge.
    let ax = e.x - cx, ay = e.y - cy, az = e.z - cz;
    const al = Math.hypot(ax, ay, az);
    if (al < 1e-4) { ax = nx; ay = ny; az = nz; } else { ax /= al; ay /= al; az /= al; }

    const o = this.shields.claim();
    if (o >= 0) {
      // Bigger bubbles ring for longer — a mothership shield is not a fighter's.
      const life = 0.34 + Math.min(rad, 900) * 0.0006;
      const f0 = this.shields.f[0], f1 = this.shields.f[1], f2 = this.shields.f[2];
      f0[o] = cx; f0[o + 1] = cy; f0[o + 2] = cz; f0[o + 3] = rad;
      f1[o] = ax; f1[o + 1] = ay; f1[o + 2] = az; f1[o + 3] = this.time;
      // HDR: the shell is allowed to blow out where the ring passes.
      const gain = 1.15 + Math.min(0.9, scale * 0.06);
      f2[o] = sr * gain; f2[o + 1] = sg * gain; f2[o + 2] = sb * gain;
      f2[o + 3] = 1 / life;
      this.shields.keepUntil(this.time + life);
    }

    // Point flash where the round actually stopped.
    if (e.kind !== 'ion') {
      this.flash(
        e.x, e.y, e.z, scale * 2.2, nx, ny, nz, 0,
        sr * 3.2 + 0.8, sg * 3.2 + 0.9, sb * 3.2 + 1.0, 1,
        0.10, FLARE_CORE,
      );
    }

    const n = Math.round(14 * mult);
    if (n > 0) {
      // Spray skids along the bubble: bias the cone axis away from the surface.
      P.vx = ax; P.vy = ay; P.vz = az;
      this.particles.burst(e.x, e.y, e.z, n, 'shieldSpray', scale * 1.25, sr, sg, sb);
    }
    if (this.quality.preset >= 2) {
      P.vx = ax; P.vy = ay; P.vz = az;
      this.particles.burst(e.x, e.y, e.z, Math.round(5 * mult), 'ionMotes', scale * 1.6, sr, sg, sb);
    }
  }

  /**
   * Recover the ship that owns the shield bubble a hit landed on, by asking the
   * sim's spatial hash for the neighbourhood of the impact and taking the hull
   * whose surface passes closest to the impact point. Writes `_host`.
   */
  private findHost(x: number, y: number, z: number): void {
    _host.found = false;
    const world = this.world;
    if (!world) return;

    const ids = _scratchIds;
    ids.length = 0;
    // radius 1 -> the 27 cells around the point, ~2.7 km on a side. Every hull
    // in the game has a bounding radius well inside that.
    world.hash.query(x, y, z, 1, ids);

    let best = -1;
    let bestErr = Infinity;
    for (let i = 0; i < ids.length; i++) {
      const s = world.ships.items[ids[i]];
      if (!s || !s.alive) continue;
      const spec = SHIP_SPECS[s.cls];
      if (spec.maxShield <= 0) continue;
      const dx = x - s.pos.x, dy = y - s.pos.y, dz = z - s.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // How far the impact sits from this hull's shield surface.
      const err = Math.abs(d - spec.radius) / Math.max(spec.radius, 1);
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    }
    // Reject nonsense matches — better a fallback bubble than one centred on a
    // ship two kilometres away.
    if (best < 0 || bestErr > 1.5) return;

    const s = world.ships.items[ids[best]];
    _host.x = s.pos.x; _host.y = s.pos.y; _host.z = s.pos.z;
    _host.r = SHIP_SPECS[s.cls].radius;
    _host.team = s.team;
    _host.found = true;
  }

  /** Write one transient flare into the ring. */
  private flash(
    x: number, y: number, z: number, size: number,
    ax: number, ay: number, az: number, stretch: number,
    r: number, g: number, b: number, alpha: number,
    life: number, variant: number,
  ): void {
    const o = this.flashes.claim();
    if (o < 0) return;
    const f = this.flashes.f;
    const f0 = f[0], f1 = f[1], f2 = f[2], f3 = f[3];
    f0[o] = x; f0[o + 1] = y; f0[o + 2] = z; f0[o + 3] = size;
    f1[o] = ax; f1[o + 1] = ay; f1[o + 2] = az; f1[o + 3] = stretch;
    f2[o] = r; f2[o + 1] = g; f2[o + 2] = b; f2[o + 3] = alpha;
    f3[o] = this.time;
    f3[o + 1] = 1 / Math.max(life, 1e-3);
    f3[o + 2] = variant;
    f3[o + 3] = this.rng.next();
    this.flashes.keepUntil(this.time + life);
  }

  /** Write one persistent flare (rewound every frame). */
  private liveFlare(
    x: number, y: number, z: number, size: number,
    ax: number, ay: number, az: number, stretch: number,
    r: number, g: number, b: number, alpha: number, variant: number,
  ): void {
    const o = this.liveFlares.claim();
    if (o < 0) return;
    const f = this.liveFlares.f;
    const f0 = f[0], f1 = f[1], f2 = f[2], f3 = f[3];
    f0[o] = x; f0[o + 1] = y; f0[o + 2] = z; f0[o + 3] = size;
    f1[o] = ax; f1[o + 1] = ay; f1[o + 2] = az; f1[o + 3] = stretch;
    f2[o] = r; f2[o + 1] = g; f2[o + 2] = b; f2[o + 3] = alpha;
    f3[o] = 0; f3[o + 1] = 0; f3[o + 2] = variant; f3[o + 3] = 0;
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  /** Draw every live projectile and beam, and animate the transient pools. */
  update(ctx: RenderContext, world: World): void {
    this.world = world;
    this.time = ctx.time;
    this.uTime.value = ctx.time;
    this.frame++;

    this.tracers.rewind();
    this.plasma.rewind();
    this.darts.rewind();
    this.beams.rewind();
    this.liveFlares.rewind();

    this.updateProjectiles(ctx, world);
    this.updateBeams(ctx, world);

    this.tracers.flush(ctx.time);
    this.plasma.flush(ctx.time);
    this.darts.flush(ctx.time);
    this.beams.flush(ctx.time);
    this.liveFlares.flush(ctx.time);
    this.flashes.flush(ctx.time);
    this.shields.flush(ctx.time);
  }

  /** Walk the projectile pool, routing each live round to its renderer. */
  private updateProjectiles(ctx: RenderContext, world: World): void {
    const pool = world.projectiles;
    const dt = ctx.dt;
    const now = ctx.time;

    for (let i = 0; i < pool.count; i++) {
      const p = pool.items[i];
      if (!p.alive) continue;

      const look = LOOKS[p.kind] ?? LOOKS.none;
      const ki = KIND_INDEX[p.kind] ?? 0;
      const o = (p.team * KIND_COUNT + ki) * 3;
      const cr = this.tint[o], cg = this.tint[o + 1], cb = this.tint[o + 2];
      const px = p.pos.x, py = p.pos.y, pz = p.pos.z;

      if (p.kind === 'missile' || p.kind === 'torpedo') {
        this.drawDart(p.id, p.kind, px, py, pz, p.vel.x, p.vel.y, p.vel.z,
          p.splash, p.seed, cr, cg, cb, now);
        continue;
      }

      if (p.kind === 'plasma') {
        const s = this.plasma.claim();
        if (s < 0) continue;
        // Splash radius drives the visual size: a mothership battery bolt should
        // dwarf a cruiser's, and `splash` is the only per-round size the sim has.
        const rad = 7 + Math.min(p.splash, 220) * 0.075;
        const f0 = this.plasma.f[0], f1 = this.plasma.f[1], f2 = this.plasma.f[2];
        f0[s] = px; f0[s + 1] = py; f0[s + 2] = pz; f0[s + 3] = rad;
        f1[s] = cr; f1[s + 1] = cg; f1[s + 2] = cb; f1[s + 3] = 1;
        f2[s] = look.core; f2[s + 1] = p.seed; f2[s + 2] = 0; f2[s + 3] = 0;

        // A velocity-aligned wake behind the blob. Plasma is slow, so without a
        // real streak it reads as a static ball; the wake is what says it is
        // travelling and in which direction. Round 2 called our fire "scattered
        // identical bright lozenges" — a fat head with a stub behind it is that
        // lozenge, so the wake is now long and thin (aspect ~8:1) and its
        // brightness runs down the LINE, matching every other tracer in frame.
        this.drawTracer(px, py, pz, p.vel.x, p.vel.y, p.vel.z,
          rad * 0.14, look.streak, cr * 0.80, cg * 0.80, cb * 0.80, 0.9,
          look.core * 0.35, 1.1, MIN_ANGLE * look.widthAng, look.minLen);

        // Ionised motes shed from the containment field.
        // Ambient motes are PER LIVE BOLT: at 26 Hz x 2 with a 1.2-2.8 s life
        // each plasma round carried roughly fifty of them, and a hundred rounds
        // in the air made five thousand ambient sprites nobody asked for. They
        // are seasoning on a bolt that already has a head and a wake.
        if (this.quality.preset >= 2 && this.rng.next() < dt * 5) {
          this.particles.burst(px, py, pz, 1, 'ionMotes', rad * 0.35, cr, cg, cb);
        }
        continue;
      }

      // pulse / massdriver / flak / anything else: a stretched tracer.
      this.drawTracer(px, py, pz, p.vel.x, p.vel.y, p.vel.z,
        look.width, look.streak, cr, cg, cb, 1, look.core, look.tail,
        MIN_ANGLE * look.widthAng, look.minLen);
    }
  }

  /**
   * Write one tracer instance.
   *
   * `widthAng` / `minLen` are the ANGULAR floors (radians) that keep the bolt
   * readable at range: `widthAng` stops it going sub-pixel across, `minLen`
   * stops it collapsing from a line into a dot. They are independent — that
   * independence is the whole fix for the "identical soft capsules" blocker.
   */
  private drawTracer(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    width: number, streak: number,
    r: number, g: number, b: number, gain: number,
    core: number, tail: number,
    widthAng: number, minLen: number,
  ): void {
    const o = this.tracers.claim();
    if (o < 0) return;
    const f0 = this.tracers.f[0], f1 = this.tracers.f[1];
    const f2 = this.tracers.f[2], f3 = this.tracers.f[3];
    f0[o] = x; f0[o + 1] = y; f0[o + 2] = z; f0[o + 3] = width;
    f1[o] = vx; f1[o + 1] = vy; f1[o + 2] = vz; f1[o + 3] = streak;
    f2[o] = r; f2[o + 1] = g; f2[o + 2] = b; f2[o + 3] = gain;
    f3[o] = core; f3[o + 1] = tail; f3[o + 2] = widthAng; f3[o + 3] = minLen;
  }

  /**
   * Body + motor flare + smoke trail for one missile or torpedo.
   *
   * The trail is laid at a fixed spacing in metres along the path actually
   * flown since the previous frame, so it is identical at 30 and 144 fps and
   * survives a stutter without beading.
   */
  private drawDart(
    id: number, kind: WeaponKind,
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    splash: number, seed: number,
    cr: number, cg: number, cb: number,
    now: number,
  ): void {
    const torp = kind === 'torpedo';
    const len = torp ? 9 + Math.min(splash, 120) * 0.055 : 4.5 + Math.min(splash, 60) * 0.045;

    // Flight axis; a stationary round (just spawned) points at +Z.
    let fx = vx, fy = vy, fz = vz;
    const vl = Math.hypot(fx, fy, fz);
    if (vl < 1e-4) { fx = 0; fy = 0; fz = 1; } else { fx /= vl; fy /= vl; fz /= vl; }

    // -- body ---------------------------------------------------------------
    const o = this.darts.claim();
    if (o >= 0) {
      const f0 = this.darts.f[0], f1 = this.darts.f[1], f2 = this.darts.f[2];
      // Motor throb: fast, seeded, never fully off.
      const throb = 0.82 + 0.18 * Math.sin(now * 34 + seed * 61);
      f0[o] = x; f0[o + 1] = y; f0[o + 2] = z; f0[o + 3] = len;
      f1[o] = fx; f1[o + 1] = fy; f1[o + 2] = fz; f1[o + 3] = seed;
      f2[o] = cr; f2[o + 1] = cg; f2[o + 2] = cb; f2[o + 3] = throb;
    }

    // -- motor flare --------------------------------------------------------
    const tailX = x - fx * len * 0.55;
    const tailY = y - fy * len * 0.55;
    const tailZ = z - fz * len * 0.55;
    const flare = len * (torp ? 0.15 : 0.13) * (0.86 + 0.14 * Math.sin(now * 41 + seed * 23));
    this.liveFlare(
      tailX - fx * flare * 0.6, tailY - fy * flare * 0.6, tailZ - fz * flare * 0.6,
      flare, fx, fy, fz, 1.2,
      cr * 1.2 + 0.72, cg * 1.2 + 0.44, cb * 1.2 + 0.20, 1, FLARE_SOFT,
    );

    // -- motor streak ---------------------------------------------------------
    // At battle range the dart body is a few pixels and the round motor flare
    // alone reads as a static dot. A velocity-stretched streak behind it is what
    // makes ordnance read as INBOUND rather than parked.
    const dl = LOOKS[kind];
    this.drawTracer(
      tailX, tailY, tailZ, vx, vy, vz,
      Math.max(len * 0.10, dl.width), dl.streak,
      cr * 0.9 + 0.30, cg * 0.9 + 0.14, cb * 0.9 + 0.05, 0.9,
      dl.core * 0.55, 1.35, MIN_ANGLE * dl.widthAng, dl.minLen,
    );

    // -- smoke trail --------------------------------------------------------
    if (!this.qTrail) {
      this.trailStamp[id] = this.frame;
      return;
    }

    const t3 = id * 3;
    const fresh = this.trailStamp[id] !== this.frame - 1;
    this.trailStamp[id] = this.frame;
    if (fresh) {
      // New round (or a recycled pool slot): start the trail here.
      this.trailPrev[t3] = tailX;
      this.trailPrev[t3 + 1] = tailY;
      this.trailPrev[t3 + 2] = tailZ;
      this.trailAcc[id] = 0;
      return;
    }

    const ax = this.trailPrev[t3], ay = this.trailPrev[t3 + 1], az = this.trailPrev[t3 + 2];
    const dx = tailX - ax, dy = tailY - ay, dz = tailZ - az;
    const d = Math.hypot(dx, dy, dz);
    this.trailPrev[t3] = tailX;
    this.trailPrev[t3 + 1] = tailY;
    this.trailPrev[t3 + 2] = tailZ;
    if (d < 1e-4) return;

    // A torpedo trail is the visual signature of a bomber run: dense, thick and
    // long-lived. A missile leaves a thinner, shorter thread.
    // Puffs must be born WIDER than the gap between them or the trail reads as a
    // dotted line instead of a rope; the alpha comes down to compensate for the
    // overlap that buys.
    const spacing = (torp ? len * 0.40 : len * 0.55) / Math.max(this.qSmoke, 0.2);
    const life = (torp ? 2.4 : 1.35) * (0.85 + this.qSmoke * 0.25);
    // NB: ParticleSystem sizes are DIAMETERS, so a puff must be born wider than
    // the spacing by a good margin before the trail closes into a rope.
    const born = spacing * (torp ? 2.4 : 2.0);
    const grown = torp ? len * 4.0 : len * 2.0;

    let acc = this.trailAcc[id] + d;
    let budget = TRAIL_BUDGET;
    const rng = this.rng;
    while (acc >= spacing && budget-- > 0) {
      acc -= spacing;
      // The puff sits `acc` metres short of the current tail position.
      const t = 1 - acc / d;
      const jx = rng.sign(), jy = rng.sign(), jz = rng.sign();

      P.x = ax + dx * t + jx * born * 0.16;
      P.y = ay + dy * t + jy * born * 0.16;
      P.z = az + dz * t + jz * born * 0.16;
      // Exhaust drifts backwards slowly and expands; it must not chase the round.
      P.vx = -fx * 3 + jx * 2.2;
      P.vy = -fy * 3 + jy * 2.2;
      P.vz = -fz * 3 + jz * 2.2;
      P.size = born * (0.85 + rng.next() * 0.35);
      P.sizeEnd = grown * (0.85 + rng.next() * 0.4);
      // Warm, dirty exhaust cooling to cold grey.
      P.r = 0.26; P.g = 0.22; P.b = 0.195;
      P.rEnd = 0.055; P.gEnd = 0.055; P.bEnd = 0.068;
      P.alpha = torp ? 0.20 : 0.14;
      P.alphaEnd = 0;
      P.life = life * (0.75 + rng.next() * 0.5);
      P.drag = 0.85;
      P.spin = rng.sign() * 0.5;
      P.kind = 3;
      P.additive = false;
      P.stretch = 0;
      P.turbulence = 0.45;
      this.particles.emit();

      // A hot ember riding the front of each puff keeps the trail from reading
      // as a grey rope at close range.
      // Only near the nozzle: a long-lived ember every puff turns the trail
      // into a string of beads.
      if (rng.next() < (torp ? 0.5 : 0.25)) {
        P.size = born * 0.20;
        P.sizeEnd = born * 0.04;
        P.r = cr * 1.8 + 1.2; P.g = cg * 1.8 + 0.55; P.b = cb * 1.8 + 0.2;
        P.rEnd = 0.6; P.gEnd = 0.12; P.bEnd = 0.03;
        P.alpha = 1; P.alphaEnd = 0;
        P.life = 0.09 + rng.next() * 0.12;
        P.drag = 0.9;
        P.spin = 0;
        P.kind = 0;
        P.additive = true;
        P.turbulence = 0;
        this.particles.emit();
      }
    }
    // Drop any backlog a stall created rather than paying it off over seconds.
    this.trailAcc[id] = budget > 0 ? acc : 0;
  }

  /** Walk the beam pool: ribbon, both end flares, and impact spatter. */
  private updateBeams(ctx: RenderContext, world: World): void {
    const pool = world.beams;
    const dt = ctx.dt;

    for (let i = 0; i < pool.count; i++) {
      const b = pool.items[i];
      if (!b.alive) continue;

      const inten = b.intensity <= 0 ? 0 : b.intensity > 1 ? 1 : b.intensity;
      if (inten <= 0.001) continue;

      const o = (b.team * KIND_COUNT + KIND_INDEX.ion) * 3;
      const cr = this.tint[o], cg = this.tint[o + 1], cb = this.tint[o + 2];
      // The sim quotes a structural half-width off the hardpoint size (1.2-3 m);
      // that is the size of the EMITTER, not of the discharge. A hero ion lance
      // wants to be a fifth of its own frigate across, so the visual floor is
      // LOOKS.ion.width and the sim value is scaled up to match.
      const w = Math.max(b.width * 2.6, LOOKS.ion.width);

      const s = this.beams.claim();
      if (s >= 0) {
        const f0 = this.beams.f[0], f1 = this.beams.f[1], f2 = this.beams.f[2];
        f0[s] = b.from.x; f0[s + 1] = b.from.y; f0[s + 2] = b.from.z; f0[s + 3] = w;
        f1[s] = b.to.x; f1[s + 1] = b.to.y; f1[s + 2] = b.to.z; f1[s + 3] = inten;
        f2[s] = cr; f2[s + 1] = cg; f2[s + 2] = cb; f2[s + 3] = b.seed;
      }

      // -- end caps: emitter bloom and, larger, the strike bloom -------------
      let dx = b.to.x - b.from.x, dy = b.to.y - b.from.y, dz = b.to.z - b.from.z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;

      // A lance of light has to be ANCHORED at both ends or it reads as a
      // painted line. Muzzle: a hot bloom plus a barrel-aligned star. Strike: a
      // bigger star plus an expanding hoop of splash. Critique round 1, "bright
      // flares at both ends".
      const flick = 0.82 + 0.18 * Math.sin(ctx.time * 27 + b.seed * 31);
      const jit = 0.9 + 0.2 * Math.sin(ctx.time * 61 + b.seed * 17);
      this.liveFlare(
        b.from.x, b.from.y, b.from.z, w * 4.6 * flick, dx, dy, dz, 0.25,
        cr * 1.8 + 1.0, cg * 1.8 + 1.1, cb * 1.8 + 1.2, inten, FLARE_CORE,
      );
      this.liveFlare(
        b.from.x, b.from.y, b.from.z, w * 7.0 * jit, dx, dy, dz, 0.9,
        cr * 1.2 + 0.5, cg * 1.2 + 0.6, cb * 1.2 + 0.7, inten * 0.8, FLARE_STAR,
      );
      this.liveFlare(
        b.to.x, b.to.y, b.to.z, w * 7.5 * flick, dx, dy, dz, 0,
        cr * 2.2 + 1.6, cg * 2.2 + 1.6, cb * 2.2 + 1.6, inten, FLARE_STAR,
      );
      this.liveFlare(
        b.to.x, b.to.y, b.to.z, w * 4.2 * jit, dx, dy, dz, 0,
        cr * 2.6 + 0.9, cg * 2.6 + 1.0, cb * 2.6 + 1.1, inten, FLARE_CORE,
      );

      // -- continuous spatter at the strike point ---------------------------
      // Rate-limited by an accumulator so the emission is framerate-independent
      // and a 2.6 s cruiser lance does not drain the particle pool on its own.
      const rate = 55 * this.qSpark * inten;
      let acc = this.beamAcc[b.id] + rate * dt;
      let n = 0;
      while (acc >= 1 && n < 12) { acc -= 1; n++; }
      this.beamAcc[b.id] = acc;
      if (n > 0) {
        P.vx = -dx; P.vy = -dy; P.vz = -dz;
        this.particles.burst(b.to.x, b.to.y, b.to.z, n, 'shieldSpray', w * 2.2, 3.0, 1.6, 0.6);
        if (this.quality.preset >= 2 && (n & 3) === 0) {
          P.vx = -dx; P.vy = -dy; P.vz = -dz;
          this.particles.burst(b.to.x, b.to.y, b.to.z, 2, 'ionMotes', w * 3.0, cr, cg, cb);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Drop every live effect (mission restart, scene reset). */
  clear(): void {
    this.tracers.clear();
    this.plasma.clear();
    this.darts.clear();
    this.beams.clear();
    this.liveFlares.clear();
    this.flashes.clear();
    this.shields.clear();
    this.trailStamp.fill(0);
    this.trailAcc.fill(0);
    this.beamAcc.fill(0);
  }

  dispose(): void {
    for (let i = 0; i < this.unsub.length; i++) this.unsub[i]();
    this.unsub.length = 0;

    const batches = [
      this.tracers, this.plasma, this.darts, this.beams,
      this.liveFlares, this.flashes, this.shields,
    ];
    for (let i = 0; i < batches.length; i++) {
      this.scene.remove(batches[i].mesh);
      batches[i].dispose();
    }

    this.matTracer.dispose();
    this.matPlasma.dispose();
    this.matBeam.dispose();
    this.matFlare.dispose();
    this.matDart.dispose();
    this.matShield.dispose();

    this.geoQuad.dispose();
    this.geoStrip.dispose();
    this.geoDart.dispose();
    this.geoSphere.dispose();

    this.world = null;
  }
}
