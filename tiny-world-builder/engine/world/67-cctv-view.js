// 64-cctv-view.js — "CCTV only" view mode for the world page.
//
// Reached via tiny-world-builder.html?world=tidewater-bay&view=cctv (embedded
// as an iframe by community.html). It rides the normal ?world= auto-enter flow,
// joins the live PartyKit room as a passive observer, hides all builder/play
// chrome, and re-displays the existing Truman CCTV feeds as a vertical stack on
// the main canvas. Non-lobby worlds do not run this mode.
//
// It does NOT re-implement the cameras, CRT shader, captions, or tracking — those
// already run in 62-cctv-truman.js / 63-cctv-placement.js. This module only:
//   1) forces role 'observe' (read by enterWorldFull in 46-worlds-universe.js),
//   2) hides everything but the canvas,
//   3) builds an orthographic "video wall" scene of planes textured with the
//      feeds' own CRT-shaded materials (via __tinyworldCCTV.monitorMaterialFor),
//   4) draws that wall to the canvas each frame in place of the world (the loop
//      in 25-animation-loop-schema.js calls renderWall() when active).
(function () {
  'use strict';

  function qp(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (_) { return null; }
  }

  // Expose state early so the animation loop can see it even before we build.
  const api = { active: false, renderWall: renderWall };
  window.__tinyworldCctvView = api;

  if (qp('view') !== 'cctv') return; // no-op on the normal page
  const lobbyWorldSlug = String(window.__TW_LOBBY_WORLD_SLUG || 'tidewater-bay').toLowerCase();
  const requestedWorldSlug = String(qp('world') || qp('slug') || '').toLowerCase();
  if (requestedWorldSlug && requestedWorldSlug !== lobbyWorldSlug) return;

  // Join as a spectator (no avatar). enterWorldFull() honours this global.
  window.__tinyworldForceRole = 'observe';
  api.active = true;

  // ---- hide all chrome; the canvas shows the feed wall -----------------------
  function installHideCss() {
    if (document.getElementById('tw-cctv-view-style')) return;
    const st = document.createElement('style');
    st.id = 'tw-cctv-view-style';
    st.textContent = [
      'html.tw-cctv-view, body.tw-cctv-view { background:#05060a !important; overflow:hidden !important; }',
      // hide every direct child of <body> except the app/canvas host
      'body.tw-cctv-view > *:not(#app):not(script):not(style) { display:none !important; }',
      // inside #app keep only the WebGL canvas (HUD overlays live here too)
      'body.tw-cctv-view #app > *:not(canvas) { display:none !important; }',
      'body.tw-cctv-view #app, body.tw-cctv-view #app canvas { width:100% !important; height:100% !important; }',
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }
  function addClass() {
    try {
      document.documentElement.classList.add('tw-cctv-view');
      if (document.body) document.body.classList.add('tw-cctv-view');
    } catch (_) {}
  }
  installHideCss();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addClass);
  } else { addClass(); }

  // ---- the video-wall scene --------------------------------------------------
  function THREEref() { return (typeof THREE !== 'undefined') ? THREE : (window.THREE || null); }
  function rendererRef() { return (typeof renderer !== 'undefined' && renderer) ? renderer : null; }
  function CCTV() { return window.__tinyworldCCTV || null; }

  let wallScene = null, wallCam = null, built = false, notifiedReady = false;
  let gridW = 1, gridH = 1;

  function buildWall() {
    const T = THREEref(); if (!T) return false;
    const cc = CCTV(); if (!cc || typeof cc.feeds !== 'function' || typeof cc.monitorMaterialFor !== 'function') return false;
    const feeds = cc.feeds() || [];
    if (!feeds.length) return false;

    wallScene = new T.Scene();
    wallCam = new T.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    wallCam.position.set(0, 0, 5);

    const n = feeds.length;
    const cols = 1;
    const rows = n;
    const cellW = 4, cellH = 3, gap = 0.3;          // 4:3 cells to match the feeds
    const pitchX = cellW + gap, pitchY = cellH + gap;
    gridW = cols * pitchX - gap;
    gridH = rows * pitchY - gap;

    feeds.forEach((f, i) => {
      const mat = cc.monitorMaterialFor(f.id);
      if (!mat) return;
      const col = i % cols, row = Math.floor(i / cols);
      const x = -gridW / 2 + cellW / 2 + col * pitchX;
      const y = gridH / 2 - cellH / 2 - row * pitchY;
      const mesh = new T.Mesh(new T.PlaneGeometry(cellW, cellH), mat);
      mesh.position.set(x, y, 0);
      wallScene.add(mesh);
    });

    built = wallScene.children.length > 0;
    return built;
  }

  // Called by the animation loop (25) when api.active. Returns true if it drew
  // or cleared the canvas. It never falls back to the world render in CCTV mode,
  // because the parent community panel keeps the iframe hidden until this wall is ready.
  function renderWall() {
    if (!api.active) return false;
    const T = THREEref(); if (!T) return false;
    const r = rendererRef(); if (!r) return false;
    if (!built && !buildWall()) {
      const prevTarget = r.getRenderTarget();
      const prevClear = new T.Color(); r.getClearColor(prevClear);
      const prevAlpha = r.getClearAlpha();
      r.setRenderTarget(null);
      r.setClearColor(0x05060a, 1);
      r.clear();
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevClear, prevAlpha);
      return true;
    }

    const size = r.getSize(new T.Vector2());
    const aspect = size.x / Math.max(1, size.y);
    const gridAspect = gridW / gridH;
    let viewW, viewH;
    if (aspect > gridAspect) { viewH = gridH / 2; viewW = viewH * aspect; }
    else { viewW = gridW / 2; viewH = viewW / aspect; }
    wallCam.left = -viewW; wallCam.right = viewW; wallCam.top = viewH; wallCam.bottom = -viewH;
    wallCam.updateProjectionMatrix();

    // Draw to the canvas without disturbing the feed-capture render state.
    const prevTarget = r.getRenderTarget();
    const prevClear = new T.Color(); r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();
    const prevAutoClear = r.autoClear;
    r.setRenderTarget(null);
    r.autoClear = true;
    r.setClearColor(0x05060a, 1);
    r.clear();
    r.render(wallScene, wallCam);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    r.autoClear = prevAutoClear;
    if (!notifiedReady) {
      notifiedReady = true;
      try { parent.postMessage({ type: 'tinyworld:cctv-ready' }, location.origin); } catch (_) {}
    }
    return true;
  }
})();
