/* =====================================================================
   14. 界面：方块图标 · 快捷栏 · 状态条 · 调试屏 · 菜单
   ===================================================================== */

/* ---------- 纹理 → 离屏 canvas ---------- */
const LAYER_CANVAS = new Map();
function layerCanvas(layer) {
  if (LAYER_CANVAS.has(layer)) return LAYER_CANVAS.get(layer);
  const L = TEX_LAYERS[layer];
  if (!L) return null;
  const c = document.createElement('canvas');
  c.width = L.px.w; c.height = L.px.h;
  const g = c.getContext('2d');
  g.putImageData(new ImageData(new Uint8ClampedArray(L.px.d), L.px.w, L.px.h), 0, 0);
  LAYER_CANVAS.set(layer, c);
  return c;
}

/* ---------- 等距方块图标 ---------- */
const ICON_CACHE = new Map();
function blockIcon(block, size = 64) {
  const key = block.id;
  if (ICON_CACHE.has(key)) return ICON_CACHE.get(key);

  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  if (block.render !== 'cube' && block.render !== 'liquid') {
    // 非立方体（植物 / 火把）直接铺平显示
    const l = block.tex.all;
    const lc = layerCanvas(l);
    if (lc) g.drawImage(lc, 4, 4, size - 8, size - 8);
    const url = c.toDataURL();
    ICON_CACHE.set(key, url);
    return url;
  }

  const s = size / 36.5;
  const cos30 = 0.8660254, sin30 = 0.5;
  const w = 16 * s * cos30;
  const hh = 16 * s * sin30;
  const topH = 16 * s;
  const totalH = 2 * hh + topH;
  const nx = size / 2, ny = (size - totalH) / 2;

  const topL = block.tex.top !== undefined ? block.tex.top : block.tex.all;
  const sideL = block.tex.side !== undefined ? block.tex.side : block.tex.all;
  const frontL = block.tex.north !== undefined ? block.tex.north : sideL;

  const cTop = layerCanvas(topL);
  const cSide = layerCanvas(sideL);
  const cFront = layerCanvas(frontL);

  // 东侧面（+X）
  g.save();
  g.setTransform(cos30 * s, -sin30 * s, 0, s, nx, ny + 2 * hh);
  if (cSide) g.drawImage(cSide, 0, 0);
  g.restore();
  // 南侧面（+Z）
  g.save();
  g.setTransform(cos30 * s, sin30 * s, 0, s, nx - w, ny + hh);
  if (cFront) g.drawImage(cFront, 0, 0);
  g.restore();
  // 顶面
  g.save();
  g.setTransform(cos30 * s, sin30 * s, -cos30 * s, sin30 * s, nx, ny);
  if (cTop) g.drawImage(cTop, 0, 0);
  g.restore();
  g.setTransform(1, 0, 0, 1, 0, 0);

  const url = c.toDataURL();
  ICON_CACHE.set(key, url);
  return url;
}

/* ---------- 像素遮罩图标（心 / 饥饿 / 气泡） ---------- */
function maskIcon(mask, fill, stroke, size) {
  const h = mask.length, w = mask[0].length;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const put = (x, y, col) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
  };
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y][x] === 'X';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (on(x, y)) put(x, y, fill);
    else if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1) ||
             on(x - 1, y - 1) || on(x + 1, y + 1) || on(x - 1, y + 1) || on(x + 1, y - 1))) put(x, y, stroke);
  }
  g.putImageData(img, 0, 0);
  const c2 = document.createElement('canvas');
  c2.width = size; c2.height = size;
  const g2 = c2.getContext('2d');
  g2.imageSmoothingEnabled = false;
  g2.drawImage(c, 0, 0, size, size);
  return c2.toDataURL();
}

const HEART_MASK = [
  '  XX XX  ',
  ' XXXXXXX ',
  'XXXXXXXXX',
  'XXXXXXXXX',
  'XXXXXXXXX',
  ' XXXXXXX ',
  '  XXXXX  ',
  '   XXX   ',
  '    X    ',
];
const FOOD_MASK = [
  '  XXXX   ',
  ' XXXXXX  ',
  'XXXXXXXX ',
  'XXXXXXXX ',
  'XXXXXXX  ',
  ' XXXXX   ',
  '  XXX    ',
  '  X X    ',
  '  X X    ',
];
const BUBBLE_MASK = [
  '  XXX  ',
  ' XXXXX ',
  'XXXXXXX',
  'XXXXXXX',
  'XXXXXXX',
  ' XXXXX ',
  '  XXX  ',
];

let ICON_HEART, ICON_HEART_HALF, ICON_HEART_EMPTY, ICON_FOOD, ICON_FOOD_HALF, ICON_FOOD_EMPTY, ICON_BUBBLE, ICON_BUBBLE_POP;
function buildStatusIcons() {
  ICON_HEART = maskIcon(HEART_MASK, [224, 32, 32], [40, 6, 6], 18);
  ICON_HEART_HALF = maskIcon(HEART_MASK, [224, 32, 32], [40, 6, 6], 18);
  ICON_HEART_EMPTY = maskIcon(HEART_MASK, [58, 10, 10], [22, 4, 4], 18);
  ICON_FOOD = maskIcon(FOOD_MASK, [196, 140, 62], [58, 38, 16], 18);
  ICON_FOOD_EMPTY = maskIcon(FOOD_MASK, [58, 44, 26], [26, 18, 10], 18);
  ICON_BUBBLE = maskIcon(BUBBLE_MASK, [230, 248, 255], [60, 110, 150], 16);
  ICON_BUBBLE_POP = maskIcon(BUBBLE_MASK, [120, 150, 170], [50, 70, 90], 16);
}

