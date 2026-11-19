#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');
const json = process.argv.includes('--json');

const GEOMETRY_RE = /new\s+THREE\.(BoxGeometry|SphereGeometry|CylinderGeometry|ConeGeometry|PlaneGeometry|DodecahedronGeometry|ExtrudeGeometry|TorusGeometry|CircleGeometry|EdgesGeometry)\s*\(/g;

const ALLOWED_FILES = new Set([
  'engine/world/03-geometry-materials.js',
  'engine/world/05-tile-factory.js',
  'engine/world/15-ghost-generation-fade.js',
  'engine/world/23-particles-clouds.js',
  'engine/world/31-cloud-sea.js',
  'engine/world/40-shield-system.js',
  'LandscapeEngine.js',
  'engine/landscape/geometries.js',
  'engine/landscape/chunks.js',
  'engine/landscape/water.js',
]);

const ALLOWED_FUNCTION_NAMES = /^(get|make|build|ensure|init|create).*?(Geometry|Geo|Assets|Resources|Shared|Cache|Library|Material|Mesh|Landscape|Chunk|Water|Cloud|Particle|Shield)/;
const HOT_FACTORY_FILES = /engine\/world\/(0[5-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9]|6[0-9]|70)-.*\.js$/;

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function currentFunction(lines, index) {
  for (let i = index; i >= 0; i--) {
    const line = lines[i];
    const match = /\bfunction\s+([A-Za-z0-9_$]+)\s*\(/.exec(line)
      || /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/.exec(line);
    if (match) return match[1];
  }
  return '';
}

const files = [
  path.join(root, 'LandscapeEngine.js'),
  ...walk(path.join(root, 'engine', 'landscape')),
  ...walk(path.join(root, 'engine', 'world')),
].filter(file => fs.existsSync(file));

const hits = [];
for (const file of files) {
  const rel = toPosix(path.relative(root, file));
  const source = readText(file);
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    GEOMETRY_RE.lastIndex = 0;
    let match;
    while ((match = GEOMETRY_RE.exec(line))) {
      const fn = currentFunction(lines, i);
      const allowedFile = ALLOWED_FILES.has(rel);
      const allowedFn = ALLOWED_FUNCTION_NAMES.test(fn);
      const localWindow = lines.slice(i, i + 6).join(' ');
      const explicitlyOwned = /ownReason|userData\.cached/.test(localWindow);
      const likelyHot = HOT_FACTORY_FILES.test(rel) && !allowedFn && !allowedFile && !explicitlyOwned;
      hits.push({
        file: rel,
        line: i + 1,
        geometry: match[1],
        function: fn || null,
        status: allowedFile || allowedFn ? 'allowed/cache-or-setup' : (explicitlyOwned ? 'allowed-owned-unique' : (likelyHot ? 'review-hot-factory' : 'review')),
        code: line.trim(),
      });
    }
  }
}

const review = hits.filter(hit => !hit.status.startsWith('allowed'));
const byStatus = hits.reduce((acc, hit) => {
  acc[hit.status] = (acc[hit.status] || 0) + 1;
  return acc;
}, {});
const report = {
  generatedAt: new Date().toISOString(),
  totalGeometryConstructors: hits.length,
  reviewCount: review.length,
  byStatus,
  review,
  allowedCount: hits.length - review.length,
};

if (json) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  console.log('Render audit: geometry constructors');
  console.log('total:', report.totalGeometryConstructors, 'review:', report.reviewCount, 'allowed:', report.allowedCount);
  for (const [status, count] of Object.entries(byStatus).sort()) console.log(status + ':', count);
  if (review.length) {
    console.log('\nReview candidates:');
    for (const hit of review.slice(0, 80)) {
      console.log('- ' + hit.file + ':' + hit.line + ' [' + hit.status + '] ' + hit.geometry + ' in ' + (hit.function || '<top>'));
      console.log('  ' + hit.code);
    }
    if (review.length > 80) console.log('... ' + (review.length - 80) + ' more; rerun with --json for full output');
  }
}

if (strict && review.length) process.exit(1);
