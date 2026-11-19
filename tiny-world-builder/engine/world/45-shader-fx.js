  // -------- shader FX library --------
  // A self-contained, reusable GLSL effects library inspired by
  // lettier/3d-game-shaders-for-beginners (lighting, fog, normal mapping,
  // posterization, dithering, outlining) adapted to TinyWorld's stylized
  // low-poly look.
  //
  // Exposes window.TinyShaderFX with material factories for flowing water,
  // waterfalls, foam, smoke, and explosions, plus a procedural damage / wear
  // overlay that patches any Lambert/Standard material via onBeforeCompile.
  //
  // Design notes:
  //  - Everything is procedural (hash noise / fbm) so there are no texture
  //    fetches or extra render targets — the effects stay cheap and ship with
  //    zero asset weight.
  //  - Animated materials expose a `uTime` uniform. They self-register with the
  //    frame ticker (window.__tinyworldShaderFXTick), which the animation loop
  //    calls once per frame, so callers never have to wire per-material clocks.
  //  - Wrapped in an IIFE with a 4-space body so its locals never collide with
  //    the shared engine/world global scope (and dodge the duplicate-decl guard).
  (function () {
    if (typeof THREE === 'undefined') return;

    // ---- shared GLSL building blocks (reused across every factory) ----
    // value-noise + fbm + a Fresnel term + a posterize helper. These map
    // directly onto the "lighting", "fog", "normal mapping" and "posterization"
    // chapters of the reference and are deliberately self-contained so a single
    // string prepend gives any ShaderMaterial the full toolkit.
    const GLSL_NOISE = `
      float fxHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float fxNoise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(fxHash(i), fxHash(i+vec2(1.0,0.0)), u.x),
                   mix(fxHash(i+vec2(0.0,1.0)), fxHash(i+vec2(1.0,1.0)), u.x), u.y);
      }
      float fxFbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++){ v += a * fxNoise(p); p *= 2.02; a *= 0.5; }
        return v;
      }
      float fxFresnel(vec3 n, vec3 v, float power){
        return pow(1.0 - clamp(dot(n, v), 0.0, 1.0), power);
      }
      vec3 fxPosterize(vec3 c, float levels){
        return levels > 0.5 ? floor(c * levels) / levels : c;
      }
    `;

    const tracked = new Set();

    // Register a material so the frame ticker advances its uTime uniform.
    // Wraps dispose() once so the tracker auto-prunes and can never leak.
    function track(mat) {
      if (mat && mat.uniforms && mat.uniforms.uTime && !mat.userData.__fxTracked) {
        mat.userData.__fxTracked = true;
        tracked.add(mat);
        const baseDispose = mat.dispose.bind(mat);
        mat.dispose = function () {
          mat.userData.__fxDisposed = true;
          tracked.delete(mat);
          baseDispose();
        };
      }
      return mat;
    }

    // Called once per frame by the animation loop. Advances every tracked
    // material's clock and prunes disposed materials.
    function tick(t /* seconds */, dt) {
      for (const mat of tracked) {
        if (!mat || mat.userData.__fxDisposed) { tracked.delete(mat); continue; }
        if (mat.uniforms && mat.uniforms.uTime) mat.uniforms.uTime.value = t;
      }
    }

    function colorUniform(value, fallback) {
      return { value: new THREE.Color(value != null ? value : fallback) };
    }

    // ---- 1. Flowing water / river surface ----------------------------------
    // Stylized scrolling water for flat planes (rivers, ponds, canals). Two
    // noise layers flow along `flow` and its perpendicular, a Blinn-Phong glint
    // rides the crests, and a fresnel term mixes in a sky tint. Posterized to
    // sit happily next to the cel-shaded terrain.
    function makeWaterFlowMaterial(opts) {
      opts = opts || {};
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: opts.depthWrite !== undefined ? opts.depthWrite : false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime:       { value: 0 },
          uShallow:    colorUniform(opts.shallow, 0x4ea68a),
          uDeep:       colorUniform(opts.deep, 0x143a46),
          uSky:        colorUniform(opts.sky, 0xbfe4ff),
          uFoam:       colorUniform(opts.foam, 0xeaf7ff),
          uSunDir:     { value: (opts.sunDir || new THREE.Vector3(0.5, 0.8, 0.3)).clone().normalize() },
          uFlow:       { value: opts.flow || new THREE.Vector2(1.0, 0.25) },
          uScale:      { value: opts.scale != null ? opts.scale : 0.9 },
          uSpeed:      { value: opts.speed != null ? opts.speed : 0.6 },
          uOpacity:    { value: opts.opacity != null ? opts.opacity : 0.9 },
          uPosterize:  { value: opts.posterize != null ? opts.posterize : 10.0 },
        },
        vertexShader: `
          varying vec3 vWorld;
          void main(){
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: GLSL_NOISE + `
          uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky;
          uniform vec3 uFoam; uniform vec3 uSunDir; uniform vec2 uFlow; uniform float uScale;
          uniform float uSpeed; uniform float uOpacity; uniform float uPosterize;
          varying vec3 vWorld; varying vec2 vUv;
          void main(){
            vec2 fl = uFlow;
            vec2 base = vWorld.xz * (0.06 * uScale);
            float ts = uTime * uSpeed;
            vec2 uv1 = base + fl * (ts * 0.08);
            vec2 uv2 = base * 2.3 + vec2(-fl.y, fl.x) * (ts * 0.11);
            float h0 = fxNoise(uv1) * 0.62 + fxNoise(uv2) * 0.38;
            float e = 0.5;
            float hX = fxNoise(uv1 + vec2(e,0.0)) * 0.62 + fxNoise(uv2 + vec2(e,0.0)) * 0.38;
            float hZ = fxNoise(uv1 + vec2(0.0,e)) * 0.62 + fxNoise(uv2 + vec2(0.0,e)) * 0.38;
            vec3 n = normalize(vec3(-(hX-h0)*1.1, 1.0, -(hZ-h0)*1.1));
            vec3 v = normalize(cameraPosition - vWorld);
            vec3 hvec = normalize(uSunDir + v);
            float glint = pow(max(dot(n, hvec), 0.0), 90.0);
            float fres = fxFresnel(n, v, 3.0);
            vec3 col = mix(uDeep, uShallow, h0 * 0.6 + 0.2);
            col = mix(col, uSky, clamp(0.12 + fres * 0.5, 0.0, 0.85));
            col += vec3(1.0,0.98,0.92) * glint * 0.6;
            float foam = smoothstep(0.7, 0.95, h0) + smoothstep(0.92, 1.0, fxNoise(base * 6.0 + fl * ts));
            col = mix(col, uFoam, clamp(foam, 0.0, 0.7));
            col = fxPosterize(col, uPosterize);
            gl_FragColor = vec4(col, uOpacity);
            #include <colorspace_fragment>
          }
        `,
      });
      mat.userData.shaderFX = 'water-flow';
      return track(mat);
    }

    // ---- 2. Waterfall curtain ----------------------------------------------
    // Vertical falling-water sheet: lanes of water streak downward, foam gathers
    // at the lip and the plunge, and the whole thing fades at the edges. Apply to
    // a vertical plane (UV.y = top..bottom).
    function makeWaterfallMaterial(opts) {
      opts = opts || {};
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: opts.depthWrite !== undefined ? opts.depthWrite : true,
        side: THREE.DoubleSide,
        uniforms: {
          uTime:    { value: 0 },
          uBase:    colorUniform(opts.base, 0x28b5f0),
          uHi:      colorUniform(opts.hi, 0x96e7ff),
          uFoam:    colorUniform(opts.foam, 0xf4fdff),
          uSpeed:   { value: opts.speed != null ? opts.speed : 1.0 },
          uLanes:   { value: opts.lanes != null ? opts.lanes : 9.0 },
          uOpacity: { value: opts.opacity != null ? opts.opacity : 0.8 },
        },
        vertexShader: `
          varying vec2 vUv; varying vec3 vWorld;
          void main(){
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: GLSL_NOISE + `
          uniform float uTime; uniform vec3 uBase; uniform vec3 uHi; uniform vec3 uFoam;
          uniform float uSpeed; uniform float uLanes; uniform float uOpacity;
          varying vec2 vUv; varying vec3 vWorld;
          void main(){
            float seed = floor(vWorld.x * 0.61 + vWorld.z * 0.73);
            float laneX = vUv.x * uLanes;
            float laneId = floor(laneX);
            float laneUv = fract(laneX);
            float r = fxHash(vec2(laneId, seed));
            float w = 0.3 + r * 0.42;
            float blade = 1.0 - smoothstep(w, w + 0.1, abs(laneUv - 0.5) * 2.0);
            // downward flow dashes
            float flow = fract((1.0 - vUv.y) * (2.8 + r * 2.4) + uTime * uSpeed * (0.7 + r * 0.5) + r);
            float dash = 0.7 + smoothstep(0.15, 0.0, flow) * 0.25 + smoothstep(0.9, 1.0, flow) * 0.2;
            float foamTop = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.12, 0.3, vUv.y));
            float foamBottom = smoothstep(0.82, 1.0, vUv.y) * (0.6 + fxNoise(vUv * 14.0 + uTime) * 0.5);
            float foam = clamp(foamTop + foamBottom, 0.0, 1.0);
            float alpha = blade * dash * uOpacity;
            if (alpha < 0.02) discard;
            vec3 col = mix(uBase, uHi, 0.2 + (1.0 - laneUv) * 0.25);
            col = mix(col, uFoam, foam * 0.85);
            gl_FragColor = vec4(col, clamp(alpha + foam * 0.25, 0.0, 1.0));
            #include <colorspace_fragment>
          }
        `,
      });
      mat.userData.shaderFX = 'waterfall';
      return track(mat);
    }

    // ---- 3. Foam ring / shoreline -------------------------------------------
    // Animated foam ribbon for shorelines, splash rings and wakes. Drawn on a
    // ring/plane; foam concentrates near UV.y = 0 (the contact edge).
    function makeFoamMaterial(opts) {
      opts = opts || {};
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime:    { value: 0 },
          uFoam:    colorUniform(opts.foam, 0xffffff),
          uSpeed:   { value: opts.speed != null ? opts.speed : 0.8 },
          uScale:   { value: opts.scale != null ? opts.scale : 5.0 },
          uOpacity: { value: opts.opacity != null ? opts.opacity : 0.85 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: GLSL_NOISE + `
          uniform float uTime; uniform vec3 uFoam; uniform float uSpeed; uniform float uScale; uniform float uOpacity;
          varying vec2 vUv;
          void main(){
            float edge = 1.0 - smoothstep(0.0, 0.85, vUv.y);
            float bubbles = fxFbm(vUv * uScale + vec2(uTime * uSpeed, -uTime * uSpeed * 0.6));
            float mask = smoothstep(0.45, 0.8, bubbles) * edge;
            float a = mask * uOpacity;
            if (a < 0.02) discard;
            gl_FragColor = vec4(uFoam, a);
            #include <colorspace_fragment>
          }
        `,
      });
      mat.userData.shaderFX = 'foam';
      return track(mat);
    }

    // ---- 4. Soft smoke puff -------------------------------------------------
    // A dissolving, billowing smoke billboard. Far softer than a flat alpha
    // sphere: fbm carves the silhouette and an `uAge` (0..1) uniform thins and
    // greys it as the particle dies. Use on a camera-facing plane.
    function makeSmokeMaterial(opts) {
      opts = opts || {};
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime:    { value: 0 },
          uAge:     { value: 0 },
          uColor:   colorUniform(opts.color, 0xd4cfc2),
          uTint:    colorUniform(opts.tint, 0x6b6358),
          uOpacity: { value: opts.opacity != null ? opts.opacity : 0.7 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: GLSL_NOISE + `
          uniform float uTime; uniform float uAge; uniform vec3 uColor; uniform vec3 uTint; uniform float uOpacity;
          varying vec2 vUv;
          void main(){
            vec2 p = vUv - 0.5;
            float r = length(p) * 2.0;
            float billow = fxFbm(vUv * 3.0 + vec2(0.0, -uTime * 0.4) + uAge * 2.0);
            float disk = 1.0 - smoothstep(0.2, 1.0, r + billow * 0.35 - 0.2);
            float a = disk * uOpacity * (1.0 - uAge);
            if (a < 0.01) discard;
            vec3 col = mix(uColor, uTint, clamp(uAge + billow * 0.3, 0.0, 1.0));
            gl_FragColor = vec4(col, a);
            #include <colorspace_fragment>
          }
        `,
      });
      mat.userData.shaderFX = 'smoke';
      return track(mat);
    }

    // ---- 5. Explosion fireball ----------------------------------------------
    // Expanding blast: a hot white/yellow core ramps through orange/red and
    // collapses into dark smoke as `uProgress` (0..1) advances. fbm gives the
    // boiling fireball edge. Drive uProgress from your own animation and scale
    // the mesh up over the same window. Returns the material; advance uProgress
    // yourself (uTime is auto-ticked for the boil).
    function makeExplosionMaterial(opts) {
      opts = opts || {};
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime:     { value: 0 },
          uProgress: { value: 0 },
          uCore:     colorUniform(opts.core, 0xfff3c4),
          uMid:      colorUniform(opts.mid, 0xff7b29),
          uEdge:     colorUniform(opts.edge, 0x8a1d05),
          uSmoke:    colorUniform(opts.smoke, 0x2b2622),
        },
        vertexShader: `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: GLSL_NOISE + `
          uniform float uTime; uniform float uProgress;
          uniform vec3 uCore; uniform vec3 uMid; uniform vec3 uEdge; uniform vec3 uSmoke;
          varying vec2 vUv;
          void main(){
            vec2 p = vUv - 0.5;
            float r = length(p) * 2.0;
            float boil = fxFbm(vUv * 4.0 + vec2(uTime * 0.8, -uTime * 0.5));
            float fire = r + boil * 0.5 - 0.25;
            // expanding shell: core shrinks as it cools, smoke takes over
            float core = 1.0 - smoothstep(0.0, 0.45 * (1.0 - uProgress * 0.6), fire);
            float body = 1.0 - smoothstep(0.2, 1.0, fire);
            vec3 col = mix(uEdge, uMid, smoothstep(0.0, 0.6, core));
            col = mix(col, uCore, smoothstep(0.55, 1.0, core));
            // late phase: fade the fire to drifting smoke
            float smokeMix = smoothstep(0.55, 1.0, uProgress);
            col = mix(col, uSmoke, smokeMix * (1.0 - core));
            float a = body * (1.0 - smoothstep(0.85, 1.0, uProgress)) * (0.35 + boil * 0.65);
            if (a < 0.01) discard;
            gl_FragColor = vec4(col, a);
            #include <colorspace_fragment>
          }
        `,
      });
      mat.userData.shaderFX = 'explosion';
      return track(mat);
    }

    // ---- 6. Procedural damage / wear-and-tear overlay -----------------------
    // Patches any Lambert/Standard/Phong/Basic material so it picks up grime,
    // edge scuffs and cracks driven by world position — no UVs or textures
    // required. Strength is `amount` (0 = pristine, 1 = ruined). Returns the
    // same material with a `setWear(amount)` helper attached.
    function applyWear(material, opts) {
      if (!material) return material;
      opts = opts || {};
      material.userData = material.userData || {};
      // Idempotent: a repeat call just updates the existing uniforms instead of
      // chaining another onBeforeCompile (which would patch the shader twice and
      // break compilation with duplicate varyings/uniforms).
      if (material.userData.wearUniforms) {
        const w = material.userData.wearUniforms;
        if (opts.amount != null) w.uWearAmount.value = opts.amount;
        if (opts.scale != null) w.uWearScale.value = opts.scale;
        if (opts.color != null) w.uWearColor.value.set(opts.color);
        if (opts.seed != null) w.uWearSeed.value = opts.seed;
        return material;
      }
      const u = {
        uWearAmount: { value: opts.amount != null ? opts.amount : 0.5 },
        uWearScale:  { value: opts.scale != null ? opts.scale : 0.7 },
        uWearColor:  colorUniform(opts.color, 0x241c12),
        uWearSeed:   { value: opts.seed != null ? opts.seed : Math.random() * 100.0 },
      };
      material.userData.wearUniforms = u;
      const prevHook = material.onBeforeCompile;
      material.onBeforeCompile = (shader) => {
        if (typeof prevHook === 'function') prevHook(shader);
        shader.uniforms.uWearAmount = u.uWearAmount;
        shader.uniforms.uWearScale = u.uWearScale;
        shader.uniforms.uWearColor = u.uWearColor;
        shader.uniforms.uWearSeed = u.uWearSeed;
        // Capture world position from `transformed` (always present after
        // begin_vertex) so we don't depend on env/shadow includes being active.
        shader.vertexShader = 'varying vec3 vWearWorld;\n' + shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n  vWearWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
        );
        // Anchor on dithering_fragment — the last include in every stock
        // material template, so the patch always lands regardless of fog/env.
        shader.fragmentShader = (
          'varying vec3 vWearWorld;\n' +
          'uniform float uWearAmount; uniform float uWearScale; uniform vec3 uWearColor; uniform float uWearSeed;\n' +
          GLSL_NOISE +
          shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `{
              vec3 wp = vWearWorld * uWearScale + uWearSeed;
              float grime = fxFbm(wp.xz * 0.5);
              float crack = 1.0 - smoothstep(0.0, 0.05, abs(fxFbm(wp.xz + 4.7) - 0.5));
              float scuff = smoothstep(0.58, 0.86, fxNoise(wp.xz * 3.0 + 9.1));
              float wear = clamp((grime * 0.55 + crack * 0.8 + scuff * 0.45) * uWearAmount, 0.0, 1.0);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * uWearColor, wear * 0.7);
              gl_FragColor.rgb *= (1.0 - wear * 0.22);
            }
            #include <dithering_fragment>`
          )
        );
      };
      material.needsUpdate = true;
      material.setWear = (amount) => { u.uWearAmount.value = amount; };
      return material;
    }

    // ---- opt-in showcase ----------------------------------------------------
    // ?shaderfx=demo (or =1) drops a small gallery of the effects near the
    // origin so they can be eyeballed without touching default scenes.
    function demo(targetScene) {
      let host = targetScene;
      try { if (!host && typeof scene !== 'undefined') host = scene; } catch (e) { host = null; }
      if (!host) return null;
      const group = new THREE.Group();
      group.name = 'shaderfx-demo';
      const place = (mesh, x, label) => { mesh.position.set(x, 6, 0); mesh.userData.fxLabel = label; group.add(mesh); };

      place(new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2), makeWaterFlowMaterial()), -18, 'water');
      place(new THREE.Mesh(new THREE.PlaneGeometry(5, 7), makeWaterfallMaterial()), -6, 'waterfall');
      const smoke = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), makeSmokeMaterial());
      place(smoke, 6, 'smoke');
      const boom = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 16), makeExplosionMaterial());
      place(boom, 18, 'explosion');
      const worn = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4),
        applyWear(new THREE.MeshLambertMaterial({ color: 0xb8b0a0 }), { amount: 0.8 }));
      place(worn, 30, 'wear');

      // loop the explosion progress so the gallery is animated
      boom.userData.fxLoop = (t) => {
        const p = (t * 0.4) % 1.0;
        boom.material.uniforms.uProgress.value = p;
        const s = 0.4 + p * 1.6;
        boom.scale.setScalar(s);
        smoke.material.uniforms.uAge.value = p;
      };
      group.userData.fxTick = (t) => { if (boom.userData.fxLoop) boom.userData.fxLoop(t); };
      host.add(group);

      const prevTick = window.__tinyworldShaderFXTick;
      window.__tinyworldShaderFXTick = (t, dt) => {
        if (typeof prevTick === 'function') prevTick(t, dt);
        if (group.userData.fxTick) group.userData.fxTick(t);
      };
      return group;
    }

    const api = {
      GLSL_NOISE,
      track, tick,
      makeWaterFlowMaterial,
      makeWaterfallMaterial,
      makeFoamMaterial,
      makeSmokeMaterial,
      makeExplosionMaterial,
      applyWear,
      demo,
      _tracked: tracked,
    };

    window.TinyShaderFX = api;
    window.__tinyworldShaderFXTick = tick;

    try {
      const params = new URLSearchParams(location.search);
      const flag = params.get('shaderfx');
      if (flag === 'demo' || flag === '1') {
        window.addEventListener('load', () => { setTimeout(() => { try { demo(); } catch (e) { /* scene not ready */ } }, 800); });
      }
    } catch (e) { /* no location */ }
  })();
