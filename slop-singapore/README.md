# Slop Singapore

A Singapore city simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL. Explore Singapore's Central Area — the CBD and Marina Bay, Chinatown, the Civic District, Bugis, Little India, Orchard — on foot, by car, by bicycle, by helicopter or in an RSAF F-15SG fighter jet, with its traffic keeping left.

[Try it live](https://zz85.github.io/slop-singapore/) · one of the [Slop Cities](https://zz85.github.io/slop-cities/)

Singapore's own touches: Marina Bay Sands (three towers on their leaning legs under the SkyPark, its pool and gardens, Spectra's beams at night) and the Singapore Flyer (turning once in 32 minutes, its rim lit at night), the Supertrees of Gardens by the Bay (with the OCBC Skyway and their light show at night) and the Esplanade's spiky shells, modelled low-poly where OpenStreetMap maps them; koels calling, cicadas at dusk and crickets at night; its 72,000 street and park trees, traffic light poles, ERP gantries and camera poles solid to walk, ride or drive into; cars that honk if you sit in their lane going nowhere (stopped with the road clear ahead, on green) for a few seconds, harder the longer you stay; afternoon thunderstorms with rain, lightning and thunder that arrives at the speed of sound (the storm button or `R`, or open the page with `?storm`); and the rest of the island beyond the Central Area — the HDB estates, Jurong, Changi, Sentosa — streamed in tiles of buildings and main roads around you, built in a Web Worker, with traffic on its main roads (heard, turning at its junctions, stopping at its 1,450 traffic lights, where running a red earns you a fine), and teleports that arrive on the nearest of them.

Fly the F-15SG (`J`): it starts lined up on Paya Lebar Air Base's runway 02, home of the RSAF's two Strike Eagle squadrons. Open the throttle (`Space`/`E`, past 80% for the afterburner), pull back (`S`) at 140 knots and it lifts off; `W`/`S` pitch (the stick asks for g: centred it holds the climb or dive you're in), `A`/`D` roll (bank and it turns, but as in the real jet the nose drops unless you pull back: 2 g holds your height in a 60° bank, or turn on Bank assist), `Q`/`C` back to idle and then the speed brake or the wheel brakes. It tops out around Mach 1.1 low down, pulls up to 9 g (vapour streams off its wingtips above 4), only pulls what its wing gives at that speed and stalls if you zoom it too slow, burns its 22,900 lb of fuel as the F-15SG's two F110s do (about 12 minutes in full afterburner, much longer cruising; lighter, it climbs and turns better; empty, it flames out and glides; stop on a runway to refuel, or turn on Unlimited fuel), and lands on any land with the gear down and a gentle descent; buildings, the sea and steep arrivals blow it up, and it's back in the air a few seconds later. `T` puts you in the front seat (just move the mouse to look round, as you'd turn your head: over the shoulder at the screen's edges, eyes front in the middle) behind a working HUD (pitch ladder, heading tape, knots, feet, Mach, g, throttle, warnings). The jet is modelled in code from the real aircraft's dimensions (about 3,500 triangles, no model files), flown by `js/jet-flight.js`, with Singapore's runways (Paya Lebar, Tengah, Changi, Seletar) painted from OpenStreetMap. The Air Force menu adds an F-15 wingman (in echelon off your right wing, abreast on the runway), orders a flypast for wherever you are (four F-15SGs running in low, 150 m up, right over you, then their display trailing red and white smoke: pick the formation or let it surprise you, a diamond's bomb burst, a finger four's missing man, an echelon's fan break, a loop in line abreast, or rolls in line astern and a climb; subsonic or supersonic with its booms, followed through binoculars (`Z`) or watched from a wingman's cockpit, the last jet's or a chase plane (`X`); on the radar as green arrows) and shows the runways on the radar and map.

