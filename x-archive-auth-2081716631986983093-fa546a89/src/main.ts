/**
 * Starfall — entry point and integration layer.
 *
 * Owns the boot sequence, the fixed-step simulation loop and the wiring between
 * every subsystem. Nothing else in the codebase imports this file.
 */

import * as THREE from 'three';
import './style.css';

import { CONFIG } from './core/config';
import { bus } from './core/bus';
import { Rng, hashSeed } from './core/rng';
import { Team, ShipClass, Formation, type QualitySettings } from './core/types';
import type { RenderContext } from './core/contracts';
import { SHIP_SPECS } from './core/registry';

import { World } from './sim/world';
import { generateMap } from './sim/mapgen';
import { stepMovement } from './sim/movement';
import { updateSquads } from './sim/formations';
import { stepCombat } from './sim/combat';
import { stepOrders } from './sim/orders';
import { cancelBuild, enqueueBuild, startResearch, stepEconomy } from './sim/economy';
import { EnemyAI } from './sim/ai';

import { Stage } from './render/renderer';
import { createTextures } from './render/textures';
import { createHullMaterial, updateHullMaterial } from './render/hullMaterial';
import { ShipLibrary } from './ships/library';
import { FleetRenderer } from './render/fleet';
import { TacticalCamera } from './render/cameraRig';
import { ShipPicker } from './render/picking';

import { Backdrop } from './world/backdrop';
import { Planet } from './world/planet';
import { AsteroidRenderer } from './world/asteroids';

import { ParticleSystem } from './fx/particles';
import { EngineFx } from './fx/engines';
import { WeaponFx } from './fx/weapons';
import { ExplosionFx } from './fx/explosions';

import { Controls } from './input/controls';
import { Hud } from './ui/hud';
import { BuildPanel } from './ui/build';
import { TacticalOverlay } from './ui/tactical';
import { BandOverlay } from './ui/bandOverlay';
import { FleetBar } from './ui/fleetBar';
import { SelectionVisuals } from './ui/selection';
import { Audio } from './core/audio';
import { Menu } from './ui/menu';

// ---------------------------------------------------------------------------
// Boot parameters
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const SEED = params.get('seed') ? hashSeed(params.get('seed')!) : (Math.random() * 0xffffffff) >>> 0;
/** Isolated hull inspection mode: ?ship=Destroyer */
const SHIP_VIEW = params.get('ship');
/** Scenario presets for the capture harness. */
const SCENARIO = params.get('scenario') ?? '';
/**
 * Camera override for the capture harness: `?cam={"dist":1400,"yaw":0.9,"pitch":0.2}`.
 *
 * `scripts/capture.mjs` has documented and forwarded this since it was written
 * and nothing ever read it, so every `--cam` in every verification run was
 * silently ignored and produced the scenario's default framing instead. That
 * makes a screenshot harness worse than useless: it answers a question you did
 * not ask while looking like it answered the one you did.
 */
const CAM_OVERRIDE = ((): { dist?: number; yaw?: number; pitch?: number } | null => {
  const raw = params.get('cam');
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const num = (k: string): number | undefined =>
      typeof v[k] === 'number' && isFinite(v[k] as number) ? (v[k] as number) : undefined;
    return { dist: num('dist'), yaw: num('yaw'), pitch: num('pitch') };
  } catch {
    console.warn('[starfall] ?cam= is not valid JSON, ignored');
    return null;
  }
})();

declare global {
  interface Window {
    __starfallReady?: boolean;
    __starfallStats?: Record<string, number>;
    __starfall?: Game;
  }
}

// ---------------------------------------------------------------------------
// Quality presets
// ---------------------------------------------------------------------------

function detectQuality(): QualitySettings {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ultra: QualitySettings = {
    preset: 3,
    shadows: true,
    shadowResolution: 4096,
    bloom: true,
    motionBlur: false,
    volumetrics: true,
    ssao: true,
    antialias: 'smaa',
    // 120000 was set while the particle system was NOT DRAWING (see the
    // feedback-loop note in the frame loop): the number was never once looked
    // at on screen. With the draw restored, a battle held 67142 live additive
    // sprites and the middle of the frame was an opaque white wash - the
    // reported "huge spam on screen". A readable engagement is thousands, not
    // tens of thousands; past that the sprites stop being events and become fog.
    maxParticles: 24000,
    pixelRatio: dpr,
    lodBias: 1.35,
  };
  return ultra;
}

// ---------------------------------------------------------------------------
// Boot screen helpers
// ---------------------------------------------------------------------------

