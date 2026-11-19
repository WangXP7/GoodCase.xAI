The advisor's guidance aligns with and sharpens my verified findings. I'll write the plan with the de-duplication, the two landmines (explode-groups, gizmo-visibility go/no-go), and the gated build order.

---

# TinyWorld Part-Editing Fix + Radial Sub-Edit UX — Implementation Plan

All facts below verified at HEAD `43d43ad` (clean tree). Six diagnoses de-duplicated into **four code fixes + one verify-only** (sections collapse where they describe the same fix).

---

## 1. Bugs — root causes & fixes (ordered by user-visible impact)

### 1.1 Door/window selects the TILE behind it — pre-existing, never worked inside sub-edit
**Confirmed cause (two parts):**
- `resolveRaycastCell` (`18-scene-pick-xr.js:678`) walks UP from any sub-mesh to the gx/gz-stamped cell root, collapsing every hit to `{kind:'cell'}`. Houses render **unbatched** (`makeVoxelLinearHouse` is returned raw — no `optimizeVoxelObjectGroup`), so the door group genuinely wins the raycast, but the click resolves to the cell anyway.
- Even in sub-edit mode, `44:305` `onSubEditPointerDown` selects the part on pointerdown, then `20-input-place-erase.js:937-998` pointerup re-runs `resolveIslandClick → setRectangleSelection(cell)` and clobbers it. Two listeners on the same element, no `stopPropagation`, **pointerup wins**.

**Fix (FIX 1):** In `20-input-place-erase.js`, add a sub-part intercept in the pointerdown handler — after the `gizmoHit` block (ends line 732), before the `engineHit` block (line 734):
```js
const sub = window.__tinyworldSubEdit;
const subHit = (e.button === 0 && !spaceDown && !e.shiftKey && !e.metaKey && !e.ctrlKey && mpEditAllowed()
    && sub && sub.isActive && sub.isActive() && sub._pick)
  ? sub._pick(e.clientX, e.clientY) : null;
if (subHit) {
  sub.selectPart(subHit.partKey);
  dragMode = 'subpart-select';
  pointerDown = { x: e.clientX, y: e.clientY };
  lastPointer = { x: e.clientX, y: e.clientY };
  didDrag = false; hoverMesh.visible = false; currentHover = null;
  renderer.domElement.classList.add('dragging');
  e.preventDefault();
  return;
}
```
Then add `&& dragMode !== 'subpart-select'` to the pointerup click-suppression guard at `20:937-939` (alongside `engine-select`/`transform-gizmo`). Remove the now-redundant `pointerdown` listener and `onSubEditPointerDown` in `44:305` (KEEP the `pointermove` hover listener at 304). Do **NOT** modify `resolveRaycastCell` — that breaks normal cell selection.

**GATING (critical for build order):** FIX 1's guard requires `sub.isActive()`. A cold first click on a door (object not yet in sub-edit) still selects the whole object → radial appears. That is correct. "Door picks tile" is only a bug **inside** sub-edit. So FIX 1 is testable via the existing inspector "Edit parts" entry **before** the radial exists.

### 1.2 Roof not selectable — incomplete NEW work this session
**Confirmed cause:** `voxelSteppedRoof` (`09b:725-739`) adds 4 plain boxes directly to the `house` group with no `partKey`/marker. `keyAndApplyHouseParts` (`09b:1519-1525`) only keys windows (`windowFace`) and door (`doorPart`); wall is keyed inline at `1465`. `pickSubPart` (`44:86-99`) requires an ancestor `partKey` → roof is unpickable. (This is the SAME fix referenced as "FIX 2" in the door-picks-tile diagnosis — not a separate item.)

**Fix:** In `makeVoxelLinearHouse` replace line `1467`:
```js
const roofGroup = new THREE.Group();
roofGroup.position.set(0, wallH, 0);
roofGroup.userData.roofPart = true;
voxelSteppedRoof(roofGroup, bodyW, bodyD, 0, roofMat, roofDark, 'z'); // y=0 since group at wallH
house.add(roofGroup);
```
World Y is byte-identical (`wallH + i*0.085 + s.h/2`). Then in `keyAndApplyHouseParts` after the door branch (`1524`) add:
```js
else if (ch.userData.roofPart) ch.userData.partKey = 'roof';
```
Window indices (`wi++`) are unchanged — the roofGroup has `windowFace === undefined` so persisted `window:N` overrides stay valid. The **call-site** wrapper (not inside `voxelSteppedRoof`) is mandatory: `voxelSteppedRoof` is shared by `makeVoxelBridge` (`09b:1903`), which IS batched (`optimizeVoxelObjectGroup` at 1908) and would discard the marker — so wrapping inside the shared fn would be useless and risk the bridge. No `04-textures.js` allowlist change needed — `keyOk` regex (`04:2075`) already matches `roof`.

