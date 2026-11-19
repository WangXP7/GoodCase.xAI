// Downloads the CC0 PBR textures used by the client from Poly Haven (https://polyhaven.com, CC0 1.0)
// into public/textures/<name>/{diff,nor}.jpg at 1K. Cached files are skipped.
// Usage: node tools/assets/fetch_textures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../pipeline/config.mjs';

// key -> Poly Haven asset. Facade textures are used as detail (the building colour tints them).
export const TEXTURES = {
  wall_tile: 'long_white_tiles',
  wall_concrete: 'concrete_tile_facade',
  wall_plaster: 'grey_plaster',
  wall_brick: 'brown_brick_02',
  wall_siding: 'box_profile_metal_sheet',
  asphalt: 'asphalt_02',
  pavers: 'interlocking_concrete_pavers',
  grass: 'leafy_grass',
  roof: 'concrete_floor_worn_001',
  ground: 'concrete_pavement',
};
const MAPS = { diff: ['Diffuse'], nor: ['nor_gl'] };

const OUT = path.join(ROOT, 'public/textures');
for (const [key, asset] of Object.entries(TEXTURES)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${asset}`)).json();
  for (const [map, [name]] of Object.entries(MAPS)) {
    const url = files[name]?.['1k']?.jpg?.url;
    const file = path.join(OUT, key, `${map}.jpg`);
    if (!url) { console.log(`${key}: no ${name} map`); continue; }
    if (fs.existsSync(file)) continue;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    console.log(`${key}/${map}.jpg  ${asset}  ${(buf.length / 1024).toFixed(0)} KB`);
  }
}
fs.writeFileSync(path.join(OUT, 'LICENSE.md'),
  '# Textures\n\nAll textures in this folder are from [Poly Haven](https://polyhaven.com) under CC0 1.0.\n\n' +
  Object.entries(TEXTURES).map(([k, a]) => `- \`${k}/\`: [${a}](https://polyhaven.com/a/${a})`).join('\n') + '\n');
