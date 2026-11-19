// Valor VOLÁTIL dentro de bloco gerado (contagem, tamanho, linha): só o release o reescreve.
// No PR, `mesclar` mantém o valor que já está commitado e confere só o resto da linha.
const ABRE = '\u0001';
const FECHA = '\u0002';
export const v = (x) => `${ABRE}${x}${FECHA}`;
export const limpa = (t) => t.replace(/[\u0001\u0002]/g, '');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const esqueleto = (linha) => new RegExp(`^${linha.split(/\u0001[^\u0002]*\u0002/).map(esc).join('.*?')}$`);

/* Linha com valor volátil fica com a primeira linha atual AINDA LIVRE de mesmo esqueleto
   (sem cursor: símbolo que muda de lugar não arrasta o resto); sem par, sai com o valor medido. */
export function mesclar(modelo, atual) {
  const antigas = (atual || '').split('\n');
  const usadas = new Set();
  return modelo.split('\n').map((linha) => {
    if (!linha.includes(ABRE)) return linha;
    const re = esqueleto(linha);
    const i = antigas.findIndex((velha, k) => !usadas.has(k) && re.test(velha));
    if (i < 0) return limpa(linha);
    usadas.add(i);
    return antigas[i];
  }).join('\n');
}
