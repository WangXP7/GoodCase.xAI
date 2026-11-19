// Materials. Buildings and ground are MeshStandardMaterials patched with procedural detail, so they keep
// three's lighting, shadows, fog and environment reflections.
//
// Building vertex attributes (see meshing.js):
//   color    surface colour (linear); the wall texture only adds detail on top
//   aFacade  x: window column coordinate (integer = bay edge), y: height above the base (m),
//            z: floor height (m), w: building seed in [0, 1)
//   aBldg    x: building height (m), y: category + 8 * texture layer, z: kind (KIND), w: bay width (m, 0 = no windows)
import * as THREE from 'three';

export const shared = {
  uNight: { value: 0 }, // 0 day .. 1 night: how far the lights are on
  uDark: { value: 0 },  // 0 day .. 1 night: how dark it is
  uTime: { value: 0 },  // seconds, for wind and signals
  // aerial photo over the area: texture, and its rectangle in world x/z as (minX, minZ, sizeX, sizeZ)
  uOrtho: { value: null }, uOrthoRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uOrthoOn: { value: 0 },
  // lit windows at night: the share of rooms whose light comes and goes, and the clock they go by (seconds that
  // run as fast as the pace says: see windowPace; at pace 1 a room may change every 1.5 to 5.5 minutes)
  uWindowLife: { value: new THREE.Vector2(0.5, 0) },
  // how strongly the glass of tall buildings mirrors the lights of the city at night (0: off)
  uCityGlass: { value: 0 }, // (off: the glass is flat and mirrors what is really there; the drawn lights are dots)
  // how bright the lit rooms are at night (1: as designed)
  uRoomLight: { value: 1.75 },
  // how soft the lit rooms are at night (0: even bright panels, as they were; 1: lamps, curtains, spill)
  uSoft: { value: 1 },
  // the glow of the trees on the abstract model by night (set every frame: main.js)
  uTreeGlow: { value: new THREE.Color(0, 0, 0) },
  // the season of the trees (props.js): 0 summer (green, as they are), 1 autumn, 2 spring
  uSeason: { value: 0 },
  // contact shadows (contact.js): how dark (0: none), the blurred mask of what stands on the ground, where it lies
  uContact: { value: 0 }, uContactMap: { value: null }, uContactRect: { value: new THREE.Vector4(0, 0, 1, 0) },
  // how much the windows look like glass (0: as plain mirrors, the way they were): see the facade shader
  uGlass: { value: 2 },
  // how blue the lights of the city are at night (0: mostly warm, 1: a cool blue city)
  uNightBlue: { value: 0.55 },
  // lamp light on the ground (src/world/lamplight.js): on at night, the light map, where it lies
  uLampOn: { value: 0 }, uLampMap: { value: null }, uLampRect: { value: new THREE.Vector4(0, 0, 1, 0) },
  // the city mirrored in the water (mirror.js): the picture, how a point of the world maps into it, and whether there is one
  uMirror: { value: null }, uMirrorMatrix: { value: new THREE.Matrix4() }, uMirrorOn: { value: 0 },
  // the clouds, for the water to mirror (set by atmosphere.js): the weather map the cloud pass draws them from, its
  // drift, the cover, the height of the cloud base, the place of the world on the globe, and where clouds are kept to
  uCloudMap: { value: null }, uCloudOffset: { value: new THREE.Vector2() }, uCloudCover: { value: 0 }, uCloudBase: { value: 450 }, uCloudsOn: { value: 0 },
  uWorldToECEF: { value: new THREE.Matrix4() }, uCloudRect: { value: new THREE.Vector4() }, uCloudFade: { value: 500 },
  // the sun in the window glass: direction to the sun (world), and its colour times how much of it there is
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunGlint: { value: new THREE.Color(0, 0, 0) }, uGlintOn: { value: 1 },
  // wall photos: the distances (m) between which a facade goes from generated to photo, and how much photo at most
  uPhotoRange: { value: new THREE.Vector2(140, 420) }, uPhotoMix: { value: 1 },
};

// ---------------------------------------------------------------- variants
// The abstract model (the city as a plain model of itself, with the light as it is), whether the landmarks keep
// their look on it, and whether the buildings have windows. These are not values the shaders read but variants
// the shaders are compiled in: with all three as they are here, every shader is exactly what it is without
// this section, to the letter.
export const variant = { abstract: false, landmarks: false, windows: true, contact: false, relief: false };
const varying = new Set(); // the materials whose shaders depend on `variant`
export const variantKey = () => (variant.abstract ? 'a' : '') + (variant.abstract && variant.landmarks ? 'l' : '') + (variant.windows ? '' : 'w') + (variant.relief ? 'r' : '');
// Registers a material whose onBeforeCompile reads `variant`.
export function varies(material) {
  varying.add(material);
  material.addEventListener('dispose', () => varying.delete(material));
  return material;
}
export function setVariant(changes) {
  Object.assign(variant, changes);
  for (const m of varying) m.needsUpdate = true; // (compiled again, or taken from the programs already made)
}

// The colours of the abstract model (linear), after the plain 3D view of a street map. By day: cream for the
// buildings people go to (shops, offices), a cool pale grey for the others, the land between them, the water.
// By night the model is slate blue (purple where the shops are), brighter than the dark it stands in.
export const ABSTRACT = {
  shop: [0.47, 0.42, 0.33], home: [0.4, 0.405, 0.47], land: [0.36, 0.36, 0.38], paving: [0.4, 0.4, 0.43], water: [0.2, 0.36, 0.6],
  // (by night, as a street map shows it: warm grey-brown blocks and slate blue ones, on dark blue-green ground)
  night: { shop: [0.06, 0.05, 0.045], home: [0.034, 0.052, 0.08], land: [0.012, 0.022, 0.031], tree: [0.006, 0.06, 0.058] },
};
const v3 = (c) => `vec3(${c.join(', ')})`;


const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Anti-aliased box [a, b] in x with filter width w.
float box(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
}
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
`;

const WORLD_VARYINGS_VERT = 'varying vec3 vWPos;\nvarying vec3 vWNrm;';
const WORLD_VARYINGS_SET = 'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * normal);';
// Replaces the shading normal with the tangent-space normal gNm in the world frame (gT, gB, gN).
const APPLY_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(normalize(gT * gNm.x + gB * gNm.y + gN * gNm.z), 0.0)).xyz);
`;

// ---------------------------------------------------------------- facade
const FACADE_PARS = /* glsl */ `
uniform float uNight;
uniform float uTime;
uniform vec2 uWindowLife;
uniform float uCityGlass;
uniform float uRoomLight;
uniform float uSoft;
uniform float uGlass;
uniform float uNightBlue;
uniform vec3 uSunDir;
uniform vec3 uSunGlint;
uniform float uGlintOn;
uniform sampler2DArray uWallAlb;
uniform sampler2DArray uWallNor;
uniform float uWallScale[6];
uniform float uWallDetail[6];
varying vec4 vFacade;
varying vec4 vBldg;
varying vec3 vWPos;
varying vec3 vWNrm;
float gRough, gMetal;
vec3 gGlint = vec3(0.0); // the sun mirrored in a pane (added to the specular light where the sun reaches it)
float gPane = 0.0; // how much of a mirror this fragment is: window glass (written to alpha for the reflection pass)
vec3 gEmissive, gT, gB, gN, gNm;
${NOISE}
`;

