// 提取 index.html 内联 module 脚本做 node --check 语法校验
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, '..', 'index.html'), 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: module script not found'); process.exit(1); }
const out = path.join(dir, '..', '.tmp-game-check.mjs');
fs.writeFileSync(out, m[1]);
console.log('extracted', m[1].length, 'chars ->', out);
