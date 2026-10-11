/**
 * main.js —— 《檐下 · UNDER THE EAVES》主入口（集成收口）
 *
 * 职责：把已就绪的下游模块接成「浏览器打开即玩」的游戏。
 *   - 引导：WebGL2 探测 → 设备分档 → 渲染器 / 等距相机 / 后处理 / 光照
 *   - 存档：SaveVault + 双槽交替 + CRC32，hidden/pagehide 同步写入（零容忍）
 *   - 主循环：FixedStepLoop（固定步长 1/30s，与渲染解耦）
 *   - 交互：Raycaster 拾取猫本体与可交互物 → InteractionSystem 三态 → CatState
 *   - UI：Hud / Diary 默认全隐，H 键或边缘按钮召唤
 *   - 健壮性：resize / 旋转、tier 降级、全局错误捕获（不白屏）
 *
 * 严禁改动 src/ 与 vendor/ 下其它模块；本文件只做装配。
 */

import * as THREE from 'three';

import { isWebGL2Available, createRenderer, createIsoCamera, updateIsoCameraAspect, getWebGLContextCount } from './render/renderer.js';
import { PostFX } from './render/postfx.js';
import { LightingRig } from './render/lighting.js';
import { buildRoom, ROOM_BOUNDS } from './world/room.js';
import { buildCat } from './cat/model.js';
import { CatAnimator } from './cat/animator.js';
import { CatState, ANCHORS, ANCHOR_POS, walkSpeedFor } from './cat/state.js';
import { GameClock, TIME_SCALE, slotAt, currentTzOffsetMin } from './systems/time.js';
import { InteractionSystem, VERBS, HOLD_REQUIRED_MS } from './systems/interaction.js';
import { settleOffline } from './systems/snapshot.js';
import { SaveVault, createLocalStorageAdapter } from './core/save.js';
import { PCG32, createStreams, makeSeed } from './core/rng.js';
import { FixedStepLoop, STEP_SECONDS } from './core/tick.js';
import { probeDevice, tierConfig, resolveDPR, FrameBenchmark, TIERS } from './core/device.js';
import { Hud } from './ui/hud.js';
import { Diary } from './ui/diary.js';
import { clamp, easeInOutCubic } from './core/easing.js';

/* ============================================================================
 * 0. 全局错误捕获（不白屏）
 * ========================================================================== */

const errorBanner = document.getElementById('error-banner');
let _bannerTimer = 0;
function showError(msg) {
  if (!errorBanner) return;
  errorBanner.textContent = String(msg).slice(0, 160);
  errorBanner.classList.add('show');
  clearTimeout(_bannerTimer);
  _bannerTimer = setTimeout(() => errorBanner.classList.remove('show'), 4200);
}
window.addEventListener('error', (e) => showError(e.message || '运行时错误'));
window.addEventListener('unhandledrejection', (e) => showError((e.reason && e.reason.message) || '未处理的异步错误'));

/* ============================================================================
 * 1. 引导
 * ========================================================================== */

const loadingEl = document.getElementById('loading');
const upgradeEl = document.getElementById('upgrade');

function hideLoading() {
  if (!loadingEl) return;
  loadingEl.classList.add('hidden');
  setTimeout(() => loadingEl && loadingEl.remove(), 900);
}

function showUpgrade() {
  if (loadingEl) loadingEl.classList.add('hidden');
  if (upgradeEl) upgradeEl.classList.add('show');
}

/** 时段 → 环境光强（驱动 cat.expression 的瞳孔/微表情） */
function lightForSlot(slot) {
  return slot === 'night' ? 0.18 : slot === 'dusk' ? 0.55 : slot === 'morning' ? 0.70 : 0.92;
}

let app = null; // 全局引用，供保存/调试

