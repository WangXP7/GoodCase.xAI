# Architecture

Read the section for whatever you are about to touch. The invariants here are the ones that
have already been broken at least once.

---

## The contract

**The wheels and the shader read the same height field.**

`terrain.heightAt(x, z)` on the CPU and `terrainH(p)` in the vertex shader compute the same
number from the same baked data. The GPU never re-derives a height. The CPU bilinear filter
(`bilinear()` in `terrain.js`) is written to reproduce GL's `LinearFilter` + `ClampToEdge`,
and where `OES_texture_float_linear` is missing the shader filters in software rather than
falling back to nearest sampling.

Height is `hMacro + hDetail − hDent`. All three parts exist on both sides.

If you change how height is computed, change it on both sides in the same commit. When they
disagree the rover floats or sinks and every attempt to tune it makes something else worse.

**The contract is local.** It holds within about 95 m of the *camera*, and not beyond.
`terrainH` in the shader multiplies both detail octaves by
`fade = 1 − smoothstep(95, 300, distance(p, uCamXZ.xy))`, while the CPU `heightAt()` adds
them at full amplitude with no fade at all. They agree only because the fade is still 1.0
inside that radius.

Consequences you must respect:

- Do not narrow that window, and do not key `uCamXZ` off the rover instead of the render
  camera. Either desyncs physics from the drawn ground by up to 0.24 m.
- In PHOTO mode physics is frozen while the camera free-flies. Fly 300 m away and the ground
  under the parked rover loses its detail on the GPU while the CPU still has it.

**Where they are allowed to disagree, deliberately:** every clipmap ring except the innermost
is drawn 10 % of its own cell size low (`uSag`), so the LOD seam falls under the finer ring
instead of poking through it — up to 4 m on the outer ring. The whole surface is also bent
down quadratically with distance to fake a horizon (`uCurveR`). Neither has a CPU
counterpart. Nothing drives out there, so nothing notices.

**The macro→far crossfade is written three times** — `smoothstep(520, 596, r)` in the shared
GLSL `hMacro`, again in the sun-mask shader, and as `sstep(520, 596, r)` in `heightAt()`.
Change one and the physics and the drawn ground separate by metres in that annulus and
nowhere else. Change all three in the same commit, and never let the upper edge exceed 596:
`MACRO_EXT` is 1200, so the field only covers ±600 m and the UV clamp bites at 599.4.

---

## Frame order

`main.js`, in this order. Several of these are order-dependent.

| | |
|---|---|
| `input.poll()` | raw controls for this frame |
| `pumpCommands()` | queues drive commands if SIGNAL DELAY is on; returns what has *arrived* |
| `rover.step(dt, ctl, terrain)` | 6 physics substeps |
| `props.resolve(rover)` | **teleports** `rover.pos` out of static colliders |
| `rover.sync()` | pushes the body transform to the scene graph |
| `dust.update` · `terrain.update` · `sky.update` | world |
| `game.update` | missions, power, thermal, drill, radar |
| `rig.update` | camera |
| `audio.update` · `hud.update` | presentation |
| `engine.render(dt)` | composer |
| `saveFrame()` | screenshot, if requested — must be immediately after render |
| `input.endFrame()` | clears edge-triggered state and the click latch |

**`props.resolve` runs after the substeps and writes `rover.pos` directly, with no impulse
and no re-solve.** Anything that constrains the rover's position (a tow rope, a winch) will
see that as an instantaneous jump. Account for it or move the call.

**`saveFrame()` must stay immediately after `engine.render`.** It reads the canvas via
`toDataURL`, and the drawing buffer is not preserved across other work.

**`input.endFrame()` clears `mouse.clicked`.** That latch exists because a tap whose
`touchstart` and `touchend` both land between two frames is otherwise lost entirely — which
is most taps on a phone, and is why the drill was unusable there. Never test `mouse.down`
alone for a discrete action.

**Poll once, thread the result.** `poll()` zeroes `mouse.dx/dy/wheel` as it returns them, so
a second call anywhere in the frame steals mouse-look and zoom from the camera rig. There is
one `raw` per frame and everything reads that. Key edges and clicks exist only between
`poll()` and `endFrame()` — anything deferred into a callback or a `setTimeout` sees nothing.

