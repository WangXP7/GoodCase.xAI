# TinyWorld — CodeSurf Workspace Memory

Date of last refresh: 2026-07-04

---

## Overview

TinyWorld is a voxel-world builder and MMO game (Netlify + PartyKit) with a Three.js r185 engine split across numbered IIFE modules at `engine/world/NN-*.js`. Source is served live from `npm run dev` on port 3000; `./publish.sh` produces `dist/` for production (Netlify). All view-facing edits require a publish step to appear in prod.

CodeSurf auto-commits and auto-pushes edits to main, which deploys to Netlify prod immediately. Branches do not guarantee isolation.

---

## Durable Architecture Facts

### Module system
- All `engine/world/*.js` files share a single global browser scope. `tools/check.js` CI guard fails the build on duplicate top-level identifiers — every new module must use an IIFE and expose only via `window.__*`.
- New module = `engine/world/NN-*.js` + one `<script defer>` tag before `99-late-boot.js`. Load order matters.
- `LandscapeEngine.js` is a superseded monolith; `getHeight`/chunk-building live in `engine/landscape/*.js` mixins that override it — edit the mixins, not the monolith.
- Three.js r185 is self-hosted at `vendor/three/tinyworld-three.r185.min.js`. Do not bump casually; regenerate with `npm run vendor:three` and re-check when upgrading.

### Build and deploy
- Dev server: `npm run dev` → port 3000, source live. Prod artifact: `./publish.sh` → `dist/`.
- `tools/check.js` CI guard: (1) duplicate top-level identifier check; (2) maintains `tools/localstorage-baseline.json` (~27 engine files, ~205 legacy LS write sites) as allowlist for LS-ban check.
- No PNG icons — SVG glyphs only; PNG baked-icon system must never be reintroduced.
- No bundler, no npm runtime dependencies.

### Persistence rules
- localStorage is **cache-only**. All durable state goes to Postgres via `/api/*` endpoints.
- Existing auth-gated endpoints: `/api/assets`, `/api/worlds`, `/api/builds`, `/api/preferences`, `/api/collectibles`.
- Guests get in-memory state + sign-in prompt — never silent LS saves.
- CI will ban un-allowlisted `localStorage.setItem` / `twSafeSetItem` calls (allowlist tracked in `tools/localstorage-baseline.json`).

### Feature flags
- Registered in `engine/world/00b-feature-flags.js` via `TW_FEATURE_FLAG_IDS`.
- Current flags include: `ai`, `stamps`, `dbAssets`, `buildV2`, `thirdPersonView`, and ~25 others.
- Admin-secret gate: roadmap drag / features admin silently 403 if `TINYWORLD_ADMIN_SECRET` unset; restart netlify dev after setting.

### Multiplayer / worlds
- PartyKit transport at `party/index.js`. New worlds message handlers go in `onWorldMessage`, NOT main `onMessage` (worlds rooms early-return past it).
- Server-authoritative worlds room at `47-worlds-room.js`. Signed-token join; Postgres flush.
- Local peers need `openMode` (unset `WORLDS_JOIN_SECRET`/`WORLDS_SERVICE_TOKEN`) or a signed play token, else bots/clients are observers and never render as peers.
- World grid size must be a legal value: `[8, 10, 12, 16, 20]` (cap 20). Off-list sizes cause terrain/movement/stargate divergence.

### Shell / environment traps
- `rm` is aliased interactive in this shell; scripted `rm` silently no-ops. Use `command rm -f` and verify.
- `cwd` drifts into `~/clawd` mirror where edits auto-commit to main. Always use absolute paths.
- Never revert uncommitted code without explicit permission.

---

## Active Features and New Modules (2026-07-04 working state)

### Animals system
- Pig animal added across world systems (commit `670b17f`). Full module list in that commit.

### Asset store (build-v2 / dbAssets flag)
**`engine/world/00c-asset-store.js`** — `TWAssetStore` IIFE, `window.TWAssetStore`
- Per-asset DB-backed persistence choke-point, behind the `dbAssets` feature flag.
- API contract: `GET/PUT/DELETE /api/assets` (per-row, not whole-library JSON).
- LS cache keys: `tinyworld:asset-cache.v1:<id>` (write-through) + `tinyworld:asset-dirty.v1` (flush queue).
- Dirty queue drains with 1.5 s debounce + 60 s retry loop; stops when empty.
- `window.__tinyworldCloudApiCall` looked up lazily (module 30 may not have booted).
- Does NOT replace the whole-library cloud sync in `30-ui-boot-wiring.js`.

