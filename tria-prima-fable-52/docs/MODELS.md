# Model manifest

The game asks for these models by name, so names, anchors, parts and the listed meta are a contract.
Sizes are targets, not exact. Read `docs/DESIGN.md` sections 2 and 4 first.

Shared rules

- Origin on the ground at the model's centre, Y up, +Z is the front. Metres.
- `meta.kind` as listed, `meta.variants` = how many seeds (1..variants) give distinct looks.
- Colliders: `boxCollider(cx, cy, cz, hx, hy, hz, ry)` takes half extents and a yaw;
  `cylCollider(cx, cy, cz, r, h)` is an upright cylinder, `c` its centre, `h` its full height;
  `sphereCollider(cx, cy, cz, r)`. Colliders cannot tilt. Keep them few and simple. A surface the
  player walks on must be a collider whose top is flat. Steps up to 0.35 m are climbed by walking.
- Wind: `sway` (aFx.w) is roughly metres of travel divided by 0.15 in an ordinary wind. Trunks and
  anything rigid 0. Twig tips of an 8 m tree 1.5 to 3. Small plants 0.3 to 0.8. Hanging cloth and
  strands 1 to 2. It must fall smoothly to 0 where the part is rooted.
- `opts.lod` (trees and big rocks only): 0 full, 1 about a third of the triangles, 2 about a tenth
  (silhouette only, for the far distance). Same seed, same silhouette at every lod. Set `meta.lods = 3`.
- Things placed in their thousands must be cheap. Budgets are per model at lod 0.
- Emissive is for small hot things. Anything that burns or glows only in some game state (a lit
  lantern, a relit furnace) must be cold in the model: the game adds flame, light and glow at the
  anchors.
- A model sits on uneven ground, so give structures and big rocks a foundation or root that
  continues 0.5 to 2 m below y = 0.

## MODELS-A: `src/models/flora/` (ingredients) and `src/models/items/`

Ingredients: `kind: 'ingredient'`, `variants: 3` or 4, anchor `top` (where the gather prompt points).
`opts.picked = true` builds what is left after harvesting (the plant without its head, the mineral
node chipped down to stubs). 0.6 to 2k triangles.

| name | what | size |
| --- | --- | --- |
| `cinderbloom` | done, the reference | 0.5 m |
| `saltwort` | pale brittle succulent, jointed stems crusted with salt, crystal tips | 0.35 to 0.5 m |
| `weepcap` | cluster of drooping dark mushrooms, caps weeping blue-black dew; emitter `drip` | 0.2 to 0.3 m |
| `mirrorlily` | black lily pads flat on the water (y = 0.01), one bloom with a mirror-bright silver cup | pads 0.7 m across, bloom 0.25 m |
| `corpselight` | pale fungus fingers growing through a half-buried skull or rib; cold green glow; a light | 0.15 to 0.3 m |
| `stormthistle` | tall iron-grey thistle, spined head, tiny blue-white sparks at the spine tips; emitter `spark` | 0.9 to 1.3 m |
| `halite` | cubic salt crystals, interlocked, on a dark stone foot, rose and grey veils | 0.4 to 0.6 m |
| `quicksilver` | cinnabar-veined dark rock sweating beads of mercury, a small mirror pool in a hollow | 0.3 to 0.5 m |
| `brimstone` | crust of sulfur needles around a small vent; emitter `smoke`, a small blue `fire` | 0.3 to 0.5 m |

Primes: `kind: 'prime'`. Relics that hover and turn slowly; build them centred on x = z = 0 with the
lowest point at y = 0. A light and an emitter `glow` each. 1.5 to 3k triangles. Size about 0.3 m.

| name | what |
| --- | --- |
| `prime_salt` | a flawless salt crystal: interpenetrating cubes, a cold white heart |
| `prime_mercury` | a mirror drop held inside a thin tarnished armillary ring |
| `prime_sulfur` | a jagged yellow crystal that burns with a blue flame; emitter `fire` |
| `stone` | `kind: 'stone'`. The Stone: a blood-red faceted gem, 0.12 m, dark at the edges, a slow fire inside |

Bottles: `kind: 'bottle'`, `meta.potion = <id>`. Names `bottle_ember`, `bottle_verdance`,
`bottle_rime`, `bottle_levity`, `bottle_fulminate`, `bottle_saltspire`, `bottle_vitae`,
`bottle_empty`. 0.17 to 0.22 m tall, base at y = 0. Seven clearly different silhouettes, readable at
a glance when held at the edge of the screen. Walls with `b.glass()`, contents with `b.liquid()`
(about 70 % full, a flat top surface), cork, wax seal, twine, a small tag with `b.add()`. Liquid
colours from `POTIONS[id].color / color2` in `src/game/data.js`. Anchor `grip` (centre of the
body). 1.5 to 3k triangles.

