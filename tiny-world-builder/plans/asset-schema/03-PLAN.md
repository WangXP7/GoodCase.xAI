# PLAN — tinyworld-asset/1 delivery phases

No man-day estimates. Phases are independently shippable, each behind an admin-gated
feature flag, and no phase changes how existing v4 worlds render. Drafted by the opus
phase-planner from the full audit (01-REVIEW.md), reviewed and adopted by fable.

## Orchestration / staffing model

- **fable** — architecture gates: reviews each phase's design before build, resolves the
  freeze-vs-generator decision per asset class, owns the sanitizer contract.
- **opus** — expands each phase below into a detailed execution plan (file-level specs,
  code citations) when that phase starts; re-asserts the cross-phase invariants.
- **sonnet** — implementation: refactors, renderer work, migration logic, wiring.
- **haiku** — mechanical grunt work, looped until done: enum dedupe, prop-bag → JSON
  conversion, stamp flattening, table extraction, rulebook drafting.
- Each phase runs as its own subagent loop: opus plan → sonnet build (worktree) →
  adversarial review → fix loop → fable gate. Same production-line pattern already used
  in plans/production-line/.

# tinyworld-asset/1 — Phase Delivery Plan

## Sequencing rationale
The schema is delivered contract-first, then renderer, then persistence/migration, then edit/lock, then AI, then breadth+animation. Each phase is shippable behind the `00b-feature-flags.js` gate (admin-only until proven), and **no phase changes how existing v4 worlds render** — new schema is always additive (a new `kind` form / new optional field), never a rewrite of the v4 cell tuple. The voxel-build stamp system is the seed because `customParts[]` is already a generic primitive-slot array that round-trips through localStorage/cloud/import today.

## Invariants that hold across every phase (opus must re-assert per phase)
- **DB IS THE SOURCE OF TRUTH; localStorage is a cache, never a store** (owner directive,
  2026-07-04). Two authoritative surfaces must agree on shape: Postgres (via
  `/api/assets`, `/api/worlds`, `/api/preferences`, `/api/builds`) and the multiplayer
  wire (`buildWorldStateObject`/`captureEnvState` over PartyKit). localStorage holds only
  the `asset-store` cache mirror (instant boot + offline write queue, server wins
  conflicts) and is never read as truth. A schema field that isn't on DB + wire is a
  replication bug. Guests without auth get in-memory state + a sign-in prompt, not
  silent LS persistence.
- **CI governance is real and unmentioned by the audits**: `tools/check.js` enforces no-duplicate-global-decls (no bundler; files load by numeric filename order) and byte-identical embedded-schema-vs-file. Every phase that touches schema shape adds/updates an invariant here or it ships broken.
- **The app serves built `dist/`, not source**: `publish.sh` must copy any new schema/manifest file verbatim or it silently doesn't ship.
- **Perf budget is already tight and measured** (render-bound; -70% draws from terrain bake). Any generic/indirection-driven render path competes with an already-optimized budget; per-instance recolor already defeats InstancedMesh batching by design.

## Explicit non-goals (schema *configures*, does not *replace*)
Procedural terrain heightfield formulas, procedural canvas textures, GLSL shader source, and GLB model internals stay as code referenced by string/id. The schema selects and parameterizes these generators; it does not serialize their output geometry.

---

## Phase 0 — DB-first persistence backbone (NO LOCALSTORAGE doctrine)

