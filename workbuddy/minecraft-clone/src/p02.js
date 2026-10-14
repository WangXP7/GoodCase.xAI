/* =====================================================================
   4. 程序化像素纹理生成
   ---------------------------------------------------------------------
   全部 16x16 像素画，逐像素用 Canvas 算法绘制，最终打包进
   WebGL2 TEXTURE_2D_ARRAY（每张纹理一层，彻底杜绝 mipmap 渗色）
   ===================================================================== */

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const shade = (c, f) => [clamp(c[0] * f, 0, 255) | 0, clamp(c[1] * f, 0, 255) | 0, clamp(c[2] * f, 0, 255) | 0];

class Pixels {
  constructor(w = 16, h = 16) {
    this.w = w; this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x, y, r, g, b, a = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = a;
  }
  setc(x, y, c, a = 255) {
    // 容许传入单通道数值（按灰度处理），避免误用导致静默变黑
    if (typeof c === 'number') this.set(x, y, c, c, c, a);
    else this.set(x, y, c[0], c[1], c[2], a);
  }
  get(x, y) {
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  fill(c, a = 255) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.setc(x, y, c, a);
  }
  rect(x0, y0, w, h, c, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.setc(x, y, c, a);
  }
  /** 逐像素噪声填充：base 基础上叠加 ±v 的随机扰动 */
  noiseFill(base, v, seed, mask = null) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (mask && !mask(x, y)) continue;
      const n = hash2i(x, y, seed) * 2 - 1;
      const n2 = hash2i(x + 71, y + 131, seed ^ 0x5bf0) * 2 - 1;
      const f = n * v + n2 * v * 0.45;
      this.setc(x, y, [clamp(base[0] + f, 0, 255), clamp(base[1] + f * 1.02, 0, 255), clamp(base[2] + f * 1.05, 0, 255)]);
    }
  }
  /** 撒点 */
  speckle(count, c, seed, sizeMin = 1, sizeMax = 2, alpha = 255) {
    for (let i = 0; i < count; i++) {
      const x = (hash2i(i, 1, seed) * this.w) | 0;
      const y = (hash2i(i, 2, seed) * this.h) | 0;
      const s = sizeMin + ((hash2i(i, 3, seed) * (sizeMax - sizeMin + 1)) | 0);
      const cc = Array.isArray(c[0]) ? c[(hash2i(i, 4, seed) * c.length) | 0] : c;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) this.setc(x + dx, y + dy, cc, alpha);
    }
  }
  /** 圆形斑块 */
  blob(cx, cy, r, c, seed, alpha = 255, jitter = 0.35) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const dx = x - cx, dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const wob = 1 + (hash2i(x, y, seed) * 2 - 1) * jitter;
        if (d <= r * wob) this.setc((x + 64) % this.w, (y + 64) % this.h, c, alpha);
      }
    }
  }
  /** 竖直条纹（树皮） */
  vstripes(seed, colors, width = 1) {
    for (let x = 0; x < this.w; x += width) {
      const c = colors[(hash2i(x, 0, seed) * colors.length) | 0];
      for (let y = 0; y < this.h; y++) {
        const j = hash2i(x, y, seed) * 0.14 - 0.07;
        this.setc(x, y, shade(c, 1 + j));
      }
    }
  }
  /** 横向木板 */
  planks(seed, base, rows = 4) {
    const rh = this.h / rows;
    for (let r = 0; r < rows; r++) {
      const bright = 0.86 + hash2i(r, 9, seed) * 0.3;
      for (let y = r * rh; y < (r + 1) * rh; y++) {
        for (let x = 0; x < this.w; x++) {
          const n = hash2i(x, y, seed ^ 0x9e3) * 0.12 - 0.06;
          this.setc(x, y, shade(base, bright * (1 + n)));
        }
      }
      // 板缝
      for (let x = 0; x < this.w; x++) this.setc(x, r * rh, shade(base, 0.62));
      // 每行随机的短裂缝
      const seam = (hash2i(r, 33, seed) * this.w) | 0;
      for (let y = r * rh + 1; y < (r + 1) * rh; y++) this.setc(seam, y, shade(base, 0.68));
    }
  }
  /** 石砖网格 */
  bricks(seed, base, bw = 8, bh = 4, mortar = 0.6) {
    this.noiseFill(base, 11, seed);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const row = (y / bh) | 0;
        const off = (row % 2) * (bw / 2);
        const isMortar = (y % bh === 0) || (((x + off) % bw) === 0);
        if (isMortar) this.setc(x, y, shade(base, mortar));
        else {
          const bid = row * 31 + (((x + off) / bw) | 0) * 17;
          const t = 0.86 + hash2i(bid, 5, seed) * 0.26;
          const cur = this.get(x, y);
          this.setc(x, y, [cur[0] * t, cur[1] * t, cur[2] * t]);
        }
      }
    }
  }
  /** Voronoi 石子（圆石） */
  cobble(seed, colors, cells = 7) {
    const pts = [];
    for (let i = 0; i < cells; i++) {
      pts.push([hash2i(i, 11, seed) * 16, hash2i(i, 22, seed) * 16, i]);
    }
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let best = 1e9, b1 = 0, b2 = 1e9;
        for (const p of pts) {
          // 环绕距离（可平铺）
          let dx = Math.abs(x - p[0]); dx = Math.min(dx, 16 - dx);
          let dy = Math.abs(y - p[1]); dy = Math.min(dy, 16 - dy);
          const d = dx * dx + dy * dy;
          if (d < best) { b2 = best; best = d; b1 = p[2]; }
          else if (d < b2) b2 = d;
        }
        const edge = Math.sqrt(b2) - Math.sqrt(best);
        const c = colors[b1 % colors.length];
        if (edge < 0.85) this.setc(x, y, shade(c, 0.42));            // 石子缝
        else {
          const j = hash2i(x, y, seed ^ 0x77) * 0.2 - 0.1;
          const face = clamp(1 - (Math.sqrt(best) / 7) * 0.16, 0.72, 1.06);
          this.setc(x, y, shade(c, face * (1 + j)));
        }
      }
    }
  }
  /** 十字植物：在透明背景上画一株植物 */
  plant(seed, stemCol, leafCol, opts = {}) {
    const { height = 11, leafW = 2, flowerCol = null, flowerY = 3, flowers = 1, grass = false } = opts;
    this.fill([0, 0, 0], 0);
    if (grass) {
      // 细长草叶：每片 1 像素宽，带弯曲
      for (let i = 0; i < 13; i++) {
        const bx = 2 + ((hash2i(i, 1, seed) * 12) | 0);
        const h = 4 + ((hash2i(i, 2, seed) * 7) | 0);
        const bend = hash2i(i, 3, seed) * 3 - 1;
        for (let y = 0; y < h; y++) {
          const t = y / Math.max(1, h - 1);
          const x = Math.round(bx + bend * t * t * 2.4);
          const c = shade(leafCol, 0.70 + hash2i(i * 7 + y, y, seed) * 0.52);
          this.setc(x, 15 - y, c);
        }
      }
      // 底部补一层，避免镂空
      for (let x = 2; x < 14; x++) {
        if (hash2i(x, 99, seed) < 0.55) this.setc(x, 15, shade(leafCol, 0.62));
      }
      return;
    }
    const baseX = 8;
    for (let y = 0; y < height; y++) {
      const wob = Math.round(Math.sin(y * 0.55 + seed) * 1.1);
      this.setc(baseX + wob, 15 - y, shade(stemCol, 0.86 + hash2i(y, 1, seed) * 0.28));
    }
    // 叶子
    for (let i = 0; i < 6; i++) {
      const y = 3 + ((hash2i(i, 5, seed) * (height - 4)) | 0);
      const side = i % 2 ? 1 : -1;
      const x = baseX + side * (1 + ((hash2i(i, 7, seed) * leafW) | 0));
      this.setc(x, 15 - y, shade(leafCol, 0.8 + hash2i(i, 8, seed) * 0.35));
      this.setc(x, 16 - y, shade(leafCol, 0.7 + hash2i(i, 9, seed) * 0.3));
    }
    // 花
    if (flowerCol) {
      for (let f = 0; f < flowers; f++) {
        const fx = baseX + ((hash2i(f, 21, seed) * 3 - 1) | 0);
        const fy = 15 - (height - 1 - f * 2);
        const petals = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of petals) this.setc(fx + dx, fy + dy, shade(flowerCol, 0.85 + hash2i(f, dx + 4, seed) * 0.3));
        this.setc(fx, fy, [250, 240, 160]);
      }
    }
  }
}

