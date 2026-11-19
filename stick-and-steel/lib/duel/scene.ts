import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DuelSimulation, initPhysics, STEP, type DuelPhase, type DuelOptions } from './physics';
import { createAvatar } from './avatar';
import { DuelCamera, menuCameraPose, steerWeapon } from './camera';
import { createImpactEffects } from './effects';
import { weaponName } from './weapons';
import { createWeaponViews } from './weapon-view';
import { createPitArena } from './arena-view';
import { createDuelNetwork, OFFLINE_STATUS, type NetworkStatus } from './network';
import { held, supported, hangingHand, type Action } from './net-state';
import { createCombatAudio } from './audio';
import { createImpactLabels, trainingImpactCaption } from './impact-labels';
import { onPlatform } from './arena';
import { vec } from '../rig/ik';
import { DuelTutorial, type TutorialStatus } from './tutorial';
import { createTrainingYard } from './training-view';

export type DuelStatus = {
  phase: DuelPhase; hp: number[]; stamina: number[]; stagger: number[]; hits: number; blocks: number; cuts: number; states: string[]; result: string; resultReady: boolean;
  winner: number | null; message: string; slow: boolean; paused: boolean; muted: boolean; practice: boolean; pointerLocked: boolean;
  tutorial: TutorialStatus | null;
  network: NetworkStatus; interaction: string; guardDirection: string;
  options: DuelOptions; weapons: string[]; grips: number[]; disarms: number;
};
export type DuelAPI = {
  joinOnline(): void; leaveOnline(): void;
  startTutorial(): void; retryTutorial(): void; exitTutorial(): void;
  attack(value: boolean): void; steer(x: number, y: number): void;
  start(): void; reset(): void; slash(): void; chop(): void; lunge(): void; guard(value: boolean): void;
  move(x: number, y: number): void; setPaused(v: boolean): void; setSlow(v: boolean): void;
  setMuted(v: boolean): void; setPractice(v: boolean): void; captureMouse(): void; dispose(): void;
  setVolume(channel: 'effects' | 'crowd', value: number): void;
  configure(options: Partial<DuelOptions>): void; ledgeDrill(): void; interact(value: boolean): void; drop(): void; shove(): void;
};

