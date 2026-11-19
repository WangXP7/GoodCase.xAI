  // -------- pen tool (build v2, slice 4) --------
  // 00-VISION.md #2 "Pen tool": draw a stroke or loop directly on the terrain,
  // release, and the Context Bar (here: a standalone chooser — see note below)
  // asks what it becomes. The pen only produces an ordered cell list; applying
  // it reuses the exact same placement function the normal drag-paint path
  // calls (applyToolToCell, engine/world/20-input-place-erase.js) by
  // temporarily swapping the module-scoped `selectedTool` to the real Fence/
  // Path/Bush TOOLS entry for each non-skipped cell, so terrain rules,
  // adjacency, undo, economy, and multiplayer sync all come for free — this
  // file never calls setCell directly (the SLICE-3 LESSON: setCell is
  // full-intent, and updateSelectedBoardObject/applyToolToCell are the proven
  // writers).
  //
  // Drag-mode integration lives in 20-input-place-erase.js itself (new
  // dragMode 'pen-stroke' branches in the pointerdown/pointermove/pointerup/
  // contextmenu/Escape handlers there), mirroring the free-object-drag
  // template — NOT a second set of listeners here, which would race the
  // existing ones (the existing pointermove handler orbits the camera for any
  // dragMode it doesn't recognise, so a bolt-on listener can't reliably
  // suppress that).
  //
  // Preview reuses 20's brush-shape highlight mechanism verbatim
  // (_brushShapePreviewGroup / _brushClearPreview / _brushPreviewMaterial /
  // _brushDisplayPointForWorldCell) — no second highlight system.
  //
  // Chooser surface: 33b-context-bar.js's Context Bar is selection-bound (it
  // only renders when selectedBoardObjectTargets().length > 0, and it
  // positions itself off transformGizmoGroup) — a freshly drawn stroke has no
  // board-object selection, so the bar cannot show here. This file builds a
  // small standalone floating chip row instead, reusing the Context Bar's own
  // CSS verbatim (.tw-context-bar / .tw-cb-row / .selection-prop-chip) so it
  // looks identical without a second chip theme, positioned at the stroke's
  // screen midpoint using the same clamp-to-viewport math as
  // 33b's tickContextBar.
  (function initPenTool() {
    function penRt(key, fallback) {
      return (typeof window.tx === 'function') ? window.tx(key, fallback) : (window.t ? window.t(key) : fallback);
    }

    function penBuildV2Enabled() {
      return !!(window.__tinyworldFeatureFlagsApi
        && typeof window.__tinyworldFeatureFlagsApi.isEnabled === 'function'
        && window.__tinyworldFeatureFlagsApi.isEnabled('buildV2'));
    }

    // -------- stroke capture --------
    // penStrokeState is non-null only while the pointer is down and dragging
    // a stroke; penChooserEl is non-null only while the "what should this
    // become" chooser is showing. The two never overlap in time.
    let penStrokeState = null;
    let penChooserEl = null;

    function penCellKey(x, z) { return x + ',' + z; }

    // Screen position is sampled only when a genuinely NEW cell joins the
    // stroke (not on every raw pointermove) so the midpoint reflects the
    // shape of the stroke rather than being skewed toward wherever the
    // pointer happened to linger longest.
    function penAddStrokeCell(x, z, drawFenceSide, hit, clientX, clientY) {
      const state = penStrokeState;
      if (!state) return;
      const key = penCellKey(x, z);
      if (!state.seen.has(key)) {
        state.seen.add(key);
        state.cells.push({ x, z, drawFenceSide: drawFenceSide || null });
        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
          state.screenSumX += clientX;
          state.screenSumY += clientY;
          state.screenCount++;
        }
      }
      state.lastCoord = { x, z };
      state.lastHit = hit;
    }

    function penUpdatePreview() {
      if (typeof _brushClearPreview !== 'function' || typeof _brushShapePreviewGroup === 'undefined') return;
      _brushClearPreview();
      const state = penStrokeState;
      if (!state || !state.cells.length) return;
      const mat = new THREE.MeshBasicMaterial({ color: 0xe8a83c, transparent: true, opacity: 0.4, depthWrite: false });
      _brushShapePreviewGroup.userData.previewMaterials = [mat];
      state.cells.forEach(c => {
        const display = _brushDisplayPointForWorldCell(c.x, c.z, state.lastHit);
        const geom = getBoxGeometry(0.92, 0.1, 0.92);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.copy(display.point);
        mesh.position.y += 0.08;
        mesh.userData.placementPreviewGeometry = true;
        mesh.userData.sharedGeometry = true;
        _brushShapePreviewGroup.add(mesh);
      });
      _brushShapePreviewGroup.visible = true;
    }

    // Begin a fresh stroke. Returns false (and does nothing) if the pick
    // missed terrain or the flag is off, so the pointerdown branch in
    // 20-input-place-erase.js can fall through to its normal orbit handling.
    function beginPenStroke(hit, clientX, clientY) {
      if (!penBuildV2Enabled() || !hit) return false;
      penHideChooser(); // starting a fresh stroke discards any pending chooser
      const coord = drawWorldCoordForHit(hit);
      if (!coord) return false;
      penStrokeState = {
        cells: [],
        seen: new Set(),
        lastCoord: null,
        lastHit: hit,
        screenSumX: 0,
        screenSumY: 0,
        screenCount: 0,
      };
      penAddStrokeCell(coord.x, coord.z, hit.drawFenceSide || null, hit, clientX, clientY);
      penUpdatePreview();
      return true;
    }

    // Sample the pointer's new hit into the ordered cell list. Bridges gaps
    // wider than one cell (fast pointer moves between raycasts) with a
    // straight-line interpolation — the same integer-step technique
    // drawFenceSideForStep/applyDrawToolToHit already use for the freehand
    // draw-paint path, just recording cells instead of painting immediately.
    function updatePenStroke(hit, clientX, clientY) {
      const state = penStrokeState;
      if (!state || !hit) return;
      const coord = drawWorldCoordForHit(hit);
      if (!coord) return;
      const prev = state.lastCoord;
      if (prev) {
        const dx = coord.x - prev.x;
        const dz = coord.z - prev.z;
        const steps = Math.max(Math.abs(dx), Math.abs(dz));
        let prevCoord = prev;
        for (let i = 1; i <= steps; i++) {
          const sx = Math.round(prev.x + dx * (i / steps));
          const sz = Math.round(prev.z + dz * (i / steps));
          const stepCoord = { x: sx, z: sz };
          const side = drawFenceSideForStep(prevCoord, stepCoord, hit);
          penAddStrokeCell(sx, sz, side, hit, clientX, clientY);
          prevCoord = stepCoord;
        }
      } else {
        penAddStrokeCell(coord.x, coord.z, hit.drawFenceSide || null, hit, clientX, clientY);
      }
      penUpdatePreview();
    }

    // First and last stroke cells share an edge (4-directional adjacency).
    // Detected per 00-VISION.md's open-vs-closed distinction; this slice
    // offers the same three outputs either way (fill options are explicitly
    // out of scope for v1 per 04-PLAN.md slice 4), so it's informational only
    // for now — kept because a future slice's Fill option needs it, and
    // skipping the detection here would just move the work there.
    function penStrokeIsClosed(cells) {
      if (cells.length < 3) return false;
      const first = cells[0], last = cells[cells.length - 1];
      return (Math.abs(first.x - last.x) + Math.abs(first.z - last.z)) === 1;
    }

    // Ends the drag. <2 cells (a tap, not a stroke) discards silently. Otherwise
    // hands off to the chooser at the stroke's screen midpoint — the preview
    // highlight is deliberately left showing (cleared by penHideChooser/
    // penApplyStroke) so the user can see what they drew while deciding.
    function endPenStrokeAndShowChooser() {
      const state = penStrokeState;
      penStrokeState = null;
      if (!state || state.cells.length < 2) {
        if (typeof _brushClearPreview === 'function') _brushClearPreview();
        return;
      }
      const isClosed = penStrokeIsClosed(state.cells);
      const midX = state.screenCount ? state.screenSumX / state.screenCount : window.innerWidth / 2;
      const midY = state.screenCount ? state.screenSumY / state.screenCount : window.innerHeight / 2;
      penShowChooser(state.cells.slice(), isClosed, midX, midY);
    }

    // Cancels whichever pen state is live (in-progress drag, or a pending
    // chooser) and reports whether it actually did anything, so callers
    // (Escape / right-click / tool-switch) can decide whether to also reset
    // the shared dragMode. Safe to call unconditionally at any time.
    function cancelPenStroke() {
      let did = false;
      if (penStrokeState) {
        penStrokeState = null;
        if (typeof _brushClearPreview === 'function') _brushClearPreview();
        did = true;
      }
      if (penHideChooser()) did = true;
      return did;
    }

    // -------- chooser (standalone floating chip row — see file header) --------

    function penHideChooser() {
      if (!penChooserEl) return false;
      if (typeof _brushClearPreview === 'function') _brushClearPreview();
      penChooserEl.remove();
      penChooserEl = null;
      return true;
    }

    function penMakeChip(label, onClick, opts) {
      opts = opts || {};
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'selection-prop-chip' + (opts.danger ? ' danger-chip' : '');
      chip.textContent = label;
      chip.title = label;
      chip.setAttribute('aria-label', label);
      chip.addEventListener('click', e => { e.stopPropagation(); onClick(); });
      return chip;
    }

    function penShowChooser(cells, isClosed, midX, midY) {
      penHideChooser();
      const root = document.createElement('div');
      root.className = 'tw-context-bar tw-pen-chooser';
      root.setAttribute('role', 'toolbar');
      root.setAttribute('aria-label', isClosed
        ? penRt('pen.chooser.ariaLoop', 'Make this loop into')
        : penRt('pen.chooser.aria', 'Make this stroke into'));
      const row = document.createElement('div');
      row.className = 'tw-cb-row';
      row.appendChild(penMakeChip(penRt('pen.chooser.fence', 'Fence'), () => penApplyStroke(cells, 'fence')));
      row.appendChild(penMakeChip(penRt('pen.chooser.path', 'Path'), () => penApplyStroke(cells, 'path')));
      row.appendChild(penMakeChip(penRt('pen.chooser.hedge', 'Hedge'), () => penApplyStroke(cells, 'hedge')));
      row.appendChild(penMakeChip(penRt('pen.chooser.cancel', 'Cancel'), () => penHideChooser(), { danger: true }));
      root.appendChild(row);
      document.body.appendChild(root);
      penChooserEl = root;
      // Clamp-to-viewport, mirroring 33b-context-bar.js's tickContextBar anchor math.
      const halfW = (root.offsetWidth || 220) / 2;
      const h = root.offsetHeight || 48;
      const margin = 12;
      const cx = Math.max(margin + halfW, Math.min(window.innerWidth - margin - halfW, midX));
      const cy = Math.max(margin, Math.min(window.innerHeight - margin - h, midY));
      root.style.transform = 'translate3d(' + (cx - halfW) + 'px,' + cy + 'px,0)';
    }

    // -------- apply (reuses the normal placement path) --------

    function penOutputToolId(kind) {
      if (kind === 'path') return 'path';
      if (kind === 'hedge') return 'bush';
      return 'fence';
    }

    function penApplyStroke(cells, kind) {
      penHideChooser();
      if (!cells || cells.length < 2 || typeof TOOLS === 'undefined') return;
      const targetTool = TOOLS.find(t => t.id === penOutputToolId(kind));
      if (!targetTool) return;
      const prevTool = selectedTool;
      let placed = 0, skipped = 0;
      pushWorldHistorySnapshot(); // one undo step for the whole stroke (free-object-drag's pattern)
      worldHistoryMuted = true;
      try {
        selectedTool = targetTool;
        cells.forEach(c => {
          const existing = getWorldCell(c.x, c.z);
          if (existing && existing.kind) { skipped++; return; } // occupied — don't overwrite
          const hit = drawHitFromWorldCoord(c.x, c.z, null, c.drawFenceSide || null);
          applyToolToCell(hit, { skipSelectionBulk: true, drawing: true });
          placed++;
        });
      } finally {
        selectedTool = prevTool;
        worldHistoryMuted = false;
        if (typeof ensureGhostPreview === 'function') ensureGhostPreview();
      }
      penToastSummary(kind, placed, skipped);
    }

    function penToastSummary(kind, placed, skipped) {
      if (typeof twToast !== 'function') return;
      if (placed === 0) {
        twToast(penRt('pen.toast.allSkipped', 'Nothing placed — every tile was already occupied'), 'warn');
        return;
      }
      const base = kind === 'path' ? 'pen.toast.path' : (kind === 'hedge' ? 'pen.toast.hedge' : 'pen.toast.fence');
      const key = skipped > 0 ? base + 'Skipped' : base;
      const fallback = {
        'pen.toast.fence': 'Fenced {n} tiles',
        'pen.toast.fenceSkipped': 'Fenced {n} tiles, {skipped} skipped',
        'pen.toast.path': 'Paved {n} tiles',
        'pen.toast.pathSkipped': 'Paved {n} tiles, {skipped} skipped',
        'pen.toast.hedge': 'Hedged {n} tiles',
        'pen.toast.hedgeSkipped': 'Hedged {n} tiles, {skipped} skipped',
      }[key];
      const msg = (typeof window.t === 'function') ? window.t(key, { n: placed, skipped }) : fallback;
      twToast(msg, 'ok');
    }

    // Exposed for 20-input-place-erase.js's dragMode integration and
    // 19-tools-toolbar.js's selectTool() tool-switch cancel — both call these
    // through `typeof x === 'function'` guards, so load order relative to
    // this file doesn't matter (the guards only ever run after full page load).
    window.beginPenStroke = beginPenStroke;
    window.updatePenStroke = updatePenStroke;
    window.endPenStrokeAndShowChooser = endPenStrokeAndShowChooser;
    window.cancelPenStroke = cancelPenStroke;
  }());
