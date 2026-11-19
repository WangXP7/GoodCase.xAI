// Where everything is. Pure data: no three.js, no DOM. +x east, +z south, y up; the store is on
// the north side (z = -20), the highway to the south. Yaw 0 looks north (-z), +yaw turns left (west).
//
//         x=-22                 x=0                  x=22
//   z=-30  +--alley--+======== STORE ========+==== DINER (boarded) ====
//   z=-20  |  dump-  |   pavement, awning    |   door [locked 750]
//          |  sters  P  P  P  [SUV]   [cruiser]             (dead lamp D)
//   z=-10  G3        +-------- canopy -------+   G5
//          |         | [I1]  pickup  [I2]    |      [wagon]>B lamp
//   z=-4   C lamp    |       narrow lane     |
//    z=0   |         | [I3]          [I4]    |   F2 (climb)
//    z=3   F1(climb) +---[sedan]-------------+
//          |                         <tractor\\
//   z=10   G4   [hatch]      start *          \\trailer\\   G6
//          |  sign                             \\      \\  (narrow lane behind)
//   z=20   +--A lamp--[ drive ]----E lamp---[ drive ]-----+
//                       G1 (barriers)         G2
//   z=34   ============ highway embankment, stalled traffic ============

export const LOT = { x0: -23, x1: 23, z0: -31, z1: 21.5 };
export const DRIVES = [[-14, -7], [5, 12]];
export const FENCE = { w: -22.3, e: 22.3, s: 20.3, alley: -30 };
export const CANOPY = { x0: -13, x1: 9, z0: -10, z1: 3, under: 4.8 };
export const ISLANDS = [[-7.5, -6.5], [3.5, -6.5], [-7.5, -0.5], [3.5, -0.5]];

// Ways in through the wire. Everything that has to agree about them is derived from this one
// table: the holes cut in the fence runs, the sagging climb sections and the clearings the treeline
// keeps open behind them. (The spawn points are worldLayout.js's; a torn panel is a
// GAP_W hole a zombie squeezes through and the player cannot; the east fence is the forecourt's
// side of the garage and the alley now, with the alley mouth and the d4 gate cut in it there.)
//   gaps: where the mesh is torn open (coordinate along the run), each GAP_W wide
//   climbs: where the top rail sags and something can come over
export const GAP_W = 0.5;
export const OPENINGS = {
  west: { gaps: [-12.7, 11.5], climbs: [3] }, // z along x = FENCE.w
  east: { gaps: [], climbs: [] }, // z along x = FENCE.e
  alley: { gaps: [-18.7] }, // x along z = FENCE.alley
};
// the east fence's two openings: the service alley's mouth (always open) and the scrapyard gate (d4)
export const EAST_CUTS = { alley: [-12.75, -10.25], gate: [8.9, 11.3] };
export const SAG = { depth: 0.75, width: 3.2, top: 1.65 };

// Parked vehicles. yaw as in M(): 0 points the nose east (+x), positive turns it toward north.
export const vehicles = [
  { id: 'saloon', x: -8.4, z: 1.62, yaw: Math.PI, type: 'sedan', paint: 'paintCarA', plate: 'plateA', doorAjar: 1.05, dome: true, fuelOpen: 1, story: true },
  { id: 'pickup', x: 4.2, z: -8.7, yaw: 0, type: 'pickup', paint: 'paintCarB', plate: 'plateB', rim: 'paintGalv' },
  { id: 'hatch', x: -14.5, z: 10.5, yaw: 0.45, type: 'hatch', paint: 'paintCarE', plate: 'plateC', flat: 'fl', head: 0.45, tail: true },
  { id: 'suv', x: -9.0, z: -14.75, yaw: Math.PI / 2, type: 'suv', paint: 'paintCarD', plate: 'plateD' },
  { id: 'cruiser', x: 2.2, z: -13.0, yaw: Math.PI + 0.32, type: 'sedan', paint: 'paintCarB', plate: 'plateB', lightbar: true, shield: true, doorAjar: 1.25, rim: 'paintGalv' },
  { id: 'wagon', x: 18.6, z: -6.3, yaw: -0.683, type: 'wagon', paint: 'paintCarC', plate: 'plateA', hazard: true, flat: 'rr' },
];
// jack-knifed lorry: the trailer's centre and yaw; the tractor is folded back by `fold` at the kingpin
export const LORRY = { x: 13.5, z: 12, yaw: 2.41, fold: 1.15 };

export const DRAINS = [[-13.5, -17.05], [8.0, -17.05], [-2.5, 19.6]];

