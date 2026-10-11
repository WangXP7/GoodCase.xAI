/* ============================================================
 * player.js —— 玩家状态与移动
 * · WASD/方向键移动、Shift 冲刺、体力系统、墙体碰撞
 * · 行走/冲刺产生不同大小的“声音事件”（供实体听觉）
 * ============================================================ */
(function () {
  'use strict';
  var B4 = window.B4 = window.B4 || {};
  var CFG = B4.CFG;

  B4.createPlayer = function (spawn) {
    return {
      x: spawn.tx + 0.5, y: spawn.ty + 0.5,   // 世界坐标（格）
      radius: CFG.PLAYER_RADIUS,
      fx: 0, fy: 1,                            // 朝向
      moving: false, sprinting: false, exhausted: false,
      stamina: CFG.STAMINA_MAX,
      bumpTime: 0, bumpCooldown: 0,
      footAcc: 0, stepSide: 1, walkAnim: 0,
      distMoved: 0, sprintStarts: 0,
      noisePulse: 0
    };
  };

  /** 圆形与实心格碰撞检测 */
  B4.collideCircle = function (map, x, y, r) {
    var minX = Math.floor(x - r), maxX = Math.floor(x + r);
    var minY = Math.floor(y - r), maxY = Math.floor(y + r);
    var MU = B4.MapUtils;
    for (var ty = minY; ty <= maxY; ty++) {
      for (var tx = minX; tx <= maxX; tx++) {
        if (!MU.isSolid(map, tx, ty)) continue;
        var cx = Math.max(tx, Math.min(x, tx + 1));
        var cy = Math.max(ty, Math.min(y, ty + 1));
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  };

  /** 轴分离移动（先 X 后 Y），返回是否被墙挡下 */
  B4.moveCircle = function (map, ent, vx, vy, dt) {
    var r = ent.radius;
    var hitX = false, hitY = false;
    var steps = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy)) * dt / 0.12));
    var sdt = dt / steps;
    for (var s = 0; s < steps; s++) {
      var nx = ent.x + vx * sdt;
      if (vx !== 0) {
        if (!B4.collideCircle(map, nx, ent.y, r)) ent.x = nx; else hitX = true;
      }
      var ny = ent.y + vy * sdt;
      if (vy !== 0) {
        if (!B4.collideCircle(map, ent.x, ny, r)) ent.y = ny; else hitY = true;
      }
    }
    return hitX || hitY;
  };

  B4.updatePlayer = function (game, dt) {
    var p = game.player, map = game.map, input = game.input;
    var MU = B4.MapUtils;

    var ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    var iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    var len = Math.sqrt(ix * ix + iy * iy);
    if (len > 0) { ix /= len; iy /= len; p.fx = ix; p.fy = iy; }
    p.moving = len > 0;

    /* ---- 冲刺与体力 ---- */
    var wantSprint = input.sprint && p.moving;
    var wasSprinting = p.sprinting;
    p.sprinting = wantSprint && !p.exhausted && p.stamina > 0;
    if (p.sprinting && !wasSprinting) {
      p.sprintStarts++;
      game.stats.sprints = p.sprintStarts;
    }
    if (p.sprinting) {
      p.stamina -= CFG.SPRINT_DRAIN * dt;
      if (p.stamina <= 0) {
        p.stamina = 0; p.exhausted = true; p.sprinting = false;
        B4.audio.breath();
      }
    } else {
      p.stamina += CFG.STAMINA_REGEN * dt;
      if (p.stamina > CFG.STAMINA_MAX) p.stamina = CFG.STAMINA_MAX;
      if (p.exhausted && p.stamina >= CFG.SPRINT_RESUME_AT) p.exhausted = false;
    }

    /* ---- 移动与碰撞 ---- */
    var speed = CFG.PLAYER_SPEED * (p.sprinting ? CFG.SPRINT_MULT : 1);
    var vx = ix * speed, vy = iy * speed;
    var preX = p.x, preY = p.y;
    var blocked = false;
    if (len > 0) blocked = B4.moveCircle(map, p, vx, vy, dt);
    var mdx = p.x - preX, mdy = p.y - preY;
    var moved = Math.sqrt(mdx * mdx + mdy * mdy);
    p.distMoved += moved;
    game.stats.distance = p.distMoved;
    p.walkAnim += moved * (p.sprinting ? 1.6 : 1.1);

    /* ---- 脚步声 + 声音事件（行走小声，冲刺大声） ---- */
    p.footAcc += moved;
    var stepLen = p.sprinting ? 0.40 : 0.56;
    if (p.footAcc >= stepLen) {
      p.footAcc = 0;
      B4.audio.footstep(p.sprinting);
      p.noisePulse = 0.35;
    }
    if (p.noisePulse > 0) {
      p.noisePulse -= dt;
      if (p.noisePulse <= 0 && p.moving) {
        game.addNoise(p.x, p.y, p.sprinting ? CFG.NOISE_SPRINT : CFG.NOISE_WALK);
      }
    }

    /* ---- 连续撞墙 → 产生可被实体听到的声音 ---- */
    p.bumpCooldown -= dt;
    if (blocked && len > 0 && p.bumpCooldown <= 0) {
      p.bumpTime += dt;
      if (p.bumpTime > 0.35) {
        p.bumpTime = 0;
        p.bumpCooldown = 1.0;
        B4.audio.bump();
        game.addNoise(p.x, p.y, CFG.NOISE_BUMP);
        game.shake(2.2, 0.18);
      }
    } else if (!blocked) {
      p.bumpTime = 0;
    }
  };
})();
