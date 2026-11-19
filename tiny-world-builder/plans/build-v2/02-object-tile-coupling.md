# Object/Tile Coupling Audit (read-only)

Scope: where an object's position lives today, how far it can move from its
home cell, and what a "drag a lamp anywhere, it re-homes to the tile it lands
on" feature would require. No code changed.

## 1. Today's model

Storage is a sparse 2D array, one entry per integer grid cell, one object
"kind" per cell:

- `engine/world/10-world-data.js:6-26` — `world[x][z]` holds the cell
  *intent* (terrain, kind, floors, etc). `cellMeshes` / `cellMeshesGrid` hold
  the *rendered* meshes for that same `x,z` key (`{ tile, object, extras }`).
  Position identity is the array index, not a coordinate stored on the object.

- `engine/world/17-tile-renderers.js:697` (`setCellImpl`) is the single
  mutator. It writes `world[x][z] = { terrain, kind, floors, buildingType,
  fenceSide, extras, rotationY, offsetX, offsetY, offsetZ, appearance,
  economy, waterFlow }` and returns.

Sub-tile transform already exists and is exactly what the owner is asking to
generalize:

- `engine/world/21-object-transform-voxel-build.js:1137-1143`
  (`transformLimitsForCell`) — `{ xz: 0.48, yMin: -0.75, yMax: 2.5 }`.
- `engine/world/21-object-transform-voxel-build.js:1189-1198`
  (`moveSelectedBoardObject`) — arrow-key nudge, clamps `offsetX`/`offsetZ`
  to `±0.48` tile-widths and `offsetY` to `[-0.75, 2.5]`, then calls
  `updateSelectedBoardObject` → `setCell(x, z, { ...offsetX, offsetY,
  offsetZ })`.
- Applied to the actual mesh in `engine/world/17-tile-renderers.js:469-485`:
  `mesh.position.set(posX + userOffsetX, objectY + userOffsetY, posZ +
  userOffsetZ)` — the offset is a raw world-unit delta added on top of the
  tile's base render position, in the same units as tile spacing (1.0 = one
  tile width).

**There is no drag-to-move / cross-tile relocation anywhere in the codebase
today.** Grepped for `moveObjectTo`, `relocateCell`, `dragObject`,
`onDragEnd` etc. across `engine/world/*.js` — no hits. The only existing
"move" is the keyboard nudge above, and it is deliberately clamped to never
leave the home tile (0.48 < 0.5).

### The tuple format (persistence)

`engine/world/05-tile-factory.js:1294-1303` (`serializeCell`, array/tuple
branch) and the read side in `engine/world/29-persistence-api.js:403-457`
confirm the wire shape:

```
[x, z, terrain, kind, floors, buildingType, terrainFloors, fenceSide, extras, transform, appearance, waterFlow]
  0  1    2       3      4        5              6            7        8       9           10          11
```

`transform` is a 4-element sub-array: `[rotationY, offsetX, offsetZ,
offsetY]` (note the z/y order). It's only present when non-zero
(`hasTransform = ry || ox || oz || oy`), so most cells omit it entirely.
`netlify/functions/lib/worlds.mjs:33` (`worldCellKind`) independently reads
`cell[3]` for the tuple form, confirming index 3 = kind server-side too.

## 2. How far can an object be offset today, and what breaks past a tile boundary

Today: nothing breaks, because it's structurally impossible to cross — the
`xz: 0.48` clamp in `transformLimitsForCell` keeps every offset object
strictly inside its own tile's footprint (tile width is 1.0 unit; 0.48 is
just short of the 0.5 boundary). This is clearly an intentional "stay
visually on your tile" guard, not an incidental one.

The load-bearing fact for the re-homing design: **every system that reads
position keys off the integer `world[x][z]` grid index, never off the
rendered offset.**

- Adjacency (`engine/world/16-drop-anim-adjacency.js`): `getWorldCell(x, z-1)`
  etc. everywhere (`getPathNeighbors`, `getTerrainNeighbors`,
  `getFenceNeighbors`, `bfsHouseCluster`, `findFenceRenderSpan`) — all probe
  the neighboring integer cell's stored `kind`/`terrain`, with zero
  reference to `offsetX/Y/Z`.
- Economy/inventory counts (`netlify/functions/lib/worlds.mjs:213`
  `deriveResourceStats`) — buckets cells into a `byXZ` Map keyed by
  `Math.round(x) + ',' + Math.round(z)` read straight off each cell's stored
  `x`/`z` (or tuple `[0],[1]`). Also used for water/fish contiguous-region
  flood fill (lines 232-252), same key.