### 1.3 Cannot move windows/doors through the real UI — pre-existing, never worked
**Confirmed cause:** `renderSelection` is declared inside the `wireFloatingAgent` IIFE (`28:2340`) and never exposed on `window`. File 44 is a flat top-level script, so `typeof renderSelection === 'function'` (44:133, 44:193) is always false → `selectPart` never rebuilds the panel → the Part move/scale rows (gated on `selectedInfo()` at `28:2069`) never appear. Console worked because `movePart` is independent of `renderSelection`.

**Fix:** Add `window.renderSelection = renderSelection;` inside the `wireFloatingAgent` IIFE in `28-generate-panel-agent.js` (after the `renderSelection` declaration ~`2340`, before the IIFE closes). Classic scripts share the global object, so file 44's existing bare calls resolve without editing file 44. Zero existing `window.renderSelection` usages — purely additive.

### 1.4 Roofs SUNK over windows in voxel mode — regression this session, ALREADY FIXED this session
**Verify-only, NO code change.** This is the SAME finding as the regression audit. Commit `4fde681` introduced it (window group y-anchor + literal-`0` y-arg hitting vbox's `y||h/2` default); the **very next commit `43d43ad` (= HEAD) already reverted it** — `voxelWindow:686-705` now passes full `(x,y,z)` with no group y-anchor. The stale "change `w.position.set(x,y,z)`" edits in the audit diagnosis do **NOT** match current source — do not apply them. Per the user's "verify in real app" rule: load the running app, confirm windows sit centered in walls (not in the eaves). **Only if** residual eave overhang still reads as covering top windows, apply the contained lever `const wallH = 0.46 → 0.52` at `09b:1456` (raises wall+roof+chimney together; no gap opens). Do not pre-apply.

---

## 2. Radial sub-edit UX — concrete design

Reuse the existing single-level drill-down (`33-radial-menu.js`); do not invent a new overlay. All edits inside the `initRadialMenu` IIFE.

**A) ROOT 'Edit' item + nested back-stack (33-radial-menu.js)**
- **Icons:** add `edit` (pencil), `explode` (expand-arrows). `palette` exists; reuse `size` for scale, `move` for nudge arrows.
- **ROOT array (33:22-30):** insert `{ id:'edit', label: window.t('radial.edit'), icon:'edit', angle:90, submenu:'edit', posType:'primary' }`, moving `more` to a freed angle (ROOT currently fills 7 slots; fold/relabel `more`). **Gate it** to single-cottage selection by filtering in `renderLevel('root')` (same place `ISLAND_ACTIONS` filters at 33:104-105), mirroring `28:2055` (`isCottage = kind==='house' && !buildingType` and `onHome`).
- **Back-stack:** replace `let currentLevel='root'` with `levelStack=['root']`. Top-slot handler (33:96-100): if not root, pop and re-render previous; popping out of any `edit*` level back to root calls `window.__tinyworldSubEdit.exit()`. Root Close also calls `exit()` defensively.

**B) `renderLevel('edit')` (the secondary radial — opens on Edit click)**
On first render: `const se=window.__tinyworldSubEdit; const t=selectedBoardObjectTargets()[0]; if(se && t){ se.enter(t.x,t.z); se.setExplode(true); }` (auto-explode so parts separate and become clickable). Four items via `arcAngles(4)`:
- **Explode** — toggle `se.setExplode(!se.isExploded())`, re-render to flip label Explode/Collapse.
- **Move / Scale / Recolor** — each opens its sub-level, BUT read `const hasPart = !!(se && se.selectedInfo && se.selectedInfo())`; if no part selected, render disabled with title `t('radial.edit.tapPart')` ("Tap a part first") + no-op click.

