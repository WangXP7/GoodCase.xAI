import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { createPostProcessing } from './post-processing.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { getLocationLabel, isTypingInField, ROADS, NYC_LANDMARKS, CITY, SPAWN, LAND_REGIONS } from './city-config.js';
import { buildCityGrid } from './city-grid.js';
import { buildLandmarks } from './landmarks.js';
import { buildCityBlocks } from './buildings.js';
import { buildOpenCityBuildings } from './open-city-buildings.js';
import { buildSingaporeLandmarks } from './singapore-landmarks.js';
import { CityTiles } from './city-tiles.js';
import { loadIslandRoads } from './island-roads.js';
import { createIslandTraffic } from './island-traffic.js';
import { createIslandSignals } from './island-signals.js';
import { RED_LIGHT_FINE } from './open-city-enforcement.js';
import { createLandMask } from './city-tiles-build.js';
import { buildStreetDetails } from './street-details.js';
import { buildOpenCityDetails } from './open-city-details.js';
import { createTrafficSystem, createHighwayTraffic } from './traffic.js';
import { buildRoadPaint } from './road-paint.js';
import { ThirdPersonControllerManager } from './controllers.js';
import { TouchControls } from './touch-controls.js';
import { GamepadControls } from './gamepad-controls.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem } from './lighting.js';
import { NYCMapSystem } from './nyc-map.js';
import { setupSceneCulling, updateSceneCulling } from './scene-culling.js';
import { CityAudioSystem } from './audio-system.js';
import { Weather } from './weather.js';
import { initialTreeDetail, bindTreeDetail, createAutoTreeDetail } from './graphics-settings.js';
import { Navigator } from './navigation.js';
import { setupNavigationUI } from './navigation-ui.js';
import { MrtSystem } from './mrt-system.js';
import { PerceptionOverlay } from './perception-overlay.js';
import { createIslandGraph } from './island-network.js';
import { createAirbases } from './airbases.js';
import { JetHUD } from './jet-hud.js';
import { createAirForce } from './air-force.js';
import { Binoculars } from './binoculars.js';
import { BoomWatcher } from './jet-acoustics.js';
import { GEO } from './geodata.js';

// js/main.js
// Main entry point for the city simulation (Singapore by default, ?city=nyc for New York) in Three.js WebGPURenderer &
// TSL (three.js dev, see index.html)

// The page's words for the simulated city: index.html is written for Singapore, the default city; New York keeps the
// page it always had
function nameThePage() {
  const title = `Slop ${CITY.name}`;
  const text = CITY.open
    ? {
      description: `A ${CITY.name} city simulation built with three.js: walk, drive, cycle or fly through its real streets.`,
      map: `Full ${CITY.name} street map [M]`, radar: `Live ${CITY.name} street radar minimap`,
      radarTitle: `Open the full ${CITY.name} street map [M]`, modal: `Full ${CITY.name} street map (interactive)`,
      atlas: `${CITY.name} Street Atlas`, compass: 'North is up',
      all: `All of ${CITY.name}`, fit: `Fit all of ${CITY.name}`
    }
    : {
      description: 'Photorealistic GTA-style 3D Slop New York simulation built with Three.js WebGPURenderer and TSL shaders featuring complete Manhattan street map (125th St to Battery Park), third-person navigation (Person, Car, Cyclist, Helicopter), and 11 cinematic cameras at 60 FPS.',
      map: 'Full New York City street map [M]', radar: 'Live NYC Street Radar Minimap',
      radarTitle: 'Open the full New York City street map [M]', modal: 'Full New York City Interactive Street Map',
      atlas: 'Manhattan Street Atlas', compass: "North is up · Manhattan's street grid runs 29° east of it",
      all: 'All of Manhattan (125th St to Battery Park)', fit: 'Fit all of Manhattan'
    };
  const set = (selector, fn) => { for (const el of document.querySelectorAll(selector)) fn(el); };
  document.title = title;
  set('meta[name="description"]', (el) => el.setAttribute('content', text.description));
  set('.loader-title, h1', (el) => (el.textContent = title));
  set('.mta-bullet', (el) => (el.textContent = CITY.short));
  set('#canvas-container', (el) => el.setAttribute('aria-label', `3D Interactive ${title} Viewport`));
  set('#btn-open-map', (el) => (el.title = text.map));
  set('#minimap-card', (el) => { el.title = text.radarTitle; el.setAttribute('aria-label', text.radar); });
  set('#fullmap-modal', (el) => el.setAttribute('aria-label', text.modal));
  set('.fullmap-title h2', (el) => (el.textContent = text.atlas));
  set('.map-compass', (el) => (el.title = text.compass));
  set('#map-view-all', (el) => { el.title = text.all; el.setAttribute('aria-label', text.fit); });
}

