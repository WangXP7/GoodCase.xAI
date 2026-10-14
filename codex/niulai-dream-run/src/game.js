import * as THREE from "../vendor/three.module.min.js";

const COLORS = {
  ink: 0x102c27,
  deepInk: 0x071915,
  jade: 0x2f8f7d,
  jadeLight: 0x87c9b8,
  paper: 0xeee9da,
  paperWarm: 0xd8cfb9,
  ochre: 0xd99a3a,
  vermilion: 0xb83b2e,
  gold: 0xe9c777,
  horn: 0x564d42,
  muzzle: 0xe4bca0,
  hoof: 0x2c211c
};

const FINISH_DISTANCE = 820;
const CHAPTERS = [
  {
    kicker: "第一梦",
    name: "草原初醒",
    title: "草原初醒",
    copy: "云雀落在晨雾里。牛来第一次明白，启程并不是离开熟悉之地，而是愿意看见更远的自己。",
    mission: "循着青色梦路前行",
    start: 0,
    speed: 13,
    palette: { sky: 0x9ebdad, fog: 0x9ebdad, ground: 0x183f35, leaf: 0x235f4c, mountain: 0x5e7b6c, road: 0xffffff, sun: 0xffe3b0 }
  },
  {
    kicker: "第二梦",
    name: "荒漠问心",
    title: "荒漠问心",
    copy: "风会吹散脚印，却吹不散已经做出的选择。别追问勇气从哪里来——先跨出下一步。",
    mission: "避开风蚀山石，追随金色云羽",
    start: 240,
    speed: 14.5,
    palette: { sky: 0xd3ae73, fog: 0xd3b986, ground: 0x68492f, leaf: 0x735c36, mountain: 0x9a764e, road: 0xf0d7a5, sun: 0xffc468 }
  },
  {
    kicker: "第三梦",
    name: "墨云天关",
    title: "墨云天关",
    copy: "暗影没有名字，它只是每一次退缩留下的形状。穿过去，天光就在云背后。",
    mission: "以踏风击碎暗影，抵达天光",
    start: 520,
    speed: 16,
    palette: { sky: 0xc6d4ca, fog: 0xbaccc3, ground: 0x162d29, leaf: 0x193e37, mountain: 0x566d66, road: 0xdbe7dd, sun: 0xeef5df }
  }
];

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function makeInkTexture(seed = 7) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  const random = seededRandom(seed);

  context.fillStyle = "#d8cfb9";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const paper = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  paper.addColorStop(0, "rgba(255,252,236,.46)");
  paper.addColorStop(0.48, "rgba(93,149,127,.08)");
  paper.addColorStop(1, "rgba(242,226,190,.28)");
  context.fillStyle = paper;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 13; i += 1) {
    context.beginPath();
    const x = 128 + random() * 256;
    const width = 35 + random() * 110;
    context.moveTo(x, -40);
    for (let y = -40; y <= 1080; y += 85) {
      context.quadraticCurveTo(
        x + (random() - 0.5) * 180,
        y + 38,
        x + (random() - 0.5) * 95,
        y + 88
      );
    }
    context.lineWidth = width;
    context.lineCap = "round";
    context.strokeStyle = i % 3 === 0 ? "rgba(13,42,35,.14)" : "rgba(37,126,108,.14)";
    context.stroke();
  }

  for (let i = 0; i < 3300; i += 1) {
    const alpha = 0.012 + random() * 0.035;
    context.fillStyle = `rgba(17,47,38,${alpha})`;
    context.fillRect(random() * 512, random() * 1024, 0.5 + random() * 1.5, 0.5 + random() * 1.5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function makeSoftCircleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 60);
  gradient.addColorStop(0, "rgba(4,18,15,.5)");
  gradient.addColorStop(0.5, "rgba(4,18,15,.22)");
  gradient.addColorStop(1, "rgba(4,18,15,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function mesh(geometry, material, { position, rotation, scale, cast = true, receive = false } = {}) {
  const value = new THREE.Mesh(geometry, material);
  if (position) value.position.set(...position);
  if (rotation) value.rotation.set(...rotation);
  if (scale) value.scale.set(...scale);
  value.castShadow = cast;
  value.receiveShadow = receive;
  return value;
}

function createBull(materials) {
  const bull = new THREE.Group();
  bull.name = "牛来";

  const torso = mesh(new THREE.SphereGeometry(0.72, 16, 12), materials.fur, {
    position: [0, 1.55, 0],
    scale: [0.92, 1.22, 0.66]
  });
  bull.add(torso);

  const belly = mesh(new THREE.SphereGeometry(0.54, 14, 10), materials.belly, {
    position: [0, 1.48, 0.44],
    scale: [0.8, 1.06, 0.2]
  });
  bull.add(belly);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 2.58, 0.04);
  bull.add(headPivot);

  const head = mesh(new THREE.SphereGeometry(0.7, 16, 12), materials.fur, {
    scale: [1.05, 0.9, 0.88]
  });
  headPivot.add(head);

  const muzzle = mesh(new THREE.SphereGeometry(0.44, 16, 10), materials.muzzle, {
    position: [0, -0.15, -0.56],
    scale: [1.12, 0.65, 0.58]
  });
  headPivot.add(muzzle);

  const nose = mesh(new THREE.SphereGeometry(0.22, 12, 8), materials.nose, {
    position: [0, -0.04, -0.8],
    scale: [1.12, 0.58, 0.3]
  });
  headPivot.add(nose);

  [-1, 1].forEach((side) => {
    const nostril = mesh(new THREE.SphereGeometry(0.035, 8, 6), materials.dark, {
      position: [side * 0.09, -0.01, -0.87],
      scale: [1.25, 0.7, 0.35]
    });
    headPivot.add(nostril);

    const eyeWhite = mesh(new THREE.SphereGeometry(0.14, 10, 8), materials.eyeWhite, {
      position: [side * 0.27, 0.17, -0.6],
      scale: [1.12, 0.78, 0.28]
    });
    const pupil = mesh(new THREE.SphereGeometry(0.07, 8, 6), materials.dark, {
      position: [side * 0.265, 0.16, -0.715],
      scale: [0.8, 1, 0.4]
    });
    headPivot.add(eyeWhite, pupil);

    const brow = mesh(new THREE.BoxGeometry(0.3, 0.045, 0.04), materials.dark, {
      position: [side * 0.27, 0.36, -0.655],
      rotation: [0, 0, side * -0.14]
    });
    headPivot.add(brow);

    const ear = mesh(new THREE.ConeGeometry(0.18, 0.48, 4), materials.fur, {
      position: [side * 0.67, 0.12, -0.02],
      rotation: [0, 0, side * -1.15],
      scale: [1, 1, 0.42]
    });
    const earInner = mesh(new THREE.ConeGeometry(0.1, 0.31, 4), materials.ear, {
      position: [side * 0.73, 0.12, -0.08],
      rotation: [0, 0, side * -1.15],
      scale: [1, 1, 0.38]
    });
    headPivot.add(ear, earInner);

    const horn = mesh(new THREE.ConeGeometry(0.12, 0.58, 8), materials.horn, {
      position: [side * 0.43, 0.55, -0.02],
      rotation: [0.1, 0, side * -0.36]
    });
    headPivot.add(horn);
  });

  const scarf = mesh(new THREE.TorusGeometry(0.55, 0.09, 7, 24), materials.scarf, {
    position: [0, 2.16, 0],
    rotation: [Math.PI / 2, 0, 0]
  });
  bull.add(scarf);

  const scarfTail = mesh(new THREE.BoxGeometry(0.2, 0.75, 0.08, 2, 4), materials.scarf, {
    position: [0.45, 1.95, 0.23],
    rotation: [0.1, 0.1, -0.35]
  });
  bull.add(scarfTail);

  const limbGeometry = new THREE.CapsuleGeometry(0.12, 0.56, 4, 8);
  const hoofGeometry = new THREE.SphereGeometry(0.16, 10, 7);
  const armPivots = [];
  const legPivots = [];

  [-1, 1].forEach((side) => {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.66, 1.86, 0);
    armPivot.rotation.z = side * -0.08;
    armPivot.add(mesh(limbGeometry, materials.fur, { position: [0, -0.36, 0] }));
    armPivot.add(mesh(hoofGeometry, materials.hoof, {
      position: [0, -0.77, -0.02],
      scale: [0.84, 1.02, 0.84]
    }));
    bull.add(armPivot);
    armPivots.push(armPivot);

    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.32, 0.95, 0);
    legPivot.add(mesh(limbGeometry, materials.fur, { position: [0, -0.39, 0] }));
    legPivot.add(mesh(hoofGeometry, materials.hoof, {
      position: [0, -0.82, -0.09],
      scale: [1.05, 0.72, 1.34]
    }));
    bull.add(legPivot);
    legPivots.push(legPivot);
  });

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 1.55, 0.52);
  const tail = mesh(new THREE.CapsuleGeometry(0.045, 0.5, 3, 6), materials.fur, {
    position: [0, -0.25, 0.12],
    rotation: [0.35, 0, 0.38]
  });
  tailPivot.add(tail);
  bull.add(tailPivot);

  bull.userData = { headPivot, scarfTail, armPivots, legPivots, tailPivot };
  bull.scale.setScalar(0.92);
  return bull;
}

