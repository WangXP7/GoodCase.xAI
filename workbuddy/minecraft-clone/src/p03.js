/* =====================================================================
   5. 方块注册表
   ---------------------------------------------------------------------
   每种方块声明：纹理层、遮挡性、硬度、发光、透明度、音效材质、
   渲染类型（立方体 / 十字植物 / 液体 / 火把 / 梯子）
   ===================================================================== */

const BLOCKS = [];          // 索引 = 方块 ID
const BID = Object.create(null); // 名字 → ID
const DESTROY_LAYERS = [];  // 破坏裂纹的纹理层

const T = (n) => TEX_INDEX[n];

/** 生物群系纹理变体索引：0=温带 1=寒带 2=干旱 */
const BiomeTint = {
  grass: [
    { top: null, side: null }, // 运行时填
    { top: null, side: null },
    { top: null, side: null },
  ],
  leaves: [null, null, null],
};

function regBlock(name, o) {
  const id = BLOCKS.length;
  const b = {
    id, name,
    display: o.display || name,
    displayEn: o.displayEn || name,
    render: o.render || 'cube',
    solid: o.solid !== undefined ? o.solid : true,
    opaque: o.opaque !== undefined ? o.opaque : (o.solid !== undefined ? o.solid : true),
    light: o.light || 0,
    lightOpacity: o.lightOpacity !== undefined ? o.lightOpacity : ((o.solid !== undefined ? o.solid : true) ? 15 : 0),
    hardness: o.hardness !== undefined ? o.hardness : 1,
    blast: o.blast || 0,
    sound: o.sound || 'stone',
    tool: o.tool || null,
    fluid: !!o.fluid,
    climbable: !!o.climbable,
    alphaTest: !!o.alphaTest,
    translucent: !!o.translucent,
    tint: o.tint || null,       // 'grass' | 'leaves'
    tex: o.tex,                 // {all|top|bottom|side|front|north...}
    bbox: o.bbox || null,       // 自定义碰撞盒
    damage: o.damage || 0,      // 接触伤害（仙人掌 / 岩浆）
    dropSelf: o.dropSelf !== undefined ? o.dropSelf : true,
    drops: o.drops || null,
    tab: o.tab !== undefined ? o.tab : 1, // 0=不出现在创造栏
    icon: o.icon || null,
  };
  BLOCKS.push(b);
  BID[name] = id;
  return b;
}

/* =====================================================================
   方块注册（必须在 buildTextures() 之后调用）
   ===================================================================== */
