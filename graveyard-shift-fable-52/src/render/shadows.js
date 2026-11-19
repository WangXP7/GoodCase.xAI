// Soft shadows. three's stock shadow lookup is replaced (ShaderChunk patch, so every lit material
// gets it, including ones built with onBeforeCompile) by a percentage-closer soft shadow:
//   blocker search -> penumbra that grows with receiver-blocker distance -> receiver-plane depth
//   bias (each tap is compared against the receiver plane at that tap's texel centre, which is what
//   removes acne at grazing angles) -> fade to lit at the edge of the map.
// Needs raw depth, so the renderer runs BasicShadowMap (sampler2D depth, nearest). That also means
// light.shadow.map.depthTexture can be sampled directly by the volumetrics pass.
//
// The stock per-light shadow uniforms are reused with new meanings (no extra uniforms, no recompiles):
//   spot  shadow.intensity = tan(half shadow fov)   shadow.bias = bias in metres   shadow.radius = source radius in metres
//   moon  shadow.intensity = 1 / frustum width (uv per metre)   shadow.bias = depth range in metres   shadow.radius = tan(angular radius)
// Use configureSpotShadow / configureMoonShadow; do not set those three fields by hand.
// Both lit materials (lights_fragment_begin) and shadow catchers (ShadowMaterial, shadowmask_pars_fragment)
// are patched, so every stock reader of those uniforms goes through the new lookup.
//
// Fallback. If three's chunk text does not match (version drift) or the page has ?softshadows=0,
// nothing is patched: one console.warn, the renderer uses three's stock PCF shadows and the
// configure helpers write ordinary values. The game stays lit. softShadowsActive() says which.
//
// Also hosts the ?shot=lighttest stage (installLightTestScene) used to judge lights, sky and shadows.
import {
  ShaderChunk, BasicShadowMap, PCFShadowMap, ShadowMaterial, Vector3, Group, Mesh, MeshStandardMaterial, MeshBasicMaterial, PlaneGeometry,
  BoxGeometry, CylinderGeometry, Color,
} from 'three';

export const SPOT_SHADOW_NEAR = 0.3; // metres; baked into the shader, every pooled spot uses it
export const SPOT_SHADOW_MAX_HALF = 1.05; // rad; wider cones keep a 120 degree shadow frustum and are lit outside it
export const MOON_SHADOW = { extent: 64, depth: 180, distance: 90, lead: 14 }; // metres

