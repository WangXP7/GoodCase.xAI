// Rain: G.fx.rain = { update(dt), intensity }. A few instanced draws with one material (the shells,
// splashes and drips in one; one small draw per lamp that carries its own rain) in the post chain's
// 'fx' slot (pass name 'rain'), additive, depth-tested against the scene depth texture.
//
//   streaks  Three shells of drops around the camera, so the rain has depth: a few soft drops close
//            to the lens, a dense middle distance, and a far shell of very many fine lines. Nothing
//            is simulated: each drop's position is its seed plus velocity * time, wrapped into its
//            shell's box in world space, so the boxes follow the camera but the drops do not.
//            A streak is the drop's path over the shutter time (the farther shells are drawn with
//            more blur), never longer on screen than maxPx.
//   beams    Every outdoor lamp that shines down (up to BEAM_LAMPS, nearest first) has its own drops,
//            placed in the lamp's cone and nowhere else: fixed to the lamp, so they stay put in the
//            world when the camera turns or strafes. This is the far rain: from 30 or 40 m it reads
//            as a faintly striated glow, brightest under the lamp and fading to the beam's edge and
//            the ground. Within about 9 to 17 m of the eye it hands over to the shells.
//   soft     No streak is ever a hard one-pixel line or a dot: each is at least `soft.x` pixels wide
//            with a soft profile and at least `soft.y` times as long as wide, dimmed by what it gains.
//   splashes Where drops land: a ring spreading flat on the water (a thin ellipse at a grazing
//            angle) or a short soft crown, a new random spot every cycle. Soft to the edge, and
//            one too small to draw that way fades out instead of becoming a speck.
//   drips    Heavier drops falling in a line from the edges of everything rain cannot pass through
//            (the canopy, the awning, the trailer), each with its own ring underneath.
// Rain is only seen where light catches it:
//   - a falling drop shows a lamp's light only inside the beam and skirt the air shows
//     (lightlist.js BEAM), mostly when the lamp is behind it, and less and less within nearLit
//     metres of the eye (standing under a lamp must not fill the dark sky with white streaks);
//   - in front of a bright surface it shows a little of that surface (back);
//   - within a few metres outside a roof's edge it is lit by all the roof's lamps spill there,
//     near the eye or not, so the canopy has a curtain of rain round it (curtain);
//   - a drip or a splash is lit by all the light that falls where it is (the lamp's whole cone),
//     so the drip line along the canopy catches the canopy light; a splash needs properly lit
//     ground and takes almost nothing from the sky;
//   - the moon and the fog colour (so lightning lights the rain) add a faint cool glint.
// Streaks thinner than a pixel are drawn one pixel wide and dimmed by the same factor.
//
// Shelter: G.level.rainOccluders = [{ min:[x,y,z], max:[x,y,z] }, ...] (arrays or {x,y,z}): the
// roofs. A drop is traced back along its slanted path to the height of each roof's top; if it came
// through the roof it is not drawn, and it fades in over `margin` metres outside the roof's edge
// (the edge is marked by the drip line instead of a hard curtain). That covers drops next to the
// lens as well as distant ones: there is none under the canopy or inside the trailer. If the level
// publishes no occluders, G.level.areas ({ min, max } covered volumes) are used instead. Re-read
// twice a second, so the level can fill them in late. With neither, it rains everywhere.
// intensity (0..1) scales the number of drops and drives G.mats.shared.uRain.
//
// rain.uniforms (all { value }): gain, shutter (s), velocity (Vector3, m/s), maxPx, margin (m),
// desat (0..1 toward white), thin, spill (share of a lamp's whole cone a falling drop shows outside
// the visible beam), ambient (x fog colour), moon, inside (how much of a lamp's light is dropped when
// the eye stands in its light), nearLit (m), back (how much of a bright background a drop shows),
// beam (Vector4: metres from the eye where beam rain starts / is full, its streak length in shutter
// times, how much dimmer at the ground), beamGain, soft (Vector3: least width in px at 1080 lines,
// least length : width, width against the final pass's colour fringing as a multiple of the split),
// curtain (Vector2: spill and extra brightness of rain just outside a roof's edge).
import {
  InstancedBufferGeometry, BufferAttribute, InstancedBufferAttribute, RawShaderMaterial, GLSL3, Mesh, AdditiveBlending,
  DynamicDrawUsage, Vector2, Vector3, Vector4, Matrix4, Frustum, Sphere, Group,
} from 'three';
import { createLightList, readFog, FOG_GLSL, BEAM } from '../render/post/lightlist.js';

// shells: drop count, box (m), how far ahead of the camera the box sits (m), drop half-width (m), brightness, streak length (x one shutter's fall)
const SHELLS = [
  { count: 240, box: [7, 6, 7], ahead: 2.2, wid: 0.0045, gain: 0.3, blur: 1 },
  { count: 20000, box: [22, 13, 22], ahead: 8, wid: 0.0016, gain: 1, blur: 2.2 },
  { count: 26000, box: [58, 20, 58], ahead: 23, wid: 0.0016, gain: 1, blur: 2.6 },
];
const STREAKS = SHELLS.reduce((n, s) => n + s.count, 0);
const SPLASHES = 5000;
const SPLASH_BOX = 28; // metres square, centred 9 m ahead
const BEAM_LAMPS = 8; // outdoor lamps whose beams carry their own rain
const BEAM_DROPS = 5000; // per lamp
const BEAMS = BEAM_LAMPS * BEAM_DROPS;
const BEAM_FULL = 22; // metres: a lamp this close or closer shows all its drops; farther ones fewer, by the area the cone covers
const MAX_DRIPS = 5000;
const FIXED = STREAKS + SPLASHES; // these follow the drips in the buffers, in order of density rank
const TOTAL = MAX_DRIPS + FIXED;
const MAX_OCCLUDERS = 16;
const RAIN_LIGHTS = 16; // 15 lamps + the muzzle flash
const DRIP_SPACING = 0.03; // metres between drip points along an edge
const QUALITY_DENSITY = { high: 1, medium: 0.65, low: 0.4 };
const QUALITY_BEAMS = { high: 1, medium: 0.7, low: 0.5 }; // further share of each lamp's own drops (each as much brighter)

