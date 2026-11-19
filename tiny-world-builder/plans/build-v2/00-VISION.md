# Build v2 — Vision & Interaction Model

Owner directive (2026-07-04): complete overhaul and simplification of the build system.
No dead options, no phantom features, consistent proportions everywhere, smarter
placement. Everything ships behind the `buildV2` feature flag (registered, admin-gated)
so v1 stays untouched and switchable.

## The one rule that fixes most of it

**Nothing appears in any menu unless it provably does something to the selected
object.** Today the ring menu shows "style" on kinds that ignore it. Build v2 is
capability-driven: a single `KIND_CAPS` registry (per-kind: which options exist, their
legal values, their preview swatches) is the ONLY source menus read from. An option
that isn't in the registry cannot be rendered. The registry is data — the same table
later feeds the tinyworld-asset/1 schema's behavior block, the AI builder's tool
schema, and the i18n label pass. (Grounding: 01-ux-capability-audit.md.)

## The new surface: Context Bar + Pen, radial demoted

The ring menu's problem isn't that it's a circle — it's that it guesses. Build v2 uses
three cooperating surfaces:

1. **Context Bar** (anchored popover / bottom sheet on touch) — appears on selection.
   Row 1: capability chips only (Rotate, Floors 1-8 stepper, Style: [real variants with
   thumbnails], Color). Row 2: **suggestions** (see below). Row 3: destructive/rare
   (Delete, Duplicate, Pick-up). One level deep, never nested. Kinds with one action
   get one chip.
2. **Pen tool** — draw a stroke or loop directly on the terrain like a pen. On release
   the stroke snaps to cell edges/centers and the Context Bar asks what it becomes:
   open stroke → Fence / Wall / Path / Hedge along it; closed loop → the same plus
   Fill (trees, crops, water) and "Fence + gate at nearest path". This is the "draw a
   shape and say I want that fenced" feature, and it reuses the placement engine —
   the pen only produces an ordered cell/edge list.
3. **Radial keeps exactly one job**: quick placement of the active palette item
   (muscle memory), no editing options in it at all.

## Suggestions engine (the "change to wall?" moment)

A small data-driven rules table evaluated on placement and selection:

```
SUGGEST = [
  { when: { placed: 'fence', adjacentTo: ['tower', 'castle-wall'] },
    offer: 'convert-run-to-wall', label: 'Change fence run to castle wall?' },
  { when: { placed: 'fence', closesLoop: true },
    offer: 'add-gate', label: 'Add a gate?' },
  { when: { placed: 'lamp', near: 'path', dist: 1 }, offer: 'align-to-path' },
  { when: { placed: 'house', adjacentTo: ['house'] }, offer: 'merge-composite' },
]
```

Offers render as one dismissible chip in the Context Bar (never a modal, never blocks
placement). Accepting runs a normal batched edit through the existing setCell path so
undo works. Rules are data → AI builders and future assets can register their own.

## Free objects (lamp anywhere)

Objects stop being welded to their tile. Placement/drag is continuous; on release the
object re-homes: storage moves to the containing cell, residual offset kept in the
existing v4 transform tuple — no format change. Inventory/economy/adjacency all read
the new home cell, so "it appears associated with that tile" falls out of the design.
(Feasibility + the systems that key off home cell: 02-object-tile-coupling.md.)

## Consistency retune (every object, building, animal, plant)

One `PROPORTIONS` spec expressed against avatar height (door = 1.15x avatar, sill,
ceiling per floor, window module), selected by `buildV2` so old worlds keep their look
until switched. Executed as a looped, screenshot-verified pass per asset — fable
reviews each batch against the spec; no drive-by eyeballing. Buildings first (doors/
windows/ceilings), then animals/plants outliers. Tower upgrade variations land here:
windowed towers, external spiral stair, open battlements walkway — as buildingType
variants, not new kinds. (Numbers: 03-proportions-audit.md.)

## Rendering defaults

- Voxel bevel OFF by default (DONE — `01-render-core.js` RENDER_DEFAULTS.voxelBevel
  '0'); the rendering-settings slider remains for opt-in. Users who previously moved
  the slider keep their synced preference.
- Audit any other rounding/bevel defaults during the retune (rounded-box smooth mode).

## Delivery order (each slice independently shippable behind buildV2)

1. KIND_CAPS registry + capability-gated menus (kills dead options) — the audit's
   matrix becomes the registry content.
2. Context Bar replacing ring-menu editing (radial demoted to placement).
3. Suggestions engine with the first 4 rules.
4. Pen tool (stroke → cell/edge list → apply kind), fence/path first.
5. Free objects re-homing.
6. Proportions retune loop + tower/castle variants.

Non-negotiables: no serialization format changes in slices 1-5; every slice passes
`npm run check`; UI slices get real-browser verification before being called done;
flag off = byte-identical v1 behavior.
