"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import ammoScriptUrl from "ammojs-typed/ammo/ammo.js?url";
import * as THREE from "three";

export type ArenaPhase = "ready" | "playing" | "paused" | "goal" | "ended";
export type ArenaDifficulty = "新秀" | "职业" | "传奇";
export type ArenaFormation = "2-2" | "1-2-1" | "3-1";
export type ArenaTeam = "home" | "away";
export type EngineState = "loading" | "ready" | "error";

export type ArenaStats = {
  homeShots: number;
  awayShots: number;
  homeSaves: number;
  awaySaves: number;
  homePasses: number;
  awayPasses: number;
  homePossession: number;
};

type ThreeArenaProps = {
  phase: ArenaPhase;
  difficulty: ArenaDifficulty;
  formation: ArenaFormation;
  teamColor: string;
  duration: number;
  resetSignal: number;
  selected: number;
  keysRef: MutableRefObject<Set<string>>;
  shootRef: MutableRefObject<boolean>;
  passRef: MutableRefObject<boolean>;
  onSelectedChange: (index: number) => void;
  onTimeChange: (seconds: number) => void;
  onStatsChange: (stats: ArenaStats) => void;
  onGoal: (team: ArenaTeam) => void;
  onMatchEnd: () => void;
  onResumeAfterGoal: () => void;
  onEngineState: (state: EngineState) => void;
  onKick?: () => void;
};

type PlayerBody = {
  body: AmmoBody;
  mesh: THREE.Group;
  team: ArenaTeam;
  index: number;
  homeIndex: number;
  facing: number;
  kickCooldown: number;
};

type AmmoBody = {
  getMotionState: () => AmmoMotionState;
  setWorldTransform: (transform: AmmoTransform) => void;
  setLinearVelocity: (velocity: AmmoVector) => void;
  setAngularVelocity: (velocity: AmmoVector) => void;
  getLinearVelocity: () => AmmoVector;
  setLinearFactor: (factor: AmmoVector) => void;
  setAngularFactor: (factor: AmmoVector) => void;
  setDamping: (linear: number, angular: number) => void;
  setFriction: (value: number) => void;
  setRollingFriction: (value: number) => void;
  setRestitution: (value: number) => void;
  setCcdMotionThreshold?: (value: number) => void;
  setCcdSweptSphereRadius?: (value: number) => void;
  applyCentralImpulse: (impulse: AmmoVector) => void;
  clearForces: () => void;
  activate: (force?: boolean) => void;
};

type AmmoMotionState = {
  getWorldTransform: (transform: AmmoTransform) => void;
  setWorldTransform: (transform: AmmoTransform) => void;
};

type AmmoTransform = {
  setIdentity: () => void;
  setOrigin: (origin: AmmoVector) => void;
  setRotation: (rotation: AmmoQuaternion) => void;
  getOrigin: () => AmmoVector;
  getRotation: () => AmmoQuaternion;
};

type AmmoVector = {
  setValue: (x: number, y: number, z: number) => void;
  x: () => number;
  y: () => number;
  z: () => number;
};

type AmmoQuaternion = {
  x: () => number;
  y: () => number;
  z: () => number;
  w: () => number;
};

type AmmoApi = {
  btDefaultCollisionConfiguration: new () => unknown;
  btCollisionDispatcher: new (config: unknown) => unknown;
  btDbvtBroadphase: new () => unknown;
  btSequentialImpulseConstraintSolver: new () => unknown;
  btDiscreteDynamicsWorld: new (
    dispatcher: unknown,
    broadphase: unknown,
    solver: unknown,
    config: unknown,
  ) => AmmoWorld;
  btVector3: new (x: number, y: number, z: number) => AmmoVector;
  btQuaternion: new (x: number, y: number, z: number, w: number) => AmmoQuaternion;
  btTransform: new () => AmmoTransform;
  btDefaultMotionState: new (transform: AmmoTransform) => AmmoMotionState;
  btRigidBodyConstructionInfo: new (
    mass: number,
    motionState: AmmoMotionState,
    shape: AmmoShape,
    inertia: AmmoVector,
  ) => unknown;
  btRigidBody: new (info: unknown) => AmmoBody;
  btBoxShape: new (halfExtents: AmmoVector) => AmmoShape;
  btCylinderShape: new (halfExtents: AmmoVector) => AmmoShape;
  btSphereShape: new (radius: number) => AmmoShape;
  destroy: (object: unknown) => void;
};

type AmmoWorld = {
  setGravity: (gravity: AmmoVector) => void;
  addRigidBody: (body: AmmoBody) => void;
  removeRigidBody: (body: AmmoBody) => void;
  stepSimulation: (delta: number, maxSubSteps: number, fixedStep: number) => void;
};

type AmmoShape = {
  calculateLocalInertia: (mass: number, inertia: AmmoVector) => void;
};

type AmmoFactory = (this: Window) => Promise<AmmoApi>;
type AmmoWindow = Window & typeof globalThis & {
  Ammo?: AmmoFactory | AmmoApi;
};

let ammoLoadPromise: Promise<AmmoApi> | null = null;

function isAmmoApi(value: unknown): value is AmmoApi {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<AmmoApi>).btVector3 === "function" &&
    typeof (value as Partial<AmmoApi>).btDiscreteDynamicsWorld === "function"
  );
}