/* ---------- 纹理注册 ---------- */
const TEX_LAYERS = [];
const TEX_INDEX = Object.create(null);
function regTex(name, w, h, fn) {
  const p = new Pixels(w, h);
  fn(p);
  TEX_INDEX[name] = TEX_LAYERS.length;
  TEX_LAYERS.push({ name, px: p });
  return TEX_INDEX[name];
}

/* ---------- 常用色板 ---------- */
const C = {
  grassTop:   hex('#79c05a'), grassTopDark: hex('#5d9c3c'),
  grassCold:  hex('#7fb08a'), grassDry:   hex('#bfb755'),
  dirt:       hex('#866043'), dirtDark:   hex('#6b4a31'),
  stone:      hex('#7d7d7d'), cobble:     hex('#7a7a7a'),
  sand:       hex('#dbd3a0'), sandstone:  hex('#d5cc9f'),
  oakLog:     hex('#6b5233'), oakBark:    hex('#57432a'),
  oakPlank:   hex('#b08d57'), oakLeaf:    hex('#4a7a2e'),
  birchLog:   hex('#d7cfc0'), birchLeaf:  hex('#7aa84b'),
  spruceLog:  hex('#4a3722'), spruceLeaf: hex('#2f5c2a'),
  water:      hex('#3f76e4'), lava:       hex('#d8560f'),
  snow:       hex('#f2fbff'), ice:        hex('#7daaf5'),
  bedrock:    hex('#585858'), gravel:     hex('#8a8583'),
  coal:       hex('#1c1c1c'), iron:       hex('#d8af93'),
  gold:       hex('#fcee4b'), diamond:    hex('#5decf5'),
  redstone:   hex('#e02020'), lapis:      hex('#3a6fd8'),
  emerald:    hex('#3fe08a'),
  obsidian:   hex('#140a20'),

  glow:       hex('#f9d67a'), glass:      hex('#d0f0f8'),
  brickRed:   hex('#9b5a45'), mossy:      hex('#6f8a5c'),
  clay:       hex('#a4a8b8'), tnt:        hex('#c0392b'),
  wool: {
    white: hex('#e9ecec'), red: hex('#b02e26'), orange: hex('#f9801d'), yellow: hex('#fed83d'),
    lime: hex('#80c71f'), green: hex('#5e7c16'), cyan: hex('#169c9c'), blue: hex('#3c44aa'),
    purple: hex('#8932b8'), magenta: hex('#c74ebd'), pink: hex('#f38baa'), gray: hex('#474f52'),
    black: hex('#1d1d21'), brown: hex('#835432'),
  },
};

