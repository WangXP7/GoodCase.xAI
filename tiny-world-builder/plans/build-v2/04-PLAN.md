# Build v2 — Delivery Plan

Everything behind the `buildV2` flag (registered in 00b, admin-gated). Flag off =
byte-identical v1. Each slice independently shippable; `npm run check` green at every
step; UI slices are not "done" until verified in a real browser (project rule).
No man-days. Staffing per the production pattern: opus expands a slice when it starts,
sonnet builds, haiku does mechanical table work, fable gates design + reviews diffs.

Grounding docs: 00-VISION.md (interaction model), 01-ux-capability-audit.md (dead-option
matrix + registry sources), 02-object-tile-coupling.md (re-homing feasibility),
03-proportions-audit.md (numbers; pending at plan-writing time).

## Landed already (this session)

- `buildV2` flag registered (00b, three points).
- Voxel bevel OFF by default (`01-render-core.js` RENDER_DEFAULTS.voxelBevel '0');
  rendering-settings slider unchanged for opt-in; prior users keep synced prefs.
- Slice 1 CODE-COMPLETE: `17b-object-capabilities.js` registry (assembled lazily from
  isVoxelSubEditableKind / SELECTION_COLOR_EDITABLE_KINDS / selectionColorConfig /
  FENCE_STYLES / toolbar variants; fails open on uncertainty) + ring root filtering +
  panel Style guards fixed. Flag-off paths textually identical. Awaiting browser verify
  (checklist in caps-builder report: stargate → no Color/Style; tree → both; mixed
  multi-select hides; flag off unchanged).
- Known gap carried to Slice 2: the root ring does not rebuild when the selection's
  kind changes without a full rebuild trigger — with kind-gating this can show a stale
  ring (tree → stargate without deselecting). The Context Bar replaces the surface, so
  fix it there, not in the ring.

## Slice 1 — Capability registry + gated menus (kills dead options)

`capsForKind(kind)` assembled from the constants that already encode the truth
(TW_VOXEL_SUBEDIT_BUILTIN_KINDS for style/subEdit, SELECTION_COLOR_EDITABLE_KINDS +
selectionColorConfig for color, FENCE_STYLES, toolbar buildingType list). Ring color
submenu (dead for 17 kinds — worst offender) and panel Style row (dead for 7 kinds —
the reported bug) consult it when the flag is on. New file loads between 17 and 19.
Exit: stargate selection shows no Color/Style anywhere; tree shows both; flag off
identical. Browser-verify before enabling for everyone.

## Slice 2 — Context Bar (ring demoted to placement)

New surface per 00-VISION.md: anchored popover/bottom-sheet on selection; row 1
capability chips (from the same registry — Rotate, Floors stepper, Style variants with
thumbnails, Color rows named by selectionColorConfig), row 2 suggestions (slice 3),
row 3 Delete/Duplicate/Pick-up. One level deep, never nested — directly addresses the
audit's facts: permanent 9-button ring density, 2-hop depth, no breadcrumb, dead
options indistinguishable. Free win folded in: surface fenceStyle 'gate' (real, working,
currently unreachable by any picker — build variant lists from FENCE_STYLES, not the
toolbar copy). Dedup the two literal copies of the buildingType list (toolbar 19:15-20
vs panel 28a:1623-1629) into the registry. Ring keeps quick-placement only when the
flag is on; untouched when off. i18n: all new labels go through the tinyworld-i18n
pipeline (5 locales) before ship.

## Slice 3 — Suggestions engine

> STATUS: CODE-COMPLETE (33c-build-suggestions.js). Two rules shipped:
> fence-near-tower -> "Change fence run to castle wall?" (flood-fills the
> contiguous run, sets fenceStyle 'castle' — a new opt-in value; isCastleFence/
> isTurretHouse resurrected in 16 as explicit-field detectors, NO adjacency
> inference, v1-safe since nothing in v1 can set 'castle'); fence-closes-loop
> -> "Add a gate?" (fenceStyle 'gate', real since forever, finally reachable).
> fenceStyle enum updated in BOTH WORLD_SCHEMA and world.schema.json (CI
> byte-identity intact). REVIEW CATCH (fable): the agent's accept-actions
> called setCell with a bare {appearance} patch — setCell is FULL-INTENT and
> would have DELETED the fences; fixed to route through
> updateSelectedBoardObject (the proven partial-patch writer). Lesson recorded:
> all programmatic cell edits must go through updateSelectedBoardObject or
> carry the full cell spread.

Data table SUGGEST rules (see 00-VISION.md) evaluated on placement/selection; offers
render as ONE dismissible chip in the Context Bar; accepting executes batched setCell
edits (undo-compatible). First rules: fence-adjacent-to-tower/castle → convert run to
wall; closed fence loop → offer gate; house-adjacent-to-house → offer composite merge;
lamp-near-path → align. Rules read the same adjacency helpers 16-drop-anim-adjacency
already uses (getCastleWallNeighbors etc. — note isTurretHouse/isCastleFence are
currently hardcoded false; the fence→wall rule gives that dormant path a real entry
point).

## Slice 4 — Pen tool

> STATUS: CODE-COMPLETE (20b-pen-tool.js + toolbar/pointer integration). Pen
> registers through the EXISTING flag-tool mechanism (TW_FEATURE_FLAG_TOOL_IDS
> buildV2->'pen' — same system as spotlight/lava). Stroke capture with
> Bresenham gap-bridging; chooser chips at stroke midpoint (Fence/Path/Hedge/
> Cancel); apply temporarily selects the real tool and calls applyToolToCell —
> the SAME function normal paint-drag uses, so terrain rules/fenceSide/
> adjacency/economy/multiplayer are inherited, occupied cells skipped with an
> i18n-interpolated count toast; one undo step (history-mute pattern); Escape/
> right-click/tool-switch cancel. Flag off: tool hidden, zero listener work.

