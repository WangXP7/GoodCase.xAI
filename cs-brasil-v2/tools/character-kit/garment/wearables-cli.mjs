#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCensus, buildMatrix, runMutants, serialize, validateBundle, validateManifest } from './wearables-factory.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const manifestPath = new URL('./wearables-manifest.json', import.meta.url);
const censusPath = new URL('./body-census.json', import.meta.url);
const matrixPath = new URL('./compatibility-matrix.json', import.meta.url);

export function loadManifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export function checkGenerated(manifest, census, matrix) {
  const checkedCensus = JSON.parse(readFileSync(censusPath, 'utf8'));
  const checkedMatrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
  if (serialize(checkedCensus) !== serialize(census)) throw new Error('body-census.json is stale; run wearables-cli.mjs --write');
  if (serialize(checkedMatrix) !== serialize(matrix)) throw new Error('compatibility-matrix.json is stale; run wearables-cli.mjs --write');
  validateBundle(manifest, checkedCensus, checkedMatrix, root);
}

export function main(args = process.argv.slice(2)) {
  const mode = args.length === 0 ? '--check' : args.length === 1 ? args[0] : null;
  if (!['--check', '--write', '--mutate'].includes(mode)) throw new Error('usage: wearables-cli.mjs [--check|--write|--mutate]');
  const manifest = loadManifest();
  validateManifest(manifest, root);
  const census = buildCensus(root), matrix = buildMatrix(manifest, census);
  validateBundle(manifest, census, matrix, root);
  if (mode === '--write') {
    writeFileSync(censusPath, serialize(census));
    writeFileSync(matrixPath, serialize(matrix));
  } else {
    checkGenerated(manifest, census, matrix);
  }
  const mutants = mode === '--mutate' ? runMutants(manifest, census, matrix, root) : [];
  const result = { bodies: census.summary.bodies, families: census.summary.families, countsBySlot: matrix.summary.countsBySlot, mutants };
  console.log(`wearables ${mode.slice(2)}: ${serialize(result).trim()}`);
  return result;
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (direct) {
  try { main(); }
  catch (error) { console.error(`wearables: ${error.message}`); process.exitCode = 1; }
}