const FACADE_MAIN = /* glsl */ `
{
  gN = normalize(vWNrm);
  gT = abs(gN.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), gN));
  gB = cross(gN, gT);
  float seed = vFacade.w, height = vBldg.x, kind = vBldg.z, cellW = vBldg.w;
  float layer = floor(vBldg.y / 8.0 + 0.01), cat = vBldg.y - layer * 8.0;
  float u = vFacade.x, v = vFacade.y, floorH = vFacade.z;

  // surface texture: detail (mean 1) over the vertex colour, plus a normal map
  vec2 st = vec2(dot(vWPos, gT), dot(vWPos, gB));
  vec3 tuv = vec3(st / uWallScale[int(layer)], layer);
  vec3 wall = diffuseColor.rgb * mix(vec3(1.0), texture(uWallAlb, tuv).rgb * 2.0, uWallDetail[int(layer)]);
  wall *= 0.9 + 0.2 * vnoise(st * 0.11 + seed * 50.0);          // breaks up tiling over large walls
  gNm = texture(uWallNor, tuv).xyz * 2.0 - 1.0;
  gNm = normalize(vec3(gNm.xy * 0.7, gNm.z));
  gRough = 0.82; gMetal = 0.0; gEmissive = vec3(0.0);
  if (layer > 3.5 && layer < 4.5) { gRough = 0.5; gMetal = 0.35; }  // metal siding and roofs

  // weathering on walls: rain streaks, a dirty base, run-off under the roofline
  if (kind < 0.5 || (kind > 1.5 && kind < 2.5)) {
    float streak = vnoise(vec2(st.x * 2.2, st.y * 0.13 + seed * 40.0));
    float grime = smoothstep(0.55, 0.95, streak) * 0.1
      + (1.0 - smoothstep(0.0, 1.6, v)) * 0.1
      + smoothstep(height - 2.5, height, v) * streak * 0.14;
    wall *= 1.0 - grime;
  }
  diffuseColor.rgb = wall;

  // steelwork of a lattice tower (src/world/tower.js): painted steel in the vertex colour, floodlit at night
  if (kind > 3.5) {
    // (a colour brighter than 1 is a lamp: dark glass by day, lit at night; the steel keeps its own paint
    // under the floodlights)
    float lampOn = step(1.5, max(vColor.r, max(vColor.g, vColor.b)));
    diffuseColor.rgb = mix(vColor.rgb * (0.94 + 0.12 * vnoise(st * 0.7)), vec3(0.12), lampOn);
    gRough = 0.5; gMetal = 0.25; gNm = vec3(0.0, 0.0, 1.0);
    // By night the steel keeps its own paint, dimly: it is the bulbs along its frame that light the tower. The
    // warning lights at the top flash for aircraft: on for half of every 1.6 seconds.
    float beat = fract(uTime / 1.6), flash = mix(1.0, 0.08 + 0.92 * smoothstep(0.0, 0.07, beat) * (1.0 - smoothstep(0.45, 0.58, beat)), lampOn * step(vColor.g, 0.037 * vColor.r));
    // (lit up, the painted steel shows a clear red — not the orange of its paint by day — and the white bands a warm gold)
    vec3 steel = vColor.r > 2.0 * vColor.g ? vec3(0.5, 0.03, 0.012) : vColor.rgb * vec3(0.62, 0.46, 0.22);
    gEmissive = mix(steel, vColor.rgb * 1.6 * flash, lampOn) * uNight;
  }

  if (kind < 0.5 && cellW > 0.5) {
    float fyAll = v / floorH, row = floor(fyAll), col = floor(u);
    // Per-room random numbers. The seed is interpolated, so it carries rounding noise: hash only
    // integers derived from it (meshing.js stores seeds as multiples of 1/4096).
    float sid = floor(seed * 4096.0 + 0.5);
    vec2 room = vec2(col + mod(sid, 61.0) * 17.0, row + mod(sid, 53.0) * 13.0);
    float fx = fract(u), fy = fract(fyAll);
    float wx = max(fwidth(u), 1e-4), wy = max(fwidth(fyAll), 1e-4);
    float far = smoothstep(0.2, 0.6, max(wx, wy));                   // the grid aliases far away

    // window rectangle within one bay: [x0, x1] x [y0, y1]
    vec4 r = vec4(0.14, 0.86, 0.3, 0.82);                            // apartments, offices
    if (cat < 0.5) r = vec4(0.26, 0.74, 0.36, 0.78);                 // houses
    else if (cat > 3.5 && cat < 4.5) r = vec4(0.16, 0.84, 0.3, 0.8); // public
    else if (cat > 4.5) r = vec4(0.0, 1.0, 0.26, 1.0);               // curtain wall: glass above a spandrel
    bool shop = row < 0.5 && cat > 1.5 && cat < 3.5;
    if (shop) r = vec4(0.05, 0.95, 0.03, 0.8);                       // ground-floor shopfront
    float valid = step(0.0, v) * step(v, height - 0.9);
    // houses and apartments: some bays are plain wall
    if (cat < 2.5 && !shop) valid *= step(0.2, hash12(room + 41.0));
    float inWin = box(fx, r.x, r.y, wx) * box(fy, r.z, r.w, wy) * valid;

    // frame and mullions, measured in metres from the window edge
    vec2 wmin = vec2(r.x * cellW, r.z * floorH), wmax = vec2(r.y * cellW, r.w * floorH);
    vec2 pm = vec2(fx * cellW, fy * floorH);
    float edge = min(min(pm.x - wmin.x, wmax.x - pm.x), min(pm.y - wmin.y, wmax.y - pm.y));
    float fw = cat > 4.5 ? 0.045 : 0.065, ew = max(fwidth(edge), 1e-4);
    float frame = 1.0 - smoothstep(fw - ew, fw + ew, edge);
    float panes = max(1.0, floor((wmax.x - wmin.x) / 1.25 + 0.5));
    float mx = fract((pm.x - wmin.x) / (wmax.x - wmin.x) * panes);
    float mw = 0.03 * panes / (wmax.x - wmin.x);
    frame = max(frame, panes > 1.5 ? 1.0 - box(mx, mw, 1.0 - mw, max(fwidth(mx), 1e-4)) : 0.0);
    frame *= 1.0 - far;
    float pane = inWin * (1.0 - frame);

    // interior mapping: intersect the view ray with a room box behind the glass
    vec3 V = normalize(vWPos - cameraPosition);
    vec3 rd = vec3(dot(V, gT) / cellW, dot(V, gB) / floorH, dot(V, gN) / 4.5) + vec3(1e-5, 1e-5, 0.0);
    vec3 ro = vec3(fx, fy, 0.0);
    vec2 tA = (step(0.0, rd.xy) - ro.xy) / rd.xy;
    float tz = -1.0 / min(rd.z, -1e-4);
    float tHit = min(min(tA.x, tA.y), tz);
    vec3 hp = ro + rd * tHit;
    float rh = hash12(room);
    vec3 interior = mix(vec3(0.74, 0.69, 0.6), vec3(0.6, 0.63, 0.68), rh);
    float shade = 0.62;                                              // side walls
    if (tHit == tz) shade = 0.5 + 0.28 * step(0.42, hp.y);          // back wall above a furniture band
    else if (tHit == tA.y) shade = rd.y > 0.0 ? 1.0 : 0.38;         // ceiling, floor
    interior *= shade * mix(1.0, 0.5, clamp(-hp.z, 0.0, 1.0));
    // blinds or curtains pulled part-way down some windows
    float blind = step(0.5, hash12(room + 7.7)) * hash12(room + 3.1);
    float wyLocal = (fy - r.z) / (r.w - r.z);
    if (!shop && wyLocal > 1.0 - blind * 0.85) interior = mix(vec3(0.8, 0.78, 0.72), vec3(0.68, 0.7, 0.74), rh) * 0.75;
    interior = mix(interior, vec3(0.42, 0.42, 0.4), far);            // far away: the average room

    // lit rooms at night: shops and offices more often than homes
    float onRate = shop ? 0.75 : cat > 2.5 ? 0.32 : 0.22;
    // No two buildings alike: one is asleep and the next is busy; many offices are lit by the floor (a whole
    // storey working late, the one above dark).
    float b1 = fract(seed * 11.7), b2 = fract(seed * 17.3), b3 = fract(seed * 23.9);
    onRate *= mix(0.35, 1.9, b1);
    if (!shop && cat > 2.5 && b2 > 0.4) onRate = mix(0.05, 0.9, step(0.5, hash12(vec2(row * 3.0 + mod(sid, 37.0), mod(sid, 53.0)))));
    // A tower at night is mostly dark glass: a few storeys lit as bands, the rest a mirror for the city.
    float tall = smoothstep(70.0, 110.0, height);
    if (!shop) onRate = mix(onRate, 0.02 + 0.8 * step(0.9, hash12(vec2(row * 5.0 + mod(sid, 41.0), mod(sid, 59.0)))), tall);
    onRate = clamp(onRate, 0.0, 0.95);
    // Some rooms stay as they are all night. The others (uWindowLife.x of them) are lived in: every so often,
    // each room on its own clock (90 to 330 s of the windows' clock uWindowLife.y), someone may come in or
    // leave, and the light goes on or off over a moment. Which rooms, and when, is by chance: each room draws
    // anew for every stretch of its own clock.
    float fickle = step(1.0 - uWindowLife.x, hash12(room + 31.0));
    float period = 90.0 + 240.0 * hash12(room + 37.0);
    float clock = uWindowLife.y / period + hash12(room + 41.0) * 64.0, slot = floor(clock);
    // (the draw for a stretch: small numbers only, so that the chance stays good however long the clock has run)
    vec2 was = vec2(mod(slot - 1.0, 61.0) * 7.13, mod(slot - 1.0, 47.0) * 3.71), now = vec2(mod(slot, 61.0) * 7.13, mod(slot, 47.0) * 3.71);
    float lit = mix(step(1.0 - onRate, hash12(room + 43.0 + was)), step(1.0 - onRate, hash12(room + 43.0 + now)), smoothstep(0.0, 4.0 / period, fract(clock)));
    float on = mix(step(1.0 - onRate, hash12(room + 23.0)), lit, fickle);
    // The colour of the light: homes mostly warm bulbs, some cool, the odd blue of a television; an office
    // building one kind of tube throughout, cool white more often than warm. Brightness varies room by room
    // and building by building.
    float tint = hash12(room + 61.0), office = step(2.5, cat);
    vec3 warm = mix(vec3(1.0, 0.6, 0.3), vec3(1.0, 0.82, 0.6), hash12(room + 67.0));
    // (uNightBlue leans the city towards blue: bluer cool lamps, more of them, more rooms in screen light)
    vec3 cool = mix(vec3(1.0, 0.95, 0.86), mix(vec3(0.78, 0.9, 1.0), vec3(0.42, 0.66, 1.0), uNightBlue), hash12(room + 71.0));
    float coolShare = mix(0.25, mix(0.12, 0.95, step(0.35, b2)), office) + 0.45 * uNightBlue;
    vec3 lamp = mix(warm, cool, step(1.0 - coolShare, mix(tint, 0.5 * b3 + 0.5 * tint, office)));
    lamp = mix(lamp, vec3(0.3, 0.55, 1.0), step(0.93 - 0.22 * uNightBlue, tint) * mix(1.0 - office, 1.0, uNightBlue));
    float glow = mix(0.3, 1.35, hash12(room + 1.3)) * mix(0.65, 1.25, b3);

    // glass: mostly a mirror of the sky; the room behind shows through as emitted light
    vec3 glassTint = cat > 4.5 ? mix(vec3(0.2, 0.3, 0.38), vec3(0.3, 0.33, 0.34), fract(seed * 5.7)) : vec3(0.1, 0.11, 0.12);
    vec3 frameCol = fract(seed * 3.3) < 0.5 ? vec3(0.16, 0.17, 0.18) : vec3(0.62, 0.63, 0.63);
    diffuseColor.rgb = mix(diffuseColor.rgb, frameCol, inWin * frame);
    diffuseColor.rgb = mix(diffuseColor.rgb, glassTint, pane);
    gRough = mix(gRough, 0.45, inWin * frame);
    gRough = mix(gRough, 0.05, pane);
    gMetal = mix(gMetal, 0.92, pane);
    // (the panes are flat but for a trace: the glass mirrors the world as it is)
    float tilt = 0.008;
    gNm = mix(gNm, normalize(vec3((hash12(room + 5.1) - 0.5) * tilt, (hash12(room + 9.4) - 0.5) * tilt, 1.0)), inWin);
    float daylight = (1.0 - uNight) * (shop ? 0.3 : cat > 4.5 ? 0.06 : 0.12);
    // A lit room is not an even bright panel (uSoft: 0 as it was .. 1). The light comes from a lamp somewhere in
    // it, brightest there and falling away towards the corners of the window; in many rooms a curtain or a blind
    // is drawn and the whole window glows evenly and more dimly, in the colour of the cloth; the colours are
    // nearer to one another, and some of the light spills on the frame and on the wall round the window.
    {
      vec2 inPane = vec2((fx - r.x) / (r.y - r.x), (fy - r.z) / (r.w - r.z));
      vec2 lampAt = vec2(0.25 + 0.5 * hash12(room + 12.1), 0.55 + 0.35 * hash12(room + 14.9));
      float fall = mix(1.0, 0.32 + 0.95 * exp(-3.2 * dot(inPane - lampAt, inPane - lampAt)), uSoft);
      float curtain = step(0.52, hash12(room + 16.3)) * uSoft * (shop ? 0.0 : 1.0);
      vec3 cloth = mix(vec3(0.95, 0.82, 0.62), vec3(0.85, 0.86, 0.84), hash12(room + 18.7)) * 0.42;
      vec3 soft = mix(lamp, mix(vec3(1.0, 0.8, 0.58), lamp, 0.45), uSoft);          // (less colour between rooms)
      vec3 room3 = mix(interior * fall, cloth * (0.75 + 0.35 * fall), curtain);
      float power = uNight * on * glow * mix(1.25, 0.78, uSoft) * uRoomLight;
      gEmissive = pane * (interior * daylight + room3 * soft * power);
      // the spill: on the frame and mullions, and a hand's breadth of wall round the opening
      float spill = uSoft * (1.0 - far) * valid * power * 0.16;
      gEmissive += soft * spill * (inWin * frame * 0.6 + (1.0 - inWin) * exp(min(edge, 0.0) * 4.5) * step(-0.9, edge));
    }
    // The sun in the glass. Each pane sits a little out of true and float glass is never quite flat, so the
    // mirrored sun is a hot core with a glare around it that wanders from pane to pane as the view moves. The
    // third, wide term is not physics: the true mirror image is only seen from below the sun's own height, and
    // this lets glass facing the sun catch some of its light from the air too.
    {
      vec3 wobble = vec3(vnoise(st * 0.8 + seed * 9.0) - 0.5, vnoise(st * 0.8 + 31.0 + seed * 9.0) - 0.5, 0.0) * 0.035;
      vec3 paneN = normalize(gT * (gNm.x + wobble.x) + gB * (gNm.y + wobble.y) + gN * gNm.z);
      float s = max(dot(reflect(normalize(vWPos - cameraPosition), paneN), uSunDir), 0.0);
      gGlint = pane * uGlintOn * uSunGlint * (pow(s, 1400.0) * 14.0 + pow(s, 90.0) * 0.35 + pow(s, 7.0) * 0.1) * step(0.0, dot(gN, uSunDir));
      // glass: a soft wash of the sun on panes that face it, pane by pane a little different, and the sheen of
      // the sky on glass seen at a glancing angle (by day)
      vec3 toEye = normalize(cameraPosition - vWPos);
      float graze = pow(1.0 - max(dot(toEye, gN), 0.0), 3.0);
      gGlint += pane * uGlass * uSunGlint * 0.035 * max(dot(paneN, uSunDir), 0.0) * (0.6 + 0.8 * hash12(room + 15.7));
      gEmissive += pane * uGlass * (1.0 - uNight) * vec3(0.45, 0.6, 0.82) * (0.015 + 0.22 * graze) * (0.7 + 0.6 * hash12(room + 19.3));
    }
    // Some towers (more of them as uNightBlue rises) are lit in one colour throughout: their lit rooms shine
    // blue or golden yellow — a few cyan or violet — instead of white. (Window light only: thin lines of light
    // along edges and floors shimmer at a distance.)
    {
      float pickA = fract(seed * 31.7), hue = fract(seed * 47.3);
      float accent = tall * step(0.7 - 0.45 * uNightBlue, pickA) * uNight;
      vec3 accentCol = hue < 0.42 ? vec3(0.12, 0.38, 1.0) : hue < 0.76 ? vec3(1.0, 0.72, 0.16) : hue < 0.89 ? vec3(0.1, 0.85, 1.0) : vec3(0.75, 0.3, 1.0);
      gEmissive = mix(gEmissive, accentCol * dot(gEmissive, vec3(0.9)), accent * 0.8);
    }
    // The city in the glass of a tower at night. The mirrored view ray is followed down to street level, where
    // the lights of the city lie as a field of points fixed to the ground (a lamp or a window every 26 m or
    // so, warm or cool), so the reflection slides over the glass as the view moves, as a real one does.
    if (tall > 0.0 && uNight > 0.01 && uCityGlass > 0.0) {
      vec3 paneN = normalize(gT * gNm.x + gB * gNm.y + gN * gNm.z), R = reflect(V, paneN);
      float fresnel = 0.1 + 0.9 * pow(1.0 - max(dot(-V, paneN), 0.0), 4.0);
      vec3 city = vec3(0.0);
      if (R.y < -0.015) {
        float reach = (vWPos.y - 12.0) / -R.y;                      // metres along the ray to street level
        vec2 g = (vWPos.xz + R.xz * reach) / 26.0, cell = floor(g);
        vec2 at = vec2(hash12(cell + 3.1), hash12(cell + 7.7));
        float d = length(fract(g) - at) * 26.0, kind = hash12(cell + 13.0);
        float spot = exp(-d * d / (3.0 + reach * 0.03)) * step(0.3, kind);
        vec3 tintC = kind > 0.8 - 0.3 * uNightBlue ? mix(vec3(0.8, 0.9, 1.0), vec3(0.4, 0.65, 1.0), uNightBlue) : kind > 0.42 && kind < 0.5 ? vec3(1.0, 0.25, 0.2) : vec3(1.0, 0.72, 0.42);
        city = tintC * spot * 5.0 / (1.0 + reach * reach / 4.0e5);
        city += vec3(1.0, 0.75, 0.5) * 0.035 * smoothstep(0.0, 900.0, reach);  // and their haze towards the horizon
      }
      gEmissive += city * fresnel * pane * tall * uNight * uCityGlass * (1.0 - on * 0.9);
    }
    gPane = pane * (1.0 - 0.7 * far) * (1.0 - 0.85 * uNight * on); // (a lit room shows itself, not a reflection)
    // the lintel shades the top of the opening
    diffuseColor.rgb *= 1.0 - 0.35 * inWin * (1.0 - smoothstep(0.0, 0.18, wmax.y - pm.y)) * (1.0 - far);

    // sign band over shopfronts
    if (shop) {
      float sign = box(fy, 0.84, 0.985, wy) * box(fx, 0.03, 0.97, wx) * valid * step(0.25, hash12(room + 57.0));
      vec3 sc = mix(hue(hash12(room + 71.0)), vec3(0.95), 0.35 * step(0.6, hash12(room + 83.0)));
      diffuseColor.rgb = mix(diffuseColor.rgb, sc * 0.75, sign);
      gEmissive += sign * sc * uNight * 1.6;
      gRough = mix(gRough, 0.4, sign);
    }
  }
}
`;

