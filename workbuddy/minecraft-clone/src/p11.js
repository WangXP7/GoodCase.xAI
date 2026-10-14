/* =====================================================================
   13. 粒子 · 掉落物 · 音效
   ===================================================================== */

/* ---------- 方块平均色（粒子与掉落物着色用） ---------- */
let BLOCK_AVG_COLOR = new Float32Array(0);
function computeBlockColors() {
  BLOCK_AVG_COLOR = new Float32Array(BLOCKS.length * 3);
  for (let i = 0; i < BLOCKS.length; i++) {
    const b = BLOCKS[i];
    let layer = 0;
    if (b.tex) {
      layer = b.tex.all !== undefined ? b.tex.all
            : (b.tex.side !== undefined ? b.tex.side : (b.tex.top !== undefined ? b.tex.top : 0));
    }
    if (layer === undefined || layer === null || !TEX_LAYERS[layer]) layer = 0;
    const px = TEX_LAYERS[layer].px;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let k = 0; k < px.d.length; k += 4) {
      if (px.d[k + 3] < 128) continue;
      r += px.d[k]; g += px.d[k + 1]; bl += px.d[k + 2]; n++;
    }
    if (!n) n = 1;
    BLOCK_AVG_COLOR[i * 3] = r / n / 255;
    BLOCK_AVG_COLOR[i * 3 + 1] = g / n / 255;
    BLOCK_AVG_COLOR[i * 3 + 2] = bl / n / 255;
  }
}

/* =====================================================================
   粒子系统
   ===================================================================== */
class Particles {
  constructor(max = 2000) {
    this.list = [];
    this.max = max;
    this._texCache = new Map();
  }
  clear() { this.list.length = 0; }

  _lightAt(world, x, y, z) {
    const sky = getSkyLight(world, Math.floor(x), Math.floor(y), Math.floor(z));
    const blk = getBlockLight(world, Math.floor(x), Math.floor(y), Math.floor(z));
    return Math.max(SKY_BRIGHTNESS[sky], BLOCK_BRIGHTNESS[blk]) * 0.92 + 0.08;
  }

  spawnBreak(world, bx, by, bz, block, n = 28) {
    if (this.list.length > this.max) return;
    const col = [BLOCK_AVG_COLOR[block.id * 3], BLOCK_AVG_COLOR[block.id * 3 + 1], BLOCK_AVG_COLOR[block.id * 3 + 2]];
    const layer = block.tex ? (block.tex.side !== undefined ? block.tex.side : block.tex.all) : 0;
    for (let i = 0; i < n; i++) {
      const px = bx + 0.14 + Math.random() * 0.72;
      const py = by + 0.14 + Math.random() * 0.72;
      const pz = bz + 0.14 + Math.random() * 0.72;
      this.list.push({
        x: px, y: py, z: pz,
        vx: (Math.random() - 0.5) * 3.2, vy: Math.random() * 3.4 + 0.8, vz: (Math.random() - 0.5) * 3.2,
        size: 0.055 + Math.random() * 0.075,
        life: 0.65 + Math.random() * 0.75, maxLife: 1.4,
        color: col.slice(),
        light: this._lightAt(world, px, py, pz),
        layer,
        gravity: 15,
        collide: true,
      });
    }
  }

  spawnHit(world, bx, by, bz, face, block, n = 6) {
    if (this.list.length > this.max) return;
    const col = [BLOCK_AVG_COLOR[block.id * 3], BLOCK_AVG_COLOR[block.id * 3 + 1], BLOCK_AVG_COLOR[block.id * 3 + 2]];
    const layer = block.tex ? (block.tex.side !== undefined ? block.tex.side : block.tex.all) : 0;
    const d = DIRS[face];
    for (let i = 0; i < n; i++) {
      const px = bx + 0.5 + d[0] * 0.52 + (d[0] ? 0 : (Math.random() - 0.5)) * 0.8;
      const py = by + 0.5 + d[1] * 0.52 + (d[1] ? 0 : (Math.random() - 0.5)) * 0.8;
      const pz = bz + 0.5 + d[2] * 0.52 + (d[2] ? 0 : (Math.random() - 0.5)) * 0.8;
      this.list.push({
        x: px, y: py, z: pz,
        vx: d[0] * 1.4 + (Math.random() - 0.5) * 1.2,
        vy: d[1] * 1.4 + Math.random() * 1.6,
        vz: d[2] * 1.4 + (Math.random() - 0.5) * 1.2,
        size: 0.035 + Math.random() * 0.05,
        life: 0.35 + Math.random() * 0.4, maxLife: 0.8,
        color: col.slice(),
        light: this._lightAt(world, px, py, pz),
        layer, gravity: 18, collide: false,
      });
    }
  }

