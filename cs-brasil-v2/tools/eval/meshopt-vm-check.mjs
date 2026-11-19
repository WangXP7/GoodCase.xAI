#!/usr/bin/env node
/* ============================================================================
   meshopt-vm-check.mjs — O GLB MESHOPT PUBLICADO É O QUE O MANIFEST REGISTRA?
   ----------------------------------------------------------------------------
   O CASO (lane glm/peso, 14/10/2026): a 1ª versão do conversor escreveu a saída
   com extensão que não .glb; o NodeIO escolheu o escritor de glTF e EXPLODIU o
   viewmodel em .bin + texturas externas. O "ak-hires.glb" de 0,41 MB era um JSON
   apontando pra arquivos irmãos, e o jogo carregou por acaso (os arquivos estavam
   lá). Nenhuma régua olhava o container.

   O QUE MEDE, para cada GLB do manifest (tools/eval/meshopt-manifest.json):
   (1) o arquivo em disco tem o sha256 registrado (ninguém re-assou por fora);
   (2) é container GLB (magic glTF) e declara EXT_meshopt_compression requerida;
   (3) CARREGA: o NodeIO com MeshoptDecoder lê o arquivo e acha malha e textura
       (a leitura falha se a compressão estiver corrompida);
   (4) a origem registrada não é o próprio convertido (conversão de conversão).

   MUTAÇÃO: `--mutante=troca-byte` inverte um byte no meio do BIN de um GLB
   convertido (e devolve o original ao sair) e EXIGE vermelho citando o arquivo.

   Uso: node tools/eval/meshopt-vm-check.mjs [--mutante=troca-byte]
   ============================================================================ */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const mutante = process.argv.find((a) => a.startsWith('--mutante='))?.split('=')[1];
if (mutante && mutante !== 'troca-byte') throw new Error(`mutante desconhecido: ${mutante}`);

const manifest = JSON.parse(readFileSync('tools/eval/meshopt-manifest.json', 'utf8'));
const alvo = Object.keys(manifest).sort()[0];
const originalMutante = mutante === 'troca-byte' ? readFileSync(alvo) : null;

let falhas = [];
try {
  if (mutante === 'troca-byte') {
    const buf = readFileSync(alvo);
    buf[Math.floor(buf.length * 0.6)] ^= 0xff;
    writeFileSync(alvo, buf);
  }

  for (const [arquivo, reg] of Object.entries(manifest)) {
    const dados = readFileSync(arquivo);
    if (sha256(dados) !== reg.convertidoSha256) falhas.push(`${arquivo}: sha256 do disco difere do manifest`);
    if (reg.origemSha256 === reg.convertidoSha256) falhas.push(`${arquivo}: origem e convertido idênticos (não converteu)`);
    if (dados.readUInt32LE(0) !== 0x46546c67) { falhas.push(`${arquivo}: não é container GLB`); continue; }
    const jsonLen = dados.readUInt32LE(12);
    const json = JSON.parse(dados.slice(20, 20 + jsonLen).toString());
    if (!(json.extensionsRequired || []).includes('EXT_meshopt_compression')) {
      falhas.push(`${arquivo}: sem EXT_meshopt_compression requerida (${(json.extensionsRequired || []).join(',') || 'nenhuma'})`);
    }
    try {
      const doc = await io.read(arquivo);
      if (!doc.getRoot().listMeshes().length) falhas.push(`${arquivo}: carregou sem malha`);
      if (!doc.getRoot().listTextures().length) falhas.push(`${arquivo}: carregou sem textura`);
    } catch (e) {
      falhas.push(`${arquivo}: NÃO CARREGA com decoder (${e.message})`);
    }
  }

  if (mutante === 'troca-byte') {
    if (!falhas.some((f) => f.startsWith(`${alvo}: sha256`))) {
      console.error(`MUTAÇÃO PASSOU — byte trocado em ${alvo} não foi visto.`);
      falhas = ['mutacao-passou'];
    } else {
      console.log(`mutante troca-byte reprovado como devia: ${falhas.find((f) => f.startsWith(alvo))}`);
      falhas = [];   // mutante que morde é o verde desta passada
    }
  } else if (falhas.length) {
    console.error(`GLBs meshopt publicados divergem do manifest (${Object.keys(manifest).length} registrados):`);
    for (const f of falhas) console.error(`  ✗ ${f}`);
  } else {
    console.log(`${Object.keys(manifest).length} GLBs meshopt conferem: hash, container, extensão e carga com decoder.`);
  }
} finally {
  if (originalMutante) writeFileSync(alvo, originalMutante);
}
process.exit(falhas.length ? 1 : 0);