**C) `renderLevel('edit-move')`** — `arcAngles(6)` arrows → `se.movePart(±0.25, …)` per axis (mirrors `28:1693`). Stay open after each tap. Back → 'edit'.
**D) `renderLevel('edit-scale')`** — 2 buttons Down/Up → `se.scalePart(0.85)` / `se.scalePart(1.18)` (mirrors `28:1706`). Stay open. Back → 'edit'.
**E) `renderLevel('edit-color')`** — reuse the `COLORS` array + swatch markup from the `color` branch (33:117-131) but click calls new `se.recolorPart(hex)`.

**F) Reactivity — `tickRadialMenu` (33:218-228):** add `let lastPartKey=null;` — when in an `edit*` level, compare `se.selectedInfo()?.partKey`; if changed, re-run `renderLevel(currentLevel)`. **This is the hook** that flips Move/Scale/Recolor from disabled→enabled after a 3D part click. Note: this is tick-polling, independent of the section 1.3 `renderSelection` fix.

**G) Recolor backing (4 sites — NOT wired today):**
- `44-sub-object-edit.js`: add `function recolorPart(hex){ return mutateSelectedPart(c=>{ if(hex) c.col=hex; else delete c.col; }); }`, export `recolorPart` in `window.__tinyworldSubEdit` (44:308-325).
- `04-textures.js` allowlist (`2084-2089`): copy `col` into the entry using `normalizeHexColor` (already in scope, used at 2107) — `const col = normalizeHexColor(p.col); if(col) entry.col = col;` — and add `&& !entry.col` to the `isIdentity` check (2088) so color-only overrides aren't dropped.
- `09b-voxel-build-factories.js` voxel loop (~398-400): **separate binding** — `let voxMat = mat; if (ov && ov.col) { voxMat = mat.clone(); voxMat.color.set(ov.col); }` then pass `voxMat` to `vbox` at 400. **Leave `trimBase = trimBase || mat` (399) reading `mat`** — `voxelBuildMaterial` returns a shared cached instance; cloning is mandatory or the first recolored voxel poisons every object's trim.
- `keyAndApplyHouseParts` (~1533-1536): after scale, `if (ov.col) n.traverse(o=>{ if(o.isMesh&&o.material){ o.material=o.material.clone(); o.material.color.set(ov.col); } });`. **Known limitation:** cottage recolor covers wall/door/window/roof (now keyed) — sculpt-only voxel-stamps recolor per-voxel.

**H) Replace the buried 'Edit parts' tab flow (28-generate-panel-agent.js):** Delete the rows at `2057-2087` (subEdit/subExplode/partMove/partScale/voxelSculpt/voxelAdd) and their handlers at `1674-1727`. **Do this LAST** (build step 7), only after the radial is verified — and flag as dead code, confirm no other dispatcher hits those rowKeys. Keep voxel sculpt (Remove/Smooth/Add) out of the 4-item radial for now; defer to a follow-up `edit-voxel` sub-ring so no capability is silently dropped.

**I) i18n (`engine/i18n/en.js` after line 251, + fr/zh/es):** `radial.edit:'Edit'`, `radial.edit.explode:'Explode'`, `radial.edit.collapse:'Collapse'`, `radial.edit.move:'Move'`, `radial.edit.scale:'Scale'`, `radial.edit.recolor:'Recolor'`, `radial.edit.tapPart:'Tap a part'`.

---

## 3. Make all house parts selectable + click-pick as default

- **Roof keying:** section 1.2 (cottage `makeVoxelLinearHouse`).
- **Click-pick by default in edit target:** FIX 1 (section 1.1) makes a plain click on any keyed sub-part select that part whenever `sub.isActive()`. Hover already works (`44:304` pointermove). Once the radial's Edit item routes `enter()`, a single click + Edit + click-part is the whole flow — no buried tabs.
- **Generalize to manor/tower/turret/skyscraper/square (separate final phase):** These are gated OUT today by `isCottage` and use different roof builders, none calling `keyAndApplyHouseParts`. `makeVoxelSquareHouse` builds its roof inline (`~1551`) and never calls `keyAndApplyHouseParts` at all. `makeVoxelCompositeHouse` calls `makeVoxelLinearHouse` WITHOUT `{appearance}`, so part overrides don't reach composite houses. Per factory: (a) wrap roof in a `roofPart` group, (b) call `keyAndApplyHouseParts(topGroup, opts.appearance)`, (c) widen the `isCottage` gate at `28:2055`/the radial gate. Do NOT attempt in pass 1 — high regression surface.