- Preview/list payload (`worlds.mjs:374` `worldPreview`) — same, `x`/`z`
  straight off the cell.
- Crop/pumpkin hot-path indexes (`engine/world/10-world-data.js:49-51,90-150`
  `cropPositions`, `maxPumpkinPositions`, `carriagePumpkin`) — keyed by
  `'x,z'` string, maintained inside `setCellImpl` itself
  (`17-tile-renderers.js:777-784`).
- Smoke/light registries (`registerRuntimeObject` /
  `unregisterRuntimeObject`, `10-world-data.js:53-81`) — keyed by mesh object
  reference, not position; tied to mesh create/dispose lifecycle.
- Multiplayer sync (`engine/world/38-multiplayer-partykit.js:2662-2666`) —
  listens for the generic `tinyworld:world-changed` event (fired once per
  `setCellImpl` call, always carrying that call's own `x,z`) and relays a
  `cell.set` snapshot for that single cell to peers.

So today's clamp isn't preventing some other system from breaking — it's the
*only* thing standing between "sub-tile nudge" and "free placement." Nothing
downstream currently has logic conditioned on the offset ever exceeding tile
width, because it never can.

## 3. Minimal re-homing design

Verdict: **additive, no serialization format change.** Re-homing is "write
the same tuple shape under a different `(x,z)` key," which is exactly what
`setCell` already does on every call.

Proposed drag-end flow:
1. Compute the containing tile from the drag's final world position:
   `bx = Math.round(worldX)`, `bz = Math.round(worldZ)` (mirrors the
   existing `Math.round(a.obj.position.x + GRID/2 - 0.5)` pattern already
   used in `16-drop-anim-adjacency.js:155-156,181-182` for impact-dust/ripple
   origin — i.e. "nearest cell" math already exists in the codebase).
2. Read the full intent from the source cell A (`getWorldCell(ax, az)`).
3. Residual offset for the new home = `worldPos - tileCenter(bx,bz)`,
   re-clamped through the existing `transformLimitsForCell` (so a drag that
   lands near a tile edge still gets a small in-tile nudge, not a jump to
   dead-center).
4. `setCell(bx, bz, { ...sourceIntent, offsetX: residualX, offsetY, offsetZ,
   rotationY: preserved })` — writes B.
5. `setCell(ax, az, { kind: null, ... })` — clears A (an ordinary erase,
   same code path as today's erase tool).

Why this needs no hook per system, verified against the actual
`setCellImpl` body (`17-tile-renderers.js:697-950`):

- **Adjacency refresh already runs per-call, keyed off that call's own
  `(x,z)`.** `setCellImpl` builds a `toRefresh` map from `x,z`'s own
  4-neighbors, house cluster BFS, and fence-component flood fill (lines
  869-933) *every single time it's invoked*. Two ordinary `setCell` calls
  (clear A, place B) each independently trigger the correct neighbor
  refresh at their own end — both the vacated tile's old neighbors and the
  new tile's neighbors repaint correctly with no new code.
- **Crop/pumpkin index sets update automatically** (lines 777-784,
  `wasCrop`/`isCrop`, `wasMaxPump`/`isMaxPump` diffed against `prev` inside
  the same call).
- **Economy/inventory counts are transparent** — `deriveResourceStats` and
  `worldPreview` re-derive from `data.cells` by scanning each cell's own
  `x,z` every time; they have no memory of "where the lamp used to be."
- **Multiplayer sync is transparent but non-atomic** — `notifyWorldChanged`
  fires once per `setCellImpl` call, so a move becomes *two* `cell.set`
  messages to peers (clear A, then place B) rather than one atomic "move"
  message. Order matters (place B before clear A, or peers briefly see
  neither cell occupied) — worth sequencing deliberately even though no
  protocol change is required.
- **Smoke/light registries are transparent** — tied to mesh
  create/dispose, which happens naturally when A's mesh is torn down and
  B's is built.

The one system that is **not** automatically transparent: the
`transformLimitsForCell` clamp itself, and by extension the drag-input code
(wherever a pointer-drag handler would live — none exists yet) needs new
logic to decide "this drag exceeded the home tile's half-width, re-home
instead of clamp," rather than just clamping. That's new behavioral code,
not a data-model change.

## 4. Collision case (target tile already occupied)

`extras[]` does **not** already support arbitrary secondary objects like
lamps. Confirmed in two places:

- `engine/world/29-persistence-api.js:438-445` (`normalizedExtras`) —
  `.filter(e => e.kind === 'fence' || e.kind === 'tuft')`. Any other kind
  read from a tuple/import is silently dropped.
- `engine/world/17-tile-renderers.js:541-544` (`renderCellExtrasImpl`) only
  builds a mesh for `ex.kind === 'tuft'` or `'fence'`; anything else falls
  through to `mesh = null` and is skipped.

Extras also carry a much smaller field set (`{kind, fenceSide, floors,
appearance}` — see the tuple mapping at `05-tile-factory.js:1257-1262`) with
no `offsetX/Y/Z` of their own; fence/tuft extras get fixed corner positions
computed inline (`17-tile-renderers.js:549-559`), not a general sub-position.

Options for a lamp dragged onto an occupied tile:
- **Reject with feedback** (recommended MVP) — no format change, no new UI
  beyond a toast/snap-back. Matches the existing one-kind-per-cell
  invariant everywhere else in the codebase (setCell always fully overwrites
  `kind`).
- **Extend extras to a general secondary-object slot** — bigger lift: extras
  would need their own `offsetX/Y/Z`/`rotationY`, the persistence filter
  would need new allowed kinds, `renderCellExtrasImpl` would need a real
  mesh-factory dispatch instead of the two hardcoded branches, and the
  "how many objects can a tile hold" invariant changes everywhere it's
  currently assumed (selection tool, economy counts, inspector). Treat as a
  separate, later feature — not needed for the "move a lamp to an empty
  spot" requirement as stated.

## 5. Risk list for shipping this behind buildV2 with zero v4 format change

- **Confirmed**: re-homing is "the same 12-slot tuple, written under a
  different `x,z` key." No new tuple slot, no version bump. Verified against
  both the write side (`serializeCell`) and read side
  (`29-persistence-api.js:403-457`) — both are keyed purely by whatever
  `x,z` the entry declares, with no assumption that a given kind stays at a
  fixed cell across saves.
- **Adjacency refresh correctness depends on calling ordinary `setCell`
  twice**, not on mutating `world[][]` directly. Any re-homing
  implementation that pokes the array bypassing `setCellImpl` will silently
  skip the neighbor-refresh/index-set maintenance described in §3.
- **Multiplayer message ordering**: two `cell.set` broadcasts per move
  (place-then-clear vs. clear-then-place) — pick place-before-clear so peers
  never observe a frame where the object exists nowhere.
- **Collision policy is undecided and has no format support today** — must
  ship an explicit reject (or a separate extras redesign); don't let a drag
  silently overwrite whatever was on the target tile.
- **Drag-detection/re-home threshold is new code**: `transformLimitsForCell`
  is currently a hard clamp; it will need a paired "has this drag exceeded
  the tile" check that doesn't exist anywhere yet (no drag handler exists at
  all today — this is 100% new input code, separate from the storage-model
  question).
- **House clusters and fence spans use anchor cells** (`findHouseCluster`,
  `findFenceRenderSpan`) — re-homing an anchor cell (not just a leaf) needs
  the same BFS-based anchor recompute that already runs on any ordinary
  edit; no special case needed since it's cheap and already runs per
  `setCell` call, but worth calling out in QA (moving a multi-cell house is
  out of scope — houses/fences are multi-cell *composites*, only the
  anchor cell root would move, not the whole footprint).

## Bottom line

Today: sub-tile offset exists (`offsetX/Y/Z`, `rotationY` on the cell
intent, clamped to `±0.48`/`[-0.75,2.5]`, applied directly to mesh position
in `17-tile-renderers.js:485`), but nothing lets an object cross into
another tile — no drag feature exists at all yet. Every system that could
plausibly care about "home cell" (adjacency, economy/resource counts, crop
and pumpkin indexes, multiplayer sync) already keys strictly off the
integer `world[x][z]` grid index and already re-derives itself per
`setCell` call, so a re-homing move implemented as **clear source cell +
write destination cell, both through the existing `setCell` API** is
additive and needs zero v4 serialization changes. The two things that don't
already exist and must be built are: (1) actual drag-and-drop input/handler
code (there is currently none — only keyboard nudge), and (2) a collision
policy for landing on an occupied tile, since `extras[]` today is
hardcoded to fence/tuft only and cannot host an arbitrary second object.

Report path: `/Users/jkneen/Documents/GitHub/tinyworld/plans/build-v2/02-object-tile-coupling.md`
