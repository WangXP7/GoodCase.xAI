// Vehicle materials. One program shades a whole car body: base paint under a clear coat
// (MeshPhysicalMaterial's clearcoat lobe: its own sharp reflection of the sky capture and of every
// real lamp), with what the night has done to it layered on from the load-time noise volumes: road
// film rising from the sills, rust at the seams and arches, chips, cracked paint at dent creases,
// rain beading on what faces up, running in streaks down what does not, and a dry line under
// whatever keeps the rain off. What a vertex is made of comes from its attributes, so trim, rubber,
// chrome, the cabin and the lamps' glow ride in the same draw call as the paint:
//   color   base colour (linear)
//   aMat    x: class (0 paint, 1 plastic / rubber, 2 bright metal, 3 cabin trim, 4 dark glass
//              stand-in for the far levels, 5 bare steel, 6 pebbled glass, 7 tyre rubber, 8 a lamp
//              lens where there is no glass mesh: the middle and far levels), y: emissive scale
//              (radiance = color * y), z: blink (1 = flashes with the hazards), w: on a wheel,
//              which rim the vertex belongs to
//   aFx     x: dirt 0..1, y: rust 0..1, z: damage (cracked paint) 0..1, w: shelter (1 = rain never reaches)
// createCarMats(G) -> { body, tyre, glass, lit, plates(texts), update(t), and the factories the
// brief names: clearcoat, carGlass, tyre, rim, lens, trim, plate }.
import {
  MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, RepeatWrapping, LinearFilter,
  LinearMipmapLinearFilter, SRGBColorSpace, NoColorSpace, Color, Vector2,
} from 'three';