**`netlify/functions/assets.mjs`** — `/api/assets` endpoint
- Auth-gated. Asset classes: `stamp`, `template`, `model-stamp`, `world-asset`, `other`.
- Max 500 assets per profile; max 1 MB per asset data blob.
- Table: `user_assets(profile_id, asset_id, class, name, format, version, visibility, data JSONB)` — PK `(profile_id, asset_id)`.
- DDL self-heals on warm invocations via cached `ensureUserAssetsTable`.

**`netlify/database/migrations/20260704120000_user_assets.sql`** — migration file
- Creates `user_assets` table and `idx_user_assets_profile_class` index.
- Not yet applied to any environment; `assets.mjs` self-heals at runtime.

### Object capability registry (build-v2 / buildV2 flag)
**`engine/world/17b-object-capabilities.js`** — `TWObjectCaps` IIFE, `window.TWObjectCaps`
- Single lookup: `capsForKind(kind)` → `{style, color, colorRows, fenceStyle, buildingType, rotate, size, subEdit}`.
- Assembled lazily from existing constants: `isVoxelSubEditableKind`, `SELECTION_COLOR_EDITABLE_KINDS`, `selectionColorConfig`, `FENCE_STYLES`, toolbar variants.
- Fails open (returns `true` for rotate/size) on uncertainty.
- Loads after `09b`/`16`/`17` and before `19`/`28a`/`33`.
- Slice 1 code-complete; browser verify pending.

### Build v2 — related module changes
- `engine/world/00b-feature-flags.js`: `buildV2` and `dbAssets` flags added.
- `engine/world/01-render-core.js`: `voxelBevel` now OFF by default in `RENDER_DEFAULTS` (`'0'`); slider still present for opt-in.
- `engine/world/33-radial-menu.js`: ring now consults `TWObjectCaps.capsForKind()` to gate dead options when `buildV2` flag on. Color submenu was dead for 17 kinds; Style was dead for 7 kinds.
- `engine/world/28a-floating-agent.js`: panel Style row gated via `TWObjectCaps`.
- `engine/world/30-ui-boot-wiring.js`: preview-test impersonation block added (`mmo-preview` hostname).

### Collectibles / Tinyverse
- Pack-opened islands persist to Postgres (`collectibles` table + `/api/collectibles`), auth-gated, mirrors `builds.mjs`.
- localStorage is the local mirror; crosses economy gate.

