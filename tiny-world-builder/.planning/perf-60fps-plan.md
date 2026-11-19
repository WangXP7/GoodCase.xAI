# TinyWorld 60fps Optimization Plan

## APPLIED (2026-06-03) — verified in live app, committed (not pushed)
Measured default-farm deltas (headless Chromium — absolute fps is software-GPU/fill-bound
and NOT representative; draw-call + frustum-cull numbers are structural/device-agnostic):
**draw calls 2880 → 1673 (−42%)**, frustum-cull-disabled **1360 → 61 (−96%)**, programs flat,
propellers spinning, 0 console errors, `npm test`/build/diff-check clean.

Shipped:
- **Row 1+2 (engines)** — merged the ~282-cube lift-engine static body per material (282→~7
  meshes/engine) + dropped engine shadow casting. Engine meshes 1308 → 208. This is the −42%
  draw-call win. (`09b makeVoxelLiftEngine`)
- **Row 4** — scoped `prepareHomeBorderForRender`'s frustum-cull-disable to skip engine
  subtrees → fc-disabled 1360 → 61. (`13 prepareHomeBorderForRender`)
- **Row 3** — group-cull the distant-worlds ring. SAFE but low-yield: at the default steep-iso
  framing (fov 28, polar 54°) the ring is genuinely in view, so the cull correctly does NOT
  fire there; it fires only on tight zoom-in. (`01 updateSceneVisibilityForCamera`)
- **Row 14** — star-vault tessellation 64×32 → 32×16 (−~3k resident tris). (`39`)
- **Row 6+7** — reuse normalized appearance + gate the per-voxel partKey string in the
  voxel-build build loop (build-path GC; tightens the slice 1-6 sub-object code). (`09b`)
- **Row 12** — soft-cap `customMaterialCache` at 1024 to bound long-session memory. (`04`)

