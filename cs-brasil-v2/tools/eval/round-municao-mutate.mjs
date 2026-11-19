// Mutantes do contrato de munição entre rounds (round-municao-check.mjs). Muda a FONTE
// executada (cópia em artifacts/, imports relativos resolvidos pra file://) — nada do
// checkout é sobrescrito. Esperado: todo mutante KILLED com as falhas previstas.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SRC = 'public/js/game.js';
const OUT = 'artifacts/round-municao';
mkdirSync(OUT, { recursive: true });
const source = readFileSync(SRC, 'utf8');
const BLOCO = /    \/\/ ROUND NOVO, LOADOUT CHEIO[\s\S]*?\n    }\n/.exec(source)?.[0];
if (!BLOCO) throw new Error('âncora do refill não encontrada — mutante impossível');

const trials = [
  // o bug do relato de volta: round novo herda o pente do round anterior
  ['sem-refill', source.replace(BLOCO, ''), ['round novo com primaria cheia']],
  // top-off sem a guarda de modo: presenteia pistola no SÓ AWP e rifle no modo FACA
  ['refill-ignora-modo', source.replace('this._pickupAllowed(slot) && ', ''),
    ['awp: pistola continua seca', 'knife: pistola seca', 'knife: arma do personagem não ganha pente']],
];

const results = [];
for (const [name, body, esperadas] of trials) {
  if (body === source) throw new Error(`mutação não aplicou: ${name}`);
  const file = resolve(`${OUT}/${name}.mjs`);
  // imports relativos do game.js apontam pro checkout real; a cópia mutada continua
  // importando os módulos irmãos originais
  writeFileSync(file, body.replace(/from '(\.\/[^']+)'/g,
    (_, p) => `from '${pathToFileURL(resolve(dirname(SRC), p)).href}'`));
  const run = spawnSync(process.execPath, ['tools/eval/round-municao-check.mjs', `--game-module=${file}`],
    { encoding: 'utf8' });
  writeFileSync(`${OUT}/${name}.log`, run.stdout + run.stderr);
  let failed = [];
  try { failed = JSON.parse(run.stdout.split('\n{').length > 1 ? '{' + run.stdout.split('\n{').slice(1).join('\n{') : run.stdout).failed; } catch { failed = ['<sem json>']; }
  const ok = run.status === 1 && esperadas.every((e) => failed.includes(e))
    && esperadas.length === failed.length;
  results.push({ name, status: run.status, failed, esperadas, ok });
  console.log(name, ok ? 'KILLED' : 'SURVIVED', JSON.stringify(failed));
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
if (results.some((r) => !r.ok)) process.exitCode = 1;
