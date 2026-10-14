/* =====================================================================
   9. 区块网格构建
   ---------------------------------------------------------------------
   · 六面剔除（不透明邻居 / 同种透明方块）
   · 逐顶点 AO（Minecraft 式三邻域算法）
   · 平滑光照（四个角的光照值平均后插值）
   · 十字植物 / 火把 / 仙人掌 / 液体等特殊模型
   顶点布局（9 个 float32 = 36 字节）：
     [0..2] 位置   [3..4] UV   [5] 纹理层   [6] 天光  [7] 方块光  [8] AO
   ===================================================================== */

const VERT_FLOATS = 9;
const VERT_BYTES = VERT_FLOATS * 4;

// 光源亮度曲线（Minecraft lightmap 公式）
const LIGHT_TABLE = new Float32Array(16);
for (let i = 0; i < 16; i++) {
  const f = i / 15;
  LIGHT_TABLE[i] = f / (4 - 3 * f);
}
const AO_SHADE = [0.46, 0.68, 0.87, 1.0];

/** 六个面的几何定义（顶点顺序严格 CCW，从外侧看） */
const FACE_DEF = [
  { // 0  +X
    n: [1, 0, 0], uDir: [0, 0, -1], vDir: [0, 1, 0], layerKey: 'side',
    v: [
      { p: [1, 0, 1], uv: [0, 1], s: [-1, -1] },
      { p: [1, 0, 0], uv: [1, 1], s: [1, -1] },
      { p: [1, 1, 0], uv: [1, 0], s: [1, 1] },
      { p: [1, 1, 1], uv: [0, 0], s: [-1, 1] },
    ],
  },
  { // 1  -X
    n: [-1, 0, 0], uDir: [0, 0, 1], vDir: [0, 1, 0], layerKey: 'side',
    v: [
      { p: [0, 0, 0], uv: [0, 1], s: [-1, -1] },
      { p: [0, 0, 1], uv: [1, 1], s: [1, -1] },
      { p: [0, 1, 1], uv: [1, 0], s: [1, 1] },
      { p: [0, 1, 0], uv: [0, 0], s: [-1, 1] },
    ],
  },
  { // 2  +Y 顶
    n: [0, 1, 0], uDir: [1, 0, 0], vDir: [0, 0, -1], layerKey: 'top',
    v: [
      { p: [0, 1, 1], uv: [0, 0], s: [-1, -1] },
      { p: [1, 1, 1], uv: [1, 0], s: [1, -1] },
      { p: [1, 1, 0], uv: [1, 1], s: [1, 1] },
      { p: [0, 1, 0], uv: [0, 1], s: [-1, 1] },
    ],
  },
  { // 3  -Y 底
    n: [0, -1, 0], uDir: [1, 0, 0], vDir: [0, 0, 1], layerKey: 'bottom',
    v: [
      { p: [0, 0, 0], uv: [0, 0], s: [-1, -1] },
      { p: [1, 0, 0], uv: [1, 0], s: [1, -1] },
      { p: [1, 0, 1], uv: [1, 1], s: [1, 1] },
      { p: [0, 0, 1], uv: [0, 1], s: [-1, 1] },
    ],
  },
  { // 4  +Z 南
    n: [0, 0, 1], uDir: [1, 0, 0], vDir: [0, 1, 0], layerKey: 'front',
    v: [
      { p: [0, 0, 1], uv: [0, 1], s: [-1, -1] },
      { p: [1, 0, 1], uv: [1, 1], s: [1, -1] },
      { p: [1, 1, 1], uv: [1, 0], s: [1, 1] },
      { p: [0, 1, 1], uv: [0, 0], s: [-1, 1] },
    ],
  },
  { // 5  -Z 北
    n: [0, 0, -1], uDir: [-1, 0, 0], vDir: [0, 1, 0], layerKey: 'back',
    v: [
      { p: [1, 0, 0], uv: [0, 1], s: [-1, -1] },
      { p: [0, 0, 0], uv: [1, 1], s: [1, -1] },
      { p: [0, 1, 0], uv: [1, 0], s: [1, 1] },
      { p: [1, 1, 0], uv: [0, 0], s: [-1, 1] },
    ],
  },
];

