// OWNER: render agent. Post chain (docs/ARCHITECTURE.md, render/post.js).
//
//   scene -> HDR (half-float) MSAA target + depth texture                              [full res]
//   AO        contact darkening from depth (Vogel taps, min-difference normals)        [half res]
//   prefilter downsample x AO, signed circle of confusion in alpha (px, - = near)       [half res]
//   tile      max near-field CoC so foreground blur can bleed over the sharp band       [1/8 res]
//   gather    golden-angle disc bokeh, scatter-as-gather, near/far aware               [half res]
//   fill      small tent that closes the gaps between gather taps                      [half res]
//   bloom     threshold + separable gaussian                                           [quarter res]
//   composite sharp/blur mix, pale cut-edge rim, bloom, vignette, filmic tone map, grade, grain, sRGB
//
// Tilt-shift: CoC = mix(screen-Y distance from the focus line, view-depth distance from the focus
// point, depthWeight), zero inside `focusBand`, growing over `ramp` to `maxBlurPx`.
import { setColorCached } from './colorcache.js';
import * as THREE from 'three';
import { renderReflection } from './water.js';
import { CONFIG, qualitySettings } from '../core/config.js';
import { state } from '../core/state.js';
// integration: V8's Math.hypot allocates (rest-argument array) on every call; this 2-argument form is allocation-free.
const hypot2 = (a, b) => Math.sqrt(a * a + b * b);

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const COMMON = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uProj;  // near, far, tan(fov/2), aspect
uniform vec4 uDofA;  // focus view depth, focus uv.y, depth scale kD, depth weight
uniform vec4 uDofB;  // half band, ramp, max blur (px, drawing buffer), near gain
uniform vec4 uDofC;  // far gain, enabled, sage grade amount (composite), -
float viewZ( float d ) { return ( uProj.x * uProj.y ) / ( uProj.y - d * ( uProj.y - uProj.x ) ); }
float cocAt( vec2 uv, float z ) {
  float sY = uv.y - uDofA.y;
  float sD = ( z - uDofA.x ) / uDofA.x * uDofA.z;
  float c = mix( sY, sD, uDofA.w );
  float a = min( max( abs( c ) - uDofB.x, 0.0 ) / uDofB.y, 1.0 );
  a = a * a * ( 3.0 - 2.0 * a ) * 0.35 + a * 0.65;
  float g = c < 0.0 ? uDofB.w : uDofC.x;
  return sign( c ) * min( a * g, 1.0 ) * uDofB.z * uDofC.y;
}
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
// World-space light falloff applied to the lit image (works for every material in the scene):
// the key side (screen-left) is brighter and warmer, the fill side dimmer and cooler, and everything
// fades to the dark surround with distance from the focus point (fog-to-dark at the far page).
uniform mat4 uCamWorld;
uniform vec4 uGobo;   // screen-right axis on the ground (x, z), 1 / radius, key falloff
uniform vec4 uGobo2;  // tint, fade start, fade end, fade amount
uniform vec3 uFocusW;
uniform vec3 uFadeA;
uniform vec3 uFadeB;
vec3 gradeWorld( vec3 col, vec2 uv, float z, float rawDepth ) {
  vec3 pv = vec3( ( uv * 2.0 - 1.0 ) * vec2( uProj.z * uProj.w, uProj.z ) * z, - z );
  vec2 rel = ( uCamWorld * vec4( pv, 1.0 ) ).xz - uFocusW.xz;
  float t = clamp( dot( rel, uGobo.xy ) * uGobo.z, -1.0, 1.0 );
  col *= ( 1.0 - uGobo.w * t ) * vec3( 1.0 - uGobo2.x * 0.5 * t, 1.0, 1.0 + uGobo2.x * t );
  float f = rawDepth >= 0.99999 ? 1.0 : smoothstep( uGobo2.y, uGobo2.z, length( rel ) );
  return mix( col, mix( uFadeA, uFadeB, smoothstep( -0.5, 0.9, t ) ), f * uGobo2.w );
}
`;

const AO_FRAG = COMMON + /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uTexel;   // full-res texel
uniform vec4 uAo;      // radius (world), intensity, bias (world), -
vec3 vpos( vec2 uv ) {
  float z = viewZ( textureLod( tDepth, uv, 0.0 ).r );
  return vec3( ( uv * 2.0 - 1.0 ) * vec2( uProj.z * uProj.w, uProj.z ) * z, - z );
}
void main() {
  float d0 = textureLod( tDepth, vUv, 0.0 ).r;
  if ( d0 >= 0.99999 ) { gl_FragColor = vec4( 1.0 ); return; }
  vec3 P = vpos( vUv );
  vec2 t = uTexel * 2.0;
  vec3 pr = vpos( vUv + vec2( t.x, 0.0 ) ), pl = vpos( vUv - vec2( t.x, 0.0 ) );
  vec3 pu = vpos( vUv + vec2( 0.0, t.y ) ), pd = vpos( vUv - vec2( 0.0, t.y ) );
  vec3 dxv = abs( pr.z - P.z ) < abs( P.z - pl.z ) ? pr - P : P - pl;
  vec3 dyv = abs( pu.z - P.z ) < abs( P.z - pd.z ) ? pu - P : P - pd;
  vec3 N = normalize( cross( dxv, dyv ) );
  float z = - P.z;
  float rUv = uAo.x / ( 2.0 * z * uProj.z );
  float phi = ign( gl_FragCoord.xy ) * 6.2831853;
  float occ = 0.0;
  for ( int i = 0; i < AO_TAPS; i ++ ) {
    float fi = float( i );
    float r = sqrt( ( fi + 0.5 ) / float( AO_TAPS ) );
    float a = fi * 2.399963229728653 + phi;
    vec2 o = vec2( cos( a ), sin( a ) ) * r * rUv;
    vec3 v = vpos( vUv + vec2( o.x / uProj.w, o.y ) ) - P;
    float dv = dot( v, v );
    float fall = clamp( 1.0 - dv / ( uAo.x * uAo.x ), 0.0, 1.0 );
    occ += min( max( dot( v, N ) - uAo.z, 0.0 ) / ( dv + 1e-4 ) * uAo.x, 1.6 ) * fall;
  }
  float ao = clamp( 1.0 - uAo.y * occ / float( AO_TAPS ), 0.0, 1.0 );
  gl_FragColor = vec4( ao, ao, ao, 1.0 );
}
`;