const SOFT_SHADOW_GLSL = /* glsl */ `
#if defined( USE_SHADOWMAP ) && ! defined( SHADOWMAP_TYPE_PCF ) && ! defined( SHADOWMAP_TYPE_VSM )

	const float GS_SPOT_NEAR = ${SPOT_SHADOW_NEAR.toFixed(4)};
	const int GS_BLOCKER_TAPS = 8;
	const int GS_FILTER_TAPS = 8; // each tap is a bilinear 2x2 comparison (32 fetches)
	const float GS_MAX_SLOPE = 6.0; // receiver-plane slope limit (tan of the angle to the light axis)

	float gsNoise( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }

	vec2 gsDisk( int i, int n, float phi ) {
		float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
		float a = float( i ) * 2.399963229728653 + phi;
		return vec2( cos( a ), sin( a ) ) * r;
	}

	// d(depth)/d(uv) of the receiver's plane in shadow-map space, from screen-space derivatives
	vec2 gsPlaneGradient( vec2 uv, float depth ) {
		vec2 dx = dFdx( uv ); vec2 dy = dFdy( uv );
		float ddx = dFdx( depth ); float ddy = dFdy( depth );
		float det = dx.x * dy.y - dx.y * dy.x;
		if ( abs( det ) < 1e-14 ) return vec2( 0.0 );
		return vec2( ddx * dy.y - dx.y * ddy, dx.x * ddy - dy.x * ddx ) / det;
	}

	vec2 gsTexelCentre( vec2 uv, vec2 mapSize ) { return ( floor( uv * mapSize ) + 0.5 ) / mapSize; }

	float gsEdgeFade( vec2 uv ) {
		vec2 e = min( uv, 1.0 - uv );
		return smoothstep( 0.0, 0.05, min( e.x, e.y ) );
	}

	// one texel compared against the receiver plane at that texel's centre: 1 lit, 0 shadowed
	#define GS_MOON_CMP( C ) step( p.z + dot( grad, ( C ) - p.xy ) - bias, texture2D( map, ( C ) ).r )
	#define GS_SPOT_CMP( C ) step( w + dot( grad, ( C ) - p.xy ) - bias, GS_SPOT_NEAR / max( 1.0 - texture2D( map, ( C ) ).r / A, 1e-6 ) )

	// Orthographic (moon). Depths are the 0..1 map values; linear in metres.
	float gsMoonShadow( sampler2D map, vec2 mapSize, float uvPerMetre, float depthRange, float tanAngle, vec4 coord ) {
		vec3 p = coord.xyz / coord.w;
		float fade = gsEdgeFade( p.xy ) * ( 1.0 - smoothstep( 0.92, 1.0, p.z ) );
		if ( fade <= 0.0 || p.z <= 0.0 ) return 1.0;
		vec2 texel = 1.0 / mapSize;
		vec2 grad = gsPlaneGradient( p.xy, p.z );
		float gMax = GS_MAX_SLOPE / ( uvPerMetre * depthRange );
		grad *= min( 1.0, gMax / max( length( grad ), 1e-9 ) );
		float bias = 0.008 / depthRange + 0.15 * ( abs( grad.x ) + abs( grad.y ) ) * texel.x;
		float phi = gsNoise( gl_FragCoord.xy ) * 6.2831853;

		float searchR = clamp( tanAngle * 10.0 * uvPerMetre, 2.0 * texel.x, 0.02 );
		float sum = 0.0; float n = 0.0;
		for ( int i = 0; i < GS_BLOCKER_TAPS; i ++ ) {
			vec2 c = gsTexelCentre( p.xy + gsDisk( i, GS_BLOCKER_TAPS, phi ) * searchR, mapSize );
			float zb = texture2D( map, c ).r;
			float zr = p.z + dot( grad, c - p.xy ) - bias;
			if ( zb < zr ) { sum += zb; n += 1.0; }
		}
		// No blocker among the search taps is not proof of light: the rotated, texel-snapped search
		// misses a thin or just-touching occluder on some pixels and finds it on their neighbours,
		// which drew contact shadows as a dotted screen. One bilinear comparison at the pixel's own
		// position settles those pixels smoothly (four fetches; open ground still leaves here lit).
		if ( n < 0.5 ) {
			vec2 st0 = p.xy * mapSize - 0.5; vec2 f0 = fract( st0 ); vec2 c0 = ( floor( st0 ) + 0.5 ) * texel;
			float l0 = mix( mix( GS_MOON_CMP( c0 ), GS_MOON_CMP( c0 + vec2( texel.x, 0.0 ) ), f0.x ),
				mix( GS_MOON_CMP( c0 + vec2( 0.0, texel.y ) ), GS_MOON_CMP( c0 + texel ), f0.x ), f0.y );
			return mix( 1.0, l0, fade );
		}

		float gap = max( p.z - sum / n, 0.0 ) * depthRange; // metres between blocker and receiver
		float r = clamp( tanAngle * gap * uvPerMetre, 1.25 * texel.x, 0.03 );
		// every search tap blocked and the filter disk inside the searched area: fully in shadow
		if ( n > float( GS_BLOCKER_TAPS ) - 0.5 && r <= searchR ) return 1.0 - fade;
		float lit = 0.0;
		// Each tap blends the four texels round it by its position between them (every texel still
		// compared against the receiver plane at its own centre). A tap snapped to one texel is all
		// or nothing, and with the per-pixel rotation that showed as a screen-door stipple up close.
		for ( int i = 0; i < GS_FILTER_TAPS; i ++ ) {
			vec2 st = ( p.xy + gsDisk( i, GS_FILTER_TAPS, phi + 1.7 ) * r ) * mapSize - 0.5;
			vec2 f = fract( st );
			vec2 c = ( floor( st ) + 0.5 ) * texel;
			lit += mix( mix( GS_MOON_CMP( c ), GS_MOON_CMP( c + vec2( texel.x, 0.0 ) ), f.x ),
				mix( GS_MOON_CMP( c + vec2( 0.0, texel.y ) ), GS_MOON_CMP( c + texel ), f.x ), f.y );
		}
		return mix( 1.0, lit / float( GS_FILTER_TAPS ), fade );
	}

	// Perspective (spot). Works in metres along the light axis: coord.w is the receiver's depth, and
	// with a fixed near plane the map's 0..1 depth converts back to metres without knowing far.
	float gsSpotShadow( sampler2D map, vec2 mapSize, float tanHalf, float biasMetres, float sourceRadius, vec4 coord ) {
		float w = coord.w;
		if ( w <= GS_SPOT_NEAR * 1.05 ) return 1.0;
		vec3 p = coord.xyz / w;
		float fade = gsEdgeFade( p.xy );
		if ( fade <= 0.0 || p.z >= 1.0 || p.z <= 0.0 ) return 1.0;
		float A = p.z / ( 1.0 - GS_SPOT_NEAR / w ); // far / ( far - near )
		vec2 texel = 1.0 / mapSize;
		float metresPerUv = 2.0 * tanHalf * w;
		vec2 grad = gsPlaneGradient( p.xy, w );
		float gMax = GS_MAX_SLOPE * metresPerUv;
		grad *= min( 1.0, gMax / max( length( grad ), 1e-9 ) );
		float bias = biasMetres + 0.15 * ( abs( grad.x ) + abs( grad.y ) ) * texel.x;
		float phi = gsNoise( gl_FragCoord.xy ) * 6.2831853;

		float searchR = clamp( sourceRadius * ( w - GS_SPOT_NEAR ) / ( w * 2.0 * tanHalf * GS_SPOT_NEAR ), 2.0 * texel.x, 0.03 );
		float sum = 0.0; float n = 0.0;
		for ( int i = 0; i < GS_BLOCKER_TAPS; i ++ ) {
			vec2 c = gsTexelCentre( p.xy + gsDisk( i, GS_BLOCKER_TAPS, phi ) * searchR, mapSize );
			float wb = GS_SPOT_NEAR / max( 1.0 - texture2D( map, c ).r / A, 1e-6 );
			float wr = w + dot( grad, c - p.xy ) - bias;
			if ( wb < wr ) { sum += wb; n += 1.0; }
		}
		if ( n < 0.5 ) { // see gsMoonShadow
			vec2 st0 = p.xy * mapSize - 0.5; vec2 f0 = fract( st0 ); vec2 c0 = ( floor( st0 ) + 0.5 ) * texel;
			float l0 = mix( mix( GS_SPOT_CMP( c0 ), GS_SPOT_CMP( c0 + vec2( texel.x, 0.0 ) ), f0.x ),
				mix( GS_SPOT_CMP( c0 + vec2( 0.0, texel.y ) ), GS_SPOT_CMP( c0 + texel ), f0.x ), f0.y );
			return mix( 1.0, l0, fade );
		}

		float wAvg = sum / n;
		float penumbra = sourceRadius * max( w - wAvg, 0.0 ) / wAvg; // metres at the receiver
		float r = clamp( penumbra / metresPerUv, 1.25 * texel.x, 0.04 );
		if ( n > float( GS_BLOCKER_TAPS ) - 0.5 && r <= searchR ) return 1.0 - fade;
		float lit = 0.0;
		for ( int i = 0; i < GS_FILTER_TAPS; i ++ ) {
			vec2 st = ( p.xy + gsDisk( i, GS_FILTER_TAPS, phi + 1.7 ) * r ) * mapSize - 0.5;
			vec2 f = fract( st );
			vec2 c = ( floor( st ) + 0.5 ) * texel;
			lit += mix( mix( GS_SPOT_CMP( c ), GS_SPOT_CMP( c + vec2( texel.x, 0.0 ) ), f.x ),
				mix( GS_SPOT_CMP( c + vec2( 0.0, texel.y ) ), GS_SPOT_CMP( c + texel ), f.x ), f.y );
		}
		return mix( 1.0, lit / float( GS_FILTER_TAPS ), fade );
	}

#else

	#define gsMoonShadow getShadow
	#define gsSpotShadow getShadow

#endif
`;

