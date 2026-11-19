import { mkdir, rename, access } from 'node:fs/promises';
// Keep the existing Vinext build separate from Genex's static upload directory.
await access('dist-game/index.html');
let previous = false;
try { await access('dist'); previous = true; } catch {}
if (previous) {
  await mkdir('.genex/build-cache', { recursive: true });
  await rename('dist', `.genex/build-cache/build-${Date.now()}`);
}
await rename('dist-game', 'dist');
console.log('Static game prepared in dist/. Previous generated build retained in .genex/build-cache/.');
