# REVIEW — How schema-ready are tinyworld's pure-Three.js asset definitions?

Audit of buildings, environment, terrain, foliage, and artifacts/objects against the goal:
encapsulate everything into a `voxel-pet/1`-style declarative JSON schema feeding one
rendering pipeline with build / edit / lock modes and AI builders. GLB paths excluded.

Method: 8 parallel subsystem readers (sonnet) over ~30k lines, adversarial gap critic,
opus phase-planning pass, fable synthesis. Every claim below carries a file:line citation
from the underlying reports.

---

## Verdict

**The bones are better than expected — overall readiness ~3/5, and the two most important
pieces already exist in production:**

1. **The world model is already a versioned JSON schema.** `WORLD_SCHEMA` is a genuine
   JSON Schema (draft 2020-12) embedded at `25-animation-loop-schema.js:232-1112`,
   CI-enforced byte-identical to `world.schema.json` (`tools/check.js:316`), doubling as
   the AI-generation contract and Anthropic tool `input_schema` (`26-ai-generation.js:184,558`).
   Saved worlds (v4 cell tuples + `appearance` + `extras` + `customParts`) round-trip
   through localStorage, cloud/Postgres, URL params, AI output, and multiplayer snapshots
   today (`29-persistence-api.js:89-755`).
2. **A generic primitive-parts asset format already flows end-to-end.** `customParts`
   (`08-voxel-stamp-renderer.js:327-389`) — box/cylinder/cone/sphere/ellipsoid/cable with
   named materials, sizes, positions — is validated, persisted, cloud-synced, imported,
   AI-authorable, and rendered by one dispatch function (`09b:379-435`). This is the
   voxel-pet "slots" concept already shipping. The voxel stamp library
   (`{id,name,voxels:[{x,y,z,color}],footprint}`) is its chunky sibling.

**What's genuinely missing** is palette indirection (colors are baked hex, roles inferred
by regex — `09b:88-115`), declared slots/sockets, an asset-level registry (today assets
live per-cell), declarative animation (all world animation is imperative and kind-keyed —
`25:57-68`), and data-driven definitions for buildings, foliage, and terrain species,
which are bespoke imperative functions.

## Per-subsystem readiness (1 = full rewrite, 5 = serializable today)

| Subsystem | Score | One-line assessment |
|---|---|---|
| World model / persistence | **4** | Already a CI-guarded JSON Schema; cell = kind selector + params + appearance overrides + customParts. The strongest foundation. |
| Voxel builds (stamps + customParts) | **4** | Already flat JSON round-tripping all three persistence surfaces. Docked for: two disjoint palettes (`C{}` 08:8-30 vs `VOXEL_PART_COLORS` 08:253-308), regex-inferred recolor roles, frozen built-ins, zero animation. |
| Tiles / materials / textures | **3** | `M` = ~140 flat material prop-bags (03:309-582) → trivially JSON; 7 hand-written ShaderMaterials need `shader:<id>` indirection with JSON-only uniforms. `normalizeAppearance` (04:2530-2705) is already a per-instance "skin" schema persisted via `serializeCell`. Procedural canvas textures stay code, referenced by name. |
| Environment / weather / time | **3** | Slider state + `captureEnvState()` wire format are already flat JSON (score 5 alone). Time-of-day is already a keyframe anchor array (`30-ui-boot-wiring.js:3060-3067`) but night logic exists in 3 drifted copies. Light rig topology and particle systems are imperative. |
| Buildings | **2** | Layout data (linear plans 07:199-207, composite topology 16:372-451, castle neighbors) is clean JSON; all visual geometry is bespoke imperative functions (cottage/manor/tower/skyscraper each hand-written, 07:220-938) sharing module constants `H` (07:8-14). Two parallel renderers exist (smooth 07 vs voxel 09b) — schema must pick or cover both. |
| Terrain | **2** | `BIOMES` table (LandscapeEngine.js:88-137) and flood/planet params are near-JSON already; but terrain is a sampled heightfield + GLSL, not parts — the honest schema is a **generator-parameter profile**, not slots-of-boxes. Monolith-vs-mixin duplication is known/accepted (see memory), not a fresh blocker. |
| Foliage / props | **2** | `treeVox` species recipes (57:181-243) are hardcoded per-species voxel painters with inline palettes; scatter counts are magic numbers; **zero edit/persistence surface** — foliage is built once at load. Distant-dressing placements (13:100-111) are already `{x,z,y,s,r}` data. |
| 3Dpet reference itself | **4** | The sanitizer (`sanitizePet`, pet-schema.js:173-259) is the real contract — clamps/drops, never throws. Caveats to import: `docs/pet.schema.json` is documentation only (nothing runtime-validates against it), and the built-in characters are NOT natively in the schema — they reach it via a lossy recording-box flatten (voxel-pet.html:938-963). |