function registerBlocks() {
BLOCKS.length = 0;
DESTROY_LAYERS.length = 0;
for (const k in BID) delete BID[k];

/* ---------- 空气 ---------- */
regBlock('air', {
  display: '空气', displayEn: 'Air', render: 'none', solid: false, opaque: false,
  lightOpacity: 0, hardness: 0, tab: 0, dropSelf: false,
});

/* ---------- 岩石家族 ---------- */
regBlock('stone', { display: '石头', displayEn: 'Stone', hardness: 1.5, sound: 'stone', tool: 'pickaxe',
  drops: { item: 'cobblestone' }, tex: { all: T('stone') } });
regBlock('granite', { display: '花岗岩', displayEn: 'Granite', hardness: 1.5, sound: 'stone', tool: 'pickaxe', tex: { all: T('stone') } });
regBlock('cobblestone', { display: '圆石', displayEn: 'Cobblestone', hardness: 2, sound: 'stone', tool: 'pickaxe', tex: { all: T('cobblestone') } });
regBlock('mossy_cobblestone', { display: '苔石', displayEn: 'Mossy Cobblestone', hardness: 2, sound: 'stone', tool: 'pickaxe', tex: { all: T('mossy_cobblestone') } });
regBlock('stone_bricks', { display: '石砖', displayEn: 'Stone Bricks', hardness: 1.5, sound: 'stone', tool: 'pickaxe', tex: { all: T('stone_bricks') } });
regBlock('bricks', { display: '砖块', displayEn: 'Bricks', hardness: 2, sound: 'stone', tool: 'pickaxe', tex: { all: T('bricks') } });
regBlock('bedrock', { display: '基岩', displayEn: 'Bedrock', hardness: -1, sound: 'stone', tex: { all: T('bedrock') }, dropSelf: false });
regBlock('obsidian', { display: '黑曜石', displayEn: 'Obsidian', hardness: 50, blast: 1200, sound: 'stone', tool: 'pickaxe', tex: { all: T('obsidian') } });
regBlock('gravel', { display: '砂砾', displayEn: 'Gravel', hardness: 0.6, sound: 'gravel', tool: 'shovel', tex: { all: T('gravel') } });
regBlock('clay', { display: '黏土', displayEn: 'Clay', hardness: 0.6, sound: 'dirt', tool: 'shovel', tex: { all: T('clay') } });

/* ---------- 土壤 ---------- */
regBlock('dirt', { display: '泥土', displayEn: 'Dirt', hardness: 0.5, sound: 'dirt', tool: 'shovel', tex: { all: T('dirt') } });
regBlock('grass_block', {
  display: '草方块', displayEn: 'Grass Block', hardness: 0.6, sound: 'grass', tool: 'shovel',
  tint: 'grass', drops: { item: 'dirt' },
  tex: { top: T('grass_top'), bottom: T('dirt'), side: T('grass_side') },
});
regBlock('snowy_grass_block', {
  display: '积雪草方块', displayEn: 'Snowy Grass Block', hardness: 0.6, sound: 'grass', tool: 'shovel',
  drops: { item: 'dirt' }, tex: { top: T('snow'), bottom: T('dirt'), side: T('grass_side_snow') },
});
regBlock('sand', { display: '沙子', displayEn: 'Sand', hardness: 0.5, sound: 'sand', tool: 'shovel', tex: { all: T('sand') } });
regBlock('sandstone', { display: '沙岩', displayEn: 'Sandstone', hardness: 0.8, sound: 'stone', tool: 'pickaxe',
  tex: { top: T('sandstone_top'), bottom: T('sandstone_top'), side: T('sandstone_side') } });
regBlock('snow_block', { display: '雪块', displayEn: 'Snow Block', hardness: 0.2, sound: 'snow', tool: 'shovel', tex: { all: T('snow') } });
regBlock('ice', { display: '冰', displayEn: 'Ice', hardness: 0.5, sound: 'glass', tool: 'pickaxe',
  opaque: false, translucent: true, lightOpacity: 3, blast: 600, tex: { all: T('ice') } });
regBlock('packed_ice', { display: '浮冰', displayEn: 'Packed Ice', hardness: 0.5, sound: 'glass', tool: 'pickaxe', tex: { all: T('packed_ice') } });

/* ---------- 木头 ---------- */
const woodSet = [
  ['oak', '橡木', 'Oak', C.oakPlank],
  ['birch', '白桦', 'Birch', hex('#c8b48a')],
  ['spruce', '云杉', 'Spruce', hex('#7b5a34')],
];
for (const [k, zh, en] of woodSet) {
  regBlock(k + '_log', { display: zh + '原木', displayEn: en + ' Log', hardness: 2, sound: 'wood', tool: 'axe',
    tex: { top: T(k + '_log_top'), bottom: T(k + '_log_top'), side: T(k + '_log_side') } });
  regBlock(k + '_planks', { display: zh + '木板', displayEn: en + ' Planks', hardness: 2, sound: 'wood', tool: 'axe',
    tex: { all: T(k + '_planks'), top: T(k + '_planks'), bottom: T(k + '_planks'), side: T(k + '_planks') } });
  regBlock(k + '_leaves', {
    display: zh + '树叶', displayEn: en + ' Leaves', hardness: 0.2, sound: 'grass', tool: 'shears',
    opaque: false, alphaTest: true, lightOpacity: 1, tint: (k === 'oak') ? 'leaves' : null,
    drops: (k === 'oak') ? { item: 'oak_sapling', chance: 0.08 } : null, dropSelf: (k === 'oak'),
    tex: { all: T(k + '_leaves') },
  });
  regBlock(k + '_sapling', { display: zh + '树苗', displayEn: en + ' Sapling', hardness: 0, sound: 'grass',
    solid: false, opaque: false, lightOpacity: 0, render: 'cross', alphaTest: true,
    tex: { all: T(k === 'spruce' ? 'sapling_spruce' : 'sapling') } });
}

/* ---------- 矿石 ---------- */
const ores = [
  ['coal', '煤炭', 'Coal', 3, C.coal], ['iron', '铁', 'Iron', 3, C.iron],
  ['gold', '金', 'Gold', 3, C.gold], ['diamond', '钻石', 'Diamond', 3, C.diamond],
  ['redstone', '红石', 'Redstone', 3, C.redstone], ['lapis', '青金石', 'Lapis', 3, C.lapis],
  ['emerald', '绿宝石', 'Emerald', 3, C.emerald],
];
for (const [k, zh, en, hard] of ores) {
  regBlock(k + '_ore', {
    display: zh + '矿石', displayEn: en + ' Ore', hardness: hard, sound: 'stone', tool: 'pickaxe',
    tex: { all: T(k + '_ore') },
  });
}

/* ---------- 液体 ---------- */
regBlock('water', {
  display: '水', displayEn: 'Water', render: 'liquid', fluid: true, hardness: 100,
  solid: false, opaque: false, translucent: true, lightOpacity: 2, dropSelf: false, tab: 1,
  tex: { all: T('water') },
});
regBlock('lava', {
  display: '岩浆', displayEn: 'Lava', render: 'liquid', fluid: true, hardness: 100,
  solid: false, opaque: false, lightOpacity: 0, light: 15, damage: 4, dropSelf: false,
  tex: { all: T('lava') },
});

/* ---------- 玻璃 / 发光 ---------- */
regBlock('glass', { display: '玻璃', displayEn: 'Glass', hardness: 0.3, sound: 'glass', tool: 'pickaxe',
  opaque: false, translucent: true, alphaTest: true, lightOpacity: 0, dropSelf: false, tex: { all: T('glass') } });
regBlock('glowstone', { display: '荧石', displayEn: 'Glowstone', hardness: 0.3, sound: 'glass', light: 15,
  tex: { all: T('glowstone') } });
regBlock('sea_lantern', { display: '海晶灯', displayEn: 'Sea Lantern', hardness: 0.3, sound: 'glass', light: 15,
  tex: { all: T('sea_lantern') } });

/* ---------- 植物（十字模型） ---------- */
function plantBlock(name, zh, en, tex, opt = {}) {
  regBlock(name, Object.assign({
    display: zh, displayEn: en, hardness: 0, sound: 'grass',
    solid: false, opaque: false, lightOpacity: 0, render: 'cross', alphaTest: true,
    tab: 1, tex: { all: T(tex) },
  }, opt));
}
plantBlock('tall_grass', '草', 'Grass', 'tall_grass', { tint: 'grass', dropSelf: false });
plantBlock('fern', '蕨', 'Fern', 'fern', { tint: 'grass' });
plantBlock('dead_bush', '枯萎的灌木', 'Dead Bush', 'dead_bush', { sound: 'grass' });
plantBlock('dandelion', '蒲公英', 'Dandelion', 'dandelion');
plantBlock('poppy', '虞美人', 'Poppy', 'poppy');
plantBlock('blue_orchid', '兰花', 'Blue Orchid', 'blue_orchid');

regBlock('cactus', {
  display: '仙人掌', displayEn: 'Cactus', hardness: 0.4, sound: 'cloth', opaque: false,
  lightOpacity: 0, damage: 1, bbox: [0.0625, 0, 0.0625, 0.9375, 0.9375, 0.9375],
  tex: { top: T('cactus_top'), bottom: T('cactus_top'), side: T('cactus_side') },
});

regBlock('torch', {
  display: '火把', displayEn: 'Torch', render: 'torch', hardness: 0, sound: 'wood',
  solid: false, opaque: false, lightOpacity: 0, light: 14, alphaTest: true, tab: 1,
  tex: { all: T('torch') },
});
regBlock('ladder', {
  display: '梯子', displayEn: 'Ladder', render: 'ladder', hardness: 0.4, sound: 'wood',
  solid: false, opaque: false, lightOpacity: 0, alphaTest: true, climbable: true,
  tex: { all: T('ladder') },
});

/* ---------- 功能方块 ---------- */
regBlock('crafting_table', { display: '工作台', displayEn: 'Crafting Table', hardness: 2.5, sound: 'wood', tool: 'axe',
  tex: { top: T('crafting_table_top'), bottom: T('oak_planks'), side: T('crafting_table_side'),
         north: T('crafting_table_front'), south: T('crafting_table_front') } });
regBlock('furnace', { display: '熔炉', displayEn: 'Furnace', hardness: 3.5, sound: 'stone', tool: 'pickaxe',
  tex: { top: T('furnace_top'), bottom: T('furnace_top'), side: T('furnace_side'), north: T('furnace_front') } });
regBlock('bookshelf', { display: '书架', displayEn: 'Bookshelf', hardness: 1.5, sound: 'wood', tool: 'axe',
  tex: { top: T('oak_planks'), bottom: T('oak_planks'), side: T('bookshelf') } });
regBlock('tnt', { display: 'TNT', displayEn: 'TNT', hardness: 0, sound: 'grass',
  tex: { top: T('tnt_top'), bottom: T('tnt_bottom'), side: T('tnt_side') } });
regBlock('pumpkin', { display: '南瓜', displayEn: 'Pumpkin', hardness: 1, sound: 'wood',
  tex: { top: T('pumpkin_top'), bottom: T('pumpkin_top'), side: T('pumpkin_side'), north: T('pumpkin_face') } });
regBlock('melon', { display: '西瓜', displayEn: 'Melon', hardness: 1, sound: 'wood',
  tex: { top: T('melon_top'), bottom: T('melon_top'), side: T('melon_side') } });

/* ---------- 羊毛 ---------- */
const woolZh = { white: '白色', red: '红色', orange: '橙色', yellow: '黄色', lime: '黄绿色', green: '绿色',
  cyan: '青色', blue: '蓝色', purple: '紫色', magenta: '品红色', pink: '粉红色', gray: '灰色',
  black: '黑色', brown: '棕色' };
const woolEn = { white: 'White', red: 'Red', orange: 'Orange', yellow: 'Yellow', lime: 'Lime', green: 'Green',
  cyan: 'Cyan', blue: 'Blue', purple: 'Purple', magenta: 'Magenta', pink: 'Pink', gray: 'Gray',
  black: 'Black', brown: 'Brown' };
for (const k in C.wool) {
  regBlock('wool_' + k, { display: woolZh[k] + '羊毛', displayEn: woolEn[k] + ' Wool',
    hardness: 0.8, sound: 'cloth', tool: 'shears', tex: { all: T('wool_' + k) } });
}

/* ---------- 破坏裂纹层 ---------- */
for (let i = 0; i < 10; i++) DESTROY_LAYERS.push(T('destroy_' + i));

/* ---------- 生物群系纹理变体查表 ---------- */
BiomeTint.grass = [
  { top: T('grass_top'), side: T('grass_side') },
  { top: T('grass_top_cold'), side: T('grass_side_cold') },
  { top: T('grass_top_dry'), side: T('grass_side_dry') },
];
BiomeTint.leaves = [
  T('oak_leaves'), T('oak_leaves_cold'), T('oak_leaves_dry'),
];

} /* end registerBlocks */