async function initApp() {
  const container = document.getElementById('canvas-container');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  nameThePage();
  const loadingTrack = loadingOverlay ? loadingOverlay.querySelector('.loader-track') : null;
  const loadingFill = document.getElementById('loading-progress');
  // The loading bar sweeps while the city is being built (the main thread is busy) and fills as the shaders compile
  const setLoadingProgress = (p) => {
    if (!loadingFill) return;
    if (loadingTrack) loadingTrack.classList.remove('is-indeterminate');
    loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  };

  if (loadingStatus) {
    loadingStatus.textContent = `Initializing Three.js r${THREE.REVISION} WebGPURenderer & TSL Shaders...`;
  }

  // 1. Initialize Three.js WebGPURenderer with 32-bit float reversedDepthBuffer
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true
  });
  renderer.setPixelRatio(1.0);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  container.appendChild(renderer.domElement);

  // Start-up phase timings (logged once as "[init] ...") to keep load-time regressions traceable
  let initTimings = [];
  let initMark = performance.now();
  const markInit = (label) => {
    const now = performance.now();
    initTimings.push(`${label} ${Math.round(now - initMark)}ms`);
    initMark = now;
  };

  await renderer.init();
  markInit('renderer');

  // 2. Build Scene & Physical Atmospheric Sky / PMREM IBL / 4096x4096 Shadow Lighting
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer);
  markInit('lighting');

  if (loadingStatus) {
    loadingStatus.textContent = CITY.open ? `Constructing ${CITY.name}...` : 'Constructing Manhattan Grid, Landmarks & Streetscape...';
  }

  // 3. Build Manhattan Geography, Iconic Landmarks, Blocks, Street Details & Traffic. A city built from OpenStreetMap
  //    (city-config.js CITY.open) has its ground, blocks, trees and traffic, without New York's boroughs, landmarks &
  //    street furniture
  const cityGrid = buildCityGrid(scene);
  markInit('cityGrid');
  const boroughs = CITY.open ? { colliders: [] } : (await import('./boroughs.js')).buildBoroughs(scene, { sidewalks: cityGrid.sidewalks });
  markInit('boroughs');
  const { colliders: landmarkColliders } = CITY.open ? { colliders: [] } : buildLandmarks(scene);
  markInit('landmarks');
  // (a city built from OpenStreetMap with its buildings mapped stands them as mapped; else they're generated on the lots)
  const cityBlocks = (CITY.open && buildOpenCityBuildings(scene)) || buildCityBlocks(scene);
  markInit('blocks');
  // Singapore's modelled landmarks (Marina Bay Sands, the Flyer) stand where their mapped outlines were left out
  const cityLandmarks = CITY.open && CITY.id === 'singapore' ? buildSingaporeLandmarks(scene) : null;
  if (cityLandmarks && cityBlocks.allBlocks[0]) cityBlocks.allBlocks[0].footprints.push(...cityLandmarks.footprints);
  markInit('cityLandmarks');
  // The rest of the island (tools/city/tiles.mjs), streamed in tiles of buildings & main roads around the camera
  const cityTiles = CITY.open ? new CityTiles(scene, { url: `./tiles/${CITY.id}/` }) : null;
  if (cityTiles && !(await cityTiles.init())) cityTiles.index = null;
  // ...its main roads (js/island-roads.js: loaded in the background for the maps, the traffic & teleports), and their
  // traffic (a pool of cars kept around the camera beyond the detailed city)
  let islandRoads = null;
  const islandTraffic = cityTiles?.index ? createIslandTraffic(scene, {
    vehicles: CITY.vehicles, keepLeft: CITY.driveSide === 'left',
    count: navigator.hardwareConcurrency <= 4 || matchMedia('(pointer: coarse)').matches ? 20 : 36
  }) : null;
  const islandSignals = cityTiles?.index ? createIslandSignals(scene, { keepLeft: CITY.driveSide === 'left' }) : null;
  const islandRoadsLoading = cityTiles?.index
    ? loadIslandRoads(`${cityTiles.url}roads.json`, { coreRing: cityTiles.index.coreRing }).then((roads) => {
      islandRoads = roads;
      islandTraffic.setRoads(roads);
      islandSignals.setRoads(roads);
      return roads;
    }).catch((e) => { console.warn(`[island] no roads: ${e.message}`); return null; })
    : Promise.resolve(null);
  markInit('islandTiles');
  const allColliders = [...landmarkColliders, ...(cityLandmarks?.colliders || []), ...cityBlocks.colliders, ...boroughs.colliders, ...(cityGrid.colliders || [])];

  const streetDetails = CITY.open ? buildOpenCityDetails(scene) : buildStreetDetails(scene);
  markInit('streetDetails');
  // Buildings turned along non-grid streets have oriented colliders whose world bounds reach past their lots: they stay
  // inside the property line anyway, so the road network (lanes & sidewalks) doesn't need them.
  // Elevated building sections that clear even a bus don't obstruct ground traffic.
  const trafficSystem = createTrafficSystem(scene, cityGrid.sidewalks, [
    ...cityGrid.footprints,
    ...streetDetails.footprints,
    ...allColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)
  ], streetDetails.signalIntersections);
  markInit('traffic');
  const highwayTraffic = createHighwayTraffic(scene, cityGrid.highwayLanes);
  buildRoadPaint(scene, trafficSystem.network);
  markInit('roadPaint');

  // 4. Initialize Third-Person Controllers (Person, Car, Cyclist, Helicopter, Jet) & Multi-Camera System
  const controllerManager = new ThirdPersonControllerManager(scene, allColliders);
  // Singapore's runways (js/airbases.js): the F-15SG starts on Paya Lebar's, where the RSAF's F-15SGs are based
  const airbases = CITY.open ? createAirbases(scene, CITY.id) : null;
  if (airbases) controllerManager.setJetHome(airbases.home, airbases.runways);
  // With the island's tiles, the player may go anywhere on its land: the detailed city's own (2 m) inside the area it
  // was built for, the island's (tools/city/tiles.mjs, 8 m) beyond; and bumps into the tiles' buildings as they load
  if (cityTiles?.landMask) {
    const detail = createLandMask(LAND_REGIONS.map((r) => [r.outer, ...r.holes].map((ring) => ring.flatMap((p) => [p.x, p.z]))), 2);
    const core = cityTiles.index.coreRing;
    const inCore = (x, z) => {
      let inside = false;
      for (let i = 0, j = core.length - 2; i < core.length; j = i, i += 2) {
        if ((core[i + 1] > z) !== (core[j + 1] > z) && x < core[i] + ((z - core[i + 1]) * (core[j] - core[i])) / (core[j + 1] - core[i + 1])) inside = !inside;
      }
      return inside;
    };
    controllerManager.setLand((x, z) => (inCore(x, z) ? detail.at(x, z) : cityTiles.landMask.at(x, z)));
    cityTiles.onTileColliders = (key, list) => controllerManager.setTileColliders(key, list);
  }

  // Reuse teleport placement so saved players return at rest, close to their last positions. Each city keeps its own.
  const playerStateKey = CITY.open ? `${CITY.id}-player-state` : 'nyc-player-state';
  let restored = false;
  let savedJet = false;
  try {
    const saved = JSON.parse(localStorage.getItem(playerStateKey));
    if (saved?.version === 1) {
      for (const mode of Object.keys(controllerManager.entities)) {
        const p = saved.entities?.[mode];
        if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
        controllerManager.setMode(mode);
        controllerManager.teleportActiveTo(p.x, p.z, p.heading, p.y);
        if (mode === 'jet') savedJet = true;
      }
      controllerManager.setMode(Object.hasOwn(controllerManager.entities, saved.activeMode) ? saved.activeMode : 'car');
      restored = true;
    }
  } catch { /* Missing or unavailable storage does not prevent playing. */ }
  // A fresh session in a city built from OpenStreetMap: every mode starts at its street (controllers.js places them
  // around 5th Ave & 37th St)
  if (CITY.open && !restored) {
    // the car on the street, the cyclist behind it, the pedestrian on the kerb beside it, the helicopter overhead
    const fx = Math.sin(SPAWN.heading), fz = Math.cos(SPAWN.heading);
    const start = { car: [0, 0], cyclist: [-14, 0], person: [-6, 12], helicopter: [-40, 0] };
    for (const mode of Object.keys(controllerManager.entities)) {
      const [back, side] = start[mode] || [0, 0];
      controllerManager.setMode(mode);
      controllerManager.teleportActiveTo(SPAWN.x + fx * back - fz * side, SPAWN.z + fz * back + fx * side, SPAWN.heading);
    }
    controllerManager.setMode('car');
  }
  // a fresh start, or a session saved before there was a jet: the jet waits on its runway
  if (airbases && !savedJet) controllerManager.parkJet();

  function savePlayerState() {
    try {
      const entities = Object.fromEntries(Object.entries(controllerManager.entities).map(([mode, entity]) => [mode, {
        x: entity.position.x, y: entity.position.y, z: entity.position.z, heading: entity.heading
      }]));
      localStorage.setItem(playerStateKey, JSON.stringify({ version: 1, activeMode: controllerManager.activeMode, entities }));
    } catch { /* Storage may be disabled or full. */ }
  }

  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager);
  // Binoculars (js/binoculars.js): on a flypast, from the Air Force menu or [Z]
  const binoculars = new Binoculars(cameraSystem.camera, { overlay: document.getElementById('binoculars'), label: document.getElementById('binoculars-label') });
  // the taxi cockpit sits on the driver's side: the right in a city driving on the left
  cameraSystem.driverSide = CITY.driveSide === 'left' ? 1 : -1;
  const touchControls = new TouchControls(controllerManager);
  const soundButton = document.getElementById('btn-sound');
  // A tropical city (Singapore) has its koels, cicadas and thunderstorms
  const tropical = CITY.open && CITY.id === 'singapore';
  // The RSAF's other F-15SGs (js/air-force.js): a wingman for the jet, a flypast to order, from the Air Force menu
  const airForce = airbases ? createAirForce(scene, controllerManager) : null;
  const audioSystem = new CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic, streetDetails, islandTraffic, aircraft: airForce?.aircraft }, {
    onStateChange: updateSoundButton,
    tropics: tropical
  });
  function updateSoundButton() {
    if (!soundButton) return;
    soundButton.disabled = !audioSystem.supported;
    soundButton.setAttribute('aria-pressed', String(audioSystem.enabled));
    soundButton.setAttribute('aria-label', audioSystem.enabled ? 'Mute sound' : 'Enable sound');
    soundButton.title = audioSystem.supported ? `${audioSystem.enabled ? 'Mute' : 'Enable'} sound [N]` : 'Web Audio is unavailable';
    soundButton.querySelector('use').setAttribute('href', audioSystem.enabled ? '#i-sound' : '#i-sound-off');
  }
  soundButton?.addEventListener('click', () => audioSystem.setEnabled(!audioSystem.enabled));
  // Thunderstorms (js/weather.js): the storm button & [R]; each lightning flash's thunder follows at the speed of sound
  const weather = tropical ? new Weather(scene, lightingSystem, { onLightning: (distance) => audioSystem.thunder(distance) }) : null;
  const stormButton = document.getElementById('btn-storm');
  if (stormButton && !weather) stormButton.remove();
  function toggleStorm(immediate = false) {
    if (!weather) return;
    const on = !weather.stormy;
    weather.setStorm(on, immediate);
    stormButton?.setAttribute('aria-pressed', String(on));
    stormButton?.classList.toggle('active', on);
  }
  stormButton?.addEventListener('click', () => toggleStorm());
  if (weather && new URLSearchParams(location.search).has('storm')) toggleStorm(true);
  // (a city built from OpenStreetMap: its gantries & cameras learn the junctions' signals and get the in-car chimes)
  if (streetDetails.attach) streetDetails.attach(trafficSystem.network, audioSystem);
  // The street's solid things for the player to bump into (js/street-colliders.js): trees, gantries, cameras and the
  // signals' poles; the island's signal poles once its roads are in. (Kept out of the traffic network's footprints:
  // the lanes and sidewalks are laid out around them already.)
  controllerManager.setTileColliders('street', streetDetails.colliders || []);
  controllerManager.setTileColliders('signals', streetDetails.signalColliders?.() || []);
  islandRoadsLoading.then((roads) => { if (roads && islandSignals) controllerManager.setTileColliders('island-signals', islandSignals.colliders()); });
  updateSoundButton();
  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => {
    savePlayerState();
    if (!event.persisted) audioSystem.dispose();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePlayerState(); });
  markInit('controllers');

  // Island-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (scene-culling.js)
  const cullingRoots = ['ManhattanCityGrid', 'CityGrid', 'ManhattanCityBlocks', 'ManhattanStreetDetails', 'ManhattanLandmarks', 'Boroughs']
    .map((name) => scene.getObjectByName(name))
    .filter(Boolean);
  setupSceneCulling(scene, cullingRoots, lightingSystem.sunLight.shadow);

  // Initialize static world matrices once, including the chunks and shadow proxies created above.
  // Crowd, tree and building-detail animation changes instance/pose buffers, not Object3D transforms.
  const dynamicRoots = [
    trafficSystem.group,
    highwayTraffic.group,
    scene.getObjectByName('StoreClusteredLights'),
    scene.getObjectByName('StreetClusteredLights'),
    ...Object.values(controllerManager.entities).map((entity) => entity.mesh),
    controllerManager.entities.cyclist.helmet,
    // the jet's vapour trails and its explosion (in the scene, not under the jet)
    controllerManager.entities.jet.trails.mesh,
    controllerManager.entities.jet.explosion.fireball,
    controllerManager.entities.jet.explosion.smoke,
    airForce?.group,
    airbases?.group,
    // Singapore's: the Flyer's wheel & capsules, Spectra's beams; the island tiles streamed in around the camera; rain
    cityLandmarks?.group,
    cityTiles?.group,
    weather?.rain,
    islandTraffic?.group,
    islandSignals?.group
  ].filter(Boolean);
  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;
  markInit('culling');

  // On WebGPU, small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes only upload when needed; WebGL2 needs ordinary instanced attributes for correct transforms.
  if (renderer.backend.isWebGPUBackend) {
    scene.traverse((object) => {
      if (object.isInstancedMesh) {
        object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
      }
    });
  }

  // 5. TSL RenderPipeline with Half-Res Screen Space Reflections (SSRNode), Bloom & Filmic Toning
  //    Fade out distant and matte surfaces so SSR spends its rays on visible glossy reflections.
  const scenePass = pass(scene, cameraSystem.camera);
  // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
  // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
  // the browser supports them). The multisampled depth stays stored: SSR reads it.
  scenePass.renderTarget.storeMultisampledColorBuffer = false;
  const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
  const maxSSRRoughness = 0.75;
  const sceneMRT = mrt({
    output: output,
    normal: normalView,
    metalRough: vec2(roughness.lessThan(maxSSRRoughness).select(metalness.mul(ssrFade), 0), roughness)
  });
  sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
  sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
  scenePass.setMRT(sceneMRT);

  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassDepth = scenePass.getTextureNode('depth');
  const scenePassNormal = scenePass.getTextureNode('normal');
  const scenePassMetalRough = scenePass.getTextureNode('metalRough');

  const ssrPass = ssr(scenePassColor, scenePassDepth, scenePassNormal, {
    metalnessNode: scenePassMetalRough.r,
    roughnessNode: scenePassMetalRough.g,
    camera: cameraSystem.camera
  });
  ssrPass.resolutionScale = 0.5;
  ssrPass.blurQuality = 1;
  ssrPass.maxDistance.value = 42;
  ssrPass.thickness.value = 0.85;
  // Fewer coarse steps, then refine detected hits to keep reflection edges precise.
  ssrPass.quality.value = 0.25;
  ssrPass.binaryRefine = true;
  ssrPass.intensity.value = 0.50;
  ssrPass.screenEdgeFadeBlack = true;

  // Roughness mip blur must not spread reflections back onto matte or nonreflective surfaces.
  const reflectionMask = scenePassMetalRough.r.greaterThan(0).select(smoothstep(maxSSRRoughness, 0.55, scenePassMetalRough.g), 0);
  const reflections = ssrPass.mul(reflectionMask);
  const colorGrade = createPostProcessing(renderer, scenePassColor, reflections);
  const renderPipeline = new THREE.RenderPipeline(renderer, colorGrade.outputNode);

  // 6. Wire UI Controls (Strictly using safe DOM APIs: textContent, classList, addEventListener)
  // The Navigate menu (navigation-ui.js) lists the city's destinations and teleports there too. A city built from
  // OpenStreetMap offers only the cameras following the player and the auto-director (the scenic ones look at New
  // York's landmarks).
  const CAMERAS = CITY.open ? CAMERA_PRESETS.filter((p) => p.category === 'follow' || p.id === 'drone') : CAMERA_PRESETS;
  const cameraOffered = (id) => CAMERAS.some((p) => p.id === id);
  for (const btn of document.querySelectorAll('[data-camera]')) if (!cameraOffered(btn.dataset.camera)) btn.remove();
  const modeButtons = document.querySelectorAll('[data-mode]');
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const timeButtons = document.querySelectorAll('[data-time]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const modeSwitch = document.getElementById('mode-switch');
  touchControls.onAvailabilityChange = placeModeIndicator;

  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elAltitude = document.getElementById('hud-altitude');
  const elLocation = document.getElementById('hud-location');
  const elControlsHint = document.getElementById('hud-controls-hint');
  // The jet's head-up display (js/jet-hud.js): in the cockpit the full HUD, behind the jet its numbers
  const jetHud = new JetHUD(document.body, { bearingDeg: GEO.frame?.bearingDeg || 0 });
  const hudForward = new THREE.Vector3(), hudView = new THREE.Vector3(), hudPoint = new THREE.Vector3();
  const hudQuat = new THREE.Quaternion();
  const gamepadControls = new GamepadControls(controllerManager, cameraSystem, {
    onCycleMode: (step) => {
      const modes = ['person', 'car', 'cyclist', 'helicopter', 'jet'];
      selectMode(modes[(modes.indexOf(controllerManager.activeMode) + step + modes.length) % modes.length]);
    },
    onCycleCamera: cycleCamera,
    onToggleMap: () => mapSystem.toggleFullMap(!mapSystem.isFullMapOpen),
    onCloseMap: () => mapSystem.toggleFullMap(false)
  });

  // Keyboard guide for each mode: [keys, action]
  const controlHints = {
    person: [[['W', 'S'], 'Walk / Run'], [['A', 'D'], 'Turn'], [['Space'], 'Jump'], [['Drag'], 'Orbit']],
    car: [[['W', 'S'], 'Drive / Reverse'], [['A', 'D'], 'Steer'], [['B'], 'Horn'], [['[', ']'], 'How to go'], [['G'], 'Where to'], [['Drag'], 'Orbit']],
    cyclist: [[['W', 'S'], 'Pedal / Brake'], [['A', 'D'], 'Lean & Turn'], [['Drag'], 'Orbit']],
    helicopter: [[['W', 'S'], 'Pitch'], [['A', 'D'], 'Yaw'], [['Space', 'E'], 'Ascend'], [['Q', 'C'], 'Descend']],
    jet: [[['W', 'S'], 'Nose down / up'], [['A', 'D'], 'Roll'], [['Space', 'E'], 'Throttle'], [['Q', 'C'], 'Idle / Brake'], [['T'], 'Cockpit · mouse looks']]
  };
  // Top speeds in mph (controllers.js caps them at 8.2, 36, 19 & 52 m/s; the jet Mach 1.1, jet-flight.js): full scale
  // of the speed meter
  const topSpeedMph = { person: 18, car: 81, cyclist: 43, helicopter: 116, jet: 850 };
  // Speed & altitude in the city's units: mph & ft, or km/h & m
  const metric = CITY.units === 'metric';
  for (const el of document.querySelectorAll('.gauge-unit')) el.textContent = metric ? 'km/h' : 'mph';
  const altUnit = document.getElementById('hud-altitude-unit');
  if (altUnit) altUnit.textContent = metric ? 'm' : 'ft';

  function renderControlHints(mode) {
    if (!elControlsHint) return;
    const items = (controlHints[mode] || []).map(([keys, action]) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        item.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.className = 'hint-label';
      label.textContent = action;
      item.appendChild(label);
      return item;
    });
    elControlsHint.replaceChildren(...items);
  }

  // The taxi-yellow pill under the selected mode glides from button to button
  function placeModeIndicator() {
    const active = modeSwitch ? modeSwitch.querySelector('.mode-btn.active') : null;
    if (!active) return;
    modeSwitch.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    modeSwitch.style.setProperty('--ind-w', `${active.offsetWidth}px`);
  }

  function selectMode(mode) {
    controllerManager.setMode(mode);
    touchControls.setMode(controllerManager.activeMode);
    gamepadControls.reset();
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    document.body.dataset.mode = mode;
    placeModeIndicator();
    const ent = controllerManager.getActiveEntity();
    if (elMode) elMode.textContent = ent.label;
    renderControlHints(mode);
    jetHud.setVisible(mode === 'jet');

    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    const currentCam = cameraSystem.getActivePreset();
    if (currentCam.category !== 'follow') {
      selectCamera('chase', false);
    }
  }

  function selectCamera(camId, snap = false) {
    if (!cameraOffered(camId)) return;
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
    const preset = cameraSystem.getActivePreset();
    if (elCamera) elCamera.textContent = preset.name;
  }

  // Steps through the cameras offered (V / Shift+V, and the arrows either side of the camera name)
  function cycleCamera(step) {
    const n = CAMERAS.length;
    const idx = CAMERAS.findIndex((p) => p.id === cameraSystem.activePresetId);
    selectCamera(CAMERAS[(idx + step + n) % n].id, true);
  }

  function selectTime(timeId) {
    lightingSystem.applyPreset(timeId);
    colorGrade.applyPreset(lightingSystem.activePresetId);
    timeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === timeId);
    });
  }

  // Graphics: the island's tree detail (js/graphics-settings.js), saved; the menu hidden where there are no island tiles
  // (Auto by default: a level from the frame rate, js/graphics-settings.js createAutoTreeDetail)
  const graphicsButton = document.getElementById('btn-graphics');
  let autoTrees = null;
  if (cityTiles?.index) {
    let storage = null;
    try { storage = localStorage; } catch { /* storage unavailable */ }
    const autoSub = document.getElementById('tree-auto-sub');
    const names = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' };
    autoTrees = createAutoTreeDetail({
      start: 'medium',
      load: () => cityTiles.stats.treeTriangles,
      apply: (level, why) => {
        cityTiles.setTreeDetail(level);
        if (autoSub) autoSub.textContent = `From the frame rate · now ${names[level]}`;
        if (why === 'slow' || why === 'fast') console.info(`[trees] auto: ${level} (${why === 'slow' ? 'below' : 'at'} ${Math.round(autoTrees.state().goal)} fps)`);
      }
    });
    bindTreeDetail({
      buttons: [...document.querySelectorAll('#tree-detail [data-trees]')],
      apply: (choice) => {
        if (choice === 'auto') return autoTrees.enable();
        autoTrees.disable();
        cityTiles.setTreeDetail(choice);
        if (autoSub) autoSub.textContent = 'From the frame rate';
      },
      storage,
      level: initialTreeDetail({ search: location.search, storage })
    });
  } else {
    graphicsButton?.remove();
    document.getElementById('graphics-popover')?.remove();
  }

  // Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
  // names the element they sit above / below, data-align the one whose right edge they line up with
  const popovers = document.querySelectorAll('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  function closePopovers() {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  }
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) return;
      const anchor = document.getElementById(pop.dataset.anchor) || invoker;
      const align = document.getElementById(pop.dataset.align) || invoker;
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      pop.style.right = `${Math.max(8, window.innerWidth - align.getBoundingClientRect().right)}px`;
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectMode(btn.getAttribute('data-mode'));
    });
  });

  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCamera(btn.getAttribute('data-camera'), true);
      closePopovers();
    });
  });

  const camPrevBtn = document.getElementById('cam-prev');
  const camNextBtn = document.getElementById('cam-next');
  if (camPrevBtn) camPrevBtn.addEventListener('click', () => cycleCamera(-1));
  if (camNextBtn) camNextBtn.addEventListener('click', () => cycleCamera(1));

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTime(btn.getAttribute('data-time'));
    });
  });

  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  // Where you are: the place's name over its street corner, drawn as a pair of NYC street-name signs
  const roadNames = new Set(ROADS.map((r) => r.name));
  const placeNames = new Set(NYC_LANDMARKS.map((l) => l.name));
  let locationText = '';
  function renderLocation(label) {
    if (!elLocation || label === locationText) return;
    locationText = label;
    let place = '';
    let streets = label;
    const split = label.indexOf(' · ');
    if (split >= 0) {
      place = label.slice(0, split);
      streets = label.slice(split + 3);
    } else if (placeNames.has(label) || (!label.includes(' & ') && !roadNames.has(label))) {
      place = label;
      streets = '';
    }
    const nodes = [];
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place';
      el.textContent = place;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs';
      if (streets.startsWith('near ')) {
        streets = streets.slice(5);
        const near = document.createElement('span');
        near.className = 'location-near';
        near.textContent = 'near';
        row.appendChild(near);
      }
      for (const name of streets.split(' & ')) {
        const sign = document.createElement('span');
        sign.className = 'street-sign';
        sign.textContent = name;
        row.appendChild(sign);
      }
      nodes.push(row);
    }
    elLocation.replaceChildren(...nodes);
  }

  function teleportTo(x, z, heading = Math.PI) {
    // beyond the detailed city, a ground arrival is on the nearest of the island's main roads, in its lane, with its
    // traffic (the expressways only for the car)
    const mode = controllerManager.activeMode;
    if (islandRoads && mode !== 'helicopter' && mode !== 'jet' && !islandRoads.inCore(x, z)) {
      const road = islandRoads.snap(x, z, heading, 800, CITY.driveSide === 'left', { expressways: mode === 'car' });
      if (road) ({ x, z, heading } = road);
    }
    const destination = controllerManager.teleportActiveTo(x, z, heading);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    mapSystem.waypoint = {
      x: destination.x,
      z: destination.z,
      name: getLocationLabel(destination.x, destination.z)
    };
    return destination;
  }

  const mapSystem = new NYCMapSystem({
    controllerManager,
    cameraSystem,
    trafficSystem,
    allBlocks: cityBlocks.allBlocks,
    onToggle: (open) => {
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      gamepadControls.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        mapHint.textContent = 'Tap to go there · Drag to pan · Use + / − to zoom';
      }
    },
    onTeleport: teleportTo
  });

  const openMapBtn = document.getElementById('btn-open-map');

  // The maps show the whole island: its land at once, its main roads once roads.json arrives, and each streamed tile's
  // buildings as it loads
  if (cityTiles?.index) {
    const land = cityTiles.index.land;
    mapSystem.setIsland({ land });
    islandRoadsLoading.then((roads) => { if (roads) mapSystem.setIsland({ land, roads: roads.data }); });
    cityTiles.onTileOutlines = (key, x, z, outlines) => mapSystem.addTile(key, x, z, outlines);
  }
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));

  // The Air Force menu: the wingman and the runways on the map (both remembered), and a flypast to order
  const afButton = document.getElementById('btn-airforce');
  const afPopover = document.getElementById('airforce-popover');
  const afWingman = document.getElementById('af-wingman');
  const afFlypast = document.getElementById('af-flypast');
  const afFlypastSub = document.getElementById('af-flypast-sub');
  const afRunways = document.getElementById('af-runways');
  const afFuel = document.getElementById('af-fuel');
  const afAssist = document.getElementById('af-assist');
  const afFlypastText = afFlypastSub?.textContent || '';
  const afBinoculars = document.getElementById('af-binoculars');
  const afSupersonic = document.getElementById('af-supersonic');
  const afSmoke = document.getElementById('af-smoke');
  const afFormations = [...document.querySelectorAll('#af-formation [data-formation]')];
  // the formation to order: one of js/air-force.js FORMATIONS, or 'random' (a different one each time); remembered
  let flypastFormation = (() => { try { return localStorage.getItem('flypast-formation') || 'random'; } catch { return 'random'; } })();
  if (!afFormations.some((b) => b.dataset.formation === flypastFormation)) flypastFormation = 'random';
  function setFlypastFormation(id) {
    flypastFormation = id;
    for (const b of afFormations) b.setAttribute('aria-checked', String(b.dataset.formation === id));
    try { localStorage.setItem('flypast-formation', id); } catch { /* storage unavailable */ }
  }
  const afViews = [...document.querySelectorAll('#af-view [data-view]')];
  // where a flypast is watched from: where you are, or riding in it (js/air-force.js RIDES); remembered
  const FLYPAST_VIEWS = ['ground', 'wing', 'slot', 'chase'];
  let flypastView = (() => { try { const v = localStorage.getItem('flypast-view'); return FLYPAST_VIEWS.includes(v) ? v : 'ground'; } catch { return 'ground'; } })();
  function setFlypastView(view) {
    flypastView = view;
    for (const b of afViews) b.setAttribute('aria-checked', String(b.dataset.view === view));
    try { localStorage.setItem('flypast-view', view); } catch { /* storage unavailable */ }
    if (!airForce?.flypast.active) return;
    if (view === 'ground') {
      if (afBinoculars?.getAttribute('aria-checked') === 'true') binoculars.watch(airForce.flypast);
    } else binoculars.lower();
  }
  const remember = (key, on) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ } };
  const recalled = (key) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
  function setWingman(on) {
    airForce?.setWingman(on);
    afWingman?.setAttribute('aria-checked', String(on));
    remember('airforce-wingman', on);
  }
  function setRunwaysOnMap(on) {
    mapSystem.setRunways(airbases?.runways || [], on);
    afRunways?.setAttribute('aria-checked', String(on));
    remember('map-runways', on);
  }
  // the flight options: unlimited fuel and Bank assist (both off, as the real jet, unless chosen; remembered)
  function setJetOption(button, key, option, on) {
    controllerManager.setJetOptions({ [option]: on });
    button?.setAttribute('aria-checked', String(on));
    remember(key, on);
  }
  for (const [button, key, option] of [[afFuel, 'jet-unlimited-fuel', 'unlimitedFuel'], [afAssist, 'jet-bank-assist', 'assist']]) {
    button?.addEventListener('click', () => setJetOption(button, key, option, button.getAttribute('aria-checked') !== 'true'));
    setJetOption(button, key, option, recalled(key));
  }
  if (airForce) {
    mapSystem.setAircraft(airForce.contacts);
    afWingman?.addEventListener('click', () => setWingman(afWingman.getAttribute('aria-checked') !== 'true'));
    afRunways?.addEventListener('click', () => setRunwaysOnMap(!mapSystem.runwaysShown));
    afFlypast?.addEventListener('click', () => {
      if (airForce.flypast.active) return;
      const supersonic = afSupersonic?.getAttribute('aria-checked') === 'true';
      const smoke = afSmoke?.getAttribute('aria-checked') !== 'false';
      airForce.orderFlypast(cameraSystem.camera, { supersonic, formation: flypastFormation, smoke });
      closePopovers();
      if (flypastView === 'ground' && afBinoculars?.getAttribute('aria-checked') === 'true') binoculars.watch(airForce.flypast);
      const how = supersonic ? ', supersonic' : '';
      const from = flypastView === 'ground' ? 'Z: binoculars' : 'X: watch from elsewhere';
      const f = airForce.flypast.formation;
      streetDetails.notice?.('RSAF FLYPAST', `Four F-15SGs in ${f.name.toLowerCase()}${how}, dead ahead: overhead in ${Math.round(airForce.flypast.overhead)} s, then a ${f.manoeuvre} · ${from}`, false, 'erp');
    });
    for (const b of afFormations) b.addEventListener('click', () => setFlypastFormation(b.dataset.formation));
    setFlypastFormation(flypastFormation);
    // red and white smoke through the display (on unless turned off; remembered)
    afSmoke?.setAttribute('aria-checked', String((() => { try { return localStorage.getItem('flypast-smoke') !== '0'; } catch { return true; } })()));
    afSmoke?.addEventListener('click', () => {
      const on = afSmoke.getAttribute('aria-checked') !== 'true';
      afSmoke.setAttribute('aria-checked', String(on));
      remember('flypast-smoke', on);
      airForce.flypast.smokeOn = on;
    });
    afSupersonic?.addEventListener('click', () => {
      const on = afSupersonic.getAttribute('aria-checked') !== 'true';
      afSupersonic.setAttribute('aria-checked', String(on));
      remember('flypast-supersonic', on);
    });
    afSupersonic?.setAttribute('aria-checked', String(recalled('flypast-supersonic')));
    for (const b of afViews) b.addEventListener('click', () => setFlypastView(b.dataset.view));
    setFlypastView(flypastView);
    // binoculars on a flypast, as it's ordered (on unless turned off; remembered)
    const binocularsOn = (() => { try { return localStorage.getItem('flypast-binoculars') !== '0'; } catch { return true; } })();
    afBinoculars?.setAttribute('aria-checked', String(binocularsOn));
    afBinoculars?.addEventListener('click', () => {
      const on = afBinoculars.getAttribute('aria-checked') !== 'true';
      afBinoculars.setAttribute('aria-checked', String(on));
      remember('flypast-binoculars', on);
      if (airForce.flypast.active) (on ? binoculars.watch(airForce.flypast) : binoculars.lower());
    });
    setWingman(recalled('airforce-wingman'));
    setRunwaysOnMap(recalled('map-runways'));
  } else {
    afButton?.remove();
    afPopover?.remove();
  }
  // Riding in the flypast (the camera in a wingman's or the slot's front seat, or a chase plane), then back to the
  // view's own lens; the sonic booms as each jet's Mach cone reaches the camera (js/jet-acoustics.js), and the view
  // shaken by them
  const boomWatcher = new BoomWatcher();
  const booms = [];
  let riding = false, ridingFov = 0, shake = 0;
  let flypastTrails = null;
  function watchFlypast(dt, elapsed) {
    const cam = cameraSystem.camera;
    const f = airForce.flypast;
    // (the wingman flies with the camera when it's on your jet: heard as it is)
    airForce.wingman.jet.sound.direct = controllerManager.activeMode === 'jet';
    const ride = flypastView !== 'ground' && f.active && f.ride(flypastView, cam);
    if (ride !== riding) {
      if (ride) ridingFov = cam.fov;
      else {
        f.ride(null, cam);
        cam.fov = ridingFov;
        cam.updateProjectionMatrix();
      }
      riding = ride;
      document.body.classList.toggle('flypast-ride', ride);
      for (const a of f.jets) a.sound.direct = ride;
    }
    if (ride) {
      const fov = flypastView === 'chase' ? 58 : 74;
      if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    }
    const p = cam.position;
    flypastTrails ??= airForce.aircraft.map((a) => a.trail);
    for (const b of boomWatcher.check(flypastTrails, elapsed, p.x, p.y, p.z, booms)) {
      audioSystem.boom(b.intensity, b.x, b.y, b.z);
      shake = Math.max(shake, b.intensity);
    }
    if (shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * 0.35 * shake;
      cam.position.y += (Math.random() - 0.5) * 0.35 * shake;
      cam.rotateX((Math.random() - 0.5) * 0.02 * shake);
      cam.rotateZ((Math.random() - 0.5) * 0.015 * shake);
      shake *= Math.exp(-dt * 4.5);
    }
  }

  // the flypast's countdown in the menu, while it's on its way
  let afShown = '';
  function updateAirForceMenu() {
    if (!airForce || !afFlypast) return;
    const f = airForce.flypast;
    const m = f.formation;
    const text = !f.active ? afFlypastText : f.overhead > 0 ? `${m.name} inbound: overhead in ${Math.ceil(f.overhead)} s` : f.eta > 0 ? `${m.name} overhead: ${m.manoeuvre} in ${Math.ceil(f.eta)} s` : `${m.name}, ${m.manoeuvre}: look up`;
    if (text === afShown) return;
    afShown = text;
    afFlypastSub.textContent = text;
    afFlypast.disabled = f.active;
  }

  // Drive to a destination (js/navigation.js): turn-by-turn for you, or the self-driving or Crazy Taxi autopilot driving
  // the car over the traffic's own road graph
  // Beyond the detailed city, over the island's main roads: their graph joined to the city's, built in a worker once the
  // roads have loaded and put together here between frames (js/island-network.js createIslandGraph)
  const islandGraph = createIslandGraph({
    city: trafficSystem.network, keepLeft: CITY.driveSide === 'left', coreRing: cityTiles?.index?.coreRing || null,
    makeWorker: () => new Worker(new URL('./island-network-worker.js', import.meta.url), { type: 'module' }),
    onReady: (net) => routeNavigator.setNetwork(net)
  });
  islandRoadsLoading.then((roads) => roads && islandGraph.start(roads, new URL(`${cityTiles.url}roads.json`, location.href).href));
  const resolveNetwork = (a, b) => islandGraph.resolve(a, b);
  const routeNavigator = new Navigator({ network: trafficSystem.network, trafficSystem, islandTraffic, controllerManager, audioSystem, resolveNetwork });
  // The MRT (js/mrt-system.js, tiles/<city>/mrt.json): its viaducts across the island, and rides on its trains, from
  // the station nearest you to the one nearest where you're going (the ways strip's MRT, the map's Take the MRT here)
  const mrtSystem = cityTiles?.index && CITY.id === 'singapore' ? new MrtSystem({
    scene, audioSystem, cameraSystem,
    onToast: (text) => navigationUI?.toast(text, 2600),
    // under the ground nothing of the street is seen; the pedestrian crowds draw garbage across the view from below
    // them, so they're left out while the camera is down there
    onUnderground: (on) => {
      scene.traverse((o) => {
        if (!o.isMesh || !/^People(Near|Far)$/.test(o.name)) return;
        if (on) { o.userData.mrtWasVisible = o.visible; o.visible = false; } else if (o.userData.mrtWasVisible !== undefined) { o.visible = o.userData.mrtWasVisible; delete o.userData.mrtWasVisible; }
      });
    },
    onEnd: ({ station, exit }) => {
      // out of the station, on foot, at its exit
      selectMode('person');
      const x = exit ? exit[0] : station.x, z = exit ? exit[1] : station.z;
      teleportTo(x, z, controllerManager.getActiveEntity().heading);
      navigationUI?.toast(`${station.name}${exit && exit[2] ? `, exit ${exit[2]}` : ''}`, 2200);
    }
  }) : null;
  if (mrtSystem) {
    // (its trains, stations & tunnels move: their world matrices are kept up each frame with the rest that does)
    dynamicRoots.push(mrtSystem.root);
    mrtSystem.load(`${cityTiles.url}mrt.json`).catch((e) => console.warn(`[mrt] none: ${e.message}`));
  }
  const rideMrt = mrtSystem ? (x0, z0, x1, z1, name) => {
    if (!mrtSystem.rideBetween(x0, z0, x1, z1, name)) return false;
    // (the controls let go: you're a passenger)
    touchControls.reset();
    gamepadControls.reset();
    controllerManager.setAutopilotInput?.(null);
    return true;
  } : null;
  const navigationUI = setupNavigationUI({ navigator: routeNavigator, mapSystem, controllerManager, selectMode, closePopovers, teleport: teleportTo, mrt: rideMrt });
  // (the ways strip centres its choice by measuring it: again once the HUD font is in)
  document.fonts?.ready?.then(() => navigationUI.layout());
  // What the autopilot sees, over the view (js/perception-overlay.js): the Navigate menu's switch & [O], remembered
  const perceptionOverlay = new PerceptionOverlay(document.body, { metric: CITY.units === 'metric' });
  const overlaySwitch = document.getElementById('nav-overlay');
  function setOverlay(on) {
    perceptionOverlay.setEnabled(on);
    overlaySwitch?.setAttribute('aria-checked', String(on));
    try { localStorage.setItem('perception-overlay', on ? '1' : '0'); } catch { /* storage unavailable */ }
  }
  overlaySwitch?.addEventListener('click', () => setOverlay(!perceptionOverlay.enabled));
  try { if (localStorage.getItem('perception-overlay') === '1') setOverlay(true); } catch { /* storage unavailable */ }

  if (hudToggleBtn) {
    hudToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('hud-minimized');
      const isMin = document.body.classList.contains('hud-minimized');
      hudToggleBtn.setAttribute('aria-pressed', String(isMin));
      hudToggleBtn.setAttribute('aria-label', isMin ? 'Show HUD' : 'Hide HUD');
      hudToggleBtn.title = isMin ? 'Show the HUD [H]' : 'Clean view: hide the HUD [H]';
      if (isMin) closePopovers();
    });
  }

  // Global keyboard shortcuts for modes (1-4), cameras (V / 5-0), and HUD (H)
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    switch (e.code) {
      case 'Digit1':
        selectMode('person');
        break;
      case 'Digit2':
        selectMode('car');
        break;
      case 'Digit3':
        selectMode('cyclist');
        break;
      case 'Digit4':
        selectMode('helicopter');
        break;
      case 'KeyJ':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) selectMode('jet');
        break;
      case 'Digit5':
        selectCamera('chase', true);
        break;
      case 'Digit6':
        selectCamera('action', true);
        break;
      case 'Digit7':
        selectCamera('pov', true);
        break;
      case 'Digit8':
        selectCamera('fifthAve', true);
        break;
      case 'Digit9':
        selectCamera('timesSquare', true);
        break;
      case 'Digit0':
        selectCamera('chryslerGCT', true);
        break;
      case 'KeyO':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) setOverlay(!perceptionOverlay.enabled);
        break;
      case 'KeyT':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) selectCamera('taxi', true);
        break;
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'KeyR':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) toggleStorm();
        break;
      case 'KeyN':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) audioSystem.setEnabled(!audioSystem.enabled);
        break;
      case 'KeyG':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !mapSystem.isFullMapOpen) navigationUI.toggleMenu();
        break;
      case 'BracketLeft':
      case 'BracketRight':
        if (!e.metaKey && !e.ctrlKey && !e.altKey && !mapSystem.isFullMapOpen) navigationUI.step(e.code === 'BracketLeft' ? -1 : 1);
        break;
      case 'KeyZ':
        // the binoculars, on a flypast
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && airForce?.flypast.active && flypastView === 'ground') binoculars.toggle(airForce.flypast);
        break;
      case 'KeyX':
        // where the flypast is watched from: the next one
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && airForce) setFlypastView(FLYPAST_VIEWS[(FLYPAST_VIEWS.indexOf(flypastView) + 1) % FLYPAST_VIEWS.length]);
        break;
      case 'KeyB':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !mapSystem.isFullMapOpen) audioSystem.honk(controllerManager.getActiveEntity());
        break;
    }
  });

  window.addEventListener('resize', () => {
    cameraSystem.onResize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
    placeModeIndicator();
    navigationUI.layout();
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  });

  // Initialize the UI and chase camera around the restored player, or the default taxi on a first visit.
  selectMode(controllerManager.activeMode);
  selectCamera('chase', true);
  selectTime('golden');
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeModeIndicator);
  markInit('ui');

  // The loading screen stays up while the shaders compile (precompileShaders() & the warm-up frame, see the loop) and
  // until the first frame is on screen
  if (loadingStatus) {
    loadingStatus.textContent = 'Compiling Shaders & Render Pipelines...';
  }

  // 6b. Shader pre-compilation behind the loading screen. compileAsync() builds the node graphs in slices and has the GPU
  //     process compile the pipelines in parallel, but after every 8 ms slice it waits for a rendered frame, which
  //     leaves the main thread idle about half the time while nothing else animates; several calls side by side keep
  //     it busy (warm cache: 2.1 s instead of 4.0 s). (Rendering straight away compiled ~500 pipelines one after
  //     another: ~25 s with a cold shader cache.)
  const COMPILE_POOL = 16;
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders() {
    // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
    // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
    scene.visible = false;
    renderPipeline.render();
    scene.visible = true;
    markInit('postFX');

    // Every visible object with frustum culling off (like the warm-up frame, see the loop). Plain meshes that share
    // a material share its shader, so one job compiles them in turn (the first build serves the rest); every
    // instanced mesh gets a build of its own unless its chunks share a pipeline
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    const pipelines = new Set();
    scene.traverseVisible((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      // Use the first visible chunk: the original representative may be in an inactive tree cell. Shadow stand-ins
      // only draw in the shadow maps (the warm-up frame compiles those).
      if (o.userData.shadowProxy) return;
      const pipeline = o.userData.sharesPipelineWith || o;
      if (pipelines.has(pipeline)) return;
      pipelines.add(pipeline);
      if (o.isInstancedMesh || Array.isArray(o.material)) {
        jobs.push([o]);
        return;
      }
      let job = jobByMaterial.get(o.material);
      if (!job) {
        job = [];
        jobByMaterial.set(o.material, job);
        jobs.push(job);
      }
      job.push(o);
    });

    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(sceneMRT);
    const compile = async (object) => {
      // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer,
      // which must not be mid-step for two of them in the same microtask checkpoint
      await nextTask();
      try {
        await renderer.compileAsync(object, cameraSystem.camera, scene);
      } catch (e) {
        console.warn('[compile]', e); // the warm-up frame compiles it instead
      }
    };
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (const object of job) await compile(object);
        done++;
        if (loadingStatus) {
          loadingStatus.textContent = `Compiling Shaders & Render Pipelines... ${Math.round((done / jobs.length) * 100)}%`;
        }
        setLoadingProgress(done / jobs.length);
      }
    };
    await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    for (const o of culled) o.frustumCulled = true;
  }

  // For poking at from the console (and the browser checks): the simulation's main systems
  globalThis.slop = { mrt: mrtSystem, scene, autoTrees, airForce, binoculars, navigator: routeNavigator, perceptionOverlay, trafficSystem, controllerManager, cameraSystem, lightingSystem, audioSystem, cityTiles, cityLandmarks, weather, mapSystem, islandTraffic, islandSignals, get islandRoads() { return islandRoads; }, teleportTo };

  await precompileShaders();
  markInit('compile');

  // 6. Animation Loop
  let lastTime = performance.now();
  let elapsed = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let nextPlayerSave = 0;
  let warmedUp = false; // see the first frame below

  if (elFps) elFps.textContent = '60';

  renderer.setAnimationLoop((now) => {
    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    elapsed += dt;

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    gamepadControls.update(dt);
    routeNavigator.update(dt, elapsed); // (the autopilot's inputs, for this frame's car update)
    navigationUI.update(dt);
    // (a passenger on the MRT moves with the train, not by the controls)
    if (!mrtSystem?.riding) controllerManager.update(dt, elapsed);
    if (airForce) airForce.update(dt, elapsed, cameraSystem.camera); // (the wingman follows where the jet went this frame)
    binoculars.before();
    cameraSystem.update(dt, elapsed);
    // riding the MRT: the view is from the train
    if (mrtSystem?.riding) mrtSystem.update(dt);
    binoculars.update(dt, elapsed);
    if (binoculars.active !== document.body.classList.contains('binoculars-up')) document.body.classList.toggle('binoculars-up', binoculars.active);
    if (airForce) watchFlypast(dt, elapsed);
    streetDetails.signalClock.value = elapsed;
    trafficSystem.update(
      dt,
      elapsed,
      cameraSystem.currentPos,
      controllerManager.getActiveEntity(),
      controllerManager.activeMode,
      cameraSystem.camera
    );
    highwayTraffic.update(dt, cameraSystem.camera, controllerManager.getActiveEntity(), controllerManager.activeMode);
    if (!document.hidden && now >= nextPlayerSave) {
      savePlayerState();
      nextPlayerSave = now + 5000;
    }
    if (boroughs.update) boroughs.update(elapsed); // Roosevelt Island Tramway cabins
    if (cityLandmarks) cityLandmarks.update(elapsed, lightingSystem.activePresetId === 'midnight' || lightingSystem.activePresetId === 'twilight');
    cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z);
    if (cityBlocks.updateLights) cityBlocks.updateLights(cameraSystem.camera);
    if (streetDetails.update) streetDetails.update(cameraSystem.camera, controllerManager.getActiveEntity());
    lightingSystem.update(cameraSystem.currentPos);
    mapSystem.update();
    if (weather) weather.update(dt, cameraSystem.camera);
    if (cityTiles) cityTiles.update(cameraSystem.camera);
    if (islandTraffic) islandTraffic.update(dt, cameraSystem.camera, controllerManager.getActiveEntity(), controllerManager.activeMode, elapsed);
    if (islandSignals) {
      islandSignals.update(cameraSystem.camera, elapsed);
      // the island's red light cameras: the fine notice the detailed city's give
      if (streetDetails.notice && islandSignals.ranRed(controllerManager.getActiveEntity(), elapsed)) streetDetails.notice(...RED_LIGHT_FINE);
    }
    audioSystem.setAmbience(lightingSystem.activePresetId, weather ? weather.storm : 0);
    audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.activePresetId === 'midnight');
    if (warmedUp) updateSceneCulling(cameraSystem.camera.position); // the warm-up frame draws every chunk
    // Traffic collisions can move the player after controller updates; finalize moving hierarchies here.
    for (const root of dynamicRoots) root.updateMatrixWorld();

    // what the autopilot sees, over this frame (when shown)
    perceptionOverlay.update(routeNavigator, controllerManager.getActiveEntity(), cameraSystem.camera, THREE.Vector3);
    {
      const preset = cameraSystem.activePresetId;
      const jet = controllerManager.entities.jet;
      const cockpit = controllerManager.activeMode === 'jet' && (preset === 'pov' || preset === 'taxi');
      // from the front seat: the cockpit around you, out through the canopy (drawn opaque from outside)
      jet.model.setCockpitView(cockpit);
      if (controllerManager.activeMode === 'jet') {
        // the HUD stays on the jet's boresight as the pilot's head turns, seen through its combiner within ~12°
        let bore = null;
        if (cockpit) {
          const cam = cameraSystem.camera;
          const q = jet.flight.q;
          const fwd = hudForward.set(0, 0, 1).applyQuaternion(hudQuat.set(q[0], q[1], q[2], q[3]));
          const off = fwd.angleTo(cam.getWorldDirection(hudView));
          cam.updateMatrixWorld();
          const ndc = hudPoint.copy(cam.position).addScaledVector(fwd, 5000).project(cam);
          bore = {
            x: (ndc.x * 0.5 + 0.5) * window.innerWidth, y: (0.5 - ndc.y * 0.5) * window.innerHeight,
            alpha: ndc.z < 1 ? 1 - THREE.MathUtils.smoothstep(off, 0.12, 0.3) : 0
          };
        }
        jetHud.update(dt, jet, cameraSystem.camera, cockpit, bore);
      }
    }
    if (airForce) {
      updateAirForceMenu();
    }

    // Render frame via TSL RenderPipeline (SSR + Bloom)
    if (!warmedUp) {
      // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
      // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
      // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
      const culled = [];
      const pipelines = new Set();
      scene.traverseVisible((o) => {
        const pipeline = o.userData.sharesPipelineWith || o;
        if (pipelines.has(pipeline)) return;
        pipelines.add(pipeline);
        if (o.frustumCulled) {
          culled.push(o);
          o.frustumCulled = false;
        }
      });
      renderPipeline.render();
      for (const o of culled) o.frustumCulled = true;
      markInit('warmup');
    }
    renderPipeline.render();
    if (!warmedUp) {
      warmedUp = true;
      markInit('firstFrame');
      // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
      // compiled), i.e. until the city is actually on screen
      const device = renderer.backend.device;
      Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {}).then(() => {
        markInit('gpu');
        console.log(`[init] ${initTimings.join(', ')}`);
        initTimings = null;
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        audioSystem.ready = true;
        setLoadingProgress(1);
      });
    }

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    frameCount++;
    fpsTimer += Math.max(0, rawDt);
    if (autoTrees) autoTrees.update(rawDt);
    if (fpsTimer >= 0.25) {
      const currentFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;

      const activeEnt = controllerManager.getActiveEntity();
      const mode = controllerManager.activeMode;
      const mph = Math.round(Math.abs(activeEnt.speed) * (metric ? 3.6 : 2.237)); // (km/h in a metric city)
      const altFt = Math.max(0, Math.round(activeEnt.position.y * (metric ? 1 : 3.281)));

      if (elFps) {
        elFps.textContent = String(currentFps);
        elFps.className = currentFps >= 50 ? 'fps-ok' : currentFps >= 30 ? 'fps-warn' : 'fps-bad';
      }
      if (elSpeed) elSpeed.textContent = String(mph);
      if (elSpeedMeter) elSpeedMeter.style.transform = `scaleX(${Math.min(1, mph / ((topSpeedMph[mode] || 80) * (metric ? 1.609 : 1)))})`;
      if (elAltitude) elAltitude.textContent = altFt.toLocaleString('en-US');
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos;
      renderLocation(getLocationLabel(where.x, where.z));
    }
  });
}

initApp();
