// Static game data: the three Primes, ingredients, potions, the chart, places, lore and quests.
// Pure data + small pure helpers. No rendering, no DOM. Safe to import from anywhere.
// Tone: dark fantasy. Grave, spare, no jokes.

// ---------------------------------------------------------------------------------------------
// The Tria Prima. Every mixture is a point inside a triangle whose corners are the three Primes.
// A mixture is stored as barycentric coordinates [s, m, k] with s + m + k = 1:
//   s = Sulfur (the soul that burns), m = Mercury (the spirit that flows), k = Salt (the body that holds).
// ---------------------------------------------------------------------------------------------
export const PRIMES = {
  sulfur: { id: 'sulfur', name: 'Sulfur', epithet: 'the soul that burns', color: '#d9902f', index: 0 },
  mercury: { id: 'mercury', name: 'Mercury', epithet: 'the spirit that flows', color: '#9db4c9', index: 1 },
  salt: { id: 'salt', name: 'Salt', epithet: 'the body that holds', color: '#d8cfc4', index: 2 },
};
export const PRIME_ORDER = ['sulfur', 'mercury', 'salt'];

// ---------------------------------------------------------------------------------------------
// Ingredients. `bary` is where the ingredient sits on the chart, `weight` how hard it pulls.
// `color` is the dye it bleeds into the cauldron.
// ---------------------------------------------------------------------------------------------
export const INGREDIENTS = {
  cinderbloom: {
    id: 'cinderbloom',
    name: 'Cinderbloom',
    latin: 'Flos cineris',
    bary: [0.86, 0.04, 0.1],
    weight: 1.0,
    color: '#e8571c',
    glow: 0.7,
    where: 'Scorched ground and old pyres in Hearthfall.',
    desc: 'A flower of charred petals that never finished burning. It grows where something was set alight and no one stayed to watch.',
    regrow: 240,
  },
  saltwort: {
    id: 'saltwort',
    name: 'Saltwort',
    latin: 'Salsola fida',
    bary: [0.14, 0.18, 0.68],
    weight: 1.0,
    color: '#b9c2ac',
    glow: 0.0,
    where: 'Shores, graves and stony ground all over the isle.',
    desc: 'A pale, jointed herb crusted with its own salt. It thrives on graves. It is in nearly every recipe.',
    regrow: 200,
  },
  weepcap: {
    id: 'weepcap',
    name: 'Weepcap',
    latin: 'Mycena lacrimans',
    bary: [0.12, 0.58, 0.3],
    weight: 0.8,
    color: '#4f8f9a',
    glow: 0.2,
    where: 'Riverbanks, wells and damp hollows.',
    desc: 'A grey-blue mushroom that is never dry. It drips without rain, and the ground beneath it stays dark.',
    regrow: 260,
  },
  mirrorlily: {
    id: 'mirrorlily',
    name: 'Mirrorlily',
    latin: 'Nymphaea speculi',
    bary: [0.04, 0.9, 0.06],
    weight: 1.0,
    color: '#b8c7d6',
    glow: 0.3,
    where: 'The black shallows of Quickmere.',
    desc: 'A funeral-pale lily holding a bead of living silver. The bead turns to follow you.',
    regrow: 240,
  },
  corpselight: {
    id: 'corpselight',
    name: 'Corpselight',
    latin: 'Lux mortuorum',
    bary: [0.34, 0.08, 0.58],
    weight: 0.8,
    color: '#8fd9a0',
    glow: 1.0,
    where: 'Dead wood and salt-figures in the Saltwood. Brightest at night.',
    desc: 'A fungus that glows the colour of a held breath. It grows on what has stopped moving.',
    regrow: 300,
  },
  stormthistle: {
    id: 'stormthistle',
    name: 'Stormthistle',
    latin: 'Carduus fulminis',
    bary: [0.48, 0.46, 0.06],
    weight: 1.0,
    color: '#d8c25a',
    glow: 0.5,
    where: 'Wind-scoured ridges below the Brimstone Scar.',
    desc: 'It crackles before rain. The dead soldiers of the ridge were found with it growing through their mail.',
    regrow: 300,
  },
  halite: {
    id: 'halite',
    name: 'Halite',
    latin: 'Sal gemmae',
    bary: [0.0, 0.03, 0.97],
    weight: 1.4,
    color: '#e6d3d2',
    glow: 0.25,
    where: 'Crystal seams deep in the Saltwood.',
    desc: 'Rock salt, rose-white and perfectly square. Salt at its most unforgiving.',
    regrow: 420,
  },
  quicksilver: {
    id: 'quicksilver',
    name: 'Quicksilver',
    latin: 'Argentum vivum',
    bary: [0.0, 0.98, 0.02],
    weight: 1.4,
    color: '#cfd8e4',
    glow: 0.35,
    where: 'Still pools on the islets of Quickmere.',
    desc: 'Metal that refuses to hold a shape. Heavier than it looks. It remembers every face that leaned over it.',
    regrow: 420,
  },
  brimstone: {
    id: 'brimstone',
    name: 'Brimstone',
    latin: 'Sulphur vivum',
    bary: [0.97, 0.03, 0.0],
    weight: 1.4,
    color: '#e0b62e',
    glow: 0.45,
    where: 'Around the vents of the Brimstone Scar.',
    desc: 'Yellow crystal that burns with a blue flame and the smell of a struck match. The fire knows its name.',
    regrow: 420,
  },
};
export const INGREDIENT_ORDER = ['cinderbloom', 'saltwort', 'weepcap', 'mirrorlily', 'corpselight', 'stormthistle', 'halite', 'quicksilver', 'brimstone'];