function loadAmmo(): Promise<AmmoApi> {
  if (ammoLoadPromise) return ammoLoadPromise;

  const pending = new Promise<AmmoApi>((resolve, reject) => {
    const ammoWindow = window as AmmoWindow;

    const initialize = async () => {
      try {
        if (isAmmoApi(ammoWindow.Ammo)) {
          resolve(ammoWindow.Ammo);
          return;
        }

        if (typeof ammoWindow.Ammo !== "function") {
          reject(new Error("Ammo.js 脚本未暴露初始化函数"));
          return;
        }

        // ammojs-typed is a classic UMD build. Calling it with window as its
        // receiver preserves the global `this` that its generated runtime uses.
        const Ammo = await ammoWindow.Ammo.call(window);
        if (!isAmmoApi(Ammo)) {
          reject(new Error("Ammo.js 刚体运行时初始化结果无效"));
          return;
        }
        resolve(Ammo);
      } catch (error) {
        reject(error);
      }
    };

    if (ammoWindow.Ammo) {
      void initialize();
      return;
    }

    const selector = 'script[data-ammo-2066="true"]';
    const existing = document.querySelector<HTMLScriptElement>(selector);
    const onLoad = (script: HTMLScriptElement) => {
      script.dataset.loaded = "true";
      void initialize();
    };
    const onError = (script: HTMLScriptElement) => {
      script.remove();
      reject(new Error("Ammo.js 物理引擎脚本加载失败"));
    };

    if (existing) {
      if (existing.dataset.loaded === "true") {
        void initialize();
      } else {
        existing.addEventListener("load", () => onLoad(existing), { once: true });
        existing.addEventListener("error", () => onError(existing), { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = ammoScriptUrl;
    script.async = true;
    script.setAttribute("data-ammo-2066", "true");
    script.addEventListener("load", () => onLoad(script), { once: true });
    script.addEventListener("error", () => onError(script), { once: true });
    document.head.appendChild(script);
  });

  ammoLoadPromise = pending.catch((error) => {
    ammoLoadPromise = null;
    throw error;
  });
  return ammoLoadPromise;
}

const FIXED_STEP = 1 / 60;
const FIELD_HALF_X = 16;
const FIELD_HALF_Z = 9.34;
const GOAL_HALF_Z = 2.55;
const PLAYER_Y = 0.66;
const BALL_RADIUS = 0.32;

const FORMATION_POINTS: Record<ArenaFormation, Array<[number, number]>> = {
  "2-2": [
    [-14.25, 0],
    [-7.5, -3.5],
    [-7.5, 3.5],
    [0.8, -3.15],
    [0.8, 3.15],
  ],
  "1-2-1": [
    [-14.25, 0],
    [-8.2, 0],
    [-3.2, -3.7],
    [-3.2, 3.7],
    [2.1, 0],
  ],
  "3-1": [
    [-14.25, 0],
    [-8.1, -4.25],
    [-8.1, 0],
    [-8.1, 4.25],
    [1.65, 0],
  ],
};

const HOME_NUMBERS = [1, 4, 8, 11, 9];
const AWAY_NUMBERS = [1, 3, 6, 10, 9];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hexToNumber(color: string) {
  return Number.parseInt(color.replace("#", ""), 16) || 0x19e7b0;
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createPlayerMesh(color: number, number: number, goalkeeper: boolean) {
  const group = new THREE.Group();
  const kit = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.52,
    metalness: 0.08,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x071612, roughness: 0.72 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a077, roughness: 0.84 });
  const accent = new THREE.MeshStandardMaterial({
    color: goalkeeper ? 0xf7d64a : 0xe8fff7,
    roughness: 0.5,
    emissive: goalkeeper ? 0x3c2800 : 0x061d17,
    emissiveIntensity: 0.4,
  });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.43, 0.76, 12), kit);
  torso.position.y = 1.02;
  torso.castShadow = true;
  torso.receiveShadow = true;
  group.add(torso);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.76), accent);
  shoulder.position.set(0, 1.26, 0);
  shoulder.castShadow = true;
  group.add(shoulder);

  const shorts = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.55), dark);
  shorts.position.y = 0.62;
  shorts.castShadow = true;
  group.add(shorts);

  for (const z of [-0.2, 0.2]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.09, 0.48, 8), skin);
    leg.position.set(0, 0.28, z);
    leg.castShadow = true;
    group.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.16), dark);
    boot.position.set(0.08, 0.07, z);
    boot.castShadow = true;
    group.add(boot);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.235, 14, 10), skin);
  head.position.y = 1.62;
  head.castShadow = true;
  group.add(head);

  const facingMark = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.34), accent);
  facingMark.position.set(0.35, 1.05, 0);
  group.add(facingMark);

  const badgeCanvas = document.createElement("canvas");
  badgeCanvas.width = 96;
  badgeCanvas.height = 96;
  const context = badgeCanvas.getContext("2d");
  if (context) {
    context.fillStyle = "rgba(2, 14, 11, .82)";
    context.beginPath();
    context.arc(48, 48, 38, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f1fff9";
    context.font = "900 48px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(number), 48, 51);
  }
  const badgeMaterial = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(badgeCanvas),
    transparent: true,
    depthTest: false,
  });
  const badge = new THREE.Sprite(badgeMaterial);
  badge.position.set(0, 2.05, 0);
  badge.scale.set(0.78, 0.78, 0.78);
  group.add(badge);

  return { group, kit };
}

