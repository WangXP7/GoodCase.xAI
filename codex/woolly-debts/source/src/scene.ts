import * as THREE from "three";
import type { HammerDefinition, SheepDefinition, SmashResult } from "./types";

export interface SheepEntity {
  id: number;
  definition: SheepDefinition;
  group: THREE.Group;
  bodyMaterial: THREE.MeshStandardMaterial;
  hp: number;
  maxHp: number;
  speed: number;
  target: THREE.Vector3;
  bornAt: number;
  lastHitAt: number;
  hitBar: THREE.Group;
  hitFill: THREE.Mesh;
  alive: boolean;
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: number;
}

interface CoinPickup {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  value: number;
  age: number;
}

const WOOL_GEOMETRY = new THREE.SphereGeometry(0.42, 12, 9);
const EYE_GEOMETRY = new THREE.SphereGeometry(0.075, 10, 8);
const LEG_GEOMETRY = new THREE.CylinderGeometry(0.09, 0.11, 0.48, 8);
const COIN_GEOMETRY = new THREE.CylinderGeometry(0.12, 0.12, 0.035, 12);
const DEBRIS_GEOMETRY = new THREE.TetrahedronGeometry(0.1, 0);

function material(color: number, roughness = 0.72, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function cast(mesh: THREE.Object3D): void {
  mesh.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function roundedBox(width: number, height: number, depth: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth, 2, 2, 2), material(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 80);
  readonly sheep: SheepEntity[] = [];
  hovered: SheepEntity | null = null;
  onHoverChange?: (entity: SheepEntity | null) => void;
  onPointerDown?: () => void;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(3, 3);
  private readonly pointerWorld = new THREE.Vector3();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.03);
  private readonly hammer = new THREE.Group();
  private readonly hammerHead = new THREE.Group();
  private readonly hammerTrail: THREE.Mesh;
  private readonly particles: Particle[] = [];
  private readonly pickups: CoinPickup[] = [];
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private nextId = 1;
  private lastTime = 0;
  private hammerSwing = 0;
  private shake = 0;
  private disposed = false;
  private reducedMotion = false;
  private allowScreenShake = true;
  private pointerInside = false;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.id = "game-canvas";
    this.renderer.domElement.setAttribute("aria-label", "肥羊砸罐游戏桌面");
    this.host.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x120e0c);
    this.scene.fog = new THREE.FogExp2(0x140e0b, 0.027);
    this.camera.position.set(0, 9.8, 8.8);
    this.camera.lookAt(0, 0.25, 0);

    this.createLighting();
    this.createDesk();
    this.createProps();
    this.createHammer();
    this.hammerTrail = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.64, 24, 1, 0, Math.PI * 1.22),
      new THREE.MeshBasicMaterial({ color: 0xffdf8d, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    this.hammerTrail.rotation.x = -Math.PI / 2;
    this.hammerTrail.position.y = 0.08;
    this.scene.add(this.hammerTrail);

    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerleave", this.handlePointerLeave);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    this.frame = requestAnimationFrame(this.animate);
  }

  setMotionPreferences(reduced: boolean, screenShake: boolean): void {
    this.reducedMotion = reduced;
    this.allowScreenShake = screenShake;
  }

  private createLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0xffead1, 0x1a1010, 1.2));
    const key = new THREE.SpotLight(0xffc77c, 58, 28, Math.PI / 4.5, 0.55, 1.2);
    key.position.set(-5.2, 8, 4.6);
    key.target.position.set(-0.7, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.bias = -0.0003;
    this.scene.add(key, key.target);
    const cool = new THREE.DirectionalLight(0x7598b5, 1.25);
    cool.position.set(6, 5, -4);
    this.scene.add(cool);
  }

  private createDesk(): void {
    const desk = new THREE.Mesh(new THREE.BoxGeometry(15, 0.55, 9.8), material(0x4a2718, 0.86));
    desk.position.y = -0.34;
    desk.receiveShadow = true;
    this.scene.add(desk);

    const grainMaterial = new THREE.MeshBasicMaterial({ color: 0x7c4328, transparent: true, opacity: 0.25 });
    for (let i = 0; i < 24; i += 1) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.018 + Math.random() * 0.028, 0.006, 7 + Math.random() * 2), grainMaterial);
      line.position.set(-7 + Math.random() * 14, -0.048, -4 + Math.random() * 8);
      line.rotation.y = (Math.random() - 0.5) * 0.05;
      this.scene.add(line);
    }

    const back = new THREE.Mesh(new THREE.PlaneGeometry(24, 13), material(0x211611));
    back.position.set(0, 4.2, -5);
    this.scene.add(back);
  }

  private createProps(): void {
    const paperMaterial = material(0xd9caa9, 0.94);
    for (let i = 0; i < 4; i += 1) {
      const paper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.025, 1.4), paperMaterial);
      paper.position.set(4.8 + i * 0.07, 0.03 + i * 0.025, -2.6 + i * 0.04);
      paper.rotation.y = -0.18 + i * 0.025;
      paper.receiveShadow = true;
      this.scene.add(paper);
    }
    for (let i = 0; i < 6; i += 1) {
      const ink = new THREE.Mesh(new THREE.BoxGeometry(1.2 - i * 0.07, 0.008, 0.025), new THREE.MeshBasicMaterial({ color: 0x6d6156 }));
      ink.position.set(4.78, 0.15, -2.9 + i * 0.16);
      ink.rotation.y = -0.18;
      this.scene.add(ink);
    }

    const calculator = roundedBox(1.5, 0.22, 2.05, 0x282b2b);
    calculator.position.set(-5.15, 0.13, -2.65);
    calculator.rotation.y = 0.15;
    this.scene.add(calculator);
    const display = roundedBox(1.05, 0.025, 0.38, 0x8c9c7c);
    display.position.set(-5.1, 0.265, -3.2);
    display.rotation.y = 0.15;
    this.scene.add(display);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const key = roundedBox(0.25, 0.05, 0.22, row === 3 ? 0xc08438 : 0x59605e);
        key.position.set(-5.55 + col * 0.42, 0.285, -2.72 + row * 0.35);
        key.rotation.y = 0.15;
        this.scene.add(key);
      }
    }

    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.44, 0.9, 18, 1, true), material(0x305b5a, 0.55));
    cup.position.set(5.7, 0.46, 2.55);
    cup.castShadow = true;
    this.scene.add(cup);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.48, 24), material(0x21120b, 0.25));
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.set(5.7, 0.91, 2.55);
    this.scene.add(coffee);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.08, 8, 18, Math.PI * 1.4), material(0x305b5a));
    handle.position.set(6.15, 0.52, 2.55);
    handle.rotation.y = Math.PI / 2;
    this.scene.add(handle);

    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.86, 0.18, 24), material(0x2a2c2b, 0.4, 0.25));
    lampBase.position.set(-6, 0.05, 2.8);
    this.scene.add(lampBase);
    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 10), material(0x393c39, 0.35, 0.3));
    lampStem.position.set(-6.05, 1.65, 2.9);
    lampStem.rotation.z = -0.12;
    this.scene.add(lampStem);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.15, 24, 1, true), material(0x6a3923, 0.62));
    shade.position.set(-5.65, 3.35, 2.78);
    shade.rotation.z = -0.8;
    this.scene.add(shade);

    cast(this.scene);
  }

  private createHammer(): void {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.15, 12), material(0xa56f43));
    handle.position.y = -0.72;
    this.hammer.add(handle);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.72, 0.75, 2, 2, 2), material(0x71503c, 0.68));
    this.hammerHead.add(head);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.78, 0.79), material(0x4a352a, 0.4, 0.15));
    this.hammerHead.add(band);
    this.hammerHead.position.y = 0.35;
    this.hammer.add(this.hammerHead);
    this.hammer.position.set(0, 3.2, 2);
    this.hammer.rotation.z = -0.62;
    this.hammer.rotation.x = -0.15;
    cast(this.hammer);
    this.scene.add(this.hammer);
  }

  setHammer(definition: HammerDefinition): void {
    const head = this.hammerHead.children[0];
    const handle = this.hammer.children[0];
    if (head instanceof THREE.Mesh && head.material instanceof THREE.MeshStandardMaterial) head.material.color.setHex(definition.headColor);
    if (handle instanceof THREE.Mesh && handle.material instanceof THREE.MeshStandardMaterial) handle.material.color.setHex(definition.handleColor);
    const scale = 0.88 + (definition.hitRadius - 1.7) * 0.22;
    this.hammerHead.scale.set(scale, scale, scale);
  }

  spawn(definition: SheepDefinition, forcedPosition?: { x: number; z: number }): SheepEntity {
    const group = new THREE.Group();
    const bodyMaterial = material(definition.color, definition.id === "golden" ? 0.32 : 0.76, definition.id === "golden" ? 0.55 : 0.02);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.98, 20, 14), bodyMaterial);
    body.scale.set(1.22, 0.9, 0.94);
    body.position.y = 0.86;
    group.add(body);

    const bobbleOffsets = [
      [-0.72, 1.2, -0.18], [-0.33, 1.5, -0.24], [0.12, 1.52, -0.25], [0.56, 1.34, -0.15],
      [-0.83, 0.88, 0.03], [0.78, 0.93, 0.02], [-0.58, 1.42, 0.16], [-0.1, 1.62, 0.12],
      [0.38, 1.55, 0.13], [0.75, 1.22, 0.16], [-0.4, 0.83, -0.62], [0.34, 0.84, -0.62]
    ];
    for (const [x, y, z] of bobbleOffsets) {
      const wool = new THREE.Mesh(WOOL_GEOMETRY, bodyMaterial);
      wool.position.set(x!, y!, z!);
      wool.scale.setScalar(0.85 + Math.random() * 0.2);
      group.add(wool);
    }

    const faceMaterial = material(definition.faceColor, 0.82);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 12), faceMaterial);
    head.scale.set(0.8, 1.04, 0.68);
    head.position.set(0, 0.96, 0.83);
    group.add(head);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.48, 10), faceMaterial);
      ear.position.set(side * 0.37, 1.16, 0.82);
      ear.rotation.z = side * 1.2;
      ear.rotation.x = -0.15;
      group.add(ear);
      const eye = new THREE.Mesh(EYE_GEOMETRY, material(0x151311, 0.25));
      eye.position.set(side * 0.15, 1.06, 1.16);
      group.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(side * 0.13, 1.09, 1.225);
      group.add(glint);
    }

    for (const x of [-0.56, 0.56]) {
      for (const z of [-0.4, 0.36]) {
        const leg = new THREE.Mesh(LEG_GEOMETRY, faceMaterial);
        leg.position.set(x, 0.25, z);
        group.add(leg);
      }
    }
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.035, 0.12), material(0x28221e, 0.5));
    slot.position.set(0, 1.89, -0.02);
    group.add(slot);

    if (definition.id === "tourist") this.addTouristHat(group);
    if (definition.id === "pinata") this.addStripes(group);
    if (definition.id === "loco") this.addBandana(group);
    if (definition.id === "timber") this.addWoodBands(group);

    group.scale.setScalar(definition.scale);
    const startX = forcedPosition?.x ?? -4.8 + Math.random() * 9.6;
    const startZ = forcedPosition?.z ?? -1.3 + Math.random() * 4.2;
    group.position.set(startX, 0, startZ);
    group.rotation.y = (Math.random() - 0.5) * 0.4;
    cast(group);
    this.scene.add(group);

    const hitBar = new THREE.Group();
    const backMaterial = new THREE.MeshBasicMaterial({ color: 0x1b1210, transparent: true, opacity: 0.96, depthTest: false, depthWrite: false });
    const fillMaterial = new THREE.MeshBasicMaterial({ color: 0xe45d4f, transparent: true, opacity: 0.98, depthTest: false, depthWrite: false });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.16), backMaterial);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.085), fillMaterial);
    back.renderOrder = 110;
    fill.renderOrder = 111;
    fill.position.z = 0.002;
    hitBar.add(back, fill);
    hitBar.visible = false;
    this.scene.add(hitBar);

    const entity: SheepEntity = {
      id: this.nextId++,
      definition,
      group,
      bodyMaterial,
      hp: definition.hp,
      maxHp: definition.hp,
      speed: definition.speed,
      target: this.randomTarget(),
      bornAt: performance.now(),
      lastHitAt: 0,
      hitBar,
      hitFill: fill,
      alive: true
    };
    group.traverse((child) => {
      child.userData.sheepId = entity.id;
    });
    this.sheep.push(entity);
    return entity;
  }

  private addTouristHat(group: THREE.Group): void {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 18), material(0xd4ad55));
    brim.position.set(0, 1.72, 0.63);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.44, 0.42, 18), material(0xe0bd68));
    crown.position.set(0, 1.94, 0.62);
    group.add(brim, crown);
  }

  private addStripes(group: THREE.Group): void {
    const colors = [0x56b5c9, 0xf5c94a, 0xe75d72];
    for (let i = 0; i < 3; i += 1) {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.93 - i * 0.06, 0.07, 6, 28), material(colors[i]!));
      stripe.scale.set(1.2, 0.92, 0.95);
      stripe.rotation.x = Math.PI / 2;
      stripe.position.y = 0.83 + i * 0.26;
      group.add(stripe);
    }
  }

  private addBandana(group: THREE.Group): void {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.075, 8, 22), material(0xf1c747));
    band.position.set(0, 1.28, 0.84);
    band.rotation.x = Math.PI / 2;
    group.add(band);
  }

  private addWoodBands(group: THREE.Group): void {
    for (const x of [-0.45, 0.45]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.055, 6, 24), material(0x704b2f));
      band.rotation.y = Math.PI / 2;
      band.scale.set(1, 1.1, 1);
      band.position.set(x, 0.92, 0);
      group.add(band);
    }
  }

  private randomTarget(): THREE.Vector3 {
    return new THREE.Vector3(-4.55 + Math.random() * 9.1, 0, -1.2 + Math.random() * 4.05);
  }

  getNearby(center: SheepEntity, worldRadius: number): SheepEntity[] {
    return this.sheep.filter((entity) => entity.alive && entity.group.position.distanceTo(center.group.position) <= worldRadius);
  }

  dropLoot(position: THREE.Vector3, value: number): void {
    let remaining = Math.max(0, Math.round(value));
    if (!remaining) return;
    const count = Math.max(1, Math.min(8, Math.ceil(Math.log2(remaining + 1) / 2)));
    for (let i = 0; i < count; i += 1) {
      const slotsLeft = count - i;
      const share = slotsLeft === 1
        ? remaining
        : Math.max(1, Math.min(remaining - (slotsLeft - 1), Math.round((remaining / slotsLeft) * (0.68 + Math.random() * 0.64))));
      remaining -= share;
      const palette = [0xc8c5b8, 0xe7b63f, 0x52b878, 0xd94c47];
      const color = palette[Math.min(3, Math.floor((i / Math.max(1, count - 1)) * 4))] ?? palette[0]!;
      const mesh = new THREE.Mesh(COIN_GEOMETRY, material(color, 0.24, 0.76));
      mesh.rotation.x = Math.PI / 2;
      mesh.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 0.36, 0.8 + Math.random() * 0.2, (Math.random() - 0.5) * 0.36));
      mesh.scale.setScalar(0.85 + Math.min(0.55, Math.log10(share + 1) * 0.09));
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.pickups.push({
        mesh,
        value: share,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 3.9, 3.1 + Math.random() * 3.5, (Math.random() - 0.5) * 3.4),
        age: 0
      });
    }
  }

  collectPickups(radius: number, delta: number): number {
    if (!this.pointerInside) return 0;
    let collected = 0;
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i]!;
      if (pickup.age < 0.28) continue;
      const dx = pickup.mesh.position.x - this.pointerWorld.x;
      const dz = pickup.mesh.position.z - this.pointerWorld.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      const pull = Math.min(0.72, delta * (5.5 + radius * 1.8));
      pickup.mesh.position.x += (this.pointerWorld.x - pickup.mesh.position.x) * pull;
      pickup.mesh.position.z += (this.pointerWorld.z - pickup.mesh.position.z) * pull;
      pickup.mesh.position.y += (0.27 - pickup.mesh.position.y) * pull;
      pickup.mesh.rotation.y += delta * 14;
      if (distance > 0.3) continue;
      collected += pickup.value;
      this.scene.remove(pickup.mesh);
      this.pickups.splice(i, 1);
    }
    return collected;
  }

  clearPickups(): number {
    let value = 0;
    for (const pickup of this.pickups) {
      value += pickup.value;
      this.scene.remove(pickup.mesh);
    }
    this.pickups.length = 0;
    return value;
  }

  pendingLootValue(): number {
    return this.pickups.reduce((sum, pickup) => sum + pickup.value, 0);
  }

  pointerScreenPoint(): { x: number; y: number } {
    return this.worldToScreen(this.pointerWorld.clone().setY(0.3));
  }

  healthBarScreenPoint(entity: SheepEntity): { x: number; y: number } {
    return this.worldToScreen(entity.hitBar.position.clone());
  }

  headScreenPoint(entity: SheepEntity): { x: number; y: number } {
    return this.worldToScreen(this.headWorldPosition(entity));
  }

  private headWorldPosition(entity: SheepEntity): THREE.Vector3 {
    entity.group.updateMatrixWorld(true);
    const localHeight = entity.definition.id === "tourist" ? 2.22 : 1.68;
    return new THREE.Vector3(0, localHeight, 0.86).applyMatrix4(entity.group.matrixWorld);
  }

  clearSheep(): void {
    for (const entity of [...this.sheep]) {
      entity.alive = false;
      this.scene.remove(entity.group);
      this.scene.remove(entity.hitBar);
    }
    this.sheep.length = 0;
    this.setHovered(null);
  }

  hit(entity: SheepEntity, result: SmashResult, isPrimary = true): void {
    if (!entity.alive) return;
    entity.hp = Math.max(0, entity.hp - result.damage);
    entity.lastHitAt = performance.now();
    entity.hitBar.visible = true;
    const ratio = entity.hp / entity.maxHp;
    entity.hitFill.scale.x = Math.max(0.001, ratio);
    entity.hitFill.position.x = -0.635 * (1 - ratio);
    entity.group.scale.multiplyScalar(0.94);
    window.setTimeout(() => {
      if (entity.alive) entity.group.scale.setScalar(entity.definition.scale);
    }, this.reducedMotion ? 20 : 90);
    if (isPrimary) this.swingAt(entity.group.position, result.critical);
    this.burst(entity.group.position, result.killed ? 14 : 4, result.killed, result.critical);
    if (result.killed) {
      entity.alive = false;
      entity.group.visible = false;
      entity.hitBar.visible = false;
      if (this.hovered === entity) this.setHovered(null);
      this.coinBurst(entity.group.position, result.loot);
      window.setTimeout(() => this.remove(entity), 50);
    }
  }

  private remove(entity: SheepEntity): void {
    const index = this.sheep.indexOf(entity);
    if (index >= 0) this.sheep.splice(index, 1);
    this.scene.remove(entity.group);
    this.scene.remove(entity.hitBar);
  }

  private burst(position: THREE.Vector3, count: number, debris: boolean, critical: boolean): void {
    const color = critical ? 0xffdf59 : debris ? 0xf3e4c3 : 0xffffff;
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(debris ? DEBRIS_GEOMETRY : COIN_GEOMETRY, material(color, 0.5, critical ? 0.25 : 0));
      mesh.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6));
      mesh.scale.setScalar(debris ? 0.55 + Math.random() * 0.8 : 0.35);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 3.5, 1.8 + Math.random() * 3.6, (Math.random() - 0.5) * 3),
        life: 0.6 + Math.random() * 0.55,
        maxLife: 1.2,
        spin: (Math.random() - 0.5) * 8
      });
    }
  }

  private coinBurst(position: THREE.Vector3, loot: number): void {
    const count = Math.min(18, 4 + Math.ceil(Math.log2(Math.max(2, loot))));
    for (let i = 0; i < count; i += 1) {
      const valueColor = loot >= 100 && i === 0 ? 0xd94c47 : loot >= 25 && i < 2 ? 0x52b878 : i % 4 === 0 ? 0xe7b63f : 0xc8c5b8;
      const mesh = new THREE.Mesh(COIN_GEOMETRY, material(valueColor, 0.25, 0.72));
      mesh.rotation.x = Math.PI / 2;
      mesh.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.8, (Math.random() - 0.5) * 0.5));
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 4.3, 3.4 + Math.random() * 4.4, (Math.random() - 0.5) * 3.7),
        life: 1.2 + Math.random() * 0.7,
        maxLife: 2,
        spin: (Math.random() - 0.5) * 12
      });
    }
  }

  swingAt(position: THREE.Vector3, critical: boolean): void {
    this.hammerSwing = 1;
    this.shake = critical ? 0.2 : 0.09;
    this.hammerTrail.position.set(position.x, 0.07, position.z);
    const trailMaterial = this.hammerTrail.material;
    if (trailMaterial instanceof THREE.MeshBasicMaterial) {
      trailMaterial.color.setHex(critical ? 0xffcc3c : 0xf4e0bb);
      trailMaterial.opacity = 0.8;
    }
  }

  worldToScreen(position: THREE.Vector3): { x: number; y: number } {
    const projected = position.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height
    };
  }

  private handlePointerMove = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.ray.intersectPlane(this.groundPlane, this.pointerWorld);
    this.pointerInside = true;
    const hits = this.raycaster.intersectObjects(this.sheep.map((entity) => entity.group), true);
    let next: SheepEntity | null = null;
    for (const hit of hits) {
      const id = hit.object.userData.sheepId as number | undefined;
      if (id !== undefined) {
        next = this.sheep.find((entity) => entity.id === id && entity.alive) ?? null;
        if (next) break;
      }
    }
    this.setHovered(next);
  };

  private handlePointerLeave = (): void => {
    this.pointer.set(3, 3);
    this.pointerInside = false;
    this.setHovered(null);
  };

  private handlePointerDown = (): void => {
    this.onPointerDown?.();
  };

  private setHovered(entity: SheepEntity | null): void {
    if (this.hovered === entity) return;
    if (this.hovered) {
      this.hovered.bodyMaterial.emissive.setHex(0x000000);
      this.hovered.hitBar.visible = performance.now() - this.hovered.lastHitAt < 1450;
    }
    this.hovered = entity;
    if (entity) {
      entity.bodyMaterial.emissive.setHex(0x392815);
      entity.hitBar.visible = true;
    }
    this.renderer.domElement.classList.toggle("targeting", Boolean(entity));
    this.onHoverChange?.(entity);
  }

  private updateSheep(delta: number, elapsed: number): void {
    for (const entity of this.sheep) {
      if (!entity.alive) continue;
      const position = entity.group.position;
      if (entity.speed > 0 && entity !== this.hovered) {
        const direction = entity.target.clone().sub(position);
        if (direction.lengthSq() < 0.16) entity.target = this.randomTarget();
        else {
          direction.normalize();
          position.addScaledVector(direction, entity.speed * delta);
          entity.group.rotation.y = Math.atan2(direction.x, direction.z);
        }
      }
      entity.group.position.y = Math.sin(elapsed * 2.1 + entity.id) * 0.025;
      const projectedAnchor = this.headWorldPosition(entity).project(this.camera);
      projectedAnchor.y += 44 / Math.max(1, this.renderer.domElement.clientHeight);
      entity.hitBar.position.copy(projectedAnchor.unproject(this.camera));
      entity.hitBar.quaternion.copy(this.camera.quaternion);
      entity.hitBar.scale.setScalar(0.88 + (entity.definition.scale - 1) * 0.24);
      if (entity !== this.hovered && performance.now() - entity.lastHitAt >= 1450) entity.hitBar.visible = false;
      if (entity.definition.id === "loco" && performance.now() - entity.bornAt > 16000) {
        entity.target.set(7.5, 0, entity.group.position.z);
        entity.speed = 2.4;
        if (entity.group.position.x > 6.7) {
          entity.alive = false;
          this.remove(entity);
        }
      }
    }
  }

  private updateParticles(delta: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i]!;
      particle.life -= delta;
      particle.velocity.y -= 8.5 * delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      particle.mesh.rotation.x += particle.spin * delta;
      particle.mesh.rotation.z += particle.spin * 0.7 * delta;
      if (particle.mesh.position.y < 0.08) {
        particle.mesh.position.y = 0.08;
        particle.velocity.y *= -0.34;
        particle.velocity.x *= 0.75;
        particle.velocity.z *= 0.75;
      }
      const opacity = clamp01(particle.life / particle.maxLife);
      if (particle.mesh.material instanceof THREE.MeshStandardMaterial) {
        particle.mesh.material.transparent = true;
        particle.mesh.material.opacity = opacity;
      }
      if (particle.life <= 0) {
        this.scene.remove(particle.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  private updatePickups(delta: number): void {
    for (const pickup of this.pickups) {
      pickup.age += delta;
      if (pickup.mesh.position.y <= 0.095 && Math.abs(pickup.velocity.y) < 0.42) {
        pickup.mesh.position.y = 0.095;
        pickup.velocity.set(0, 0, 0);
        pickup.mesh.rotation.x = Math.PI / 2;
        continue;
      }
      pickup.velocity.y -= 8.7 * delta;
      pickup.mesh.position.addScaledVector(pickup.velocity, delta);
      pickup.mesh.rotation.y += delta * 7;
      pickup.mesh.rotation.z += delta * 5;
      if (pickup.mesh.position.y < 0.095) {
        pickup.mesh.position.y = 0.095;
        pickup.velocity.y *= -0.31;
        pickup.velocity.x *= 0.72;
        pickup.velocity.z *= 0.72;
      }
    }
  }

  private updateHammer(delta: number): void {
    const target = this.hovered?.group.position ?? this.pointerWorld;
    const desired = new THREE.Vector3(clampNumber(target.x + 1.15, -5.4, 5.5), 2.72, clampNumber(target.z + 1.2, -1, 4));
    this.hammer.position.lerp(desired, 1 - Math.pow(0.002, delta));
    if (this.hammerSwing > 0) {
      this.hammerSwing = Math.max(0, this.hammerSwing - delta * (this.reducedMotion ? 10 : 4.7));
      const phase = 1 - this.hammerSwing;
      const arc = Math.sin(phase * Math.PI);
      this.hammer.rotation.z = -0.62 + arc * 1.25;
      this.hammer.position.y = 2.72 - arc * 1.25;
      const trailMaterial = this.hammerTrail.material;
      if (trailMaterial instanceof THREE.MeshBasicMaterial) trailMaterial.opacity = this.hammerSwing * 0.75;
      this.hammerTrail.scale.setScalar(1 + phase * 0.8);
    } else {
      this.hammer.rotation.z += (-0.62 - this.hammer.rotation.z) * Math.min(1, delta * 12);
    }
  }

  private animate = (time: number): void => {
    if (this.disposed) return;
    const delta = Math.min(0.05, this.lastTime ? (time - this.lastTime) / 1000 : this.clock.getDelta());
    this.lastTime = time;
    const elapsed = time / 1000;

    const base = new THREE.Vector3(0, 9.8, 8.8);
    if (this.allowScreenShake && !this.reducedMotion && this.shake > 0.001) {
      base.x += (Math.random() - 0.5) * this.shake;
      base.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.02, delta);
    }
    this.camera.position.copy(base);
    this.camera.lookAt(0, 0.25, 0);
    this.camera.updateMatrixWorld();

    this.updateSheep(delta, elapsed);
    this.updateParticles(delta);
    this.updatePickups(delta);
    this.updateHammer(delta);

    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("pointerleave", this.handlePointerLeave);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.dispose();
    this.clearPickups();
    this.host.replaceChildren();
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clampNumber(value, 0, 1);
}