---

## 4. Build order (each step independently verifiable with REAL clicks; commit only after live verify)

> **Two go/no-go gates before investing in the radial — verify these with real clicks first:**
> - **GATE A (gizmo persistence):** The radial only renders when `transformGizmoGroup.visible` (33:195). `se.enter()` calls `renderCellObject()` which rebuilds the cell mesh. **Verify the selection + gizmo survive that re-render** so the radial stays anchored. If the gizmo drops, the entire secondary-radial design is dead and needs rework first. Test by entering sub-edit via the existing inspector entry and watching whether the radial stays up.
> - **GATE B (explode-for-groups, step 5):** must be fixed before the radial auto-calls `setExplode(true)`, or only the wall flies off and it looks broken.

1. **`window.renderSelection` (1.3).** Unblocks UI testing of the existing inspector flow. Verify: enter parts via inspector, click part → move rows appear in panel.
2. **FIX 1 click routing (1.1).** Verify via inspector entry (radial not needed yet): enter parts, click door → door selects, not the tile.
3. **Roof keying (1.2).** Verify: in sub-edit, click roof → selects; move/scale work.
4. **Recolor backing (2.G).** Verify: select a part, `recolorPart('#d24a4f')` via console → recolors and persists across re-render; trim of neighbouring objects unaffected.
5. **Explode-for-groups fix (GATE B / landmine).** `captureExplodeParts` (44:264-273) currently pushes only `isMesh && partKey`; windows/doors carry partKey on groups created at origin `(0,0,0)` with absolute child coords — so capturing `group.position` records `(0,0,0)` and `base*k` leaves them put. Fix: capture nodes with `userData.partKey` (don't descend into a captured part) and derive each part's base center from its **children's bounding-box centroid in house-local space**, not `group.position`. Verify: explode separates windows/doors/roof, not just the wall.
6. **GATE A verify**, then **Radial Edit item + nested levels (2.A-F, I).** Verify full flow: select cottage → radial → Edit → auto-explode → tap part → Move/Scale/Recolor enable → each operates and persists.
7. **Remove buried inspector tab flow (2.H).** Only now. Flag dead code, confirm no other dispatch.
8. **Generalize to other house types (section 3).** Separate phase, factory by factory, verify each.

---

## 5. Risks / regressions to watch

- **main auto-pushes to Netlify prod** (CodeSurf): every step touches the prod path — verify live in the real app before each commit; never claim working from synthetic events/console alone (per user memory).
- **GATE A is a coin-flip** from static analysis: if `enter()`→`renderCellObject()` drops the gizmo, the radial vanishes mid-flow. Verify before building nested levels.
- **Explode no-op (step 5) blocks the radial as specced** — the radial auto-explodes on Edit; without the group fix the result looks broken.
- **Recolor material poisoning:** `voxelBuildMaterial` returns a **shared cached** instance — the clone in step 4 is mandatory, and `trimBase` (399) must keep pointing at the original `mat`, or the first recolored voxel tints the decorative trim frame on every object.
- **Click empty space / non-part while in sub-edit** falls through FIX 1 → `resolveIslandClick` → cell reselect, which may visually pop out of part context. Verify desired behavior (deselect part vs stay) — non-blocking.
- **`selectedInfo()` returns `{partKey}` only** — if a radial label needs more (e.g. current swatch color), extend it in file 44.
- **Window-sink (1.4) is already fixed** — do NOT apply the stale audit edits; they don't match HEAD and would churn cleaner committed code.
- **Composite/square/manor part overrides** silently don't apply today (section 3) — out of scope for pass 1, but call out so users aren't surprised non-cottage parts don't edit yet.

**Files touched:** `20-input-place-erase.js` (FIX 1), `44-sub-object-edit.js` (remove listener, recolorPart, explode-groups), `09b-voxel-build-factories.js` (roof keying, recolor apply), `28-generate-panel-agent.js` (renderSelection on window, remove buried rows), `33-radial-menu.js` (Edit item + nested levels), `04-textures.js` (col allowlist + isIdentity), `engine/i18n/en.js` + fr/zh/es (radial.edit keys). No change to `18-scene-pick-xr.js` (`resolveRaycastCell`), `14-editable-islands-moorings.js`, `17-tile-renderers.js`, or `voxelWindow`/`voxelDoor` geometry.