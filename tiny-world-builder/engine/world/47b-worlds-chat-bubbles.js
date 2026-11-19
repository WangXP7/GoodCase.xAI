  // -------- speech bubbles (extracted from 47-worlds-room.js) --------
  // A chat line shown above an avatar in an 8-bit pixel font (Press Start 2P).
  // Rendered to a CanvasTexture on a billboard sprite so it always faces the
  // camera and rides the jump arc. Auto-fades.
  // Depends on THREE, twSetTextureSRGB, WS.avatarParent(), WS.selfEnt(),
  // WS.peerEnts(), WS.getMyId() — all from earlier modules / the WS namespace.
  (function () {
    'use strict';
    const WS = (window.__tinyworldWorlds = window.__tinyworldWorlds || {});
    const BUBBLE_FONT = "'Press Start 2P'";
    const BUBBLE_MS = 5200;
    const BUBBLE_FADE_MS = 700;
    const BUBBLE_MAX_CHARS = 90;
    const BUBBLE_HEAD_Y = 1.24;
    let bubbleFontReady = false;
    (function preloadBubbleFont() {
      try {
        if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
          document.fonts.load('16px ' + BUBBLE_FONT).then(() => {
            bubbleFontReady = true;
            const redraw = (e) => { if (e && e.bubble && e.bubble.text != null) renderBubble(e, e.bubble.text); };
            const se = WS.selfEnt && WS.selfEnt();
            if (se) redraw(se);
            const pe = WS.peerEnts && WS.peerEnts();
            if (pe) pe.forEach(redraw);
          }).catch(() => {});
        }
      } catch (_) {}
    })();

    function roundRectPath(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function speechBubblePath(ctx, x, y, w, h, r, tailHalf, tailH) {
      r = Math.min(r, w / 2, h / 2);
      const right = x + w;
      const bottom = y + h;
      const cx = x + w / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(right - r, y);
      ctx.quadraticCurveTo(right, y, right, y + r);
      ctx.lineTo(right, bottom - r);
      ctx.quadraticCurveTo(right, bottom, right - r, bottom);
      ctx.lineTo(cx + tailHalf, bottom);
      ctx.lineTo(cx, bottom + tailH);
      ctx.lineTo(cx - tailHalf, bottom);
      ctx.lineTo(x + r, bottom);
      ctx.quadraticCurveTo(x, bottom, x, bottom - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
    function wrapBubbleLines(ctx, text, maxW) {
      const words = String(text).split(/\s+/).filter(Boolean);
      const lines = []; let line = '';
      for (const w of words) {
        const probe = line ? line + ' ' + w : w;
        if (ctx.measureText(probe).width > maxW && line) { lines.push(line); line = w; }
        else line = probe;
        if (lines.length >= 4) break;
      }
      if (line && lines.length < 4) lines.push(line);
      return lines.length ? lines : [String(text)];
    }
    function renderBubble(ent, text) {
      if (!ent || !ent.bubble || typeof THREE === 'undefined') return;
      const S = 3;
      const FS = 9 * S, LH = 15 * S, PAD = 9 * S, TAIL = 9 * S, MAXW = 150 * S, R = 7 * S, LW = 2 * S;
      const font = FS + "px " + BUBBLE_FONT + ", 'Courier New', monospace";
      const cv = ent.bubble.canvas, ctx = cv.getContext('2d');
      ctx.font = font;
      const lines = wrapBubbleLines(ctx, text, MAXW);
      let textW = 0; for (const l of lines) textW = Math.max(textW, ctx.measureText(l).width);
      const cw = Math.ceil(textW) + PAD * 2;
      const bodyH = lines.length * LH + PAD * 2;
      const ch = bodyH + TAIL;
      cv.width = cw; cv.height = ch;
      ctx.font = font; ctx.textBaseline = 'top';
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = '#fdfcf7'; ctx.strokeStyle = '#1b2a4a'; ctx.lineWidth = LW;
      speechBubblePath(ctx, LW, LW, cw - LW * 2, bodyH - LW * 2, R, TAIL, TAIL);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1b2a4a';
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], PAD, PAD + i * LH);
      if (ent.bubble.texture) ent.bubble.texture.dispose();
      const tex = new THREE.CanvasTexture(cv);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      twSetTextureSRGB(tex);
      tex.needsUpdate = true;
      ent.bubble.sprite.material.map = tex;
      ent.bubble.sprite.material.needsUpdate = true;
      ent.bubble.texture = tex;
      const K = 0.011;
      ent.bubble.sprite.scale.set((cw / S) * K, (ch / S) * K, 1);
    }
    function showChatBubble(id, rawText) {
      let text = String(rawText == null ? '' : rawText).trim();
      if (!text) return;
      if (text.length > BUBBLE_MAX_CHARS) text = text.slice(0, BUBBLE_MAX_CHARS - 1).trimEnd() + '…';
      const myId = WS.getMyId ? WS.getMyId() : null;
      const selfEnt = WS.selfEnt ? WS.selfEnt() : null;
      const peerEnts = WS.peerEnts ? WS.peerEnts() : null;
      const ent = (id != null && id === myId) ? selfEnt : (peerEnts ? peerEnts.get(id) : null);
      if (!ent || !ent.sprite) return;
      if (!ent.bubble) {
        if (typeof THREE === 'undefined') return;
        const canvas = document.createElement('canvas');
        const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.center.set(0.5, 0);
        sprite.renderOrder = 12;
        const par = WS.avatarParent ? WS.avatarParent() : null; if (par) par.add(sprite);
        ent.bubble = { canvas: canvas, sprite: sprite, texture: null, text: null, start: 0 };
      }
      ent.bubble.text = text;
      ent.bubble.start = Date.now();
      ent.bubble.sprite.visible = true;
      ent.bubble.sprite.material.opacity = 1;
      renderBubble(ent, text);
    }
    function updateBubble(ent) {
      if (!ent || !ent.bubble || !ent.bubble.sprite) return;
      const b = ent.bubble;
      const age = Date.now() - b.start;
      if (age >= BUBBLE_MS) { removeBubble(ent); return; }
      if (ent.sprite) b.sprite.position.set(ent.sprite.position.x, ent.sprite.position.y + BUBBLE_HEAD_Y, ent.sprite.position.z);
      const fadeIn = age > (BUBBLE_MS - BUBBLE_FADE_MS) ? Math.max(0, (BUBBLE_MS - age) / BUBBLE_FADE_MS) : 1;
      b.sprite.material.opacity = fadeIn;
    }
    function removeBubble(ent) {
      if (!ent || !ent.bubble) return;
      const b = ent.bubble; ent.bubble = null;
      if (b.sprite && b.sprite.parent) b.sprite.parent.remove(b.sprite);
      if (b.texture) b.texture.dispose();
      if (b.sprite && b.sprite.material) b.sprite.material.dispose();
    }
    WS.showChatBubble = showChatBubble;
    WS._updateBubble = updateBubble;
    WS._removeBubble = removeBubble;
  })();
