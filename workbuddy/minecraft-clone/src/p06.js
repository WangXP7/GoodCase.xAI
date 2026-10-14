/* =====================================================================
   8. 地形生成
   ---------------------------------------------------------------------
   生物群系 / 高度场 / 洞穴 / 矿脉 / 树木 / 水体 / 植被
   全部由种子决定，区块间完全无缝（噪声为纯函数，树木跨区块续写）
   ===================================================================== */

const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4,
  SNOWY: 5, MOUNTAINS: 6, SWAMP: 7,
};
const BIOME_NAME = ['海洋', '沙滩', '平原', '森林', '沙漠', '雪原', '山地', '沼泽'];
const BIOME_NAME_EN = ['Ocean', 'Beach', 'Plains', 'Forest', 'Desert', 'Snowy Peaks', 'Mountains', 'Swamp'];

/** 生物群系 → 草/叶色号（0 温带 1 寒带 2 干旱） */
const BIOME_TINT = [0, 2, 0, 0, 2, 1, 1, 0];

/** 生物群系 → 树木密度（每个 5x5 网格生成一棵树的概率） */
const BIOME_TREE = [0, 0, 0.22, 0.78, 0.04, 0.42, 0.10, 0.5];
/** 生物群系 → 草密度 */
const BIOME_GRASS = [0, 0, 0.14, 0.24, 0.01, 0.05, 0.08, 0.30];
/** 生物群系 → 花密度 */
const BIOME_FLOWER = [0, 0, 0.035, 0.05, 0.004, 0.01, 0.01, 0.02];

/* ---------------------------------------------------------------------
   大陆性与海拔
   --------------------------------------------------------------------- */
function continentalness(world, x, z) {
  return world.noise.fbm2(x * 0.00072, z * 0.00072, 4, 2, 0.5);
}
function humidity(world, x, z) {
  return world.noiseB.fbm2(x * 0.0013, z * 0.0013, 3);
}
function temperature(world, x, z) {
  return world.noiseC.fbm2(x * 0.00095, z * 0.00095, 3);
}

function biomeAt(world, x, z, hIn) {
  const cont = continentalness(world, x, z);
  const temp = temperature(world, x, z);
  const hum = humidity(world, x, z);
  const h = hIn !== undefined ? hIn : terrainHeightRaw(world, x, z);

  if (h < SEA_LEVEL - 1.2) {
    if (h > SEA_LEVEL - 4) return BIOME.BEACH;
    return BIOME.OCEAN;
  }
  if (h <= SEA_LEVEL + 1.6) return BIOME.BEACH;
  if (h > SEA_LEVEL + 46) return BIOME.MOUNTAINS;
  if (temp < -0.28) return BIOME.SNOWY;
  if (temp > 0.32 && hum < -0.05) return BIOME.DESERT;
  if (hum > 0.26 && cont < 0.02) return BIOME.SWAMP;
  if (hum > 0.06) return BIOME.FOREST;
  return BIOME.PLAINS;
}

/** 地形高度（纯函数，供生物群系/树木/网格共用） */
function terrainHeightRaw(world, x, z) {
  const n = world.noise, nb = world.noiseB;
  const cont = n.fbm2(x * 0.00072, z * 0.00072, 4, 2, 0.5);
  const hills = n.fbm2(x * 0.0062, z * 0.0062, 4, 2, 0.5);
  const detail = nb.fbm2(x * 0.031, z * 0.031, 2, 2, 0.5);
  const mt = n.ridge2(x * 0.0034, z * 0.0034, 5);

  let h = SEA_LEVEL + 1.2;
  h += hills * 6.2;
  h += detail * 1.5;

  if (cont < 0) {
    // 海洋 / 浅海
    h += Math.max(cont, -0.62) * 33;
  } else {
    h += cont * 19;
    const mFac = clamp((cont - 0.24) / 0.48, 0, 1);
    h += mFac * mFac * 40 * (0.34 + mt * 0.9);
  }
  // 平原化：靠近海平面的地方压平，形成开阔的沙滩与平原
  const flat = 1 - clamp(Math.abs(h - SEA_LEVEL) / 6, 0, 1);
  h = lerp(h, SEA_LEVEL + 2.4, flat * 0.34);
  return clamp(h, 10, 122);
}

