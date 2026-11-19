// OWNER: render agent. Matte cardstock material factory (docs/ARCHITECTURE.md, render/materials.js).
//
// paper(opts) returns a CACHED MeshLambertMaterial (purely diffuse: no specular, no sheen) extended with:
//   - fibre: tooth + mottling + normal perturbation from ONE packed fibre texture (procedural fallback,
//     or repacked from the textures agent's card maps), mapped in object space (sticks to a folding flap)
//     or world space (opts.fibre = 'world', for the endless page);
//   - paper lighting: wrap diffuse, warm back-lit translucency of thin card, wide wrapped lantern pool;
//   - PCSS soft shadows of the key light (blocker search + receiver-plane depth bias + Vogel PCF) with
//     crisp contact and widening penumbra, warm light leak in the shadow. The PCSS itself is patched into
//     three's shadow chunk GLOBALLY, so non-paper lit materials (e.g. the book page) get it too;
//   - per-sheet tone variation;
//   - vertex colours: always enabled; a mesh WITHOUT a colour attribute renders as if it were white.
// Works with Mesh, InstancedMesh and BatchedMesh (one shared material; only stock chunks are extended).
import { setColorCached } from './colorcache.js';
import * as THREE from 'three';
import { CONFIG, qualitySettings } from '../core/config.js';
import { mulberry32 } from '../core/rng.js';

/** Uniforms shared by EVERY paper material. lights.js and post.js write into these each frame. */
export const paperUniforms = {
  uPaperFibreTex: { value: null },
  uPaperFibre: { value: new THREE.Vector4(1 / 2.6, 0.2, 0.1, 0.6) }, // 1/scale, tooth, cloud, normal strength
  uPaperFibre2: { value: new THREE.Vector4(0.55, 3.73, 0, 0) }, // fine octave weight, fine octave frequency
  uPaperLight: { value: new THREE.Vector4(0.16, 0.3, 0.55, 0.05) }, // wrap, translucency, point-light wrap, tone variation
  uPaperTransTint: { value: new THREE.Color('#ffb070') },
  uPaperShadowLeak: { value: new THREE.Color('#2a1206') },
  // Art atlas (decision O10): sampled with uv1 on faces whose uv1.x > 0 (kit.art_card). x = alpha floor (1 = the
  // whole art face takes the atlas colour: the PNG is colour-bled outside the silhouettes and the card is already
  // cut to the outline; 0 = straight alpha over the vertex colour), y = 1 when an atlas is bound, z = strength.
  uPaperArtTex: { value: null },
  uPaperArt: { value: new THREE.Vector4(1, 0, 1, 0.4) },
  // Look pass. Hero cut-out: stand-up paper between the camera and the traveller is dithered away inside a cylinder
  // around the camera -> traveller line (lights.js writes these). xyz = traveller chest (world), w = radius;
  // uPaperHero2 = ( feet height, strength 0..1, share of pixels kept in the core, clear margin in front of him ).
  uPaperHero: { value: new THREE.Vector4(0, 0, 0, 0.45) },
  uPaperHero2: { value: new THREE.Vector4(0, 0, 0.25, 0.25) },
  // Warm ground pools of the lantern / lamp posts (life.js writes them; night only). xyz = lamp, w = strength.
  uPaperPool: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4(0, 0, 0, 0)) },
  uPaperPoolCol: { value: new THREE.Vector4(1, 0.78, 0.47, 0) }, // rgb (linear, pre-multiplied), w = radius (0 = off)
  // Gold pass. Pale die-cut rim from the art alpha: every printed card gets a cream band of even width along its
  // cut (outer silhouette and inner holes). x = world width, y / z = min / max width in screen px, w = strength.
  uPaperLightB: { value: new THREE.Vector4(1.2, 0, 0, 0) }, // x = weight of the broad mottle relative to the cloud
  uPaperRim: { value: new THREE.Vector4(0.016, 1.5, 3.4, 0.9) },
  uPaperRimCol: { value: new THREE.Vector4(1, 0.93, 0.78, 0.3) }, // rgb = rim albedo (linear), w = width wobble
  uPaperRim2: { value: new THREE.Vector4(0.5, 0, 0, 0) }, // x = coverage cut-off (0.5 without MSAA, ~0 with alpha-to-coverage)
};

// ---------------------------------------------------------------------------------------------
// Procedural fibre texture (fallback when the textures agent's maps are missing). Deterministic.
// Packed RGBA: RG = tangent-space normal xy, B = tooth (0.5-centred albedo detail), A = cloud/mottling.
// ---------------------------------------------------------------------------------------------
function smooth(t) { return t * t * (3 - 2 * t); }

function addValueNoise(out, N, cells, amp, rng) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng() - 0.5;
  for (let y = 0; y < N; y++) {
    const fy = (y / N) * cells;
    const iy = Math.floor(fy);
    const ty = smooth(fy - iy);
    const y0 = (iy % cells) * cells;
    const y1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells;
      const ix = Math.floor(fx);
      const tx = smooth(fx - ix);
      const x0 = ix % cells;
      const x1 = (ix + 1) % cells;
      const a = g[y0 + x0] + (g[y0 + x1] - g[y0 + x0]) * tx;
      const b = g[y1 + x0] + (g[y1 + x1] - g[y1 + x0]) * tx;
      out[y * N + x] += amp * (a + (b - a) * ty);
    }
  }
}