// The three pure Primes: key items won at the shrines, used only for the Great Work.
export const PRIME_ITEMS = {
  salt: { id: 'salt', name: 'Prime Salt', desc: 'Body without flaw. A cube that casts no shadow inside itself.', color: '#f1e4e2' },
  mercury: { id: 'mercury', name: 'Prime Mercury', desc: 'Spirit without rest. It hangs in the air like a held breath.', color: '#cfdcec' },
  sulfur: { id: 'sulfur', name: 'Prime Sulfur', desc: 'Soul without ash. It burns and is not consumed.', color: '#f0b93a' },
};

// ---------------------------------------------------------------------------------------------
// Potions. Each owns a round region on the chart (`center`, `radius`) and a heat band (0..1).
// `key` is its fixed belt slot (number key).
// ---------------------------------------------------------------------------------------------
export const POTIONS = {
  ember: {
    id: 'ember',
    key: 1,
    name: 'Ember',
    full: 'Ember Phial',
    motto: 'Pure Soul: flame.',
    center: [1, 0, 0],
    radius: 0.24,
    heat: [0.7, 1.0],
    color: '#f0561c',
    color2: '#ffc56a',
    throw: true,
    drink: false,
    effect: 'Bursts into fire. Burns briar, lights lanterns and braziers, melts ice, unmakes Shades.',
    hint: 'Three Cinderblooms over a roaring fire.',
  },
  verdance: {
    id: 'verdance',
    key: 2,
    name: 'Verdance',
    full: 'Verdance',
    motto: 'Soul bound to Body: life, of a kind.',
    center: [0.5, 0, 0.5],
    radius: 0.16,
    heat: [0.35, 0.65],
    color: '#5c9a3c',
    color2: '#b9d67a',
    throw: true,
    drink: false,
    effect: 'Wakes sleeping seeds into briar you can climb, and forces dead ground to flower.',
    hint: 'Cinderbloom and Saltwort in equal parts, over a middling fire.',
  },
  rime: {
    id: 'rime',
    key: 3,
    name: 'Rime',
    full: 'Rime',
    motto: 'Spirit held by Body: stillness.',
    center: [0, 0.5, 0.5],
    radius: 0.16,
    heat: [0.05, 0.3],
    color: '#7fc3dc',
    color2: '#e3f4fa',
    throw: true,
    drink: false,
    effect: 'Freezes water into floes that bear your weight, crusts lava, snuffs fire, holds Shades still.',
    hint: 'Mirrorlily and Saltwort over dying embers. Let the fire sink low.',
  },
  levity: {
    id: 'levity',
    key: 4,
    name: 'Levity',
    full: 'Levity',
    motto: 'Pure Spirit: rising.',
    center: [0, 1, 0],
    radius: 0.24,
    heat: [0.2, 0.5],
    color: '#a99bd6',
    color2: '#e6e1f5',
    throw: true,
    drink: true,
    effect: 'Thrown, it unburdens heavy things. Drunk, it lets you leap high and fall like ash.',
    hint: 'Mirrorlily alone, over a gentle heat.',
  },
  fulminate: {
    id: 'fulminate',
    key: 5,
    name: 'Fulminate',
    full: 'Fulminate',
    motto: 'Soul loosed by Spirit: thunder.',
    center: [0.5, 0.5, 0],
    radius: 0.16,
    heat: [0.55, 0.85],
    color: '#e6c93e',
    color2: '#fff3bd',
    throw: true,
    drink: false,
    effect: 'Detonates. Breaks cracked stone and throws everything nearby, you included.',
    hint: 'Cinderbloom and Mirrorlily over a hot fire. Not the hottest.',
  },
  saltspire: {
    id: 'saltspire',
    key: 6,
    name: 'Saltspire',
    full: 'Saltspire',
    motto: 'Pure Body: standing.',
    center: [0, 0, 1],
    radius: 0.24,
    heat: [0.45, 0.8],
    color: '#e3bcc2',
    color2: '#ffffff',
    throw: true,
    drink: false,
    effect: 'Raises a pillar of salt where it lands. Stand on it, or let it lift what lies in the way.',
    hint: 'Halite over a strong fire.',
  },
  vitae: {
    id: 'vitae',
    key: 7,
    name: 'Aqua Vitae',
    full: 'Aqua Vitae',
    motto: 'All three in balance: mending.',
    center: [1 / 3, 1 / 3, 1 / 3],
    radius: 0.12,
    heat: [0.4, 0.6],
    color: '#d9a93c',
    color2: '#ffe9ae',
    throw: false,
    drink: true,
    effect: 'Closes wounds and keeps closing them for a while.',
    hint: 'All three Primes in balance, over a steady fire.',
  },
};
export const POTION_ORDER = ['ember', 'verdance', 'rime', 'levity', 'fulminate', 'saltspire', 'vitae'];

