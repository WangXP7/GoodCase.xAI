import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { RigSimulation, STEP, initPhysics, type TargetName, type PoseName, type CatchPhase } from './physics';
import { vec } from './ik';
import { handPaths } from './hand';

export type Mode = 'throw' | 'pose' | 'view';
export type PlaygroundStatus = { hits: number; balls: number; message: string; catchPhase: CatchPhase };
export type PlaygroundAPI = {
  setMode(mode: Mode): void; setPose(pose: PoseName): void;
  setStrength(strength: number): void; setPower(power: number): void;
  setSlow(slow: boolean): void; setPaused(paused: boolean): void;
  setRagdoll(ragdoll: boolean): void; hitArm(): void; dropBalls(): void;
  catchPass(): void; throwHeld(): void;
  reset(): void; dispose(): void;
};

export async function createPlayground(host: HTMLElement, onStatus: (status: PlaygroundStatus) => void): Promise<PlaygroundAPI> {
  await initPhysics();
  const sim = new RigSimulation();
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
  renderer.domElement.setAttribute('aria-label', 'Interactive stick character. Click to throw balls. Switch to Pose to drag hand and foot targets.');
  renderer.domElement.setAttribute('role', 'img'); host.appendChild(renderer.domElement);
  const scene = new T.Scene(); scene.background = new T.Color('#eef1f5'); scene.fog = new T.Fog('#eef1f5', 12, 27);
  const camera = new T.PerspectiveCamera(37, 1, .05, 70); camera.position.set(3.3, 2.7, 5.2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.03, 0); controls.enableDamping = true; controls.dampingFactor = .09;
  controls.minDistance = 3; controls.maxDistance = 10; controls.minPolarAngle = .3; controls.maxPolarAngle = Math.PI * .48; controls.enablePan = false;
  controls.mouseButtons = { LEFT: undefined as unknown as T.MOUSE, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };
  controls.touches = { ONE: undefined as unknown as T.TOUCH, TWO: T.TOUCH.DOLLY_ROTATE }; controls.update();
  const hemi = new T.HemisphereLight('#ffffff', '#b2bed1', 2.4);
  const sun = new T.DirectionalLight('#fff6e7', 3.3); sun.position.set(-3, 7, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: .5, far: 20 });
  sun.shadow.normalBias = .025; sun.shadow.bias = -.0002;
  const fill = new T.DirectionalLight('#bdd8ff', 1.5); fill.position.set(4, 3, -4); scene.add(hemi, sun, fill);
  // Match the head's .012-wide silhouette with flat strokes throughout the rig.
  // Line2 preserves a round, unlit mark while its path moves through 3D space.
  const strokeColor = '#d9252b';
  // Use the late render queue even for opaque ink, so the translucent court grid
  // is already drawn. Coverage handles antialiasing without alpha blending.
  const strokeMat = new LineMaterial({ color: strokeColor, linewidth: .012, worldUnits: true, alphaToCoverage: true, toneMapped: false, depthWrite: false, transparent: true, blending: T.NoBlending });
  const face = new T.MeshStandardMaterial({ color: '#fffaf0', roughness: .9 });
  const faceInk = new T.MeshBasicMaterial({ color: '#37312b' });
  const outline = new T.MeshBasicMaterial({ color: strokeColor, side: T.BackSide, toneMapped: false });
  const ballMat = new T.MeshStandardMaterial({ color: '#e57528', roughness: .8 });
  const seamMat = new T.MeshStandardMaterial({ color: '#703915', roughness: 1 });
  const handleMat = new T.MeshBasicMaterial({ color: '#3076ef', transparent: true, opacity: .8, depthTest: false });
  const ghostMat = new T.LineBasicMaterial({ color: '#3076ef', transparent: true, opacity: .45, depthTest: false });
  const sphereGeo = new T.SphereGeometry(1, 24, 16), cylinderGeo = new T.CylinderGeometry(1, 1, 1, 16);
  const resources: T.BufferGeometry[] = [sphereGeo, cylinderGeo];
  function sphere(parent: T.Object3D, radius: number, material: T.Material, position = new T.Vector3()) {
    const mesh = new T.Mesh(sphereGeo, material); mesh.scale.setScalar(radius); mesh.position.copy(position); mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  function capsule(parent: T.Object3D, a: T.Vector3, b: T.Vector3, radius: number, material: T.Material) {
    const mesh = new T.Mesh(cylinderGeo, material); mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.scale.set(radius, a.distanceTo(b), radius);
    mesh.quaternion.setFromUnitVectors(vec([0, 1, 0]), b.clone().sub(a).normalize()); mesh.castShadow = true; parent.add(mesh);
    sphere(parent, radius, material, a); sphere(parent, radius, material, b);
  }
  function stroke(parent: T.Object3D, points: number[][]) {
    const geometry = new LineGeometry().setPositions(points.flat()); resources.push(geometry);
    const line = new Line2(geometry, strokeMat);
    // Draw ink after solid objects, testing their depth but not fighting adjacent
    // ink caps for depth. This removes the pale rings at polyline joins.
    line.renderOrder = 1; parent.add(line); return line;
  }
  const handDrawings = new Map<'left' | 'right', { lines: Line2[]; curl: number }>();
  function drawHand(parent: T.Object3D, side: 'left' | 'right') {
    const paths = handPaths(0, side);
    stroke(parent, paths.stem.map(p => p.toArray()));
    handDrawings.set(side, { lines: paths.fingers.map(points => stroke(parent, points.map(p => p.toArray()))), curl: 0 });
  }
  const floor = new T.Mesh(new T.PlaneGeometry(80, 80), new T.MeshStandardMaterial({ color: '#eef1f5', roughness: .94 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor); resources.push(floor.geometry);
  const grid = new T.GridHelper(10, 20, '#c6cfdc', '#dce2e9'); grid.position.y = .003;
  (grid.material as T.Material).transparent = true; (grid.material as T.Material).opacity = .5; scene.add(grid);
  function floorLine(points: number[][], color = '#c0cad8') {
    const geo = new T.BufferGeometry().setFromPoints(points.map(p => vec(p))); resources.push(geo);
    scene.add(new T.Line(geo, new T.LineBasicMaterial({ color })));
  }
  floorLine(Array.from({ length: 97 }, (_, i) => { const a = i / 96 * Math.PI * 2; return [Math.cos(a) * 1.6, .006, Math.sin(a) * 1.6]; }), '#b4c1d2');
  floorLine([[-5, .006, -5], [5, .006, -5], [5, .006, 5], [-5, .006, 5], [-5, .006, -5]]);
  const curbMat = new T.MeshStandardMaterial({ color: '#dae1eb', roughness: .7 });
  for (const [x, z, sx, sz] of [[-5, 0, .24, 10], [5, 0, .24, 10], [0, -5, 10, .24], [0, 5, 10, .24]]) {
    const geo = new T.BoxGeometry(sx, .26, sz); resources.push(geo); const mesh = new T.Mesh(geo, curbMat);
    mesh.position.set(x, .13, z); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
  }
  const meshes = new Map<string, T.Group>(), pickables: T.Object3D[] = [];
  for (const part of sim.parts.values()) {
    const group = new T.Group(); group.userData.part = part.name; scene.add(group); meshes.set(part.name, group);
    if (part.shape === 'head') {
      sphere(group, .237, outline).castShadow = false; sphere(group, .225, face);
      for (const sign of [-1, 1]) {
        sphere(group, .014, faceInk, vec([sign * .076, .021, .208])).scale.y = .018;
        capsule(group, vec([sign * .042, .077, .207]), vec([sign * .112, .084, .185]), .009, faceInk);
      }
      capsule(group, vec([-.028, -.071, .212]), vec([.026, -.064, .214]), .007, faceInk);
      stroke(group, Array.from({ length: 65 }, (_, i) => { const a = i / 64 * Math.PI * 2; return [Math.cos(a) * .191, .121, Math.sin(a) * .191]; }));
      stroke(group, [[-.075, .13, -.18], [-.094, .075, -.24], [-.12, .02, -.27]]);
    } else if (part.shape === 'hand') {
      drawHand(group, part.name.startsWith('left') ? 'left' : 'right');
    } else if (part.shape === 'foot') {
      stroke(group, [[0, 0, -.08], [0, -.054, -.08], [0, -.06, -.035], [0, -.06, .12]]);
    } else {
      stroke(group, [[0, -part.length / 2, 0], [0, part.length / 2, 0]]);
      if (part.name === 'chest') {
        stroke(group, [[-.21, part.length / 2, 0], [.21, part.length / 2, 0]]);
        stroke(group, [[0, part.length / 2, 0], [0, part.length / 2 + .11, 0]]);
      }
    }
    pickables.push(group);
  }
  const ballMeshes = new Map<number, T.Group>();
  const ballSeamGeo = new T.TorusGeometry(.146, .003, 5, 48); resources.push(ballSeamGeo);
  const handleGeo = new T.TorusGeometry(.10, .007, 8, 40), handleHitGeo = new T.SphereGeometry(.14, 12, 8);
  resources.push(handleGeo, handleHitGeo);
  const handleHitMat = new T.MeshBasicMaterial({ visible: false });
  const handles = new Map<TargetName, T.Group>(), handleLines = new Map<TargetName, T.Line>();
  for (const name of Object.keys(sim.targets) as TargetName[]) {
    const group = new T.Group(); group.userData.target = name;
    const ring = new T.Mesh(handleGeo, handleMat); ring.renderOrder = 20; group.add(ring, new T.Mesh(handleHitGeo, handleHitMat)); scene.add(group); handles.set(name, group);
    const geo = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]); resources.push(geo);
    const line = new T.Line(geo, ghostMat); line.renderOrder = 19; scene.add(line); handleLines.set(name, line);
  }
  const impacts: { mesh: T.Mesh; life: number }[] = [];
  const impactGeo = new T.TorusGeometry(.13, .009, 6, 24); resources.push(impactGeo);
  let mode: Mode = 'throw', power = 11, slow = false, paused = false, disposed = false;
  let lastMessage = 'Click the character to throw a ball.', statusClock = 0, frameId = 0;
  const catchMessages: Record<CatchPhase, string> = {
    idle: '', reaching: 'Reaching · opening the hand for a pass.', incoming: 'Catch · watch for contact with the palm.',
    holding: 'Holding · fingers closed. Move the hand in Pose, or throw the ball.', windup: 'Throw · drawing the arm back.',
    throwing: 'Throw · opening the fingers and releasing.', released: 'Released · the ball is flying freely. Catch another pass to repeat.',
    missed: 'Missed the pass. Try again with firmer muscles or a fresh reset.',
  };
  const status = () => onStatus({ hits: sim.hits, balls: sim.balls.length, catchPhase: sim.catchPhase, message: catchMessages[sim.catchPhase] || lastMessage });
  sim.onHit = hit => {
    lastMessage = `Impact · ${hit.name}`; status();
    const material = new T.MeshBasicMaterial({ color: '#f08a39', transparent: true, depthTest: false });
    const mesh = new T.Mesh(impactGeo, material); mesh.position.copy(hit.position); mesh.renderOrder = 25; scene.add(mesh); impacts.push({ mesh, life: .4 });
  };
  const raycaster = new T.Raycaster(), pointer = new T.Vector2(), dragPlane = new T.Plane();
  // Keep thin strokes easy to aim at without making the drawing heavier.
  Object.assign(raycaster.params, { Line2: { threshold: .065 } });
  let dragging: TargetName | null = null, startPointer: { x: number; y: number } | null = null;
  function ray(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    startPointer = { x: event.clientX, y: event.clientY }; ray(event);
    if (mode !== 'pose' || sim.ragdoll) return;
    const hits = raycaster.intersectObjects([...handles.values()], true); if (!hits.length) return;
    let parent: T.Object3D | null = hits[0].object;
    while (parent && !parent.userData.target) parent = parent.parent;
    if (!parent) return;
    dragging = parent.userData.target as TargetName;
    dragPlane.setFromNormalAndCoplanarPoint(dragging.endsWith('Foot') ? vec([0, 1, 0]) : camera.getWorldDirection(new T.Vector3()), sim.targets[dragging]);
    renderer.domElement.setPointerCapture(event.pointerId); controls.enabled = false; host.style.cursor = 'grabbing';
  }
  function pointerMove(event: PointerEvent) {
    ray(event);
    if (dragging) { const point = raycaster.ray.intersectPlane(dragPlane, new T.Vector3()); if (point) sim.setTarget(dragging, point); return; }
    if (mode === 'pose') host.style.cursor = raycaster.intersectObjects([...handles.values()], true).length ? 'grab' : 'default';
  }
  function pointerUp(event: PointerEvent) {
    if (dragging) {
      dragging = null; controls.enabled = true; host.style.cursor = 'grab';
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      startPointer = null; return;
    }
    if (mode === 'throw' && startPointer && Math.hypot(event.clientX - startPointer.x, event.clientY - startPointer.y) < 7 && !paused) {
      ray(event); const hits = raycaster.intersectObjects(pickables, true);
      const target = hits[0]?.point ?? raycaster.ray.intersectPlane(new T.Plane(vec([0, 0, 1]), 0), new T.Vector3());
      if (target) { sim.launchAt(target, camera.position.clone().addScaledVector(raycaster.ray.direction, .65), power); status(); }
    }
    startPointer = null;
  }
  function cancelPointer() { dragging = null; startPointer = null; controls.enabled = true; }
  renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp); renderer.domElement.addEventListener('pointercancel', cancelPointer);
  const contextLoss = (event: Event) => { event.preventDefault(); paused = true; lastMessage = 'The 3D view stopped. Reload the page to restart.'; status(); };
  renderer.domElement.addEventListener('webglcontextlost', contextLoss);
  function render() {
    for (const [name, mesh] of meshes) { const part = sim.parts.get(name)!; mesh.position.copy(part.body.translation()); mesh.quaternion.copy(part.body.rotation()).multiply(part.visualRotation); }
    for (const [side, drawing] of handDrawings) {
      if (Math.abs(drawing.curl - sim.fingerCurl[side]) < .00001) continue;
      drawing.curl = sim.fingerCurl[side];
      handPaths(drawing.curl, side).fingers.forEach((points, i) => drawing.lines[i].geometry.setPositions(points.flatMap(p => p.toArray())));
    }
    for (const [id, mesh] of ballMeshes) if (!sim.balls.some(ball => ball.id === id)) { scene.remove(mesh); ballMeshes.delete(id); }
    for (const ball of sim.balls) {
      let mesh = ballMeshes.get(ball.id);
      if (!mesh) {
        mesh = new T.Group(); sphere(mesh, ball.radius, ballMat);
        for (const rot of [[0, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0]]) { const seam = new T.Mesh(ballSeamGeo, seamMat); seam.rotation.set(rot[0], rot[1], rot[2]); mesh.add(seam); }
        scene.add(mesh); ballMeshes.set(ball.id, mesh);
      }
      mesh.position.copy(ball.body.translation()); mesh.quaternion.copy(ball.body.rotation());
    }
    for (const [name, handle] of handles) {
      handle.visible = mode === 'pose' && !sim.ragdoll; handle.position.copy(sim.targets[name]); handle.quaternion.copy(camera.quaternion);
      const side = name.startsWith('left') ? 'left' : 'right';
      const part = sim.parts.get(`${side} ${name.endsWith('Hand') ? 'forearm' : 'foot'}`)!;
      const end = name.endsWith('Hand') ? sim.wristPoint(side) : vec(part.body.translation());
      const line = handleLines.get(name)!; line.visible = handle.visible; line.geometry.setFromPoints([end, sim.targets[name]]);
    }
    renderer.render(scene, camera);
  }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.fov = w < 500 ? 46 : 37; camera.updateProjectionMatrix(); render();
  }
  const observer = new ResizeObserver(resize); observer.observe(host);
  let previous = performance.now(), accumulator = 0;
  function frame(now: number) {
    if (disposed) return;
    const elapsed = Math.min((now - previous) / 1000, .06); previous = now;
    if (!paused && !document.hidden) { accumulator += elapsed * (slow ? .25 : 1); while (accumulator >= STEP) { sim.step(); accumulator -= STEP; } }
    for (let i = impacts.length - 1; i >= 0; i--) {
      const effect = impacts[i]; if (!paused) effect.life -= elapsed * (slow ? .25 : 1);
      effect.mesh.quaternion.copy(camera.quaternion); effect.mesh.scale.setScalar(1 + (.4 - effect.life) * 3);
      (effect.mesh.material as T.MeshBasicMaterial).opacity = Math.max(0, effect.life / .4);
      if (effect.life <= 0) { scene.remove(effect.mesh); (effect.mesh.material as T.Material).dispose(); impacts.splice(i, 1); }
    }
    controls.update(); render(); statusClock += elapsed;
    if (statusClock > .4) { status(); statusClock = 0; }
    frameId = requestAnimationFrame(frame);
  }
  function seedBalls() { sim.spawnBall(vec([-1.2, .35, .65])); sim.spawnBall(vec([1.4, .2, -.45])); sim.spawnBall(vec([.8, .5, 1.1])); }
  function setMode(value: Mode) {
    mode = value; cancelPointer(); controls.mouseButtons.LEFT = mode === 'view' ? T.MOUSE.ROTATE : undefined as unknown as T.MOUSE;
    controls.touches.ONE = mode === 'view' ? T.TOUCH.ROTATE : undefined as unknown as T.TOUCH;
    host.style.cursor = mode === 'throw' ? 'crosshair' : 'grab';
    lastMessage = mode === 'throw' ? 'Click the character to throw a ball.' : mode === 'pose' ? 'Drag blue hand targets. Foot targets slide along the floor.' : 'Drag to orbit. Scroll or pinch to zoom.'; status();
  }
  for (let i = 0; i < 180; i++) sim.step();
  seedBalls(); setMode('throw'); resize(); frameId = requestAnimationFrame(frame);
  return {
    setMode,
    setPose(pose) { sim.setPose(pose); lastMessage = `${pose[0].toUpperCase()}${pose.slice(1)} pose`; status(); },
    setStrength(value) { sim.strength = value; }, setPower(value) { power = value; },
    setSlow(value) { slow = value; }, setPaused(value) { paused = value; accumulator = 0; },
    setRagdoll(value) { sim.ragdoll = value; if (value) sim.cancelCatch(); lastMessage = value ? 'Muscles released. Joint limits remain active.' : 'Assisted balance is pulling the character back into its pose.'; status(); },
    catchPass() { if (!paused) { sim.startCatch(); status(); } },
    throwHeld() { if (!paused) { sim.throwHeld(power * .7); status(); } },
    hitArm() { if (!paused) { sim.hitArm(); lastMessage = 'Incoming · right arm'; status(); } },
    dropBalls() { if (!paused) { for (let i = 0; i < 8; i++) sim.spawnBall(vec([(Math.random() - .5) * 2.8, 3 + Math.random() * 1.6, (Math.random() - .5) * 1.7])); status(); } },
    reset() { sim.reset(); seedBalls(); accumulator = 0; for (const effect of impacts) { scene.remove(effect.mesh); (effect.mesh.material as T.Material).dispose(); } impacts.length = 0; lastMessage = 'Fresh start. Aim for an arm.'; status(); },
    dispose() {
      disposed = true; cancelAnimationFrame(frameId); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointermove', pointerMove); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('pointercancel', cancelPointer); renderer.domElement.removeEventListener('webglcontextlost', contextLoss);
      const materials = new Set<T.Material>();
      scene.traverse(obj => { if (obj instanceof T.Mesh || obj instanceof T.Line) { (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => materials.add(m)); } });
      materials.forEach(m => m.dispose()); resources.forEach(g => g.dispose()); grid.geometry.dispose(); renderer.dispose(); renderer.domElement.remove(); sim.dispose();
    },
  };
}