/** Tileable Worley F1 "pebbles": the embossed tooth of heavy handmade paper. */
function addPebbles(out, N, cells, amp, rng) {
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  const ph = new Float32Array(cells * cells);
  for (let i = 0; i < px.length; i++) { px[i] = rng(); py[i] = rng(); ph[i] = 0.6 + rng() * 0.4; }
  for (let y = 0; y < N; y++) {
    const fy = (y / N) * cells;
    const cy = Math.floor(fy);
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells;
      const cx = Math.floor(fx);
      let best = 9;
      let bh = 1;
      for (let j = -1; j <= 1; j++) {
        const yy = (cy + j + cells) % cells;
        for (let i = -1; i <= 1; i++) {
          const xx = (cx + i + cells) % cells;
          const k = yy * cells + xx;
          const dx = cx + i + px[k] - fx;
          const dy = cy + j + py[k] - fy;
          const d = dx * dx + dy * dy;
          if (d < best) { best = d; bh = ph[k]; }
        }
      }
      const d = Math.min(1, Math.sqrt(best) / 0.75);
      out[y * N + x] += amp * ((1 - d * d) * bh - 0.45);
    }
  }
}

function addFibres(out, N, count, amp, rng) {
  for (let f = 0; f < count; f++) {
    let x = rng() * N;
    let y = rng() * N;
    let a = rng() * Math.PI * 2;
    const len = 10 + rng() * 46;
    const curve = (rng() - 0.5) * 0.12;
    const s = (rng() < 0.72 ? 1 : -0.8) * amp * (0.5 + rng() * 0.7);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const w = s * Math.sin(Math.PI * t);
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const x0 = ((ix % N) + N) % N;
      const y0 = ((iy % N) + N) % N;
      const x1 = (x0 + 1) % N;
      const y1 = (y0 + 1) % N;
      out[y0 * N + x0] += w * (1 - fx) * (1 - fy);
      out[y0 * N + x1] += w * fx * (1 - fy);
      out[y1 * N + x0] += w * (1 - fx) * fy;
      out[y1 * N + x1] += w * fx * fy;
      x += Math.cos(a);
      y += Math.sin(a);
      a += curve;
    }
  }
}

function normalise(a) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m += a[i];
  m /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) { a[i] -= m; v += a[i] * a[i]; }
  const s = 1 / Math.sqrt(v / a.length + 1e-12);
  for (let i = 0; i < a.length; i++) a[i] *= s;
  return a;
}

function makeCloud(N, rng) {
  const c = new Float32Array(N * N);
  addValueNoise(c, N, 9, 1.0, rng);
  addValueNoise(c, N, 17, 0.7, rng);
  addValueNoise(c, N, 36, 0.35, rng);
  return normalise(c);
}

function packToTexture(N, height, tooth, cloud, normalStrength, anisotropy) {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    const yu = ((y + N - 1) % N) * N;
    const yd = ((y + 1) % N) * N;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = (height[y * N + ((x + 1) % N)] - height[y * N + ((x + N - 1) % N)]) * normalStrength;
      const dy = (height[yd + x] - height[yu + x]) * normalStrength;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      data[i * 4] = Math.max(0, Math.min(255, Math.round((-dx * il * 0.5 + 0.5) * 255)));
      data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round((-dy * il * 0.5 + 0.5) * 255)));
      data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round((0.5 + tooth[i] * 0.16) * 255)));
      data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((0.5 + cloud[i] * 0.16) * 255)));
    }
  }
  return finishTexture(new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType), anisotropy);
}

function finishTexture(tex, anisotropy) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.name = 'paper-fibre-packed';
  tex.needsUpdate = true;
  return tex;
}

function makeProceduralFibre(N, anisotropy) {
  const rng = mulberry32(0x51f1b2e);
  const h = new Float32Array(N * N);
  addPebbles(h, N, 96, 0.8, rng);
  addPebbles(h, N, 190, 0.5, rng);
  addValueNoise(h, N, 170, 0.5, rng);
  addValueNoise(h, N, 256, 0.4, rng);
  addFibres(h, N, 2600, 0.7, rng);
  normalise(h);
  const cloud = makeCloud(N, rng);
  return packToTexture(N, h, h, cloud, 0.24, anisotropy);
}