const NO_PHOTO = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
NO_PHOTO.needsUpdate = true;

// One instance per tile that has a wall photo atlas (they share the program); set it with material.userData.photo.
// The real wall, from PLATEAU's aerial photo: too smeared to stand in front of, right from across the city.
const PHOTO_PARS = /* glsl */ `
uniform sampler2D uPhoto;
uniform float uPhotoOn;
uniform vec2 uPhotoRange;
uniform float uPhotoMix;
varying vec2 vPhoto;
varying float vMark; // 1 on a landmark (landmarks.js)
`;
const PHOTO_MAIN = /* glsl */ `
{
  vec3 photo = texture2D(uPhoto, vPhoto).rgb; // (sampled outside the branch: derivatives)
  // (a landmark is known by its own look: it keeps its photograph from close by as well)
  float k = uPhotoOn * uPhotoMix * step(0.0, vPhoto.x) * max(smoothstep(uPhotoRange.x, uPhotoRange.y, distance(cameraPosition, vWPos)), step(0.5, vMark));
  diffuseColor.rgb = mix(diffuseColor.rgb, photo * 1.12, k);
  gRough = mix(gRough, 0.85, k);
  gMetal *= 1.0 - k;
}
`;

// The abstract model: a building is a plain block in one of two colours (shops, offices and mixed blocks in the
// one, homes and public buildings in the other), its windows a faint pattern, its roof a little lighter, with no
// gloss and nothing mirrored in it. By night it glows a little in its own colour — its roofs more than its walls
// and the walls each by the way they face, so that the blocks keep their shape in the dark — and its windows
// still light up. No photographs on the walls. A landmark (aMark; the lattice tower is one as well) keeps its
// look where they are asked to.
const ABSTRACT_PARS = /* glsl */ `
uniform float uDark;
float gPlain = 1.0; // how plain this fragment is (0: a landmark that keeps its look)
`;
// On the pale model the blue of the sky would make every shadow blue: there the light of the sky reaches the
// shade as a neutral grey, a trace warm. (After the lights; `amount` is GLSL.)
export const neutralShade = (amount) => `#include <lights_fragment_end>
{
  float shadeLum = dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
  reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, shadeLum * vec3(1.0, 0.985, 0.96), ${amount});
}`;
const abstractMain = (landmarks) => /* glsl */ `
{
  vec3 photo = texture2D(uPhoto, vPhoto).rgb; // (sampled outside any branch: derivatives)
${landmarks ? `  // a landmark keeps the photograph of its walls, at any distance (its roofs keep theirs: streamer.js)
  float shown = uPhotoOn * step(0.0, vPhoto.x) * step(0.5, vMark);
  diffuseColor.rgb = mix(diffuseColor.rgb, photo * 1.12, shown);
  gRough = mix(gRough, 0.85, shown);
  gMetal *= 1.0 - shown;` : ''}
  float lattice = step(3.5, vBldg.z);
  float plain = ${landmarks ? '1.0 - max(step(0.5, vMark), lattice)' : '1.0'};
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  float sort = mod(vBldg.y, 8.0), shop = step(1.5, sort) * (1.0 - step(3.5, sort) * step(sort, 4.5));
  float roof = step(0.5, abs(gN.y));
  vec3 pale = mix(${v3(ABSTRACT.home)}, ${v3(ABSTRACT.shop)}, shop) * mix(1.0, 1.14, roof) * mix(0.93, 1.0, smoothstep(0.03, 0.22, lum));
  pale *= mix(1.0, 0.22, uDark); // (by night the model is dark: it is seen by its own dim colour, below)
  gPlain = plain;
  diffuseColor.rgb = mix(diffuseColor.rgb, pale, plain);
  gRough = mix(gRough, 0.92, plain);
  gMetal *= 1.0 - plain;
  gNm = normalize(mix(gNm, vec3(0.0, 0.0, 1.0), plain));
  gPane *= 1.0 - plain;
  gGlint *= 1.0 - plain;
  vec3 dusk = mix(${v3(ABSTRACT.night.home)}, ${v3(ABSTRACT.night.shop)}, shop) * mix(0.6 + 0.34 * dot(gN, normalize(vec3(0.5, 0.0, 0.85))), 1.45, roof);
  gEmissive = mix(gEmissive, gEmissive * 0.55 * (1.0 - lattice) + dusk * uDark, plain); // (no floodlights on a plain tower)
}
`;

