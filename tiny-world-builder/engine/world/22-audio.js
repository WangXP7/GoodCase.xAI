  // -------- audio --------
  // Music: random sessions pick from the Horizon themes only. Rising stays in
  // the picker as a deliberate manual choice. Music can't auto-play before a
  // user gesture, so we defer the first .play() to the next pointerdown/keydown.
  //
  // SFX: small pools of foley clips. playSfx(group) clones the chosen node
  // so overlapping plays don't truncate each other. A per-group min-gap
  // prevents drag-painting from machine-gunning sounds.
  const AUDIO_LS = {
    music:        'tinyworld:audio:music',
    sfx:          'tinyworld:audio:sfx',
    ambient:      'tinyworld:audio:ambient',
    engines:      'tinyworld:audio:engines',
    musicMuted:   'tinyworld:audio:music-muted',
    sfxMuted:     'tinyworld:audio:sfx-muted',
    ambientMuted: 'tinyworld:audio:ambient-muted',
    enginesMuted: 'tinyworld:audio:engines-muted',
    musicTrack:   'tinyworld:audio:music-track',
    musicMode:    'tinyworld:audio:music-mode',
    ambientRange: 'tinyworld:audio:ambient-range',
    enginesRange: 'tinyworld:audio:engines-range',
  };
  function storedAudio(key, fallback, min, max) {
    const v = parseFloat(localStorage.getItem(key));
    if (!isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, v));
  }
  let audioMusicVolume   = storedAudio(AUDIO_LS.music,   0.20, 0, 1);
  let audioSfxVolume     = storedAudio(AUDIO_LS.sfx,     0.7,  0, 1);
  let audioAmbientVolume = storedAudio(AUDIO_LS.ambient, 0.6,  0, 1);
  let audioEnginesVolume = storedAudio(AUDIO_LS.engines, 0.55, 0, 1);
  let audioMusicMuted    = localStorage.getItem(AUDIO_LS.musicMuted)    === '1';
  let audioSfxMuted      = localStorage.getItem(AUDIO_LS.sfxMuted)      === '1';
  let audioAmbientMuted  = localStorage.getItem(AUDIO_LS.ambientMuted)  === '1';
  let audioEnginesMuted  = localStorage.getItem(AUDIO_LS.enginesMuted)  === '1';

  const SOUNDS_BASE = 'sounds/';
  const MUSIC_TRACKS = [
    'music-horizon-1.mp3',
    'music-horizon-2.mp3',
    'music-horizon-3.mp3',
    'music-horizon-4.mp3',
    'music-horizon-5.mp3',
    'music-horizon-6.mp3',
    'music-rising-1.mp3',
  ];
  const MUSIC_RANDOM_TRACKS = MUSIC_TRACKS.filter(name => /^music-horizon-\d+\.mp3$/i.test(name));
  const SFX_GROUPS = {
    rustle: ['foley-rustle-1.mp3', 'foley-rustle-2.mp3', 'foley-rustle-3.mp3'],
    knock:  ['foley-knock-jingle-1.mp3', 'foley-knock-jingle-2.mp3'],
    whoosh: ['foley-whoosh-1.mp3', 'foley-whoosh-2.mp3'],
    ripple: ['foley-digital ripple activity.mp3'],
    // 'land' reuses the rustle pool but has its own clock + a longer gap,
    // so cascade landings (boot/reset/clear) thin out instead of forming
    // a wall of foley over the rustle channel.
    land:   ['foley-rustle-1.mp3', 'foley-rustle-2.mp3', 'foley-rustle-3.mp3'],
  };
  // Minimum time (ms) between two plays of the same group. Drag-painting
  // tiles must not produce a machine-gun of identical foley.
  const SFX_MIN_GAP = { rustle: 70, knock: 90, whoosh: 110, ripple: 240, land: 180 };
  const sfxPool = {};
  for (const g of Object.keys(SFX_GROUPS)) {
    sfxPool[g] = SFX_GROUPS[g].map(name => {
      const a = new Audio(SOUNDS_BASE + encodeURIComponent(name));
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      return a;
    });
  }
  const sfxLastPlay = { rustle: 0, knock: 0, whoosh: 0, ripple: 0, land: 0 };

  function playSfx(group, scale) {
    if (audioSfxMuted) return;
    const now = performance.now();
    if (now - (sfxLastPlay[group] || 0) < (SFX_MIN_GAP[group] || 80)) return;
    sfxLastPlay[group] = now;
    const pool = sfxPool[group];
    if (!pool || !pool.length) return;
    const base = pool[Math.floor(Math.random() * pool.length)];
    // cloneNode keeps the preloaded src reference; cheaper than `new Audio`.
    const node = base.cloneNode();
    node.volume = Math.max(0, Math.min(1, audioSfxVolume * (scale || 1)));
    // Drop the clone after it finishes so we don't leak HTMLAudioElements.
    node.addEventListener('ended', () => { node.src = ''; }, { once: true });
    const p = node.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  function playSfxForTool(tool) {
    if (!tool || tool.auto) return;
    if (tool.erase) { playSfx('whoosh'); return; }
    if (tool.kind === 'house' || tool.kind === 'fence' || tool.kind === 'model-stamp') { playSfx('knock'); return; }
    if (tool.kind || tool.terrain) { playSfx('rustle'); return; }
  }

  let musicAudio = null;
  let musicStarted = false;
  let musicPickedTrack = null;
  function randomMusicTrack() {
    const pool = MUSIC_RANDOM_TRACKS.length ? MUSIC_RANDOM_TRACKS : MUSIC_TRACKS;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function manualMusicTrack() {
    const mode = localStorage.getItem(AUDIO_LS.musicMode);
    const savedTrack = localStorage.getItem(AUDIO_LS.musicTrack);
    return mode === 'manual' && savedTrack && MUSIC_TRACKS.includes(savedTrack) ? savedTrack : null;
  }
  function startMusicIfNeeded() {
    if (musicStarted || audioMusicMuted) return;
    musicStarted = true;
    musicPickedTrack = manualMusicTrack() || musicPickedTrack || randomMusicTrack();
    musicAudio = new Audio(SOUNDS_BASE + musicPickedTrack);
    musicAudio.loop = true;
    musicAudio.volume = audioMusicVolume;
    musicAudio.crossOrigin = 'anonymous';
    const p = musicAudio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Autoplay still blocked — let the next gesture try again.
        musicStarted = false;
        musicAudio = null;
      });
    }
  }
  // Lazily start music on the first user gesture (any pointer or key event).
  function armMusicAutostart() {
    const handler = () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
      startMusicIfNeeded();
    };
    window.addEventListener('pointerdown', handler, { passive: true });
    window.addEventListener('keydown', handler);
  }
  armMusicAutostart();

  function applyAudioState() {
    if (musicAudio) musicAudio.volume = audioMusicMuted ? 0 : audioMusicVolume;
    // SFX volume is applied per-play; nothing to update here.
    // Positional buses (ambient/engines) are updated by the tick loop.
    if (typeof updatePositionalBusGains === 'function') updatePositionalBusGains();
    try {
      localStorage.setItem(AUDIO_LS.music,    String(audioMusicVolume));
      localStorage.setItem(AUDIO_LS.sfx,      String(audioSfxVolume));
      localStorage.setItem(AUDIO_LS.ambient,  String(audioAmbientVolume));
      localStorage.setItem(AUDIO_LS.engines,  String(audioEnginesVolume));
      localStorage.setItem(AUDIO_LS.musicMuted,    audioMusicMuted    ? '1' : '0');
      localStorage.setItem(AUDIO_LS.sfxMuted,      audioSfxMuted      ? '1' : '0');
      localStorage.setItem(AUDIO_LS.ambientMuted,  audioAmbientMuted  ? '1' : '0');
      localStorage.setItem(AUDIO_LS.enginesMuted,  audioEnginesMuted  ? '1' : '0');
    } catch (_) {}
  }
  function setMusicVolume(v) {
    audioMusicVolume = Math.max(0, Math.min(1, v));
    if (!audioMusicMuted && !musicStarted) startMusicIfNeeded();
    applyAudioState();
  }
  function setSfxVolume(v) {
    audioSfxVolume = Math.max(0, Math.min(1, v));
    applyAudioState();
  }
  function setMusicMuted(m) {
    audioMusicMuted = !!m;
    if (audioMusicMuted && musicAudio) {
      musicAudio.pause();
    } else if (!audioMusicMuted) {
      if (!musicStarted) startMusicIfNeeded();
      else if (musicAudio) musicAudio.play().catch(() => {});
    }
    applyAudioState();
  }
  function setSfxMuted(m) {
    audioSfxMuted = !!m;
    applyAudioState();
  }
  function setAmbientVolume(v) {
    audioAmbientVolume = Math.max(0, Math.min(1, v));
    applyAudioState();
  }
  function setEnginesVolume(v) {
    audioEnginesVolume = Math.max(0, Math.min(1, v));
    applyAudioState();
  }
  function setAmbientMuted(m) {
    audioAmbientMuted = !!m;
    applyAudioState();
  }
  function setEnginesMuted(m) {
    audioEnginesMuted = !!m;
    applyAudioState();
  }
  // Switch the playing music track on the fly. Persists user choice.
  function setMusicTrack(name) {
    if (typeof name !== 'string' || !MUSIC_TRACKS.includes(name)) return;
    try { localStorage.setItem(AUDIO_LS.musicTrack, name); } catch (_) {}
    try { localStorage.setItem(AUDIO_LS.musicMode, 'manual'); } catch (_) {}
    musicPickedTrack = name;
    // Restart playback so the new track takes over immediately if music is on.
    if (musicAudio) {
      try { musicAudio.pause(); } catch (_) {}
      try { musicAudio.src = ''; } catch (_) {}
    }
    musicAudio = null;
    musicStarted = false;
    if (!audioMusicMuted) startMusicIfNeeded();
  }
  function setMusicRandomTrack() {
    try { localStorage.removeItem(AUDIO_LS.musicTrack); } catch (_) {}
    try { localStorage.removeItem(AUDIO_LS.musicMode); } catch (_) {}
    musicPickedTrack = randomMusicTrack();
    if (musicAudio) {
      try { musicAudio.pause(); } catch (_) {}
      try { musicAudio.src = ''; } catch (_) {}
    }
    musicAudio = null;
    musicStarted = false;
    if (!audioMusicMuted) startMusicIfNeeded();
  }
  function currentMusicTrack() {
    return musicPickedTrack || manualMusicTrack() || MUSIC_RANDOM_TRACKS[0] || MUSIC_TRACKS[0];
  }

  // -------- positional audio (water + engines) --------
  // Web Audio sources placed at world positions. Each is a looped buffer
  // routed through Gain → StereoPanner → master. Per-frame we compute
  // distance-based volume and L/R pan from the camera so sounds rise and
  // fall as you move around the world. Two overlapping variants per
  // location with random start offsets mask the loop point.
  let _audioCtx = null;
  let _audioMaster = null;
  const _audioBufferCache = new Map();           // url -> Promise<AudioBuffer>
  const _positionalSources = [];                 // active source descriptors
  const WATER_FOLEY = ['foley-water-1.mp3','foley-water-2.mp3','foley-water-3.mp3','foley-water-4.mp3'];
  const ENGINE_FOLEY = ['foley-rocket-engines-1.mp3','foley-rocket-engines-2.mp3','foley-rocket-engines-3.mp3','foley-rocket-engines-4.mp3'];

  function ensureAudioCtx() {
    if (_audioCtx) return _audioCtx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      _audioCtx = new Ctor();
      _audioMaster = _audioCtx.createGain();
      _audioMaster.gain.value = 1.0;
      _audioMaster.connect(_audioCtx.destination);
    } catch (_) { _audioCtx = null; }
    return _audioCtx;
  }

  function resumeAudioCtxIfNeeded() {
    if (!_audioCtx) return;
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(() => {});
    }
  }

  function loadAudioBuffer(url) {
    const ctx = ensureAudioCtx();
    if (!ctx) return Promise.resolve(null);
    if (_audioBufferCache.has(url)) return _audioBufferCache.get(url);
    const p = fetch(SOUNDS_BASE + url)
      .then(r => r.arrayBuffer())
      .then(buf => new Promise((resolve, reject) => {
        // Some browsers expect callback form; promise form fails silently.
        try {
          const ret = ctx.decodeAudioData(buf, resolve, reject);
          if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
        } catch (err) { reject(err); }
      }))
      .catch(() => null);
    _audioBufferCache.set(url, p);
    return p;
  }

  // bus: 'ambient' (water) or 'engines' (planes)
  async function spawnPositionalSource(url, getPos, bus, baseVolume = 1.0, startOffsetSec = null) {
    const ctx = ensureAudioCtx();
    if (!ctx) return null;
    const buf = await loadAudioBuffer(url);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = ctx.createStereoPanner();
    src.connect(gain).connect(panner).connect(_audioMaster);
    // Random start offset so two variants don't sync up + the loop seam
    // doesn't always land at the same world moment.
    const offset = (startOffsetSec == null)
      ? Math.random() * Math.max(0.1, buf.duration - 0.1)
      : Math.max(0, Math.min(buf.duration - 0.05, startOffsetSec));
    try { src.start(0, offset); } catch (_) {}
    const entry = { src, gain, panner, getPos, bus, baseVolume, alive: true };
    _positionalSources.push(entry);
    return entry;
  }

  function disposePositionalSource(entry) {
    if (!entry || !entry.alive) return;
    entry.alive = false;
    try { entry.src.stop(); } catch (_) {}
    try { entry.src.disconnect(); } catch (_) {}
    try { entry.gain.disconnect(); } catch (_) {}
    try { entry.panner.disconnect(); } catch (_) {}
    const idx = _positionalSources.indexOf(entry);
    if (idx >= 0) _positionalSources.splice(idx, 1);
  }

  // Distance falloff curve. Audible from ~3m, silent past ~35m.
  const POSITIONAL_NEAR = 3.0;
  const POSITIONAL_FAR  = 35.0;
  // Max stereo width for positional sources. A StereoPanner value of ±1 is a
  // full hard pan (sound vanishes from one ear). Cap well under that so a
  // source off to the side still reads directional but stays audible in both
  // ears as you walk past it.
  const POSITIONAL_PAN_WIDTH = 0.65;

  const _camFwd = new THREE.Vector3();
  const _camRight = new THREE.Vector3();
  const _camUp = new THREE.Vector3();
  function tickPositionalAudio() {
    if (!_audioCtx || _positionalSources.length === 0) return;
    if (_audioCtx.state === 'suspended') return;
    // Camera basis vectors for stereo panning. We project the source's
    // horizontal offset onto the camera-right axis and divide by distance
    // to get a -1..+1 pan value.
    camera.getWorldDirection(_camFwd);
    _camUp.set(0, 1, 0);
    _camRight.copy(_camFwd).cross(_camUp).normalize();
    const cam = camera.position;
    const now = _audioCtx.currentTime;
    for (let i = _positionalSources.length - 1; i >= 0; i--) {
      const e = _positionalSources[i];
      let pos = null;
      try { pos = e.getPos(); } catch (_) { pos = null; }
      let finalVol = 0;
      let pan = 0;
      if (pos) {
        const dx = pos.x - cam.x;
        const dy = pos.y - cam.y;
        const dz = pos.z - cam.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        // Falloff — tight per bus so each sound is only audible when really
        // near its source. Without this, an "ambient" source at the river
        // bleeds across the whole island.
        let near = POSITIONAL_NEAR, far = POSITIONAL_FAR;
        let curveExp = 2; // quadratic by default
        if (e.bus === 'engines') {
          // Planes fly past at offscreen distance ~26 + camera radius ~35,
          // so peak distance is comfortably under 80. Use a wider range
          // with linear-ish curve so you hear the approach and fade.
          near = 4; far = 90; curveExp = 1.2;
        } else if (e.bus === 'ambient') {
          near = 1.5; far = 11; curveExp = 2;
        }
        const t = Math.max(0, Math.min(1, (dist - near) / Math.max(0.001, far - near)));
        const vol = Math.pow(1 - t, curveExp) * e.baseVolume;
        // Pan: horizontal offset projected onto camera-right.
        const px = dx * _camRight.x + dz * _camRight.z;
        const norm = dist > 0.5 ? px / dist : 0;
        pan = Math.max(-POSITIONAL_PAN_WIDTH, Math.min(POSITIONAL_PAN_WIDTH, norm * POSITIONAL_PAN_WIDTH));
        const busOn = e.bus === 'engines' ? !audioEnginesMuted : !audioAmbientMuted;
        const busLvl = e.bus === 'engines' ? audioEnginesVolume : audioAmbientVolume;
        finalVol = busOn ? vol * busLvl : 0;
      }
      try {
        e.gain.gain.setTargetAtTime(finalVol, now, 0.08);
        e.panner.pan.setTargetAtTime(pan, now, 0.08);
      } catch (_) {}
    }
  }

  // Master volume bus update — re-applied by applyAudioState through this
  // shim. Pure no-op when context not yet built.
  function updatePositionalBusGains() {
    if (!_audioCtx) return;
    // Per-source gains get updated in the next tick anyway.
  }

  // --- water sources -----------------------------------------------------
  // Pick a few cluster centres from the home water cells and place two
  // overlapping variants per cluster. Re-evaluated when the world changes.
  const _waterSources = [];
  function clearWaterSources() {
    for (const e of _waterSources.splice(0)) disposePositionalSource(e);
  }
  function collectWaterClusterCenters() {
    const cells = [];
    if (typeof world === 'undefined' || !world) return cells;
    for (let x = 0; x < GRID; x++) {
      const col = world[x];
      if (!col) continue;
      for (let z = 0; z < GRID; z++) {
        const c = col[z];
        if (c && c.terrain === 'water') {
          const p = (typeof tilePos === 'function') ? tilePos(x, z) : { x: x - GRID/2 + 0.5, z: z - GRID/2 + 0.5 };
          cells.push({ x: p.x, z: p.z });
        }
      }
    }
    if (!cells.length) return [];
    // Single cluster: use centroid. Good enough for the typical river layout.
    let cx = 0, cz = 0;
    for (const p of cells) { cx += p.x; cz += p.z; }
    cx /= cells.length; cz /= cells.length;
    return [{ x: cx, y: 0, z: cz }];
  }
  async function rebuildWaterSources() {
    clearWaterSources();
    if (!ensureAudioCtx()) return;
    const centers = collectWaterClusterCenters();
    if (!centers.length) return;
    for (const c of centers) {
      const v1 = WATER_FOLEY[Math.floor(Math.random() * WATER_FOLEY.length)];
      let v2 = WATER_FOLEY[Math.floor(Math.random() * WATER_FOLEY.length)];
      if (v2 === v1) v2 = WATER_FOLEY[(WATER_FOLEY.indexOf(v2) + 1) % WATER_FOLEY.length];
      const getPos = () => c;
      const a = await spawnPositionalSource(v1, getPos, 'ambient', 0.85);
      const b = await spawnPositionalSource(v2, getPos, 'ambient', 0.55);
      if (a) _waterSources.push(a);
      if (b) _waterSources.push(b);
    }
  }

  // --- engine sources ----------------------------------------------------
  // One looped rocket-engine source per plane. The plane's world position
  // drives the panner each frame. Silent when the plane is hidden.
  const _engineSources = [];
  async function setupEngineSources() {
    if (!ensureAudioCtx()) return;
    if (_engineSources.length || typeof planes === 'undefined' || !planes) return;
    for (let i = 0; i < planes.length; i++) {
      const plane = planes[i];
      const variant = ENGINE_FOLEY[i % ENGINE_FOLEY.length];
      const getPos = (() => {
        const wp = new THREE.Vector3();
        return () => {
          if (!plane || !plane.group || !plane.group.visible) return null;
          plane.group.getWorldPosition(wp);
          return wp;
        };
      })();
      const entry = await spawnPositionalSource(variant, getPos, 'engines', 1.0);
      if (entry) _engineSources.push(entry);
    }
  }

  // --- flyable-plane engine synth (propeller drone + wind rush) ----------
  // A continuous, synthesised propeller-plane loop driven from 34-flight-sim.js
  // (start on flight entry, stop on exit, update(throttle, speed) each frame).
  // No audio files: two detuned sawtooth oscillators through a throttle-swept
  // lowpass form the engine drone; a slow LFO on the drone gain gives the
  // propeller "chop"; looped white noise through a speed-swept bandpass is the
  // wind rush. Everything routes through a private channel gain that mirrors the
  // shared "engines" volume/mute into the same master as the positional
  // sources. stop() halts and disconnects every node so nothing leaks.
  let _flightEngine = null;

  function _flightEngineNoiseBuffer(ctx) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function startFlightEngineAudio() {
    // Only ever runs inside an active flight, which itself begins from a user
    // gesture, so the shared context is already unlocked by this point. This is
    // never the first thing to create/resume the context on its own — the
    // ensure/resume calls below are a defensive fallback, not a forced start.
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    resumeAudioCtxIfNeeded();
    if (_flightEngine) stopFlightEngineAudio();

    const now = ctx.currentTime;
    const channel = ctx.createGain();
    channel.gain.value = 0;                 // update() sets the real level
    channel.connect(_audioMaster);

    // engine drone -------------------------------------------------------
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 0.7;
    lp.connect(droneGain).connect(channel);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 48;
    osc1.connect(lp);
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 96;
    osc2.detune.value = 6;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.5;
    osc2.connect(osc2Gain).connect(lp);

    // propeller chop: an LFO amplitude-modulates the drone gain AudioParam.
    const chop = ctx.createOscillator();
    chop.type = 'sine';
    chop.frequency.value = 9;
    const chopGain = ctx.createGain();
    chopGain.gain.value = 0.0001;
    chop.connect(chopGain).connect(droneGain.gain);

    // wind rush ----------------------------------------------------------
    const noise = ctx.createBufferSource();
    noise.buffer = _flightEngineNoiseBuffer(ctx);
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.0001;
    noise.connect(bp).connect(windGain).connect(channel);

    try { osc1.start(now); } catch (_) {}
    try { osc2.start(now); } catch (_) {}
    try { chop.start(now); } catch (_) {}
    try { noise.start(now); } catch (_) {}

    _flightEngine = {
      // Every node created above is listed in `nodes` (disconnected on stop);
      // every startable source is listed in `sources` (stopped on stop). Keep
      // both exhaustive so stop() can never leak a running node.
      nodes: [channel, droneGain, lp, osc1, osc2, osc2Gain, chop, chopGain, noise, bp, windGain],
      sources: [osc1, osc2, chop, noise],
      channel, droneGain, lp, osc1, osc2, chop, chopGain, bp, windGain,
    };
  }

  function updateFlightEngineAudio(throttle, speed) {
    const e = _flightEngine;
    if (!e || !_audioCtx || _audioCtx.state === 'suspended') return;
    const now = _audioCtx.currentTime;
    const thr = Math.max(0, Math.min(1, throttle || 0));
    const spdN = Math.min(1, Math.max(0, speed || 0) / 110);

    // Drone pitch + brightness rise with throttle.
    const f = 48 + thr * 46;
    e.osc1.frequency.setTargetAtTime(f, now, 0.06);
    e.osc2.frequency.setTargetAtTime(f * 2, now, 0.06);
    e.lp.frequency.setTargetAtTime(320 + thr * 1500, now, 0.08);

    // Drone loudness + propeller chop rate/depth rise with throttle. The chop
    // LFO swings +/- chopDepth around the gain param, so the base value is
    // offset down by chopDepth to keep the modulated gain strictly positive.
    const droneAmp = 0.10 + thr * 0.22;
    const chopDepth = droneAmp * (0.20 + thr * 0.22);
    e.droneGain.gain.setTargetAtTime(droneAmp - chopDepth, now, 0.08);
    e.chopGain.gain.setTargetAtTime(chopDepth, now, 0.08);
    e.chop.frequency.setTargetAtTime(8 + thr * 13, now, 0.1);

    // Wind rush rises with airspeed.
    e.bp.frequency.setTargetAtTime(420 + spdN * 1200, now, 0.1);
    e.windGain.gain.setTargetAtTime(spdN * spdN * 0.14, now, 0.1);

    // Mirror the shared "engines" channel volume/mute, read fresh each frame
    // exactly like the positional sources track their bus.
    const level = audioEnginesMuted ? 0 : audioEnginesVolume;
    e.channel.gain.setTargetAtTime(level, now, 0.05);
  }

  function stopFlightEngineAudio() {
    const e = _flightEngine;
    _flightEngine = null;
    if (!e) return;
    for (const s of e.sources) { try { s.stop(); } catch (_) {} }
    for (const n of e.nodes) { try { n.disconnect(); } catch (_) {} }
  }

  window.__flightEngineAudio = {
    start: startFlightEngineAudio,
    update: updateFlightEngineAudio,
    stop: stopFlightEngineAudio,
  };

  // -------- one-shot combat SFX (guns / missiles / explosions / impacts), synthesised --------
  // Each call builds a tiny throwaway node graph, schedules an amplitude
  // envelope, and disconnects every node once its sources end — so nothing
  // accumulates however fast the guns fire. All route through _audioMaster and
  // honour the shared "sfx" bus volume/mute (these are one-shot SFX, not the
  // continuous engine drone), read fresh at trigger time. An optional
  // opts.gain (0..1, distance attenuation) multiplies on top of the bus level.
  let _combatNoise = null;
  function _combatNoiseBuffer(ctx) {
    if (_combatNoise && _combatNoise.sampleRate === ctx.sampleRate) return _combatNoise;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    _combatNoise = buf;
    return buf;
  }
  function _combatLevel(opts) {
    if (audioSfxMuted) return 0;
    let g = (opts && typeof opts.gain === 'number') ? opts.gain : 1;
    g = Math.max(0, Math.min(1, g));
    return audioSfxVolume * g;
  }

  // Voice budget: a firefight can call gun() hundreds of times a second across
  // several planes. Cap concurrent combat voices so we never spawn unbounded
  // node graphs, and gate rapid gun fire with a small inter-call floor so a
  // burst doesn't turn into a solid buzz. Both are cheap early-outs.
  const COMBAT_VOICE_CAP = 24;
  const COMBAT_GUN_MIN_GAP = 40; // ms
  let _combatVoices = 0;
  let _combatLastGun = 0;
  let _combatGunIdx = 0;
  // One voice = one node graph. `nodes` lists EVERY node the caller created;
  // `count` is how many of its sources have their onended wired to onended().
  // Teardown is idempotent (the `done` latch) so it can run from the last
  // onended OR the start()-failure fallback without double-counting the voice,
  // guaranteeing the counter can never leak and permanently silence combat.
  function _combatVoice(nodes, count) {
    _combatVoices++;
    let ended = 0, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      for (const n of nodes) { try { n.disconnect(); } catch (_) {} }
      _combatVoices--;
    };
    return { onended: () => { if (++ended >= count) finish(); }, finish };
  }

  function combatGun(opts) {
    const nowMs = performance.now();
    if (nowMs - _combatLastGun < COMBAT_GUN_MIN_GAP) return;
    const ctx = ensureAudioCtx(); if (!ctx) return;
    const lvl = _combatLevel(opts); if (lvl <= 0) return;
    if (_combatVoices >= COMBAT_VOICE_CAP) return;
    _combatLastGun = nowMs;
    resumeAudioCtxIfNeeded();
    const now = ctx.currentTime;
    // Per-call timbre variation so a sustained burst reads as distinct cracks
    // rather than a single machine buzz: a rotating index nudges the bandpass
    // centre, jittered a little more by random each shot.
    _combatGunIdx = (_combatGunIdx + 1) % 5;
    const center = 1350 + _combatGunIdx * 150 + (Math.random() - 0.5) * 260;
    const out = ctx.createGain(); out.gain.value = 0.0001; out.connect(_audioMaster);
    const noise = ctx.createBufferSource(); noise.buffer = _combatNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = center; bp.Q.value = 0.8 + Math.random() * 0.4;
    noise.connect(bp).connect(out);
    const click = ctx.createOscillator(); click.type = 'square';
    click.frequency.setValueAtTime(210 + Math.random() * 70, now);
    click.frequency.exponentialRampToValueAtTime(58 + Math.random() * 26, now + 0.05);
    const clickG = ctx.createGain(); clickG.gain.setValueAtTime(0.5 * lvl, now);
    clickG.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    click.connect(clickG).connect(out);
    const peak = 0.22 * lvl;
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    const off = now + 0.13;
    const v = _combatVoice([out, noise, bp, click, clickG], 2);
    noise.onended = v.onended; click.onended = v.onended;
    try { noise.start(now, Math.random() * 0.6); noise.stop(off); } catch (_) { v.finish(); return; }
    try { click.start(now); click.stop(off); } catch (_) {}
  }

  function combatMissile(opts) {
    const ctx = ensureAudioCtx(); if (!ctx) return;
    const lvl = _combatLevel(opts); if (lvl <= 0) return;
    if (_combatVoices >= COMBAT_VOICE_CAP) return;
    resumeAudioCtxIfNeeded();
    const now = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0.0001; out.connect(_audioMaster);
    // Rising airy whoosh.
    const noise = ctx.createBufferSource(); noise.buffer = _combatNoiseBuffer(ctx); noise.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(2400, now + 0.45);
    noise.connect(bp).connect(out);
    // Low launch thump.
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(140, now);
    sub.frequency.exponentialRampToValueAtTime(46, now + 0.22);
    const subG = ctx.createGain(); subG.gain.setValueAtTime(0.5 * lvl, now);
    subG.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    sub.connect(subG).connect(out);
    const peak = 0.26 * lvl;
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(peak, now + 0.03);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    const off = now + 0.62;
    const v = _combatVoice([out, noise, bp, sub, subG], 2);
    noise.onended = v.onended; sub.onended = v.onended;
    try { noise.start(now, Math.random() * 0.6); noise.stop(off); } catch (_) { v.finish(); return; }
    try { sub.start(now); sub.stop(off); } catch (_) {}
  }

  function combatExplosion(opts) {
    const ctx = ensureAudioCtx(); if (!ctx) return;
    const lvl = _combatLevel(opts); if (lvl <= 0) return;
    if (_combatVoices >= COMBAT_VOICE_CAP) return;
    resumeAudioCtxIfNeeded();
    const now = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0.0001; out.connect(_audioMaster);
    // Rumble: broadband noise driven through a downward-sweeping lowpass.
    const noise = ctx.createBufferSource(); noise.buffer = _combatNoiseBuffer(ctx); noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(900, now);
    lp.frequency.exponentialRampToValueAtTime(90, now + 0.7);
    noise.connect(lp).connect(out);
    // Sub-bass body thud.
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(110, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.5);
    const subG = ctx.createGain(); subG.gain.setValueAtTime(0.7 * lvl, now);
    subG.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    sub.connect(subG).connect(out);
    const peak = 0.5 * lvl;
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    const off = now + 0.95;
    const v = _combatVoice([out, noise, lp, sub, subG], 2);
    noise.onended = v.onended; sub.onended = v.onended;
    try { noise.start(now, Math.random() * 0.6); noise.stop(off); } catch (_) { v.finish(); return; }
    try { sub.start(now); sub.stop(off); } catch (_) {}
  }

  function combatImpact(opts) {
    const ctx = ensureAudioCtx(); if (!ctx) return;
    const lvl = _combatLevel(opts); if (lvl <= 0) return;
    if (_combatVoices >= COMBAT_VOICE_CAP) return;
    resumeAudioCtxIfNeeded();
    const now = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0.0001; out.connect(_audioMaster);
    // Metallic hit: a short bandpass noise transient for the "clank".
    const noise = ctx.createBufferSource(); noise.buffer = _combatNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 2600 + Math.random() * 900; bp.Q.value = 3.4;
    const nG = ctx.createGain();
    nG.gain.setValueAtTime(0.5 * lvl, now);
    nG.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    noise.connect(bp).connect(nG).connect(out);
    // Two detuned resonant partials give the "ding" ring on the hull.
    const f1 = 3100 + Math.random() * 520;
    const p1 = ctx.createOscillator(); p1.type = 'sine'; p1.frequency.value = f1;
    const p2 = ctx.createOscillator(); p2.type = 'sine'; p2.frequency.value = f1 * 1.48;
    const pG = ctx.createGain();
    pG.gain.setValueAtTime(0.26 * lvl, now);
    pG.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
    p1.connect(pG); p2.connect(pG); pG.connect(out);
    const peak = 0.3 * lvl;
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(peak, now + 0.003);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    const off = now + 0.22;
    const v = _combatVoice([out, noise, bp, nG, p1, p2, pG], 3);
    noise.onended = v.onended; p1.onended = v.onended; p2.onended = v.onended;
    try { noise.start(now, Math.random() * 0.5); noise.stop(off); } catch (_) { v.finish(); return; }
    try { p1.start(now); p1.stop(off); } catch (_) {}
    try { p2.start(now); p2.stop(off); } catch (_) {}
  }

  window.__flightCombatAudio = {
    gun: combatGun,
    missile: combatMissile,
    explosion: combatExplosion,
    impact: combatImpact,
  };

  // First-gesture initialiser — Web Audio contexts can't start until the
  // page has been interacted with. We piggy-back the existing music
  // autostart by listening for the same first gesture.
  let _positionalAudioBooted = false;
  function bootPositionalAudio() {
    if (_positionalAudioBooted) return;
    _positionalAudioBooted = true;
    ensureAudioCtx();
    resumeAudioCtxIfNeeded();
    // Water sources need the world to exist. Defer one tick so the initial
    // scene has populated `world[][]`.
    setTimeout(() => { rebuildWaterSources(); }, 50);
    setTimeout(() => { setupEngineSources(); }, 100);
  }
  (function armPositionalAudioAutostart() {
    const handler = () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
      bootPositionalAudio();
    };
    window.addEventListener('pointerdown', handler, { passive: true });
    window.addEventListener('keydown', handler);
  })();

  // Expose so external code (setCell, world load, reset) can refresh water
  // sources when the river layout changes.
  window.__tinyworldRefreshWaterAudio = () => {
    if (_positionalAudioBooted) rebuildWaterSources();
  };

  // Sound panel wiring — single icon toggles a floating panel with the
  // music track picker plus volume sliders for music, sfx, ambient, engines.
  (function setupSoundPanel() {
    const icon = document.getElementById('sound-icon');
    const panel = document.getElementById('sound-panel');
    const closeBtn = document.getElementById('sound-panel-close');
    const musicVol = document.getElementById('snd-music-vol');
    const sfxVol   = document.getElementById('snd-sfx-vol');
    const ambientVol = document.getElementById('snd-ambient-vol');
    const enginesVol = document.getElementById('snd-engines-vol');
    const musicMute   = document.getElementById('snd-music-mute');
    const sfxMute     = document.getElementById('snd-sfx-mute');
    const ambientMute = document.getElementById('snd-ambient-mute');
    const enginesMute = document.getElementById('snd-engines-mute');
    const trackList = document.getElementById('snd-music-tracks');
    if (!icon || !panel || !musicVol) return;

    // Renderable name from the file name (drop extension and clean up).
    function prettyTrackName(file) {
      return file.replace(/\.mp3$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function renderTracks() {
      if (!trackList) return;
      const active = currentMusicTrack();
      const manualTrack = manualMusicTrack();
      trackList.innerHTML = '';
      const randomBtn = document.createElement('button');
      randomBtn.type = 'button';
      randomBtn.className = 'sound-track-item' + (!manualTrack ? ' active' : '');
      randomBtn.setAttribute('role', 'option');
      randomBtn.setAttribute('aria-selected', !manualTrack ? 'true' : 'false');
      const randomDot = document.createElement('span');
      randomDot.className = 'track-dot';
      randomDot.setAttribute('aria-hidden', 'true');
      const randomLabel = document.createElement('span');
      randomLabel.textContent = 'Random Horizon';
      randomBtn.appendChild(randomDot);
      randomBtn.appendChild(randomLabel);
      randomBtn.addEventListener('click', () => {
        setMusicRandomTrack();
        renderTracks();
      });
      trackList.appendChild(randomBtn);
      MUSIC_TRACKS.forEach(name => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sound-track-item' + (manualTrack && name === active ? ' active' : '');
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', manualTrack && name === active ? 'true' : 'false');
        const dot = document.createElement('span');
        dot.className = 'track-dot';
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = prettyTrackName(name);
        btn.appendChild(dot);
        btn.appendChild(label);
        btn.addEventListener('click', () => {
          setMusicTrack(name);
          renderTracks();
        });
        trackList.appendChild(btn);
      });
    }

    function syncMuteUi() {
      musicMute.classList.toggle('muted', audioMusicMuted);
      sfxMute.classList.toggle('muted', audioSfxMuted);
      ambientMute.classList.toggle('muted', audioAmbientMuted);
      enginesMute.classList.toggle('muted', audioEnginesMuted);
      // The launcher icon is "muted" when everything is muted.
      const allMuted = audioMusicMuted && audioSfxMuted && audioAmbientMuted && audioEnginesMuted;
      icon.classList.toggle('muted', allMuted);
      if (typeof window.syncToolbarSoundButton === 'function') window.syncToolbarSoundButton();
    }
    function syncValues() {
      musicVol.value   = Math.round(audioMusicVolume   * 100);
      sfxVol.value     = Math.round(audioSfxVolume     * 100);
      ambientVol.value = Math.round(audioAmbientVolume * 100);
      enginesVol.value = Math.round(audioEnginesVolume * 100);
      syncMuteUi();
    }
    syncValues();
    renderTracks();

    function openPanel() {
      panel.hidden = false;
      icon.setAttribute('aria-expanded', 'true');
      icon.classList.add('open');
      if (typeof window.syncToolbarSoundButton === 'function') window.syncToolbarSoundButton();
      renderTracks();
    }
    function closePanel() {
      panel.hidden = true;
      icon.setAttribute('aria-expanded', 'false');
      icon.classList.remove('open');
      if (typeof window.syncToolbarSoundButton === 'function') window.syncToolbarSoundButton();
    }
    icon.addEventListener('click', () => {
      if (panel.hidden) openPanel(); else closePanel();
    });
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    // Click outside to close.
    document.addEventListener('pointerdown', e => {
      if (panel.hidden) return;
      if (panel.contains(e.target) || icon.contains(e.target)) return;
      closePanel();
    });
    // Escape to close.
    document.addEventListener('keydown', e => {
      if (!panel.hidden && e.key === 'Escape') closePanel();
    });

    musicVol.addEventListener('input', () => {
      setMusicVolume(parseFloat(musicVol.value) / 100);
      if (audioMusicVolume > 0 && audioMusicMuted) { setMusicMuted(false); syncMuteUi(); }
    });
    sfxVol.addEventListener('input', () => {
      setSfxVolume(parseFloat(sfxVol.value) / 100);
      if (audioSfxVolume > 0 && audioSfxMuted) { setSfxMuted(false); syncMuteUi(); }
    });
    sfxVol.addEventListener('change', () => {
      if (!audioSfxMuted) playSfx('rustle');
    });
    ambientVol.addEventListener('input', () => {
      setAmbientVolume(parseFloat(ambientVol.value) / 100);
      if (audioAmbientVolume > 0 && audioAmbientMuted) { setAmbientMuted(false); syncMuteUi(); }
    });
    enginesVol.addEventListener('input', () => {
      setEnginesVolume(parseFloat(enginesVol.value) / 100);
      if (audioEnginesVolume > 0 && audioEnginesMuted) { setEnginesMuted(false); syncMuteUi(); }
    });

    musicMute.addEventListener('click', () => { setMusicMuted(!audioMusicMuted); syncMuteUi(); });
    sfxMute.addEventListener('click',   () => { setSfxMuted(!audioSfxMuted);     syncMuteUi(); });
    ambientMute.addEventListener('click', () => { setAmbientMuted(!audioAmbientMuted); syncMuteUi(); });
    enginesMute.addEventListener('click', () => { setEnginesMuted(!audioEnginesMuted); syncMuteUi(); });
  })();
