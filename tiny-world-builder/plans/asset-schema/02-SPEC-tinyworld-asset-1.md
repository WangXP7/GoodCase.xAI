# SPEC — `tinyworld-asset/1`

A single declarative JSON format for every pure-Three.js asset in tinyworld — buildings,
terrain, environment, foliage, artifacts/objects — rendered by one pipeline, editable by
builders (human + AI), and lockable for gameplay. Generalizes the proven `voxel-pet/1`
architecture (per-asset palette, slots of primitive ops, layers, keyframe animations,
bounds-clamped sanitizers) from the 3Dpet project.

Status: DRAFT v2 — envelope grounded in firsthand reads of
`engine/world/08-voxel-stamp-renderer.js`, `10-world-data.js`, `25-animation-loop-schema.js`,
`default_island.json` (v4), and 3Dpet `pet-schema.js`; corrected against the full 8-subsystem
audit (see 01-REVIEW.md). Key audit facts baked in: the world already has a CI-guarded JSON
Schema (`WORLD_SCHEMA` at 25:232-1112 ↔ `world.schema.json`, `tools/check.js:316`);
`customParts` is already a shipping generic parts format; `normalizeAppearance`
(04:2530-2705) is already a per-instance skin schema; animation precedents exist in-tree
(`70-animal-anim.js`, `53-voxel-avatar.js`).

---

## 1. Design rules (carried over from voxel-pet/1)

1. **Palette indirection.** Ops reference palette *keys*, never raw hex. Recolor = swap
   palette. (The current voxel-build stamps bake hex per voxel — the single biggest schema
   deficiency today.)
2. **Sanitize on ingest, never trust input.** Every numeric is clamped to declared bounds;
   unknown keys are dropped with warnings, not errors. LLM builders get `extractJSON`-style
   repair. This is what makes AI builders safe.
3. **Data describes intent, renderer owns technique.** The JSON says "box of `wall` at
   x,y,z"; the pipeline decides merging, instancing, LOD, shadows. Assets never carry
   Three.js objects.
4. **Layers are toggleable overlays** with categories and exclusivity rules (voxel-pet's
   `gear`/`coat` pattern → seasonal dressing, damage states, decoration sets).
5. **Everything versioned.** `format: "tinyworld-asset/1"` envelope; migration functions,
   never in-place mutation of old saves (the v4 `cells` format keeps loading forever).

## 2. Envelope

```json
{
  "format": "tinyworld-asset/1",
  "id": "machiya-house",
  "name": "Machiya House",
  "class": "building | object | foliage | terrain | environment | artifact",
  "tags": ["japan", "house"],
  "palette": { "wall": "#ECE4D2", "roof": "#3F494D" },
  "params": { },
  "parts": [ ],
  "voxels": [ ],
  "layers": { },
  "anchors": { },
  "animations": { },
  "behavior": { },
  "lod": { },
  "lock": { "editable": true, "sublock": [] }
}
```

`class` selects which blocks are meaningful and which sanitizer bounds apply. All classes
share palette/params/layers/lock; the geometry source differs.

## 3. Geometry blocks

### 3.1 `voxels` — chunky voxel grid (buildings, artifacts)
Direct upgrade of the existing voxel-build stamp format (`08-voxel-stamp-renderer.js:398`,
`normalizeVoxelBuildStamp`), with color → palette key:

```json
{ "voxels": [ [x, y, z, "wall"], [x, y, z, "roof", 0.1] ] }
```

