  // -------- generate modal wiring --------
  // -------- generate panel state --------
  // Persisted under tinyworld:gen:* — seed + composition + elevation +
  // "plan first" toggle.  Sums on biomes/elevation sliders are enforced
  // by proportionally rebalancing the other rows when one row moves.
  const GEN_LS = {
    seed: 'tinyworld:gen:seed',
    gridSize: 'tinyworld:gen:gridSize',
    biomes: 'tinyworld:gen:biomes.v1',
    elevation: 'tinyworld:gen:elevation.v1',
    disableAutofill: 'tinyworld:gen:disableAutofill',
    planetDrop: 'tinyworld:gen:planetDrop',
  };
  const GEN_BIOME_DEFAULTS = { grass: 55, forest: 20, water: 10, dirt: 10, settlement: 5 };
  const GEN_ELEV_DEFAULTS  = { plains: 55, hills: 30, mountains: 15 };

  function genReadBiomes() {
    try {
      const raw = localStorage.getItem(GEN_LS.biomes);
      if (!raw) return { ...GEN_BIOME_DEFAULTS };
      const v = JSON.parse(raw);
      const out = { ...GEN_BIOME_DEFAULTS };
      for (const k of Object.keys(out)) if (Number.isFinite(v[k])) out[k] = clampInt(v[k], 0, 100);
      return out;
    } catch (_) { return { ...GEN_BIOME_DEFAULTS }; }
  }
  function genReadElevation() {
    try {
      const raw = localStorage.getItem(GEN_LS.elevation);
      if (!raw) return { ...GEN_ELEV_DEFAULTS };
      const v = JSON.parse(raw);
      const out = { ...GEN_ELEV_DEFAULTS };
      for (const k of Object.keys(out)) if (Number.isFinite(v[k])) out[k] = clampInt(v[k], 0, 100);
      return out;
    } catch (_) { return { ...GEN_ELEV_DEFAULTS }; }
  }
  function clampInt(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(Number(n) || 0))); }
  function randomSeed() {
    // Readable seeds: two short words + 3 digits.
    const a = ['amber','clover','coral','dune','fern','glow','hazel','iris','juno','kestrel','larch','moss','nova','onyx','poppy','quartz','rust','sage','tide','umbra','vale','willow','yarrow','zephyr'];
    const b = ['barrow','bay','brook','cliff','copse','crag','dale','fen','fjord','glen','grove','heath','holt','isle','lea','mire','peak','reef','ridge','vale','wood'];
    const i = Math.floor(Math.random() * a.length);
    const j = Math.floor(Math.random() * b.length);
    const n = Math.floor(Math.random() * 900) + 100;
    return a[i] + '-' + b[j] + '-' + n;
  }
  // seedHash + makeMulberry32 relocated to engine/world/00-prelude.js
  // (must load before module 04's top-level texture generation).
  // Re-normalise a percent dict so it sums to 100, with the just-moved key
  // pinned. Empty rows stay empty when possible.
  function rebalanceSliderDict(dict, movedKey) {
    const keys = Object.keys(dict);
    const moved = clampInt(dict[movedKey], 0, 100);
    let rest = 0;
    for (const k of keys) if (k !== movedKey) rest += clampInt(dict[k], 0, 100);
    const target = 100 - moved;
    if (rest === 0) {
      // Spread evenly across the other rows.
      const others = keys.filter(k => k !== movedKey);
      if (others.length === 0) return { ...dict, [movedKey]: 100 };
      const each = Math.floor(target / others.length);
      const out = { ...dict, [movedKey]: moved };
      let used = 0;
      others.forEach((k, i) => {
        const v = (i === others.length - 1) ? (target - used) : each;
        out[k] = clampInt(v, 0, 100);
        used += v;
      });
      return out;
    }
    const out = { [movedKey]: moved };
    let used = 0;
    const others = keys.filter(k => k !== movedKey);
    others.forEach((k, i) => {
      let v;
      if (i === others.length - 1) {
        v = clampInt(target - used, 0, 100);
      } else {
        v = clampInt(dict[k] / rest * target, 0, 100);
        used += v;
      }
      out[k] = v;
    });
    // Tiny rounding fix — make sure total == 100.
    let total = 0;
    for (const k of keys) total += out[k];
    if (total !== 100 && others.length) {
      const last = others[others.length - 1];
      out[last] = clampInt(out[last] + (100 - total), 0, 100);
    }
    return out;
  }

  (function wireGenerateModal() {
    const modal = document.getElementById('gen-modal');
    const openBtn = document.getElementById('generate');
    const closeBtn = document.getElementById('gen-close');
    const goBtn = document.getElementById('gen-go');
    const applyPreviewBtn = document.getElementById('gen-apply');
    const regeneratePreviewBtn = document.getElementById('gen-regenerate');
    const discardPreviewBtn = document.getElementById('gen-discard');
    const promptEl = document.getElementById('gen-prompt');
    const providerEl = document.getElementById('gen-provider');
    const modelEl = document.getElementById('gen-model');
    const keyEl = document.getElementById('gen-key');
    const statusEl = document.getElementById('gen-status');
    const seedEl = document.getElementById('gen-seed');
    const seedRandomBtn = document.getElementById('gen-seed-random');
    const seedCopyBtn = document.getElementById('gen-seed-copy');
    const seedPasteBtn = document.getElementById('gen-seed-paste');
    const gridSizeEl = document.getElementById('gen-grid-size');
    fillGridSizeSelect(gridSizeEl);
    const disableAutofillEl = document.getElementById('gen-disable-autofill');
    const proceduralEl = document.getElementById('gen-procedural');
    const useLandscapeEl = document.getElementById('gen-use-landscape');
    const landscapeContainer = document.getElementById('gen-landscape-container');
    
    if (proceduralEl) {
      proceduralEl.checked = localStorage.getItem('tinyworld:gen:procedural') === '1';
      proceduralEl.addEventListener('change', () => {
        try { localStorage.setItem('tinyworld:gen:procedural', proceduralEl.checked ? '1' : '0'); } catch (_) {}
        if (landscapeContainer) landscapeContainer.style.display = proceduralEl.checked ? 'block' : 'none';
      });
      if (landscapeContainer) landscapeContainer.style.display = proceduralEl.checked ? 'block' : 'none';
    }
    
    if (useLandscapeEl) {
      useLandscapeEl.checked = localStorage.getItem('tinyworld:gen:useLandscape') === '1';
      useLandscapeEl.addEventListener('change', () => {
        try { localStorage.setItem('tinyworld:gen:useLandscape', useLandscapeEl.checked ? '1' : '0'); } catch (_) {}
      });
    }
    const landscapeStyleEl = document.getElementById('gen-landscape-style');
    const biomeDdContainer = document.getElementById('gen-landscape-biome-container');
    const biomeDdEl = document.getElementById('gen-landscape-biome');
    const renderDdEl = document.getElementById('gen-landscape-render');
    const planetDropControl = document.getElementById('gen-planet-drop-control');
    const planetDropEl = document.getElementById('gen-planet-drop');
    const planetDropValueEl = document.getElementById('gen-planet-drop-value');
    const genActionsEl = goBtn ? goBtn.closest('.gen-actions') : null;
    const progressEl = document.getElementById('gen-progress');
    const progressFillEl = document.getElementById('gen-progress-fill');
    const progressLabelEl = document.getElementById('gen-progress-label');

    const _genPreviewState = { data: null, meta: null, group: null, mats: [], geoms: [] };

    function _genPreviewCellKey(x, z) { return String(x) + ',' + String(z); }

    function _genPreviewNormalizeCell(entry) {
      if (Array.isArray(entry)) {
        return {
          x: +entry[0],
          z: +entry[1],
          terrain: entry[2] || 'grass',
          kind: entry[3] || null,
          floors: entry[4] || 1,
          buildingType: entry[5] || null,
          terrainFloors: entry[6] || 1,
          fenceSide: entry[7] || null,
        };
      }
      if (!entry || typeof entry !== 'object') return null;
      return {
        x: +entry.x,
        z: +entry.z,
        terrain: entry.terrain || 'grass',
        kind: entry.kind || null,
        floors: entry.floors || 1,
        buildingType: entry.buildingType || null,
        terrainFloors: entry.terrainFloors || 1,
        fenceSide: entry.fenceSide || null,
      };
    }

    function _genPreviewCellSignature(cell) {
      if (!cell) return 'empty';
      return [
        cell.terrain || 'grass',
        cell.kind || '',
        cell.floors || 1,
        cell.buildingType || '',
        cell.terrainFloors || 1,
        cell.fenceSide || '',
      ].join('|');
    }

    function _genPreviewDispose() {
      if (_genPreviewState.group && _genPreviewState.group.parent) {
        _genPreviewState.group.parent.remove(_genPreviewState.group);
      }
      _genPreviewState.geoms.forEach(geom => { if (geom && typeof geom.dispose === 'function') geom.dispose(); });
      _genPreviewState.mats.forEach(mat => { if (mat && typeof mat.dispose === 'function') mat.dispose(); });
      _genPreviewState.data = null;
      _genPreviewState.meta = null;
      _genPreviewState.group = null;
      _genPreviewState.geoms = [];
      _genPreviewState.mats = [];
    }

    function _genPreviewSetControls(pending) {
      if (genActionsEl) genActionsEl.classList.toggle('preview-pending', !!pending);
      [applyPreviewBtn, regeneratePreviewBtn, discardPreviewBtn].forEach(btn => {
        if (btn) btn.hidden = !pending;
      });
      if (goBtn) goBtn.hidden = !!pending;
    }

    function _genPreviewStage(data, meta) {
      _genPreviewDispose();
      if (!data || !Array.isArray(data.cells) || typeof THREE === 'undefined' || !xrWorldRoot) return false;
      const gridSize = coerceGridSize(data.gridSize, GRID);
      const baseSig = _genPreviewCellSignature({ terrain: 'grass', terrainFloors: 1 });
      const existing = new Map();
      for (let x = 0; x < Math.min(GRID, HOME_GRID_MAX); x++) {
        for (let z = 0; z < Math.min(GRID, HOME_GRID_MAX); z++) {
          const cell = world && world[x] && world[x][z];
          existing.set(_genPreviewCellKey(x, z), _genPreviewCellSignature(cell));
        }
      }
      const proposed = new Map();
      data.cells.forEach(entry => {
        const cell = _genPreviewNormalizeCell(entry);
        if (!cell || !Number.isFinite(cell.x) || !Number.isFinite(cell.z)) return;
        proposed.set(_genPreviewCellKey(cell.x, cell.z), cell);
      });

      const group = new THREE.Group();
      group.name = 'generation-preview-diff';
      group.renderOrder = 1300;
      const addMat = new THREE.MeshBasicMaterial({ color: 0x48d77a, transparent: true, opacity: 0.34, depthWrite: false, depthTest: true });
      const changeMat = new THREE.MeshBasicMaterial({ color: 0x4fa7ff, transparent: true, opacity: 0.34, depthWrite: false, depthTest: true });
      const removeMat = new THREE.MeshBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: 0.24, depthWrite: false, depthTest: true });
      const objectMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.44, depthWrite: false, depthTest: true });
      _genPreviewState.mats.push(addMat, changeMat, removeMat, objectMat);
      const tileGeom = new THREE.BoxGeometry(TILE * 0.86, 0.06, TILE * 0.86);
      const objectGeom = new THREE.BoxGeometry(TILE * 0.42, 0.55, TILE * 0.42);
      _genPreviewState.geoms.push(tileGeom, objectGeom);

      let added = 0, changed = 0, removed = 0;
      proposed.forEach((cell, key) => {
        const currentSig = existing.get(key);
        const nextSig = _genPreviewCellSignature(cell);
        const isAdd = !currentSig || currentSig === baseSig;
        if (currentSig === nextSig) return;
        if (isAdd) added++; else changed++;
        const y = 0.12 + Math.max(0, (cell.terrainFloors || 1) - 1) * 0.18;
        const tile = new THREE.Mesh(tileGeom, isAdd ? addMat : changeMat);
        tile.position.set(cell.x - gridSize / 2 + 0.5, y, cell.z - gridSize / 2 + 0.5);
        tile.renderOrder = 1301;
        group.add(tile);
        if (cell.kind) {
          const obj = new THREE.Mesh(objectGeom, objectMat);
          obj.position.set(cell.x - gridSize / 2 + 0.5, y + 0.33, cell.z - gridSize / 2 + 0.5);
          obj.renderOrder = 1302;
          group.add(obj);
        }
      });
      existing.forEach((sig, key) => {
        if (proposed.has(key) || sig === baseSig) return;
        const parts = key.split(',');
        const x = +parts[0];
        const z = +parts[1];
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        const tile = new THREE.Mesh(tileGeom, removeMat);
        tile.position.set(x - gridSize / 2 + 0.5, 0.15, z - gridSize / 2 + 0.5);
        tile.renderOrder = 1301;
        group.add(tile);
        removed++;
      });
      xrWorldRoot.add(group);
      _genPreviewState.data = data;
      _genPreviewState.meta = meta || {};
      _genPreviewState.group = group;
      _genPreviewSetControls(true);
      setStatus('preview ready · +' + added + ' / ~' + changed + ' / −' + removed, 'done');
      return true;
    }

    async function _genPreviewCommit() {
      const data = _genPreviewState.data;
      const meta = _genPreviewState.meta || {};
      if (!data) return false;
      _genPreviewDispose();
      _genPreviewSetControls(false);
      if (typeof setCameraMode === 'function') setCameraMode('perspective');
      setGenerationLocked(true);
      setStatus('applying preview…', 'busy');
      setGenerationProgress(18, 'Preparing apply');
      await generationPaintYield();
      const ok = await applyGeneratedStateWithProgress(data, {
        start: 24,
        end: 94,
        label: 'Applying preview',
        terrainBake: true,
        apply: {
          keepCamera: true,
          renderOrigin: meta.renderOrigin || undefined,
        },
      });
      if (!ok) {
        setGenerationLocked(false);
        setStatus('renderer rejected the preview', 'error');
        return false;
      }
      if (meta.landscapeStyle === 'landscape' && landscapeEngineInstance) {
        initLandscapeMesh();
        rebuildTerrainRender();
      }
      setGenerationProgress(100, 'Complete');
      setGenerationLocked(false);
      clearGenerationProgress();
      setStatus('applied · seed: ' + (meta.seed || 'random') + (meta.planetDrop ? ' · planet ' + meta.planetDrop + 'm below' : ''), 'done');
      if (window.__tinyworldAgent) window.__tinyworldAgent.say('Applied the generated preview.');
      return true;
    }

    function _genPreviewDiscard(message) {
      _genPreviewDispose();
      _genPreviewSetControls(false);
      setStatus(message || 'preview discarded', '');
    }

    function selectedPlanetDrop() {
      const fallback = planetLandscapeConfig && Number.isFinite(Number(planetLandscapeConfig.drop))
        ? planetLandscapeConfig.drop
        : PLANET_LANDSCAPE_DROP;
      return clampPlanetLandscapeDrop(planetDropEl ? planetDropEl.value : fallback, fallback);
    }

    function planetDropLabel(drop) {
      const relation = drop < PLANET_LANDSCAPE_DROP
        ? ' · land higher'
        : (drop > PLANET_LANDSCAPE_DROP ? ' · land lower' : '');
      return drop + 'm below' + relation;
    }

    function syncPlanetDropLabel() {
      if (!planetDropEl) return;
      const drop = selectedPlanetDrop();
      planetDropEl.value = String(Math.min(PLANET_LANDSCAPE_DROP_UI_MAX, drop));
      if (planetDropValueEl) planetDropValueEl.textContent = planetDropLabel(drop);
    }

    function syncBiomeContainerVisibility() {
      if (!biomeDdContainer || !landscapeStyleEl) return;
      const style = landscapeStyleEl.value;
      biomeDdContainer.style.display = (style === 'landscape' || style === 'planet-underlay') ? 'flex' : 'none';
      if (planetDropControl) planetDropControl.style.display = style === 'planet-underlay' ? 'flex' : 'none';
      syncPlanetDropLabel();
    }

    if (landscapeStyleEl) {
      const storedStyle = localStorage.getItem('tinyworld:gen:landscapeStyle') || 'lowpoly';
      landscapeStyleEl.value = storedStyle;
      landscapeStyleEl.addEventListener('change', () => {
        try { localStorage.setItem('tinyworld:gen:landscapeStyle', landscapeStyleEl.value); } catch (_) {}
        syncBiomeContainerVisibility();
      });
    }
    if (biomeDdEl) {
      const storedBiome = localStorage.getItem('tinyworld:gen:landscapeBiome') || 'grassland';
      biomeDdEl.value = storedBiome;
      biomeDdEl.addEventListener('change', () => {
        try { localStorage.setItem('tinyworld:gen:landscapeBiome', biomeDdEl.value); } catch (_) {}
      });
    }
    if (renderDdEl) {
      const storedRender = localStorage.getItem('tinyworld:gen:landscapeRender') || 'lowpoly';
      renderDdEl.value = storedRender;
      renderDdEl.addEventListener('change', () => {
        try { localStorage.setItem('tinyworld:gen:landscapeRender', renderDdEl.value); } catch (_) {}
      });
    }
    if (planetDropEl) {
      planetDropEl.min = String(PLANET_LANDSCAPE_DROP_MIN);
      planetDropEl.max = String(PLANET_LANDSCAPE_DROP_UI_MAX);
      planetDropEl.step = '5';
      const storedDrop = clampPlanetLandscapeDrop(localStorage.getItem(GEN_LS.planetDrop));
      planetDropEl.value = String(Math.min(PLANET_LANDSCAPE_DROP_UI_MAX, storedDrop));
      planetDropEl.addEventListener('input', () => {
        const drop = selectedPlanetDrop();
        if (planetDropValueEl) planetDropValueEl.textContent = planetDropLabel(drop);
      });
      planetDropEl.addEventListener('change', () => {
        const drop = selectedPlanetDrop();
        try { localStorage.setItem(GEN_LS.planetDrop, String(drop)); } catch (_) {}
        syncPlanetDropLabel();
        if (isPlanetLandscapeActive() && planetLandscapeConfig && landscapeStyleEl && landscapeStyleEl.value === 'planet-underlay') {
          if (!updatePlanetLandscapeDrop(drop)) initPlanetLandscape({ ...planetLandscapeConfig, drop });
          saveState();
        }
      });
      syncPlanetDropLabel();
    }
    syncBiomeContainerVisibility();
    const biomeSlidersEl = document.getElementById('gen-biome-sliders');
    const biomeSumEl = document.getElementById('gen-biome-sum');
    const elevSlidersEl = document.getElementById('gen-elev-sliders');
    const elevSumEl = document.getElementById('gen-elev-sum');

    let biomeState = genReadBiomes();
    let elevState = genReadElevation();
    if (disableAutofillEl) disableAutofillEl.checked = localStorage.getItem(GEN_LS.disableAutofill) === '1';
    if (seedEl) seedEl.value = localStorage.getItem(GEN_LS.seed) || '';
    if (gridSizeEl) {
      const storedGridSize = parseInt(localStorage.getItem(GEN_LS.gridSize) || '', 10);
      gridSizeEl.value = String(coerceGridSize(storedGridSize, GRID));
    }

    function selectedGenGridSize() {
      const value = gridSizeEl ? parseInt(gridSizeEl.value, 10) : GRID;
      return coerceGridSize(value, GRID);
    }

    function paintSliders(group, state, slidersEl, sumEl) {
      let total = 0;
      const rows = slidersEl ? slidersEl.querySelectorAll('.gen-slider-row') : [];
      rows.forEach(row => {
        const key = row.getAttribute('data-' + group);
        if (!(key in state)) return;
        const v = clampInt(state[key], 0, 100);
        const range = row.querySelector('input[type=range]');
        const val = row.querySelector('.gen-slider-val');
        if (range && Number(range.value) !== v) range.value = String(v);
        if (val) val.textContent = v + '%';
        total += v;
      });
      if (sumEl) {
        sumEl.textContent = total + '%';
        sumEl.classList.remove('bad', 'good');
        if (total === 100) sumEl.classList.add('good');
        else sumEl.classList.add('bad');
      }
    }
    function refreshSliders() {
      paintSliders('biome', biomeState, biomeSlidersEl, biomeSumEl);
      paintSliders('elev', elevState, elevSlidersEl, elevSumEl);
    }
    function bindGroup(group, state, slidersEl, storageKey, sumEl) {
      if (!slidersEl) return;
      slidersEl.addEventListener('input', e => {
        const t = e.target;
        if (!t || t.tagName !== 'INPUT' || t.type !== 'range') return;
        const key = t.getAttribute('data-' + group);
        if (!key || !(key in state)) return;
        state[key] = clampInt(t.value, 0, 100);
        const next = rebalanceSliderDict(state, key);
        for (const k of Object.keys(state)) state[k] = next[k];
        try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) {}
        paintSliders(group, state, slidersEl, sumEl);
      });
    }
    bindGroup('biome', biomeState, biomeSlidersEl, GEN_LS.biomes, biomeSumEl);
    bindGroup('elev', elevState, elevSlidersEl, GEN_LS.elevation, elevSumEl);
    refreshSliders();

    if (seedEl) {
      seedEl.addEventListener('input', () => {
        try { localStorage.setItem(GEN_LS.seed, seedEl.value); } catch (_) {}
      });
    }
    if (seedRandomBtn && seedEl) {
      seedRandomBtn.addEventListener('click', () => {
        seedEl.value = randomSeed();
        try { localStorage.setItem(GEN_LS.seed, seedEl.value); } catch (_) {}
      });
    }
    if (seedCopyBtn && seedEl) {
      seedCopyBtn.addEventListener('click', async () => {
        if (!seedEl.value) return;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(seedEl.value);
          } else {
            seedEl.select(); document.execCommand && document.execCommand('copy');
          }
        } catch (_) { /* clipboard blocked */ }
      });
    }
    if (seedPasteBtn && seedEl) {
      seedPasteBtn.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const v = await navigator.clipboard.readText();
            if (v) { seedEl.value = v.trim(); try { localStorage.setItem(GEN_LS.seed, seedEl.value); } catch (_) {} }
          }
        } catch (_) {}
      });
    }
    if (disableAutofillEl) {
      disableAutofillEl.addEventListener('change', () => {
        try { localStorage.setItem(GEN_LS.disableAutofill, disableAutofillEl.checked ? '1' : '0'); } catch (_) {}
      });
    }
    if (gridSizeEl) {
      gridSizeEl.addEventListener('change', () => {
        try { localStorage.setItem(GEN_LS.gridSize, String(selectedGenGridSize())); } catch (_) {}
      });
    }

    window.__genState = () => ({
      seed: seedEl ? seedEl.value : '',
      gridSize: selectedGenGridSize(),
      biomes: { ...biomeState },
      elevation: { ...elevState },
      planFirst: false,
      fastLayout: false,
      disableAutofill: !!(disableAutofillEl && disableAutofillEl.checked),
    });

    function setStatus(msg, kind) {
      statusEl.textContent = msg || '';
      statusEl.className = kind || '';
    }

    function setGenerationProgress(value, label) {
      const pct = Math.max(0, Math.min(100, Number(value) || 0));
      if (progressEl) {
        progressEl.hidden = false;
        progressEl.setAttribute('aria-valuenow', String(Math.round(pct)));
      }
      if (progressFillEl) progressFillEl.style.width = pct.toFixed(1) + '%';
      if (progressLabelEl) progressLabelEl.textContent = label || (Math.round(pct) + '%');
    }

    function clearGenerationProgress(delay = 900) {
      setTimeout(() => {
        if (progressEl) progressEl.hidden = true;
        if (progressFillEl) progressFillEl.style.width = '0%';
        if (progressLabelEl) progressLabelEl.textContent = 'Preparing generation';
        if (progressEl) progressEl.setAttribute('aria-valuenow', '0');
      }, delay);
    }

    function generationPaintYield() {
      return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 0);
      });
    }

    function setGenerationLocked(locked) {
      if (typeof setGenerationViewLocked === 'function') setGenerationViewLocked(locked);
      [goBtn, applyPreviewBtn, regeneratePreviewBtn, discardPreviewBtn].forEach(btn => {
        if (btn) btn.disabled = !!locked;
      });
    }

    function requestGeneratedTerrainBake() {
      try {
        if (typeof window.__tinyworldRequestTerrainBake === 'function') window.__tinyworldRequestTerrainBake();
      } catch (_) {}
    }

    function applyGeneratedStateWithProgress(data, opts = {}) {
      return new Promise(resolve => {
        const start = Number.isFinite(opts.start) ? opts.start : 35;
        const end = Number.isFinite(opts.end) ? opts.end : 94;
        const label = opts.label || 'Building world';
        const applyOpts = Object.assign({}, opts.apply || {}, {
          sliced: true,
          onProgress(info) {
            const total = Math.max(1, (info && info.total) || 1);
            const done = Math.max(0, Math.min(total, (info && info.done) || 0));
            const phase = info && info.phase ? ' · ' + info.phase : '';
            setGenerationProgress(start + (end - start) * (done / total), label + phase);
          },
          onDone() {
            if (opts.terrainBake) requestGeneratedTerrainBake();
            if (opts.apply && typeof opts.apply.onDone === 'function') {
              try { opts.apply.onDone(); } catch (_) {}
            }
            resolve(true);
          },
        });
        const ok = typeof applyState === 'function' && applyState(data, applyOpts);
        if (!ok) resolve(false);
      });
    }

    function applyGenerationAutofillSetting(disabled) {
      ghostBoardsBlank = !!disabled;
      if (typeof clearGhostWorld === 'function') clearGhostWorld();
      if (!ghostBoardsBlank && typeof ensureGhostBoardsAroundTarget === 'function') {
        ensureGhostBoardsAroundTarget();
      }
    }

    function positionPlanOverlayToGrid() {
      const overlay = document.getElementById('generation-plan-overlay');
      const img = document.getElementById('generation-plan-image');
      if (!overlay || overlay.hidden || !img || !camera) return;
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      const half = GRID / 2;
      const y = TOP_H + 0.06;
      const corners = [
        new THREE.Vector3(-half, y, -half),
        new THREE.Vector3( half, y, -half),
        new THREE.Vector3(-half, y,  half),
        new THREE.Vector3( half, y,  half),
      ].map(corner => {
        const p = corner.project(camera);
        return {
          x: (p.x * 0.5 + 0.5) * window.innerWidth,
          y: (-p.y * 0.5 + 0.5) * window.innerHeight,
        };
      });
      if (!corners.every(p => Number.isFinite(p.x + p.y))) return;
      const topW = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
      const bottomW = Math.hypot(corners[3].x - corners[2].x, corners[3].y - corners[2].y);
      const leftH = Math.hypot(corners[2].x - corners[0].x, corners[2].y - corners[0].y);
      const rightH = Math.hypot(corners[3].x - corners[1].x, corners[3].y - corners[1].y);
      const centerX = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
      const centerY = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
      const angle = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x);
      img.style.left = Math.round(centerX) + 'px';
      img.style.top = Math.round(centerY) + 'px';
      img.style.width = Math.round((topW + bottomW) / 2) + 'px';
      img.style.height = Math.round((leftH + rightH) / 2) + 'px';
      img.style.transform = 'translate(-50%, -50%) rotate(' + angle + 'rad)';
    }

    function showPlanOverlay(url) {
      const overlay = document.getElementById('generation-plan-overlay');
      const img = document.getElementById('generation-plan-image');
      if (!overlay || !img || !url) return;
      img.src = url;
      img.onload = positionPlanOverlayToGrid;
      overlay.hidden = false;
      requestAnimationFrame(() => {
        if (typeof updateCamera === 'function') updateCamera();
        positionPlanOverlayToGrid();
        overlay.classList.add('visible');
      });
    }

    function hidePlanOverlay() {
      const overlay = document.getElementById('generation-plan-overlay');
      const img = document.getElementById('generation-plan-image');
      if (!overlay || !img) return;
      overlay.classList.remove('visible');
      setTimeout(() => {
        overlay.hidden = true;
        img.onload = null;
        img.removeAttribute('src');
        img.removeAttribute('style');
      }, 220);
    }
    window.addEventListener('resize', positionPlanOverlayToGrid);

    function generationProgress(prompt) {
      const agent = window.__tinyworldAgent;
      if (!agent) {
        return {
          say() {},
          update() {},
          error() {},
          done() {},
        };
      }
      agent.add('user', 'Generate: ' + prompt);
      let current = agent.add('assistant', 'Starting generation…');
      return {
        say(text) {
          current = agent.add('assistant', text);
          return current;
        },
        update(text) {
          agent.update(current, text);
        },
        error(text) {
          // Final / failure — record + toast.
          if (agent.done) agent.done(text, 'error');
        },
        done(text) {
          if (agent.done) agent.done(text);
        },
      };
    }

    function populateModelOptions(provider, selectedModel) {
      const def = AI_DEFAULTS[provider] || AI_DEFAULTS.openai;
      const models = def.models || [def.model];
      const requested = selectedModel || localStorage.getItem(AI_LS.model(provider)) || def.model;
      const stored = isImageOnlyModel(requested) ? def.model : requested;
      // Suggestions go into the datalist; the input itself stays a free
      // text field so the user can type any model their key has access
      // to (newer than our suggestion list included).
      const datalist = document.getElementById('gen-model-list');
      if (datalist) {
        datalist.innerHTML = '';
        models.forEach(model => {
          const opt = document.createElement('option');
          opt.value = model;
          datalist.appendChild(opt);
        });
      }
      modelEl.value = stored;
      localStorage.setItem(AI_LS.model(provider), stored);
    }

    function loadProviderState() {
      const provider = AI_DEFAULTS[providerEl.value] ? providerEl.value : 'openai';
      providerEl.value = provider;
      const def = AI_DEFAULTS[provider];
      populateModelOptions(provider, localStorage.getItem(AI_LS.model(provider)) || def.model);
      keyEl.value = localStorage.getItem(AI_LS.key(provider)) || '';
    }

    // Track whether the user has just typed in the key field — only an
    // explicit user input should be allowed to *remove* a stored key.
    // Auto-saves triggered by provider / model switches must never wipe
    // a key that's still in localStorage (was: a transient empty keyEl
    // would delete the saved value).
    let keyEditedByUser = false;
    keyEl.addEventListener('input', () => { keyEditedByUser = true; });
    function saveProviderState() {
      const provider = providerEl.value;
      localStorage.setItem(AI_LS.provider, provider);
      if (modelEl.value) localStorage.setItem(AI_LS.model(provider), modelEl.value);
      if (keyEl.value) {
        localStorage.setItem(AI_LS.key(provider), keyEl.value);
      } else if (keyEditedByUser) {
        // Only remove the stored key if the user actually cleared the
        // field themselves; never wipe on auto-save.
        localStorage.removeItem(AI_LS.key(provider));
      }
      if (promptEl.value) localStorage.setItem(AI_LS.prompt, promptEl.value);
      const autoBtn = document.querySelector('.tool[data-id="auto"]');
      if (autoBtn) autoBtn.disabled = !(keyEl.value || localStorage.getItem(AI_LS.key(provider)));
    }

    function open() {
      const lastProvider = localStorage.getItem(AI_LS.provider) || 'openai';
      providerEl.value = lastProvider;
      loadProviderState();
      promptEl.value = localStorage.getItem(AI_LS.prompt) || promptEl.value;
      if (gridSizeEl) {
        const storedGridSize = parseInt(localStorage.getItem(GEN_LS.gridSize) || '', 10);
        gridSizeEl.value = String(coerceGridSize(storedGridSize, GRID));
      }
      if (landscapeStyleEl) {
        if (isPlanetLandscapeActive()) {
          landscapeStyleEl.value = 'planet-underlay';
          if (renderDdEl && planetLandscapeConfig) renderDdEl.value = planetLandscapeConfig.styleMode || 'lowpoly';
          if (planetDropEl && planetLandscapeConfig) planetDropEl.value = String(Math.min(PLANET_LANDSCAPE_DROP_UI_MAX, clampPlanetLandscapeDrop(planetLandscapeConfig.drop)));
        } else if (landscapeMeshMode) {
          landscapeStyleEl.value = 'landscape';
          if (renderDdEl) renderDdEl.value = landscapeMeshStyle || 'lowpoly';
        } else if (!renderVoxelTerrain) {
          landscapeStyleEl.value = 'lowpoly';
        } else {
          landscapeStyleEl.value = 'voxel-' + renderTerrainVoxelResolution;
        }
        syncBiomeContainerVisibility();
      }
      setStatus('');
      openTinyModal(modal, promptEl);
    }

    function close() {
      _genPreviewDiscard('preview discarded');
      closeTinyModal(modal);
    }
    openGenerateModal = opts => {
      open();
      if (!opts) return;
      if (typeof opts === 'string') {
        setStatus(opts, 'error');
        return;
      }
      if (opts.prompt && promptEl) {
        const current = (promptEl.value || '').trim();
        const hint = String(opts.prompt).trim();
        promptEl.value = current && current.indexOf(hint) === -1 ? hint + '\n\n' + current : (current || hint);
        try { promptEl.focus(); promptEl.setSelectionRange(0, 0); } catch (_) {}
      }
      if (opts.gridSize && gridSizeEl) {
        gridSizeEl.value = String(coerceGridSize(parseInt(opts.gridSize, 10), GRID));
      }
      if (opts.status) setStatus(opts.status, opts.statusType || '');
    };
    window.__syncAiSettings = loadProviderState;

    openBtn.addEventListener('click', () => {
      // AI generation is gated for anonymous users.
      if (!window.__loggedIn && typeof window.__openLoginModal === 'function') {
        window.__openLoginModal('Sign in to use AI generation');
        return;
      }
      open();
    });
    closeBtn.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    providerEl.addEventListener('change', () => {
      // Switching provider is not an explicit key edit — reset the
      // "edited" flag so the auto-save can't accidentally wipe the new
      // provider's stored key.
      keyEditedByUser = false;
      loadProviderState();
      saveProviderState();
    });
    modelEl.addEventListener('change', saveProviderState);
    keyEl.addEventListener('input', saveProviderState);

    if (applyPreviewBtn) applyPreviewBtn.addEventListener('click', () => {
      _genPreviewCommit();
    });
    if (discardPreviewBtn) discardPreviewBtn.addEventListener('click', () => {
      _genPreviewDiscard('preview discarded');
    });
    if (regeneratePreviewBtn) regeneratePreviewBtn.addEventListener('click', () => {
      _genPreviewDiscard('regenerating…');
      goBtn.click();
    });

    goBtn.addEventListener('click', async () => {
      const promptRaw = promptEl.value.trim();
      const provider = AI_DEFAULTS[providerEl.value] ? providerEl.value : 'openai';
      const model = modelEl.value.trim() || AI_DEFAULTS[provider].model;
      const key = keyEl.value.trim() || localStorage.getItem(AI_LS.key(provider)) || '';
      const seed = (seedEl && seedEl.value.trim()) || '';
      const gridSize = selectedGenGridSize();
      const biomes = { ...biomeState };
      const elevation = { ...elevState };
      const procedural = !!(proceduralEl && proceduralEl.checked);
      const landscapeStyle = landscapeStyleEl && landscapeStyleEl.value;
      const wantsPlanetLandscape = landscapeStyle === 'planet-underlay';
      const planetBiome = (biomeDdEl && biomeDdEl.value) || 'grassland';
      const planetStyleMode = (renderDdEl && renderDdEl.value) || 'lowpoly';
      const planetDrop = selectedPlanetDrop();
      const useLandscapeEl = document.getElementById('gen-use-landscape');
      const useLandscape = (landscapeStyle === 'landscape') || (!wantsPlanetLandscape && useLandscapeEl && useLandscapeEl.checked);
      const disableAutofill = !!(disableAutofillEl && disableAutofillEl.checked);
      try { localStorage.setItem(GEN_LS.gridSize, String(gridSize)); } catch (_) {}
      try { localStorage.setItem(GEN_LS.planetDrop, String(planetDrop)); } catch (_) {}

      // Apply the selected terrain style to the global settings and persist them
      if (landscapeStyleEl) {
        const style = landscapeStyleEl.value;
        if (style === 'landscape') {
          disposePlanetLandscape();
          renderVoxelTerrain = false;
          // Realistic renders as voxel blocks (mesh terrain), not the continuous
          // LandscapeEngine mesh — so it is a normal-tile world plus an overlay
          // (landscapeMeshMode stays false). Low-poly keeps the continuous mesh.
          landscapeMeshMode = (planetStyleMode !== 'realistic');
          // Store biome/render choices for the landscape build below
          landscapeMeshBiome = planetBiome;
          landscapeMeshStyle = planetStyleMode;
          // The overlay is built after applyState creates the engine instance
        } else if (style === 'planet-underlay') {
          disposeLandscapeMesh({ rebuild: true });
          useLandscapeEngine = false;
          landscapeEngineInstance = null;
          landscapeMeshMode = false;
          landscapeMeshBiome = planetBiome;
          landscapeMeshStyle = planetStyleMode;
          renderVoxelTerrain = false;
        } else if (style === 'lowpoly') {
          disposePlanetLandscape();
          disposeLandscapeMesh({ rebuild: true });
          if (!useLandscape) {
            useLandscapeEngine = false;
            landscapeEngineInstance = null;
          }
          renderVoxelTerrain = false;
        } else {
          disposePlanetLandscape();
          disposeLandscapeMesh({ rebuild: true });
          if (!useLandscape) {
            useLandscapeEngine = false;
            landscapeEngineInstance = null;
          }
          renderVoxelTerrain = true;
          renderTerrainVoxelResolution = style.split('-')[1];
        }
        if (typeof persistSettings === 'function') persistSettings();
        if (typeof syncControls === 'function') syncControls();
      }

      // Procedural path — bypass the LLM entirely.
      if (procedural) {
        const effectiveSeed = seed || randomSeed();
        if (!seed && seedEl) seedEl.value = effectiveSeed;
        setGenerationLocked(true);
        setStatus('generating random island…', 'busy');
        setGenerationProgress(6, 'Preparing seed');
        try {
          applyGenerationAutofillSetting(disableAutofill);
          await generationPaintYield();
          setGenerationProgress(18, 'Selecting terrain and resources');
          const data = useLandscape
            ? generateLandscapeWorld({ seed: effectiveSeed, biomes, elevation, gridSize })
            : generateProceduralWorld({ seed: effectiveSeed, biomes, elevation, gridSize });
          if (wantsPlanetLandscape) {
            data.planetLandscape = planetLandscapeStateFromSelection(effectiveSeed, planetBiome, planetStyleMode, planetDrop);
          }
          setGenerationProgress(30, 'Validating world');
          await generationPaintYield();
          const err = (typeof validateWorld === 'function') ? validateWorld(data) : null;
          if (err) throw new Error('random island schema: ' + err);
          const applied = await applyGeneratedStateWithProgress(data, {
            start: 36,
            end: 94,
            label: 'Rendering island',
            terrainBake: !useLandscape,
          });
          if (!applied) {
            throw new Error('renderer rejected the procedural scene');
          }
          // Build the landscape overlay after applyState created the engine.
          // Realistic -> voxel blocks; low-poly -> continuous LandscapeEngine mesh.
          if (landscapeStyleEl && landscapeStyleEl.value === 'landscape' && landscapeEngineInstance) {
            if (landscapeMeshStyle === 'realistic' && typeof applyRealisticVoxelLandscape === 'function') {
              // Voxel overlay hides the (already-painted) tiles; no tile rebuild
              // after, or it would re-show them.
              applyRealisticVoxelLandscape();
            } else {
              initLandscapeMesh();
              rebuildTerrainRender();
            }
          }
          if (wantsPlanetLandscape && typeof setCameraMode === 'function') setCameraMode('perspective');
          setGenerationProgress(100, 'Complete');
          clearGenerationProgress();
          setStatus('done · seed: ' + effectiveSeed + (wantsPlanetLandscape ? ' · planet ' + planetDrop + 'm below' : ''), 'done');
        } catch (err) {
          console.error('random island generate failed:', err);
          setStatus(String(err.message || err).slice(0, 140), 'error');
        } finally {
          setGenerationLocked(false);
        }
        return;
      }

      if (!promptRaw) { setStatus('enter a prompt', 'error'); return; }
      if (!key)       { setStatus('enter an API key', 'error'); return; }
      applyGenerationAutofillSetting(disableAutofill);
      const progress = generationProgress(promptRaw);
      close();
      progress.update('Preparing generation settings…');
      progress.say(
        'Settings: ' + gridSize + 'x' + gridSize + ' grid, seed ' + (seed || 'random') +
        ', JSON layout model ' + model +
        ', image generation off' +
        ', outside auto-fill ' + (disableAutofill ? 'off' : 'on') + '.'
      );
      // Auto-sum guard: re-normalise on the fly if a row is off (defensive).
      const bSum = Object.values(biomes).reduce((s,n)=>s+n,0);
      if (bSum !== 100)      { setStatus('composition must sum to 100% — adjusted automatically', 'error'); }
      const eSum = Object.values(elevation).reduce((s,n)=>s+n,0);
      if (eSum !== 100)      { setStatus('elevation must sum to 100% — adjusted automatically', 'error'); }

      // Effective seed: user-supplied or freshly generated. Stamped on the
      // status line so the user can copy it after generation.
      const effectiveSeed = seed || randomSeed();
      if (!seed && seedEl) seedEl.value = effectiveSeed;

      // Decorate the user prompt with composition + topology constraints
      // and seed. Model is asked to honour those proportions when picking
      // terrain / kinds, and to use the seed to disambiguate aesthetic
      // choices so re-runs of the same seed produce consistent worlds.
      const decoratedPrompt = (
        'User intent: ' + promptRaw + '\n\n' +
        'Board size: ' + gridSize + 'x' + gridSize + '. The JSON must include "gridSize": ' + gridSize + ' and all home-board cells must use x/z coordinates from 0 to ' + (gridSize - 1) + '.\n\n' +
        'Composition (target percentages across the ' + gridSize + 'x' + gridSize + ' grid, sum=100):\n' +
        Object.entries(biomes).map(([k,v]) => '  ' + k + ': ' + v + '%').join('\n') + '\n\n' +
        'Elevation profile (terrainFloors stack distribution, sum=100):\n' +
        '  plains (terrainFloors=1): ' + elevation.plains + '%\n' +
        '  hills (terrainFloors=2-3): ' + elevation.hills + '%\n' +
        '  mountains (terrainFloors=4-8): ' + elevation.mountains + '%\n\n' +
        'Seed: "' + effectiveSeed + '" — interpret as an aesthetic anchor; use it ' +
        'to break ties consistently so the same seed + prompt yields a similar layout.\n\n' +
        'Notes:\n' +
        '- "forest" composition share should be expressed via tree placements on grass.\n' +
        '- "settlement" share should be expressed via house clusters connected by path.\n' +
        '- Use water cells for water share, dirt cells for farmland, grass for the rest.\n' +
        '- Raise hills/mountains using terrainFloors (1=plains, 2-3=hills, 4-8=mountains).\n' +
        '- Do not express hills or mountains by filling the map with rock objects. Use rock only as occasional landmark/boulder cells.\n' +
        '- If the user intent names a bespoke object or model with no native kind, create a customParts object for it. Use sphere/ellipsoid customParts for rounded envelopes, domes, and canopies, and cable customParts for ropes, tethers, rigging, and mooring-style connections. Keep compact objects around customFootprint 1.1-1.3; use 1.5-1.8 only for deliberate hero pieces. Use existing houses, fences, rocks, bridges, trees, and terrain only when they are real scene components, not as substitutes for the requested object.'
      );

      if (modelEl.value.trim() !== model) {
        modelEl.value = model;
        setStatus('using ' + model + ' for JSON generation', 'busy');
      }
      saveProviderState();
      setGenerationLocked(true);
      setGenerationProgress(8, 'Preparing request');
      if (statusEl.textContent.indexOf('using ') !== 0) {
        setStatus('generating', 'busy');
      }
      try {
        hidePlanOverlay();
        await generationPaintYield();
        setGenerationProgress(28, 'Requesting JSON');
        progress.say('Generating validated world JSON with ' + model + '…');
        const data = await generateWorld(provider, model, key, decoratedPrompt, gridSize);
        if (!data) { setStatus('', ''); return; } // superseded by a newer generation
        if (wantsPlanetLandscape) {
          data.planetLandscape = planetLandscapeStateFromSelection(effectiveSeed, planetBiome, planetStyleMode, planetDrop);
          progress.say('Adding ' + planetBiome + ' LandscapeEngine planet underlay ' + planetDrop + 'm below the floating board…');
        }
        const receivedCells = data && Array.isArray(data.cells) ? data.cells.length : 0;
        progress.say('Received JSON with ' + receivedCells + ' cells. Building holographic diff preview…');
        setGenerationProgress(76, 'Building preview');
        hidePlanOverlay();
        if (typeof setCameraMode === 'function') setCameraMode('perspective');
        const ok = _genPreviewStage(data, {
          seed: effectiveSeed,
          renderOrigin: { x: target.x, z: target.z },
          landscapeStyle: landscapeStyleEl ? landscapeStyleEl.value : '',
          planetDrop: wantsPlanetLandscape ? planetDrop : 0,
        });
        if (!ok) throw new Error('preview rejected the scene');
        setGenerationProgress(100, 'Preview ready');
        clearGenerationProgress();
        modal.hidden = false;
        progress.done('Preview ready — inspect the holographic diff, then Apply, Regenerate, or Discard.');
      } catch (err) {
        if (err && (err.name === 'AbortError' || (err instanceof DOMException && err.name === 'AbortError'))) return;
        console.error('generate failed:', err);
        hidePlanOverlay();
        progress.error(String(err.message || err).slice(0, 180));
        setStatus(String(err.message || err).slice(0, 140), 'error');
      } finally {
        setGenerationLocked(false);
      }
    });

    // Cmd/Ctrl+Enter inside the prompt to fire generation.
    promptEl.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') goBtn.click();
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
    _genPreviewSetControls(false);
    loadProviderState();
  })();