> STATUS 2026-07-04 — first slice LANDED (working tree, not committed):
> per-row `user_assets` table + `/api/assets` row CRUD (blob paths untouched;
> migration `netlify/database/migrations/20260704120000_user_assets.sql`);
> `engine/world/00c-asset-store.js` choke point (cache mirror + persistent dirty
> queue + debounced flush + online/retry loops, server-wins revalidation) behind
> the admin-gated `dbAssets` flag; custom voxel stamps mirrored per-row from 08;
> CI ratchet live in `tools/check.js` + `tools/localstorage-baseline.json`
> (211 grandfathered writes / 31 files — new LS writes fail `npm run check`).
> STATUS 2026-07-04 (second pass) — Phase 0 code-complete except live verify:
> blob→row backfill (lazy, once, only into an empty user_assets set — see
> backfillAssetRowsFromBlob in assets.mjs); stamp hydration from rows at sign-in
> bootstrap (08 twHydrateStampsFromAssetRows via TWAssetStore.fetchFresh, the
> new awaitable network-first read in 00c); `tinyworld:v1` finding RESOLVED —
> an always-on live-slot sync already existed (30:5095-5262, since fb8fbfb);
> the real gap was a tab-close race, now closed by flushActiveSnapshotOnHide
> (sync slot write before best-effort cloud push). Audit violations: 3-10 +
> meshTerrain:prefs resolved via PREF_SYNC_KEYS; home-grid keys downgraded
> (bootstrap cache / write-only inert). OPEN: (a) live DB round-trip acceptance
> test (netlify dev + Neon + signed-in, dbAssets flag on); (b) meshTerrain:v2
> sculpt design (~100KB blob) needs a design decision — world-state field w/
> version bump vs dedicated endpoint — schema-phase work, do not hack into
> prefs (server drops values >100k chars); (c) dist build (publish.sh) when
> the owner says ship.
**Goal:** Invert the persistence model before any schema work lands on top of it. Today
the client treats localStorage as truth and mirrors a whole-library JSON blob to Postgres
(`asset_libraries` via `/api/assets` — one row per profile, last-write-wins, 20MB cap).
After this phase: Postgres is truth, localStorage is a write-through cache, and every
localStorage write in the engine goes through one audited module.

**Scope:**
- **`asset-store` client module** (new engine file, early load-order slot): the single
  choke point for durable state. API: `get(key)` (serve cache, revalidate by
  `updatedAt`), `put(key, data)` (optimistic local + queued PUT), offline dirty queue
  with replay on reconnect/auth, server-wins conflict rule. All 205 existing
  `localStorage.setItem`/`twSafeSetItem` call sites across 27 engine files migrate to it
  or are classified as legitimate cache (session UI state) in an explicit allowlist.
- **`tools/check.js` invariant**: `localStorage.setItem`/`twSafeSetItem` outside the
  cache module + allowlist fails CI. This is what makes the doctrine permanent.
- **DB shape — per-asset rows**: new `assets` table (`id, profile_id, format, class,
  name, data jsonb, version, visibility, created_at, updated_at`), evolving
  `netlify/functions/assets.mjs` from the whole-library blob to row CRUD (keep the blob
  GET as a legacy shim during migration; one-time server-side split of existing
  `asset_libraries` blobs into rows). Per-row is what enables sharing, versioning, a
  public gallery, and conflict-free concurrent sessions.
- **Route existing local-only state to existing endpoints**: home-board autosave
  (`STORAGE_VERSION` world blob) → debounced `/api/worlds` PUT; RENDER_LS environment/
  render settings → `/api/preferences`; custom stamps → per-row `/api/assets`. Verify
  each endpoint's current shape before wiring (preferences/worlds exist; shapes
  unaudited).
- **Guest policy**: unauthenticated users keep in-memory state only; durable-save
  attempts surface the sign-in prompt. No new anonymous LS stores.

**Exit criteria:** CI fails on any un-allowlisted localStorage write; a custom stamp
created in one browser appears in a second browser after sign-in with no manual sync;
kill-network mid-edit → edits replay on reconnect; existing `asset_libraries` blobs are
readable as rows; zero rendered-pixel change.

**Risks:** the offline queue is the hard part (replay ordering, auth expiry mid-queue);
migration of 205 write sites is wide but mechanical; `sameOriginWriteGuard` and the
20MB blob cap need per-row equivalents (per-asset size cap ~1MB); watch Neon row/write
pricing under debounced autosave — batch world PUTs, don't write per keystroke.

**Staffing:** *Sonnet* — asset-store module, queue/conflict logic, assets.mjs row
migration, endpoint wiring. *Haiku* — looped migration of the 205 call sites to
asset-store (mechanical, verifiable per-file), allowlist classification, CI invariant.

---

## Phase 1 — Schema contract + governance backbone
**Goal:** Ship the `tinyworld-asset/1` JSON Schema as a data document plus its defensive sanitizer, wired into CI, with zero runtime/visual change. The format can round-trip through all three persistence surfaces as an inert validated blob.

