import { existsSync, readFileSync, rmSync } from 'node:fs';

export function freshReport(path, produce) {
  // map_check.json é versionado; sem remover o antigo, um timeout parece medição atual.
  rmSync(path, { force: true });
  const output = produce();
  // O auditor pode rodar assíncrono (as invariantes medem e paralelizam cada um): aí a
  // leitura espera ele terminar, e a remoção acima continua ANTES de ele começar.
  if (typeof output?.then === 'function') return output.then((o) => ler(path, o));
  return ler(path, output);
}

function ler(path, output) {
  if (!existsSync(path)) {
    const reason = String(output).split('__ERRO__')[1]?.trim() || 'verifique a execução do auditor';
    return { data: null, error: `auditoria não gravou relatório novo: ${reason.slice(0, 180)}` };
  }
  try {
    return { data: JSON.parse(readFileSync(path, 'utf8')), error: null };
  } catch (error) {
    return { data: null, error: `relatório novo inválido: ${error.message}` };
  }
}