/** Repack the textures agent's grey albedo-detail + tangent normal map into the packed layout. Returns null on any failure. */
function packFromAssets(detailTex, normalTex, anisotropy) {
  try {
    const dImg = detailTex && detailTex.image;
    const nImg = normalTex && normalTex.image;
    if (!dImg || !nImg || !dImg.width || !nImg.width) return null;
    const N = Math.min(1024, dImg.width);
    const read = (img) => {
      const c = document.createElement('canvas');
      c.width = c.height = N;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, N, N);
      return ctx.getImageData(0, 0, N, N).data;
    };
    const d = read(dImg);
    const n = read(nImg);
    const cloud = makeCloud(N, mulberry32(0x7a11c3));
    const data = new Uint8Array(N * N * 4);
    let mean = 0;
    for (let i = 0; i < N * N; i++) mean += d[i * 4];
    mean /= N * N;
    // canvas rows are top-down while this DataTexture is uploaded bottom-up (flipY = false): the image is
    // mirrored in v, so the green (v) component of the tangent normal is mirrored with it.
    const flipG = normalTex.flipY !== false;
    for (let i = 0; i < N * N; i++) {
      data[i * 4] = n[i * 4];
      data[i * 4 + 1] = flipG ? 255 - n[i * 4 + 1] : n[i * 4 + 1];
      data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(d[i * 4] - mean + 127.5)));
      data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((0.5 + cloud[i] * 0.16) * 255)));
    }
    return finishTexture(new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType), anisotropy);
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Shader extension
// ---------------------------------------------------------------------------------------------
const VERT_PARS = /* glsl */ `
varying vec3 vPaperPos;
varying vec3 vPaperNrm;
varying float vPaperTone;
// art atlas UVs: three only declares uv1 when one of its own maps uses channel 1. A geometry WITHOUT the attribute
// reads the constant (0,0) and a non-art face carries (-1,-1): both fail the x > 0 gate in the fragment shader.
#ifndef USE_UV1
attribute vec2 uv1;
#endif
varying vec2 vPaperArtUv;
varying vec3 vPaperW;
float paperHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float paperVNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(paperHash(i), paperHash(i + vec2(1.0, 0.0)), f.x), mix(paperHash(i + vec2(0.0, 1.0)), paperHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// A mesh without a colour attribute reads the constant (0,0,0): treat that as "no vertex colour" (white).
vec3 paperVC(vec3 c) { return dot(c, vec3(1.0)) <= 0.0 ? vec3(1.0) : c; }
vec4 paperVC(vec4 c) { return dot(c.rgb, vec3(1.0)) <= 0.0 ? vec4(1.0) : c; }
`;

const VERT_MAIN = /* glsl */ `
{
  mat4 paperM = modelMatrix;
  float paperId = 0.0;
  #ifdef USE_BATCHING
    paperM = paperM * batchingMatrix;
    paperId = getIndirectIndex( gl_DrawID );
  #endif
  #ifdef USE_INSTANCING
    paperM = paperM * instanceMatrix;
    paperId = float( gl_InstanceID );
  #endif
  #ifdef PAPER_FIBRE_WORLD
    vPaperPos = ( paperM * vec4( transformed, 1.0 ) ).xyz;
    vPaperNrm = normalize( mat3( paperM ) * objectNormal );
  #else
    vPaperPos = transformed * length( paperM[0].xyz );
    vPaperNrm = objectNormal;
  #endif
  // per-sheet tone: smooth in the sheet's origin (so a moving sheet never flickers) + a hash of the instance id
  vec3 paperO = paperM[3].xyz;
  float paperTn = paperVNoise( paperO.xz * 1.13 + paperO.y * 2.71 );
  paperTn = fract( paperTn + paperHash( vec2( paperId, 3.7 ) ) * step( 0.5, paperId ) );
  vPaperTone = paperTn * 2.0 - 1.0;
  vPaperArtUv = uv1;
  vPaperW = ( paperM * vec4( transformed, 1.0 ) ).xyz;
}
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D uPaperFibreTex;
uniform vec4 uPaperFibre;
uniform vec4 uPaperFibre2;
uniform vec4 uPaperLight;
uniform vec3 uPaperTransTint;
uniform vec3 uPaperShadowLeak;
varying vec3 vPaperPos;
varying vec3 vPaperNrm;
varying float vPaperTone;
varying vec2 vPaperArtUv;
uniform sampler2D uPaperArtTex;
uniform vec4 uPaperArt;
uniform vec4 uPaperHero;
uniform vec4 uPaperHero2;
uniform vec4 uPaperPool[6];
uniform vec4 uPaperPoolCol;
uniform vec4 uPaperRim;
uniform vec4 uPaperLightB;
uniform vec4 uPaperRimCol;
uniform vec4 uPaperRim2;
varying vec3 vPaperW;
float gPaperCov = 1.0;
float paperHashF( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float paperVNoiseF( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( paperHashF( i ), paperHashF( i + vec2( 1.0, 0.0 ) ), f.x ), mix( paperHashF( i + vec2( 0.0, 1.0 ) ), paperHashF( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float gPaperShadow = 1.0;
float gPaperTrans = 1.0;
float gPaperPoint = 0.0;
`;

const FRAG_LIGHTING = /* glsl */ `
varying vec3 vViewPosition;

struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};

void RE_Direct_Paper( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float nl = dot( geometryNormal, directLight.direction );
	float wrap = mix( uPaperLight.x, uPaperLight.z, gPaperPoint );
	float front = saturate( ( nl + wrap ) / ( 1.0 + wrap ) );
	// key shadow with a warm leak (light bounced off the surrounding cream paper)
	vec3 irradiance = front * directLight.color * mix( uPaperShadowLeak, vec3( 1.0 ), gPaperShadow );
	// thin card lit from behind glows warm
	float back = saturate( ( - nl + 0.1 ) / 1.1 );
	irradiance += back * gPaperTrans * uPaperLight.y * uPaperTransTint * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	gPaperShadow = 1.0;
	gPaperTrans = 1.0;
}

void RE_IndirectDiffuse_Paper( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}

#define RE_Direct				RE_Direct_Paper
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Paper
`;

