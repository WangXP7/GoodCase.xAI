#!/usr/bin/env node
/* ============================================================================
   mapas-sob-demanda-check.mjs — NENHUM MAPA NO GRAFO ESTÁTICO DO BOOT
   ----------------------------------------------------------------------------
   O CASO (lane glm/peso, item 5): maps.js importava os ~19 módulos de mapa
   estaticamente, então o boot baixava TODO o JS de mapa antes de qualquer
   clique. A medição da lane (peso-boot.mjs) mostrou 1,8 MB de JS até o menu.

   O QUE MEDE:
   G1  BFS pelos imports ESTÁTICOS a partir de public/js/main.js: nenhum
       ./map_*.js pode ser alcançado (import() dinâmico não conta);
   C1  contrato de carregaMapa: instala build no registro, memoiza a promessa,
       reconhece alias de id antigo e mapaCarregado() acompanha;
   C2  a conferência registro×módulo MORDE: props adulterado no registro faz
       carregaMapa rejeitar (metadado duplicado não pode deslizar calado);
   C3  a fronteira de construção carrega uma vez ANTES do build, propaga a
       rejeição original sem construir e usa o construtor do mapa trocado.

   MUTAÇÕES: `--mutante=estatico` planta import estático de map_piscina.js numa
   cópia da árvore e EXIGE que G1 acenda; `--mutante=registro` adultera o props
   do registro e EXIGE que C2 rejeite; `--mutante=ordem` constrói antes do await
   e EXIGE que C3 veja a inversão.

   Uso: node tools/eval/mapas-sob-demanda-check.mjs [--mutante=estatico|registro|ordem]
   ============================================================================ */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const RAIZ = resolve(import.meta.dirname, '../..');
const mutante = process.argv.find((a) => a.startsWith('--mutante='))?.split('=')[1];
if (mutante && !['estatico', 'registro', 'ordem'].includes(mutante)) throw new Error(`mutante desconhecido: ${mutante}`);

