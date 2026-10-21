/* ============================================================
 * cities/nanjing.js —— 南京（v2 重点新增城市）
 * 六朝烟水气：城墙青灰 / 梧桐苍绿 / 琉璃金蓝 / 秦淮灯红
 * 地标全清单：紫峰大厦·明城墙·中华门·中山陵·夫子庙·秦淮河·
 *   玄武湖·鸡鸣寺·阅江楼·长江大桥·南京眼·大报恩寺琉璃塔·
 *   牛首山佛顶宫·总统府·新街口孙中山铜像·德基广场·金陵饭店·
 *   鼓楼·紫金山·梧桐大道·民国建筑群
 * ========================================================== */
import { zifengTower, dejiTwin, jinlingHotel, cbdTower } from '../lib/towers.js';
import { bellTower, templeHall, sunYatSenMausoleum, yuejiangTower, porcelainPagoda, fodingPalace, presidentialPalace, sunYatSenStatue, waterTownHouse, gateTower } from '../lib/heritage.js';
import { cityWall, zhonghuaGate, archBridge, yangtzeBridge, nanjingEye } from '../lib/infra.js';
import { paifang, screenWall } from '../lib/roofs.js';

/* ---- 布局常量 ---- */
const WALL = [[-260, -296], [110, -296], [110, 195], [-280, 195]];
const LAKE = { x0: -240, x1: 110, z0: -430, z1: -300 };
const CANAL = { x0: -250, x1: 60, z0: 105, z1: 140 };   // 内秦淮
const WAIQINHUAI = { x0: -330, x1: 130, z0: 218, z1: 246 }; // 外秦淮

/* ---- 地块填充工具 ---- */
const exclusions = [];
const keepOut = (x, z, r) => exclusions.push({ x, z, r });
const blocked = (x, z, r = 20) => exclusions.some(e => Math.hypot(x - e.x, z - e.z) < e.r + r);

function fillBlock(ctx, x0, z0, x1, z1, opt = {}) {
  const { minH = 14, maxH = 44, republican = 0, traditional = 0, shop = 0, step = 30 } = opt;
  const r = ctx.rng;
  for (let x = x0 + step / 2; x < x1 - 4; x += step) {
    for (let z = z0 + step / 2; z < z1 - 4; z += step) {
      if (blocked(x, z, 24)) continue;
      const w = 15 + r() * 11, d = 15 + r() * 11, h = minH + r() * (maxH - minH);
      const px = x + (r() - 0.5) * 7, pz = z + (r() - 0.5) * 7;
      const rep = r() < republican;
      const style = rep ? 'republican' : 'modern';
      const roof = rep ? { type: 'gable' }
        : (r() < traditional ? { type: r() < 0.55 ? 'gold' : 'green' } : 'flat');
      ctx.building(px, pz, { w, d, h, style, roof, shop: r() < shop });
    }
  }
}
function pavilion(ctx, x, z, s = 1, y = 0) {
  ctx.box(7 * s, 1, 7 * s, x, y, z, { mat: ctx.mat('pavStone', { color: 0x9b968a, roughness: 0.85 }) });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ctx.cyl(0.35 * s, 0.4 * s, 4.2 * s, x + sx * 2.4 * s, y + 1, z + sz * 2.4 * s, { mat: ctx.mat('pavRed', { color: 0x8a2f22, roughness: 0.6 }), seg: 6 });
  }
  ctx.box(8 * s, 0.5, 8 * s, x, y + 5.2 * s, z, { mat: ctx.mat('pavBeam', { color: 0x8a2f22, roughness: 0.6 }), cast: false });
  const T = ctx.THREE;
  const roof = new T.ConeGeometry(5.4 * s, 2.8 * s, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(x, y + 7.2 * s, z);
  ctx._push(ctx.mat('pavRoof', { color: 0x2e6b4f, roughness: 0.5 })._key, roof, ctx.mat('pavRoof', { color: 0x2e6b4f, roughness: 0.5 }));
}