/* =====================================================================
   生成全部纹理
   ===================================================================== */
function buildTextures() {

  /* ---- 泥土 / 草 ---- */
  regTex('dirt', 16, 16, p => {
    p.noiseFill(C.dirt, 20, 11);
    p.speckle(20, [C.dirtDark, shade(C.dirt, 1.22)], 12, 1, 2);
    p.speckle(6, shade(C.dirtDark, 0.82), 13, 1, 3);
  });

  const mkGrassTop = (base, name) => regTex(name, 16, 16, p => {
    p.noiseFill(base, 17, 21);
    // MC 草顶的细微 2x2 规律噪点
    for (let y = 0; y < 16; y += 2) for (let x = 0; x < 16; x += 2) {
      const t = 0.9 + hash2i(x >> 1, y >> 1, 21) * 0.24;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const c = p.get(x + dx, y + dy);
        p.setc(x + dx, y + dy, [c[0] * t, c[1] * t, c[2] * t]);
      }
    }
    p.speckle(14, [shade(base, 0.82), shade(base, 1.16)], 22, 1, 1);
  });
  mkGrassTop(C.grassTop, 'grass_top');
  mkGrassTop(C.grassCold, 'grass_top_cold');
  mkGrassTop(C.grassDry, 'grass_top_dry');

  const mkGrassSide = (base, name) => regTex(name, 16, 16, p => {
    p.noiseFill(C.dirt, 20, 11);
    p.speckle(18, [C.dirtDark, shade(C.dirt, 1.2)], 12, 1, 2);
    // 顶部草沿：高度不规则
    for (let x = 0; x < 16; x++) {
      const h = 3 + ((hash2i(x, 5, 31) * 3) | 0);
      for (let y = 0; y < h; y++) {
        const c = shade(base, 0.88 + hash2i(x, y, 32) * 0.3);
        p.setc(x, y, y === h - 1 ? shade(base, 0.72) : c);
      }
    }
    // 草沿下的几处垂坠
    for (let i = 0; i < 5; i++) {
      const x = (hash2i(i, 41, 33) * 16) | 0;
      const y0 = 3 + ((hash2i(i, 42, 33) * 3) | 0);
      p.setc(x, y0, shade(base, 0.75));
    }
  });
  mkGrassSide(C.grassTop, 'grass_side');
  mkGrassSide(C.grassCold, 'grass_side_cold');
  mkGrassSide(C.grassDry, 'grass_side_dry');

  regTex('grass_side_snow', 16, 16, p => {
    p.noiseFill(C.dirt, 20, 11);
    p.speckle(18, [C.dirtDark, shade(C.dirt, 1.2)], 12, 1, 2);
    for (let x = 0; x < 16; x++) {
      const h = 4 + ((hash2i(x, 5, 44) * 3) | 0);
      for (let y = 0; y < h; y++) p.setc(x, y, shade(C.snow, 0.94 + hash2i(x, y, 45) * 0.1));
    }
  });

  /* ---- 石头家族 ---- */
  regTex('stone', 16, 16, p => {
    p.noiseFill(C.stone, 15, 51);
    p.speckle(26, [shade(C.stone, 0.86), shade(C.stone, 1.12)], 52, 1, 3);
    p.speckle(8, shade(C.stone, 0.78), 53, 1, 4);
  });
  regTex('cobblestone', 16, 16, p => {
    p.cobble(61, [shade(C.cobble, 1.0), shade(C.cobble, 0.86), shade(C.cobble, 1.12), shade(C.cobble, 0.94)], 8);
  });
  regTex('mossy_cobblestone', 16, 16, p => {
    p.cobble(61, [shade(C.cobble, 1.0), shade(C.cobble, 0.86), shade(C.cobble, 1.12)], 8);
    p.speckle(30, [C.mossy, shade(C.mossy, 0.78), shade(C.mossy, 1.18)], 71, 1, 3);
  });
  regTex('stone_bricks', 16, 16, p => p.bricks(81, C.stone, 8, 4, 0.62));
  regTex('bricks', 16, 16, p => p.bricks(82, C.brickRed, 8, 4, 0.7));
  regTex('bedrock', 16, 16, p => {
    p.noiseFill(C.bedrock, 26, 91);
    for (let i = 0; i < 14; i++) {
      const x = (hash2i(i, 1, 92) * 16) | 0, y = (hash2i(i, 2, 92) * 16) | 0;
      const s = 3 + ((hash2i(i, 3, 92) * 4) | 0);
      const c = shade(C.bedrock, 0.45 + hash2i(i, 4, 92) * 0.9);
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) p.setc(x + dx, y + dy, c);
    }
  });
  regTex('obsidian', 16, 16, p => {
    p.noiseFill(C.obsidian, 9, 101);
    p.speckle(22, [hex('#3b2a5e'), hex('#241a3a'), hex('#4a3a72')], 102, 1, 2);
  });
  regTex('gravel', 16, 16, p => {
    p.noiseFill(C.gravel, 22, 111);
    p.speckle(40, [shade(C.gravel, 0.62), shade(C.gravel, 1.24), shade(C.gravel, 0.86), hex('#6d6763')], 112, 1, 3);
  });
  regTex('clay', 16, 16, p => {
    p.noiseFill(C.clay, 12, 121);
    p.speckle(16, [shade(C.clay, 0.86), shade(C.clay, 1.12)], 122, 1, 2);
  });

  /* ---- 沙 / 沙岩 ---- */
  regTex('sand', 16, 16, p => {
    p.noiseFill(C.sand, 13, 131);
    p.speckle(24, [shade(C.sand, 0.9), shade(C.sand, 1.1)], 132, 1, 2);
  });
  regTex('sandstone_top', 16, 16, p => {
    p.noiseFill(C.sand, 10, 141);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (hash2i(x, y, 142) > 0.86) p.setc(x, y, shade(C.sand, 0.88));
    }
  });
  regTex('sandstone_side', 16, 16, p => {
    p.noiseFill(C.sand, 10, 151);
    for (let y = 0; y < 16; y++) {
      const t = (y === 0 || y === 15) ? 0.82 : (y < 4 ? 1.06 : 0.96);
      for (let x = 0; x < 16; x++) {
        const c = p.get(x, y);
        const j = hash2i(x, y, 152) * 0.08 - 0.04;
        p.setc(x, y, shade(c, t * (1 + j)));
      }
    }
    for (let y = 4; y < 15; y += 5) for (let x = 0; x < 16; x++) p.setc(x, y, shade(C.sand, 0.86));
  });

  /* ---- 雪 / 冰 ---- */
  regTex('snow', 16, 16, p => {
    p.noiseFill(C.snow, 7, 161);
    p.speckle(10, shade(C.snow, 0.95), 162, 1, 2);
  });
  regTex('ice', 16, 16, p => {
    p.noiseFill(C.ice, 14, 171);
    p.speckle(14, [shade(C.ice, 1.18), shade(C.ice, 0.86)], 172, 1, 3);
    for (let i = 0; i < 4; i++) {
      const x0 = (hash2i(i, 1, 173) * 16) | 0, y0 = (hash2i(i, 2, 173) * 16) | 0;
      for (let k = 0; k < 8; k++) p.setc((x0 + k) % 16, (y0 + ((k / 2) | 0)) % 16, shade(C.ice, 1.2));
    }
  });
  regTex('packed_ice', 16, 16, p => {
    p.noiseFill(shade(C.ice, 0.92), 12, 181);
    p.speckle(20, [shade(C.ice, 1.1), shade(C.ice, 0.8)], 182, 1, 3);
  });

  /* ---- 木头 ---- */
  const mkLogSide = (name, bark, seedn) => regTex(name, 16, 16, p => {
    p.vstripes(seedn, [bark, shade(bark, 0.84), shade(bark, 1.14), shade(bark, 0.94)], 1);
    for (let i = 0; i < 5; i++) {
      const x = (hash2i(i, 3, seedn) * 16) | 0;
      const y0 = (hash2i(i, 4, seedn) * 16) | 0;
      for (let k = 0; k < 6; k++) p.setc(x, (y0 + k) % 16, shade(bark, 0.72));
    }
  });
  mkLogSide('oak_log_side', C.oakBark, 191);
  mkLogSide('birch_log_side', C.birchLog, 195);
  mkLogSide('spruce_log_side', C.spruceLog, 199);

  const mkLogTop = (name, inner, bark, seedn) => regTex(name, 16, 16, p => {
    p.noiseFill(inner, 12, seedn);
    // 年轮
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.sin(d * 2.1) * 0.5 + 0.5;
      const c = p.get(x, y);
      p.setc(x, y, shade(c, 0.88 + ring * 0.26));
    }
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x < 1 || y < 1 || x > 14 || y > 14) {
        const c = shade(bark, 0.92 + hash2i(x, y, seedn ^ 7) * 0.24);
        p.setc(x, y, c);
      }
    }
  });
  mkLogTop('oak_log_top', hex('#b08d57'), C.oakBark, 192);
  mkLogTop('birch_log_top', hex('#c8b98a'), C.birchLog, 196);
  mkLogTop('spruce_log_top', hex('#8a6b45'), C.spruceLog, 200);

  regTex('oak_planks', 16, 16, p => p.planks(201, C.oakPlank, 4));
  regTex('birch_planks', 16, 16, p => p.planks(202, hex('#c8b48a'), 4));
  regTex('spruce_planks', 16, 16, p => p.planks(203, hex('#7b5a34'), 4));

  const mkLeaves = (name, col, seedn, dens) => regTex(name, 16, 16, p => {
    p.fill([0, 0, 0], 0);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const h = hash2i(x, y, seedn);
      if (h < dens) continue;                       // 空洞
      const t = 0.68 + hash2i(x + 5, y + 9, seedn) * 0.6;
      p.setc(x, y, shade(col, t), 255);
    }
    // 让叶子边缘稍微透一点，看起来更蓬松（先收集再应用，避免顺序依赖）
    const drop = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (p.get(x, y)[3] === 0) continue;
      let open = 0;
      if (p.get((x + 1) % 16, y)[3] === 0) open++;
      if (p.get((x + 15) % 16, y)[3] === 0) open++;
      if (p.get(x, (y + 1) % 16)[3] === 0) open++;
      if (p.get(x, (y + 15) % 16)[3] === 0) open++;
      if (open >= 3 && hash2i(x, y, seedn ^ 3) > 0.72) drop.push([x, y]);
    }
    for (const [x, y] of drop) p.set(x, y, 0, 0, 0, 0);
  });
  mkLeaves('oak_leaves', C.oakLeaf, 211, 0.05);
  mkLeaves('oak_leaves_cold', hex('#3d6b45'), 212, 0.05);
  mkLeaves('oak_leaves_dry', hex('#7c8a35'), 213, 0.05);
  mkLeaves('birch_leaves', C.birchLeaf, 214, 0.06);
  mkLeaves('spruce_leaves', C.spruceLeaf, 215, 0.07);

  /* ---- 液体 ---- */
  regTex('water', 16, 16, p => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const w = Math.sin(x * 0.9 + y * 0.4) * 0.5 + Math.sin(x * 0.35 - y * 1.1) * 0.5;
      const t = 0.9 + w * 0.12 + (hash2i(x, y, 221) * 0.1 - 0.05);
      const c = shade(C.water, t);
      p.set(x, y, c[0], c[1], c[2], 176);
    }
  });
  regTex('lava', 16, 16, p => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = Math.sin(x * 0.7 + y * 0.7) * 0.5 + Math.sin(x * 1.3 - y * 0.5) * 0.5;
      const h = hash2i(x, y, 231);
      const t = 0.78 + n * 0.28 + h * 0.24;
      const c = shade(C.lava, t);
      p.set(x, y, clamp(c[0] * 1.15, 0, 255), clamp(c[1] * 1.05, 0, 255), clamp(c[2] * 0.9, 0, 255));
    }
    p.speckle(16, [hex('#ffd15c'), hex('#ffb43b')], 232, 1, 2);
    p.speckle(12, [hex('#8a2b06'), hex('#6b1f04')], 233, 1, 3);
  });

  /* ---- 矿石 ---- */
  const oreTex = (name, col, seedn, cnt = 6) => regTex(name, 16, 16, p => {
    p.noiseFill(C.stone, 15, 51);
    p.speckle(26, [shade(C.stone, 0.86), shade(C.stone, 1.12)], 52, 1, 3);
    for (let i = 0; i < cnt; i++) {
      const x = 2 + ((hash2i(i, 1, seedn) * 12) | 0);
      const y = 2 + ((hash2i(i, 2, seedn) * 12) | 0);
      const r = 1.1 + hash2i(i, 3, seedn) * 1.2;
      const tones = [col, shade(col, 0.72), shade(col, 1.24)];
      for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
        const d = Math.sqrt(xx * xx + yy * yy);
        if (d > r) continue;
        const px = (x + xx + 16) % 16, py = (y + yy + 16) % 16;
        const t = hash2i(px, py, seedn ^ 9);
        p.setc(px, py, d > r - 0.9 ? shade(col, 0.6) : tones[(t * 3) | 0]);
      }
    }
  });
  oreTex('coal_ore', C.coal, 241, 7);
  oreTex('iron_ore', hex('#d8af93'), 242, 6);
  oreTex('gold_ore', C.gold, 243, 6);
  oreTex('diamond_ore', hex('#5decf5'), 244, 5);
  oreTex('redstone_ore', hex('#e02020'), 245, 7);
  oreTex('lapis_ore', hex('#3a6fd8'), 246, 6);
  oreTex('emerald_ore', hex('#3fe08a'), 247, 5);

  /* ---- 玻璃 / 发光 ---- */
  regTex('glass', 16, 16, p => {
    p.fill([0, 0, 0], 0);
    const fr = [200, 232, 240];
    for (let x = 0; x < 16; x++) { p.setc(x, 0, fr, 210); p.setc(x, 15, fr, 210); }
    for (let y = 0; y < 16; y++) { p.setc(0, y, fr, 210); p.setc(15, y, fr, 210); }
    p.setc(1, 1, fr, 130); p.setc(14, 1, fr, 130); p.setc(1, 14, fr, 130); p.setc(14, 14, fr, 130);
    // 高光斜线
    for (let k = 3; k < 9; k++) { p.setc(k, 12 - k, [235, 250, 255], 90); p.setc(k + 1, 12 - k, [235, 250, 255], 55); }
    for (let k = 9; k < 13; k++) p.setc(k, 22 - k, [235, 250, 255], 60);
  });
  regTex('glowstone', 16, 16, p => {
    p.noiseFill(hex('#8f6b3f'), 18, 251);
    for (let i = 0; i < 12; i++) {
      const x = (hash2i(i, 1, 252) * 16) | 0, y = (hash2i(i, 2, 252) * 16) | 0;
      const r = 1.4 + hash2i(i, 3, 252) * 1.6;
      for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
        if (Math.sqrt(xx * xx + yy * yy) > r) continue;
        const t = hash2i(x + xx, y + yy, 253);
        p.setc((x + xx + 16) % 16, (y + yy + 16) % 16, t > 0.6 ? hex('#fff0b8') : C.glow);
      }
    }
  });
  regTex('sea_lantern', 16, 16, p => {
    p.noiseFill(hex('#cfe6df'), 14, 261);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const m = ((x + y) % 4 < 2) ? 1.1 : 0.9;
      const c = p.get(x, y); p.setc(x, y, shade(c, m));
    }
    p.speckle(20, [hex('#ffffff'), hex('#a8e8dd')], 262, 1, 2);
  });

  /* ---- 植物（十字模型） ---- */
  regTex('tall_grass', 16, 16, p => p.plant(301, null, C.grassTop, { grass: true }));
  regTex('tall_grass_dry', 16, 16, p => p.plant(302, null, C.grassDry, { grass: true }));
  regTex('fern', 16, 16, p => p.plant(303, null, hex('#5d8a3a'), { grass: true }));
  regTex('dead_bush', 16, 16, p => {
    p.fill([0, 0, 0], 0);
    const col = hex('#6b5334');
    for (let i = 0; i < 9; i++) {
      const x = 3 + ((hash2i(i, 1, 311) * 10) | 0);
      const h = 5 + ((hash2i(i, 2, 311) * 9) | 0);
      const lean = hash2i(i, 3, 311) * 2 - 1;
      for (let y = 0; y < h; y++) {
        p.setc(x + Math.round(lean * y * 0.25), 15 - y, shade(col, 0.8 + hash2i(i, y, 311) * 0.5));
      }
    }
  });
  regTex('dandelion', 16, 16, p => p.plant(321, hex('#4f7f27'), hex('#5f9c33'),
    { height: 10, flowerCol: hex('#ffe93c'), flowers: 2, flowerY: 4 }));
  regTex('poppy', 16, 16, p => p.plant(322, hex('#4f7f27'), hex('#5f9c33'),
    { height: 10, flowerCol: hex('#e04b2e'), flowers: 2, flowerY: 4 }));
  regTex('blue_orchid', 16, 16, p => p.plant(323, hex('#4f7f27'), hex('#5f9c33'),
    { height: 9, flowerCol: hex('#3fb3e0'), flowers: 2 }));
  regTex('sapling', 16, 16, p => p.plant(331, hex('#6b5233'), hex('#4a7a2e'), { height: 7 }));
  regTex('sapling_spruce', 16, 16, p => p.plant(332, hex('#5a4325'), hex('#2f5c2a'), { height: 7 }));

  regTex('cactus_side', 16, 16, p => {
    p.noiseFill(hex('#0f6b1f'), 10, 341);
    for (let y = 0; y < 16; y++) {
      p.setc(0, y, shade(hex('#0f6b1f'), 0.78));
      p.setc(15, y, shade(hex('#0f6b1f'), 0.78));
    }
    for (let y = 2; y < 16; y += 4) for (let x = 2; x < 15; x += 4) p.setc(x, y, hex('#cfe0a0'));
  });
  regTex('cactus_top', 16, 16, p => {
    p.noiseFill(hex('#1a7a2a'), 10, 342);
    p.rect(1, 1, 14, 14, hex('#0d5a1a'));
    p.rect(2, 2, 12, 12, hex('#1d8a30'));
    p.speckle(10, hex('#cfe0a0'), 343, 1, 2);
  });

  regTex('torch', 16, 16, p => {
    p.fill([0, 0, 0], 0);
    p.rect(7, 8, 2, 8, hex('#8b6a44'));
    p.rect(7, 8, 1, 8, hex('#6e5233'));
    p.setc(7, 7, hex('#ffdd55')); p.setc(8, 7, hex('#ffcc33'));
    p.rect(6, 5, 4, 2, hex('#ffe066'));
    p.setc(7, 4, hex('#fff3b0')); p.setc(8, 4, hex('#ffe98a'));
    p.setc(5, 6, hex('#ffcf40')); p.setc(10, 6, hex('#ffcf40'));
  });
  regTex('ladder', 16, 16, p => {
    p.fill([0, 0, 0], 0);
    const w = hex('#9c7f4e');
    p.rect(2, 0, 2, 16, w); p.rect(12, 0, 2, 16, w);
    for (let y = 2; y < 16; y += 4) p.rect(2, y, 12, 2, shade(w, 1.1));
  });

  /* ---- 功能方块 ---- */
  regTex('crafting_table_top', 16, 16, p => {
    p.planks(351, C.oakPlank, 4);
    p.rect(1, 1, 14, 14, hex('#6b4a31'));
    p.rect(2, 2, 12, 12, hex('#9c7f4e'));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      p.rect(2 + i * 4, 2 + j * 4, 4, 4, i === 1 && j === 1 ? hex('#7a5c39') : hex('#8a6c45'));
    }
  });
  regTex('crafting_table_side', 16, 16, p => {
    p.planks(352, C.oakPlank, 4);
    p.rect(0, 0, 16, 3, hex('#7a5c39'));
    p.rect(1, 9, 5, 5, hex('#6b4a31'));
    p.rect(10, 9, 5, 5, hex('#6b4a31'));
  });
  regTex('crafting_table_front', 16, 16, p => {
    p.planks(352, C.oakPlank, 4);
    p.rect(1, 1, 14, 6, hex('#6b4a31'));
    p.rect(2, 2, 12, 4, hex('#8a6c45'));
    for (let x = 2; x < 14; x += 3) p.setc(x, 4, hex('#5c4128'));
  });
  regTex('bookshelf', 16, 16, p => {
    p.planks(361, C.oakPlank, 4);
    const cols = [hex('#8a3a2a'), hex('#2a5a8a'), hex('#c0a030'), hex('#2a7a3a'), hex('#6a2a7a'), hex('#c05a2a')];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (y < 4 || y > 11) { const c = p.get(x, y); p.setc(x, y, shade(c, 0.82)); continue; }
      const bi = ((x * 7 + y * 3) % cols.length) | 0;
      const t = hash2i(x, y, 362) * 0.3 + 0.85;
      p.setc(x, y, shade(cols[bi], t));
      if (x % 3 === 2) p.setc(x, y, shade(cols[bi], 0.6));
    }
  });
  regTex('furnace_side', 16, 16, p => { p.noiseFill(C.stone, 15, 371); p.speckle(18, [shade(C.stone, 0.86), shade(C.stone, 1.12)], 372, 1, 3); });
  regTex('furnace_top', 16, 16, p => {
    p.noiseFill(C.stone, 15, 371);
    p.rect(1, 1, 14, 14, shade(C.stone, 0.82));
    p.rect(2, 2, 12, 12, shade(C.stone, 1.02));
    p.speckle(10, shade(C.stone, 0.86), 373, 1, 2);
  });
  regTex('furnace_front', 16, 16, p => {
    p.noiseFill(C.stone, 15, 371);
    p.speckle(16, [shade(C.stone, 0.86), shade(C.stone, 1.12)], 372, 1, 2);
    p.rect(3, 4, 10, 9, hex('#2a2a2a'));
    p.rect(4, 5, 8, 7, hex('#111111'));
    for (let x = 4; x < 12; x++) p.setc(x, 11, hex('#4a4a4a'));
  });
  regTex('furnace_front_on', 16, 16, p => {
    p.noiseFill(C.stone, 15, 371);
    p.speckle(16, [shade(C.stone, 0.86), shade(C.stone, 1.12)], 372, 1, 2);
    p.rect(3, 4, 10, 9, hex('#2a2a2a'));
    p.rect(4, 5, 8, 7, hex('#3a1a06'));
    for (let x = 4; x < 12; x++) for (let y = 9; y < 12; y++) {
      const t = hash2i(x, y, 374);
      p.setc(x, y, t > 0.5 ? hex('#ff9b2f') : hex('#ffd05a'));
    }
  });
  regTex('tnt_side', 16, 16, p => {
    p.noiseFill(hex('#c0392b'), 12, 381);
    p.rect(0, 5, 16, 6, hex('#e8e8e8'));
    p.rect(0, 5, 16, 1, hex('#c8c8c8'));
    p.rect(0, 10, 16, 1, hex('#c8c8c8'));
    // 简单像素字母 "TNT"
    const glyph = [
      [1,1,1,0,1,0,1,0,1,1,1],
      [0,1,0,0,1,1,0,0,0,1,0],
      [0,1,0,0,1,0,1,0,0,1,0],
      [0,1,0,0,1,0,1,0,0,1,0],
      [0,1,0,0,1,0,1,0,0,1,0],
    ];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 11; x++)
      if (glyph[y][x]) p.setc(3 + x, 6 + y, hex('#8f2220'));
  });
  regTex('tnt_top', 16, 16, p => {
    p.noiseFill(hex('#c0392b'), 12, 382);
    p.rect(4, 4, 8, 8, hex('#8f2220'));
    p.rect(5, 5, 6, 6, hex('#c0392b'));
    p.rect(7, 0, 2, 16, hex('#d8d8d8'));
    p.rect(0, 7, 16, 2, hex('#d8d8d8'));
  });
  regTex('tnt_bottom', 16, 16, p => p.noiseFill(hex('#a83226'), 12, 383));
  regTex('pumpkin_side', 16, 16, p => {
    p.noiseFill(hex('#c07615'), 14, 391);
    for (let x = 1; x < 16; x += 3) for (let y = 0; y < 16; y++) p.setc(x, y, hex('#a35f10'));
  });
  regTex('pumpkin_top', 16, 16, p => {
    p.noiseFill(hex('#b06a12'), 12, 392);
    p.rect(5, 5, 6, 6, hex('#8a5a10'));
    p.rect(6, 6, 4, 4, hex('#a06a18'));
    p.rect(7, 7, 2, 2, hex('#6b4a10'));
  });
  regTex('pumpkin_face', 16, 16, p => {
    p.noiseFill(hex('#c07615'), 14, 391);
    for (let x = 1; x < 16; x += 3) for (let y = 0; y < 16; y++) p.setc(x, y, hex('#a35f10'));
    const dark = hex('#3a2606');
    p.rect(2, 3, 4, 3, dark); p.rect(10, 3, 4, 3, dark);
    p.setc(2, 6, dark); p.setc(13, 6, dark);
    p.rect(4, 8, 8, 1, dark);
    p.setc(5, 9, dark); p.setc(10, 9, dark);
    p.rect(6, 10, 4, 2, dark);
    p.setc(4, 10, dark); p.setc(11, 10, dark);
  });
  regTex('melon_side', 16, 16, p => {
    p.noiseFill(hex('#6b9c2a'), 14, 401);
    for (let x = 0; x < 16; x += 4) for (let y = 0; y < 16; y++) p.setc(x, y, hex('#3f6b12'));
  });
  regTex('melon_top', 16, 16, p => {
    p.noiseFill(hex('#4a7a18'), 12, 402);
    p.speckle(18, [hex('#6b9c2a'), hex('#3f6b12')], 403, 1, 2);
  });

  /* ---- 羊毛 ---- */
  for (const k in C.wool) regTex('wool_' + k, 16, 16, p => {
    p.noiseFill(C.wool[k], 13, 411 + k.length);
    p.speckle(24, [shade(C.wool[k], 0.86), shade(C.wool[k], 1.14)], 421, 1, 2);
  });

  /* ---- 破坏裂纹 0..9 ---- */
  const crackSeedBase = 5000;
  const crackSegs = [];
  (function genCracks() {
    // 用递归分裂生成裂纹骨架
    const rnd = mulberry32(9182736);
    const queue = [[8, 8, 14, 35, 0]];
    const all = [];
    for (let stage = 0; stage < 10; stage++) {
      const lines = [];
      const target = 2 + stage * 2.4;
      while (all.length < target) {
        const [x, y, len, ang, depth] = queue.splice((rnd() * queue.length) | 0, 1)[0] || [8, 8, 12, rnd() * TAU, 0];
        const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
        all.push([x, y, ex, ey, depth]);
        if (depth < 3) {
          const mx = (x + ex) / 2, my = (y + ey) / 2;
          queue.push([mx, my, len * 0.6, ang + (rnd() - 0.5) * 1.9, depth + 1]);
          queue.push([mx, my, len * 0.55, ang + (rnd() - 0.5) * 1.9, depth + 1]);
        }
        if (queue.length === 0) queue.push([rnd() * 16, rnd() * 16, 10, rnd() * TAU, 0]);
      }
      crackSegs.push(all.slice());
    }
  })();
  for (let s = 0; s < 10; s++) {
    regTex('destroy_' + s, 16, 16, p => {
      p.fill([0, 0, 0], 0);
      const segs = crackSegs[s];
      for (const [x0, y0, x1, y1, d] of segs) {
        const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 0 : i / steps;
          const x = Math.round(x0 + (x1 - x0) * t);
          const y = Math.round(y0 + (y1 - y0) * t);
          const w = d <= 1 ? 2 : 1;
          p.setc(x, y, [40, 40, 40], 200);
          if (w === 2) p.setc(x + 1, y, [30, 30, 30], 130);
        }
      }
    });
  }

  /* ---- 天空元素（16x16，放大后呈现 Minecraft 特有的像素化日轮） ---- */
  regTex('sun', 16, 16, p => {
    p.fill([0, 0, 0], 0);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2);
      if (d <= 6.1) p.setc(x, y, d > 5.2 ? [252, 240, 178] : [255, 255, 238], 255);
    }
  });
  regTex('moon', 16, 16, p => {
    p.fill([0, 0, 0], 0);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2);
      if (d <= 6.1) {
        const cr = hash2i(x, y, 9001);
        const cr2 = hash2i(x + 3, y + 7, 9002);
        let c = [228, 232, 242];
        if (cr > 0.86) c = [198, 204, 216];
        if (cr2 > 0.93) c = [174, 182, 196];
        if (d > 5.2) c = shade(c, 0.82);
        p.setc(x, y, c, 255);
      }
    }
  });

  /* ---- 粒子（通用白色方块，配色在 shader 里做） ---- */
  regTex('particle', 16, 16, p => p.fill([255, 255, 255], 255));
}

