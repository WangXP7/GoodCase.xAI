/* ============================================================
 * mapgen.js —— 程序化地图生成
 * · 每次点击“新游戏”随机生成新地图；相同 Seed 完全复现
 * · 房间 + 狭长走廊 + 录像室/密码终端/出口/安全屋/敌人生成点
 * · 生成后做连通性校验，失败则按确定性序列重试
 * ============================================================ */
(function () {
  'use strict';
  var B4 = window.B4 = window.B4 || {};
  var CFG = B4.CFG;
  var W = CFG.MAP_W, H = CFG.MAP_H;

  var T_FLOOR = 0, T_WALL = 1, T_FURN = 2; // 2=家具(实体障碍)

  var NORMAL_NAMES = ['档案室', '资料室', '储物间', '办公室', '复印室', '会议室', '收发室', '文印室'];
  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  function idx(x, y) { return y * W + x; }
  function inMap(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  function manhattan(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

  /* ---------- BFS 最短距离场 ---------- */
  function bfsDist(tiles, sx, sy, avoidSafe) {
    var dist = new Int32Array(W * H).fill(-1);
    var q = [idx(sx, sy)];
    dist[q[0]] = 0;
    var head = 0;
    while (head < q.length) {
      var cur = q[head++];
      var cx = cur % W, cy = (cur / W) | 0;
      var d = dist[cur] + 1;
      var nb = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
      for (var i = 0; i < 4; i++) {
        var nx = nb[i][0], ny = nb[i][1];
        if (!inMap(nx, ny)) continue;
        var ni = idx(nx, ny);
        if (tiles[ni] !== T_FLOOR) continue;
        if (dist[ni] !== -1) continue;
        dist[ni] = d;
        q.push(ni);
      }
    }
    return dist;
  }

  /* ---------- 帮助工具（敌人寻路 / 视线 / 碰撞查询） ---------- */
  B4.MapUtils = {
    isSolid: function (map, tx, ty) {
      if (!inMap(tx, ty)) return true;
      return map.tiles[idx(tx, ty)] !== T_FLOOR;
    },
    isSafeTile: function (map, tx, ty) {
      return inMap(tx, ty) && map.safeSet[idx(tx, ty)] === 1;
    },
    /** BFS 网格寻路，返回不含起点的路径；forEnemy 时避开安全屋 */
    bfsPath: function (map, sx, sy, tx, ty, forEnemy) {
      if (sx === tx && sy === ty) return [];
      var prev = new Int32Array(W * H).fill(-2);
      var start = idx(sx, sy), goal = idx(tx, ty);
      if (forEnemy && map.safeSet[goal] === 1) return null;
      prev[start] = -1;
      var q = [start], head = 0;
      while (head < q.length) {
        var cur = q[head++];
        if (cur === goal) break;
        var cx = cur % W, cy = (cur / W) | 0;
        var nb = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (var i = 0; i < 4; i++) {
          var nx = nb[i][0], ny = nb[i][1];
          if (!inMap(nx, ny)) continue;
          var ni = idx(nx, ny);
          if (prev[ni] !== -2) continue;
          if (map.tiles[ni] !== T_FLOOR) continue;
          if (forEnemy && map.safeSet[ni] === 1) continue;
          prev[ni] = cur;
          q.push(ni);
        }
      }
      if (prev[goal] === -2) return null;
      var path = [], cur = goal;
      while (cur !== start && cur >= 0) {
        path.push({ x: cur % W, y: (cur / W) | 0 });
        cur = prev[cur];
      }
      path.reverse();
      return path;
    },
    /** 世界坐标(格)之间的视线判断：采样直线是否穿墙 */
    hasLOS: function (map, x0, y0, x1, y1) {
      var dx = x1 - x0, dy = y1 - y0;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.001) return true;
      var steps = Math.ceil(d / 0.15);
      for (var i = 1; i < steps; i++) {
        var t = i / steps;
        var sx = x0 + dx * t, sy = y0 + dy * t;
        if (B4.MapUtils.isSolid(map, Math.floor(sx), Math.floor(sy))) return false;
      }
      return true;
    }
  };

  /* ---------- 生成入口 ---------- */
  B4.generateMap = function (seedStr) {
    var rng = new B4.RNG(B4.hashString('b4map:' + seedStr));
    var reasons = {};
    for (var attempt = 0; attempt < 300; attempt++) {
      var map = tryGenerate(seedStr, rng, function (why) {
        reasons[why] = (reasons[why] || 0) + 1;
      });
      if (map) { map.attempts = attempt + 1; return map; }
    }
    var top = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; });
    throw new Error('地图生成失败：' + top.map(function (k) { return k + '×' + reasons[k]; }).join(' / ') + '（seed=' + seedStr + '）');
  };

  function tryGenerate(seedStr, rng, fail) {
    // fail(reason) 记录首次失败原因并返回 null

    var tiles = new Uint8Array(W * H).fill(T_WALL);
    var roomIdx = new Int16Array(W * H).fill(-1);
    var i, x, y, r, k;

    /* 1. 放置房间（互不重叠，含 1 格间隔） */
    var rooms = [];
    for (var att = 0; att < 110 && rooms.length < 14; att++) {
      var rw = rng.int(4, 8), rh = rng.int(4, 7);
      var rx = rng.int(1, W - rw - 2), ry = rng.int(1, H - rh - 2);
      var ok = true;
      for (i = 0; i < rooms.length; i++) {
        var o = rooms[i];
        if (rx < o.x + o.w + 1 && rx + rw + 1 > o.x && ry < o.y + o.h + 1 && ry + rh + 1 > o.y) { ok = false; break; }
      }
      if (ok) rooms.push({ x: rx, y: ry, w: rw, h: rh });
    }
    if (rooms.length < 9) return fail('房间数量不足');

    for (i = 0; i < rooms.length; i++) {
      r = rooms[i];
      r.cx = r.x + (r.w >> 1); r.cy = r.y + (r.h >> 1);
      for (y = r.y; y < r.y + r.h; y++) {
        for (x = r.x; x < r.x + r.w; x++) {
          tiles[idx(x, y)] = T_FLOOR;
          roomIdx[idx(x, y)] = i;
        }
      }
    }

    /* 2. Prim 连接所有房间（L 形狭长走廊） */
    function carveCorridor(a, b) {
      var ax = a.cx, ay = a.cy, bx = b.cx, by = b.cy;
      var horizFirst = rng.chance(0.5);
      function carve(x, y) {
        if (tiles[idx(x, y)] === T_WALL) { tiles[idx(x, y)] = T_FLOOR; roomIdx[idx(x, y)] = -1; }
      }
      if (horizFirst) {
        for (x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) carve(x, ay);
        for (y = Math.min(ay, by); y <= Math.max(ay, by); y++) carve(bx, y);
      } else {
        for (y = Math.min(ay, by); y <= Math.max(ay, by); y++) carve(ax, y);
        for (x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) carve(x, by);
      }
    }
    var connected = [0], rest = [];
    for (i = 1; i < rooms.length; i++) rest.push(i);
    while (rest.length > 0) {
      var bestA = -1, bestB = -1, bestD = 1e9;
      for (i = 0; i < connected.length; i++) {
        for (k = 0; k < rest.length; k++) {
          var d = manhattan(rooms[connected[i]].cx, rooms[connected[i]].cy, rooms[rest[k]].cx, rooms[rest[k]].cy);
          if (d < bestD) { bestD = d; bestA = connected[i]; bestB = rest[k]; }
        }
      }
      carveCorridor(rooms[bestA], rooms[bestB]);
      connected.push(bestB);
      rest.splice(rest.indexOf(bestB), 1);
    }
    /* 2.1 额外环路走廊，制造绕行路线（摆脱追逐用） */
    var loops = rng.int(2, 3);
    while (loops-- > 0) {
      var ra = rng.int(0, rooms.length - 1), rb = rng.int(0, rooms.length - 1);
      if (ra !== rb && manhattan(rooms[ra].cx, rooms[ra].cy, rooms[rb].cx, rooms[rb].cy) < 22) {
        carveCorridor(rooms[ra], rooms[rb]);
      }
    }

    /* 3. 出生点（靠近左上角的房间）与距离场 */
    var spawnRoom = 0, bestScore = 1e9;
    for (i = 0; i < rooms.length; i++) {
      var score = rooms[i].cx + rooms[i].cy;
      if (score < bestScore) { bestScore = score; spawnRoom = i; }
    }
    var dist = bfsDist(tiles, rooms[spawnRoom].cx, rooms[spawnRoom].cy);
    var maxDist = 0;
    for (i = 0; i < dist.length; i++) if (dist[i] > maxDist) maxDist = dist[i];

    var order = rooms.map(function (_, n) { return n; })
      .sort(function (a, b) { return (dist[rooms[b].cx + rooms[b].cy * W] || 0) - (dist[rooms[a].cx + rooms[a].cy * W] || 0); });
    var usedRooms = [spawnRoom];

    function takeRoom(frac) { // 取按距离排序后位于 frac 处的未用房间（使用私有循环变量，避免污染外部 i/k）
      for (var pi = 0; pi < order.length; pi++) {
        var n = order[Math.min(order.length - 1, Math.round(frac * (order.length - 1)))];
        if (usedRooms.indexOf(n) === -1) { usedRooms.push(n); return n; }
        // 该位置已被占用则顺延
        for (var pk = 1; pk < order.length; pk++) {
          var cand = order[(Math.round(frac * (order.length - 1)) + pk) % order.length];
          if (usedRooms.indexOf(cand) === -1) { usedRooms.push(cand); return cand; }
        }
      }
      return -1;
    }

    var exitRoom = takeRoom(1.0);
    var terminalRoom = takeRoom(0.55);
    var safeRoom = takeRoom(0.32);
    var tapeRooms = [takeRoom(0.15), takeRoom(0.62), takeRoom(0.88)];
    if (exitRoom == null || terminalRoom == null || safeRoom == null ||
        tapeRooms.some(function (t) { return t == null; })) {
      return fail('功能区房间分配失败 ' + JSON.stringify([exitRoom, terminalRoom, safeRoom, tapeRooms, 'rooms=' + rooms.length]));
    }
    if (exitRoom < 0 || terminalRoom < 0 || safeRoom < 0 || tapeRooms.indexOf(-1) !== -1) return fail('功能区房间分配为 -1');
    if (tapeRooms[0] === tapeRooms[1] || tapeRooms[1] === tapeRooms[2] || tapeRooms[0] === tapeRooms[2]) return fail('录像带房间重复');

    /* 4. 房间类型与名称 */
    var typeMap = {};
    typeMap[spawnRoom] = CFG.ROOM.NORMAL;
    typeMap[exitRoom] = CFG.ROOM.EXIT;
    typeMap[terminalRoom] = CFG.ROOM.TERMINAL;
    typeMap[safeRoom] = CFG.ROOM.SAFE;
    typeMap[tapeRooms[0]] = CFG.ROOM.MONITOR;
    var nameSeq = 0, normalCount = 0;
    for (i = 0; i < rooms.length; i++) {
      r = rooms[i];
      r.type = typeMap[i] || CFG.ROOM.NORMAL;
      if (r.type === CFG.ROOM.MONITOR) r.name = '监控室';
      else if (r.type === CFG.ROOM.TERMINAL) r.name = '档案主机房';
      else if (r.type === CFG.ROOM.EXIT) r.name = '闸门通道';
      else if (r.type === CFG.ROOM.SAFE) r.name = '值班安全屋';
      else r.name = NORMAL_NAMES[normalCount++ % NORMAL_NAMES.length] + ' ' + LETTERS[nameSeq++ % LETTERS.length];
    }

    /* 5. POI 落点工具 */
    function roomFloorTiles(ri, needWallSide) {
      var rr = rooms[ri], out = [];
      for (y = rr.y; y < rr.y + rr.h; y++) {
        for (x = rr.x; x < rr.x + rr.w; x++) {
          if (tiles[idx(x, y)] !== T_FLOOR || roomIdx[idx(x, y)] !== ri) continue;
          if (isDoorway(x, y)) continue;
          if (needWallSide) {
            var againstWall = x === rr.x || x === rr.x + rr.w - 1 || y === rr.y || y === rr.y + rr.h - 1;
            if (!againstWall) continue;
          }
          out.push({ x: x, y: y });
        }
      }
      return out;
    }
    function isDoorway(x, y) { // 房间内与外部地板相邻的门口格，保持通畅
      if (roomIdx[idx(x, y)] === -1) return false;
      var nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (var n = 0; n < 4; n++) {
        var nx = nb[n][0], ny = nb[n][1];
        if (inMap(nx, ny) && tiles[idx(nx, ny)] === T_FLOOR && roomIdx[idx(nx, ny)] === -1) return true;
      }
      return false;
    }

    function pickTapeTile(ri, placed, minPair) {
      var cands = roomFloorTiles(ri, false).filter(function (t) {
        return dist[idx(t.x, t.y)] > 4 &&
          manhattan(t.x, t.y, spawn.tx, spawn.ty) >= 6;
      });
      if (cands.length === 0) return null;
      rng.shuffle(cands);
      for (var relax = 0; relax < 2; relax++) {
        var mp = relax === 0 ? minPair : 4;
        for (var ci = 0; ci < cands.length; ci++) {
          var t = cands[ci], ok = true;
          for (var ck = 0; ck < placed.length; ck++) {
            if (manhattan(t.x, t.y, placed[ck].x, placed[ck].y) < mp) { ok = false; break; }
          }
          if (ok) return t;
        }
      }
      return null;
    }

    var spawn = { tx: rooms[spawnRoom].cx, ty: rooms[spawnRoom].cy };
    var placedTapes = [], tapes = [];
    for (i = 0; i < 3; i++) {
      var tt = pickTapeTile(tapeRooms[i], placedTapes, 9);
      if (!tt) return fail('录像带落点不足 tr=' + tapeRooms[i]);
      if (!rooms[tapeRooms[i]]) return fail('录像带房间索引非法 tr=' + tapeRooms[i]);
      placedTapes.push(tt);
      tapes.push({ x: tt.x, y: tt.y, order: 0, digit: 0, taken: false, roomName: rooms[tapeRooms[i]].name });
    }
    var orderShuffle = rng.shuffle([0, 1, 2]);
    for (i = 0; i < 3; i++) tapes[orderShuffle[i]].order = i + 1;
    for (i = 0; i < 3; i++) tapes[i].digit = rng.int(0, 9);

    /* 密码终端：贴墙格 */
    var termCands = roomFloorTiles(terminalRoom, true);
    if (termCands.length === 0) return fail('终端落点不足');
    var term = rng.pick(termCands);
    var terminal = { tx: term.x, ty: term.y };

    /* 出口闸门：出口房间边缘墙上、内侧有地板的格 */
    var exitRoomObj = rooms[exitRoom], exit = null;
    var exitCands = [];
    for (y = exitRoomObj.y - 1; y <= exitRoomObj.y + exitRoomObj.h; y++) {
      for (x = exitRoomObj.x - 1; x <= exitRoomObj.x + exitRoomObj.w; x++) {
        if (!inMap(x, y) || tiles[idx(x, y)] !== T_WALL) continue;
        var inner = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(function (n) {
          return inMap(n[0], n[1]) && roomIdx[idx(n[0], n[1])] === exitRoom && tiles[idx(n[0], n[1])] === T_FLOOR;
        });
        if (inner.length > 0) exitCands.push({ gx: x, gy: y, fx: inner[0][0], fy: inner[0][1] });
      }
    }
    if (exitCands.length === 0) return fail('出口候选不足');
    // 选择离房间入口最远（离出生点最近方向无所谓），取随机
    var ec = rng.pick(exitCands);
    exit = { tx: ec.gx, ty: ec.gy, floorTx: ec.fx, floorTy: ec.fy, unlocked: false };

    /* 安全屋长椅 */
    var benchCands = roomFloorTiles(safeRoom, true);
    var bench = benchCands.length ? (function () { var b = rng.pick(benchCands); return { tx: b.x, ty: b.y, cooldown: 0 }; })() : null;

    /* 6. 家具（普通房间/监控室，贴墙摆放；完成后统一校验连通性） */
    var furniture = [];
    for (i = 0; i < rooms.length; i++) {
      r = rooms[i];
      if (r.type !== CFG.ROOM.NORMAL && r.type !== CFG.ROOM.MONITOR) continue;
      var fCount = rng.int(1, 3);
      var fCands = roomFloorTiles(i, true);
      for (k = 0; k < fCount && fCands.length > 0; k++) {
        var ft = rng.pick(fCands);
        var horiz = (ft.y === r.y || ft.y === r.y + r.h - 1);
        var t2 = { x: ft.x + (horiz ? 1 : 0), y: ft.y + (horiz ? 0 : 1) };
        var ok2 = inMap(t2.x, t2.y) && tiles[idx(t2.x, t2.y)] === T_FLOOR &&
          roomIdx[idx(t2.x, t2.y)] === i && !isDoorway(t2.x, t2.y);
        var tilesToMark = ok2 && rng.chance(0.55) ? [ft, t2] : [ft];
        var blocked = false;
        for (var m = 0; m < tilesToMark.length; m++) {
          var mt = tilesToMark[m];
          if (manhattan(mt.x, mt.y, spawn.tx, spawn.ty) < 2) { blocked = true; break; }
          for (var q = 0; q < tapes.length; q++) {
            if (tapes[q].x === mt.x && tapes[q].y === mt.y) { blocked = true; break; }
          }
          if (!blocked && bench && bench.tx === mt.x && bench.ty === mt.y) blocked = true;
          if (blocked) break;
        }
        if (blocked) continue;
        var kind = rng.pick(['shelf', 'desk', 'crate']);
        for (m = 0; m < tilesToMark.length; m++) {
          tiles[idx(tilesToMark[m].x, tilesToMark[m].y)] = T_FURN;
          furniture.push({ x: tilesToMark[m].x, y: tilesToMark[m].y, kind: kind, part: m, total: tilesToMark.length });
        }
      }
    }

    /* 7. 荧光灯 */
    var lamps = [];
    for (i = 0; i < rooms.length; i++) {
      r = rooms[i];
      lamps.push({
        tx: r.cx, ty: r.cy, radius: CFG.LAMP_ROOM_R,
        broken: r.type === CFG.ROOM.SAFE ? false : rng.chance(CFG.LAMP_BROKEN_P),
        flickerSeed: rng.int(0, 65535),
        warm: r.type === CFG.ROOM.SAFE ? 2 : 1
      });
      if (r.w * r.h >= 34) {
        lamps.push({ tx: r.x + 1, ty: r.y + 1, radius: CFG.LAMP_ROOM_R * 0.8, broken: rng.chance(CFG.LAMP_BROKEN_P), flickerSeed: rng.int(0, 65535), warm: 1 });
      }
    }
    var corrTiles = [];
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tiles[idx(x, y)] === T_FLOOR && roomIdx[idx(x, y)] === -1) corrTiles.push({ x: x, y: y });
    }
    rng.shuffle(corrTiles);
    for (i = 0; i < corrTiles.length; i++) {
      var ct = corrTiles[i], far = true;
      for (k = 0; k < lamps.length; k++) {
        if (manhattan(ct.x, ct.y, lamps[k].tx, lamps[k].ty) < 4) { far = false; break; }
      }
      if (far && rng.chance(0.4)) {
        lamps.push({ tx: ct.x, ty: ct.y, radius: CFG.LAMP_CORR_R, broken: rng.chance(CFG.LAMP_BROKEN_P + 0.12), flickerSeed: rng.int(0, 65535), warm: 1 });
      }
    }

    /* 8. 潮湿地毯与污渍（装饰层，纯视觉） */
    var carpet = [], stains = [];
    for (i = 0; i < rooms.length; i++) {
      r = rooms[i];
      if (rng.chance(0.55)) {
        var cw = rng.int(2, Math.max(2, r.w - 2)), ch = rng.int(2, Math.max(2, r.h - 2));
        carpet.push({ x: r.x + rng.int(0, Math.max(0, r.w - cw)), y: r.y + rng.int(0, Math.max(0, r.h - ch)), w: cw, h: ch });
      }
      var sc = rng.int(0, 3);
      for (k = 0; k < sc; k++) {
        stains.push({ x: r.x + rng.int(0, r.w - 1), y: r.y + rng.int(0, r.h - 1), s: rng.range(0.5, 1.4) });
      }
    }

    /* 9. 每格变化种子（渲染用） */
    var tileSeed = new Uint8Array(W * H);
    for (i = 0; i < tileSeed.length; i++) tileSeed[i] = rng.int(0, 255);

    /* 10. 敌对实体出生点：距玩家足够远 */
    var minEnemyDist = Math.max(16, Math.floor(maxDist * 0.45));
    var enemyCands = [];
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      if (tiles[idx(x, y)] !== T_FLOOR) continue;
      if (roomIdx[idx(x, y)] === safeRoom) continue;
      if (dist[idx(x, y)] >= minEnemyDist) enemyCands.push({ x: x, y: y });
    }
    if (enemyCands.length === 0) return fail('敌人出生点不足');
    var es = rng.pick(enemyCands);

    /* 11. 连通性校验（硬性要求） */
    var reach = bfsDist(tiles, spawn.tx, spawn.ty);
    function reached(tx, ty) { return inMap(tx, ty) && reach[idx(tx, ty)] >= 0; }
    for (i = 0; i < tapes.length; i++) {
      if (!reached(tapes[i].x, tapes[i].y)) return fail('录像带不可达');
      if (manhattan(tapes[i].x, tapes[i].y, exit.tx, exit.ty) < 3) return fail('录像带过于靠近出口');
    }
    var termOk = false;
    [[terminal.tx - 1, terminal.ty], [terminal.tx + 1, terminal.ty], [terminal.tx, terminal.ty - 1], [terminal.tx, terminal.ty + 1]].forEach(function (n) {
      if (inMap(n[0], n[1]) && reach[idx(n[0], n[1])] >= 0) termOk = true;
    });
    if (!termOk) return fail('终端不可达');
    if (!reached(exit.floorTx, exit.floorTy)) return fail('出口不可达');
    if (!reached(es.x, es.y) || reach[idx(es.x, es.y)] < minEnemyDist) return fail('敌人出生点不满足距离');
    if (!reached(spawn.tx, spawn.ty)) return fail('出生点不可达');

    /* 12. 安全区集合与地图指纹 */
    var safeSet = new Uint8Array(W * H);
    var sr = rooms[safeRoom];
    for (y = sr.y; y < sr.y + sr.h; y++) for (x = sr.x; x < sr.x + sr.w; x++) safeSet[idx(x, y)] = 1;

    var hashSrc = [];
    for (i = 0; i < tiles.length; i++) hashSrc.push(tiles[i]);
    [spawn.tx, spawn.ty, exit.tx, exit.ty, term.tx, term.ty, es.x, es.y].forEach(function (v) { hashSrc.push(v); });
    tapes.forEach(function (t) { hashSrc.push(t.x, t.y); });
    var mapHash = B4.hashBytes(hashSrc, 0x811c9dc5).toString(16);

    /* 13. 房间安全标记 */
    for (i = 0; i < rooms.length; i++) rooms[i].safe = (i === safeRoom);

    return {
      seed: seedStr, w: W, h: H,
      tiles: tiles, roomIdx: roomIdx, tileSeed: tileSeed,
      rooms: rooms, spawn: spawn, enemySpawn: es,
      tapes: tapes, terminal: terminal, exit: exit, bench: bench,
      safeSet: safeSet, safeRoomIdx: safeRoom,
      lamps: lamps, carpet: carpet, stains: stains, furniture: furniture,
      distFromSpawn: reach, maxDist: maxDist,
      mapHash: mapHash,
      connectivity: 'OK'
    };
  }
})();
