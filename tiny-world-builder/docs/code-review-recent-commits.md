# Tiny World Builder — Recent-Commits Review

This is an advisory review of the five most recent commits on `main`: `52c50c7` (lights, garden fences, star-vault & shield), `2f0261f` (PartyKit multiplayer shared-building), `5a0528c` (Netlify cloud sync + import), `dd42a54` (render hot-path optimization), and `f8d5028` (voxel-seams + flight prop fixes). The in-progress i18n layer in the working tree is **out of scope** and not reviewed. Findings are grouped by dimension, ranked within each, and every claim cites `file:line` verified against the real source. Nothing here is implemented — this is a punch list.

The headline picture: the new server-side surfaces (PartyKit room, Netlify functions) ship with **no trust boundary on remote/peer input**, which is where the two highest-severity items live. The client-side cloud-sync and multiplayer-broadcast paths each have a real data-loss bug. The new shield/atmosphere feature work introduced some unconditional per-frame work that the `dd42a54` optimization pass would have caught had it covered these files. Refactor opportunities are mostly low-risk file splits plus one genuinely valuable missing CI guard.

## Severity tally

| Severity | Security | Correctness | Performance | Refactor | Total |
|----------|:--------:|:-----------:|:-----------:|:--------:|:-----:|
| High     | 1        | 2           | 0           | 0        | 3     |
| Medium   | 1        | 0           | 1           | 1        | 3     |
| Low      | 5        | 1           | 4           | 4        | 14    |
| **Total**| **7**    | **3**       | **5**       | **5**    | **20**|

Severities shown are the verification-corrected values. Several originally-higher findings were downgraded after the exploit path or hot-path was traced (noted inline and in the Rejected/Downgraded section).

---

## Security

Ranked high → low. Two new server surfaces dominate: the PartyKit room (`party/index.js`, no auth, broadcast-only) and the Netlify functions (`netlify/functions/*.mjs`, bearer/cookie auth). The `.mjs` and `party/index.js` files are legitimate Node modules — fixes there may use `import`/validation freely; they are the correct choke points.

### 1. Unbounded remote cell coordinates — one crafted message poisons every connected peer  · HIGH · `2f0261f`
**`engine/world/38-multiplayer-partykit.js:347-367` (client) + `party/index.js:70-84` (server `cleanCellSet`)**

The server's `cleanCellSet` rounds `x`/`z` to integers (`party/index.js:78-79`) but never range-checks them. The client's `applyRemoteCell` checks only `Number.isFinite(x)/Number.isFinite(z)` (`38-multiplayer-partykit.js:349-351`) before calling `setCell(x, z, {...op.cell, forceTile:true})` (line 356). `setCell → ensureWorldCell` does `if (!world[x]) world[x] = []` with no bounds guard, and `setCellImpl` writes `world[x][z]` unconditionally.

**Exploit path.** Attacker joins a shared room via the open `?party/?room/?collab` URL param (rooms have no auth; the link is meant to be shared). They send `{type:'cell.set', op:{x:9999999, z:9999999, cell:{terrain:'grass', userEdited:true, ...}}}`. `cleanCell` (`party/index.js:62-68`) does `JSON.parse(JSON.stringify(cell))`, which **preserves the attacker-supplied `userEdited` flag**, and re-broadcasts. On each peer, `setCellImpl` writes the off-grid cell (sparse `world[x][z]` growth); `userEdited:true` makes `shouldRenderCellMesh` true so `forceTile` adds a real THREE mesh to the scene, **and** `saveState` persists the off-grid cell to localStorage (the `!insideHome && !c.userEdited` skip no longer applies). With no server rate cap (finding 6), repeating across millions of coords is an unbounded memory/GPU/per-frame-matrix DoS plus persistent save poisoning on every peer.

**Fix.** Validate coordinate range in `cleanCellSet` (the single server choke point) — do **not** clamp to `0..GRID` (the schema supports sparse ghost-board cells outside the home grid; clamping breaks a real feature). Reject ops whose `|x|` or `|z|` exceeds a generous finite ghost-board bound (`return null` to drop). Add the same range check in `applyRemoteCell` as defense-in-depth (plain JS, one local `const`, no new globals).

