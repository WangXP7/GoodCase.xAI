/* ============================================================
   LORE — codex, samples, missions
   ============================================================ */

export const CODEX = [
  {
    id: 'dossier', tag: 'DOSSIER', title: 'OPERATION ANAXAGORAS', meta: 'SELENE DIRECTORATE · CLEARANCE COBALT',
    start: true,
    body: [
      `Beacon-9 sits on the floor of Anaxagoras, 73.4° north, ten degrees west of the meridian. Close enough to the limb that Earth never rises more than a hand's width above the rim wall, and the sun never climbs higher than nineteen degrees. Shadows here do not shorten at midday. They only turn.`,
      `The station reported nominal for six hundred and eleven days. On day six hundred and twelve it sent a single unscheduled burst — four seconds of carrier, no payload — and then nothing. That was two hundred and fourteen days ago.`,
      `You are the operator of MU-7 CASSIOPEIA, delivered by descent sled to a clear patch of mare a few hundred metres east of the station, on the near side of the rille. Your instructions are to survey, sample, restore the relay chain, and determine why Beacon-9 stopped talking.`,
      `You will notice that the dossier does not say what Beacon-9 was for.`
    ]
  },
  {
    id: 'geology', tag: 'GEOLOGY', title: 'THE FLOOR OF THE BASIN', meta: 'SURVEY PRIMER · REV 12',
    start: true,
    body: [
      `Regolith is not sand. It is powdered rock that has been shattered, welded, shattered again and salted with meteoritic iron over four billion years, with no water and no wind to round a single grain. Every particle is a splinter. It packs to about forty percent void, it holds a footprint indefinitely, and it will grind through a bearing seal in a season.`,
      `It is also electrostatically alive. Ultraviolet light knocks electrons off the dayside; the nightside charges negative from the solar wind. At the terminator the potential difference across a few metres of ground can exceed a kilovolt, and the finest fraction levitates. Apollo crews photographed the horizon glow and nobody has fully explained it since.`,
      `Drive gently. At one sixth of a gravity your wheels have one sixth of the grip, and a slope you would not notice on Earth will put you on your roof.`
    ]
  },
  {
    id: 'first-return', tag: 'FIELD NOTE', title: 'THE FIRST RETURN', meta: 'GPR · SUBSURFACE ECHO 001',
    body: [
      `The radar came back wrong on the very first sweep.`,
      `A buried boulder returns a single hard hyperbola. Ice returns a broad, low-velocity smear. What came back from four metres under the basin floor was a lattice — a repeating hexagonal return, coherent across sixty metres, with internal voids.`,
      `Nothing forms hexagonal voids in regolith. Basalt columns do it in cooling lava on Earth, but this is not columnar and it is not basalt. The dielectric constant reads like glass.`,
      `Recommend excavation.`
    ]
  },
  {
    id: 'lattice', tag: 'ANALYSIS', title: 'THE VITRIFIED LATTICE', meta: 'SAMPLE 007 · MASS SPEC + PETROGRAPHY',
    body: [
      `The sample is a hollow tube of lunar glass. Outer diameter 41 mm, wall 3 mm, interior smooth and unweathered. It is a fulgurite: the trace left when a very large current passes through loose silicate and fuses it into a pipe along its own path.`,
      `Fulgurites occur on Earth wherever lightning strikes sand. There is no lightning here. There is no atmosphere to hold a charge column.`,
      `The chemistry is local — the glass is made of the regolith it sits in, so nothing arrived from outside. The current did.`,
      `Two findings I would like struck from the field record until we are on a secure link:`,
      `First, the tubes branch outward from a common origin under the central massif, in a hexagonal close-packed arrangement, over an area of at least nine square kilometres. That is not the shape a discharge makes when it is looking for a path. That is the shape it makes when the path is already there.`,
      `Second, the solar-flare glass on the exterior surface is thin. Cosmic-ray exposure dating puts the formation of these tubes at thirty-nine years before present, plus or minus four.`,
      `We have had people on this body for longer than that.`
    ]
  },
  {
    id: 'roster', tag: 'PERSONNEL', title: 'BEACON-9 CREW', meta: 'FOUR SOULS · ROTATION 7',
    body: [
      `HALVORSEN, I. — station lead, geophysics. Third rotation. Wrote most of the logs.`,
      `OKONKWO, A. — power systems. Kept a chess game going with somebody in Houston, one move per uplink window.`,
      `REYES, M. — medical, and the only one qualified on the drill rig.`,
      `TANAKA-BRUUN, S. — Directorate liaison. No published field record. No published anything, in fact. Arrived with the last resupply and was not on the manifest.`,
      `All four are listed as MISSING. Not lost. The distinction is a legal one and the Directorate has been careful about it.`
    ]
  },
  {
    id: 'log6', tag: 'STATION LOG', title: 'SUN-DAY 6', meta: 'I. HALVORSEN · TRANSCRIPT',
    body: [
      `Ground potential is up again. Okonkwo has the electrometer mast reading four hundred volts positive at two metres, which would be unremarkable at the terminator except that the terminator is one hundred and ninety kilometres away and moving away from us.`,
      `The charge is not coming from the sun. It is coming from underneath.`,
      `Tanaka-Bruun asked me not to put that in the log. I told her the log is the log. She said something I have been thinking about since, which is: "the log is a transmission."`
    ]
  },
  {
    id: 'log11', tag: 'STATION LOG', title: 'SUN-DAY 11', meta: 'I. HALVORSEN · TRANSCRIPT · PARTIAL',
    body: [
      `We dug down to a tube today. Reyes took the rig out to the third marker and went through the skin at 3.9 metres.`,
      `The interior is not empty. There is a film on the inside wall, a few microns, and it is a conductor. Room-temperature, in a vacuum, at minus one hundred and sixty degrees — a conductor with no measurable resistance.`,
      `The whole lattice is one continuous circuit. Nine square kilometres of superconducting pipe buried four metres under a crater floor that has been geologically dead for three billion years.`,
      `Somebody built a capacitor out of the Moon.`,
      `Okonkwo did the arithmetic on the storage. He came back very quiet and asked me not to make him say the number out loud, so I will write it instead: if the lattice is charged to the potential we are measuring at the surface, it is holding somewhere between four and eleven petajoules.`,
      `That is not a science instrument. That is a weapon, or a battery for one, and the difference has never been more than a matter of intent.`
    ]
  },
  {
    id: 'memo', tag: 'DIRECTORATE', title: 'MEMORANDUM 44-C', meta: 'RECOVERED FROM RELAY CACHE · UNSENT',
    body: [
      `TO: Station Lead, Beacon-9`,
      `FROM: Directorate Oversight, Selene`,
      `RE: Cessation of unauthorised subsurface work`,
      `Your survey exceeds the scope of the ice-prospecting charter under which Beacon-9 is licensed and insured. All excavation below two metres is to stop immediately. Instrumentation already emplaced in the formation is to be left in place and left powered.`,
      `For the avoidance of doubt: the formation was catalogued prior to your arrival. It is Directorate property under the salvage provisions. Your crew was not selected for its discovery and will not be credited with it.`,
      `Liaison Tanaka-Bruun holds standing authority on all matters relating to the formation, including the authority to terminate the rotation early.`,
      `You are reminded that the station's power is drawn from a tap the Directorate installed and the Directorate maintains.`
    ]
  },
  {
    id: 'charge', tag: 'ANALYSIS', title: 'WHAT IT IS FOR', meta: 'SAMPLE 019 · DEEP CORE, CENTRAL MASSIF',
    body: [
      `The deep core answers it.`,
      `The tubes are not a natural formation and they are not thirty-nine years old either. The tubes are thirty-nine years old. The *film inside them* is four billion.`,
      `Read that again, because I had to.`,
      `The conducting layer is a mineral phase that does not appear in any lunar sample ever returned, and its crystallisation age sits within a hundred million years of the Moon's own formation. It was already in the rock, dispersed, dormant, a few parts per billion, everywhere under this basin.`,
      `Thirty-nine years ago somebody put a current through the ground, and the current found that mineral, and the mineral *assembled*. The fulgurite tubes are not the structure. They are the packaging the structure grew inside.`,
      `The Directorate did not find a battery. They found a seed, and they watered it, and they have been watching it grow for four decades while telling four people at a time that they were looking for ice.`
    ]
  },
  {
    id: 'lasthour', tag: 'STATION LOG', title: 'THE LAST HOUR', meta: 'I. HALVORSEN · UNSENT · RECOVERED FROM LOCAL STORE',
    body: [
      `Potential at the mast is nine kilovolts and climbing. The dust is standing up off the ground outside the window — not blowing, there is nothing to blow it — standing, in columns, like the whole basin is holding its breath.`,
      `Tanaka-Bruun has locked out the tap. She is not hostile. She has been perfectly polite about it. She says the discharge is scheduled, that it has always been scheduled, that we were told and did not read the annex.`,
      `Okonkwo is trying to ground the hab to the drill string. Reyes is getting the suits.`,
      `If you are reading this you drove here, which means the relays are up, which means you can send. So send this, and send all of it, and do not let them tell you it was an equipment failure:`,
      `It is not a fault. It is a function. The Moon is a capacitor and we are standing on the terminal, and somewhere there is a schedule with our names in the margin.`,
      `Sun-day 14. Halvorsen out. Tell my brother I said the chess game goes to Okonkwo.`
    ]
  },
  {
    id: 'node', tag: 'FIELD NOTE', title: 'THE NODE', meta: 'CENTRAL MASSIF · 11 m SUBSURFACE',
    body: [
      `It is warm.`,
      `Minus one hundred and sixty-one degrees on the surface, and the node reads minus ninety-four. Something down there has been dissipating power continuously for two hundred and fourteen days.`,
      `The lattice discharged on sun-day 14. It took the station, and it took the crew, and it has spent every hour since doing exactly what a capacitor does after you empty it.`,
      `It is charging again.`,
      `At the present rate it reaches the potential recorded on Halvorsen's last log in eleven months.`
    ]
  },
  {
    id: 'transmission', tag: 'ENDING', title: 'TRANSMISSION', meta: 'RELAY CHAIN NOMINAL · UPLINK WINDOW OPEN',
    body: [
      `The relays are up. Earth is eleven degrees above the northern rim, blue and half-lit and one and a quarter seconds away.`,
      `You have the crew logs, the sample analyses, the memo they never sent, and a timestamped record of a four-petajoule structure charging under a crater floor with four names still legally listed as missing.`,
      `The Directorate maintains this uplink. The Directorate will receive this first.`,
      `Halvorsen knew that, and wrote it down anyway, and then walked out to help Okonkwo ground the hab to a drill string, which was never going to work and which he did regardless.`,
      `MU-7 CASSIOPEIA, Anaxagoras basin, sun-day 228.`,
      `Transmitting.`
    ]
  }
];

