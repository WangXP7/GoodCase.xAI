import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerPropTemplate } from '../../public/js/mapprops.js';
import { preloadPropGeometry } from './prop-geometry-fixture.mjs';

export async function loadUpaGeometry(ids, args = process.argv) {
  const argument = args.find(value => value.startsWith('--asset-manifest='));
  if (!argument) {
    const missing = ids.filter(id => !existsSync(new URL(`../../public/models/props/${id}.glb`, import.meta.url)));
    if (missing.length) throw new Error(`GLBs públicos ausentes: ${missing.join(', ')}`);
    await preloadPropGeometry(ids);
    const assets = ids.map(id => {
      const source = readFileSync(new URL(`../../public/models/props/${id}.glb`, import.meta.url));
      return { id, sha256: createHash('sha256').update(source).digest('hex'), bytes: source.length };
    });
    return { mode: 'final-public', assets };
  }
  const entries = JSON.parse(readFileSync(argument.slice('--asset-manifest='.length), 'utf8'));
  const assets = [];
  for (const id of ids) {
    const entry = entries.find(asset => asset.id === id);
    if (!entry) throw new Error(`Candidato clínico ausente no manifesto: ${id}`);
    const source = readFileSync(entry.file);
    const sha256 = createHash('sha256').update(source).digest('hex');
    if (sha256 !== entry.sha256) throw new Error(`Candidato ${id} mudou depois do manifesto`);
    const length = source.readUInt32LE(12), json = JSON.parse(source.subarray(20, 20 + length));
    const strip = object => {
      if (!object || typeof object !== 'object') return;
      for (const key of Object.keys(object)) { if (/texture$/i.test(key)) delete object[key]; else strip(object[key]); }
    };
    for (const material of json.materials || []) strip(material);
    delete json.images; delete json.textures;
    const encoded = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
    encoded.copy(padded);
    const binary = source.subarray(20 + length), glb = Buffer.alloc(20 + padded.length + binary.length);
    source.copy(glb, 0, 0, 20); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(padded.length, 12);
    padded.copy(glb, 20); binary.copy(glb, 20 + padded.length);
    const loaded = await new Promise((resolve, reject) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', resolve, reject));
    loaded.scene.userData.geometryFixtureAsset = id;
    registerPropTemplate(id, loaded.scene);
    assets.push({ id, sha256, bytes: source.length });
  }
  return { mode: 'candidate-external', assets };
}