### 2. No schema validation of remote cell content — peers inject arbitrary `kind`/`floors`/`voxelBuild`  · MEDIUM · `2f0261f`
**`party/index.js:62-68` (`cleanCell`) + `engine/world/38-multiplayer-partykit.js:347-367` (`applyRemoteCell`)**

`cleanCell` deep-clones and only patches `terrain`/`extras` defaults — it does **not** whitelist keys or validate `kind`/`buildingType`/`floors` against `world.schema.json` (kind enum at `world.schema.json:94`). The client spreads `op.cell` straight into `setCell`.

**Exploit path.** A peer broadcasts `cell: { kind:'house', buildingType:'skyscraper', floors: 1e7 }`. Server passes it verbatim; each peer's `setCellImpl` takes `newFloors = floors` with no clamp (`17-tile-renderers.js:504`) and stores it. On render, `bType === 'skyscraper'` → `makeSkyscraper(Math.max(floors, 4))` → `07-house-primitives.js:570` loops `for (i=0; i<f; i++)` with **no upper cap** (the `MAX_FLOORS=8` in `10-world-data.js:246` is not applied on this path), creating ~4 meshes per floor → OOM/freeze of every collaborator, persisted. This is data-integrity corruption, not RCE/XSS — remote strings only reach `fillText` (`makeNameSprite`, line 190) and `textContent` (`setStatus`, line 100), both safe sinks.

**Fix.** Replace the blanket deep-clone in `cleanCell` with an explicit field allowlist (terrain, kind, floors, terrainFloors, buildingType, fenceSide, extras, rotationY, offset*, appearance, waterFlow, voxelBuild), normalizing `terrain`/`kind` against the schema enums and clamping `floors`. Optionally mirror a light kind-enum check in `applyRemoteCell`.

### 3. No message-rate limit on the party server  · LOW · `2f0261f`
**`party/index.js:101-120` (`onMessage`), `:4` (`MESSAGE_LIMIT`)**

`onMessage` rebroadcasts every valid presence/cell.set message via `this.room.broadcast` with no per-connection rate limit. The only guard is `MESSAGE_LIMIT = 48*1024` on a single message's *length* (line 9), not its *rate*. The client's `~90ms schedulePresence` throttle (`38-multiplayer-partykit.js:151`) is client-side courtesy only — a hostile client opening a raw WebSocket ignores it. Verified downgrade from medium to **low**: the amplification matters but is gated by needing a connected room and pairs with finding 1 rather than standing alone.

**Fix.** Add a per-connection token-bucket / sliding-window in `onMessage` keyed on the stable `sender.id` (a few lines of `Map` state on the room instance); drop or disconnect past a sane ops/sec for presence and cell.set separately.

### 4. CORS `Access-Control-Allow-Origin` reflects any caller's Origin  · LOW · `5a0528c`
**`netlify/functions/lib/http.mjs:1-8`**

`corsHeaders` sets `'Access-Control-Allow-Origin': origin || '*'` from the caller's `Origin` header (line 3). **No `Access-Control-Allow-Credentials:true` is ever emitted** (verified: grep for allow-credentials across `netlify/` is empty) and auth is via a bearer `Authorization` header an attacker page cannot read from a victim's session, so **no cross-user data-theft path exists**. This is a defense-in-depth gap, not a live exploit.

**Fix.** Reflect the Origin only when it matches an allowlist (`process.env.URL` + localhost for dev); otherwise omit the header. Never combine reflected-origin with `Allow-Credentials:true`.

### 5. No per-user quota on builds/shares inserts (authenticated storage DoS)  · LOW · `5a0528c`
**`netlify/functions/builds.mjs:71-82` (POST), `netlify/functions/share.mjs:27-42,64-110`**

Each row is size-capped at ~2 MB (`builds.mjs:32`, `share.mjs:19`) and the LIST read is capped at 100 (`builds.mjs:67`), but there is **no cap on row count per profile**. `builds.mjs:76-80` INSERTs with no count check; `share.mjs` `createShare` only loops to dodge an id collision. The migrations define only FKs / size CHECKs / indexes — no row-count constraint. An authenticated user can grow the managed Postgres table without bound (~2 MB/row); excess rows are invisible in the UI but persist. Low because it requires a logged-in account.

