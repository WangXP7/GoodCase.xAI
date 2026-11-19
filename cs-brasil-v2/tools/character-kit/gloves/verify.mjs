#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRepository } from './repository.mjs';

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
if (process.argv.length !== 2) {
  console.error('usage: node tools/character-kit/gloves/verify.mjs');
  process.exit(2);
}

try {
  const result = verifyRepository(root);
  console.log(JSON.stringify({ status: 'PASS', ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', error: error.message }, null, 2));
  process.exitCode = 1;
}
