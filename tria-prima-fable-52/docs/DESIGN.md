# Tria Prima — design and module contracts

A first-person, dark-fantasy alchemy adventure for the browser. WebGL2 (three.js 0.170), physics in
pure JS (cannon-es), every model, texture and sound generated in code. No asset files.

## 1. The game

The Athanor, the furnace that kept the Isle of Morne alive, has gone cold. The Gloom has come up out
of the ground and the isle is dying under it. You are the last apprentice. You gather ingredients,
brew at the cauldron in the ruined chapel, and use what you brew as tools to reach three pure Primes
(Salt, Mercury, Sulfur) hidden where the Gloom is thickest. Unite them in the Great Work, make the
Stone, relight the Athanor.

**Loop:** explore, gather, brew, throw. Each potion is a verb that changes the physical world, and
each new verb opens new ground and new ingredients.

**The chart.** Every mixture is a point inside a triangle whose corners are Sulfur, Mercury and
Salt. Each ingredient sits somewhere in the triangle and pulls the mixture toward itself. Each of
the seven potions owns a round region of the triangle and a heat band. Put the mark inside a region,
bring the fire into the band, stir until it binds, bottle it. All numbers live in
`src/game/data.js`.

| Potion | Region | Heat | Verb |
| --- | --- | --- | --- |
| Ember | Sulfur corner | roaring | fire: burns briar, lights lanterns and braziers, melts ice, unmakes Shades |
| Verdance | Sulfur–Salt edge | middling | growth: wakes seeds into climbable briar |
| Rime | Mercury–Salt edge | embers | frost: floes on water, crust on lava, snuffs fire, freezes Shades |
| Levity | Mercury corner | gentle | thrown: heavy things float; drunk: high leap, slow fall |
| Fulminate | Sulfur–Mercury edge | hot | explosion: breaks cracked stone, throws bodies |
| Saltspire | Salt corner | strong | raises a salt pillar to stand on |
| Aqua Vitae | centre | steady | drunk: heals |

The Great Work is the three Primes brought through four heat stages: black, white, gold, red.

**World.** One island, about 640 m across. X is east, Y is up, Z is south (north is −Z). Sea and
lake level is y = 0.

| Place | Where (x, z) | What |
| --- | --- | --- |
| The Grey Landing | (0, 290) | the dock where you arrive |
| Hearthfall | centre | withered moor, the river, the ruined Chapel of the Athanor on a knoll at (−10, 70) |
| The Saltwood | west, x < −110 | a dead forest crusted in salt, salt-figures, the Elder Hollow at (−245, 30) |
| Quickmere | east, around (215, 50) | a black mirror lake, drowned ruins, the far islet at (235, 45) |
| Brimstone Scar | north, around (70, −255) | a caldera with a lava lake and blue sulfur fires |
| Greyhorn | north-west | the mountain, the river's source |

Gates: a briar wall (Ember) into the Saltwood, open water (Rime) to the Mere islet, a rockfall
(Fulminate) into the Scar. Lanterns of the dead (stone towers lit with Ember) are checkpoints and
fast-travel points. Shades (hooded wraiths of the Gloom) haunt the gloomed regions.

## 2. Art direction: dark fantasy

Grave, weathered, cold. Think of a dying land seen at last light, not a storybook.

- **Palette.** Desaturated greys, umbers, bone, slate, dead grass. Saturated colour is reserved for
  light and for substances: ember orange, sulfur yellow and its blue flame, quicksilver steel,
  blood red of the Stone, the violet of the Gloom. Use `PAL` in `src/models/kit.js`.
- **Forms.** Plausible proportions and sharp silhouettes: thorns, splinters, cracked edges, sagging
  timber, leaning stones. Nothing rounded, chubby, glossy or toy-like. No pastel.
- **Materials.** Rusted iron, tarnished hammered copper, soot, wax, bone, wet slate, lichen, salt
  crust. Everything has been outdoors for a hundred years.