/* ---------- 云层（独立的 2D 平铺纹理，128x128） ---------- */
function buildCloudTexture() {
  const S = 128;
  const P = 8;                       // 8x8 个可平铺噪声单元
  const p = new Pixels(S, S);
  const wrap = (v, m) => ((v % m) + m) % m;
  const gv = (X, Y, seed) => hash2i(wrap(X, P), wrap(Y, P), seed);
  const vnoise = (x, y, seed) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = smoothstep(x - x0), ty = smoothstep(y - y0);
    return lerp(lerp(gv(x0, y0, seed), gv(x0 + 1, y0, seed), tx),
                lerp(gv(x0, y0 + 1, seed), gv(x0 + 1, y0 + 1, seed), tx), ty);
  };
  const fbm = (x, y) => {
    let v = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < 4; o++) { v += amp * vnoise(x * f, y * f, 8100 + o * 137); norm += amp; amp *= 0.5; f *= 2; }
    return v / norm;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = fbm(x / S * P, y / S * P);
      const on = v > 0.585;
      p.set(x, y, 255, 255, 255, on ? 255 : 0);
    }
  }
  return p;
}

/* ---------- 打包为 TEXTURE_2D_ARRAY ---------- */
function packTextureArray(textures) {
  const S = 16;
  const layers = textures.length;
  const out = new Uint8Array(S * S * 4 * layers);
  for (let li = 0; li < layers; li++) {
    const p = textures[li].px;
    if (p.w !== S || p.h !== S) throw new Error('纹理 ' + textures[li].name + ' 尺寸非 16x16');
    out.set(p.d, li * S * S * 4);
  }
  return { data: out, S, layers };
}
