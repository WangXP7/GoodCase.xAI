import * as THREE from 'three';
import { registerDetail, detailFor } from './textures.js';

const localRandom = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
const allocationRandom = localRandom(9271);
export function withSurfaceAllocation(create, isolate = false) {
  const random = Math.random;
  if (isolate) Math.random = allocationRandom;
  try { return create(); } finally { Math.random = random; }
}
function canvasSurface(name, size, rx, ry, draw, strength = .8, isolateAllocation = false) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size, localRandom(731));
  // UUIDs novos não deslocam o RNG de gameplay nem colidem entre superfícies.
  return withSurfaceAllocation(() => {
    const texture = new THREE.CanvasTexture(canvas); texture.name = name;
    texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(rx, ry);
    if (strength !== null) registerDetail(texture, canvas, strength, .78, .98);
    detailFor(texture);
    return texture;
  }, isolateAllocation);
}

export function commercialSlab(rx, ry) {
  return canvasSurface('commercial-slab', 256, rx, ry, (ctx, s, rand) => {
    ctx.fillStyle = '#c9cfd6'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2200; i++) {
      ctx.fillStyle = i % 3 ? 'rgba(151,160,169,.18)' : 'rgba(243,244,245,.45)';
      ctx.fillRect(rand() * s, rand() * s, .8 + rand() * 1.2, .8 + rand() * 1.2);
    }
    for (const p of [35, 116, 208]) {
      const gradient = ctx.createLinearGradient(p - 28, 0, p + 28, 0);
      gradient.addColorStop(0, 'rgba(143,153,163,0)'); gradient.addColorStop(.5, 'rgba(143,153,163,.06)'); gradient.addColorStop(1, 'rgba(143,153,163,0)');
      ctx.fillStyle = gradient; ctx.fillRect(p - 28, 0, 56, s);
    }
    ctx.strokeStyle = '#aeb5bb'; ctx.lineWidth = 1;
    for (const p of [0, s / 2, s]) { ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke(); }
  });
}

// A terra conserva massas sem emenda; a grama usa somente grão e lâminas discretas.
export function soilSurface(rx, ry, green = false) {
  return canvasSurface(green ? 'dry-ground-cover' : 'packed-junkyard-earth', 256, rx, ry, (ctx, s, rand) => {
    ctx.fillStyle = green ? '#677443' : '#786d5f'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 8; i++) {
      const px = rand() * s, py = rand() * s, radius = s * (.18 + rand() * .19);
      if (green) continue;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        const g = ctx.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, radius);
        g.addColorStop(0, green ? 'rgba(112,97,61,.35)' : i % 2 ? 'rgba(63,56,47,.23)' : 'rgba(151,133,104,.24)');
        g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
      }
    }
    for (let i = 0; i < 2800; i++) {
      ctx.fillStyle = green ? i % 2 ? 'rgba(190,174,107,.22)' : 'rgba(47,65,37,.23)' : i % 2 ? 'rgba(176,159,131,.25)' : 'rgba(67,61,52,.22)';
      ctx.fillRect(rand() * s, rand() * s, .7 + rand() * 1.8, .7 + rand() * 1.4);
    }
    if (green) for (let i = 0; i < 260; i++) {
      const x = rand() * s, y = rand() * s;
      ctx.strokeStyle = i % 3 ? '#798452' : '#9c965d'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 2, y - 4); ctx.moveTo(x, y); ctx.lineTo(x - 3, y - 3); ctx.stroke();
    }
  }, null, green);
}

export function planterLeaves(rx = 1, ry = 1) {
  return canvasSurface('cerrado-planter-leaves', 256, rx, ry, (ctx, s, rand) => {
    ctx.fillStyle = '#485333'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 360; i++) {
      const x = rand() * s, y = rand() * s, h = 8 + rand() * 16;
      ctx.fillStyle = ['#677246', '#84905b', '#59643a', '#a09965'][i % 4];
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - h * .6, y - h * .4, x - h * .2, y - h); ctx.quadraticCurveTo(x + h * .5, y - h * .6, x, y); ctx.fill();
    }
  }, .5);
}

export function paintedPanel(color = '#496c7e') {
  return canvasSurface('painted-panel', 128, 1, 1, (ctx, s, rand) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(25,36,43,.32)'; ctx.lineWidth = 2; ctx.strokeRect(6, 6, s - 12, s - 12);
    ctx.fillStyle = 'rgba(211,211,196,.5)';
    for (const x of [10, s - 12]) for (const y of [10, s - 12]) ctx.fillRect(x, y, 2, 2);
    for (let i = 0; i < 35; i++) { ctx.fillStyle = 'rgba(209,209,187,.1)'; ctx.fillRect(rand() * s, s - 12 + rand() * 12, 2 + rand() * 9, 1); }
  }, .5, true);
}

export function directedMasonry(rx, ry, variant = 0, raw = false) {
  const s = 256, data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const grain = ((Math.imul((x + variant * 43) ^ (y * 373), 1597334677) >>> 16) % 13) - 6;
    const band = 214 + Math.sin((x + variant * 29) * Math.PI * 2 / s) * 11;
    const edge = (x < 14 || x > 241) && y > 136 + variant % 3 * 17;
    const exposed = raw || y > band || edge;
    const row = Math.floor(y / 16), bx = (x + (row % 2) * 16) % 32;
    const mortar = y % 16 < 1 || bx < 1;
    const brick = ((Math.floor((x + (row % 2) * 16) / 32) * 7 + row * 3 + variant) % 5) - 2;
    const moisture = Math.max(0, (y - 176) / 80) * 15;
    const c = exposed ? mortar ? [146 + grain, 137 + grain, 116 + grain] : [177 + brick * 5 + grain, 108 + brick * 3 + grain, 70 + grain] : [200 + grain - moisture, 178 + grain - moisture, 137 + grain - moisture];
    data.set([...c.map(v => Math.round(v)), 255], (y * s + x) * 4);
  }
  const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  t.name = raw ? 'corrego-exposed-brick' : 'corrego-directed-plaster';
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry); t.needsUpdate = true; detailFor(t); return t;
}
