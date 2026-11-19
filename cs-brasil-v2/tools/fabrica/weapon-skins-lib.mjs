import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CATALOG_SCHEMA = 'cs-weapon-skin-catalog/1';
export const PATCH_SCHEMA = 'cs-weapon-material-variant/1';
export const MANIFEST_SCHEMA = 'cs-weapon-skin-build/1';
const MAX_GLB_BYTES = 256 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const SAFE_PATH = /^[a-zA-Z0-9_./ -]+$/;
const MAGAZINE = /mag(?:azine)?|pente|gauge|cartridge|shell/i;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const must = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const jsonDigest = (value) => sha256(Buffer.from(JSON.stringify(value)));
const clone = (value) => structuredClone(value);
const sortedUnique = (values) => [...new Set(values)].sort();

export function readJSON(file) {
  const stat = fs.statSync(file);
  must(stat.isFile() && stat.size <= 4 * 1024 * 1024, `JSON inválido ou grande demais: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function finiteTree(value) {
  if (typeof value === 'number') must(Number.isFinite(value), 'número não finito');
  else if (Array.isArray(value)) value.forEach(finiteTree);
  else if (object(value)) Object.values(value).forEach(finiteTree);
}

function sourceSpec(value, at) {
  must(object(value), `${at}: fonte obrigatória`);
  must(typeof value.path === 'string' && SAFE_PATH.test(value.path) && !path.isAbsolute(value.path) && !value.path.split('/').includes('..'), `${at}: caminho inseguro`);
  must(HASH.test(value.sha256 || ''), `${at}: sha256 obrigatório`);
  must(Array.isArray(value.materialNames) || value.materialNames === undefined, `${at}: materialNames inválido`);
  if (value.materialNames) must(value.materialNames.length > 0 && value.materialNames.every((name) => typeof name === 'string' && name), `${at}: materialNames vazio`);
}

export function loadCatalog(file = path.join(ROOT, 'tools/fabrica/skins/weapon-skins.v1.json')) {
  const catalog = readJSON(file);
  finiteTree(catalog);
  must(catalog.schemaVersion === CATALOG_SCHEMA, 'schema do catálogo de skins inválido');
  must(object(catalog.families) && Object.keys(catalog.families).length > 0, 'famílias de skin ausentes');
  for (const [id, family] of Object.entries(catalog.families)) {
    must(family.id === id && typeof family.description === 'string' && family.description, `${id}: família inválida`);
    must(family.approved === false && family.store === false, `${id}: aprovação/store devem iniciar false`);
    const material = family.material;
    must(object(material) && Array.isArray(material.baseColorFactor) && material.baseColorFactor.length === 4 && material.baseColorFactor.every((n) => Number.isFinite(n) && n >= 0 && n <= 1), `${id}: baseColorFactor inválido`);
    must(['metallicFactor', 'roughnessFactor'].every((key) => Number.isFinite(material[key]) && material[key] >= 0 && material[key] <= 1), `${id}: fatores PBR inválidos`);
    must(family.provenance?.type === 'procedural-parameters' && typeof family.provenance.license === 'string' && family.provenance.license, `${id}: procedência ausente`);
  }
  must(object(catalog.factoryRecipes) && Object.keys(catalog.factoryRecipes).length === 7, 'as sete receitas de fábrica não foram unificadas');
  for (const [id, recipe] of Object.entries(catalog.factoryRecipes)) {
    must(recipe.id === id && typeof recipe.description === 'string' && recipe.description, `${id}: receita inválida`);
    must(object(recipe.source?.fingerprints) && Object.values(recipe.source.fingerprints).every((hash) => HASH.test(hash)), `${id}: fingerprints ausentes`);
    must(Array.isArray(recipe.partMappings) && recipe.partMappings.length > 0, `${id}: mapeamento de partes ausente`);
    must(object(recipe.materials) && recipe.partMappings.every((name) => object(recipe.materials[name])), `${id}: slot material sem receita`);
    for (const spec of Object.values(recipe.materials)) must(/^[a-f0-9]{6}$/.test(spec.cor) && Number.isFinite(spec.metal) && Number.isFinite(spec.rugosidade), `${id}: material inválido`);
  }
  must(object(catalog.coverage), 'cobertura ausente');
  for (const [id, entry] of Object.entries(catalog.coverage)) {
    must(['supported', 'unknown', 'incompatible'].includes(entry.status), `${id}: status inválido`);
    must(typeof entry.reason === 'string' && entry.reason, `${id}: reason obrigatório`);
    sourceSpec(entry.thirdPerson, `${id}.thirdPerson`);
    sourceSpec(entry.firstPerson, `${id}.firstPerson`);
    if (entry.runtimeFirstPerson) sourceSpec(entry.runtimeFirstPerson, `${id}.runtimeFirstPerson`);
    if (entry.status === 'supported') {
      must(Array.isArray(entry.partMappings) && entry.partMappings.length > 0, `${id}: par suportado sem mapeamento`);
      must(entry.firstPerson.materialNames?.length && entry.thirdPerson.materialNames?.length, `${id}: par suportado sem slots`);
      must(HASH.test(entry.firstPerson.derivedFrom3pSha256 || '') && entry.firstPerson.derivedFrom3pSha256 === entry.thirdPerson.sha256, `${id}: fingerprint 1P→3P divergente`);
      for (const mapping of entry.partMappings) {
        must(typeof mapping.part === 'string' && mapping.part, `${id}: parte sem identidade`);
        must(mapping.firstPersonMaterials?.length && mapping.thirdPersonMaterials?.length, `${id}: parte sem slots 1P/3P`);
      }
    } else must(!entry.partMappings?.length, `${id}: arma não suportada não pode declarar equivalência`);
  }
  return catalog;
}

export function factoryWeaponRecipe(catalog, id) {
  const recipe = catalog.factoryRecipes[id];
  must(recipe, `receita de arma ausente: ${id}`);
  return {
    id: recipe.id,
    descricao: recipe.description,
    ...(recipe.origin ? { origem: recipe.origin } : {}),
    materiais: clone(recipe.materials),
    ...(recipe.default ? { padrao: clone(recipe.default) } : {}),
  };
}

export async function runtimeWeaponIds() {
  const weaponsURL = `${pathToFileURL(path.join(ROOT, 'public/js/weapons.js')).href}?weapon-skin-census`;
  const gameplayURL = `${pathToFileURL(path.join(ROOT, 'public/js/data/weapons.js')).href}?weapon-skin-census`;
  const [{ WEAPON_IDS }, { WEAPONS }] = await Promise.all([import(weaponsURL), import(gameplayURL)]);
  must(Array.isArray(WEAPON_IDS) && WEAPON_IDS.length > 0, 'WEAPON_IDS inválido');
  must(new Set(WEAPON_IDS).size === WEAPON_IDS.length, 'WEAPON_IDS duplicado');
  must(JSON.stringify([...WEAPON_IDS].sort()) === JSON.stringify(Object.keys(WEAPONS).sort()), 'WEAPON_IDS diverge de data/weapons.js');
  return Object.freeze([...WEAPON_IDS]);
}

function sourcePath(relative) {
  must(typeof relative === 'string' && SAFE_PATH.test(relative) && !path.isAbsolute(relative) && !relative.split('/').includes('..'), 'caminho de fonte inseguro');
  const target = path.resolve(ROOT, relative);
  const rel = path.relative(ROOT, target);
  must(rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel), 'fonte fora da árvore lógica');
  must(fs.statSync(target).isFile(), `fonte ausente: ${relative}`);
  return target;
}

export function parseGLB(bytes) {
  must(Buffer.isBuffer(bytes) && bytes.length >= 20 && bytes.length <= MAX_GLB_BYTES, 'GLB inválido/grande demais');
  must(bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, 'header/length GLB inválido');
  let offset = 12;
  const chunks = [];
  while (offset < bytes.length) {
    must(offset + 8 <= bytes.length, 'chunk GLB truncado');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    must(length % 4 === 0 && offset + 8 + length <= bytes.length, 'limites do chunk GLB inválidos');
    chunks.push({ type, data: Buffer.from(bytes.subarray(offset + 8, offset + 8 + length)) });
    offset += 8 + length;
  }
  must(chunks.length >= 1 && chunks[0].type === 0x4e4f534a, 'JSON GLB precisa ser o primeiro chunk');
  must(chunks.slice(1).every((chunk) => chunk.type === 0x004e4942), 'chunk GLB não suportado');
  const json = JSON.parse(chunks[0].data.toString('utf8'));
  finiteTree(json);
  must(json?.asset?.version === '2.0', 'glTF 2 obrigatório');
  for (const key of ['nodes', 'meshes', 'materials', 'accessors', 'bufferViews', 'skins', 'animations']) must(json[key] === undefined || Array.isArray(json[key]), `${key}: array inválido`);
  return { json, chunks };
}

export function packGLB(json, sourceChunks) {
  finiteTree(json);
  const raw = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc((raw.length + 3) & ~3, 0x20);
  raw.copy(padded);
  const chunks = [{ type: 0x4e4f534a, data: padded }, ...sourceChunks.slice(1).map((chunk) => ({ type: chunk.type, data: Buffer.from(chunk.data) }))];
  const size = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0);
  const out = Buffer.alloc(size);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(size, 8);
  let offset = 12;
  for (const chunk of chunks) {
    out.writeUInt32LE(chunk.data.length, offset); out.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(out, offset + 8); offset += 8 + chunk.data.length;
  }
  return out;
}

function binChunk(parsed) {
  return parsed.chunks.find((chunk) => chunk.type === 0x004e4942)?.data || Buffer.alloc(0);
}

function viewPayload(parsed, viewIndex) {
  const view = parsed.json.bufferViews?.[viewIndex];
  if (!view) return null;
  const compressed = view.extensions?.EXT_meshopt_compression;
  const descriptor = view.buffer === 0
    ? { buffer: view.buffer, byteOffset: view.byteOffset || 0, byteLength: view.byteLength || 0, encoding: 'raw' }
    : compressed?.buffer === 0
      ? { buffer: 0, byteOffset: compressed.byteOffset || 0, byteLength: compressed.byteLength || 0, encoding: 'meshopt' }
      : null;
  must(descriptor, `bufferView ${viewIndex}: buffer externo sem payload meshopt embutido`);
  const bin = binChunk(parsed), start = descriptor.byteOffset, end = start + descriptor.byteLength;
  must(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end <= bin.length, `bufferView ${viewIndex} fora do BIN`);
  return { view, payload: descriptor, sha256: sha256(bin.subarray(start, end)) };
}

function accessorFact(parsed, accessorIndex) {
  const accessor = parsed.json.accessors?.[accessorIndex];
  if (!accessor) return null;
  const payload = viewPayload(parsed, accessor.bufferView);
  return { index: accessorIndex, descriptorSha256: jsonDigest(accessor), bufferView: accessor.bufferView, payloadSha256: payload?.sha256 || null };
}

function primitiveRows(json) {
  const rows = [];
  for (const [meshIndex, mesh] of (json.meshes || []).entries()) for (const [primitiveIndex, primitive] of (mesh.primitives || []).entries()) {
    rows.push({
      meshIndex,
      meshName: mesh.name || null,
      primitiveIndex,
      materialIndex: primitive.material ?? null,
      attributes: Object.fromEntries(Object.entries(primitive.attributes || {}).sort(([a], [b]) => a.localeCompare(b))),
      uvSets: Object.keys(primitive.attributes || {}).filter((name) => /^TEXCOORD_\d+$/.test(name)).sort(),
    });
  }
  return rows;
}

function materialRows(parsed, primitives) {
  const json = parsed.json;
  return (json.materials || []).map((material, index) => {
    const pbr = material.pbrMetallicRoughness || {};
    const textureIndices = sortedUnique([
      pbr.baseColorTexture?.index,
      pbr.metallicRoughnessTexture?.index,
      material.normalTexture?.index,
      material.occlusionTexture?.index,
      material.emissiveTexture?.index,
    ].filter(Number.isSafeInteger));
    return {
      index,
      name: material.name || null,
      pbr: {
        baseColorFactor: pbr.baseColorFactor ?? null,
        metallicFactor: pbr.metallicFactor ?? null,
        roughnessFactor: pbr.roughnessFactor ?? null,
        baseColorTexture: pbr.baseColorTexture?.index ?? null,
        metallicRoughnessTexture: pbr.metallicRoughnessTexture?.index ?? null,
      },
      textureIndices,
      primitiveBindings: primitives.filter((row) => row.materialIndex === index).map(({ meshIndex, meshName, primitiveIndex, uvSets }) => ({ meshIndex, meshName, primitiveIndex, uvSets })),
    };
  });
}

function relevantAccessors(json, predicate) {
  const ids = [];
  for (const row of primitiveRows(json)) for (const [name, index] of Object.entries(row.attributes)) if (predicate(name)) ids.push(index);
  return sortedUnique(ids);
}

export function censusGLB(bytes) {
  const parsed = parseGLB(bytes), { json } = parsed;
  const primitives = primitiveRows(json);
  const uvAccessors = relevantAccessors(json, (name) => /^TEXCOORD_\d+$/.test(name));
  const weightAccessors = relevantAccessors(json, (name) => name === 'JOINTS_0' || name === 'WEIGHTS_0');
  const animationAccessors = sortedUnique((json.animations || []).flatMap((animation) => (animation.samplers || []).flatMap((sampler) => [sampler.input, sampler.output]).filter(Number.isSafeInteger)));
  const inverseBindAccessors = sortedUnique((json.skins || []).map((skin) => skin.inverseBindMatrices).filter(Number.isSafeInteger));
  const magazineParts = [
    ...(json.nodes || []).map((node, index) => ({ kind: 'node', index, name: node.name || null, digest: jsonDigest(node) })),
    ...(json.meshes || []).map((mesh, index) => ({ kind: 'mesh', index, name: mesh.name || null, digest: jsonDigest(mesh) })),
  ].filter((part) => part.name && MAGAZINE.test(part.name));
  const animations = (json.animations || []).map((animation, index) => ({ index, name: animation.name || null, digest: jsonDigest(animation) }));
  const skins = (json.skins || []).map((skin, index) => ({
    index,
    name: skin.name || null,
    joints: (skin.joints || []).map((nodeIndex) => json.nodes?.[nodeIndex]?.name || `#${nodeIndex}`),
    digest: jsonDigest(skin),
    inverseBindMatrices: Number.isSafeInteger(skin.inverseBindMatrices) ? accessorFact(parsed, skin.inverseBindMatrices) : null,
  }));
  const invariants = {
    binChunksSha256: jsonDigest(parsed.chunks.slice(1).map((chunk) => ({ type: chunk.type, bytes: chunk.data.length, sha256: sha256(chunk.data) }))),
    nodesSha256: jsonDigest(json.nodes || []),
    meshesSha256: jsonDigest(json.meshes || []),
    skinsSha256: jsonDigest(json.skins || []),
    animationsSha256: jsonDigest(json.animations || []),
    accessorsSha256: jsonDigest(json.accessors || []),
    bufferViewsSha256: jsonDigest(json.bufferViews || []),
    uvBindingsSha256: jsonDigest(primitives.map(({ meshIndex, primitiveIndex, materialIndex, attributes, uvSets }) => ({ meshIndex, primitiveIndex, materialIndex, attributes, uvSets }))),
    uvPayloadSha256: jsonDigest(uvAccessors.map((index) => accessorFact(parsed, index))),
    rigPayloadSha256: jsonDigest([...inverseBindAccessors, ...weightAccessors].map((index) => accessorFact(parsed, index))),
    animationPayloadSha256: jsonDigest(animationAccessors.map((index) => accessorFact(parsed, index))),
    magazinePartsSha256: jsonDigest(magazineParts),
  };
  return {
    sha256: sha256(bytes),
    bytes: bytes.length,
    nodes: (json.nodes || []).length,
    meshes: (json.meshes || []).length,
    materials: materialRows(parsed, primitives),
    skins,
    animations,
    uvAccessors: uvAccessors.map((index) => accessorFact(parsed, index)),
    weightAccessors: weightAccessors.map((index) => accessorFact(parsed, index)),
    magazineParts,
    invariants,
  };
}