export const bounds = { min: [-34, -2, -38], max: [34, 14, 34] };
// the interior the player is meant to fight in (fence to fence, pavement kerb to south fence)
export const playable = { min: [FENCE.w, 0, -20], max: [FENCE.e, 6, FENCE.s] };

export const playerStart = { pos: [-4, 0, 12], yaw: 0.12 };

export const areas = [
  { name: 'canopy', min: [CANOPY.x0, 0, CANOPY.z0], max: [CANOPY.x1, CANOPY.under, CANOPY.z1] },
  { name: 'awning', min: [-15.3, 0, -20], max: [7.3, 3.05, -17.55] },
];

const sides = [['west', FENCE.w, -1], ['east', FENCE.e, 1]]; // name, fence x, outward sign

// Gaps and sags of one fence run, as distances from the run's start, for buildFence.
export const fenceCuts = (name, start) => ({
  gaps: OPENINGS[name].gaps.map((c) => [c - start - GAP_W / 2, c - start + GAP_W / 2]),
  sags: (OPENINGS[name].climbs || []).map((c) => ({ at: c - start, depth: SAG.depth, width: SAG.width })),
});

// the forecourt's own (the doors, the power and the boards are the world's: world.js)
export const interactables = [
  { id: 'ammo-store', kind: 'wallAmmo', pos: [6.02, 1.3, -19.5], radius: 1.6, cost: 250, label: 'Ammo', zone: 'forecourt' },
];

// cam: [x, y, z, yaw, pitch]
export const shots = {
  title: { cam: [-12.5, 0.75, 17.2, -0.38, 0.13], fov: 50 },
  wide: { cam: [-21.2, 3.6, 12.5, -1.17, -0.1], fov: 70 }, // panned so the hatchback below is beside the gun, not behind it (it read as a hole in the frame)
  canopy: { cam: [-14.6, 1.7, -3.4, -1.62, 0.07], fov: 62 },
  pumps: { cam: [-10.9, 1.6, -3.9, -1.05, -0.02], fov: 52 },
  lane: { cam: [21.0, 1.7, 19.4, 0.16, 0.05], fov: 62 },
  'zombies-near': { cam: [-2.2, 1.7, -3.5, -1.5708, -0.3], fov: 70 },
  'zombies-far': { cam: [-5.6, 1.7, -9.3, 1.37, 0.09], fov: 58 },
  weapon: { cam: [-4, 1.7, 9.5, 0.2, 0.0], fov: 70 },
  // the weapon shot on the frame of a shot (stepped harness only): flash, its light on gun, glove and ground, the casing leaving
  firing: { cam: [-4, 1.7, 9.5, 0.2, 0.0], fov: 70, fire: 1 },
  // the north edge: the store front with the ammo wall buy on its east pier; the boarded diner door
  store: { cam: [-5, 1.7, -10.6, -0.45, 0.03], fov: 62 },
  door: { cam: [9.2, 1.7, -12.4, -0.33, 0.05], fov: 60 },
  // from the west drive, up the ramp to the highway: barriers, the jam, the sign truss
  highway: { cam: [-10.5, 1.7, 20.9, 3.61, 0.07], fov: 62 },
  // knee height in the middle pump lane, looking east: stains, the fuel spill, wheel polish, paint, kerbs
  ground: { cam: [-11.2, 0.5, -2.4, -1.5708, -0.1], fov: 55 },
  // what happened at the red saloon: the door left open, hands dragged down the rear glass, the
  // pool by the sill and the trail leading off into the dark
  story: { cam: [-5.7, 1.5, 5.3, 0.92, -0.2], fov: 55 },
};