/* ---------------- sample taxonomy ---------------- */
export const SAMPLES = {
  regolith: { name: 'REGOLITH CORE', rare: false, value: 1, desc: 'Mature mare soil. 40 % void, 3 % meteoritic iron, agglutinate-rich.' },
  breccia: { name: 'IMPACT BRECCIA', rare: false, value: 2, desc: 'Shattered rock welded by shock. Someone else\'s crater, delivered here.' },
  ilmenite: { name: 'ILMENITE CONCENTRATE', rare: false, value: 2, desc: 'FeTiO₃. The reason anyone would ever want to own this basin.' },
  agglutinate: { name: 'AGGLUTINATE', rare: false, value: 2, desc: 'Soil welded to itself by micrometeorite glass. Pure lunar weathering.' },
  pyroclast: { name: 'PYROCLASTIC BEADS', rare: true, value: 4, desc: 'Orange volcanic glass. Fire-fountained from 400 km down, 3.6 Gy ago.' },
  meteoritic: { name: 'METEORITIC IRON', rare: true, value: 4, desc: 'Kamacite fragment. Arrived at eighteen kilometres per second.' },
  tube: { name: 'VITREOUS TUBE', rare: true, value: 6, desc: 'Hollow fulgurite of local glass. Interior wall: unweathered, conducting.', unlock: 'lattice' },
  film: { name: 'CONDUCTING FILM', rare: true, value: 8, desc: 'Micron-thick phase from a tube interior. Zero measurable resistance at 110 K.', unlock: 'charge' },
  core: { name: 'CHARGED NODE CORE', rare: true, value: 12, desc: 'Still warm. Still gaining.', unlock: 'node' }
};