const bootEl = document.getElementById('boot');
const bootBar = bootEl?.querySelector('.boot-bar > i') as HTMLElement | null;
const bootStatus = bootEl?.querySelector('.boot-status') as HTMLElement | null;

function progress(done: number, total: number, label: string): void {
  if (bootBar) bootBar.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
  if (bootStatus) bootStatus.textContent = label;
}

function bootDone(): void {
  if (!bootEl) return;
  bootEl.classList.add('gone');
  window.setTimeout(() => bootEl.remove(), 900);
}

/** Let the browser paint between heavy synchronous build steps. */
function yieldFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

class Game {
  readonly quality = detectQuality();
  readonly world: World;
  readonly rng: Rng;

  stage!: Stage;
  library!: ShipLibrary;
  fleet!: FleetRenderer;
  backdrop!: Backdrop;
  planet!: Planet;
  rocks!: AsteroidRenderer;
  particles!: ParticleSystem;
  engineFx!: EngineFx;
  weaponFx!: WeaponFx;
  explosionFx!: ExplosionFx;
  selectionVis!: SelectionVisuals;
  cam!: TacticalCamera;
  controls!: Controls;
  hud!: Hud;
  build!: BuildPanel;
  tactical!: TacticalOverlay;
  bandOverlay!: BandOverlay;
  picker!: ShipPicker;
  fleetBar!: FleetBar;
  audio!: Audio;
  menu!: Menu;
  ai!: EnemyAI;

  private accumulator = 0;
  private last = performance.now();
  private frames = 0;
  private fpsTimer = 0;
  private running = false;

  private ctx: RenderContext = {
    renderer: null as unknown as THREE.WebGLRenderer,
    scene: null as unknown as THREE.Scene,
    camera: null as unknown as THREE.PerspectiveCamera,
    envMap: null,
    quality: this.quality,
    time: 0,
    dt: 0,
  };

  constructor() {
    this.world = new World(SEED);
    this.rng = new Rng(SEED ^ 0x5bf03635);
  }