export default {
  id: 'nanjing',
  name: '南京',
  subtitle: '六朝古都 · 十里秦淮',
  badge: '重点新增',
  accent: '#e0a94f',
  camera: { radius: 1180, phi: 0.72, theta: 1.02, targetY: 60, minR: 180, maxR: 2400 },
  palette: {
    ground: 0x3c403f, blotch: '126,130,126',
    road: 0x2f3337, roadDash: 'rgba(222,214,188,.42)', curb: 0x7f817a, plaza: 0x464a4b,
    facades: [0x8a8a82, 0x746f68, 0x94908a, 0x6e6c66, 0x9c9a90],
    glassBase: '#33505a', brickBase: 0x6f6c64, baseColor: 0x555a5b,
    roofGold: 0xc9a227, tileBlack: 0x2c2f36,
    treeColors: { plane: 0x2e5626, willow: 0x5f7a33, pine: 0x2d4a2c, broad: 0x3a5a30, pineTall: 0x27402c },
    waterDeep: 0x1a3038, waterShallow: 0x3a6062,
    fog: 0x93847c, fogMix: 0.5,
    skyTop: 0x35507a, skyHorizon: 0xd8a86e,
  },

  async build(ctx) {
    const r = ctx.rng;
    /* ========== 壹 · 山水形胜 ========== */
    await ctx.step('勘定山水形胜…');
    // 长江（外秦淮以外的大江）
    ctx.paintPoly([[-600, -620], [600, -620], [600, -500], [-600, -500]], '#1d2b30');
    ctx.water(0, -560, 1200, 124);
    // 外秦淮
    ctx.paintPoly([[-340, 210], [140, 210], [140, 250], [-340, 250]], '#1f2a2c');
    ctx.water(-100, 230, 480, 40);
    // 玄武湖 + 五洲
    ctx.paintPoly([[-250, -435], [115, -435], [115, -300], [-250, -300]], '#16262b');
    ctx.water(-68, -367, 360, 132);
    const isles = [
      [-120, -312, 46, 7], [-230, -332, 30, 6], [-240, -372, 27, 6],
      [-105, -362, 38, 7], [-175, -395, 25, 5.5],
    ];
    for (const [ix, iz, ir, ih] of isles) {
      ctx.hill(ix, iz, ir, ih, ctx.mat('isleMat', { color: 0x4d5a3c, roughness: 0.95 }), { top: 0.4 });
      for (let i = 0; i < 5; i++) ctx.tree(ix + (r() - 0.5) * ir * 1.1, iz + (r() - 0.5) * ir * 1.1, { type: r() < 0.5 ? 'willow' : 'broad', scale: 0.8 + r() * 0.4 });
      pavilion(ctx, ix, iz, 0.9, ctx.groundY(ix, iz));
    }
    // 湖堤
    for (const [a, b] of [[[-190, -322], [-95, -314]], [[-140, -364], [-160, -384]]]) {
      ctx.beam([a, b], 6, 1.4, ctx.mat('causeway', { color: 0x8a867c, roughness: 0.9 }), 1.2);
    }
    // 紫金山 + 头陀岭（与陵山连成一片）
    ctx.hill(330, -330, 185, 34, ctx.mat('zijinMat', { color: 0x51603c, roughness: 0.96 }), { top: 0.28 });
    ctx.hill(255, -415, 150, 30, ctx.mat('lingMat', { color: 0x4e5c3a, roughness: 0.96 }), { top: 0.45 });
    const peak = new ctx.THREE.ConeGeometry(48, 68, 9);
    peak.translate(352, 34, -368);
    ctx._push(ctx.mat('toutuoMat', { color: 0x46543a, roughness: 0.96 })._key, peak, ctx.mat('toutuoMat', { color: 0x46543a, roughness: 0.96 }));
    for (let i = 0; i < 90; i++) {
      const a = r() * Math.PI * 2, rr = r() * 150;
      ctx.tree(330 + Math.cos(a) * rr, -330 + Math.sin(a) * rr * 0.8, { type: r() < 0.55 ? 'pineTall' : 'pine', scale: 1 + r() * 0.6 });
    }
    // 牛首山
    ctx.hill(-430, 330, 85, 30, ctx.mat('niushouMat', { color: 0x55603f, roughness: 0.96 }), { top: 0.5 });
    for (let i = 0; i < 26; i++) ctx.tree(-430 + (r() - 0.5) * 130, 330 + (r() - 0.5) * 110, { type: 'pine', scale: 0.9 + r() * 0.5 });
    // 远山：江北（江南丘陵）贴地而起
    ctx.ridge(-590, -560, 560, 16, 42, ctx.mat('ridgeN', { color: 0x4a5a66, roughness: 1 }));
    ctx.ridge(560, -560, 560, 18, 44, ctx.mat('ridgeS', { color: 0x47596a, roughness: 1 }));

    /* ========== 贰 · 夯筑明城墙 ========== */
    await ctx.step('夯筑明城墙…');
    ctx.paintPoly(WALL.concat([WALL[0]]), '#3f443f');
    ctx.paintRect(-30, -50, 330, 460, ctx.palette.plaza);
    cityWall(ctx, WALL, {
      h: 13, w: 7, mark: '明城墙',
      gates: [
        { at: 0, t: 0.6, mark: '玄武门' },
        { at: 1, t: 0.55, mark: '太平门' },
        { at: 2, t: 0.55, mark: '中华门墙段' },
        { at: 3, t: 0.45, mark: '石城门' },
      ],
    });
    // 中华门瓮城（南墙）
    zhonghuaGate(ctx, -80, 195, { mark: '中华门' });
    keepOut(-80, 225, 60); keepOut(110, -296, 40); keepOut(-260, -296, 40); keepOut(110, 195, 40); keepOut(-280, 195, 40);
    // 外秦淮长干桥
    archBridge(ctx, -80, 230, { len: 34, w: 9, span: 16, h: 6, mark: '长干桥' });
    // 城墙根绿化
    for (let i = 0; i < 40; i++) {
      const t = r();
      const wx = -260 + t * 370, wz = -296 + (r() < 0.5 ? -1 : 1) * 26 * (r() < 0.5 ? 1 : 0) + (r() - 0.5) * 8;
      ctx.tree(wx, wz, { type: 'plane', scale: 0.9 + r() * 0.4 });
    }

    /* ========== 叁 · 紫峰天际线 ========== */
    await ctx.step('立紫峰天际线…');
    keepOut(60, -180, 90);
    zifengTower(ctx, 60, -180, 380);
    // 鼓楼 CBD 玻璃群
    const cbdSpots = [[-20, -215, 170], [125, -225, 210], [140, -150, 150], [-30, -120, 120], [110, -95, 185], [150, -40, 140]];
    cbdSpots.forEach(([x, z, h], i) => { keepOut(x, z, 50); cbdTower(ctx, x, z, h, i); });
    // 河西新城（城外东侧）
    for (let i = 0; i < 10; i++) {
      const x = 160 + r() * 150, z = -240 + r() * 260;
      if (blocked(x, z, 40)) continue;
      cbdTower(ctx, x, z, 90 + r() * 170, i + 1);
    }
    // 下关滨江
    for (let i = 0; i < 6; i++) {
      const x = -460 + r() * 280, z = -460 + r() * 20;
      cbdTower(ctx, x, z, 100 + r() * 80, i + 2);
    }

    /* ========== 肆 · 六朝楼台 ========== */
    await ctx.step('起六朝楼台…');
    // 新街口：孙中山铜像 + 德基双塔
    keepOut(-70, -30, 80);
    ctx.paintRect(-70, -30, 120, 90, '#3a3f42');
    dejiTwin(ctx, -70, -35, 260);
    ctx.box(46, 0.5, 46, -70, 0.05, -30, { mat: ctx.mat('plazaStone', { color: 0x6f7378, roughness: 0.85 }), cast: false });
    sunYatSenStatue(ctx, -70, -2);
    // 鼓楼
    keepOut(-150, -140, 45);
    ctx.paintRect(-150, -140, 80, 80, '#3f4447');
    bellTower(ctx, -150, -140, { h: 34, mark: '鼓楼' });
    // 金陵饭店
    keepOut(-10, -95, 40);
    jinlingHotel(ctx, -10, -95, 110);
    // 鸡鸣寺（北极阁）
    ctx.hill(-150, -255, 40, 15, ctx.mat('jimingHill', { color: 0x4f5a3e, roughness: 0.96 }), { top: 0.55 });
    keepOut(-150, -250, 45);
    templeHall(ctx, -150, -250, { w: 22, d: 14, h: 13, mark: '鸡鸣寺', roof: 'gold', tiers: 2, y0: ctx.groundY(-150, -250) });
    // 夫子庙 + 秦淮河
    keepOut(0, 100, 60);
    templeHall(ctx, 0, 92, { w: 34, d: 22, h: 18, mark: '夫子庙大成殿', roof: 'gold', tiers: 2 });
    screenWall(ctx, -26, 108, { w: 26, h: 7 });
    paifang(ctx, 34, 92, { w: 11, h: 12 });
    // 总统府
    keepOut(25, 55, 60);
    presidentialPalace(ctx, 25, 50);
    // 中山陵（紫金山南麓，白色大台地 + 拾级而上）
    keepOut(255, -415, 110);
    ctx.box(76, 14, 150, 255, 16, -415, { mat: ctx.mat('lingTerrace', { color: 0xcfcabd, roughness: 0.6 }), cast: false });
    sunYatSenMausoleum(ctx, 255, -350, { mark: '中山陵', y0: 30 });
    for (let i = 0; i < 16; i++) {
      const a = r() * Math.PI * 2, rr = 60 + r() * 60;
      ctx.tree(255 + Math.cos(a) * rr, -415 + Math.sin(a) * rr, { type: 'pine', scale: 1 + r() * 0.4 });
    }
    // 阅江楼（狮子山）
    ctx.hill(-380, -410, 72, 26, ctx.mat('shiziMat', { color: 0x57543f, roughness: 0.96 }), { top: 0.3 });
    keepOut(-380, -410, 70);
    yuejiangTower(ctx, -380, -412, { h: 42, mark: '阅江楼', y0: ctx.groundY(-380, -412) });
    for (let i = 0; i < 20; i++) ctx.tree(-380 + (r() - 0.5) * 110, -410 + (r() - 0.5) * 90, { type: 'pine', scale: 0.9 + r() * 0.4 });
    // 大报恩寺琉璃塔（中华门外）
    keepOut(-225, 255, 45);
    porcelainPagoda(ctx, -225, 250, { h: 88, mark: '大报恩寺琉璃塔' });
    // 牛首山佛顶宫
    keepOut(-430, 340, 70);
    fodingPalace(ctx, -430, 330, { r: 38, mark: '牛首山佛顶宫', y0: ctx.groundY(-430, 330) });
    // 跨江：长江大桥 + 南京眼
    keepOut(150, -557, 110); keepOut(-330, -557, 80);
    yangtzeBridge(ctx, 150, -557, { len: 190, h: 78, mark: '南京长江大桥', ry: Math.PI / 2 });
    nanjingEye(ctx, -330, -557, { r: 62, mark: '南京眼', ry: Math.PI / 2 });

    /* ========== 伍 · 街巷梧桐 ========== */
    await ctx.step('栽梧桐 · 点灯笼…');
    // 主干道网（中山东路 / 汉中路 / 陵园路）
    const vAve = [-235, -150, -65, 20, 95];
    const hAve = [-240, -155, -70, 15];
    for (const x of vAve) ctx.avenue(x, -285, x, 185, { w: 13, tree: 'plane', lantern: x === -150 });
    for (const z of hAve) ctx.avenue(-270, z, 105, z, { w: 13, tree: 'plane', lantern: z === -70 });
    // 陵园路（中山门 → 中山陵，梧桐林荫）
    ctx.avenue(110, -100, 235, -250, { w: 16, tree: 'plane' });
    // 街区填充
    const blocks = [];
    for (let i = 0; i < vAve.length - 1; i++) for (let j = 0; j < hAve.length - 1; j++) {
      blocks.push([vAve[i] + 10, hAve[j] + 10, vAve[i + 1] - 10, hAve[j + 1] - 10]);
    }
    blocks.push([-270, 25, -150, 185]); blocks.push([-65, 25, 105, 100]);
    blocks.push([-270, -285, -150, -245]); blocks.push([-65, -285, 105, -245]);
    for (const [x0, z0, x1, z1] of blocks) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const republican = cx > -40 && cx < 90 && cz > -50 && cz < 95 ? 0.55 : 0.12; // 总统府周边民国建筑群
      const traditional = cz > 55 && cz < 100 ? 0.3 : 0.05;
      fillBlock(ctx, x0, z0, x1, z1, { minH: 13, maxH: 40, republican, traditional, shop: 0.18 });
    }
    // 城南（ canal 与南墙之间 ）传统街区
    fillBlock(ctx, -240, 148, 60, 188, { minH: 10, maxH: 22, traditional: 0.5, step: 22 });
    // 城墙外东北民居
    fillBlock(ctx, 125, -260, 560, 250, { minH: 18, maxH: 70, step: 36 });
    fillBlock(ctx, -560, -250, -290, 200, { minH: 18, maxH: 60, step: 38 });
    // 秦淮两岸：垂柳 + 灯笼 + 画舫 + 文德桥
    for (let i = 0; i < 26; i++) {
      const x = -240 + i * 11.5;
      ctx.tree(x + (r() - 0.5) * 3, 98 + (r() - 0.5) * 4, { type: 'willow', scale: 0.85 + r() * 0.3 });
      ctx.tree(x + (r() - 0.5) * 3, 150 + (r() - 0.5) * 4, { type: 'willow', scale: 0.85 + r() * 0.3 });
      if (i % 3 === 0) { ctx.lantern(x, 4.4, 103, 1); ctx.lantern(x, 4.4, 147, 1); }
    }
    ctx.water(0, CANAL.z0 + 35, 320, 35);
    archBridge(ctx, 30, 122, { len: 26, w: 7, span: 13, h: 5, mark: '文德桥' });
    ctx.boat([[-245, 0, 122], [-60, 0, 122], [120, 0, 122]], { kind: 'huafang', speed: 4 });
    ctx.boat([[-245, 0, 128], [60, 0, 128], [140, 0, 128]], { kind: 'huafang', speed: 3.4 });
    ctx.boat([[-245, 0, 132], [40, 0, 132], [150, 0, 132]], { kind: 'huafang', speed: 3.8 });
    // 长江游船
    ctx.boat([[-460, 0, -557], [360, 0, -557]], { kind: 'youchuan', speed: 7 });
    // 车流
    ctx.carLane({ x1: -150, z1: -280, x2: -150, z2: 180, n: 7, speed: 11 });
    ctx.carLane({ x1: -265, z1: -70, x2: 100, z2: -70, n: 7, speed: 12 });
    ctx.carLane({ x1: 20, z1: -280, x2: 20, z2: 100, n: 6, speed: 10 });
    ctx.carLane({ x1: -265, z1: 15, x2: 100, z2: 15, n: 6, speed: 10 });
    ctx.carLane({ x1: 110, z1: -100, x2: 235, z2: -250, n: 4, speed: 13 });
    // 湖畔杨柳
    for (let i = 0; i < 30; i++) {
      const x = -240 + r() * 350, z = -425 + r() * 125;
      ctx.tree(x, z, { type: 'willow', scale: 0.85 + r() * 0.35 });
    }
  },
};