Optional 5th element = per-voxel noise (voxel-pet's jitter shading). Existing stamps
migrate mechanically: hex color → auto-generated palette key via `paletteKeyMap`
(3Dpet `pet-schema.js:82`). Greedy-merge + single merged BufferGeometry stays the
renderer's job, as today.

### 3.2 `parts` — primitive ops (smooth objects, structures)
Direct adoption of the already-shipped `customParts` shape
(`08-voxel-stamp-renderer.js:327`, `normalizeVoxelCustomParts`) — box, cylinder, cone,
sphere, ellipsoid, cable — with `material` becoming a palette key (it already is a named
key into `VOXEL_PART_COLORS`; the change is per-asset palette override of the global
table):

```json
{ "parts": [ { "kind": "cylinder", "mat": "wood", "pos": [0,2,0], "size": [0.3,4,0.3] } ] }
```

### 3.3 `slots` + `sockets` — for rigged/animated/attachable assets
Kept exactly as voxel-pet/1 for entities, with the one structural generalization the
3Dpet audit identified: **slot topology moves from a global constant into the asset**.
Where pet-schema.js hardcodes `SLOT_BOUNDS` for one humanoid rig, a world asset declares
its own `sockets: { "door": {bounds, pivot}, "rotor": {...}, "chimneyTop": {...} }` —
a tree and a house don't share a rig. Sockets also replace today's ad-hoc effect
attachment points (`chimneyTops` userData field, 07:307; smoke silently breaks for
variants that omit it — sockets make attachment first-class).

### 3.4 Materials — palette entries + `shader:<id>` indirection
A palette entry is either a hex color or a material descriptor
`{ type: "lambert|standard|basic|shader:<id>", color, emissive?, opacity?, roughness?,
texture?: "<canvas-texture-name>", textureScale? }` — the exact prop-bag shape of the
existing `M` registry (~140 materials, 03:309-582). The 7 hand-written ShaderMaterials
(window interior, lamp/spot pools, glows, strata, waterfalls) are referenced by shader id
with JSON-parameterizable uniforms only; GLSL stays code. Procedural canvas textures
likewise stay code, referenced by name (the `MATERIAL_TEXTURE_OPTIONS` pattern,
04:1497-1550).

## 4. `params` — procedural parameter block

For asset classes that are generated, not authored op-by-op. Bounds live in a per-class
`PARAM_SCHEMA` (the analog of `JOINT_LIMITS`/`SLOT_BOUNDS`):

- **terrain**: seed, biome, gridSize (legal sizes [8,10,12,16,20]), waterLevel, freqScale,
  amplitude, plateau, cliffs, flood — the existing LandscapeEngine levers become the
  schema (they already are the schema in practice; today they're constructor args).
- **foliage** (scatter layer): `species` (asset ids), `density`, `seed`, `slopeMax`,
  `palette`, `windAmp`. Renderer does seeded scatter + bake/merge (57-poser-surface
  pattern: 1 draw call per species).
- **environment**: `time` (0-24), `sun` {azimuth, elevation, color}, `fog` {color, near,
  far, tracksBackground}, `sky` {palette}, `clouds` {mode: sea|cumulus, density, height},
  `weather` {kind: none|rain|snow|ash, intensity}, `waterFlow`.
- **building params**: `floors` (1-8, existing MAX_FLOORS), `footprint`, adjacency flags.

## 5. `animations` — declarative keyframes for world assets

voxel-pet/1 animation block verbatim (`dur`, `frames: [[t, pose]]`, `fx`), with pose
targets = declared slots/parts instead of body joints, plus world-specific channels:

```json
{ "Idle": { "dur": 2.4, "frames": [[0, { "sails": [0,0,0], "_sway": 0.02 }], ...] } }
```

Standard channels replace today's hardcoded kind checks (`25-animation-loop-schema.js:57`
tree/tuft sway): `_sway` {amp, freq, phaseFromGrid}, `_spin`, `_bob`, `_emit`
{smoke|dust|sparkle, rate}, `_lightPulse`. A `wind` group flag replaces
`windAnimatedPlantKinds` membership.

This is a convergence, not an invention — three animation systems already exist and
flatten onto this format: `70-animal-anim.js` (graze/walk/lie/idle joint-pose phase
machine), `53-voxel-avatar.js` (walk/jump/crouch/sit/climb/attack states), and voxel-pet's
`sampleAnim()` technique for flattening a procedural `fn(t)` into keyframe data.

## 6. `behavior` — gameplay hooks (lock-for-gaming)

Pure data, no code: `{ "harvestable": {...}, "collidable": true, "interact": "door|sit|gate",
"lightSource": {...}, "economy": {...} }`. The game runtime interprets; the builder just
edits. Locking:

```json
"lock": { "editable": false, "reason": "gameplay", "allow": ["palette"] }
```

Three modes end-to-end: **build** (all blocks writable), **edit** (sanitized ops through
the op-edit API, like 3Dpet `pet-op-edit.js`), **locked** (renderer may bake/merge
aggressively because geometry is immutable — this is also the perf win: locked assets go
into per-region merged meshes, the −70% draw-call lever from the perf findings).

## 7. Registry, storage, world reference

**Persistence doctrine (owner directive): the database is the source of truth.
localStorage is a cache, never a store.** No asset, world, or setting may exist only in
localStorage. Guests without auth get in-memory state and a sign-in prompt for durable
saves — not silent LS persistence.

- Asset registry: `assets/` JSON files (built-ins, shipped in dist) + user assets in
  **Postgres, one row per asset** — `assets(id, profile_id, format, class, name,
  data jsonb, version, visibility, updated_at)` — evolving the existing auth-gated
  `/api/assets` endpoint (today a single `asset_libraries` whole-library blob per
  profile, `netlify/functions/assets.mjs`). Per-row storage is what enables sharing,
  per-asset versioning, a public gallery/marketplace, and conflict-free concurrent
  sessions (the blob is last-write-wins today).
- Client access goes through ONE module — `asset-store` — the only code allowed to touch
  localStorage (write-through cache: serve cached, revalidate by `updatedAt`/ETag, queue
  dirty writes offline, replay on reconnect, server wins conflicts). A `tools/check.js`
  invariant bans `localStorage.setItem`/`twSafeSetItem` outside the allowlisted cache
  module — that's what makes the doctrine stick (205 write sites across 27 engine files
  today; each migrates or dies).