/** 同种方块互相剔除（水/玻璃/树叶/冰） */
let CULL_SAME_SET = null;
function initCullSets() {
  CULL_SAME_SET = new Set([
    BID.water, BID.lava, BID.glass, BID.ice, BID.packed_ice,
    BID.oak_leaves, BID.birch_leaves, BID.spruce_leaves,
  ]);
}
const TRANSLUCENT_IDS = () => new Set([BID.water]);

/* ---------------------------------------------------------------------
   顶点缓冲累加器
   --------------------------------------------------------------------- */
class MeshBuilder {
  constructor(capVerts = 2048) {
    this.buf = new Float32Array(capVerts * VERT_FLOATS);
    this.n = 0;                       // 已写入的 float 数
    this.idx = new Uint32Array(Math.max(1024, capVerts * 2));
    this.ni = 0;
    this.verts = 0;
  }
  _growV(nf) {
    if (this.n + nf <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.n + nf) cap *= 2;
    const nb = new Float32Array(cap);
    nb.set(this.buf.subarray(0, this.n));
    this.buf = nb;
  }
  _growI(ni) {
    if (this.ni + ni <= this.idx.length) return;
    let cap = this.idx.length * 2;
    while (cap < this.ni + ni) cap *= 2;
    const n2 = new Uint32Array(cap);
    n2.set(this.idx.subarray(0, this.ni));
    this.idx = n2;
  }
  vert(x, y, z, u, v, layer, sky, blk, ao) {
    this._growV(VERT_FLOATS);
    const b = this.buf, o = this.n;
    b[o] = x; b[o + 1] = y; b[o + 2] = z;
    b[o + 3] = u; b[o + 4] = v;
    b[o + 5] = layer;
    b[o + 6] = sky; b[o + 7] = blk; b[o + 8] = ao;
    this.n += VERT_FLOATS;
    return this.verts++;
  }
  idx4(a, b, c, d) {
    this._growI(6);
    const it = this.idx;
    it[this.ni] = a; it[this.ni + 1] = b; it[this.ni + 2] = c;
    it[this.ni + 3] = a; it[this.ni + 4] = c; it[this.ni + 5] = d;
    this.ni += 6;
  }
  empty() { return this.verts === 0; }
  reset() { this.n = 0; this.ni = 0; this.verts = 0; }
}

/* ---------------------------------------------------------------------
   光照与 AO 采样
   --------------------------------------------------------------------- */
function solidAt(V, x, y, z) {
  const id = V.block(x, y, z);
  return id !== 0 && BLOCKS[id].opaque;
}

/**
 * 计算一个面顶点的光照与 AO
 * bx,by,bz 方块局部坐标；face 面索引；vi 顶点索引
 * 返回 [skyBrightness, blockBrightness, ao]
 */
function sampleVertexLight(V, bx, by, bz, face, vi, smooth) {
  const F = FACE_DEF[face];
  const vtx = F.v[vi];
  const nx = bx + F.n[0], ny = by + F.n[1], nz = bz + F.n[2];

  // 外侧方块的光照（一定是透明的）
  const oSky = V.sky(nx, ny, nz), oBlk = V.blkLight(nx, ny, nz);

  if (!smooth) {
    return [LIGHT_TABLE[oSky], LIGHT_TABLE[oBlk], 1.0];
  }

  const s = vtx.s;
  const ux = F.uDir[0] * s[0], uy = F.uDir[1] * s[0], uz = F.uDir[2] * s[0];
  const vx = F.vDir[0] * s[1], vy = F.vDir[1] * s[1], vz = F.vDir[2] * s[1];

  const a1x = nx + ux, a1y = ny + uy, a1z = nz + uz;
  const a2x = nx + vx, a2y = ny + vy, a2z = nz + vz;
  const a3x = nx + ux + vx, a3y = ny + uy + vy, a3z = nz + uz + vz;

  const s1 = solidAt(V, a1x, a1y, a1z);
  const s2 = solidAt(V, a2x, a2y, a2z);
  const s3 = solidAt(V, a3x, a3y, a3z);

  // AO
  let aoI = (s1 && s2) ? 0 : 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (s3 ? 1 : 0));
  const ao = AO_SHADE[aoI];

  // 平滑光照：取四个角中未被遮挡者的平均
  let cnt = 1, skySum = oSky, blkSum = oBlk;
  if (!s1) { cnt++; skySum += V.sky(a1x, a1y, a1z); blkSum += V.blkLight(a1x, a1y, a1z); }
  if (!s2) { cnt++; skySum += V.sky(a2x, a2y, a2z); blkSum += V.blkLight(a2x, a2y, a2z); }
  if (!s3 && !(s1 && s2)) { cnt++; skySum += V.sky(a3x, a3y, a3z); blkSum += V.blkLight(a3x, a3y, a3z); }

  const sAvg = skySum / cnt, bAvg = blkSum / cnt;
  // 用插值后的等级查表（近似平滑）
  const li = Math.min(15, Math.max(0, sAvg));
  const lj = Math.min(15, Math.max(0, bAvg));
  const i0 = li | 0, t = li - i0;
  const skyB = i0 >= 15 ? 1 : lerp(LIGHT_TABLE[i0], LIGHT_TABLE[i0 + 1], t);
  const j0 = lj | 0, t2 = lj - j0;
  const blkB = j0 >= 15 ? 1 : lerp(LIGHT_TABLE[j0], LIGHT_TABLE[j0 + 1], t2);

  return [skyB, blkB, ao];
}

