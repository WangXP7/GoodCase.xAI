#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { validateGripProfile, readGripJSON } from './grip-profile.mjs';
try {
  const [input, packageInput, ...extra] = process.argv.slice(2);
  if (!input || extra.length) throw new Error('usage: grip-cli.mjs profile.json [package.json]');
  const path = resolve(input), packagePath = packageInput ? resolve(packageInput) : null;
  console.log(JSON.stringify(validateGripProfile(readGripJSON(path), dirname(path), packagePath ? readGripJSON(packagePath) : null, packagePath ? dirname(packagePath) : dirname(path)), null, 2));
} catch (error) { console.error(`grip-profile: ${error.message}`); process.exitCode = 1; }