// ---- ground material inputs ---------------------------------------------------------------------
const skid = (x, z, length, width, rot) => ({ x, z, length, width, rot, kind: 'skid', wear: 0.1 });
export const ground = {
  bounds: [-40, -40, 40, 40],
  puddleNoise: 1.05,
  puddle: 0.04,
  puddles: [
    { x: -17.5, z: 16.5, r: 3.2, depth: 0.55 }, { x: -11, z: 13.5, r: 2.4, depth: 0.45 }, { x: -3.5, z: 8.2, r: 2.3, depth: 0.45 },
    { x: -16, z: 2, r: 2.6, depth: 0.45 }, { x: 1.5, z: 5.4, r: 3, depth: 0.5 }, { x: -6, z: -12.6, r: 2.6, depth: 0.45 },
    { x: 11.5, z: -13, r: 3, depth: 0.5 }, { x: 15, z: 1.5, r: 3, depth: 0.5 }, { x: 6, z: 16.5, r: 2.6, depth: 0.45 },
    { x: 20.4, z: 14, r: 2, depth: 0.5 }, { x: -19, z: -8, r: 2.6, depth: 0.5 }, { x: -9, z: 5.2, r: 2.2, depth: 0.4 }, { x: -17.5, z: -12.4, r: 3, depth: 0.55 }, { x: 19.6, z: 17, r: 2.4, depth: 0.5 },
    // blocked drains: water stands over two of the three
    { x: DRAINS[0][0] + 0.4, z: DRAINS[0][1] + 1.1, r: 1.7, depth: 0.5 }, { x: DRAINS[2][0], z: DRAINS[2][1] - 0.9, r: 2.0, depth: 0.55 },
  ],
  // oil and fuel stains are painted into the ground's detail maps (props/ground.js); the coarse
  // mask keeps only its own random film
  oil: [],
  lanes: [
    { x: -2, z: -11.6, hx: 21, hz: 1.5 }, { x: -2, z: -3.5, hx: 12, hz: 1.2 }, { x: -2, z: 5.2, hx: 21, hz: 1.5 },
    { x: -10.5, z: 16, hx: 2.6, hz: 6 }, { x: 8.5, z: 16, hx: 2.6, hz: 6 },
    // the lanes either side of each island row, polished by forty thousand fill-ups, and the truck route round the east
    { x: -2, z: -8.4, hx: 11, hz: 0.9, amount: 0.7 }, { x: -2, z: 1.4, hx: 11, hz: 0.9, amount: 0.7 }, { x: 16.5, z: -2, hx: 1.6, hz: 11, amount: 0.75 }, { x: -18.5, z: -2, hx: 1.5, hz: 12, amount: 0.6 },
  ],
  dry: [{ x: (CANOPY.x0 + CANOPY.x1) / 2, z: (CANOPY.z0 + CANOPY.z1) / 2, hx: 9.6, hz: 5.3, soft: 1.5, amount: 0.6 }], // dry to within a metre and a half of the drip line, where the rain blows in: a wet edge you can see
  marks: [
    ...[-12.6, -10.0, -7.4, -4.8, 1.0, 3.6, 6.2].map((x) => ({ x, z: -14.8, length: 5, width: 0.12, rot: Math.PI / 2, kind: 'white', wear: 0.45 })),
    { x: -1.4, z: -15.6, length: 3.3, width: 3.3, rot: 0, kind: 'hatch', wear: 0.5 },
    ...ISLANDS.flatMap(([x, z]) => [-1.25, 1.25].map((o) => ({ x, z: z + o, length: 7.6, width: 0.1, rot: 0, kind: 'yellow', wear: 0.55 }))),
    { x: -10.5, z: 19.4, length: 6.4, width: 0.3, rot: 0, kind: 'white', wear: 0.6 }, { x: 8.5, z: 19.4, length: 6.4, width: 0.3, rot: 0, kind: 'white', wear: 0.6 },
    // lane arrows on the drives: in on the west, out on the east (painted, so they lie under the water like the rest)
    { x: -10.5, z: 18.2, length: 2.5, width: 1.1, rot: -Math.PI / 2, kind: 'arrow', wear: 0.42 }, { x: 8.5, z: 17.6, length: 2.5, width: 1.1, rot: Math.PI / 2, kind: 'arrow', wear: 0.46 },
    skid(-1.2, 13.4, 9, 2.1, 2.72), skid(16.5, 14.2, 6, 2.2, 0.9), skid(-18.2, 12.3, 5, 1.5, -0.45), skid(14.6, -9.5, 5.5, 1.5, 0.683),
  ],
};

// clearings the treeline keeps open (the spawn pockets). The east fence's two old pockets stay in
// the list (the garage and the alley stand there now): the trees are placed from one random stream,
// and dropping an entry would move every tree after it.
export const clearings = [
  ...sides.flatMap(([name, x, out]) => (name === 'east' ? [-11.5, 10.1] : OPENINGS[name].gaps).map((z) => ({ x: x + out * 3.7, z, r: 3 }))),
  ...OPENINGS.alley.gaps.map((x) => ({ x, z: FENCE.alley - 2.6, r: 2.6 })),
];

export const surfaceAt = (x, z) => {
  if (x > LOT.x0 && x < LOT.x1 && z > LOT.z0 && z < LOT.z1) return 'asphalt';
  if (z >= LOT.z1 && z < 31 && DRIVES.some((d) => x > d[0] && x < d[1])) return 'asphalt';
  return 'dirt';
};