const FRAG_SHADOW = /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0 && defined( SHADOWMAP_TYPE_BASIC ) && defined( PAPER_PCSS )
// Paper keeps the lit fraction in globals (so the shadow can leak warm light and thin card can glow
// through) and returns 1 so the stock multiply is a no-op.
float paperShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
	vec2 r = paperPCSS( shadowMap, shadowMapSize, shadowRadius, shadowBias, shadowCoord );
	gPaperShadow = mix( 1.0, r.x, shadowIntensity );
	gPaperTrans = r.y;
	return 1.0;
}
#else
#define paperShadow getShadow
#endif
`;

/**
 * GLOBAL patch of three's BasicShadowMap filter: every lit material in the app (paper or not, e.g. the
 * book page) gets the same PCSS soft shadow. Only stock per-light uniforms are used, so it works on
 * materials that know nothing about paper: shadowRadius carries the world size of the shadow map and
 * shadowBias the light size (lights.js writes them); the remaining constants are baked from CONFIG.
 */
let originalShadowChunk = null;
/** pcss = false when the global shadow patch could not be applied (lights.js then feeds the stock filter). */
export const paperState = { pcss: true };
function patchShadowChunk(q) {
  const S = CONFIG.lights.shadow;
  const taps = q.shadowTaps || [8, 12];
  const f = (v) => Number(v).toFixed(6);
  const range = S.far - S.near;
  const code = /* glsl */ `	#else // SHADOWMAP_TYPE_BASIC (paper PCSS)

		#define PAPER_PCSS 1
		#ifndef PAPER_BLOCKER_TAPS
			#define PAPER_BLOCKER_TAPS ${taps[0]}
		#endif
		#ifndef PAPER_PCF_TAPS
			#define PAPER_PCF_TAPS ${taps[1]}
		#endif

		float paperIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
		vec2 paperVogel( float i, float n, float phi ) {
			float r = sqrt( ( i + 0.5 ) / n );
			float t = i * 2.399963229728653 + phi;
			return vec2( cos( t ), sin( t ) ) * r;
		}

		// PCSS on the raw depth map: blocker search, receiver-plane depth bias, Vogel-disc PCF.
		// Returns ( lit fraction, lit fraction when blockers within one sheet thickness are ignored ).
		vec2 paperPCSS( sampler2D shadowMap, vec2 shadowMapSize, float worldPerUv, float lightSize, vec4 shadowCoord ) {
			vec3 sc = shadowCoord.xyz / shadowCoord.w;
			vec3 dx = dFdx( sc );
			vec3 dy = dFdy( sc );
			if ( sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0 ) return vec2( 1.0 );
			const float range = ${f(range)};
			float det = dx.x * dy.y - dx.y * dy.x;
			vec2 grad = vec2( 0.0 );
			if ( abs( det ) > 1e-14 ) grad = vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det;
			float slope = length( grad ) * range / worldPerUv;
			grad *= min( 1.0, 4.0 / max( slope, 1e-4 ) );
			float bias = ${f(S.bias)} / range;
			float thick = ${f(S.sheetThickness)} / range;
			float phi = paperIGN( gl_FragCoord.xy ) * 6.2831853;
			float rs = ${f(S.searchRadius)} / worldPerUv;
			float sumD = 0.0;
			float nB = 0.0;
			for ( int i = 0; i < PAPER_BLOCKER_TAPS; i ++ ) {
				vec2 o = paperVogel( float( i ), float( PAPER_BLOCKER_TAPS ), phi ) * rs;
				float d = sc.z + dot( grad, o ) - textureLod( shadowMap, sc.xy + o, 0.0 ).r;
				if ( d > bias ) { sumD += d; nB += 1.0; }
			}
			float penMin = ${f(S.minPenumbraTexels)} * worldPerUv / shadowMapSize.x;
			if ( nB < 0.5 ) {
				// The sparse search can miss a thin contact sliver, which would turn it into dots:
				// catch it with 4 tight taps (the tight filter is what such a sliver would get anyway).
				float rq = 0.5 * penMin / worldPerUv;
				vec2 l4 = vec2( 0.0 );
				for ( int i = 0; i < 4; i ++ ) {
					vec2 o = paperVogel( float( i ), 4.0, phi + 0.9 ) * rq;
					float d = sc.z + dot( grad, o ) - textureLod( shadowMap, sc.xy + o, 0.0 ).r;
					l4 += vec2( step( d, bias ), step( d, thick ) );
				}
				return l4 * 0.25;
			}
			float dAvg = sumD / nB * range;
			float pen = clamp( lightSize * dAvg, penMin, ${f(S.maxPenumbra)} );
			float rp = 0.5 * pen / worldPerUv;
			float lit = 0.0;
			float litT = 0.0;
			for ( int i = 0; i < PAPER_PCF_TAPS; i ++ ) {
				vec2 o = paperVogel( float( i ), float( PAPER_PCF_TAPS ), phi + 1.7 ) * rp;
				float d = sc.z + dot( grad, o ) - textureLod( shadowMap, sc.xy + o, 0.0 ).r;
				lit += step( d, bias );
				litT += step( d, thick );
			}
			return vec2( lit, litT ) / float( PAPER_PCF_TAPS );
		}

		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float lit = paperPCSS( shadowMap, shadowMapSize, shadowRadius, shadowBias, shadowCoord ).x;
			return mix( 1.0, mix( ${f(S.stockLeak ?? 0.07)}, 1.0, lit ), shadowIntensity );
		}
