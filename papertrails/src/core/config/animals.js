// Living animals (owner: animals agent). Read live by src/life/animals.js (__atlas.config.animals), so most values
// can be tuned from the console; `species` / `spawns` are resolved once when the sprite sheet has loaded.
//
// Sprites: public/textures/art/animals.(png|json) - every frame faces RIGHT; world size of a frame = px / unit.
//
// species: behaviour `b`
//   pet    wander / sit / sleep near home; may trot over and FOLLOW the traveller for a while (cats, dog)
//   graze  slow herd drift, head down; lifts the head when he passes (sheep, cow, lamb, camel, reindeer, bank ducks)
//   peck   peck / stand in quick turns; scatters a short hop away (hens, chicks) or flutters up (`fly`: songbird)
//   shy    freezes, then bounds away from him and peeks back (rabbit, fox, deer, squirrel, hares, lizard ...)
//   float  slow arcs on water (ducks placed with the 'w' flag switch to it by themselves)
//   perch  sits still on a stump / log / rock (owl)
// walk = the two frames of the paper walk, idle = poses picked at random (repeat a name to weight it), air = the
// mid-leap frame of a bounding run, speed / run = units per second, step = ground covered per walk frame,
// hop = lift per step, rock = roll per step (rad), roam = wander radius around home, size = extra scale.
const CAT = {
  size: 1.4, // shortfall fixer: small animals 1.3-1.45 x (they were lost among the props)
  b: 'pet', coats: ['cat_ginger', 'cat_black', 'cat_white_grey', 'cat_calico', 'cat_grey_stripe'],
  walk: ['walk_a', 'walk_b'], idle: ['sit', 'sit', 'tail_up', 'stretch', 'sleep'], sit: 'sit', sleep: 'sleep',
  speed: 0.42, run: 2.75, step: 0.085, hop: 0.012, rock: 0.05, roam: 0.7,
  follow: 0, /* user 2026-11-17: animals never follow the traveller (was 0.8) */ followTime: [22, 40], notice: 1.05,
};

