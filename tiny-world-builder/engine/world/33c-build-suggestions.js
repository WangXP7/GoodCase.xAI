  // -------- contextual build suggestions (build v2, slice 3) --------
  // The "I place a fence next to a tower and it says 'change to wall?'"
  // moment from 00-VISION.md's suggestions engine. Rules are DATA
  // (SUGGEST_RULES below) — adding a rule is an array entry, not code
  // surgery through this file's evaluate/render plumbing.
  //
  // Offers render as ONE dismissible chip inside 33b-context-bar.js's
  // #tw-context-suggestions container (row 2 of the Context Bar) — never a
  // modal, never blocking placement. Accepting a rule runs ordinary setCell
  // edits (engine/world/17-tile-renderers.js), so undo/multiplayer work for
  // free, same as every other Context Bar writer.
  //
  // Reachability note: placing an object does NOT auto-select it
  // (engine/world/20-input-place-erase.js has no select-after-place step),
  // and the Context Bar is the only surface this renders into, so an offer
  // only appears once the relevant cell is selected — placing a fence next
  // to a tower and then clicking it (or selecting a fence that already
  // qualifies) shows the chip. A standalone toast surface was considered and
  // skipped: this reuses 33b's existing container with zero new UI.
  //
  // Loads after 33b-context-bar.js (script tag order in
  // tiny-world-builder.html) so its listener for 'tinyworld:selection-changed'
  // registers after 33b's — on any given fire, 33b's handler (which builds/
  // shows #tw-context-suggestions) runs first, so this file's handler always
  // finds a real container to render into when a selection is showing.
  (function initBuildSuggestions() {
    function rt(key, fallback) {
      return (typeof window.tx === 'function') ? window.tx(key, fallback) : (window.t ? window.t(key) : fallback);
    }

    function sbBuildV2Enabled() {
      return !!(window.__tinyworldFeatureFlagsApi
        && typeof window.__tinyworldFeatureFlagsApi.isEnabled === 'function'
        && window.__tinyworldFeatureFlagsApi.isEnabled('buildV2'));
    }

    function sbFenceStyle(cell) {
      return (typeof fenceStyleForCell === 'function') ? fenceStyleForCell(cell) : (cell && cell.appearance && cell.appearance.fenceStyle);
    }

    function sbAppearance(cell) {
      return (typeof normalizeAppearance === 'function') ? (normalizeAppearance(cell.appearance) || {}) : (cell.appearance || {});
    }

    // -------- rule: FENCE-NEAR-TOWER --------
    // A fence within 1 cell of a real turret house (buildingType 'turret',
    // chosen explicitly via the Castle toolbar option — see the comment on
    // isTurretHouse, 16-drop-anim-adjacency.js) offers converting its whole
    // contiguous fence run to a castle wall. Accepting sets fenceStyle
    // 'castle' (new opt-in value, same file) on every cell in the run —
    // that's the field isCastleFence now reads, so the run re-renders as
    // makeCastleWallSegment immediately via the existing setCell repaint.

    function sbFloodFenceRun(x0, z0, cap) {
      const cells = [];
      const seen = new Set();
      const queue = [[x0, z0]];
      let head = 0;
      while (head < queue.length && cells.length < cap) {
        const [x, z] = queue[head++];
        const key = x + ',' + z;
        if (seen.has(key)) continue;
        seen.add(key);
        const cell = getWorldCell(x, z);
        if (!cell || cell.kind !== 'fence') continue;
        cells.push({ x, z, cell });
        queue.push([x, z - 1], [x, z + 1], [x + 1, z], [x - 1, z]);
      }
      return cells;
    }

    function ruleFenceNearTowerWhen(ctx) {
      const cell = ctx.cell;
      if (!cell || cell.kind !== 'fence') return false;
      if (sbFenceStyle(cell) === 'castle') return false;
      const x = ctx.x, z = ctx.z;
      return isTurretHouse(x, z - 1) || isTurretHouse(x, z + 1) || isTurretHouse(x + 1, z) || isTurretHouse(x - 1, z);
    }

    // setCell is FULL-INTENT, not a partial patch — `{ appearance }` alone
    // would null the kind and reset terrain to grass (17-tile-renderers.js
    // setCellImpl destructuring: `kind = null`, `terrain || 'grass'`).
    // updateSelectedBoardObject (21-object-transform-voxel-build.js) is the
    // proven partial-patch writer: it re-reads the cell and spreads the full
    // cell into setCell opts, and works for any {x,z,cell}-shaped target.
    function sbPatchCell(x, z, cell, appearancePatch) {
      const appearance = Object.assign({}, sbAppearance(cell), appearancePatch);
      if (typeof updateSelectedBoardObject === 'function') {
        updateSelectedBoardObject({ x, z, cell }, { appearance });
      }
    }

    function ruleFenceNearTowerApply(ctx) {
      const run = sbFloodFenceRun(ctx.x, ctx.z, 200);
      run.forEach(({ x, z, cell }) => sbPatchCell(x, z, cell, { fenceStyle: 'castle' }));
    }

    // -------- rule: FENCE-LOOP-GATE --------
    // A newly placed/selected fence that closes a loop (two of its own fence
    // neighbours are already connected to each other by some OTHER path)
    // offers adding a gate at that cell. fenceStyle 'gate' is already real
    // and rendered (07-house-primitives.js makeFence gate branch) — it was
    // simply unreachable by any picker before this.

    function sbFenceClosesLoop(x, z, cap) {
      const neighborCoords = [[x, z - 1], [x, z + 1], [x + 1, z], [x - 1, z]]
        .filter(([nx, nz]) => { const c = getWorldCell(nx, nz); return c && c.kind === 'fence'; });
      if (neighborCoords.length < 2) return false;
      const start = neighborCoords[0];
      const targets = new Set(neighborCoords.slice(1).map(([nx, nz]) => nx + ',' + nz));
      const blocked = x + ',' + z; // walk must not pass back through the placed cell itself
      const seen = new Set([blocked]);
      const queue = [start];
      let head = 0;
      let visited = 0;
      while (head < queue.length && visited < cap) {
        const [cx, cz] = queue[head++];
        const key = cx + ',' + cz;
        if (seen.has(key)) continue;
        seen.add(key);
        visited++;
        if (targets.has(key)) return true;
        const c = getWorldCell(cx, cz);
        if (!c || c.kind !== 'fence') continue;
        queue.push([cx, cz - 1], [cx, cz + 1], [cx + 1, cz], [cx - 1, cz]);
      }
      return false;
    }

    function ruleFenceLoopGateWhen(ctx) {
      const cell = ctx.cell;
      if (!cell || cell.kind !== 'fence') return false;
      if (sbFenceStyle(cell) === 'gate') return false;
      return sbFenceClosesLoop(ctx.x, ctx.z, 200);
    }

    function ruleFenceLoopGateApply(ctx) {
      sbPatchCell(ctx.x, ctx.z, ctx.cell, { fenceStyle: 'gate' });
    }

    // -------- rule table (data) --------
    // Add a rule by appending an entry here — {id, when(ctx), apply(ctx),
    // labelKey/labelFallback, actionKey/actionFallback}. ctx is always
    // { x, z, cell } for the current selection's primary target. Evaluation
    // stops at the first matching, non-dismissed rule (at most one offer).
    const SUGGEST_RULES = [
      {
        id: 'fence-near-tower',
        when: ruleFenceNearTowerWhen,
        apply: ruleFenceNearTowerApply,
        labelKey: 'contextbar.suggest.fenceCastle',
        labelFallback: 'Change fence run to castle wall?',
        actionKey: 'contextbar.suggest.fenceCastle.action',
        actionFallback: 'Convert',
      },
      {
        id: 'fence-loop-gate',
        when: ruleFenceLoopGateWhen,
        apply: ruleFenceLoopGateApply,
        labelKey: 'contextbar.suggest.fenceGate',
        labelFallback: 'Add a gate?',
        actionKey: 'contextbar.suggest.fenceGate.action',
        actionFallback: 'Add gate',
      },
    ];

    // -------- evaluate / render --------
    // Session-level only (module-scoped Set) — dismissing (or accepting)
    // never persists to localStorage; a reload clears every dismissal.
    const dismissedOffers = new Set();

    function sbTargets() {
      return (typeof selectedBoardObjectTargets === 'function') ? selectedBoardObjectTargets() : [];
    }

    function sbMakeChip(rule, ctx, key) {
      const wrap = document.createElement('div');
      wrap.className = 'tw-cb-suggestion-chip';

      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'selection-prop-chip';
      accept.textContent = rt(rule.labelKey, rule.labelFallback);
      accept.title = rt(rule.actionKey, rule.actionFallback);
      accept.setAttribute('aria-label', rt(rule.labelKey, rule.labelFallback));
      accept.addEventListener('click', e => {
        e.stopPropagation();
        rule.apply(ctx);
        dismissedOffers.add(key); // accepted — don't re-offer this rule at this cell again
        sbEvaluate();
      });

      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'selection-prop-chip icon-chip round-chip';
      dismiss.textContent = '×';
      dismiss.title = rt('contextbar.suggest.dismiss', 'Dismiss');
      dismiss.setAttribute('aria-label', rt('contextbar.suggest.dismiss', 'Dismiss'));
      dismiss.addEventListener('click', e => {
        e.stopPropagation();
        dismissedOffers.add(key);
        sbEvaluate();
      });

      wrap.appendChild(accept);
      wrap.appendChild(dismiss);
      return wrap;
    }

    function sbRender(matched) {
      const container = document.getElementById('tw-context-suggestions');
      if (!container) return; // Context Bar hasn't built its DOM yet — nothing to render into.
      container.innerHTML = '';
      if (matched) container.appendChild(sbMakeChip(matched.rule, matched.ctx, matched.key));
    }

    function sbEvaluate() {
      if (!sbBuildV2Enabled()) { sbRender(null); return; }
      const targets = sbTargets();
      if (!targets.length) { sbRender(null); return; }
      const primary = targets[0];
      const ctx = { x: primary.x, z: primary.z, cell: primary.cell };
      let matched = null;
      for (let i = 0; i < SUGGEST_RULES.length; i++) {
        const rule = SUGGEST_RULES[i];
        const key = rule.id + '@' + ctx.x + ',' + ctx.z;
        if (dismissedOffers.has(key)) continue;
        if (rule.when(ctx)) { matched = { rule, ctx, key }; break; }
      }
      sbRender(matched);
    }

    // -------- debounced event wiring --------
    // Listeners always register (harmless when the flag is off); the actual
    // work — even scheduling the debounce — only happens once the flag check
    // inside the handler passes, so flag-off costs nothing per-event.
    let debounceHandle = null;
    function scheduleEvaluate() {
      if (debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => { debounceHandle = null; sbEvaluate(); }, 150);
    }
    window.addEventListener('tinyworld:world-changed', () => {
      if (!sbBuildV2Enabled()) return;
      scheduleEvaluate();
    });
    window.addEventListener('tinyworld:selection-changed', () => {
      if (!sbBuildV2Enabled()) return;
      scheduleEvaluate();
    });
  }());