function addPitch(scene: THREE.Scene) {
  const stadiumFloor = new THREE.Mesh(
    new THREE.CylinderGeometry(27, 29, 1.1, 48),
    new THREE.MeshStandardMaterial({ color: 0x06110e, roughness: 0.92 }),
  );
  stadiumFloor.position.y = -0.75;
  stadiumFloor.receiveShadow = true;
  scene.add(stadiumFloor);

  const pitch = new THREE.Group();
  const stripeWidth = (FIELD_HALF_X * 2) / 8;
  for (let index = 0; index < 8; index += 1) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(stripeWidth + 0.02, FIELD_HALF_Z * 2),
      new THREE.MeshStandardMaterial({
        color: index % 2 === 0 ? 0x0b6044 : 0x0e6b4c,
        roughness: 0.88,
      }),
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(-FIELD_HALF_X + stripeWidth * (index + 0.5), 0, 0);
    stripe.receiveShadow = true;
    pitch.add(stripe);
  }

  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xd9fff1, transparent: true, opacity: 0.88 });
  const addLine = (points: Array<[number, number]>, loop = false) => {
    const vectors = points.map(([x, z]) => new THREE.Vector3(x, 0.035, z));
    const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
    pitch.add(loop ? new THREE.LineLoop(geometry, lineMaterial) : new THREE.Line(geometry, lineMaterial));
  };
  addLine([
    [-FIELD_HALF_X, -FIELD_HALF_Z],
    [FIELD_HALF_X, -FIELD_HALF_Z],
    [FIELD_HALF_X, FIELD_HALF_Z],
    [-FIELD_HALF_X, FIELD_HALF_Z],
  ], true);
  addLine([[0, -FIELD_HALF_Z], [0, FIELD_HALF_Z]]);
  const circle = Array.from({ length: 65 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2;
    return [Math.cos(angle) * 2.25, Math.sin(angle) * 2.25] as [number, number];
  });
  addLine(circle, true);
  for (const side of [-1, 1]) {
    const x = side * FIELD_HALF_X;
    const inner = side * (FIELD_HALF_X - 4.1);
    addLine([[x, -4.35], [inner, -4.35], [inner, 4.35], [x, 4.35]]);
    const six = side * (FIELD_HALF_X - 1.75);
    addLine([[x, -2.75], [six, -2.75], [six, 2.75], [x, 2.75]]);
  }
  const centerSpot = new THREE.Mesh(
    new THREE.CircleGeometry(0.1, 16),
    new THREE.MeshBasicMaterial({ color: 0xe7fff6 }),
  );
  centerSpot.rotation.x = -Math.PI / 2;
  centerSpot.position.y = 0.04;
  pitch.add(centerSpot);
  scene.add(pitch);

  const goalMaterial = new THREE.MeshStandardMaterial({ color: 0xecfff8, roughness: 0.34, metalness: 0.42 });
  const netMaterial = new THREE.LineBasicMaterial({ color: 0x77ad9c, transparent: true, opacity: 0.4 });
  for (const side of [-1, 1]) {
    const goal = new THREE.Group();
    const goalX = side * FIELD_HALF_X;
    for (const z of [-GOAL_HALF_Z, GOAL_HALF_Z]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 10), goalMaterial);
      post.position.set(goalX, 1.1, z);
      post.castShadow = true;
      goal.add(post);
    }
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, GOAL_HALF_Z * 2, 10), goalMaterial);
    crossbar.rotation.x = Math.PI / 2;
    crossbar.position.set(goalX, 2.2, 0);
    goal.add(crossbar);
    const backX = goalX + side * 1.45;
    const netPoints: THREE.Vector3[] = [];
    for (let row = 0; row <= 5; row += 1) {
      const y = (row / 5) * 2.2;
      for (const z of [-GOAL_HALF_Z, GOAL_HALF_Z]) {
        netPoints.push(new THREE.Vector3(goalX, y, z), new THREE.Vector3(backX, y, z));
      }
      netPoints.push(
        new THREE.Vector3(backX, y, -GOAL_HALF_Z),
        new THREE.Vector3(backX, y, GOAL_HALF_Z),
      );
    }
    for (let column = 0; column <= 8; column += 1) {
      const z = -GOAL_HALF_Z + (column / 8) * GOAL_HALF_Z * 2;
      netPoints.push(new THREE.Vector3(backX, 0, z), new THREE.Vector3(backX, 2.2, z));
      netPoints.push(new THREE.Vector3(goalX, 2.2, z), new THREE.Vector3(backX, 2.2, z));
    }
    goal.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(netPoints), netMaterial));
    scene.add(goal);
  }

  const standMaterial = new THREE.MeshStandardMaterial({ color: 0x0b211b, roughness: 0.82, metalness: 0.08 });
  const stands = [
    [0, -12.7, 34, 4.1],
    [0, 12.7, 34, 4.1],
    [-20.2, 0, 4.1, 20],
    [20.2, 0, 4.1, 20],
  ];
  for (const [x, z, width, depth] of stands) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(width, 3.1, depth), standMaterial);
    stand.position.set(x, 1.05, z);
    stand.receiveShadow = true;
    scene.add(stand);
  }

  const random = seededRandom(2066);
  const crowdGeometry = new THREE.BoxGeometry(0.13, 0.18, 0.13);
  const crowdMaterial = new THREE.MeshStandardMaterial({ color: 0x5fffd0, emissive: 0x0b5c45, emissiveIntensity: 0.6 });
  const crowd = new THREE.InstancedMesh(crowdGeometry, crowdMaterial, 520);
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < 520; index += 1) {
    const longSide = index < 330;
    const side = random() > 0.5 ? 1 : -1;
    const x = longSide ? (random() - 0.5) * 31 : side * (18.4 + random() * 3.2);
    const z = longSide ? side * (11.15 + random() * 3.1) : (random() - 0.5) * 18.2;
    const y = 1.65 + random() * 1.55;
    matrix.makeTranslation(x, y, z);
    crowd.setMatrixAt(index, matrix);
    crowd.setColorAt(index, new THREE.Color(random() > 0.72 ? 0xf2fff9 : random() > 0.5 ? 0xff4f62 : 0x37d7aa));
  }
  crowd.instanceMatrix.needsUpdate = true;
  scene.add(crowd);

  const roof = new THREE.Mesh(
    new THREE.TorusGeometry(22.5, 0.22, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0x214039, metalness: 0.72, roughness: 0.28 }),
  );
  roof.rotation.x = Math.PI / 2;
  roof.scale.z = 0.65;
  roof.position.y = 6.2;
  scene.add(roof);
}