/* ---------------- missions ---------------- */
export const MISSIONS = [
  {
    id: 'coldstart', tag: 'MISSION 01', name: 'COLD START',
    brief: `The sled is down and you are on the surface. Deploy the array, wake the drive train, and get a feel for one sixth of a gravity before you need it. Everything about this machine is tuned for a world that pulls harder than this one.`,
    objectives: [
      { id: 'deploy', text: 'Deploy the solar array', hint: 'press T' },
      { id: 'drive', text: 'Drive 120 m from the sled' },
      { id: 'scan', text: 'Run one ground-penetrating radar sweep', hint: 'press G' }
    ]
  },
  {
    id: 'firstecho', tag: 'MISSION 02', name: 'FIRST ECHO',
    brief: `The radar is returning a coherent hexagonal structure four metres under the basin floor. Find three subsurface anomalies and excavate them. Sweep, drive to the return, and put the drill through it.`,
    objectives: [
      { id: 'find3', text: 'Excavate 3 subsurface anomalies', count: 3 },
      { id: 'home1', text: 'Return the samples to the sled' }
    ]
  },
  {
    id: 'relay', tag: 'MISSION 03', name: 'RELAY CHAIN',
    brief: `Beacon-9 sat in a depression with no line of sight to Earth, which is a strange place to build a station and a convenient place to lose one. Earth never clears the rim from down here. Plant three relays on high ground — the terraces under the wall, or the massif — to open an uplink.`,
    objectives: [
      { id: 'relays', text: 'Deploy 3 relays on high ground', count: 3, hint: 'press B on ground above 10 m, 95 m apart' }
    ]
  },
  {
    id: 'station', tag: 'MISSION 04', name: 'THE SILENT STATION',
    brief: `Beacon-9 is three hundred and forty metres west-northwest, on the far side of the rille. There is one crossing, where the graben roof collapsed — everywhere else the walls are past the repose angle and you will not come back out. Get inside the perimeter and pull whatever is left of the local store. Mind the scorch ring: the ground there is glass under a centimetre of dust.`,
    objectives: [
      { id: 'reach', text: 'Reach Beacon-9' },
      { id: 'recover', text: 'Recover the crew logs', hint: 'hold E at the airlock' }
    ]
  },
  {
    id: 'node', tag: 'MISSION 05', name: 'THE NODE',
    brief: `Everything in the lattice radiates from one point under the central massif. Drive up, drill deep, and find out what has been keeping itself warm for two hundred and fourteen days.`,
    objectives: [
      { id: 'massif', text: 'Reach the central massif' },
      { id: 'deep', text: 'Extract the node core' },
      { id: 'transmit', text: 'Return to the sled and transmit' }
    ]
  }
];