export const animals = {
  enabled: true,
  /** Instances alive at once (pool size), scan range around the traveller (world units), global spawn multiplier. */
  max: 56,
  range: 5.2,
  density: 1.5, // fixer (gold pass): 1 -> 1.5, the gold image has about ten animals in frame
  /** Global size multiplier on the heights of animals.json (cat 0.16 x 1.25 = 0.2: a third of the traveller, as measured on the gold image). */
  scale: 1.5, // fixer (gold pass): 1.25 -> 1.5 (sheep about half the traveller, cat / hen about a third)
  /** Card pop when its tile has risen this far (fold progress), pop / hide rates (1 / s). */
  riseAt: 0.86,
  popRate: 4.5,
  hideRate: 10,
  /** Room (world.clearance) an animal keeps from blockers; water is never entered (except floaters). */
  minClear: 0.07,
  /** Lighting: normal of the card as [up, toward camera] (flat cards facing the camera would lose the key light). */
  normal: [0.72, 0.7],
  /** Albedo multiplier: the sheet is painted brighter than the tile sprites. */
  tint: 0.9,
  alphaTest: 0.42,
  shadows: true,
  /** Paper flip when an animal turns round (1 / s), lift of a card above the page. */
  flipRate: 11,
  /** Fastest walk-frame swap (frames / s), however fast the animal runs. */
  stepRate: 9,
  lift: 0.004,
  /** Following: at most this many at once; give up this far from home / from him; pause before the next try (s). */
  maxFollowers: 2,
  followFar: 9,
  followLost: 4.2,
  followCool: 25,
  followSide: 0.27,
  /** Reaction radii (world units). */
  headsUp: 1.35,
  scatter: 0.75, // round 3: 0.6 -> 0.75 (hens scatter a step earlier, so the hop is seen)
  wag: 1.3,
  /** round 3: a bank duck slides into the water / a grazer takes a few steps aside when he comes this close. */
  slide: 0.85,
  shuffle: 0.62,

  /**
   * round 3 - the companion: ONE cat adopts the traveller. A cat of the place within `notice` trots over; when none has
   * after `spawnAfter` seconds of looking, his own cat (`coat`) pops up a little way off and comes. It walks beside
   * him, sits when he stops, naps after `nap` seconds of standing, stretches and hops along again. It leaves when it
   * loses him (`lost`) or after `wild` seconds outside `biomes` (it sits and watches him go), and is back `away` +
   * `back` seconds after he is on settled land again. `stills`: it sits beside him in settled stills.
   */
  companion: { enabled: false, /* user 2026-11-17: no companion */ species: 'cat', coat: 'cat_ginger', after: 4, notice: 2.4, spawnAfter: 12, nap: 9, behind: 1.1 /* farther than this for half a second: one paper leap to his heels */, lost: 4.6, away: 5, back: 4, wild: 4, biomes: ['heartland', 'blossom', 'pinewood'], stills: true },
  /**
   * round 3 - vignettes (6th item of a spawn entry, see `spawns`): `sink` = how far a sitter sinks below the top of the
   * piece it sits on, `topK` = share of a tall piece's height an owl perches at, `doorSleep` = share of door cats that
   * sleep, `stay` = how often a vignette keeps its place when it thinks of wandering.
   */
  vignettes: { enabled: true, sink: 0.03, topK: 0.95, doorSleep: 0.65, stay: 0.75, perchEvery: 0 /* fixer r3: >1 = only one cell in N x N seats a cat on a prop (others sleep at the door); 0 = off - at 3 a door cat landed in a snow_cabin blocker and the adoption checks lost their seated cat */ },

  species: {
    cat: CAT,
    dog: { size: 1.35, b: 'pet', walk: ['walk_a', 'walk_b'], idle: ['stand', 'sit', 'sit'], sit: 'sit', speed: 0.5, run: 2.75, step: 0.1, hop: 0.014, rock: 0.05, roam: 0.6, follow: 0, followTime: [8, 14], notice: 1.2, wag: 1 },
    sheep: { size: 1.12, b: 'graze', walk: ['stand', 'walk_a'], idle: ['graze', 'graze', 'graze', 'stand'], speed: 0.13, step: 0.09, hop: 0.006, rock: 0.03, roam: 0.45, shuffle: 0.5 },
    cow: { size: 0.95, b: 'graze', walk: ['stand', 'stand'], idle: ['graze', 'graze', 'stand'], speed: 0.09, step: 0.11, hop: 0.006, rock: 0.025, roam: 0.35, shuffle: 0.35 },
    lamb: { b: 'graze', walk: ['stand', 'stand'], idle: ['stand'], air: 'hop', frisky: 0.5, speed: 0.22, run: 0.8, step: 0.07, hop: 0.05, rock: 0.05, roam: 0.5 },
    camel: { size: 0.78, b: 'graze', walk: ['stand', 'walk'], idle: ['stand'], speed: 0.1, step: 0.16, hop: 0.006, rock: 0.02, roam: 0.4 },
    reindeer: { size: 0.9, b: 'graze', walk: ['stand', 'walk'], idle: ['stand'], speed: 0.14, step: 0.14, hop: 0.006, rock: 0.02, roam: 0.5, shuffle: 0.5 },
    hen: { size: 1.55, b: 'peck', walk: ['stand', 'stand'], idle: ['peck', 'stand'], speed: 0.2, run: 1.5, step: 0.05, hop: 0.02, rock: 0.07, roam: 0.35, flee: 0.55 },
    chick: { size: 1.6, b: 'peck', walk: ['stand', 'stand'], idle: ['stand'], speed: 0.22, run: 1.3, step: 0.03, hop: 0.012, rock: 0.09, roam: 0.3, flee: 0.45 },
    songbird: { size: 1.35, b: 'peck', fly: 1, walk: ['perched', 'peck'], idle: ['peck', 'perched'], speed: 0.2, run: 1.6, step: 0.04, hop: 0.02, rock: 0.06, roam: 0.3, flee: 1.7 },
    duck: { size: 1.65, b: 'graze', walk: ['stand', 'walk'], idle: ['stand'], float: 'float', speed: 0.16, step: 0.05, hop: 0.005, rock: 0.08, roam: 0.22, arc: [0.1, 0.26], drift: 0.07 },
    frog: { size: 1.3, b: 'shy', walk: ['sit', 'sit'], idle: ['sit'], speed: 0.3, run: 0.9, step: 0.22, hop: 0.07, rock: 0.0, roam: 0.15, alert: 0.5, flee: 0.35, leap: 1 },
    rabbit: { size: 1.15, b: 'shy', walk: ['sit', 'sit'], idle: ['sit'], air: 'hop', speed: 0.5, run: 2.2, step: 0.26, hop: 0.06, rock: 0.02, roam: 0.4, alert: 1.25, flee: 1.6, zig: 0.55 },
    snow_hare: { b: 'shy', walk: ['sit', 'sit'], idle: ['sit'], air: 'hop', speed: 0.5, run: 2.3, step: 0.28, hop: 0.07, rock: 0.02, roam: 0.4, alert: 1.3, flee: 1.7, zig: 0.55 },
    squirrel: { size: 1.15, b: 'shy', walk: ['sit', 'sit'], idle: ['sit'], air: 'run', speed: 0.6, run: 2.4, step: 0.24, hop: 0.035, rock: 0.02, roam: 0.45, alert: 1.1, flee: 1.4 },
    fox: { size: 1.35, b: 'shy', walk: ['stand', 'walk'], idle: ['sit', 'stand'], sit: 'sit', speed: 0.3, run: 2.3, step: 0.13, hop: 0.012, rock: 0.04, roam: 0.6, alert: 1.5, flee: 1.9 },
    desert_fox: { b: 'shy', walk: ['stand', 'stand'], idle: ['sit', 'stand'], sit: 'sit', speed: 0.3, run: 2.3, step: 0.1, hop: 0.016, rock: 0.05, roam: 0.6, alert: 1.5, flee: 1.9 },
    arctic_fox: { b: 'shy', walk: ['stand', 'stand'], idle: ['sit', 'stand'], sit: 'sit', speed: 0.3, run: 2.3, step: 0.1, hop: 0.016, rock: 0.05, roam: 0.6, alert: 1.5, flee: 1.9 },
    deer: { size: 0.9, b: 'shy', walk: ['stand', 'walk'], idle: ['graze', 'graze', 'stand'], speed: 0.2, run: 2.5, step: 0.17, hop: 0.02, rock: 0.03, roam: 0.5, alert: 1.6, flee: 2.0 },
    hedgehog: { size: 1.25, b: 'shy', walk: ['stand', 'stand'], idle: ['stand'], speed: 0.08, run: 0.08, step: 0.025, hop: 0.003, rock: 0.05, roam: 0.3, alert: 0.8, flee: 0 },
    lizard: { size: 1.4, b: 'shy', walk: ['stand', 'stand'], idle: ['stand'], speed: 0.9, run: 2.6, step: 0.04, hop: 0.0, rock: 0.09, roam: 0.5, alert: 0.9, flee: 1.0, dart: 1, zig: 0.35 },
    owl: { size: 1.15, b: 'perch', walk: ['perched', 'perched'], idle: ['perched'], speed: 0, step: 1, hop: 0, rock: 0.03, roam: 0 },
    penguin: { b: 'graze', walk: ['stand', 'waddle'], idle: ['stand'], speed: 0.2, step: 0.06, hop: 0.006, rock: 0.1, roam: 0.7, gap: 0.2, restless: 1 },
  },

  // spawns[biome][model] wins over spawns.all[model]. Entry: [species, chance, min, max, flags]
  // optional 6th item [east, south, spread]: a tile-space anchor (paddock centre ...), turned with the tile.
  // round 3 - vignettes: the 6th item may instead be 'kind:piece names' (a regex on the names of the tile's pieces as
  // drawn; an optional 7th item is the [east, south, spread] used when the tile has no such piece, else the plain rule):
  //   on:fence|bench     sits ON the piece (feet at its top)          top:tower     perches at the top of a tall piece
  //   at:cart            sits beside the piece                        behind:tree   half hidden behind it, head out
  //   door               asleep / sitting by the door of a house      in:fence_pad  inside the yard those pieces enclose
  // flags: d = by day only, n = at night only, h = one tight group, o = by the door of a house tile,
  //        w = floating on the tile's water, b = on the bank next to water, p = perched on a stump / log / rock,
  //        c = walks in a line behind the first one.
  spawns: {
    all: {
      house: [['cat', 1, 1, 1, 'o', 'door'], ['cat', 0.55, 1, 1, '', 'on:fence|barrels|well'], ['hen', 0.55, 2, 3, 'dh'], ['chick', 0.2, 1, 2, 'dh']],
      village: [['cat', 1, 1, 1, '', 'on:fence|woodpile|crates|barrels|hay'], ['cat', 0.7, 1, 1, '', 'door'], ['hen', 0.7, 3, 3, 'dh', 'in:fence_yard|cart'], ['dog', 0.7, 1, 1, '', 'at:cart']],
      manor: [['cat', 0.75, 1, 1, '', 'on:bench|barrel|fence'], ['cat', 0.5, 1, 1, '', 'door'], ['dog', 0.4, 1, 1, '', 'at:bench|barrel']],
      church: [['cat', 0.55, 1, 1, '', 'on:bench|fence'], ['songbird', 0.4, 2, 3, 'dh']],
      market_square: [['dog', 0.75, 1, 1, '', 'at:cart'], ['cat', 0.7, 1, 1, '', 'on:crates|barrels'], ['cat', 0.3, 1, 1, ''], ['hen', 0.3, 2, 2, 'dh']],
      barn_farm: [['sheep', 0.95, 2, 2, 'h', 'in:fence_pad', [-0.5, 0.46, 0.27]], ['cow', 0.7, 1, 1, ''], ['hen', 0.8, 2, 3, 'dh'], ['chick', 0.5, 2, 2, 'dh'], ['cat', 0.6, 1, 1, '', 'on:fence_pad|hay|barrel_trough'], ['dog', 0.45, 1, 1, '', 'at:cart']],
      windmill: [['cat', 0.5, 1, 1, '', 'on:hay|fence'], ['sheep', 0.4, 2, 2, 'h'], ['hen', 0.3, 2, 2, 'dh'], ['dog', 0.3, 1, 1, '', 'at:cart']],
      pond: [['duck', 1, 1, 1, 'w'], ['duck', 1, 2, 3, 'bh'], ['frog', 0.5, 1, 1, 'b'], ['cat', 0.4, 1, 1, '', 'door']],
      // round 3 (resumed): rows for the new hamlet / river tiles (tiles round 3)
      village_b: [['cat', 1, 1, 1, '', 'on:woodpile|barrels|fence_gd'], ['cat', 0.6, 1, 1, '', 'door'], ['hen', 0.6, 2, 3, 'dh', 'in:fence_gd'], ['songbird', 0.35, 2, 2, 'dh']],
      village_green: [['cat', 0.9, 1, 1, '', 'on:bench'], ['dog', 0.65, 1, 1, '', 'at:guidepost|well|bench'], ['songbird', 0.5, 2, 3, 'dh'], ['hen', 0.35, 2, 3, 'dh'], ['squirrel', 0.3, 1, 1, 'd', 'at:tree']],
      river_reeds: [['duck', 0.8, 1, 2, 'w'], ['duck', 0.7, 2, 2, 'bh'], ['frog', 0.4, 1, 1, 'b'], ['cat', 0.4, 1, 1, '', 'on:barrel']],
      river_straight: [['duck', 0.4, 1, 2, 'w'], ['duck', 0.22, 1, 1, 'b']],
      river_corner: [['duck', 0.4, 1, 2, 'w'], ['frog', 0.25, 1, 1, 'b']],
      river_source: [['frog', 0.45, 1, 1, 'b'], ['duck', 0.3, 1, 1, 'w']],
      bridge: [['duck', 0.35, 1, 2, 'w']],
      lantern_post: [['cat', 0.5, 1, 1, '', 'on:crates']],
      path_straight: [['hen', 0.25, 3, 3, 'dh'], ['dog', 0.15, 1, 1, '']],
      path_corner: [['dog', 0.55, 1, 1, '', 'at:cart', [0.1, 0.4, 0.2]], ['hen', 0.4, 3, 3, 'dh', [0.3, 0.62, 0.2]]],
      path_end: [['dog', 0.15, 1, 1, '']],
      desert_camp: [['camel', 0.85, 1, 2, 'h', 'at:palm|tent_c'], ['cat', 0.3, 1, 1, '', 'on:crates'], ['desert_fox', 0.3, 1, 1, 'n']],
      desert_market: [['camel', 0.6, 1, 1, ''], ['dog', 0.45, 1, 1, ''], ['cat', 0.45, 1, 1, ''], ['hen', 0.3, 2, 2, 'dh']],
      desert_oasis: [['camel', 0.6, 1, 2, 'h'], ['lizard', 0.4, 1, 1, 'd'], ['duck', 0.3, 1, 1, 'w']],
      desert_dunes: [['lizard', 0.4, 1, 2, 'd'], ['desert_fox', 0.32, 1, 1, 'n'], ['camel', 0.07, 1, 1, '']],
      desert_dunes_b: [['lizard', 0.4, 1, 2, 'd'], ['desert_fox', 0.32, 1, 1, 'n'], ['camel', 0.07, 1, 1, '']],
      desert_dunes_c: [['lizard', 0.4, 1, 2, 'd'], ['desert_fox', 0.32, 1, 1, 'n']],
      desert_cacti: [['lizard', 0.45, 1, 2, 'd'], ['desert_fox', 0.3, 1, 1, 'n']],
      desert_ruin: [['lizard', 0.6, 1, 2, 'd'], ['desert_fox', 0.5, 1, 1, 'n'], ['owl', 0.3, 1, 1, 'np']],
      snow_pines: [['snow_hare', 0.35, 1, 2, ''], ['reindeer', 0.25, 2, 3, 'h'], ['arctic_fox', 0.2, 1, 1, ''], ['owl', 0.25, 1, 1, 'np']],
      snow_drifts: [['reindeer', 0.32, 2, 3, 'h'], ['snow_hare', 0.3, 1, 2, ''], ['arctic_fox', 0.18, 1, 1, '']],
      snow_cabin: [['cat', 0.5, 1, 1, 'o', 'on:woodpile|fence'], ['reindeer', 0.25, 1, 2, 'h'], ['dog', 0.2, 1, 1, '', 'at:sled']],
      snow_hamlet: [['cat', 0.7, 1, 1, '', 'on:woodpile|fence'], ['cat', 0.4, 1, 1, '', 'door'], ['dog', 0.3, 1, 1, '', 'at:sled|snowman']],
      frozen_pond: [['penguin', 0.95, 3, 4, 'ch'], ['penguin', 0.5, 1, 1, '', 'at:sled|sign|igloo']],
      blossom_orchard: [['songbird', 0.5, 2, 3, 'dh'], ['lamb', 0.3, 1, 2, 'h'], ['rabbit', 0.2, 1, 1, '']],
      blossom_garden: [['songbird', 0.5, 2, 3, 'dh'], ['lamb', 0.35, 2, 2, 'h'], ['cat', 0.2, 1, 1, ''], ['rabbit', 0.25, 1, 1, '']],
      blossom_gazebo: [['cat', 0.45, 1, 1, ''], ['songbird', 0.5, 2, 3, 'dh']],
      blossom_lane: [['songbird', 0.4, 2, 3, 'dh'], ['cat', 0.15, 1, 1, '']],
      deep_pines: [['deer', 0.3, 1, 1, '', 'behind:pine'], ['squirrel', 0.4, 1, 1, 'd', 'at:pine|stump'], ['fox', 0.2, 1, 1, 'd', 'behind:pine|mossy_boulder'], ['fox', 0.35, 1, 1, 'n'], ['hedgehog', 0.35, 1, 1, 'n'], ['owl', 0.45, 1, 1, 'np'], ['rabbit', 0.2, 1, 1, '']],
      mushroom_glade: [['hedgehog', 0.6, 1, 1, 'n'], ['rabbit', 0.4, 1, 2, ''], ['squirrel', 0.4, 1, 1, 'd'], ['deer', 0.25, 1, 1, '']],
      fallen_log: [['squirrel', 0.5, 1, 1, 'd', 'on:log'], ['owl', 0.6, 1, 1, 'np'], ['fox', 0.35, 1, 1, '', 'behind:pine|boulder'], ['hedgehog', 0.4, 1, 1, 'n']],
      watchtower: [['cat', 0.35, 1, 1, ''], ['owl', 0.85, 1, 1, 'np', 'top:tower$'], ['dog', 0.2, 1, 1, ''], ['squirrel', 0.35, 1, 1, 'd', 'at:pine|stump']],
      grove: [['rabbit', 0.3, 1, 2, ''], ['squirrel', 0.4, 1, 1, 'd', 'at:tree'], ['fox', 0.3, 1, 1, 'd', 'behind:tree|bush'], ['fox', 0.4, 1, 1, 'n'], ['deer', 0.2, 1, 1, '', 'behind:tree'], ['hedgehog', 0.35, 1, 1, 'n'], ['cat', 0.25, 1, 1, '', 'on:bench']],
      forest: [['squirrel', 0.45, 1, 1, 'd', 'at:tree|pine|stump'], ['deer', 0.25, 1, 1, '', 'behind:tree|pine'], ['fox', 0.3, 1, 1, 'd', 'behind:tree|pine|bush'], ['fox', 0.4, 1, 1, 'n'], ['rabbit', 0.25, 1, 1, ''], ['hedgehog', 0.3, 1, 1, 'n'], ['owl', 0.3, 1, 1, 'np']],
    },
    heartland: {
      meadow: [['sheep', 0.6, 2, 4, 'h', 'in:fence_pad', [0.24, 0.02, 0.26]], ['cat', 0.3, 1, 1, '', 'on:fence_pad'], ['lamb', 0.1, 1, 1, ''], ['cow', 0.09, 1, 2, 'h'], ['rabbit', 0.14, 1, 2, '']],
      meadow_flowers: [['rabbit', 0.2, 1, 2, ''], ['sheep', 0.15, 2, 3, 'h'], ['songbird', 0.2, 2, 3, 'dh']],
      hills: [['sheep', 0.22, 2, 3, 'h'], ['rabbit', 0.2, 1, 1, '']],
      rocks: [['rabbit', 0.2, 1, 1, ''], ['fox', 0.12, 1, 1, '']],
    },
    desert: {
      meadow: [['lizard', 0.35, 1, 2, 'd'], ['desert_fox', 0.3, 1, 1, 'n'], ['camel', 0.08, 1, 2, 'h']],
      rocks: [['lizard', 0.5, 1, 2, 'd'], ['desert_fox', 0.3, 1, 1, 'n']],
    },
    snow: {
      meadow: [['reindeer', 0.22, 2, 3, 'h'], ['snow_hare', 0.3, 1, 2, ''], ['arctic_fox', 0.15, 1, 1, '']],
      rocks: [['snow_hare', 0.3, 1, 1, ''], ['arctic_fox', 0.25, 1, 1, '']],
      hills: [['reindeer', 0.3, 2, 3, 'h'], ['snow_hare', 0.2, 1, 1, '']],
    },
    blossom: {
      meadow: [['lamb', 0.35, 2, 3, 'h'], ['songbird', 0.35, 2, 3, 'dh'], ['rabbit', 0.2, 1, 1, '']],
      meadow_flowers: [['songbird', 0.45, 2, 3, 'dh'], ['lamb', 0.25, 2, 2, 'h'], ['rabbit', 0.2, 1, 1, '']],
      grove: [['songbird', 0.5, 2, 3, 'dh'], ['rabbit', 0.3, 1, 1, ''], ['deer', 0.15, 1, 1, ''], ['squirrel', 0.3, 1, 1, 'd']],
      forest: [['songbird', 0.4, 2, 3, 'dh'], ['deer', 0.2, 1, 2, 'h'], ['squirrel', 0.3, 1, 1, 'd'], ['rabbit', 0.25, 1, 1, '']],
      hills: [['lamb', 0.3, 2, 2, 'h'], ['rabbit', 0.2, 1, 1, '']],
    },
    pinewood: {
      meadow: [['rabbit', 0.25, 1, 2, ''], ['deer', 0.2, 1, 2, 'h'], ['fox', 0.25, 1, 1, 'n'], ['hedgehog', 0.3, 1, 1, 'n']],
      meadow_flowers: [['rabbit', 0.3, 1, 2, ''], ['deer', 0.2, 1, 1, ''], ['hedgehog', 0.3, 1, 1, 'n']],
      rocks: [['fox', 0.25, 1, 1, ''], ['owl', 0.4, 1, 1, 'np'], ['squirrel', 0.3, 1, 1, 'd']],
      hills: [['deer', 0.25, 1, 2, 'h'], ['rabbit', 0.2, 1, 1, '']],
    },
  },

  /** Mesh names of a tile model an owl may perch on (first match by hash), and the height window of their tops. */
  perch: { names: 'stump|log|rock|stone|boulder|post|fence|crate|barrel|sign|well', top: [0.06, 0.62] },
};
