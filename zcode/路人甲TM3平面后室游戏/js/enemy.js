/* ============================================================
 * enemy.js —— 敌对实体「巡影」AI
 * 状态：游荡 wander / 怀疑 suspect / 追逐 chase / 丢失搜索 search
 * · 视线判定考虑墙体遮挡（采样射线）
 * · 听觉：行走声音小、冲刺声音大、撞墙/交互也有声源
 * · BFS 网格寻路，绝不穿墙；不会进入安全屋
 * · 反蹲点：游荡目标避开密码终端与出口
 * ============================================================ */
(function () {
  'use strict';
  var B4 = window.B4 = window.B4 || {};
  var CFG = B4.CFG;

  B4.createEnemy = function (map) {
    return {
      x: map.enemySpawn.x + 0.5, y: map.enemySpawn.y + 0.5,
      radius: CFG.ENEMY_RADIUS,
      state: 'wander',
      path: null, pathI: 0,
      target: null,            // {tx,ty}
      repathT: 0,
      seeT: 0,                 // 发现确认计时
      loseT: 0, searchT: 0, lingerT: 0,
      lastSeen: null,
      stuckT: 0, lastX: 0, lastY: 0,
      wobble: Math.random() * 6.28,
      scanT: 0,
      deaggroT: 0
    };
  };

  function tileOf(e) { return { tx: Math.floor(e.x), ty: Math.floor(e.y) }; }

  /* 选择一个游荡目标：远离终端/出口（反蹲点），可达 */
  function pickWanderTarget(game) {
    var map = game.map, e = game.enemy, p = game.player;
    var MU = B4.MapUtils;
    var playerNearCritical =
      Math.hypot(p.x - (map.terminal.tx + 0.5), p.y - (map.terminal.ty + 0.5)) < 8 ||
      Math.hypot(p.x - (map.exit.floorTx + 0.5), p.y - (map.exit.floorTy + 0.5)) < 8;
    var safe = tileOf(e);
    for (var tries = 0; tries < 14; tries++) {
      var tx, ty, t = 0;
      do {
        tx = 1 + Math.floor(Math.random() * (map.w - 2));
        ty = 1 + Math.floor(Math.random() * (map.h - 2));
        t++;
      } while (t < 20 && (MU.isSolid(map, tx, ty) || B4.MapUtils.isSafeTile(map, tx, ty)));
      if (MU.isSolid(map, tx, ty) || B4.MapUtils.isSafeTile(map, tx, ty)) continue;
      var dEnemy = Math.abs(tx + 0.5 - e.x) + Math.abs(ty + 0.5 - e.y);
      if (dEnemy < 6) continue;
      if (!playerNearCritical) {
        if (Math.abs(tx - map.terminal.tx) + Math.abs(ty - map.terminal.ty) < CFG.ANTI_CAMP_RADIUS) continue;
        if (Math.abs(tx - map.exit.floorTx) + Math.abs(ty - map.exit.floorTy) < CFG.ANTI_CAMP_RADIUS) continue;
      }
      if (!MU.bfsPath(map, safe.tx, safe.ty, tx, ty, true)) continue;
      return { tx: tx, ty: ty };
    }
    return null;
  }

  function setTarget(game, tx, ty) {
    var e = game.enemy, map = game.map, t = tileOf(e);
    e.target = { tx: tx, ty: ty };
    e.path = B4.MapUtils.bfsPath(map, t.tx, t.ty, tx, ty, true);
    e.pathI = 0;
    e.repathT = e.state === 'chase' ? CFG.REPATH_CHASE : CFG.REPATH_IDLE;
  }

  B4.updateEnemy = function (game, dt) {
    var map = game.map, e = game.enemy, p = game.player;
    var MU = B4.MapUtils;

    var dx = p.x - e.x, dy = p.y - e.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var los = MU.hasLOS(map, e.x, e.y, p.x, p.y);
    var pTile = tileOf(p);
    var playerSafe = MU.isSafeTile(map, pTile.tx, pTile.ty);
    var canSee = !playerSafe && dist < CFG.ENEMY_VISION && los;

    /* ---- 听觉：处理本帧声音事件 ---- */
    for (var i = 0; i < game.noises.length; i++) {
      var n = game.noises[i];
      if (n.consumed) continue;
      var nd = Math.hypot(n.x - e.x, n.y - e.y);
      if (nd <= n.r) {
        n.consumed = true;
        if (e.state !== 'chase') {
          var nTile = { tx: Math.floor(n.x), ty: Math.floor(n.y) };
          e.state = 'suspect';
          e.seeT = 0; e.lingerT = 0;
          setTarget(game, nTile.tx, nTile.ty);
        }
      }
    }

    /* ---- 状态机 ---- */
    switch (e.state) {
      case 'wander': {
        e.speed = CFG.ENEMY_SPEED_WANDER;
        if (!e.target || !e.path || e.pathI >= (e.path ? e.path.length : 0)) {
          var w = pickWanderTarget(game);
          if (w) setTarget(game, w.tx, w.ty); else { e.target = null; e.path = null; }
        }
        if (canSee) {
          e.seeT += dt;
          if (e.seeT >= CFG.ENEMY_SPOT_TIME) startChase(game);
        } else e.seeT = Math.max(0, e.seeT - dt * 2);
        break;
      }
      case 'suspect': {
        e.speed = CFG.ENEMY_SPEED_SUSPECT;
        if (e.path && e.pathI >= e.path.length) {
          // 到达声源附近：停留环顾
          e.lingerT += dt;
          e.speed = 0;
          if (e.lingerT > 1.5) {
            e.state = 'wander'; e.target = null; e.path = null; e.lingerT = 0;
          }
        }
        if (canSee) {
          e.seeT += dt * 1.6;
          if (e.seeT >= CFG.ENEMY_SPOT_TIME * 0.6) startChase(game);
        } else e.seeT = Math.max(0, e.seeT - dt * 2);
        break;
      }
      case 'chase': {
        e.speed = CFG.ENEMY_SPEED_CHASE;
        if (playerSafe) {
          e.deaggroT += dt;
          if (e.deaggroT > 1.2) {
            e.state = 'search'; e.searchT = 3.0;
            e.lastSeen = { x: e.x, y: e.y };
            setTarget(game, Math.floor(e.x), Math.floor(e.y));
            e.deaggroT = 0;
          }
        } else {
          e.deaggroT = 0;
          if (canSee) {
            e.lastSeen = { x: p.x, y: p.y };
            e.loseT = 0;
          } else {
            e.loseT += dt;
            if (e.loseT > CFG.CHASE_LOSE_TIME) {
              e.state = 'search';
              e.searchT = CFG.SEARCH_TIME;
              var ls = e.lastSeen || { x: p.x, y: p.y };
              setTarget(game, Math.floor(ls.x), Math.floor(ls.y));
              break;
            }
          }
          // 追踪目标：优先最后视线点，恢复视线后直追玩家
          e.repathT -= dt;
          if (e.repathT <= 0) {
            var goal = canSee ? pTile : (e.lastSeen ? { tx: Math.floor(e.lastSeen.x), ty: Math.floor(e.lastSeen.y) } : pTile);
            var path = MU.bfsPath(map, Math.floor(e.x), Math.floor(e.y), goal.tx, goal.ty, true);
            if (path) { e.path = path; e.pathI = 0; }
            e.repathT = CFG.REPATH_CHASE;
          }
        }
        break;
      }
      case 'search': {
        e.speed = CFG.ENEMY_SPEED_SEARCH;
        e.searchT -= dt;
        if (e.path && e.pathI >= e.path.length) {
          e.scanT -= dt;
          e.speed = 0;
          if (e.scanT <= 0) {
            e.scanT = 1.1;
            var base = e.lastSeen || { x: e.x, y: e.y };
            var rx = Math.floor(base.x + (Math.random() * 6 - 3));
            var ry = Math.floor(base.y + (Math.random() * 6 - 3));
            if (!MU.isSolid(map, rx, ry) && !MU.isSafeTile(map, rx, ry)) setTarget(game, rx, ry);
          }
        }
        if (e.searchT <= 0) {
          e.state = 'wander'; e.target = null; e.path = null;
        }
        if (canSee) {
          e.seeT += dt * 1.8;
          if (e.seeT >= CFG.ENEMY_SPOT_TIME * 0.5) startChase(game);
        } else e.seeT = Math.max(0, e.seeT - dt * 2);
        break;
      }
    }

    /* ---- 沿路径移动（带卡墙检测） ---- */
    if (e.speed > 0 && e.path && e.pathI < e.path.length) {
      // 简化路径：能直接看见下下个节点则跳过
      if (e.pathI + 1 < e.path.length) {
        var nn = e.path[e.pathI + 1];
        if (MU.hasLOS(map, e.x, e.y, nn.x + 0.5, nn.y + 0.5)) e.pathI++;
      }
      var node = e.path[e.pathI];
      var tx2 = node.x + 0.5, ty2 = node.y + 0.5;
      var ddx = tx2 - e.x, ddy = ty2 - e.y;
      var dd = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dd < 0.12) {
        e.pathI++;
      } else {
        var vx = ddx / dd * e.speed, vy = ddy / dd * e.speed;
        B4.moveCircle(map, e, vx, vy, dt);
        e.wobble += dt * (e.state === 'chase' ? 11 : 5);
      }
    }

    /* ---- 卡死检测：长时间没有位移则重寻路 ---- */
    var moved2 = Math.abs(e.x - e.lastX) + Math.abs(e.y - e.lastY);
    if (e.speed > 0 && moved2 < e.speed * dt * 0.25) {
      e.stuckT += dt;
      if (e.stuckT > 0.9) {
        e.stuckT = 0;
        if (e.target) setTarget(game, e.target.tx, e.target.ty);
        if (e.state === 'wander') { e.target = null; e.path = null; }
      }
    } else e.stuckT = 0;
    e.lastX = e.x; e.lastY = e.y;

    /* ---- 接触判定：任何状态下碰到玩家都触发失败 ---- */
    if (dist < CFG.ENEMY_CATCH) {
      game.playerCaught();
    }
  };

  function startChase(game) {
    var e = game.enemy;
    if (e.state === 'chase') return;
    e.state = 'chase';
    e.loseT = 0; e.deaggroT = 0;
    e.lastSeen = { x: game.player.x, y: game.player.y };
    e.repathT = 0;
    game.onSpotted();
  }

  /** 调试面板/测试钩子：强制进入追逐 */
  B4.forceChase = function (game) {
    startChase(game);
  };
})();