**Scope:**
- New engine module (namespace-collision-free, load-ordered **before** `05-tile-factory.js` and `29-persistence-api.js`) holding the embedded schema + `world.asset.schema.json` file.
- Sanitizer modeled on `pet-schema.js` `sanitizePet()` (clamp/drop, never throw) as the *runtime* gate; the JSON Schema doc is documentation + AI `input_schema` only.
- `tools/check.js`: add byte-identical embedded-vs-file invariant (mirror the existing `WORLD_SCHEMA` ↔ `world.schema.json` check at check.js:316) and a namespace-collision check for the new global.
- New feature flag in `00b-feature-flags.js` (`assetSchemaV1`, admin-gated).
- Reconcile the genuinely-drifted vocabularies into one source of truth: `validateWorld`'s `okKind`/`okBuildingType`/`okFenceSide` sets (26:386-388) and the AI system-prompt prose (26:118-186). **Do not** re-touch `WORLD_SCHEMA` ↔ `world.schema.json` — those are already CI-guaranteed identical (gap analysis confirmed).

**Exit criteria:** schema doc + sanitizer land; CI fails on drift; a hand-authored `tinyworld-asset/1` blob validates, sanitizes, and survives a DB→cache→multiplayer-wire round-trip through the Phase 0 asset-store; no rendered pixel changes; flag off by default.

**Risks:** doc/sanitizer drift (the exact `pet-schema.js` _dy-clamp-vs-doc bug) — mitigate by making the sanitizer the sole gate and the doc generated/checked against it. Picking a load-order slot that a later consumer violates. Vocabulary reconciliation silently changing what the AI validator accepts.

**Staffing:** *Sonnet* — schema shape design, sanitizer, CI invariant wiring, load-order placement. *Haiku* — mechanically dedupe the drifted enum lists into the single source; generate the schema-doc-from-embedded-object.

---

## Phase 2 — Unified data-driven renderer (voxel-build seed)
**Goal:** One render path for schema assets with build/edit/lock modes, built by generalizing the existing stamp renderer. Existing built-in and custom stamps render pixel-identically; new `tinyworld-asset/1` assets render through the same two functions.

**Scope:**
- `08-voxel-stamp-renderer.js`, `09b-voxel-build-factories.js`: unify the two disjoint palettes (closure-local `C{}` and `VOXEL_PART_COLORS`) into one named table referenced by key; make palette-swap **role** a declared per-part field (replacing the `voxelAppearanceRoleForMaterial/Color` regex/RGB heuristic at 09b:88-115, with heuristic kept as fallback); unify `voxels[]` and `customParts[]` (treat a voxel as a degenerate 1×1×1 box part) so `makeVoxelBuildStamp`'s mutually-exclusive dispatch (09b:437-441) becomes one path.
- Adopt the existing `opts.editable` (un-batched, `partKey`-tagged) vs `optimizeVoxelObjectGroup` (InstancedMesh) duality **as** the build/edit-vs-lock render duality — this is the strongest existing precedent; generalize it to schema parts rather than inventing.
- Keep the ops format `[x,y,z,sx,sy,sz,color,noise]` and the box→Map→InstancedMesh pipeline (voxel-pet contract) as the low-level target — it is asset-agnostic and the strongest lift-verbatim candidate.

**Exit criteria:** all 14 built-ins + existing custom stamps render byte-identical to today (visual regression check); a new schema asset renders in both edit (addressable parts) and locked (batched) mode; draw-call count for a locked schema asset matches or beats the equivalent legacy stamp.

**Risks:** unifying voxels+customParts is a real refactor of every caller/import path assuming exactly one array. Per-instance recolor forking a cached material permanently breaks batching (already an accepted tradeoff — do not regress it further). Role-field migration must keep the heuristic fallback or silently break existing custom stamps.

**Staffing:** *Sonnet* — the voxels/customParts unification, palette unification, role-as-field with fallback, render-mode generalization. *Haiku* — none substantial (this is judgment-heavy refactor).

---

## Phase 3 — v4 migration + cross-surface persistence
**Goal:** Every existing saved/exported/AI-generated/multiplayer world keeps loading unchanged, while new schema assets persist and replicate across all three surfaces. Built-in content is baked to JSON so the schema dogfoods itself.

