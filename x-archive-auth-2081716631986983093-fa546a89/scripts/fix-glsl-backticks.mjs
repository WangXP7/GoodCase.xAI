#!/usr/bin/env node
/**
 * Strip backticks out of comments that live INSIDE a `/* glsl *\/` template
 * literal.
 *
 * A backtick inside a template literal terminates the string, so a shader
 * comment written in the surrounding TypeScript's prose style — where `foo`
 * marks an identifier — silently ends the GLSL block and produces a parse error
 * hundreds of lines away. It is an easy habit to fall into when the file's own
 * doc comments use that convention, so this normalises them to single quotes.
 *
 * Usage: node scripts/fix-glsl-backticks.mjs [--check]
 * With --check it reports offenders and exits non-zero instead of rewriting.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const check = process.argv.includes('--check');
const files = globSync('src/**/*.ts');
let total = 0;

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  let inGlsl = false;
  let hits = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!inGlsl) {
      if (/\/\* glsl \*\/\s*`/.test(l)) inGlsl = true;
      continue;
    }
    if (/^\s*`\s*[;,)]?\s*$/.test(l)) { inGlsl = false; continue; }
    if (l.includes('`') && /^\s*(\/\/|\*)/.test(l)) {
      if (check) console.log(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`);
      else lines[i] = l.replace(/`/g, "'");
      hits++;
    }
  }
  if (hits && !check) writeFileSync(f, lines.join('\n'));
  total += hits;
}

console.log(`${check ? 'found' : 'fixed'} ${total} backticked comment line(s) inside GLSL literals`);
process.exit(check && total ? 1 : 0);