export async function createDuel(host: HTMLElement, onStatus: (status: DuelStatus) => void): Promise<DuelAPI> {
  await initPhysics();
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const sim = new DuelSimulation({ arena: 'bridge', spares: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  const canvas = renderer.domElement; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Stick and Steel arena. Click to capture mouse. WASD to move, left mouse and sweep to swing, right mouse and drag to aim your guard. C to chop down. E to pick up; hold E to stand or climb. G to drop, F to shove. Middle drag to look, wheel to zoom, Escape to pause.');
  host.appendChild(canvas);
  const scene = new T.Scene(); scene.background = new T.Color('#efeeeb'); scene.fog = new T.Fog('#efeeeb', 15, 38);
  const roomEnvironment = new RoomEnvironment(), pmrem = new T.PMREMGenerator(renderer);
  const metalEnvironment = pmrem.fromScene(roomEnvironment, .04);
  roomEnvironment.dispose(); pmrem.dispose();
  const camera = new T.PerspectiveCamera(50, 1, .12, 60), followCamera = new DuelCamera();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let menuTime = 0, menuBlend = 1, presentingMenu = true;
  let fallBlend = 0;
  const pelvisPosition = new T.Vector3(), rivalPosition = new T.Vector3();
  function updateCamera(dt: number, snap = false) {
    const player = sim.fighters[sim.localPlayerId]; pelvisPosition.copy(player.rig.parts.get('pelvis')!.body.translation());
    rivalPosition.copy(sim.fighters[1 - sim.localPlayerId].rig.parts.get('pelvis')!.body.translation());
    const hanger = sim.fighters.find(f => hangingHand(f));
    const hanging = hanger?.hang ?? (hanger?.remote?.inward ? hanger.remote : undefined);
    const heading = hanging ? Math.atan2(hanging.inward!.x, hanging.inward!.z) - .25 : player.heading;
    if (snap) followCamera.reset(pelvisPosition, heading, rivalPosition);
    else followCamera.update(pelvisPosition, heading, dt, middleDown, rivalPosition);
    camera.position.copy(followCamera.position);
    const falling = sim.options.arena === 'bridge' ? sim.fighters.find(f => (f.mode === 'falling' || f.down) && f.rig.parts.get('pelvis')!.body.translation().y < -1.5) : undefined;
    fallBlend = snap ? 0 : T.MathUtils.lerp(fallBlend, falling ? 1 : 0, 1 - Math.exp(-dt * 4));
    const target = followCamera.target.clone();
    if (falling) {
      const p = falling.rig.parts.get('pelvis')!.body.translation(); target.lerp(new T.Vector3(p.x, p.y + .25, p.z), fallBlend);
      // Watch from the side of the fall; otherwise the bridge supports hide the impact.
      const side = Math.sign(p.z) || Math.sign(camera.position.z) || 1;
      camera.position.x = T.MathUtils.lerp(camera.position.x, p.x - 2.5, fallBlend);
      camera.position.z = T.MathUtils.lerp(camera.position.z, p.z + side * 4.2, fallBlend);
      camera.position.y = T.MathUtils.lerp(camera.position.y, Math.max(-3.5, p.y + 3.6), fallBlend);
    }
    menuBlend = snap ? (presentingMenu ? 1 : 0) : T.MathUtils.lerp(menuBlend, presentingMenu ? 1 : 0, 1 - Math.exp(-dt * 3.5));
    if (menuBlend > .001) {
      const view = menuCameraPose(pelvisPosition, rivalPosition, player.heading, camera.aspect, menuTime, reducedMotion.matches);
      camera.position.lerp(view.position, menuBlend); target.lerp(view.target, menuBlend);
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      camera.setViewOffset(width, height, width * view.offsetX * menuBlend, height * view.offsetY * menuBlend, width, height);
    } else camera.clearViewOffset();
    camera.lookAt(target);
  }
  updateCamera(0, true);
  const hemi = new T.HemisphereLight('#ffffff', '#a9a6a0', 2.4);
  const sun = new T.DirectionalLight('#fff8e8', 3.2); sun.position.set(-3, 8, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: .1, far: 22 });
  sun.shadow.normalBias = .025; sun.shadow.bias = -.00015; scene.add(hemi, sun);
  const geometries: T.BufferGeometry[] = [], materials: T.Material[] = [];
  const pit = createPitArena(), yard = new T.Group(), bridge = pit.group; scene.add(yard, bridge); yard.visible = false;
  function material(color: string) { const m = new T.MeshStandardMaterial({ color, roughness: .92 }); materials.push(m); return m; }
  function box(w: number, h: number, d: number, x: number, y: number, z: number, m: T.Material, parent: T.Group = yard) {
    const geometry = new T.BoxGeometry(w, h, d); geometries.push(geometry); const mesh = new T.Mesh(geometry, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  const floorGeo = new T.PlaneGeometry(70, 70); geometries.push(floorGeo);
  const floor = new T.Mesh(floorGeo, material('#e9e7e0')); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; yard.add(floor);
  // One ground surface. The previous court box duplicated this plane at y=0.
  const border = material('#b7c3ce');
  for (const [x, z, w, d] of [[-3.7, 0, .16, 7.4], [3.7, 0, .16, 7.4], [0, -3.7, 7.4, .16], [0, 3.7, 7.4, .16]]) box(w, .44, d, x, .22, z, border);
  function floorStroke(points: number[][], color: string, opacity = 1, parent: T.Group = yard) {
    const g = new T.BufferGeometry().setFromPoints(points.map(vec)), m = new T.LineBasicMaterial({ color, transparent: true, opacity });
    geometries.push(g); materials.push(m); parent.add(new T.Line(g, m));
  }
  for (const radius of [2.85, 2.92]) floorStroke(Array.from({ length: 129 }, (_, i) => { const a = i / 128 * Math.PI * 2; return [Math.cos(a) * radius, .004, Math.sin(a) * radius]; }), '#afbdcb', .7);
  floorStroke([[-.18, .006, 0], [.18, .006, 0]], '#a5b4c3'); floorStroke([[0, .006, -.18], [0, .006, .18]], '#a5b4c3');
  for (const [x, color] of [[-1.05, '#d9252b'], [1.05, '#305ca8']] as const) floorStroke([[x, .006, -.35], [x, .006, .35]], color, .5);
  const trainingYard = createTrainingYard(scene);
  let tutorial: DuelTutorial | null = null;
  let duelOptions = { ...sim.options }, duelPractice = false;
  const lessonHeld = () => !!tutorial && ['great', 'complete'].includes(tutorial.step);
  const canControl = () => !paused && !suspended && !contextLost && !lessonHeld() && sim.phase === 'fighting';
  const weapons = createWeaponViews(scene, metalEnvironment.texture);
  const avatars = [createAvatar(scene, sim.fighters[0], '#d9252b'), createAvatar(scene, sim.fighters[1], '#305ca8')];
  const shadowGeo = new T.CircleGeometry(.35, 40); geometries.push(shadowGeo);
  const shadowMat = new T.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: {},
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 vUv; void main(){float d=length(vUv-.5)*2.; gl_FragColor=vec4(.18,.24,.31,.15*(1.-smoothstep(.05,1.,d)));}' }); materials.push(shadowMat);
  const shadows = sim.fighters.map(() => { const m = new T.Mesh(shadowGeo, shadowMat); m.rotation.x = -Math.PI / 2; m.scale.set(1.1, .75, 1); scene.add(m); return m; });
  const effects = createImpactEffects(scene);
  const impactLabels = createImpactLabels(host, camera);
  let lastAudioPhase: DuelPhase = sim.phase;
  let paused = false, suspended = false, contextLost = false, slow = false, muted = false, disposed = false, frameId = 0, accumulator = 0, statusClock = 0;
  let pointerLocked = false, lockPending = false, unlockRequested = false, nativeUnlock = false, ignoreMouseMove = false;
  let message = 'Sweep your sword. When you’re ready, begin the duel.', messageUntil = 0, hitStop = 0;
  const audio = createCombatAudio(camera);
  let kick = 0;
  const unlockAudio = () => audio.unlock();
  const footsteps = [0, 0], swingMotion = [0, 1].map(() => ({ last: -10, ready: true, angular: new T.Vector3() })), holders = sim.weapons.map(w => w.holder);
  let network: ReturnType<typeof createDuelNetwork> | undefined = undefined;
  function action(name: Action) { if (tutorial) return; if (network?.active) network.action(name); else if (name === 'rematch') reset(); else sim[name](); }
  function status() {
    const local = sim.localPlayerId, ordered = [sim.fighters[local], sim.fighters[1 - local]];
    const options = local === 0 ? { ...sim.options } : { ...sim.options,
      playerWeapon: sim.options.rivalWeapon, playerSkin: sim.options.rivalSkin,
      rivalWeapon: sim.options.playerWeapon, rivalSkin: sim.options.playerSkin };
    const labels = { ready: 'Ready', guard: 'Guarding', windup: 'Winding up', swing: 'Striking', recover: 'Recovering', stagger: 'Staggered', down: 'Down', unarmed: 'Unarmed', reaching: 'Reaching', fallen: 'Knocked down', rising: 'Getting up', hanging: 'Holding the edge', climbing: 'Climbing', falling: 'Falling' };
    const player = sim.fighters[sim.localPlayerId];
    const nearby = player.mode === 'upright' ? sim.nearbyWeapon(local) : null;
    const interaction = player.pickup ? 'Reaching for ' + weaponName(player.pickup).toLowerCase() + '…' : nearby ? held(player) ? 'G to drop · E to take ' + weaponName(nearby).toLowerCase() : 'E — pick up ' + weaponName(nearby).toLowerCase() : '';
    const guardDirection = player.guard ? Math.abs(player.aim.x) > .48 ? player.aim.x > 0 ? 'Left' : 'Right' : player.aim.y < -.25 ? 'Low' : 'High' : '';
    const prompt = player.mode === 'hanging' ? 'Hold E to climb. Your stamina is your grip. G lets go.' : player.mode === 'fallen' ? 'Hold E to get back up. Your weapon is on the ground.' : player.pickup ? 'Keep holding E. Reach the handle, then close your hand.' : !held(player) ? 'Move near a weapon and hold E to pick it up. F to shove.' : sim.options.ledgeDrill ? 'C chops down at the gripping hand. Step close enough to reach the edge.' : 'Find your distance. Meet their weapon, then counter.';
    onStatus({ tutorial: tutorial?.status ?? null, phase: sim.phase, interaction, guardDirection, network: network?.status ?? OFFLINE_STATUS, hp: ordered.map(f => Math.ceil(f.hp)), stamina: ordered.map(f => Math.round(f.stamina)), stagger: ordered.map(f => f.stagger), winner: sim.winner === null ? null : sim.winner === local ? 0 : 1, hits: sim.hits, blocks: sim.blocks, cuts: sim.cuts,
      states: ordered.map(f => f.counterTime > 0 && !f.down ? 'Counter ready' : f.wounds.length && !f.down ? 'Bleeding · ' + labels[f.state] : labels[f.state]),
      result: sim.winner === null ? '' : sim.fighters[1 - sim.winner].defeat,
      resultReady: sim.endedAt !== null && sim.time - sim.endedAt > 1.1, slow, paused, muted, practice: sim.practice, pointerLocked,
      options, disarms: sim.disarms, grips: ordered.map(f => hangingHand(f) ? Math.round(f.stamina) : held(f) ? Math.round((1 - f.gripStress) * 100) : 0),
      weapons: ordered.map(f => held(f) ? `${weaponName(f.weapon)} · ${supported(f) ? 'two hands' : f.mainHand + ' hand'}` : 'Empty hands'),
      message: sim.time < messageUntil ? message : sim.phase === 'finished' ? (sim.winner === local ? 'Your opponent is down.' : 'You’re down. Find your distance and try again.') : prompt });
  }
  const presentHit = (hit: import('./physics').DuelHit) => {
    if (!tutorial && hit.kind !== 'floor') pit.react(hit.kind === 'sever' || hit.kind === 'impale' ? 1 : hit.counter ? .9 : .55);
    audio.play(hit.kind === 'block' ? 'clash' : hit.kind === 'sever' || hit.kind === 'impale' ? 'cut' : hit.kind === 'floor' ? 'drop' : 'hit', hit.point, Math.min(1, .4 + hit.strength * .055));
    kick = Math.min(.035, hit.strength * .0018);
    if (hit.kind !== 'floor') {
      message = hit.kind === 'impale' ? `${hit.target === sim.localPlayerId ? 'You' : 'Rival'} hit the spikes.` : hit.kind === 'block' ? hit.counter ? hit.target === sim.localPlayerId ? 'Parried. Counter now.' : 'Your blade was parried. Recover your guard.' : 'Blades clashed. Find your stance.' : `${hit.target === sim.localPlayerId ? 'You' : 'Rival'} · ${hit.part} ${hit.kind === 'sever' ? 'severed' : 'hit'}`;
      messageUntil = sim.time + (hit.kind === 'sever' ? 2.5 : 1.1); hitStop = hit.kind === 'sever' ? .055 : hit.kind === 'hit' ? .032 : .022;
    }
    effects.hit(hit, !!tutorial); impactLabels.hit(hit, tutorial ? trainingImpactCaption(hit) : undefined);
    if (hit.kind === 'sever' || hit.kind === 'impale' || hit.damage >= 6 || hit.counter) audio.react(hit.kind === 'block' ? 'parry' : 'hit');
    status();
  };
  sim.onHit = hit => {
    tutorial?.contact(hit);
    if (lessonHeld()) { clearInput(); releaseMouse(); }
    presentHit(hit); network?.hit(hit);
  };
  network = createDuelNetwork(sim, { reset: options => reset(options, true), hit: presentHit, changed: status,
    canStartBot: () => !paused && !suspended && !contextLost,
    finished: result => { void import('./standings').then(s => s.recordOnlineResult(result)).catch(() => { /* The pending result is retained and retried from the leaderboard. */ }); },
  });
  const pendingSteer = new T.Vector2();
  function queueSteer(x: number, y: number) { if (tutorial?.step === 'move') return; tutorial?.steer(x, y); pendingSteer.add(new T.Vector2(x, y)).clampLength(0, 180); }
  const keys = new Set<string>(); let leftDown = false, rightDown = false, middleDown = false;
  const touchPoints = new Map<number, T.Vector2>();
  // Player-facing left/right is the opposite of the rig's local horizontal axis.
  function updateMove() { sim.input.move.set((keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0), (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0)); }
  function clearInput() { pendingSteer.set(0, 0); keys.clear(); touchPoints.clear(); leftDown = rightDown = middleDown = false; sim.clearInput(); }
  function reset(options: Partial<DuelOptions> = {}, fromNetwork = false) { if (network?.active && !fromNetwork) { network.action('rematch'); return; } clearInput(); swingMotion.forEach(m => { m.last = -10; m.ready = true; m.angular.set(0, 0, 0); }); sim.reset(options); presentingMenu = !tutorial && !network?.active && sim.phase === 'ready'; effects.reset(); impactLabels.reset(); weapons.reset(); accumulator = 0; paused = false; hitStop = 0; lastAudioPhase = sim.phase; avatars.forEach(a => a.resetTrail()); yard.visible = sim.options.arena === 'yard'; bridge.visible = !yard.visible; trainingYard.group.visible = !!tutorial; updateCamera(0, true); messageUntil = 0; status(); }
  function startTutorial() {
    if (network?.active) return;
    if (!tutorial) { duelOptions = { ...sim.options }; duelPractice = sim.practice; }
    releaseMouse(); sim.training = 'dummy'; sim.practice = false; slow = false;
    tutorial = new DuelTutorial(sim);
    reset({ arena: 'yard', playerWeapon: 'sword', rivalWeapon: 'sword', playerSkin: undefined, rivalSkin: undefined, spares: false, ledgeDrill: false });
    tutorial.begin(); status();
  }
  function retryTutorial() {
    if (!tutorial) return;
    const parry = ['parry', 'great', 'complete'].includes(tutorial.step);
    sim.training = parry ? 'parry' : 'dummy'; reset();
    tutorial = new DuelTutorial(sim); if (parry) tutorial.parry(); else tutorial.begin(); status();
  }
  function exitTutorial() {
    if (!tutorial) return;
    releaseMouse(); tutorial = null; sim.training = 'off'; sim.practice = duelPractice;
    reset(duelOptions);
  }
  function releaseMouse() {
    if (document.pointerLockElement === canvas) { unlockRequested = true; document.exitPointerLock(); }
  }
  function setPaused(v: boolean) { paused = v; audio.ambience(!tutorial && (!v || !!network?.active) && sim.phase === 'fighting', document.hidden); accumulator = 0; clearInput(); if (v) releaseMouse(); status(); }
  function lockError() {
    lockPending = false;
    if (disposed) return;
    message = 'Mouse capture unavailable. Hold and drag in the arena to swing; middle-drag to look.'; messageUntil = sim.time + 5; status();
  }
  function captureMouse() {
    if (paused || lessonHeld() || disposed || sim.phase === 'finished' || document.pointerLockElement || lockPending) return;
    if (!canvas.requestPointerLock) { lockError(); return; }
    lockPending = true;
    // Called only from a click/key gesture. Older browsers return void instead of a promise.
    try { void canvas.requestPointerLock()?.catch(lockError); } catch { lockError(); }
  }
  function captureMouseOnDesktop() { if (window.matchMedia('(pointer: fine)').matches) captureMouse(); }
  function lockChange() {
    const wasLocked = pointerLocked; pointerLocked = document.pointerLockElement === canvas; lockPending = false;
    ignoreMouseMove = true;
    if (pointerLocked) {
      nativeUnlock = false;
      if (disposed || paused || sim.phase === 'finished') releaseMouse();
    } else if (wasLocked) {
      clearInput();
      // Unlocking alone is not a menu request. Focus loss and browser chrome
      // can release pointer lock before the game receives a blur event.
      nativeUnlock = !unlockRequested;
      unlockRequested = false;
    }
    if (!disposed) status();
  }
  function keyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || (event.target as HTMLElement).closest('[role="dialog"]')) return;
    if ((event.target as HTMLElement).closest('input, textarea, select, [role="slider"], [role="combobox"], [role="listbox"], [role="option"]') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyQ', 'KeyE', 'KeyG', 'KeyF', 'Escape', 'Enter'].includes(event.code)) return;
    if ((event.target as HTMLElement).closest('button, a') && ['Space', 'Enter'].includes(event.code)) return;
    event.preventDefault(); unlockAudio();
    if (event.code === 'Escape' && !event.repeat) {
      nativeUnlock = false;
      if (!paused) setPaused(true);
      return;
    }
    if (event.code === 'KeyR' && !event.repeat) { if (tutorial) retryTutorial(); else reset(); return; }
    if (event.code === 'KeyQ' && !event.repeat && !network?.active) { slow = !slow; status(); return; }
    if (!canControl()) return;
    keys.add(event.code); updateMove();
    if (event.code === 'KeyE') { sim.input.interact = true; if (!event.repeat) action('pickup'); }
    if (event.repeat) return;
    if (event.code === 'Space') action('slash');
    if (event.code === 'KeyC') action('chop');
    if (event.code.startsWith('Shift')) action('lunge');
    if (event.code === 'KeyG') action('drop');
    if (event.code === 'KeyF') action('shove');
    if (event.code === 'Enter') { if (!network?.active) sim.start(); captureMouseOnDesktop(); }
  }
  function keyUp(event: KeyboardEvent) {
    // Some browsers consume Escape keydown to unlock, but still deliver keyup.
    if (event.code === 'Escape' && nativeUnlock) { nativeUnlock = false; if (!paused && document.hasFocus() && !document.hidden) setPaused(true); }
    keys.delete(event.code); if (event.code === 'KeyE') sim.input.interact = false; updateMove();
  }
  function setGuard(value: boolean) {
    if (value && !sim.input.guard) { pendingSteer.set(0, 0); sim.input.aim.set(.18, .8); }
    sim.input.guard = value;
  }
  function mouseDown(event: MouseEvent) {
    if (!canControl() || event.button > 2) return;
    event.preventDefault(); unlockAudio(); canvas.focus({ preventScroll: true }); captureMouse();
    if (tutorial?.step === 'move') return;
    if (event.button === 0) { leftDown = true; sim.input.attack = true; }
    if (event.button === 1) middleDown = true;
    if (event.button === 2) { rightDown = true; setGuard(true); }
  }
  function mouseMove(event: MouseEvent) {
    if (ignoreMouseMove) { ignoreMouseMove = false; return; }
    if (paused) return;
    if (middleDown) followCamera.look(event.movementX, event.movementY);
    else if (leftDown || rightDown) queueSteer(event.movementX, event.movementY);
  }
  function mouseUp(event: MouseEvent) {
    // Ignore compatibility mouse releases from touch controls and menu buttons.
    if (!leftDown && !rightDown && !middleDown) return;
    if (event.button === 0) leftDown = false;
    if (event.button === 1) middleDown = false;
    if (event.button === 2) rightDown = false;
    sim.input.attack = leftDown; sim.input.guard = rightDown;
  }
  function touchDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' || !canControl()) return;
    event.preventDefault(); unlockAudio(); canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
    touchPoints.set(event.pointerId, new T.Vector2(event.clientX, event.clientY));
    sim.input.attack = touchPoints.size === 1 && !sim.input.guard; middleDown = touchPoints.size > 1;
  }
  function touchMove(event: PointerEvent) {
    const previousPoint = touchPoints.get(event.pointerId); if (!previousPoint || paused) return;
    const dx = event.clientX - previousPoint.x, dy = event.clientY - previousPoint.y;
    if (touchPoints.size > 1) {
      const otherPoint = [...touchPoints].find(([id]) => id !== event.pointerId)![1];
      const oldDistance = previousPoint.distanceTo(otherPoint);
      previousPoint.set(event.clientX, event.clientY);
      followCamera.zoom((oldDistance - previousPoint.distanceTo(otherPoint)) * 3);
      followCamera.look(dx / touchPoints.size, dy / touchPoints.size);
    } else { queueSteer(dx, dy); previousPoint.set(event.clientX, event.clientY); }
  }
  function touchUp(event: PointerEvent) {
    if (!touchPoints.delete(event.pointerId)) return;
    sim.input.attack = false; middleDown = touchPoints.size > 1;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    if (!paused) followCamera.zoom(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1));
  }
  const contextMenu = (e: Event) => e.preventDefault();
  const suspend = () => { suspended = true; nativeUnlock = false; accumulator = 0; clearInput(); releaseMouse(); audio.ambience(false, document.hidden); status(); };
  const focus = () => { if (document.hidden || contextLost) return; suspended = false; nativeUnlock = false; accumulator = 0; status(); };
  const visibility = () => { if (document.hidden) suspend(); else if (document.hasFocus()) focus(); };
  const blur = suspend;
  // Mobile iframe fullscreen transitions may omit focus. Resume on a visible
  // viewport change or the next real gesture, without dismissing an explicit menu.
  const resumeGesture = (e: Event) => { if (e.isTrusted && suspended) focus(); };
  const fullscreen = () => { clearInput(); nativeUnlock = false; resize(); focus(); };
  const contextLoss = (e: Event) => { e.preventDefault(); contextLost = true; suspend(); message = 'Restoring the arena…'; messageUntil = Infinity; status(); };
  const contextRestored = () => { contextLost = false; messageUntil = 0; resize(); focus(); };
  canvas.addEventListener('mousedown', mouseDown); window.addEventListener('mousemove', mouseMove); window.addEventListener('mouseup', mouseUp);
  canvas.addEventListener('pointerdown', touchDown); canvas.addEventListener('pointermove', touchMove); canvas.addEventListener('pointerup', touchUp); canvas.addEventListener('pointercancel', touchUp); canvas.addEventListener('lostpointercapture', touchUp); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('contextmenu', contextMenu); canvas.addEventListener('webglcontextlost', contextLoss);
  window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', blur); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visibility); document.addEventListener('pointerlockchange', lockChange); document.addEventListener('pointerlockerror', lockError);
  document.addEventListener('pointerdown', resumeGesture, true); document.addEventListener('keydown', resumeGesture, true);
  document.addEventListener('fullscreenchange', fullscreen); document.addEventListener('webkitfullscreenchange', fullscreen);
  window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  const cuePoint = new T.Vector3(), cueRival = new T.Vector3();
  function positionTutorialCue() {
    const width = host.clientWidth, height = host.clientHeight;
    cuePoint.copy(sim.fighters[0].rig.parts.get('head')!.body.translation()).project(camera);
    cueRival.copy(sim.fighters[1].rig.parts.get('head')!.body.translation()).project(camera);
    const playerX = (cuePoint.x * .5 + .5) * width, rivalX = (cueRival.x * .5 + .5) * width;
    const x = T.MathUtils.clamp(Math.max(playerX + 130, rivalX + 110), 110, width - 115);
    const y = T.MathUtils.clamp((-cuePoint.y * .5 + .5) * height - 35, 115, height - 210);
    host.parentElement?.style.setProperty('--cue-x', x.toFixed(1) + 'px');
    host.parentElement?.style.setProperty('--cue-y', y.toFixed(1) + 'px');
  }
  function render() {
    sim.fighters.forEach((f, i) => { avatars[i].update(f); avatars[i].setVisible(i !== 1 || !tutorial); const p = f.rig.parts.get('pelvis')!.body.translation(); shadows[i].position.set(p.x, .007, p.z); shadows[i].visible = p.y > 0 && onPlatform(sim.options.arena, p); });
    trainingYard.update(sim.fighters[1], !!tutorial);
    weapons.update(sim.weapons, !held(sim.fighters[sim.localPlayerId]) ? sim.fighters[sim.localPlayerId].pickup?.id ?? sim.nearbyWeapon()?.id : undefined);
    if (tutorial) positionTutorialCue();
    renderer.render(scene, camera);
  }
  function resize() {
    if (disposed || contextLost) return;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h); camera.aspect = w / h; camera.fov = w < 650 ? 64 : 50; camera.updateProjectionMatrix(); render();
    if (suspended && (document.hasFocus() || window.matchMedia('(pointer: coarse)').matches)) focus();
  }
  const observer = new ResizeObserver(resize); observer.observe(host);
  let previous = performance.now();
  function frame(now: number) {
    if (disposed) return;
    if ((paused || suspended) && !network?.active) { previous = now; frameId = requestAnimationFrame(frame); return; }
    const elapsed = Math.min((now - previous) / 1000, .05); previous = now;
    if (bridge.visible) pit.update(elapsed, !reducedMotion.matches);
    presentingMenu = !tutorial && !network?.active && sim.phase === 'ready';
    sim.idleMotion = presentingMenu && !reducedMotion.matches;
    if (presentingMenu) menuTime += elapsed;
    const dt = elapsed * (slow ? .25 : 1);
    tutorial?.present(elapsed);
    const handling = sim.fighters[sim.localPlayerId].weapon.spec.kind;
    const response = handling === 'mace' ? .048 : handling === 'greatsword' ? .038 : .018;
    const steering = pendingSteer.clone().multiplyScalar(1 - Math.exp(-elapsed / response));
    steerWeapon(sim.input.aim, steering.x, steering.y); pendingSteer.sub(steering);
    const networkBefore = sim.time; network?.render();
    if (network?.active) effects.update(Math.min(.05, Math.max(0, sim.time - networkBefore)) || elapsed, sim.fighters, sim.time, sim.options.arena);
    if (!network?.active && !paused && !document.hidden) {
      const before = sim.time;
      if (hitStop > 0) hitStop -= elapsed;
      else { accumulator += dt; let steps = 0; while (accumulator >= STEP && steps++ < 8) { if (!lessonHeld()) { tutorial?.tick(); sim.step(); } accumulator -= STEP;
        if (tutorial?.needsParrySetup) { clearInput(); tutorial.parry(); status(); } } }
      effects.update(lessonHeld() ? elapsed : Math.max(0, sim.time - before), sim.fighters, sim.time, sim.options.arena);
    }
    if (!paused || network?.active) {
      for (const f of sim.fighters) {
        const motion = swingMotion[f.id], angular = new T.Vector3().copy(f.sword.angvel());
        const speed = angular.length() * f.weapon.spec.reach;
        if (speed < 1.5 || angular.dot(motion.angular) < 0) motion.ready = true;
        if (held(f) && f.state === 'swing' && speed > 2 && motion.ready && sim.time - motion.last > .22) {
          audio.swing(f.sword.translation(), f.weapon.spec.kind, speed); audio.react('attack'); motion.last = sim.time; motion.ready = false;
        }
        motion.angular.copy(angular);
        if (f.stepping < 0 && footsteps[f.id] > 0 && f.mode === 'upright') audio.play('step', f.position, .16);
        footsteps[f.id] = f.stepping + 1;
      }
      sim.weapons.forEach((w, i) => { if (holders[i] !== null && w.holder === null) audio.play('drop', w.body.translation(), .3); holders[i] = w.holder; });
    }
    if (sim.phase === 'finished' && document.pointerLockElement === canvas) { clearInput(); releaseMouse(); }
    if (sim.phase === 'finished' && lastAudioPhase !== 'finished') audio.react('finish');
    lastAudioPhase = sim.phase;
    audio.ambience(!tutorial && !suspended && (!paused || !!network?.active) && sim.phase === 'fighting', document.hidden);
    updateCamera(elapsed);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) { camera.translateY(kick * Math.sin(now * .09)); camera.rotateZ(kick * .2); }
    kick *= Math.exp(-elapsed * 24); render(); impactLabels.update(elapsed, host.clientWidth, host.clientHeight, sim.fighters); statusClock += elapsed;
    if (statusClock > .09) { statusClock = 0; status(); }
    frameId = requestAnimationFrame(frame);
  }
  resize(); status(); frameId = requestAnimationFrame(frame);
  return {
    startTutorial, retryTutorial, exitTutorial,
    attack(v) { if (canControl() && tutorial?.step !== 'move') { unlockAudio(); sim.input.attack = v; } },
    steer(x, y) { if (canControl()) queueSteer(x, y); },
    joinOnline() { exitTutorial(); unlockAudio(); clearInput(); slow = paused = false; releaseMouse(); void network?.join(); },
    leaveOnline() { releaseMouse(); network?.leave(); },
    start() { exitTutorial(); unlockAudio(); if (!network?.active) sim.start(); canvas.focus({ preventScroll: true }); captureMouseOnDesktop(); status(); }, reset, captureMouse,
    slash() { if (!paused) { unlockAudio(); action('slash'); } }, chop() { if (!paused) { unlockAudio(); action('chop'); } }, lunge() { if (!paused) action('lunge'); },
    guard(v) { if (canControl()) setGuard(v); }, move(x, y) { if (canControl()) sim.input.move.set(-x, y); },
    setPaused(v) { setPaused(v); if (!v) { canvas.focus({ preventScroll: true }); if (sim.phase === 'fighting') captureMouseOnDesktop(); } }, setSlow(v) { slow = !network?.active && v; status(); }, setMuted(v) { muted = v; audio.mute(v); if (!v) unlockAudio(); status(); },
    setVolume(channel, value) { unlockAudio(); audio.volume(channel, value); },
    setPractice(v) { if (!network?.active) { sim.practice = v; reset(); } },
    configure(options) { if (network?.active || tutorial) return; releaseMouse(); reset({ ledgeDrill: false, ...options }); },
    ledgeDrill() { if (network?.active) return; releaseMouse(); sim.practice = true; reset({ arena: 'bridge', ledgeDrill: true }); },
    interact(v) { if (!paused) { sim.input.interact = v; if (v) action('pickup'); } }, drop() { if (!paused) action('drop'); }, shove() { if (!paused) action('shove'); },
    dispose() {
      disposed = true; network?.dispose(); cancelAnimationFrame(frameId); clearInput(); observer.disconnect(); releaseMouse();
      canvas.removeEventListener('mousedown', mouseDown); window.removeEventListener('mousemove', mouseMove); window.removeEventListener('mouseup', mouseUp);
      canvas.removeEventListener('pointerdown', touchDown); canvas.removeEventListener('pointermove', touchMove); canvas.removeEventListener('pointerup', touchUp); canvas.removeEventListener('pointercancel', touchUp); canvas.removeEventListener('lostpointercapture', touchUp); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('contextmenu', contextMenu); canvas.removeEventListener('webglcontextlost', contextLoss);
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('pointerlockchange', lockChange); document.removeEventListener('pointerlockerror', lockError);
      document.removeEventListener('pointerdown', resumeGesture, true); document.removeEventListener('keydown', resumeGesture, true);
      document.removeEventListener('fullscreenchange', fullscreen); document.removeEventListener('webkitfullscreenchange', fullscreen);
      window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      trainingYard.dispose(); pit.dispose(); avatars.forEach(a => a.dispose()); effects.dispose(); weapons.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
      audio.dispose(); impactLabels.dispose(); metalEnvironment.dispose(); renderer.dispose(); canvas.remove(); sim.dispose();
    },
  };
}