const VERT_PARS = /* glsl */ `
attribute vec4 aMat;
attribute vec4 aFx;
#ifdef CAR_WHEEL
attribute vec2 aWheel; // per instance: x the rim worn (1 alloy, 2 steel, 0 none), y 1 = a flat tyre
#endif
varying vec3 vCarP;
varying vec3 vCarN;
varying vec4 vCarMat;
varying vec4 vCarFx;
`;
const VERT_MAIN = /* glsl */ `
{
  vec4 carW = vec4(transformed, 1.0);
  vec3 carN = objectNormal;
  #ifdef USE_INSTANCING
  carW = instanceMatrix * carW;
  carN = mat3(instanceMatrix) * carN;
  #endif
  vCarP = (modelMatrix * carW).xyz;
  vCarN = normalize(mat3(modelMatrix) * carN);
  vCarMat = aMat;
  vCarFx = aFx;
}
`;
// wheels (one geometry: tyre and both rims, aMat.w naming the rim): drop the rim this instance does
// not wear; a flat tyre's foot spreads under the car's weight and its sidewalls fold out over it
const VERT_WHEEL = /* glsl */ `
#ifdef CAR_WHEEL
if (aMat.w > 0.5 && abs(aMat.w - aWheel.x) > 0.5) transformed = vec3(0.0);
if (aMat.w < 0.5 && aWheel.y > 0.5 && transformed.y < -0.45) {
  float wk = (-0.45 - transformed.y) / 0.55;
  transformed.y = -0.45 - wk * 0.19;
  transformed.z *= 1.0 + 0.28 * sin(min(1.0, wk * 1.4) * 1.5708);
  transformed.x *= 1.0 + 0.1 * wk;
}
#endif
`;
const FRAG_PARS = /* glsl */ `
uniform highp sampler3D tNzA;
uniform highp sampler3D tNzB;
uniform float uTime;
uniform float uRain;
uniform float uWetness;
uniform float uBlink;
uniform vec4 uCarFx;     // added to the per-vertex dirt, rust, damage, shelter
uniform float uCarClass; // used when the geometry carries no aMat (the factories below)
uniform float uGroundY;
varying vec3 vCarP;
varying vec3 vCarN;
varying vec4 vCarMat;
varying vec4 vCarFx;
float cRough = 0.5; float cMetal = 0.0; float cCoat = 0.0; float cCoatRough = 0.04; float cFill = 0.0;
vec2 cBumpBase = vec2(0.0); vec2 cBumpCoat = vec2(0.0);
vec3 carBump(vec3 surfPos, vec3 n, vec2 dH) {
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * n - g);
}
`;
// after <color_fragment>: diffuseColor.rgb is the vertex colour
const FRAG_SURFACE = /* glsl */ `
{
  float cls = floor(vCarMat.x + uCarClass + 0.5);
  vec4 fx = clamp(vCarFx + uCarFx, 0.0, 1.0);
  vec3 wn = normalize(vCarN);
  vec3 p = vCarP;
  float up = smoothstep(0.3, 0.85, wn.y);
  float side = 1.0 - smoothstep(0.3, 0.8, abs(wn.y));
  float hgt = p.y - uGroundY;
  vec4 nA = texture(tNzA, p * 0.31 + 0.13);                 // hand-to-arm sized blotches
  vec4 nB = texture(tNzA, p * 3.7 + 0.61);                  // centimetres
  float streak = texture(tNzB, vec3(p.x * 5.1 + p.z * 3.9, p.y * 0.22, p.z * 5.1 - p.x * 3.9)).a;
  vec4 vor = texture(tNzB, p * 4.6 + nA.yzw * 0.004);       // beads: one cell is about 14 mm
  vec3 base = diffuseColor.rgb;
  bool paint = cls < 0.5;
  bool plastic = cls > 0.5 && cls < 1.5;
  bool bright = cls > 1.5 && cls < 2.5;
  bool cabin = cls > 2.5 && cls < 3.5;
  bool farGlass = cls > 3.5 && cls < 4.5;
  bool steel = cls > 4.5 && cls < 5.5;
  bool pebble = cls > 5.5 && cls < 6.5;
  bool rubber = cls > 6.5 && cls < 7.5;
  bool lens = cls > 7.5;
  float rough = paint ? 0.42 : plastic ? 0.62 : bright ? 0.2 : cabin ? 0.82 : farGlass ? 0.06 : steel ? 0.5 : rubber ? 0.88 : lens ? 0.12 : 0.3;
  float metal = paint ? 0.35 : bright ? 1.0 : steel ? 0.75 : 0.0;
  float coat = paint ? 1.0 : farGlass ? 1.0 : pebble ? 1.0 : lens ? 1.0 : 0.0;
  float coatRough = 0.035;
  vec3 alb = base;
  if (paint) {
    // flake and orange peel under the lacquer; old lacquer chalks in patches
    alb *= 0.96 + 0.08 * nB.x;
    float chalk = smoothstep(0.6, 0.9, nA.x) * fx.y;
    alb = mix(alb, alb * 1.15 + 0.01, chalk * 0.35);
    coatRough += 0.18 * chalk;
    // stone chips: specks through to primer, thickest low down and on what faces forward
    float chip = smoothstep(0.16, 0.06, vor.r) * step(0.86 - 0.2 * fx.y, vor.b) * (1.0 - smoothstep(0.25, 0.8, hgt)) * (1.0 - up);
    alb = mix(alb, vec3(0.2, 0.19, 0.18), chip);
    coat *= 1.0 - chip;
  }
  if (pebble) {
    // toughened glass gone to pebbles: every crumb its own facet
    cBumpCoat += (vor.gb - 0.5) * 0.01;
    alb *= 0.7 + 0.6 * vor.b;
  }
  if (cabin) alb *= 0.22; // inside the shell: what reaches it is what comes through the glass (it has no shadow of its own roof)
  if (!cabin) {
    // rust: creeps out from seams, arch lips and creases (the vertex mask), blisters first
    // (in patches: the blotch noise decides where along a seam it has broken through)
    float rustN = fx.y * (0.15 + 1.0 * nB.x + 0.8 * (nA.x - 0.5));
    float rust = smoothstep(0.5, 0.66, rustN) * (paint || steel || bright ? 1.0 : 0.0);
    float blister = smoothstep(0.36, 0.5, rustN) * (1.0 - rust);
    vec3 rustC = mix(vec3(0.04, 0.014, 0.006), vec3(0.16, 0.058, 0.016), nB.x * nB.x) * (0.6 + 0.7 * nA.y);
    // rust runs hang below it on upright faces
    float run = side * smoothstep(0.5, 0.75, streak) * smoothstep(0.35, 0.6, fx.y * (0.6 + 0.8 * nA.x));
    alb = mix(alb, rustC, rust);
    alb = mix(alb, mix(alb, rustC, 0.6), max(blister * 0.5, run * 0.45));
    rough = mix(rough, 0.9, rust); metal = mix(metal, 0.1, rust); coat *= 1.0 - rust;
    cBumpBase += vec2(dFdx(nB.x), dFdy(nB.x)) * 0.012 * (rust + blister);
    cBumpCoat += vec2(dFdx(nB.x), dFdy(nB.x)) * 0.008 * blister;
    // damage: paint cracked off along a crease, bare steel going brown
    float crack = smoothstep(0.45, 0.6, fx.z * (0.3 + 0.8 * nB.x + 0.6 * nA.y));
    alb = mix(alb, mix(vec3(0.03, 0.03, 0.033), rustC * 0.7, 0.4 + 0.5 * nA.x), crack);
    rough = mix(rough, 0.65, crack); metal = mix(metal, 0.3, crack); coat *= 1.0 - crack;
    // road film: thrown up from the wheels, thick at the sill, washed in streaks, thin on the roof
    float film = fx.x * clamp((1.0 - smoothstep(0.08, 0.5 + 0.45 * nA.x, hgt)) * 1.2 + 0.16 * smoothstep(0.35, 0.8, nA.x) + 0.1 * up * nB.x
      - 0.3 * side * smoothstep(0.5, 0.72, streak), 0.0, 1.0) * (plastic ? 0.6 : lens ? 0.3 : 1.0);
    vec3 dirtC = mix(vec3(0.075, 0.062, 0.048), vec3(0.11, 0.095, 0.075), nB.x);
    alb = mix(alb, dirtC, film * 0.85);
    rough = mix(rough, 0.9, film * 0.8);
    coatRough = mix(coatRough, 0.6, film);
    coat *= 1.0 - 0.75 * film;
    metal *= 1.0 - film;
    // rain: a film on everything it reaches, beads standing on what faces up, rivulets on what does not
    float wet = uWetness * (1.0 - fx.w) * mix(0.3, 1.0, smoothstep(-0.3, 0.6, wn.y));
    if (wet > 0.02) {
      float waxed = paint || farGlass ? 1.0 : 0.45;
      float bead = smoothstep(0.3, 0.1, vor.r) * step(0.3, vor.b) * up * waxed * (1.0 - 0.6 * film);
      float bh = bead * wet;
      float riv = smoothstep(0.6, 0.72, texture(tNzB, vec3(p.x * 9.0 + p.z * 7.0, p.y * 0.45 + uTime * 0.05 * uRain, p.z * 9.0 - p.x * 7.0)).a) * side * wet;
      // (shallow: a bead tilted far from the panel reflects the black sky and reads as a speck of soot)
      float h = bh * 0.0013 + riv * 0.0009;
      cBumpCoat += vec2(dFdx(h), dFdy(h)) * 1.0;
      cBumpBase += vec2(dFdx(h), dFdy(h)) * (1.0 - coat);
      float water = max(max(bh, riv), wet * 0.7 * mix(0.6, 1.0, up));
      coat = max(coat, water * (plastic ? 0.75 : rubber ? 0.3 : 0.95));
      coatRough = mix(coatRough, 0.04, max(max(bh, riv), water * 0.85));
      rough = mix(rough, rough * 0.6, wet * (1.0 - coat));
      alb *= 1.0 - 0.18 * wet * (1.0 - coat * 0.5);
      alb *= 1.0 + 0.4 * bh; // a bead is a lens: it gathers light onto the paint under it
    }
  }
  cFill = bright ? 0.07 : steel ? 0.03 : 0.0; // bright metal mirrors a black sky: give it the lot's glow to reflect
  diffuseColor.rgb = alb;
  cRough = clamp(rough, 0.04, 1.0); cMetal = clamp(metal, 0.0, 1.0);
  cCoat = clamp(coat, 0.0, 1.0); cCoatRough = clamp(coatRough, 0.0, 1.0);
}
`;