## MODELS-C: `src/models/nature/`

Trees: `kind: 'tree'`, `meta.lods = 3`, `variants: 5` or 6, one `cylCollider` for the trunk,
`opaque` only. Lod 0: 2 to 4k triangles. They are bare or nearly bare: the branch structure is the
whole look, so make it good (tapering, crooked, forking, broken limbs, burls, exposed roots).

| name | what | height |
| --- | --- | --- |
| `tree_dead` | leafless gnarled oak, heavy boughs, split trunk | 7 to 11 m |
| `tree_birch` | thin pale birch, peeling bark with dark scars, a few rust leaves left | 6 to 9 m |
| `tree_pine` | ragged dark fir, sparse drooping boughs, dead lower branches | 10 to 16 m |
| `tree_salt` | dead tree bleached white and crusted with salt, salt icicles under the limbs | 6 to 10 m |
| `tree_willow` | dead weeping willow, long hanging strands that sway | 6 to 9 m |
| `tree_charred` | burnt snag, split, a few ember cracks | 2 to 6 m |

Ground cover: `kind: 'shrub'`, no collider, 100 to 400 triangles, `variants: 4`.
`shrub_heather` (dark heather mound 0.4 m), `shrub_thorn` (bare thorn bush 1 m), `fern_dead` (brown
bracken 0.5 m), `reeds` (reed clump 1.2 m, seed heads), `grass_tall` (dry grass clump 0.7 m),
`mushrooms` (small pale cluster for logs and roots).
`kind: 'deco'`: `stump` (0.6 m, collider), `log` (fallen trunk 3 to 5 m, box collider), `bones`
(rib cage and scattered long bones, 1 m), `skull` (0.2 m, sphere collider; also a physics prop).

Rocks: `kind: 'rock'`, `meta.lods = 2`, colliders, `variants: 6`. 200 to 900 triangles at lod 0.
`rock_boulder` (0.8 to 2.5 m, lichen granite), `rock_slab` (flat outcrop 3 x 0.6 x 2.5 m, top
walkable), `rock_spire` (sharp standing crag 4 to 9 m), `rock_basalt` (cluster of hexagonal columns
2 to 5 m), `rock_obsidian` (black glassy shards 1 to 2.5 m), `salt_crystal` (big salt crystal
cluster 1 to 3 m), `rock_small` (three to five stones 0.15 to 0.4 m, no collider),
`standing_stone` (menhir 2.5 to 3.5 m; `opts.glyph = 'sulfur' | 'mercury' | 'salt' | null` carves
that sign with `GLYPH` and `strokes`, cold, no glow).

Things potions make or unmake: `kind: 'gameplay'`.

| name | what | contract |
| --- | --- | --- |
| `briar_wall` | a barricade of woven black briars with finger-long thorns and a few dead roses | 7 m wide (X), 3.6 m tall, 2.2 m deep; one box collider; `opaque` only (the game burns it away with a shader) |
| `seed_mound` | a mound of dark earth with a dormant briar pod, a faint green pulse | 0.9 m wide, 0.3 m high; anchor `seed` |
| `briar_vine` | the climbable briar that Verdance wakes: twisted trunks with side shoots like rungs, leaves, thorns, pale flowers | `opts.height` (default 9); footprint 1.3 m; grows by being revealed from y = 0 upward, so keep it continuous along Y; anchor `top`; no collider |
| `rock_cracked` | a plug of wedged boulders split by deep fissures, faint sulfur-yellow veins | 8 m wide (X), 5 m tall, 4 m deep; one box collider |
| `rubble` | one chunk of broken rock, `variants: 8`, 0.3 to 0.9 m | centred on its own centre of mass (not on the ground); one sphere or box collider |
| `ice_floe` | an irregular plate of ice, frosted and cracked on top, blue in the edges | 3.6 m across, 0.5 m thick, origin at the waterline: top at y = 0.14; `cylCollider` r 1.7 with its top at 0.14; `variants: 3` |
| `lava_crust` | a plate of cooled black crust with orange cracks | 3.2 m across, top at y = 0.1, same collider idea; `variants: 3` |
| `salt_pillar` | a column of grown salt with a flat top to stand on | 1.7 m across, 2.8 m tall; `cylCollider` r 0.8 h 2.8; it rises by scaling Y from 0 |

Creatures: `kind: 'creature'`.

