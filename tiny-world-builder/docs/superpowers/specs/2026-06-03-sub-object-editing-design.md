# Sub-Object Editing Suite — Foundation Design (reqs 6, 7, 8, 9)

Date: 2026-06-03
Status: In progress (slices 3–6 of the editing-system overhaul)
Builds on: 2026-06-03-object-inspector-design.md (slices 1–2 done)

## The reqs
- 6: hover over the selected object → web-inspector-style highlight on editable sub-parts.
- 7: explode view — parts fly outward/upward into a sphere for inspection/editing.
- 9: select a sub-part → move/size/edit it within the model; save override locally.
- 8: manipulate/add/remove voxels + push/burst/smooth. (voxels + mesh deform, all types — see wall below.)

## Load-bearing constraint (from exploration)
Automatic batching — `optimizeVoxelObjectGroup` (`09b:432`) — collapses per-voxel/per-part
meshes into `InstancedMesh`, destroying sub-part addressability. It bails early when the
root has `userData.noVoxelBatch` (`09b:433`). So: **the actively sub-edited object renders
un-batched; everything else stays batched (perf).**

## Stable part identity (critical — never array index)
Sculpting adds/removes voxels, shifting array order; positional/index keys would reattach
saved overrides to the wrong part after reload. Keys:
- voxel-builds → `v:<x>,<y>,<z>` (the voxel's grid coord)
- custom parts → `p:<customParts[].id>` (already has an id)
- houses → role id (`wall`, `roof`, `chimney:0`) — door/window/chimney are conditional and
  shift positional order with buildingType/features.
Stamped into each child mesh `userData.partKey` at build time (only on the editable path).

## Mesh-deform feasibility wall (req 8)
Houses/trees/rocks regenerate from parameters every `setCell` render — no stable vertex
channel to persist push/smooth deltas. Literal "deform other objects" is NOT buildable on
this architecture. Fork surfaced to user: (a) voxel-builds get true add/remove/push/smooth;
(b) non-voxel objects "voxelize-on-sculpt" → editable voxel proxy; (c) out of scope.
Recommendation a+b. Req 8 is last; does not block 6/9/7.

## Persistence
Per-part overrides live on `appearance.parts` (object keyed by partKey), registered in the
`normalizeAppearance` allowlist (`04-textures.js`) so they persist via the existing per-cell
save and key the material cache. Verification gate for req 9: set override → reload →
re-render → confirm it reattached to the SAME visual part.

## Reused systems
Raycaster (`18-scene-pick-xr.js`), `addObjectOutline` (works on a single mesh, `12:216`),
opacity/drop tweens (`15`/`16`, `25` loop), appearance persistence (`29`).

## Slice plan
- **Slice 3 (req 6)**: foundation — editable (un-batched, part-keyed) render path for
  voxel-builds + sub-mesh raycast + hover outline. Home board first.
- **Slice 4 (req 9)**: sub-part select + transform (move/scale within model) + `appearance.parts`
  persistence with reattach-on-reload verification.
- **Slice 5 (req 7)**: explode view (animate parts outward into a sphere; click a part to edit).
- **Slice 6 (req 8)**: voxel sculpting (add/remove/push/smooth on the voxel array) + the a/b/c
  resolution for non-voxel objects.

All gated by `window.__tinyworldFlags.inspectorV2`.

## Status & verification (2026-06-03)
Implemented + verified live (real app, 3D-math probes), all flag-gated, home-board voxel-builds:

- **Slice 3 — req 6 (hover):** editable render un-batches (1259 separate meshes vs 9
  InstancedMeshes) + stamps stable `v:x,y,z` keys; sub-mesh raycast picks the correct
  part; hover outlines it and clears on leave. Fixed a state bug (highlightPart was
  nulling currentHoverPart) caught by verification.
- **Slice 4 — req 9 (sub-part transform):** click-select a part; move/scale persist to
  `appearance.parts[key]`. GATE PASSED: after reload, override reattached to the SAME
  voxel (renders visibly larger than neighbor).
- **Slice 5 — req 7 (explode):** parts animate radially out + up (radial 1.8→3.9, lift
  +2.9) and collapse back to base (drift 0.001). Fixed base-capture drift (capture only
  from collapsed state).
- **Slice 6 — req 8a (voxel sculpt):** add/remove voxels (1259→1258→1259 by stable key)
  + smooth (neighbor-offset relax); push = movePart, burst = scalePart. GATE PASSED:
  add/remove persist across reload and reattach by stable key.

Entry point: select a single voxel-build with inspectorV2 on → inspector "Edit parts"
toggle. Then hover/click parts; Transform→Part move/size; Edit→Voxel remove/smooth, Add
voxel; Edit→Explode. Window API: `window.__tinyworldSubEdit`.

## Scope delivered vs. requested (read this first)
Reqs 6/7/8/9 are delivered **for home-board voxel-builds whose stamp is voxel-based.**
The "Edit parts" affordance is GATED to exactly those configs (verified: shows on a home
voxel stamp; hidden on island voxel-builds and on customParts stamps) so it is never
offered where it would no-op.

NOT built (the user's "all object types" answer + req 8 "other objects" cover these):
- **All object types (reqs 6/9):** houses/trees/rocks have no sub-part hover/select/
  transform. Needs role-based part-keys (`wall`/`roof`/`chimney:0`) stamped in the house/
  primitive factories + an editable (un-batched) path for them. Multi-slice follow-up.
- **customParts voxel-builds:** `makeCustomPartsStamp` (09b:358) has no `editable`/key
  path; would need `p:<id>` keys + noVoxelBatch added there.
- **Island sub-object editing:** `subEditObject()`/`enterSubEdit` use the home-only
  `cellMeshes` path; islands render elsewhere.
- **req 8 (b) non-voxel mesh-deform:** "voxelize-on-sculpt" proxy for houses/trees —
  large; awaiting go/no-go. Option (c) = leave out of scope.

These are the next chunk to greenlight, not silently absorbed into "done".