// Facade relief: the windows are set back into the wall instead of painted on it. The glass lies a hand's
// breadth behind the face of the wall, so that from the side the reveal of the opening comes into view — its sill
// bright, its head dark, its sides by the way they face the sun — and the wall throws a shadow across the
// glass when the sun stands to one side. (No geometry: the ray to the eye is followed to the plane of the glass.)
const RELIEF_PARS = /* glsl */ `
float gJamb = 0.0, gJambShade = 1.0, gReveal = 0.0;
`;
const RELIEF_PM = /* glsl */ `
    {
      float deep = (shop ? 0.1 : cat > 4.5 ? 0.0 : 0.24) * (1.0 - far);
      vec3 toWall = normalize(vWPos - cameraPosition);
      vec2 slide = vec2(dot(toWall, gT), dot(toWall, gB)) / max(-dot(toWall, gN), 0.12) * deep;
      vec2 pg = pm + slide;                                   // where the ray meets the glass
      vec2 below = wmin - pg, above = pg - wmax;              // > 0: beyond the opening on that side
      float out2 = max(max(below.x, above.x), max(below.y, above.y));
      gJamb = inWin * step(0.0, out2) * step(1e-4, deep);
      // which side of the opening is seen: its sill, its head, or a side lit by how it faces the sun
      vec3 side = above.x > max(below.x, max(below.y, above.y)) ? -gT : below.x > max(below.y, above.y) ? gT : below.y > above.y ? gB : -gB;
      gJambShade = 0.5 + 0.75 * max(dot(side, uSunDir), 0.0) + 0.2 * side.y;
      // the shadow of the wall on the glass: the sun's ray to this point of the glass passes the face of the wall
      float sunN = dot(uSunDir, gN);
      vec2 through = pg + vec2(dot(uSunDir, gT), dot(uSunDir, gB)) / max(sunN, 0.08) * deep;
      vec2 edge2 = min(through - wmin, wmax - through);
      gReveal = step(0.0, sunN) * (1.0 - smoothstep(-0.02, 0.03, min(edge2.x, edge2.y))) * inWin * step(1e-4, deep);
      pm = pg;
    }
`;

