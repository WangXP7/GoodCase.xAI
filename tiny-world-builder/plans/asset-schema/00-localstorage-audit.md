# localStorage Key Audit Report

**Generated**: 2026-07-04  
**Scope**: engine/world/*.js, engine/landscape/*.js, scripts/*.js  
**Classification**: Against sync mechanisms in engine/world/30-ui-boot-wiring.js lines 1096–1235

---

## SYNCED-PREFS (Cloud Account)

Matched against `PREF_SYNC_PREFIXES` and `PREF_SYNC_KEYS` (30-ui-boot-wiring.js:1101–1113). Synced via `twCloudCollectPreferences()` and `twCloudApplyPreferences()`.

| Key | Files:Lines | Notes |
|-----|-----------|-------|
| tinyworld:render:resolution | 01-render-core.js:319,340 | Part of RENDER_LS object |
| tinyworld:render:dynamicResolution | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:targetFps | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:saturation | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:contrast | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:brightness | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:shadow | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:lighting | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:directionalSun | 01-render-core.js:319,327 | Part of RENDER_LS object |
| tinyworld:render:ambientFill | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:frontFill | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:sideFill | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:backFill | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:visibleDistance | 01-render-core.js:319,340,472,868 | Part of RENDER_LS object |
| tinyworld:render:visibleSize | 01-render-core.js:319,341,473,869 | Part of RENDER_LS object |
| tinyworld:render:clouds | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:cloudSpeed | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:cloudHeight | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:cloudShadow | 01-render-core.js:319,347 | Part of RENDER_LS object |
| tinyworld:render:planesEnabled | 01-render-core.js:319; 24-crop-duster-banners.js:75 | Part of RENDER_LS object |
| tinyworld:render:distantWorlds | 01-render-core.js:319; 13-distant-dressing-ghost.js:132 | Part of RENDER_LS object |
| tinyworld:render:cloudSea | 01-render-core.js:319; 31-cloud-sea.js:162 | Part of RENDER_LS object |
| tinyworld:render:cloudStyle | 01-render-core.js:319; 31-cloud-sea.js:239 | Part of RENDER_LS object |
| tinyworld:render:starVault | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:starVaultStrength | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:cloudRimLight | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:accentLights | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:underCloudSpread | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:skyBlueDepth | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:skyBlueSaturation | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:distanceMist | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:backdrop | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:backdropVignette | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:tiltBlur | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:tiltFocus | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:ghostOpacity | 01-render-core.js:319,342 | Part of RENDER_LS object |
| tinyworld:render:floorOpacity | 01-render-core.js:319,343 | Part of RENDER_LS object |
| tinyworld:render:objectOpacity | 01-render-core.js:319,344 | Part of RENDER_LS object |
| tinyworld:render:voxelGap | 01-render-core.js:319,345 | Part of RENDER_LS object |
| tinyworld:render:voxelBevel | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:voxelTerrain | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:texturedGrass | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:surfaceLinkedMaterials | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:terrainColors | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:terrainColorTarget | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:materialParts | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:materialTarget | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:materialWear | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:enhancedWater | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:landscapeMeshMode | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:terrainVoxelResolution | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:showCrowns | 01-render-core.js:319,346 | Part of RENDER_LS object |
| tinyworld:render:autoExpand | 01-render-core.js:319,448 | Part of RENDER_LS object |
| tinyworld:render:pixelSize | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:pixelDepthEdge | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:pixelNormalEdge | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:shaderAntialias | 01-render-core.js:319 | Part of RENDER_LS object |
| tinyworld:render:version | 01-render-core.js:319,320 | Part of RENDER_LS object |
| tinyworld:audio:music | 22-audio.js:143 | Part of AUDIO_LS object; matches tinyworld:audio:* prefix |
| tinyworld:audio:sfx | 22-audio.js:144 | Part of AUDIO_LS object |
| tinyworld:audio:ambient | 22-audio.js:145 | Part of AUDIO_LS object |
| tinyworld:audio:engines | 22-audio.js:146 | Part of AUDIO_LS object |
| tinyworld:audio:music-muted | 22-audio.js:147 | Part of AUDIO_LS object |
| tinyworld:audio:sfx-muted | 22-audio.js:148 | Part of AUDIO_LS object |
| tinyworld:audio:ambient-muted | 22-audio.js:149 | Part of AUDIO_LS object |
| tinyworld:audio:engines-muted | 22-audio.js:150 | Part of AUDIO_LS object |
| tinyworld:audio:music-track | 22-audio.js:195 | Part of AUDIO_LS object |
| tinyworld:audio:music-mode | 22-audio.js:196 | Part of AUDIO_LS object |
| tinyworld:audio:ambient-range | 22-audio.js (read not write) | Part of AUDIO_LS object |
| tinyworld:audio:engines-range | 22-audio.js (read not write) | Part of AUDIO_LS object |
| tinyworld:crowd:count | 11-vehicle-crowd.js:640 | Part of RENDER_LS; matches tinyworld:crowd:* prefix |
| tinyworld:crowd:scale | 11-vehicle-crowd.js:641 | Part of RENDER_LS |
| tinyworld:crowd:speed | 11-vehicle-crowd.js:642 | Part of RENDER_LS |
| tinyworld:crowd:bob | 11-vehicle-crowd.js:643 | Part of RENDER_LS |
| tinyworld:crowd:sway | 11-vehicle-crowd.js:644 | Part of RENDER_LS |
| tinyworld:crowd:lean | 11-vehicle-crowd.js:645 | Part of RENDER_LS |
| tinyworld:crowd:zoneRadius | 11-vehicle-crowd.js:646 | Part of RENDER_LS |
| tinyworld:crowd:showZones | 11-vehicle-crowd.js:647 | Part of RENDER_LS |
| tinyworld:crowd:paused | 11-vehicle-crowd.js:648 | Part of RENDER_LS |
| tinyworld:crowd:debug | 11-vehicle-crowd.js:649 | Part of RENDER_LS |
| tinyworld:crowd:mode | 11-vehicle-crowd.js:650 | Part of RENDER_LS |
| tinyworld:crowd:showArrows | 11-vehicle-crowd.js:651 | Part of RENDER_LS |
| tinyworld:crowd:enabled | 11-vehicle-crowd.js:652 | Part of RENDER_LS |
| tinyworld:crowd.collapsed | 30-ui-boot-wiring.js:2736 | Matches tinyworld:crowd.* prefix; panel UI state |
| tinyworld:crowd.pos | 30-ui-boot-wiring.js:2771 | Matches tinyworld:crowd.* prefix; panel UI state |
| tinyworld:gen:seed | 28-generate-panel-agent.js (read/write via GEN_LS) | Matches tinyworld:gen:* prefix |
| tinyworld:gen:gridSize | 28-generate-panel-agent.js (via GEN_LS) | Matches tinyworld:gen:* prefix |
| tinyworld:gen:biomes.v1 | 28-generate-panel-agent.js (via GEN_LS) | Matches tinyworld:gen:* prefix |
| tinyworld:gen:elevation.v1 | 28-generate-panel-agent.js (via GEN_LS) | Matches tinyworld:gen:* prefix |
| tinyworld:gen:disableAutofill | 28-generate-panel-agent.js (via GEN_LS) | Matches tinyworld:gen:* prefix |
| tinyworld:gen:planetDrop | 28-generate-panel-agent.js (via GEN_LS) | Matches tinyworld:gen:* prefix |
| tinyworld:gen:useLandscape | 20-input-place-erase.js:3623,3707; 27-landscape-engine.js:1194; 28-generate-panel-agent.js:130 | Matches tinyworld:gen:* prefix |
| tinyworld:gen:procedural | 28-generate-panel-agent.js:121 | Matches tinyworld:gen:* prefix |
| tinyworld:gen:landscapeStyle | 28-generate-panel-agent.js:356 | Matches tinyworld:gen:* prefix |
| tinyworld:gen:landscapeBiome | 28-generate-panel-agent.js:364 | Matches tinyworld:gen:* prefix |
| tinyworld:gen:landscapeRender | 28-generate-panel-agent.js:371 | Matches tinyworld:gen:* prefix |
| tinyworld:view.camera | 02-cameras-lighting.js:12 (CAMERA_LS_KEY) | Explicit entry in PREF_SYNC_KEYS (30-ui-boot-wiring.js:1105) |
| tinyworld:season.v1 | 30-ui-boot-wiring.js:2921 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:weather.v1 | 30-ui-boot-wiring.js:2922 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:weather-intensity.v2 | 23-particles-clouds.js:705 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:weather-splashes.v1 | 23-particles-clouds.js:706 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:uiTheme | 01-render-core.js:319 (RENDER_LS.uiTheme) | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:lang | Not found in grep (read-only at startup) | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:showGroups | 35-tool-palette.js:102 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:tips.dismissed | 24-crop-duster-banners.js:319,325 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:welcome:dismissedId | Not found in grep | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:stamp-builder-recent.v1 | 19-tools-toolbar.js:529 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:agent:input-pos | Not found in grep (read-only) | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:agent:panel-pos | 28a-floating-agent.js:54 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:minimap.pos | 30-ui-boot-wiring.js:2536 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:toolPalette.pos | 35-tool-palette.js:75 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:stamp-panel-pos | 21-object-transform-voxel-build.js:2171 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:layers-panel-pos.v1 | 32-layers-panel.js:482 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:layers-panel-open.v1 | 32-layers-panel.js:397 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:selection-props-active-tab.v1 | 28a-floating-agent.js:347 | Explicit entry in PREF_SYNC_KEYS |
| tinyworld:selection-props-collapsed.v1 | 28a-floating-agent.js:336 | Explicit entry in PREF_SYNC_KEYS |

**Count**: 78 keys

---

## SYNCED-ASSETS (Cloud Asset Library)

Covered by `twCloudCollectAssetLibrary()` and `twCloudMergeAssetsIntoLocal()` (30-ui-boot-wiring.js:991–1057). These keys store user-created assets synced to cloud.

| Key | Files:Lines | Notes |
|-----|-----------|-------|
| tinyworld:voxel-build-stamps.v1 | 08-voxel-stamp-renderer.js:464 | Custom voxel builds; collected by collectCustomVoxelBuilds() |
| tinyworld:asset-templates.v1 | 20-input-place-erase.js:2413 | Asset templates; collected by loadAssetTemplates() |
| tinyworld:model-stamp-defaults.v1 | 09-model-stamp-loader.js:107,135,155,195 | Model stamp defaults; collected by window.__tinyworldModelStampDefaults.collect() |
| tinyworld:stamp-builder-hidden.v1 | 19-tools-toolbar.js:560 | Hidden stamp keys; collected by window.__tinyworldStampBuilderHidden.collect() |

**Count**: 4 keys

---

## SYNCED-WORLDS (Cloud World Metadata & Avatar)

Covered by `twCloudSyncLocalWorldsToCloud()`, `readWorldsMeta()`, `writeWorldsMeta()`, and `twCloudHydrateAvatar()` (30-ui-boot-wiring.js:895–1221).

| Key | Files:Lines | Notes |
|-----|-----------|-------|
| tinyworld:worlds.v1 | 29-persistence-api.js:75; 30-ui-boot-wiring.js (readWorldsMeta) | World list metadata with cloud sync state |
| tinyworld:worlds.active.v1 | 30-ui-boot-wiring.js:3752–3756 (getActiveWorldId/setActiveWorldId) | Active world ID; synced as part of worlds metadata |
| tinyworld:multiplayer:avatar-voxel | 30-ui-boot-wiring.js:1218 | Avatar hydrated from /api/avatar; synced via twCloudHydrateAvatar() |

**Count**: 3 keys

---

## SECRET-LOCAL-ONLY (Intentional Exclusions)

Hard-excluded by `twCloudIsSyncedPrefKey()` (30-ui-boot-wiring.js:1117). Never leave device.

| Key | Files:Lines | Notes |
|-----|-----------|-------|
| tinyworld:ai:provider | 26-ai-generation.js:48 | AI provider choice (OpenAI, etc.); secret keys stored under tinyworld:ai:key:* |
| tinyworld:ai:model:* | 26-ai-generation.js:49 | AI model names per provider |
| tinyworld:ai:key:* | 26-ai-generation.js:50 | API keys for each provider (SECRETS) |
| tinyworld:ai:prompt | 26-ai-generation.js:51 | Custom AI prompts |
| tinyworld:auth:wallet-session.v1 | 30-ui-boot-wiring.js:478 | Wallet session token (auth secret) |
| tinyworld:api:v1 | 29-persistence-api.js:858 | API configuration (local-only) |

**Count**: 6 keys (or 4 base patterns with dynamic suffixes)

---

## CACHE/EPHEMERAL (Device-Local by Design)

Intentionally ephemeral per user behavior. Unique per device/session. Not synced.

| Key | Files:Lines | Notes |
|-----|-----------|-------|
| tinyworld:multiplayer:client-id | 47-worlds-room.js:140 | Random per-device peer ID for multiplayer; regenerated each session if missing |
| tinyworld:multiplayer:color | 47-worlds-room.js:167 | User's chosen avatar color in multiplayer; ephemeral UI pref, not user data |

**Count**: 2 keys

---

## UNSYNCED-DURABLE (Violations — User Data at Risk)

These keys store user data that would be LOST on a new device under current architecture. Classified by data value/impact.

### Critical (User Loses Editable World Data)

| Key | Files:Lines | Severity | Current Impact | Proposed Fix |
|-----|-----------|----------|---|---|
| tinyworld:v1 | 29-persistence-api.js:62,148,167 | **CRITICAL** | Full world state (tiles, builds, objects) for home world; lost on new device. User loses all local edits not saved to cloud via slot. | Move home-world state to /api/world; use `tinyworld:worlds.v1` as sync point (already synced), then hydrate tinyworld:v1 from server on load. OR: add tinyworld:v1 to SYNCED-DURABLE list if home is the primary build target. |

### High (User Loses Customization or Session State)

| Key | Files:Lines | Severity | Current Impact | Proposed Fix |
|-----|-----------|---|---|
| tinyworld:home-grid | ~~20-input-place-erase.js:3394,3373~~ read: 01-render-core.js:146; write: 20-input-place-erase.js:3394 | ~~HIGH~~ **corrected: NOT A VIOLATION (verified cache)** | Stores just the home board size (`String(GRID)`, e.g. `"16"`) — NOT cell selection/history as originally guessed. Read synchronously at very early boot (01-render-core.js:146, before the async world load resolves) so initial buffers/camera framing size correctly before the real world state arrives. `gridSize: GRID` is already captured in `buildWorldStateObject` and restored via `applyState` (29-persistence-api.js:116, 364), and world saves are cloud-synced (SYNCED-WORLDS). So the authoritative value already rides the account; this LS key is a same-device bootstrap cache of that same number, re-derived every load. **No code change** — adding it to PREF_SYNC_KEYS would be redundant (self-heals every load from the world save) and risks racing the world-load's own restore. |
| tinyworld:home-grid:backup | 20-input-place-erase.js:3373 (write-only) | **corrected: LOW (dead safety net, not a sync gap)** | Verified **write-only**: set on every `setHomeGridSize()` resize (full serialized cell dump of the pre-resize board via `serializeCell`), but grepped across engine/world/*.js and every `.worktrees/*` checkout — there is no `getItem('tinyworld:home-grid:backup')` anywhere. Not wired to any restore/recovery UI, so today it's inert disk usage, not a source of data loss (the resize itself doesn't drop data — `world[][]` already preserves tiles outside the shrunk grid per the code comment at 20-input-place-erase.js:3343-3348). Nothing to sync since there's no consumer. If a "restore board before last resize" feature is ever built, that's new feature work (needs a restore UI, probably belongs in world-state history rather than localStorage) — not an audit fix. **No code change.** |
| tinyworld:multiplayer:avatar-class | 47-worlds-room.js:2262 | **HIGH** | Avatar appearance class choice in worlds room (stripped to role on next load); lost on new device. | Move to /api/avatar or fold into tinyworld:multiplayer:avatar-voxel (already synced). |
| tinyworld:multiplayer:avatar-voxel-seed | 47-worlds-room.js:2140,2146 | **HIGH** | Avatar voxel seed for non-customized avatars; lost on new device. Affects avatar appearance in multiplayer. | Move to /api/avatar; currently only tinyworld:multiplayer:avatar-voxel is synced. |

### Medium (User Loses UI/Session Preferences, Durable Workarounds)

| Key | Files:Lines | Severity | Current Impact | Proposed Fix |
|-----|-----------|---|---|
| tinyworld:worlds.activeTinyverse.v1 | 46-worlds-universe.js:24; 47-worlds-room.js:72,124 | **MEDIUM** | Last-active world slug in worlds room; user revisits the same world but must re-select on new device. | Add to PREF_SYNC_KEYS (already world-local pref, follows account). |
| tinyworld:worlds.map.pos | 47-worlds-room.js:1861 | **MEDIUM** | Map panel position in world room; UI state, user must reposition. | Add to PREF_SYNC_KEYS (panel position pref). |
| tinyworld:worlds.map.scale | 47-worlds-room.js:1797 | **MEDIUM** | Map zoom level in world room; UI state, user must rezoom. | Add to PREF_SYNC_KEYS. |
| tinyworld:playchat:size | 50-worlds-play-chat.js:326 | **MEDIUM** | Chat panel size in play mode; UI state, user must resize. | Add to PREF_SYNC_KEYS. |
| tinyworld:build-play-mode.v1 | 30-ui-boot-wiring.js:180 | **MEDIUM** | Toggle between build/play mode on home world entry; mode preference. | Add to PREF_SYNC_KEYS. |

### Low (User Loses Minor State, Auto-Recoverable or Less Impactful)

| Key | Files:Lines | Severity | Current Impact | Proposed Fix |
|-----|-----------|---|---|
| tinyworld:onboarding:driver.v1 | 70-onboarding-driver.js:21 | **LOW** | Onboarding tour completion flag; user redoes tour on new device. | Not critical; auto-clears on account signup anyway. Optional: add to PREF_SYNC_KEYS. |
| tinyworld:graphics-warning-dismissed.v1 | 01-render-core.js:647 | **LOW** | User dismissed GPU warning once; warning reappears. | Not critical; user dismisses again. Optional: move to PREF_SYNC_KEYS. |
| tinyworld:minimap.collapsed | 30-ui-boot-wiring.js:2601 | **LOW** | Minimap panel collapsed state; UI state, user must re-collapse. | Add to PREF_SYNC_KEYS. |
| tinyworld:controls:invertLookY | 30-ui-boot-wiring.js:3335 | **LOW** | Camera Y-axis inversion toggle; gameplay pref. | Add to PREF_SYNC_KEYS (controls pref). |
| tinyworld:vehicle-demo:last-seed | 11-vehicle-crowd.js:538 | **LOW** | Last vehicle crowd seed used in demo; demo-only state. | Not critical; demo is ephemeral. Safe to ignore. |
| tinyworld:windowStyle | 30-ui-boot-wiring.js:5661 | **LOW** | Window/fullscreen mode state; UI state. | Add to PREF_SYNC_KEYS if persistent. |

### Dev-Only (Non-User Data)

| Key | Files:Lines | Severity | Notes |
|-----|-----------|----------|-------|
| tw:test-user-email | 30-ui-boot-wiring.js:23 | N/A | Dev test login; should never ship in prod. |
| tw:test-user-admin | 30-ui-boot-wiring.js:24 | N/A | Dev test admin flag; should never ship in prod. |
| tw:test-user-logged | 30-ui-boot-wiring.js:25 | N/A | Dev test login marker; should never ship in prod. |
| tinyworld:flags.inspectorV2 | 00-prelude.js:8 | N/A | Feature flag; read-only, dev control. |
| tinyworld:features:model-stamp-api | 09-model-stamp-loader.js:47,62 | N/A | Feature flag; read-only, dev control. |
| tinyworld:renderTerrainBake | 17-tile-renderers.js:1017 | N/A | Feature flag; read-only, dev control. |

### Mesh Terrain Tools (Non-Synced Durable Tool State)

| Key | Files:Lines | Severity | Notes |
|-----|-----------|----------|-------|
| tinyworld:meshTerrain:v2 | 46-mesh-terrain.js:111-120 | **MEDIUM (verified real gap)** | Stores `{v:2, gridSize, vpt, applied, cellH: Array<float>, mats: Array<uint8>}` — a per-voxel sculpt design, NOT a small blob. `N = gridSize * effVpt` is capped at `MAX_N=96` (46-mesh-terrain.js:27,144-145: `while (effVpt>2 && gridSize*effVpt>MAX_N) effVpt--`), so worst case is `N*N = 9216` voxels regardless of board size, giving `cellH`+`mats` JSON on the order of ~100KB+ (close to/over the server's 100k-char-per-value cap in netlify/functions/preferences.mjs:20, which silently drops oversized values). Confirmed via grep of 29-persistence-api.js: `buildWorldStateObject`/`applyState` only carry `landscapeMeshMode` (a boolean toggle for the *unrelated* procedural LandscapeEngine, module 27) — nothing captures this sculptor's actual `cellH`/`mats` design. So a user's hand-sculpted terrain (own opt-in tool, "world schema untouched" by design per the code comment at 46-mesh-terrain.js:17-22) is genuinely device-local and lost on a new device or cleared storage. **Not fixed here**: adding it to PREF_SYNC_KEYS is unsafe (size risk against the 100k-char cap, and it's board content, not a preference); capturing it in world-state would need a new field, a size budget decision for the world-save/DB row, and a migration path for existing local-only designs — that's schema-phase work with data-loss-on-mismigration risk, out of scope for this pass. **Proposed fix (schema-phase)**: either (a) add an optional `meshTerrain` field to the world-state schema with the same gridSize-scoped size cap already enforced client-side, gated behind a version bump + migration, or (b) treat it like a fourth SYNCED-ASSETS-style endpoint (own `/api/mesh-terrain` row, mirroring the avatar/preferences pattern) so it doesn't inflate the per-world state blob. |
| tinyworld:meshTerrain:prefs:v1 | 46-mesh-terrain.js:96-108 | ~~LOW~~ **FIXED** | Stores `{vpt, toolMode, brushRadius, paintMatIndex}` — small scalar tool UI prefs (viewport voxel density, sculpt/paint mode, brush radius, selected material index), on the order of 60-80 bytes. No size or content-safety concerns. | **Added to PREF_SYNC_KEYS** (30-ui-boot-wiring.js:1117-1120, this pass). Now rides the existing account preferences sync. |

### Watcher Layer (Developer/Debug Visualization)

| Key | Files:Lines | Severity | Notes |
|-----|-----------|----------|-------|
| tinyworld:watcher:enabled | 69-watcher-layer.js:11 | **LOW** | Developer visualization layer state; debug-only, non-user. |
| tinyworld:watcher:size | 69-watcher-layer.js:12 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:faceWidth | 69-watcher-layer.js:13 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:faceHeight | 69-watcher-layer.js:14 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:posX | 69-watcher-layer.js:15 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:posY | 69-watcher-layer.js:16 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:posZ | 69-watcher-layer.js:17 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:tilt | 69-watcher-layer.js:18 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:zoom | 69-watcher-layer.js:19 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:smooth | 69-watcher-layer.js:20 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:faceOpacity | 69-watcher-layer.js:21 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:handOpacity | 69-watcher-layer.js:22 | **LOW** | Developer visualization; debug-only. |
| tinyworld:watcher:cloudOpacity | 69-watcher-layer.js:23 | **LOW** | Developer visualization; debug-only. |

**Count**: 29+ durable unsynced keys (excluding watcher debug layer)

---

## Violations Ranked (by User Impact)

> STATUS 2026-07-04 (fable review pass): items 3-10 RESOLVED by adding their keys to
> `PREF_SYNC_KEYS` (30-ui-boot-wiring.js) — they now ride the existing account
> preferences sync (remote wins on boot). Item 1 was re-traced and DOWNGRADED (see
> correction below). Remaining open: item 1 (narrowed), item 2, items 14-15
> (mesh terrain), and low-value 11-13/16.
>
> STATUS 2026-07-04 (second pass, home-grid + mesh-terrain investigation): item 2
> re-traced and DOWNGRADED to not-a-violation on both keys (verified cache /
> verified dead write-only backup — see corrected entries below). Item 15
> RESOLVED (added to PREF_SYNC_KEYS). Item 14 re-traced and CONFIRMED as a real
> gap (upgraded LOW->MEDIUM) — genuinely unsynced sculpt data, but the fix needs
> a world-state schema version bump or a dedicated endpoint, so it is reported
> only, not implemented in this pass.

1. **tinyworld:v1** (~~CRITICAL~~ ~~MEDIUM~~ **RESOLVED, race closed 2026-07-04**) —
   Both earlier versions of this finding were wrong. Final trace (world-autosync agent):
   an always-on live-slot-refresh mechanism has existed since the May 28 refactor
   (fb8fbfb), unconditional for all users: `updateActiveSnapshot()`
   (30-ui-boot-wiring.js:5095-5118) fingerprint-compares live state to the active slot
   and pushes to the cloud, driven by every `tinyworld:world-changed` event (800ms
   debounce, 30:5121-5127) plus a 5s visible-tab dirty-flush interval (30:5249-5262).
   The only real gap was a TAB-CLOSE RACE: edits within the ~800ms slot debounce +
   ~1200ms cloud debounce of a close/background could miss both (29-persistence-api's
   flushSaveNow covered only the local key). FIXED: `flushActiveSnapshotOnHide()`
   (30-ui-boot-wiring.js, next to the 5s interval) on visibilitychange-hidden/pagehide —
   dirty-guarded, writes the slot synchronously before any await (so even a killed
   cloud fetch is recovered by the next bootstrap sync via `slot.ts > cloudSyncedAt`),
   then best-effort cloud push (no keepalive; world bodies can exceed its 64KB cap).

2. **tinyworld:home-grid** (~~HIGH~~ **corrected: NOT A VIOLATION**) — Re-traced: it stores only the board size (`String(GRID)`), read once at early boot to size buffers before the async world load resolves. `gridSize` is already part of `buildWorldStateObject`/`applyState` (29-persistence-api.js:116,364) and world saves are cloud-synced, so this LS key is a same-device bootstrap cache of already-synced data, not new user data at risk. **No fix needed.**

2b. **tinyworld:home-grid:backup** (~~HIGH~~ **corrected: LOW, not a sync gap**) — Re-traced: write-only across the whole repo (incl. all `.worktrees/*`); no `getItem` call anywhere reads it back. It's an unused safety net, not a source of loss (the resize path itself preserves tiles via `world[][]`). **No fix needed**; wiring an actual restore UI would be new feature work, not an audit fix.

3. **tinyworld:multiplayer:avatar-voxel-seed** (HIGH) — Avatar seed lost on new device, affecting multiplayer appearance. Currently only tinyworld:multiplayer:avatar-voxel (customized avatar) is synced. **Proposed fix**: Extend `/api/avatar` sync to include both voxel descriptor AND seed for regenerated avatars.

4. **tinyworld:multiplayer:avatar-class** (HIGH) — Avatar class choice in worlds room lost on new device. **Proposed fix**: Move to `/api/avatar` or fold into synced tinyworld:multiplayer:avatar-voxel.

5. **tinyworld:worlds.activeTinyverse.v1** (MEDIUM) — Last-active world slug lost; user must re-select favorite world. **Proposed fix**: Add to PREF_SYNC_KEYS (already a world-local pref).

6. **tinyworld:worlds.map.pos, tinyworld:worlds.map.scale** (MEDIUM) — Map UI state lost; user must reposition/rezoom. **Proposed fix**: Add both to PREF_SYNC_KEYS (map panel prefs).

7. **tinyworld:playchat:size** (MEDIUM) — Chat panel size lost in play mode. **Proposed fix**: Add to PREF_SYNC_KEYS.

8. **tinyworld:build-play-mode.v1** (MEDIUM) — Build/play mode toggle on home entry lost. **Proposed fix**: Add to PREF_SYNC_KEYS.

9. **tinyworld:controls:invertLookY** (LOW) — Camera inversion pref lost. **Proposed fix**: Add to PREF_SYNC_KEYS (controls pref).

10. **tinyworld:minimap.collapsed** (LOW) — Minimap state lost. **Proposed fix**: Add to PREF_SYNC_KEYS.

11. **tinyworld:windowStyle** (LOW) — Window mode state lost. **Proposed fix**: Add to PREF_SYNC_KEYS if persistent across sessions.

12. **tinyworld:graphics-warning-dismissed.v1** (LOW) — GPU warning must be re-dismissed. **Proposed fix**: Optional, non-critical; add to PREF_SYNC_KEYS if user values it.

13. **tinyworld:onboarding:driver.v1** (LOW) — Onboarding tour redone on new device. **Proposed fix**: Non-critical; optional add to PREF_SYNC_KEYS.

14. **tinyworld:meshTerrain:v2** (~~LOW~~ **corrected: MEDIUM, confirmed real gap**) — Verified: `buildWorldStateObject`/`applyState` do not capture this key's data at all (they only carry the unrelated `landscapeMeshMode` boolean for the LandscapeEngine, module 27 — a different feature from the mesh-terrain sculptor, module 46). A user's hand-sculpted terrain is genuinely device-local and lost on a new device. Also confirmed **too large to safely add to PREF_SYNC_KEYS**: worst case is `N*N=9216` voxels (MAX_N=96 cap) of `cellH`+`mats`, whose JSON is on the order of ~100KB — near/over the server's 100k-char-per-value cap (netlify/functions/preferences.mjs:20), which would silently drop the value rather than error. **Proposed fix (schema-phase, not implemented here)**: either add a size-capped `meshTerrain` field to the world-state schema behind a version bump + migration, or give it its own sync endpoint (`/api/mesh-terrain`) mirroring the avatar/preferences pattern instead of inflating the per-world blob.

15. **tinyworld:meshTerrain:prefs:v1** (~~LOW~~ **FIXED this pass**) — Small scalar tool UI prefs (~60-80 bytes: vpt/toolMode/brushRadius/paintMatIndex). **Added to PREF_SYNC_KEYS** (30-ui-boot-wiring.js:1117-1120); now rides the existing account preferences sync.

16. **tinyworld:vehicle-demo:last-seed** (LOW) — Demo crowd seed lost. **Proposed fix**: Non-critical; safe to ignore (demo is ephemeral).

---

## Summary by Classification

| Classification | Count | Synced | Violations |
|---|---|---|---|
| SYNCED-PREFS | 78 | ✓ | 0 |
| SYNCED-ASSETS | 4 | ✓ | 0 |
| SYNCED-WORLDS | 3 | ✓ | 0 |
| SECRET-LOCAL-ONLY | 6 | ✗ (by design) | 0 |
| CACHE/EPHEMERAL | 2 | ✗ (by design) | 0 |
| **UNSYNCED-DURABLE** | **29+** | **✗** | **16 actionable (1 critical, 3 high, 5 medium, 7+ low)** |
| Dev-Only | 6 | N/A | 0 |
| **TOTAL** | **~128** | — | **16 violations** |

---

## Notes

- **tinyworld:v1** is the most critical gap: it stores home-world state but is not synced. On new device, user loses all local edits.
- **Avatar sync gaps**: tinyworld:multiplayer:avatar-voxel-seed and avatar-class are not synced; only the descriptor is.
- **UI prefs**: Many panel positions, collapsed states, and gameplay toggles (map.pos, map.scale, playchat:size, build-play-mode, controls:invertLookY, minimap.collapsed, windowStyle) should be moved to PREF_SYNC_KEYS since they are user preferences following the account.
- **Mesh terrain**: tinyworld:meshTerrain:v2 (tool state) has same loss-on-new-device issue as tinyworld:v1 but scoped to the mesh tool. **Confirmed 2026-07-04**: no world-state field captures it; fix needs a schema version bump or dedicated endpoint (see corrected entry above) — not a simple PREF_SYNC_KEYS add (size risk).
- **Home grid keys corrected 2026-07-04**: tinyworld:home-grid and tinyworld:home-grid:backup were originally miscategorized as HIGH-severity violations based on an unverified guess ("grid cell selection/history"). Re-traced against actual code: home-grid stores only the board size and is a redundant bootstrap cache of data the world save already syncs; home-grid:backup is write-only with zero readers anywhere in the repo. Both downgraded to not-a-violation. The Count/Summary table below predates this correction (and the earlier items 3-10 resolution) and has not been fully reconciled — treat the per-item numbered list above as the current source of truth over the aggregate counts.
- **Watcher layer**: 13 keys for developer-only visualization (tinyworld:watcher:*) are not user data; safe to leave unsynced.
- **Feature flags** (inspectorV2, renderTerrainBake, model-stamp-api) and **test keys** (tw:test-user-*) are dev controls; should never be in prod UX.