/* ---------------------------------------------------------------------
   面剔除判定
   --------------------------------------------------------------------- */
function faceVisible(selfId, nbId) {
  if (nbId === 0) return true;
  const nb = BLOCKS[nbId];
  if (nb.opaque) return false;                    // 被不透明方块挡住
  if (nbId === selfId && CULL_SAME_SET.has(nbId)) return false; // 同种透明方块互相剔除
  return true;
}

/* ---------------------------------------------------------------------
   构建一个区块的网格
   --------------------------------------------------------------------- */
function buildChunkMesh(world, chunk, gl, opts) {
  const smooth = opts.smoothLighting !== false;
  const bx0 = chunk.cx * 16, bz0 = chunk.cz * 16;
  const V = new View3x3(world, chunk.cx, chunk.cz);
  const solidB = new MeshBuilder(4096);
  const waterB = new MeshBuilder(512);
  const blocks = chunk.blocks;

  let anySolid = false;

  for (let y = 0; y < CH_Y; y++) {
    for (let z = 0; z < CH_Z; z++) {
      for (let x = 0; x < CH_X; x++) {
        const id = blocks[IDX(x, y, z)];
        if (id === 0) continue;
        const B = BLOCKS[id];
        if (B.render === 'none') continue;
        anySolid = true;

        const isWater = id === BID.water;
        const MB = isWater ? waterB : solidB;
        const biomeTint = BIOME_TINT[V.biome(x, z)];

        switch (B.render) {
          case 'cube':
            if (B.bbox) emitBox(V, MB, blocks, x, y, z, id, B, smooth, biomeTint, B.bbox);
            else emitCube(V, MB, blocks, x, y, z, id, B, smooth, biomeTint);
            break;
          case 'cross': emitCross(V, MB, x, y, z, id, B, smooth, biomeTint); break;
          case 'liquid': emitLiquid(V, MB, blocks, x, y, z, id, B, smooth); break;
          case 'torch': emitTorch(V, MB, x, y, z, id, B, smooth); break;
          case 'ladder': emitLadder(V, MB, x, y, z, id, B, smooth); break;
        }
      }
    }
  }

  chunk.empty = !anySolid;

  const solidMesh = solidB.empty() ? null : uploadMesh(gl, solidB, chunk.mesh);
  const waterMesh = waterB.empty() ? null : uploadMesh(gl, waterB, chunk.meshWater);
  if (solidB.empty() && chunk.mesh) { gl.deleteBuffer(chunk.mesh.vbo); gl.deleteVertexArray(chunk.mesh.vao); chunk.mesh = null; }
  if (waterB.empty() && chunk.meshWater) { gl.deleteBuffer(chunk.meshWater.vbo); gl.deleteVertexArray(chunk.meshWater.vao); chunk.meshWater = null; }
  chunk.mesh = solidMesh;
  chunk.meshWater = waterMesh;
  chunk.dirtyMesh = false;
}

function uploadMesh(gl, MB, old) {
  let vao, vbo, ibo;
  if (old) { vao = old.vao; vbo = old.vbo; ibo = old.ibo; }
  else { vao = gl.createVertexArray(); vbo = gl.createBuffer(); ibo = gl.createBuffer(); }
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, MB.buf.subarray(0, MB.n), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, MB.idx.subarray(0, MB.ni), gl.STATIC_DRAW);
  const st = VERT_BYTES;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, st, 20);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, st, 24);
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, count: MB.ni, verts: MB.verts };
}

