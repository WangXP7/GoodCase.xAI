# Proportions Audit — doors, windows, ceiling heights, tower/castle upgrades, animals/plants

Read-only audit. No code changed. All numbers below are world units (TILE = 1, `engine/world/01-render-core.js:149`) unless stated otherwise. Reference human scale: the voxel avatar's world height at default build is **0.5** (`AVATAR_HEIGHT = 0.5`, `engine/world/53-voxel-avatar.js:25`), and the per-player height slider (`cfg.height`, `engine/world/53-voxel-avatar.js:532`) ranges **0.84–1.22**, so actual avatar height in a live world ranges **0.42–0.61**. `MAX_FLOORS = 8` (`engine/world/10-world-data.js:156`).

**Architecture note, load-bearing for everything below**: there are two independent geometry systems in this codebase, not one.
- `engine/world/07-house-primitives.js` (`H` constants, `Parts.*`, `buildHouse`, `buildSquareHouse`, `buildCompositeHouse`, `makeManor`, `makeStoneTower`, `makeSkyscraper`, `makeCastleWallSegment`, `makeFence`, `makeCow`/`makeSheep`/`makePig`, crop factories) is what actually renders in the live world for houses/manor/tower/skyscraper/animals. Confirmed via `engine/world/17-tile-renderers.js:168-170,388-427` and `engine/world/18-scene-pick-xr.js:369-448`.
- `engine/world/09b-voxel-build-factories.js` (`makeVoxel*`) is a **second, hand-duplicated** implementation of nearly the same building set, used only for the ghost/fade-in construction preview (`engine/world/15-ghost-generation-fade.js:556-578`) and toolbar drag-icons (`engine/world/19-tools-toolbar.js:246-275`) — **except for the crenellated turret**, where `makeTurret` (`07:562-564`) calls `makeVoxelTurret` directly, making the turret's real, permanent, in-world geometry the voxel one. So turret is the one building type with no 07-native equivalent at all.

This means "fix the door height" is two edits in two files for every building type except turret (one edit), and the two systems already disagree with each other today (see §2, item 9).

---

## 1. Measurement table

All heights are from ground (y=0) unless noted. "Ratio→avatar" uses the default avatar height 0.5; "Ratio→TILE" uses TILE=1.

### Cottage / farmhouse (linear cluster) — `Parts` + `buildHouse`, `07-house-primitives.js:8-14, 220-337`

| Element | Value | →avatar | →TILE |
|---|---|---|---|
| Wall height per floor (`H.WALL_H`) | 0.55 | 110% | 0.55 |
| Roof ridge apex (`H.PEAK_Y`) | 0.87 | 174% | 0.87 |
| Wall width (short axis, `H.WALL_W`) | 0.82 | 164% | 0.82 |
| Gable door (`Parts.door('gable')`, :104) | 0.20w × 0.48h × 0.04d, sill 0 → top 0.48 | 96% h | 0.20 w |
| Side door (:113) | 0.04w × 0.48h × 0.20d | 96% h | — |
| Ground window, "large" (`Parts.window`, :128-136) | frame 0.24×0.24, glass 0.24×0.86 = 0.206×0.206, center y=0.32 → sill 0.20, head 0.44 | sill 40%, head 88% | frame 0.24 |
| Upper/back window, "small" | frame 0.20×0.20, glass 0.172×0.172, same sill scheme | sill 40%, head 84% | frame 0.20 |
| Chimney (:149) | 0.14×0.6×0.14, base at wallH-top, top = wallH+0.60 | — | — |
| Roof pitch | rise = PEAK_Y − WALL_H = 0.32 over half-width 0.41 → ≈38° | — | — |

Door fills 0.48/0.55 = **87.3%** of one floor's wall height (13% headroom) — internally reasonable, on its own.

### Square (2×2) farmhouse — `buildSquareHouse`, `07:406-491`

Reuses `H.WALL_H` (0.55/floor) and `Parts.door`/`Parts.window` unchanged — numbers identical to cottage above. `SIDE = 2·TILE − 0.18 = 1.82`. Hipped roof rise 0.65. **No inconsistency versus cottage** — this variant is a clean reuse.

### Composite house — `buildCompositeHouse`, `07:498-555`

