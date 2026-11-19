  // -------- context bar (build v2) --------
  // The selection-editing surface from 00-VISION.md #2. Replaces the radial
  // ring's editing role (Color/Style/Size) when the `buildV2` flag is on —
  // see the ring demotion in 33-radial-menu.js (radialBuildV2Enabled gate).
  //
  // DOCTRINE (00-VISION.md "the one rule that fixes most of it"): a chip is
  // only rendered when TWObjectCaps.capsForKind() says the selection supports
  // it (engine/world/17b-object-capabilities.js). Multi-select uses the same
  // every()-across-selection intersection semantics slice 1 used in the ring
  // (33-radial-menu.js radialRootCapsForSelection).
  //
  // Reuses the shared global writers other surfaces already call — this file
  // never reimplements a mutation:
  //   - rotateActiveCellIntent / deleteActiveCellIntent / duplicateActiveCellIntent
  //     (engine/world/20-input-place-erase.js)
  //   - scaleSelectedBoardObject / updateSelectedBoardObjects / selectedBoardObjectTargets
  //     (engine/world/21-object-transform-voxel-build.js)
  //   - window.applySelectionProperty / window.selectionColorConfig
  //     (engine/world/28a-floating-agent.js — exposed on window for this file;
  //     see the export comment there. That export also fixes a pre-existing
  //     gap: TWObjectCaps.capsForKind().colorRows relied on selectionColorConfig
  //     as a bare identifier since slice 1, but it was never reachable outside
  //     28a's IIFE, so colorRows had always resolved to null.)
  //
  // DOM is built lazily on first real show (ensureDom()) so the flag-off path
  // never touches the document — only function definitions, one event
  // listener, and a tick-fn export happen at load time.
  //
  // Loads after 33-radial-menu.js (script tag order in tiny-world-builder.html).
  // Its per-frame position/visibility tick is wired into the animation loop
  // from engine/world/25-animation-loop-schema.js (tickContextBar()), the same
  // way tickRadialMenu() is.
  (function initContextBar() {
    function rt(key, fallback) {
      return (typeof window.tx === 'function') ? window.tx(key, fallback) : (window.t ? window.t(key) : fallback);
    }

    function cbBuildV2Enabled() {
      return !!(window.__tinyworldFeatureFlagsApi
        && typeof window.__tinyworldFeatureFlagsApi.isEnabled === 'function'
        && window.__tinyworldFeatureFlagsApi.isEnabled('buildV2'));
    }

    // Islands are transformed as a whole via a separate gizmo (33-radial-menu.js
    // selectedRadialIsland()) — no cell.kind, so the capability registry has
    // nothing to gate. Mirror that same guard here.
    function cbIslandSelected() {
      return !!(typeof selectedTransformGizmoIsland !== 'undefined' && selectedTransformGizmoIsland);
    }

    function cbTargets() {
      return (typeof selectedBoardObjectTargets === 'function') ? selectedBoardObjectTargets() : [];
    }

    // Intersection across multi-select — same every() semantics slice 1 used
    // (33-radial-menu.js radialRootCapsForSelection). Color-row labels/options
    // key off the first selected target's kind, exactly like the panel's
    // "primary" pattern (28a-floating-agent.js renderSelectionProperties:
    // `const primary = entries[0][0]; const colorConfig = selectionColorConfig(primary);`).
    function cbCapsForTargets(targets) {
      if (!targets.length || typeof TWObjectCaps === 'undefined') return null;
      const capsList = targets.map(t => TWObjectCaps.capsForKind(t.cell.kind));
      const every = fn => capsList.every(fn);
      const primaryKind = targets[0].cell.kind;
      const housesOnly = targets.every(t => t.cell.kind === 'house');
      const colorOk = every(c => c.color);
      return {
        rotate: every(c => c.rotate),
        size: every(c => c.size),
        style: every(c => c.style),
        color: colorOk,
        floors: housesOnly,
        colorRows: colorOk ? (TWObjectCaps.capsForKind(primaryKind).colorRows || null) : null,
      };
    }

    function cbUniform(items, getter) {
      let has = false, first;
      for (const it of items) {
        const v = getter(it);
        if (!has) { has = true; first = v; }
        else if (v !== first) return undefined;
      }
      return has ? first : undefined;
    }

    function cbAppearance(cell) {
      return (typeof normalizeAppearance === 'function') ? (normalizeAppearance(cell.appearance) || {}) : (cell.appearance || {});
    }

    // -------- writers (all delegate to existing global mutation primitives) --------

    function cbRotate() {
      if (typeof rotateActiveCellIntent === 'function') rotateActiveCellIntent(Math.PI / 2);
    }
    function cbScale(factor) {
      if (typeof scaleSelectedBoardObject === 'function') scaleSelectedBoardObject(factor);
    }
    function cbFloorsDelta(delta) {
      if (typeof updateSelectedBoardObjects !== 'function') return;
      const maxFloors = (typeof MAX_FLOORS !== 'undefined') ? MAX_FLOORS : 8;
      updateSelectedBoardObjects(target => {
        if (target.cell.kind !== 'house') return null;
        const next = Math.max(1, Math.min(maxFloors, (target.cell.floors || 1) + delta));
        if (next === (target.cell.floors || 1)) return null;
        return { floors: next };
      });
    }
    function cbToggleStyle(currentIsVoxel) {
      if (typeof updateSelectedBoardObjects !== 'function') return;
      const next = currentIsVoxel ? 'normal' : 'voxel';
      updateSelectedBoardObjects(target => {
        const appearance = Object.assign({}, cbAppearance(target.cell));
        appearance.objectStyle = next;
        return { appearance };
      });
    }
    function cbApplyColor(rowKey, value) {
      if (typeof window.applySelectionProperty === 'function') window.applySelectionProperty(rowKey, value);
    }
    function cbDelete() {
      if (typeof deleteActiveCellIntent === 'function') deleteActiveCellIntent();
    }
    function cbDuplicate() {
      if (typeof duplicateActiveCellIntent === 'function') duplicateActiveCellIntent();
    }
    // Arms a one-shot free-drag (engine/world/20-input-place-erase.js
    // armFreeObjectDrag): the next pointerdown on this object starts a
    // continuous drag that re-homes it to whatever tile it's dropped on.
    // Single-selection only for v1 — multi-select rejects with a toast
    // rather than silently arming for one arbitrary target.
    function cbArmMove(targets) {
      if (!targets || targets.length !== 1) {
        if (typeof twToast === 'function') twToast(rt('contextbar.move.multiselect', 'Select a single object to move it.'), 'warn');
        return;
      }
      if (typeof armFreeObjectDrag === 'function') armFreeObjectDrag(targets[0]);
    }

    // -------- DOM (built lazily — never at load time) --------

    let root = null;
    let capsRowEl = null, colorRowEl = null;
    let lastSignature = null;

    function makeActionChip(label, opts) {
      opts = opts || {};
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'selection-prop-chip' + (opts.danger ? ' danger-chip' : '') + (opts.active ? ' active' : '');
      chip.textContent = label;
      chip.title = opts.title || label;
      chip.setAttribute('aria-label', opts.title || label);
      if (opts.active) chip.setAttribute('aria-pressed', 'true');
      chip.addEventListener('click', e => { e.stopPropagation(); opts.onClick && opts.onClick(); });
      return chip;
    }

    function ensureDom() {
      if (root) return;
      root = document.createElement('div');
      root.className = 'tw-context-bar';
      root.hidden = true;
      root.setAttribute('role', 'toolbar');
      root.setAttribute('aria-label', rt('contextbar.aria', 'Selection actions'));

      capsRowEl = document.createElement('div');
      capsRowEl.className = 'tw-cb-row tw-cb-row-caps';

      colorRowEl = document.createElement('div');
      colorRowEl.className = 'tw-cb-row tw-cb-row-color';

      // Row 2 — suggestions (slice 3 fills this in). Stable id per the plan.
      const suggestionsEl = document.createElement('div');
      suggestionsEl.className = 'tw-cb-suggestions';
      suggestionsEl.id = 'tw-context-suggestions';

      // Row 3 — destructive/rare. Not kind-gated (plans/build-v2/01-ux-capability-
      // audit.md: "Duplicate / Delete ... not kind-sensitive"), and reuses the
      // exact same actions the ring's runAction('delete'/'duplicate') calls
      // (33-radial-menu.js:436, :422) — both stay wired in the ring too, so
      // this is an additive surface, not a relocation.
      const actionsRowEl = document.createElement('div');
      actionsRowEl.className = 'tw-cb-row tw-cb-row-actions';
      actionsRowEl.appendChild(makeActionChip(rt('contextbar.duplicate', 'Duplicate'), { onClick: cbDuplicate }));
      actionsRowEl.appendChild(makeActionChip(rt('contextbar.delete', 'Delete'), { danger: true, onClick: cbDelete }));
      // The ring is fully suppressed for board-object selections under build
      // v2 (33-radial-menu.js tickRadialMenu) — its three non-editing actions
      // live here now, reusing the ring's own functions and i18n keys.
      actionsRowEl.appendChild(makeActionChip(rt('radial.generate', 'Generate'), {
        onClick: () => { if (typeof window.__twRadialOpenGenerateModal === 'function') window.__twRadialOpenGenerateModal(); },
      }));
      actionsRowEl.appendChild(makeActionChip(rt('radial.more', 'More'), {
        onClick: () => { if (typeof window.__twRadialOpenSelectionPanel === 'function') window.__twRadialOpenSelectionPanel(); },
      }));
      const closeChip = makeActionChip('×', {
        title: rt('radial.close', 'Close'),
        onClick: () => { if (typeof clearSelection === 'function') clearSelection(); hideBar(); },
      });
      closeChip.classList.add('icon-chip', 'round-chip');
      actionsRowEl.appendChild(closeChip);

      root.appendChild(capsRowEl);
      root.appendChild(colorRowEl);
      root.appendChild(suggestionsEl);
      root.appendChild(actionsRowEl);
      document.body.appendChild(root);
    }

    function renderCaps(targets, caps) {
      capsRowEl.innerHTML = '';
      // Move is universal — not gated by TWObjectCaps, same as Duplicate/Delete
      // in the actions row (every selected object has a tile position it can
      // be dragged off of, regardless of kind).
      capsRowEl.appendChild(makeActionChip(rt('contextbar.move', 'Move'), {
        title: rt('contextbar.move.title', 'Drag to move to another tile'),
        onClick: () => cbArmMove(targets),
      }));
      if (caps.rotate) {
        capsRowEl.appendChild(makeActionChip(rt('radial.rotate', 'Rotate'), { onClick: cbRotate }));
      }
      if (caps.size) {
        capsRowEl.appendChild(makeActionChip(rt('radial.size.shrink', 'Shrink'), { onClick: () => cbScale(0.87) }));
        capsRowEl.appendChild(makeActionChip(rt('radial.size.grow', 'Grow'), { onClick: () => cbScale(1.15) }));
      }
      if (caps.floors) {
        const floorsVal = cbUniform(targets, t => t.cell.floors || 1);
        const wrap = document.createElement('div');
        wrap.className = 'tw-cb-stepper';
        const minus = makeActionChip('−', { title: rt('contextbar.floors.decrease', 'Fewer floors'), onClick: () => cbFloorsDelta(-1) });
        minus.classList.add('icon-chip', 'round-chip');
        const plus = makeActionChip('+', { title: rt('contextbar.floors.increase', 'More floors'), onClick: () => cbFloorsDelta(1) });
        plus.classList.add('icon-chip', 'round-chip');
        const label = document.createElement('span');
        label.className = 'tw-cb-stepper-label';
        label.textContent = rt('contextbar.floors', 'Floors') + ' ' + (floorsVal === undefined ? '—' : floorsVal);
        wrap.appendChild(minus);
        wrap.appendChild(label);
        wrap.appendChild(plus);
        capsRowEl.appendChild(wrap);
      }
      if (caps.style) {
        const styleVal = cbUniform(targets, t => (cbAppearance(t.cell).objectStyle === 'voxel' ? 'voxel' : 'normal'));
        const isVoxel = styleVal === 'voxel';
        capsRowEl.appendChild(makeActionChip(
          isVoxel ? rt('contextbar.style.voxel', 'Voxel') : rt('contextbar.style.normal', 'Normal'),
          { active: isVoxel, title: rt('radial.style', 'Style'), onClick: () => cbToggleStyle(isVoxel) },
        ));
      }
    }

    function renderColor(targets, caps) {
      colorRowEl.innerHTML = '';
      if (!caps.color || !caps.colorRows || !Array.isArray(caps.colorRows.rows)) return;
      const colorKinds = caps.colorRows.kinds;
      const colorCells = targets.filter(t => !colorKinds || colorKinds.has(t.cell.kind)).map(t => t.cell);
      caps.colorRows.rows.forEach(row => {
        const rowWrap = document.createElement('div');
        rowWrap.className = 'selection-prop-row';
        const label = document.createElement('div');
        label.className = 'selection-prop-label';
        label.textContent = row.label;
        const options = document.createElement('div');
        options.className = 'selection-prop-options';
        const activeValue = cbUniform(colorCells, cell => cbAppearance(cell)[row.key] || 'default');
        (row.options || []).forEach(opt => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'selection-prop-chip color-chip';
          chip.title = row.label + ': ' + opt.label;
          chip.setAttribute('aria-label', row.label + ': ' + opt.label);
          const isActive = activeValue !== undefined && activeValue === opt.value;
          chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
          if (isActive) chip.classList.add('active');
          if (opt.color) {
            const swatch = document.createElement('span');
            swatch.className = 'selection-prop-swatch';
            swatch.style.background = opt.color;
            chip.appendChild(swatch);
          }
          chip.appendChild(document.createTextNode(opt.label));
          chip.addEventListener('click', e => { e.stopPropagation(); cbApplyColor(row.key, opt.value); });
          options.appendChild(chip);
        });
        rowWrap.appendChild(label);
        rowWrap.appendChild(options);
        colorRowEl.appendChild(rowWrap);
      });
    }

    function cbSelectionSignature(targets) {
      if (!targets.length) return '';
      return targets.map(t => t.x + ',' + t.z + ':' + t.cell.kind + ':' + (t.cell.floors || 1) + ':' + JSON.stringify(t.cell.appearance || null)).join('|');
    }

    function hideBar() {
      if (root) root.hidden = true;
      lastSignature = null;
    }

    // The canonical selection-changed hook — same event 28a-floating-agent.js
    // (renderSelection) and 32-layers-panel.js (scheduleLayersRefresh) listen
    // to. Rebuilding chips here on every fire (rather than only tracking the
    // ring's narrower island/edit-part transitions) is the fix for the known
    // slice-1 gap: a kind change under an open surface used to leave stale
    // chips (04-PLAN.md "Known gap carried to Slice 2").
    function renderAll() {
      if (!cbBuildV2Enabled() || cbIslandSelected()) { hideBar(); return; }
      const targets = cbTargets();
      if (!targets.length) { hideBar(); return; }
      const caps = cbCapsForTargets(targets);
      if (!caps) { hideBar(); return; }
      ensureDom();
      renderCaps(targets, caps);
      renderColor(targets, caps);
      root.hidden = false;
      lastSignature = cbSelectionSignature(targets);
    }
    window.addEventListener('tinyworld:selection-changed', renderAll);

    // -------- per-frame position + defensive re-render --------
    // Mirrors tickRadialMenu()'s gizmo-projection anchoring (33-radial-menu.js),
    // offset further below the object so the bar doesn't sit directly on top
    // of the ring (which keeps rotate/move/duplicate/delete/generate/more when
    // the flag is on — see the ring demotion comment there). Also re-renders
    // defensively when the selection signature drifts without a selection-
    // changed event firing, so a stale surface can't survive a missed event.
    const cbProjectPoint = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;

    function cbNarrowViewport() {
      return window.innerWidth <= 700;
    }

    function tickContextBar() {
      if (!cbBuildV2Enabled() || cbIslandSelected()) { if (root) root.hidden = true; return; }
      const targets = cbTargets();
      if (!targets.length) { if (root) root.hidden = true; return; }
      const sig = cbSelectionSignature(targets);
      if (sig !== lastSignature) renderAll();
      if (!root || root.hidden) return;

      const narrow = cbNarrowViewport();
      root.classList.toggle('tw-cb-sheet', narrow);
      if (narrow) return; // CSS docks it to the viewport edge — no JS position needed.

      const gizmo = typeof transformGizmoGroup !== 'undefined' ? transformGizmoGroup : null;
      const cam = typeof camera !== 'undefined' ? camera : null;
      const dom = (typeof renderer !== 'undefined' && renderer) ? renderer.domElement : null;
      if (!gizmo || !cam || !dom || !gizmo.visible || !cbProjectPoint) return;
      cam.updateMatrixWorld();
      const p = cbProjectPoint.copy(gizmo.position);
      p.y -= 0.6;
      p.project(cam);
      if (p.z > 1) return;
      const rect = dom.getBoundingClientRect();
      const sx = rect.left + (p.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
      const halfW = (root.offsetWidth || 240) / 2;
      const h = root.offsetHeight || 60;
      const margin = 12;
      const cx = Math.max(margin + halfW, Math.min(window.innerWidth - margin - halfW, sx));
      const cy = Math.max(margin, Math.min(window.innerHeight - margin - h, sy));
      root.style.transform = 'translate3d(' + (cx - halfW) + 'px,' + cy + 'px,0)';
    }

    window.tickContextBar = tickContextBar;
  }());