**Stamp the terrain before `terrain.update`, not after.** `terrain.update` is the only place
dirty excavation rects upload and trail quads flush. Today `game.update` runs *after* it, so
the drill's `excavate` leaves exactly one pending rect at the end of every drilling frame:
the CPU `heightAt` sees the new hole immediately and the shader does not until the next
frame. That is the physics/pixels contract broken for one frame. Anything new that writes to
the dent field should go before `terrain.update`.

**Anything that must agree with the frame actually rendered goes after `rig.update`.**
`terrain`, `sky` and `props` update before it and therefore see the *previous* frame's
camera — measured: after a tick, `terrain.uniforms.uCamXZ` and `sky.group.position` hold the
pre-tick camera position. The sun-flare block sits where it does for exactly this reason.

**Whenever `sun.position` is written, write `sun.target.position` in the same pass.**
`syncSun` sets the position with the target at the origin; `aimShadow` then overwrites both
to sit at the rover — but `aimShadow` early-returns when `quality.shadow === 0`. Switching
to a tier without shadows leaves the target frozen at the last rover position while `syncSun`
keeps moving the light: measured 18° and 29° of error between the light direction and
`sky.sunDir`, so the rover and props are lit from the wrong place.

### Driving it headlessly

`REGOLITH.tick(dt)` applies **no dt clamp** — only the real `frame()` does. Meanwhile
`rover.step` caps its integration at `Math.min(dt, 0.05)` while elapsed time, the sun, dust
and every timer consume the full `dt`.

Call it at roughly 1/60 per tick. Measured: 60 ticks of 1/60 drove the rover 0.44 m, one
`tick(1.0)` drove it 0.01 m — both advancing mission time by exactly one second. A coarse
driver will silently report the physics as broken when it is fine.

---

## Terrain

### The bake

`bakeTerrain()` is a generator, pumped across frames during load so the progress bar moves.
**It takes no parameters** — one fixed world, from module constants. There is no seed and no
location argument. Making a second region means parameterising it.

It produces three CPU fields, all quality-independent:

| field | resolution | extent | metres/texel |
|---|--:|--:|--:|
| macro | 2048² | 1200 m | 0.586 |
| far | 512² | 7200 m | 14.06 |
| detail | 256², tiling | 16 m tile | 0.0625 |

Because the bake ignores quality, a quality change does **not** re-bake. That is what makes
live quality switching cheap.

R32F rather than half-float: heights reach 160 m, and half-float's mantissa would quantise
that to 12 cm steps — visibly terraced.

### The clipmap

Nine rings at HIGH and ULTRA, eight at MEDIUM, seven at LOW. Per frame each ring only has
its `position` snapped to a multiple of its own cell size — no vertex data is touched, so
there is zero per-frame CPU geometry work.

`buildClipmap()` **reuses `this.group`** if it already exists. `main.js` adds that group to
the scene once at boot; returning a fresh one would orphan the new rings and leave the old
ones drawn.

Ring materials are built directly, not cloned. `ShaderMaterial.clone()` deep-copies uniforms,
which warns on every render-target texture in the set and then has its work thrown away by
the line that shares the wrappers.

### Uniforms — the rule that bites

**Never replace a uniform wrapper object. Only mutate `.value`.**

`buildClipmap` does `Object.assign({}, this.uniforms)` so every ring shares the same wrapper
objects, and `Dust` is constructed with `terrain.uniforms.uSunDir` directly. Replacing
`this.uniforms.uSunDir` with a new `{value: …}` unwires all of them silently — nothing
throws, the sun just stops moving for the dust.

`Terrain.setQuality` follows this rule throughout. Copy it.

Two further consequences of how the rings are built:

- **Declare every new uniform in `buildMaterial()`'s literal**, which runs before
  `buildClipmap()`. The rings take a one-time snapshot of the wrapper map. A uniform added
  to `this.uniforms` afterwards never reaches any ring — the shader silently reads 0, and
  then it starts working the moment a quality change rebuilds the clipmap, which makes the
  bug look intermittent.