Each wing is a `buildHouse` call — **identical numbers to cottage**, no drift.

### Manor — `makeManor`, `07:623-789`

| Element | Value | vs. cottage |
|---|---|---|
| Wall height per floor | `H.WALL_H * f` = 0.55/floor | same |
| Front door (:696) | 0.26w × 0.46h × 0.04d, sill 0 → top 0.46 | **4% shorter** than 0.48 |
| Portico height (:660) | `min(wallH-0.12, H.WALL_H-0.10)` = 0.43 at f=1 | — |
| Sash window glass (`makeWindowPane`, :708) | fixed 0.14×0.20 (not scaled by the `f`/`size` param used elsewhere) | center y=0.34 (fi=0) → sill 0.24, head 0.44 |
| — head height | 0.44 | **matches** cottage head (0.44) |
| — sill height | 0.24 | **4cm higher than** cottage sill (0.20) |

Manor's sash glass is a hardcoded 0.14×0.20 literal, disconnected from `windowGlassRatio()`/the `f`/`size` system every other variant uses — same head line as cottage by coincidence, different sill, different width. Worth folding into the shared window system rather than leaving as a one-off literal.

### Stone tower — `makeStoneTower`, `07:795-938`

| Element | Value | vs. cottage |
|---|---|---|
| Shaft height | `H.WALL_H*f + 0.34` → 1.44 at f=2(min) | — |
| Front door (:883-884) | 0.28w × 0.46h × 0.04d, **center y=0.39** → **sill = 0.16, top = 0.62** | sill floats 0.16 above grade (cottage sill=0) |
| Base cylinder (:810-813) | y 0–0.16 (radius+0.12→+0.15 taper) | — |
| Plinth cylinder (:815-818) | y 0.16–0.26 (radius+0.07→+0.10) | — |
| Slit windows (arrow slits, :899-908) | 0.10×0.18 gable-face + 0.03×0.20×0.10 side, no glass | not glazed |
| Balcony walkway (:829-836) | disc at wallH+0.10, radius+0.12 | — |
| Balcony railing posts (:838-844) | 12 posts, 0.04×0.10×0.04, at railR=radius+0.13 | — |
| Cone roof + finial | roofBase→cone→cap→finial spans wallH+0.24 to wallH+1.09 | — |