/* ---------------------------------------------------------------------
   洞穴
   --------------------------------------------------------------------- */
function isCave(world, x, y, z, surfaceY) {
  if (y < 5) return false;
  if (y > surfaceY - 3) return false;      // 不破坏地表
  if (y > SEA_LEVEL - 2) return false;     // 不在水下开洞，避免海水"漏空"
  const n = world.noise;
  // 双层交错的蠕虫洞穴
  const a = n.noise3(x * 0.0295, y * 0.052, z * 0.0295);
  const b = n.noise3(x * 0.0295 + 41.7, y * 0.052 + 17.3, z * 0.0295 - 8.1);
  if (a * a + b * b < 0.0125) return true;
  // 深层大空腔（廉价的单层噪声）
  if (y < 44 && world.noiseB.noise3(x * 0.017, y * 0.024, z * 0.017) > 0.74) return true;
  return false;
}

/* ---------------------------------------------------------------------
   矿脉
   --------------------------------------------------------------------- */
const ORE_DEFS = [
  { block: 'coal_ore',     minY: 6,  maxY: 108, tries: 22, size: 15, rarity: 1 },
  { block: 'iron_ore',     minY: 5,  maxY: 68,  tries: 16, size: 8,  rarity: 1 },
  { block: 'lapis_ore',    minY: 5,  maxY: 34,  tries: 2,  size: 6,  rarity: 1 },
  { block: 'gold_ore',     minY: 5,  maxY: 34,  tries: 3,  size: 7,  rarity: 1 },
  { block: 'redstone_ore', minY: 5,  maxY: 20,  tries: 7,  size: 8,  rarity: 1 },
  { block: 'diamond_ore',  minY: 5,  maxY: 16,  tries: 2,  size: 6,  rarity: 1 },
  { block: 'emerald_ore',  minY: 5,  maxY: 30,  tries: 1,  size: 3,  rarity: 1 },
];

function generateOres(world, chunk, cx, cz, rnd) {
  const stoneId = BID.stone;
  for (const ore of ORE_DEFS) {
    const oid = BID[ore.block];
    for (let t = 0; t < ore.tries; t++) {
      if (rnd() > 0.86) continue;
      let x = (rnd() * 16) | 0;
      let y = ore.minY + ((rnd() * (ore.maxY - ore.minY)) | 0);
      let z = (rnd() * 16) | 0;
      const count = 2 + ((rnd() * ore.size) | 0);
      for (let i = 0; i < count; i++) {
        if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < CH_Y) {
          const idx = IDX(x, y, z);
          const cur = chunk.blocks[idx];
          if (cur === stoneId || cur === BID.granite) chunk.blocks[idx] = oid;
        }
        // 随机游走扩散矿脉
        const d = (rnd() * 6) | 0;
        if (d < 1) x++; else if (d < 2) x--; else if (d < 3) y++;
        else if (d < 4) y--; else if (d < 5) z++; else z--;
      }
    }
  }
}

/* ---------------------------------------------------------------------
   树木（可跨区块续写）
   --------------------------------------------------------------------- */
function treeKindOf(world, x, z, biome) {
  const r = hash2i(x, z, world.seed ^ 0x7ab3);
  if (biome === BIOME.SNOWY || biome === BIOME.MOUNTAINS) return r < 0.78 ? 2 : 1;
  if (biome === BIOME.SWAMP) return 0;
  if (biome === BIOME.FOREST) return r < 0.62 ? 0 : 1;
  return r < 0.8 ? 0 : 1;
}

