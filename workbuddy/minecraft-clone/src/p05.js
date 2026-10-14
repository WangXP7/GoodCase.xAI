/* =====================================================================
   7. 光照引擎
   ---------------------------------------------------------------------
   两套独立光照：天光(0..15) 与方块光(0..15)，均用 BFS 泛洪传播。
   · 天光自顶部垂直灌入，垂直方向遇到 opacity=0 的方块时不衰减
   · 透明方块按 lightOpacity 衰减（水 3、树叶 1、玻璃 0）
   · 方块变化时做增量式"清除 + 重新扩散"，不做全图重算
   ===================================================================== */

const L_SKY = 0, L_BLK = 1;

const LQ = {
  q: [],       // 扁平整数队列 [x,y,z,level,type, ...]
  head: 0,
  dirty: new Set(),  // 受影响区块 key，处理完后统一标脏网格
};

function lqPush(x, y, z, lv, type) {
  LQ.q.push(x, y, z, lv, type);
}
function lqClear() { LQ.q.length = 0; LQ.head = 0; }

/* ---------- 原始光照读写（不做任何检查，只在已加载区块内） ---------- */
function rawGet(world, x, y, z, type) {
  if (y < 0 || y >= CH_Y) return 0;
  const c = world.chunks.get(world.key(x >> 4, z >> 4));
  if (!c) return 0;
  const i = IDX(x & 15, y, z & 15);
  return type === L_SKY ? c.sky[i] : c.blk[i];
}
function rawSet(world, x, y, z, type, v) {
  if (y < 0 || y >= CH_Y) return;
  const k = world.key(x >> 4, z >> 4);
  const c = world.chunks.get(k);
  if (!c) return;
  const i = IDX(x & 15, y, z & 15);
  if (type === L_SKY) c.sky[i] = v; else c.blk[i] = v;
  LQ.dirty.add(k);
}

/** 某方块的"不透明度"（光的衰减量），>=15 表示完全阻挡 */
function opacityOf(id) {
  if (id === 0) return 0;
  return BLOCKS[id].lightOpacity;
}

/* =====================================================================
   泛洪扩散
   ===================================================================== */
const NX = [1, -1, 0, 0, 0, 0];
const NY = [0, 0, 1, -1, 0, 0];
const NZ = [0, 0, 0, 0, 1, -1];

/** 把 (x,y,z) 的当前光照作为源，加入扩散队列 */
function enqueueSpread(world, x, y, z, type) {
  const lv = rawGet(world, x, y, z, type);
  if (lv > 0) lqPush(x, y, z, lv, type);
}

/** 处理扩散队列。budget 为最多处理的元素数，msBudget 为时间上限（毫秒） */
function processLightQueue(world, budget, msBudget) {
  const q = LQ.q;
  let processed = 0;
  const t0 = performance.now();
  const ms = msBudget === undefined ? Infinity : msBudget;
  while (LQ.head < q.length && processed < budget) {
    if ((processed & 1023) === 0 && performance.now() - t0 > ms) break;
    const x = q[LQ.head], y = q[LQ.head + 1], z = q[LQ.head + 2],
          lv = q[LQ.head + 3], type = q[LQ.head + 4];
    LQ.head += 5;
    processed++;
    if (lv <= 1 && type === L_BLK) continue;
    for (let d = 0; d < 6; d++) {
      const nx = x + NX[d], ny = y + NY[d], nz = z + NZ[d];
      if (ny < 0 || ny >= CH_Y) continue;
      const id = world.getBlock(nx, ny, nz);
      if (id < 0) continue;                 // 未加载，跳过
      const op = opacityOf(id);
      if (op >= 15) continue;               // 不透光
      let nl;
      if (type === L_SKY && d === 3 && lv === 15 && op === 0) {
        nl = 15;                            // 阳光垂直下灌不衰减
      } else {
        nl = lv - (op === 0 ? 1 : op);
      }
      if (nl <= 0) continue;
      if (nl > rawGet(world, nx, ny, nz, type)) {
        rawSet(world, nx, ny, nz, type, nl);
        lqPush(nx, ny, nz, nl, type);
      }
    }
    // 队列可能因为 push 增长；同时回收已消费的前缀
    if (LQ.head > 65536) { q.splice(0, LQ.head); LQ.head = 0; }
  }
  const done = LQ.head >= q.length;
  if (done) lqClear();
  return done;
}

/* =====================================================================
   移除光照（破坏方块 / 放置遮挡物时的必要步骤）
   ===================================================================== */
function removeLightAt(world, x, y, z, type) {
  const start = rawGet(world, x, y, z, type);
  if (start === 0) return;
  const rq = [x, y, z, start];
  rawSet(world, x, y, z, type, 0);
  let head = 0;
  const addBack = [];
  while (head < rq.length) {
    const cx = rq[head], cy = rq[head + 1], cz = rq[head + 2], lv = rq[head + 3];
    head += 4;
    for (let d = 0; d < 6; d++) {
      const nx = cx + NX[d], ny = cy + NY[d], nz = cz + NZ[d];
      if (ny < 0 || ny >= CH_Y) continue;
      const nl = rawGet(world, nx, ny, nz, type);
      if (nl === 0) continue;
      // 判断该邻居是否依赖当前方块
      const verticalDown = (d === 3);
      const depends = (nl < lv) ||
        (type === L_SKY && lv === 15 && nl === 15 && verticalDown) ||
        (type === L_BLK && lv === 15 && nl === 15 && false);
      if (depends) {
        rawSet(world, nx, ny, nz, type, 0);
        rq.push(nx, ny, nz, nl);
      } else {
        // 这是独立的边界光源，稍后重新扩散
        addBack.push(nx, ny, nz);
      }
    }
  }
  for (let i = 0; i < addBack.length; i += 3) enqueueSpread(world, addBack[i], addBack[i + 1], addBack[i + 2], type);
}

