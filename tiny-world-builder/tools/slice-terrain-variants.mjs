#!/usr/bin/env node
import { mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'textures/terrain-variants/source/tw.png');
const outputDir = path.join(root, 'textures/terrain-variants');

const crops = [
  // Grass
  { name: 'grass-plain-01', x: 14, y: 45, w: 124, h: 116 },
  { name: 'grass-plain-02', x: 151, y: 45, w: 128, h: 116 },
  { name: 'grass-mushrooms-01', x: 294, y: 45, w: 126, h: 116 },
  { name: 'grass-flowers-01', x: 435, y: 45, w: 137, h: 116 },
  { name: 'grass-mushrooms-02', x: 588, y: 45, w: 126, h: 116 },
  { name: 'grass-flower-01', x: 725, y: 45, w: 116, h: 116 },

  // Mud / dirt
  { name: 'dirt-blocks-01', x: 970, y: 45, w: 136, h: 116 },
  { name: 'dirt-clean-01', x: 1119, y: 45, w: 127, h: 116 },
  { name: 'dirt-clean-02', x: 1261, y: 45, w: 126, h: 116 },
  { name: 'dirt-pebbles-01', x: 1400, y: 45, w: 125, h: 116 },

  // Stone / pavers
  { name: 'stone-blocks-01', x: 14, y: 233, w: 126, h: 116 },
  { name: 'stone-broken-01', x: 152, y: 233, w: 89, h: 116 },
  { name: 'stone-slabs-01', x: 255, y: 233, w: 116, h: 116 },
  { name: 'stone-moss-01', x: 383, y: 233, w: 116, h: 116 },

  // Cliff / rock faces
  { name: 'rock-cliff-01', x: 524, y: 233, w: 128, h: 126 },
  { name: 'rock-cliff-02', x: 665, y: 233, w: 126, h: 126 },
  { name: 'rock-cliff-moss-01', x: 804, y: 233, w: 116, h: 126 },
  { name: 'rock-cliff-moss-02', x: 930, y: 233, w: 116, h: 126 },

  // Path / pavers
  { name: 'path-pavers-01', x: 16, y: 441, w: 110, h: 116 },
  { name: 'path-pavers-02', x: 137, y: 441, w: 114, h: 116 },
  { name: 'path-pavers-03', x: 262, y: 441, w: 114, h: 116 },
  { name: 'path-pavers-04', x: 389, y: 441, w: 110, h: 116 },

  // Wood planks / crates
  { name: 'wood-planks-01', x: 1072, y: 234, w: 98, h: 116 },
  { name: 'wood-planks-02', x: 1182, y: 234, w: 96, h: 116 },
  { name: 'wood-rings-01', x: 1286, y: 234, w: 124, h: 116 },
  { name: 'wood-crate-01', x: 1418, y: 234, w: 105, h: 116 },

  // Non-enhanced water variants
  { name: 'water-flat-01', x: 972, y: 636, w: 134, h: 116 },
  { name: 'water-flat-02', x: 1120, y: 636, w: 134, h: 116 },
  { name: 'water-ripples-01', x: 1267, y: 636, w: 131, h: 116 },
  { name: 'water-deep-01', x: 1413, y: 636, w: 111, h: 116 },
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(cmd + ' exited with ' + code));
    });
  });
}

async function main() {
  await access(source);
  await mkdir(outputDir, { recursive: true });
  for (const crop of crops) {
    const out = path.join(outputDir, crop.name + '.png');
    await run('magick', [
      source,
      '-filter', 'point',
      '-crop', `${crop.w}x${crop.h}+${crop.x}+${crop.y}`,
      '+repage',
      '-resize', '128x128!',
      out,
    ]);
    console.log(`wrote ${path.relative(root, out)}`);
  }
}

main().catch(err => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