export function ThreeArena(props: ThreeArenaProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef(props);
  const [bootState, setBootState] = useState<EngineState>("loading");
  const [bootMessage, setBootMessage] = useState("正在加载 Ammo.js 刚体世界");

  useEffect(() => {
    latestRef.current = props;
  }, [props]);

  useEffect(() => {
    let disposed = false;
    let destroyEngine = () => {};
    const surface = surfaceRef.current;
    if (!surface) return;

    const boot = async () => {
      setBootState("loading");
      latestRef.current.onEngineState("loading");
      setBootMessage("正在加载 Ammo.js 刚体世界");

      const [Ammo, PIXI] = await Promise.all([loadAmmo(), import("pixi.js")]);
      if (disposed) return;

      setBootMessage("正在同步 Three.js 与 PixiJS 渲染层");
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x020a08);
      scene.fog = new THREE.FogExp2(0x020c09, 0.018);

      const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 120);
      camera.position.set(0, 20.5, 19.8);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.domElement.className = "three-canvas";
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute("aria-label", "2066 决战世界杯 3D 五人制球场");
      renderer.domElement.dataset.testid = "three-game-canvas";
      surface.appendChild(renderer.domElement);

      const ambient = new THREE.HemisphereLight(0xcaffed, 0x03120d, 1.35);
      scene.add(ambient);
      const keyLight = new THREE.DirectionalLight(0xf4fff9, 3.4);
      keyLight.position.set(-8, 17, 11);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1536, 1536);
      keyLight.shadow.camera.left = -22;
      keyLight.shadow.camera.right = 22;
      keyLight.shadow.camera.top = 16;
      keyLight.shadow.camera.bottom = -16;
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x26ffc0, 1.7);
      rimLight.position.set(14, 10, -15);
      scene.add(rimLight);
      addPitch(scene);

      const pixiApp = new PIXI.Application();
      await pixiApp.init({
        width: Math.max(1, surface.clientWidth),
        height: Math.max(1, surface.clientHeight),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        autoStart: false,
        resolution: Math.min(window.devicePixelRatio || 1, 1.25),
        preference: "webgl",
        powerPreference: "high-performance",
      });
      if (disposed) {
        pixiApp.destroy({ removeView: true }, { children: true });
        renderer.dispose();
        return;
      }
      pixiApp.ticker.stop();
      pixiApp.canvas.className = "pixi-canvas";
      pixiApp.canvas.setAttribute("aria-hidden", "true");
      surface.appendChild(pixiApp.canvas);
      const hud = new PIXI.Graphics();
      pixiApp.stage.addChild(hud);
      const playerLabels = Array.from({ length: 10 }, (_, index) => {
        const label = new PIXI.Text({
          text: String(index < 5 ? HOME_NUMBERS[index] : AWAY_NUMBERS[index - 5]),
          style: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 11,
            fontWeight: "800",
            fill: 0xf1fff9,
            stroke: { color: 0x04120e, width: 3 },
          },
        });
        label.anchor.set(0.5);
        pixiApp.stage.addChild(label);
        return label;
      });

      const collisionConfig = new Ammo.btDefaultCollisionConfiguration();
      const dispatcher = new Ammo.btCollisionDispatcher(collisionConfig);
      const broadphase = new Ammo.btDbvtBroadphase();
      const solver = new Ammo.btSequentialImpulseConstraintSolver();
      const world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfig);
      const gravity = new Ammo.btVector3(0, -18, 0);
      world.setGravity(gravity);

      const ammoBodies: AmmoBody[] = [];
      const ammoShapes: AmmoShape[] = [];
      const createBody = (shape: AmmoShape, mass: number, x: number, y: number, z: number) => {
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        const origin = new Ammo.btVector3(x, y, z);
        const rotation = new Ammo.btQuaternion(0, 0, 0, 1);
        transform.setOrigin(origin);
        transform.setRotation(rotation);
        const motionState = new Ammo.btDefaultMotionState(transform);
        const inertia = new Ammo.btVector3(0, 0, 0);
        if (mass > 0) shape.calculateLocalInertia(mass, inertia);
        const info = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, inertia);
        const body = new Ammo.btRigidBody(info);
        world.addRigidBody(body);
        ammoBodies.push(body);
        ammoShapes.push(shape);
        Ammo.destroy(info);
        Ammo.destroy(inertia);
        Ammo.destroy(rotation);
        Ammo.destroy(origin);
        Ammo.destroy(transform);
        return body;
      };

      const boxBody = (halfX: number, halfY: number, halfZ: number, x: number, y: number, z: number) => {
        const half = new Ammo.btVector3(halfX, halfY, halfZ);
        const shape = new Ammo.btBoxShape(half);
        Ammo.destroy(half);
        const body = createBody(shape, 0, x, y, z);
        body.setFriction(0.72);
        body.setRestitution(0.52);
        return body;
      };

      boxBody(17.6, 0.18, 10.8, 0, -0.2, 0);
      boxBody(17.4, 0.62, 0.16, 0, 0.55, -FIELD_HALF_Z - 0.22);
      boxBody(17.4, 0.62, 0.16, 0, 0.55, FIELD_HALF_Z + 0.22);
      for (const side of [-1, 1]) {
        const x = side * (FIELD_HALF_X + 0.18);
        const segmentDepth = (FIELD_HALF_Z - GOAL_HALF_Z) / 2;
        const offset = GOAL_HALF_Z + segmentDepth;
        boxBody(0.16, 0.62, segmentDepth, x, 0.55, -offset);
        boxBody(0.16, 0.62, segmentDepth, x, 0.55, offset);
        boxBody(0.16, 0.8, GOAL_HALF_Z + 0.16, side * (FIELD_HALF_X + 1.56), 0.72, 0);
        boxBody(0.8, 0.8, 0.12, side * (FIELD_HALF_X + 0.78), 0.72, -GOAL_HALF_Z - 0.08);
        boxBody(0.8, 0.8, 0.12, side * (FIELD_HALF_X + 0.78), 0.72, GOAL_HALF_Z + 0.08);
      }

      const playerBodies: PlayerBody[] = [];
      const kitMaterials: THREE.MeshStandardMaterial[] = [];
      for (let index = 0; index < 10; index += 1) {
        const team: ArenaTeam = index < 5 ? "home" : "away";
        const homeIndex = index % 5;
        const base = FORMATION_POINTS[latestRef.current.formation][homeIndex];
        const x = team === "home" ? base[0] : -base[0];
        const z = base[1];
        const half = new Ammo.btVector3(0.5, 0.65, 0.5);
        const shape = new Ammo.btCylinderShape(half);
        Ammo.destroy(half);
        const body = createBody(shape, 4.2, x, PLAYER_Y, z);
        const planeFactor = new Ammo.btVector3(1, 0, 1);
        const lockRotation = new Ammo.btVector3(0, 0, 0);
        body.setLinearFactor(planeFactor);
        body.setAngularFactor(lockRotation);
        body.setDamping(0.78, 1);
        body.setFriction(0.78);
        body.setRestitution(0.05);
        Ammo.destroy(planeFactor);
        Ammo.destroy(lockRotation);
        const { group, kit } = createPlayerMesh(
          team === "home" ? hexToNumber(latestRef.current.teamColor) : 0xff365d,
          team === "home" ? HOME_NUMBERS[homeIndex] : AWAY_NUMBERS[homeIndex],
          homeIndex === 0,
        );
        group.userData.playerIndex = index;
        group.traverse((object) => {
          object.userData.playerIndex = index;
        });
        scene.add(group);
        kitMaterials.push(kit);
        playerBodies.push({ body, mesh: group, team, index, homeIndex, facing: team === "home" ? 0 : Math.PI, kickCooldown: 0 });
      }

      const ballShape = new Ammo.btSphereShape(BALL_RADIUS);
      const ballBody = createBody(ballShape, 0.43, 0, BALL_RADIUS + 0.03, 0);
      ballBody.setFriction(0.54);
      ballBody.setRollingFriction(0.12);
      ballBody.setRestitution(0.67);
      ballBody.setDamping(0.065, 0.16);
      ballBody.setCcdMotionThreshold?.(0.18);
      ballBody.setCcdSweptSphereRadius?.(BALL_RADIUS * 0.72);

      const ballMesh = new THREE.Group();
      const ballSphere = new THREE.Mesh(
        new THREE.SphereGeometry(BALL_RADIUS, 24, 18),
        new THREE.MeshStandardMaterial({ color: 0xf4fff9, roughness: 0.42, metalness: 0.02 }),
      );
      ballSphere.castShadow = true;
      ballSphere.receiveShadow = true;
      ballMesh.add(ballSphere);
      const patchGeometry = new THREE.CircleGeometry(0.074, 6);
      const patchMaterial = new THREE.MeshStandardMaterial({ color: 0x07130f, roughness: 0.6, side: THREE.DoubleSide });
      for (const [x, y, z, rx, ry] of [
        [BALL_RADIUS, 0, 0, 0, Math.PI / 2],
        [-BALL_RADIUS, 0, 0, 0, -Math.PI / 2],
        [0, BALL_RADIUS, 0, -Math.PI / 2, 0],
        [0, 0, BALL_RADIUS, 0, 0],
        [0, 0, -BALL_RADIUS, 0, Math.PI],
      ] as number[][]) {
        const patch = new THREE.Mesh(patchGeometry, patchMaterial);
        patch.position.set(x, y, z);
        patch.rotation.set(rx, ry, 0);
        ballMesh.add(patch);
      }
      scene.add(ballMesh);

      const transform = new Ammo.btTransform();
      const velocity = new Ammo.btVector3(0, 0, 0);
      const zeroVector = new Ammo.btVector3(0, 0, 0);
      const impulse = new Ammo.btVector3(0, 0, 0);
      const resetOrigin = new Ammo.btVector3(0, 0, 0);
      const resetRotation = new Ammo.btQuaternion(0, 0, 0, 1);

      const getPosition = (body: AmmoBody) => {
        body.getMotionState().getWorldTransform(transform);
        const origin = transform.getOrigin();
        return { x: origin.x(), y: origin.y(), z: origin.z() };
      };

      const setBodyPosition = (body: AmmoBody, x: number, y: number, z: number) => {
        transform.setIdentity();
        resetOrigin.setValue(x, y, z);
        transform.setOrigin(resetOrigin);
        transform.setRotation(resetRotation);
        body.setWorldTransform(transform);
        body.getMotionState().setWorldTransform(transform);
        body.setLinearVelocity(zeroVector);
        body.setAngularVelocity(zeroVector);
        body.clearForces();
        body.activate(true);
      };

      let remaining = latestRef.current.duration * 60;
      let runtimeStats: ArenaStats = {
        homeShots: 0,
        awayShots: 0,
        homeSaves: 0,
        awaySaves: 0,
        homePasses: 0,
        awayPasses: 0,
        homePossession: 50,
      };
      let possession = { home: 0, away: 0 };
      let lastTouch: ArenaTeam | null = null;
      let lastResetSignal = latestRef.current.resetSignal;
      let lastFormation = latestRef.current.formation;
      let lastColor = latestRef.current.teamColor;
      let ended = false;
      let goalHandled = false;
      let goalTimer = 0;
      let previousBallX = 0;
      let accumulator = 0;
      let previousFrame = performance.now();
      let lastPublish = 0;
      let raf = 0;
      const aimPoint = new THREE.Vector3(10, 0, 0);
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const pitchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const projected = new THREE.Vector3();
      const cameraTarget = new THREE.Vector3();
      const particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; color: number }> = [];

      const resetMatch = (fullReset: boolean) => {
        if (goalTimer) window.clearTimeout(goalTimer);
        goalTimer = 0;
        goalHandled = false;
        ended = false;
        lastTouch = null;
        previousBallX = 0;
        if (fullReset) {
          remaining = latestRef.current.duration * 60;
          possession = { home: 0, away: 0 };
          runtimeStats = {
            homeShots: 0,
            awayShots: 0,
            homeSaves: 0,
            awaySaves: 0,
            homePasses: 0,
            awayPasses: 0,
            homePossession: 50,
          };
          latestRef.current.onTimeChange(remaining);
          latestRef.current.onStatsChange({ ...runtimeStats });
        }
        const points = FORMATION_POINTS[latestRef.current.formation];
        playerBodies.forEach((player) => {
          const [homeX, z] = points[player.homeIndex];
          setBodyPosition(player.body, player.team === "home" ? homeX : -homeX, PLAYER_Y, z);
          player.facing = player.team === "home" ? 0 : Math.PI;
          player.kickCooldown = 0;
        });
        setBodyPosition(ballBody, 0, BALL_RADIUS + 0.03, 0);
        aimPoint.set(10, 0, 0);
      };

      const spawnGoalParticles = (team: ArenaTeam) => {
        const random = seededRandom(Date.now());
        for (let index = 0; index < 74; index += 1) {
          const angle = random() * Math.PI * 2;
          const speed = 80 + random() * 210;
          particles.push({
            x: pixiApp.screen.width / 2,
            y: pixiApp.screen.height / 2,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 40,
            life: 0.65 + random() * 0.8,
            color: team === "home" ? (random() > 0.45 ? 0x19e7b0 : 0xf1fff9) : (random() > 0.45 ? 0xff365d : 0xffd451),
          });
        }
      };

      const kick = (player: PlayerBody, targetX: number, targetZ: number, power: number, isPass: boolean) => {
        const playerPosition = getPosition(player.body);
        const ballPosition = getPosition(ballBody);
        const dx = ballPosition.x - playerPosition.x;
        const dz = ballPosition.z - playerPosition.z;
        if (Math.hypot(dx, dz) > 1.42 || player.kickCooldown > 0) return false;
        const targetDx = targetX - ballPosition.x;
        const targetDz = targetZ - ballPosition.z;
        const length = Math.max(0.001, Math.hypot(targetDx, targetDz));
        const lift = isPass ? 0.42 : 0.92;
        impulse.setValue((targetDx / length) * power, lift, (targetDz / length) * power);
        ballBody.applyCentralImpulse(impulse);
        ballBody.activate(true);
        player.facing = Math.atan2(targetDz, targetDx);
        player.kickCooldown = isPass ? 0.32 : 0.48;
        lastTouch = player.team;
        if (player.team === "home") {
          if (isPass) runtimeStats.homePasses += 1;
          else runtimeStats.homeShots += 1;
        } else if (isPass) runtimeStats.awayPasses += 1;
        else runtimeStats.awayShots += 1;
        latestRef.current.onKick?.();
        return true;
      };

      const nearestOutfield = (team: ArenaTeam, ballPosition: { x: number; z: number }) => {
        let best = team === "home" ? 1 : 6;
        let bestDistance = Number.POSITIVE_INFINITY;
        playerBodies.forEach((player) => {
          if (player.team !== team || player.homeIndex === 0) return;
          const position = getPosition(player.body);
          const value = Math.hypot(position.x - ballPosition.x, position.z - ballPosition.z);
          if (value < bestDistance) {
            best = player.index;
            bestDistance = value;
          }
        });
        return best;
      };

      const setPlayerVelocity = (player: PlayerBody, targetX: number, targetZ: number, speed: number) => {
        const position = getPosition(player.body);
        const dx = targetX - position.x;
        const dz = targetZ - position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.08) {
          const scaled = Math.min(speed, distance * 3.2);
          velocity.setValue((dx / distance) * scaled, 0, (dz / distance) * scaled);
          player.body.setLinearVelocity(velocity);
          player.facing = Math.atan2(dz, dx);
        } else {
          player.body.setLinearVelocity(zeroVector);
        }
        player.body.activate(true);
      };

      const runFixedStep = () => {
        const current = latestRef.current;
        if (current.phase !== "playing" || goalHandled || ended) return;
        remaining = Math.max(0, remaining - FIXED_STEP);
        if (remaining <= 0) {
          ended = true;
          current.onTimeChange(0);
          current.onMatchEnd();
          return;
        }

        const ballPosition = getPosition(ballBody);
        const homeChaser = nearestOutfield("home", ballPosition);
        const awayChaser = nearestOutfield("away", ballPosition);
        const difficultyTuning = {
          新秀: { speed: 4.15, pressure: 0.84, shot: 4.25 },
          职业: { speed: 5.15, pressure: 0.96, shot: 5.1 },
          传奇: { speed: 6.05, pressure: 1.08, shot: 5.8 },
        }[current.difficulty];

        playerBodies.forEach((player) => {
          player.kickCooldown = Math.max(0, player.kickCooldown - FIXED_STEP);
          const base = FORMATION_POINTS[current.formation][player.homeIndex];
          const side = player.team === "home" ? 1 : -1;
          const isSelected = player.team === "home" && player.homeIndex === current.selected;
          if (isSelected) {
            const keys = current.keysRef.current;
            const horizontal = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft"));
            const vertical = Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup"));
            const length = Math.hypot(horizontal, vertical);
            if (length > 0) {
              const selectedSpeed = 6.45;
              velocity.setValue((horizontal / length) * selectedSpeed, 0, (vertical / length) * selectedSpeed);
              player.body.setLinearVelocity(velocity);
              player.body.activate(true);
              player.facing = Math.atan2(vertical, horizontal);
            } else {
              player.body.setLinearVelocity(zeroVector);
            }
            if (current.shootRef.current) {
              kick(player, aimPoint.x, aimPoint.z, 5.9, false);
              current.shootRef.current = false;
            }
            if (current.passRef.current) {
              const candidates = playerBodies
                .filter((candidate) => candidate.team === "home" && candidate.homeIndex !== player.homeIndex)
                .map((candidate) => ({ candidate, position: getPosition(candidate.body) }))
                .sort((a, b) => {
                  const aScore = Math.hypot(a.position.x - ballPosition.x, a.position.z - ballPosition.z) - a.position.x * 0.28;
                  const bScore = Math.hypot(b.position.x - ballPosition.x, b.position.z - ballPosition.z) - b.position.x * 0.28;
                  return aScore - bScore;
                });
              const receiver = candidates[0]?.position ?? { x: 7, z: 0 };
              kick(player, receiver.x, receiver.z, 3.55, true);
              current.passRef.current = false;
            }
            return;
          }

          if (player.homeIndex === 0) {
            const keeperX = side * -14.35;
            const keeperZ = clamp(ballPosition.z, -2.35, 2.35);
            setPlayerVelocity(player, keeperX, keeperZ, player.team === "home" ? 4.3 : difficultyTuning.speed * 0.88);
            const playerPosition = getPosition(player.body);
            if (Math.hypot(playerPosition.x - ballPosition.x, playerPosition.z - ballPosition.z) < 1.25 && player.kickCooldown <= 0) {
              const cleared = kick(player, side * 11.5, clamp(-ballPosition.z * 0.4, -5, 5), 4.7, false);
              if (cleared) {
                if (player.team === "home") runtimeStats.homeSaves += 1;
                else runtimeStats.awaySaves += 1;
              }
            }
            return;
          }

          const chaser = player.team === "home" ? homeChaser : awayChaser;
          const shouldChase = player.index === chaser && (player.team === "away" || ballPosition.x < 7.5);
          if (shouldChase) {
            const leadX = ballPosition.x + (player.team === "home" ? -0.16 : 0.16);
            setPlayerVelocity(
              player,
              leadX,
              ballPosition.z,
              player.team === "home" ? 4.85 : difficultyTuning.speed * difficultyTuning.pressure,
            );
            const playerPosition = getPosition(player.body);
            const close = Math.hypot(playerPosition.x - ballPosition.x, playerPosition.z - ballPosition.z) < 1.34;
            if (close && player.team === "away" && player.kickCooldown <= 0) {
              const nearGoal = ballPosition.x < -6.5;
              kick(
                player,
                nearGoal ? -17.2 : ballPosition.x - 7.5,
                nearGoal ? clamp(-ballPosition.z * 0.16, -2.1, 2.1) : clamp(ballPosition.z * 0.45, -5.6, 5.6),
                nearGoal ? difficultyTuning.shot : 3.35,
                !nearGoal,
              );
            }
          } else {
            const ballShift = clamp(ballPosition.x * 0.16, -2.8, 2.8);
            const targetX = side === 1 ? base[0] + ballShift : -base[0] + ballShift;
            const targetZ = clamp(base[1] + ballPosition.z * 0.1, -7.7, 7.7);
            setPlayerVelocity(player, targetX, targetZ, player.team === "home" ? 4.05 : difficultyTuning.speed * 0.78);
          }
        });

        world.stepSimulation(FIXED_STEP, 2, FIXED_STEP);
        const afterBall = getPosition(ballBody);
        if (afterBall.y < -0.5 || Math.abs(afterBall.z) > 13 || Math.abs(afterBall.x) > 20) {
          setBodyPosition(ballBody, clamp(afterBall.x, -8, 8), BALL_RADIUS + 0.03, clamp(afterBall.z, -5, 5));
        }

        const homeNearest = playerBodies
          .filter((player) => player.team === "home")
          .reduce((best, player) => {
            const position = getPosition(player.body);
            return Math.min(best, Math.hypot(position.x - afterBall.x, position.z - afterBall.z));
          }, Number.POSITIVE_INFINITY);
        const awayNearest = playerBodies
          .filter((player) => player.team === "away")
          .reduce((best, player) => {
            const position = getPosition(player.body);
            return Math.min(best, Math.hypot(position.x - afterBall.x, position.z - afterBall.z));
          }, Number.POSITIVE_INFINITY);
        if (lastTouch === "home" || homeNearest + 0.12 < awayNearest) possession.home += FIXED_STEP;
        else possession.away += FIXED_STEP;
        const totalPossession = possession.home + possession.away;
        runtimeStats.homePossession = totalPossession > 0 ? Math.round((possession.home / totalPossession) * 100) : 50;

        const homeGoal = previousBallX <= FIELD_HALF_X && afterBall.x > FIELD_HALF_X && Math.abs(afterBall.z) < GOAL_HALF_Z;
        const awayGoal = previousBallX >= -FIELD_HALF_X && afterBall.x < -FIELD_HALF_X && Math.abs(afterBall.z) < GOAL_HALF_Z;
        previousBallX = afterBall.x;
        if (homeGoal || awayGoal) {
          const scoringTeam: ArenaTeam = homeGoal ? "home" : "away";
          goalHandled = true;
          spawnGoalParticles(scoringTeam);
          current.onGoal(scoringTeam);
          goalTimer = window.setTimeout(() => {
            resetMatch(false);
            latestRef.current.onResumeAfterGoal();
          }, 1450);
        }
      };

      const projectToPixi = (position: THREE.Vector3) => {
        projected.copy(position).project(camera);
        return {
          x: (projected.x * 0.5 + 0.5) * pixiApp.screen.width,
          y: (-projected.y * 0.5 + 0.5) * pixiApp.screen.height,
        };
      };

      const renderHud = (delta: number) => {
        hud.clear();
        const selectedPlayer = playerBodies[clamp(latestRef.current.selected, 0, 4)];
        if (selectedPlayer) {
          const position = getPosition(selectedPlayer.body);
          const ringPoint = projectToPixi(new THREE.Vector3(position.x, 0.06, position.z));
          const aim = projectToPixi(new THREE.Vector3(aimPoint.x, 0.06, aimPoint.z));
          const pulse = 14 + Math.sin(performance.now() * 0.006) * 2.2;
          hud.circle(ringPoint.x, ringPoint.y, pulse).stroke({ color: hexToNumber(latestRef.current.teamColor), width: 2.5, alpha: 0.95 });
          hud.circle(ringPoint.x, ringPoint.y, pulse + 5).stroke({ color: 0xe9fff8, width: 1, alpha: 0.32 });
          hud.moveTo(ringPoint.x, ringPoint.y).lineTo(aim.x, aim.y).stroke({ color: 0x8cffe0, width: 1.2, alpha: 0.36 });
          hud.circle(aim.x, aim.y, 6).stroke({ color: 0xeafff8, width: 1.5, alpha: 0.72 });
        }

        playerBodies.forEach((player, index) => {
          const position = getPosition(player.body);
          const screen = projectToPixi(new THREE.Vector3(position.x, 2.18, position.z));
          playerLabels[index].position.set(screen.x, screen.y);
          playerLabels[index].alpha = latestRef.current.phase === "ready" ? 0.72 : 1;
        });

        for (let index = particles.length - 1; index >= 0; index -= 1) {
          const particle = particles[index];
          particle.life -= delta;
          if (particle.life <= 0) {
            particles.splice(index, 1);
            continue;
          }
          particle.vy += 180 * delta;
          particle.x += particle.vx * delta;
          particle.y += particle.vy * delta;
          hud.circle(particle.x, particle.y, Math.max(1.5, particle.life * 3.2)).fill({ color: particle.color, alpha: clamp(particle.life, 0, 0.9) });
        }
        pixiApp.render();
      };

      const syncMeshes = () => {
        playerBodies.forEach((player) => {
          const position = getPosition(player.body);
          player.mesh.position.set(position.x, 0, position.z);
          player.mesh.rotation.y = -player.facing;
        });
        ballBody.getMotionState().getWorldTransform(transform);
        const origin = transform.getOrigin();
        const rotation = transform.getRotation();
        ballMesh.position.set(origin.x(), origin.y(), origin.z());
        ballMesh.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
      };

      const animate = (now: number) => {
        if (disposed) return;
        const delta = Math.min(0.05, Math.max(0, (now - previousFrame) / 1000));
        previousFrame = now;
        const current = latestRef.current;
        if (current.resetSignal !== lastResetSignal) {
          lastResetSignal = current.resetSignal;
          lastFormation = current.formation;
          resetMatch(true);
        } else if (current.formation !== lastFormation && current.phase !== "playing") {
          lastFormation = current.formation;
          resetMatch(false);
        }
        if (current.teamColor !== lastColor) {
          lastColor = current.teamColor;
          const color = hexToNumber(lastColor);
          kitMaterials.slice(0, 5).forEach((material) => material.color.setHex(color));
        }

        if (current.phase === "playing") {
          accumulator = Math.min(accumulator + delta, FIXED_STEP * 5);
          while (accumulator >= FIXED_STEP) {
            runFixedStep();
            accumulator -= FIXED_STEP;
          }
        } else {
          accumulator = 0;
        }
        syncMeshes();

        const selectedPosition = getPosition(playerBodies[clamp(current.selected, 0, 4)].body);
        const targetCameraX = selectedPosition.x * 0.1;
        camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCameraX, 0.025);
        cameraTarget.set(targetCameraX * 0.35, 0, 0);
        camera.lookAt(cameraTarget);
        renderer.render(scene, camera);
        renderHud(delta);

        if (now - lastPublish > 140) {
          lastPublish = now;
          current.onTimeChange(remaining);
          current.onStatsChange({ ...runtimeStats });
        }
        raf = requestAnimationFrame(animate);
      };

      const setAimFromPointer = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        raycaster.ray.intersectPlane(pitchPlane, aimPoint);
        aimPoint.x = clamp(aimPoint.x, -FIELD_HALF_X, FIELD_HALF_X);
        aimPoint.z = clamp(aimPoint.z, -FIELD_HALF_Z, FIELD_HALF_Z);
      };

      const onPointerMove = (event: PointerEvent) => {
        if (event.pointerType === "mouse" || event.buttons > 0) setAimFromPointer(event);
      };
      const onPointerDown = (event: PointerEvent) => {
        setAimFromPointer(event);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(playerBodies.slice(0, 5).map((player) => player.mesh), true)[0];
        const playerIndex = hit?.object.userData.playerIndex;
        if (typeof playerIndex === "number" && playerIndex < 5) {
          latestRef.current.onSelectedChange(playerIndex);
        }
        renderer.domElement.focus({ preventScroll: true });
      };
      renderer.domElement.addEventListener("pointermove", onPointerMove);
      renderer.domElement.addEventListener("pointerdown", onPointerDown);

      const resize = () => {
        const width = Math.max(1, surface.clientWidth);
        const height = Math.max(1, surface.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        pixiApp.renderer.resize(width, height);
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(surface);
      resize();
      resetMatch(false);

      setBootState("ready");
      latestRef.current.onEngineState("ready");
      previousFrame = performance.now();
      raf = requestAnimationFrame(animate);

      destroyEngine = () => {
        if (goalTimer) window.clearTimeout(goalTimer);
        cancelAnimationFrame(raf);
        resizeObserver.disconnect();
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        ammoBodies.forEach((body) => {
          world.removeRigidBody(body);
          const motionState = body.getMotionState();
          if (motionState) Ammo.destroy(motionState);
          Ammo.destroy(body);
        });
        ammoShapes.forEach((shape) => Ammo.destroy(shape));
        [transform, velocity, zeroVector, impulse, resetOrigin, resetRotation, gravity, world, solver, broadphase, dispatcher, collisionConfig]
          .forEach((object) => Ammo.destroy(object));
        pixiApp.destroy({ removeView: true }, { children: true });
        scene.traverse((object) => {
          const drawable = object as THREE.Mesh;
          drawable.geometry?.dispose?.();
          if (Array.isArray(drawable.material)) drawable.material.forEach((material) => material.dispose());
          else drawable.material?.dispose?.();
        });
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    };

    boot().catch((error: unknown) => {
      if (disposed) return;
      console.error("3D engine failed to boot", error);
      const detail = error instanceof Error ? error.message : "未知初始化错误";
      setBootMessage(`初始化失败：${detail}`);
      setBootState("error");
      latestRef.current.onEngineState("error");
    });

    return () => {
      disposed = true;
      destroyEngine();
    };
  }, []);

  return (
    <div className="three-arena" data-engine-state={bootState}>
      <div className="three-surface" ref={surfaceRef} />
      <div className="engine-tech-pills" aria-label="3D 引擎技术栈">
        <span>THREE.JS</span>
        <span>AMMO PHYSICS</span>
        <span>PIXI FX</span>
      </div>
      {bootState !== "ready" && (
        <div className={`engine-loader ${bootState === "error" ? "error" : ""}`} role="status">
          <strong>{bootState === "error" ? "ENGINE OFFLINE" : "3D ENGINE SYNC"}</strong>
          <span>{bootMessage}</span>
        </div>
      )}
    </div>
  );
}