`;
  if (!originalShadowChunk) originalShadowChunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const src = originalShadowChunk;
  // the Basic variant is the single-tab `#else` branch after the VSM variant (the npm build strips comments)
  const v = src.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )');
  const a = v >= 0 ? src.indexOf('\n\t#else', v) + 1 : -1;
  const b = a > 0 ? src.indexOf('\n\t#endif', a) : -1;
  if (a <= 0 || b < 0) {
    console.warn('[materials] three.js shadow chunk layout changed; falling back to stock hard shadows');
    return false;
  }
  THREE.ShaderChunk.shadowmap_pars_fragment = src.slice(0, a) + code + src.slice(b);
  return true;
}

const FRAG_FIBRE = /* glsl */ `
#ifndef PAPER_NO_CUTOUT
if ( uPaperHero2.y > 0.0 && vPaperW.y > uPaperHero2.x + 0.07 ) {
  // hero cut-out: screen-door (no blending, depth stays correct for DOF / AO; the shadow pass is untouched)
  vec3 hD = uPaperHero.xyz - cameraPosition;
  float hL = length( hD );
  hD /= hL;
  vec3 hR = vPaperW - cameraPosition;
  float hT = dot( hR, hD );
  float hK = ( 1.0 - smoothstep( uPaperHero.w * 0.8, uPaperHero.w, length( hR - hD * hT ) ) ) * smoothstep( uPaperHero2.w, uPaperHero2.w + 0.16, hL - hT ) * uPaperHero2.y;
  if ( hK > 0.0 ) {
    vec2 hP = floor( gl_FragCoord.xy );
    float hN = fract( 52.9829189 * fract( dot( hP, vec2( 0.06711056, 0.00583715 ) ) ) );
    if ( hN < hK * ( 1.0 - uPaperHero2.z ) ) discard;
  }
}
#endif
{
  // printed art BEFORE fibre and lighting: albedo = mix( vertexColour, vertexColour * art, coverage ). Art faces are
  // authored white (times baked contact AO), so the art shows unmodified but keeps the AO, fibre, shadows, glow.
  vec4 paperArt = texture2D( uPaperArtTex, vPaperArtUv );
  float paperArtK = step( 0.0001, vPaperArtUv.x ) * uPaperArt.y * uPaperArt.z * max( paperArt.a, uPaperArt.x );
  // O10 build: die-cut holes inside art outlines (fence gaps, bridge arch, sails): w = alpha threshold on art faces.
  // Gold pass: the cut is anti-aliased (coverage from the alpha gradient -> alpha-to-coverage on the MSAA target).
  float paperIsArt = step( 0.0001, vPaperArtUv.x ) * uPaperArt.y;
  float paperAw = max( fwidth( paperArt.a ), 1e-4 );
  vec2 paperADx = dFdx( vPaperArtUv ), paperADy = dFdy( vPaperArtUv );
  float paperWpp = max( length( fwidth( vPaperW ) ) * 0.7071, 1e-5 );
  float paperRimK = 0.0;
  if ( paperIsArt > 0.5 ) {
    gPaperCov = clamp( ( paperArt.a - uPaperArt.w ) / paperAw + 0.5, 0.0, 1.0 );
    if ( gPaperCov < uPaperRim2.x ) discard;
    if ( uPaperRim.w > 0.0 ) {
      // pale cut-edge rim: the blurred alpha is probed on a ring of screen radius = rim width (even on screen at any
      // tilt; constant world width between the px clamps); a slow wobble keeps it hand-cut
      float rpx = clamp( uPaperRim.x / paperWpp, uPaperRim.y, uPaperRim.z );
      rpx *= 1.0 + uPaperRimCol.w * ( paperVNoiseF( vPaperW.xy * 9.0 + vPaperW.z * 5.0 ) - 0.5 ) * 2.0;
      vec2 ts = vec2( textureSize( uPaperArtTex, 0 ) );
      float lod = max( 0.0, log2( min( max( length( paperADx * ts ), length( paperADy * ts ) ), min( length( paperADx * ts ), length( paperADy * ts ) ) * 2.2 ) * max( rpx * 0.45, 1.0 ) ) ); // integrator: lod from the capped footprint too (edge-on cards sampled a mip so blurred that the whole card counted as rim)
      float amin = 1.0;
      float paperRimCap = min( length( paperADx ), length( paperADy ) ) * rpx * 2.2;
      for ( int i = 0; i < 6; i ++ ) {
        float an = float( i ) * 1.0471976 + 0.3;
        vec2 o = ( paperADx * cos( an ) + paperADy * sin( an ) ) * rpx;
        // integrator (gold pass): on a card seen nearly edge-on one screen pixel spans a large part of the sprite, so
        // the ring swallowed the whole card and it rendered as a white sliver; cap the probe in texture space
        float oL = length( o ); o *= min( 1.0, paperRimCap / max( oL, 1e-7 ) );
        amin = min( amin, textureLod( uPaperArtTex, vPaperArtUv + o, lod ).a );
      }
      paperRimK = ( 1.0 - smoothstep( 0.3, 0.7, amin ) ) * uPaperRim.w;
    }
  }
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * paperArt.rgb, paperArtK );
  // the rim keeps the baked contact AO of the vertex colour (vColor) but not the print
  diffuseColor.rgb = mix( diffuseColor.rgb, uPaperRimCol.rgb * min( vec3( 1.0 ), vColor.rgb * 1.15 ), paperRimK );
}
vec3 paperAN = abs( vPaperNrm );
vec2 paperUv = ( paperAN.y >= max( paperAN.x, paperAN.z ) ) ? vPaperPos.xz : ( ( paperAN.x > paperAN.z ) ? vPaperPos.zy : vPaperPos.xy );
paperUv *= uPaperFibre.x;
vec4 paperF1 = texture2D( uPaperFibreTex, paperUv, -0.6 );
vec4 paperF2 = texture2D( uPaperFibreTex, paperUv * uPaperFibre2.y + vec2( 0.37, 0.61 ), -0.4 );
float paperTooth = ( paperF1.b - 0.5 ) + ( paperF2.b - 0.5 ) * uPaperFibre2.x;
float paperCloud = paperF1.a - 0.5;
#ifndef PAPER_NO_FIBRE
// crumple: the same sheet sampled coarse and blurred = broad low-relief creases (lighting only, see FRAG_NORMAL)
vec4 paperF3 = texture2D( uPaperFibreTex, paperUv.yx * uPaperFibre2.w + vec2( 0.13, 0.71 ), 1.6 );
// gold pass: + a broad soft mottle (the coarse sample) so large sheets never read as a flat fill at gameplay distance
diffuseColor.rgb *= max( 0.0, 1.0 + paperTooth * uPaperFibre.y * 6.25 + ( paperCloud + ( paperF3.a - 0.5 ) * uPaperLightB.x ) * uPaperFibre.z * 6.25 );
#endif
#ifndef PAPER_NO_VARY
diffuseColor.rgb *= ( 1.0 + vPaperTone * uPaperLight.w ) * vec3( 1.0 + vPaperTone * uPaperLight.w * 0.35, 1.0, 1.0 - vPaperTone * uPaperLight.w * 0.5 );
#endif
`;

