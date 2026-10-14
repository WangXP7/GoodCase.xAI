/* =====================================================================
   6. 区块与世界
   ---------------------------------------------------------------------
   区块 = 16 x 128 x 16 = 32768 个方块
   每区块四张字节数组：方块 ID / 元数据 / 天光 / 方块光
   ===================================================================== */

// 区块状态
const CS_EMPTY = 0, CS_TERRAIN = 1, CS_LIT = 2, CS_READY = 3;

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = new Uint8Array(CH_VOL);   // 方块 ID
    this.meta = new Uint8Array(CH_VOL);     // 低 3 位 = 流体等级 / 朝向
    this.sky = new Uint8Array(CH_VOL);      // 天光 0..15
    this.blk = new Uint8Array(CH_VOL);      // 方块光 0..15
    this.biome = new Uint8Array(CH_AREA);   // 每列生物群系
    this.hm = new Uint8Array(CH_AREA);      // 每列最高非空气方块 y+1
    this.state = CS_EMPTY;
    this.dirtyLight = true;                 // 需要扩散光照
    this.dirtyMesh = true;                  // 需要重建网格
    this.mesh = null;                       // GL 网格句柄
    this.meshWater = null;
    this.sortKey = 0;                       // 到相机距离（渲染排序）
    this.empty = false;                     // 整块全空，跳过渲染
  }
  get(x, y, z) { return this.blocks[IDX(x, y, z)]; }
  set(x, y, z, id) { this.blocks[IDX(x, y, z)] = id; }
  getMeta(x, y, z) { return this.meta[IDX(x, y, z)]; }
  setMeta(x, y, z, m) { this.meta[IDX(x, y, z)] = m; }

  /** 重算高度图（每列自顶向下第一个非空气方块） */
  recomputeHeightMap() {
    for (let z = 0; z < CH_Z; z++) {
      for (let x = 0; x < CH_X; x++) {
        let h = 0;
        for (let y = CH_Y - 1; y >= 0; y--) {
          const b = this.blocks[IDX(x, y, z)];
          if (b !== 0 && BLOCKS[b].lightOpacity >= 15) { h = y + 1; break; }
        }
        this.hm[z * CH_X + x] = h;
      }
    }
  }

  freeGL(gl) {
    if (this.mesh) { gl.deleteBuffer(this.mesh.vbo); gl.deleteVertexArray(this.mesh.vao); this.mesh = null; }
    if (this.meshWater) { gl.deleteBuffer(this.meshWater.vbo); gl.deleteVertexArray(this.meshWater.vao); this.meshWater = null; }
  }
}

/* =====================================================================
   世界
   ===================================================================== */
class World {
  constructor(seed, opts = {}) {
    this.seed = seed >>> 0;
    this.chunks = new Map();
    this.noise = makeNoise(this.seed);
    this.noiseB = makeNoise((this.seed ^ 0x9e3779b9) >>> 0);
    this.noiseC = makeNoise((this.seed + 0x51ed270b) >>> 0);
    this.opts = opts;
    this.time = 0.16;             // 0..1 一天（0.16 ≈ 早上 9:50）
    this.tickCount = 0;
    this.loadQueue = [];
    this.lightQueue = [];         // 光照扩散队列 [x,y,z,level,type]
    this.lightRemoveQueue = [];
    this.fluidTicks = new Map();  // 流体调度
    this.renderDistance = 8;
    this.spawnX = 0; this.spawnZ = 0; this.spawnY = 80;
    this.genCalls = 0;
  }

