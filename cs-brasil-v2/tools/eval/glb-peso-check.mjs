#!/usr/bin/env node
/* ============================================================================
   glb-peso-check.mjs — GLB GRANDE SEM REFERÊNCIA NÃO ENTRA EM public/
   ----------------------------------------------------------------------------
   O CASO (lane glm/peso, 14/10/2026): `public/models/props/{caixa_dagua,
   trave_futebol,favela_house}/` carregam os GLBs PBR CRUS da Mint (53 a 57 MB
   cada, 162 MB no total) com nomes de UUID. Nenhum código os pede: os mapas
   usam os GLBs OTIMIZADOS (`models/props/${id}.glb`, mapprops.js), e nem o
   mint-assets.json os registra. Como public/ é copiado inteiro no build e no
   portal, lixo de geração vira payload de repo para sempre.

   O QUE MEDE: todo .glb acima de 10 MB dentro de public/ precisa de
   referência: o stem do arquivo citado em código/config tracked (public/, src/,
   scripts/, tools/, .github/, package.json, *.mjs da raiz; docs .md e
   evidência de asset não contam: mencionar não é carregar). O teto de 10 MB é
   do escopo da lane (progress/handoff-20261014/PROMPT-GLM.md, item 2); o maior
   GLB referenciado hoje tem 9,2 MB (wall_of_cars.glb).

   MUTAÇÃO: `--mutante=bruto` planta um GLB falso de 11 MB não referenciado em
   public/models/props/ e EXIGE que a régua o reprova pelo nome.

   Uso: node tools/eval/glb-peso-check.mjs [--mutante=bruto]
   ============================================================================ */
import { execSync } from 'node:child_process';
import { readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TETO_MB = 10;
const mutante = process.argv.find((a) => a.startsWith('--mutante='))?.split('=')[1];
if (mutante && mutante !== 'bruto') throw new Error(`mutante desconhecido: ${mutante}`);

function achaSemRef() {
  const glbs = [];
  (function varre(dir) {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      const st = statSync(caminho);
      if (st.isDirectory()) varre(caminho);
      else if (nome.endsWith('.glb')) glbs.push({ caminho, mb: st.size / 1e6 });
    }
  })('public');
  const graves = glbs.filter((g) => g.mb > TETO_MB);
  const semRef = [];
  for (const g of graves) {
    const stem = g.caminho.replace(/\.glb$/, '').split('/').pop();
    // Fontes onde citar o stem VALE como referência de runtime: código e config.
    // Evidência (asset-evidence) e doc .md não carregam nada.
    const refs = execSync(
      `git grep -l -F -e ${JSON.stringify(stem)} -- public src scripts tools .github package.json '*.mjs' ':(exclude)*.md' ':(exclude)tools/eval/asset-evidence' || true`,
      { encoding: 'utf8' },
    ).trim();
    if (!refs) semRef.push({ ...g, stem });
  }
  return { total: glbs.length, graves, semRef };
}

// stem montado em runtime: literal em fonte tracked faz o git grep citar a si mesmo
const arquivoMutante = `public/models/props/${['mutante', 'peso', 'bruto'].join('_')}.glb`;
const STEM_MUTANTE = arquivoMutante.split('/').pop().replace('.glb', '');
try {
  if (mutante === 'bruto') { writeFileSync(arquivoMutante, 'glTF'); truncateSync(arquivoMutante, 11 * 1e6); }
  const { total, graves, semRef } = achaSemRef();

  if (mutante === 'bruto') {
    if (!semRef.some((g) => g.caminho === arquivoMutante)) {
      console.error('MUTAÇÃO PASSOU — GLB falso de 11 MB sem referência não foi visto.');
      console.error(semRef.length ? `reprovados: ${semRef.map((g) => g.caminho).join(', ')}` : 'nada reprovado');
      process.exitCode = 1;
    } else {
      console.log('mutante bruto reprovado como devia: 11 MB sem referência acendeu a régua.');
    }
  } else if (semRef.length) {
    console.error(`GLBs acima de ${TETO_MB} MB sem referência em public/ (${total} GLBs no total):`);
    for (const g of semRef) console.error(`  ✗ ${g.caminho} (${g.mb.toFixed(1)} MB) — nenhum código/config tracked cita o stem`);
    process.exitCode = 1;
  } else {
    const citados = graves.length ? ` (${graves.length} acima de ${TETO_MB} MB, todos citados)` : '';
    console.log(`nenhum GLB > ${TETO_MB} MB sem referência em public/${citados}; ${total} GLBs no total.`);
  }
} finally {
  if (mutante === 'bruto') rmSync(arquivoMutante, { force: true });
}