const VERT = /* glsl */ `precision highp float;
#define NOCC ${MAX_OCCLUDERS}
#define NL ${RAIN_LIGHTS}
in vec2 corner;
in vec4 iA;
in vec4 iB;
// streak: iA = seed xyz, density rank          iB = shell (0, 1, 2), speed, size, brightness (all 0..1)
// splash: iA = seed x, seed z, phase, rank      iB = 3, period (s), size 0..1, kind (ring below 0.6, crown above)
// drip:   iA = x, y of the edge, z, phase       iB = 4, period (s), ground y, rank
// beam:   iA = radius, height, turn (0..1), rank iB = 5 + lamp slot, speed, size, brightness
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform vec2 resolution;
uniform float uTime;
uniform vec3 uCentre[3];
uniform vec3 uBox[3];
uniform vec3 uShell[3];   // half-width (m), brightness, streak length in shutter times (far rain is drawn with more blur)
uniform vec3 uSplashCentre;
uniform vec3 uVelocity;   // mean drop velocity, m/s
uniform float uShutter;
uniform float uMaxPx;     // longest streak, screen pixels at 1080 lines
uniform float uDensity;
uniform float uGroundY;
uniform float uMargin;
uniform float uDesat;
uniform float uSpill;     // 0..1: share of a lamp's light a falling drop shows outside the visible beam and its skirt
uniform float uNearLit;   // m: falling drops nearer the eye than this show less and less lamp light
uniform float uThin;      // 0..1: how much a streak thinner than a pixel is dimmed (1 = by its true coverage)
uniform vec3 uOccMin[NOCC];
uniform vec3 uOccMax[NOCC];
uniform int uOccCount;
uniform vec4 uLPos[NL];   // xyz, range
uniform vec4 uLDir[NL];   // axis, cos of the lamp's full cone
uniform vec4 uLCol[NL];   // colour * candela, cos where the full cone reaches full strength
uniform vec4 uLVis[NL];   // the visible beam (lightlist.js BEAM): cos of its edge, cos where the edge starts, cos of the skirt's edge, skirt gain
uniform int uLCount;
#define NB ${BEAM_LAMPS}
uniform vec4 uBPos[NB];   // lamp xyz, tan of the beam's half angle
uniform vec4 uBDir[NB];   // axis, cos of the beam's edge
uniform vec4 uBCol[NB];   // colour * gain, cos where the beam's soft edge starts
uniform vec4 uBExt[NB];   // ground y, 1 / distance along the axis to the ground, share of its drops drawn, 1 = in use
uniform vec4 uBeam;       // m from the eye where beam rain starts / is full, streak length (x one shutter's fall), how much dimmer at the ground
uniform vec3 uSoft;       // narrowest streak (px at 1080 lines), least length : width, width against the colour split at the frame's sides
uniform float uFringe;    // the final pass's chromatic aberration x frame width, pixels
uniform vec2 uCurtain;    // spill and brightness of rain just outside a roof's edge
uniform vec3 uMoonDir;
uniform vec3 uMoonCol;
uniform vec3 uAmbient;
uniform float uGain;
uniform float uBack;
uniform highp sampler2D tScene;
${FOG_GLSL}
out vec2 vUv;
out float vViewZ;
flat out vec3 vCol;   // everything the drop shows, ready to draw
flat out vec2 vShape; // 0 streak / 1 ring on the ground / 2 crown, splash age 0..1

// x: 0 under a roof, 1 in the open. vel = the drop's velocity: it is traced back up to each roof's top.
// y: 1 just outside a roof's edge and below it (where the roof sheds its water and its lamps spill), 0 from 4 m out.
vec2 open(vec3 p, vec3 vel) {
  float o = 1.0; float edge = 0.0;
  for (int i = 0; i < NOCC; i++) {
    if (i >= uOccCount) break;
    vec3 a = uOccMin[i]; vec3 b = uOccMax[i];
    if (p.y >= b.y) continue;
    vec2 q = p.xz + vel.xz * ((b.y - p.y) / vel.y);
    float d = length(max(max(a.xz - q, q - b.xz), 0.0));
    o = min(o, smoothstep(0.0, uMargin, d));
    edge = max(edge, smoothstep(0.0, 0.5, d) * (1.0 - smoothstep(0.8, 4.0, d)) * (1.0 - smoothstep(b.y - 0.6, b.y, p.y)));
  }
  return vec2(o, edge);
}
vec2 hash2(vec3 p) {
  uvec3 v = uvec3(ivec3(p));
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x;
  return vec2(v.xy >> 8u) * (1.0 / 16777216.0);
}
// Is the point off screen (with 1.2 m of slack for a streak's length) or behind the eye? Asked first, before any
// roof or lamp is looked at: the boxes reach well past the view's sides, and most drops are not in view.
bool unseen(vec3 q) {
  vec4 c = projectionMatrix * (viewMatrix * vec4(q, 1.0));
  return c.w < 0.15 || abs(c.x) > c.w + 1.2 || abs(c.y) > c.w + 1.2;
}
vec3 wrapBox(vec3 w, vec3 centre, vec3 box) { return centre + mod(w - centre + 0.5 * box, box) - 0.5 * box; }
// 1 in the middle of a shell's box, 0 at its sides
float inBox(vec3 p, vec3 centre, vec3 box) {
  vec2 e = abs(p.xz - centre.xz) / (0.5 * box.xz);
  return 1.0 - smoothstep(0.78, 1.0, max(e.x, e.y));
}

// Light a drop sends toward the eye. spill = how much of each lamp's whole cone counts: a falling
// drop shows only in the beam the air shows (spill near 0); a drip off a roof edge or a splash on
// the ground is lit by whatever light falls there (1). dark = how much sky and moon it picks up,
// lamps = how much lamp light.
vec3 lightDrop(vec3 p, vec3 toEye, float spill, float dark, float lamps) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < NL; i++) {
    if (i >= uLCount) break;
    vec3 L = p - uLPos[i].xyz;
    float d2 = dot(L, L);
    vec3 l = L * inversesqrt(d2 + 1e-6);
    float w = d2 / (uLPos[i].w * uLPos[i].w);
    w = clamp(1.0 - w * w, 0.0, 1.0);
    if (w <= 0.0) continue;
    float ca = dot(l, uLDir[i].xyz);
    vec4 V = uLVis[i];
    float beam = (1.0 - V.w) * smoothstep(V.x, V.y, ca) + 0.5 * V.w * smoothstep(V.z, mix(V.z, V.x, 0.6), ca);
    beam = mix(beam, smoothstep(uLDir[i].w, uLCol[i].w, ca), spill);
    if (beam <= 0.0) continue;
    float c = dot(l, toEye);
    float f = max(c, 0.0); float b = max(-c, 0.0);
    float ph = 0.3 + 1.3 * f * f * f + 0.25 * b * b; // drops between the eye and a lamp glitter
    sum += uLCol[i].rgb * (beam * w * w * ph / (d2 + 1.0));
  }
  float cm = max(dot(-uMoonDir, toEye), 0.0);
  sum = sum * lamps + (uAmbient + uMoonCol * (0.3 + 1.7 * cm * cm * cm)) * dark;
  return mix(sum, vec3(dot(sum, vec3(0.2126, 0.7152, 0.0722))), uDesat);
}

void main() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUv = corner; vViewZ = 0.0; vCol = vec3(0.0); vShape = vec2(0.0);
  vec3 p; vec3 axis = vec3(0.0, -1.0, 0.0);
  float halfLen = 0.0; float halfWid = 0.0; float bright = 1.0;
  float splashAge = -1.0; float splashSize = 0.0; float kind = 1.0;
  float nearFade = 1.5; float spill = uSpill; float dark = 1.0; float keepNear = 1.0;
  float aspect = 0.0; float coverage = uThin; int beamLamp = -1;

  if (iB.x < -0.5) return; // an unused drip slot
  if (iB.x < 2.5) {
    if (iA.w > uDensity) return;
    int s = int(iB.x + 0.5);
    vec3 vel = uVelocity * vec3(1.0, 0.85 + 0.3 * iB.y, 1.0);
    p = wrapBox(iA.xyz * uBox[s] + vel * uTime, uCentre[s], uBox[s]);
    if (p.y < uGroundY || unseen(p)) return;
    vec2 op = open(p, vel);
    bright = op.x;
    if (bright <= 0.0) return;
    // each shell hands over to the next one out, so the density is even and nothing pops at a box side
    bright *= inBox(p, uCentre[s], uBox[s]);
    if (s > 0) bright *= 1.0 - inBox(p, uCentre[s - 1], uBox[s - 1]);
    if (bright <= 0.0) return;
    float speed = length(vel);
    axis = vel / speed;
    halfLen = 0.5 * speed * uShutter * uShell[s].z * (0.7 + 0.6 * iB.z);
    halfWid = uShell[s].x * (0.7 + 0.6 * iB.z);
    bright *= uShell[s].y * (0.3 + 1.0 * iB.w * iB.w); // most drops faint, a few bright
    nearFade = s == 0 ? 0.6 : 1.5;
    // just outside a roof the rain is lit by everything the roof's lamps spill, close to the eye or not: a curtain at the edge
    spill = mix(uSpill, uCurtain.x, op.y);
    bright *= 1.0 + uCurtain.y * op.y;
    keepNear = op.y;
    aspect = s == 0 ? 0.0 : uSoft.y;
  } else if (iB.x > 4.5) {
    // rain in an outdoor lamp's beam: every drop stays inside the cone, spread evenly through its volume,
    // falling from the cone's surface to the ground and starting again
    beamLamp = int(iB.x - 4.5);
    vec4 P = uBPos[beamLamp]; vec4 E = uBExt[beamLamp];
    // a far lamp's cone is small on screen: it gets fewer drops, each as much brighter, so it costs what it covers
    float share = uDensity * E.z;
    if (E.w <= 0.0 || iA.w > share) return;
    float H = P.y - E.x;
    float rr = 0.5 - sin(asin(1.0 - 2.0 * iA.x) / 3.0); // 0 on the axis .. 1 at the foot of the cone's edge
    float span = max(H * (1.0 - rr), 0.3);
    vec3 vel = uVelocity * vec3(1.0, 0.85 + 0.3 * iB.y, 1.0);
    float fallen = fract(iA.y + uTime * -vel.y / span) * span;
    float turn = iA.z * 6.2831853;
    p = vec3(P.x + H * P.w * rr * cos(turn), P.y - H * rr - fallen, P.z + H * P.w * rr * sin(turn));
    // the cone leans with the lamp, and the wind carries the drop as it falls
    p.xz += uBDir[beamLamp].xz * ((P.y - p.y) / max(-uBDir[beamLamp].y, 0.3)) + vel.xz * ((fallen - 0.5 * span) / -vel.y);
    if (unseen(p) || distance(p, cameraPosition) < uBeam.x) return;
    bright = open(p, vel).x * smoothstep(0.0, 0.15, 1.0 - iA.w / share) / E.z; // the last drops of the share fade, so none pops as the eye moves
    if (bright <= 0.0) return;
    float speed = length(vel);
    axis = vel / speed;
    halfLen = 0.5 * speed * uShutter * uBeam.z * (0.7 + 0.6 * iB.z);
    halfWid = 0.002 * (0.7 + 0.6 * iB.z);
    bright *= 0.25 + 1.5 * iB.w * iB.w;
    nearFade = 1.5;
    aspect = uSoft.y; coverage = 1.0; // drawn larger than life at a distance, and dimmed by exactly as much
  } else if (iB.x < 3.5) {
    if (iA.w > uDensity) return;
    float ph = uTime / iB.y + iA.z;
    splashAge = fract(ph) * iB.y / 0.26;
    if (splashAge > 1.0) return;
    vec2 h = hash2(vec3(iA.x * 9973.0, iA.y * 7919.0, floor(ph)));
    vec3 box = vec3(${SPLASH_BOX.toFixed(1)}, 1.0, ${SPLASH_BOX.toFixed(1)});
    p = wrapBox(vec3(h.x * box.x, 0.0, h.y * box.z), uSplashCentre, box);
    p.y = uGroundY;
    if (unseen(p)) return;
    bright = open(p + vec3(0.0, 0.05, 0.0), uVelocity).x * inBox(p, uSplashCentre, box);
    if (bright <= 0.0) return;
    kind = iB.w < 0.7 ? 1.0 : 2.0;
    splashSize = kind < 1.5 ? 0.035 + 0.12 * iB.z * iB.z : 0.03 + 0.03 * iB.z; // rings: most small, a few wide
    bright *= 2.0;
    spill = 1.0; dark = 0.1;
  } else {
    if (iB.w > uDensity * 1.6) return;
    if (unseen(vec3(iA.x, 0.5 * (iA.y + iB.z), iA.z)) && unseen(vec3(iA.x, iA.y, iA.z)) && unseen(vec3(iA.x, iB.z, iA.z))) return; // the whole fall is out of view
    float age = fract(uTime / iB.y + iA.w) * iB.y;
    float fall = sqrt(max(iA.y - iB.z, 0.0) / 4.905);
    if (age < fall) {
      p = vec3(iA.x, iA.y - 4.905 * age * age, iA.z);
      halfLen = max(0.5 * 9.81 * age * uShutter * 3.0, 0.05); // heavy drops: drawn with a longer trail than the rain
      halfWid = 0.0035;
      bright = 2.2 * (0.4 + iB.w);
      aspect = uSoft.y;
      nearFade = 1.5; // a drip line right in front of the lens would read as rain under the roof
      spill = 1.0; dark = 3.0; // a drip catches whatever light falls on the roof's edge, and a heavy drop glints even in the dark
    } else {
      splashAge = (age - fall) / 0.22;
      if (splashAge > 1.0) return;
      p = vec3(iA.x, iB.z, iA.z);
      splashSize = 0.075;
      bright = 6.0;
      spill = 1.0; dark = 0.1;
    }
  }

  vec3 toEye = cameraPosition - p;
  float dist = length(toEye);
  toEye /= dist;
  vec4 vp = viewMatrix * vec4(p, 1.0);
  if (vp.z > -0.15) return;
  vec4 clip = projectionMatrix * vp;
  if (abs(clip.x) > clip.w + 1.2 || abs(clip.y) > clip.w + 1.2) return;
  float pxPerMetre = 0.5 * resolution.y * projectionMatrix[1][1] / -vp.z;
  vec3 world;
  if (splashAge < 0.0) {
    float scale = resolution.y / 1080.0;
    halfLen = min(halfLen, 0.5 * uMaxPx * scale / pxPerMetre);
    // Never a hard one-pixel line: a streak is at least uSoft.x pixels wide with a soft profile, so it
    // does not glitter as it crosses pixels, and at least uSoft.y times as long as wide, so far rain is
    // fine lines and never dots. Toward the left and right of the frame the final pass's chromatic
    // aberration pulls red and blue apart sideways (uFringe = that pass's amount in pixels); a streak
    // there is made uSoft.z times as wide as the split, or it would show as a red line beside a blue
    // one. What a streak gains in size it loses in brightness.
    vec2 off = 0.5 * clip.xy / clip.w;
    float aspectXY = resolution.x / resolution.y;
    float split = 2.0 * abs(off.x) * (dot(off * vec2(aspectXY, 1.0), off * vec2(aspectXY, 1.0)) / (0.25 * (aspectXY * aspectXY + 1.0))) * uFringe;
    float px = 2.0 * halfWid * pxPerMetre;
    float k0 = max(px, uSoft.x * scale) / px;        // as wide as it must be to be soft
    float k = max(px * k0, min(uSoft.z * split, 5.0 * scale)) / px; // and as wide as the colour split asks, up to 5 px
    float lenPx = 2.0 * halfLen * pxPerMetre;
    float kl = max(lenPx, aspect * 0.8 * px * k0) / lenPx; // 0.8: the soft profile shows a little over half the quad's width and most of its length
    // drops right at the lens would be out of focus: fade them. Width added against the colour split costs all of its brightness.
    bright *= smoothstep(nearFade, nearFade * 3.0, dist) * pow(k0 * kl, -coverage) * (k0 / k);
    halfLen *= kl;
    vec3 side = normalize(cross(axis, toEye));
    world = p + axis * (halfLen * corner.y) + side * (halfWid * k * corner.x);
  } else {
    // Never a hard speck: a splash too small to draw as a soft shape fades out instead of being held at a pixel or two.
    float s = splashSize * (0.4 + 0.6 * splashAge);
    float px = 2.0 * s * pxPerMetre;
    bright *= smoothstep(2.0, 5.0, px);
    if (kind < 1.5) {
      // a ring spreading flat on the water; seen at a grazing angle it is a thin ellipse, kept at least 1.6 px tall
      vec3 f = normalize(vec3(toEye.x, 0.0, toEye.z) + vec3(1e-4, 0.0, 0.0));
      vec3 side = vec3(-f.z, 0.0, f.x); // side x f points up, so the quad faces the eye
      float tall = max(px * abs(toEye.y), 1e-3);
      float k = max(tall, 1.6) / tall;
      bright /= k;
      world = p + side * (s * corner.x) + f * (s * k * corner.y) + vec3(0.0, 0.012, 0.0);
    } else {
      // the crown: a short soft jet thrown up from the impact
      vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toEye));
      world = p + side * (s * 0.7 * corner.x) + vec3(0.0, s * (corner.y + 1.0), 0.0);
    }
    vShape = vec2(kind, splashAge);
  }
  if (bright <= 0.0005) return;
  // The colour is flat across the quad: only the vertex both triangles end on (the provoking one, corner (-1, 1))
  // has to work it out. The other three only place the quad.
  if (corner.x < 0.0 && corner.y > 0.0) {
  bright *= exp(-fogOpticalDepth(cameraPosition.y, -toEye.y, dist));
  if (beamLamp >= 0) {
    // lit by its own lamp only: brightest under the lamp, fading to the beam's edge and toward the ground
    vec3 L = p - uBPos[beamLamp].xyz;
    float d = length(L);
    vec3 ax = uBDir[beamLamp].xyz;
    float c = dot(L, toEye) / d;
    float f = max(c, 0.0);
    float lit = smoothstep(uBDir[beamLamp].w, uBCol[beamLamp].w, dot(L, ax) / d)
      * pow(max(1.0 - dot(L, ax) * uBExt[beamLamp].y, 0.0), 1.3) * (1.0 - uBeam.w * smoothstep(0.3, 1.0, dot(L, ax) * uBExt[beamLamp].y))
      * (0.7 + 0.9 * f * f * f) * smoothstep(uBeam.x, uBeam.y, dist);
    vec3 col = uBCol[beamLamp].rgb * (lit * bright);
    vCol = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), 0.5 * uDesat) * uGain;
  } else {
    vCol = lightDrop(p, toEye, spill, dark, mix(smoothstep(0.2 * uNearLit, uNearLit, dist), 1.0, keepNear)) * bright;
    // a splash shows where the ground is properly lit, and not at all in the dim edge of a lamp's reach
    if (splashAge >= 0.0) vCol *= smoothstep(0.6, 3.0, dot(vCol, vec3(0.2126, 0.7152, 0.0722)) / max(bright, 1e-4));
    vCol *= uGain;
    // a falling drop is a lens: in front of a bright surface it shows a little of that brightness (read once, behind its middle)
    if (splashAge < 0.0) vCol += min(textureLod(tScene, clip.xy / clip.w * 0.5 + 0.5, 0.0).rgb, vec3(4.0)) * (bright * uBack);
  }
  // Rain is only seen where something lights it: a drop that would add next to nothing fades to nothing
  // (most of them, over the dark lot and the sky), so the dark stays clean.
  vCol *= smoothstep(0.0005, 0.0015, max(vCol.r, max(vCol.g, vCol.b)));
  }
  vec4 v = viewMatrix * vec4(world, 1.0);
  vViewZ = -v.z;
  gl_Position = projectionMatrix * v;
}`;

