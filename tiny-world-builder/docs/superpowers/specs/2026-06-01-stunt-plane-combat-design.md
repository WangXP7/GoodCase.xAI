# Stunt-plane combat: guns, targeting, missiles

**Date:** 2026-06-01
**Source:** `~/downloads/ships/flight-sim3.html` (monolithic combat system)
**Target:** `tinyworld` flight mode (`engine/world/34-flight-sim.js`)

## Goal

Bring the ships combat *feel* — wing guns, a live targeting HUD, and guided
missiles — to the tinyworld stunt plane. The ships code is a tightly-coupled
subsystem that assumes a target-rich arena (AI traffic, saucers, mountain
targets) and a full economy (ammo banks, heat, flares, smoke, countermeasures,
alien weapons, supply earnings). **We do not port that.** We extract the three
core systems and rebuild them lean against tinyworld's idioms.

## Non-goals (explicitly cut — YAGNI)

- Ammo economy / supply earnings / time-earned refills
- Weapon heat + overheat lockout
- Flares, smoke screens, countermeasures
- Alien / blue-pulse weapon
- AI enemy behaviour (dogfight/flee), UFO pulse fire
- Score/combo banners tied to the ships game-score system
- Gamepad / touch weapon buttons (keyboard + mouse only for v1)

## Core principles

1. **Combat lives entirely in scene-space. The flight physics is untouched.**
   `updateFlightPhysics` and the sim-space model are not modified. Every tick,
   combat reads the *rendered* plane transform off `window.__flightJet` to get
   muzzle world positions and the fire direction. Targets (MP ghosts, world
   cells) are already scene-space, so everything stays in one frame and combat
   stays fully decoupled from the flight model.

2. **Own module, hooked like multiplayer.** New file
   `engine/world/41-flight-combat.js`, loaded after 40 in `tiny-world-builder.html`.
   `34-flight-sim.js` calls into it through optional global hooks — the same
   pattern already used for `window.__tinyworldMultiplayer.broadcastFlight`:
   - `tickFlight(dt)` → `window.__flightCombat?.tick(dt)`
   - `enterFlight()` → `window.__flightCombat?.onEnter(jet)`
   - `exitFlight()` → `window.__flightCombat?.onExit()`
   These are 3 small, guarded edits to file 34. No combat logic lives in 34.

3. **One load-bearing abstraction: the target adapter.** Guns, missiles, and the
   HUD never know what kind of thing they are hitting. Each target exposes:
   ```
   { id, kind, getWorldPos(out:Vector3), radius, isAlive(),
     label(), speedKts(), applyDamage(amount, hitScenePos, source) }
   ```
   Two providers feed a single per-frame candidate list:
   - **MP ghost provider** — wraps `flightGhosts` from module 38 (new getter).
   - **World-cell provider** — wraps destructible object cells near the plane,
     discovered from `cellMeshes` (reuses the flight collision candidate scan).
   Get this interface right and guns/HUD/missiles are all target-agnostic.

## Coordinate / aiming contract (the bug traps)

- **Muzzle anchors are re-derived, not copied.** The ships `gunL/gunR/missileL/
  missileR` offsets are in the *ships* model's local space at ships scale. The
  tinyworld stunt_plane GLB has different geometry/scale. On `onEnter(jet)` we
  compute the jet's local bounding box and derive wing-tip gun offsets and
  under-wing missile rails from its actual extents.

- **Fire direction must back out `FLIGHT_MODEL_FWD_FIX`.** File 34 sets
  `flightJet.quaternion = flightYawQuat * plane.quat * FLIGHT_MODEL_FWD_FIX`
  (a 180° Y spin because the GLB nose is +Z but physics-forward is −Z). The
  travel-forward we fire along is `(0,0,-1)` rotated by
  `flightYawQuat * plane.quat` — i.e. the jet quaternion with the FWD_FIX
  removed. File 34 will expose a tiny helper
  `window.__flightSceneForward(outVec3)` (and `__flightSceneMuzzle(localOffset,
  out)`) so combat never re-derives this and the two files cannot drift.

