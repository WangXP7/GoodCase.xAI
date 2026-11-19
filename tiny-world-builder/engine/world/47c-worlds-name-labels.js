  // -------- name labels (extracted from 47-worlds-room.js) --------
  // A persistent pill with the player's name floating above the avatar's head.
  // Rendered to a CanvasTexture on a THREE.Sprite, so it always faces the camera.
  // Depends on THREE, camera, renderer, WS.avatarParent() — all from earlier modules.
  (function () {
    'use strict';
    const WS = (window.__tinyworldWorlds = window.__tinyworldWorlds || {});
    const NAME_HEAD_Y = 1.15;
    const NAME_TAG_SCREEN_HEIGHT = 30;
    const NAME_TAG_ASPECT = 4;
    const NAME_TAG_TMP_POS = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;
    const NAME_TAG_TMP_CAM = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;

    function roundRectLabel(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
    }
    function makeNameLabel(name, color) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '700 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
      const label = String(name || 'Builder').slice(0, 28);
      const width = Math.min(230, Math.max(72, ctx.measureText(label).width + 28));
      ctx.fillStyle = 'rgba(24, 28, 38, 0.84)';
      roundRectLabel(ctx, (256 - width) / 2, 12, width, 36, 12);
      ctx.fill();
      ctx.fillStyle = color || '#3c82f7';
      ctx.beginPath();
      ctx.arc((256 - width) / 2 + 18, 30, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 128, 31);
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(1.55, 0.38, 1);
      sprite.userData.nameTagAspect = canvas.width / canvas.height || NAME_TAG_ASPECT;
      sprite.renderOrder = 13;
      return sprite;
    }
    function nameTagViewportHeight() {
      try {
        if (typeof renderer !== 'undefined' && renderer && renderer.domElement) {
          return renderer.domElement.clientHeight || renderer.domElement.height || window.innerHeight || 720;
        }
      } catch (_) {}
      return (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 720;
    }
    function updateNameLabelScale(sprite) {
      if (!sprite || typeof camera === 'undefined' || !camera) return;
      const viewH = Math.max(1, nameTagViewportHeight());
      let worldPerPixel = 0;
      if (camera.isOrthographicCamera) {
        const zoom = camera.zoom || 1;
        worldPerPixel = Math.abs((camera.top - camera.bottom) / zoom) / viewH;
      } else if (camera.isPerspectiveCamera && NAME_TAG_TMP_POS && NAME_TAG_TMP_CAM) {
        sprite.getWorldPosition(NAME_TAG_TMP_POS);
        camera.getWorldPosition(NAME_TAG_TMP_CAM);
        const dist = Math.max(0.05, NAME_TAG_TMP_POS.distanceTo(NAME_TAG_TMP_CAM));
        const fov = (typeof THREE !== 'undefined' && THREE.MathUtils)
          ? THREE.MathUtils.degToRad(camera.fov || 50)
          : (camera.fov || 50) * Math.PI / 180;
        worldPerPixel = (2 * Math.tan(fov / 2) * dist) / viewH;
      }
      if (!(worldPerPixel > 0)) return;
      const h = worldPerPixel * NAME_TAG_SCREEN_HEIGHT;
      const aspect = (sprite.userData && sprite.userData.nameTagAspect) || NAME_TAG_ASPECT;
      sprite.scale.set(h * aspect, h, 1);
    }
    function ensureNameLabel(ent, name, color) {
      if (!ent || !ent.sprite || typeof THREE === 'undefined') return;
      const text = String(name == null ? '' : name).trim() || 'Builder';
      const col = color || '#3c82f7';
      ent.name = text;
      if (ent.nameTag && ent.nameTag.text === text && ent.nameTag.color === col) return;
      removeNameLabel(ent);
      const sprite = makeNameLabel(text, col);
      const par = WS.avatarParent ? WS.avatarParent() : null; if (par) par.add(sprite);
      ent.nameTag = { sprite: sprite, text: text, color: col };
    }
    function updateNameLabel(ent) {
      if (!ent || !ent.nameTag || !ent.nameTag.sprite) return;
      const s = ent.nameTag.sprite;
      const bubbleUp = !!(ent.bubble && ent.bubble.sprite && ent.bubble.sprite.visible);
      const show = !!ent.sprite && ent.sprite.visible !== false && !bubbleUp;
      s.visible = show;
      if (show) {
        s.position.set(ent.sprite.position.x, ent.sprite.position.y + NAME_HEAD_Y, ent.sprite.position.z);
        updateNameLabelScale(s);
      }
    }
    function removeNameLabel(ent) {
      if (!ent || !ent.nameTag) return;
      const s = ent.nameTag.sprite; ent.nameTag = null;
      if (s && s.parent) s.parent.remove(s);
      if (s && s.material) { if (s.material.map) s.material.map.dispose(); s.material.dispose(); }
    }
    WS._ensureNameLabel = ensureNameLabel;
    WS._updateNameLabel = updateNameLabel;
    WS._removeNameLabel = removeNameLabel;
    // Raw sprite factory, for callers that need a standalone billboard (not
    // tied to an avatar `ent`) — e.g. flight-ghost name tags in 47-worlds-room.js.
    WS._makeNameLabelSprite = makeNameLabel;
  })();
