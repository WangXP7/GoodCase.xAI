import { spawnSync } from 'node:child_process';
const casos = { 'shared-shot-check.mjs': ['ultimo', 'parede', 'alcance'],
  'shared-shot-consumers-check.mjs': ['camera', 'remoto', 'proxy'] };
for (const [arquivo, mutantes] of Object.entries(casos)) {
  for (const mutante of [null, ...mutantes]) {
    const args = [new URL(arquivo, import.meta.url).pathname, ...(mutante ? [`--mutante=${mutante}`] : [])];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 2 ** 20 });
    const ok = mutante ? r.status === 1 && /^FALHA /m.test(r.stdout) && !r.stderr.includes('Error:') : r.status === 0;
    console.log(`${ok ? 'OK' : 'FALHA'} ${arquivo} ${mutante || 'normal'}`);
    if (!ok) { process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(1); }
  }
}
