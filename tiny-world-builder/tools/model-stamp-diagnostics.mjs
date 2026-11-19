#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { scanModelStamps } = require('./model-stamps.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const json = process.argv.includes('--json');
const strict = process.argv.includes('--strict');
const warnTriangles = Number(process.env.MODEL_STAMP_WARN_TRIS || 120000);
const warnMaterials = Number(process.env.MODEL_STAMP_WARN_MATERIALS || 24);
const warnTextures = Number(process.env.MODEL_STAMP_WARN_TEXTURES || 32);
const warnSizeMb = Number(process.env.MODEL_STAMP_WARN_MB || 20);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function parseGlbJson(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 20 || buf.toString('utf8', 0, 4) !== 'glTF') return null;
  const version = buf.readUInt32LE(4);
  const length = buf.readUInt32LE(8);
  if (version !== 2 || length > buf.length) return null;
  let offset = 12;
  while (offset + 8 <= length) {
    const chunkLength = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + chunkLength > buf.length) return null;
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(buf.toString('utf8', offset, offset + chunkLength).replace(/\0+$/g, ''));
    }
    offset += chunkLength;
  }
  return null;
}

function pngDimensions(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  } catch (_) { return null; }
}

function jpgDimensions(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), format: 'jpg' };
      }
      i += 2 + len;
    }
  } catch (_) {}
  return null;
}

function imageDimensions(file) {
  return pngDimensions(file) || jpgDimensions(file);
}

function primitiveTriangleCount(primitive, accessors) {
  const mode = primitive.mode === undefined ? 4 : primitive.mode;
  const indexedCount = primitive.indices !== undefined && accessors[primitive.indices] ? accessors[primitive.indices].count || 0 : 0;
  const posAccessor = primitive.attributes && primitive.attributes.POSITION;
  const vertexCount = posAccessor !== undefined && accessors[posAccessor] ? accessors[posAccessor].count || 0 : 0;
  const count = indexedCount || vertexCount;
  if (!count) return 0;
  if (mode === 4) return Math.floor(count / 3); // TRIANGLES
  if (mode === 5 || mode === 6) return Math.max(0, count - 2); // strips/fans
  return 0;
}

function mergeBounds(a, min, max) {
  if (!min || !max || min.length < 3 || max.length < 3) return a;
  if (!a) return { min: min.slice(0, 3), max: max.slice(0, 3) };
  for (let i = 0; i < 3; i++) {
    a.min[i] = Math.min(a.min[i], min[i]);
    a.max[i] = Math.max(a.max[i], max[i]);
  }
  return a;
}

function gltfMetrics(doc) {
  if (!doc) return null;
  const accessors = doc.accessors || [];
  let triangles = 0;
  let primitives = 0;
  let bounds = null;
  for (const mesh of doc.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      primitives++;
      triangles += primitiveTriangleCount(primitive, accessors);
      const posAccessor = primitive.attributes && primitive.attributes.POSITION;
      const acc = posAccessor !== undefined ? accessors[posAccessor] : null;
      bounds = mergeBounds(bounds, acc && acc.min, acc && acc.max);
    }
  }
  const span = bounds ? bounds.max.map((v, i) => v - bounds.min[i]) : null;
  return {
    meshes: (doc.meshes || []).length,
    nodes: (doc.nodes || []).length,
    primitives,
    triangles,
    materials: (doc.materials || []).length,
    textures: (doc.textures || []).length,
    images: (doc.images || []).length,
    animations: (doc.animations || []).length,
    skins: (doc.skins || []).length,
    bounds: bounds ? { min: bounds.min, max: bounds.max, span } : null,
  };
}

function diagnosticsForModel(model) {
  const full = path.join(root, 'models', model.path);
  const sizeMb = model.size / (1024 * 1024);
  let doc = null;
  if (model.format === 'glb') doc = parseGlbJson(full);
  else if (model.format === 'gltf') doc = readJson(full);
  const metrics = gltfMetrics(doc);
  const sidecarTextures = (((model.sidecars || {}).textures) || []).map(texture => {
    const texFull = path.join(root, 'models', texture.path);
    return Object.assign({}, texture, { dimensions: imageDimensions(texFull) });
  });
  const warnings = new Set(model.warnings || []);
  if (sizeMb > warnSizeMb) warnings.add('Large file size: ' + sizeMb.toFixed(1) + ' MB');
  if (metrics) {
    if (metrics.triangles > warnTriangles) warnings.add('High triangle count: ' + metrics.triangles.toLocaleString());
    if (metrics.materials > warnMaterials) warnings.add('High material count: ' + metrics.materials);
    if (metrics.textures > warnTextures || metrics.images > warnTextures) warnings.add('High texture/image count: ' + Math.max(metrics.textures, metrics.images));
    if (metrics.bounds && Math.max(...metrics.bounds.span) > 100) warnings.add('Very large authored bounds; check model scale/transforms');
    if (metrics.bounds && Math.max(...metrics.bounds.span) < 0.01) warnings.add('Very tiny authored bounds; check model scale/transforms');
  } else if (model.format === 'glb' || model.format === 'gltf') {
    warnings.add('Could not parse glTF diagnostics');
  }
  return {
    id: model.id,
    label: model.label,
    path: model.path,
    format: model.format,
    supported: model.supported,
    size: model.size,
    sizeMb: Number(sizeMb.toFixed(2)),
    metrics,
    sidecarTextures,
    warnings: Array.from(warnings),
  };
}

const models = scanModelStamps(root).map(diagnosticsForModel);
const totals = models.reduce((acc, model) => {
  acc.models++;
  acc.sizeMb += model.sizeMb;
  if (model.metrics) {
    acc.triangles += model.metrics.triangles;
    acc.meshes += model.metrics.meshes;
    acc.materials += model.metrics.materials;
    acc.textures += model.metrics.textures;
    acc.animations += model.metrics.animations;
  }
  if (model.warnings.length) acc.warningModels++;
  return acc;
}, { models: 0, sizeMb: 0, triangles: 0, meshes: 0, materials: 0, textures: 0, animations: 0, warningModels: 0 });
totals.sizeMb = Number(totals.sizeMb.toFixed(2));

const report = {
  generatedAt: new Date().toISOString(),
  thresholds: { warnTriangles, warnMaterials, warnTextures, warnSizeMb },
  totals,
  models,
};

if (json) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  console.log('Model stamp diagnostics');
  console.log('models:', totals.models, 'warnings:', totals.warningModels, 'triangles:', totals.triangles.toLocaleString(), 'size:', totals.sizeMb + ' MB');
  for (const model of models) {
    const m = model.metrics;
    const summary = m
      ? `${m.triangles.toLocaleString()} tris · ${m.meshes} meshes · ${m.materials} mats · ${m.textures || m.images} tex · ${m.animations} anim`
      : `${model.format.toUpperCase()} static scan only`;
    console.log('- ' + model.path + ' — ' + summary + ' · ' + model.sizeMb + ' MB');
    for (const warning of model.warnings) console.log('  ⚠ ' + warning);
  }
}

if (strict && models.some(model => model.warnings.length)) process.exit(1);