const frag = (post) => /* glsl */ `precision highp float;
precision highp sampler2D;
${post.glsl.depth}
uniform vec2 texel;
in vec2 vUv;
in float vViewZ;
flat in vec3 vCol;
flat in vec2 vShape;
out vec4 outColor;
void main() {
  vec2 suv = gl_FragCoord.xy * texel;
  if (linearDepth(suv) < vViewZ) discard;
  float a;
  if (vShape.x < 0.5) {
    float x = 1.0 - vUv.x * vUv.x;
    float y = 1.0 - vUv.y * vUv.y;
    a = x * x * y * (0.55 + 0.45 * smoothstep(-1.0, 0.6, vUv.y)); // brighter toward the leading end
  } else if (vShape.x < 1.5) {
    // ring: grows outward and thins; nothing reaches the quad's edge
    float t = vShape.y;
    float r = length(vUv);
    float R = 0.12 + 0.66 * t;
    // A ripple is seen by what its slopes reflect, not as a drawn circle: the near and far crests
    // (the slopes that tilt toward and away from the eye) catch the light, the sides hardly do.
    // So the ring is two soft arcs, thin, fading as it spreads.
    float arc = 0.12 + 0.88 * pow(abs(vUv.y) / max(r, 1e-3), 2.0);
    a = 0.6 * exp(-pow((r - R) / 0.1, 2.0)) * arc * (1.0 - smoothstep(0.7, 1.0, r)) * (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.12, t);
  } else {
    float t = vShape.y;
    float v = vUv.y * 0.5 + 0.5; // 0 at the ground
    float x = vUv.x * (1.0 + 1.5 * (1.0 - v)); // narrow at the foot, opening upward
    a = exp(-x * x * 5.0 - pow((v - 0.3 - 0.3 * t) / 0.24, 2.0)) * (1.0 - smoothstep(0.55, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.7, 1.0, v)) * (1.0 - t) * (1.0 - t);
  }
  outColor = vec4(vCol * a, 1.0);
}`;

