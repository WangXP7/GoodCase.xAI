/* =====================================================================
   15. 主游戏
   ===================================================================== */

const SETTINGS = {
  renderDistance: 8,
  fov: 70,
  brightness: 50,
  smoothLighting: true,
  viewBob: true,
  dayCycle: true,
  deco: true,
  caves: true,
  ores: true,
  clouds: true,
  sound: true,
};

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.renderer = null;
    this.world = null;
    this.player = null;
    this.particles = new Particles(2400);
    this.drops = [];
    this.sfx = new Sfx();

    this.keys = Object.create(null);
    this.input = { forward: 0, back: 0, left: 0, right: 0, jump: false, sneak: false, sprint: false };
    this.mouseLeft = false;
    this.mouseRight = false;

    this.hotbar = [];
    this.selected = 0;
    this.hit = null;
    this.mining = null;
    this.placeCooldown = 0;
    this.attackCooldown = 0;
    this.debugOn = false;
    this.menuOpen = false;
    this.invOpen = false;
    this.pointerLocked = false;

    this.time = 0;
    this.fps = 0; this._fpsAcc = 0; this._fpsN = 0; this._fpsT = 0;
    this.last = 0;
    this.chunkLoadIndex = 0;
    this.loadList = [];
    this.lastCX = 1e9; this.lastCZ = 1e9;
    this.stats = { drawnChunks: 0, tris: 0 };
    this._stepTimer = 0;
    this._splashCooldown = 0;
    this.lastChunkWork = 0;
    this.frames = 0;
  }

  /* ============ 初始化 ============ */
  async boot(onProgress) {
    const rep = (p, msg) => { onProgress && onProgress(p, msg); return new Promise(r => setTimeout(r, 0)); };

    await rep(0.04, '生成纹理…');
    buildTextures();
    registerBlocks();
    initCullSets();
    computeBlockColors();
    buildStatusIcons();
    this._cloudPixels = buildCloudTexture();

    await rep(0.22, '初始化 WebGL2…');
    this.renderer = new Renderer(this.canvas);
    this.renderer.initOverlay();
    const packed = packTextureArray(TEX_LAYERS);
    this.renderer._atlasCPU = packed.data;
    this.renderer.uploadAtlas(packed);
    this.renderer.upload2D('sun', TEX_LAYERS[TEX_INDEX['sun']].px, {});
    this.renderer.upload2D('moon', TEX_LAYERS[TEX_INDEX['moon']].px, {});
    this.renderer.upload2D('particle', TEX_LAYERS[TEX_INDEX['particle']].px, {});
    this.renderer.texCloud = this.renderer.upload2D('cloud', this._cloudPixels, { repeat: true, smooth: false, mipmap: true, aniso: 4 });
    this.renderer.makeStars();

    await rep(0.40, '生成世界…');
    this.newWorld(Date.now() & 0x7fffffff);

    await rep(0.62, '构建出生点地形…');
    this.preloadSpawn();

    await rep(0.86, '编译着色器…');
    await rep(0.94, '准备就绪');
    this.renderer.renderDistance = SETTINGS.renderDistance;
    this.player.baseFov = SETTINGS.fov;
    this.player.fovBase = SETTINGS.fov;
    this.player.bobEnabled = SETTINGS.viewBob;
    this.applySettings();
  }

  newWorld(seed, flat) {
    const opts = { caves: SETTINGS.caves, deco: SETTINGS.deco, ores: SETTINGS.ores, flat: !!flat };
    if (this.world && this.renderer) {
      for (const [k, c] of this.world.chunks) c.freeGL(this.renderer.gl);
    }
    this.world = new World(seed, opts);
    this.world.renderDistance = SETTINGS.renderDistance;
    this.player = new Player(this.world);
    this.drops.length = 0;
    this.particles.clear();
    this.hit = null;
    this.mining = null;
    this.loadList = [];
    this.chunkLoadIndex = 0;
    this.lastCX = 1e9; this.lastCZ = 1e9;

    // 出生点
    const sp = this.findSpawn();
    this.player.pos = [sp[0], sp[1], sp[2]];
    this.player.spawn = sp.slice();
    this.player.yaw = 0.6;
    this.player.pitch = -0.12;

    this.hotbar = [
      BID.grass_block, BID.dirt, BID.stone, BID.cobblestone,
      BID.oak_planks, BID.oak_log, BID.glass, BID.torch, BID.sand,
    ];
    this.selected = 0;
    this.refreshHotbar();
    this.selectSlot(0);
  }

  refreshHotbar() {
    for (let i = 0; i < 9; i++) {
      const b = BLOCKS[this.hotbar[i]];
      UI.setSlotImg(i, (b && b.tab !== 0) ? b : null);
    }
  }

  findSpawn() {
    const w = this.world;
    for (let r = 0; r < 260; r += 6) {
      for (let a = 0; a < 10; a++) {
        const ang = a / 10 * TAU + r * 0.17;
        const x = Math.round(Math.cos(ang) * r);
        const z = Math.round(Math.sin(ang) * r);
        const h = Math.round(terrainHeightRaw(w, x, z));
        if (h <= SEA_LEVEL + 2 || h > SEA_LEVEL + 26) continue;
        const b = biomeAt(w, x, z, h);
        if (b === BIOME.OCEAN || b === BIOME.BEACH) continue;
        // 避开树的位置，免得一出生就被埋在树干里
        if (treeAt(w, x, z, b, h)) continue;
        return [x + 0.5, h + 1.05, z + 0.5];
      }
    }
    return [0.5, 78, 0.5];
  }

  preloadSpawn() {
    const px = Math.floor(this.player.pos[0] / 16);
    const pz = Math.floor(this.player.pos[2] / 16);
    const R = 3;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const c = this.world.createChunk(px + dx, pz + dz);
      initChunkLight(this.world, c);
      wakeNeighborLight(this.world, c);
    }
    // 立即完成光照与网格
    processLightQueue(this.world, 1e9, 1e9);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const c = this.world.getChunk(px + dx, pz + dz);
      if (c) buildChunkMesh(this.world, c, this.renderer.gl, SETTINGS);
    }
    // 落地：以地形高度为准，避免站到树冠上
    const hh = Math.round(terrainHeightRaw(this.world, this.player.pos[0], this.player.pos[2]));
    for (let y = hh + 3; y > 0; y--) {
      if (this.world.isSolid(Math.floor(this.player.pos[0]), y, Math.floor(this.player.pos[2]))) {
        this.player.pos[1] = y + 1.05;
        break;
      }
    }
  }

  applySettings() {
    if (!this.renderer || !this.world || !this.player) return;
    this.renderer.renderDistance = SETTINGS.renderDistance;
    this.world.renderDistance = SETTINGS.renderDistance;
    this.player.baseFov = SETTINGS.fov;
    this.player.fovBase = SETTINGS.fov;
    this.player.bobEnabled = SETTINGS.viewBob;
    this.renderer.brightness = 0.35 + SETTINGS.brightness / 100 * 1.25;
    this.sfx.setVolume(SETTINGS.sound ? 0.55 : 0);
    this.sfx.enabled = SETTINGS.sound;
  }

  /* ============ 区块调度 ============ */
  updateLoadList() {
    const pcx = Math.floor(this.player.pos[0] / 16);
    const pcz = Math.floor(this.player.pos[2] / 16);
    if (pcx === this.lastCX && pcz === this.lastCZ && this.loadList.length) return;
    this.lastCX = pcx; this.lastCZ = pcz;
    const R = SETTINGS.renderDistance;
    const list = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > (R + 0.4) * (R + 0.4)) continue;
        const cx = pcx + dx, cz = pcz + dz;
        if (!this.world.hasChunk(cx, cz)) list.push([d2, cx, cz]);
      }
    }
    list.sort((a, b) => a[0] - b[0]);
    this.loadList = list;
    this.chunkLoadIndex = 0;

    // 卸载过远区块
    const lim = R + 2;
    const toDel = [];
    for (const [k, c] of this.world.chunks) {
      if (Math.abs(c.cx - pcx) > lim || Math.abs(c.cz - pcz) > lim) toDel.push(c);
    }
    for (const c of toDel) {
      c.freeGL(this.renderer.gl);
      this.world.chunks.delete(this.world.key(c.cx, c.cz));
    }
  }

  processChunks(budgetMs) {
    const t0 = performance.now();
    const W = this.world, gl = this.renderer.gl;

    // 1) 地形生成（最先，保证有东西可看）
    let gen = 0;
    while (this.chunkLoadIndex < this.loadList.length) {
      if (gen >= 2 || performance.now() - t0 > budgetMs * 0.62) break;
      const entry = this.loadList[this.chunkLoadIndex++];
      const cx = entry[1], cz = entry[2];
      if (W.hasChunk(cx, cz)) continue;
      const c = W.createChunk(cx, cz);
      initChunkLight(W, c);
      wakeNeighborLight(W, c);
      gen++;
    }

    // 2) 光照扩散（严格限时，且绝不允许吃掉网格时间）
    processLightQueue(W, 1e9, Math.max(1.2, budgetMs * 0.30));

    // 3) 网格构建（3x3 邻居必须已生成）
    const pcx = Math.floor(this.player.pos[0] / 16);
    const pcz = Math.floor(this.player.pos[2] / 16);
    const R = SETTINGS.renderDistance;
    const pending = [];
    for (const [k, c] of W.chunks) {
      if (!c.dirtyMesh) continue;
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (R + 1.5) * (R + 1.5)) continue;
      let ready = true;
      for (let z = -1; z <= 1 && ready; z++) for (let x = -1; x <= 1; x++) {
        if (!W.hasChunk(c.cx + x, c.cz + z)) { ready = false; break; }
      }
      if (!ready) continue;
      pending.push([dx * dx + dz * dz, c]);
    }
    pending.sort((a, b) => a[0] - b[0]);
    let built = 0;
    for (const [, c] of pending) {
      if (performance.now() - t0 > budgetMs) break;
      buildChunkMesh(W, c, gl, SETTINGS);
      built++;
      if (built >= 3) break;
    }

    // 4) 强制首帧：如果视野内一个网格都没有，至少建一个
    if (built === 0 && this.frames < 4) {
      const c0 = W.getChunk(pcx, pcz);
      if (c0 && c0.dirtyMesh) buildChunkMesh(W, c0, gl, SETTINGS);
    }
    this.lastChunkWork = performance.now() - t0;
  }

  /* ============ 输入 ============ */
  bindInput() {
    const canvas = this.canvas;

    canvas.addEventListener('mousedown', e => {
      if (!this.pointerLocked) { this.requestLock(); return; }
      if (e.button === 0) { this.mouseLeft = true; this.startMining(); }
      else if (e.button === 2) { this.mouseRight = true; this.doPlace(); }
      else if (e.button === 1) {
        e.preventDefault();
        if (this.hit) {
          const b = BLOCKS[this.hit.id];
          if (b && b.tab !== 0) this.pickBlock(this.hit.id);
        }
      }
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) { this.mouseLeft = false; this.mining = null; this._mineSoundT = 0; }
      if (e.button === 2) this.mouseRight = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('mousemove', e => {
      if (!this.pointerLocked || this.menuOpen || this.invOpen) return;
      const sens = 0.0022;
      this.player.yaw -= e.movementX * sens;
      this.player.pitch -= e.movementY * sens;
      const lim = Math.PI / 2 - 0.0008;
      this.player.pitch = clamp(this.player.pitch, -lim, lim);
      this.player.yaw = ((this.player.yaw % TAU) + TAU) % TAU;
    });

    canvas.addEventListener('wheel', e => {
      if (this.menuOpen || this.invOpen) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      this.selectSlot((this.selected + dir + 9) % 9);
    }, { passive: false });

    window.addEventListener('keydown', e => {
      if (e.repeat && e.code !== 'KeyW') { this._updateInputState(e.code, true); return; }
      this._updateInputState(e.code, true);
      switch (e.code) {
        case 'Escape':
          if (this.invOpen) this.closeInventory();
          else this.toggleMenu();
          break;
        case 'KeyE':
          if (!this.menuOpen) { this.invOpen ? this.closeInventory() : this.openInventory(); }
          break;
        case 'F3': this.debugOn = !this.debugOn; e.preventDefault(); break;
        case 'F5': this.cycleView(); e.preventDefault(); break;
        case 'KeyR': if (this.player.creative || this.player.dead) this.player.respawn(); break;
        case 'Space': e.preventDefault(); break;
        default: break;
      }
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) this.selectSlot(n - 1);
      }
    });
    window.addEventListener('keyup', e => this._updateInputState(e.code, false));
    window.addEventListener('blur', () => { this.keys = Object.create(null); this.applyKeys(); });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked && !this.menuOpen && !this.invOpen && this.running) {
        this.toggleMenu();
      }
    });
  }

  _updateInputState(code, down) {
    this.keys[code] = down;
    this.applyKeys();
    // 双击 W 疾跑
    if (code === 'KeyW' && down) {
      const now = performance.now();
      if (this._lastW && now - this._lastW < 280) { this.sprintToggle = true; }
      this._lastW = now;
    }
    if (code === 'KeyW' && !down) this.sprintToggle = false;
    // 双击空格切换飞行
    if (code === 'Space' && down) {
      const now = performance.now();
      if (this._lastSpace && now - this._lastSpace < 300 && this.player.creative) {
        this.player.flying = !this.player.flying;
        this.player.vel[1] = 0;
        UI.toast(this.player.flying ? '飞行模式：开' : '飞行模式：关');
      }
      this._lastSpace = now;
    }
  }

  applyKeys() {
    const K = this.keys;
    this.input.forward = K['KeyW'] ? 1 : 0;
    this.input.back = K['KeyS'] ? 1 : 0;
    this.input.left = K['KeyA'] ? 1 : 0;
    this.input.right = K['KeyD'] ? 1 : 0;
    this.input.jump = !!K['Space'];
    this.input.sneak = !!(K['ShiftLeft'] || K['ShiftRight']);
    this.input.sprint = !!(K['ControlLeft'] || K['ControlRight']) || !!this.sprintToggle;
    this.player.sprinting = this.input.sprint && (this.input.forward || this.input.back || this.input.left || this.input.right);
  }

  requestLock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
    this.sfx.ensure();
  }

  /* ============ 游戏行为 ============ */
  updateHit() {
    const cam = this.player.camera();
    const dir = lookDir(cam.yaw, cam.pitch, [0, 0, 0]);
    const reach = this.player.creative ? 5.0 : 4.5;
    this.hit = raycastVoxel(this.world, cam.x, cam.y, cam.z, dir[0], dir[1], dir[2], reach, false);
    UI.hitFeedback(false);
  }

  startMining() {
    if (!this.hit) return;
    const b = BLOCKS[this.hit.id];
    const held = BLOCKS[this.hotbar[this.selected]];
    const t = this.player.creative ? 0.18 : breakTime(b, held);
    if (b.hardness < 0) return;
    this.mining = { x: this.hit.x, y: this.hit.y, z: this.hit.z, t: 0, time: t, id: this.hit.id };
    this.player.startSwing();
    if (this.player.creative) {
      // 创造模式：立即破坏
      this.mining.t = t;
    }
  }

  updateMining(dt) {
    if (this.mouseLeft && this.hit && !this.mining) this.startMining();
    const m = this.mining;
    if (!m) return;
    if (!this.hit || this.hit.x !== m.x || this.hit.y !== m.y || this.hit.z !== m.z || this.hit.id !== m.id) {
      this.mining = null;
      return;
    }
    m.t += dt;
    this._mineSoundT = (this._mineSoundT || 0) + dt;
    if (this._mineSoundT > 0.22) {
      this._mineSoundT = 0;
      const B = BLOCKS[m.id];
      this.sfx.dig(B ? B.sound : 'stone');
      const cam = this.player.camera();
      const dir = lookDir(cam.yaw, cam.pitch, [0, 0, 0]);
      if (Math.random() < 0.6) this.particles.spawnHit(this.world, m.x, m.y, m.z, this.hit.face, B, 2);
    }
    if (m.t >= m.time) {
      this.breakBlock(m.x, m.y, m.z, true);
      if (!this.player.creative) this.player.startSwing();
      this.mining = null;
      if (this.mouseLeft) this.startMining();
    }
  }

  breakProgress() {
    if (!this.mining) return -1;
    const p = clamp(this.mining.t / this.mining.time, 0, 1);
    if (p <= 0) return -1;
    return Math.min(9, Math.floor(p * 10));
  }

  breakBlock(x, y, z, drop) {
    const W = this.world;
    const id = W.getBlock(x, y, z);
    if (id <= 0) return;
    const B = BLOCKS[id];
    if (B.hardness < 0) return;

    this.particles.spawnBreak(W, x, y, z, B, 22);
    this.sfx.breakBlock(B.sound);

    // 破坏上方的植物
    const above = W.getBlock(x, y + 1, z);
    if (above > 0 && BLOCKS[above].render === 'cross') {
      W.setBlock(x, y + 1, z, 0);
      this.particles.spawnBreak(W, x, y + 1, z, BLOCKS[above], 10);
    }
    const above2 = W.getBlock(x, y + 2, z);
    if (above > 0 && above2 > 0 && BLOCKS[above2].render === 'cross') W.setBlock(x, y + 2, z, 0);

    W.setBlock(x, y, z, 0);

    // 掉落物
    if (drop && B.tab !== 0) {
      let dropId = id;
      if (B.drops && B.drops.item) {
        if (B.drops.chance === undefined || Math.random() < B.drops.chance) dropId = BID[B.drops.item];
        else dropId = id;
      } else if (B.drops && B.drops.item === undefined) dropId = id;
      if (!B.dropSelf && B.drops && B.drops.item) dropId = BID[B.drops.item];
      const db = BLOCKS[dropId];
      if (db && db.tab !== 0) {
        this.drops.push(new DropEntity(x + 0.5, y + 0.32, z + 0.5, dropId));
      }
    }
  }

  doPlace() {
    if (!this.hit) return;
    if (this.placeCooldown > 0) return;
    const pos = placementPos(this.hit);
    if (pos.y < 0 || pos.y >= CH_Y) return;
    const W = this.world;
    const cur = W.getBlock(pos.x, pos.y, pos.z);
    if (cur > 0 && !BLOCKS[cur].fluid && BLOCKS[cur].render !== 'cross') return;
    const bid = this.hotbar[this.selected];
    if (!bid) return;
    const B = BLOCKS[bid];
    if (!B || B.tab === 0) return;
    if (placementBlocked(this.player, pos.x, pos.y, pos.z, B)) return;
    W.setBlock(pos.x, pos.y, pos.z, bid, 0);
    this.sfx.place(B.sound);
    this.player.startSwing();
    this.placeCooldown = 0.22;
    // 新增光源 → 光照已由 setBlock 处理
  }

  pickBlock(id) {
    const slot = this.hotbar.indexOf(id);
    if (slot >= 0) { this.selectSlot(slot); return; }
    this.hotbar[this.selected] = id;
    UI.setSlotImg(this.selected, BLOCKS[id]);
    this.selectSlot(this.selected);
    UI.showItemName(BLOCKS[id].display);
  }

  selectSlot(i) {
    this.selected = i;
    UI.selectSlot(i);
    const b = BLOCKS[this.hotbar[i]];
    if (b && b.tab !== 0) UI.showItemName(b.display);
  }

  cycleView() {
    this.viewMode = ((this.viewMode || 0) + 1) % 3;
    UI.toast(['第一人称', '第三人称（背后）', '第三人称（正面）'][this.viewMode]);
  }

  /* ============ 主循环 ============ */
  start() {
    this.running = true;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.08);
    this.last = now;
    this.time += dt;
    this.frames++;

    // FPS
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.4) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }

    if (!this.menuOpen && !this.invOpen) {
      this.updateGame(dt);
    }
    this.tickWork(dt);
    this.render(dt);

    requestAnimationFrame(this.loop);
  }

  updateGame(dt) {
    const W = this.world, P = this.player;

    if (SETTINGS.dayCycle) W.time = (W.time + dt / 1200) % 1;

    this.updateHit();
    P.update(dt, this.input, W);

    // 脚下踩空 / 入水音效
    const feet = W.getBlock(Math.floor(P.pos[0]), Math.floor(P.pos[1] + 0.1), Math.floor(P.pos[2]));
    if (feet > 0) {
      const FB = BLOCKS[feet];
      if (FB.fluid) {
        this._splashCooldown -= dt;
        if (this._splashCooldown <= 0) {
          this._splashCooldown = 0.35;
          this.sfx.swim();
          if (Math.random() < 0.5) this.particles.spawnSplash(W, P.pos[0], P.pos[1] + 0.3, P.pos[2], 5);
        }
      } else if (P.onGround) {
        const spd = Math.hypot(P.vel[0], P.vel[2]);
        this._stepTimer += dt * (0.6 + spd);
        if (this._stepTimer > (P.sprinting ? 0.26 : 0.34)) {
          this._stepTimer = 0;
          this.sfx.step(FB.sound, P.sprinting);
        }
      }
    }

    // 挖掘 / 放置
    this.placeCooldown -= dt;
    this.updateMining(dt);
    if (this.mouseRight) this.doPlace();

    // 攻击（生存模式下打掉落物不算）
    // 掉落物
    const cam = P.camera();
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.update(dt, W);
      if (d.dead) { this.drops.splice(i, 1); continue; }
      const dx = d.x - P.pos[0], dy = d.y - (P.pos[1] + 0.9), dz = d.z - P.pos[2];
      if (d.pickupDelay <= 0 && dx * dx + dy * dy + dz * dz < 1.6) {
        this.drops.splice(i, 1);
        this.sfx.pop();
        UI.toast('+' + BLOCKS[d.block].display);
      }
    }

    // 粒子
    this.particles.update(dt, W);

    // 受伤反馈
    if (P.hurtTime > 0.5) UI.flashDamage();
  }

  tickWork(dt) {
    this.updateLoadList();
    const budget = this.frames < 8 ? 26 : 9;
    this.processChunks(budget);
    this.particles.update(0, this.world);
    UI.updateItemName(dt);
    this.updateHUD(dt);
    this.updateDebug();
  }

  updateHUD(dt) {
    const P = this.player;
    UI.setHealth(P.health, P.maxHealth, P.hurtTime);
    UI.setFood(P.food);
    UI.setAir(P.air, P.maxAir, P.creative);

    // 水下 / 岩浆 屏幕滤镜
    const blk = this.world.getBlock(Math.floor(P.camera().x), Math.floor(P.camera().y), Math.floor(P.camera().z));
    const inLava = blk > 0 && blk === BID.lava;
    if (inLava) UI.setOverlay('0.62', 'rgba(190,72,12,0.62)');
    else if (P.headInWater) UI.setOverlay('0.34', 'rgba(24,74,160,0.55)');
    else UI.setOverlay('0');

    // 经验条
    const xpFill = document.getElementById('xpFill');
    const xpLvl = document.getElementById('xpLvl');
    if (xpFill) xpFill.style.width = (P.xp * 100) + '%';
    if (xpLvl) { xpLvl.textContent = P.xpLevel; xpLvl.style.display = P.xpLevel > 0 ? '' : 'none'; }
  }

  updateDebug() {
    if (!this.debugOn) { UI.setDebug(false); return; }
    const P = this.player, W = this.world;
    const bx = Math.floor(P.pos[0]), by = Math.floor(P.pos[1]), bz = Math.floor(P.pos[2]);
    const biome = W.getBiome(bx, bz);
    const look = lookDir(P.yaw, P.pitch, [0, 0, 0]);
    const facing = (() => {
      const y = ((P.yaw % TAU) + TAU) % TAU;
      const idx = Math.round(y / (Math.PI / 4)) % 8;
      return ['南 (+Z)', '西南', '西 (-X)', '西北', '北 (-Z)', '东北', '东 (+X)', '东南'][idx];
    })();
    const skyL = getSkyLight(W, bx, by + 1, bz);
    const blkL = getBlockLight(W, bx, by + 1, bz);
    const lines = [
      'Minecraft JS Edition  ' + (this.fps.toFixed(0)) + ' fps',
      'XYZ: ' + P.pos[0].toFixed(3) + ' / ' + P.pos[1].toFixed(5) + ' / ' + P.pos[2].toFixed(3),
      'Block: ' + bx + ' ' + by + ' ' + bz,
      'Chunk: ' + (bx >> 4) + ' ' + (by >> 4) + ' ' + (bz >> 4) + '  (rel ' + (bx & 15) + ' ' + (by & 15) + ' ' + (bz & 15) + ')',
      'Facing: ' + facing + '  (' + (P.yaw / DEG).toFixed(1) + ' / ' + (P.pitch / DEG).toFixed(1) + ')',
      'Biome: ' + BIOME_NAME[biome] + ' (' + BIOME_NAME_EN[biome] + ')',
      'Light: ' + skyL + ' sky, ' + blkL + ' block',
      'Time: ' + fmtTime(W.time) + '  Day ' + (Math.floor(this.time / 1200) + 1),
      'Seed: ' + W.seed,
      'Mode: ' + (P.creative ? '创造' : '生存') + (P.flying ? ' (飞行)' : ''),
    ];
    const r = [
      'Chunks: ' + W.chunks.size + ' loaded',
      'Rendered: ' + this.stats.drawnChunks + '  Tris: ' + fmtNum(this.stats.tris),
      'ChunkWork: ' + this.lastChunkWork.toFixed(1) + ' ms',
      'Particles: ' + this.particles.list.length + '  Drops: ' + this.drops.length,
      'Queue: ' + Math.max(0, this.loadList.length - this.chunkLoadIndex) + ' pending',
      'Draw: ' + this.stats.drawCalls,
      'Mem: ' + (performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB' : 'n/a'),
      '',
      '渲染距离: ' + SETTINGS.renderDistance + '  平滑光照: ' + (SETTINGS.smoothLighting ? '开' : '关'),
      '模型内存: ' + this.estimateMeshMB().toFixed(1) + ' MB',
    ];
    UI.setDebug(true, lines.join('\n'), r.join('\n'));
  }

  estimateMeshMB() {
    let b = 0;
    for (const [, c] of this.world.chunks) {
      if (c.mesh) b += c.mesh.count * 4 + c.mesh.verts * VERT_BYTES;
      if (c.meshWater) b += c.meshWater.count * 4 + c.meshWater.verts * VERT_BYTES;
    }
    return b / 1048576;
  }

  /* ============ 渲染 ============ */
  render(dt) {
    const gl = this.renderer.gl;
    const R = this.renderer;
    const P = this.player;
    R.renderDistance = SETTINGS.renderDistance;

    R.resize();
    const cam = P.camera();
    R.setCamera(cam);

    const camBlock = this.world.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z));
    const underwater = camBlock > 0 && BLOCKS[camBlock].name === 'water';
    const sky = R.computeSky(this.world, underwater);
    R.applyEnv(sky, { brightness: 0.35 + SETTINGS.brightness / 100 * 1.25, underwater });
    R.time = this.time;

    // 收集需要渲染的区块
    const chunks = [];
    for (const [, c] of this.world.chunks) {
      if (!c.mesh && !c.meshWater) continue;
      chunks.push(c);
    }

    gl.clearColor(sky.horizon[0], sky.horizon[1], sky.horizon[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.disable(gl.BLEND);

    R.drawSky(sky);
    R.drawCelestial(sky, cam);
    R.drawClouds(sky, cam, this.time, SETTINGS.clouds);

    let drawCalls = 0;
    R.drawOpaque(this.world, cam, chunks, this.stats);
    drawCalls += this.stats.drawnChunks;
    drawCalls += R.drawWater(this.world, cam, chunks);

    // 选中框与裂纹
    if (!this.menuOpen && !this.invOpen) {
      R.drawSelection(this.hit);
      R.drawBreakOverlay(this.hit, this.breakProgress());
    }

    this.particles.render(R, cam);

    // 掉落物
    if (this.drops.length) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      const r9 = new Float32Array(9);
      for (const d of this.drops) {
        const bob = Math.sin(d.age * 2.2) * 0.06;
        const co = Math.cos(d.rot), si = Math.sin(d.rot);
        r9[0] = co; r9[1] = 0; r9[2] = -si;
        r9[3] = 0; r9[4] = 1; r9[5] = 0;
        r9[6] = si; r9[7] = 0; r9[8] = co;
        R.drawBlockCube(BLOCKS[d.block], d.x - 0.5, d.y + bob - 0.5, d.z - 0.5, 0.28, r9, [1, 1, 1, 1]);
        drawCalls++;
      }
      gl.enable(gl.CULL_FACE);
    }

    // 手持物品
    if (!(this.viewMode === 1 || this.viewMode === 2)) {
      const held = BLOCKS[this.hotbar[this.selected]];
      if (held && held.tab !== 0) {
        R.drawHand(P, held, sky);
        drawCalls++;
      }
    }

    // 屏幕叠加
    if (underwater) R.drawSolidOverlay([0.09, 0.26, 0.55, 0.20]);
    this.stats.drawCalls = drawCalls;
  }

  /* ============ 菜单 / 界面 ============ */
  toggleMenu() {
    if (this.invOpen) this.closeInventory();
    this.menuOpen = !this.menuOpen;
    document.getElementById('menuScreen').classList.toggle('hide', !this.menuOpen);
    if (this.menuOpen) document.exitPointerLock && document.exitPointerLock();
    else this.requestLock();
  }

  closeMenu() {
    this.menuOpen = false;
    document.getElementById('menuScreen').classList.add('hide');
    this.requestLock();
  }

  openInventory() {
    this.invOpen = true;
    document.getElementById('invScreen').classList.remove('hide');
    document.exitPointerLock && document.exitPointerLock();
    this.buildInventory();
  }
  closeInventory() {
    this.invOpen = false;
    document.getElementById('invScreen').classList.add('hide');
    this.requestLock();
  }

  buildInventory(filter) {
    const grid = document.getElementById('invGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const f = (filter || '').trim().toLowerCase();
    const list = [];
    for (let i = 0; i < BLOCKS.length; i++) {
      const b = BLOCKS[i];
      if (b.tab === 0) continue;
      if (!b.tex) continue;
      if (f) {
        const hay = (b.name + ' ' + b.display + ' ' + b.displayEn).toLowerCase();
        if (!hay.includes(f)) continue;
      }
      list.push(b);
    }
    for (const b of list) {
      const d = document.createElement('div');
      d.className = 'icell';
      d.title = b.display + ' / ' + b.displayEn;
      const img = document.createElement('img');
      img.src = blockIcon(b);
      d.appendChild(img);
      d.addEventListener('click', () => {
        this.hotbar[this.selected] = b.id;
        UI.setSlotImg(this.selected, b);
        UI.showItemName(b.display);
        this.closeInventory();
      });
      grid.appendChild(d);
    }
  }
}