const FRAG_POOL = /* glsl */ `
if ( uPaperPoolCol.w > 0.0 ) {
  // lamp-post pools: warm light on the page and the paper around each lamp (cheap: no real lights, max 6)
  float pL = 0.0;
  for ( int i = 0; i < 6; i ++ ) {
    vec4 pp = uPaperPool[ i ];
    float pf = max( 0.0, 1.0 - distance( vPaperW, pp.xyz ) / uPaperPoolCol.w );
    pL += pp.w * pf * pf;
  }
  totalEmissiveRadiance += diffuseColor.rgb * uPaperPoolCol.rgb * pL;
}
`;

const FRAG_NORMAL = /* glsl */ `
#ifndef PAPER_NO_FIBRE
{
	vec2 pn = ( paperF1.rg - 0.5 ) * 2.0 + ( paperF2.rg - 0.5 ) * 2.0 * uPaperFibre2.x;
	pn += ( paperF3.gr - 0.5 ) * 2.0 * uPaperFibre2.z / max( uPaperFibre.w, 1e-3 );
	vec3 q0 = dFdx( vViewPosition );
	vec3 q1 = dFdy( vViewPosition );
	vec2 st0 = dFdx( paperUv );
	vec2 st1 = dFdy( paperUv );
	vec3 q1perp = cross( q1, normal );
	vec3 q0perp = cross( normal, q0 );
	vec3 pT = q1perp * st0.x + q0perp * st1.x;
	vec3 pB = q1perp * st0.y + q0perp * st1.y;
	float pdet = max( dot( pT, pT ), dot( pB, pB ) );
	float pscale = ( pdet == 0.0 ) ? 0.0 : inversesqrt( pdet );
	normal = normalize( normal + ( pT * pn.x + pB * pn.y ) * pscale * uPaperFibre.w );
}
#endif
`;

function patchLightsBegin() {
  let src = THREE.ShaderChunk.lights_fragment_begin;
  src = src.replace('getShadow( directionalShadowMap[ i ]', 'paperShadow( directionalShadowMap[ i ]');
  src = src.replace('getPointLightInfo( pointLight, geometryPosition, directLight );', 'getPointLightInfo( pointLight, geometryPosition, directLight );\n\t\tgPaperPoint = 1.0;');
  src = src.replace('getSpotLightInfo( spotLight, geometryPosition, directLight );', 'getSpotLightInfo( spotLight, geometryPosition, directLight );\n\t\tgPaperPoint = 0.0;');
  src = src.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tgPaperPoint = 0.0;');
  return src;
}

function patchColorVertex() {
  return THREE.ShaderChunk.color_vertex.replace('vColor *= color;', 'vColor *= paperVC( color );').replace('vColor.rgb *= color;', 'vColor.rgb *= paperVC( color );');
}