**Fix.** `SELECT count(*) WHERE profile_id = ...` before INSERT and reject with 409/429 past a sane ceiling (a few hundred). Keep logic in the `.mjs` functions.

### 6. Bearer-token verify URL is built from `request.url` rather than trusted config  · LOW · `5a0528c`
**`netlify/functions/lib/auth.mjs:24-37`**

`userFromBearerToken` validates via `new URL('/.netlify/identity/user', request.url)` (line 28) — the verify host comes from request data. In standard Netlify Functions v2, `request.url` is platform-constructed from the deployed origin and is **not** taken from a raw client `Host`/`X-Forwarded-Host`, so no live exploit exists today (the finding concedes this). It is a fragile trust boundary: a validation target should never come from request data.

**Fix.** Resolve the identity base from `process.env.URL` (or the `@netlify/database/identity` context), mirroring `@netlify/identity`'s own `resolveIdentityUrl` preference, and reject if the resolved host is not the known site host.

### 7. Room join is unauthenticated (by-design link-sharing) — stated for completeness  · LOW · `2f0261f`
**`party/index.js:86-120` (no `onBeforeConnect`)**

`onConnect` sends the full peer list with no auth gate; `onMessage` accepts edits from any connection. Room membership = "knows the WebSocket URL". Verified mitigations that keep this **low**: room ids are the `/api/share` id, generated with `crypto.randomBytes(9).toString('base64url')` (~72 bits, `share.mjs:10`) and validated `^[a-zA-Z0-9_-]{8,40}$` (`share.mjs:14`) — unguessable, non-enumerable; and presence spoofing is blocked because the server overwrites `presence.id = sender.id` (line 109) and stamps `op.userId = sender.id` (line 117). Residual risk: anyone the link is forwarded to gets unrevocable edit rights.

**Fix.** Accept as MVP by-design; document the link-equals-edit-rights model. If per-user control is ever wanted, add an `onBeforeConnect` verifying a short-lived TinyWorldAuth/GoTrue token against the share's collaborator list (server-side only).

---

## Correctness / Bugs

Ranked high → low. Both HIGH items are real data-loss bugs in the new cloud-sync / multiplayer client paths.

### 1. Bulk world apply floods the collab room, stamping stale geometry over peers' live edits  · HIGH · `2f0261f`
**`engine/world/38-multiplayer-partykit.js` (`sendCellSnapshot` / `applyingRemote` guard); chain via `29-persistence-api.js:307,499-553,644-666` and `17-tile-renderers.js:606,705`**

The MP client broadcasts a `cell.set` for every `tinyworld:world-changed` event, suppressing only when `applyingRemote` is true. But `applyingRemote` is set true **only** inside `applyRemoteCell` (one remote cell) and reset synchronously in its `finally` (`38-multiplayer-partykit.js:352,365`). `applyState()` paints asynchronously: `buildOneChunk()` schedules chunks via `requestAnimationFrame` (`29-persistence-api.js:644-666`), and each painted cell's `setCellImpl` dispatches `tinyworld:world-changed` synchronously (`17-tile-renderers.js:606,705`). Those rAF ticks run **after** `applyState()` returns, so `applyingRemote` is false the whole time.

**Trigger.** The collaborate URL builder (`worldMenuCollaborateUrl`, `30-ui-boot-wiring.js ~2353`) produces a link carrying **both** `?share=ID` and `?party=ID`. On open, `?share` auto-loads via `applyState` while the MP IIFE connects via `?party` — so merely opening a collaborate link (or any in-room reload, slot-load, import, or AI-generate) replays the full snapshot into the room. A peer who reloads mid-session re-broadcasts the original shared world over everyone's newer edits.