const PRE_FRAG = COMMON + /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tAo;
uniform vec2 uTexel;    // full-res texel
uniform vec3 uAoTint;
uniform float uAoOn;
void main() {
  vec3 acc = vec3( 0.0 );
  float wsum = 0.0;
  float coc = 0.0;
  for ( int i = 0; i < 4; i ++ ) {
    vec2 o = ( vec2( float( i & 1 ), float( i >> 1 ) ) - 0.5 ) * uTexel;
    vec2 uv = vUv + o;
    float dr = textureLod( tDepth, uv, 0.0 ).r;
    float zz = viewZ( dr );
    float c = cocAt( uv, zz );
    // favour the blurrier samples so a sharp foreground edge never leaks its colour into the blur buffer
    float w = 0.02 + abs( c );
    acc += gradeWorld( min( textureLod( tScene, uv, 0.0 ).rgb, vec3( 24.0 ) ), uv, zz, dr ) * w;
    wsum += w;
    if ( abs( c ) > abs( coc ) ) coc = c;
  }
  vec3 col = acc / wsum;
  if ( uAoOn > 0.5 ) {
    vec2 t = uTexel * 2.0;
    float ao = 0.25 * ( texture2D( tAo, vUv + t * vec2( 0.5, 0.5 ) ).r + texture2D( tAo, vUv + t * vec2( -0.5, 0.5 ) ).r
      + texture2D( tAo, vUv + t * vec2( 0.5, -0.5 ) ).r + texture2D( tAo, vUv + t * vec2( -0.5, -0.5 ) ).r );
    col *= mix( uAoTint, vec3( 1.0 ), ao );
  }
  gl_FragColor = vec4( col, coc );
}
`;

const TILE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPre;
uniform vec2 uHalfTexel;
void main() {
  float m = 0.0;
  for ( int y = 0; y < 4; y ++ ) {
    for ( int x = 0; x < 4; x ++ ) {
      vec2 o = ( vec2( float( x ), float( y ) ) - 1.5 ) * uHalfTexel;
      m = max( m, - textureLod( tPre, vUv + o, 0.0 ).a );
    }
  }
  gl_FragColor = vec4( m, 0.0, 0.0, 1.0 );
}
`;