- `this.uniforms.uCell`, `uSag` and `uLod` are **dead objects**. `buildClipmap` replaces
  those three wrappers per ring. Writing to the ones on `this.uniforms` does nothing.
  `this.material` is never rendered either; it exists only as the shader-source template.

### The excavation field

CPU-authoritative. `Float32Array`, 4096² at 0.25 m/texel on HIGH/ULTRA (2048² and 0.5 m
below), spanning ±512 m. `heightAt` subtracts it, so ruts and drill pits are real geometry
the physics reads back.

Uploaded to the GPU as dirty rects through three scratch textures (16/64/256) blitted with
`copyTextureToTexture`. `_marks` holds pending rects; `_slumps` holds regions still settling.
**Both index the current grid** — if the grid is reallocated, clear them.

### `texDent.needsUpdate` is a trap

`texDent` is constructed over `this.dentHalf`, but `_uploadRect` never writes `dentHalf` — it
fills a small scratch texture and blits. So `dentHalf` stays the all-zero snapshot taken at
boot, forever.

Setting `texDent.needsUpdate = true` makes three re-upload that stale array before the blit,
which **erases every rut, berm and drill pit from the rendered ground** while `this.dent`
still has them — so the wheels keep driving over invisible geometry and dropping into pits
that are not drawn.

There are exactly two legal sites, and both have just filled `dentHalf` from `dent`: the
constructor, and `_resizeDent`. Everywhere else, push excavation through `_mark()` and let
`_uploadDirty()` handle it.

`DIG_CAP` is 0.48 m: buried past the axle, and there is no rescue mechanic for it.

Compacted rut floor never slumps; only churned floor relaxes, over about 2.4 s.
`_slumpRegion` merges regions within 4 texels and caps the list at 8.

**The berm guard:** `if (D[i] > 0.004) continue` refuses to raise a lip on already-excavated
ground. It exists because overlapping wheel steps would otherwise cancel each other flat. It
also means anything dragged along a path the wheels already rutted cannot berm there.

### The sun mask

A baked occlusion texture, ray-marched on the GPU when the sun has moved, plus a CPU
equivalent in `sunVis()` used for the rover's charging.

**Both march the macro field only.** Neither samples the excavation field. A pit the player
digs casts no shadow and does not stop the array charging. The mask is also 1.46 m/texel at
HIGH, which could not resolve a small pit even if it sampled one.

The march is `for (int i = 0; i < 96; i++)` with 96 as a GLSL literal, so shadow length stops
growing past a fixed distance regardless of `sunSteps`.

Penumbra is sized to the sun's real 0.53° angular diameter.

---

## Rover

A rigid body with a body-frame inertia tensor and a gyroscopic term, integrated by hand in
`_substep` — six substeps per frame, `dt` clamped to 0.05 first.

**It never touches an engine physics system.** It calls `terrain.heightAt` and
`terrain.normalAt` — pure functions over CPU arrays. There is no collider and no scene
raycast. This is why an engine migration would buy nothing here (see DECISIONS.md).

Six raycast wheels, each with spring-damper suspension, slip-based tyre forces inside a
friction circle, and pressure-based sinkage. The wheel-spin integration is **semi-implicit**
because the hub inertia is tiny next to the slip stiffness and an explicit step oscillates
and then explodes:

```js
spinNew = (w + dt*aT + dt*K*R*vLong/I) / (1 + dt*K*R*R/I)
```

Do not graft a position-based constraint solver into `_substep`. It would overwrite the
velocity that the semi-implicit tyre solve just produced.

**`SUB = 6` and the `Math.min(dt, 0.05)` clamp are load-bearing**, as is the spin clamp to
`±DRIVE.maxSpeed / WHEEL_R * 1.6`. They are what keep the solve inside its stability limit.

**`rover.hardHit` is a max-latch that `step()` never clears.** The single
`rover.hardHit = 0` before the step call in `main.js` is the only thing resetting it. Any
second stepping path — a headless driver, a replay, a split fixed-step loop — that omits the
reset will re-fire HARD LANDING damage, the thud and the dust burst every frame from one
landing, walking the hull to zero and teleporting the player home in a loop.