let mode = null; // null until first install, then 'soft' or 'stock'

// The two chunks that read the shadow uniforms, with their shadow lookups redirected. Returns null
// (and changes nothing) unless every patch point is found.
function patchedChunks() {
  const out = {};
  for (const name of ['lights_fragment_begin', 'shadowmask_pars_fragment']) {
    const src = ShaderChunk[name];
    const spot = 'getShadow( spotShadowMap[ i ]';
    const dir = 'getShadow( directionalShadowMap[ i ]';
    if (typeof src !== 'string' || src.split(spot).length !== 2 || src.split(dir).length !== 2) return null;
    out[name] = src.replace(spot, 'gsSpotShadow( spotShadowMap[ i ]').replace(dir, 'gsMoonShadow( directionalShadowMap[ i ]');
  }
  if (typeof ShaderChunk.shadowmap_pars_fragment !== 'string') return null;
  out.shadowmap_pars_fragment = ShaderChunk.shadowmap_pars_fragment + SOFT_SHADOW_GLSL;
  return out;
}

// Idempotent. Call before any lit material compiles (createLights does, at boot). Never throws:
// returns true with soft shadows installed, false on the stock-shadow fallback.
export function installSoftShadows(renderer) {
  if (mode === null) {
    const off = new URLSearchParams(window.location.search).get('softshadows') === '0';
    const chunks = off ? null : patchedChunks();
    if (chunks) Object.assign(ShaderChunk, chunks);
    else console.warn(`[shadows] soft shadows unavailable (${off ? '?softshadows=0' : 'three shader chunks changed, patch points not found'}): using stock PCF shadows`);
    mode = chunks ? 'soft' : 'stock';
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = mode === 'soft' ? BasicShadowMap : PCFShadowMap;
  return mode === 'soft';
}

export const softShadowsActive = () => mode === 'soft';

// angle: the spot's half angle (rad). sourceRadius: luminaire radius in metres (bigger = softer).
export function configureSpotShadow(light, angle, sourceRadius = 0.25, mapSize = 1024) {
  const s = light.shadow;
  const half = Math.min(angle, SPOT_SHADOW_MAX_HALF);
  s.focus = half / angle;
  if (mode === 'soft') {
    s.intensity = Math.tan(half); s.bias = 0.01; s.radius = sourceRadius; s.normalBias = 0.01;
  } else { // three's own meanings
    s.intensity = 1; s.bias = -0.0006; s.radius = 2.5; s.normalBias = 0.03;
  }
  if (s.mapSize.x !== mapSize) s.mapSize.set(mapSize, mapSize);
  if (s.camera.near !== SPOT_SHADOW_NEAR) { s.camera.near = SPOT_SHADOW_NEAR; s.camera.updateProjectionMatrix(); }
}

export function configureMoonShadow(light, { mapSize = 2048, angularRadius = 0.03 } = {}) {
  const s = light.shadow;
  const { extent, depth } = MOON_SHADOW;
  const c = s.camera;
  c.left = -extent / 2; c.right = extent / 2; c.top = extent / 2; c.bottom = -extent / 2;
  c.near = 1; c.far = 1 + depth;
  c.updateProjectionMatrix();
  if (mode === 'soft') {
    s.intensity = 1 / extent; s.bias = depth; s.radius = Math.tan(angularRadius); s.normalBias = 0.01;
  } else { // three's own meanings
    s.intensity = 1; s.bias = -0.0004; s.radius = 3; s.normalBias = 0.05;
  }
  if (s.mapSize.x !== mapSize) s.mapSize.set(mapSize, mapSize);
}

// How often the moon's shadow map is redrawn: every n-th frame (G.quality.moonShadowEvery; lights.js
// passes it on each frame). Between redraws the light is left where the map was drawn, so the map
// and its matrix still belong together; what is in it is at most that many frames old.
let moonEvery = 1;
let moonTick = 0;
let moonDrawnSize = 0;
export function setMoonShadowCadence(n) {
  const v = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  if (v !== moonEvery) { moonEvery = v; moonTick = 0; }
}

const _f = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _c = new Vector3();
const UP = new Vector3(0, 1, 0);

// Keep the moon's shadow frustum around the area in front of the camera. The centre moves in whole
// shadow-map texels so static shadows do not crawl as the camera moves. moonDir points at the moon.
export function fitMoonShadow(light, camera, moonDir) {
  const { extent, distance, lead } = MOON_SHADOW;
  const sh = light.shadow;
  if (moonEvery > 1) {
    sh.autoUpdate = false;
    const due = moonTick % moonEvery === 0 || !sh.map || sh.mapSize.x !== moonDrawnSize;
    moonTick++;
    if (!due) return;
    sh.needsUpdate = true;
    moonDrawnSize = sh.mapSize.x;
  } else if (!sh.autoUpdate) sh.autoUpdate = true;
  camera.getWorldDirection(_f);
  _f.y = 0;
  if (_f.lengthSq() > 1e-6) _f.normalize();
  _c.copy(camera.position).addScaledVector(_f, lead);
  _c.y = 0;
  _r.crossVectors(UP, moonDir).normalize();
  _u.crossVectors(moonDir, _r);
  const texel = extent / light.shadow.mapSize.x;
  const x = _c.dot(_r);
  const y = _c.dot(_u);
  _c.addScaledVector(_r, Math.round(x / texel) * texel - x).addScaledVector(_u, Math.round(y / texel) * texel - y);
  light.target.position.copy(_c);
  light.position.copy(_c).addScaledVector(moonDir, distance);
}

// ---- ?shot=lighttest ---------------------------------------------------------------------------
// A stand-in forecourt: wet dark ground, crates, a car-sized block, two near sodium lamps and a row
// of far ones, a canopy slab with downlights, a wall with a fluorescent tube.
// Extra query params (read here; core/params.js is not ours): dolly=1 (5 s camera move along the lot),
// flash=<0..1> (fire sheet lightning at t = flashat seconds, default 0, toward azimuth flashaz),
// mz=<0..1> (hold the muzzle flash on), catcher=1 (a ShadowMaterial plane beside the car).
export function installLightTestScene(G) {
  const q = new URLSearchParams(window.location.search);
  const root = new Group();
  root.name = 'lighttest';
  const L = G.lights;
  const std = (color, roughness, metalness = 0) => new MeshStandardMaterial({ color, roughness, metalness });
  const add = (geo, mat, x, y, z, cast = true) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const glow = (c, radiance) => new MeshBasicMaterial({ color: new Color().copy(c).multiplyScalar(radiance) });

  const ground = add(new PlaneGeometry(400, 400), std(0x3a3b3d, 0.3), 0, 0, 0, false);
  L.poolAlbedo = 0.042; L.poolRoughness = 0.3; // what the pool-only fixtures assume about this ground
  ground.rotation.x = -Math.PI / 2;

  // crates: pale, mid and dark, so rim light and shadow depth can both be judged
  const crate = new BoxGeometry(1, 1, 1);
  add(crate, std(0xb9b6ae, 0.8), -0.6, 0.5, 4.4).rotation.y = 0.5;
  add(crate, std(0x8a8a8a, 0.7), 0.3, 0.5, 5.3).rotation.y = -0.2;
  add(crate, std(0x9a9a98, 0.75), -0.3, 1.5, 4.7).rotation.y = 0.9;
  add(new BoxGeometry(1.4, 1.9, 0.9), std(0xa4a7aa, 0.6), 10.5, 0.95, 4.2).rotation.y = 0.35;

  // car-sized block on wheels (so there is a real gap underneath)
  const car = new Group();
  car.position.set(4.4, 0, 0.8); car.rotation.y = 0.5;
  const paint = std(0x5a1512, 0.32, 0.1);
  const part = (geo, mat, x, y, z) => { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; car.add(m); return m; };
  part(new BoxGeometry(4.4, 0.75, 1.8), paint, 0, 0.7, 0);
  part(new BoxGeometry(2.3, 0.62, 1.6), paint, -0.25, 1.38, 0);
  const wheel = new CylinderGeometry(0.33, 0.33, 0.24, 20);
  for (const [x, z] of [[1.4, 0.82], [1.4, -0.82], [-1.4, 0.82], [-1.4, -0.82]]) part(wheel, std(0x101010, 0.85), x, 0.33, z).rotation.x = Math.PI / 2;
  root.add(car);

  // a pale crate and a barrel out in the dark, turned so one side catches the moon
  add(new BoxGeometry(1.2, 1.2, 1.2), std(0xc4c1b8, 0.75), -8, 0.6, 22).rotation.y = Math.PI / 4;
  add(new CylinderGeometry(0.3, 0.3, 0.9, 28), std(0x8d9296, 0.45, 0.6), -8.4, 0.45, 20.2);

  if (q.get('catcher') === '1') { // shadow catcher: proves ShadowMaterial reads the patched lookup
    const c = add(new PlaneGeometry(9, 6), new ShadowMaterial({ opacity: 0.85, color: 0x003060 }), 5, 0.02, 3.5, false);
    c.rotation.x = -Math.PI / 2;
  }

  // sodium lamp poles
  const poleMat = std(0x4b4f52, 0.55, 0.6);
  const lamp = (x, z, armDir) => {
    add(new CylinderGeometry(0.09, 0.12, 8, 10), poleMat, x, 4, z);
    add(new BoxGeometry(1.8, 0.1, 0.1), poleMat, x + armDir * 0.9, 7.95, z);
    add(new BoxGeometry(0.7, 0.16, 0.34), poleMat, x + armDir * 1.9, 7.93, z);
    add(new BoxGeometry(0.5, 0.04, 0.26), glow(L.colors.sodium, 90), x + armDir * 1.9, 7.84, z, false);
    return L.add({ type: 'spot', pos: [x + armDir * 1.9, 7.8, z], dir: [armDir * 0.12, -1, 0], color: L.colors.sodium, lumens: 28000, range: 30, cone: 1.15, size: 0.3, flicker: 0.04, castShadow: true });
  };
  lamp(-1.5, -1.2, 1);
  lamp(16, 3, -1);
  for (let i = 0; i < 9; i++) lamp(30 + i * 15, i % 2 ? 6 : -4, i % 2 ? -1 : 1);

  // canopy: slab on four columns, six downlights
  const canopyMat = std(0xc9ccca, 0.6);
  add(new BoxGeometry(13, 0.5, 8), canopyMat, -13, 5.25, -5);
  for (const [x, z] of [[-18.5, -8], [-7.5, -8], [-18.5, -2], [-7.5, -2]]) add(new BoxGeometry(0.4, 5, 0.4), canopyMat, x, 2.5, z);
  for (let i = 0; i < 6; i++) {
    const x = -17 + (i % 3) * 4; const z = i < 3 ? -7 : -3;
    add(new BoxGeometry(0.6, 0.04, 0.6), glow(L.colors.canopy, 60), x, 4.98, z, false);
    L.add({ type: 'spot', pos: [x, 4.95, z], dir: [0, -1, 0], color: L.colors.canopy, lumens: 11000, range: 16, cone: 1.0, size: 0.3, castShadow: true });
  }
  add(new BoxGeometry(0.9, 1.5, 0.5), std(0x7a2a22, 0.4, 0.2), -13, 0.75, -5); // pump-sized block under the canopy

  // wall with a flickering fluorescent tube
  add(new BoxGeometry(7, 3.4, 0.3), std(0x8d8a80, 0.9), 9, 1.7, -7);
  const tubeMesh = add(new CylinderGeometry(0.02, 0.02, 1.2, 8), glow(L.colors.fluorescent, 40), 9, 2.9, -6.7, false);
  tubeMesh.rotation.z = Math.PI / 2;
  L.add({ type: 'tube', pos: [9, 2.85, -6.6], dir: [0, 0, 1], color: L.colors.fluorescent, lumens: 2600, range: 9, flicker: 0.7 });

  G.scene.add(root);

  const shot = { cam: [7.6, 1.65, 9.6, 0.5, -0.1], fov: 60 };
  G.shotCam = shot;
  G.camera.position.set(shot.cam[0], shot.cam[1], shot.cam[2]);
  G.camera.rotation.order = 'YXZ';
  G.camera.rotation.set(shot.cam[4], shot.cam[3], 0);

  const dolly = q.get('dolly') === '1';
  const flash = Number(q.get('flash')) || 0;
  const flashAt = Number(q.get('flashat')) || 0;
  const flashAz = q.has('flashaz') ? Number(q.get('flashaz')) : undefined;
  const mz = Number(q.get('mz')) || 0;
  let flashed = false;
  return {
    root,
    update() {
      const t = G.time.t;
      if (dolly) {
        const k = Math.min(1, t / 5);
        G.shotCam = { cam: [-10 + 40 * k, 1.7, 13 - 3 * k, -1.15, -0.06], fov: 60 };
      }
      if (flash > 0 && !flashed && t >= flashAt) { flashed = true; G.sky.lightning(flash, flashAz); }
      if (mz > 0) L.setMuzzleFlash([1.2, 1.5, 4.6], mz);
    },
  };
}