const GATHER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPre;
uniform sampler2D tTile;
uniform vec2 uTexel;       // full-res texel
uniform vec2 uTileTexel;
uniform vec2 uTaps[ DOF_TAPS ];
uniform float uBoost;
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
void main() {
  vec4 c0 = textureLod( tPre, vUv, 0.0 );
  float cc = c0.a;
  float nearMax = texture2D( tTile, vUv ).r;
  nearMax = max( nearMax, texture2D( tTile, vUv + uTileTexel * vec2( 1.3, 1.3 ) ).r );
  nearMax = max( nearMax, texture2D( tTile, vUv + uTileTexel * vec2( -1.3, 1.3 ) ).r );
  nearMax = max( nearMax, texture2D( tTile, vUv + uTileTexel * vec2( 1.3, -1.3 ) ).r );
  nearMax = max( nearMax, texture2D( tTile, vUv + uTileTexel * vec2( -1.3, -1.3 ) ).r );
  // dilate only for a real foreground silhouette; inside a smooth ramp the pixel keeps its own radius
  // (otherwise most taps fall outside its own disc and the result turns blocky)
  float R = mix( abs( cc ), max( abs( cc ), nearMax ), smoothstep( 2.0, 6.0, nearMax - abs( cc ) ) );
  if ( R < 0.6 ) { gl_FragColor = vec4( c0.rgb, 0.0 ); return; }
  float phi = ign( gl_FragCoord.xy ) * 6.2831853;
  float cs = cos( phi ), sn = sin( phi );
  mat2 rot = mat2( cs, sn, - sn, cs );
  vec3 acc = c0.rgb * 0.15;
  float wsum = 0.15;
  float nearW = 0.0;
  float wnorm = 0.0;
  for ( int i = 0; i < DOF_TAPS; i ++ ) {
    vec2 o = rot * uTaps[ i ];
    float tr = length( uTaps[ i ] );
    float d = tr * R;
    vec4 s = textureLod( tPre, vUv + o * R * uTexel, 0.0 );
    float sAbs = abs( s.a );
    // a tap behind the centre may not spread further than the centre is blurred itself
    if ( s.a > cc ) sAbs = min( sAbs, abs( cc ) * 2.0 );
    // taps are denser toward the centre (r = u^0.75); tr^(2/3) restores the area weighting
    float w = smoothstep( d - 1.0, d + 1.0, sAbs ) * pow( tr, 0.6667 );
    // near weight ramps in like the far-side blend (a hard step at -0.5 px drew a visible line where the
    // full-res sharp layer switched to the half-res layer on a smooth near-field ramp)
    float isNear = w * smoothstep( 1.0, 3.4, - s.a );
    wnorm += pow( tr, 0.6667 );
    w *= 1.0 + uBoost * min( luma( s.rgb ), 6.0 );
    acc += s.rgb * w;
    wsum += w;
    nearW += isNear;
  }
  gl_FragColor = vec4( acc / wsum, clamp( 2.0 * nearW / max( wnorm, 1e-3 ), 0.0, 1.0 ) );
}
`;

const FILL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tGather;
uniform sampler2D tPre;
uniform vec2 uTexel;     // full-res texel
uniform vec2 uFill;      // spacing factor, max blur px
void main() {
  vec4 c = texture2D( tGather, vUv );
  float R = max( abs( textureLod( tPre, vUv, 0.0 ).a ), c.a * uFill.y * 0.6 );
  float f = clamp( R * uFill.x, 0.0, 5.0 );
  vec2 o = uTexel * f;
  vec4 s = c * 0.3;
  s += texture2D( tGather, vUv + vec2( o.x, o.y * 0.4 ) ) * 0.175;
  s += texture2D( tGather, vUv + vec2( - o.x, - o.y * 0.4 ) ) * 0.175;
  s += texture2D( tGather, vUv + vec2( - o.x * 0.4, o.y ) ) * 0.175;
  s += texture2D( tGather, vUv + vec2( o.x * 0.4, - o.y ) ) * 0.175;
  gl_FragColor = s;
}
`;

const BLOOM_DOWN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPre;
uniform vec2 uHalfTexel;
uniform float uThreshold;
vec3 bright( vec2 uv ) {
  vec3 c = texture2D( tPre, uv ).rgb;
  float l = max( c.r, max( c.g, c.b ) );
  return c * clamp( ( l - uThreshold ) / max( l, 1e-4 ), 0.0, 1.0 );
}
void main() {
  vec3 c = bright( vUv + uHalfTexel * vec2( 1.0, 1.0 ) ) + bright( vUv + uHalfTexel * vec2( -1.0, 1.0 ) )
    + bright( vUv + uHalfTexel * vec2( 1.0, -1.0 ) ) + bright( vUv + uHalfTexel * vec2( -1.0, -1.0 ) );
  gl_FragColor = vec4( min( c * 0.25, vec3( 8.0 ) ), 1.0 );
}
`;

const BLOOM_BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uDir;   // texel * direction
void main() {
  vec3 c = texture2D( tSrc, vUv ).rgb * 0.227027;
  c += ( texture2D( tSrc, vUv + uDir * 1.384615 ).rgb + texture2D( tSrc, vUv - uDir * 1.384615 ).rgb ) * 0.316216;
  c += ( texture2D( tSrc, vUv + uDir * 3.230769 ).rgb + texture2D( tSrc, vUv - uDir * 3.230769 ).rgb ) * 0.070270;
  gl_FragColor = vec4( c, 1.0 );
}
`;