It is also written only by the chassis-vs-terrain floor clamp, never by suspension travel, so
a hard landing the suspension absorbs registers as exactly zero.

**Keep `w.lastGround.copy(w.worldPos)` on the airborne branch in `main.js`.** It is the only
thing advancing `lastGround` while a wheel is off the ground. Without it, landing feeds the
entire jump arc as one segment to `addTrack` and to the `rut` chain — one stretched track
quad through the air, and up to six permanent, non-slumping craters punched across ground the
wheels never touched.

### The drive envelope

`DRIVE.maxSpeed` is the single knob the whole feel hangs off — 8.4 m/s arcade, 3.6 LRV.
Every speed threshold in the rover, the camera and the audio is expressed as a fraction of
it, so the steering still loads up and the motor still sounds worked at either setting.

Two constants were literal absolutes and broke in LRV mode before being fixed: the camera's
auto-centre ramp and the motor's spin normalisation. If you add a speed threshold, make it a
fraction. Wheel *slip* is still absolute, deliberately — slip is a relative velocity, not a
road speed.

### Power and traction

`powerScale = POWER_FLOOR + (1 − POWER_FLOOR) · clamp(power / POWER_KNEE)` multiplies motor
torque. Below 25 % charge the torque fades to an 18 % floor — enough to limp home, not enough
to climb. The radar and the drill are harder gates and refuse outright.

Sinkage is a function of **wheel load only**. There is no soil map; every square metre of the
basin digs identically. Slip already feeds rut *depth* in `main.js`, but not the sinkage
*force*.

---

## Rendering

`QUALITY` in `engine.js` has fifteen fields. `Engine.setQuality` re-applies four of them —
shadow, pixels/maxDpr, msaa, bloom. **The rest live in the world objects**, and
`applyWorldQuality()` in `main.js` pushes them through to `Terrain`, `Props`, `Sky` and
`Dust`. If you add a field to the table, wire it into one of those or it will silently do
nothing.

`buildComposer` must dispose the old passes, not just the composer. `EffectComposer.dispose()`
frees its own two targets and nothing else; `UnrealBloomPass` carries eleven more.

**Never hold a reference to `engine.final` or `engine.bloom` across a rebuild.**
`buildComposer` constructs a new `ShaderPass` and a new `UnrealBloomPass`, and `ShaderPass`
deep-clones its uniforms — so a live rebuild puts `uGrain` back to 1, `uTime` back to 0 and
`bloom.enabled` back to the tier default. Anything still writing to the old objects is
writing into a pass that is no longer in the chain. Reach through `engine.` fresh every time,
and follow every `setQuality()` with `applySettings()`.

The framebuffer is capped by **total pixel count**, not device pixel ratio, and a governor
trades resolution for smoothness between 100 % and 62 %.

**Do not call `resize()` — or anything that reaches it — between `composer.render()` and a
canvas readback in the same frame.** `render()` runs the governor *after* the draw, and a
governor step reallocates the drawing buffer: measured, `toDataURL()` went from a 2.83 MB PNG
to a 19 KB blank one across that resize. This is why `saveFrame()` sits immediately after
`engine.render(dt)` and why nothing may be inserted between them.

### Audio and sky lifetimes

`Audio` is constructed at boot and handed to the HUD, but `init()` only runs inside
`startGame()` — so `this.ctx` is null while the menu is on screen, and menu clicks already
call into it. **Every public `Audio` method must start with `if (!this.ready) return;`.**
Any ungated path reaches `now()`, dereferences `this.ctx.currentTime`, and throws before the
game has started.

`sky._envDirty` is expensive in a way its name does not suggest: each flag costs a full
`pmrem.fromScene()` — a new render target plus the whole mip convolution chain — and disposes
the previous one on the next frame. It is also the sole `scene.environment` for every
`MeshStandardMaterial` in the rover and props, some at `metalness: 1.0`, so it cannot simply
be skipped. The six-second throttle in `main.js` is the balance point; set the flag through
that and nowhere else.

