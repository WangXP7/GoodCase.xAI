#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VM_FRAME } from '../../public/js/data/vmconfig.js';
import { VM_FRAME as LEGACY_VM_FRAME } from '../../public/js/vmattach.js';
import { rotXYZ } from './vm-mint-audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const game = fs.readFileSync(path.join(ROOT, 'public/js/game.js'), 'utf8');
const auditFile = path.join(ROOT, 'tools/eval/vm_mint_audit.json');
const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
const v0 = Number(/const\s+VM_FOV_DEFAULT\s*=\s*([\d.]+)\s*;/.exec(game)?.[1]);
const off = (/const\s+VM_OFF\s*=[\s\S]*?:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/.exec(game) || [])
  .slice(1, 4).map(Number);
const halfTanHorizontal = Math.tan(v0 * Math.PI / 360) * (16 / 9);

let worst = { delta: 0, weapon: '', point: '' };
for (const [weapon, measurement] of Object.entries(audit.armas || {})) {
  const box = measurement.gunSpace;
  if (!box || !measurement.viewSpace) continue;
  const tuning = VM_FRAME.cls[VM_FRAME.classOf[weapon] || 'rifle'];
  const scale = VM_FRAME.vmScale * (measurement.vm ?? 1);
  const back = scale * Math.max(0, -box.bboxMin[2]);
  const forward = scale * Math.max(0.001, box.bboxMax[2]);
  let depth = Math.max(back + tuning.clear, tuning.minz, forward / tuning.fwdTan)
    * (VM_FRAME.zMul[weapon] || 1) * VM_FRAME.recuoZ;
  const edge = VM_FRAME.nearX * halfTanHorizontal;
  if (edge > tuning.tanH + 1e-3 && back > 0) {
    depth = Math.max(depth, (back * edge) / (edge - tuning.tanH));
  }
  const gripX = depth * tuning.tanH;
  const gripY = -gripX * VM_FRAME.tanBarrel;
  const grip = [off[0] + gripX, off[1] + gripY, off[2] - depth];
  const knife = weapon === 'knife';
  const knifeRotation = VM_FRAME.knifeRot || [0, 0, 0];
  const rotation = {
    pitch: knife ? knifeRotation[0] : (tuning.pitch || 0),
    yaw: knife ? knifeRotation[1] : (tuning.yaw || 0),
    roll: knife ? knifeRotation[2] : (tuning.roll || 0),
  };
  const muzzle = rotXYZ(rotation, [
    -scale * box.boca[0],
    scale * box.boca[1],
    -scale * box.boca[2],
  ]).map((value, axis) => value + grip[axis]);
  for (const [point, expected, actual] of [
    ['grip', grip, measurement.viewSpace.grip],
    ['muzzle', muzzle, measurement.viewSpace.boca],
  ]) {
    const delta = Math.max(...expected.map((value, axis) => Math.abs(value - actual[axis])));
    if (delta > worst.delta) worst = { delta, weapon, point };
  }
}

const sourceShared = LEGACY_VM_FRAME === VM_FRAME;
const ok = sourceShared && Number.isFinite(v0) && off.length === 3 && worst.delta <= 0.002;
const result = {
  id: 'AUD1',
  ok,
  evid: `VM_FRAME compartilhado=${sourceShared}; pior Δ=${worst.delta.toFixed(4)} m (${worst.weapon}/${worst.point})`,
};
console.log(JSON.stringify({ results: [result] }));
if (!ok) process.exitCode = 1;