const COMPOSITE_FRAG = COMMON + /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBlur;
uniform sampler2D tBloom;
uniform sampler2D tSpill;
uniform float uSpill;
uniform sampler2D tAo;
uniform vec2 uTexel;       // full-res texel
uniform vec4 uTone;        // exposure, contrast, saturation, shadow lift
uniform vec3 uShadowTint;
uniform vec4 uLens;        // vignette, grain, grain size, chroma (px)
uniform vec4 uFx;          // bloom, ao on, rim strength, split
uniform vec3 uAoTint;
uniform vec3 uRimColor;
uniform vec3 uSeed;        // frame seed, rim width px, view mode
uniform float uSharpen;
uniform vec3 uTint;
vec3 aces( vec3 x ) { return clamp( ( x * ( 2.51 * x + 0.03 ) ) / ( x * ( 2.43 * x + 0.59 ) + 0.14 ), 0.0, 1.0 ); }
vec3 toSRGB( vec3 c ) { return mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) ); }
float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
void main() {
  float rawD = textureLod( tDepth, vUv, 0.0 ).r;
  float z = viewZ( rawD );
  float coc = cocAt( vUv, z );
  float rw = uSeed.y;
  vec2 ox = vec2( uTexel.x * rw, 0.0 ), oy = vec2( 0.0, uTexel.y * rw );
  float zl = viewZ( textureLod( tDepth, vUv - ox, 0.0 ).r ), zr = viewZ( textureLod( tDepth, vUv + ox, 0.0 ).r );
  float zd = viewZ( textureLod( tDepth, vUv - oy, 0.0 ).r ), zu = viewZ( textureLod( tDepth, vUv + oy, 0.0 ).r );

  // --- sharp layer (very slight chromatic softness toward the frame edge) -----------------------------
  vec3 sharp = textureLod( tScene, vUv, 0.0 ).rgb;
  #ifdef POST_CHROMA
    vec2 cd = ( vUv - 0.5 );
    vec2 co = cd * dot( cd, cd ) * 4.0 * uLens.w * uTexel;
    sharp.r = textureLod( tScene, vUv + co, 0.0 ).r;
    sharp.b = textureLod( tScene, vUv - co, 0.0 ).b;
  #endif
  #ifdef POST_SHARPEN
    // 4 taps around the pixel: an unsharp mask inside the focus band (bite of a real macro lens; the
    // MSAA resolve is soft), turning into a small full-res blur for CoC 0.5-3 px so detail fades out
    // gradually before the half-res bokeh layer takes over.
    float ac = abs( coc );
    vec2 mo = uTexel * max( 0.75, ac * 0.8 );
    vec3 sb = 0.25 * ( textureLod( tScene, vUv + mo * vec2( 1.0, 0.4 ), 0.0 ).rgb + textureLod( tScene, vUv + mo * vec2( -1.0, -0.4 ), 0.0 ).rgb
      + textureLod( tScene, vUv + mo * vec2( -0.4, 1.0 ), 0.0 ).rgb + textureLod( tScene, vUv + mo * vec2( 0.4, -1.0 ), 0.0 ).rgb );
    vec3 crisp = max( sharp + clamp( sharp - sb, vec3( -0.25 ), vec3( 0.25 ) ) * uSharpen, vec3( 0.0 ) );
    sharp = mix( crisp, mix( sharp, sb, 0.8 ), smoothstep( 0.4, 1.6, ac ) );
  #endif
  sharp = gradeWorld( sharp, vUv, z, rawD );
  #ifdef POST_AO
    if ( uFx.y > 0.5 ) {
      vec2 t = uTexel * 2.0;
      float ao = 0.25 * ( texture2D( tAo, vUv + t * vec2( 0.6, 0.6 ) ).r + texture2D( tAo, vUv + t * vec2( -0.6, 0.6 ) ).r
        + texture2D( tAo, vUv + t * vec2( 0.6, -0.6 ) ).r + texture2D( tAo, vUv + t * vec2( -0.6, -0.6 ) ).r );
      sharp *= mix( uAoTint, vec3( 1.0 ), ao );
    }
  #endif

  // --- pale paper-core line where this pixel is the front side of a depth silhouette ---------------
  // gold pass: two rings (inner axis taps + outer diagonal taps) give a smooth 2-3 px cream band instead of a 1 px
  // dotted line; the depth step is relative to the view distance so far cards keep their rim; no block jitter.
  float zfar = max( max( zl, zr ), max( zd, zu ) );
  vec2 od = uTexel * rw * 1.55;
  float zfar2 = max( max( viewZ( textureLod( tDepth, vUv + od, 0.0 ).r ), viewZ( textureLod( tDepth, vUv - od, 0.0 ).r ) ),
    max( viewZ( textureLod( tDepth, vUv + vec2( od.x, - od.y ), 0.0 ).r ), viewZ( textureLod( tDepth, vUv + vec2( - od.x, od.y ), 0.0 ).r ) ) );
  float zs = 0.0035 * z;
  // fixer (round 3): uFx.z < 0 = DARK card edge - the cream band read as a white sticker halo round every piece
  // (gold: a thin darker card edge); then uRimColor is a multiplier on the piece's own colour
  float rim = max( smoothstep( zs, zs * 2.6, zfar - z ), 0.55 * smoothstep( zs * 1.4, zs * 3.4, zfar2 - z ) ) * abs( uFx.z );
  if ( rim > 0.0 ) {
    rim *= 1.0 - smoothstep( 1.5, 4.0, abs( coc ) );
    float mc = max( sharp.r, max( sharp.g, sharp.b ) );
    vec3 target = uFx.z < 0.0 ? sharp * uRimColor : max( uRimColor * clamp( mc * 1.7 + 0.012, 0.0, 0.95 ), sharp );
    sharp = mix( sharp, target, clamp( rim, 0.0, 1.0 ) );
  }

  // --- blur layer; the lookup is pushed away from sharp silhouettes so they do not halo -------------
  vec2 g = vec2( abs( cocAt( vUv + ox, zr ) ) - abs( cocAt( vUv - ox, zl ) ), abs( cocAt( vUv + oy, zu ) ) - abs( cocAt( vUv - oy, zd ) ) );
  float gl = length( g );
  vec2 shift = gl > 1e-4 ? g / gl * min( gl * 0.35, 1.0 ) * 2.2 : vec2( 0.0 );
  vec4 blur = texture2D( tBlur, vUv + shift * uTexel );
  #ifdef POST_SHARPEN
    float blend = max( smoothstep( 1.2, 3.6, abs( coc ) ), blur.a );
  #else
    float blend = max( smoothstep( 0.5, 2.2, abs( coc ) ), blur.a );
  #endif
  vec3 col = mix( sharp, blur.rgb, blend * uDofC.y );

  #ifdef POST_BLOOM
    col += texture2D( tBloom, vUv ).rgb * uFx.x;
    // screen-space light spill: the very wide blur of the glowing panes / lantern lights the paper around them
    if ( uSpill > 0.0 ) {
      vec3 sp = texture2D( tSpill, vUv ).rgb;
      float cl = max( col.r, max( col.g, col.b ) );
      col += sp * uSpill * ( col * 5.0 + 0.035 ) * ( 1.0 - smoothstep( 0.5, 1.4, cl ) );
    }
  #endif

  // --- lens + film ------------------------------------------------------------------------------------
  vec2 vc = ( vUv - 0.5 ) * vec2( uProj.w / 1.7778, 1.0 ) * vec2( 1.0, 1.12 );
  float vr = dot( vc, vc ) * 2.4;
  col *= 1.0 - uLens.x * smoothstep( 0.12, 1.25, vr ) * 1.25;
  col = aces( col * uTone.x * uTint );
  float l = luma( col );
  col = mix( vec3( l ), col, uTone.z );
  col = toSRGB( max( col, 0.0 ) );
  col = ( col - 0.42 ) * uTone.y + 0.42;
  // yellow-green field under the warm key reads as video-game grass: pull only those hues toward sage
  // (cream, ochre, terracotta and the teal river are outside the mask)
  float gm = smoothstep( 0.1, 0.3, col.g - col.b ) * smoothstep( -0.2, -0.05, col.g - col.r ) * uDofC.z;
  col = mix( col, mix( vec3( luma( col ) ), col, 0.45 ) * vec3( 0.97, 1.0, 1.03 ), clamp( gm, 0.0, 1.0 ) );
  col += uShadowTint * uTone.w * ( 1.0 - smoothstep( 0.0, 0.45, l ) );
  float sx = vUv.x * 2.0 - 1.0;
  col *= vec3( 1.0 - uFx.w * sx, 1.0 - uFx.w * 0.25 * sx, 1.0 + uFx.w * 1.3 * sx );
  #ifdef POST_GRAIN
    vec2 gp = gl_FragCoord.xy / uLens.z;
    vec2 gi = floor( gp ), gf = fract( gp );
    vec2 so = vec2( uSeed.x * 0.618, uSeed.x * 0.377 );
    float n00 = hash12( gi + so ), n10 = hash12( gi + vec2( 1.0, 0.0 ) + so ), n01 = hash12( gi + vec2( 0.0, 1.0 ) + so ), n11 = hash12( gi + vec2( 1.0, 1.0 ) + so );
    float n = mix( mix( n00, n10, gf.x ), mix( n01, n11, gf.x ), gf.y ) + hash12( gl_FragCoord.xy + so * 1.7 ) * 0.5 - 0.75;
    float gl2 = luma( col );
    col += n * uLens.y * 2.2 * ( 0.35 + 1.3 * sqrt( clamp( gl2, 0.0, 1.0 ) ) * ( 1.0 - 0.6 * gl2 ) );
  #endif
  if ( uSeed.z > 0.5 ) {
    if ( uSeed.z < 1.5 ) col = vec3( max( coc, 0.0 ), max( - coc, 0.0 ), blur.a * uDofB.z ) / uDofB.z;
    else if ( uSeed.z < 2.5 ) col = vec3( texture2D( tAo, vUv ).r );
    else if ( uSeed.z < 3.5 ) col = toSRGB( aces( blur.rgb ) );
    else col = toSRGB( aces( textureLod( tScene, vUv, 0.0 ).rgb ) );
  }
  gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
}
`;

// ---- JS mirror of the tone curve (to pre-compensate colours that must come out exact on screen) -------
function acesJS(x) { return Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))); }
function toSRGBJS(c) { return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
function toneJS(rgb, P) {
  const tint = P.tint || [1, 1, 1];
  const t = rgb.map((v, i) => acesJS(v * P.exposure * tint[i]));
  const l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  return t.map((v) => {
    const s = toSRGBJS(Math.max(0, l + (v - l) * P.saturation));
    return (s - 0.42) * P.contrast + 0.42 + 0; // shadow lift left out (tiny)
  });
}
/** Linear scene colour whose tone-mapped result is the given sRGB hex (centre of frame, no vignette/grain). */
function inverseTone(hex, P, out) {
  const target = new THREE.Color(hex);
  const want = [0, 0, 0];
  target.getRGB(_rgb, THREE.SRGBColorSpace);
  want[0] = _rgb.r; want[1] = _rgb.g; want[2] = _rgb.b;
  const x = [0.02, 0.02, 0.02];
  for (let it = 0; it < 60; it++) {
    const got = toneJS(x, P);
    for (let i = 0; i < 3; i++) {
      const ratio = (want[i] + 0.02) / (Math.max(got[i], -0.015) + 0.02);
      x[i] = Math.min(8, Math.max(1e-5, x[i] * Math.pow(ratio, 0.8)));
    }
  }
  return out.setRGB(x[0], x[1], x[2], THREE.LinearSRGBColorSpace);
}
const _rgb = { r: 0, g: 0, b: 0 };

function vogelTaps(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.pow((i + 0.5) / n, 0.75);
    const a = i * 2.399963229728653;
    out.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return out;
}

export function createPost({ renderer, scene, camera, quality = 'high' }) {
  let q = qualitySettings(quality);
  let qLevel = quality;
  let focus = null;
  let width = 2;
  let height = 2;
  const canFloat = renderer.capabilities.isWebGL2 !== false && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  const hdrType = canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(tri, null);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const shared = {
    uProj: { value: new THREE.Vector4(1, 120, 0.27, 1.78) },
    uDofA: { value: new THREE.Vector4(17, 0.45, 2.7, 0.6) },
    uDofB: { value: new THREE.Vector4(0.1, 0.3, 18, 1.3) },
    uDofC: { value: new THREE.Vector4(1, 1, 0, 0) },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uAoTint: { value: new THREE.Color() },
  };
  const common = {
    uProj: { value: new THREE.Vector4(1, 120, 0.27, 1.78) },
    uDofA: { value: new THREE.Vector4(17, 0.45, 2.7, 0.6) },
    uDofB: { value: new THREE.Vector4(0.1, 0.3, 18, 1.3) },
    uDofC: { value: new THREE.Vector4(1, 1, 0, 0) },
    uCamWorld: { value: new THREE.Matrix4() },
    uGobo: { value: new THREE.Vector4(1, 0, 1 / 9, 0.3) },
    uGobo2: { value: new THREE.Vector4(0.1, 6, 12, 0.9) },
    uFocusW: { value: new THREE.Vector3() },
    uFadeA: { value: new THREE.Color() },
    uFadeB: { value: new THREE.Color() },
  };
  shared.uProj = common.uProj; shared.uDofA = common.uDofA; shared.uDofB = common.uDofB; shared.uDofC = common.uDofC;
  function mat(fragmentShader, uniforms, defines = {}) {
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });
  }
  const M = {};
  function buildMaterials() {
    for (const k in M) M[k].dispose();
    M.ao = mat(AO_FRAG, { ...common, tDepth: { value: null }, uTexel: shared.uTexel, uAo: { value: new THREE.Vector4(0.22, 0.85, 0.012, 0) } }, { AO_TAPS: Math.max(1, q.aoTaps || 1) });
    M.pre = mat(PRE_FRAG, { ...common, tScene: { value: null }, tDepth: { value: null }, tAo: { value: null }, uTexel: shared.uTexel, uAoTint: shared.uAoTint, uAoOn: { value: 0 } });
    M.tile = mat(TILE_FRAG, { tPre: { value: null }, uHalfTexel: { value: new THREE.Vector2() } });
    M.gather = mat(GATHER_FRAG, { tPre: { value: null }, tTile: { value: null }, uTexel: shared.uTexel, uTileTexel: { value: new THREE.Vector2() }, uTaps: { value: vogelTaps(q.dofTaps) }, uBoost: { value: 0.3 } }, { DOF_TAPS: q.dofTaps });
    M.fill = mat(FILL_FRAG, { tGather: { value: null }, tPre: { value: null }, uTexel: shared.uTexel, uFill: { value: new THREE.Vector2(0.2, 18) } });
    M.bloomDown = mat(BLOOM_DOWN_FRAG, { tPre: { value: null }, uHalfTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 } });
    M.bloomBlur = mat(BLOOM_BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    const defs = {};
    if (q.chroma) defs.POST_CHROMA = 1;
    if (q.aoTaps > 0) defs.POST_AO = 1;
    if (q.bloom) defs.POST_BLOOM = 1;
    if (q.grain) defs.POST_GRAIN = 1;
    if (q.sharpen) defs.POST_SHARPEN = 1;
    M.composite = mat(COMPOSITE_FRAG, {
      ...common,
      tScene: { value: null }, tDepth: { value: null }, tBlur: { value: null }, tBloom: { value: null }, tSpill: { value: null }, uSpill: { value: 0 }, tAo: { value: null },
      uTexel: shared.uTexel, uTone: { value: new THREE.Vector4(1, 1, 1, 0) }, uShadowTint: { value: new THREE.Color() },
      uLens: { value: new THREE.Vector4(0.2, 0.02, 1.3, 0.5) }, uFx: { value: new THREE.Vector4(0.5, 1, 0.3, 0.04) },
      uAoTint: shared.uAoTint, uRimColor: { value: new THREE.Color() }, uSeed: { value: new THREE.Vector3(0, 1, 0) }, uSharpen: { value: 0.3 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    }, defs);
  }
  buildMaterials();

  // ---- render targets -------------------------------------------------------------------------------
  const T = {};
  function target(w, h, opts = {}) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: opts.type ?? hdrType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: !!opts.depth, stencilBuffer: false, samples: opts.samples || 0, generateMipmaps: false,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  }
  function buildTargets() {
    for (const k in T) { if (T[k].depthTexture) T[k].depthTexture.dispose(); T[k].dispose(); }
    const w = width;
    const h = height;
    const hw = Math.max(1, Math.round(w * (q.postScale || 0.5)));
    const hh = Math.max(1, Math.round(h * (q.postScale || 0.5)));
    T.scene = target(w, h, { depth: true, samples: canFloat ? q.msaa || 0 : 0 });
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depth.format = THREE.DepthFormat;
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    T.scene.depthTexture = depth;
    T.ao = target(hw, hh, { type: THREE.UnsignedByteType });
    T.pre = target(hw, hh);
    T.gather = target(hw, hh);
    T.fill = target(hw, hh);
    T.tile = target(Math.max(1, Math.ceil(hw / 4)), Math.max(1, Math.ceil(hh / 4)));
    T.bloomA = target(Math.max(1, hw >> 1), Math.max(1, hh >> 1));
    T.bloomB = target(Math.max(1, hw >> 1), Math.max(1, hh >> 1));
    T.spillA = target(Math.max(1, hw >> 3), Math.max(1, hh >> 3));
    T.spillB = target(Math.max(1, hw >> 3), Math.max(1, hh >> 3));
    shared.uTexel.value.set(1 / w, 1 / h);
  }

  function resize() {
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(2, Math.floor(_size.x));
    const h = Math.max(2, Math.floor(_size.y));
    if (w !== width || h !== height || !T.scene) { width = w; height = h; buildTargets(); }
  }
  const _size = new THREE.Vector2();
  const _v = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _bg = new THREE.Color();
  let toneKey = '';
  resize();

  function pass(material, rt) {
    quad.material = material;
    renderer.setRenderTarget(rt);
    renderer.render(quadScene, quadCam);
  }

  function updateUniforms() {
    const D = CONFIG.dof;
    const P = CONFIG.post;
    camera.updateMatrixWorld();
    const tanHalf = camera.isPerspectiveCamera ? Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) : 0.27;
    shared.uProj.value.set(camera.near, camera.far, tanHalf, camera.aspect || width / height);
    _m.copy(camera.matrixWorld).invert();
    // focus point in view space
    let fz = 17;
    let fy = 0.5;
    if (focus) {
      _v.copy(focus).applyMatrix4(_m);
      if (_v.z < -0.01) { fz = -_v.z; fy = 0.5 + (0.5 * _v.y) / (fz * tanHalf); }
    }
    const e = camera.matrixWorld.elements;
    const sinP = Math.min(0.9999, Math.max(0.05, e[9])); // -forward.y
    const cot = Math.max(0.1, Math.sqrt(1 - sinP * sinP) / sinP);
    const kD = Math.min(9, 1 / (2 * Math.atan(tanHalf) * cot));
    shared.uDofA.value.set(fz, Math.min(0.9, Math.max(0.1, fy)), kD, D.depthWeight);
    // a close camera (macro framing) keeps a taller band sharp, like the close-up references
    const bandScale = Math.min(D.closeBandScale ?? 1.8, Math.max(1, 12 / fz));
    shared.uDofB.value.set((D.focusBand * bandScale) / 2, Math.max(0.02, D.ramp), (D.maxBlurPx * height) / 1080, D.nearGain);
    shared.uDofC.value.set(D.farGain, api.enabled ? 1 : 0, P.greenDesat ?? 0, 0);
    setColorCached(shared.uAoTint.value, P.aoTint);
    // world-space falloff (gobo + fade to the surround), scaled with the camera distance
    const G = CONFIG.lights.gobo;
    const F = CONFIG.lights.fade;
    const ks = Math.min(3, Math.max(0.82, fz / 17));
    let rx = e[0];
    let rz = e[2];
    const rl = hypot2(rx, rz) || 1;
    rx /= rl; rz /= rl;
    common.uCamWorld.value.copy(camera.matrixWorld);
    // the left/right falloff spans the visible width at any camera distance
    common.uGobo.value.set(rx, rz, 1 / Math.max(0.5, G.radius * Math.min(3, fz / 17)), api.enabled ? G.key * (1 - (G.closeRelief ?? 0) * Math.min(1, Math.max(0, (8 - fz) / 4))) : 0);
    common.uGobo2.value.set(api.enabled ? G.tint : 0, F.start * ks, F.end * ks, api.enabled ? F.amount : 0);
    if (focus) common.uFocusW.value.copy(focus);
    const ao = M.ao.uniforms.uAo.value;
    ao.set(P.aoRadius, P.ao, 0.012, 0);
    M.gather.uniforms.uBoost.value = D.highlightBoost;
    M.fill.uniforms.uFill.value.set(1.9 / Math.sqrt(q.dofTaps), (D.maxBlurPx * height) / 1080);
    M.bloomDown.uniforms.uThreshold.value = P.bloomThreshold;
    const c = M.composite.uniforms;
    // macro framing (camera closer than ~8 units): stop down a little so lit cream paper does not clip
    const closeT = Math.min(1, Math.max(0, (8 - fz) / 4));
    c.uTone.value.set(P.exposure * (1 + ((P.closeExposure ?? 1) - 1) * closeT), P.contrast, P.saturation, P.shadowLift);
    if (setColorCached(c.uShadowTint.value, P.shadowTint)) c.uShadowTint.value.convertLinearToSRGB();
    c.uLens.value.set(P.vignette, q.grain ? P.grain : 0, Math.max(1, (P.grainSize * height) / 900), (P.chroma * height) / 1080);
    c.uFx.value.set(P.bloom, q.aoTaps > 0 && P.ao > 0 && api.enabled ? 1 : 0, api.enabled ? P.edgeRim * (P.edgeRimDark ? -1 : 1) : 0, P.split);
    setColorCached(c.uRimColor.value, (P.edgeRimDark ? P.edgeRimDarkColor : P.edgeRimColor) || CONFIG.palette.cutEdge);
    c.uSharpen.value = api.enabled ? P.sharpen ?? 0 : 0;
    const tint = P.tint || [1, 1, 1];
    c.uTint.value.set(tint[0], tint[1], tint[2]);
    c.uSeed.value.set(Math.floor(state.time * 60) % 1024, (P.edgeRimPx ?? 1.25) * Math.max(1, height / 900) * (fz < 9 ? 1.5 : 1), api.view || 0);
    // colours that must come out exact after the tone curve
    const key = [P.exposure, P.contrast, P.saturation, (P.tint || []).join(), CONFIG.lights.background, CONFIG.lights.fade.color, CONFIG.lights.fade.colorRight].join('|');
    if (key !== toneKey) {
      toneKey = key;
      inverseTone(CONFIG.lights.background, P, _bg);
      inverseTone(CONFIG.lights.fade.color, P, common.uFadeA.value);
      inverseTone(CONFIG.lights.fade.colorRight || CONFIG.lights.fade.color, P, common.uFadeB.value);
    }
    if (scene.background && scene.background.isColor) scene.background.copy(_bg);
  }

  const api = {
    enabled: true,
    /** Debug view for check scripts: 0 final, 1 CoC, 2 AO, 3 blur layer, 4 scene without post. */
    view: 0,
    /** Render the frame to the canvas (the ONLY place that draws to the default framebuffer). */
    render(dt) {
      resize();
      updateUniforms();
      const full = api.enabled;
      const prevAuto = renderer.autoClear;
      renderer.autoClear = true;

      // water (shortfall pass): planar mirror pass for the page's water; a no-op unless inked water is in view
      renderReflection(renderer, scene, camera, width, height, qLevel);
      renderer.autoClear = true;
      renderer.setRenderTarget(T.scene);
      renderer.render(scene, camera);

      const depth = T.scene.depthTexture;
      const aoOn = full && q.aoTaps > 0 && CONFIG.post.ao > 0;
      if (aoOn) {
        M.ao.uniforms.tDepth.value = depth;
        pass(M.ao, T.ao);
      }
      if (full) {
        const pu = M.pre.uniforms;
        pu.tScene.value = T.scene.texture; pu.tDepth.value = depth; pu.tAo.value = T.ao.texture; pu.uAoOn.value = aoOn ? 1 : 0;
        pass(M.pre, T.pre);
        M.tile.uniforms.tPre.value = T.pre.texture;
        M.tile.uniforms.uHalfTexel.value.set(1 / T.pre.width, 1 / T.pre.height);
        pass(M.tile, T.tile);
        const gu = M.gather.uniforms;
        gu.tPre.value = T.pre.texture; gu.tTile.value = T.tile.texture; gu.uTileTexel.value.set(1 / T.tile.width, 1 / T.tile.height);
        pass(M.gather, T.gather);
        M.fill.uniforms.tGather.value = T.gather.texture; M.fill.uniforms.tPre.value = T.pre.texture;
        pass(M.fill, T.fill);
        if (q.bloom && CONFIG.post.bloom > 0) {
          M.bloomDown.uniforms.tPre.value = T.pre.texture;
          M.bloomDown.uniforms.uHalfTexel.value.set(1 / T.pre.width, 1 / T.pre.height);
          pass(M.bloomDown, T.bloomA);
          M.bloomBlur.uniforms.tSrc.value = T.bloomA.texture;
          M.bloomBlur.uniforms.uDir.value.set(1 / T.bloomA.width, 0);
          pass(M.bloomBlur, T.bloomB);
          M.bloomBlur.uniforms.tSrc.value = T.bloomB.texture;
          M.bloomBlur.uniforms.uDir.value.set(0, 1 / T.bloomA.height);
          pass(M.bloomBlur, T.bloomA);
          if ((CONFIG.post.spill ?? 0) > 0) {
            let src = T.bloomA;
            for (let i = 0; i < 3; i++) {
              const k = 1.7 + i * 1.5; // fixer pass: ~1.7x wider pools
              M.bloomBlur.uniforms.tSrc.value = src.texture;
              M.bloomBlur.uniforms.uDir.value.set(k / T.spillA.width, 0);
              pass(M.bloomBlur, T.spillB);
              M.bloomBlur.uniforms.tSrc.value = T.spillB.texture;
              M.bloomBlur.uniforms.uDir.value.set(0, k / T.spillA.height);
              pass(M.bloomBlur, T.spillA);
              src = T.spillA;
            }
          }
        }
      }
      const cu = M.composite.uniforms;
      cu.tScene.value = T.scene.texture; cu.tDepth.value = depth; cu.tBlur.value = T.fill.texture;
      cu.tBloom.value = T.bloomA.texture; cu.tAo.value = T.ao.texture;
      cu.tSpill.value = T.spillA.texture;
      cu.uSpill.value = full && q.bloom && CONFIG.post.bloom > 0 ? CONFIG.post.spill ?? 0 : 0;
      if (!full || !q.bloom || CONFIG.post.bloom <= 0) cu.uFx.value.x = 0;
      pass(M.composite, null);
      renderer.autoClear = prevAuto;
    },
    /** CSS-pixel size; the actual drawing-buffer size is read from the renderer. */
    setSize(w, h) { resize(); },
    /** World-space point that must be sharp (the traveller). Called every frame before render(). */
    setFocus(point) { focus = point; },
    setQuality(level) {
      q = qualitySettings(level);
      qLevel = level;
      buildMaterials();
      buildTargets();
    },
    dispose() {
      for (const k in T) { if (T[k].depthTexture) T[k].depthTexture.dispose(); T[k].dispose(); }
      for (const k in M) M[k].dispose();
      tri.dispose();
    },
  };
  return api;
}
