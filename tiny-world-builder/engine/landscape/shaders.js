/**
 * LandscapeEngine — terrain shader mixin.
 *
 * Builds the realistic (sand) ShaderMaterial and the low-poly cel
 * ShaderMaterial used by terrain chunks. Attaches `_initSharedShaders`
 * to LandscapeEngine.prototype.
 *
 * Depends on: LandscapeEngine being defined globally and window.THREE.
 */
(function (global) {
  if (!global.LandscapeEngine) {
    throw new Error('engine/landscape/shaders.js: LandscapeEngine must be loaded first.');
  }
  const THREE = global.THREE;
  if (!THREE) {
    throw new Error('engine/landscape/shaders.js: THREE must be loaded first.');
  }

  Object.assign(global.LandscapeEngine.prototype, {
    // --- Shaders Initialization ---
    _initSharedShaders() {
      this.SAND_VS = `
        attribute vec3 color;
        varying vec3 vColor;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vColor = color;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `;

      this.SAND_FS = `
        precision highp float;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        uniform vec3 ambientColor;
        uniform vec3 skyTint;
        uniform vec3 groundTint;
        uniform vec3 fogColor;
        uniform float fogNear;
        uniform float fogFar;
        uniform float hazeStrength;
        uniform float hazeExponent;
        uniform float clipEnabled;
        uniform vec3 clipMin;
        uniform vec3 clipMax;

        varying vec3 vColor;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f*f*(3.0-2.0*f);
          return mix(
            mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
            mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          // Clip bounds discard. The boundary is filled by opaque cut-cap
          // geometry; do not fade the terrain/water to blue fog at the edge.
          if (clipEnabled > 0.5) {
            float dx1 = vWorldPos.x - clipMin.x;
            float dx2 = clipMax.x - vWorldPos.x;
            float dz1 = vWorldPos.z - clipMin.z;
            float dz2 = clipMax.z - vWorldPos.z;
            float minDist = min(min(dx1, dx2), min(dz1, dz2));
            if (minDist < 0.0) {
              discard;
            }
          }

          vec3 N = normalize(vNormal);
          vec2 uv = vWorldPos.xz;
          float r1 = cos(uv.x * 0.55 + uv.y * 0.21);
          float r2 = cos(uv.y * 0.62 - uv.x * 0.27 + 1.7);
          float r3 = cos((uv.x + uv.y) * 0.13);
          float r4 = cos(uv.x * 1.8 + uv.y * 0.6) * 0.3;
          float r5 = cos(uv.y * 1.6 - uv.x * 1.2 + 0.5) * 0.3;
          vec3 rippleN = normalize(vec3(
            r1 * 0.06 + r3 * 0.02 + r4 * 0.025,
            1.0,
            r2 * 0.06 + r3 * 0.02 + r5 * 0.025
          ));

          float flatness = smoothstep(0.55, 0.92, N.y);
          vec3 perturbed = normalize(mix(N, normalize(N + (rippleN - vec3(0.0, 1.0, 0.0)) * 0.7), flatness));

          vec3 L = normalize(sunDir);
          float rawNdotL = dot(perturbed, L);
          float NdotL = max(rawNdotL, 0.0);
          float sunFacing = smoothstep(-0.18, 0.78, rawNdotL);

          float hemi = perturbed.y * 0.5 + 0.5;
          vec3 hemiCol = mix(groundTint, skyTint, hemi);

          vec3 diffuse = vColor * (NdotL * sunColor + hemiCol * 0.45 + ambientColor);

          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 H = normalize(L + V);
          float NdotH = max(dot(perturbed, H), 0.0);
          float spec = pow(NdotH, 22.0) * 0.18 * flatness;
          float sparkleNoise = vnoise(uv * 55.0);
          float sparkleMask = smoothstep(0.79, 0.93, sparkleNoise) * pow(NdotH, 90.0) * flatness;
          vec3 sparkle = sunColor * sparkleMask * 5.0;

          float backLight = max(dot(-perturbed, L), 0.0);
          vec3 backScatter = vColor * sunColor * backLight * 0.07;

          float rim = 1.0 - max(dot(N, V), 0.0);
          rim = pow(rim, 2.5) * 0.15;
          vec3 rimCol = mix(vColor, fogColor, 0.6) * rim;

          vec3 color = diffuse + spec * sunColor + sparkle + backScatter + rimCol;
          color *= mix(vec3(0.72, 0.78, 0.88), vec3(1.03, 1.0, 0.97), sunFacing);

          float dist = length(vWorldPos - cameraPosition);
          float fogF = clamp((dist - fogNear) / (fogFar - fogNear), 0.0, 1.0);
          float horizon = pow(clamp(1.0 - abs(V.y), 0.0, 1.0), hazeExponent);
          float haze = clamp(fogF * (0.86 + horizon * hazeStrength), 0.0, 1.0);
          vec3 hazeColor = mix(fogColor, skyTint, 0.38 + horizon * 0.22);
          // No clip-edge haze fade; cut caps fill the boundary.

          gl_FragColor = vec4(color, 1.0);
        }
      `;

      this.LOWPOLY_FS = `
        precision highp float;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        uniform vec3 ambientColor;
        uniform vec3 skyTint;
        uniform vec3 groundTint;
        uniform vec3 fogColor;
        uniform float fogNear;
        uniform float fogFar;
        uniform float hazeStrength;
        uniform float hazeExponent;
        uniform float clipEnabled;
        uniform vec3 clipMin;
        uniform vec3 clipMax;

        varying vec3 vColor;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          // Clip bounds discard. The boundary is filled by opaque cut-cap
          // geometry; do not fade the terrain/water to blue fog at the edge.
          if (clipEnabled > 0.5) {
            float dx1 = vWorldPos.x - clipMin.x;
            float dx2 = clipMax.x - vWorldPos.x;
            float dz1 = vWorldPos.z - clipMin.z;
            float dz2 = clipMax.z - vWorldPos.z;
            float minDist = min(min(dx1, dx2), min(dz1, dz2));
            if (minDist < 0.0) {
              discard;
            }
          }

          vec3 dx = dFdx(vWorldPos);
          vec3 dy = dFdy(vWorldPos);
          vec3 N = normalize(cross(dx, dy));
          if (N.y < 0.0) N = -N;

          vec3 L = normalize(sunDir);
          float rawNdotL = dot(N, L);
          float NdotL = max(rawNdotL, 0.0);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 H = normalize(L + V);

          float band;
          if (NdotL > 0.72)       band = 1.00;
          else if (NdotL > 0.38)  band = 0.86;
          else if (NdotL > 0.02)  band = 0.74;
          else                    band = 0.62;

          vec3 c = vColor * 1.04;
          c = floor(c * 12.0) / 12.0;
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(vec3(lum), c, 1.08);

          float hemi = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 hemiCol = mix(groundTint, skyTint, hemi);
          float sunFacing = smoothstep(-0.18, 0.78, rawNdotL);
          float backLight = max(dot(-N, L), 0.0);
          float spec = pow(max(dot(N, H), 0.0), 18.0) * 0.08;
          float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.12;
          vec3 rimCol = mix(c, fogColor, 0.55) * rim;
          vec3 shadowCol = mix(groundTint, skyTint, 0.70 + hemi * 0.24);
          vec3 litCol = band * sunColor + hemiCol * 0.52 + ambientColor;
          vec3 shadeCol = shadowCol * (0.56 + hemi * 0.14) + ambientColor * 0.56;

          vec3 color = c * mix(shadeCol, litCol, smoothstep(-0.12, 0.34, rawNdotL));
          color += spec * sunColor;
          color += c * sunColor * backLight * 0.08;
          color += rimCol;
          color *= mix(vec3(0.84, 0.88, 0.95), vec3(1.04, 1.00, 0.96), sunFacing);

          float dist = length(vWorldPos - cameraPosition);
          float fogF = clamp((dist - fogNear) / (fogFar - fogNear), 0.0, 1.0);
          float horizon = pow(clamp(1.0 - abs(V.y), 0.0, 1.0), hazeExponent);
          float haze = clamp(fogF * (0.96 + horizon * (hazeStrength + 0.18)), 0.0, 1.0);
          vec3 hazeColor = mix(fogColor, skyTint, 0.66 + horizon * 0.16);
          // No clip-edge haze fade; cut caps fill the boundary.

          gl_FragColor = vec4(color, 1.0);
        }
      `;

      this.sandMat = new THREE.ShaderMaterial({
        uniforms: {
          sunDir:        { value: this.sunDir.clone() },
          sunColor:      { value: new THREE.Color(this.currentBiome.sunColor) },
          ambientColor:  { value: new THREE.Color(this.currentBiome.ambient) },
          skyTint:       { value: new THREE.Color(this.currentBiome.skyTop) },
          groundTint:    { value: new THREE.Color(this.currentBiome.groundTint) },
          fogColor:      { value: new THREE.Color(this.currentBiome.fogColor) },
          fogNear:       { value: 360 },
          fogFar:        { value: 6200 },
          hazeStrength:  { value: 0.92 },
          hazeExponent:  { value: 1.55 },
          clipEnabled:   { value: 0.0 },
          clipMin:       { value: this._clipMin },
          clipMax:       { value: this._clipMax },
        },
        vertexShader: this.SAND_VS,
        fragmentShader: this.SAND_FS,
      });

      this.sandMatLowPoly = new THREE.ShaderMaterial({
        uniforms: {
          sunDir:       { value: this.sunDir.clone() },
          sunColor:     { value: new THREE.Color(this.currentBiome.sunColor) },
          ambientColor: { value: new THREE.Color(this.currentBiome.lowPolyAmbient) },
          skyTint:      { value: new THREE.Color(this.currentBiome.skyTop) },
          groundTint:   { value: new THREE.Color(this.currentBiome.groundTint) },
          fogColor:     { value: new THREE.Color(this.currentBiome.fogColor) },
          fogNear:      { value: 500 },
          fogFar:       { value: 6100 },
          hazeStrength: { value: 0.98 },
          hazeExponent: { value: 1.30 },
          clipEnabled:  { value: 0.0 },
          clipMin:      { value: this._clipMin },
          clipMax:      { value: this._clipMax },
        },
        vertexShader: this.SAND_VS,
        fragmentShader: this.LOWPOLY_FS,
        extensions: { derivatives: true },
      });
    },
  });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