/** 判断 (x,z) 是否为一棵树的根部，若是返回树信息 */
function treeAt(world, x, z, biome, surfaceY) {
  const dens = BIOME_TREE[biome];
  if (dens <= 0) return null;
  if (surfaceY <= SEA_LEVEL) return null;
  const GS = 5;
  const gx = Math.floor(x / GS), gz = Math.floor(z / GS);
  if (hash2i(gx, gz, world.seed ^ 0x1234abcd) > dens) return null;
  const tx = gx * GS + ((hash2i(gx, gz, world.seed ^ 0x5566) * GS) | 0);
  const tz = gz * GS + ((hash2i(gx, gz, world.seed ^ 0x99aa) * GS) | 0);
  if (tx !== x || tz !== z) return null;
  const kind = treeKindOf(world, x, z, biome);
  const h = kind === 2 ? 7 + ((hash2i(x, z, 91) * 6) | 0)
          : kind === 1 ? 5 + ((hash2i(x, z, 92) * 3) | 0)
          : 4 + ((hash2i(x, z, 93) * 3) | 0);
  return { kind, height: h, y: surfaceY };
}

/** 写入一个方块（自动裁剪到本区块内） */
function putTree(world, chunk, bx, bz, wx, wy, wz, id, overwrite = false) {
  const lx = wx - bx, lz = wz - bz;
  if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return;
  if (wy < 0 || wy >= CH_Y) return;
  const i = IDX(lx, wy, lz);
  const cur = chunk.blocks[i];
  if (!overwrite && cur !== 0 && cur !== BID.water && !BLOCKS[cur].alphaTest && BLOCKS[cur].solid) {
    if (cur === BID.oak_leaves || cur === BID.birch_leaves || cur === BID.spruce_leaves) return;
    return;
  }
  chunk.blocks[i] = id;
}

function buildTree(world, chunk, bx, bz, wx, wz, info, biome) {
  const { kind, height, y } = info;
  const logId = kind === 2 ? BID.spruce_log : kind === 1 ? BID.birch_log : BID.oak_log;
  const leafId = kind === 2 ? BID.spruce_leaves : kind === 1 ? BID.birch_leaves : BID.oak_leaves;

  // 树干
  for (let i = 0; i < height; i++) putTree(world, chunk, bx, bz, wx, y + i, wz, logId, true);

  const rnd = mulberry32(hash2i(wx, wz, world.seed ^ 0xffee) * 4294967296);

  if (kind === 2) {
    // 云杉：锥形
    let r = 1;
    for (let i = height - 1; i > 1; i--) {
      const layer = height - 1 - i;
      r = layer < 2 ? 1 : (layer % 3 === 0 ? 2 : 1);
      const extra = layer % 4 === 0 ? 1 : 0;
      for (let dx = -r - extra; dx <= r + extra; dx++) for (let dz = -r - extra; dz <= r + extra; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > r + extra) continue;
        if (dx === 0 && dz === 0 && i < height) continue;
        putTree(world, chunk, bx, bz, wx + dx, y + i, wz + dz, leafId);
      }
    }
    putTree(world, chunk, bx, bz, wx, y + height, wz, leafId, true);
  } else {
    const top = y + height - 1;
    // 两层层 5x5（去角），两层 3x3，顶部十字
    for (let dy = -1; dy <= 1; dy++) {
      const r = dy === 1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r) {
          if (r === 2 && rnd() < 0.5) continue;
          if (r === 1) continue;
        }
        putTree(world, chunk, bx, bz, wx + dx, top + dy, wz + dz, leafId);
      }
    }
    for (let dy = 2; dy <= 3; dy++) {
      const r = dy === 2 ? 1 : 0;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++)
        putTree(world, chunk, bx, bz, wx + dx, top + dy, wz + dz, leafId);
    }
    putTree(world, chunk, bx, bz, wx, top + 4, wz, leafId, true);
  }
}

/* ---------------------------------------------------------------------
   主生成函数
   --------------------------------------------------------------------- */