- Settings (RENDER_LS environment keys, editor prefs) route to the existing
  `/api/preferences`; world autosaves route to `/api/worlds` — LS keeps only the
  last-known copy for instant boot + offline.
- World cells reference assets by id, exactly like today's
  `{ "voxelBuildId": "voxel_fantasy_tree-enhanced", "objectScale": 0.83 }` extras in the
  v4 cells array — that mechanism generalizes unchanged; legacy `kind` strings become
  aliases into the registry (`"house"` → `asset:house-default` + `params.floors`).
- `world.v5` is **additive to v4, never a rewrite**: schema assets ride alongside the
  existing cell tuple as a new kind form / registry, exactly how `voxelBuildId` +
  `customParts` coexist today (`materializeCustomPartCells`, 29:217-251). The embedded
  `WORLD_SCHEMA` ↔ `world.schema.json` CI byte-identity check (`tools/check.js:316`)
  extends to the new asset schema doc. The **sanitizer is the runtime contract**
  (3Dpet lesson: its schema doc drifted from its sanitizer because nothing validated
  against the doc — here the doc is generated from / checked against the sanitizer).
- All three persistence surfaces move together or not at all: localStorage, cloud
  (`__tinyworldSyncAssetsToCloud`), multiplayer wire — plus the server-side enum mirrors
  (`netlify/functions/lib/worlds.mjs`, `party/index.js`).

## 8. Renderer contract (single pipeline)

One function: `renderAsset(def, ctx) -> { group, tick?, dispose }`.
- Resolves palette → cached materials (per-hue material cache like
  `voxelBuildMaterialCache`, keyed by resolved hex + shading tier).
- Geometry source by class: voxels → greedy-merged BufferGeometry; parts → primitive
  factory; params → procedural generator (terrain/foliage/environment adapters).
- `ctx` carries quality tier, lock state, seeded RNG, and time-of-day bindings.
- Animations compile to a per-asset `tick(t, dt)` only when the asset has animation
  channels; static assets return no ticker and are eligible for region baking.

## 9. Builders

- **Manual**: existing voxel builder + sub-object edit (44) grow palette editing and
  layer toggles.
- **AI**: the 26-ai-generation contract moves to emitting `tinyworld-asset/1` JSON,
  sanitized on ingest (same trust boundary as 3Dpet `pet-builder-ai`). Edit = op list
  (`pet-op-edit` pattern): `{op: "add-part"|"recolor"|"set-param"|"toggle-layer", ...}`
  so LLM edits are small diffs, not full regeneration.

---

*Companion docs: `01-REVIEW.md` (audit findings), `03-PLAN.md` (phases).*
