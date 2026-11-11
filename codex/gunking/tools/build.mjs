import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const meta = JSON.parse(read('case-meta.json'));
const original = fs.readFileSync(path.join(root, meta.originalFile));
const hash = crypto.createHash('sha256').update(original).digest('hex');
if (hash !== meta.originalSHA256) throw Error('Original file hash changed; refusing to overwrite the published copy');
const vendor = read('vendor/three-r180.js');
const game = read('src/game.js');
// Preserve the original shared lexical scope. These files are ordered source
// fragments, not independently loadable ES modules.
const code = `(()=>{\n${vendor}\n${game}\n})();`;
new vm.Script(code, { filename: 'GunKing-built.js' });
const html = read('src/page.html')
  .replace('<!--GAME_STYLE-->', () => read('src/ui.css'))
  .replace('<!--GAME_CODE-->', () => code);
if (html.includes('<!--GAME_')) throw Error('Unresolved build placeholder');
// Default publication is a byte-for-byte copy of the untouched original.
// --editable builds a separate preview only, for later authorized edits.
const editable = process.argv.includes('--editable');
const name = editable ? 'editable.html' : 'index.html';
const output = editable ? Buffer.from(html) : original;
const target = path.join(root, name);
if (process.argv.includes('--check')) {
  if (!fs.readFileSync(target).equals(output)) throw Error(`${name} differs: run node tools/build.mjs`);
  console.log('PASS: original SHA256, syntax, and publication bytes match');
} else {
  fs.writeFileSync(target, output);
  console.log(`Built ${name} (${output.length} bytes), original preserved`);
}