  spawnSplash(world, x, y, z, n = 14) {
    for (let i = 0; i < n; i++) {
      this.list.push({
        x: x + (Math.random() - 0.5) * 0.9, y: y + Math.random() * 0.25, z: z + (Math.random() - 0.5) * 0.9,
        vx: (Math.random() - 0.5) * 2.6, vy: Math.random() * 4.2 + 1.4, vz: (Math.random() - 0.5) * 2.6,
        size: 0.045 + Math.random() * 0.05,
        life: 0.5 + Math.random() * 0.5, maxLife: 1.0,
        color: [0.62, 0.78, 1.0],
        light: 1.0,
        layer: TEX_INDEX['particle'],
        gravity: 14, collide: false,
      });
    }
  }

  spawnBubble(world, x, y, z, n = 3) {
    for (let i = 0; i < n; i++) {
      this.list.push({
        x: x + (Math.random() - 0.5) * 0.5, y: y + Math.random() * 0.4, z: z + (Math.random() - 0.5) * 0.5,
        vx: (Math.random() - 0.5) * 0.35, vy: 1.4 + Math.random(), vz: (Math.random() - 0.5) * 0.35,
        size: 0.028 + Math.random() * 0.026,
        life: 1.1, maxLife: 1.1,
        color: [0.88, 0.95, 1.0],
        light: 1.0,
        layer: TEX_INDEX['particle'],
        gravity: -1.2, collide: false,
      });
    }
  }

  spawnDust(world, x, y, z, n, col) {
    for (let i = 0; i < n; i++) {
      this.list.push({
        x: x + (Math.random() - 0.5) * 0.8, y: y + 0.05, z: z + (Math.random() - 0.5) * 0.8,
        vx: (Math.random() - 0.5) * 1.4, vy: Math.random() * 1.4, vz: (Math.random() - 0.5) * 1.4,
        size: 0.04 + Math.random() * 0.05,
        life: 0.5 + Math.random() * 0.6, maxLife: 1.1,
        color: col, light: 0.9,
        layer: TEX_INDEX['particle'], gravity: 9, collide: false,
      });
    }
  }