- **Light.** Overcast days with breaks of low sun, long amber dusk, moonlit nights, heavy fog and
  light shafts. Emissive surfaces are small and hot, never large flat glows.
- **Architecture.** Gothic ruin: pointed arches, buttresses, broken vaults, crypt slabs, iron
  fences, chains, candles guttering in clusters. Grave markers are plain slabs, obelisks and
  wheel-heads, no religious symbols.
- **Writing.** Spare and grave. Short sentences. No jokes, no exclamation marks.
- **UI.** Dark, minimal, engraved. Bone-white text on near-black, thin lines, one warm accent.
  Display face Cormorant Garamond, UI face Inter (both embedded). No cards, chips or badges.
- **Sound.** A written score, not a drone: a theme for each place and state, in the old modes,
  for vielle, flute, lute, horn, voices, bells and war drums, all on one motif. Under it a quiet
  bed of wind and far-off things. Water is heard near water and nowhere else.

## 3. Code layout and ownership

```
index.html              dev shell (import map)            MAIN
src/main.js             boot                               MAIN
src/core/               math, rng, noise, events           MAIN
src/game/data.js        all static data and chart math     MAIN
src/game/state.js       save state + brew state shape      MAIN
src/game/               gameplay                           MAIN
src/gfx/                renderer, shaders, post, materials MAIN
src/world/              terrain, water, flora placement    MAIN
src/physics/            cannon-es wrapper, player          MAIN
src/models/kit.js       geometry toolkit                   MAIN (read-only for others)
src/models/registry.js  model registry                     MAIN
src/models/flora/       the nine ingredients               MODELS-A
src/models/items/       primes, the Stone, potion bottles  MODELS-A
src/models/structures/  chapel, athanor, cauldron, furniture, lanterns, shrines   MODELS-B
src/models/nature/      trees, shrubs, rocks, potion-made things, creatures       MODELS-C
src/models/ruins/       bridge, dock, ruins, graves, salt figures, roadside things MODELS-D
src/ui/                 all DOM UI                         UI
src/audio/              all sound                          AUDIO
dev/                    test pages (each module adds its own)
tools/                  dev server, playwright helpers, build
shots/                  captures (never shipped)
```

A module edits only the files it owns. If a contract below is not enough, say so in the final
report instead of editing someone else's file.

Plain ES modules, no TypeScript, no framework. Bare imports allowed: `three`, `three/addons/...`,
`cannon-es`. Everything else is a relative path that starts with `./` or `../`. Code, comments and
all game text are English.

Tools: `node tools/dev-server.mjs <port>` serves the project root (`POST /__shot?name=x` saves an
image to `shots/`, `POST /__save?name=x.ext` saves any bytes). `tools/pw.mjs` exports
`launch({ width, height })` for headless Chromium on the real GPU; `tools/dev-server.mjs` exports
`startServer(0)` for a free port. Read an image back with the Read tool to look at it.

## 4. Contract: models (`src/models/`)

Read `src/models/kit.js` first; `src/models/flora/cinderbloom.js` is the reference for both code
style and tone.

```js
import { Builder, Rng, MAT, PAL, paint, ... } from '../kit.js';
import { register } from '../registry.js';
register('name', (seed, opts) => { const b = new Builder(); ...; return b.build(); }, { kind, ...meta });
```

- Metres, Y up, the model stands on y = 0 centred on the origin, +Z is its front.
- Build each part in a handy local pose, `paint()` it, then place it with `xf()`. Wood grain runs
  along the part's local Y at paint time.
- `b.add()` solid parts, `b.glass()` bottle walls and lenses, `b.liquid()` the liquid volume,
  `b.part(name, ...)` pieces the game moves or lights on its own, `b.boxCollider / cylCollider /
  sphereCollider` for anything the player can bump into or stand on (few, simple shapes),
  `b.anchor(name, x, y, z)` named points, `b.emitter(type, x, y, z, extra)` for fire / glow / smoke /
  spark / steam / drip, `b.light(x, y, z, color, intensity, range)`.