`makeMoonAlbedo` must keep `wrapT = RepeatWrapping`. `toTexture()` defaults to
`ClampToEdge` on T because the Earth maps are equirectangular and must not wrap at the poles,
but the terrain tiles the albedo in *both* axes. Normalising the two call sites either seams
Earth or smears one row of texels across the whole basin.

---

## Content

`lore.js` holds `CODEX`, `SAMPLES` and `MISSIONS` as plain data. Adding the *text* of a
mission is trivial.

The *logic* is not. Objectives are completed by hardcoded calls in `gameplay.js` — there are
nine objective ids in total, and each is wired by hand:

```
deep  deploy  drive  home1  massif  reach  recover  scan  transmit
```

A new kind of objective means editing `gameplay.js`. Worse, there are comparisons against
`missionIdx` (`< 4`, `=== 4`, `>= 3`) that gate content by position in the campaign — insert
a mission in the middle and they silently point at the wrong one. Even "drive 120 m" is a
literal in code, not a value in the mission data.

Fix this before writing story content, not after. Each mission added before the refactor
makes the refactor more expensive.

### Anomaly saves are positional — this is the sharpest edge in the codebase

`save()` writes the state of every anomaly as a bare array of `0/1/2` codes with **no id and
no coordinates**, and `load()` re-keys them by array index alone. `buildAnomalies()` builds
that array with `continue` filters on `slopeAt()` and radius.

So: change the terrain, change a filter, change the push order, or change the count, and
every index shifts. Old saves then mark the wrong objects as found or taken — verified, a
one-slot shift moved the "extracted" flag off the node core and onto the film sample.

The save blob carries no version field of its own. **The only thing that can force a reset is
the `KEY` string in `save.js`** — bump it in the same commit as any change to anomaly
generation or to the terrain the filters read.

---

## UI

One CSS variable drives the whole HUD: `--u × --hud-k = --s`, and every instrument dimension
is a multiple of `--s`. Instrument labels carry a `max()` floor so shrinking the HUD takes
space off canvases and padding, never off legibility. Some non-instrument text — the
discovery banner, the HUD's own inherited base size — has no floor.

Phones do not scale the tablet layout down; they **drop instruments**. The compass, sample
bay, thermal, chips, wheel monitor, radar scope and clock are `display: none` below the phone
breakpoint and are not available anywhere else in the session.

`body.touch-controls` is set by the code that actually mounts the thumbsticks, not by a
`pointer: coarse` media query, because the two can disagree. It only drives the tablet-and-up
blocks; phones move the HUD on the breakpoint alone.

Full-screen sheets use `.overlay.sheet`. **Do not name anything `.panel` at overlay scope** —
`.panel` is the HUD instrument class, and the collision once collapsed every full-screen
sheet to a 2 px strip for the entire history of the project before anyone noticed.

Opening a panel stores where to return in a separate variable rather than overwriting
`App.state`, because `closePanels()` tests `App.state !== ST.MENU` and overwriting it makes
that test unfalsifiable — which trapped the pointer lock.

**`--s` exists only inside the `.hud` and `#touch` subtrees.** `:root` carries `--hud-k` and
nothing else — that is the one `applySettings()` writes. A `calc(N * var(--s))` written
anywhere else resolves to an invalid value and CSS drops **the whole declaration**, so the
element silently falls back to browser defaults. Verified in the page: `--s` reads empty on
`:root`, on `body` and on `#pause`, and only resolves inside `#hud`.

**Any state that is not `ST.PLAY` or `ST.BOOT` runs `idleWorld()`**, which advances
`App.sunAz` and overwrites the camera with the menu orbit. Measured: opening the pause panel
while driving moved the camera from behind the rover to the menu flyover, and the sun kept
turning through paused ticks — mission time correctly froze, the sun did not. Never read
camera or sun state across a panel open, and assume any new panel state inherits this.

**`hud.cardOpen` is independent of `App.state`.** Only the opening card in `startGame` sets
`ST.CARD`; `advance()` shows a card while the state stays `ST.PLAY`, the world keeps
simulating behind it and the pointer stays locked. `closePanels()` hides pause, codex and
help — never the card overlay — so Escape stacks the pause panel on top of a still-visible
card. Check `cardOpen` explicitly rather than inferring it from the state.
