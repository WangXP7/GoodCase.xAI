/* ============================================================
   INPUT — keyboard, mouse, gamepad, touch
   ============================================================ */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();      // edge-triggered, cleared each frame
    // `clicked` latches a press until a frame consumes it. `down` alone drops a
    // quick tap whose touchstart and touchend both land between two frames —
    // which is most taps on a phone, and is why the drill was unusable there.
    this.mouse = { dx: 0, dy: 0, wheel: 0, locked: false, down: false, clicked: false, rdown: false };
    this.touch = { lx: 0, ly: 0, rx: 0, ry: 0, active: false, btn: {} };
    this.pad = null;
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const c = e.code;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1'].includes(c)) e.preventDefault();
      this.keys.add(c); this.pressed.add(c);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.down = true; this.mouse.clicked = true; }
      if (e.button === 2) this.mouse.rdown = true;
      if (this.enabled && !this.mouse.locked && !this.touch.active) canvas.requestPointerLock?.();
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rdown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (this.mouse.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === canvas;
    });

    addEventListener('gamepadconnected', (e) => { this.pad = e.gamepad.index; });
    addEventListener('gamepaddisconnected', () => { this.pad = null; });

    this.buildTouch();
  }

  lock() {
    // Pointer lock does not exist on touch, and asking for it there throws a
    // permission prompt at the player for no benefit.
    if (this.enabled && !this.touch.active) this.canvas.requestPointerLock?.();
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock?.(); }

  down(...codes) { return codes.some(c => this.keys.has(c)); }
  hit(...codes) { return codes.some(c => this.pressed.has(c)); }

  /* ---------------- touch ----------------
     Two thumbsticks plus a button column. The right stick is a LOOK stick, not
     a position stick: it feeds a rate, so you can keep panning past the edge of
     its travel. Buttons that map to a held key (brake, drill) latch on
     touchstart and release on touchend; the rest are momentary. */
  buildTouch() {
    if (!matchMedia('(pointer: coarse)').matches && !('ontouchstart' in window)) return;
    const wrap = document.createElement('div'); wrap.id = 'touch'; wrap.className = 'hidden';
    wrap.innerHTML = `
      <div class="stick left"><div class="nub"></div><span>DRIVE</span></div>
      <div class="stick right"><div class="nub"></div><span>LOOK</span></div>
      <div class="tbtns">
        <button class="tb" data-k="KeyG">SCAN</button>
        <button class="tb" data-k="KeyR">ARM</button>
        <button class="tb" data-lmb="1">DRILL</button>
        <button class="tb" data-k="KeyB">RELAY</button>
      </div>
      <div class="tbtns2">
        <button class="tb" data-k="KeyC">CAM</button>
        <button class="tb" data-k="KeyF">LAMP</button>
        <button class="tb" data-k="KeyT">ARRAY</button>
        <button class="tb" data-k="KeyH">HUD</button>
        <button class="tb" data-k="KeyK">SHOT</button>
        <button class="tb wide" data-k="Space" data-hold="1">BRAKE</button>
      </div>`;
    document.body.appendChild(wrap);
    // the stylesheet keeps the HUD clear of the thumb zone off this class, so
    // it is set by the code that puts the sticks on screen and nothing else
    document.body.classList.add('touch-controls');
    this.touchEl = wrap;
    this.touch.active = true;

    wrap.querySelectorAll('.stick').forEach((s, i) => {
      const nub = s.querySelector('.nub');
      let id = null;
      const set = (x, y) => {
        const r = s.getBoundingClientRect();
        let dx = (x - r.left - r.width / 2) / (r.width / 2);
        let dy = (y - r.top - r.height / 2) / (r.height / 2);
        const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        nub.style.transform = `translate(${dx * 32}px, ${dy * 32}px)`;
        if (i === 0) { this.touch.lx = dx; this.touch.ly = dy; }
        else { this.touch.rx = dx; this.touch.ry = dy; }
      };
      const clear = () => {
        id = null; nub.style.transform = '';
        if (i === 0) { this.touch.lx = this.touch.ly = 0; } else { this.touch.rx = this.touch.ry = 0; }
      };
      s.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0]; id = t.identifier; set(t.clientX, t.clientY); e.preventDefault();
      }, { passive: false });
      s.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) if (t.identifier === id) set(t.clientX, t.clientY);
        e.preventDefault();
      }, { passive: false });
      s.addEventListener('touchend', clear);
      s.addEventListener('touchcancel', clear);
    });

    wrap.querySelectorAll('.tb').forEach((b) => {
      const k = b.dataset.k, lmb = b.dataset.lmb, hold = b.dataset.hold;
      const down = (e) => {
        e.preventDefault(); b.classList.add('on');
        if (lmb) { this.mouse.down = true; this.mouse.clicked = true; }
        else { this.keys.add(k); this.pressed.add(k); }
      };
      const up = () => {
        b.classList.remove('on');
        if (lmb) this.mouse.down = false;
        else if (hold || !k) this.keys.delete(k);
        else this.keys.delete(k);          // momentary: the edge already fired
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
    });
  }

  /** Touch overlay only belongs on screen while you are actually driving. */
  showTouch(on) {
    if (this.touchEl) this.touchEl.classList.toggle('hidden', !on);
  }

  /* ---------------- per-frame ---------------- */
  poll() {
    const out = {
      throttle: 0, steer: 0, brake: 0,
      lookX: 0, lookY: 0, zoom: 0,
      // Whether the operator is actively aiming the view. The camera used to
      // infer this from the magnitude of lookX/lookY, but that number is in
      // mouse pixels — a thumbstick pushed a third of the way produces a
      // smaller value than a nudge of the mouse, so auto-centre never stood
      // down and dragged the view back while you were still pushing.
      looking: false
    };
    // keyboard
    if (this.down('KeyW', 'ArrowUp')) out.throttle += 1;
    if (this.down('KeyS', 'ArrowDown')) out.throttle -= 1;
    if (this.down('KeyA', 'ArrowLeft')) out.steer -= 1;
    if (this.down('KeyD', 'ArrowRight')) out.steer += 1;
    if (this.down('Space')) out.brake = 1;

    // mouse look
    out.lookX = this.mouse.dx; out.lookY = this.mouse.dy;
    out.zoom = this.mouse.wheel;
    if (this.mouse.dx || this.mouse.dy) out.looking = true;
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;

    // touch
    if (this.touch.active) {
      out.throttle += -this.touch.ly;
      out.steer += this.touch.lx;
      // rate, not position: hold it over and the view keeps turning
      out.lookX += this.touch.rx * Math.abs(this.touch.rx) * 17;
      out.lookY += this.touch.ry * Math.abs(this.touch.ry) * 14;
      if (Math.hypot(this.touch.rx, this.touch.ry) > 0.06) out.looking = true;
    }

    // gamepad
    if (this.pad !== null && navigator.getGamepads) {
      const gp = navigator.getGamepads()[this.pad];
      if (gp) {
        const dz = (v) => Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86;
        out.steer += dz(gp.axes[0] || 0);
        out.throttle += (gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0);
        if (Math.abs(dz(gp.axes[1] || 0)) > 0.01 && !(gp.buttons[7]?.value)) out.throttle += -dz(gp.axes[1]);
        out.lookX += dz(gp.axes[2] || 0) * 13;
        out.lookY += dz(gp.axes[3] || 0) * 13;
        if (Math.abs(dz(gp.axes[2] || 0)) + Math.abs(dz(gp.axes[3] || 0)) > 0.02) out.looking = true;
        if (gp.buttons[0]?.pressed) out.brake = 1;
        const map = { 2: 'KeyG', 3: 'KeyR', 1: 'KeyF', 9: 'Escape', 8: 'Tab', 4: 'KeyC', 5: 'KeyB' };
        for (const [b, code] of Object.entries(map)) {
          const p = gp.buttons[b]?.pressed;
          this._gpPrev ||= {};
          if (p && !this._gpPrev[b]) { this.keys.add(code); this.pressed.add(code); }
          if (!p && this._gpPrev[b]) this.keys.delete(code);
          this._gpPrev[b] = p;
        }
      }
    }

    out.throttle = Math.max(-1, Math.min(1, out.throttle));
    out.steer = Math.max(-1, Math.min(1, out.steer));
    return out;
  }

  endFrame() { this.pressed.clear(); this.mouse.clicked = false; }
}