/* ---------------------------------------------------------------------
   各模型发射器
   --------------------------------------------------------------------- */
function emitQuad(MB, face, x, y, z, layer, lights, yScaleTop = 1, yOffBottom = 0) {
  const F = FACE_DEF[face];
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const v = F.v[i];
    const py = v.p[1] === 1 ? yScaleTop : yOffBottom;
    const L = lights[i];
    ids.push(MB.vert(x + v.p[0], y + py, z + v.p[2], v.uv[0], v.uv[1], layer, L[0], L[1], L[2]));
  }
  MB.idx4(ids[0], ids[1], ids[2], ids[3]);
}

function emitCube(V, MB, blocks, x, y, z, id, B, smooth, biome) {
  for (let f = 0; f < 6; f++) {
    const F = FACE_DEF[f];
    let layer;
    if (f === 2) layer = topLayer(B, biome);
    else if (f === 3) layer = B.tex.bottom !== undefined ? B.tex.bottom : (B.tex.all !== undefined ? B.tex.all : topLayer(B, biome));
    else if (f === 4 && B.tex.front !== undefined) layer = B.tex.front;
    else if (f === 5 && B.tex.back !== undefined) layer = B.tex.back;
    else if (f === 5 && B.tex.north !== undefined) layer = B.tex.north;
    else layer = faceLayer(B, f, biome);
    if (layer === undefined || layer === null) layer = B.tex.all;

    const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
    const nid = V.block(nx, ny, nz);
    if (!faceVisible(id, nid)) continue;

    const lights = [];
    for (let i = 0; i < 4; i++) lights.push(sampleVertexLight(V, x, y, z, f, i, smooth));
    emitQuad(MB, f, x, y, z, layer, lights, 1, 0);
  }
}

/** 仙人掌等带自定义盒体的方块 */
function emitBox(V, MB, blocks, x, y, z, id, B, smooth, biome, box) {
  const [x0, y0, z0, x1, y1, z1] = box;
  for (let f = 0; f < 6; f++) {
    const F = FACE_DEF[f];
    const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
    if (!faceVisible(id, V.block(nx, ny, nz))) continue;
    const layer = f === 2 ? topLayer(B, biome) : faceLayer(B, f, biome);
    const lights = [];
    for (let i = 0; i < 4; i++) lights.push(sampleVertexLight(V, x, y, z, f, i, smooth));
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const v = F.v[i];
      ids.push(MB.vert(x + (v.p[0] ? x1 : x0), y + (v.p[1] ? y1 : y0), z + (v.p[2] ? z1 : z0),
        v.uv[0], v.uv[1], layer, lights[i][0], lights[i][1], lights[i][2]));
    }
    MB.idx4(ids[0], ids[1], ids[2], ids[3]);
  }
}

/** 十字植物：两个对角面，各生成正反两遍（植物不做背面剔除） */
function emitCross(V, MB, x, y, z, id, B, smooth, biomeTint) {
  const layer = B.tex.all;
  // 用外侧空气方块的光照（上方与四周的较大值）
  const L = [
    Math.max(V.sky(x, y + 1, z), V.sky(x + 1, y, z), V.sky(x, y, z + 1)) / 15,
    Math.max(V.blkLight(x, y + 1, z), V.blkLight(x + 1, y, z), V.blkLight(x, y, z + 1)) / 15,
    1.0,
  ];
  const skyB = LIGHT_TABLE[Math.round(L[0] * 15)];
  const blkB = LIGHT_TABLE[Math.round(L[1] * 15)];
  const hJit = 1 + (hash2i(x, z, 4242) * 0.18 - 0.09);
  const planes = [
    [[0.06, 0.06], [0.94, 0.94]],
    [[0.94, 0.06], [0.06, 0.94]],
  ];
  for (const [a, b] of planes) {
    const corners = [
      [a[0], 0, a[1], 0, 1],
      [b[0], 0, b[1], 1, 1],
      [b[0], 1, b[1], 1, 0],
      [a[0], 1, a[1], 0, 0],
    ];
    for (let pass = 0; pass < 2; pass++) {
      const ids = new Array(4);
      for (let i = 0; i < 4; i++) {
        const c = corners[i];
        const hh = c[1] === 1 ? hJit : 0;
        ids[i] = MB.vert(x + c[0], y + hh, z + c[2], c[3], c[4], layer,
          skyB * 0.94, blkB * 0.94, 1);
      }
      if (pass === 0) MB.idx4(ids[0], ids[1], ids[2], ids[3]);
      else MB.idx4(ids[0], ids[3], ids[2], ids[1]);
    }
  }
}