function generateTerrain(world, chunk, cx, cz) {
  const bx = cx * 16, bz = cz * 16;
  const blocks = chunk.blocks;
  const rnd = mulberry32(((hash2i(cx, cz, world.seed ^ 0x51ab) * 4294967296) | 0) >>> 0);

  const BEDROCK = BID.bedrock, STONE = BID.stone, DIRT = BID.dirt,
        GRASS = BID.grass_block, SAND = BID.sand, SANDSTONE = BID.sandstone,
        WATER = BID.water, GRAVEL = BID.gravel, SNOW = BID.snow_block,
        SNOWGRASS = BID.snowy_grass_block, ICE = BID.ice, CLAY = BID.clay,
        LAVA = BID.lava;

  // ---- 1. 高度与生物群系（外扩 3 格，供跨区块的树木续写使用，避免重复采样） ----
  const EX = 3, EW = CH_X + EX * 2;   // 22 x 22
  const extH = new Int16Array(EW * EW);
  const extB = new Uint8Array(EW * EW);
  for (let z = 0; z < EW; z++) {
    for (let x = 0; x < EW; x++) {
      const wx = bx + x - EX, wz = bz + z - EX;
      const h = Math.round(terrainHeightRaw(world, wx, wz));
      extH[z * EW + x] = h;
      extB[z * EW + x] = biomeAt(world, wx, wz, h);
    }
  }
  const colH = new Int16Array(CH_AREA);
  const colB = new Uint8Array(CH_AREA);
  for (let z = 0; z < CH_Z; z++) {
    for (let x = 0; x < CH_X; x++) {
      const ei = (z + EX) * EW + (x + EX);
      colH[z * CH_X + x] = extH[ei];
      colB[z * CH_X + x] = extB[ei];
      chunk.biome[z * CH_X + x] = extB[ei];
    }
  }

  // ---- 2. 基础地层 ----
  for (let z = 0; z < CH_Z; z++) {
    for (let x = 0; x < CH_X; x++) {
      const ci = z * CH_X + x;
      const h = colH[ci];
      const biome = colB[ci];
      const wx = bx + x, wz = bz + z;

      const isOcean = h < SEA_LEVEL - 1;
      const desert = biome === BIOME.DESERT;
      const snowy = biome === BIOME.SNOWY || biome === BIOME.MOUNTAINS;
      const beach = biome === BIOME.BEACH;

      // 表层厚度
      const soilDepth = isOcean ? 1 : (desert ? 3 : 1);
      const subDepth = isOcean ? 2 : 3 + ((hash2i(wx, wz, 7) * 3) | 0);

      for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
        const i = IDX(x, y, z);
        let id = 0;
        if (y <= BEDROCK_LEVEL - 1) {
          id = BEDROCK;
        } else if (y === BEDROCK_LEVEL && hash2i(wx * 3 + y, wz * 5, 11) > 0.4) {
          id = BEDROCK;
        } else if (y < h - subDepth) {
          id = STONE;
        } else if (y < h - soilDepth) {
          id = desert ? SANDSTONE : (snowy ? DIRT : DIRT);
        } else if (y < h) {
          if (desert) id = SAND;
          else if (snowy) id = DIRT;
          else if (isOcean) id = (y >= h - 1 && h > SEA_LEVEL - 8) ? SAND : GRAVEL;
          else id = DIRT;
        } else if (y === h) {
          // 表层方块
          if (isOcean) id = (h > SEA_LEVEL - 6) ? ((hash2i(wx, wz, 13) > 0.35) ? SAND : GRAVEL) : (hash2i(wx, wz, 13) > 0.6 ? CLAY : GRAVEL);
          else if (desert) id = SAND;
          else if (snowy) id = SNOWGRASS;
          else if (beach) id = SAND;
          else id = GRASS;
          // 陡坡露岩
          const ei = (z + EX) * EW + (x + EX);
          const dh = Math.abs(extH[ei + 1] - h) + Math.abs(extH[ei + EW] - h);
          if (dh > 2.6 && !isOcean && !desert) id = (h > SEA_LEVEL + 34) ? STONE : id;
        } else {
          // 海平面以下填水
          id = (y <= SEA_LEVEL) ? WATER : 0;
        }
        blocks[i] = id;
      }
      // 冰封水面
      if (snowy && h < SEA_LEVEL) {
        const i = IDX(x, SEA_LEVEL, z);
        if (blocks[i] === WATER && hash2i(wx, wz, 17) > 0.25) blocks[i] = ICE;
      }
    }
  }

  // ---- 3. 洞穴 ----
  if (world.opts.caves !== false) {
    for (let z = 0; z < CH_Z; z++) {
      for (let x = 0; x < CH_X; x++) {
        const ci = z * CH_X + x;
        const h = colH[ci];
        const wx = bx + x, wz = bz + z;
        for (let y = 6; y < h; y++) {
          if (!isCave(world, wx, y, wz, h)) continue;
          const i = IDX(x, y, z);
          const cur = blocks[i];
          if (cur === BEDROCK || cur === WATER) continue;
          if (y <= 9) blocks[i] = LAVA;
          else blocks[i] = 0;
        }
      }
    }
  }

  // ---- 4. 矿脉 ----
  if (world.opts.ores !== false) generateOres(world, chunk, cx, cz, rnd);

  // ---- 5. 地表装饰与树木 ----
  const deco = world.opts.deco !== false;
  // 树木搜索范围需要外扩，以便跨区块的树能续写进本区块
  if (deco) {
    for (let z = 0; z < EW; z++) {
      for (let x = 0; x < EW; x++) {
        const wx = bx + x - EX, wz = bz + z - EX;
        const ei = z * EW + x;
        const info = treeAt(world, wx, wz, extB[ei], extH[ei]);
        if (!info) continue;
        buildTree(world, chunk, bx, bz, wx, wz, info, extB[ei]);
      }
    }
  }

  // ---- 6. 花草 / 仙人掌 / 甘蔗 ----
  if (deco) {
    for (let z = 0; z < CH_Z; z++) {
      for (let x = 0; x < CH_X; x++) {
        const ci = z * CH_X + x;
        const h = colH[ci];
        if (h <= SEA_LEVEL) continue;
        const biome = colB[ci];
        const wx = bx + x, wz = bz + z;
        if (h + 1 >= CH_Y) continue;
        const above = IDX(x, h + 1, z);
        if (blocks[above] !== 0) continue;
        const ground = blocks[IDX(x, h, z)];

        // 沙漠：仙人掌与枯木
        if (biome === BIOME.DESERT) {
          if (hash2i(wx, wz, 21) < 0.008) {
            const ch2 = 1 + ((hash2i(wx, wz, 22) * 3) | 0);
            for (let i = 0; i < ch2; i++) if (h + 1 + i < CH_Y) blocks[IDX(x, h + 1 + i, z)] = BID.cactus;
          } else if (hash2i(wx, wz, 23) < 0.02) {
            blocks[above] = BID.dead_bush;
          }
          continue;
        }
        if (ground !== GRASS && ground !== SNOWGRASS) continue;

        const r = hash2i(wx, wz, 31);
        if (r < BIOME_FLOWER[biome]) {
          const fr = hash2i(wx, wz, 32);
          const flower = fr < 0.42 ? BID.dandelion : fr < 0.84 ? BID.poppy : BID.blue_orchid;
          blocks[above] = biome === BIOME.SNOWY ? BID.tall_grass : flower;
        } else if (r < BIOME_FLOWER[biome] + BIOME_GRASS[biome]) {
          blocks[above] = (biome === BIOME.SNOWY) ? BID.tall_grass
                       : (hash2i(wx, wz, 33) < 0.18 ? BID.fern : BID.tall_grass);
        }
      }
    }
  }

  // ---- 7. 雪盖 ----
  if (deco) {
    for (let z = 0; z < CH_Z; z++) for (let x = 0; x < CH_X; x++) {
      const ci = z * CH_X + x;
      const h = colH[ci];
      const biome = colB[ci];
      if (biome !== BIOME.SNOWY && biome !== BIOME.MOUNTAINS) continue;
      if (h <= SEA_LEVEL || h + 1 >= CH_Y) continue;
      if (hash2i(bx + x, bz + z, 41) < 0.7 && blocks[IDX(x, h + 1, z)] === 0) {
        blocks[IDX(x, h + 1, z)] = BID.snow_block;
      }
    }
  }
}
