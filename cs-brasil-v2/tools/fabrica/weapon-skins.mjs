#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  applyVariant,
  buildVariants,
  loadCatalog,
  readJSON,
  runtimeWeaponIds,
  verifyVariantDirectory,
} from './weapon-skins-lib.mjs';

function option(args, name, fallback = null) {
  const prefix = `--${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function absolute(value) {
  return path.resolve(process.cwd(), value);
}

function usage() {
  console.log(`uso:
  node tools/fabrica/weapon-skins.mjs build [--family=brasa-fosca] [--output=artifacts/weapon-skins] [--write-applied=DIR]
  node tools/fabrica/weapon-skins.mjs check DIR [--write-applied=DIR]
  node tools/fabrica/weapon-skins.mjs apply PATCH.material.json OUTPUT.glb

build grava manifesto e patches materiais rastreáveis; só --write-applied/apply grava GLBs derivados fora das fontes.`);
}

async function main() {
  const args = process.argv.slice(2), command = args[0] || 'build';
  if (command === '--help' || command === 'help') { usage(); return; }
  if (command === 'build') {
    const outputDir = absolute(option(args, 'output', 'artifacts/weapon-skins'));
    const catalogFile = absolute(option(args, 'catalog', path.relative(process.cwd(), path.join(ROOT, 'tools/fabrica/skins/weapon-skins.v1.json'))));
    const familyId = option(args, 'family');
    const writeApplied = option(args, 'write-applied');
    loadCatalog(catalogFile);
    const ids = await runtimeWeaponIds();
    const manifest = await buildVariants({ catalogFile, outputDir, runtimeIds: ids, familyId });
    const verified = await verifyVariantDirectory(outputDir, { writeAppliedDir: writeApplied ? absolute(writeApplied) : null });
    const statusCounts = Object.values(manifest.coverage).reduce((counts, entry) => ({ ...counts, [entry.status]: (counts[entry.status] || 0) + 1 }), {});
    console.log(JSON.stringify({ outputDir, runtimeWeapons: ids.length, statusCounts, generatedMaterialVariants: verified.outputs, supportedPairs: verified.pairs, appliedGLBDir: writeApplied ? absolute(writeApplied) : null, visualApproval: manifest.approval.visual, store: false }, null, 2));
    return;
  }
  if (command === 'check') {
    if (!args[1] || args[1].startsWith('--')) throw new Error('check exige o diretório do manifesto');
    const writeApplied = option(args, 'write-applied');
    const result = await verifyVariantDirectory(absolute(args[1]), { writeAppliedDir: writeApplied ? absolute(writeApplied) : null });
    console.log(JSON.stringify({ checkedDirectory: absolute(args[1]), generatedMaterialVariants: result.outputs, supportedPairs: result.pairs, appliedGLBDir: writeApplied ? absolute(writeApplied) : null }, null, 2));
    return;
  }
  if (command === 'apply') {
    if (!args[1] || !args[2]) throw new Error('apply exige PATCH.material.json e OUTPUT.glb');
    const patch = readJSON(absolute(args[1])), target = absolute(args[2]);
    const applied = applyVariant(patch);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, applied.bytes);
    fs.writeFileSync(`${target}.receipt.json`, `${JSON.stringify(applied.receipt, null, 2)}\n`);
    console.log(JSON.stringify({ output: target, ...applied.receipt }, null, 2));
    return;
  }
  usage();
  throw new Error(`comando desconhecido: ${command}`);
}

main().catch((error) => {
  console.error(`weapon-skins: ${error.message}`);
  process.exitCode = 1;
});
