// Release build: the whole game as one minified module in dist/, loaded by index.html at the
// project root (the page GitHub Pages serves). Everything in the page is addressed relatively,
// so the folder works from any path.
//   node tools/build.mjs
import { build } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const t0 = Date.now();

fs.rmSync(out, { recursive: true, force: true });
const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  outfile: path.join(out, 'game.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'external',
  metafile: true,
  logLevel: 'warning',
});

// the libraries inside the bundle travel with their licences
const libraries = [
  ['three.js', 'node_modules/three/LICENSE'],
  ['cannon-es', 'node_modules/cannon-es/LICENSE'],
];
const notices = libraries.map(([name, file]) => `${name}\n${'-'.repeat(name.length)}\n\n${fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n').trim()}\n`);
fs.writeFileSync(path.join(out, 'THIRD-PARTY-LICENSES.txt'), 'dist/game.js contains the libraries below, each under its own licence.\n\n' + notices.join('\n\n'));

// stamp the page with the bundle's hash, so a new build is never served from an old cache
const code = fs.readFileSync(path.join(out, 'game.js'));
const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 10);
const pagePath = path.join(root, 'index.html');
const page = fs.readFileSync(pagePath, 'utf8');
const stamped = page.replace(/dist\/game\.js(\?v=[a-z0-9]*)?/g, 'dist/game.js?v=' + hash);
if (stamped === page && !page.includes('dist/game.js?v=' + hash)) throw new Error('index.html does not load dist/game.js');
fs.writeFileSync(pagePath, stamped);

// every file the page names must exist
const missing = [];
for (const m of stamped.matchAll(/(?:href|src)="([^"#?]+)(?:\?[^"]*)?"|url\('([^')]+)'\)/g)) {
  const ref = m[1] || m[2];
  if (/^(https?:|data:|#)/.test(ref)) continue;
  if (!fs.existsSync(path.join(root, ref))) missing.push(ref);
}
if (missing.length) throw new Error('index.html names files that do not exist: ' + missing.join(', '));

const inputs = Object.keys(result.metafile.inputs);
const own = inputs.filter((f) => !f.includes('node_modules')).length;
console.log(`dist/game.js  ${(code.length / 1024).toFixed(0)} KB  (${own} game modules + ${inputs.length - own} library modules)  v=${hash}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
