# Stick & Steel

Licensed under the [MIT License](LICENSE). Third-party dependencies and the bundled font retain their own licenses.

[Play the current game on Genex](https://genex.games/stick-steel) · [GitHub source](https://github.com/Rabneba/stick-steel)

![Stick & Steel — The Splinter Pit](public/assets/stick-steel-cover.webp)

A browser-based Three.js + Rapier dueling prototype with thin cartoon characters, physical weapons, and an active ragdoll rig. The original Stick Lab remains available at `/lab`.

## Run

```sh
npm install
npm run dev
```

The weapon models, sounds, textures, and cover are included through Git LFS. Install Git LFS before cloning, or run `git lfs install` and `git lfs pull` in an existing clone to download the actual assets.

Open **http://localhost:3000/** while the dev server is running. The Sites/Vinext shell hosts a client-only Three.js scene. No account, API key, model download, or GPU service is needed for the simulation itself. Solo play and the rig lab work locally without Genex identity. Published online duels use the Genex relay.

## Play the duel at `/`

First-time players enter **The Practice Yard** immediately. A growing curved gesture beside the fighter shows the left mouse button to hold and the upward sweep to make. After a real dummy hit, the lesson automatically arms the same dummy and changes the cue to **Parry**; no confirmation panel interrupts the action. A real parry shows **Great!**, followed by a translucent ivory veil and **Enter to duel**. Clicking it or pressing Enter opens **Find Match** / **Play with a Bot**. Touch players see a thumb gesture and highlighted touch controls instead of a mouse. Training keeps physical impulses but disables wounds, lethal damage and grip failure. **Menu → Reset positions** (or R) retries the current lesson; Skip training is also in the menu. Completion is remembered locally, and Replay training remains available.

Open **Menu → Arena & sound** to choose arena, weapons, passive Practice mode, or the ledge drill; changing a selection resets the bout. The bot approaches, circles, guards and swings; Practice keeps it passive. Both can recover, climb, and retrieve a weapon. The handwritten HUD keeps health, stamina, relevant condition hints and core controls visible during a bout. Sound sliders, full controls, slow motion and the rig lab stay in the menu.

| Weapon | Gameplay |
| --- | --- |
| Arming sword | Quick cuts and balanced reach; one hand remains free to shove. |
| Iron mace | Shorter reach with mass concentrated in its head. Solid blunt hits can knock a fighter down; it cannot sever limbs. |
| Longsword | Longer reach and slower recovery. The other hand reaches the long handle and attaches a second physical grip, improving control and resistance to disarming. Usable with one surviving hand at reduced control. |

**The Practice Yard** gives room to learn spacing. **The Splinter Pit** is an 8.8 × 1.04 metre unguarded bridge inside an ivory arena. Individual planks with pencil grain, fasteners, hatched stone courses, terraced seating with sketched spectators, arched entrances, banners and rope pennants add detail without photorealistic textures. Deck support faces are inset beneath the planks; spike bases are truncated below their red tips, eliminating overlapping surfaces. The practice yard also uses a single ground plane. A bed of 135 physical spikes lies beneath it; actual limb contacts trigger localized blood and an impact sound. There are no invisible side walls: walking or being pushed off can turn into a fall. A spare mace and longsword lie on both arenas.

**Ledge drill** starts with the rival hanging from the edge. Begin the drill, then press C to chop through the exposed gripping fingers. You can also guide a low swing with left-drag. A sufficiently strong actual hit makes the hand release. If left alone, the rival begins climbing after 4.5 seconds, gets back onto the platform, and seeks a weapon. Reset repeats the scenario. Changing a weapon or arena returns to a normal standing start.

| Control | Action |
| --- | --- |
| W / S | Advance toward the opponent / retreat |
| A / D | Circle around the opponent |
| Click arena / Begin duel | Capture the mouse for continuous movement without screen edges |
| Hold left mouse + move | Guide the weapon through a swing; moving the mouse upward raises the blade |
| Hold right mouse + drag | Aim a high, low, left, or right guard |
| Space | A complete quick slash, alternating sides |
| Shift | A short lunge that costs stamina |
| E / hold E | Tap to approach and pick up a nearby weapon / hold to stand or climb |
| C | Downward chop; Space also chooses a low strike against a hanging rival |
| F | Shove with a free hand; requires actual proximity to the opponent's chest |
| G | Drop the current weapon, or let go of a ledge |
| Q | Toggle quarter-speed slow motion in solo play |
| Escape | Release the mouse; solo play pauses, online simulation continues. Resume recaptures it. |
| R | Reset a solo bout, or request an online rematch after a result |
| Middle drag / wheel | Look around temporarily / zoom; release middle mouse to settle into the side follow view |

The third-person camera sits about 37 degrees to the side, so the player's silhouette does not cover the rival. It follows the physical pelvis with about 0.13 seconds of movement lag and smooths turning and vertical motion separately. Its aim includes the opponent, and it pulls back when the pair separate or one hangs below the platform. Hanging switches to an outside view of the edge. A fall below the bridge eases the view down and out to the same side of the bridge as the falling body, keeping the supports out of the impact view. It stays upright during knockdowns, uses real time during slow motion, and snaps to the new spawn on reset. Manual zoom ranges from 3.3–7 metres, with extra automatic framing distance. These open arenas do not yet use camera collision casts for enclosed rooms.

Mouse capture requires a click or key gesture. If unavailable, ordinary held mouse dragging still works with the same relative steering. Esc, losing window focus, or hiding the page clears held inputs. Solo play pauses; online Escape only releases control. A backgrounded online tab pauses the shared bout until both players return; finishing a bout releases the cursor for Rematch. Touch devices have an analog movement stick and a separate held swing pad. Tap Guard to keep a high guard, drag the pad to aim it, and tap Guard again to attack. Hold Interact to pick up, stand or climb. Guard, Interact and Drop form a compact vertical stack beside the swing pad; downward drags aim low strikes. Independent pointer capture supports simultaneous movement and steering; cancellation, lost capture and pausing release controls. Two fingers on the arena look and pinch to zoom. Training progressively highlights the relevant pad; portrait and landscape layouts keep controls within reach. Eight locally bundled Genex sound effects distinguish clashes, blunt hits, cuts, swings, drops, and steps. Audio starts after interaction, uses camera-relative panning and distance attenuation, has an 18-voice cap, and can be muted. A continuous crowd murmur and separately mixed quiet applause loop give the arena a live background. Attack anticipation swells the murmur; significant hits/parries trigger a vocal reaction with a 2.8-second cooldown, and bout endings get a subdued celebration. Vocal reactions are quieter; the clap tail fades further down. Three swing recordings avoid consecutive repeats, vary with weapon weight and speed, and trigger on moving strokes rather than idle attack poses. Loop seams are crossfaded, applause is low-pass filtered, and the page mutes when hidden. Effects and crowd have independent menu volume sliders. Short impact camera impulses respect reduced-motion settings. Direct mouse steering settles faster for the sword than the mace or longsword. Rematch restores the selected arena, fighters, grips, and loose weapons.

`lib/duel/physics.ts` owns a single 120 Hz Rapier world with 36 dynamic bodies in the demo: two 16-body fighters, two starting weapons, and two spares. A fixed platform body anchors ledge joints (37 bodies total). Headless scenarios can omit spares for 34 dynamic bodies. Weapons have physical blade, handle, guard, or blunt-head colliders, continuous collision detection, and bounded steering torque. Torque compensates for the actual centre of mass relative to the handle. Enemy body and weapon collisions are enabled; a fighter's own held weapon and body do not collide. Limb contact radii are narrower than the laboratory colliders, while mass and inertia remain independent of the thin drawing.

Weapons are independent objects with changing ownership. Heavy clashes, parries, and weapon-hand injuries strain the grip. A low stamina stroke shows remaining endurance; contextual HUD hints explain unarmed and hanging states. When it breaks, both grip joints release and the original dynamic weapon falls with its momentum. Press E near the handle marker to start a pickup. The character walks close before crouching; one press keeps the target until the hand reaches it. Attacking, guarding, or pausing cancels the reach. Drop the current weapon with G before choosing another. Pickup requires the actual hand to come within 14 cm at a bounded relative speed. The new grip first anchors at the contact position, then settles toward the handle over 0.4 seconds to avoid snapping the weapon across the floor. The AI uses the same pickup path. A second longsword grip is a damped spring that attaches only when the other hand reaches the handle.

Ordinary knockdowns release the weapon and pose controller without setting health to zero. Hold E to recover; the AI attempts to get up automatically. Recovery ramps the stance and balance assistance through a crouch, then returns control. A missing weapon arm can leave the fighter alive: they automatically use the surviving hand to reach and rearm. Losing both hands, losing a leg, running out of health, bleeding out, or falling deep below the span ends the bout.

On the span, foot assistance switches off beyond the platform and an unsupported pelvis enters a fall. A healthy hand can catch only while close to an edge and descending. A spherical joint to the fixed platform holds the hand; the rest of the body remains articulated. Hanging drains stamina, climbing costs more, and a hand strike or severed gripping arm can release it. Exposed finger colliders follow the same two-link paths as the drawing. Climbing first pulls the body clear of the platform's underside, then lifts and moves the stance over the lip. This is **assisted physical recovery**, not learned climbing or muscle-only balance. It changes force and pose targets, not live body transforms; arbitrary walls, corners, and multi-level traversal remain outside this demo.

Damage uses actual Rapier contact force events, **relative contact-point velocity**, the leading blade edge, body region, and a per-attacker contact cooldown. Head and torso strikes are decisive; grazing flat-blade and hilt contacts do less damage, and resting contact is harmless. The damage and injury thresholds are game tuning rather than an anatomical simulation.

Weapon commands have a bounded turn rate and drive a dynamic sword with limited torque. Quick slashes have preparation, a committed stroke, and recovery; the opponent visibly winds up for 0.36 seconds before a normal strike. A real blade clash briefly weakens arm and sword control so the collision can deflect them. A successful guard gives a 0.8-second counter window with a faster quick slash. The HUD shows windups, injuries, stagger, and counter readiness only when relevant. Small handwritten damage/parry labels pop up at actual contact points. Rapid same-target contacts combine, and each fighter gets only one impalement caption per round; incidental floor contacts produce no label. There is no guard invulnerability: moving around the blade can still land a hit. Impacts weaken the struck limb and balance assistance, and recovery steps follow the physical pelvis motion.

Strong aligned cuts accumulate injury at the contacted limb and can detach it at the shoulder, elbow, wrist, hip, knee, or ankle. Detachment removes that physical joint and disables pose forces for downstream bodies, retaining their other joints and momentum. Arm wounds bleed down remaining health; a severed leg collapses the fighter. Detached parts reuse the existing bodies. This uses the rig's joint boundaries; arbitrary cuts through the middle of a segment, head severing, and mesh slicing are outside this version.

Blood uses red droplets with gravity, velocity from the impact, short wound drips, and floor splashes that darken and fade. Over the span's void, droplets keep falling rather than creating floating floor marks. The cosmetic effect has fixed pools of 192 airborne particles and 256 floor marks, rendered in two instanced draws. It adds no Rapier bodies and is not a fluid solver. All wounds, joints, grips, blood, and combat state reset on Rematch. The result text waits briefly so you can see the physical fall.

This is an assisted physical controller with a procedural opponent. Armor penetration, independent finger dynamics, general grappling and learned balance are not implemented. Simulation and rendering are separate. `DuelSimulation.input`, `slash()`, `lunge()`, `shove()`, `drop()`, `start()`, `step()`, `reset(options)`, and `onHit` work headlessly. Rendering uses WebGL; Rapier runs as CPU WebAssembly. Online multiplayer supports two-player duels. The 62-player stress test remains deferred.

`lib/duel/weapons.ts` defines weapon profiles; `weapon-view.ts` draws all held and dropped items. `arena.ts` defines platform support and edge queries. `avatar.ts` draws the line characters, hand poses, and wound ends. `damage.ts` evaluates impacts and limb thresholds; `effects.ts` owns the bounded blood and spark pools. `camera.ts` owns the headless follow camera and relative weapon steering. `scene.ts` connects input, mouse capture, camera, rendering, impact effects, sound, and cleanup. The app routes own only the controls and HUD.

For a first playthrough:

1. In Practice, compare the three weapons. Drop one with G, press E near the handle marker, and watch the hand reach the handle. The longsword brings the other hand in after pickup.
2. In Duel, meet a swing with right-mouse plus drag to aim your guard, then press Space during “Counter ready.” Watch grip strength during repeated clashes. F shoves only with a free hand in contact range.
3. Choose Ledge drill and begin. First watch the rival climb back. Reset, aim down, and sweep across the fingers before the climb. Q slows the complete simulation.
4. Choose the Splinter Pit for a normal duel. Circle to an edge to test the automatic catch; hold E to climb or G to release. A caught fall costs stamina and drops your weapon.

## Reference and next direction

Half Sword's developers describe freely controlled weapons and active ragdolls as the combat foundation in [their Epic Games interview](https://store.epicgames.com/news/how-half-sword-makes-bloody-brutal-medieval-combat-feel-real?lang=en-US). Its [official 0.6.1 notes](https://store.steampowered.com/news/posts/?enddate=1781942700&feed=steam_community_announcements) describe reverse grips, two-handed stances, stronger wrists, equipment weight, ragdoll optimization, and a Bridge combat scenario. Those support the direction here: distinct physical weapons and meaningful grip control. The ledge-catching and assisted climb system is our demo extension; the sources do not establish that Half Sword implements that same sequence.

After play feedback, the next useful pass is deliberate AI spacing for each weapon and guard/recovery tuning. A shield or small amount of armor could then change tactics. General body grabbing, shields/armor, and more advanced opponent spacing are possible next passes after feedback on the online two-fighter loop.

## Online duels and publishing

Play at **https://genex.games/stick-steel** (published under Simeon M). Choose a weapon, click **Online Match**, and have a second player do the same. Guests are supported. For two players on one computer, use separate browser profiles or an incognito window: Genex permits one seat per player identity, so two tabs using the same signed-in account will evict one another.

The queue seats exactly two players. Both must be connected and ready before a three-second countdown. The host selects the arena; each player keeps their own chosen weapon. There is no AI in either online seat. Both players must request a rematch; Escape does not pause the opponent. Leave online returns to solo play.

`network.ts` uses Genex's `open` matchmaking with a two-seat cap. Exactly one elected host steps the shared 120 Hz Rapier world. The other player sends bounded input at 20 Hz and renders the SDK-smoothed transform stream without a second physics simulation. Three host-owned snapshots carry all bodies, weapons, authoritative health/flags, and recent impact events. Unchanged snapshots fall back to a 2 Hz keepalive. Input packets have round epochs and sequence numbers; stale remote controls time out after 300 ms. This is casual host-authoritative play, not an authoritative anti-cheat server or a rollback/prediction implementation.

A network blip pauses the contest through reconnect grace. A hidden tab also pauses it. Losing the host elects another host and starts a fresh bout once a second player is present; incomplete ragdoll/grip constraints are never silently reconstructed mid-fight. Vacated seats can refill. Leaving and teardown cancel matchmaking and dispose timers/physics.

The localhost Vinext workflow and `/lab` remain available. Genex gets a separate static React entry at `hosted/main.tsx`; its lab route is `?view=lab`. Genex identity boots before rendering, but rendering never awaits identity. Runtime environment values come from the CLI-generated config and the host's injection. The CLI account token is never shipped.

This checkout is linked to the production project `cmtx4330e000z33msg4dez2mr`. Production uses `api.genex.games` and `stick-steel.genex.technology`; the previous development release remains available separately. Development deployment metadata is retained in `output/production-migration/`. Player records and shop entitlements belong to their own environment and are not copied between development and production.

```sh
npm run preview:game       # build static files, retain the prior build, upload the draft
npx genex promote          # publish the exact draft after review
npx tsx scripts/test-online.ts  # live guest/relay integration check; requires a published project
```

`npm run build` still builds the original Sites/Vinext application. `build:game` writes `dist-game/`; `stage:game` preserves the previous generated `dist/` beneath `.genex/build-cache/` and prepares the static export in `dist/`. Use `preview:game` rather than a bare Genex preview that would run the Vinext build.

The current three weapons use generated, locally bundled GLBs: a red-leather arming sword, a long two-handed sword, and an iron studded mace. Originals remain in assets; scripts/prepare-weapon-assets.py records the measured axis, tip, grip, and width corrections and reduces their textures to 1K. Runtime meshes are 9.6–10.9k triangles and 0.74–0.81 MB each. Authored geometry remains a loading/offline fallback. The first batch of model attempts was refunded by the provider; the current batch succeeded. Generated wood/stone textures are retained for experiments but intentionally omitted from the final ivory arena. Generated combat and crowd sounds are bundled under readable names; `public/assets/README.md` records their generation IDs. Genex's unused-asset scan does not recognize that filename mapping.

## Try the original rig lab at `/lab`

- **Throw:** click the character to launch a basketball at that spot. Throw power controls speed.
- **Test arm impact:** aims a physical projectile at the right forearm.
- **Catch a pass:** the right arm reaches and opens its hand. A ball is passed toward the fingers; a grip can attach only after physical hand contact. Weak muscles or moving the target can cause a miss.
- **Throw held ball:** after catching, inspect the hold (or drag the right hand in Pose), then throw. The arm draws back, swings, opens its fingers, and releases the physical ball. Throw power changes the release impulse.
- **Pose:** drag blue hand targets in the camera plane. Foot targets slide on the ground. Goals clamp to reachable positions.
- **Ready / Guard / Reach:** try the same rig in different poses.
- **Muscle strength:** adjust how strongly limbs recover toward the IK pose.
- **Ragdoll:** release the pose and balance controllers and any held ball; all 16 bodies fall under gravity while anatomical limits remain active.
- **Slow motion / pause / reset:** inspect contacts and start over.
- Right-drag to orbit; scroll to zoom. On touch devices select View to orbit or use two fingers to zoom.

## Structure

- `lib/rig/ik.ts`: two-bone IK with bend and reach limits.
- `lib/rig/anatomy.ts`: joint ranges, shared hinge frames, constrained forward reconstruction, and bounded wrist orientation.
- `lib/rig/hand.ts`: three fingers fan from one hub; a shorter thumb branches nearer the wrist. Each digit has two fixed-length segments (eight per hand), driven by one curl value. Explicit left/right handedness keeps both thumbs forward in the neutral pose. Rendering and finger colliders use the same paths.
- `lib/rig/physics.ts`: headless simulation, 16 dynamic bodies (including two hands), anatomical joints, contact-gated grips, balls, collision events, and a fixed 120 Hz step.
- `lib/rig/scene.ts`: Three.js rendering, picking, target dragging, camera, and effect lifecycle.
- `app/page.tsx`: controls. The renderer follows physical transforms; it never teleports limbs to animate them.

The simulation is reusable independently of the page: initialize with `initPhysics()`, construct `RigSimulation`, call `setPose()` / `setTarget()`, then call `step()` at a fixed rate. `parts`, `balls`, `onHit`, and `diagnostics()` expose state. Always call `dispose()` when finished.

For the ball interaction call `startCatch()`, inspect `catchPhase`, and call `throwHeld(power)` once it becomes `holding`. `fingerCurl`, `heldBall`, `wristPoint(side)`, and `gripPoint()` expose the interaction. `cancelCatch()`, pose changes, ragdoll, and reset release any grip. Catch timers advance in simulation time, so pause and slow motion apply to the whole sequence.

## Physical model and current limits

IK calculates the desired pose. Bounded PD torques drive physical segments toward that pose. Spring forces at the pelvis and feet provide **assisted balance**. Projectiles collide with actual limb colliders and transfer impulses through joints. Ragdoll disables every pose and balance force.

Elbows and knees are revolute hinges with 6–145 degree bending ranges. Shoulders, hips, wrists, ankles, spine, and neck have bounded relative angular rotation. Limits are enforced by Rapier, including during ragdoll, and the IK goals use the same ranges. The Rapier 0.19 spherical-joint wrapper lacks multi-axis limit setters, so `connect()` isolates a typed raw-joint-set call for these limits; regression tests exercise it. Shared limb frames prevent independent shortest-arc forearm twisting. Wrist goals use a neutral palm frame, bounded rotation, and a turn-rate limit.

A catch adds a temporary physical fixed joint only after contact with the right hand and proximity/speed checks. Its anchor settles into the palm as fingers close. The wrist controller accounts for the held ball's inertia and gravity. A throw removes that joint and applies a release impulse; hand collisions resume after a 0.12-second clearance interval. The ball stays dynamic throughout. Curl drives thin finger colliders attached to the hand; individual finger bones do not have independent rigid bodies or force-driven joints.

The hands use a short wrist stroke rather than a palm polygon. Two links per digit provide one readable knuckle bend and enough curl for the ball, reducing finger collider count from twelve to eight per hand. Longer digits keep a relaxed bend even when open: the middle finger is longest, the little finger curls most, and the shorter thumb angles separately. The hand's mass and rotational inertia still represent its spread digits, independently of the small hub collider. The forearm collider ends at the wrist to leave clearance for the grip.

This is a physics interaction MVP, not an autonomous athletic controller. There is no reinforcement learning, locomotion, full sports action library, or learned balance. The joint ranges are a stylized humanoid approximation; forearm pronation is folded into hand rotation, and character self-collision remains disabled. The pass is a controlled right-hand demo, not a general interception planner. Balls collide with each other, the character, the floor, and the low court boundary. Ball count is bounded at 24 and distant/old balls are removed. Turning muscles back on uses assisted recovery; Reset restores a clean stance immediately. The ball laboratory remains a solo demonstration. Multiplayer currently covers two-player combat; crowd stress testing is deferred.

For a future learning experiment, keep this fixed-step environment and replace the pose controller with policy actions, observation/reward definitions, and repeatable episode resets. Training is outside this MVP.

## Validation

```sh
npm test
npx tsc --noEmit
npm run lint
npm run build
```

The tests cover shared-world stability, harmless resting contact, physical steering and parries, disarming, all three floor pickups, two-handed grips, surviving-hand rearming, blunt knockdowns and recovery, catches on both platform edges, climbing, real strikes on hanging fingers, fatal falls, and repeated arena resets. Camera checks use Three.js projection math for standing and hanging framing, smooth follow, turning, zoom, and corrected mouse steering. The rig laboratory retains its IK, joint limits, fingers, catch/hold/throw, projectile, and reset checks. The expanded suite also checks independent human controls, bounded network input, raw gameplay flags versus smoothed transforms, weapon mesh bounds, and actual spike contacts. The live Genex test used two distinct guests (plus a replacement guest) to verify matchmaking, opposite sides, host-only simulation, remote movement/drop, background pause/resume, shared falls and impacts, rematches, host migration, and seat refill. Public HTML, scripts, CSS, and audio returned HTTP 200. The arena/HUD refresh also received browser checks at 1200 × 837 and 390 × 844, including menu navigation, keyboard play, bridge edges, spike surfaces, and the falling-body view. Three geometry/caption regressions bring the suite to 42 tests. These are desktop browser checks, not a physical-phone performance benchmark.

The interaction refresh adds four regression scenarios (47 total tests, including generated model bounds): physical directional guarding, stable spare placement and one-press pickup, downward hand strikes from both bridge sides with all three weapons, and remote guard/reach/ledge pose data. The live relay test also verifies directional guarding, chop commands, and pickup ownership in addition to the earlier lifecycle checks. Genex doctor checks service health; Rapier behavior is verified separately by the physical scenarios.

For the production browser startup path, navigate Playwright CLI to the published game (Genex staging is single-player) and run `playwright-cli run-code --filename scripts/check-online-ui.js`. It clicks Online Match in isolated desktop and touch browser contexts through the real guest identity flow, waits for the shared countdown, and verifies that the touch browser's Drop action appears in the desktop browser. The headless relay script alone does not cover the built browser's identity imports. `online-session.ts` is the single lazy browser entry; its SDK/config imports stay static to avoid dynamic imports back into the minified app entry.

The onboarding refresh has 49 passing physical/unit scenarios. `scripts/check-training-ui.js` exercises a held mouse sweep, real dummy contact, a parry, completion persistence, and bot entry. `scripts/check-touch-ui.js` uses browser touch emulation with two real touch pointers to complete the lesson, checks cancellation and guard controls, and inspects portrait/landscape layouts. Run either with Playwright CLI `run-code --filename` after opening localhost or the hosted build; both use the current page origin. Phone hardware performance still needs a physical-device check.

## Movement tutorial, records and armory

Online Match waits five seconds in a healthy search queue or seated solo lobby before starting a bot duel automatically. The queue timer advances only on fresh server reports after matchmaking reservations; authentication delays and connection errors never trigger a bot. Human arrivals, including loading or reconnecting seats, take priority, and an established human match never switches to a bot. Backgrounding the game or opening the menu resets the wait. The fallback rival receives a stable random Player 10–99 name for the duel and does not contribute online wins or losses. After that round, Online Match starts a fresh search for a human. There is no extra waiting control or visible countdown. This is a queue timeout, not a count of every player across the game. Timing/cancellation tests are in `tests/matchmaking.test.ts`.

The main menu opens for every visitor; Learn to Fight is an underlined text link directly below the weapon tiles. Training is optional and begins with W/A/S/D movement (a separate touch-stick lesson on phones), then two free held sweeps, two separated real dummy hits and a parry. The wider starting distance gives room to learn the swing, and a short cue asks the player to approach when needed. Stage changes preserve the same world, bodies and player position. The partner equips its sword in place, walks into range and waits before attacking. Find Match after completion enters matchmaking directly; Back to menu opens Online Match / Play with a Bot. Canceling matchmaking can start a bot fight immediately. A small underlined Skip Tutorial button beneath The Practice Yard returns to the menu and remembers the choice. Replay training stays available in the footer and settings.

In the landscape menu, the fighters sit just left of the weapon tiles and match buttons, with the leaderboard above the choices. A slow camera drift and small physically driven idle poses keep the scene moving; both respect reduced-motion preferences. Portrait layout places the fighters above the buttons. Spectator arms use one dynamic line buffer for staggered waves and hit reactions. Losing iframe focus suspends solo controls without opening a dialog; Escape and Menu remain explicit pause actions. The small crown during combat opens standings and returns to the current bout.

Sharp impacts select the closest joint on the actual struck limb: shoulder/elbow/wrist and hip/knee/ankle. Detached branches retain physical joints and momentum; cut anchors and detached parts travel in multiplayer snapshots. Blood comes from both exposed ends, inherits their movement, and tapers from a short pulsed spray to drips. Floor marks gather below each wound on the deck or pit floor. This uses the existing articulated bones, not arbitrary mesh slicing through the middle of a bone. The simulation/camera suite now has 62 passing tests; browser checks also cover real iframe focus, desktop and mobile layouts, and three cut points rendered with the actual rig and effects.

Combat uses anatomical right hands: +Z-facing characters have their right shoulder at -X. The grip joint, IK, feet and thumb drawing frames agree. Hanging fingers retain their grip orientation on the ledge while wrist/arm joints remain articulated. Low strikes crouch according to weapon reach.

Leaderboard records count completed online rounds only. Each round ID is applied once; player saves use version checks and preserve other progress, and pending results retry. The global board uses verified account names and orders wins first, then bouts played. Guest identities renew on visits, so guest records use a stable device-local slot. Account records stay separate and populate the public standings. Guest state is never queued over an existing account save on sign-in. The underlying game remains host-authoritative casual multiplayer: these client-submitted records are not a competitive anti-cheat system.

The menu armory displays the actual rotating 3D weapon, with pointer/touch drag rotation. Normal selections persist locally. Ravenblade is a durable 100-coin design of the existing two-handed Longsword: identical mass, reach, damage, torque, colliders and timing. Production SKU `cmtx44en500152qqyz2tcfruq` is in the Genex catalog (the retained development release uses `cmtvpg8a7000a2bmxhnag242i`). The UI reads current coin/USD-equivalent pricing from that catalog; the SDK handles purchase confirmation. Only a real durable entitlement unlocks it, restored on every boot and after purchase. Canceling or failing a purchase grants nothing. Skin choices travel in round loadouts and stay with dropped weapons. The earlier development owner test entitlement is scoped to development; production uses its own account entitlements. No paid transaction was executed during automated testing.

The active arming sword is `sword-dark-cmtvomjcx00072etq8bbl9bx3.glb`, blackened steel and oxblood leather (11,233 triangles, 899 KB). Ravenblade is `ravenblade-cmtvp6o7m00002bmxz9mp6bpm.glb` (11,090 triangles, 895 KB). Their preparation scripts record measured tip/guard/handle alignment and 1K texture packaging. Both earlier swords, including the rejected brass version, and all provider originals are preserved.

`check-armory-ui.js` tests desktop/mobile selection, reload persistence and the locked premium state. `check-online-ui.js` covers the published two-guest route, shared controls/fall and personal records. Local test mode intentionally has no live shop, auth, saves or relay. Device emulation checks layout and input; it is not a phone hardware benchmark.

## Mobile HUD and combat balance

Phone controls stack equal-size Guard, Interact and Drop buttons beside the right swing pad; captured movement/aim pointers remain independent. Climb and pickup prompts sit lower, just above the controls. Health starts below the host's close-button lane, and the arena mark appears only on the idle screen (training keeps its Practice Yard title). Weapon names sit inside the rotating tiles, with the live catalog price at the premium tile's upper-left. The new arena mark uses hand-cut SVG lettering and a broken-span underline.

Training labels distinguish Your hit, Guard here (an incoming hit), and a true Parry; the contact stage explicitly asks to Hit the dummy. Damage now uses a bounded speed curve: an ordinary clean torso hit at 5 m/s is about 15 HP, and a single speed spike cannot remove all 100 HP. Normal limb hits flinch rather than force a whole-body knockdown; committed central blows still topple, and repeated edge hits accumulate toward joint separation. The updated suite has 66 passing tests, including fresh-opponent first-hit survival, prior-injury severing, recovery and ledge strikes. Playwright checks cover full mouse/touch tutorials and 390×694, 320×568 and 844×390 layouts; these emulate phones and do not replace hardware Safari testing. Run `scripts/check-mobile-polish.js` with Playwright CLI to repeat the layout checks.

Impact captions measure their actual text and select nearby clear space outside the two fighter silhouettes, avoiding HUD margins and other captions. The short float respects reduced motion; when a close-up has no clear space, the cosmetic caption is omitted. The bot entry uses a softer border, Leaderboard has an ink underline and red hover state, and the armory keeps Equip and Back actions close together. `scripts/check-hud-refinement.js` covers these details and direct touch Drop in the browser.

Sparse leaderboard displays are filled to ten rows with fictional starter arena rivals, marked “rival.” They use stable names and records, yield to real entries as the board fills, and never create accounts or submit scores. Real player saves remain untouched; the starter entries are presentation only.
