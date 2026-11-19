#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexRaw = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const htmlRaw = fs.readFileSync(path.join(root, 'tiny-world-builder.html'), 'utf8');
const devServer = fs.readFileSync(path.join(root, 'tools/dev-server.js'), 'utf8');

// App logic lives in external modules (LandscapeEngine.js + engine/**/*.js)
// since the single-file HTML was split up. Match against the combined source
// so these guards still find the functions/markers they expect.
function collectAppModules(rootDir) {
  const out = [];
  const landscape = path.join(rootDir, 'LandscapeEngine.js');
  if (fs.existsSync(landscape)) out.push(fs.readFileSync(landscape, 'utf8'));
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) out.push(fs.readFileSync(full, 'utf8'));
    }
  };
  const engineDir = path.join(rootDir, 'engine');
  if (fs.existsSync(engineDir)) walk(engineDir);
  return out;
}
const html = htmlRaw + '\n' + collectAppModules(root).join('\n');

function fail(message) {
  console.error('smoke failed:', message);
  process.exit(1);
}
function requireIncludes(text, label) {
  if (!html.includes(text)) fail('missing ' + label + ': ' + text);
}
function requireNotIncludes(text, label) {
  if (html.includes(text)) fail('unexpected ' + label + ': ' + text);
}

requireIncludes('function setCell(', 'state mutation entry point');
requireIncludes('function renderCellObject(', 'object renderer');
requireIncludes('function applyTool(', 'tool application');
requireIncludes('function doClear(', 'clear action');
requireIncludes('function togglePerspective(', 'camera toggle');
requireIncludes('function runSeededVehicleDemo(', 'shareable vehicle seed demo');
requireIncludes('VEHICLE_DEMO_DEFAULT_SEED', 'vehicle demo default seed');
requireIncludes('vehicle-demo-badge', 'visible vehicle demo badge');
requireIncludes('M_VEHICLE.beacon', 'visible vehicle beacon marker');
requireIncludes('VEHICLE_COLLISION_RADIUS', 'vehicle collision radius');
requireIncludes('function getVehicleCollisionRisk(', 'vehicle collision risk check');
requireIncludes('function rerouteVehicleAroundTraffic(', 'traffic-aware vehicle reroute');
requireIncludes('function isVehicleDrivableCell(', 'object-aware vehicle drivable cell check');
requireIncludes('function refreshVehiclesForWorldObstacleChange(', 'vehicle reroute on world obstacle edits');
requireIncludes('__getVehicleRuntimeSnapshot', 'vehicle runtime debug snapshot');
requireIncludes('function makeCloud(', 'voxel cloud factory');
requireIncludes('function openTinyModal(', 'modal focus helper');
requireIncludes('customDepthMaterial', 'cloud shadow depth material');
requireIncludes('vendor/three/tinyworld-three.r185.min.js', 'self-hosted Three.js r185 bundle');
requireIncludes('vendor/three/VDBLoader.tinyworld.js', 'self-hosted TinyWorld VDBLoader');

const netlifyToml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
if (!netlifyToml.includes('publish = "dist"') || !netlifyToml.includes('command = "./publish.sh"')) {
  fail('netlify.toml does not point Netlify at publish.sh/dist');
}

requireNotIncludes('cdnjs.cloudflare.com/ajax/libs/three.js', 'Three.js CDN');
requireNotIncludes('cdn.jsdelivr.net/npm/three', 'GLTFLoader CDN');
requireNotIncludes('postTarget', 'post-processing render target');
requireNotIncludes('postMaterial', 'post-processing shader material');
requireNotIncludes('postProcessingEnabled', 'post-processing mode flag');
requireNotIncludes('render-smoothing', 'dead post smoothing control');
requireNotIncludes('cluso/cluso-embed.js', 'Cluso runtime script');
requireNotIncludes('cluso/cluso-embed.css', 'Cluso runtime stylesheet');

for (const asset of [
  'vendor/three/tinyworld-three.r185.min.js',
  'vendor/three/VDBLoader.tinyworld.js',
  'vendor/three/draco/draco_decoder.wasm',
  'vendor/three/basis/basis_transcoder.wasm',
]) {
  if (!fs.existsSync(path.join(root, asset))) fail('missing local asset ' + asset);
}

// Dev server should now default to the temporary landing page on bare access.
// The builder stays available at /tiny-world-builder for direct testing.
if (!devServer.includes("if (pathname === '/') return { file: path.resolve(root, 'index.html') };")) {
  fail('dev server bare root should serve index.html landing page');
}
if (!devServer.includes("pathname === '/tiny-world-builder'")) {
  fail('dev server should serve tiny-world-builder.html for normal access');
}
for (const landingNeedle of [
  'styles/landing.css',
  'assets/twlogo-wordmark.png',
  'assets/landing-hero.png',
  'assets/landing-feature-build.png',
  'assets/landing-feature-sculpt.png',
  'assets/landing-feature-fly.png',
  'assets/landing-feature-share.png',
  'href="/tiny-world-builder"',
]) {
  if (!indexRaw.includes(landingNeedle)) {
    fail('landing page missing required asset/link: ' + landingNeedle);
  }
}

console.log('smoke ok');