- Same seed, same model. Different seeds give visibly different variants where it makes sense.
- Triangle budgets: small plants 0.6–2k, bottles 1.5–3k, props 1–5k, large structures 8–40k.
- The full list of models, with the names, anchors and parts the game relies on, is
  `docs/MODELS.md`. Each model folder has an `index.js` that imports its model files; the owner of
  the folder keeps it up to date. Helpers shared inside a folder go in that folder (`_shared.js`).
- Check your work: `node tools/shot-models.mjs --m <names> --seed 1-4 --bg day|dusk|night --out
  model_<name>` then Read `shots/model_<name>.jpg`. `--views "az,el;az,el"` for several angles,
  `--debug 1` shows colliders and anchors. Look at every model in at least two lights and from two
  angles before calling it done.

## 5. Contract: UI (`src/ui/`)

```js
import { createUI } from './ui/index.js';
const ui = createUI(game);     // builds its DOM under document.getElementById('ui')
ui.update(dt);                  // once per frame; cheap; reads game.state / game.hud / game.brew
```

The UI never touches three.js or game internals. It reads the objects below and calls
`game.actions`. It listens to `game.bus`.

```js
game.state      // src/game/state.js createState()
game.brew       // src/game/state.js createBrew()
game.data       // namespace import of src/game/data.js
game.bus        // src/core/events.js bus
game.settings   // { quality:'low'|'medium'|'high'|'ultra', renderScale:0.5..1, fov:60..100,
                //   sensitivity:0.2..3, invertY:bool, master:0..1, music:0..1, sfx:0..1,
                //   shake:bool, grain:bool, hints:bool }
game.hud        // per-frame view model:
                //   focus: null | { verb:'Gather', name:'Cinderbloom', key:'E', hold:0..1|null }
                //   crosshair: 'none' | 'dot' | 'ring' | 'aim'
                //   compass: { heading: radians (0 = north, clockwise), marks: [{ id, kind:'quest'|'lantern'|'home', bearing: radians, dist: metres }] }
                //   region: region id | null,  gloom: 0..1 (how deep in the Gloom the player stands)
                //   hint: '' | short tutorial line,  held: potion id | null,  carrying: bool
                //   time: hour 0..24
game.icons.get(kind, id)   // -> HTMLCanvasElement | null; kind: 'ingredient' | 'potion' | 'prime' | 'stone'
                           // rendered 3D thumbnails with transparent background, 256 x 256
game.map        // { canvas: HTMLCanvasElement | null, size: 768 (world metres, centred on 0,0),
                //   toUV(x, z) -> [u, v] in 0..1, player: { x, z, yaw }, marks: [{ id, kind, x, z, name, lit }] }
game.actions    // newGame(), continueGame(), hasSave() -> bool, resume(), pause(), quitToTitle(),
                // openBook(tab), closeBook(), selectPotion(id), setSetting(key, value),
                // brewAdd(ingredientId | 'prime:salt'...), brewPump(bool), brewDamp(bool),
                // brewBottle(), brewEmpty(), brewLeave(), travel(lanternId), respawn(),
                // photo(bool), readLoreDone()
```

Modes (`game.state.mode`): `title`, `play`, `brew`, `book`, `pause`, `cutscene`, `photo`, `dead`.

Input split. The game owns the keyboard and the mouse in `play`, `brew`, `photo` and `cutscene`;
the UI only shows the prompts and offers clickable equivalents. The UI owns the keyboard in
`title`, `book`, `pause`, `dead`, in the lore reader and in the ending (Esc closes or resumes
through `game.actions`). In `play` the pointer is locked, so nothing in the HUD may need the mouse.
In `brew` the 3D view fills the left 58 % of the screen and the game handles stirring there
(circling the mouse over the pot): the overlay root must let pointer events through
(`pointer-events: none`) and only its own panels, on the right, take them. Keys in `play`: WASD,
Shift run, Space jump, E use / gather / carry, left mouse throw (hold to aim), F drink, Q next
potion, 1..7 pick potion, Tab book, M map, Esc pause, P photo mode. In `brew`: Space bellows (hold),
C damper (hold), B bottle, X empty, Esc leave.