## Convergent finding (independent from 3 readers)

**Built-in content everywhere is a frozen snapshot of a one-time code run.** The 14 voxel
stamps bake closures to data at boot (08:252); 3Dpet's own built-in characters flatten
through a recording box; house/foliage/terrain recipes exist only as code. Flattening to
JSON loses re-parameterization (pagoda tier count, seeded species variety); keeping code
means the schema never covers built-in content. This is THE central design tension —
resolved per class in the plan (freeze where variety is fake, keep parameterized
generators where it's real, schema stores generator id + params).

## What the audit initially missed (gap critic, verified)

- **`53-voxel-avatar.js` + `49-worlds-avatar-picker.js` are the closest in-house analog
  to voxel-pet/1** (palette + per-attribute customization + walk/jump/crouch/sit/climb
  animation states) — the entity side of this schema effectively already has a prototype
  in-tree.
- **"No animation model exists" is narrowly true but broadly false**: `70-animal-anim.js`
  is a live joint-pose phase machine driving `makeVoxelAnimal` rigs via
  `group.userData.anim`. The plan converges these + voxel-pet's `sampleAnim` flattening
  onto one serializable clip format.
- Out-of-scope asset classes flagged for later arcs: vehicles/flight/combat (~5-6k lines),
  shield system, GLB/model stamps + drag-drop import, economy data path (LAUNCH GATE),
  social props (benches, emote layer).

## Cross-cutting constraints no subsystem owns (these shape the plan)

1. **Three persistence surfaces must agree**: localStorage (`STORAGE_VERSION`, stamp key
   suffix), cloud/Postgres (`__tinyworldSyncAssetsToCloud`), multiplayer wire
   (`buildWorldStateObject`/`captureEnvState`). A schema field missing on any one is a
   replication bug. Three different migration philosophies exist today (gated IIFE /
   bump-and-wipe / key-suffix).
2. **CI governance is real**: `tools/check.js` enforces no-duplicate globals (no bundler;
   ~90 files share one namespace in numeric load order) and embedded-vs-file schema
   byte-identity. New schema modules need a load-order slot before `05-tile-factory.js`
   and `29-persistence-api.js`, plus new check invariants.
3. **The app ships `dist/`**, not source — `publish.sh` must copy any new schema/manifest
   or it silently doesn't ship (known trap, see memory).
4. **Perf budget is tight and measured** (render-bound; −70% draws from region bake).
   Generic indirection must not blow the material-variant caches (1024/64/256,
   evict-never-dispose) or regress InstancedMesh batching; per-instance recolor already
   forks materials by design.
5. **Server-side schema consumers**: `netlify/functions/lib/worlds.mjs` derives
   tile/pricing counts from the v4 format; `party/index.js` mirrors enums for validation.
   Schema changes have anti-cheat/pricing blast radius.
6. **Feature flags** (`00b-feature-flags.js`, 26 flags, everyone/admin gating) are the
   rollout mechanism — every phase ships admin-gated first.

## The five hard problems (in priority order)

1. **Frozen-snapshot vs regenerative tension** (above) — decide freeze-vs-generator per
   asset class, explicitly.
2. **Perf under indirection** — locked assets must bake/batch at least as well as today;
   edit mode pays the addressability cost, locked mode gets the draw-call win.
3. **Vocabulary unification** — 4+ drifted kind/material/palette vocabularies
   (`WORLD_SCHEMA` kinds vs `validateWorld` okKind vs AI prompt prose vs island-generator
   internals; two voxel palettes; mesh-terrain MATERIALS vs BIOMES strata) need one
   CI-guarded source of truth.
4. **Lock semantics across 4 subsystems** that today have four different "edit mode"
   concepts (voxel `opts.editable`, world `userEdited` provenance, mesh-terrain sculptor
   state, environment slider state). Note `opts.editable` un-batched vs
   `optimizeVoxelObjectGroup` InstancedMesh (09b:437-616) IS the build/edit-vs-lock
   duality already — generalize it, don't invent.
5. **Cross-surface migration governance** — highest blast radius, least glamorous;
   nothing ships until all three persistence surfaces + server mirrors move together
   behind a flag.

---

*Full structured findings: workflow `wf_c1c5a6d4-412` journal; salvaged buildings report
in session scratchpad. Companion docs: `02-SPEC-tinyworld-asset-1.md`, `03-PLAN.md`.*
