#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectThirdPersonCandidate, makeSelectionsDocument } from './core.mjs';
import {
  buildRepositoryArtifacts,
  listCharacterSources,
  resolveRepositoryPaths,
  verifyRepository,
} from './repository.mjs';

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const args = process.argv.slice(2);
if (args.length !== 1 || !['--write-selections', '--write', '--check'].includes(args[0])) {
  console.error('usage: node tools/character-kit/gloves/build.mjs --write-selections|--write|--check');
  process.exit(2);
}
const mode = args[0];
const paths = resolveRepositoryPaths(root);

if (mode === '--write-selections') {
  const census = listCharacterSources(root).map(source => inspectThirdPersonCandidate({ ...source, bytes: fs.readFileSync(source.absolutePath) }));
  const compatible = census.filter(result => result.compatible);
  const selections = makeSelectionsDocument(compatible);
  fs.mkdirSync(path.dirname(paths.selectionsPath), { recursive: true });
  fs.writeFileSync(paths.selectionsPath, `${JSON.stringify(selections)}\n`);
  console.log(JSON.stringify({
    schema: selections.schema,
    compatible: compatible.map(result => result.id),
    blocked: census.filter(result => !result.compatible).map(result => result.incompatibility),
    selectionsPath: path.relative(root, paths.selectionsPath),
  }, null, 2));
} else if (mode === '--write') {
  const built = buildRepositoryArtifacts(root);
  fs.rmSync(paths.outputDir, { recursive: true, force: true });
  for (const [relative, bytes] of built.artifacts) {
    const output = path.join(root, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes);
  }
  console.log(JSON.stringify({
    schema: built.manifest.schema,
    packages: built.manifest.packages.length,
    supported1p: built.manifest.coverage.firstPersonSupportedCharacterIds,
    supported3p: built.manifest.coverage.thirdPersonSupportedCharacterIds,
    blocked3p: built.manifest.incompatible,
    files: [...built.artifacts.keys()],
  }, null, 2));
} else {
  const result = verifyRepository(root);
  console.log(JSON.stringify(result, null, 2));
}