**Fix.** Gate `sendCellSnapshot` on `suppressSave` too — `suppressSave` already brackets the entire async bulk-apply window (set before `buildOneChunk(0)`, cleared only in `finishApplyState`). Change the early-return to `if (applyingRemote || (typeof suppressSave !== 'undefined' && suppressSave) || !cell) return;`. Interactive single-click edits never set `suppressSave`, so they keep flowing to peers (confirmed by `17-tile-renderers.js:566` firing the webhook only when `!suppressSave`).

### 2. Cloud autosave read-modify-write race resurrects deleted worlds and drops renames  · HIGH · `5a0528c`
**`engine/world/30-ui-boot-wiring.js:284-313` (`twCloudSyncLocalWorldsToCloud`); interacts with `2442-2481`, `2135-2145`**

`twCloudSyncLocalWorldsToCloud` reads `const list = readWorldsMeta()` **once** at line 284, then `await`s a network save per slot (line 291). `readWorldsMeta()` returns a fresh independent parse each call (`2135-2141`), so `list` is a private snapshot. While the awaits are in flight (debounce 1200ms + RTT, easily seconds), other paths mutate persisted state via their own read-modify-write: the 5s-interval `updateActiveSnapshot`, `renameActive`, `saveAsNew`/delete handlers. When the loop finishes, line 302 does a **blind `writeWorldsMeta(list)`** of the stale snapshot, clobbering concurrent persisted changes. Plain state edits self-heal on the next snapshot; **structural** mutations do not — a deleted slot is rewritten back (resurrected), a rename reverted, a new slot dropped. Resurrection is permanent because the re-queued sync then skips it via `cloudSyncedAt >= slotTs` (line 290).

**Trigger.** User deletes World A in the world menu while a queued cloud sync (from a prior edit) is awaiting its fetch → the blind write re-adds World A's slot with its old cloudId → World A reappears on the next `paintList` refresh.

**Fix.** Don't write the stale snapshot back. After the loop, `const fresh = readWorldsMeta();` and apply only the cloud-metadata deltas (`cloudId`, `cloudSyncedAt`, `cloudUpdatedAt`, slot-id rename) collected during the loop onto slots matched by stable identity (`slot.id`, fallback `cloudId`). Deleted slots simply won't be found (no resurrection); concurrent edits in `fresh` are preserved. Then `writeWorldsMeta(fresh)` once.

### 3. Latent: `VoxelShield.destroy()`/`rebuild()` leak cloned glow materials, but no engine caller exists  · LOW · `52c50c7`
**`engine/world/40-shield-system.js:745-751, 777-783`**

`rebuildVoxelShield()` and `window.VoxelShield.destroy/.rebuild` are the only callers of `ShieldDemo.destroy()`, which calls `disposeGroup(this.shield)` — and `disposeGroup` deliberately never disposes materials (shared-material contract). The shield's glow cubes carry per-mesh `.clone()`d `MeshStandardMaterial`s (`40:116`) marked `noBatch`, so they orphan on destroy. **But** grep shows no engine caller of `rebuildVoxelShield`/`.rebuild`/`.destroy` — the toolbar is toggle-only (`19-tools-toolbar.js:1426-1430). `GRID` is resizable but nothing re-runs the rebuild on resize, so the leak is dormant during normal use.

**Fix.** Either (a) document that `VoxelShield.rebuild/destroy` leak cloned glow materials until fixed, or (b) if a GRID-resize rebuild is ever intended, wire it **and** ship a material-dispose pass (traverse and dispose only the non-shared, non-cached clones before `disposeGroup`) together.

---

## Performance

Ranked by corrected severity. The optimization commit `dd42a54` established the patterns these findings reference: preallocated scratch `Vector3`s for flight collision and the radial menu, a dirty-flag bucket for atmosphere, and `renderSceneIfReady()` boot-gating for async load callbacks. The findings below are sites that pattern *should* have reached but didn't.

### 1. Per-frame cull loop allocates a Vector3 + two string keys per cell  · MEDIUM · pre-existing (in scope for the frame-loop audit)
**`engine/world/01-render-core.js:1224-1262` (loop); `:1230` + `:1244` callers**

