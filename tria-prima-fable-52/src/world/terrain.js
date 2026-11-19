// The land as meshes: 16 x 16 chunks, three levels of detail each, skirts to hide the seams,
// and the ground shader that paints turf, rock, shingle, salt, ash, snow and mud from the masks.
import * as THREE from 'three';
import { shared, bindShared } from '../gfx/shared.js';
import { worldMaterial } from '../gfx/atmos.js';
import { addPatch, after } from '../gfx/patch.js';
import { SCAR, WORLD } from './heightmap.js';

const CHUNKS = 16;
const CELLS = 32;

const FRAG_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uGroundA;
uniform sampler2DArray uGroundN;
vec4 tpGA(vec2 uv, float layer, vec2 dx, vec2 dy) { return textureGrad(uGroundA, vec3(uv, layer), dx, dy); }
vec4 tpGN(vec2 uv, float layer, vec2 dx, vec2 dy) { return textureGrad(uGroundN, vec3(uv, layer), dx, dy); }
// height blend: the taller surface wins near the seam
float tpHB(float t, float hNew, float hOld) {
  return clamp(((hNew + t) - (hOld + 1.0 - t)) / 0.34 + 0.5, 0.0, 1.0);
}
`;

// Runs after <color_fragment>. Leaves: diffuseColor, tpGroundN (world normal), tpGroundR (roughness).
const FRAG_GROUND = /* glsl */ `
vec3 tpGroundN;
float tpGroundR;
vec3 tpGroundE = vec3(0.0);
{
  vec2 wxz = vTpWorld.xz;
  float wy = vTpWorld.y;
  vec2 luv = tpLandUV(wxz);
  vec4 nrmS = texture2D(uNrmTex, luv);
  vec4 mA = texture2D(uMaskA, luv);
  vec4 mB = texture2D(uMaskB, luv);
  vec4 fx = texture2D(uFxTex, luv);
  vec2 nxz = nrmS.xy * 2.0 - 1.0;
  vec3 wN = vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y);
  float slope = 1.0 - wN.y;
  float bn1 = texture2D(uNoiseTex, wxz * 0.0113).r;
  float bn2 = texture2D(uNoiseTex, wxz * 0.049).g;
  float bn3 = texture2D(uNoiseTex, wxz * 0.0031 + 0.4).b;

  float dist = length(vTpWorld - cameraPosition);
  // far away a 3.6 m tile would shimmer and repeat: read blurrier mips and drop its relief
  float lodk = 1.0 + smoothstep(30.0, 240.0, dist) * 7.0;
  float detail = 1.0 - smoothstep(50.0, 200.0, dist);
  // fine relief turns to glitter under a low sun long before the tile itself shows
  float nDetail = 1.0 - 0.75 * smoothstep(10.0, 60.0, dist);
  vec2 uv = wxz / 3.6;
  vec2 dx = dFdx(uv) * lodk, dy = dFdy(uv) * lodk;

  // turf underneath everything, laid twice at unrelated scales so the eye finds no repeat
  mat2 rotB = mat2(0.7986, -0.6018, 0.6018, 0.7986);
  vec2 uvB = rotB * uv * 0.293 + 0.37;
  vec2 dxB = rotB * dx * 0.293, dyB = rotB * dy * 0.293;
  vec4 a = tpGA(uv, 0.0, dx, dy);
  vec4 n = tpGN(uv, 0.0, dx, dy);
  vec4 aB = tpGA(uvB, 0.0, dxB, dyB);
  float tb = smoothstep(0.3, 0.7, bn2) * 0.6 + smoothstep(20.0, 90.0, dist) * 0.3;
  vec3 col = mix(a.rgb, aB.rgb, tb);
  // the moor is not one colour: straw, heather stain, sour green hollows
  col *= mix(vec3(0.72, 0.76, 0.7), vec3(1.16, 1.08, 0.9), bn1);
  col = mix(col, col * vec3(0.92, 0.66, 0.76), smoothstep(0.6, 0.85, mB.b) * 0.5);
  col = mix(col, col * vec3(0.72, 1.05, 0.7) * 1.1, fx.b);
  float hOld = mix(a.a, aB.a, tb);
  vec2 dn = n.xy * 2.0 - 1.0;
  float rough = n.z, ao = n.a;

  float w;
  // mud and silt by the water
  w = mB.r * smoothstep(0.25, 0.7, mB.r + (bn2 - 0.5) * 0.5);
  if (w > 0.004) {
    vec4 a2 = tpGA(uv, 7.0, dx, dy), n2 = tpGN(uv, 7.0, dx, dy);
    float t = tpHB(w, a2.a, hOld);
    col = mix(col, a2.rgb, t); dn = mix(dn, n2.xy * 2.0 - 1.0, t); rough = mix(rough, n2.z, t); ao = mix(ao, n2.a, t); hOld = mix(hOld, a2.a, t);
  }
  // dark sand below the tide line and wherever the shingle thins
  w = smoothstep(2.8, 1.0, wy + (bn2 - 0.5) * 1.2) * (1.0 - mA.r) * (1.0 - mA.g);
  if (w > 0.004) {
    vec4 a2 = tpGA(uv * 0.8, 7.0, dx * 0.8, dy * 0.8), n2 = tpGN(uv * 0.8, 7.0, dx * 0.8, dy * 0.8);
    float t = tpHB(w, a2.a + 0.1, hOld);
    col = mix(col, a2.rgb * vec3(1.05, 1.0, 0.95), t); dn = mix(dn, n2.xy * 2.0 - 1.0, t); rough = mix(rough, 0.8, t); ao = mix(ao, n2.a, t); hOld = mix(hOld, a2.a, t);
  }
  // shingle along the shore
  w = smoothstep(2.6, 0.9, wy + (bn2 - 0.5) * 1.3 + (bn1 - 0.5) * 1.6) * (1.0 - mA.r) * (1.0 - mB.r * 0.8) * smoothstep(0.25, 0.5, bn1 * 0.6 + bn3 * 0.4 + smoothstep(1.2, 0.2, wy) * 0.3);
  if (w > 0.004) {
    vec4 a2 = tpGA(uv * 1.3, 3.0, dx * 1.3, dy * 1.3), n2 = tpGN(uv * 1.3, 3.0, dx * 1.3, dy * 1.3);
    float t = tpHB(w, a2.a, hOld);
    col = mix(col, a2.rgb, t); dn = mix(dn, n2.xy * 2.0 - 1.0, t); rough = mix(rough, n2.z, t); ao = mix(ao, n2.a, t); hOld = mix(hOld, a2.a, t);
  }
  // salt
  w = mA.r * smoothstep(0.2, 0.62, mA.r + (bn2 - 0.5) * 0.6 - (bn1 - 0.5) * 0.3);
  if (w > 0.004) {
    vec4 a2 = tpGA(uv * 0.6, 4.0, dx * 0.6, dy * 0.6), n2 = tpGN(uv * 0.6, 4.0, dx * 0.6, dy * 0.6);
    float t = tpHB(w, a2.a, hOld);
    col = mix(col, a2.rgb * mix(0.62, 0.86, bn3), t); dn = mix(dn, n2.xy * 2.0 - 1.0, t); rough = mix(rough, n2.z, t); ao = mix(ao, n2.a, t); hOld = mix(hOld, a2.a, t);
  }
  // ash and cooled lava
  w = mA.g;
  if (w > 0.004) {
    vec4 a2 = tpGA(uv * 0.7, 5.0, dx * 0.7, dy * 0.7), n2 = tpGN(uv * 0.7, 5.0, dx * 0.7, dy * 0.7);
    float t = tpHB(w, a2.a, hOld);
    col = mix(col, a2.rgb, t); dn = mix(dn, n2.xy * 2.0 - 1.0, t); rough = mix(rough, n2.z, t); ao = mix(ao, n2.a, t); hOld = mix(hOld, a2.a, t);
  }
  // trodden paths, frayed at the edges
  w = smoothstep(0.3, 0.7, mA.b + (bn2 - 0.5) * 0.45);
  if (w > 0.004) {
    vec4 a2 = tpGA(uv, 1.0, dx, dy), n2 = tpGN(uv, 1.0, dx, dy);
    float t = tpHB(w, a2.a, hOld);
    col = mix(col, a2.rgb, t); dn = mix(dn, n2.xy * 2.0 - 1.0, t); rough = mix(rough, n2.z, t); ao = mix(ao, n2.a, t); hOld = mix(hOld, a2.a, t);
  }
  // rock wherever it is steep: projected from three sides so cliffs do not smear,
  // once at the scale of a hand and once at the scale of the whole cliff
  w = smoothstep(0.2, 0.36, slope + (bn2 - 0.5) * 0.1);
  if (w > 0.004) {
    vec3 bw = pow(abs(wN), vec3(5.0));
    bw /= bw.x + bw.y + bw.z;
    vec2 ux = vTpWorld.zy / 5.0, uy = wxz / 5.0, uz = vTpWorld.xy / 5.0;
    vec4 a2 = tpGA(ux, 2.0, dFdx(ux) * lodk, dFdy(ux) * lodk) * bw.x + tpGA(uy, 2.0, dFdx(uy) * lodk, dFdy(uy) * lodk) * bw.y + tpGA(uz, 2.0, dFdx(uz) * lodk, dFdy(uz) * lodk) * bw.z;
    vec2 mx = vTpWorld.zy / 23.0 + 0.31, mz = vTpWorld.xy / 23.0 + 0.57;
    vec4 a3 = tpGA(mx, 2.0, dFdx(mx), dFdy(mx)) * (bw.x + bw.y * 0.5) + tpGA(mz, 2.0, dFdx(mz), dFdy(mz)) * (bw.z + bw.y * 0.5);
    // (the relief too is taken from the side that faces us, or it smears into streaks down a cliff)
    vec4 n2 = tpGN(ux, 2.0, dFdx(ux) * lodk, dFdy(ux) * lodk) * bw.x + tpGN(uy, 2.0, dFdx(uy) * lodk, dFdy(uy) * lodk) * bw.y + tpGN(uz, 2.0, dFdx(uz) * lodk, dFdy(uz) * lodk) * bw.z;
    n2.z = max(n2.z, 0.74);
    float t = tpHB(w, a2.a + 0.15, hOld);
    float macro = dot(a3.rgb, vec3(0.333)) / 0.06;
    vec3 rc = a2.rgb * (0.5 + 0.55 * macro);
    rc *= mix(vec3(0.72, 0.74, 0.8), vec3(1.1, 1.05, 0.98), bn1);
    rc *= 0.72 + 0.5 * a3.a;
    rc = mix(rc, rc * vec3(0.5, 0.42, 0.4), mA.g * 0.85);
    rc = mix(rc, rc * 1.3 + 0.05, mA.r * 0.6);
    // (the relief is laid on a wall here, not on the ground: at full strength it turns the lips of the
    //  cracks to face along the cliff, and a lamp held beside it draws them as white wires)
    col = mix(col, rc, t); dn = mix(dn, (n2.xy * 2.0 - 1.0) * 0.4, t); rough = mix(rough, n2.z, t); ao = mix(ao, n2.a * (0.7 + 0.3 * a3.a), t); hOld = mix(hOld, a2.a, t);
  }
  // snow last: it lies on whatever is flat enough
  w = mB.g * smoothstep(0.42, 0.2, slope);
  if (w > 0.004) {
    vec4 a2 = tpGA(uv * 0.5, 6.0, dx * 0.5, dy * 0.5), n2 = tpGN(uv * 0.5, 6.0, dx * 0.5, dy * 0.5);
    float t = tpHB(w, a2.a + 0.2, hOld);
    col = mix(col, a2.rgb, t); dn = mix(dn, n2.xy * 2.0 - 1.0, t); rough = mix(rough, n2.z, t); ao = mix(ao, n2.a, t);
  }

  // potions leave marks: scorch and frost
  col = mix(col, col * 0.12 + vec3(0.012, 0.01, 0.009), fx.r);
  rough = mix(rough, 0.95, fx.r);
  col = mix(col, vec3(0.62, 0.72, 0.8), fx.g * 0.8);
  rough = mix(rough, 0.25, fx.g);
  // wet at the waterline, dark under it
  float wet = smoothstep(0.55, -0.05, wy) * (1.0 - mA.g);
  col *= mix(1.0, 0.5, wet);
  rough = mix(rough, 0.22, wet * 0.8);
  col *= mix(1.0, 0.45, smoothstep(0.0, -2.5, wy));

  // big soft variation and the land's own cavity shading
  col *= 0.84 + 0.3 * bn3;
  col *= mix(1.0, ao, 0.55 * detail) * mix(0.55, 1.0, nrmS.z);
  dn *= detail * nDetail;
  tpGroundN = normalize(vec3(wN.x + dn.x * 0.9, wN.y, wN.z + dn.y * 0.9));
  tpGroundR = rough;
  diffuseColor.rgb = col;

  // the lava lights the bowl of the Scar from below
  vec2 sc = wxz - vec2(SCAR_X, SCAR_Z);
  float sr = length(sc);
  float glow = smoothstep(64.0, 30.0, sr) * smoothstep(34.0, 0.0, wy - LAVA_Y) * smoothstep(-1.5, 0.3, wy - LAVA_Y);
  if (glow > 0.001) {
    float pull = min(1.0, 22.0 / max(sr, 1.0));
    vec3 toLava = normalize(vec3(-sc.x * pull, LAVA_Y - wy - 2.0, -sc.y * pull) + vec3(0.0, 1e-3, 0.0));
    float facing = 0.35 + 0.65 * max(dot(tpGroundN, toLava), 0.0);
    float flick = 0.88 + 0.12 * sin(uTime * 1.7 + sr * 0.2) * sin(uTime * 0.9 + wy);
    tpGroundE = vec3(1.0, 0.28, 0.06) * col * glow * glow * facing * flick * 5.5;
  }
}
`;

const FRAG_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(tpGroundN, 0.0)).xyz);
roughnessFactor = tpGroundR;
metalnessFactor = 0.0;
totalEmissiveRadiance += tpGroundE;
`;