// The Great Work: brewed from the three pure Primes in four stages of rising heat.
export const OPUS = {
  center: [1 / 3, 1 / 3, 1 / 3],
  stages: [
    { id: 'nigredo', name: 'Nigredo', sub: 'the blackening', heat: [0.08, 0.3], color: '#07060a', seconds: 7 },
    { id: 'albedo', name: 'Albedo', sub: 'the whitening', heat: [0.34, 0.54], color: '#e9ecf5', seconds: 7 },
    { id: 'citrinitas', name: 'Citrinitas', sub: 'the yellowing', heat: [0.58, 0.78], color: '#e9b92e', seconds: 7 },
    { id: 'rubedo', name: 'Rubedo', sub: 'the reddening', heat: [0.82, 1.0], color: '#c4121f', seconds: 7 },
  ],
};

export const BREW = {
  capacity: 8, // ingredients per brew
  bindSeconds: 6, // stirring time, in band, to finish a potion
  maxCarry: 9, // bottles of one kind
  yield: [2, 3, 4], // bottles for one, two, three marks of purity
};

// ---------------------------------------------------------------------------------------------
// Chart math.
// ---------------------------------------------------------------------------------------------
const SQ3_2 = 0.8660254037844386;

/** Barycentric [s,m,k] -> 2D point in a unit-side triangle: Mercury (0,0), Salt (1,0), Sulfur (0.5, 0.866). */
export function baryTo2D(b) {
  return [b[2] + 0.5 * b[0], SQ3_2 * b[0]];
}
/** Distance between two barycentric points, measured in the unit-side triangle plane. */
export function baryDist(a, b) {
  const ds = a[0] - b[0],
    dm = a[1] - b[1],
    dk = a[2] - b[2];
  return Math.sqrt(Math.max(0, -(ds * dm + dm * dk + dk * ds)));
}
/** Weighted mix of ingredient ids -> { bary:[s,m,k], total, count } (bary is null when empty). */
export function mixOf(contents) {
  let s = 0,
    m = 0,
    k = 0,
    w = 0;
  for (const id of contents) {
    const ing = INGREDIENTS[id];
    if (!ing) continue;
    s += ing.bary[0] * ing.weight;
    m += ing.bary[1] * ing.weight;
    k += ing.bary[2] * ing.weight;
    w += ing.weight;
  }
  if (w <= 0) return { bary: null, total: 0, count: 0 };
  return { bary: [s / w, m / w, k / w], total: w, count: contents.length };
}
/** Which potion region contains this point? -> { id, dist, quality 0..1, stars 1..3 } or null. */
export function regionAt(bary) {
  if (!bary) return null;
  let best = null;
  for (const id of POTION_ORDER) {
    const p = POTIONS[id];
    const d = baryDist(bary, p.center);
    if (d <= p.radius) {
      const q = 1 - d / p.radius;
      if (!best || q > best.quality) best = { id, dist: d, quality: q, stars: q > 0.62 ? 3 : q > 0.3 ? 2 : 1 };
    }
  }
  return best;
}
export function yieldFor(stars) {
  return BREW.yield[Math.max(1, Math.min(3, stars)) - 1];
}
/** Position of a heat value relative to a band: -1 too cold, 0 inside, +1 too hot. */
export function heatFit(heat, band) {
  return heat < band[0] ? -1 : heat > band[1] ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Places.
// ---------------------------------------------------------------------------------------------
export const ISLE = 'Morne';

export const REGIONS = {
  shore: { id: 'shore', name: 'The Grey Landing', sub: 'Isle of Morne' },
  vale: { id: 'vale', name: 'Hearthfall', sub: 'where the Athanor went cold' },
  saltwood: { id: 'saltwood', name: 'The Saltwood', sub: 'nothing here rots' },
  mere: { id: 'mere', name: 'Quickmere', sub: 'the mirror that does not rest' },
  scar: { id: 'scar', name: 'Brimstone Scar', sub: 'the isle remembers its fire' },
  heights: { id: 'heights', name: 'Greyhorn', sub: 'the cold shoulder of the isle' },
};

// Lanterns of the dead: stone towers that hold a flame. Lit with Ember, they become resting places
// (respawn points) and can be travelled between.
export const LANTERNS = {
  chapel: { id: 'chapel', name: 'The Chapel of the Athanor', region: 'vale' },
  saltwood: { id: 'saltwood', name: 'Saltwood Gate', region: 'saltwood' },
  mere: { id: 'mere', name: 'Quickmere Shore', region: 'mere' },
  scar: { id: 'scar', name: 'Scar Mouth', region: 'scar' },
};

// ---------------------------------------------------------------------------------------------
// Lore: the notes of Magistra Odile Varn. `reveals` inks a potion's region onto the chart.
// ---------------------------------------------------------------------------------------------
export const LORE = {
  letter: {
    id: 'letter',
    title: 'A letter, left under the pestle',
    body: [
      'Apprentice,',
      'If you are reading this, the Athanor is cold and I am not coming back. Do not look for me.',
      'The isle was made of three Primes, as all things are. Sulfur, the soul that burns. Mercury, the spirit that flows. Salt, the body that holds. While the fire burned they kept their order. Now the Gloom has come up out of the ground, and what it touches forgets what it was.',
      'Each Prime still lies in its pure form where the Gloom is thickest. Bring the three to the cauldron. The Work will show you the rest.',
      'Begin with flame. It is the only thing the dark still fears.',
    ],
    sign: 'O. V.',
    reveals: 'ember',
  },
  flame: {
    id: 'flame',
    title: 'Of flame',
    body: [
      'Pure Sulfur wants a roaring fire. Three Cinderblooms, the bellows, a steady hand on the ladle.',
      'Watch the chart, not the pot. When the mark sits in the corner and the fire is high, stir until it binds.',
    ],
    reveals: 'ember',
  },
  green: {
    id: 'green',
    title: 'Of green things',
    body: [
      'Soul bound to Body is Life, of a kind. Cinderbloom and Saltwort in equal parts, over a middling fire.',
      'Cast it on a sleeping seed. What grows is briar, and it does not care what it climbs.',
    ],
    reveals: 'verdance',
  },
  stillness: {
    id: 'stillness',
    title: 'Of stillness',
    body: [
      'Spirit held by Body is Stillness. Mirrorlily and Saltwort over dying embers. Let the fire sink low before you stir.',
      'The Mere will bear your weight for a while. It has borne heavier.',
    ],
    reveals: 'rime',
  },
  rising: {
    id: 'rising',
    title: 'Of rising',
    body: [
      'Pure Spirit obeys no weight. Mirrorlily alone, over a gentle heat.',
      'Thrown, it unburdens stone. Drunk, it unburdens you. The ground is patient either way.',
    ],
    reveals: 'levity',
  },
  thunder: {
    id: 'thunder',
    title: 'Of thunder',
    body: [
      'Soul loosed by Spirit is Thunder. Cinderbloom and Mirrorlily over a hot fire, though not the hottest.',
      'Cracked stone cannot bear it. Stand well back.',
    ],
    reveals: 'fulminate',
  },
  standing: {
    id: 'standing',
    title: 'Of standing stones',
    body: [
      'Pure Body remembers its shape. Halite over a strong fire. Where it falls, a pillar rises.',
      'The Saltwood is full of pillars. Not all of them were made on purpose.',
    ],
    reveals: 'saltspire',
  },
  mending: {
    id: 'mending',
    title: 'Of mending',
    body: [
      'All three in balance make the water of life. A steady, middling fire.',
      'It closes wounds. It does not bring anything back.',
    ],
    reveals: 'vitae',
  },
  gloom: {
    id: 'gloom',
    title: 'Of the Gloom',
    body: [
      'The Gloom is not a creature and it is not a curse. It is what remains when a place forgets its Primes.',
      'The Shades are only its hunger, wearing what it found. Flame unmakes them. Cold holds them still. Do not let them hold you.',
    ],
  },
  work: {
    id: 'work',
    title: 'Of the Great Work',
    body: [
      'Black, white, gold, red. The Work is one fire, climbing.',
      'Begin with the embers almost out, and end with the bellows roaring. Each colour will tell you when it is finished with you.',
      'Do not stop stirring.',
    ],
  },
  last: {
    id: 'last',
    title: 'The last page',
    body: [
      'I had the three, once. I was afraid of the fourth colour, and I let the fire die while I was afraid. That is all the Gloom is.',
      'You are not me. That was the point of you.',
    ],
    sign: 'O. V.',
  },
};
export const LORE_ORDER = ['letter', 'flame', 'mending', 'green', 'gloom', 'stillness', 'rising', 'thunder', 'standing', 'work', 'last'];

// ---------------------------------------------------------------------------------------------
// The main quest. `stage` advances in order until 'primes', where the three hunts run in parallel.
// ---------------------------------------------------------------------------------------------
export const QUEST = {
  arrive: { id: 'arrive', title: 'The cold Athanor', text: 'Follow the road up to the chapel.' },
  letter: { id: 'letter', title: 'The cold Athanor', text: 'Read the letter on the workbench.' },
  gather: { id: 'gather', title: 'Begin with flame', text: 'Gather three Cinderblooms from the scorched ground below the chapel.' },
  brew: { id: 'brew', title: 'Begin with flame', text: 'Brew Ember at the cauldron.' },
  kindle: { id: 'kindle', title: 'Begin with flame', text: 'Throw an Ember into the mouth of the Athanor.' },
  primes: { id: 'primes', title: 'The three Primes', text: 'Recover the pure Primes from under the Gloom.' },
  opus: { id: 'opus', title: 'The Great Work', text: 'Unite the three Primes in the cauldron.' },
  stone: { id: 'stone', title: 'The Great Work', text: 'Set the Stone in the heart of the Athanor.' },
  done: { id: 'done', title: 'The Athanor burns', text: 'Morne is yours to walk.' },
};
export const QUEST_ORDER = ['arrive', 'letter', 'gather', 'brew', 'kindle', 'primes', 'opus', 'stone', 'done'];

export const PRIME_HUNTS = {
  salt: { id: 'salt', region: 'saltwood', text: 'Prime Salt lies in the Elder Hollow, deep in the Saltwood.' },
  mercury: { id: 'mercury', region: 'mere', text: 'Prime Mercury rests on the far islet of Quickmere.' },
  sulfur: { id: 'sulfur', region: 'scar', text: 'Prime Sulfur burns at the heart of the Brimstone Scar.' },
};

export const GAME_TITLE = 'Tria Prima';
export const GAME_VERSION = '1.1.1';