function readSource(spec) {
  const file = sourcePath(spec.path), bytes = fs.readFileSync(file), digest = sha256(bytes);
  must(digest === spec.sha256, `${spec.path}: digest divergente (esperado ${spec.sha256}, atual ${digest})`);
  return { file, bytes, census: censusGLB(bytes) };
}

function bindingsFor(census, names, perspective, weaponId) {
  const rows = [];
  for (const name of names) {
    const matches = census.materials.filter((material) => material.name === name);
    must(matches.length === 1, `${weaponId}/${perspective}: material ${name} precisa existir uma vez`);
    const material = matches[0];
    must(material.primitiveBindings.length > 0, `${weaponId}/${perspective}: material ${name} sem primitive binding`);
    if (material.pbr.baseColorTexture !== null) must(material.primitiveBindings.every((binding) => binding.uvSets.includes('TEXCOORD_0')), `${weaponId}/${perspective}: ${name} sem UV0`);
    rows.push({
      materialIndex: material.index,
      materialName: material.name,
      primitiveBindings: material.primitiveBindings,
      retainedTextureIndices: material.textureIndices,
    });
  }
  return rows;
}

function patchFor({ family, weaponId, perspective, source, census, mappings }) {
  const namesKey = perspective === '1p' ? 'firstPersonMaterials' : 'thirdPersonMaterials';
  const targets = mappings.map((mapping) => ({ part: mapping.part, materials: bindingsFor(census, mapping[namesKey], perspective, weaponId) }));
  return {
    schemaVersion: PATCH_SCHEMA,
    familyId: family.id,
    weaponId,
    perspective,
    source: { path: source.path, sha256: source.sha256, pipeline: source.pipeline || (perspective === '1p' ? 'unspecified-1p' : 'world-3p') },
    variant: { material: clone(family.material), provenance: clone(family.provenance) },
    targets,
    invariants: { ...census.invariants, magazineParts: clone(census.magazineParts) },
    approved: false,
    store: false,
  };
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sourceCensus(spec, cache) {
  if (!cache.has(spec.path)) cache.set(spec.path, readSource(spec));
  const value = cache.get(spec.path);
  must(value.census.sha256 === spec.sha256, `${spec.path}: censo leu outro digest`);
  return value.census;
}

export async function buildVariants({ catalogFile = path.join(ROOT, 'tools/fabrica/skins/weapon-skins.v1.json'), outputDir, runtimeIds = null, familyId = null } = {}) {
  must(outputDir, 'outputDir obrigatório');
  const catalog = loadCatalog(catalogFile), ids = runtimeIds || await runtimeWeaponIds();
  must(JSON.stringify(Object.keys(catalog.coverage).sort()) === JSON.stringify([...ids].sort()), 'cobertura não coincide com WEAPON_IDS');
  const families = familyId ? [catalog.families[familyId]] : Object.values(catalog.families);
  must(families.every(Boolean), `família ausente: ${familyId}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const cache = new Map(), coverage = {}, outputs = [];
  for (const weaponId of ids) {
    const entry = catalog.coverage[weaponId];
    const thirdPersonCensus = sourceCensus(entry.thirdPerson, cache);
    const firstPersonCensus = sourceCensus(entry.firstPerson, cache);
    const runtimeFirstPersonCensus = entry.runtimeFirstPerson ? sourceCensus(entry.runtimeFirstPerson, cache) : null;
    coverage[weaponId] = {
      status: entry.status,
      reason: entry.reason,
      thirdPerson: { source: clone(entry.thirdPerson), census: thirdPersonCensus },
      firstPerson: { source: clone(entry.firstPerson), census: firstPersonCensus },
      ...(entry.runtimeFirstPerson ? { runtimeFirstPerson: { source: clone(entry.runtimeFirstPerson), census: runtimeFirstPersonCensus } } : {}),
    };
    if (entry.status !== 'supported') continue;
    for (const family of families) for (const perspective of ['1p', '3p']) {
      const source = perspective === '1p' ? entry.firstPerson : entry.thirdPerson;
      const census = perspective === '1p' ? firstPersonCensus : thirdPersonCensus;
      const patch = patchFor({ family, weaponId, perspective, source, census, mappings: entry.partMappings });
      const file = `${family.id}/${weaponId}-${perspective}.material.json`;
      const absolute = path.join(outputDir, file);
      writeJSON(absolute, patch);
      outputs.push({ familyId: family.id, weaponId, perspective, file, sha256: sha256(fs.readFileSync(absolute)) });
    }
  }
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    catalogSha256: sha256(fs.readFileSync(catalogFile)),
    runtimeWeaponIds: [...ids],
    families: Object.fromEntries(families.map((family) => [family.id, { approved: false, store: false, provenance: clone(family.provenance) }])),
    coverage,
    outputs,
    approval: { visual: 'pending-human-review', store: false },
  };
  writeJSON(path.join(outputDir, 'manifest.json'), manifest);
  return manifest;
}

function verifyPatchShape(patch) {
  must(patch?.schemaVersion === PATCH_SCHEMA, 'schema da variante inválido');
  must(typeof patch.familyId === 'string' && typeof patch.weaponId === 'string' && ['1p', '3p'].includes(patch.perspective), 'identidade da variante inválida');
  must(patch.approved === false && patch.store === false, 'variante não revisada precisa ficar fora da store');
  sourceSpec(patch.source, 'patch.source');
  must(object(patch.variant?.material) && Array.isArray(patch.targets) && patch.targets.length > 0, 'patch material/targets ausente');
  must(object(patch.invariants) && Array.isArray(patch.invariants.magazineParts), 'patch sem invariantes');
}

function selectedMaterials(patch) {
  return patch.targets.flatMap((target) => target.materials.map((material) => ({ ...material, part: target.part })));
}

function assertTargetBindings(parsed, patch) {
  const primitives = primitiveRows(parsed.json);
  for (const target of selectedMaterials(patch)) {
    const material = parsed.json.materials?.[target.materialIndex];
    must(material?.name === target.materialName, `${patch.weaponId}/${patch.perspective}: off-by-one/material ${target.materialName}`);
    const current = primitives.filter((row) => row.materialIndex === target.materialIndex).map(({ meshIndex, meshName, primitiveIndex, uvSets }) => ({ meshIndex, meshName, primitiveIndex, uvSets }));
    must(JSON.stringify(current) === JSON.stringify(target.primitiveBindings), `${patch.weaponId}/${patch.perspective}: material binding divergente`);
    if (target.retainedTextureIndices.length) must(current.every((binding) => binding.uvSets.includes('TEXCOORD_0')), `${patch.weaponId}/${patch.perspective}: UV0 ausente`);
  }
}

function invariantError(before, after) {
  const order = [
    ['magazinePartsSha256', 'magazine parts'],
    ['skinsSha256', 'skins/rig'],
    ['nodesSha256', 'nodes/rig'],
    ['rigPayloadSha256', 'weights/inverse bind'],
    ['animationsSha256', 'animation JSON'],
    ['animationPayloadSha256', 'animation payload'],
    ['uvBindingsSha256', 'UV/material binding'],
    ['uvPayloadSha256', 'UV payload'],
    ['meshesSha256', 'mesh/primitive binding'],
    ['accessorsSha256', 'accessors'],
    ['bufferViewsSha256', 'bufferViews'],
    ['binChunksSha256', 'BIN chunks'],
  ];
  for (const [key, label] of order) if (before[key] !== after[key]) return `${label} mudou (${key})`;
  return null;
}

export function verifyApplied(sourceBytes, outputBytes, patch) {
  verifyPatchShape(patch);
  const before = censusGLB(sourceBytes), after = censusGLB(outputBytes);
  must(before.sha256 === patch.source.sha256, 'source digest não corresponde ao patch');
  const expected = { ...patch.invariants }; delete expected.magazineParts;
  must(!invariantError(expected, before.invariants), 'invariantes do patch não correspondem à fonte');
  const changed = invariantError(before.invariants, after.invariants);
  must(!changed, changed || 'estrutura alterada');
  const beforeParsed = parseGLB(sourceBytes), afterParsed = parseGLB(outputBytes);
  assertTargetBindings(beforeParsed, patch); assertTargetBindings(afterParsed, patch);
  const stripped = clone(afterParsed.json); stripped.materials = clone(beforeParsed.json.materials || []);
  must(JSON.stringify(stripped) === JSON.stringify(beforeParsed.json), 'campo fora de materials mudou');
  must(beforeParsed.chunks.length === afterParsed.chunks.length && beforeParsed.chunks.slice(1).every((chunk, index) => chunk.type === afterParsed.chunks[index + 1].type && chunk.data.equals(afterParsed.chunks[index + 1].data)), 'chunks binários mudaram');
  const desired = patch.variant.material;
  for (const target of selectedMaterials(patch)) {
    const pbr = afterParsed.json.materials[target.materialIndex].pbrMetallicRoughness;
    must(JSON.stringify(pbr.baseColorFactor) === JSON.stringify(desired.baseColorFactor) && pbr.metallicFactor === desired.metallicFactor && pbr.roughnessFactor === desired.roughnessFactor, `${target.materialName}: identidade material divergente`);
    const oldPbr = beforeParsed.json.materials[target.materialIndex].pbrMetallicRoughness || {};
    must(JSON.stringify(pbr.baseColorTexture ?? null) === JSON.stringify(oldPbr.baseColorTexture ?? null) && JSON.stringify(pbr.metallicRoughnessTexture ?? null) === JSON.stringify(oldPbr.metallicRoughnessTexture ?? null), `${target.materialName}: textura/binding foi substituída`);
  }
  return { sourceSha256: before.sha256, outputSha256: after.sha256, invariants: after.invariants };
}

export function applyVariant(patch, { sourceBytes = null } = {}) {
  verifyPatchShape(patch);
  const bytes = sourceBytes || fs.readFileSync(sourcePath(patch.source.path));
  must(sha256(bytes) === patch.source.sha256, `${patch.source.path}: source digest divergente`);
  const parsed = parseGLB(bytes);
  assertTargetBindings(parsed, patch);
  for (const target of selectedMaterials(patch)) {
    const material = parsed.json.materials[target.materialIndex];
    const pbr = material.pbrMetallicRoughness = material.pbrMetallicRoughness || {};
    pbr.baseColorFactor = clone(patch.variant.material.baseColorFactor);
    pbr.metallicFactor = patch.variant.material.metallicFactor;
    pbr.roughnessFactor = patch.variant.material.roughnessFactor;
  }
  const output = packGLB(parsed.json, parsed.chunks);
  const receipt = verifyApplied(bytes, output, patch);
  return { bytes: output, receipt };
}

export function assertPairParity(patches) {
  must(Array.isArray(patches) && patches.length === 2, 'par 1P/3P incompleto');
  const [a, b] = [...patches].sort((x, y) => x.perspective.localeCompare(y.perspective));
  must(a.weaponId === b.weaponId && a.familyId === b.familyId && a.perspective !== b.perspective, 'identidade do par divergente');
  must(JSON.stringify(a.variant) === JSON.stringify(b.variant), `${a.weaponId}: identidade visual 1P/3P divergente`);
  must(JSON.stringify(a.targets.map((target) => target.part)) === JSON.stringify(b.targets.map((target) => target.part)), `${a.weaponId}: partes 1P/3P divergentes`);
}

export async function verifyVariantDirectory(outputDir, { writeAppliedDir = null } = {}) {
  const manifest = readJSON(path.join(outputDir, 'manifest.json'));
  must(manifest.schemaVersion === MANIFEST_SCHEMA, 'manifesto de build inválido');
  const patches = [];
  for (const output of manifest.outputs) {
    const file = path.join(outputDir, output.file), bytes = fs.readFileSync(file);
    must(sha256(bytes) === output.sha256, `${output.file}: digest do patch divergente`);
    const patch = readJSON(file), applied = applyVariant(patch);
    patches.push(patch);
    if (writeAppliedDir) {
      const target = path.join(writeAppliedDir, patch.familyId, `${patch.weaponId}-${patch.perspective}.glb`);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, applied.bytes);
      writeJSON(`${target}.receipt.json`, applied.receipt);
    }
  }
  const pairs = new Map();
  for (const patch of patches) {
    const key = `${patch.familyId}:${patch.weaponId}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(patch);
  }
  for (const pair of pairs.values()) assertPairParity(pair);
  return { outputs: patches.length, pairs: pairs.size };
}

export function directoryDigest(dir) {
  const files = [];
  const walk = (base, rel = '') => {
    for (const name of fs.readdirSync(base).sort()) {
      const absolute = path.join(base, name), next = path.join(rel, name), stat = fs.statSync(absolute);
      if (stat.isDirectory()) walk(absolute, next);
      else files.push({ file: next.split(path.sep).join('/'), sha256: sha256(fs.readFileSync(absolute)) });
    }
  };
  walk(dir);
  return jsonDigest(files);
}

function mustReject(label, fn, pattern) {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  must(error, `mutante ${label} não mordeu`);
  if (pattern) must(pattern.test(String(error.message)), `mutante ${label} caiu pelo motivo errado: ${error.message}`);
}

export async function expectMutation(type, fixture, outputDir) {
  if (type === 'identity-parity') {
    const pair = fixture.map(clone); pair[0].variant.material.roughnessFactor = 0.123;
    mustReject(type, () => assertPairParity(pair), /identidade visual/); return;
  }
  const patch = clone(fixture), source = fs.readFileSync(sourcePath(patch.source.path));
  if (type === 'source-digest') {
    patch.source.sha256 = '0'.repeat(64);
    mustReject(type, () => applyVariant(patch), /source digest/); return;
  }
  if (type === 'off-by-one') {
    patch.targets[0].materials[0].materialIndex += 1;
    mustReject(type, () => applyVariant(patch), /off-by-one\/material/); return;
  }
  if (type === 'uv-binding') {
    const parsed = parseGLB(source), binding = patch.targets[0].materials[0].primitiveBindings[0];
    delete parsed.json.meshes[binding.meshIndex].primitives[binding.primitiveIndex].attributes.TEXCOORD_0;
    const mutant = packGLB(parsed.json, parsed.chunks); patch.source.sha256 = sha256(mutant);
    mustReject(type, () => applyVariant(patch, { sourceBytes: mutant }), /binding divergente|UV0 ausente/); return;
  }
  const applied = applyVariant(patch).bytes, parsed = parseGLB(applied);
  if (type === 'rig') {
    must(parsed.json.skins?.length, 'fixture sem skin');
    parsed.json.skins[0].joints = [...parsed.json.skins[0].joints].reverse();
    mustReject(type, () => verifyApplied(source, packGLB(parsed.json, parsed.chunks), patch), /skins\/rig/); return;
  }
  if (type === 'animation') {
    must(parsed.json.animations?.length, 'fixture sem animação');
    parsed.json.animations[0].name = `${parsed.json.animations[0].name || 'clip'}-mutant`;
    mustReject(type, () => verifyApplied(source, packGLB(parsed.json, parsed.chunks), patch), /animation JSON/); return;
  }
  if (type === 'magazine') {
    const node = parsed.json.nodes?.find((value) => MAGAZINE.test(value.name || ''));
    must(node, 'fixture sem magazine node'); node.name = `${node.name}-mutant`;
    mustReject(type, () => verifyApplied(source, packGLB(parsed.json, parsed.chunks), patch), /magazine parts/); return;
  }
  throw new Error(`mutante desconhecido: ${type} (${outputDir})`);
}