function extend(material, flags) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, paperUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <color_vertex>', patchColorVertex())
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <lights_lambert_pars_fragment>', FRAG_LIGHTING)
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + FRAG_SHADOW)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_FIBRE)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_POOL)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
      .replace('#include <lights_fragment_begin>', patchLightsBegin())
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + 'gl_FragColor.a = gPaperCov;');
  };
  material.customProgramCacheKey = () => 'paper3|' + JSON.stringify(flags);
}

export function createMaterials({ quality = 'high' } = {}) {
  const cache = new Map();
  let q = qualitySettings(quality);
  let textures = {};
  let fibreTex = null;
  let fibreSource = 'none';
  let assetRepeat = 0;
  const _rimCol = new THREE.Color();
  // alpha-to-coverage needs the multisampled scene target (post.js: q.msaa); without it the cut stays a hard test
  const a2c = () => (q.msaa || 0) > 0 && CONFIG.lights.paper.alphaToCoverage !== false;
  const pcss = patchShadowChunk(q);
  paperState.pcss = pcss;

  function applyConfig() {
    const P = CONFIG.lights.paper;
    const u = paperUniforms;
    const ext = fibreSource === 'assets';
    const scale = (ext && (assetRepeat || P.assetFibreScale)) || P.fibreScale;
    u.uPaperFibre.value.set(1 / scale, ext ? P.assetFibreTooth ?? P.fibreTooth : P.fibreTooth, P.fibreCloud, ext ? P.assetFibreNormal ?? P.fibreNormal : P.fibreNormal);
    u.uPaperFibre2.value.set(ext ? P.assetFibreFine ?? P.fibreFine : P.fibreFine, 3.73, P.crumple ?? 0, P.crumpleScale ?? 0.27);
    u.uPaperLight.value.set(P.wrap, P.translucency, CONFIG.lights.lantern.wrap ?? 0.5, P.toneVary);
    setColorCached(u.uPaperTransTint.value, P.translucencyTint);
    setColorCached(u.uPaperShadowLeak.value, CONFIG.lights.shadow.leak);
    const H = CONFIG.lights.cutout || {};
    u.uPaperHero.value.w = H.radius ?? 0.45;
    u.uPaperHero2.value.z = H.keep ?? 0.25;
    u.uPaperHero2.value.w = H.margin ?? 0.25;
    const R = P.rim || {};
    u.uPaperRim.value.set(R.width ?? 0.016, R.minPx ?? 1.5, R.maxPx ?? 3.4, R.strength ?? 0.9);
    if (setColorCached(_rimCol, R.color || '#fff0cf')) { /* linear working space */ }
    u.uPaperRimCol.value.set(_rimCol.r, _rimCol.g, _rimCol.b, R.wobble ?? 0.3);
    u.uPaperRim2.value.x = a2c() ? 0.04 : 0.5;
    u.uPaperLightB.value.x = P.fibreBroad ?? 1.2;
  }

  function setFibre(tex, source) {
    if (fibreTex && fibreTex !== tex) fibreTex.dispose();
    fibreTex = tex;
    fibreSource = source;
    paperUniforms.uPaperFibreTex.value = tex;
    applyConfig();
  }

  setFibre(makeProceduralFibre(512, q.anisotropy || 4), 'procedural');

  let fromLoader = false;
  function useMaps(detail, normal) {
    const packed = packFromAssets(detail, normal, q.anisotropy || 4);
    if (!packed) return false;
    // world units per repeat, if known (manifest `repeat`)
    const r = detail.userData && (detail.userData.repeat || detail.userData.worldSize);
    assetRepeat = typeof r === 'number' && r > 0 ? r : 0;
    setFibre(packed, 'assets');
    return true;
  }
  /**
   * Safety net: fetch the textures agent's card maps straight from public/textures/manifest.json, so the
   * fibre is right even when the assets loader hands over no textures. Loader-supplied maps win.
   */
  async function selfLoad() {
    try {
      if (typeof fetch !== 'function' || typeof Image === 'undefined' || CONFIG.lights.paper.useAssetTextures === false) return;
      const res = await fetch('./textures/manifest.json');
      if (!res.ok) return;
      const man = await res.json();
      const d = man.paper;
      const n = man.paperNormal;
      if (!d || !n || !d.file || !n.file) return;
      const load = (file) => new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = './textures/' + file;
      });
      const [di, ni] = await Promise.all([load(d.file), load(n.file)]);
      if (!di || !ni || fromLoader) return;
      useMaps({ image: di, flipY: d.flipY !== false, userData: { repeat: d.repeat } }, { image: ni, flipY: n.flipY !== false });
    } catch (err) { /* keep the procedural fibre */ }
  }

  function defines() {
    const taps = q.shadowTaps || [8, 12];
    return { PAPER_BLOCKER_TAPS: taps[0], PAPER_PCF_TAPS: taps[1] };
  }

  const api = {
    palette: CONFIG.palette,
    uniforms: paperUniforms,
    /** true when the global PCSS shadow patch is active (false = three.js changed, stock hard shadows). */
    pcss,
    /**
     * Matte cardstock material. CACHED: same options -> same material instance (so meshes batch).
     * opts: { color = '#ffffff', map = null, side = THREE.DoubleSide, layer = 0 (ignored: one material for
     *   all layers), edge = true (ignored: cut edges come from vertex colours), emissive = null,
     *   emissiveIntensity = 1, alphaTest = 0, transparent = false,
     *   fibre = 'local' | 'world' | 'none'  (object-space fibre sticks to moving flaps; 'world' for a
     *     page mesh that is re-centred on the traveller, so the fibre does not swim),
     *   vary = true (per-sheet tone variation) }
     * Vertex colours are always multiplied in when the geometry has a `color` attribute (linear RGB);
     * a mesh without one renders as if its vertex colour were white.
     */
    paper(opts = {}) {
      const { color = '#ffffff', map = null, side = THREE.DoubleSide, emissive = null, emissiveIntensity = 1, alphaTest = 0, transparent = false, fibre = 'local', vary = true, variant = '' } = opts;
      const colorKey = color && color.isColor ? '#' + color.getHexString() : String(color).toLowerCase();
      const emKey = emissive ? (emissive.isColor ? '#' + emissive.getHexString() : String(emissive).toLowerCase()) : '-';
      const key = [colorKey, map ? map.uuid : '-', side, emKey, emissive ? emissiveIntensity : 1, alphaTest, transparent ? 1 : 0, fibre, vary ? 1 : 0].join('|') + (variant ? '|' + variant : '');
      // `variant` (integration): a separate material INSTANCE with identical look. Objects of a different class
      // (plain Mesh vs BatchedMesh, receiveShadow on/off) must not share one material: three recomputes the
      // whole program-parameter set every time such a flag flips inside a frame (~25 kB of garbage per frame).
      let m = cache.get(key);
      if (!m) {
        m = new THREE.MeshLambertMaterial({ color, map, side, alphaTest, transparent, vertexColors: true });
        if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveIntensity; }
        m.shadowSide = THREE.DoubleSide;
        m.alphaToCoverage = a2c() && !transparent;
        m.name = 'paper:' + key;
        m.defines = { ...defines() };
        if (fibre === 'world') m.defines.PAPER_FIBRE_WORLD = 1;
        if (fibre === 'none') m.defines.PAPER_NO_FIBRE = 1;
        if (!vary) m.defines.PAPER_NO_VARY = 1;
        if (variant === 'traveller') m.defines.PAPER_NO_CUTOUT = 1; // the hero is never cut out of his own frame
        extend(m, { fibre, vary: !!vary, cut: variant !== 'traveller' });
        cache.set(key, m);
      }
      return m;
    },
    /**
     * Called by main.js after assets load. Uses the textures agent's maps when present
     * ({ card | paper: grey albedo detail, cardNormal | paperNormal: tangent normal }), else keeps the
     * procedural fibre. Never throws.
     */
    setTextures(t) {
      textures = t || {};
      // art atlas (manifest key `art`): sRGB, mipmapped, anisotropic; glTF UV convention (flipY = false in the manifest)
      const art = textures.art || null;
      if (art && art.isTexture) {
        art.colorSpace = THREE.SRGBColorSpace;
        art.wrapS = art.wrapT = THREE.ClampToEdgeWrapping;
        art.generateMipmaps = true;
        art.minFilter = THREE.LinearMipmapLinearFilter;
        art.magFilter = THREE.LinearFilter;
        art.anisotropy = Math.max(q.anisotropy || 4, 8);
        art.needsUpdate = true;
      }
      paperUniforms.uPaperArtTex.value = art && art.isTexture ? art : null;
      paperUniforms.uPaperArt.value.y = art && art.isTexture ? 1 : 0;
      if (CONFIG.lights.paper.useAssetTextures === false) return;
      const detail = textures.card || textures.cardAlbedo || textures.paper || null;
      const normal = textures.cardNormal || textures.paperNormal || null;
      if (useMaps(detail, normal)) fromLoader = true;
    },
    /** Resolves when the self-loaded fibre maps (if any) are in place. Never rejects. */
    ready: null,
    get textures() { return textures; },
    get fibreSource() { return fibreSource; },
    /** Per-frame hook: re-reads the tunables so live config edits (and check scripts) take effect. */
    update(dt) { applyConfig(); },
    setQuality(level) {
      q = qualitySettings(level);
      const d = defines();
      for (const m of cache.values()) {
        const want = a2c() && !m.transparent;
        if (m.alphaToCoverage !== want) { m.alphaToCoverage = want; m.needsUpdate = true; }
        if (m.defines.PAPER_BLOCKER_TAPS !== d.PAPER_BLOCKER_TAPS || m.defines.PAPER_PCF_TAPS !== d.PAPER_PCF_TAPS) {
          Object.assign(m.defines, d);
          m.needsUpdate = true;
        }
      }
      if (fibreTex) { fibreTex.anisotropy = q.anisotropy || 4; fibreTex.needsUpdate = true; }
    },
    dispose() {
      for (const m of cache.values()) m.dispose();
      cache.clear();
      if (fibreTex) fibreTex.dispose();
    },
  };
  api.ready = selfLoad();
  return api;
}