**Hot-path caller.** `updateSceneVisibilityForCamera()` runs unconditionally every frame from `renderScene()` (`01-render-core.js:1310`), iterating `for (const key in cellMeshes)` over every rendered cell. Per cell per frame: (a) `renderCullCellVisible(x,z) → cellDisplayPointForCell → tilePos(x,z)` returns `new THREE.Vector3(...)` (`11-vehicle-crowd.js:605`) for the common home case; (b) `editableIslandForWorldCell(x,z)` is called twice (directly at `:1230` and again inside the cull path), each doing a string concat in `editableIslandBoardKey` (`14-editable-islands-moorings.js:13`). On a 256-cell board that is ~256 Vector3 + ~512 transient strings/frame ≈ 46k allocations/sec at 60fps, growing linearly with world size → periodic GC hitches. This is exactly the churn `dd42a54` killed for flight collision and `radialProjectPoint` (`33-radial-menu.js:43`); this loop was missed.

**Fix.** Compute the island once per cell at `:1230` and thread it into `renderCullCellVisible(x, z, island)` so `cellDisplayPointForCell` doesn't recompute. Replace the per-cell `new THREE.Vector3` with a reused module-scope scratch via a globally-unique `tilePosInto(out, x, z)` helper + a cull-path-local scratch vector. **Do not** change `tilePos()`'s signature/return — it's called widely and callers retain the returned vector.

### 2. Shield runs full 36-object deployment (traversals + trig) every frame even when closed at rest  · LOW (corrected from medium) · `52c50c7`
**`engine/world/40-shield-system.js:541-607` (`update`/`applyDeployment`), `:684-687`, `:753-756`, `:787`; call site `25-animation-loop-schema.js:55`**

*(Merges two review dimensions — the traversal cost and the transform cost — same root cause, same file, one fix.)*

