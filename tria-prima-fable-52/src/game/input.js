// Keyboard and mouse. Pointer lock when the browser grants it; otherwise drag to look.
import { LookFilter } from './look.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this._hit = new Set();
    this._rel = new Set();
    this.dx = 0;
    this.dy = 0;
    this.mx = 0; // pointer position over the canvas, 0..1
    this.my = 0;
    this.mdx = 0; // pointer travel this frame in canvas pixels (unlocked)
    this.mdy = 0;
    this.left = false;
    this.right = false;
    this.locked = false;
    this.lockWanted = false;
    this.lockFailed = false;
    this.active = false; // the game is reading input (play / brew / photo)
    this.onUnlock = null; // () => void, when the browser drops the lock
    this._dragMoved = 0;
    this._dragT = 0;
    this.raw = null; // true once the browser hands over the mouse's own movement, false if it cannot
    this.look = new LookFilter(); // look.js: drops the reports that are the cursor being moved
    this._lm = [0, 0];

    const kd = (e) => {
      if (!this.active) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'KeyF' || e.code === 'Quote' || e.code === 'Slash') e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this._hit.add(e.code);
    };
    const ku = (e) => {
      this.down.delete(e.code);
      this._rel.add(e.code);
    };
    addEventListener('keydown', kd);
    addEventListener('keyup', ku);
    addEventListener('blur', () => {
      this.down.clear();
      this.left = this.right = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 0) {
        this.left = true;
        this._hit.add('Mouse0');
        this._dragMoved = 0;
        this._dragT = performance.now();
      }
      if (e.button === 2) {
        this.right = true;
        this._hit.add('Mouse2');
      }
      if (this.lockWanted && !this.locked) this.requestLock();
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        if (this.left) {
          this._rel.add('Mouse0');
          // without pointer lock the left button drags the view: a short still click is a throw
          if (!this.locked && this._dragMoved < 6 && performance.now() - this._dragT < 350) this._hit.add('Click');
        }
        this.left = false;
      }
      if (e.button === 2) {
        if (this.right) this._rel.add('Mouse2');
        this.right = false;
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mx = (e.clientX - r.left) / Math.max(1, r.width);
      this.my = (e.clientY - r.top) / Math.max(1, r.height);
      if (!this.active) return;
      this.mdx += e.movementX || 0;
      this.mdy += e.movementY || 0;
      if (this.locked) {
        // window size in the units of the report, whatever the page zoom
        const w = Math.min(innerWidth, outerWidth || innerWidth),
          h = Math.min(innerHeight, outerHeight || innerHeight);
        const m = this.look.feed(e.movementX || 0, e.movementY || 0, e.timeStamp || performance.now(), w, h, this._lm);
        this.dx += m[0];
        this.dy += m[1];
      } else if (this.left || this.right) {
        this.dx += e.movementX || 0;
        this.dy += e.movementY || 0;
        this._dragMoved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (this.locked && !was) this.look.reset(performance.now());
      if (was && !this.locked && this.onUnlock) this.onUnlock();
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
    });
  }

  requestLock() {
    this.lockWanted = true;
    if (this.locked || !this.canvas.requestPointerLock) return;
    const plain = () => {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch)
          p.catch(() => {
            this.lockFailed = true;
          });
      } catch (e) {
        this.lockFailed = true;
      }
    };
    if (this.raw === false) return plain();
    // Ask for the mouse's own movement first. The browser then has no cursor to keep inside the
    // window, so it never moves one, and never mistakes that for the hand (see look.js).
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.then)
        p.then(
          () => {
            this.raw = true;
          },
          (err) => {
            if (err && err.name === 'NotSupportedError') {
              this.raw = false;
              plain();
            } else this.lockFailed = true;
          }
        );
    } catch (e) {
      this.raw = false;
      plain();
    }
  }
  releaseLock() {
    this.lockWanted = false;
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  /** True once for each press since the last endFrame(). */
  hit(code) {
    return this._hit.has(code);
  }
  released(code) {
    return this._rel.has(code);
  }
  held(code) {
    return this.down.has(code);
  }
  endFrame() {
    this._hit.clear();
    this._rel.clear();
    this.dx = this.dy = 0;
    this.mdx = this.mdy = 0;
  }
  clear() {
    this.down.clear();
    this._hit.clear();
    this._rel.clear();
    this.left = this.right = false;
    this.dx = this.dy = this.mdx = this.mdy = 0;
  }

  // --- for automated play
  press(code) {
    this.down.add(code);
    this._hit.add(code);
    if (code === 'Mouse0') this.left = true;
  }
  release(code) {
    this.down.delete(code);
    this._rel.add(code);
    if (code === 'Mouse0') this.left = false;
  }
}