  key(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }
  getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }
  hasChunk(cx, cz) { return this.chunks.has(this.key(cx, cz)); }

  /* ---------- 基础读写（世界坐标） ---------- */
  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= CH_Y) return 0;
    const c = this.chunks.get(this.key(wx >> 4, wz >> 4));
    if (!c) return -1; // 未加载
    return c.blocks[IDX(wx & 15, wy, wz & 15)];
  }
  getBlockOrAir(wx, wy, wz) {
    const b = this.getBlock(wx, wy, wz);
    return b < 0 ? 0 : b;
  }
  isSolid(wx, wy, wz) {
    const b = this.getBlockOrAir(wx, wy, wz);
    return b !== 0 && BLOCKS[b].solid;
  }
  getBiome(wx, wz) {
    const c = this.chunks.get(this.key(wx >> 4, wz >> 4));
    if (!c) return 0;
    return c.biome[(wz & 15) * CH_X + (wx & 15)];
  }
  getHeight(wx, wz) {
    const c = this.chunks.get(this.key(wx >> 4, wz >> 4));
    if (!c) return SEA_LEVEL;
    return c.hm[(wz & 15) * CH_X + (wx & 15)];
  }

  /** 生成一个区块（地形阶段，不含光照） */
  createChunk(cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (c) return c;
    c = new Chunk(cx, cz);
    this.chunks.set(k, c);
    generateTerrain(this, c, cx, cz);
    c.recomputeHeightMap();
    c.state = CS_TERRAIN;
    this.genCalls++;
    return c;
  }

  unloadChunk(cx, cz, gl) {
    const k = this.key(cx, cz);
    const c = this.chunks.get(k);
    if (!c) return;
    if (gl) c.freeGL(gl);
    this.chunks.delete(k);
  }

  /* ---------- 修改方块（含光照与网格刷新） ---------- */
  setBlock(wx, wy, wz, id, meta = 0) {
    if (wy < 0 || wy >= CH_Y) return false;
    const cx = wx >> 4, cz = wz >> 4;
    const c = this.chunks.get(this.key(cx, cz));
    if (!c) return false;
    const li = IDX(wx & 15, wy, wz & 15);
    const old = c.blocks[li];
    if (old === id && c.meta[li] === meta) return false;
    c.blocks[li] = id;
    c.meta[li] = meta;

    // 更新高度图该列
    const hi = (wz & 15) * CH_X + (wx & 15);
    const op = id !== 0 && BLOCKS[id].lightOpacity >= 15;
    if (op) { if (wy + 1 > c.hm[hi]) c.hm[hi] = wy + 1; }
    else if (c.hm[hi] === wy + 1) {
      let h = 0;
      for (let y = CH_Y - 1; y >= 0; y--) {
        const b = c.blocks[IDX(wx & 15, y, wz & 15)];
        if (b !== 0 && BLOCKS[b].lightOpacity >= 15) { h = y + 1; break; }
      }
      c.hm[hi] = h;
    }

    this.updateLightAt(wx, wy, wz, old, id);
    this.markMeshDirty(wx, wy, wz, id, old);
    return true;
  }

  /** 方块变化后刷新涉及区块的网格 */
  markMeshDirty(wx, wy, wz) {
    const cx = wx >> 4, cz = wz >> 4;
    const lx = wx & 15, lz = wz & 15;
    const mark = (dx, dz) => { const c = this.getChunk(cx + dx, cz + dz); if (c) c.dirtyMesh = true; };
    mark(0, 0);
    if (lx === 0) mark(-1, 0);
    if (lx === 15) mark(1, 0);
    if (lz === 0) mark(0, -1);
    if (lz === 15) mark(0, 1);
    // 光照变化会外溢到更大范围，保守地把 3x3 全部标脏
    if (BLOCKS[this.getBlockOrAir(wx, wy, wz)] && (BLOCKS[this.getBlockOrAir(wx, wy, wz)].light > 0 || true)) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) mark(dx, dz);
    }
  }
}

/* =====================================================================
   区块邻域访问器（网格构建 / 光照的高频读写）
   ===================================================================== */
class View3x3 {
  constructor(world, ccx, ccz) {
    this.w = world;
    this.ccx = ccx; this.ccz = ccz;
    this.c = new Array(9);
    this.ok = true;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ch = world.getChunk(ccx + dx, ccz + dz);
      this.c[(dz + 1) * 3 + (dx + 1)] = ch;
      if (!ch) this.ok = false;
    }
  }
  _chunk(lx, lz) {
    return this.c[((lz >> 4) + 1) * 3 + ((lx >> 4) + 1)];
  }
  block(lx, y, lz) {          // lx/lz 允许 -1..16
    if (y < 0 || y >= CH_Y) return 0;
    const ch = this._chunk(lx, lz);
    if (!ch) return 0;
    return ch.blocks[IDX(lx & 15, y, lz & 15)];
  }
  meta(lx, y, lz) {
    const ch = this._chunk(lx, lz);
    if (!ch || y < 0 || y >= CH_Y) return 0;
    return ch.meta[IDX(lx & 15, y, lz & 15)];
  }
  sky(lx, y, lz) {
    if (y < 0) return 0;
    if (y >= CH_Y) return 15;
    const ch = this._chunk(lx, lz);
    if (!ch) return 15;
    return ch.sky[IDX(lx & 15, y, lz & 15)];
  }
  blkLight(lx, y, lz) {
    if (y < 0 || y >= CH_Y) return 0;
    const ch = this._chunk(lx, lz);
    if (!ch) return 0;
    return ch.blk[IDX(lx & 15, y, lz & 15)];
  }
  biome(lx, lz) {
    const ch = this._chunk(lx, lz);
    if (!ch) return 0;
    return ch.biome[(lz & 15) * CH_X + (lx & 15)];
  }
}

/* ---------- 便捷：判断方块是否"完全遮挡"（用于面剔除） ---------- */
function isOpaqueBlock(id) { return id !== 0 && BLOCKS[id].opaque; }
function isAirBlock(id) { return id === 0; }
function isFluid(id) { return id !== 0 && BLOCKS[id].fluid; }