function facadeMaterial(tex) {
  const m = varies(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 }));
  m.userData.photo = { value: NO_PHOTO }; m.userData.photoOn = { value: 0 };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uLampOn: { value: 0 }, uLampMap: shared.uLampMap, // (no lamp light on buildings; the sampler still needs its texture)
      uPhoto: m.userData.photo, uPhotoOn: m.userData.photoOn, uPhotoRange: shared.uPhotoRange, uPhotoMix: shared.uPhotoMix,
      uNight: shared.uNight, uTime: shared.uTime, uWindowLife: shared.uWindowLife, uCityGlass: shared.uCityGlass, uRoomLight: shared.uRoomLight, uSoft: shared.uSoft, uGlass: shared.uGlass, uNightBlue: shared.uNightBlue, uSunDir: shared.uSunDir, uSunGlint: shared.uSunGlint, uGlintOn: shared.uGlintOn, uWallAlb: { value: tex.wall.albedo }, uWallNor: { value: tex.wall.normal },
      uWallScale: { value: tex.wall.scales }, uWallDetail: { value: tex.wall.details },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aFacade;\nattribute vec4 aBldg;\nattribute vec2 aPhoto;\nattribute float aMark;\nvarying float vMark;\nvarying vec4 vFacade;\nvarying vec4 vBldg;\nvarying vec2 vPhoto;\n${WORLD_VARYINGS_VERT}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvFacade = aFacade;\nvBldg = aBldg;\nvPhoto = aPhoto;\nvMark = aMark;\n${WORLD_VARYINGS_SET}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_PARS + PHOTO_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FACADE_MAIN + PHOTO_MAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + APPLY_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmissive;')
      // (the direct diffuse light is zero in shadow: it tells whether the sun reaches this pane)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular += gGlint * smoothstep(0.0, 0.002, dot(reflectedLight.directDiffuse, vec3(0.333)));')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = 1.0 - 0.95 * gPane;');
    // ---- variants (see `variant`): nothing below is done as things are by default
    const part = (text, a, b) => { if (!text.includes(a)) console.warn('facade: the shader has changed; a variant is not applied'); return text.replace(a, b); };
    if (!variant.windows) shader.fragmentShader = part(shader.fragmentShader, 'cellW = vBldg.w;', 'cellW = 0.0;'); // (no bay width: no windows)
    if (variant.relief) {
      let f = shader.fragmentShader;
      f = part(f, 'float gPane = 0.0;', 'float gPane = 0.0;' + RELIEF_PARS);
      f = part(f, '    vec2 pm = vec2(fx * cellW, fy * floorH);\n', '    vec2 pm = vec2(fx * cellW, fy * floorH);\n' + RELIEF_PM);
      f = part(f, '    float pane = inWin * (1.0 - frame);', '    float pane = inWin * (1.0 - frame) * (1.0 - gJamb);');
      // the reveal is wall, in its own light; the glass in the wall's shadow is darker and mirrors no sun
      f = part(f, '    gRough = mix(gRough, 0.05, pane);', `    gRough = mix(gRough, 0.05, pane);
    diffuseColor.rgb = mix(diffuseColor.rgb, wall * gJambShade, gJamb);
    diffuseColor.rgb *= 1.0 - 0.45 * gReveal * pane;
    gRough = mix(gRough, 0.85, gJamb);`);
      f = part(f, 'float daylight = (1.0 - uNight) * (shop ? 0.3 : cat > 4.5 ? 0.06 : 0.12);', 'float daylight = (1.0 - uNight) * (shop ? 0.3 : cat > 4.5 ? 0.06 : 0.12) * (1.0 - 0.6 * gReveal);');
      f = part(f, '* step(0.0, dot(gN, uSunDir));', '* step(0.0, dot(gN, uSunDir)) * (1.0 - gReveal);');
      shader.fragmentShader = f;
    }
    if (variant.abstract) {
      shader.uniforms.uDark = shared.uDark;
      shader.fragmentShader = part(part(part(shader.fragmentShader, PHOTO_PARS, PHOTO_PARS + ABSTRACT_PARS), PHOTO_MAIN, abstractMain(variant.landmarks)), '#include <lights_fragment_end>', neutralShade('0.92 * gPlain'));
    }
  };
  m.customProgramCacheKey = () => 'facade-v38' + variantKey();
  return m;
}