/** 液体：顶面在无同种液体覆盖时下沉到 0.888 */
function emitLiquid(V, MB, blocks, x, y, z, id, B, smooth) {
  const aboveId = V.block(x, y + 1, z);
  const aboveSame = aboveId === id;
  const topY = aboveSame ? 1 : 0.8888;
  const layer = B.tex.all;
  for (let f = 0; f < 6; f++) {
    const F = FACE_DEF[f];
    if (f === 2 && aboveSame) continue;
    if (f === 3) {
      const below = V.block(x, y - 1, z);
      if (below === id) continue;
      if (below !== 0 && BLOCKS[below].opaque) continue;
    }
    const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
    if (!faceVisible(id, V.block(nx, ny, nz))) continue;
    const lights = [];
    for (let i = 0; i < 4; i++) lights.push(sampleVertexLight(V, x, y, z, f, i, smooth));
    emitQuad(MB, f, x, y, z, layer, lights, topY, 0);
  }
}

/** 火把：细柱 + 发光顶面 */
function emitTorch(V, MB, x, y, z, id, B, smooth) {
  const layer = B.tex.all;
  const w = 1 / 16, cx = 0.5, cz = 0.5, h = 10 / 16;
  const u0 = 7 / 16, u1 = 9 / 16, vTop = 4 / 16, vBot = 1.0;
  const L = sampleVertexLight(V, x, y, z, 2, 0, smooth);
  const glow = LIGHT_TABLE[B.light];
  const bl = Math.max(L[1], glow);

  // 四个侧面（严格 CCW，从外侧看）
  const sides = [
    [[cx - w, cz + w], [cx + w, cz + w]],   // +Z
    [[cx + w, cz - w], [cx - w, cz - w]],   // -Z
    [[cx + w, cz + w], [cx + w, cz - w]],   // +X
    [[cx - w, cz - w], [cx - w, cz + w]],   // -X
  ];
  for (const [a, b] of sides) {
    const ids = new Array(4);
    const vs = [
      [a[0], 0, a[1], u0, vBot], [b[0], 0, b[1], u1, vBot],
      [b[0], h, b[1], u1, vTop], [a[0], h, a[1], u0, vTop],
    ];
    for (let i = 0; i < 4; i++) {
      const vv = vs[i];
      ids[i] = MB.vert(x + vv[0], y + vv[1], z + vv[2], vv[3], vv[4], layer, L[0], bl, 1);
    }
    MB.idx4(ids[0], ids[1], ids[2], ids[3]);
  }
  // 顶面（火焰）
  const tv = [
    [cx - w, cz - w, u0, vTop], [cx + w, cz - w, u1, vTop],
    [cx + w, cz + w, u1, vTop + 1 / 16], [cx - w, cz + w, u0, vTop + 1 / 16],
  ];
  const ids = new Array(4);
  for (let i = 0; i < 4; i++) {
    const t = tv[i];
    ids[i] = MB.vert(x + t[0], y + h, z + t[1], t[2], t[3], layer, L[0], glow, 1);
  }
  MB.idx4(ids[0], ids[1], ids[2], ids[3]);
}

/** 梯子：贴在方块 +Z 侧的薄片，双面可见 */
function emitLadder(V, MB, x, y, z, id, B, smooth) {
  const layer = B.tex.all;
  const L = sampleVertexLight(V, x, y, z, 4, 0, smooth);
  const zb = 1 - 1 / 16;
  const pts = [
    [0, 0, zb, 0, 1], [1, 0, zb, 1, 1], [1, 1, zb, 1, 0], [0, 1, zb, 0, 0],
  ];
  const ids = new Array(4);
  for (let i = 0; i < 4; i++) {
    const c = pts[i];
    ids[i] = MB.vert(x + c[0], y + c[1], z + c[2], c[3], c[4], layer, L[0], L[1], L[2]);
  }
  MB.idx4(ids[0], ids[1], ids[2], ids[3]);
  MB.idx4(ids[0], ids[3], ids[2], ids[1]);
}
