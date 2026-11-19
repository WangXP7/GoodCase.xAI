import { build } from 'esbuild';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, '.tmp-three-vendor-entry.mjs');
const outfile = resolve(root, 'vendor/three/tinyworld-three.r185.min.js');

const source = `
import * as THREE_CORE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { VOXLoader, VOXMesh, VOXData3DTexture, buildMesh as buildVOXMesh, buildData3DTexture as buildVOXData3DTexture } from 'three/addons/loaders/VOXLoader.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const root = globalThis;
const TinyWorldInstancedMesh = class TinyWorldInstancedMesh extends THREE_CORE.InstancedMesh {
  constructor(...args) {
    super(...args);
    // r151 changed InstancedMesh to frustum-cull by default. TinyWorld's
    // pre-r151-authored instance batches often update matrices after construction and
    // only opt specific bounds-aware systems into culling, so preserve the old
    // safe default here.
    this.frustumCulled = false;
  }
};
const THREE = Object.assign({}, THREE_CORE, {
  InstancedMesh: TinyWorldInstancedMesh,
  DRACOLoader,
  FBXLoader,
  GLTFLoader,
  KTX2Loader,
  USDZExporter,
  VOXLoader,
  VOXMesh,
  VOXData3DTexture,
  buildVOXMesh,
  buildVOXData3DTexture,
});

// TinyWorld is still a classic-script app. three.js removed classic builds in
// r160 and classic addon scripts in r148, so this bundle exposes the r185 ES
// modules through the legacy global namespace the app expects.
THREE.MeshoptDecoder = MeshoptDecoder;
THREE.sRGBEncoding = THREE.SRGBColorSpace;
THREE.LinearEncoding = THREE.LinearSRGBColorSpace;

// Compatibility shims for older TinyWorld modules/proof pages while the app
// migrates fully to r152+ color-space property names.
if (THREE.Texture && !Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'encoding')) {
  Object.defineProperty(THREE.Texture.prototype, 'encoding', {
    configurable: true,
    get() { return this.colorSpace; },
    set(value) { this.colorSpace = value; },
  });
}
if (THREE.WebGLRenderer && !Object.getOwnPropertyDescriptor(THREE.WebGLRenderer.prototype, 'outputEncoding')) {
  Object.defineProperty(THREE.WebGLRenderer.prototype, 'outputEncoding', {
    configurable: true,
    get() { return this.outputColorSpace; },
    set(value) { this.outputColorSpace = value; },
  });
}

root.THREE = THREE;
root.MeshoptDecoder = MeshoptDecoder;
root.__tinyworldKTX2LoaderClass = KTX2Loader;
root.__tinyworldThreeRevision = THREE.REVISION;
`;

await mkdir(dirname(outfile), { recursive: true });
const addonPathPlugin = {
  name: 'tinyworld-addon-paths',
  setup(buildApi) {
    buildApi.onLoad({ filter: /three\/examples\/jsm\/loaders\/DRACOLoader\.js$/ }, async (args) => {
      let contents = await readFile(args.path, 'utf8');
      contents = contents
        .replace(/new URL\( '\.\.\/libs\/draco\/draco_decoder\.wasm', import\.meta\.url \)\.toString\(\)/g, "'vendor/three/draco/draco_decoder.wasm'")
        .replace(/new URL\( '\.\.\/libs\/draco\/draco_wasm_wrapper\.js', import\.meta\.url \)\.toString\(\)/g, "'vendor/three/draco/draco_wasm_wrapper.js'")
        .replace(/new URL\( '\.\.\/libs\/draco\/draco_decoder\.js', import\.meta\.url \)\.toString\(\)/g, "'vendor/three/draco/draco_decoder.js'")
        .replace(/new URL\( '\.\.\/libs\/draco\/gltf\/draco_wasm_wrapper\.js', import\.meta\.url \)\.toString\(\)/g, "'vendor/three/draco/draco_wasm_wrapper.js'")
        .replace(/new URL\( '\.\.\/libs\/draco\/gltf\/draco_decoder\.wasm', import\.meta\.url \)\.toString\(\)/g, "'vendor/three/draco/draco_decoder.wasm'");
      return { contents, loader: 'js' };
    });
    buildApi.onLoad({ filter: /three\/examples\/jsm\/loaders\/KTX2Loader\.js$/ }, async (args) => {
      let contents = await readFile(args.path, 'utf8');
      contents = contents
        .replace(/new URL\( '\.\.\/libs\/basis\/basis_transcoder\.wasm', import\.meta\.url \)\.toString\(\)/g, "'vendor/three/basis/basis_transcoder.wasm'")
        .replace(/new URL\( '\.\.\/libs\/basis\/basis_transcoder\.js', import\.meta\.url \)\.toString\(\)/g, "'vendor/three/basis/basis_transcoder.js'");
      return { contents, loader: 'js' };
    });
  },
};

await writeFile(entry, source);
try {
  await build({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    sourcemap: false,
    legalComments: 'inline',
    plugins: [addonPathPlugin],
    banner: {
      js: '/* TinyWorld Three.js r185 global bundle. Generated by tools/build-three-vendor.mjs from three@0.185.0. */',
    },
  });
} finally {
  await unlink(entry).catch(() => {});
}
console.log('Wrote ' + outfile);