| name | what | contract |
| --- | --- | --- |
| `shade` | a hooded wraith, 2.2 m: tattered cloak that ends in ragged strips instead of legs, an empty hood, long thin arms with clawed hands | body in `opaque` (MAT.CLOTH, generous `sway` in the hem strips, 0 at the shoulders); parts `armL`, `armR` hanging at rest; anchors `shoulderL`, `shoulderR` (their pivots), `head`, `core`; part `eyes`: two tiny pale points deep in the hood (MAT.GLOW) |
| `crow` | a carrion crow, 0.45 m long | parts `body`, `wingL`, `wingR`, wings spread flat along -X / +X; anchors `wingL`, `wingR` at the shoulder joints; 300 to 500 triangles in all |

## MODELS-B: `src/models/structures/`

`kind: 'structure'` for buildings, `'prop'` for furniture and small things.

| name | what | contract |
| --- | --- | --- |
| `chapel` | the Chapel of the Athanor, a roofless gothic ruin. Nave about 9 m wide (X) inside and 20 m long (Z), walls up to 9 m with broken tops, tall pointed window openings, a door arch in the south end (+Z), an apse at the north end (-Z), flagstone floor 0.3 m above the ground with steps at the door, a few surviving roof ribs, fallen blocks, ivy gone to wire. The centrepiece of the game: spend the budget here (up to 40k triangles). | Colliders: boxes for each wall run (door gap 2.2 m wide), a floor box, big fallen blocks. Anchors: `athanor` (floor, centre of the apse), `cauldron` (floor, centre of the nave a third of the way from the apse), `workbench` and `shelf` (floor, against the west and east walls), `lectern` (floor, just inside the door, to one side), `spawn` (floor, 2 m inside the door), `door` (ground, 3 m outside the door), `candles1`..`candles4` (ledges and floor corners). Foundation to y = -2. |
| `athanor` | the great furnace: 3 m wide, 6.5 m tall. Stone and brick foot, iron-banded drum, an arched firebox mouth facing +Z with its centre 1.2 m up (0.7 m wide, black inside), an iron cradle on the front at chest height where a gem can be set, chimney, pipes, a cracked gauge, the three signs carved in the stone | part `coals` (the bed inside the firebox, cold and grey; the game makes it glow). Anchors `mouth` (centre of the opening), `socket` (the cradle), `chimney` (top), `front` (ground 2 m in front). Colliders. |
| `cauldron` | a cast-iron cauldron 1.15 m across on an iron trivet over a ring of stones, logs and ash under it. Hollow: the inside wall is modelled, no liquid | rim at y = 0.95. Anchors `surface` (centre of the liquid surface, y = 0.82), `fire` (under the pot), `view` (0, 1.75, 1.5). `meta.surfaceRadius` (about 0.5). Part `coals`. Part `ladle`: a long stirring paddle built upright, its origin at the `surface` anchor, blade down to 0.35 m below it, handle 1 m above. One `cylCollider`. |
| `bellows` | floor bellows 0.9 m long, nozzle toward -Z | part `top` (the upper board), anchor `hinge` (at the nozzle end, the axis is X) |
| `workbench` | heavy oak table 2.2 x 0.9 x 0.9 m: mortar, scales, retort stand, books, a skull, candle stubs, jars (glass and liquid) | box collider |
| `shelf` | ingredient shelf 1.8 wide, 2.4 tall, 0.4 deep: jars, stoppered flasks, hanging dried herbs, a small skull | box collider |
| `lectern` | carved lectern 1.3 m with an open book | anchor `page`; cyl collider |
| `alembic` | distilling rig on an iron stand, 0.9 m: glass cucurbit and head, copper coil, receiver | glass + liquid |
| `candles` | 5 to 9 wax candles of different heights fused on a stone or dish, `variants: 4`, up to 0.35 m | emitters `candle` at every wick, one light. Unlit geometry: the game draws the flames |
| `chest`, `crate`, `barrel`, `sack`, `bookpile` | storage and clutter; `crate` 0.7 m and `barrel` 0.6 x 0.9 m are physics props | one collider each, exact fit, `variants: 3` |
| `lore_page` | where a note is found: loose parchment weighted with a stone, a satchel, a candle stub, on a flat rock or a broken stool | anchor `page`; `variants: 3` |
| `lantern` | a Lantern of the Dead: slender octagonal stone tower 5.5 m, three steps, a top chamber open on all sides where the flame burns, a conical stone cap | anchors `flame` (centre of the chamber, about y = 4.4), `base` (ground 1.6 m in front); cyl collider. Cold in the model. |
| `brazier` | iron tripod brazier 1.3 m, a bowl of dead coals | part `coals`, anchor `flame`, cyl collider |
| `shrine_salt` | the Elder Hollow: the shell of a colossal dead tree, 6 m across and 9 m tall, crusted white with salt, the top broken into a ledge | a walkable ledge at the top (box or cyl collider with a flat top, at least 2 m across), anchors `prime` (on the ledge), `ledge` (where the climber steps off, at the ledge's south edge), `vine` (ground at the south foot, straight below `ledge`). Cyl collider for the trunk. |
| `shrine_mercury` | a round stone basin 2.4 m across with a rim 1 m high, brimming with quicksilver, sealed under a carved stone lid; four leaning pillars with rusted chains around it | part `lid` (2.2 m across, 0.3 m thick, resting on the rim), part `pool` (the mirror surface: metal 1, roughness 0.04). `meta.lid = { radius, thickness, y }`. Anchor `prime` (centre, just above the pool). Colliders for basin and pillars, none for the lid. |
| `shrine_sulfur` | a black basalt dais 5 m across, two steps, a stone bowl on a pedestal at the centre caged in iron bars | part `cage` (sinks into the dais when the braziers burn). Anchors `prime` (in the bowl, y about 1.3), `brazier1`, `brazier2`, `brazier3` (on the dais rim, 120 degrees apart). Walkable dais collider. |

## MODELS-D: `src/models/ruins/`

| name | kind | what | contract |
| --- | --- | --- | --- |
| `bridge` | structure | stone packhorse bridge, one arch, broken parapets. Span 16 m along Z, 3.6 m wide, the deck rises 1.6 m at the middle | deck ends meet the ground at y = 0, z = +8 and -8. Colliders: the deck as stepped boxes no more than 0.3 m apart in height, parapets as thin boxes. Abutments and piers down to y = -4. |
| `dock` | structure | a rotting pier 16 m long (Z), 2.6 m wide, some planks gone, mooring posts, rope | origin at the waterline; deck top at y = 1.0; piles down to y = -3; the landward end is at z = -8; box collider for the deck |
| `boat` | prop | a tarred rowing boat 4 m, oars shipped, a dead lantern at the bow | box collider |
| `ruin_wall` | structure | a run of broken wall 5 to 7 m long, 2 to 5 m high, some with a window hole; `variants: 5` | box colliders; foundation to -1 |
| `ruin_arch` | structure | a pointed arch standing alone, 5 m | colliders for the two legs |
| `ruin_pillar` | structure | broken columns 1 to 4 m, some with a fallen drum beside them; `variants: 4` | cyl collider |
| `ruin_tower` | structure | the shell of a round tower 6 m across, 10 m tall, the top broken on a diagonal, a doorway, hollow | wall as a ring of 8 boxes with the doorway left open |
| `ruin_house` | structure | a cottage shell 6 x 5 m: gable ends, a chimney, charred beams, no roof; `variants: 3` | box colliders, doorway open |
| `bell_tower` | structure | a drowned belfry, 5 x 5 x 16 m, leaning. The lowest 6 m stands under water, so the origin is on the lake bed | part `bell` (a great bronze bell in the open belfry), anchor `bell`; box collider |
| `grave` | prop | grave markers, `variants: 8`: slab, leaning headstone, obelisk, wheel-head, broken stump, table tomb. 0.6 to 1.8 m. Plain stone, no religious symbols | one box collider |
| `crypt` | structure | a small mausoleum 3 x 4 x 3.2 m, iron door ajar | box collider |
| `fence_iron` | prop | 3 m of spear-topped iron fence (along X), 1.3 m high; `variants: 3`, one bent, one with missing bars | thin box collider |
| `gate_iron` | structure | cemetery gate: two stone posts, one iron leaf hanging open | colliders for the posts |
| `statue_salt` | prop | a person turned to salt, rough and crystalline, featureless; `variants: 6`: shielding the face with an arm, kneeling, reaching up, two holding each other, fallen, turning to look back. 1.5 to 1.8 m. Adults only. | cyl collider |
| `waymark` | prop | a leaning post with a dead iron lantern cage and a worn board, 2.4 m | anchor `flame` (inside the cage) |
| `cairn` | prop | stacked stones 1 m; `variants: 3` | cyl collider |
| `well` | structure | a village well, windlass and bucket, roof gone | cyl collider |
| `cart` | prop | a broken hand-cart, one wheel off | box collider |
| `scarecrow` | prop | crossed poles in rags, a sack head; 2.2 m | - |
| `gibbet` | structure | a post and arm with an empty hanging iron cage, bones under it; 4 m | cyl collider for the post |