**Scope:**
- `29-persistence-api.js`: `applyState`/`buildWorldStateObject` read v4 cells + `appearance` untouched; schema assets ride as a new `kind` form or new registry alongside `voxelBuildId`/`customParts` (which already coexist via `materializeCustomPartCells`, 29:217-251). Extend the bespoke-IIFE migration pattern (29:14-81) with one additive, non-destructive v4→v4+asset shim — **no** wipe.
- Retire the three independently-versioned localStorage migration philosophies (`STORAGE_VERSION` per-break IIFE, `RENDER_SETTINGS_VERSION` bump-and-wipe, stamp key-suffix): after Phase 0 these keys are cache mirrors, so versioning collapses to a single cache-schema version on the asset-store (stale cache = drop and refetch from DB — a wipe is now free). The DB rows carry the real `version` column; server-side migration replaces client IIFEs for new formats. The bespoke v4 IIFE chain (29:14-81) stays intact for reading old exports/`?world=` URLs.
- Multiplayer: confirm/implement that schema assets referenced by id are actually replicated to peers who lack them locally (the stamp-registry-replication gap) — `38-multiplayer-partykit.js`, `47-worlds-room.js`, `party/index.js`, and server consumers `netlify/functions/lib/worlds.mjs`.
- `publish.sh` / `stamp-manifest.json`: add the new schema/manifest to the copied-verbatim list.
- **Bake the 14 built-in stamps to frozen `tinyworld-asset/1` JSON** using the recording-box flatten technique (voxel-pet.html:938-963 precedent). Lossy (loses re-parameterization) — accept, since the recipe stays available in source for regeneration.

**Exit criteria:** a corpus of existing v4 worlds (including `default_island.json`) loads with zero visual diff; a schema asset authored locally appears for a peer who never had it; server tile/pricing counts still derive correctly; `dist/` ships the manifest.

**Risks:** the FLAT_REQUIRED-list drift (29:23-26 vs 29:422-426) is a live example of exactly the migration-copy divergence this phase must not repeat. Server-side blast radius into pricing/anti-cheat (`worlds.mjs`, `party/index.js` enum mirrors). Bake losing procedural variety silently.

**Staffing:** *Sonnet* — `applyState` migration logic, cross-surface reconciliation, peer replication. *Haiku* — the 14-stamp recording-box flatten to JSON; mechanical audit/dedupe of the two FLAT_REQUIRED copies.

---

## Phase 4 — Build/edit/lock editing semantics
**Goal:** A user can build, edit, and lock a schema asset; edits round-trip through persistence and undo; locked assets are gameplay-safe with a consistent cross-subsystem definition.