Corrected by measurement (the workflow's code-read was wrong/overstated):
- **Row 1 shadow premise** — engines were NOT actually casting shadows at runtime (shadowCasters
  unchanged when toggled); ENG-2's "1308 shadow draws" was a code-read that missed a runtime
  override. The change is harmless/defensive but yields no shadow win.

Deferred (deliberately NOT applied):
- **Row 13 (DPR clamp)** — disables 105–150% supersampling on retina; a quality/perf UX tradeoff
  the plan flagged "apply consciously" — owner decision, not a silent auto-apply.
- **Rows 8–11 (per-frame micro-GC)** — the frame profile shows all JS ticks <0.2ms (render-bound,
  not JS-bound), so these add hot-path/prod risk for no measurable frame gain. Skipped per scope
  discipline.
- **Row 5 (small-prop shadows)** — small default-scene payoff (house 204 + tree 50 dominate
  casters; props are ~tens) + castReceive can't see kind at factory time. Low value; deferred.

Highest-value UNSHIPPED levers remain in §3 "Needs design" — especially **event-driven shadow
map** (skips a full shadow depth pass per idle frame; the scene is static most of the time) and
**opaque-pass ground tiles / cross-cell static merge** (attacks the ~1100 transparent tiles =
the fill-rate bottleneck). These genuinely move real-GPU frame time but are larger/riskier and
need their own design pass before touching auto-prod.

---



_Three.js r128 voxel world. Baseline metrics are camera- and mode-dependent (see §5). Engine-cluster draw-call arithmetic is de-duplicated below so totals stay coherent._

---

## 1. Headline diagnosis

The frame budget is dominated by **three root causes**, in order of cost:

### A. The four home-island lift engines are an unbatched, shadow-casting, never-LOD'd mesh bomb (~2,400 draw submissions from one object cluster)
Each lift engine is built as ~282–330 individual `THREE.Mesh` cubes. Four engines = ~1,128–1,320 meshes. They are excluded from every batcher (`canMergeStaticBaseMesh` rejects anything stamped `editableIslandEngineId`/`isEditableIslandEnginePropeller`, and `optimizeVoxelObjectGroup` never recurses into them), so they cost:
- **~1,092 color-pass draw calls** (the static body, unmerged).
- **~1,308 shadow-pass draw calls** (every cube gets `castShadow=true` via `castReceive`, even though the engines hang *below* the island where their shadows are occluded).
- **~1,360 frustum-cull-disabled meshes** — `prepareHomeBorderForRender` blanket-sets `frustumCulled=false` over the whole home border, so the engines submit even when their board corner is off-screen.

This single cluster accounts for the bulk of the 1308-island-engine-meshes line, a large fraction of the 2880 draw calls, and a large fraction of the 346 shadow casters.

### B. Ground tiles are forced into the transparent pass at full opacity (the 950 transparent-tile line)
`prepareFadeable` sets `keepFadeAtOpaque=true` on every tile, which skips `pickFadeMaterial`'s opaque fast-path. Even at `displayOpacity=1.0` each tile gets a **cloned material with `transparent=true`, `depthWrite=false`**. Consequence: ~950 ground tiles enter the per-frame back-to-front transparent sort, lose early-Z, and each holds a unique cloned material that blocks batching. This is a z-fighting workaround for coplanar same-material tile-top overlap (`TILE*1.04` oversize + `seamOverlap`), not a fade requirement — so it's removable, but only paired with a geometry de-overlap fix.

### C. Batching coverage stops at the per-cell boundary, and culling/shadow work is done unconditionally
- World tiles are never merged across cells (`worldGroup` children stay independent), so every cell re-emits its own terrain-top, surface-detail, and cap-bevel draw calls.
- The shadow map re-renders **all casters every frame** (`shadowMap.autoUpdate` left at default `true`, no dirty-flagging) even on a static idle view — wasteful since the scene is overwhelmingly static.
- Distant decorative mini-worlds are merged into scene-spanning meshes whose AABBs straddle ±39 world units, so they can **never** be frustum-culled and submit ~7k tris + ~18 draws every frame even when off-screen at default home framing.

---

## 2. Apply now (safe, high-yield)

All rows are `safeToApplyNow: true`, low/medium risk, ordered by **impact ÷ risk**. Overlapping engine findings are de-duplicated: ENG-2 owns the shadow pass, ENG-1 owns the color pass (and absorbs fc-2), fc-1 is cheap insurance whose value mostly collapses once ENG-1 ships.

| # | Change | File : function | Expected metric delta | Risk |
|---|--------|-----------------|------------------------|------|
| 1 | **Disable engine shadow casting.** After `castReceive(root)`, traverse engine root and set `castShadow=false` on all meshes (leave `receiveShadow` intact). | `09b-voxel-build-factories.js:1223` : `makeVoxelLiftEngine` | **−~1,308 shadow-pass draw calls** in default home scene; ~−346 shadow casters traversed | low — only loses sub-texel engine self-shadowing; island-on-engine receive shadow preserved. Verify in real app. |
| 2 | **Merge engine static body in the factory** before `stampEditableIslandEngineMesh` runs (so `canMergeStaticBaseMesh` passes). Call `mergeStaticBaseMeshesByMaterial(body, …)`; leave the spinning `prop` group untouched. | `09b-voxel-build-factories.js:1078` : `makeVoxelLiftEngine` (this is the design-correct location fc-2 asked for; auto-covers rebuild-on-upgrade) | **−~1,092 color-pass draw calls** (282 body meshes → ~8 merged/material per engine ×4); stacks with row 1 on the shadow pass | low — picking still walks up to the engine root (`resolveRaycastEditableIslandEngine`), userData preserved |
| 3 | **Group-level frustum cull the distant-worlds group.** Add `setRenderCullVisible(distantWorldGroup, renderCullBoxVisible(±40 box), renderDistantWorlds)` to the per-frame cull loop. (Absorbs cull-02's distant-worlds half; under-cloud half is negligible — already InstancedMesh-culled.) | `01-render-core.js:1207` : `updateSceneVisibilityForCamera` | **−~7,000 triangles + −~18 draw calls** whenever camera frames the home board (the common case); doubled under pixel/AA post | low — mirrors existing editableIslands cull; pad AABB to placement extent |
| 4 | **Scope `prepareHomeBorderForRender`'s cull-disable to skip engine subtrees.** Inside the traverse, leave `frustumCulled` at default (`true`) for nodes with `editableIslandEngineId`/propeller/`voxel-lift-engine` ancestry; keep `false` for the board side/backing meshes. | `13-distant-dressing-ghost.js:362` : `prepareHomeBorderForRender` | **Up to −~1,300 draw calls at close zoom** *if applied alone*; **collapses to −tens** once row 2 ships. Cheap insurance — do it, but don't double-count. | low — parity with off-home engines (already render `frustumCulled=true`); raycasting unaffected |
| 5 | **Stop small ground-hugging props from casting shadows.** Add a no-cast kind set (tuft, flower, crop, carrot) checked **inside `castReceive`**, dropping only `castShadow` and **keeping `receiveShadow`**. Do NOT use the `userData.noShadow` headline (it also kills receive). Leave corn/sunflower/wheat/trees casting. | `04-textures.js:2269` : `castReceive` | **−shadow draws + tris per affected prop instance** (each plant is many unmerged meshes: tuft=5, carrot=36, wheat=18). World-mix dependent: tens of percent of casters in farm/vegetated worlds | low — ground-hugger shadows are negligible visual read; verify iso diorama |
| 6 | **Cache per-voxel `normalizeAppearance`.** Pass the pre-normalized `normApp` (already computed at `09b:362`) into `voxelAppearanceMaterial` instead of re-normalizing per voxel; add one `normalizeAppearance` call in `makeCustomPartsStamp` near `:310`. | `09b-voxel-build-factories.js:69` : `voxelAppearanceMaterial` (+ callers `:315`, `:389`) | **−~(N−1) regex/clamp/alloc passes per voxel-build per rebuild**; recurs on every pan-in (no mesh cache). Build-path GC, not per-frame FPS | low — identical pure-function call on identical input; null→{} case returns base unchanged |
| 7 | **Gate the per-voxel `partKey` string** on `opts.editable || hasParts` so the `'v:'+x+','+y+','+z` string + map lookup aren't built for every voxel of every non-editable render. **Gate on editable OR hasParts** (not editable alone — partKey is the override lookup key). | `09b-voxel-build-factories.js:381` : `makeVoxelBuildStamp` | **−~N short-string allocs + N empty-map lookups per build** when no overrides (the default). Build-path GC | low — preserves both partKey consumers |
| 8 | **Avoid per-frame array+Set churn in crowd actors.** Iterate `crowdLayer.people.values()` directly (skip `Array.from`); hoist `liveIds` to a module-scope Set and `.clear()` each frame. | `11-vehicle-crowd.js:911` : `updateCrowdModelActors` | **−1 crowd-sized array − 1 Set/frame** while model crowds active (zero in sprite mode) | low — no concurrent-modification hazard |
| 9 | **Numeric atmosphere bucket signature.** Replace the per-frame concatenated `toFixed` bucket string with primitive `!==` comparisons; preserve the `_atmoLastBucket=null` force-reapply sentinel. | `39-atmosphere-effects.js:272` : `updateStarlitAtmosphere` | **−~4–5 small string allocs/frame** (always-on, low yield) | low |
| 10 | **Iterate waterfall Set directly.** Drop the per-frame `Array.from(waterfallEffectMeshes)`; `for…of` with inline `.delete` is spec-safe. | `05-tile-factory.js:1100` : `updateWaterfallEffects` | **−1 array/frame** in waterfall worlds (minor) | low |
| 11 | **Scratch object for vehicle cell lookup.** Add module-scope scratch + `fillVehicleCell(out,x,z)` for the `tickVehicle` `:787`/`:858` path (consumed before reuse). Leave the allocating version for reroute/`:665`. | `10-world-data.js:278` : `vehicleCellFromWorld` | **−~16–40 small object allocs/frame** during Vehicle Demo only (micro-GC) | low |
| 12 | **Soft-cap `customMaterialCache`.** When `size > ~1024` (generous, above realistic peak — not 512), evict oldest insertion-order entries before `set()`. Optionally drop the dead `wear.toFixed(2)` key suffix. | `04-textures.js:1483` : material factories | **Bounds a steady-state memory climb** (~hundreds of orphaned Materials in long multiplayer sessions); not frame-time | low — value-keyed factory; evicted entries re-clone on demand. Pick cap above peak to avoid re-clone churn |
| 13 | **Clamp the resolution-slider DPR product** to `BASE_DPR_CAP` in `setRenderResolutionScale` + init, so retina users can't reach 3.0 effective DPR (4× the default fragments). | `01-render-core.js:606`, `:491` | **Caps a worst-case ~2.25× fragment blowup** for max-slider retina users; zero default-path change | low — UX caveat: 105–150% slider becomes a dead-zone on retina (silent loss of supersampling). Apply consciously. |
| 14 | **Reduce star-vault tessellation** 64×32 → 32×16 (~3,968 → ~1,000 tris). Equirect texture hides lower tessellation. | `39-atmosphere-effects.js:130` : star-vault build | **−~3,000 resident triangles** (trivial but free); shadow exclusion already satisfied | low — visual-by-design; do not remove the sphere |

**Excluded from apply-now despite looking cheap:** `gc-1` (its proposed Map key is collision-prone — `safeToApplyNow:false`; the minimal-half is safe but not worth promoting on its own).

---

## 3. Needs design (bigger structural levers)

| Item | What | Rough payoff | Why it needs design |
|------|------|--------------|---------------------|
| **Cross-cell chunked static-terrain merge** (BC-1 + BC-2 + BC-3 + BC-4 as **one** project) | After a region is built, group static tile sub-meshes (terrain tops, surface details, cap bevels) by `(geometry,material,flags)` across an N×N chunk and emit one InstancedMesh per bucket per chunk. | **Largest draw-call lever**: order hundreds fewer draws on a 64-cell board (terrain tops alone ~−230–300; details + bevels on top). | Breaks per-cell fade (`prepareFadeable`), drop-in animation, and incremental per-cell dispose/rebuild on edit. **Mode caveat: collapses to ~0 in landscape-mesh mode** (no per-cell tiles built) — confirm baseline mode first. |
| **Cross-cell object instancer** (BC-5) | Instance deterministic repeated models (same-level trees/rocks/fence segments) per `(geometry,material)` across a chunk instead of per-object `optimizeVoxelObjectGroup`. | ~−50–200 draws on densely dressed boards (savings concentrate on shared canopy/leaf/rock buckets, not per-cell-random trunks). | Breaks per-cell/per-part pick, erase, transform (`sub-object-edit` raycasts individual part meshes). Needs logical-record + rebuild-on-edit layer. |
| **Instance-aware bounds for batched voxel objects** (surfaced from fc-3's *verdict*, not its headline) | `09b:505` unconditionally forces `frustumCulled=false` on **every** `optimizeVoxelObjectGroup` InstancedMesh (trees, rocks, bridges, fences, crops, animals, shields, islands) because r128 InstancedMesh lacks instance methods. Compute correct instance-aware bounds, then enable culling. | Latent culling opportunity for all scattered/localized voxel objects scene-wide. | Enabling culling without instance-aware bounds pops instances when the origin-instance sphere leaves the frustum. **fc-3's headline wrongly calls 505 a harmless dead else — its own verdict corrected this. Do not bury it.** |
| **Event-driven shadow map** (shadow-autoupdate-event-driven) | Set `shadowMap.autoUpdate=false`, refresh `needsUpdate=true` only on real changes. Wire into the existing `markCameraMoving()` no-op stub. | **Eliminates one full-scene shadow depth pass per idle frame** — large on a static diorama view. | Must enumerate **all** dirty sources: camera move + drop anims + opacity/wipe transitions + island LOD swaps + ghost-board drains + vehicle/crowd presence + quality change. Miss one → shadows visibly desync. Plant sway is deliberately excluded (sub-texel). |
| **Opaque-pass ground tiles** (TT-1) | Return shared opaque base material for `fadeRole==='tile'` at `displayOpacity===1`, **paired** with a `makeTile` geometry de-overlap (remove `TILE*1.04` oversize + `seamOverlap`, or weld top+riser). | Moves opacity-1 home-grid tiles (≤400) out of the transparent sort, restores early-Z + base-material sharing. **Smaller than the headline** — outside-home/ghost tiles stay grayscale-cloned regardless. | **High correctness risk**: material change alone re-exposes the coplanar z-fighting the transparency was hiding. Requires on-GPU grazing-angle visual verification. |
| **Particle mesh pooling** (gc-2) | Per-effect free-lists for smoke/debris/pipe meshes; reset + reuse userData in place. | −~20–50 `THREE.Mesh` allocs/sec in houses+islands+low-camera scenes; reduces minor-GC spikes. | Reused meshes must fully reset life/position/scale/rotation/material (`_particleMatKey` early-return trap); shared smoke/dust array needs full userData overwrite. |
| **Per-blade propeller merge** (ENG-4) | Merge each blade's 11 cubes while keeping the blade `Group` as the visibility-toggle parent. | ~−32 draws/engine (~−128 default scene). | The naive `mergeStaticBaseMeshesByMaterial(blade)` is a **silent no-op** (propeller exclusion guard). Needs a dedicated per-blade merge that bypasses the guard without breaking spin/blur-disc swap. Secondary to ENG-1. |
| **Home-engine on-screen LOD gate** (ENG-3) | Coarse projected-size / `viewSize` gate (not target-distance) + spin gate for home engines in orthographic zoom-out overview. | **Mostly redundant** — home subtree is already frustum-culled when off-screen. Residual win only in on-screen-but-tiny overview. **Low priority; do ENG-1 first and re-measure.** | Home is the player's island, almost always centered; wrong thresholds pop the player's own engines. Wrong lever in finding (target stays at origin). |

---

## 4. Rejected / overstated

**Did not survive verification (don't implement):**
- **shadow-frustum-texel-density** — shadow-map raster cost is fixed by `mapSize` (1024²) regardless of frustum size; no draw-call/fill reduction. Frustum is already near-matched (or undersized) in the view-depth axis at default zoom; shrinking would clip shadows. Marginal visual-sharpness lever at best.
- **rp-skybubble-fullscreen-overdraw** — the proposed fix (`scene.background=null` when skyBubble visible) is **self-contradictory**: it trips the `visible=!!scene.background` gate (turning the gradient off) and disables distance-mist fog. The "redundant clear" is a near-free hardware `gl.clear`, not a second shaded pass. Real cost is one cheap fullscreen shader pass — low, not medium.
- **cull-03-home-border-underside-always-drawn** — premise assumes near-top-down framing, but `DEFAULT_POLAR = 54°` (steep iso) makes island sides/edge dressing **genuinely visible**; the edge debris is the rendered island edge, not occluded waste. Only the deep utility underside is occluded, and that benefit → 0 as the camera tilts. No post-processing fragment doubling on occluded geometry.
- **BC-3 (cap-bevel)** — overstated 5×: in the default config (voxel terrain on), bevels render **only** on flat level-1 simple-grass tiles at exposed boundaries (~dozens of draws on a fresh board, not 150–400). The 150–400 figure assumes voxel terrain disabled. Per-tile instancing recovers ~nothing (3 distinct geometries each bucket below `minInstances=2`). Real savings only via the BC-1 chunk merger.
- **rp-antialias-true-wasted-under-post** / **rp-non-integer-pixelsize-targets** — post-gated only (pixelation/AA off by default); zero default-baseline impact. Theoretical until a structural redesign.

**Confirmed clean — no action needed (these are confirmations, NOT rejections):**
- **MP-2** — materials/shader programs already near-optimally deduped; 18 programs for 260 materials is the `onBeforeCompile.toString()` program-cache collapse working as designed.
- **rp-verdict-already-optimized** — default render path is single-pass, zero render targets, post off by default.
- **rp-pixelratio-clamped** — pixelRatio already capped (1.5/2.0) and scaled 0.75; ~44% fewer fragments than unclamped 2.0 already realized.
- **gc-7** (placeable-light pool gated behind TOD bucket), **REG-00** (no structural regression in default material/appearance paths), **REG-39-inspector-light-idle** (inspectorV2 off by default), **REG-44-subedit-idle** (sub-edit listeners gated) — all verified idle in default play.

---

## 5. Measurement plan

**Before measuring anything, pin the experiment:**
1. **Establish baseline mode.** Confirm whether the 2880 draws / 950 transparent tiles were captured in **classic voxel-tile mode** (default) or **landscape-mesh mode**. BC-1/BC-2/BC-4 collapse to ~0 in landscape mode. Record the mode in every measurement.
2. **Fix a camera pose + fixed world.** fc-1 (close zoom), cull-01 (home framing), small-prop shadows (world mix), ENG-3 (overview) only fire under specific conditions. Use one deterministic pose framing the home board, plus one zoomed-in pose for fc-1/fc-4.
3. **Toggle one change at a time**, re-measure, attribute the delta.

**Metrics to capture each run** (via `renderer.info` + a scene-traversal probe):

| Metric | Source | Baseline | Target after apply-now (rows 1–5) |
|--------|--------|----------|-----------------------------------|
| `drawCalls` | `renderer.info.render.calls` | ~2,880 | **−~1,092** (ENG-1) **−~18** (cull-01) → ~1,770; further −tens to −1,300 from fc-1 at close zoom |
| `triangles` | `renderer.info.render.triangles` | (record) | **−~7,000** (cull-01 at home framing) **−~3,000 resident** (star-vault) |
| `transparentHits` | scene traverse: count meshes with `material.transparent===true` | ~950 (tiles) | unchanged by apply-now (TT-1 is needs-design); target **≤~400 home tiles** after TT-1 ships |
| `frustumCullDisabled` | scene traverse: count `mesh.frustumCulled===false` | ~1,360 | **−~1,300** after fc-1 (engines back to default `true`) → ~60 (board side/backing only) |
| `shadowCasters` | scene traverse: count `mesh.castShadow===true` | ~346 | **−engine meshes** (ENG-2) and **−small-prop meshes** (row 5); re-count after each |
| `programs` | `renderer.info.programs.length` | ~18 | confirm **flat** (MP-1 must not increase it; MP-2 says it shouldn't) |
| frame time avg / worst | rAF timing | 59.5 / 75.8 (cited, unverified) | confirm worst-frame spread narrows after GC rows 6–11 + shadow rows |

**Per-change verification gates:**
- **ENG-1**: re-count `drawCalls`; click-pick each of the 4 engines to confirm `editableIslandEngineId` raycast still resolves; trigger an engine upgrade to confirm the merge re-runs (built inside `makeVoxelLiftEngine`).
- **ENG-2 + row 5**: visually confirm in the real app that island underside doesn't lose engine shadows and small-prop ground reads acceptably at default iso.
- **cull-01**: pan so distant worlds leave/enter frame; confirm they hide/reappear without popping (AABB padded to ±40).
- **fc-1**: zoom into board center; confirm `frustumCullDisabled` drops and no engine popping at corners.
- **GC rows 6–11**: heap-allocation profile over a fixed 10s pan/place loop; confirm alloc-rate drop with no visual/behavioral change.
- **needs-design items**: each requires its own on-GPU grazing-angle visual pass (TT-1 especially) before merge.
