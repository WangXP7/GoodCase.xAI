const fs = require('fs');
const path = require('path');

const dir = __dirname;
const parts = [
  'p00.html', 'p01.js', 'p02.js', 'p03.js', 'p04.js', 'p05.js', 'p06.js',
  'p07.js', 'p08.js', 'p09.js', 'p10.js', 'p11.js', 'p12.js', 'p13.js',
  'p14.js', 'p99.html',
];

let out = '';
for (const p of parts) {
  const f = path.join(dir, p);
  if (!fs.existsSync(f)) { console.error('缺少分片: ' + p); process.exit(1); }
  out += fs.readFileSync(f, 'utf8');
  if (!out.endsWith('\n')) out += '\n';
}

const target = path.join(dir, '..', 'index.html');
fs.writeFileSync(target, out, 'utf8');

// 抽出 <script> 内的 JS 用于语法检查
const m = out.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('未找到 script 块'); process.exit(1); }
fs.writeFileSync(path.join(dir, '_bundle_check.js'), m[1], 'utf8');

const stats = {
  bytes: Buffer.byteLength(out, 'utf8'),
  lines: out.split('\n').length,
  jsLines: m[1].split('\n').length,
};
console.log(JSON.stringify(stats));