  update(dt, world) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L.splice(i, 1); continue; }
      p.vy -= p.gravity * dt;
      let nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (p.collide) {
        const W = world;
        if (W.isSolid(Math.floor(nx), Math.floor(p.y), Math.floor(p.z))) { nx = p.x; p.vx *= -0.32; }
        if (W.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(nz))) { nz = p.z; p.vz *= -0.32; }
        if (W.isSolid(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))) { ny = p.y; p.vy *= -0.3; if (Math.abs(p.vy) < 0.6) p.vy = 0; }
      }
      p.x = nx; p.y = ny; p.z = nz;
    }
  }

  render(renderer, cam) {
    if (!this.list.length) return;
    const gl = renderer.gl;
    const visible = [];
    const r2 = 90 * 90;
    for (const p of this.list) {
      const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      visible.push(p);
    }
    if (!visible.length) return;
    const prog = renderer.progPart.use();
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.uniformMatrix4fv(prog.u('uProj'), false, renderer.proj);
    gl.uniformMatrix4fv(prog.u('uView'), false, renderer.view);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(prog.u('uTex'), 0);
    gl.bindVertexArray(renderer.quadVAO);
    let curTex = null;
    for (const p of visible) {
      let tex = this._texCache.get(p.layer);
      if (!tex) {
        tex = renderer.makeLayerTexture(p.layer);
        this._texCache.set(p.layer, tex);
      }
      if (tex !== curTex) { gl.bindTexture(gl.TEXTURE_2D, tex); curTex = tex; }
      const fade = clamp(p.life / 0.35, 0, 1);
      const s = p.size * (0.5 + fade * 0.5) * 0.5;
      gl.uniform3f(prog.u('uCenter'), p.x, p.y, p.z);
      gl.uniform2f(prog.u('uSize'), s, s);
      gl.uniform1f(prog.u('uLight'), p.light);
      gl.uniform3f(prog.u('uColor'), p.color[0], p.color[1], p.color[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
  }
}

/* 亮度查表（供粒子使用） */
const SKY_BRIGHTNESS = new Float32Array(16);
const BLOCK_BRIGHTNESS = new Float32Array(16);
for (let i = 0; i < 16; i++) {
  SKY_BRIGHTNESS[i] = i === 0 ? 0.06 : (0.06 + 0.94 * Math.pow(i / 15, 1.35));
  BLOCK_BRIGHTNESS[i] = i === 0 ? 0.04 : (0.04 + 0.96 * Math.pow(i / 15, 1.28));
}

/* =====================================================================
   掉落物实体
   ===================================================================== */
class DropEntity {
  constructor(x, y, z, blockId) {
    this.x = x; this.y = y; this.z = z;
    this.vx = (Math.random() - 0.5) * 1.6;
    this.vy = 1.6 + Math.random() * 0.8;
    this.vz = (Math.random() - 0.5) * 1.6;
    this.block = blockId;
    this.age = 0;
    this.rot = Math.random() * TAU;
    this.pickupDelay = 0.5;
    this.dead = false;
  }
  update(dt, world) {
    this.age += dt;
    this.pickupDelay -= dt;
    this.rot += dt * 1.2;
    this.vy -= 24 * dt;
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt, nz = this.z + this.vz * dt;
    if (!world.isSolid(Math.floor(nx), Math.floor(this.y + 0.15), Math.floor(this.z))) { this.x = nx; } else this.vx = 0;
    if (!world.isSolid(Math.floor(this.x), Math.floor(this.y + 0.15), Math.floor(nz))) { this.z = nz; } else this.vz = 0;
    if (!world.isSolid(Math.floor(this.x), Math.floor(ny + 0.15), Math.floor(this.z))) { this.y = ny; }
    else { this.y = Math.floor(this.y) + 0.001; this.vy = 0; this.vx *= 0.7; this.vz *= 0.7; }
    if (this.age > 300) this.dead = true;
  }
}

/* =====================================================================
   程序化音效（WebAudio 合成，零音频资源）
   ===================================================================== */
const MATERIAL_SOUND = {
  stone:  { f: 760,  q: 2.2, dur: 0.17, vol: 0.34, hp: 180 },
  dirt:   { f: 380,  q: 1.0, dur: 0.20, vol: 0.30, hp: 90 },
  grass:  { f: 460,  q: 1.1, dur: 0.20, vol: 0.28, hp: 120 },
  wood:   { f: 560,  q: 3.4, dur: 0.19, vol: 0.32, hp: 150 },
  sand:   { f: 1750, q: 0.9, dur: 0.19, vol: 0.26, hp: 400 },
  gravel: { f: 1150, q: 1.1, dur: 0.20, vol: 0.30, hp: 260 },
  glass:  { f: 2700, q: 5.0, dur: 0.13, vol: 0.26, hp: 900 },
  cloth:  { f: 320,  q: 0.7, dur: 0.22, vol: 0.24, hp: 70 },
  snow:   { f: 900,  q: 0.8, dur: 0.18, vol: 0.20, hp: 200 },
  metal:  { f: 1400, q: 6.0, dur: 0.16, vol: 0.28, hp: 600 },
};

class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.55;
    this.lastStep = 0;
  }
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      // 白噪声缓冲
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      // 淡入以避免爆音
      const comp = this.ctx.createDynamicsCompressor ? this.ctx.createDynamicsCompressor() : null;
      if (comp) { comp.threshold.value = -18; comp.ratio.value = 6; this.master.disconnect(); this.master.connect(comp); comp.connect(this.ctx.destination); }
      return true;
    } catch (e) { return false; }
  }
  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
  _burst(mat, pitch = 1, volMul = 1, durMul = 1) {
    if (!this.enabled || !this.ensure()) return;
    const c = this.ctx, t = c.currentTime;
    const m = MATERIAL_SOUND[mat] || MATERIAL_SOUND.stone;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.85 + Math.random() * 0.34;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = m.f * pitch * (0.92 + Math.random() * 0.16);
    bp.Q.value = m.q;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = m.hp * 0.6;
    const g = c.createGain();
    const dur = m.dur * durMul;
    const vol = m.vol * volMul * 0.9;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
    return { src, g };
  }
  dig(mat) { this._burst(mat, 1, 0.55, 1); }
  breakBlock(mat) { this._burst(mat, 0.82, 1.25, 1.5); }
  place(mat) { this._burst(mat, 1.22, 1.0, 0.9); }
  step(mat, sprint) { this._burst(mat, sprint ? 1.14 : 1.0, sprint ? 0.42 : 0.3, 0.7); }
  swim() { this._burst('dirt', 0.55, 0.28, 1.6); }
  hurt() {
    if (!this.enabled || !this.ensure()) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.24);
  }
  pop() {
    if (!this.enabled || !this.ensure()) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(560, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.07);
    const g = c.createGain();
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.14);
  }
  splash() { this._burst('sand', 0.7, 0.5, 1.8); }
}