function varreGrafo(dirJs) {
  const estaticoDe = (src) => [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  const vistos = new Set();
  const fila = ['main.js'];
  const arestas = [];
  while (fila.length) {
    const arquivo = fila.pop();
    if (vistos.has(arquivo)) continue;
    vistos.add(arquivo);
    let src;
    try { src = readFileSync(join(dirJs, arquivo), 'utf8'); } catch { continue; }
    for (const spec of estaticoDe(src)) {
      const alvo = spec.startsWith('./') ? spec.slice(2) : spec;
      const rel = alvo.endsWith('.js') ? alvo : `${alvo}.js`;
      arestas.push([arquivo, rel]);
      fila.push(rel);
    }
  }
  return { vistos, arestas };
}

/* Arenas são os alvos da lane (os 18 construtores de mundo do registro). Auxiliares
   de mapa (decals, sky, surface_finish, previews) são infra compartilhada e ficam. */
const arenasDoRegistro = (dirJs) => {
  const src = readFileSync(join(dirJs, 'maps.js'), 'utf8');
  return new Set([...src.matchAll(/import\('\.\/(map_[a-z0-9_]+\.js)'\)/g)].map((m) => m[1]));
};

 const mapasNoGrafo = (dirJs) => {
  const arenas = arenasDoRegistro(dirJs);
   const { arestas } = varreGrafo(dirJs);
  return arestas.filter(([, alvo]) => arenas.has(alvo));
 };

async function verificaFronteira(comMapaCarregado) {
  const eventos = [];
  const cargas = new Map();
  const mapas = {
    praca_poderes: { build: () => eventos.push('build:praca_poderes') },
    piscina_treta: { build: () => eventos.push('build:piscina_treta') },
    amazonia: { build: () => eventos.push('build:amazonia') },
  };
  const carregar = async (id) => {
    cargas.set(id, (cargas.get(id) || 0) + 1);
    eventos.push(`load:${id}`);
  };
  await comMapaCarregado('praca_poderes', (mapa) => mapa.build(), carregar, mapas);
  await comMapaCarregado('piscina_treta', (mapa) => mapa.build(), carregar, mapas);

  const problemas = [];
  const ordem = [
    'load:praca_poderes', 'build:praca_poderes',
    'load:piscina_treta', 'build:piscina_treta',
  ];
  if (eventos.join('|') !== ordem.join('|')) problemas.push(`ordem observada ${eventos.join(' -> ')}`);
  for (const id of ['praca_poderes', 'piscina_treta']) {
    if (cargas.get(id) !== 1) problemas.push(`${id} carregou ${cargas.get(id) || 0} vez(es)`);
  }

  const falhaReal = new Error('módulo do mapa rejeitou');
  let erroRecebido = null, buildsDepoisDaFalha = 0;
  try {
    await comMapaCarregado(
      'amazonia',
      () => { buildsDepoisDaFalha++; },
      async () => { throw falhaReal; },
      mapas,
    );
  } catch (erro) {
    erroRecebido = erro;
  }
  if (erroRecebido !== falhaReal) problemas.push('rejeição original não propagou por identidade');
  if (buildsDepoisDaFalha !== 0) problemas.push('build rodou apesar da rejeição do loader');
  return problemas;
}

let falhou = false;
let dirMutante = null;
try {
  if (mutante === 'estatico' || mutante === 'ordem') {
    dirMutante = mkdtempSync(join(tmpdir(), 'mapas-demanda-'));
    cpSync(join(RAIZ, 'public/js'), join(dirMutante, 'js'), { recursive: true });
    const alvo = join(dirMutante, 'js/maps.js');
    const src = readFileSync(alvo, 'utf8');
    if (mutante === 'estatico') {
      writeFileSync(alvo, `import { buildPoolDay } from './map_piscina.js';\n${src}`);
    } else {
      const correto = '  await carregar(alvo);\n  return usar(mapas[alvo], alvo);';
      const invertido = '  const resultado = usar(mapas[alvo], alvo);\n  await carregar(alvo);\n  return resultado;';
      if (!src.includes(correto)) throw new Error('mutante ordem não casou com comMapaCarregado');
      writeFileSync(alvo, src.replace(correto, invertido));
    }
  }

  const dirJs = dirMutante ? join(dirMutante, 'js') : join(RAIZ, 'public/js');
  const noGrafo = mapasNoGrafo(dirJs);
  const g1 = noGrafo.length === 0;

  if (mutante === 'estatico') {
    if (g1) {
      console.error('MUTAÇÃO PASSOU — import estático de map_piscina.js não foi visto no grafo do boot.');
      falhou = true;
    } else {
      console.log(`mutante estatico reprovado como devia: ${noGrafo[0].join(' -> ')}`);
    }
  } else if (!g1) {
    console.error('G1 reprovado: módulos de mapa no grafo estático do boot:');
    for (const [de, alvo] of noGrafo) console.error(`  ✗ ${de} -> ${alvo}`);
    falhou = true;
  } else {
    console.log('G1 ok: nenhum map_*.js no grafo estático do boot.');
  }

  /* ---------- C1/C2/C3: contratos do carregamento lazy ---------- */
  if (mutante !== 'estatico') {
    globalThis.location = new URL('http://localhost/');
    globalThis.window = globalThis;
    const maps = await import(`file://${join(dirJs, 'maps.js')}?m=${Date.now()}`);
    const { carregaMapa, mapaCarregado, comMapaCarregado, MAPS, ALIAS_MAPA } = maps;

    if (mutante === 'registro') MAPS.velho_oeste.props = ['adulterado'];
    if (mutante !== 'ordem') {

    let carregou = null, erro = null;
    try { carregou = await carregaMapa(mutante === 'registro' ? 'velho_oeste' : 'fy_pool_day'); } catch (e) { erro = e; }

    const c = [];
    if (mutante === 'registro') {
      if (!erro || !/velho_oeste\.props.*diverge/.test(String(erro.message))) {
        c.push(`C2: registro adulterado não foi rejeitado (${erro ? erro.message : 'carregou sem erro'})`);
      }
    } else {
      if (erro) c.push(`C1: carregaMapa rejeitou: ${erro.message}`);
      if (typeof MAPS.piscina_treta.build !== 'function') c.push('C1: build não foi instalado no registro');
      if (carregaMapa('piscina_treta') !== carregaMapa('fy_pool_day')) c.push('C1: promessa não memoizada entre id e alias');
      if (!mapaCarregado('piscina_treta')) c.push('C1: mapaCarregado não vê o mapa carregado');
      if (mapaCarregado('velho_oeste')) c.push('C1: mapaCarregado acende para mapa não carregado');
      if (!ALIAS_MAPA.awp_map) c.push('C1: sumiu com ALIAS_MAPA');
    }
    if (c.length) { falhou = true; for (const f of c) console.error(`  ✗ ${f}`); }
    else console.log(mutante === 'registro'
      ? 'mutante registro reprovado como devia: divergência registro×módulo rejeitada no carregamento.'
      : 'C1 ok: carregaMapa instala build, memoiza, resolve alias e mapaCarregado acompanha.');
    }

    const problemasFronteira = await verificaFronteira(comMapaCarregado);
    if (mutante === 'ordem') {
      if (problemasFronteira.length === 0) {
        console.error('MUTAÇÃO PASSOU — construir antes do await não foi percebido.');
        falhou = true;
      } else {
        console.log(`mutante ordem reprovado como devia: ${problemasFronteira.join('; ')}.`);
      }
    } else if (problemasFronteira.length) {
      falhou = true;
      for (const problema of problemasFronteira) console.error(`  ✗ C3: ${problema}`);
    } else {
      console.log('C3 ok: uma carga antes do build, rejeição propagada e troca constrói o mapa correto.');
    }
  }
} finally {
  if (dirMutante) rmSync(dirMutante, { recursive: true, force: true });
}
process.exit(falhou ? 1 : 0);