Go somewhere: pick how on the strip above the travel modes (swipe, scroll or `[` `]`: You drive, Self-driving, Crazy Taxi, Teleport, MRT), then where with Navigate (`G`, or tap the chosen way) to a place, or tap anywhere on the map (`M`, true north up) to go there any of those ways. Navigating plans a route over the same road graph the traffic drives, lane by lane, with turn-by-turn directions on the HUD and the route on the radar and map. Drive it yourself, or hand the taxi over: Self-driving keeps to its lane at up to 90 km/h or the speed of the traffic ahead, changes lanes past slow traffic (waiting for a gap), stops at red lights and waits for the car ahead; Crazy Taxi drives flat out, treats every light as green, swerves into whatever lane is free (oncoming included) and is on the clock, with near misses paid into the fare and the next fare called when you drop off. Both autopilots watch the traffic: they track every vehicle and person around them from where they are seen frame by frame (estimating speed, braking and turn rate, never reading them off the traffic), predict where each will be over the next few seconds, and check their own plan against that: easing off, braking, or swerving to another line if that is what keeps clear. Self-driving looks 4 s ahead, keeps a metre or more of room and prefers braking; Crazy Taxi looks 3 s ahead, keeps a hand's breadth, swerves before it brakes, squeezes past half in the next lane, and will use any part of the road. Both drive a line eased out of the mapped lanes, the kinks between the map's points spread over tens of metres but never more than a little off the lane (0.6 m self-driving, 1 m Crazy Taxi), so they take a mapped bend at speed in one smooth sweep rather than steering to every kink. Beyond the detailed city the trips go on over the island's main roads (and their slip roads), joined to the city's streets at its edge: self-driving keeps to their speed limits and stops at their traffic lights, Crazy Taxi doesn't. Turn on Show what it sees (Navigate menu, or `O`) to watch it think: every vehicle and person it is tracking boxed on the road with its predicted course, the car it is following in blue and the one it is avoiding in red with their estimated speeds, and its planned line in green. Touch the controls to take the wheel back. `T` puts you in the cab: the Crazy Taxi Cam rides in the driver's seat (move the mouse to turn your head: out of the side windows at the screen's edges), looks into the turns, leans out of them, widens with speed and jolts when you hit something.

Ride the MRT: pick MRT on the ways strip and then a place (or tap the map and choose Take the MRT here), and you board a train at the station nearest you, bound for the one nearest where you're going, changing lines at the interchanges on the way. The six lines (North-South, East-West, North East, Circle, Downtown, Thomson-East Coast), their 146 stations and their exits come from OpenStreetMap; the elevated stretches stand on viaducts across the island, the rest run in tunnels. The train pulls away, runs at its line's speed, eases for curves and brakes into each station, stopping with its doors at the platform. Inside, the cars follow photos of the real trains: white cabins with longitudinal benches of moulded seats in each line's colours (teal on the North-South Line, green on the East-West, blue and red on the North East...), frosted draught screens, stainless poles and grab handles that swing as the train brakes and pulls away, LED strip lights, route maps and a display over each door showing the next station. you hear its traction motors whine up and down, the wheels roar in the tunnel, the door chimes and closing beeps, and the announcements (next station, interchanges, your stop, read by your browser's voice). A panel shows the line, the next station, the stops to come and the minutes left. `V` changes the view (standing by a door, a window seat, the front window, or outside following the train; drag to look round), `F` fast-forwards (4× or 16×), `G` skips on to the next station, and `Esc` gets off at the next one. At the end you step out of one of the station's exits, on foot.

Slop Singapore grew out of mrdoob's [Slop New York](https://github.com/mrdoob/slop-newyork), and New York still runs here: open the page with `?city=nyc`.

## Run it

Serve the folder and open it in a browser with WebGPU (or WebGL 2):

```sh
python3 -m http.server 8000 --bind 127.0.0.1    # then open http://127.0.0.1:8000/
```

## Make it your own

Fork it, remix it, improve it, break it. Make games, animations, films, experiments, or something completely different. Use it as a starting point and take it wherever you want. Have fun!

## Cities

Singapore is built from OpenStreetMap; `?city=<id>` loads another city. To add one, describe it in `tools/city/cities/<city>.mjs` (its area, origin, driving side, neighbourhoods and places), then:

```sh
node tools/city/fetch.mjs <city>                                  # OpenStreetMap layers from Overpass
node --max-old-space-size=8192 tools/city/build.mjs <city>        # writes js/<city>-geodata.js
node tools/city/preview.mjs <city> preview.png                    # a map of the result, to check it
```

The rest of the island, as streamed tiles (`island` in the city's config): buildings and main roads only, no traffic or colliders yet:

```sh
node tools/city/fetch-island.mjs <city>                            # buildings & main roads cell by cell, coastline, water, traffic lights
node --max-old-space-size=8192 tools/city/tiles.mjs <city>        # writes tiles/<city>/: index.json, a file per tile, roads.json for the maps
```

The MRT (`tiles/<city>/mrt.json`): its lines' route relations, their tracks and stations, and the stations' exits:

```sh
node tools/city/mrt.mjs <city> --fetch                             # downloads from Overpass, then writes tiles/<city>/mrt.json
```

New York (`?city=nyc`) has its own data build from NYC Open Data: `node --max-old-space-size=8192 tools/build-geodata.mjs`.

Explore other cities and community remixes in [Slop Cities](https://github.com/zz85/slop-cities).

## License and data

The project code is available under the [MIT License](LICENSE).

Geographic data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL); New York's also NYC Open Data. Singapore's trees: [Trees.sg](https://www.nparks.gov.sg/treessg) © National Parks Board, collected by [cheeaun/sgtreesdata](https://github.com/cheeaun/sgtreesdata). Third-party data and dependencies retain their respective licenses.
