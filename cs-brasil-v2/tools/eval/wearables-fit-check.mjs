#!/usr/bin/env node
import { main } from '../character-kit/garment/wearables-cli.mjs';

try { main(process.argv.slice(2)); }
catch (error) { console.error(`wearables-fit-check: ${error.message}`); process.exitCode = 1; }
