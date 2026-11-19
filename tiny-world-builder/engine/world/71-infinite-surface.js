  // -------- infinite procedural water + islands GPU surface --------
  // When the plane flies down toward the planet, the finite baked poser sea
  // (57-poser-surface.js) covers only ~240 world units around the spawn. This
  // module lays an ENDLESS camera-following shader plane at the same sea level:
  // a single 600x600 mesh whose vertices are displaced by world-anchored FBM
  // noise, so flying in any direction reveals fresh islands forever and the far
  // edge melts into the live sky via in-shader fog.
  //
  // The geometry recenters on the camera (snapped to a coarse grid so vertices
  // never swim), but the noise is sampled in WORLD space via modelMatrix — the
  // field is anchored to the world, the mesh merely slides under it. Lit by the
  // same day/night sun + ambient that tint everything else, so night reads dark
  // and blue, midday bright.
  //
  // Exposed as window.__tinyworldInfiniteSurface.{show,hide,tick,isActive}.
  // flight-sim (34) calls show()/hide() on veil begin/end; the surface animates
  // on its own rAF. IIFE — no top-level identifiers leak into the shared scope.
  (function infiniteSurfaceBoot() {
    'use strict';
    if (typeof window === 'undefined' || typeof THREE === 'undefined') return;
    if (window.__tinyworldInfiniteSurface) return;   // guard against double-install

    // ---- placement (matches the poser surface so the two seas are coplanar) ----
    const SEA_Y = -60.3;          // poser DROP is -60; sit a hair below to avoid z-fight
    // TWO co-planar layers give a truly limitless horizon with no visible plane
    // edge: a detailed NEAR layer that fades to transparent at its rim, revealing
    // a huge coarse FAR layer behind it that itself dissolves into the sky. Both
    // sample the SAME world-anchored noise, so the distant land lines up exactly
    // with the near land — one continuous world receding into haze.
    const LAYERS = [
      // near: fine detail; fully transparent by fogFar (< half-extent 450) so its
      // rim never shows as an edge. depthWrite off so the far layer reads through.
      { plane: 900,  segs: 240, snap: 4,  yOff: 0.0,  order: -2, fadeToAlpha: 1, fogNear: 200, fogFar: 430, transparent: true,  depthWrite: false },
      // far: vast + coarse; melts to sky by fogFar (< half-extent 3000) so the
      // horizon has hazy distant landmasses and no boundary is ever reached.
      { plane: 6000, segs: 200, snap: 24, yOff: -0.8, order: -3, fadeToAlpha: 0, fogNear: 430, fogFar: 2700, transparent: false, depthWrite: true },
    ];

    // ---- shared-scene references (in-scope for engine <script> modules) ----
    function parentNode() {
      if (typeof worldGroup !== 'undefined' && worldGroup) return worldGroup;
      if (typeof xrWorldRoot !== 'undefined' && xrWorldRoot) return xrWorldRoot;
      return (typeof scene !== 'undefined') ? scene : null;
    }
    function sceneRef() { return (typeof scene !== 'undefined') ? scene : null; }
    function cameraRef() { return (typeof camera !== 'undefined') ? camera : null; }

    // ===================== shaders =====================
    // Value-noise FBM shared by vertex (displacement) and fragment (foam detail).
    const NOISE_GLSL = [
      'float vhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }',
      'float vnoise(vec2 p){',
      '  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);',
      '  return mix(mix(vhash(i), vhash(i+vec2(1.0,0.0)), f.x),',
      '             mix(vhash(i+vec2(0.0,1.0)), vhash(i+vec2(1.0,1.0)), f.x), f.y);',
      '}',
      'float fbm(vec2 p){',
      '  float a = 0.5, s = 0.0;',
      '  for (int i = 0; i < 5; i++){ s += a*vnoise(p); p *= 2.02; a *= 0.5; }',
      '  return s;',   // ~[0,1]
      '}',
      // continent field -> world elevation. The GRAVITANIUM lore drives three
      // looks selected by uTheme (0 flooded scar-world, 1 ocean + survivors,
      // 2 crust + crater holes). Shared by vertex displacement and the fragment
      // normal/colour so all three agree exactly.
      'uniform float uFreq; uniform float uHeight; uniform float uSea; uniform float uTime; uniform float uTheme;',
      // sea threshold shifts how much of the field is crust vs flooded:
      //   theme 2 (crust world) -> lower threshold, mostly land
      //   theme 1 (ocean world) -> higher threshold, mostly water
      'float seaThreshold(){',
      '  if (uTheme > 1.5) return uSea - 0.18;',
      '  if (uTheme > 0.5) return uSea + 0.22;',
      '  return uSea;',
      '}',
      // blast craters: sparse second field punched only into the crust theme,
      // where gravitanium tore out of the surface leaving empty holes.
      'float craterPit(vec2 wp){',
      '  if (uTheme < 1.5) return 0.0;',
      '  float hole = fbm(wp * uFreq * 0.7 + vec2(19.3, 7.1));',
      '  return smoothstep(0.60, 0.78, hole);',
      '}',
      // land mask (theme-aware): crust where the continent field clears the sea
      // threshold, minus any crater interior (those read as flooded holes).
      'float landMask(vec2 wp){',
      '  float cont = fbm(wp * uFreq);',
      '  float seaT = seaThreshold();',
      '  float land = smoothstep(seaT, seaT + 0.05, cont);',
      '  return land * (1.0 - craterPit(wp));',
      '}',
      'float terrainH(vec2 wp){',
      '  float cont = fbm(wp * uFreq);',
      '  float seaT = seaThreshold();',
      '  float land = smoothstep(seaT, seaT + 0.05, cont);',
      '  float elev = max(0.0, cont - seaT) * uHeight;',
      '  elev += fbm(wp * uFreq * 4.0) * land * (uHeight * 0.30);',            // broken crust
      '  elev += abs(fbm(wp * uFreq * 8.0) - 0.5) * land * (uHeight * 0.24);', // jagged gravitanium ridges
      '  float pit = craterPit(wp);',
      '  elev = mix(elev, -uHeight * 0.40, pit);',                             // carve the crater down
      '  land *= (1.0 - pit);',
      '  float wave = sin(wp.x*0.35 + uTime*1.3)*0.06 + sin(wp.y*0.31 - uTime*1.1)*0.05;',
      '  return mix(wave, elev, land);',
      '}',
    ].join('\n');

    const VERT = [
      NOISE_GLSL,
      'varying vec3 vWorldPos; varying vec3 vNormal; varying float vCont; varying float vLand;',
      'void main(){',
      '  vec4 wp4 = modelMatrix * vec4(position, 1.0);',   // world XZ, parent-transform safe
      '  vec2 wp = wp4.xz;',
      '  float h = terrainH(wp);',
      '  float e = 2.0;',                                   // finite-diff step for analytic normal
      '  float hx = terrainH(wp + vec2(e, 0.0));',
      '  float hz = terrainH(wp + vec2(0.0, e));',
      '  vNormal = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));',
      '  vCont = fbm(wp * uFreq);',
      '  vLand = landMask(wp);',
      '  vec3 dp = position; dp.y += h;',                  // displace in local space (plane is flat)
      '  vec4 world = modelMatrix * vec4(dp, 1.0);',
      '  vWorldPos = world.xyz;',
      '  gl_Position = projectionMatrix * viewMatrix * world;',
      '}',
    ].join('\n');

    const FRAG = [
      NOISE_GLSL,
      'varying vec3 vWorldPos; varying vec3 vNormal; varying float vCont; varying float vLand;',
      'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient; uniform vec3 uSky;',
      'uniform float uFogNear; uniform float uFogFar; uniform float uFadeToAlpha;',
      'void main(){',
      '  float e = vWorldPos.y;',                           // world elevation (water ~0, islands up)
      '  vec3 col;',
      '  if (vLand < 0.5){',                                // ---- water (flooded craters / ocean) ----
      '    float depth = clamp((seaThreshold() - vCont) * 6.0, 0.0, 1.0);',
      '    vec3 deep = vec3(0.02, 0.11, 0.20);',
      '    vec3 shallow = vec3(0.07, 0.40, 0.48);',
      '    col = mix(shallow, deep, depth);',
      '    float sp = vnoise(vWorldPos.xz*1.6 + vec2(uTime*0.17, uTime*0.11));',
      '    float sp2 = vnoise(vWorldPos.xz*3.4 - vec2(uTime*0.12, uTime*0.19));',
      '    float spark = pow(clamp(1.0 - abs(sin(sp*6.2831)+sin(sp2*6.2831))*0.5, 0.0, 1.0), 4.0);',
      '    col += spark * vec3(0.20, 0.26, 0.28);',
      '  } else {',                                          // ---- gravitanium crust (dead, inhospitable) ----
      // The surface is scarred gravitanium, NOT lush terrain — the only green
      // lives on the survivor islands (separate meshes). Dark crystalline crust
      // with jagged lighter ridges, mineral glints, and a faint violet vein glow.
      '    vec3 crust = vec3(0.085, 0.088, 0.115);',
      '    vec3 ridge = vec3(0.26, 0.25, 0.30);',
      '    vec3 vein = vec3(0.22, 0.62, 0.72);',
      '    col = crust;',
      '    col = mix(col, ridge, smoothstep(1.0, 6.0, e));',
      '    float glint = pow(vnoise(vWorldPos.xz*2.2), 8.0);',
      '    col += glint * vec3(0.30, 0.40, 0.52) * 0.5;',    // crystalline sparkle
      '    float veinM = smoothstep(0.58, 0.76, fbm(vWorldPos.xz*0.8));',
      '    col = mix(col, vein, veinM * 0.22);',             // gravitanium glow in the cracks
      '    col *= 0.90 + fbm(vWorldPos.xz*0.5)*0.18;',       // tonal variation
      '  }',
      // foam ribbon hugging the waterline (both sides of the coast transition)
      '  float foam = (1.0 - smoothstep(0.0, 0.06, abs(vLand - 0.5))) * 0.6;',
      '  foam *= 0.6 + 0.4*vnoise(vWorldPos.xz*2.5 + uTime*0.6);',
      '  col = mix(col, vec3(0.96, 0.98, 1.0), clamp(foam, 0.0, 1.0));',
      // Lambert diffuse from the live sun + day/night ambient
      '  float diff = max(dot(normalize(vNormal), normalize(uSunDir)), 0.0);',
      '  col = col * (uAmbient + uSunColor * diff);',
      // Distance blend. Two layers share this shader: the NEAR detailed layer
      // fades to TRANSPARENT at its edge (uFadeToAlpha=1) so the huge coarse FAR
      // layer shows through behind it; the FAR layer fades to sky (uFadeToAlpha=0)
      // so the horizon dissolves with no visible plane edge. Result: layered
      // landscape receding endlessly into haze.
      '  float dist = distance(cameraPosition, vWorldPos);',
      '  float fog = smoothstep(uFogNear, uFogFar, dist);',
      '  if (uFadeToAlpha > 0.5){',
      '    if (fog > 0.985) discard;',                       // don\'t write depth where fully faded -> far layer shows
      '    gl_FragColor = vec4(col, 1.0 - fog);',
      '  } else {',
      '    col = mix(col, uSky, fog);',
      '    gl_FragColor = vec4(col, 1.0);',
      '  }',
      '}',
    ].join('\n');

    // ===================== state =====================
    // Surface theme: 0 = flooded scar-world (default), 1 = ocean + survivors,
    // 2 = crust + crater holes. Switchable at runtime (setTheme / cycle key)
    // so the look can be chosen by eye in flight.
    const THEME_NAMES = ['flooded scar-world', 'ocean + survivors', 'crust + crater holes'];
    let _theme = 0;
    let layers = [];              // [{ mesh, mat, cfg }] near-first
    let built = false, raf = null;
    let sunLight = null, sunSearched = false;
    let last = 0, tSec = 0;
    const _sky = new THREE.Color(0x9fb8d0);
    const _sunC = new THREE.Color(0xffffff);
    const _amb = new THREE.Color(0x404850);
    const _sunDir = new THREE.Vector3(0.4, 1.0, 0.3).normalize();

    function build() {
      if (built) return layers;
      layers = LAYERS.map((cfg, i) => {
        const geo = new THREE.PlaneGeometry(cfg.plane, cfg.plane, cfg.segs, cfg.segs);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uTheme: { value: _theme },
            uFreq: { value: 0.012 },
            uHeight: { value: 11.0 },
            uSea: { value: 0.52 },
            uSunDir: { value: _sunDir },
            uSunColor: { value: _sunC },
            uAmbient: { value: _amb },
            uSky: { value: _sky },
            uFogNear: { value: cfg.fogNear },
            uFogFar: { value: cfg.fogFar },
            uFadeToAlpha: { value: cfg.fadeToAlpha },
          },
          vertexShader: VERT,
          fragmentShader: FRAG,
          transparent: cfg.transparent,
          depthWrite: cfg.depthWrite,
          fog: false,   // all fog is in-shader; ignore the poser's short scene.fog
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = i === 0 ? 'infiniteSurface' : 'infiniteSurfaceFar';
        mesh.frustumCulled = false;   // recenters every frame; bounds would be stale
        mesh.renderOrder = cfg.order; // behind the detailed poser sea/islands near centre
        mesh.visible = false;
        return { mesh, mat, cfg };
      });
      built = true;
      return layers;
    }

    // The day/night sun is the one shadow-casting directional light (02-cameras-
    // lighting.js:233); the scene also holds several decorative/fill directionals,
    // so castShadow uniquely identifies it. Cache once; read colour+intensity live.
    function findSun() {
      if (sunSearched) return sunLight;
      const sc = sceneRef();
      if (!sc) return null;   // retry next tick once scene exists
      sunSearched = true;
      let best = null, bestI = -1;
      sc.traverse((o) => {
        if (!o.isDirectionalLight) return;
        const shadowed = o.castShadow ? 1e6 : 0;   // prefer the shadow caster
        const score = shadowed + o.intensity;
        if (score > bestI) { bestI = score; best = o; }
      });
      sunLight = best;
      return sunLight;
    }

    function updateUniforms() {
      if (!layers.length) return;
      const sc = sceneRef();
      // sky / fog colour from the live day-night background (dark blue at night,
      // bright at midday) — the single source that makes the surface obey the clock.
      if (sc && sc.background && sc.background.isColor) _sky.copy(sc.background);
      // sun direction (constant SUN_OFFSET) + live colour*intensity; target moves
      // in flight, so use position - target, never raw position.
      const sun = findSun();
      if (sun) {
        _sunDir.copy(sun.position);
        if (sun.target) _sunDir.sub(sun.target.position);
        if (_sunDir.lengthSq() < 1e-6) _sunDir.set(0.4, 1.0, 0.3);
        _sunDir.normalize();
        _sunC.copy(sun.color).multiplyScalar(Math.min(1.4, sun.intensity));
      } else {
        _sunC.setRGB(1, 1, 1);
      }
      // Ambient is the sky bounced back off the water: derive it from the live sky
      // colour (so night stays dark/blue, midday bright) with a small floor so land
      // is never pure black. A live hemisphere light, if present, tints the ground.
      _amb.setRGB(
        Math.min(1, _sky.r * 1.15 + 0.05),
        Math.min(1, _sky.g * 1.15 + 0.05),
        Math.min(1, _sky.b * 1.15 + 0.06),
      );
      // _sky/_sunC/_amb/_sunDir are shared uniform object refs across both layers,
      // so mutating them updates both; only uTime is per-material.
      for (const L of layers) L.mat.uniforms.uTime.value = tSec;
    }

    function recenter() {
      const cam = cameraRef();
      if (!cam || !layers.length) return;
      for (const L of layers) {
        const snap = L.cfg.snap;
        const cx = Math.round(cam.position.x / snap) * snap;
        const cz = Math.round(cam.position.z / snap) * snap;
        L.mesh.position.set(cx, SEA_Y + L.cfg.yOff, cz);
      }
    }

    // Self-driven tick (like the poser sea). Also exposed for 34 to call if it wants.
    function tick(now) {
      if (!isActive()) return;
      const t = (typeof now === 'number') ? now
        : ((performance && performance.now) ? performance.now() : Date.now());
      if (!last) last = t;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      tSec += dt;
      recenter();
      updateUniforms();
    }

    function startTick() {
      if (raf) return;
      last = 0;
      const loop = (now) => { tick(now); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    function stopTick() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

    function show() {
      build();
      const par = parentNode();
      if (!par) return false;
      for (const L of layers) { if (L.mesh.parent !== par) par.add(L.mesh); L.mesh.visible = true; }
      recenter();
      updateUniforms();
      startTick();
      return true;
    }

    function hide() {
      stopTick();
      for (const L of layers) {
        if (L.mesh.parent) L.mesh.parent.remove(L.mesh);
        if (L.mesh.geometry) L.mesh.geometry.dispose();
        if (L.mat) L.mat.dispose();
        L.mesh.visible = false;
      }
      // reset lazy-build state so a re-show rebuilds fresh GPU buffers
      layers = []; built = false;
      sunLight = null; sunSearched = false;
      tSec = 0; last = 0;
    }

    function isActive() { return !!(layers[0] && layers[0].mesh.visible); }

    function setTheme(n) {
      _theme = ((n % 3) + 3) % 3;               // clamp/wrap to 0..2
      for (const L of layers) L.mat.uniforms.uTheme.value = _theme;
      if (typeof window.toast === 'function' && isActive()) {
        window.toast('Surface: ' + THEME_NAMES[_theme]);
      }
      return _theme;
    }
    function getTheme() { return _theme; }
    function cycleTheme() { return setTheme(_theme + 1); }

    // Dev/testing: press T while the surface is showing to cycle the look.
    window.addEventListener('keydown', (e) => {
      if (!isActive()) return;
      if ((e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey && !e.altKey) cycleTheme();
    });

    window.__tinyworldInfiniteSurface = { show, hide, tick, isActive, setTheme, getTheme, cycleTheme };
  })();