export function createTerrainMaterial(ground) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  m.shadowSide = THREE.BackSide;
  m.defines = { SCAR_X: SCAR.x.toFixed(1), SCAR_Z: SCAR.z.toFixed(1), LAVA_Y: WORLD.lava.toFixed(2) };
  worldMaterial(m);
  addPatch(
    m,
    (shader) => {
      shader.uniforms.uGroundA = { value: ground.albedo };
      shader.uniforms.uGroundN = { value: ground.normal };
      shader.fragmentShader = after(shader.fragmentShader, '#include <common>', FRAG_PARS, 'terrain pars');
      shader.fragmentShader = after(shader.fragmentShader, '#include <color_fragment>', FRAG_GROUND, 'terrain ground');
      shader.fragmentShader = after(shader.fragmentShader, '#include <normal_fragment_maps>', FRAG_NORMAL, 'terrain normal');
    },
    'terrain'
  );
  return m;
}

/** Upload the land's data textures into the shared uniforms. */
export function bindTerrainTextures(T) {
  const n = T.n;
  const ht = new THREE.DataTexture(T.h, n, n, THREE.RedFormat, THREE.FloatType);
  ht.minFilter = ht.magFilter = THREE.NearestFilter;
  ht.needsUpdate = true;
  const mk = (data) => {
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  shared.uHeightTex.value = ht;
  shared.uNrmTex.value = mk(T.nrm);
  shared.uMaskA.value = mk(T.maskA);
  shared.uMaskB.value = mk(T.maskB);
  shared.uWorld.value.set(T.half, T.size, T.n, T.cell);
}

export class Terrain {
  constructor(T, material) {
    this.T = T;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.chunks = [];
    const n = T.n,
      cell = T.cell,
      half = T.half;
    const index = [0, 1, 2].map((l) => this._index(CELLS >> l));
    for (let cj = 0; cj < CHUNKS; cj++)
      for (let ci = 0; ci < CHUNKS; ci++) {
        const c = { lods: [], lod: -1, cx: (ci + 0.5) * CELLS * cell - half, cz: (cj + 0.5) * CELLS * cell - half, cy: 0 };
        let ymin = 1e9,
          ymax = -1e9;
        for (let l = 0; l < 3; l++) {
          const step = 1 << l,
            q = CELLS >> l,
            side = q + 1;
          // the grid, then a skirt ring that hangs down round the rim
          const pos = new Float32Array((side * side + side * 4) * 3);
          let p = 0;
          for (let j = 0; j <= q; j++)
            for (let i = 0; i <= q; i++) {
              const gi = ci * CELLS + i * step,
                gj = cj * CELLS + j * step;
              const y = T.h[gj * n + gi];
              pos[p++] = gi * cell - half;
              pos[p++] = y;
              pos[p++] = gj * cell - half;
              if (l === 0) {
                if (y < ymin) ymin = y;
                if (y > ymax) ymax = y;
              }
            }
          const drop = 1.5 + l * 3;
          const rim = (i, j) => {
            const k = (j * side + i) * 3;
            pos[p++] = pos[k];
            pos[p++] = pos[k + 1] - drop;
            pos[p++] = pos[k + 2];
          };
          for (let i = 0; i <= q; i++) rim(i, 0);
          for (let i = 0; i <= q; i++) rim(i, q);
          for (let j = 0; j <= q; j++) rim(0, j);
          for (let j = 0; j <= q; j++) rim(q, j);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          geo.setIndex(index[l]);
          geo.computeBoundingBox();
          geo.computeBoundingSphere();
          const mesh = new THREE.Mesh(geo, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.visible = false;
          this.group.add(mesh);
          c.lods.push(mesh);
        }
        c.cy = (ymin + ymax) / 2;
        this.chunks.push(c);
      }
  }

  _index(q) {
    const side = q + 1;
    const idx = [];
    for (let j = 0; j < q; j++)
      for (let i = 0; i < q; i++) {
        const a = j * side + i,
          b = a + 1,
          c = a + side,
          d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const base = side * side;
    const strip = (g0, s0, g1, s1) => idx.push(g0, s0, g1, g1, s0, s1);
    for (let i = 0; i < q; i++) {
      strip(i, base + i, i + 1, base + i + 1); // north edge
      strip(q * side + i, base + side + i, q * side + i + 1, base + side + i + 1); // south
    }
    for (let j = 0; j < q; j++) {
      strip(j * side, base + side * 2 + j, (j + 1) * side, base + side * 2 + j + 1); // west
      strip(j * side + q, base + side * 3 + j, (j + 1) * side + q, base + side * 3 + j + 1); // east
    }
    const Arr = base + side * 4 > 65535 ? Uint32Array : Uint16Array;
    return new THREE.BufferAttribute(new Arr(idx), 1);
  }

  /** Pick each chunk's level of detail for this camera position. */
  update(cam, detail = 1) {
    const d0 = 105 * detail,
      d1 = 250 * detail;
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z, (c.cy - cam.y) * 0.5);
      let lod = d < d0 ? 0 : d < d1 ? 1 : 2;
      // stay put near a boundary so chunks do not flicker between levels
      if (c.lod >= 0 && lod !== c.lod) {
        const edge = lod > c.lod ? (c.lod === 0 ? d0 : d1) + 8 : (lod === 0 ? d0 : d1) - 8;
        if (lod > c.lod ? d < edge : d > edge) lod = c.lod;
      }
      if (lod !== c.lod) {
        if (c.lod >= 0) c.lods[c.lod].visible = false;
        c.lods[lod].visible = true;
        c.lod = lod;
      }
    }
  }
}