- **Verification is by 3D math, not screenshots.** Aim correctness is confirmed
  by casting the computed fire ray and checking it passes within `radius` of a
  known target world position / bbox — never by eyeballing a screenshot or
  synthetic click. (Per this project's standing lesson.)

## System 1 — Guns

- **Hitscan with visual tracers.** On fire (cooldown-gated, ~0.11s), for each of
  the two muzzles: spawn a box-tracer that flies along the shot direction for a
  short life, AND immediately run `attemptInstantHit(origin, dir)` against the
  target candidate list (nearest target whose miss-distance < `radius + magnet`).
  Magnet is biased toward the currently locked target so a good lock makes hits
  forgiving — same model as ships.
- **Inputs:** hold **Space** or **left mouse** to fire. Added to file 34's
  `FLIGHT_KEYCODES` capture set (Space) plus a pointer listener gated on
  `flightActive`.
- **Ammo:** simple finite belt with a slow passive refill is **out** for v1 —
  guns are unlimited but cooldown-limited. (Revisit if it feels cheap.)
- **FX:** muzzle flash + tracer using tinyworld's existing particle emitter
  (`engine/world/23-particles-clouds.js`) — checked for a reusable cluster
  emitter before writing a new one. Tracer meshes are a small pooled set
  (~48) of additive boxes, mirroring ships but scene-scaled.

## System 2 — Targeting HUD (full)

DOM overlay injected by module 41 (hidden unless `flightActive`), styled to
match the existing flight HUD. Per frame:

- **Reticle:** derived from the gun line projected forward and biased slightly
  up; spring-smoothed so it has natural lag/movement rather than being glued to
  screen centre. (Ships `HERMES_HANDOFF` direction.)
- **Target brackets + data cards:** for each on-screen target in front of the
  camera (capped count), project its world position to 2D, draw a bracket box
  sized from `radius`, and a card showing **type · distance · speed · altitude**.
- **Lock:** the target nearest the reticle becomes the active candidate; lock
  builds up over ~time-to-lock while the reticle stays on it, decays when it
  leaves. A locked target gets a distinct bracket state + a lock tone (short
  WebAudio beep via the existing sound system if available, else silent).
- Telemetry hooks (`reticle_x/y`, `target_lock`, `target_lock_label`,
  `target_lock_distance_m`) exposed on `window.__flightCombat.telemetry()` for
  the 3D-math verification.

## System 3 — Missiles

- **Alternating wing rails**, guided toward the locked target; **dumb-fire**
  straight ahead if there is no lock.
- Pooled missile meshes (cylinder body + cone nose + fins), proportional
  guidance steering toward `target.getWorldPos()`, limited turn rate, finite
  life, smoke trail via the particle emitter.
- **Input:** **X** key (already in file 34's capture set) or a dedicated bind;
  cooldown-gated. Finite missile count (e.g. 6) with no refill for v1.
- On proximity to target → `target.applyDamage(missileDamage, hitPos, 'missile')`
  + explosion FX.

## Damage model

### World objects — persistent destruction (per decision)

- Destructible = any cell with a non-null object `kind` (house, fence, rock,
  crops, model-stamp, voxel-build). Terrain is **not** destroyed (no craters).
- A hit accumulates damage on a lightweight per-cell health record keyed by
  `x,z` (held in module 41, seeded from object size). On reaching zero:
  `setCell(x, z, { terrain: prev.terrain, terrainFloors: <prev>, kind: null,
  floors: 1 })`.
- **This reuses the existing erase path for free:** `setCell` already
  (a) broadcasts a `cell.set` op to peers via `sendCellSnapshot` (role-gated by
  `canEdit(x,z)`), (b) persists through the save layer, and (c) pushes an undo
  snapshot. No new netcode or persistence code is required.
- **Role gate respected:** if `window.__tinyworldMultiplayer.canEdit(x,z)` is
  false (viewer/player role, or outside an editor's island), the cell is **not**
  destroyed — combat shows a shield-spark "can't damage" cue instead. Solo /
  un-upgraded server → always permitted.
- Hit→cell mapping: a `THREE.Raycaster` along the shot ray tested against the
  nearby candidate object meshes (same candidate set the flight collision scan
  already builds), returning the owning `entry.{x,z}`.

### Other players — lock + hit + damage messages (per decision)

- No server authority exists; each client owns its own plane. So:
  - Shooter computes a hit on a ghost, plays local hit sparks, and sends
    `{ type: 'combat.hit', to: <peerId>, by: <myId>, damage, source }` over
    `window.__tinyworldMultiplayer.send`.
  - The **hit player's own client** owns a flight-health value (new, lives in
    module 41), subtracts incoming damage, shows a damage/shield HUD readout.
    At zero health it runs local destruction FX and **resets**: re-launch at the
    plane's spawn transform (or exit flight) — the target owns its own death.
  - Module 38 routes inbound `combat.hit` messages to
    `window.__flightCombat?.onIncomingHit(msg)` (one small dispatch edit,
    mirroring how chat/flight/env messages are routed).
- This is real PvP without faking authority client-side; a hidden ghost would
  just reappear on the next broadcast, which is why we don't do that.

## Files touched

| File | Change | Size |
|------|--------|------|
| `engine/world/41-flight-combat.js` | **New** — all combat, HUD, target adapter | large |
| `engine/world/34-flight-sim.js` | 3 guarded hook calls + `__flightSceneForward/Muzzle` helpers + Space/mouse fire capture | small |
| `engine/world/38-multiplayer-partykit.js` | `flightGhosts()` getter on the export; route inbound `combat.hit` | small |
| `tiny-world-builder.html` | `<script src="engine/world/41-flight-combat.js">` after 40 | 1 line |
| styles (flight HUD CSS) | reticle / target-bracket / card / damage-readout styles | small |

## Build & verify order (riskiest last)

1. Reticle + gun tracers + muzzle flash, **no targets** — verify fire direction
   with 3D ray-vs-known-point math.
2. `flightGhosts()` getter + target adapter + full HUD (brackets/cards/lock)
   over MP ghosts.
3. Hitscan damage + hit FX on ghosts + `combat.hit` messaging + target-owned
   death/reset.
4. Guided missiles.
5. World-object targets: raycast→cell, per-cell health, persistent
   `setCell(kind:null)` destruction with role gate. (Highest cross-system risk.)

## Resolved decisions

- **Cuts confirmed (v1).** No ammo limits and no weapon heat. Guns are
  unlimited but cooldown-gated; missiles are finite (~6) with no refill.
- **Player death = re-launch at spawn.** When a player's flight-health reaches
  zero, run destruction FX and re-launch them at the parked plane's spawn
  transform (they stay in flight), rather than ejecting to the editor.

## Deviations discovered during build

- **Server relay required.** The plan assumed `combat.hit` could ride the
  existing channel, but the partykit server (`party/index.js`) relays only
  whitelisted message types via explicit branches and drops unknown ones. A
  `combat.hit` relay branch + rate-limit entry were added to the server (routed
  only to the targeted peer, stamping `by = sender.id`), with a unit test in
  `tests/party.test.mjs`.
- **Scenery candidate source.** In-grid objects live in `cellMeshesGrid` (2D
  array), not the string-keyed `cellMeshes`; the hit resolver scans both.
- **Raycast hardening.** Scenery raycast is wrapped in try/catch (some cell
  object trees contain a null child that crashes THREE's recursive raycast) and
  sets `raycaster.camera` (cell objects contain sprites that warn otherwise).
- **Muzzle derivation.** Offsets are derived in jet-LOCAL units (world bbox /
  jet world scale), with a load-race retry until the GLB is present.

## Open risks

- **No flight-health today.** Player health for PvP is new state in module 41,
  seeded on `onEnter`.
- **HUD performance** with many ghosts/cells — capped candidate count mitigates.
- **`canEdit` semantics** when solo vs MP-with-roles — verified to default-open
  when un-upgraded.