### Skybound
- Phase 1 shipped: `engine/world/53-voxel-avatar.js` → `window.makeVoxelAvatar({seed})`.
- Voxel avatars swapped into `47-worlds-room.js` `createAvatar`; drives self + peers + bots.
- Fly-down: `engine/world/54-fly-down.js` (key `j`). Flooded planet: LandscapeEngine flood config with `waterLevel`/`freqScale` levers.
- Stargate: `engine/world/55-stargate.js` (key `G`) + gate transit `56-*.js` (key `h`).
- Chat emotes: `/wave /jump /dance /sit /crouch /attack` via `WS.sendChat` intercept → server relay → `animVoxel`.
- World notifications: module 68 (join/leave/chat/bot toasts + web notifications; opt-in bell in minimap header).
- CCTV: `62-cctv-truman.js` + `63-cctv-placement.js`; lobby screen cuts to hottest live feed.
- Lobby slide screen: `58-*.js` + PartyKit `present` slide-sync.
- Lobby population bots: `tools/lobby-bots.mjs` (PR #65); empty-token observers CAN move/chat/emote.
- AI bots: `tools/ai-bots.mjs` (`npm run bots:ai`); needs `openMode` + `grassCells` in `world.state`.

### Name labels
- Persistent player name pills above world-room avatars; billboard Sprite, lifted from `makeNameSprite`, +1.46 Y above avatar.

---

## Plan Files

### plans/asset-schema/ (4+ files)
- `00-localstorage-audit.md` — audit of ~205 legacy LS write sites across 27 engine files
- `01-REVIEW.md` — asset schema review
- `02-SPEC-tinyworld-asset-1.md` — spec for tinyworld-asset/1; `customParts` is the seed, 3Dpet is the reference
- `03-PLAN.md` — delivery plan; Phase 0 = `00c-asset-store.js` choke-point + CI ban

### plans/build-v2/ (5 files)
- `00-VISION.md` — capability-driven menus, Context Bar replaces ring for editing, Pen tool, Suggestions engine
- `01-ux-capability-audit.md` — dead-option matrix; ring color submenu was worst offender (17 kinds)
- `02-object-tile-coupling.md` — re-homing feasibility
- `03-proportions-audit.md` — numbers audit
- `04-PLAN.md` — slices 1–3+; slice 1 code-complete; slice 2 = Context Bar; slice 3 = Suggestions engine

### plans/ROADMAP-skybound.md
- Phases 1–6 game roadmap. Phase 1 (voxel avatars) shipped local-only.
- Phase 1b: network avatar descriptor. Phase 2: fly-down to planet surface. Phase 3: NPC settlements. Phase 4: real PvP battles. Phase 5: crafting loop. Phase 6: IK/ragdoll.

### plans/production-line/
- Autonomous multi-agent delivery loop; per-feature SPEC→BUILD(worktree)→adversarial-review→PR pipeline.
- ECONOMY LAUNCH GATE: economy PRs held until preview-ready.
- Mission-control dashboard at `mission-control.html`.

---

## Active Workflows and Capabilities

### Build v2 (slice 1 complete, browser verify pending)
- Capability registry + ring/panel gating code-complete.
- Browser verify checklist: stargate selection → no Color/Style; tree → both present; mixed multi-select → options hidden; `buildV2` flag off → byte-identical to v1 UI.
- Known stale-ring bug (ring doesn't rebuild when selected kind changes without deselect) — deferred to slice 2 Context Bar.

### Asset store (code-complete, not wired)
- `TWAssetStore`, `/api/assets`, and migration all written; none wired into stamp/template save-load paths yet.
- Next: integrate `TWAssetStore` calls into `engine/world/30-ui-boot-wiring.js` or dedicated stamp/template IO paths.

### Skybound (phase 1 shipped, phase 1b/2 not started)
- Voxel avatar peer path proven via synthetic signed-token client; voxel bot path not yet verified (bots blocked by observer-role gate).
- Avatar identity not networked: every peer renders the same default skin. Phase 1b adds `avatar` to `world.join` + presence.

---

## Open Threads Worth Remembering

- **Browser verify blocked**: Build v2 Slice 1 code-complete but unverified in real browser. See checklist above.
- **Asset store not wired**: `TWAssetStore` + `/api/assets` exist but zero stamp/template save-load call sites updated.
- **DB migration unrun**: `20260704120000_user_assets.sql` not applied to any environment; `assets.mjs` self-heals at runtime but migration should be committed for schema tracking.
- **`tools/localstorage-baseline.json` untracked**: CI allowlist snapshot must be committed alongside `tools/check.js` changes.
- **`plans/asset-schema/` and `plans/build-v2/`** directories are untracked locally — active planning docs.
- **Voxel avatar identity not networked**: Phase 1b scope. Every peer currently renders the same default skin.
- **`voxelBevel` default change**: existing users keep synced prefs; affects only new/reset users. Verify rendering-settings slider has no regression.
- **Stale ring bug (deferred)**: ring does not rebuild when selected object kind changes without full deselect. Fix surface is Context Bar (Slice 2) — do not patch the ring.

---

## Infrastructure Reminders

- Cluso widget is local-dev only; `cluso/` is gitignored; build guards forbid it in shipped HTML.
- `party/index.js` deploys via `partykit deploy`, not `./publish.sh`.
- Doc publishing: `docs/*.md` + `doc.html?file=` (auto-ships, allowlisted); `pypdf` for PDF extraction (no poppler dependency).
- Admin secret: `TINYWORLD_ADMIN_SECRET` must be set and `netlify dev` restarted for roadmap/features admin to work.
- `rm` alias trap: use `command rm -f` in scripts and verify deletion succeeded.
- World notifications implicit-join: seeding silently happens on `world.state` — no join message emitted for seed peers (differing peer IDs; seed on `world.state`).