**Scope:**
- Wire `44-sub-object-edit.js` (picking/UI behind the parts/slots editing) and `06-history-object-factories.js` (snapshot/diff on `serializeCell`/`STORAGE_VERSION`) to the schema.
- Lift `pet-op-edit.js` transforms verbatim: `translateOps`, `scaleOpsAboutCenter`, `rotateOpQuarterTurn` (note: 90°-only — free rotation is out of scope, would break the axis-aligned voxel invariant). Add `opRefFromPath`/`pathOfOpRef` for undo/diff addressing.
- Give per-instance sculpt overrides **stable part-ids** instead of the `'v:x,y,z'` coordinate-string key (09b:469) that silently orphans overrides when a stamp's baked voxel list changes.
- Define `locked` as a first-class schema field (world/island/cell-level — an opus design decision) and thread enforcement through `applyState`/`setCell`. Reconcile with the four different existing "edit mode" concepts (voxel-build `opts.editable`, world-model's unrelated `userEdited` provenance flag, mesh-terrain's separate sculptor state, environment's slider-open state).

**Exit criteria:** build→edit→lock→save→reload preserves edits exactly; undo/redo works across schema edits; a locked asset rejects edits consistently regardless of subsystem; renumbering a base stamp no longer orphans saved overrides.

**Risks:** the merged-mesh addressability trap — a locked/baked asset cannot be re-picked for editing unless the pre-merge instance list is retained (trading back the draw-call win). `rotateOps` 90°-only limitation surfacing as a user-facing constraint. Lock semantics must not break any of the four existing mode conventions.

**Staffing:** *Sonnet* — lock semantics threading, part-id stabilization, sub-object-edit/history wiring. *Haiku* — mechanically port the `pet-op-edit.js` transforms and path helpers.

---

## Phase 5 — AI builders
**Goal:** AI can author and patch schema assets via the patch-diff-and-merge protocol, feeding the schema as tool `input_schema`.

**Scope:**
- Lift the `pet-builder-ai.js` patch contract (single-JSON-diff merged via `mergeGeneratedPatch`) and the prompt-enhancement-summary pattern (`buildPromptEnhancementSummary` — embed a compact map of what each palette key currently paints).
- Wire into existing AI world-gen (`26-ai-generation.js`); the schema doubles as the Anthropic tool `input_schema` (26:558 precedent).
- Per-asset-type prose rulebook (the character-specific slot-bounds/region-mapping prose must be rewritten per asset class — this does not generalize).
- Close the AI feedback gap: the sanitizer silently clamps/drops out-of-bounds AI output today with no signal back to the model — add a clamp-report so the AI learns its output was constrained.

**Exit criteria:** "paint the barn red" (recolor), "add a chimney" (new layer), "widen the barn" (proportions) each produce a valid, sanitized, rendered patch; clamped outputs are reported back; generated assets persist and replicate.

**Risks:** the rulebook is unenforced prose with no machine-checkable link to bounds — scales worse as asset-type count grows (each new class needs its own detailed rulebook). Prompt length already large.

**Staffing:** *Sonnet* — patch-merge wiring, sanitizer clamp-report feedback loop, `26-ai-generation.js` integration. *Haiku* — draft the per-asset prose rulebooks from the reconciled vocabulary + schema.

---

## Phase 6 — Broaden asset classes + animation pillar
**Goal:** Extend the schema beyond stamps to buildings, foliage, and at least one animated class, and add the keyframe animation pillar by reusing existing engine precedents (not building from scratch).

**Scope:**
- **Correct the audit blind spot:** animation precedent already exists in-engine — `70-animal-anim.js` (procedural joint-pose phase machine) and `53-voxel-avatar.js` (walk/jump/crouch/skydive states). Reuse the voxel-pet `sampleAnim()` technique (flatten procedural `fn(t)` to keyframe data) to converge these onto one serializable clip format (`{dur, frames:[[t,pose]], fx}`) — this is the resolution to the repeated (narrowly-true, broadly-misleading) "no animation exists" claim.
- Per-asset-type socket/slot declarations moved into the asset definition (a tree and a house don't share the humanoid rig) — the main generalization of the voxel-pet fixed-11-slot topology.
- Buildings: characterize and adapt `07-house-primitives.js` (plan-based assembler — the most common placed object, never actually opened by the audits). Foliage: species catalog from `57-poser-surface.js` `treeVox` recipes + the ready `cropKinds` palette. Environment TOD curve (`todProfile`/`bgColorForTod` ANCHORS) unified into one keyframe curve, de-duplicating the three drifted "is it night" implementations.
- Materials/textures registry externalization: `03`/`04` `M` prop-bags → JSON palette; procedural textures/shaders stay code referenced by string id (shader-registry indirection).

**Exit criteria:** buildings + foliage + one animated class (animal or avatar-adjacent) authorable as schema assets; one canonical TOD keyframe curve drives sun/hemi/star-vault with no drift; material palette externalized without regressing the cache-cap/batching perf budget.

**Risks:** the frozen-snapshot-vs-regenerative tension recurs here worst (house plans, species recipes, TOD curve) — flattening loses re-parameterization; opus must decide per class whether to freeze or keep as parameterized generator. Material-variant cache caps (1024/64/256, evict-never-dispose) can be blown by a schema generating more distinct variants than the UI ever did. Two foliage draw-call strategies (poser bake-to-one-mesh vs ghost-board one-mesh-per-object) must be reconciled under "one pipeline."

**Staffing:** *Sonnet* — clip-format convergence via `sampleAnim`, per-asset socket generalization, house/foliage adaptation, TOD-curve de-duplication. *Haiku* — `M` prop-bags → JSON palette conversion; mechanical extraction of species recipes and magic-number density/weight constants into data tables; convert if/else lookup chains (`mapLabObject`, `terrainVoxelMaterials`, `SIMPLE_OBJECT_FACTORIES`) to data tables.

---

## Deferred / out of scope for this arc (flag to owner)
GLB/model-stamp internals (`09` GLB paths, `43-drag-drop-import.js`) — referenced by id, not serialized. Terrain heightfield generation and the monolith-vs-mixin duplication (known accepted tradeoff per `tinyworld-landscape-engine-mixins.md`, not a fresh blocker). Vehicles/flight/combat/shield (~6000 lines, heavily tuned) — a separate asset arc. Economy data path (`cellEconomy` behind the ECONOMY LAUNCH GATE). i18n of schema-surfaced asset names/labels (route through the `tinyworld-i18n` pipeline when UI lands).