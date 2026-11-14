import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const meta = JSON.parse(read('case-meta.json'));
const release = fs.readFileSync(path.join(root, meta.releaseFile));
const hash = crypto.createHash('sha256').update(release).digest('hex');
if (hash !== meta.releaseSHA256) throw Error('Restored release hash changed; inspect source-audit.json before publication');
// Preserve the supplied renamed version locally as evidence, without publishing it.
const inputPath = path.join(root, meta.inputFile);
if (fs.existsSync(inputPath) && crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex') !== meta.inputSHA256)
  throw Error('Supplied input backup changed');
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
// Default publication copies the audited restored Chinese release.
// --editable builds a separate preview for future authorized optimizations.
const editable = process.argv.includes('--editable');
const name = editable ? 'editable.html' : 'index.html';
const output = editable ? Buffer.from(html) : release;
const target = path.join(root, name);
if (process.argv.includes('--check')) {
  if (!fs.readFileSync(target).equals(output)) throw Error(`${name} differs: run node tools/build.mjs`);
  console.log('PASS: input backup, restored release SHA256, syntax and publication bytes');
} else {
  fs.writeFileSync(target, output);
  console.log(`Built ${name} (${output.length} bytes), input backup preserved`);
}