// ---------------------------------------------------------------- ground
// Terrain and road surfaces: vertex colour x texture detail, layer from the aLayer attribute
// (roads) or fixed (terrain).
const GROUND_PARS = /* glsl */ `
uniform sampler2DArray uGroundAlb;
uniform sampler2DArray uGroundNor;
uniform float uGroundScale[4];
uniform float uFixedLayer;
uniform sampler2D uOrtho;
uniform vec4 uOrthoRect;
uniform float uOrthoOn;
uniform float uTime;
uniform sampler2D uMirror;
uniform mat4 uMirrorMatrix;
uniform float uMirrorOn;
uniform float uDark;
uniform sampler2D uCloudMap;
uniform vec2 uCloudOffset;
uniform float uCloudCover, uCloudBase, uCloudsOn, uCloudFade;
uniform mat4 uWorldToECEF;
uniform vec4 uCloudRect;
varying float vLayer;
varying vec3 vWPos;
varying vec3 vWNrm;
vec3 gT, gB, gN, gNm;
float gRough;
float gMetal = 0.0;
float gWater = 0.0; // 1 on water: written to alpha for the reflection pass, which mirrors the world in it
vec3 gWaveN = vec3(0.0, 1.0, 0.0); // the water's surface normal with its ripples (world space)
${NOISE}
// Where a point of the globe lies in the clouds' weather map (as the cloud pass maps it: three-clouds, clouds.glsl).
vec2 cloudMapUv(vec3 position) {
  vec3 n = normalize(position), f = abs(n), c = n / max(f.x, max(f.y, f.z));
  vec2 m;
  if (all(greaterThan(f.yy, f.xz))) m = c.y > 0.0 ? vec2(-n.x, n.z) : n.xz;
  else if (all(greaterThan(f.xx, f.yz))) m = c.x > 0.0 ? n.yz : vec2(-n.y, n.z);
  else m = c.z > 0.0 ? n.xy : vec2(n.x, -n.y);
  vec2 m2 = m * m;
  float q = dot(m2.xy, vec2(-2.0, 2.0)) - 3.0;
  vec2 uv;
  uv.x = sqrt(1.5 + m2.x - m2.y - 0.5 * sqrt(-24.0 * m2.x + q * q)) * (m.x > 0.0 ? 1.0 : -1.0);
  uv.y = sqrt(6.0 / (3.0 - uv.x * uv.x)) * m.y;
  return uv * 0.5 + 0.5;
}
// How much cloud a ray from p towards dir (upwards) meets: 0 clear sky .. 1 cloud. The same weather map and
// cover as the cloud pass, without its fine shapes: the clouds are where they are in the sky, a little softer.
float cloudAbove(vec3 p, vec3 dir) {
  if (uCloudsOn < 0.5 || dir.y < 0.03) return 0.0;
  vec3 at = p + dir * ((uCloudBase + 320.0 - p.y) / dir.y);
  vec2 weather = texture2D(uCloudMap, cloudMapUv((uWorldToECEF * vec4(at, 1.0)).xyz) * 100.0 + uCloudOffset).rg;
  vec2 beyond = max(uCloudRect.xy - at.xz, at.xz - uCloudRect.zw);
  weather *= 1.0 - smoothstep(0.0, uCloudFade, max(beyond.x, beyond.y));
  // (the cloud pass wears the weather map down with its shape noise: only the thicker parts are cloud)
  float edge = 1.0 - 1.25 * uCloudCover;
  return smoothstep(edge, edge + 0.22, max(weather.r, weather.g)) * smoothstep(0.03, 0.14, dir.y);
}
// Calm harbour water: the height of its ripples (in units of about 3.5 cm) at a point of the ground plan. Long
// low waves from several quarters crossing each other, bent out of line so they never look ruled.
float ripple(vec2 p, float t) {
  p += 3.2 * vec2(vnoise(p * 0.11 + t * 0.03), vnoise(p * 0.11 + 9.0 - t * 0.03)) + 0.9 * vec2(vnoise(p * 0.45 - t * 0.05), vnoise(p * 0.45 + 23.0 + t * 0.05));
  float h = 0.3 * sin(dot(p, vec2(0.92, 0.39)) * 1.1 + t * 1.1);
  h += 0.28 * sin(dot(p, vec2(-0.45, 0.89)) * 1.6 - t * 1.4 + 1.3);
  h += 0.22 * sin(dot(p, vec2(0.2, -0.98)) * 2.7 + t * 1.9 + 4.0);
  h += 0.14 * sin(dot(p, vec2(-0.8, -0.6)) * 4.3 - t * 2.6);
  h += 0.9 * (vnoise(p * 0.8 + vec2(t * 0.25, -t * 0.18)) - 0.5) + 0.45 * (vnoise(p * 1.9 - vec2(t * 0.4, t * 0.3)) - 0.5);
  return h;
}
`;
const GROUND_MAIN = /* glsl */ `
{
  gN = normalize(vWNrm);
  gT = normalize(cross(gN, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
  gB = cross(gT, gN); // +z on flat ground, matching the texture's v axis
  vec3 tint = diffuseColor.rgb;
  float layer = uFixedLayer >= 0.0 ? uFixedLayer : floor(vLayer + 0.5);
  bool water = layer > 3.5;
  layer = min(layer, 3.0);
  float sc = uGroundScale[int(layer)];
  vec2 st = abs(gN.y) > 0.5 ? vWPos.xz : vec2(vWPos.x + vWPos.z, vWPos.y);
  vec3 a = texture(uGroundAlb, vec3(st / sc, layer)).rgb * 2.0;
  // a second, larger sample hides the repeat
  vec3 b = texture(uGroundAlb, vec3(st / (sc * 3.7) + 0.37, layer)).rgb * 2.0;
  float blotch = vnoise(st * 0.045);
  diffuseColor.rgb *= mix(a, b, 0.4) * (0.86 + 0.28 * blotch);
  // (grass: the green of its texture on the green of its tint is an emerald no lawn has — it is brought back to the
  // yellower, greyer green of real turf, lighter and darker in patches)
  if (layer > 1.5 && layer < 2.5 && !water) {
    float turf = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    diffuseColor.rgb = mix(vec3(turf), diffuseColor.rgb, 0.58) * vec3(1.12, 1.0, 0.8) * (0.9 + 0.2 * vnoise(st * 0.011 + 3.7));
  }
  gNm = texture(uGroundNor, vec3(st / sc, layer)).xyz * 2.0 - 1.0;
  gNm = normalize(vec3(gNm.xy * 0.8, gNm.z));
  gRough = layer < 0.5 ? 0.86 - 0.12 * blotch : 0.93;
  // Pavements: the pale concrete pavers of a Japanese footway — oblongs of 60 by 30 cm laid in running bond,
  // each a shade of its own, with dark joints between them (fading out where they are smaller than a pixel).
  if (layer > 0.5 && layer < 1.5 && !water) {
    vec2 q = st / vec2(0.6, 0.3);
    q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 slab = floor(q), f = fract(q), w = fwidth(st) / vec2(0.6, 0.3);
    float fine = 1.0 - smoothstep(0.3, 0.9, max(w.x, w.y));
    vec2 edge = min(f, 1.0 - f) * vec2(0.6, 0.3);                       // metres to the nearest joint
    float joint = 1.0 - smoothstep(0.004, 0.011 + 0.6 * fwidth(st.x), min(edge.x, edge.y));
    float grey = dot(tint, vec3(0.3, 0.59, 0.11));
    vec3 paver = mix(tint, vec3(grey) * vec3(0.99, 1.0, 1.02), 0.65) * 1.12;
    paver *= (0.92 + 0.16 * hash12(slab)) * (0.96 + 0.08 * vnoise(st * 14.0));
    paver = mix(paver, paver * 0.55, joint);
    diffuseColor.rgb = mix(diffuseColor.rgb, paver, fine);
    gNm = normalize(mix(gNm, vec3(0.0, 0.0, 1.0), 0.75 * fine));
    gRough = mix(gRough, 0.88, fine);
  }
  // the open ground (not roads, which have their own surface) shows the aerial photo: car parks, yards, gardens
  if (uFixedLayer >= 0.0 && uOrthoOn > 0.5) {
    vec2 ouv = (vWPos.xz - uOrthoRect.xy) / uOrthoRect.zw;
    if (ouv.x > 0.0 && ouv.x < 1.0 && ouv.y > 0.0 && ouv.y < 1.0) {
      vec3 photo = texture2D(uOrtho, vec2(ouv.x, 1.0 - ouv.y)).rgb;
      diffuseColor.rgb = photo * (0.9 + 0.2 * (mix(a, b, 0.4).g - 0.5));
      gNm = vec3(0.0, 0.0, 1.0);
    }
  }
  if (water) {
    // Water: dark and a little green in itself (what is seen of it is mostly what it mirrors, see the end of the
    // shader); its ripples flatten out with distance, where they are smaller than a pixel.
    diffuseColor.rgb = tint * 0.5;
    // (from far off the water is a calm mirror: ripples left standing there break what it mirrors — the trees on
    // the bank — into green specks)
    float t = uTime, e = 0.12, amp = 0.045 * clamp(170.0 / distance(cameraPosition, vWPos) - 0.12, 0.0, 1.0);
    vec2 slope = vec2(ripple(vWPos.xz + vec2(e, 0.0), t) - ripple(vWPos.xz - vec2(e, 0.0), t), ripple(vWPos.xz + vec2(0.0, e), t) - ripple(vWPos.xz - vec2(0.0, e), t)) * (amp / (2.0 * e));
    gWaveN = normalize(vec3(-slope.x, 1.0, -slope.y));
    gNm = vec3(gWaveN.x, gWaveN.z, gWaveN.y);
    gRough = 0.08;
    gMetal = 0.0;
    gWater = 1.0;
  }
}
`;