function boot() {
  if (!isWebGL2Available()) {
    showUpgrade();
    return;
  }

  // —— 设备分档 ——
  const probe = probeDevice();
  const tierName = probe.tier;
  const cfg = tierConfig(tierName);

  // —— 渲染器（全局唯一 WebGL context，验收 V-5 = 1）——
  const canvas = document.getElementById('scene');
  const r = createRenderer(canvas, { tier: tierName });
  const { renderer } = r;

  // —— 场景 / 相机 / 雾 ——
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1512);
  // 微缩场景不需要厚雾。near 必须拉远到房间尺度（~10m）之外，
  // 否则整个房间都泡在雾里、高模质感被冲淡（原 6.5 就起雾，实测画面发灰发白）。
  scene.fog = new THREE.Fog(0x1a1512, 15, 48);

  const camTarget = ROOM_BOUNDS.center.clone();
  const camera = createIsoCamera({ frustum: 4.2, aspect: window.innerWidth / window.innerHeight, target: camTarget });

  // —— 后处理（自写 3-pass，非 EffectComposer）——
  const postfx = new PostFX(renderer, cfg.postfx);

  // —— 初始游戏时刻 ——
  // 默认 null = 由 GameClock 锚定本地真实时刻（RUL-4 ①：我晚上打开，屋里就是晚上）
  // 可用 URL 参数覆盖，便于分时段调试与分享特定画面：
  //   ?t=0630  → 按 HHMM 解释为 6:30
  //   ?t=390   → 按分钟数解释为 6:30
  const tRaw = new URLSearchParams(location.search).get('t');
  const initialGameMinutes = (() => {
    if (tRaw == null || tRaw === '') return null;
    const n = Number(tRaw);
    if (!Number.isFinite(n) || n < 0) return null;
    return (tRaw.length === 4 ? Math.floor(n / 100) * 60 + (n % 100) : n) % 1440;
  })();

  // —— 光照循环（4 时段 0.8s 交叉淡入）——
  const lighting = new LightingRig(scene, {
    cfg, roomRadius: ROOM_BOUNDS.radius, center: camTarget,
    gameMinutes: initialGameMinutes ?? 7 * 60,
  });

  // —— 房间 + 猫 ——
  const seed = makeSeed();
  const streams = createStreams(seed);
  const room = buildRoom({ tier: tierName, rng: streams.genesis });
  scene.add(room.group);

  const catModel = buildCat({ tier: tierName });
  scene.add(catModel.group);

  // CatAnimator 的 rng 契约是「函数」（内部 randRange 直接 rng() 取 [0,1)），
  // 与 buildRoom/CatState 期望的「流对象」不同，此处需适配。
  const animator = new CatAnimator({ cat: catModel, rng: () => streams.cosmetic.nextFloat(), autoResolve: true });

  // —— 时钟 / 互动系统 ——
  const clock = new GameClock({ gameMinutes: initialGameMinutes }); // null → 锚定本地真实时刻；?t= 可覆盖
  const interaction = new InteractionSystem({ now: performance.now() });
  const interactionRng = new PCG32((seed ^ 0x55aa55aa) >>> 0);

  // —— 存档（同步写入，零 await）——
  const vault = new SaveVault({ storage: createLocalStorageAdapter(localStorage) });

  // —— UI（默认全隐，召唤后出现）——
  const uiRoot = document.getElementById('ui');
  const hud = new Hud(uiRoot, {
    onTimeScaleChange: (mode) => clock.setTimeScale(mode === 'real' ? 1 : TIME_SCALE),
    onResetSave: () => { try { vault.wipe(); } catch (e) { /* noop */ } location.reload(); },
  });
  const diary = new Diary(uiRoot, { onClose: () => {} });

  // —— 猫状态机 ——
  let cat = new CatState({ rng: streams.core, gameMinutes: clock.gameMinutes });
  // 猫状态变化 → 同步通知互动系统（重置 streak / 拒绝升级）
  cat.on('state', (e) => interaction.onStateChanged(e.state));

  // —— 读取存档 / 离线结算 / 新建 ——
  let isNewGame = true;
  const saved = vault.read();
  if (saved && saved.body && saved.body.cat) {
    isNewGame = false;
    const useSeed = (typeof saved.body.seed === 'number') ? saved.body.seed : seed;
    cat = new CatState({ rng: new PCG32(useSeed >>> 0), gameMinutes: clock.gameMinutes });
    cat.on('state', (e) => interaction.onStateChanged(e.state));
    cat.restore(saved.body.cat);
    if (saved.body.clock) clock.restore(saved.body.clock);
    if (saved.body.interaction) interaction.restore(saved.body.interaction);

    // 离线结算（防作弊：双时间戳 + 回拨检测）
    const offline = GameClock.reconcile({
      savedAtEpoch: saved.body.savedAtEpoch != null ? saved.body.savedAtEpoch : Date.now(),
      monotonicMs: saved.body.monotonicMs != null ? saved.body.monotonicMs : Date.now(),
      nowEpoch: Date.now(),
      nowMonotonic: performance.now(),
      tzOffsetMin: currentTzOffsetMin(),
      savedTzOffsetMin: saved.body.tzOffsetMin != null ? saved.body.tzOffsetMin : currentTzOffsetMin(),
    });
    if (offline.offlineMs > 1500) {
      const off = GameClock.offlineAdvance(offline.offlineMs);
      const settled = settleOffline({
        cat: cat.snapshot(),
        offlineMinutes: off.gameMinutes,
        rng: streams.journal,
        startGameMin: cat.gameMinutes,
        discoveredAnchors: cat.discoveredAnchors,
        clamped: offline.clamped,
      });
      cat.applyOfflineSettlement(settled, settled.report.days);
      clock.applyOffline(off.gameMinutes);
      if (settled.cards.length) diary.show(settled.cards, { offlineMinutes: off.gameMinutes, tier: settled.tier });
    }
  }

  // —— 运行时跑分器（超标降档）——
  let renderCapMs = (tierName === 'L') ? 1000 / 30 : 0; // L 档锁 30fps 渲染
  const benchmark = new FrameBenchmark({
    onDowngrade: () => {
      // 降档：关后处理 + 压 DPR（逻辑仍 30Hz 固定步长）
      postfx.cfg.tiltShift = false;
      postfx.cfg.grading = false;
      postfx.cfg.vignette = false;
      const w = window.innerWidth, h = window.innerHeight;
      r.resize(w, h); // 用档位上限重新解析 DPR
      showError('已为你降低画质以保流畅');
    },
  });

  /* ==========================================================================
   * 2. 猫的世界坐标（锚点间平滑位移）
   * ======================================================================== */

  const catDisplayPos = new THREE.Vector3();
  const catFromPos = new THREE.Vector3();
  const catToPos = new THREE.Vector3();
  let catMoveT = 1;
  let catMoveDur = 0.0001;
  let curAnchorId = null;

  function anchorWorld(id) {
    const a = room.anchors[id] || room.anchors[cat.anchorId] || room.anchors['rug'];
    return a.position;
  }
  function ensureCatAnchor() {
    if (cat.anchorId !== curAnchorId) {
      const target = anchorWorld(cat.anchorId);
      catFromPos.copy(catDisplayPos.lengthSq() === 0 ? target : catDisplayPos);
      catToPos.copy(target);
      const d = catFromPos.distanceTo(catToPos);
      const speed = walkSpeedFor(cat.personality.aff); // 米/秒（AFF 调制）
      catMoveDur = Math.max(0.25, d / Math.max(0.05, speed));
      catMoveT = 0;
      curAnchorId = cat.anchorId;
      animator.setWalkSpeed(cat.personality.aff);
    }
  }

  // 初始就位
  catDisplayPos.copy(anchorWorld(cat.anchorId));
  catModel.group.position.copy(catDisplayPos);
  curAnchorId = cat.anchorId;

  /* ==========================================================================
   * 3. 交互（鼠标 / 触摸 → Raycaster → InteractionSystem 三态）
   * ======================================================================== */

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitboxToInteractable = new Map();
  for (const it of room.interactables) hitboxToInteractable.set(it.hitbox, it);

  let press = null;        // { startMs, target:'cat'|'object', verb, fired, mesh }
  let petting = false;      // 抚摸持续态（L3 满足度）
  let playerIdle = 0;       // 距上次互动的秒数
  let feedback = null;      // { mesh, t } 物件层 L1 反馈

  function pickTarget(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const targets = [catModel.group, ...room.interactables.map((i) => i.hitbox)];
    const hits = raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    for (const h of hits) {
      let o = h.object;
      // 命中猫本体（遍历父链判断是否属于猫）
      let p = o;
      while (p) { if (p === catModel.group) return { target: 'cat', mesh: catModel.group }; p = p.parent; }
      // 命中可交互热盒
      if (hitboxToInteractable.has(o)) {
        const it = hitboxToInteractable.get(o);
        return { target: 'object', verb: it.verb, mesh: it.mesh };
      }
    }
    return null;
  }

  function doInteract(verb) {
    const result = interaction.resolve({
      verb,
      state: cat.state,
      personality: cat.personality,
      rng: interactionRng,
      nowMs: performance.now(),
      env: { bowlFood: cat.env.bowlFood, bowlWater: cat.env.bowlWater, visible: true },
    });
    if (result.objectFeedback && press && press.mesh) {
      feedback = { mesh: press.mesh, t: 0.35 }; // 物件层 L1 反馈（必定给）
    }
    cat.applyInteractionResult(result); // 数值落账 + 状态机 + Ear-ack（猫层 L3）
    playerIdle = 0;
    return result;
  }

  function onPointerDown(e) {
    const pt = (e.touches && e.touches[0]) || e;
    const hit = pickTarget(pt.clientX, pt.clientY);
    if (!hit) return;
    press = { startMs: performance.now(), target: hit.target, verb: hit.verb, fired: false, mesh: hit.mesh };
  }

  function onPointerUp() {
    if (!press) return;
    const held = performance.now() - press.startMs;
    if (press.target === 'cat') {
      if (!press.fired) {
        if (held >= HOLD_REQUIRED_MS.pet) {
          doInteract(VERBS.PET);
          petting = true;
          press.fired = true;
        } else {
          hud.say('它没理会你这下', 1.4); // 太短：仅提示，状态不变
        }
      }
      if (press.fired && press.verb === VERBS.PET) {
        cat.endPetting(0); // 松手回到 REST
        petting = false;
      }
    } else {
      if (!press.fired) doInteract(press.verb);
    }
    press = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', () => { press = null; });
  // 触摸兜底
  canvas.addEventListener('touchstart', (e) => { onPointerDown(e); }, { passive: true });
  canvas.addEventListener('touchend', () => onPointerUp(), { passive: true });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') hud.toggle();
  });

  /* ==========================================================================
   * 4. 存档（零容忍：visibilitychange→hidden 与 pagehide 必须同步写入）
   * ======================================================================== */

  function saveNow() {
    const body = {
      seed,
      cat: cat.snapshot(),
      clock: clock.serialize(),
      interaction: interaction.serialize(),
      monotonicMs: performance.now(),
      tzOffsetMin: currentTzOffsetMin(),
    };
    vault.write(body); // 全程同步，零 await / setTimeout / requestIdleCallback
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', () => saveNow());

  let autosaveAccum = 0;

  /* ==========================================================================
   * 5. 主循环（FixedStepLoop：固定步长 1/30s，与渲染解耦）
   * ======================================================================== */

  let lastRenderMs = performance.now();
  let lastDrawMs = 0;
  let fps = 60;

  const loop = new FixedStepLoop({
    onStep(dt) {
      // dt 恒为 STEP_SECONDS（真实秒）；GameClock 内部按 timeScale 折算游戏分钟（×12）
      clock.advance(dt * 1000);

      playerIdle += dt;

      cat.update(dt, {
        gameMinutes: clock.gameMinutes,
        timeScale: clock.timeScale,
        presence: { online: true, idleSeconds: playerIdle, busy: petting },
        env: {
          bowlFood: cat.env.bowlFood,
          bowlWater: cat.env.bowlWater,
          windowNoise: false,
          toyVisible: cat.env.toyVisible,
          visible: true,
          light: lightForSlot(clock.slot),
        },
      });

      // 抚摸持续态：满足度耗尽 → 强制 REJECT（R4）
      if (petting) {
        const forced = interaction.updatePetting(true, cat.personality, dt);
        if (forced) { cat.endPetting(4); petting = false; }
      }

      // 定期自动存档
      autosaveAccum += dt;
      if (autosaveAccum >= 20) { autosaveAccum = 0; saveNow(); }
    },

    onRender(alpha) {
      const now = performance.now();
      const frameMs = now - lastRenderMs;
      lastRenderMs = now;
      fps = fps * 0.9 + (1000 / Math.max(1, frameMs)) * 0.1;

      // L 档渲染锁 30fps（逻辑仍 30Hz 固定步长）
      if (renderCapMs > 0 && (now - lastDrawMs) < renderCapMs - 4) return;
      lastDrawMs = now;

      // 猫在锚点间平滑位移
      ensureCatAnchor();
      if (catMoveT < 1) {
        catMoveT = clamp(catMoveT + (frameMs / 1000) / catMoveDur, 0, 1);
        const w = easeInOutCubic(catMoveT);
        catDisplayPos.lerpVectors(catFromPos, catToPos, w);
      }
      catModel.group.position.copy(catDisplayPos);
      // 面向房间中心
      const dx = camTarget.x - catDisplayPos.x;
      const dz = camTarget.z - catDisplayPos.z;
      catModel.group.rotation.y = Math.atan2(dx, dz);

      // 姿态过渡 + 次级动画
      animator.update(frameMs / 1000, cat);

      // 光照循环
      lighting.update(clock.gameMinutes, frameMs / 1000);

      // HUD
      hud.update(frameMs / 1000, { gameMinutes: clock.gameMinutes, catState: cat, tierName, fps });

      // 物件层 L1 反馈（极轻 emissive 脉冲）
      if (feedback) {
        feedback.t -= frameMs / 1000;
        const k = Math.max(0, feedback.t / 0.35);
        const mat = feedback.mesh && feedback.mesh.material;
        if (mat && mat.emissive) {
          mat.emissive.setRGB(0.18 * k, 0.12 * k, 0.06 * k);
        }
        if (feedback.t <= 0) {
          if (mat && mat.emissive) mat.emissive.setRGB(0, 0, 0);
          feedback = null;
        }
      }

      // 后处理渲染（enabled=false 时直通）
      postfx.render(scene, camera, now / 1000);

      benchmark.sample(frameMs);
    },
  });

  /* ==========================================================================
   * 6. 尺寸 / 旋转
   * ======================================================================== */

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = resolveDPR(tierName, window.devicePixelRatio || 1, w, h, null);
    r.resize(w, h);
    updateIsoCameraAspect(camera, w / h, 4.2);
    postfx.setSize(w, h, dpr, cfg.msaaSamples);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
  onResize();

  /* ==========================================================================
   * 7. 启动
   * ======================================================================== */

  if (isNewGame) hud.firstRunHint();

  app = { renderer, scene, camera, postfx, lighting, room, catModel, animator, clock, interaction, vault, hud, diary, cat };

  hideLoading();

  // rAF 驱动（FixedStepLoop 内部解耦逻辑/渲染）
  let running = true;
  function frame(nowMs) {
    if (!running) return;
    requestAnimationFrame(frame);
    try {
      loop.frame(nowMs);
    } catch (err) {
      running = false;
      showError('渲染中断：' + (err && err.message));
      // 不强杀页面，给出一次提示后停止循环
      console.error(err);
    }
  }
  requestAnimationFrame(frame);

  // 调试入口
  window.__EAVES__ = app;
}

/* ============================================================================
 * 启动（捕获引导期异常，避免白屏）
 * ========================================================================== */
try {
  boot();
} catch (err) {
  console.error(err);
  showError('初始化失败：' + (err && err.message));
  showUpgrade();
  throw err;
}
