/* ============================================================
 * items.js —— 物品与交互系统
 * · 三盘录像带（各含一位数字与顺序）
 * · 密码终端（三位密码输入/校验）
 * · 出口闸门（解锁状态切换）、安全屋长椅（恢复理智）
 * ============================================================ */
(function () {
  'use strict';
  var B4 = window.B4 = window.B4 || {};
  var CFG = B4.CFG;

  /** 找到玩家附近可交互对象 */
  B4.findInteractable = function (game) {
    var p = game.player, map = game.map, R = CFG.INTERACT_R;
    var best = null, bestD = 1e9;
    function consider(d, obj) { if (d <= R && d < bestD) { bestD = d; best = obj; } }

    for (var i = 0; i < map.tapes.length; i++) {
      var t = map.tapes[i];
      if (t.taken) continue;
      var d = Math.hypot(t.x + 0.5 - p.x, t.y + 0.5 - p.y);
      consider(d, { type: 'tape', ref: t, label: '按 E 拾取录像带（' + game.tapesCollected + '/3）' });
    }
    var dt2 = Math.hypot(map.terminal.tx + 0.5 - p.x, map.terminal.ty + 0.5 - p.y);
    consider(dt2, {
      type: 'terminal', ref: map.terminal,
      label: game.tapesCollected >= 3 ? '按 E 使用密码终端' : '按 E 查看密码终端（还缺 ' + (3 - game.tapesCollected) + ' 盘录像带）'
    });
    var de = Math.hypot(map.exit.floorTx + 0.5 - p.x, map.exit.floorTy + 0.5 - p.y);
    consider(de, {
      type: 'exit', ref: map.exit,
      label: map.exit.unlocked ? '按 E 开启闸门逃离' : '闸门锁死 —— 需要在密码终端输入三位密码'
    });
    if (map.bench) {
      var db = Math.hypot(map.bench.tx + 0.5 - p.x, map.bench.ty + 0.5 - p.y);
      consider(db, {
        type: 'bench', ref: map.bench,
        label: map.bench.cooldown > 0 ? '长椅（休息冷却中 ' + Math.ceil(map.bench.cooldown) + 's）' : '按 E 在长椅上休息（恢复理智）'
      });
    }
    return best;
  };

  B4.doInteract = function (game, it) {
    var map = game.map;
    if (!it) return;
    switch (it.type) {
      case 'tape': {
        var t = it.ref;
        t.taken = true;
        game.tapesCollected++;
        game.clues[t.order - 1] = t.digit;
        game.stats.tapes = game.tapesCollected;
        B4.audio.pickup();
        game.addNoise(t.x + 0.5, t.y + 0.5, CFG.NOISE_INTERACT);
        B4.ui.toast('拾取录像带 #' + t.order + '：第 ' + t.order + ' 位密码数字是 「' + t.digit + '」');
        B4.ui.tapeFlash('录像带 #' + t.order + ' 回放：画面抖动……第 ' + t.order + ' 位密码为 「' + t.digit + '」');
        game.updateObjective();
        break;
      }
      case 'terminal':
        game.openTerminal();
        break;
      case 'exit':
        if (map.exit.unlocked) {
          game.win();
        } else {
          B4.audio.gateLocked();
          B4.ui.toast('闸门被三位密码锁死（录像带 ' + game.tapesCollected + '/3）');
          game.shake(1.5, 0.12);
        }
        break;
      case 'bench':
        if (map.bench.cooldown > 0) return;
        map.bench.cooldown = CFG.BENCH_COOLDOWN;
        game.sanity = Math.min(CFG.SANITY_MAX, game.sanity + CFG.BENCH_SANITY);
        B4.audio.rest();
        game.addNoise(map.bench.tx + 0.5, map.bench.ty + 0.5, CFG.NOISE_INTERACT);
        B4.ui.toast('靠在长椅上休息片刻……理智恢复了一些');
        break;
    }
  };

  /** 密码校验：digits 为长度 3 的数组；录像带不能被清空，错误只清空输入 */
  B4.checkCode = function (game, digits) {
    var map = game.map;
    var code = [0, 0, 0];
    for (var i = 0; i < 3; i++) {
      for (var k = 0; k < map.tapes.length; k++) {
        if (map.tapes[k].order === i + 1) code[i] = map.tapes[k].digit;
      }
    }
    for (i = 0; i < 3; i++) {
      if (digits[i] !== code[i]) {
        B4.audio.codeErr();
        game.shake(2.5, 0.25);
        return { ok: false, correct: code };
      }
    }
    B4.audio.codeOk();
    map.exit.unlocked = true;
    game.updateObjective();
    B4.ui.toast('密码正确！东侧闸门已解锁 —— 跟随绿色指示灯撤离');
    return { ok: true, correct: code };
  };

  /** 出口方向（8 方位），用于解锁后的环境方向提示 */
  B4.exitDirection = function (game) {
    var p = game.player, map = game.map;
    var dx = (map.exit.floorTx + 0.5) - p.x;
    var dy = (map.exit.floorTy + 0.5) - p.y;
    var ang = Math.atan2(dy, dx); // 屏幕坐标 y 向下
    var dirs = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
    var oct = Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    return dirs[oct];
  };
})();