const X = (v) => (v && v.x !== undefined ? v.x : v[0]);
const Y = (v) => (v && v.y !== undefined ? v.y : v[1]);
const Z = (v) => (v && v.z !== undefined ? v.z : v[2]);

export function createRain(G) {
  const post = G.post;
  if (!post || post.stub || typeof post.addPass !== 'function' || !G.fx || G.fx.stub) return null;
  const rng = G.rng.fork('rain');

  const dataA = new Float32Array(TOTAL * 4);
  const dataB = new Float32Array(TOTAL * 4);
  // Two sets of instances, drawn together with one material. Every instance submitted costs time whether or
  // not the shader keeps it, so each set is laid out to submit as few as possible:
  //   main   MAX_DRIPS drip slots (unused ones are marked -1), then every shell streak and splash sorted by
  //          density rank (iA.w): at lower density (medium, low, lighter rain) only the head is drawn.
  //   beams  one small geometry per lamp slot, BEAM_DROPS each, sorted by rank: a slot is drawn only while a
  //          lamp holds it, and only as many of its drops as that lamp shows at its distance.
  const madeA = new Float32Array(FIXED * 4);
  const madeB = new Float32Array(FIXED * 4);
  let at = 0;
  for (let s = 0; s < SHELLS.length; s++) {
    for (let i = 0; i < SHELLS[s].count; i++, at++) {
      madeA.set([rng.next(), rng.next(), rng.next(), rng.next()], at * 4);
      madeB.set([s, rng.next(), rng.next(), rng.next()], at * 4);
    }
  }
  for (let i = 0; i < SPLASHES; i++, at++) {
    madeA.set([rng.next(), rng.next(), rng.next(), rng.next()], at * 4);
    madeB.set([3, rng.range(0.35, 0.9), rng.next(), rng.next()], at * 4);
  }
  const beamData = [];
  for (let slot = 0; slot < BEAM_LAMPS; slot++) {
    const ranks = Array.from({ length: BEAM_DROPS }, () => rng.next()).sort((a, b) => a - b);
    const a = new Float32Array(BEAM_DROPS * 4); const b = new Float32Array(BEAM_DROPS * 4);
    for (let i = 0; i < BEAM_DROPS; i++) {
      a.set([rng.next(), rng.next(), rng.next(), ranks[i]], i * 4);
      b.set([5 + slot, rng.next(), rng.next(), rng.next()], i * 4);
    }
    beamData.push({ a, b });
  }
  const byRank = Array.from({ length: FIXED }, (_, i) => i).sort((a, b) => madeA[a * 4 + 3] - madeA[b * 4 + 3]);
  for (let i = 0; i < FIXED; i++) {
    const from = byRank[i] * 4; const to = (MAX_DRIPS + i) * 4;
    for (let k = 0; k < 4; k++) { dataA[to + k] = madeA[from + k]; dataB[to + k] = madeB[from + k]; }
  }
  for (let i = 0; i < MAX_DRIPS; i++) dataB[i * 4] = -1;
  const geo = new InstancedBufferGeometry();
  const corners = new BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2);
  geo.setIndex([0, 1, 2, 1, 3, 2]); // both triangles end on vertex 2: its flat outputs colour the whole quad
  geo.setAttribute('corner', corners);
  const beamGeos = beamData.map(({ a, b }) => {
    const g = new InstancedBufferGeometry();
    g.setIndex([0, 1, 2, 1, 3, 2]);
    g.setAttribute('corner', corners);
    g.setAttribute('iA', new InstancedBufferAttribute(a, 4)); g.setAttribute('iB', new InstancedBufferAttribute(b, 4));
    g.instanceCount = 0;
    return g;
  });
  const attrA = new InstancedBufferAttribute(dataA, 4);
  const attrB = new InstancedBufferAttribute(dataB, 4);
  attrA.setUsage(DynamicDrawUsage); attrB.setUsage(DynamicDrawUsage);
  geo.setAttribute('iA', attrA); geo.setAttribute('iB', attrB);
  geo.instanceCount = TOTAL;

  const vec3s = (n) => Array.from({ length: n }, () => new Vector3());
  const vec4s = (n) => Array.from({ length: n }, () => new Vector4());
  const uniforms = {
    ...post.shared,
    uTime: { value: 0 }, uCentre: { value: vec3s(3) }, uBox: { value: SHELLS.map((s) => new Vector3(...s.box)) },
    uShell: { value: SHELLS.map((s) => new Vector3(s.wid, s.gain, s.blur)) }, uSplashCentre: { value: new Vector3() },
    uVelocity: { value: new Vector3(1.1, -9.2, 0.5) }, uShutter: { value: 1 / 60 }, uMaxPx: { value: 36 }, uDensity: { value: 0.7 }, uGroundY: { value: 0 },
    uMargin: { value: 1.6 }, uDesat: { value: 0.5 }, uThin: { value: 0.6 }, uSpill: { value: 0.04 }, uNearLit: { value: 10 },
    uBPos: { value: vec4s(BEAM_LAMPS) }, uBDir: { value: vec4s(BEAM_LAMPS) }, uBCol: { value: vec4s(BEAM_LAMPS) }, uBExt: { value: vec4s(BEAM_LAMPS) },
    uBeam: { value: new Vector4(9, 17, 2.5, 0.8) }, uSoft: { value: new Vector3(1.8, 18, 2) }, uFringe: { value: 0 }, uCurtain: { value: new Vector2(0.6, 1.3) },
    uOccMin: { value: vec3s(MAX_OCCLUDERS) }, uOccMax: { value: vec3s(MAX_OCCLUDERS) }, uOccCount: { value: 0 },
    uLPos: { value: vec4s(RAIN_LIGHTS) }, uLDir: { value: vec4s(RAIN_LIGHTS) }, uLCol: { value: vec4s(RAIN_LIGHTS) }, uLVis: { value: vec4s(RAIN_LIGHTS) }, uLCount: { value: 0 },
    uMoonDir: { value: new Vector3(0, 1, 0) }, uMoonCol: { value: new Vector3() }, uAmbient: { value: new Vector3() },
    uFogDensity: { value: 0 }, uFogFalloff: { value: 0 }, uGain: { value: 0.15 }, uBack: { value: 0.1 },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader: VERT, fragmentShader: frag(post), uniforms,
    depthTest: false, depthWrite: false, transparent: true, blending: AdditiveBlending,
  });
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.name = 'fx-rain';
  const drawn = new Group();
  drawn.add(mesh);
  const beamMeshes = beamGeos.map((g, i) => {
    const m = new Mesh(g, material);
    m.frustumCulled = false; m.visible = false;
    m.name = `fx-rain-beam-${i}`;
    drawn.add(m);
    return m;
  });

  // ---- shelter -------------------------------------------------------------------------------
  let boxes = []; // [minX, minY, minZ, maxX, maxY, maxZ]
  let order = []; // indices into boxes, nearest the camera first (only used past MAX_OCCLUDERS)
  let boxSum = NaN;
  let sinceRead = 1e9;
  const source = () => {
    const L = G.level;
    if (!L) return null;
    if (Array.isArray(L.rainOccluders) && L.rainOccluders.length) return L.rainOccluders;
    // no roof boxes published: fall back to the covered areas (floor to underside), which shelter the same ground
    return L.areas || null;
  };
  // a number that changes when any box changes; nothing is allocated unless it did
  function checksum(src, groundY) {
    let sum = groundY * 7.13; let n = 0;
    if (Array.isArray(src)) {
      for (let i = 0; i < src.length; i++) {
        const b = src[i];
        if (!b || !b.min || !b.max) continue;
        n++;
        sum += (X(b.min) + 2 * Y(b.min) + 3 * Z(b.min) + 5 * X(b.max) + 7 * Y(b.max) + 11 * Z(b.max)) * (i + 1);
      }
    } else if (src) {
      for (const k in src) {
        const b = src[k];
        if (!b || !b.min || !b.max) continue;
        n++;
        sum += (X(b.min) + 2 * Y(b.min) + 3 * Z(b.min) + 5 * X(b.max) + 7 * Y(b.max) + 11 * Z(b.max)) * n;
      }
    }
    return sum + n * 1000.37;
  }
  function readBoxes(src) {
    const out = [];
    if (!src) return out;
    for (const b of Array.isArray(src) ? src : Object.values(src)) {
      if (!b || !b.min || !b.max) continue;
      const box = [X(b.min), Y(b.min), Z(b.min), X(b.max), Y(b.max), Z(b.max)];
      if (box.every(Number.isFinite)) out.push(box);
    }
    return out;
  }
  const covered = (x, y, z, skip) => {
    for (const b of boxes) if (b !== skip && x > b[0] && x < b[3] && z > b[2] && z < b[5] && y < b[4]) return true;
    return false;
  };
  // Drip points along the roof edges: the underside of a raised slab, or the top of a solid block.
  function buildDrips(groundY) {
    const drip = G.rng.fork('rain-drips');
    const edges = [];
    let total = 0;
    for (const b of boxes) {
      const y = b[1] - groundY > 1.8 ? b[1] : b[4];
      if (y - groundY < 1.8) continue;
      const corners = [[b[0], b[2]], [b[3], b[2]], [b[3], b[5]], [b[0], b[5]]];
      for (let e = 0; e < 4; e++) {
        const [x0, z0] = corners[e]; const [x1, z1] = corners[(e + 1) % 4];
        const len = Math.hypot(x1 - x0, z1 - z0);
        edges.push({ b, y, x0, z0, x1, z1, len });
        total += len;
      }
    }
    const spacing = Math.max(DRIP_SPACING, total / MAX_DRIPS);
    let n = 0;
    const end = MAX_DRIPS;
    for (const e of edges) {
      const count = Math.floor(e.len / spacing);
      // outward normal of the edge (corners run counter-clockwise seen from above with +z toward the viewer)
      const nx = (e.z1 - e.z0) / e.len; const nz = -(e.x1 - e.x0) / e.len;
      for (let i = 0; i < count && n < end; i++) {
        const t = (i + drip.next()) / count;
        const x = e.x0 + (e.x1 - e.x0) * t + nx * 0.03; const z = e.z0 + (e.z1 - e.z0) * t + nz * 0.03;
        if (covered(x, e.y - 0.05, z, e.b)) continue; // an edge that butts against another roof does not drip
        dataA.set([x, e.y, z, drip.next()], n * 4);
        // a new drop a little after the last one lands, so every point always has one in the air
        dataB.set([4, Math.sqrt(Math.max(e.y - groundY, 0) / 4.905) + 0.22 + drip.range(0, 0.5), groundY, drip.next()], n * 4);
        n++;
      }
    }
    for (let i = n; i < MAX_DRIPS; i++) dataB[i * 4] = -1; // slots left over from a longer set of edges
    attrA.needsUpdate = true; attrB.needsUpdate = true;
  }
  const gap = (b, p) => Math.hypot(Math.max(b[0] - p.x, 0, p.x - b[3]), Math.max(b[2] - p.z, 0, p.z - b[5]));
  let sortAt = null;
  const byGap = (i, j) => gap(boxes[i], sortAt) - gap(boxes[j], sortAt);
  function refreshShelter(camPos, groundY) {
    const src = source();
    const sum = checksum(src, groundY);
    if (sum !== boxSum) { // the level changed its roofs: the only time anything here allocates
      boxSum = sum;
      boxes = readBoxes(src);
      order = boxes.map((_, i) => i);
      buildDrips(groundY);
    }
    // the shader tests the nearest MAX_OCCLUDERS
    if (boxes.length > MAX_OCCLUDERS) { sortAt = camPos; order.sort(byGap); }
    const n = Math.min(boxes.length, MAX_OCCLUDERS);
    for (let i = 0; i < n; i++) {
      const b = boxes[order[i]];
      uniforms.uOccMin.value[i].set(b[0], b[1], b[2]);
      uniforms.uOccMax.value[i].set(b[3], b[4], b[5]);
    }
    uniforms.uOccCount.value = n;
  }

  // ---- lights --------------------------------------------------------------------------------
  const lights = createLightList(G, RAIN_LIGHTS - 1);
  const fog = { density: 0, falloff: 0, r: 0, g: 0, b: 0 };
  const camPos = new Vector3();
  const fwd = new Vector3();
  const focus = new Vector3();
  const tmp = new Vector3();
  // lamps whose light falls where the drops are: around a point in the middle distance, not behind the camera
  const nearScore = (l) => {
    tmp.subVectors(l.pos, camPos);
    if (tmp.dot(fwd) < -l.range) return 0;
    const d2 = tmp.subVectors(l.pos, focus).lengthSq();
    const reach = l.range + 30;
    return d2 > reach * reach ? 0 : (l.intensity * (l.spot ? 1 : 0.3)) / (d2 + 80);
  };

  // Outdoor lamps that shine down: each keeps a slot (its own drops) for as long as it is in the list.
  const beamLights = createLightList(G, BEAM_LAMPS);
  const beamSlot = new Map(); // fixture -> slot
  const slotUsed = new Array(BEAM_LAMPS).fill(null);
  const underRoof = (q) => {
    for (const b of boxes) if (q.x > b[0] && q.x < b[3] && q.z > b[2] && q.z < b[5] && q.y < b[4] + 0.2) return true;
    return false;
  };
  const frustum = new Frustum();
  const viewProj = new Matrix4();
  const cone = new Sphere();
  const beamScore = (l) => {
    if (!l.spot || l.dir.y > -0.7 || l.intensity < 150) return 0;
    tmp.subVectors(l.pos, camPos);
    const d = tmp.length();
    if (d > 110 || underRoof(l.pos)) return 0;
    // a ball round the lamp's cone, lamp to ground: out of view, the lamp's drops are not even placed
    const h = Math.max(l.pos.y - l.groundY, 1);
    cone.center.set(l.pos.x, l.pos.y - 0.5 * h, l.pos.z);
    cone.radius = h * (0.5 + Math.tan(l.visAngle)) + 1;
    return frustum.intersectsSphere(cone) ? 1 / (d + 10) : 0;
  };
  function setBeams(cam, quality) {
    frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const list = beamLights.gather(beamScore);
    for (let i = 0; i < BEAM_LAMPS; i++) { slotUsed[i] = null; uniforms.uBExt.value[i].w = 0; beamMeshes[i].visible = false; }
    for (const [ref, i] of beamSlot) {
      let keep = false;
      for (let k = 0; k < list.count; k++) if (list.items[k].ref === ref) keep = true;
      if (keep) slotUsed[i] = ref; else beamSlot.delete(ref);
    }
    for (let k = 0; k < list.count; k++) {
      const l = list.items[k];
      let i = beamSlot.get(l.ref);
      if (i === undefined) {
        i = slotUsed.indexOf(null);
        if (i < 0) continue;
        beamSlot.set(l.ref, i); slotUsed[i] = l.ref;
      }
      const lum = 0.2126 * l.r + 0.7152 * l.g + 0.0722 * l.b;
      const g = rain.uniforms.beamGain.value / Math.max(lum, 1e-3);
      uniforms.uBPos.value[i].set(l.pos.x, l.pos.y, l.pos.z, Math.tan(l.visAngle));
      uniforms.uBDir.value[i].set(l.dir.x, l.dir.y, l.dir.z, l.cosVisOuter);
      uniforms.uBCol.value[i].set(l.r * g, l.g * g, l.b * g, l.cosVisInner);
      const d = tmp.subVectors(l.pos, camPos).length();
      const share = Math.min(1, Math.max(0.04, (BEAM_FULL / d) * (BEAM_FULL / d))) * (QUALITY_BEAMS[quality] ?? 1);
      uniforms.uBExt.value[i].set(l.groundY, -l.dir.y / Math.max(l.pos.y - l.groundY, 0.5), share, 1);
      // the shader keeps ranks up to density x share: submit those and no more
      beamGeos[i].instanceCount = Math.min(BEAM_DROPS, Math.ceil(uniforms.uDensity.value * share * BEAM_DROPS) + 8);
      beamMeshes[i].visible = true;
    }
  }

  let time = 0;
  const rain = {
    intensity: 0.7,
    uniforms: {
      gain: uniforms.uGain, shutter: uniforms.uShutter, velocity: uniforms.uVelocity, maxPx: uniforms.uMaxPx,
      margin: uniforms.uMargin, desat: uniforms.uDesat, thin: uniforms.uThin, spill: uniforms.uSpill, ambient: { value: 0.8 }, moon: { value: 0.08 }, inside: { value: 0.92 }, nearLit: uniforms.uNearLit, back: uniforms.uBack,
      beam: uniforms.uBeam, beamGain: { value: 16 }, soft: uniforms.uSoft, curtain: uniforms.uCurtain,
    },
    update(dt) {
      time += dt;
      sinceRead += dt;
      rain.intensity = Math.min(1, Math.max(0, rain.intensity));
      const shared = G.mats && G.mats.shared;
      if (shared && shared.uRain) shared.uRain.value = rain.intensity;
    },
  };

  const pass = post.addPass({
    name: 'rain',
    render(p) {
      if (rain.intensity <= 0.001) return;
      const cam = p.camera;
      camPos.setFromMatrixPosition(cam.matrixWorld);
      cam.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() > 1e-6) fwd.normalize();
      focus.copy(camPos).addScaledVector(fwd, 12);
      const groundY = uniforms.uGroundY.value;
      if (sinceRead > 0.5) { sinceRead = 0; refreshShelter(camPos, groundY); }

      uniforms.uTime.value = time;
      for (let s = 0; s < SHELLS.length; s++) {
        const a = SHELLS[s].ahead;
        uniforms.uCentre.value[s].set(camPos.x + fwd.x * a, camPos.y + (s === 0 ? 0.5 : 0.5 * SHELLS[s].box[1] - 3), camPos.z + fwd.z * a);
      }
      uniforms.uSplashCentre.value.set(camPos.x + fwd.x * 9, groundY, camPos.z + fwd.z * 9);
      // every drop at the default intensity (0.7) on high; fewer below it
      uniforms.uDensity.value = Math.min(1, rain.intensity / 0.7) * (QUALITY_DENSITY[p.quality.name] ?? 1);
      geo.instanceCount = MAX_DRIPS + Math.min(FIXED, Math.ceil(uniforms.uDensity.value * FIXED) + 64); // ranks above the density are never drawn: do not submit them
      setBeams(cam, p.quality.name);
      const ca = p.uniforms && p.uniforms.chromaticAberration;
      uniforms.uFringe.value = ca && ca.value > 0 ? ca.value * p.width : 0;

      const list = lights.gather(nearScore);
      let n = 0;
      for (; n < list.count; n++) {
        const l = list.items[n];
        uniforms.uLPos.value[n].set(l.pos.x, l.pos.y, l.pos.z, l.range);
        uniforms.uLDir.value[n].set(l.dir.x, l.dir.y, l.dir.z, l.cosOuter);
        // A lamp the eye stands under lights every drop around the lens; like the air (volumetrics `inside`), turn most of that down.
        let k = l.intensity;
        if (l.spot) {
          const d = tmp.subVectors(camPos, l.pos).length();
          // counted from the skirt's edge inward: anywhere in the lamp's light, the drops round the lens are in it too
          const deep = d > 1e-3 && d < l.range ? Math.min(1, Math.max(0, (tmp.dot(l.dir) / d - l.cosSkirt) / Math.max(l.cosVisOuter - l.cosSkirt, 1e-3))) : 0;
          k *= 1 - rain.uniforms.inside.value * deep * deep * (3 - 2 * deep);
        }
        uniforms.uLCol.value[n].set(l.r * k, l.g * k, l.b * k, l.cosInner);
        uniforms.uLVis.value[n].set(l.cosVisOuter, l.cosVisInner, l.cosSkirt, l.spot && l.skirtAngle > l.visAngle + 0.02 ? BEAM.skirtGain : 0);
      }
      const mz = G.fx && G.fx.muzzleLight;
      if (mz && mz.intensity > 0.01) {
        uniforms.uLPos.value[n].set(mz.pos.x, mz.pos.y, mz.pos.z, mz.range || 14);
        uniforms.uLDir.value[n].set(0, -1, 0, -2);
        uniforms.uLCol.value[n].set(mz.color.x * mz.intensity, mz.color.y * mz.intensity, mz.color.z * mz.intensity, -1.5);
        uniforms.uLVis.value[n].set(-2, -1.5, -2, 0);
        n++;
      }
      uniforms.uLCount.value = n;

      const moon = G.sky && G.sky.moon;
      if (moon && moon.intensity > 0) {
        uniforms.uMoonDir.value.copy(moon.dir);
        uniforms.uMoonCol.value.set(moon.color.r, moon.color.g, moon.color.b).multiplyScalar(moon.intensity * rain.uniforms.moon.value);
      } else uniforms.uMoonCol.value.set(0, 0, 0);
      readFog(G, fog);
      uniforms.uAmbient.value.set(fog.r, fog.g, fog.b).multiplyScalar(rain.uniforms.ambient.value);
      uniforms.uFogDensity.value = fog.density; uniforms.uFogFalloff.value = fog.falloff;

      p.renderer.setRenderTarget(p.targets.hdr);
      p.renderer.render(drawn, cam);
    },
    dispose() { geo.dispose(); for (const g of beamGeos) g.dispose(); material.dispose(); },
  }, 'fx');
  rain.pass = pass;

  G.fx.rain = rain;
  return rain;
}