// The abstract model: flat friendly colours. Open land is one pale tone and pavements a lighter one; what has a
// colour of its own (grass, courts, clay) keeps it as a pastel; by night they glow a little, in blue. The roads
// (asphalt and its markings: layer 0) stay as they are. Water is a plain matt blue: no waves, nothing mirrored.
const ABSTRACT_GROUND = /* glsl */ `
  if (!water && (uFixedLayer >= 0.0 || layer > 0.5)) {
    float top = max(tint.r, max(tint.g, tint.b)), low = min(tint.r, min(tint.g, tint.b));
    float lum = dot(tint, vec3(0.3, 0.59, 0.11)), sat = (top - low) / max(top, 1e-3);
    vec3 flatC = mix(${v3(ABSTRACT.paving)} * mix(1.0, 0.85, smoothstep(0.15, 0.5, lum)), mix(vec3(1.0), tint / max(top, 1e-3), 0.62) * 0.42, smoothstep(0.12, 0.4, sat));
    if (uFixedLayer >= 0.0) flatC = ${v3(ABSTRACT.land)};
    diffuseColor.rgb = flatC;
    gNm = vec3(0.0, 0.0, 1.0);
    gRough = 0.95;
    flatC *= mix(1.0, 0.3, uDark);
    diffuseColor.rgb = flatC;
    gGlow = ${v3(ABSTRACT.night.land)} * (flatC / 0.36) * uDark;
  }
`;
const ABSTRACT_WATER = /* glsl */ `
    diffuseColor.rgb = ${v3(ABSTRACT.water)};
    gWaveN = vec3(0.0, 1.0, 0.0);
    gNm = vec3(0.0, 0.0, 1.0);
    gRough = 0.95;
    gWater = 0.0;
`;