**Hot-path caller.** `ensureVoxelShield()` runs at boot for every session (`40:787`), and `tickVoxelShield(dt, t)` is called unconditionally each frame (`25-animation-loop-schema.js:55`) → `ShieldDemo.update` (gated only by `isRunning`, true for the shield's lifetime) → `ShieldRing.update` (`541`) → `applyDeployment` with **no early-out**. `applyDeployment` always iterates 4 keystones + 32 panels, incurring two distinct per-frame costs even when the shield is closed/invisible (the default): (a) **traversal** — each `setModuleGlow` does `root.traverse(...)` (`40:48`), so 36 full sub-tree walks/frame; (b) **transform/trig** — per-object `Math.sin`/`shieldSmoothstep` and `position.set`/`scale` writes. Verified: this is redundant-work / missing-dirty-flag, **not** per-frame allocation (the update path reuses `userData.finalPos`/`closedPos` and writes only scalars). The sibling atmosphere system in the same commit *did* add a dirty-flag (`39-atmosphere-effects.js:242`); the shield did not. Corrected to low because the work is bounded (36 objects) and the default state is invisible.

**Fix.** Add a `_settled` dirty-gate in `ShieldRing.update`: animate only while `progress !== targetProgress` or `0.001 < progress < 0.986` (the live-flicker band); apply one settled frame then skip. One gate eliminates both the traversals and the trig. Visually lossless in both settled states (closed → glow power 0; fully locked → `flicker` forced to 1, time-independent).

### 3. Eager full-shield construction at module load on every boot, regardless of use  · LOW · `52c50c7`
**`engine/world/40-shield-system.js:787` (with `:76-103`, `:695-719`)**

Distinct from finding 2 (that is per-frame *update* cost; this is one-time *construction* cost). At the bottom of the IIFE, `ensureVoxelShield();` (`40:787`) runs unconditionally at load, immediately building a `ShieldDemo → ShieldRing → 32 BlastPanels + 4 CornerKeystones` plus VoxelKit's six `MeshStandardMaterial`s (`40:82-101`) — PBR materials notably heavier than the app's standard `MeshLambertMaterial` (`03-geometry-materials.js`) — and runs `runSmokeTests()` (`40:695-719`) every boot. The shield starts hidden (`progress 0`), so this is pure startup cost paid even when the user never raises the shield. A lazy path already exists: `19-tools-toolbar.js:1428` calls `ensureVoxelShield().toggle()` on first toggle.

**Fix.** Drop the unconditional `ensureVoxelShield();` at line 787 and rely on the existing lazy toggle path / the `?shield=1` autoStart check inside `ensureVoxelShield` (`40:732`). Keep `updateVoxelShieldApi()` at load so `window.VoxelShield` exists; just defer the heavy build. If a default-visible shield is desired, gate it behind the same autoStart/URL check.

### 4. Crowd GLTF load callback calls bare `renderScene()` instead of `renderSceneIfReady()`  · LOW · pre-existing (missed by `dd42a54`)
**`engine/world/11-vehicle-crowd.js:725`**

`ensureCrowdModelCharacterAssetsLoading()` is invoked during boot (`30-ui-boot-wiring.js:1046`) **before** `setRenderSceneReady(true)` (`:1050`). Its `loadModelStampAsset` onLoad callback calls bare `renderScene()` (line 725). `dd42a54` introduced `renderSceneIfReady()` to boot-gate exactly these async callbacks (migrating `04-textures.js:574`, `09-model-stamp-loader.js:312`, `24-crop-duster-banners.js:381`) but missed this one. Bounded: `setRenderSceneReady(true)` is a one-shot gate (set once, never reset), so the worst case is one redundant render if a GLTF resolves inside the boot window — largely cosmetic consistency.

**Fix.** Replace `renderScene();` at line 725 with `renderSceneIfReady();`.

### 5. Planet-landscape warmup `setTimeout` callback calls bare `renderScene()`  · LOW · pre-existing (missed by `dd42a54`)
**`engine/world/27-landscape-engine.js:463`**

`schedulePlanetLandscapeWarmup()` fires a `setTimeout` that calls `if (typeof renderScene === 'function') renderScene();` (line 463) — the same `typeof`-guarded async pattern `dd42a54` migrated elsewhere, left on the bare path. Same bounded blast radius (one-shot gate; `setTimeout` realistically fires post-boot).

**Fix.** Replace line 463 with `if (typeof renderSceneIfReady === 'function') renderSceneIfReady();`.

---

## Refactor Opportunities

Ranked by value/risk. Every proposal preserves the hard constraints: no bundler/modules, numeric load order, globally-unique top-level names, `publish.sh` just copies. A "split" means moving a contiguous declaration block into a new numbered `engine/world/NNx-*.js` file with a `<script src>` tag inserted at the right load-order slot.

### 1. Add a check.js guard against duplicate top-level declarations across files  · MEDIUM · highest value
**`tools/check.js:19-78` (`collectAppModules` + per-module `new Function` loop)**

The single most dangerous failure mode in this codebase — a redeclared top-level `const`/`let`/`function`/`class` throws `SyntaxError` at load and silently kills the whole module while others keep running — is **unguarded**. The current loop validates each file *in isolation* (`new Function(mod.source)` per file, `:72-78`), so it structurally cannot catch a name declared in two files (each parses fine alone). Verified empirically: extracting top-level `^  (const|let|function|class|var) NAME` across `engine/world/*.js` yields total=2067, unique=2067 (**zero dupes today**), so a guard added now starts green. Recent commits add ~60+ globals each (commit `52c50c7` alone added 22 in file 39), so collision odds are real and growing.

**Constraint compliance.** Pure static regex guard in the existing check.js style — no scope parsing. Anchor on exactly 2 leading spaces, which naturally excludes IIFE-wrapped names (deeper indent) — so files 38/40's wrapped names are correctly ignored. Accumulate `name → [files]` after the per-module loop (~line 78) and `fail()` any name in 2+ files. Not a duplicate of any existing guard.

### 2. Split `09-model-stamp-loader.js` (3272L) — extract the voxel-build factory half into `09b-voxel-build-factories.js`  · LOW (corrected from high) · highest-confidence split
**`engine/world/09-model-stamp-loader.js:911-3272`**

The repo's largest file is double-purposed: lines 1-910 are the actual model-stamp loader (settings, OBJ/MTL/GLB parsing, texture sidecars); lines 911-3272 (~2360L) are an unrelated voxel-build/object factory subsystem (`voxelBuildMaterial`, `makeVoxelBuildStamp`, the InstancedMesh batching helpers, all the `makeVoxel*` building factories, island rocket/propeller, `makeVehicle`). **Verified clean seam:** the model-stamp half's last decl is `updateSelectedModelStampDefaults` (`:894`), the voxel half begins at `function voxelBuildMaterial` (`:911`), and the file's **only** top-level executable statements are `loadModelStampDefaultsConfig(); refreshModelStampManifest();` at `:908-909` — both model-stamp, both **before** the cut. The moved half is pure declarations with literal/`new Set()`/`new THREE.Vector3()` initializers (order-independent).

**Constraint compliance.** Move `911-3272` verbatim into `engine/world/09b-voxel-build-factories.js` (add a `// --------` section header at top). Insert one `<script src="engine/world/09b-voxel-build-factories.js"></script>` between the existing 09 and 10 tags in `tiny-world-builder.html` (after line 1435). Globals preserved (names move, don't duplicate); load order intact (09 → 09b → 10); no `publish.sh` edit. Corrected to low because it's a cosmetic split of working code with no behavioral defect — but it's the safest, highest-confidence one.

### 3. `39-atmosphere-effects.js` leaks 22 bare top-level globals while sibling new files 38/40 use IIFE isolation  · LOW (corrected from medium) · `52c50c7`
**`engine/world/39-atmosphere-effects.js:2-249`; contrast `38-multiplayer-partykit.js:2`, `40-shield-system.js:4`**

Files 38 and 40 wrap their bodies in IIFEs exposing only `window.*` (each adds **zero** bare globals). File 39 — added in the *same commit as 40* — dumps 22 names straight into shared global scope (`STAR_VAULT_*`, `placeableLightSources`, `lastAtmosphereBucket`, the `applyStarlit*`/`register*LightSource` functions, etc.). `lastAtmosphereBucket` is the most collision-prone given other files declare `…Bucket` names (`15-:585`, `15-:254`, `13-:406`).

**Constraint compliance, two options.** (A, ship-now) rename the purely-internal `lastAtmosphereBucket` → `_atmoLastBucket` per the `_xx` scratch-global convention, removing the highest collision risk. (B, match 38/40) wrap 39's body in an IIFE and re-expose cross-file callers via `window.*` — verify first which of the 22 are referenced externally (`updateStarlitAtmosphere`, `applyStarlitAtmosphereSettings`, `registerPlaceableLightSource` are; those must stay reachable). Corrected to low because finding 1's CI guard makes the collision detectable automatically, reducing the urgency.

### 4. Shared `renderSceneIfReady` async-load callback is copy-pasted across 3 texture loaders  · LOW · `dd42a54`
**`04-textures.js:574-576`, `09-model-stamp-loader.js:315-318`, `24-crop-duster-banners.js:381-383`**

Three callbacks repeat `() => { if (typeof renderSceneIfReady === 'function') renderSceneIfReady(); }`. Only the *callback* is duplicable — the surrounding texture config genuinely diverges (wrap modes, anisotropy, sRGB, caching). A `repaintAfterTextureLoad()` helper defined in `01-render-core.js` (after `renderSceneIfReady` at ~`:1062`, so it loads before 04/09/24) would dedupe the 3 lines.

**Constraint caveat (important).** `check.js:233` asserts the literal string `renderSceneIfReady()` appears *inside* those three function bodies — extracting the call out will **fail `npm test`** unless that guard is updated in the same change (assert on the helper name instead, keep the `renderScene()`-not-allowed half). Given the 3-line payoff and the guard coupling, this is genuinely optional.

### 5. Do **not** extract the `// -------- minimap --------` section as a unit  · LOW (explicitly negative) · n/a
**`engine/world/30-ui-boot-wiring.js:1074-1666`**

Flagged to pre-empt a tempting-but-wrong split. The minimap looks like a clean ~600L extraction, but the region under the dashed header actually concatenates **three** unrelated IIFEs: `wireMinimap()` (ends ~1311), `wireCrowdPanel()` (~1535), and a draggable-panel IIFE (ends 1666). Extracting `1074-1666` as one file drags the crowd panel and draggable helper along, defeating cohesion; cherry-picking only the minimap helpers splits the section mid-region. The minimap itself is order-safe (all cross-file callers use `typeof` guards), but the section boundary is not clean — the line accounting doesn't justify the risk. Prefer the 09b split (finding 2).

---

## Rejected / Downgraded by verification

No silent drops. These were considered and dismissed (or had severity reduced) after tracing the exploit/hot-path against real source.

| Title | Category | Verdict | Why |
|-------|----------|---------|-----|
| CSRF: cookie-only auth + Origin-absent fail-open (`http.mjs:33-37`) | security | **Rejected** (code accurate, exploit unreachable) | All six code citations verified verbatim, but the two conditions never co-occur in a browser: `SameSite=Lax` strips the cookie on the cross-site writes the guard wraps (401 before fail-open runs), and Origin-less browser requests are GET navigations hitting read-only branches. The fail-closed recommendation is legit defense-in-depth (kept as low). |
| `ShieldDemo.destroy()` leaks cloned glow materials (`40-shield-system.js`) | performance | **Rejected** (mis-categorized) | Leak mechanism is real and verified, but filed as "performance/hot-path" — and `destroy()`/`rebuild()` are never called from `animate()`/any frame-loop, resize, or listener (grep found no auto-caller). It's a slow GPU-resource leak on the rare manual rebuild, not a frame regression. Captured instead as Correctness finding 3 (low/latent). |
| `updateStarlitAtmosphere` unguarded `.toFixed(2)` on render globals (`39:241`) | correctness | **Rejected** (no reachable harm) | Hot-path confirmed, textual asymmetry real, but no NaN source (inputs are `type=range` sliders, always finite; all three writers guarded). Even granting NaN: `bucket` is a string, `'NaN' === 'NaN'` is true, so the throttle is unaffected; every consumer coerces with `\|\| 0`. A guard against a value that cannot go bad violates the boring-code house style. |
| Extract command-palette IIFE to `30b-command-palette.js` (`30:2587-2896`) | refactor | **Rejected** (misread range + false claim) | The palette IIFE closes at `:2860`, not 2896; lines 2862-2896 are a separate `bootPlanetLandscapeQuery` IIFE, so the palette is **not** the file tail and the recommended span wrongly drags an unrelated subsystem in. Following it verbatim makes a wrong edit. Even corrected, it's a cosmetic split of working code. |

---

## Top 5 recommended next actions

1. **[Security HIGH]** Range-check remote cell coordinates in `cleanCellSet` (`party/index.js:78-79`) + `applyRemoteCell` (`38-multiplayer-partykit.js:351`). Single highest-impact fix — closes the cross-peer DoS + save-poisoning vector. Pair with the `cleanCell` field allowlist (Security 2) to also clamp `floors`/`kind`.
2. **[Correctness HIGH]** Fix the cloud-sync read-modify-write race: re-read `readWorldsMeta()` after the await loop and merge only cloud deltas instead of the blind `writeWorldsMeta(list)` at `30-ui-boot-wiring.js:302`. Stops permanent resurrection of deleted worlds.
3. **[Correctness HIGH]** Add `suppressSave` to the `sendCellSnapshot` early-return in `38-multiplayer-partykit.js` so bulk applies (notably opening a `?share`+`?party` collaborate link) stop flooding the room and overwriting peers' edits.
4. **[Refactor MEDIUM]** Add the cross-file duplicate-top-level-declaration guard to `tools/check.js` (after line 78). Cheap static regex, starts green (0 dupes today), permanently protects against the codebase's silent-killer failure mode.
5. **[Performance LOW, fast wins]** Land the `_settled` dirty-gate in `ShieldRing.update` (covers Performance 2 + 3), and flip the two stragglers `renderScene()` → `renderSceneIfReady()` at `11-vehicle-crowd.js:725` and `27-landscape-engine.js:463`. The per-frame cull-loop allocation fix (Performance 1, MEDIUM) is higher value but higher touch — schedule it after the quick wins.