Fonts: `dev/fonts.css` declares the faces and the variables `--font-display` and `--font-ui`; dev
pages link it, the release build inlines it. The UI ships its CSS as a JS string that it injects
itself, with no `@font-face` and no `url()` of its own. The whole page is `position: fixed; inset: 0`
over the canvas, sized with `%`, `vmin` and `clamp()` (never `vh`), and must read well from
1280 x 720 up to 2560 x 1440 and stay usable in a 900 x 600 frame.

Bus events the game emits:
`mode {from,to}` · `toast {kind:'pickup'|'info'|'lore'|'quest'|'warn', icon?:{kind,id}, title, text?}` ·
`pickup {kind,id,count}` · `discover {kind:'potion'|'ingredient'|'chart', id}` · `region {id}` ·
`quest {stage}` · `prime {id}` · `gloom:lift {region}` · `lantern {id}` ·
`hurt {amount,hp}` · `heal {amount,hp}` · `death {}` · `respawn {}` · `lore {id}` (open this page for
reading) · `save {}` · `brew:add {id}` · `brew:ready {potion,stars,count}` ·
`brew:bottled {potion,count}` · `opus:stage {stage}` · `opus:done {}` · `ending {phase}` ·
`settings {key,value}` · `loading {progress 0..1, label}`.

Screens: loading, title (new game / continue / settings), HUD (crosshair, focus prompt, potion belt,
health, objective, compass, region card, toasts, hints, damage and Gloom vignettes), brew overlay
(the chart, the ingredient shelf, fire and heat, bottle / empty / leave), the book (journal, chart
and recipes, ingredients, lore pages, map with travel), lore reader, pause and settings, death,
ending and credits, photo mode bar.

## 6. Contract: audio (`src/audio/`)

```js
import { createAudio } from './audio/index.js';
const audio = createAudio();
audio.unlock();                                   // call from a user gesture
audio.setVolumes({ master, music, sfx });         // 0..1 each
audio.setListener(px, py, pz, fx, fy, fz);        // position + forward (up is +Y)
audio.sfx(name, { pos?: [x,y,z], gain?: 1, pitch?: 1 });        // one-shot; no pos = not spatial
const h = audio.loop(name, { pos?, gain? });      // -> handle
h.set({ pos?, gain?, pitch?, param? });  h.stop(fadeSeconds);
audio.footstep(surface, speed01);                 // 'grass'|'dirt'|'stone'|'sand'|'wood'|'water'|'snow'|'ash'|'salt'
audio.setAmbience({ region, night:0..1, wind:0..1, rain:0..1, gloom:0..1, water:0..1, height });
audio.setMusic(mood, { intensity?: 0..1 });       // 'title'|'vale'|'saltwood'|'mere'|'scar'|'heights'|'night'|'gloom'|'brew'|'opus'|'ending'|'none'
audio.update(dt);
```

One-shots: `ui_hover ui_click ui_open ui_close page toast discover quest pickup pickup_rare throw
shatter ember_burst rime_burst verdance_burst fulminate_burst levity_burst spire_rise spire_crumble
drink heal hurt death respawn jump land splash drop_in bellows bottle_fill cork brew_ready brew_fail
ignite extinguish briar_burn vine_grow rock_crack rock_break ice_form ice_crack steam shade_hit
shade_die lantern_lit travel shrine_open prime_get gloom_lift opus_stage stone_form grab impact_soft
impact_hard lid_slide bell crow`.
Loops: `fire` (param = heat 0..1) `bubble` (param = heat) `stir` (param = speed) `river` `waterfall`
`lava` `vent` `athanor` (param = 0 cold .. 1 roaring) `shade` (param = closeness) `rain` `levity`.

Everything is synthesised with the Web Audio API. Keep headroom: a limiter on the master bus, no
clipping with twenty voices at once. Unknown names must warn once and do nothing.