function patchBody(mat, u, key) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_WHEEL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SURFACE}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = cRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = cMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = carBump(-vViewPosition, normal, cBumpBase);')
      .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\nclearcoatNormal = carBump(-vViewPosition, clearcoatNormal, cBumpCoat);')
      .replace('#include <lights_physical_fragment>', /* glsl */ `#include <lights_physical_fragment>
  material.clearcoat = cCoat;
  material.clearcoatRoughness = min(1.0, max(cCoatRough, 0.045) + geometryRoughness);
  #ifdef USE_COLOR
  totalEmissiveRadiance += vColor.rgb * vCarMat.y * mix(1.0, uBlink, step(0.5, vCarMat.z));
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.2, 0.22, 0.26) * cFill;
  #endif`);
  };
  mat.customProgramCacheKey = () => `car:${key}`;
  return mat;
}

// ---- generated textures -----------------------------------------------------------------------------
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// height (red channel of a canvas, white = high) -> tangent-space normal map
function normalFromHeight(src, strength, wrapX = true) {
  const w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const g = out.getContext('2d');
  const img = g.createImageData(w, h);
  const at = (x, y) => d[(Math.min(h - 1, Math.max(0, y)) * w + (wrapX ? (x + w) % w : Math.min(w - 1, Math.max(0, x)))) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = 1 / Math.hypot(dx, dy, 1), k = (y * w + x) * 4;
    img.data[k] = Math.round((-dx * l * 0.5 + 0.5) * 255);
    img.data[k + 1] = Math.round((dy * l * 0.5 + 0.5) * 255);
    img.data[k + 2] = Math.round((l * 0.5 + 0.5) * 255);
    img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
}
const tex = (c, srgb, repeat) => {
  const t = new CanvasTexture(c);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = repeat ? RepeatWrapping : t.wrapS; t.wrapT = repeat ? RepeatWrapping : t.wrapT;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 8;
  return t;
};

// Tyre: u runs once round the wheel, v across the section from one bead to the other. The tread
// (blocks, four grooves, sipes) is the middle of v; either side of it the shoulder ribs and the
// sidewall with its raised lettering.
function tyreHeight() {
  const W = 1024, H = 256;
  const c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  const t0 = H * 0.36, t1 = H * 0.64;
  // tread band, proud of the carcass
  g.fillStyle = '#b8b8b8'; g.fillRect(0, t0, W, t1 - t0);
  g.fillStyle = '#303030';
  for (const k of [0.2, 0.42, 0.58, 0.8]) g.fillRect(0, t0 + (t1 - t0) * k - 2.5, W, 5); // circumferential grooves
  const pitch = W / 64;
  for (let i = 0; i < 64; i++) { // lateral grooves, angled, and a sipe in each block
    const x = i * pitch;
    g.save(); g.translate(x, 0);
    g.beginPath(); g.moveTo(0, t0); g.lineTo(5, t0 + (t1 - t0) * 0.2); g.lineTo(3, t0 + (t1 - t0) * 0.2); g.lineTo(-2, t0); g.fill();
    g.beginPath(); g.moveTo(0, t1); g.lineTo(5, t1 - (t1 - t0) * 0.2); g.lineTo(3, t1 - (t1 - t0) * 0.2); g.lineTo(-2, t1); g.fill();
    g.fillRect(pitch * 0.5, t0 + (t1 - t0) * 0.24, 1.5, (t1 - t0) * 0.16);
    g.fillRect(pitch * 0.5, t0 + (t1 - t0) * 0.6, 1.5, (t1 - t0) * 0.16);
    g.fillRect(pitch * 0.2, t0 + (t1 - t0) * 0.44, 2, (t1 - t0) * 0.12);
    g.restore();
  }
  // shoulders: short ribs
  for (let i = 0; i < 128; i++) { g.fillRect(i * (W / 128), t0 - 12, 3, 12); g.fillRect(i * (W / 128) + 4, t1, 3, 12); }
  // sidewalls: a rim-protector ridge, two fine rings, the lettering
  for (const [y0, dir] of [[t0 - 14, -1], [t1 + 14, 1]]) {
    g.fillStyle = '#909090'; g.fillRect(0, dir < 0 ? y0 - 62 : y0 + 56, W, 6);
    g.fillStyle = '#8c8c8c'; g.fillRect(0, dir < 0 ? y0 - 10 : y0 + 8, W, 2); g.fillRect(0, dir < 0 ? y0 - 74 : y0 + 72, W, 2);
    g.fillStyle = '#b4b4b4';
    g.font = 'bold 11px "Arial Narrow", Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    const ym = dir < 0 ? y0 - 30 : y0 + 30;
    for (let k = 0; k < 2; k++) {
      g.save(); g.translate(W * (0.25 + 0.5 * k), ym); if (dir > 0) g.scale(1, -1);
      g.fillText('KESTREL  ALL-ROAD', 0, 0); g.restore();
      g.save(); g.translate(W * (0.5 * k), ym); if (dir > 0) g.scale(1, -1);
      g.font = 'bold 8px "Arial Narrow", Arial, sans-serif';
      g.fillText('205/65 R15  94H', 0, 0); g.restore();
      g.font = 'bold 11px "Arial Narrow", Arial, sans-serif';
    }
  }
  return c;
}

// Number plates: an invented territory, embossed characters. One sheet of eight.
const PLATE_W = 512, PLATE_H = 256;
function plateSheet(texts) {
  const cols = 2, rows = Math.max(1, Math.ceil(texts.length / cols));
  const col = canvas(PLATE_W * cols, PLATE_H * rows), hgt = canvas(PLATE_W * cols, PLATE_H * rows);
  const g = col.getContext('2d'), hg = hgt.getContext('2d');
  hg.fillStyle = '#606060'; hg.fillRect(0, 0, hgt.width, hgt.height);
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
  texts.forEach((t, i) => {
    const x = (i % cols) * PLATE_W, y = Math.floor(i / cols) * PLATE_H;
    // face: cream, a dusk band across the top, pines along the foot
    g.fillStyle = '#e9e4d2'; g.fillRect(x, y, PLATE_W, PLATE_H);
    const grad = g.createLinearGradient(0, y, 0, y + 78);
    grad.addColorStop(0, '#1d4a52'); grad.addColorStop(1, '#e9e4d2');
    g.fillStyle = grad; g.fillRect(x, y, PLATE_W, 78);
    g.fillStyle = '#2f5a4a';
    for (let k = 0; k < 26; k++) { const px = x + 10 + k * 19.5, ph = 16 + ((k * 37) % 13); g.beginPath(); g.moveTo(px, y + PLATE_H - 14); g.lineTo(px + 8, y + PLATE_H - 14 - ph); g.lineTo(px + 16, y + PLATE_H - 14); g.fill(); }
    g.fillStyle = '#f3efe2'; g.font = 'bold 34px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CASCADE TERRITORY', x + PLATE_W / 2, y + 32);
    g.fillStyle = '#16303a'; g.font = 'bold 132px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    g.fillText(t, x + PLATE_W / 2, y + 138, PLATE_W - 60);
    g.fillStyle = '#2f5a4a'; g.font = 'bold 22px Arial, sans-serif';
    g.fillText('THE  LONG  ROAD  HOME', x + PLATE_W / 2, y + PLATE_H - 26);
    g.strokeStyle = '#16303a'; g.lineWidth = 6; rr(g, x + 9, y + 9, PLATE_W - 18, PLATE_H - 18, 22); g.stroke();
    for (const [bx, by] of [[40, 28], [PLATE_W - 40, 28], [40, PLATE_H - 28], [PLATE_W - 40, PLATE_H - 28]]) { g.fillStyle = '#6a6a66'; g.beginPath(); g.arc(x + bx, y + by, 9, 0, 6.3); g.fill(); }
    // height: the pressed rim, the characters, the bolt heads
    hg.strokeStyle = '#c0c0c0'; hg.lineWidth = 8; rr(hg, x + 9, y + 9, PLATE_W - 18, PLATE_H - 18, 22); hg.stroke();
    hg.fillStyle = '#e8e8e8'; hg.font = 'bold 132px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'; hg.textAlign = 'center'; hg.textBaseline = 'middle';
    hg.fillText(t, x + PLATE_W / 2, y + 138, PLATE_W - 60);
    hg.fillStyle = '#b0b0b0'; hg.font = 'bold 34px "Arial Narrow", Arial, sans-serif';
    hg.fillText('CASCADE TERRITORY', x + PLATE_W / 2, y + 32);
    for (const [bx, by] of [[40, 28], [PLATE_W - 40, 28], [40, PLATE_H - 28], [PLATE_W - 40, PLATE_H - 28]]) { hg.fillStyle = '#ffffff'; hg.beginPath(); hg.arc(x + bx, y + by, 9, 0, 6.3); hg.fill(); }
  });
  // soften the height so the emboss has a shoulder, not a cliff
  const soft = canvas(hgt.width, hgt.height), sg = soft.getContext('2d');
  sg.filter = 'blur(1.6px)'; sg.drawImage(hgt, 0, 0);
  // road dirt on the face
  texts.forEach((t, i) => {
    const x = (i % cols) * PLATE_W, y = Math.floor(i / cols) * PLATE_H;
    const d = g.createLinearGradient(0, y, 0, y + PLATE_H);
    d.addColorStop(0, 'rgba(40,32,22,0.05)'); d.addColorStop(1, `rgba(40,32,22,${0.3 + 0.12 * (i % 3)})`);
    g.fillStyle = d; g.fillRect(x, y, PLATE_W, PLATE_H);
  });
  const uv = (i) => { const cx = i % cols, cy = Math.floor(i / cols); return [cx / cols, 1 - (cy + 1) / rows, (cx + 1) / cols, 1 - cy / rows]; };
  return { color: col, normal: normalFromHeight(soft, 5, false), uv };
}