Stroke capture on terrain (pointer events on the existing pick plane) → ordered cell/
edge list (snap + dedupe + simplify) → Context Bar asks what it becomes: open stroke =
Fence/Wall/Path/Hedge; closed loop = same + Fill (trees/crops/water) + "fence with gate
at path crossing". Application is a batched sequence through the normal placement path
(ghost preview first, commit on confirm) so undo, economy, multiplayer, adjacency all
work for free. No new serialization.

## Slice 5 — Free objects (re-homing)

> STATUS: CODE-COMPLETE. Move chip in the Context Bar arms a one-shot drag
> (20-input-place-erase.js, ~260 lines): pickTile-based ground drag with
> per-mesh raycast opt-out (dragged object can't occlude its own drop target),
> full-field re-homing via place-then-clear setCell (terrain kept from target,
> everything else from source), occupied/terrain-incompatible drops reject
> with snap-back + toast, one undo step via pushWorldHistorySnapshot +
> worldHistoryMuted (the same batching the gizmo uses), selection follows the
> object to its new home. Single-select only (multi-select toasts). Fable
> review pass added: the three drag toasts routed through i18n (keys in all
> 5 locales — 20 had no i18n precedent but Build v2 sets the bar).

Per 02-object-tile-coupling.md: drag input (new), on release compute containing tile,
place-then-clear via two ordinary setCell calls (that order so multiplayer peers never
see the object vanish), residual offset in the existing transform tuple (relax the
±0.48 clamp only while the flag is on and only during drag; the persisted offset stays
in-tile after re-homing so v1 clients render it correctly). Collision = reject with
feedback (extras[] can't host arbitrary seconds objects). Inventory/economy/adjacency
need zero changes — setCellImpl recomputes from scratch both ends.

## Slice 6 — Proportions retune + building upgrades

Audit grounded (03-proportions-audit.md). Anchor: DOOR_H = 1.12 x MAX avatar height
(0.61) = 0.68; WALL_H/sills/heads scale by the same ~1.42x preserving fill ratios;
castle wall to 0.68 (today it exactly equals default avatar height — zero cover);
skyscraper gets a double-height ground "lobby" (fixes its door being taller than its
own floor). Seam: versioned TW_PROPORTIONS_V1/V2 tables with getter-based `H` so all
call sites keep working — MUST also cover the ~dozen hardcoded literals outside H
(manor/tower/skyscraper doors, castle wall, turret's voxel door in 09b). Bonus v1 bug
fix: ghost previews use different door sizes than finished buildings (manor 0.36 vs
0.46) — previews route through the same table.
- 6a CODE-COMPLETE (flag-off byte-identity proven via a numeric vm harness against the
  real builder functions): 21-key TW_PROPORTIONS_V1/V2 tables + getter-based `H`;
  all four doors converge on DOOR_H 0.68 in V2; skyscraper lobby 0.714 (upper floors
  unchanged, re-index reduces to the original formula in V1); castle wall 0.68 +
  merlon top at 0.80; wheat -38% / flower -35%; ghost previews (manor/tower/sky)
  route through the same table — preview=final in both versions (v1 preview bug fix);
  tower gets a 2-step externalStairs run in V2 only. RENDER-PASS ITEMS: tower stair
  fit against the round shaft; flower stem/petal gap in V2 (petals not moved).
- 6b CODE-COMPLETE: Parts.towerWindow (slit-anchor mount math generalized; glass is
  M.windowB so tower windows night-glow for free), Parts.spiralStair (16deg/step,
  tread clearance verified analytically per floor count), Parts.battlementRing
  (castle merlon dims, 6 merlons/6 gaps, roof skipped). New buildingType
  'watchtower' in BOTH schema copies + validateWorld + normalizeAutoAction +
  toolbar (flag-gated flyout) + all dispatch sites (construction-preview and
  toolbar icon fall back to plain voxel tower deliberately — no geometry
  duplication into 09b). Glazing on plain 'tower' is V2-gated; watchtower is
  new so always glazed. Deliberate scope cut: no flag/banner on the open deck
  (was calibrated against the cone roof). RENDER-PASS REQUIRED before flag
  widening: stair-vs-shaft fit, window facet fit, battlement proportions.
- 6c CODE-COMPLETE: both animal render paths fixed (07 makeCow/Sheep/Pig = real
  in-world; 09b makeVoxelAnimal = ghost/toolbar only — two independent
  implementations, each with its own table keys). V2 hierarchy: cow 100% >
  pig 85% > sheep 70% of cow height, per-species uniform scale (no reshaping).
  Bonus defect found+fixed: the ghost preview had sheep TALLER than pig.
  V1 numerically byte-identical (harness-verified).
- Owner dogfood fix (same day): ring+bar double-surface (screenshot) resolved —
  ring fully suppressed for board-object selections under v2 (tickRadialMenu),
  bar's action row absorbed Generate/More/Close via new window exports from 33.
Execution rule stands: screenshot-verified batches in a real browser before enabling;
static checks cannot close this slice.

## Rollout

Admin flag → owner dogfood → `everyone` per slice (flags support per-flag gating).
The "build version" the owner controls IS the flag; a visible Settings toggle
("Build system: v1/v2") ships with slice 2 so it's switchable without the admin panel.

## Standing risks

- 33/28a are shared surfaces — every gated change must fall through to v1 exactly when
  the flag is off (reviewed per diff).
- New UI strings need the i18n pass or `npm run i18n:check` fails the ship.
- Dist: nothing visible until `publish.sh`; owner ships deliberately.