/* =====================================================================
   方块变化后的光照增量更新
   ===================================================================== */
function updateLightAt(world, x, y, z, oldId, newId) {
  const nb = newId ? BLOCKS[newId] : null;
  const ob = oldId ? BLOCKS[oldId] : null;
  const newOpaque = nb ? nb.lightOpacity >= 15 : false;
  const oldOpaque = ob ? ob.lightOpacity >= 15 : false;

  for (let type = 0; type < 2; type++) {
    // 1) 清除自身原有的光及其下游
    if (!newOpaque) removeLightAt(world, x, y, z, type);
    else rawSet(world, x, y, z, type, 0);

    // 2) 让六个邻居重新参与扩散
    for (let d = 0; d < 6; d++) {
      const nx = x + NX[d], ny = y + NY[d], nz = z + NZ[d];
      if (ny < 0 || ny >= CH_Y) continue;
      const id = world.getBlock(nx, ny, nz);
      if (id < 0) continue;
      if (opacityOf(id) >= 15) continue;
      enqueueSpread(world, nx, ny, nz, type);
    }

    // 3) 新方块自身如果是光源
    if (type === L_BLK && nb && nb.light > 0) {
      if (nb.light > rawGet(world, x, y, z, L_BLK)) {
        rawSet(world, x, y, z, L_BLK, nb.light);
        lqPush(x, y, z, nb.light, L_BLK);
      }
    }
    // 4) 新方块若是透光的，天光可能从上方直接灌入
    if (type === L_SKY && !newOpaque) {
      const above = rawGet(world, x, y + 1, z, L_SKY);
      if (above === 15 && opacityOf(newId ? newId : 0) === 0) {
        rawSet(world, x, y, z, L_SKY, 15);
        lqPush(x, y, z, 15, L_SKY);
      } else if (above > 1) {
        const cand = above - Math.max(1, opacityOf(newId ? newId : 0));
        if (cand > rawGet(world, x, y, z, L_SKY)) {
          rawSet(world, x, y, z, L_SKY, cand);
          lqPush(x, y, z, cand, L_SKY);
        }
      }
    }
  }
  // 受影响区块的网格需要重建
  for (const k of LQ.dirty) {
    const c = world.chunks.get(k);
    if (c) c.dirtyMesh = true;
  }
}

/* =====================================================================
   区块生成后的初始光照
   ===================================================================== */
function initChunkLight(world, chunk) {
  const b = chunk.blocks;
  // --- 天光：逐列的垂直灌注 ---
  for (let z = 0; z < CH_Z; z++) {
    for (let x = 0; x < CH_X; x++) {
      let level = 15;
      for (let y = CH_Y - 1; y >= 0; y--) {
        const i = IDX(x, y, z);
        const id = b[i];
        const op = opacityOf(id);
        if (op >= 15) {
          level = 0;
        } else if (op > 0) {
          level = Math.max(0, level - op);
        }
        chunk.sky[i] = level;
        if (level > 0) lqPush(chunk.cx * 16 + x, y, chunk.cz * 16 + z, level, L_SKY);
      }
    }
  }
  // 该列顶部的 15 只需要作为水平扩散源，不必全部入队（浪费）；这里保守处理
  // --- 方块光源 ---
  for (let y = 0; y < CH_Y; y++) {
    for (let z = 0; z < CH_Z; z++) {
      for (let x = 0; x < CH_X; x++) {
        const id = b[IDX(x, y, z)];
        if (id !== 0) {
          const lb = BLOCKS[id];
          if (lb.light > 0) {
            chunk.blk[IDX(x, y, z)] = lb.light;
            lqPush(chunk.cx * 16 + x, y, chunk.cz * 16 + z, lb.light, L_BLK);
          }
        }
      }
    }
  }
  chunk.state = CS_LIT;
}

/** 新区块生成后，唤醒周边区块边界上的光重新扩散 */
function wakeNeighborLight(world, chunk) {
  const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
  for (let d = 0; d < 4; d++) {
    for (let y = 0; y < CH_Y; y++) {
      for (let t = 0; t < 16; t++) {
        // d: 0=+X 1=-X 2=+Z 3=-Z
        const x = x0 + (d < 2 ? (d === 0 ? 15 : 0) : t);
        const z = z0 + (d < 2 ? t : (d === 2 ? 15 : 0));
        const nx = x + NX[d], nz = z + NZ[d];
        if (!world.hasChunk(nx >> 4, nz >> 4)) continue;
        enqueueSpread(world, nx, y, nz, L_SKY);
        enqueueSpread(world, nx, y, nz, L_BLK);
      }
    }
  }
}

/* ---------- 查询：用于渲染与调试 ---------- */
function getSkyLight(world, x, y, z) { return rawGet(world, x, y, z, L_SKY); }
function getBlockLight(world, x, y, z) { return rawGet(world, x, y, z, L_BLK); }