function createSkylark(materials) {
  const bird = new THREE.Group();
  bird.name = "云雀";
  const body = mesh(new THREE.SphereGeometry(0.17, 10, 7), materials.bird, {
    scale: [0.85, 0.72, 1.45]
  });
  const head = mesh(new THREE.SphereGeometry(0.12, 9, 7), materials.birdLight, {
    position: [0, 0.08, -0.2]
  });
  const beak = mesh(new THREE.ConeGeometry(0.045, 0.18, 6), materials.gold, {
    position: [0, 0.07, -0.35],
    rotation: [-Math.PI / 2, 0, 0]
  });
  const wingGeometry = new THREE.ConeGeometry(0.2, 0.55, 5);
  const leftWing = mesh(wingGeometry, materials.birdLight, {
    position: [-0.19, 0, 0],
    rotation: [0, 0, Math.PI / 2]
  });
  const rightWing = mesh(wingGeometry, materials.birdLight, {
    position: [0.19, 0, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  bird.add(body, head, beak, leftWing, rightWing);
  bird.userData = { leftWing, rightWing };
  return bird;
}

function createMountain(material, random) {
  const group = new THREE.Group();
  const pieces = 2 + Math.floor(random() * 3);
  for (let i = 0; i < pieces; i += 1) {
    const radius = 1.2 + random() * 2.4;
    const mountain = mesh(new THREE.ConeGeometry(radius, radius * (1.2 + random()), 7), material, {
      position: [(i - pieces / 2) * radius * 0.85, radius * 0.53, (random() - 0.5) * 2],
      rotation: [0, random() * Math.PI, 0],
      scale: [1, 1, 0.72],
      cast: false,
      receive: true
    });
    group.add(mountain);
  }
  return group;
}

function createTree(materials, random) {
  const group = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.13, 0.22, 1.6, 6), materials.trunk, {
    position: [0, 0.8, 0],
    rotation: [(random() - 0.5) * 0.08, 0, (random() - 0.5) * 0.15]
  });
  const crown = mesh(new THREE.IcosahedronGeometry(0.78 + random() * 0.3, 1), materials.leaf, {
    position: [0, 1.8, 0],
    scale: [0.85, 1.25, 0.78]
  });
  group.add(trunk, crown);
  return group;
}

export class NiuLaiGame extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.state = "ready";
    this.elapsed = 0;
    this.distance = 0;
    this.feathers = 0;
    this.health = 3;
    this.score = 0;
    this.bonusScore = 0;
    this.currentChapter = 0;
    this.finishDistance = FINISH_DISTANCE;
    this.speed = 0;
    this.baseSpeed = 13;
    this.lane = 0;
    this.laneWidth = 2.62;
    this.groundY = 0.12;
    this.verticalVelocity = 0;
    this.isGrounded = true;
    this.dashDuration = 0;
    this.dashCooldown = 0;
    this.dashCooldownTotal = 4.5;
    this.invulnerability = 0;
    this.cameraShake = 0;
    this.autoSpawn = !new URLSearchParams(window.location.search).has("test");
    this.runNumber = 0;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ebdad);
    this.scene.fog = new THREE.FogExp2(0x9ebdad, 0.017);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
    this.camera.position.set(0, 5.4, 10.5);
    this.camera.lookAt(0, 1.15, -10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();
    this.materials = this.#createMaterials();
    this.#createGameplayAssets();
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.#createLights();
    this.#createWorld();
    this.#createHero();

    this.boundResize = () => this.resize();
    this.boundKeyDown = (event) => this.#handleKeyDown(event);
    window.addEventListener("resize", this.boundResize);
    window.addEventListener("keydown", this.boundKeyDown, { passive: false });
    this.resize();
    this.renderer.setAnimationLoop(() => this.#frame());

    requestAnimationFrame(() => this.#emitUpdate());
  }

  #createMaterials() {
    const standard = (color, options = {}) => new THREE.MeshStandardMaterial({
      color,
      roughness: 0.84,
      metalness: 0,
      flatShading: options.flatShading ?? true,
      transparent: options.transparent,
      opacity: options.opacity,
      side: options.side
    });
    return {
      fur: standard(COLORS.ochre),
      belly: standard(0xe9c373),
      muzzle: standard(COLORS.muzzle, { flatShading: false }),
      nose: standard(0xc68e77, { flatShading: false }),
      dark: standard(COLORS.deepInk, { flatShading: false }),
      eyeWhite: standard(0xfff7e5, { flatShading: false }),
      ear: standard(0xe7a98f, { flatShading: false }),
      horn: standard(COLORS.horn),
      hoof: standard(COLORS.hoof),
      scarf: standard(COLORS.vermilion),
      bird: standard(COLORS.gold),
      birdLight: standard(0xffe6a3),
      gold: standard(COLORS.gold),
      trunk: standard(0x3c3028),
      leaf: standard(0x235f4c),
      mountain: standard(0x5e7b6c),
      mountainFar: standard(0x78998b),
      stone: standard(0x53665c),
      roadEdge: standard(0x183f35)
    };
  }

  #createGameplayAssets() {
    this.obstacles = [];
    this.collectibles = [];
    this.effects = [];
    this.gameplayLayer = new THREE.Group();
    this.gameplayLayer.name = "跑酷物件";
    this.scene.add(this.gameplayLayer);
    this.spawnTimer = 2.4;
    this.patternIndex = 0;
    this.random = seededRandom(20260805);

    this.gameMaterials = {
      stone: new THREE.MeshStandardMaterial({ color: 0x586961, roughness: 0.96, flatShading: true }),
      stoneLight: new THREE.MeshStandardMaterial({ color: 0x829187, roughness: 1, flatShading: true }),
      wood: new THREE.MeshStandardMaterial({ color: 0x5b3523, roughness: 1, flatShading: true }),
      bark: new THREE.MeshStandardMaterial({ color: 0x2f211b, roughness: 1, flatShading: true }),
      shadow: new THREE.MeshStandardMaterial({
        color: 0x13221f,
        emissive: 0x102d27,
        emissiveIntensity: 0.75,
        roughness: 0.68,
        transparent: true,
        opacity: 0.92,
        flatShading: true
      }),
      shadowCore: new THREE.MeshBasicMaterial({ color: 0x74c2b0, transparent: true, opacity: 0.54 }),
      feather: new THREE.MeshStandardMaterial({ color: COLORS.gold, emissive: 0x4e3510, emissiveIntensity: 0.45, roughness: 0.58 }),
      featherLight: new THREE.MeshStandardMaterial({ color: 0xfff0bd, emissive: 0x6e5122, emissiveIntensity: 0.5, roughness: 0.5 }),
      hit: new THREE.MeshBasicMaterial({ color: COLORS.vermilion }),
      sparkle: new THREE.MeshBasicMaterial({ color: COLORS.gold }),
      wind: new THREE.MeshBasicMaterial({ color: COLORS.jadeLight })
    };

    this.gameGeometry = {
      stone: new THREE.DodecahedronGeometry(0.62, 0),
      pebble: new THREE.DodecahedronGeometry(0.26, 0),
      log: new THREE.CylinderGeometry(0.34, 0.42, 1.65, 8),
      branch: new THREE.CylinderGeometry(0.08, 0.12, 0.75, 6),
      shadow: new THREE.IcosahedronGeometry(0.72, 1),
      shadowCore: new THREE.OctahedronGeometry(0.35, 0),
      featherVane: new THREE.ConeGeometry(0.19, 0.68, 5),
      featherShaft: new THREE.CylinderGeometry(0.018, 0.028, 0.72, 6),
      shard: new THREE.TetrahedronGeometry(0.09, 0)
    };
  }

  #createLights() {
    const hemisphere = new THREE.HemisphereLight(0xf2ead4, 0x193d31, 2.2);
    this.hemisphere = hemisphere;
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xffe3b0, 3.4);
    sun.position.set(-7, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -5;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 45;
    sun.shadow.bias = -0.0006;
    this.sun = sun;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x76d1c0, 1.2);
    rim.position.set(8, 5, -8);
    this.scene.add(rim);
  }

  #createWorld() {
    const roadTexture = makeInkTexture(11);
    const roadMaterial = new THREE.MeshStandardMaterial({
      map: roadTexture,
      color: 0xffffff,
      roughness: 1,
      metalness: 0
    });
    this.roadMaterial = roadMaterial;
    this.roadTexture = roadTexture;

    const ground = mesh(new THREE.PlaneGeometry(150, 180), this.materials.roadEdge, {
      position: [0, -0.055, -62],
      rotation: [-Math.PI / 2, 0, 0],
      cast: false,
      receive: true
    });
    this.world.add(ground);

    const road = mesh(new THREE.PlaneGeometry(8.9, 180), roadMaterial, {
      position: [0, 0, -62],
      rotation: [-Math.PI / 2, 0, 0],
      cast: false,
      receive: true
    });
    this.world.add(road);

    const edgeGeometry = new THREE.BoxGeometry(0.12, 0.08, 180);
    [-4.52, 4.52].forEach((x) => {
      const edge = mesh(edgeGeometry, this.materials.gold, {
        position: [x, 0.025, -62],
        cast: false,
        receive: true
      });
      this.world.add(edge);
    });

    const shadowMaterial = new THREE.SpriteMaterial({ map: makeSoftCircleTexture(), transparent: true, depthWrite: false });
    this.heroShadow = new THREE.Sprite(shadowMaterial);
    this.heroShadow.position.set(0, 0.08, 2.45);
    this.heroShadow.scale.set(2.2, 1.05, 1);
    this.scene.add(this.heroShadow);

    this.scenery = new THREE.Group();
    this.world.add(this.scenery);
    const random = seededRandom(118);
    for (let i = 0; i < 20; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const tree = createTree(this.materials, random);
      tree.position.set(side * (6.2 + random() * 7), 0, 7 - i * 6.4 + random() * 3);
      tree.scale.setScalar(0.75 + random() * 1.35);
      tree.rotation.y = random() * Math.PI;
      this.scenery.add(tree);
    }

    for (let i = 0; i < 9; i += 1) {
      const mountain = createMountain(i > 4 ? this.materials.mountainFar : this.materials.mountain, random);
      const side = i % 2 === 0 ? -1 : 1;
      mountain.position.set(side * (11 + random() * 14), -0.02, -12 - i * 15);
      mountain.scale.setScalar(1.3 + random() * 2.2);
      this.scenery.add(mountain);
    }

    this.motes = this.#createMotes();
    this.scene.add(this.motes);

    this.sunDiscMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.vermilion,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide
    });
    this.sunDisc = mesh(new THREE.CircleGeometry(6.5, 48), this.sunDiscMaterial, {
      position: [-17, 13, -82],
      cast: false
    });
    this.scene.add(this.sunDisc);
  }

  #createMotes() {
    const count = 150;
    const positions = new Float32Array(count * 3);
    const random = seededRandom(45);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (random() - 0.5) * 32;
      positions[i * 3 + 1] = 0.7 + random() * 11;
      positions[i * 3 + 2] = 8 - random() * 95;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: COLORS.gold,
      size: 0.06,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    });
    return new THREE.Points(geometry, material);
  }

  #createHero() {
    this.hero = createBull(this.materials);
    this.hero.position.set(0, 0.12, 2.6);
    this.hero.rotation.y = Math.PI;
    this.scene.add(this.hero);

    this.skylark = createSkylark(this.materials);
    this.skylark.position.set(1.65, 4.05, 1.25);
    this.skylark.rotation.y = Math.PI;
    this.scene.add(this.skylark);

    this.dashAura = new THREE.Group();
    for (let index = 0; index < 3; index += 1) {
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: index === 1 ? COLORS.gold : COLORS.jadeLight,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const ring = mesh(new THREE.TorusGeometry(0.95 + index * 0.24, 0.035, 5, 28), ringMaterial, {
        position: [0, 1.52, 0.35 + index * 0.28],
        rotation: [Math.PI / 2, 0, 0],
        cast: false
      });
      this.dashAura.add(ring);
    }
    this.dashAura.position.copy(this.hero.position);
    this.scene.add(this.dashAura);
  }

  start() {
    if (this.state !== "ready" && this.state !== "gameover" && this.state !== "complete") return;
    this.state = "playing";
    this.distance = 0;
    this.feathers = 0;
    this.health = 3;
    this.score = 0;
    this.bonusScore = 0;
    this.speed = this.baseSpeed;
    this.currentChapter = 0;
    this.lane = 0;
    this.hero.position.x = 0;
    this.hero.position.y = this.groundY;
    this.verticalVelocity = 0;
    this.isGrounded = true;
    this.dashDuration = 0;
    this.dashCooldown = 0;
    this.invulnerability = 0;
    this.cameraShake = 0;
    this.spawnTimer = 2.2;
    this.patternIndex = 0;
    this.runNumber += 1;
    this.random = seededRandom(20260805 + this.runNumber * 97);
    this.#clearGameplayObjects();
    this.#applyChapter(0, true);
    this.#emit("statechange", { state: this.state });
    this.#emitUpdate();
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.#emit("statechange", { state: this.state });
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.clock.getDelta();
    this.#emit("statechange", { state: this.state });
  }

  restart() {
    this.state = "ready";
    this.start();
  }

  debugSpawnObstacle(lane = this.lane, type = "stone", distanceAhead = 6) {
    return this.#spawnObstacle(clamp(lane, -1, 1), type, this.hero.position.z - Math.max(1, distanceAhead));
  }

  debugSpawnFeather(lane = this.lane, distanceAhead = 4, height = 1.15) {
    return this.#spawnFeather(clamp(lane, -1, 1), this.hero.position.z - Math.max(1, distanceAhead), height);
  }

  debugClearGameplay() {
    this.#clearGameplayObjects();
  }

  debugAdvanceTo(distance) {
    this.distance = clamp(distance, 0, FINISH_DISTANCE + 1);
    this.score = this.distance * 10 + this.feathers * 100 + this.bonusScore;
    this.#emitUpdate();
  }

  continueChapter() {
    if (this.state !== "dialog") return false;
    this.state = "playing";
    this.speed = CHAPTERS[this.currentChapter].speed;
    this.spawnTimer = 1.7;
    this.clock.getDelta();
    this.#emit("statechange", { state: this.state });
    return true;
  }

  moveLeft() {
    if (this.state !== "playing") return false;
    const previous = this.lane;
    this.lane = clamp(this.lane - 1, -1, 1);
    if (previous !== this.lane) this.#emit("action", { type: "lane", lane: this.lane });
    return previous !== this.lane;
  }

  moveRight() {
    if (this.state !== "playing") return false;
    const previous = this.lane;
    this.lane = clamp(this.lane + 1, -1, 1);
    if (previous !== this.lane) this.#emit("action", { type: "lane", lane: this.lane });
    return previous !== this.lane;
  }

  jump() {
    if (this.state !== "playing" || !this.isGrounded) return false;
    this.verticalVelocity = 7.35;
    this.isGrounded = false;
    this.#emit("action", { type: "jump" });
    return true;
  }

  dash() {
    if (this.state !== "playing" || this.dashCooldown > 0) return false;
    this.dashDuration = 0.82;
    this.dashCooldown = this.dashCooldownTotal;
    this.#emit("action", { type: "dash" });
    return true;
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    const portrait = this.camera.aspect < 0.72;
    this.camera.fov = portrait ? 64 : 48;
    this.camera.position.y = portrait ? 5.8 : 5.4;
    this.camera.position.z = portrait ? 14.2 : 10.5;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, width < 700 ? 1.35 : 1.75));
  }

  getSnapshot() {
    const heroScreen = this.hero.position.clone().add(new THREE.Vector3(0, 1.45, 0)).project(this.camera);
    return {
      state: this.state,
      distance: Number(this.distance.toFixed(1)),
      feathers: this.feathers,
      health: this.health,
      score: Math.floor(this.score),
      speed: Number(this.speed.toFixed(2)),
      invulnerability: Number(this.invulnerability.toFixed(2)),
      chapter: this.currentChapter,
      chapterName: CHAPTERS[this.currentChapter].name,
      chapterKicker: CHAPTERS[this.currentChapter].kicker,
      journeyProgress: Number(clamp(this.distance / FINISH_DISTANCE, 0, 1).toFixed(4)),
      lane: this.lane,
      airborne: !this.isGrounded,
      dash: {
        active: this.dashDuration > 0,
        cooldown: Number(this.dashCooldown.toFixed(2)),
        ready: this.dashCooldown <= 0
      },
      objects: {
        obstacles: this.obstacles.length,
        feathers: this.collectibles.length,
        effects: this.effects.length
      },
      hero: {
        x: Number(this.hero.position.x.toFixed(2)),
        y: Number(this.hero.position.y.toFixed(2)),
        screenX: Number(heroScreen.x.toFixed(3)),
        screenY: Number(heroScreen.y.toFixed(3))
      },
      renderer: {
        width: this.renderer.domElement.width,
        height: this.renderer.domElement.height
      }
    };
  }

  #frame() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += delta;
    const active = this.state === "playing";

    if (active) {
      this.#updateMovement(delta);
      this.#updateGameplay(delta);
      this.distance += delta * this.speed * 0.24;
      this.score = this.distance * 10 + this.feathers * 100 + this.bonusScore;
      this.#updateProgression();
      this.roadTexture.offset.y -= delta * this.speed * 0.012;
      this.scenery.children.forEach((item, index) => {
        item.position.z += delta * this.speed * 0.24;
        if (item.position.z > 18) item.position.z -= 124 + (index % 4) * 7;
      });
    } else {
      this.roadTexture.offset.y -= delta * 0.007;
    }

    this.#animateHero(delta, active);
    this.#animateAtmosphere(delta, active);
    this.renderer.render(this.scene, this.camera);

    if (active && Math.floor(this.elapsed * 10) % 3 === 0) this.#emitUpdate();
  }

  #animateHero(delta, active) {
    const t = this.elapsed;
    const run = active ? Math.sin(t * 11) : Math.sin(t * 2.2) * 0.12;
    const idle = Math.sin(t * 2.2);
    const { armPivots, legPivots, headPivot, scarfTail, tailPivot } = this.hero.userData;
    armPivots[0].rotation.x = run * 0.72;
    armPivots[1].rotation.x = -run * 0.72;
    legPivots[0].rotation.x = -run * 0.78;
    legPivots[1].rotation.x = run * 0.78;
    headPivot.rotation.x = active ? Math.abs(run) * 0.045 : idle * 0.025;
    scarfTail.rotation.z = -0.35 + Math.sin(t * (active ? 8 : 2)) * 0.12;
    scarfTail.rotation.x = 0.1 + Math.cos(t * 5) * 0.05;
    tailPivot.rotation.z = Math.sin(t * 3.5) * 0.2;
    const runBounce = active && this.isGrounded ? Math.abs(run) * 0.055 : 0;
    if (this.isGrounded) this.hero.position.y = this.groundY + runBounce + (active ? 0 : idle * 0.018);
    this.hero.rotation.z = lerp(this.hero.rotation.z, (this.lane * this.laneWidth - this.hero.position.x) * -0.11, clamp(delta * 9, 0, 1));

    const birdWave = Math.sin(t * 2.7);
    this.skylark.position.y = 4.05 + birdWave * 0.19;
    this.skylark.position.x = this.hero.position.x + 1.65 + Math.cos(t * 1.4) * 0.22;
    this.skylark.rotation.z = Math.sin(t * 1.7) * 0.09;
    this.skylark.userData.leftWing.rotation.z = Math.PI / 2 + Math.sin(t * 13) * 0.7;
    this.skylark.userData.rightWing.rotation.z = -Math.PI / 2 - Math.sin(t * 13) * 0.7;

    this.heroShadow.position.x = this.hero.position.x;
    this.heroShadow.material.opacity = clamp(0.48 - (this.hero.position.y - this.groundY) * 0.12, 0.12, 0.48);
    this.heroShadow.scale.x = lerp(this.heroShadow.scale.x, this.isGrounded ? 2.2 : 1.65, clamp(delta * 8, 0, 1));

    this.dashAura.position.x = this.hero.position.x;
    this.dashAura.position.y = this.hero.position.y - this.groundY;
    this.dashAura.children.forEach((ring, index) => {
      ring.material.opacity = lerp(ring.material.opacity, this.dashDuration > 0 ? 0.72 - index * 0.13 : 0, clamp(delta * 14, 0, 1));
      ring.scale.setScalar(1 + Math.sin(t * 18 + index) * 0.08);
      ring.rotation.z += delta * (index % 2 === 0 ? 1.6 : -1.3);
    });
  }

  #updateMovement(delta) {
    const targetX = this.lane * this.laneWidth;
    this.hero.position.x = THREE.MathUtils.damp(this.hero.position.x, targetX, 11, delta);

    if (!this.isGrounded) {
      this.verticalVelocity -= 18.2 * delta;
      this.hero.position.y += this.verticalVelocity * delta;
      if (this.hero.position.y <= this.groundY) {
        this.hero.position.y = this.groundY;
        this.verticalVelocity = 0;
        this.isGrounded = true;
        this.#emit("action", { type: "land" });
      }
    }

    this.dashDuration = Math.max(0, this.dashDuration - delta);
    this.dashCooldown = Math.max(0, this.dashCooldown - delta);
    const chapterBoost = Math.min(7.5, this.distance * 0.008);
    const targetSpeed = this.baseSpeed + chapterBoost + (this.dashDuration > 0 ? 10 : 0);
    this.speed = THREE.MathUtils.damp(this.speed, targetSpeed, this.dashDuration > 0 ? 14 : 3.2, delta);
    this.invulnerability = Math.max(0, this.invulnerability - delta);
    this.hero.visible = this.invulnerability <= 0 || Math.sin(this.elapsed * 28) > -0.15;
  }

  #updateGameplay(delta) {
    const forward = delta * this.speed;
    if (this.autoSpawn) {
      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0) {
        this.#spawnPattern();
        const difficulty = Math.min(0.45, this.distance / 1800);
        this.spawnTimer = 1.72 - difficulty + this.random() * 0.42;
      }
    }

    for (let index = this.obstacles.length - 1; index >= 0; index -= 1) {
      const obstacle = this.obstacles[index];
      obstacle.position.z += forward;
      obstacle.rotation.y += delta * obstacle.userData.spin;
      if (obstacle.userData.type === "shadow") {
        const core = obstacle.userData.core;
        core.rotation.x += delta * 2.8;
        core.rotation.y -= delta * 3.4;
        obstacle.scale.y = 1 + Math.sin(this.elapsed * 5 + obstacle.userData.phase) * 0.08;
      }

      const zDistance = Math.abs(obstacle.position.z - this.hero.position.z);
      const xDistance = Math.abs(obstacle.position.x - this.hero.position.x);
      if (!obstacle.userData.hit && zDistance < 0.78 && xDistance < 0.82) {
        const clearedByJump = obstacle.userData.type !== "shadow" && this.hero.position.y > obstacle.userData.clearance;
        if (!clearedByJump) this.#collideObstacle(obstacle);
      }

      if (obstacle.position.z > 13 || obstacle.userData.remove) this.#removeObstacle(index);
    }

    for (let index = this.collectibles.length - 1; index >= 0; index -= 1) {
      const feather = this.collectibles[index];
      feather.position.z += forward;
      feather.position.y = feather.userData.baseY + Math.sin(this.elapsed * 4.8 + feather.userData.phase) * 0.14;
      feather.rotation.y += delta * 3.7;
      feather.rotation.z = Math.sin(this.elapsed * 2.6 + feather.userData.phase) * 0.2;

      const closeX = Math.abs(feather.position.x - this.hero.position.x) < 0.92;
      const closeZ = Math.abs(feather.position.z - this.hero.position.z) < 0.86;
      const closeY = Math.abs(feather.position.y - (this.hero.position.y + 1.15)) < 1.12;
      if (closeX && closeZ && closeY) {
        this.#collectFeather(feather);
        this.collectibles.splice(index, 1);
        this.gameplayLayer.remove(feather);
        continue;
      }
      if (feather.position.z > 13) {
        this.collectibles.splice(index, 1);
        this.gameplayLayer.remove(feather);
      }
    }

    this.#updateEffects(delta);
  }

  #updateProgression() {
    if (this.distance >= FINISH_DISTANCE) {
      this.distance = FINISH_DISTANCE;
      this.bonusScore += 1200;
      this.score = this.distance * 10 + this.feathers * 100 + this.bonusScore;
      this.state = "complete";
      this.speed = 0;
      this.hero.visible = true;
      this.#clearGameplayObjects();
      this.#emitUpdate();
      this.#emit("statechange", { state: this.state, snapshot: this.getSnapshot() });
      return;
    }

    const nextChapter = CHAPTERS[this.currentChapter + 1];
    if (nextChapter && this.distance >= nextChapter.start) {
      this.currentChapter += 1;
      this.state = "dialog";
      this.speed = 0;
      this.#clearGameplayObjects();
      this.#applyChapter(this.currentChapter, false);
      this.#emitUpdate();
      this.#emit("chaptertransition", { chapter: this.currentChapter, ...CHAPTERS[this.currentChapter] });
      this.#emit("statechange", { state: this.state });
    }
  }

  #applyChapter(index, immediate) {
    const chapter = CHAPTERS[index];
    const palette = chapter.palette;
    this.baseSpeed = chapter.speed;
    this.paletteTarget = {
      sky: new THREE.Color(palette.sky),
      fog: new THREE.Color(palette.fog),
      ground: new THREE.Color(palette.ground),
      leaf: new THREE.Color(palette.leaf),
      mountain: new THREE.Color(palette.mountain),
      road: new THREE.Color(palette.road),
      sun: new THREE.Color(palette.sun),
      fogDensity: index === 1 ? 0.02 : index === 2 ? 0.024 : 0.017,
      discOpacity: index === 1 ? 0.46 : index === 2 ? 0.13 : 0.3
    };

    if (immediate) {
      this.scene.background.copy(this.paletteTarget.sky);
      this.scene.fog.color.copy(this.paletteTarget.fog);
      this.scene.fog.density = this.paletteTarget.fogDensity;
      this.materials.roadEdge.color.copy(this.paletteTarget.ground);
      this.materials.leaf.color.copy(this.paletteTarget.leaf);
      this.materials.mountain.color.copy(this.paletteTarget.mountain);
      this.materials.mountainFar.color.copy(this.paletteTarget.mountain).offsetHSL(0, -0.08, 0.1);
      this.roadMaterial.color.copy(this.paletteTarget.road);
      this.sun.color.copy(this.paletteTarget.sun);
      this.sunDiscMaterial.opacity = this.paletteTarget.discOpacity;
    }
  }

  #spawnPattern() {
    const lanes = [-1, 0, 1];
    const baseZ = -54;
    const lane = lanes[Math.floor(this.random() * lanes.length)];
    const pattern = this.patternIndex % 5;
    this.patternIndex += 1;

    if (pattern === 0) {
      this.#spawnObstacle(lane, "stone", baseZ);
      const safeLane = lane === 0 ? (this.random() > 0.5 ? -1 : 1) : 0;
      for (let i = 0; i < 4; i += 1) this.#spawnFeather(safeLane, baseZ - 3 - i * 2.15, 1.18);
    } else if (pattern === 1) {
      const safeLane = lanes[(lanes.indexOf(lane) + 1 + Math.floor(this.random() * 2)) % 3];
      lanes.filter((value) => value !== safeLane).forEach((value) => this.#spawnObstacle(value, "log", baseZ));
      for (let i = 0; i < 5; i += 1) this.#spawnFeather(safeLane, baseZ - 1 - i * 2, 1.12);
    } else if (pattern === 2) {
      this.#spawnObstacle(lane, "log", baseZ);
      for (let i = 0; i < 4; i += 1) this.#spawnFeather(lane, baseZ - 2.3 - i * 1.65, 2.05);
    } else if (pattern === 3) {
      this.#spawnObstacle(lane, "shadow", baseZ);
      const safeLane = lane === -1 ? 1 : -1;
      for (let i = 0; i < 4; i += 1) this.#spawnFeather(safeLane, baseZ - 2 - i * 2, 1.25);
    } else {
      lanes.forEach((value, index) => {
        const z = baseZ - index * 4.5;
        if (value !== lane) this.#spawnObstacle(value, index % 2 ? "stone" : "log", z);
      });
      for (let i = 0; i < 6; i += 1) this.#spawnFeather(lane, baseZ - i * 2, 1.12 + (i % 2) * 0.35);
    }
  }

  #spawnObstacle(lane, type = "stone", z = -54) {
    const obstacle = new THREE.Group();
    obstacle.position.set(lane * this.laneWidth, 0.02, z);
    obstacle.userData = {
      lane,
      type,
      hit: false,
      remove: false,
      clearance: type === "log" ? 0.72 : type === "stone" ? 1.08 : 99,
      spin: type === "shadow" ? 0.7 : (this.random() - 0.5) * 0.12,
      phase: this.random() * Math.PI * 2
    };

    if (type === "log") {
      const log = mesh(this.gameGeometry.log, this.gameMaterials.wood, {
        position: [0, 0.38, 0],
        rotation: [0, 0, Math.PI / 2]
      });
      const branch = mesh(this.gameGeometry.branch, this.gameMaterials.bark, {
        position: [0.32, 0.64, 0],
        rotation: [0, 0, -0.7]
      });
      obstacle.add(log, branch);
    } else if (type === "shadow") {
      const outer = mesh(this.gameGeometry.shadow, this.gameMaterials.shadow, {
        position: [0, 1.05, 0],
        scale: [0.92, 1.46, 0.72]
      });
      const core = mesh(this.gameGeometry.shadowCore, this.gameMaterials.shadowCore, {
        position: [0, 1.08, -0.48]
      });
      obstacle.userData.core = core;
      obstacle.add(outer, core);
      for (let i = 0; i < 4; i += 1) {
        const wisp = mesh(this.gameGeometry.shard, this.gameMaterials.shadowCore, {
          position: [(this.random() - 0.5) * 1.3, 0.35 + this.random() * 1.6, (this.random() - 0.5) * 0.4],
          scale: [0.8, 2.5, 0.8]
        });
        obstacle.add(wisp);
      }
    } else {
      const mainStone = mesh(this.gameGeometry.stone, this.gameMaterials.stone, {
        position: [0, 0.56, 0],
        scale: [1.05, 0.92, 0.9],
        rotation: [0.08, this.random() * Math.PI, -0.08]
      });
      const left = mesh(this.gameGeometry.pebble, this.gameMaterials.stoneLight, {
        position: [-0.48, 0.25, 0.1],
        rotation: [0, this.random() * Math.PI, 0]
      });
      const right = mesh(this.gameGeometry.pebble, this.gameMaterials.stone, {
        position: [0.5, 0.2, -0.08],
        scale: [0.78, 0.92, 1.1]
      });
      obstacle.add(mainStone, left, right);
    }

    this.obstacles.push(obstacle);
    this.gameplayLayer.add(obstacle);
    return obstacle;
  }

  #spawnFeather(lane, z, height = 1.15) {
    const feather = new THREE.Group();
    const shaft = mesh(this.gameGeometry.featherShaft, this.gameMaterials.featherLight, {
      rotation: [0, 0, -0.28],
      cast: false
    });
    const vaneLeft = mesh(this.gameGeometry.featherVane, this.gameMaterials.feather, {
      position: [-0.1, 0.08, 0],
      rotation: [0, 0, 0.34],
      scale: [0.75, 1, 0.32],
      cast: false
    });
    const vaneRight = mesh(this.gameGeometry.featherVane, this.gameMaterials.featherLight, {
      position: [0.1, 0.08, 0],
      rotation: [0, 0, -0.34],
      scale: [0.75, 0.92, 0.32],
      cast: false
    });
    feather.add(shaft, vaneLeft, vaneRight);
    feather.position.set(lane * this.laneWidth, height, z);
    feather.userData = { lane, baseY: height, phase: this.random() * Math.PI * 2 };
    this.collectibles.push(feather);
    this.gameplayLayer.add(feather);
    return feather;
  }

  #collideObstacle(obstacle) {
    obstacle.userData.hit = true;
    if (this.dashDuration > 0) {
      this.bonusScore += 160;
      this.score = this.distance * 10 + this.feathers * 100 + this.bonusScore;
      obstacle.userData.remove = true;
      this.#spawnBurst(obstacle.position, "wind", 14);
      this.#emit("obstaclebreak", { type: obstacle.userData.type, score: this.score });
      return;
    }

    if (this.invulnerability > 0) {
      obstacle.userData.remove = true;
      return;
    }

    this.health = Math.max(0, this.health - 1);
    this.invulnerability = 1.45;
    this.cameraShake = this.reducedMotion ? 0.05 : 0.34;
    this.speed *= 0.48;
    obstacle.userData.remove = true;
    this.#spawnBurst(obstacle.position, "hit", 18);
    this.#emit("collision", { type: obstacle.userData.type, health: this.health });
    this.#emitUpdate();

    if (this.health <= 0) {
      this.state = "gameover";
      this.speed = 0;
      this.hero.visible = true;
      this.#emit("statechange", { state: this.state, snapshot: this.getSnapshot() });
    }
  }

  #collectFeather(feather) {
    this.feathers += 1;
    this.score = this.distance * 10 + this.feathers * 100 + this.bonusScore;
    this.dashCooldown = Math.max(0, this.dashCooldown - 0.28);
    this.#spawnBurst(feather.position, "sparkle", 9);
    this.#emit("collect", { feathers: this.feathers, score: this.score });
    this.#emitUpdate();
  }

  #spawnBurst(position, materialName, count) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y += materialName === "hit" ? 0.8 : 0.2;
    const random = this.random;
    for (let index = 0; index < count; index += 1) {
      const shard = mesh(this.gameGeometry.shard, this.gameMaterials[materialName], {
        scale: [0.55 + random(), 0.55 + random(), 0.55 + random()],
        cast: false
      });
      shard.userData.velocity = new THREE.Vector3(
        (random() - 0.5) * 5.5,
        1.2 + random() * 4.8,
        (random() - 0.5) * 4.5
      );
      group.add(shard);
    }
    group.userData.life = 0.85;
    this.effects.push(group);
    this.gameplayLayer.add(group);
  }

  #updateEffects(delta) {
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      effect.userData.life -= delta;
      effect.children.forEach((shard) => {
        shard.userData.velocity.y -= delta * 7.5;
        shard.position.addScaledVector(shard.userData.velocity, delta);
        shard.rotation.x += delta * 5;
        shard.rotation.y += delta * 4;
        shard.scale.multiplyScalar(1 - delta * 0.85);
      });
      if (effect.userData.life <= 0) {
        this.gameplayLayer.remove(effect);
        this.effects.splice(index, 1);
      }
    }
  }

  #removeObstacle(index) {
    const [obstacle] = this.obstacles.splice(index, 1);
    this.gameplayLayer.remove(obstacle);
  }

  #clearGameplayObjects() {
    this.obstacles.length = 0;
    this.collectibles.length = 0;
    this.effects.length = 0;
    this.gameplayLayer.clear();
  }

  #animateAtmosphere(delta, active) {
    this.motes.rotation.y += delta * 0.006;
    this.motes.position.z += active ? delta * this.speed * 0.04 : 0;
    if (this.motes.position.z > 10) this.motes.position.z = -10;

    if (this.paletteTarget) {
      const paletteLerp = 1 - Math.exp(-delta * 0.72);
      this.scene.background.lerp(this.paletteTarget.sky, paletteLerp);
      this.scene.fog.color.lerp(this.paletteTarget.fog, paletteLerp);
      this.scene.fog.density = THREE.MathUtils.damp(this.scene.fog.density, this.paletteTarget.fogDensity, 0.8, delta);
      this.materials.roadEdge.color.lerp(this.paletteTarget.ground, paletteLerp);
      this.materials.leaf.color.lerp(this.paletteTarget.leaf, paletteLerp);
      this.materials.mountain.color.lerp(this.paletteTarget.mountain, paletteLerp);
      this.materials.mountainFar.color.lerp(this.paletteTarget.mountain, paletteLerp * 0.7);
      this.roadMaterial.color.lerp(this.paletteTarget.road, paletteLerp);
      this.sun.color.lerp(this.paletteTarget.sun, paletteLerp);
      this.sunDiscMaterial.opacity = THREE.MathUtils.damp(this.sunDiscMaterial.opacity, this.paletteTarget.discOpacity, 0.7, delta);
    }

    this.cameraShake = Math.max(0, this.cameraShake - delta * 1.8);
    const shake = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake : 0;
    const laneFollow = active ? this.hero.position.x * 0.13 : 0;
    const cameraTargetX = laneFollow + Math.sin(this.elapsed * 0.18) * (active ? 0.05 : 0.28) + shake;
    this.camera.position.x = lerp(this.camera.position.x, cameraTargetX, clamp(delta * 1.8, 0, 1));
    this.camera.lookAt(this.camera.position.x * 0.16, 1.22, -10);
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #emitUpdate() {
    this.#emit("update", this.getSnapshot());
  }

  #handleKeyDown(event) {
    if (this.state !== "playing" || event.repeat) return;
    let handled = true;
    switch (event.code) {
      case "ArrowLeft":
      case "KeyA":
        this.moveLeft();
        break;
      case "ArrowRight":
      case "KeyD":
        this.moveRight();
        break;
      case "ArrowUp":
      case "KeyW":
      case "Space":
        this.jump();
        break;
      case "ShiftLeft":
      case "ShiftRight":
      case "KeyJ":
        this.dash();
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.boundResize);
    window.removeEventListener("keydown", this.boundKeyDown);
    this.renderer.dispose();
    this.container.replaceChildren();
  }
}