/* ---------- 工具倍率（还原 MC 挖掘速度） ---------- */
const TOOL_SPEED = { pickaxe: 2.5, axe: 2.5, shovel: 2.5, shears: 5 };

/** 计算破坏一个方块所需秒数（原版公式的简化版：t = hardness*1.5 / 倍率） */
function breakTime(block, heldItem) {
  if (!block || block.hardness < 0) return Infinity;
  if (block.hardness === 0) return 0;
  let speed = 1;
  if (heldItem && heldItem.tool && block.tool && heldItem.tool === block.tool) speed = TOOL_SPEED[heldItem.tool] || 2.5;
  const canHarvest = !block.tool || (heldItem && heldItem.tool === block.tool) || block.tool === 'shears';
  const dmg = canHarvest ? 1.5 : 5;
  return Math.max(0.05, (block.hardness * dmg) / speed);
}

/* ---------- 获取方块某面的纹理层 ---------- */
function faceLayer(block, face, biome) {
  const t = block.tex;
  if (face === 2) return t.top !== undefined ? t.top : t.all;
  if (face === 3) return t.bottom !== undefined ? t.bottom : (t.all !== undefined ? t.all : t.top);
  // 侧面（含正/背面）
  if (face === 5 && t.north !== undefined) return t.north;
  if (face === 4 && t.south !== undefined) return t.south;
  let l = t.side !== undefined ? t.side : t.all;
  // 生物群系染色（草顶 / 树叶 / 草植株）
  if (block.tint === 'grass' && face !== 3 && face !== 2) {
    l = BiomeTint.grass[biome] ? BiomeTint.grass[biome].side : l;
  } else if (block.tint === 'leaves' && BiomeTint.leaves[biome] !== undefined) {
    l = BiomeTint.leaves[biome];
  }
  return l;
}
function topLayer(block, biome) {
  if (block.tint === 'grass' && BiomeTint.grass[biome]) return BiomeTint.grass[biome].top;
  return block.tex.top !== undefined ? block.tex.top : block.tex.all;
}
