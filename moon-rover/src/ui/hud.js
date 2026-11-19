/* ============================================================
   HUD — telemetry, instruments, codex, menus
   ============================================================ */
import { CODEX, MISSIONS } from '../game/lore.js';
import { HOME } from '../world/props.js';
import { STATION, MASSIF } from '../game/gameplay.js';
import { DRIVE } from '../game/rover.js';
import { PLAYABLE_R, MACRO_RES, MACRO_EXT } from '../world/terrain.js';
import { clamp, sstep } from '../core/rng.js';

const $ = (id) => document.getElementById(id);
const MAP_EXT = 1020;                    // metres shown across the minimap base

export class HUD {
  constructor(audio) {
    this.audio = audio;
    this.el = {
      hud: $('hud'), mission: $('missionBox'), tag: $('missionTag'), name: $('missionName'), obj: $('missionObj'),
      sunPhase: $('sunPhase'), met: $('met'), rangeHome: $('rangeHome'),
      batt: $('gBatt'), heat: $('gHeat'), hull: $('gHull'), chips: $('sysChips'),
      bay: $('baygrid'), bayCount: $('bayCount'), mapScale: $('mapScale'),
      prompt: $('prompt'), logfeed: $('logfeed'), vig: $('vig'),
      discovery: $('discovery'), gprState: $('gprState'),
      codexList: $('codexList'), codexRead: $('codexRead')
    };
    this.cv = {
      compass: $('compass').getContext('2d'),
      minimap: $('minimap').getContext('2d'),
      speedo: $('speedo').getContext('2d'),
      wheel: $('wheelmon').getContext('2d'),
      gpr: $('gprscope').getContext('2d')
    };
    this.mapDirty = true; this.bayDirty = true; this.missionDirty = true; this.codexDirty = true;
    this.logs = [];
    this.interactProgress = 0;
    this.gprTrace = new Float32Array(160);
    this.mapBase = null;
    this._t = 0;
    this._discT = 0;
    this._camLabel = '';
    this.buildBay();
    this.buildCodexList();
  }

  /* ---------------- minimap base: hillshade the real height field ---------------- */
  bakeMap(terrain) {
    const N = 300;
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const sample = (x, z) => {
      const u = clamp((x / MACRO_EXT + 0.5) * MACRO_RES, 0, MACRO_RES - 1) | 0;
      const v = clamp((z / MACRO_EXT + 0.5) * MACRO_RES, 0, MACRO_RES - 1) | 0;
      return terrain.macro[v * MACRO_RES + u];
    };
    const step = MAP_EXT / N;
    let mn = 1e9, mx = -1e9;
    const H = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * MAP_EXT, z = (j / N - 0.5) * MAP_EXT;
      const h = sample(x, z);
      H[j * N + i] = h;
      if (h < mn) mn = h; if (h > mx) mx = h;
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h = H[j * N + i];
      const hl = H[j * N + Math.max(i - 1, 0)], hr = H[j * N + Math.min(i + 1, N - 1)];
      const hu = H[Math.max(j - 1, 0) * N + i], hd = H[Math.min(j + 1, N - 1) * N + i];
      // light from the north-west, the cartographer's convention
      const nx = (hl - hr) / (2 * step), nz = (hu - hd) / (2 * step);
      const shade = clamp(0.5 + (nx * 0.62 + nz * 0.62) * 2.4, 0, 1);
      const t = (h - mn) / Math.max(mx - mn, 1e-4);
      const base = 0.10 + t * 0.30;
      let v = base * (0.45 + 0.85 * shade);
      const x = (i / N - 0.5) * MAP_EXT, z = (j / N - 0.5) * MAP_EXT;
      const r = Math.hypot(x, z);
      if (r > PLAYABLE_R) v *= 0.42;                  // outside the fence reads dead
      const o = (j * N + i) * 4;
      img.data[o] = v * 232; img.data[o + 1] = v * 226; img.data[o + 2] = v * 210;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // fence ring
    g.strokeStyle = 'rgba(255,180,84,.30)'; g.lineWidth = 1;
    g.beginPath(); g.arc(N / 2, N / 2, PLAYABLE_R / MAP_EXT * N, 0, 6.2832); g.stroke();
    this.mapBase = c;
  }