  async boot(): Promise<void> {
    const canvas = document.getElementById('viewport') as HTMLCanvasElement;
    const uiRoot = document.getElementById('ui') as HTMLElement;

    progress(0, 10, 'starting renderer');
    this.stage = new Stage(canvas, this.quality);
    this.ctx.renderer = this.stage.renderer;
    this.ctx.scene = this.stage.scene;
    this.ctx.camera = this.stage.camera;
    await yieldFrame();

    progress(1, 10, 'baking surface textures');
    const textures = createTextures(this.stage.renderer);
    await yieldFrame();

    progress(2, 10, 'generating deep space');
    this.backdrop = new Backdrop(
      this.stage.scene, this.stage.renderer, textures, this.rng.fork(1), this.quality,
    );
    this.ctx.envMap = this.backdrop.envMap;
    this.stage.scene.environment = this.backdrop.envMap;
    // Align the key light with the backdrop's star.
    this.stage.sun.position.copy(this.backdrop.sunDir).multiplyScalar(1e6);
    await yieldFrame();

    progress(3, 10, 'forming planetary bodies');
    this.planet = new Planet(this.stage.scene, this.rng.fork(2), this.quality);
    await yieldFrame();

    progress(4, 10, 'constructing hulls');
    this.library = new ShipLibrary(this.rng.fork(3));
    await this.library.preload((done, total, label) => progress(4 + (done / total) * 3, 10, label));

    progress(7, 10, 'seeding the battlespace');
    const starts = generateMap(this.world, { seed: SEED, startFleet: 'standard' });
    this.rocks = new AsteroidRenderer(
      this.stage.scene, this.world, textures, this.rng.fork(4), this.quality,
    );
    await yieldFrame();

    progress(8, 10, 'igniting drives');
    const hullMat = createHullMaterial({ textures: textures.hull(), envMap: this.backdrop.envMap });
    this.fleet = new FleetRenderer(this.stage.scene, this.library, hullMat, this.quality);

    this.particles = new ParticleSystem(this.stage.scene, textures, this.quality);
    this.engineFx = new EngineFx(this.stage.scene, this.particles, textures, this.quality);
    this.weaponFx = new WeaponFx(this.stage.scene, this.particles, textures, this.quality);
    this.explosionFx = new ExplosionFx(this.stage.scene, this.particles, textures, this.quality);
    this.selectionVis = new SelectionVisuals(this.stage.scene, this.world, this.quality);
    await yieldFrame();

    progress(9, 10, 'bringing systems online');
    this.cam = new TacticalCamera(this.stage.camera);
    this.cam.moveTo(starts.playerStart.x, starts.playerStart.y, starts.playerStart.z, true);
    this.cam.distance = 2600;

    // Picking goes through the geometry-accurate picker, NOT the fleet
    // renderer's bounding-sphere test: a Mothership's bounding sphere has a
    // 1060 m radius, so sphere picking selected it from a kilometre away.
    this.picker = new ShipPicker(this.library);

    this.controls = new Controls(canvas, this.cam, this.world, {
      raycastShip: (ox, oy, oz, dx, dy, dz) => this.picker.raycast(ox, oy, oz, dx, dy, dz, this.world),
      raycastRock: (ox, oy, oz, dx, dy, dz) => this.rocks.raycast(ox, oy, oz, dx, dy, dz, this.world),
    });

    this.hud = new Hud(uiRoot, this.world, { onCommand: (c, a) => this.onCommand(c, a) });
    // The menu owns no game state: it reads the credit lists straight out of the
    // audio modules and the keymap out of `controls.ts`, so nothing on it can
    // drift from what the game actually does.
    this.menu = new Menu(uiRoot, {
      volumes: () => this.audio.getVolume(),
      setVolumes: (m, s, mu) => this.audio.setVolume(m, s, mu),
    });
    // The build panel is pure presentation — it reports intent and the
    // integrator drives the economy. Without these three callbacks wired the
    // panel rendered correctly and did nothing at all when clicked.
    this.build = new BuildPanel(uiRoot, this.world, {
      team: Team.Player,
      onBuild: (cls) => this.queueBuild(cls),
      onResearch: (id) => {
        if (!startResearch(this.world, Team.Player, id)) {
          bus.emit('notice', { text: 'Cannot start research', kind: 'warn' });
        }
      },
      onCancel: (index) => {
        const producer = this.selectedProducer();
        if (producer >= 0) cancelBuild(this.world, producer, index);
      },
    });
    this.bandOverlay = new BandOverlay(uiRoot);

    // Quick access to owned units. Reports intent only; the integrator owns the
    // selection, so the bar never writes to the world.
    this.fleetBar = new FleetBar(uiRoot, {
      team: Team.Player,
      onSelect: (ids, add) => {
        const sel = this.world.selection;
        if (!add) sel.length = 0;
        for (const id of ids) if (sel.indexOf(id) < 0) sel.push(id);
        bus.emit('selection', { ids: sel });
        // The fleet bar writes the selection here rather than through
        // `Controls`, so it has to raise its own acknowledgement — the one in
        // `assignSelection` never sees this path.
        bus.emit('ack', { kind: 'select', count: sel.length });
      },
      onFrame: (ids) => {
        const sel = this.world.selection;
        sel.length = 0;
        for (const id of ids) sel.push(id);
        bus.emit('selection', { ids: sel });
        bus.emit('ack', { kind: 'select', count: sel.length });
        this.cam.frame(sel, this.world);
      },
    });
    this.tactical = new TacticalOverlay(uiRoot, this.world, this.stage.camera);
    // Clicking or scrubbing the corner minimap jumps the camera. The overlay
    // reports the world point; moving the camera is the integrator's job.
    this.tactical.onMinimapJump = (x, _y, z) => {
      this.controls.stopFollow();
      this.cam.moveTo(x, this.cam.focus.y, z);
    };

    this.ai = new EnemyAI(this.world, Team.Enemy, 1);

    this.audio = new Audio();
    // The score credits itself on screen while it plays. The HUD knows nothing
    // about the music and the audio module knows nothing about the HUD; this is
    // the only place that has both. Set AFTER `audio` exists — the HUD is built
    // a hundred lines earlier in the boot sequence.
    this.audio.onTrackChange = (t): void => this.hud.showNowPlaying(t.title, t.author);
    const unlockAudio = () => {
      void this.audio.start();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.applyScenario();

    progress(10, 10, 'ready');
    bootDone();
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
    window.__starfallReady = true;
    window.__starfall = this;
  }

  /** Capture-harness scenarios so screenshots are reproducible. */
  private applyScenario(): void {
    this.placeScenario();
    if (!CAM_OVERRIDE) return;
    // Applied last so it beats the scenario's own framing, and as deltas
    // because the rig exposes yaw/pitch read-only and drives them through
    // springs. The capture harness always waits several seconds, which is far
    // longer than the springs need to settle.
    if (CAM_OVERRIDE.dist !== undefined) this.cam.distance = CAM_OVERRIDE.dist;
    const dYaw = CAM_OVERRIDE.yaw !== undefined ? CAM_OVERRIDE.yaw - this.cam.yaw : 0;
    const dPitch = CAM_OVERRIDE.pitch !== undefined ? CAM_OVERRIDE.pitch - this.cam.pitch : 0;
    if (dYaw !== 0 || dPitch !== 0) this.cam.orbit(dYaw, dPitch);
  }

  private placeScenario(): void {
    const w = this.world;
    if (SHIP_VIEW) {
      // Isolated turntable: wipe the map, place one hull at the origin.
      for (let i = w.ships.count - 1; i >= 0; i--) {
        const victim = w.ships.items[i];
        if (victim && victim.alive) w.killShip(victim.id);
      }
      for (let i = w.asteroids.count - 1; i >= 0; i--) w.asteroids.kill(i);
      const cls = (ShipClass as unknown as Record<string, number>)[SHIP_VIEW];
      if (cls !== undefined) {
        const s = w.spawnShip(cls as ShipClass, Team.Player, 0, 0, 0);
        if (s) {
          const r = SHIP_SPECS[s.cls].radius;
          this.cam.moveTo(0, 0, 0, true);
          this.cam.distance = r * 2.9;
          // Hero three-quarter from ASTERN. The old front-quarter angle put the
          // engine block on the far side of the hull, so drive plumes — the
          // thing most often being checked in a turntable — were never in shot.
          this.cam.orbit(2.45, 0.18);
          // Capture-only: pin the key light to a flattering front-left-high
          // angle so a turntable shot is not judged on a backlit hull.
          this.stage.sun.position.set(-0.62, 0.46, 0.64).normalize().multiplyScalar(1e6);
        }
      }
      return;
    }
    if (SCENARIO === 'battle') {
      // Two fleets already in contact near the player's start.
      const mid = new THREE.Vector3();
      const pm = w.ship(w.motherships[Team.Player]);
      if (pm) mid.copy(pm.pos).add(new THREE.Vector3(4200, 260, 3000));
      const roster: ShipClass[] = [
        ShipClass.Interceptor, ShipClass.Interceptor, ShipClass.Bomber,
        ShipClass.AssaultCorvette, ShipClass.IonFrigate, ShipClass.AssaultFrigate,
        ShipClass.Destroyer,
      ];
      const rng = new Rng(SEED ^ 0xbeef);
      const combatants: number[] = [];
      for (let t = 0; t < 2; t++) {
        const team = t === 0 ? Team.Player : Team.Enemy;
        const side = t === 0 ? -1 : 1;
        for (let i = 0; i < 46; i++) {
          const cls = roster[Math.min(roster.length - 1, Math.floor(rng.next() ** 2 * roster.length))];
          const s = w.spawnShip(
            cls, team,
            mid.x + side * rng.range(900, 2600) + rng.gauss() * 200,
            mid.y + rng.gauss() * 320,
            mid.z + rng.gauss() * 900,
          );
          if (s) combatants.push(s.id);
        }
      }
      this.cam.moveTo(mid.x, mid.y, mid.z, true);
      // `frame` is an explicit framing verb, which both fits the whole
      // engagement and disarms the rig's one-shot cinematic compose latch.
      // Without it the latch picked a single hero hull and closed to ~400 m,
      // which put a 5 km battle almost entirely outside the frame — 144 live
      // tracers and a firing ion beam were being drawn off-camera.
      this.cam.frame(combatants, w);
    }
  }

  private onCommand(cmd: string, _arg?: unknown): void {
    if (cmd === 'tactical') this.tactical.toggle();
    else if (cmd === 'menu') this.menu.toggle('controls');
    else if (cmd === 'credits') this.menu.toggle('credits');
  }

  /**
   * Which hull the build panel is currently driving.
   *
   * The selected producer if the player has one selected, otherwise the
   * mothership — so the panel is never dead just because nothing is selected.
   */
  private selectedProducer(): number {
    const w = this.world;
    for (const id of w.selection) {
      if (w.producers.has(id)) return id;
    }
    return w.motherships[Team.Player];
  }

  private queueBuild(cls: ShipClass): void {
    const producer = this.selectedProducer();
    if (producer < 0) {
      bus.emit('notice', { text: 'No production facility', kind: 'warn' });
      return;
    }
    if (!enqueueBuild(this.world, producer, cls)) {
      bus.emit('notice', { text: 'Cannot build — resources, supply or tech', kind: 'warn' });
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.stage.resize(w, h);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    const dtRaw = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    // --- fixed-step simulation ---
    this.accumulator += dtRaw;
    let steps = 0;
    while (this.accumulator >= CONFIG.simStep && steps < CONFIG.maxCatchupSteps) {
      this.stepSim(CONFIG.simStep);
      this.accumulator -= CONFIG.simStep;
      steps++;
    }
    if (steps === CONFIG.maxCatchupSteps) this.accumulator = 0;

    // --- render ---
    const ctx = this.ctx;
    ctx.dt = dtRaw;
    ctx.time = this.world.time;

    this.controls.update(dtRaw);
    this.cam.update(dtRaw, this.world);

    // Feed the input layer's transient state to its two consumers: the DOM band
    // rectangle, and the in-world move-disc gizmo. Both were being tracked by
    // Controls and read by nobody.
    this.bandOverlay.update(this.controls);
    const gizmo = this.controls.moveGizmo;
    if (gizmo) this.selectionVis.setMoveGizmo(gizmo.x, gizmo.y, gizmo.z, gizmo.baseY);
    else this.selectionVis.setMoveGizmo(0, 0, 0, 0, false);

    updateHullMaterial(ctx.time);
    this.backdrop.update(ctx, this.world);
    this.planet.update(ctx, this.world);
    this.rocks.update(ctx, this.world);
    this.fleet.update(ctx, this.world);
    this.engineFx.update(ctx, this.world);
    this.weaponFx.update(ctx, this.world);
    this.explosionFx.update(ctx, this.world);
    // SOFT DEPTH IS OFF, AND THIS IS NOT A TUNING CHOICE.
    //
    // `stage.depthTexture` is the depth ATTACHMENT of `stage.sceneTarget` — the
    // very render target the scene is being drawn into. Sampling a texture that
    // is attached to the currently bound framebuffer is a feedback loop, which
    // WebGL forbids: the driver does not clamp it or return garbage, it DROPS
    // THE ENTIRE DRAW CALL. Chrome logs
    //
    //   GL_INVALID_OPERATION: glDrawElementsInstanced:
    //   Feedback loop formed between Framebuffer and active Texture
    //
    // once per affected draw, per frame. Every system handed this texture stops
    // rendering completely — which is the real reason for the standing
    // "mothership still no flame" report. The plume instances were being built
    // correctly all along (6 nozzles, 234 m wide, 634 m long, intensity 1.55,
    // projecting to a 200 px column right where the flame should be); the draw
    // was simply never executed. Chasing it through the plume shader found
    // nothing because there was nothing there to find.
    //
    // Turning the term off costs a seam softener with a 0.55 floor — a small
    // effect — and buys back the drive plumes, the soft particles and a
    // per-frame GL error. Doing it PROPERLY means giving the effects a depth
    // COPY: either a depth prepass into its own target, or a blit after the
    // opaque pass. Both are real work in `renderer.ts` and neither belongs in a
    // one-line hookup here.
    this.particles.setDepthTexture(null);
    this.engineFx.setDepthTexture?.(null);
    this.particles.update(ctx, this.world);
    this.selectionVis.update(ctx, this.world);

    this.stage.updateShadowFrustum(
      this.cam.focus.x, this.cam.focus.y, this.cam.focus.z,
      Math.max(600, this.cam.distance * 0.6),
    );
    this.stage.render(dtRaw, ctx.time);

    this.hud.update(this.world, this.stage.camera, dtRaw);
    this.build.update(this.world, this.stage.camera, dtRaw);
    this.fleetBar.update(this.world, dtRaw);
    this.tactical.update(this.world, this.stage.camera, dtRaw);
    this.audio.update(this.stage.camera, dtRaw, this.world);

    // --- stats ---
    this.frames++;
    this.fpsTimer += dtRaw;
    if (this.fpsTimer >= 0.5) {
      window.__starfallStats = {
        fps: Math.round(this.frames / this.fpsTimer),
        ships: this.world.ships.liveCount(),
        projectiles: this.world.projectiles.liveCount(),
        draws: this.stage.renderer.info.render.calls,
        tris: this.stage.renderer.info.render.triangles,
      };
      this.frames = 0;
      this.fpsTimer = 0;
    }
  };

  private stepSim(dt: number): void {
    const w = this.world;
    w.time += dt;
    w.tick++;
    w.stepClocks(dt);
    w.rebuildHash();
    stepOrders(w, dt);
    updateSquads(w, dt);
    stepMovement(w, dt);
    stepCombat(w, dt);
    stepEconomy(w, dt);
    this.ai.step(w, dt);
    w.pruneSquads();
  }
}

// ---------------------------------------------------------------------------

const game = new Game();
game.boot().catch((err) => {
  console.error('[starfall] boot failed', err);
  if (bootStatus) bootStatus.textContent = `boot failed: ${String(err)}`;
});

// Silence the unused-import warning for CAPTURE while keeping the flag available
// to future capture-only tuning.
if (CAPTURE) document.documentElement.classList.add('capture');
void Formation;
void bus;
