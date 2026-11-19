/* LEGAL-PAGES · as páginas legais usam o modelo aprovado e um só contato.
   ============================================================================
   O #807 aprovou o LegalPage (src/layouts/LegalPage.astro) para privacidade e
   termos. Páginas legais novas (exclusão de dados, regras de uso) entraram com
   o Layout genérico e um email de suporte diferente do contato verificado.
   Esta régua lê o FONTE (determinístico, sem build):

   LP1 · cada página legal importa o LegalPage e usa ele como raiz
   LP2 · a navegação do LegalPage aponta para todas as páginas legais
   LP3 · nenhum mailto nas páginas legais foge de LEGAL_CONTACT
   LP4 · a exclusão de dados está no sitemap (lojas pedem URL pública)

   Mutantes (em memória, cada um DEVE reprovar; se não acender, reprova como MUT):
     layout   excluir-dados volta para o Layout genérico -> LP1
     nav      o LegalPage perde o link de regras de uso  -> LP2
     email    regras de uso ganham outro endereço        -> LP3
     sitemap  /excluir-dados some do sitemap             -> LP4

   Uso: node tools/eval/legal-pages-check.mjs [--mutante=layout|nav|email|sitemap]
   ============================================================================ */
import { readFileSync } from 'node:fs';

const MUT = (process.argv.find((a) => a.startsWith('--mutante=')) || '').split('=')[1] || '';
const MUTANTES = { layout: 'LP1', nav: 'LP2', email: 'LP3', sitemap: 'LP4' };
if (MUT && !MUTANTES[MUT]) throw new Error(`mutante desconhecido: ${MUT}`);

const PAGINAS = {
  '/privacidade': 'src/pages/privacidade.astro',
  '/termos': 'src/pages/termos.astro',
  '/excluir-dados': 'src/pages/excluir-dados.astro',
  '/regras-de-uso': 'src/pages/regras-de-uso.astro',
};
const ler = (f) => readFileSync(f, 'utf8');
const trocar = (texto, de, para, nome) => {
  const novo = texto.replace(de, para);
  if (novo === texto) throw new Error(`mutante ${nome} não aplicou`);
  return novo;
};

const fontes = Object.fromEntries(Object.entries(PAGINAS).map(([rota, f]) => [rota, ler(f)]));
let modelo = ler('src/layouts/LegalPage.astro');
let sitemap = ler('src/pages/sitemap.xml.ts');
if (MUT === 'layout') {
  fontes['/excluir-dados'] = trocar(fontes['/excluir-dados'], /LegalPage/g, 'Layout', 'layout');
}
if (MUT === 'nav') modelo = trocar(modelo, /<a href="\/regras-de-uso"[^\n]*\n/, '', 'nav');
if (MUT === 'email') {
  fontes['/regras-de-uso'] = trocar(fontes['/regras-de-uso'], '</LegalPage>', '<p><a href="mailto:suporte@example.com">ajuda</a></p>\n</LegalPage>', 'email');
}
if (MUT === 'sitemap') sitemap = trocar(sitemap, /\['\/excluir-dados'[^\n]*\n/, '', 'sitemap');

const falhas = [];
const cobra = (id, ok, msg) => { if (!ok) falhas.push([id, msg]); };

for (const [rota, texto] of Object.entries(fontes)) {
  const corpo = texto.replace(/^---[\s\S]*?---\n?/, '').trim();
  cobra('LP1', /^import LegalPage from '\.\.\/layouts\/LegalPage\.astro';$/m.test(texto) && corpo.startsWith('<LegalPage ') && corpo.endsWith('</LegalPage>'),
    `${PAGINAS[rota]} precisa usar o LegalPage como raiz`);
  cobra('LP2', new RegExp(`<a href="${rota}" aria-current=`).test(modelo), `LegalPage não aponta para ${rota}`);
  for (const m of texto.matchAll(/mailto:([^"'?`\s]*)/g)) {
    cobra('LP3', m[1] === '${LEGAL_CONTACT}', `${PAGINAS[rota]} usa mailto:${m[1]} em vez de LEGAL_CONTACT`);
  }
}
cobra('LP4', /\['\/excluir-dados',/.test(sitemap), '/excluir-dados fora do sitemap');

if (MUT && !falhas.some(([id]) => id === MUTANTES[MUT])) falhas.push(['MUT', `mutante ${MUT} não acendeu ${MUTANTES[MUT]}`]);
for (const [id, msg] of falhas) console.error(`  \x1b[31m✗\x1b[0m ${id} ${msg}`);
if (falhas.length) {
  console.error(`\x1b[31mLEGAL-PAGES ${falhas.length} VERMELHA(S)\x1b[0m${MUT ? ` (mutante=${MUT})` : ''}`);
  process.exitCode = 1;
} else {
  console.log(`\x1b[32mLEGAL-PAGES verde: ${Object.keys(PAGINAS).length} páginas no LegalPage, navegação completa, um contato e exclusão no sitemap\x1b[0m`);
}