/* =====================================================================
   UI 控制器
   ===================================================================== */
const UI = {
  hotbar: null, slots: [], sel: 0,
  healthRow: null, hungerRow: null, airRow: null,
  itemNameEl: null, itemNameTimer: 0,
  debugEl: null, debugREl: null,
  toastBox: null,
  hitEl: null,

  init() {
    this.hotbar = document.getElementById('hotbar');
    this.healthRow = document.getElementById('healthRow');
    this.hungerRow = document.getElementById('hungerRow');
    this.airRow = document.getElementById('airBubbles');
    this.itemNameEl = document.getElementById('itemName');
    this.debugEl = document.getElementById('debug');
    this.debugREl = document.getElementById('debugR');
    this.toastBox = document.getElementById('toastBox');
    this.hitEl = document.getElementById('crosshair');
    this.overlayFx = document.getElementById('overlayFx');
    this.dmgFlash = document.getElementById('dmgFlash');

    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.innerHTML = '<span class="idx">' + (i + 1) + '</span><img alt=""><span class="cnt"></span>';
      this.hotbar.appendChild(d);
      this.slots.push(d);
    }
  },

  setSlotImg(i, block) {
    const el = this.slots[i];
    const img = el.querySelector('img');
    if (!block) { img.removeAttribute('src'); el.dataset.block = ''; return; }
    img.src = blockIcon(block);
    el.dataset.block = block.id;
  },

  selectSlot(i) {
    this.sel = i;
    this.slots.forEach((s, k) => s.classList.toggle('sel', k === i));
  },

  showItemName(name) {
    this.itemNameEl.textContent = name;
    this.itemNameEl.style.opacity = '1';
    this.itemNameTimer = 2.0;
  },

  updateItemName(dt) {
    if (this.itemNameTimer > 0) {
      this.itemNameTimer -= dt;
      if (this.itemNameTimer <= 0) this.itemNameEl.style.opacity = '0';
    }
  },

  setHealth(hp, maxHealth, hurtTime) {
    const hearts = 10;
    const full = Math.ceil(hp / 2);
    let html = '';
    for (let i = 0; i < hearts; i++) {
      const v = hp - i * 2;
      const src = v >= 2 ? ICON_HEART : (v > 0 ? ICON_HEART_HALF : ICON_HEART_EMPTY);
      // 半心用裁剪实现
      const style = (v > 0 && v < 2)
        ? ' style="clip-path:inset(0 50% 0 0)"'
        : '';
      html += '<img class="icon" src="' + src + '"' + style + '>';
    }
    if (this._lastHealth !== hp) {
      this.healthRow.innerHTML = html;
      this._lastHealth = hp;
    }
  },

  setFood(food) {
    const icons = 10;
    let html = '';
    for (let i = 0; i < icons; i++) {
      const v = food - i * 2;
      const src = v >= 2 ? ICON_FOOD : (v > 0 ? ICON_FOOD : ICON_FOOD_EMPTY);
      const style = (v > 0 && v < 2) ? ' style="clip-path:inset(0 50% 0 0)"' : '';
      html += '<img class="icon" src="' + src + '"' + style + '>';
    }
    if (this._lastFood !== food) {
      this.hungerRow.innerHTML = html;
      this._lastFood = food;
    }
  },

  setAir(air, maxAir, creative) {
    if (creative) { if (this._airShown) { this.airRow.innerHTML = ''; this._airShown = false; } return; }
    const n = Math.ceil(air / maxAir * 10);
    if (this._lastAir === n && this._airShown) return;
    this._lastAir = n;
    this._airShown = true;
    let html = '';
    for (let i = 0; i < n; i++) html += '<img class="icon" src="' + ICON_BUBBLE + '">';
    this.airRow.innerHTML = html;
  },

  setOverlay(alpha, color) {
    this.overlayFx.style.background = color || 'rgba(20,60,140,0.42)';
    this.overlayFx.style.opacity = String(alpha);
  },

  flashDamage() {
    this.dmgFlash.style.transition = 'none';
    this.dmgFlash.style.opacity = '1';
    requestAnimationFrame(() => {
      this.dmgFlash.style.transition = 'opacity .5s ease-out';
      this.dmgFlash.style.opacity = '0';
    });
  },

  setDebug(show, lines, linesR) {
    this.debugEl.classList.toggle('hide', !show);
    this.debugREl.classList.toggle('hide', !show);
    if (show) { this.debugEl.textContent = lines; this.debugREl.textContent = linesR || ''; }
  },

  toast(msg) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    this.toastBox.appendChild(d);
    setTimeout(() => d.remove(), 2400);
  },

  hitFeedback(on) {
    this.hitEl.classList.toggle('hit', on);
  },
};