  /* ---------------- sample bay ---------------- */
  buildBay() {
    this.el.bay.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div'); d.className = 'slot';
      this.el.bay.appendChild(d);
    }
  }
  refreshBay(game) {
    const slots = this.el.bay.children;
    for (let i = 0; i < slots.length; i++) {
      const s = game.bay[i];
      slots[i].className = 'slot' + (s ? ' full' : '') + (s && s.rare ? ' rare' : '');
      slots[i].title = s ? s.name : 'EMPTY';
    }
    this.el.bayCount.textContent = `${game.bay.length}/6`;
    this.bayDirty = false;
  }

  /* ---------------- log feed ---------------- */
  log(text, kind) {
    const d = document.createElement('div');
    d.className = 'logline' + (kind ? ' ' + kind : '');
    d.textContent = text;
    this.el.logfeed.prepend(d);
    this.logs.push({ el: d, t: performance.now() });
    while (this.el.logfeed.children.length > 6) this.el.logfeed.lastChild.remove();
    if (this.audio) this.audio.ui(kind === 'bad' ? 'bad' : kind === 'warn' ? 'warn' : 'tick');
  }

  setPrompt(html) {
    if (!html) { this.el.prompt.classList.add('hidden'); this._prompt = null; return; }
    if (html !== this._prompt) { this.el.prompt.innerHTML = html; this._prompt = html; }
    this.el.prompt.classList.remove('hidden');
  }

  flashDiscovery(kicker, name, sub) {
    const d = this.el.discovery;
    d.querySelector('.d-kicker').textContent = kicker;
    d.querySelector('.d-name').textContent = name;
    d.querySelector('.d-sub').textContent = sub || '';
    d.classList.remove('hidden');
    d.style.animation = 'none'; void d.offsetWidth; d.style.animation = '';
    this._discT = 3.4;
  }

  hit(k) {
    this.el.vig.classList.add('hit');
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => this.el.vig.classList.remove('hit'), 120 + k * 260);
  }

  /* ---------------- mission panel ---------------- */
  refreshMission(game) {
    const m = game.mission;
    if (!m) {
      this.el.tag.textContent = 'FREE SURVEY';
      this.el.name.textContent = 'ANAXAGORAS';
      this.el.obj.innerHTML = `<div>${game.excavated} excavations · ${(game.rover.odo / 1000).toFixed(2)} km driven</div>`;
      this.missionDirty = false; return;
    }
    this.el.tag.textContent = m.tag;
    this.el.name.textContent = m.name;
    this.el.obj.innerHTML = m.objectives.map(o => {
      const done = game.objDone[o.id];
      const cnt = o.count ? ` ${Math.min(game.counts[o.id] || 0, o.count)}/${o.count}` : '';
      const hint = !done && o.hint ? `<small>${o.hint}</small>` : '';
      return `<div class="${done ? 'done' : ''}"><i>${done ? '✓' : '▸'}</i><span>${o.text}${cnt}${hint}</span></div>`;
    }).join('');
    this.missionDirty = false;
  }

  showCard(m) {
    $('cardKicker').textContent = m.tag;
    $('cardTitle').textContent = m.name;
    $('cardText').innerHTML = (m.brief || '').split('\n\n').map(p => `<span>${p}</span>`).join('<br><br>');
    $('cardObj').innerHTML = m.objectives.map(o => `<div>${o.text}</div>`).join('');
    $('cardOverlay').classList.remove('hidden');
    this.cardOpen = true;
  }
  hideCard() { $('cardOverlay').classList.add('hidden'); this.cardOpen = false; }

  /* ---------------- codex ---------------- */
  buildCodexList() {
    this.el.codexList.innerHTML = '';
    for (const e of CODEX) {
      const li = document.createElement('li');
      li.dataset.id = e.id;
      li.innerHTML = `<small>${e.tag}</small>${e.title}`;
      li.addEventListener('click', () => { if (!li.classList.contains('locked')) this.readCodex(e.id); });
      this.el.codexList.appendChild(li);
    }
  }
  refreshCodex(game) {
    for (const li of this.el.codexList.children) {
      const open = game.unlocked.has(li.dataset.id);
      li.classList.toggle('locked', !open);
      if (!open) {
        const e = CODEX.find(c => c.id === li.dataset.id);
        li.innerHTML = `<small>${e.tag}</small>[ SEALED ]`;
      } else {
        const e = CODEX.find(c => c.id === li.dataset.id);
        li.innerHTML = `<small>${e.tag}</small>${e.title}`;
      }
    }
    this.codexDirty = false;
  }
  readCodex(id) {
    const e = CODEX.find(c => c.id === id);
    if (!e) return;
    for (const li of this.el.codexList.children) li.classList.toggle('on', li.dataset.id === id);
    this.el.codexRead.innerHTML =
      `<h3>${e.title}</h3><div class="meta">${e.meta}</div>` +
      e.body.map((p, i) => `<p class="${i === e.body.length - 1 && e.tag === 'STATION LOG' ? 'sig' : ''}">${p}</p>`).join('');
    this.el.codexRead.scrollTop = 0;
    if (this.audio) this.audio.ui('tick');
  }

  /* ============================================================
     instruments
     ============================================================ */
  drawCompass(rover, game, sky) {
    const g = this.cv.compass, W = 660, H = 42;
    g.clearRect(0, 0, W, H);
    // Map convention: north is −Z (up on the minimap), east is +X.
    const heading = (Math.atan2(rover.forward.x, -rover.forward.z) * 180 / Math.PI + 360) % 360;
    const span = 140;                                  // degrees across the strip
    const pxPerDeg = W / span;
    g.font = '10px ui-monospace, monospace';
    g.textAlign = 'center';
    const marks = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    // Step over ABSOLUTE bearings, not offsets from the current heading —
    // otherwise no tick ever lands exactly on a multiple of 45 and the
    // cardinal labels never appear.
    for (let a = 0; a < 360; a += 5) {
      const rel = ((a - heading + 540) % 360) - 180;
      if (Math.abs(rel) > span / 2) continue;
      const x = W / 2 + rel * pxPerDeg;
      const major = a % 45 === 0;
      const mid = a % 15 === 0;
      g.strokeStyle = major ? 'rgba(216,210,198,.75)' : mid ? 'rgba(216,210,198,.38)' : 'rgba(216,210,198,.16)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, H - 1); g.lineTo(x, H - (major ? 13 : mid ? 8 : 4)); g.stroke();
      if (major) {
        const lab = marks[a];
        g.fillStyle = lab.length <= 2 ? '#d8d2c6' : 'rgba(216,210,198,.60)';
        g.fillText(lab, x, H - 18);
      }
    }
    // objective bearing
    const targets = [];
    if (game.mission) {
      if (!game.objDone.reach && game.missionIdx === 3) targets.push([STATION.x, STATION.z, '#ffb454', 'BEACON-9']);
      if (!game.objDone.massif && game.missionIdx === 4) targets.push([MASSIF.x, MASSIF.z, '#ffb454', 'MASSIF']);
    }
    if (game.bay.length >= 6 || game.objDone.deep || game.power < 25) targets.push([HOME.x, HOME.z, '#6fe3f5', 'SLED']);
    for (const a of game.anoms) if (a.found && !a.taken && game.distTo(a.x, a.z) < 190)
      targets.push([a.x, a.z, a.special || a.type === 'tube' ? '#ffb454' : '#6fe3f5', null]);
    for (const [tx, tz, col, lab] of targets) {
      const b = (Math.atan2(tx - rover.pos.x, -(tz - rover.pos.z)) * 180 / Math.PI + 360) % 360;
      const rel = ((b - heading + 540) % 360) - 180;
      if (Math.abs(rel) > span / 2) continue;
      const x = W / 2 + rel * pxPerDeg;
      g.fillStyle = col;
      g.beginPath(); g.moveTo(x, 4); g.lineTo(x - 4, -3); g.lineTo(x + 4, -3); g.closePath();
      g.beginPath(); g.moveTo(x, 12); g.lineTo(x - 5, 3); g.lineTo(x + 5, 3); g.closePath(); g.fill();
      if (lab) { g.font = '8px ui-monospace, monospace'; g.fillText(lab, x, 22); g.font = '10px ui-monospace, monospace'; }
    }
    // sun bearing
    const sb = (Math.atan2(sky.sunDir.x, -sky.sunDir.z) * 180 / Math.PI + 360) % 360;
    const srel = ((sb - heading + 540) % 360) - 180;
    if (Math.abs(srel) <= span / 2) {
      const x = W / 2 + srel * pxPerDeg;
      g.fillStyle = 'rgba(255,240,200,.85)';
      g.beginPath(); g.arc(x, 8, 3.4, 0, 6.2832); g.fill();
    }
    // centre index
    g.strokeStyle = '#6fe3f5'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, H - 17); g.stroke();
    g.fillStyle = '#6fe3f5'; g.font = '10px ui-monospace, monospace';
    g.fillText(String(Math.round(heading)).padStart(3, '0'), W / 2, 10);
  }

  drawMinimap(rover, game) {
    const g = this.cv.minimap, S = 300;
    g.clearRect(0, 0, S, S);
    if (!this.mapBase) return;
    const zoom = this.mapZoom || 1.9;
    const span = MAP_EXT / zoom;
    const px = rover.pos.x, pz = rover.pos.z;
    const src = this.mapBase.width;
    const sx = ((px / MAP_EXT + 0.5) * src) - (span / MAP_EXT * src) / 2;
    const sy = ((pz / MAP_EXT + 0.5) * src) - (span / MAP_EXT * src) / 2;
    const sw = span / MAP_EXT * src;
    g.save();
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapBase, sx, sy, sw, sw, 0, 0, S, S);

    const w2s = (x, z) => [(x - px) / span * S + S / 2, (z - pz) / span * S + S / 2];

    // relay coverage
    if (game.props.relays) for (const r of game.props.relays) {
      const [ux, uy] = w2s(r.position.x, r.position.z);
      g.strokeStyle = 'rgba(42,210,255,.22)'; g.lineWidth = 1;
      g.beginPath(); g.arc(ux, uy, 95 / span * S, 0, 6.2832); g.stroke();
      g.fillStyle = '#2ad2ff'; g.fillRect(ux - 2.5, uy - 2.5, 5, 5);
    }
    // POIs
    const poi = (x, z, col, label, shape) => {
      const [ux, uy] = w2s(x, z);
      if (ux < -20 || uy < -20 || ux > S + 20 || uy > S + 20) return;
      g.fillStyle = col;
      if (shape === 'home') {
        g.beginPath(); g.moveTo(ux, uy - 6); g.lineTo(ux + 5, uy + 4); g.lineTo(ux - 5, uy + 4); g.closePath(); g.fill();
      } else if (shape === 'x') {
        g.strokeStyle = col; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(ux - 4, uy - 4); g.lineTo(ux + 4, uy + 4);
        g.moveTo(ux + 4, uy - 4); g.lineTo(ux - 4, uy + 4); g.stroke();
      } else {
        g.beginPath(); g.arc(ux, uy, 3.2, 0, 6.2832); g.fill();
      }
      if (label) {
        g.font = '8px ui-monospace, monospace'; g.textAlign = 'center';
        g.fillStyle = col; g.fillText(label, ux, uy - 9);
      }
    };
    poi(HOME.x, HOME.z, '#6fe3f5', 'SLED', 'home');
    if (game.missionIdx >= 3 || game.stationVisited) poi(STATION.x, STATION.z, '#ffb454', 'BEACON-9', 'x');
    if (game.missionIdx >= 4) poi(MASSIF.x, MASSIF.z, '#ffb454', 'MASSIF', 'x');
    for (const a of game.anoms) if (a.found && !a.taken)
      poi(a.x, a.z, a.special || a.type === 'tube' ? '#ffb454' : '#2ad2ff', null, 'dot');

    // rover
    const hd = Math.atan2(rover.forward.x, -rover.forward.z);
    g.save(); g.translate(S / 2, S / 2); g.rotate(hd);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill();
    g.restore();
    // scan pulse
    if (game.scan.active) {
      const [ux, uy] = w2s(game.scan.x, game.scan.z);
      g.strokeStyle = `rgba(42,210,255,${0.8 - game.scan.t / 2.1 * 0.7})`; g.lineWidth = 1.4;
      g.beginPath(); g.arc(ux, uy, game.scan.r / span * S, 0, 6.2832); g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(216,210,198,.16)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
    this.el.mapScale.textContent = `${Math.round(span)} m`;
  }

  drawSpeedo(rover, game) {
    const g = this.cv.speedo, S = 150, c = S / 2;
    g.clearRect(0, 0, S, S);
    const spd = Math.abs(rover.speed);
    const max = 9;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const R = 58;

    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(216,210,198,.09)'; g.lineWidth = 6;
    g.beginPath(); g.arc(c, c, R, a0, a1); g.stroke();

    for (let i = 0; i <= 9; i++) {
      const a = a0 + (i / 9) * (a1 - a0);
      const maj = i % 3 === 0;
      g.strokeStyle = maj ? 'rgba(216,210,198,.50)' : 'rgba(216,210,198,.20)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * (R - 9), c + Math.sin(a) * (R - 9));
      g.lineTo(c + Math.cos(a) * (R - 4), c + Math.sin(a) * (R - 4));
      g.stroke();
    }

    const t = clamp(spd / max, 0, 1);
    g.strokeStyle = '#6fe3f5'; g.lineWidth = 6;
    g.beginPath(); g.arc(c, c, R, a0, a0 + t * (a1 - a0)); g.stroke();

    const slip = rover.wheels.reduce((s, w) => s + w.slipLong, 0) / 6;
    if (slip > 0.02) {
      g.strokeStyle = `rgba(255,180,84,${clamp(slip, 0, 1) * 0.85})`; g.lineWidth = 2;
      g.beginPath(); g.arc(c, c, R + 6, a0, a0 + clamp(slip, 0, 1) * (a1 - a0)); g.stroke();
    }

    g.textAlign = 'center';
    g.fillStyle = '#d8d2c6'; g.font = '300 30px ui-monospace, monospace';
    g.fillText((spd * 3.6).toFixed(1), c, c + 6);
    g.fillStyle = 'rgba(216,210,198,.40)'; g.font = '8px ui-monospace, monospace';
    g.fillText('KM/H', c, c + 19);
    g.fillStyle = rover.speed < -0.15 ? '#ffb454' : 'rgba(216,210,198,.55)';
    g.font = '8.5px ui-monospace, monospace';
    g.fillText(rover.airborne ? 'AIRBORNE' : rover.speed < -0.15 ? 'REVERSE' : 'DRIVE', c, c + 36);
    g.fillStyle = 'rgba(216,210,198,.32)'; g.font = '8px ui-monospace, monospace';
    g.fillText(this._camLabel, c, 22);
    g.fillText(`${(rover.odo / 1000).toFixed(2)} KM`, c, S - 10);
    void game;
  }

  drawWheels(rover) {
    const g = this.cv.wheel, W = 236, H = 130;
    g.clearRect(0, 0, W, H);
    g.font = '8px ui-monospace, monospace'; g.textAlign = 'left';
    const cols = [42, 118, 194], rows = [36, 96];
    rover.wheels.forEach((w) => {
      const cx = cols[w.axle], cy = rows[w.side < 0 ? 0 : 1];
      const load = clamp(w.load / 700, 0, 1.4);
      g.strokeStyle = w.contact ? 'rgba(216,210,198,.35)' : 'rgba(255,95,86,.55)';
      g.lineWidth = 1;
      g.strokeRect(cx - 26, cy - 15, 52, 30);
      g.fillStyle = w.slipLong > 0.25 ? `rgba(255,180,84,${0.25 + w.slipLong * 0.6})`
                                      : `rgba(111,227,245,${0.16 + load * 0.5})`;
      g.fillRect(cx - 25, cy + 14 - Math.max(2, load * 28), 50, Math.max(2, load * 28));
      // sinkage bar
      g.fillStyle = 'rgba(180,120,60,.75)';
      g.fillRect(cx - 25, cy + 14, 50 * clamp(w.sink / 0.11, 0, 1), 2);
      g.fillStyle = 'rgba(216,210,198,.55)';
      g.fillText(['F', 'M', 'A'][w.axle] + (w.side < 0 ? 'L' : 'R'), cx - 24, cy - 6);
    });
  }

  drawGPR(game) {
    const g = this.cv.gpr, W = 290, H = 130;
    g.clearRect(0, 0, W, H);
    
    // depth grid
    g.strokeStyle = 'rgba(111,227,245,.10)'; g.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const y = i / 6 * H;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    g.fillStyle = 'rgba(111,227,245,.35)'; g.font = '7.5px ui-monospace, monospace'; g.textAlign = 'left';
    for (let i = 1; i < 6; i++) g.fillText(`${i * 2} m`, 3, i / 6 * H - 2);

    // A-scope trace: noise, plus a real reflector where an anomaly sits below
    const N = this.gprTrace.length;
    const near = game.anoms.filter(a => a.found && !a.taken && game.distTo(a.x, a.z) < 30);
    const scanning = game.scan.active;
    for (let i = 0; i < N; i++) {
      const depth = i / N * 12;
      let v = (Math.random() - 0.5) * (scanning ? 0.30 : 0.10);
      for (const a of near) {
        const d = game.distTo(a.x, a.z);
        const amp = (1 - d / 30) * (a.special ? 1.5 : a.type === 'tube' ? 1.1 : 0.7);
        v += Math.exp(-Math.pow((depth - a.depth) / 0.34, 2)) * amp * Math.sin(this._t * 22 + i * 0.4);
      }
      this.gprTrace[i] = this.gprTrace[i] * 0.55 + v * 0.45;
    }
    g.strokeStyle = near.length ? '#6fe3f5' : 'rgba(111,227,245,.42)';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const y = i / N * H;
      const x = W / 2 + this.gprTrace[i] * W * 0.34;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    this.el.gprState.textContent = scanning ? 'SWEEPING' : game.scan.cool > 0 ? 'RECHARGING'
      : near.length ? `${near.length} RETURN` : 'IDLE';
  }

  /* ============================================================
     per-frame
     ============================================================ */
  update(dt, game, rover, sky, rig) {
    this._t += dt;
    this._camLabel = rig.modeName;

    if (this.missionDirty) this.refreshMission(game);
    if (this.bayDirty) this.refreshBay(game);
    if (this.codexDirty) this.refreshCodex(game);

    // gauges
    const setG = (el, frac, label, warn, crit) => {
      el.querySelector('i').style.transform = `scaleX(${clamp(frac, 0, 1)})`;
      el.querySelector('b').textContent = label;
      el.classList.toggle('warn', frac < warn && frac >= crit);
      el.classList.toggle('crit', frac < crit);
    };
    setG(this.el.batt, game.power / 100, `${Math.round(game.power)}%`, 0.35, 0.15);
    setG(this.el.hull, game.hull / 100, `${Math.round(game.hull)}%`, 0.45, 0.20);
    const ht = clamp((game.heat + 60) / 120, 0, 1);
    this.el.heat.querySelector('i').style.transform = `scaleX(${ht})`;
    this.el.heat.querySelector('b').textContent = `${game.heat > 0 ? '+' : ''}${Math.round(game.heat)}°`;
    this.el.heat.classList.toggle('warn', game.heat < -35 || game.heat > 55);
    this.el.heat.classList.toggle('crit', game.heat < -55 || game.heat > 75);

    // system chips
    const chips = [
      [`UPLINK ${DRIVE.commsDelay > 0 ? DRIVE.commsDelay.toFixed(1) + 's' : 'LOCAL'}`, DRIVE.commsDelay > 0],
      ['ARM', rover.armOut],
      ['ARRAY', rover.panelDeploy > 0.6],
      ['LAMPS', rover.lampPower > 0.1],
      ['GPR', game.scan.active],
      ['DRILL', game.drill.active],
      ['TC', game.tc !== false],
      [`RELAY ${game.relaysPlaced}/3`, game.relaysPlaced > 0]
    ];
    const sig = chips.map(c => c[0] + c[1]).join('|');
    if (sig !== this._chipSig) {
      this._chipSig = sig;
      this.el.chips.innerHTML = chips.map(([t, on]) => `<span class="chip${on ? ' on' : ''}">${t}</span>`).join('');
    }

    // clocks
    const s = Math.floor(game.met);
    this.el.met.textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    const alt = Math.asin(clamp(sky.sunDir.y, -1, 1)) * 180 / Math.PI;
    const az = (Math.atan2(sky.sunDir.x, sky.sunDir.z) * 180 / Math.PI + 360) % 360;
    this.el.sunPhase.textContent = `${alt.toFixed(1)}° / ${Math.round(az)}°`;
    const dh = game.distTo(HOME.x, HOME.z);
    this.el.rangeHome.textContent = dh > 999 ? `${(dh / 1000).toFixed(2)} km` : `${Math.round(dh)} m`;

    // instruments
    this.drawCompass(rover, game, sky);
    this.drawMinimap(rover, game);
    this.drawSpeedo(rover, game);
    this.drawWheels(rover);
    this.drawGPR(game);

    // discovery banner
    if (this._discT > 0) {
      this._discT -= dt;
      if (this._discT <= 0) this.el.discovery.classList.add('hidden');
    }
    // log fade
    const now = performance.now();
    for (const l of this.logs) {
      if (!l.faded && now - l.t > 9000) { l.faded = true; l.el.classList.add('fade'); }
      if (l.faded && now - l.t > 10200 && l.el.parentNode) l.el.remove();
    }
    this.logs = this.logs.filter(l => l.el.parentNode);

    // interaction ring
    if (this.interactProgress > 0.001) {
      this.el.prompt.style.background =
        `linear-gradient(90deg, rgba(111,227,245,.30) ${this.interactProgress * 100}%, rgba(4,5,10,.7) ${this.interactProgress * 100}%)`;
    } else this.el.prompt.style.background = '';
    void sstep; void MISSIONS;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hideHUD() { this.el.hud.classList.add('hidden'); }
}