**The door does not reach the ground.** Its sill sits at y=0.16 — inside the flared base/plinth taper, but there is no `Parts.externalStairs`-style step part bridging it, unlike the 2-floor cottage upper door which *does* get 6 explicit stair treads (`Parts.externalStairs`, :163-178, called at :317-319). At the avatar-to-world scale implied by the avatar height constant (0.16 world units ≈ 0.32× avatar height, i.e. roughly a third of a person's height), this reads as a floating door / missing stair, not a deliberate raised-porch design.

### Skyscraper — `makeSkyscraper`, `07:570-617`

| Element | Value | vs. cottage |
|---|---|---|
| Floor height (`floorH`) | 0.30 (independent constant, not `H.WALL_H`) | 45% shorter per floor |
| Ground door (:610-611) | 0.20w × 0.32h × 0.04d, center y=0.16 → top 0.32 | **33% shorter** than 0.48 |
| Glass band per floor (:586-593) | height 0.16, centered at yMid=(i+0.5)·0.30 | — |

**Door (0.32) is taller than the floor it sits in (0.30).** The door's top edge is 0.02 world units *above* the first floor's ceiling line, meaning it visually pokes into the second floor's slab/glass band. This is the single sharpest literal defect in the table — every other building's door fits inside its own floor height with margin; the skyscraper's doesn't fit at all.

### Turret (voxel-only, real geometry) — `makeVoxelTurret`, `09b-voxel-build-factories.js:2032-2108`, dispatched via `07:562-564`

| Element | Value | vs. cottage |
|---|---|---|
| Shaft height | `0.84 + (f-1)*0.30` | — |
| Door (`voxelDoor(g,0,0.405,'z',0.36)`, :2095) | 0.21w × 0.36h × 0.055d, sill 0 → top 0.36 | **25% shorter** than 0.48 |
| Crenellation merlons (:2085-2090) | 0.12×0.16×0.12, top at wallH+0.27+0.16=wallH+0.43 | — |
| Arrow slits (:2100-2103) | 0.13×0.20 / 0.034×0.20×0.13 / 0.034×0.18×0.12, no glass | not glazed |

Turret has the tallest, thickest walls of any small building (0.84 base shaft before floors) paired with the *shortest* door of any building type (0.36) — the opposite of the tower's problem (huge walls, comically small entrance) rather than a floating one.

### Castle wall segment — `makeCastleWallSegment`, `07:945-1038`

| Element | Value | →avatar |
|---|---|---|
| Wall height | 0.50 | **100%** — exactly equals default avatar height |
| Merlon height (:994) | 0.10 (top = 0.60) | 120% |

At the default avatar height (0.5), the plain wall sections between merlons come up to exactly eye level — **zero head-level cover**, and a tall-build avatar (0.61) stands taller than the wall everywhere except directly behind a merlon. A defensive castle wall reading as "waist-high fence" is a real proportional miss given the asset's name and purpose.

### Fences — `makeFence`, `07:1098-1254` (lower priority per the brief, summarized only)

Heights span 0.24 (basic wood, level 1) up to ~0.74 (garden style, level 3, `postH=0.38*1.32`) to 0.58 (stone, level 5+). These read as waist-to-chest obstacles at the avatar scale and are not flagged as inconsistent — they're deliberately varied by level/style and don't claim to be "doors" or "walls" in the load-bearing sense the owner called out.

---

## 2. Inconsistency findings, ranked by visual impact

1. **Skyscraper door (0.32) is taller than its own floor height (0.30)** — clips into the slab above; also 33% shorter than the cottage/manor door despite the tallest building footprint in the game. `07-house-primitives.js:574,610-611`.
2. **Stone tower door floats 0.16 world units above grade** with no stair part bridging the gap — every other elevated entrance in the codebase (`buildHouse` 2-floor upper door) gets an explicit `Parts.externalStairs`; the tower doesn't. `07:883-884` vs `07:313-322,163-178`.
3. **Turret's real door (0.36, voxel-only path) is 25% shorter** than the cottage/manor door (0.48/0.46) despite having the thickest walls of any small building. `09b-voxel-build-factories.js:2095`.
4. **Castle wall height (0.50) ≈ default avatar height (0.50)** — provides no head cover; a "wall" that a player looks straight over. `07:947` vs `53-voxel-avatar.js:25`.
5. **Avatar height slider (0.42–0.61) vs. fixed door heights (0.46–0.48)** — a max-height-build avatar (0.61) is 27% taller than a cottage door top (0.48) and will visibly clip through door lintels; only the default-height avatar (0.5) fits at all, and even then with just 2% clearance. `53-voxel-avatar.js:532` vs `07:104,696`.
6. **Sheep (~0.39 world height) is nearly as tall as a cow (~0.38–0.43)** — real-world size relationship inverted/erased; sheep should read noticeably shorter. `07:1584-1637` (cow) vs `07:1638-1683` (sheep) — both computed from body+head box positions in the same file.
7. **Ghost-preview geometry doesn't match the final building it previews**: manor's preview door (`makeVoxelManor`-style, `09b:1903`, h=0.36) is 22% shorter than the real manor door (0.46, `07:696`); stone tower's preview door (`09b` ~line 1970, h=0.42) is 9% shorter than the real one (0.46). The building visibly changes proportions the instant construction finishes.
8. **Manor window sill (0.24) vs. cottage window sill (0.20)** — both variants land on the same head height (0.44) by coincidence, but the sill datum differs by 4cm because manor's sash glass is a hardcoded literal (`makeWindowPane(0.14, 0.20, ...)`, `07:708`) never routed through the `f`/`size`-scaled `Parts.window` system cottage/farmhouse use.
9. **Flower (~0.28, 56% of avatar) and wheat (~0.36–0.46, up to 92% of avatar)** read disproportionately tall next to bush (~0.24–0.30) and tuft (~0.10–0.14) — flowers and wheat should sit closer to knee/shin height, not waist-to-chest height on the avatar. Derived from `07:1300-1318` (wheat), `07:1537-1559` (flower), `07:1489-1500` (tuft), `07:1560-1583` (bush).
10. **Turret vs. tower vs. cottage door heights form three unrelated numbers** (0.36 / 0.46 / 0.48) with no shared constant — the "same object" (a front door) reads at three different scales depending only on which builder function happened to write the literal.

---

## 3. Target ratio proposal + gating seam

### Proposed single PROPORTIONS spec

Anchor to the *maximum* avatar height (0.61, from the height slider) rather than the default, so tall-build players never clip a lintel:

| Constant | Current (cottage baseline) | Proposed | Delta | Rationale |
|---|---|---|---|---|
| `DOOR_H` | 0.48 | **0.68** | +42% | `MAX_AVATAR_H (0.61) × 1.12` headroom factor, so even a max-height avatar clears the door by ~10%. |
| `WALL_H` (per floor) | 0.55 | **0.78** | +42% | Preserves today's door-fill ratio (door/wall = 87%) at the new door height: 0.68/0.87 ≈ 0.78. Scales floor height by the same factor as the door so the "crampedness" read doesn't change, only the absolute scale. |
| Window sill | 0.20 | **0.28** | +40% | Preserves today's sill/wallH ratio (0.20/0.55=36%) applied to the new wallH: 0.36×0.78≈0.28. |
| Window head | 0.44 | **0.62** | +41% | Keeps ~2 units of headroom below the new door top (0.68), matching today's 0.04-unit gap scaled up. |
| Castle wall height | 0.50 | **0.68** | +36% | 1.12× max avatar height (0.61) — a wall a tall player cannot see over, matching the door's headroom logic. |
| Castle merlon top | 0.60 | **0.80** | — | Wall + 0.12 (roughly today's 0.10 merlon, scaled). |
| Skyscraper ground floor | 0.30 (shared with all floors) | **keep upper floors at 0.30–0.34; give floor 0 its own `LOBBY_H = max(2×floorH, DOOR_H×1.05)`** ≈ 0.71 | new concept | Real double-height lobbies are a standard skyscraper trope and solve the door-taller-than-floor bug without inflating every office floor. |
| Tower door sill | 0.16 (floating) | **0** | fix, not scale | Removes the floating-door defect outright; independent of the size change above. |
| Turret door (voxel) | 0.36 | **`DOOR_H`** (0.68) or a documented tower-family override, but never silently different | +89% | Unify the one building type that has no 07-native counterpart. |

Manor/tower/skyscraper doors currently sit close to the cottage baseline already (0.46/0.46/0.32) — under this proposal they'd all converge on the single `DOOR_H` constant, with only the skyscraper needing the extra lobby-floor concept layered on top.

### Gating seam recommendation

`H` in `07-house-primitives.js:8-14` is a plain module-level `const` object, closed over by every `Parts.*` function and by `buildHouse`/`buildSquareHouse`/`makeManor`/`makeStoneTower`. The cleanest non-invasive seam that matches the existing "flag selects a variant" pattern already used elsewhere in this codebase (per project memory: build-behind-flag, renderer-version toggles):

1. Rename the current object to `H_V1` (values unchanged — this is what every existing saved world keeps rendering with).
2. Add `H_V2` with the proposed numbers above.
3. Replace the `const H = {...}` declaration with a getter, e.g. `function H() { return (activeProportionsVersion() === 2) ? H_V2 : H_V1; }`, where `activeProportionsVersion()` reads a single global/world-scoped flag (the same place a `buildV2`/renderer-version flag would already be checked elsewhere in this codebase per the roadmap's stated versioning approach).
4. Every call site that reads `H.WALL_H`, `H.PEAK_Y`, etc. becomes `H().WALL_H`, `H().PEAK_Y` — mechanical, but touches every builder function in `07-house-primitives.js` (roughly a dozen call sites) plus the per-variant literals that are *not* derived from `H` at all (manor door 0.46, tower door 0.46, skyscraper door/floorH, castle wall 0.50, turret's separate `09b` door 0.36) — those need their own `V1`/`V2` pair pulled from the same versioned lookup rather than being hardcoded numbers, since they're the ones actually causing the inconsistencies in §2.
5. Because per-world data already carries a schema/version concept (see grid-size-cap memory: worlds carry a version-gated contract), the natural place to source `activeProportionsVersion()` is the same per-world flag, so a world built before the change keeps its exact current look and only new/opted-in worlds pick up `H_V2`.

This is a bigger mechanical lift than it looks: it is not just editing `H`, it's promoting every per-variant "magic number" door/window/wall literal (manor, tower, skyscraper, castle, turret) into the same versioned lookup, because §2's worst offenders are precisely the literals that never went through `H` in the first place.

---

## 4. Tower/castle upgrade levers

### (a) Real (glazed) windows on the tower

The shaft is a faceted 16-sided `CylinderGeometry` (`07:821-826`). The existing slit windows already solve the hard part — placing a flat rectangular mesh flush against a mostly-round surface — by positioning at `(0, y, cos(angle)*(radius+0.015))` with `rotation.y = angle` (`07:900-906`). To add real glazed windows: add a `Parts.towerWindow(y, angle)` that reuses the existing `makeWindowPane`/`windowGlassRatio()` helpers (already shared with `Parts.window`, confirmed both call into `03-geometry-materials.js:643,746`) instead of a flat `M.castleSlit` box, mounted at the identical anchor point/rotation the slits already use. This is a drop-in swap at `07:900-907` behind a new `opts.glazed` flag on `makeStoneTower`, not a new geometry system.

### (b) External spiral stair variation

No spiral/curved stair part exists anywhere in the codebase today — `Parts.externalStairs` (`07:163-178`) is a straight 6-step run designed for a flat rectangular wall face, not a circular shaft, and it's the direct fix for finding §2.2 (floating tower door) if kept straight, or could be replaced by a genuine spiral for the "variation" the owner asked for.

Sketch of `Parts.spiralStair(segments, radius, rise)`:
- Orbit the tower's existing plinth radius (`radius+0.07` to `radius+0.15`, the same offsets already used by `base`/`plinth` at `07:810-818`).
- `segments` treads, each a simple box (matching `externalStairs`' tread style: `getBoxGeometryPrecise(width, stepRise, stepRun*1.4)`), placed at `angle = i/segments * sweepAngle`, `y = i * (rise/segments)`, `rotation.y = angle` so each tread reads tangent to the curve.
- Anchor start at `y=0` (ground) at the shaft's existing plinth radius, anchor end at the door's sill — which should be `0` under the target-ratio fix in §3, making the stair purely decorative/climbing to the balcony rather than load-bearing for entry, OR (alternative design) keep the door raised deliberately and have the stair actually be the way in, matching real "raised keep entrance" castle design — either is viable, but the code must pick one; today it silently does neither.
- Natural attach point for the top: the existing balcony ring (`balconyY = wallH+0.10`, `railR = radius+0.13`, `07:829-844`) already has the right radius and height for a stair to terminate at.

### (c) Open battlements walkway variant

The tower **already has** the geometric bones for this: the balcony disc + 12 railing posts + open-top rail cylinder (`07:829-851`) is functionally a walkway. Today it's always capped by the conical roof (`roofBase`/`cone`/`cap`/`finial`, `07:853-880`), immediately above the balcony.

Lever: gate the roof block (`07:853-880`) behind `opts.roofed !== false` (mirroring the `roofed` boolean `makeVoxelTurret` already accepts, `09b:2032`, which the 07-native tower currently lacks entirely), and when unroofed, replace the thin railing-post loop (`07:838-844`, boxes 0.04×0.10×0.04) with a proper merlon ring reusing `makeCastleWallSegment`'s own merlon dimensions (`07:994`, 0.09×0.10×0.09) at the same `railR` radius, alternating merlon/gap around the circumference the same way the balcony posts already do (`for i in 0..12`).

Sketch of `Parts.battlementRing(radius, merlonSpec)`: iterate `i` around the circle at the tower's existing `railR = radius+0.13` anchor, alternate a stone merlon box (reuse castle wall's 0.09×0.10×0.09) with an open gap every other slot, matching the crenel/merlon 1:1 ratio `makeCastleWallSegment` already establishes at :994-1013.

---

## 5. Animals/plants quick pass — top 10 worst scale offenders

Computed from box positions/sizes in the *real* (non-voxel) factories that actually render in-world (`07-house-primitives.js`), against default avatar height 0.5:

| Rank | Object | World height | % of avatar | Issue |
|---|---|---|---|---|
| 1 | Sheep (`makeSheep`, :1638) | ~0.39 | 78% | Nearly matches cow height — real sheep are much shorter than cattle; size hierarchy is flattened. |
| 2 | Cow (`makeCow`, :1584) | ~0.38–0.43 | 76–86% | Not wrong on its own, but wrong *relative to* sheep (rank 1). |
| 3 | Wheat (`makeWheat`, :1300) | 0.36–0.46 (stalk 0.36-0.42 + head) | up to 92% | Should read knee-high; currently waist-to-chest on the avatar. |
| 4 | Flower (`makeFlower`, :1537) | ~0.28 | 56% | Over half the avatar's height; real flowers are ~20-30% of a person. |
| 5 | Corn (`makeCorn`, :1275) | ~0.64–0.68 | 128–136% | Slightly over-scaled vs. real corn-to-person ratio (~118%), but least egregious on this list. |
| 6 | Pig (`makePig`, :1684) | ~0.30–0.33 | 60–66% | Roughly correct for a pig; included as the calibration baseline the other animals should be checked against. |
| 7 | Bush (`makeBush`, :1560) | ~0.24–0.30 | 48–60% | Same height band as flower (rank 4) despite being a different plant type — the two don't read as distinct in scale. |
| 8 | Pumpkin (`makePumpkin`, :1321) | ~0.20–0.26 | 40–52% | Oversized vs. real pumpkin-to-person ratio, but plausibly intentional given the Cinderella-carriage feature riffing on giant storybook pumpkins. |
| 9 | Tuft (`makeTuft`, :1489) | 0.10–0.14 | 20–28% | Correctly the shortest ground-cover asset — no fix needed, useful as the "short" calibration point. |
| 10 | Sunflower (`makeSunflower`, :1457) | 0.55–0.70 | 110–140% | Taller than the avatar, but this is realistic (real sunflowers commonly exceed human height) — flagged only to show the contrast against wheat/flower, which are *not* similarly justified. |

The clearest, cheapest fix in this list is **wheat and flower** — both are simple stalk-height constants (`07:1307`, `07:1546`) that could drop ~35-40% (wheat `h = 0.20-0.28` instead of `0.36-0.42`; flower stem `0.09` instead of `0.14`) without touching any other geometry, immediately fixing findings #3 and #4 above.

---

## Summary for the requester

- **Top inconsistencies**: skyscraper door taller than its own floor (0.32 vs 0.30 floor height); stone tower door floats 0.16 units above grade with no stair; turret's real door (voxel-only, 0.36) is 25% shorter than every other building's door (0.46-0.48); castle walls (0.50) sit exactly at default avatar eye level, giving no cover; the avatar height slider's max (0.61) already clips through every current door height (0.46-0.48); sheep and cow read as nearly the same size; ghost-preview geometry doesn't match the finished building's real door height in 2 of 3 checked variants.
- **Proposed target ratios**: anchor `DOOR_H` to 1.12× the *max* avatar height (0.61) → 0.68 (+42% over today's cottage baseline of 0.48), scale `WALL_H`/window sill/head by the same 1.42× factor to preserve today's internal fill ratios, fix the castle wall to 1.12× max avatar height (0.68), and give the skyscraper's ground floor alone a doubled "lobby" height rather than inflating every office floor.
- **Gating seam**: promote the module-level `const H` in `07-house-primitives.js:8-14` to a versioned getter (`H_V1`/`H_V2`) selected by a per-world flag, and do the same for the half-dozen per-variant literals (manor/tower/skyscraper doors, castle wall height, turret's separate voxel door) that today bypass `H` entirely — those bypassing literals are exactly what's causing the worst inconsistencies, so the seam has to cover them too, not just `H`.
- **Tower/castle upgrade levers**: glazed tower windows are a drop-in swap of the existing slit-window anchor points; a spiral stair is a genuinely new `Parts.spiralStair` (nothing like it exists today — `externalStairs` is straight-only) that also happens to fix the floating-door bug if it's used as the real fix rather than just cosmetic; an open-battlements variant is the *smallest* lift of the three since the balcony/railing geometry already exists and only needs its roof block gated off and its thin railing posts swapped for merlon boxes reusing `makeCastleWallSegment`'s existing dimensions.

Report written to `plans/build-v2/03-proportions-audit.md`.
