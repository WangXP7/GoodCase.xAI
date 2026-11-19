#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { inspectGLB, readJSON, validatePackage, planOutfit } from './kit.mjs';
const [command, input, ...ids] = process.argv.slice(2);
try {
  if (!input || !['inspect', 'validate', 'plan'].includes(command) || (command !== 'plan' && ids.length))
    throw new Error('usage: cli.mjs inspect asset.glb | validate package.json | plan package.json [item-id ...]');
  const path = resolve(input), root = dirname(path);
  const result = command === 'inspect' ? inspectGLB(path) : command === 'validate' ? validatePackage(readJSON(path), root) : planOutfit(readJSON(path), root, ids);
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(`character-kit: ${error.message}`); process.exitCode = 1; }