function groundMaterial(tex, { fixedLayer = -1, ...params } = {}) {
  const m = varies(new THREE.MeshStandardMaterial({ roughness: 0.92, ...params }));
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uGroundAlb: { value: tex.ground.albedo }, uGroundNor: { value: tex.ground.normal },
      uGroundScale: { value: tex.ground.scales }, uFixedLayer: { value: fixedLayer },
      uOrtho: shared.uOrtho, uOrthoRect: shared.uOrthoRect, uOrthoOn: shared.uOrthoOn, uTime: shared.uTime,
      uMirror: shared.uMirror, uMirrorMatrix: shared.uMirrorMatrix, uMirrorOn: shared.uMirrorOn, uDark: shared.uDark,
      uCloudMap: shared.uCloudMap, uCloudOffset: shared.uCloudOffset, uCloudCover: shared.uCloudCover, uCloudBase: shared.uCloudBase, uCloudsOn: shared.uCloudsOn,
      uWorldToECEF: shared.uWorldToECEF, uCloudRect: shared.uCloudRect, uCloudFade: shared.uCloudFade,
      uLampOn: shared.uLampOn, uLampMap: shared.uLampMap, uLampRect: shared.uLampRect,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aLayer;\nvarying float vLayer;\n${WORLD_VARYINGS_VERT}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLayer = aLayer;\n${WORLD_VARYINGS_SET}`)
      // Water lies eight centimetres over the ground it was cut into: from a kilometre off that is less than the
      // depth buffer can tell apart, and the ground would show through in patches. In depth only (not in place),
      // water is brought a little nearer — the farther off, the more.
      .replace('#include <project_vertex>', '#include <project_vertex>\nif (aLayer > 3.5) gl_Position.z -= 0.0008;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GROUND_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_MAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + APPLY_NORMAL)
      // Water mirrors the city: the mirror picture (mirror.js) where there is one, laid on by Fresnel's share and
      // a good deal more (a clear mirror is wanted), its ripples shifting it a little. Without one, alpha 0 leaves
      // the water to the reflections found on the screen (reflections.js).
      .replace('#include <opaque_fragment>', `
        if (gWater > 0.5) {
          // What water shows is what it mirrors, by Fresnel's share: hardly anything looking straight down
          // (the dark water itself), nearly everything at a glancing angle. Every ripple turns its sides to
          // different parts of the sky, which is what draws the ripples: light streaks and dark.
          vec3 wv = normalize(vWPos - cameraPosition), wr = reflect(wv, gWaveN);
          float fresnel = 0.05 + 0.95 * pow(1.0 - max(dot(-wv, gWaveN), 0.0), 4.0);
          vec3 seen = mix(vec3(0.8, 0.86, 0.92), vec3(0.3, 0.48, 0.74), pow(clamp(abs(wr.y), 0.0, 1.0), 0.5)) * (0.03 + 0.97 * (1.0 - uDark)) * 0.9;
          // the clouds in it: white where the sun is on them, grey towards the night
          float cloud = cloudAbove(vWPos, vec3(wr.x, abs(wr.y), wr.z));
          seen = mix(seen, vec3(0.96, 0.97, 0.98) * (0.05 + 0.95 * (1.0 - uDark)), 0.9 * cloud);
          float thing = 0.0;
          if (uMirrorOn > 0.5) {
            // the city in the mirror picture (mirror.js), shifted by the ripples and drawn out lengthwise
            vec4 mc = uMirrorMatrix * vec4(vWPos, 1.0);
            float near = clamp(70.0 / distance(cameraPosition, vWPos), 0.12, 1.6);
            vec2 muv = mc.xy / mc.w * 0.5 + 0.5 + gWaveN.xz * vec2(0.5, 0.9) * near;
            vec4 mirrored = vec4(0.0);
            for (int i = -1; i <= 1; i++) mirrored += texture2D(uMirror, clamp(muv + vec2(0.0, float(i) * 0.004 * near), 0.001, 0.999));
            mirrored /= 3.0;
            thing = smoothstep(0.0, 0.3, mirrored.a + dot(mirrored.rgb, vec3(1.0)));
            seen = mix(seen, mirrored.rgb * vec3(0.88, 0.93, 0.95), thing);
          }
          // (the city is wanted in the water from above as well: more of it than Fresnel would give)
          outgoingLight = mix(outgoingLight, seen, max(fresnel, max(0.42 * thing, 0.3 * cloud * (1.0 - thing))));
        }
        #include <opaque_fragment>
        gl_FragColor.a = 1.0 - gWater * (1.0 - uMirrorOn);`);
    // ---- variants (see `variant`): nothing below is done as things are by default
    if (variant.contact) {
      // contact shadows (contact.js): the ground is darker round the foot of what stands on it
      Object.assign(shader.uniforms, { uContact: shared.uContact, uContactMap: shared.uContactMap, uContactRect: shared.uContactRect });
      shader.fragmentShader = shader.fragmentShader
        .replace('uniform float uDark;', 'uniform float uDark;\nuniform float uContact;\nuniform sampler2D uContactMap;\nuniform vec4 uContactRect;\nfloat gContactLeft = 1.0; // what a contact shadow leaves of the light')
        .replace('roughnessFactor = gRough;', `roughnessFactor = gRough;
  {
    vec2 cuv = vec2(vWPos.x - uContactRect.x, uContactRect.y - vWPos.z) / (2.0 * uContactRect.z) + 0.5;
    vec2 cedge = smoothstep(vec2(0.0), vec2(0.05), cuv) * (1.0 - smoothstep(vec2(0.95), vec2(1.0), cuv));
    float contact = smoothstep(0.0, 0.75, texture2D(uContactMap, cuv).r) * cedge.x * cedge.y * (1.0 - gWater);
    gContactLeft = 1.0 - uContact * contact;
  }`)
        // (a shadow: it takes the light of the sun and the sky away, not the light of a lamp that stands in it — a
        // car's headlamps under a bridge light the road as anywhere. The lamps' light is added after this.)
        .replace('#include <lights_fragment_end>', `reflectedLight.directDiffuse *= gContactLeft; reflectedLight.directSpecular *= gContactLeft;
  #if defined( RE_IndirectDiffuse )
    irradiance *= gContactLeft; iblIrradiance *= gContactLeft;
  #endif
  #include <lights_fragment_end>`);
    }
    if (variant.abstract) {
      const part = (text, a, b) => { if (!text.includes(a)) console.warn('ground: the shader has changed; the abstract model is not applied'); return text.replace(a, b); };
      shader.fragmentShader = part(part(part(part(shader.fragmentShader,
        'float gWater = 0.0;', 'float gWater = 0.0;\nvec3 gGlow = vec3(0.0); // the abstract model by night'),
        '  if (water) {', ABSTRACT_GROUND + '  if (water) {'),
        '    gWater = 1.0;\n', '    gWater = 1.0;\n' + ABSTRACT_WATER),
        '#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gGlow;');
      // (roads keep the sky's blue in their shade a little: asphalt is dark, it hardly shows there)
      shader.fragmentShader = part(shader.fragmentShader, '#include <lights_fragment_end>', neutralShade('0.92'));
    }
  };
  m.customProgramCacheKey = () => 'ground-v19' + (variant.abstract ? 'a' : '') + (variant.contact ? 'c2' : '');
  return m;
}

export function createMaterials(tex) {
  return {
    facade: facadeMaterial(tex),
    facadeFor: () => facadeMaterial(tex), // a tile's own instance, for its wall photos
    // Ground not covered by roads or buildings: private lots, car parks, yards.
    terrain: groundMaterial(tex, { fixedLayer: 3, color: new THREE.Color().setRGB(0.2, 0.2, 0.185) }),
    road: groundMaterial(tex, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    // lane lines and crossings: drawn over the road surface, with a stronger depth bias so they never flicker
    paint: groundMaterial(tex, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8 }),
    // PLATEAU models (bridges, street furniture, trees): plain painted surfaces, seen from both sides
    models: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }),
  };
}