export function createCarMats(G) {
  const noise = G.mats && G.mats.noise;
  const shared = (G.mats && G.mats.shared) || { uTime: { value: 0 }, uRain: { value: 0.7 }, uWetness: { value: 0.85 } };
  const blink = { value: 1 };
  const uniformsFor = (o = {}) => ({
    tNzA: { value: noise ? noise.tNzA : null }, tNzB: { value: noise ? noise.tNzB : null },
    uTime: shared.uTime, uRain: shared.uRain, uWetness: shared.uWetness, uBlink: blink,
    uCarFx: { value: [o.dirt ?? 0, o.rust ?? 0, o.chips ?? 0, o.shelter ?? 0] },
    uCarClass: { value: o.cls ?? 0 }, uGroundY: { value: o.groundY ?? 0 },
  });
  const makeBody = (o = {}, params = {}, key = 'body') => {
    const mat = new MeshPhysicalMaterial({ color: o.color ?? 0xffffff, vertexColors: o.vertexColors ?? true, roughness: 0.5, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, ...params });
    mat.carUniforms = uniformsFor(o);
    mat.name = `car:${key}`;
    return patchBody(mat, mat.carUniforms, key);
  };

  // the whole car: paint, trim, cabin
  const body = makeBody();
  // tyres: the same program with the tread and sidewall normal bake
  let tyreMat = null;
  const tyre = () => {
    if (!tyreMat) {
      const n = tex(normalFromHeight(tyreHeight(), 2.4, true), false, true);
      tyreMat = makeBody({}, { normalMap: n, normalScale: new Vector2(1.6, 1.6) }, 'tyre');
      tyreMat.defines.CAR_WHEEL = '';
    }
    return tyreMat;
  };

  // glass: the level's rain glass (running drops, beads, grime) with the tint, the opacity and the
  // grime taken per vertex, so windows, lamp lenses and a wiped windscreen share one draw:
  //   color: tint, aMat.x: opacity, aMat.y: grime scale, aMat.zw: position on the windscreen in
  //   metres from the wiper spindles' midpoint (z > -50 marks a screen with wiped arcs)
  const glassBase = G.mats.glass({ tint: 0x0a1014, opacity: 0.3, dirt: 0.6, mist: 0.14 });
  {
    const inner = glassBase.onBeforeCompile;
    glassBase.onBeforeCompile = (shader, renderer) => {
      inner(shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aMat;\nattribute vec4 aFx;\nattribute vec3 color;\nvarying vec4 vGlA;\nvarying vec4 vGlFx;\nvarying vec3 vGlTint;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlA = aMat;\nvGlFx = aFx;\nvGlTint = color;');
      const f = shader.fragmentShader;
      const need = ['s.grad = T * dr.z + B * dr.w;', 'uGlTint * 0.5', 'uGlDirt * clamp(', 'clamp(uGlOpacity + film * 0.8', 'float mist = uGlMist *', '- 0.3 * smoothstep(0.5, 0.8, washed) * w'];
      for (const s of need) if (!f.includes(s)) console.error(`[carPaint] glass patch: "${s}" not found`);
      shader.fragmentShader = f
        .replace('#include <common>', '#include <common>\nvarying vec4 vGlA;\nvarying vec4 vGlFx;\nvarying vec3 vGlTint;\nfloat gWeb = 0.0;')
        .replace('uGlTint * 0.5', 'vGlTint')
        .replace('uGlDirt * clamp(', 'uGlDirt * vGlA.y * carWipe(vGlA.zw) * clamp(')
        .replace('clamp(uGlOpacity + film * 0.8', 'clamp(vGlA.x + gWeb * 0.7 + film * 0.8')
        // a screen that took a blow (aFx: where on it, in the wiped arcs' coordinates; z > 0.5 marks it)
        .replace('s.grad = T * dr.z + B * dr.w;', /* glsl */ `s.grad = T * dr.z + B * dr.w;
  if (vGlFx.z > 0.5) {
    vec2 wTilt;
    float wb = carWeb(vGlA.zw - vGlFx.xy, wTilt);
    s.albedo = mix(s.albedo, vec3(0.42, 0.48, 0.46), wb);
    s.rough = mix(s.rough, 0.6, wb);
    s.grad += T * wTilt.x + B * wTilt.y;
    gWeb = wb;
  }`)
        // (misted in patches: an even mist turns the drops' tracks into a grain across the whole pane)
        .replace('float mist = uGlMist *', 'float mist = uGlMist * carWipe(vGlA.zw) * (vGlA.z > -50.0 ? 3.0 : 1.0) * mix(0.25, 1.0, smoothstep(0.38, 0.62, dn)) * clamp(vGlA.y * 2.5, 0.0, 1.0) *')
        // (the fine washed streaks read as wood grain on a pane this size: mostly gone)
        .replace('- 0.3 * smoothstep(0.5, 0.8, washed) * w', '- 0.1 * smoothstep(0.4, 0.9, washed) * w')
        .replace('void surfaceMain(inout Surf s) {', /* glsl */ `
// the two arcs the wipers keep clean: 1 outside them, a little grime left inside
float carWipe(vec2 q) {
  if (q.x < -50.0) return 1.0;
  float w = 1.0;
  for (int i = 0; i < 2; i++) {
    vec2 c = q - vec2(i == 0 ? 0.34 : -0.32, 0.0);
    float r = length(c), a = atan(c.y, c.x);
    float lim = i == 0 ? 0.56 : 0.5;
    float arc = smoothstep(lim + 0.012, lim - 0.012, r) * smoothstep(0.1, 0.125, r) * smoothstep(0.1, 0.16, a) * smoothstep(3.04, 2.98, a);
    w = min(w, 1.0 - 0.86 * arc);
  }
  return w;
}
// A laminated screen that took a blow: cracks running out from the hit and wandering as they go,
// shorter ones bridging between them in rings, the glass crazed milky at the centre and whitened in
// a soft margin along every crack. Each piece between cracks lies at its own small tilt (wTilt, a
// slope for the reflection), so lamps break across the web the way they do through real shattered
// laminate. q: metres from the hit, in the plane of the glass. Returns how white the glass is there.
float carWeb(vec2 q, out vec2 wTilt) {
  float r = length(q);
  const float n = 13.0;
  float a = (atan(q.y, q.x) / 6.2832 + 0.5) * n;
  float k = floor(a);
  float best = 1e3, sector = k;
  for (int i = 0; i < 2; i++) {
    float b = k + float(i);
    vec3 h = sHash3(ivec3(int(mod(b, n)), 7, 3));
    float jit = (h.x - 0.5) * 0.55 + 0.1 * sin(r * (9.0 + 8.0 * h.y) + h.z * 6.28);
    float d = (a - (b + jit)) * (6.2832 / n) * r;
    float len = mix(0.2, 0.9, h.y);
    if (i == 0 && d < 0.0) sector = k - 1.0;
    best = min(best, abs(d) + 1e3 * smoothstep(len * 0.85, len, r));
  }
  int si = int(mod(sector + n, n));
  float lg = log(max(r, 0.004) / 0.022) / 0.5 + sHash3(ivec3(si, 5, 9)).x;
  float ri = floor(lg + 0.5);
  float ring = step(0.3, sHash3(ivec3(si, int(ri) + 20, 4)).x) * (1.0 - smoothstep(0.26, 0.42, r));
  best = min(best, abs(lg - ri) * 0.5 * r + 1e3 * (1.0 - ring));
  vec3 hc = sHash3(ivec3(si, int(floor(lg)) + 40, 6));
  float aa = 0.0005 + fwidth(r) * 0.8;
  float line = 1.0 - smoothstep(aa * 0.3, aa * 1.7, best);
  float halo = exp(-best / 0.004);
  float craze = exp(-r * r / 0.0035);
  wTilt = (hc.yz - 0.5) * 0.16 * (1.0 - smoothstep(0.3, 0.6, r)) * (1.0 - line);
  return clamp(line * 0.34 + halo * 0.16 + craze * 0.7, 0.0, 1.0);
}
void surfaceMain(inout Surf s) {`);
    };
    glassBase.customProgramCacheKey = () => 'surf:glass:car';
    glassBase.name = 'car:glass';
  }

  // what gives off light: bulbs, lit reflectors, the dome lamp, the light bar. color is radiance;
  // aMat.z = 1 flashes with the hazards.
  const lit = new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  lit.onBeforeCompile = (shader) => {
    shader.uniforms.uBlink = blink;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMat;\nuniform float uBlink;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= mix(1.0, uBlink, step(0.5, aMat.z));');
  };
  lit.customProgramCacheKey = () => 'car:lit';
  lit.name = 'car:lit';

  const sheets = new Map();
  const plates = (texts) => {
    const key = texts.join('|');
    if (!sheets.has(key)) {
      const s = plateSheet(texts);
      const mat = new MeshStandardMaterial({ map: tex(s.color, true), normalMap: tex(s.normal, false), normalScale: new Vector2(1.4, 1.4), roughness: 0.42, metalness: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      mat.name = 'car:plate';
      sheets.set(key, { material: mat, uv: s.uv });
    }
    return sheets.get(key);
  };

  const _c = new Color();
  return {
    body, glass: glassBase, lit, plates, blink,
    tyreMaterial: tyre,
    // hazards: on for a little under half of each 1.1 s cycle (the level's flashers keep the same time)
    update(t) { blink.value = (t % 1.1) < 0.48 ? 1 : 0; },
    // ---- the factory functions: stand-alone materials of the same programs, for a mesh
    // that carries no vertex attributes (a prop another task builds from car parts)
    clearcoat: (o = {}) => makeBody({ color: o.color, vertexColors: false, dirt: o.dirt, rust: o.rust, chips: o.chips, cls: 0 }, o.flake !== undefined ? { metalness: o.flake } : {}, 'body:u'),
    carGlass: () => glassBase,
    tyre,
    rim: (o = {}) => makeBody({ color: o.finish === 'steel' ? 0x6f7477 : 0xc9ccd0, vertexColors: false, cls: 2 }, {}, 'body:u'),
    lens: (o = {}) => { const m = new MeshBasicMaterial({ color: _c.set(o.color ?? 0xff2010).multiplyScalar(o.lit ? 6 : 0.05).clone(), toneMapped: false, fog: false }); m.name = 'car:lens'; return m; },
    trim: () => makeBody({ color: 0x101112, vertexColors: false, cls: 1 }, {}, 'body:u'),
    plate: (text) => plates([text]).material,
  };
}
