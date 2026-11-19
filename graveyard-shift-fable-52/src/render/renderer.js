// WebGL2 renderer. Draws at a capped internal resolution (G.quality.maxHeight x G.quality.renderScale)
// and lets CSS scale the canvas to the window. No built-in tone mapping: the scene is rendered linear HDR into
// G.post.targets.scene and the post chain owns everything after that.
import {
  WebGLRenderer, NoToneMapping, Mesh, MeshStandardMaterial, MeshBasicMaterial, SphereGeometry,
  PlaneGeometry, BoxGeometry, PointLight, HemisphereLight, Color, Group,
} from 'three';
import { internalSize } from './quality.js';
import { installShaderErrorReport } from './warm.js';

const RESTORE_WAIT_MS = 3000; // how long a lost context gets to come back before the reload message

// Full-window message for states the game cannot recover from by itself.
function showOverlay(id, title, detail, withReload) {
  let el = document.getElementById(id);
  if (el) return el;
  el = document.createElement('div');
  el.id = id;
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;'
    + 'gap:14px;padding:24px;text-align:center;background:#05070a;color:#ece6d6;font:16px/1.5 Overpass,"Helvetica Neue","Segoe UI",Roboto,Arial,sans-serif;';
  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = 'font-size:22px;font-weight:600;color:#ff4a3d;';
  const p = document.createElement('div');
  p.textContent = detail;
  p.style.cssText = 'max-width:520px;color:#a3a49b;';
  el.append(h, p);
  if (withReload) {
    const b = document.createElement('button');
    b.textContent = 'Reload';
    b.style.cssText = 'margin-top:6px;padding:10px 22px;font:inherit;color:#1d0503;background:#ff4a3d;border:0;border-radius:4px;cursor:pointer;';
    b.addEventListener('click', () => window.location.reload());
    el.append(b);
  }
  document.body.appendChild(el);
  return el;
}

export function createRenderer(G) {
  const host = document.getElementById('app');
  const canvas = document.createElement('canvas');
  // The default framebuffer only ever receives the final fullscreen pass: no depth, stencil or MSAA.
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
    showOverlay('gfx-unsupported', 'This game needs WebGL2',
      'Your browser or graphics driver does not provide WebGL2 with floating-point render targets. Try a current version of Chrome, and check that hardware acceleration is turned on.', false);
    throw new Error('WebGL2 with float render targets is unavailable');
  }

  const renderer = new WebGLRenderer({ canvas, context: gl });
  renderer.toneMapping = NoToneMapping;
  renderer.autoClear = false; // the post chain clears explicitly; blended fullscreen passes must not clear
  renderer.info.autoReset = false; // the post chain resets once per frame so __stats() counts the whole frame
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(1);
  installShaderErrorReport(renderer);
  host.appendChild(canvas);

  // Context loss (a phone sent to the background, a driver reset). The browser may hand the context
  // back: three rebuilds its GL state, every render target and uploaded texture is re-created on
  // next use, and the game carries on from its pause screen. Textures that were DRAWN once (noise
  // volumes, the sky capture, baked atlases) come back empty: their owners redraw them on the
  // `renderer:restored` event. Only if nothing comes back within RESTORE_WAIT_MS does the reload
  // message go up.
  let lostTimer = 0;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // without this the browser never restores
    console.warn('[renderer] WebGL context lost');
    // nothing can be drawn: stop the round and the sound with it, rather than let both run on unseen
    if (G.game && G.game.state === 'playing' && typeof G.game.pause === 'function') G.game.pause();
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => {
      lostTimer = 0;
      showOverlay('gfx-lost', 'Graphics context lost', 'The browser took the graphics device away from this page. Reload to continue.', true);
    }, RESTORE_WAIT_MS);
  });
  // Registered after three's own listener, so its state is already rebuilt when this runs.
  // `renderer:restored {}` is emitted on every restore, whatever the steps before it do.
  canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(lostTimer); lostTimer = 0;
    console.warn('[renderer] WebGL context restored');
    try {
      const el = document.getElementById('gfx-lost');
      if (el) el.remove(); // it came back late: take the message down again
      resize();
      if (G.post && G.post.snapExposure) G.post.snapExposure(); // the adaptation history went with the context
      if (G.lights && G.lights.snap) G.lights.snap();
      // the next frames recompile every shader: not the frame rate, so dynamic resolution must not see them
      if (G.quality && G.quality.resetFrameTimes) G.quality.resetFrameTimes();
    } catch (e) {
      console.error(`[renderer] after the context restore: ${e && e.message}`);
    } finally {
      // anything drawn once into a texture (noise, baked maps, the sky capture, shadow atlases) is empty now: owners redraw on this
      if (G.events) G.events.emit('renderer:restored', {});
    }
  });

  const resize = () => {
    const { w, h } = internalSize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, G.quality.maxHeight, G.quality.renderScale ?? 1);
    renderer.setSize(w, h, false);
    G.camera.aspect = w / h;
    G.camera.updateProjectionMatrix();
    if (G.post && G.post.resize) G.post.resize(w, h);
  };
  // iOS can report the old innerWidth/innerHeight in the resize event itself (rotation, the toolbar
  // folding away): size again on the next animation frame, when the new values are in.
  let resizeFrame = 0;
  const onWindowResize = () => {
    resize();
    if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; resize(); });
  };
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', onWindowResize);
  if (G.quality.onChange) G.quality.onChange(resize);
  if (G.quality.onScale) G.quality.onScale(resize);
  resize();
  return renderer;
}

// ?shot=posttest: the image-pipeline test scene. Scene-linear units: 1.0 is diffuse white at
// exposure 1; the strip is 50, the small sodium source is 400.
export function installPostTestScene(G) {
  const root = new Group();
  root.name = 'posttest';
  const add = (geo, mat, x, y, z) => { const m = new Mesh(geo, mat); m.position.set(x, y, z); root.add(m); return m; };

  // black floor and a dark back wall: both carry long, dim light falloffs (banding test)
  const floor = add(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: 0x050505, roughness: 0.55 }), 0, 0, 0);
  floor.rotation.x = -Math.PI / 2;
  add(new PlaneGeometry(40, 12), new MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95 }), 0, 6, -6);

  // grey spheres, roughness 0.1 .. 0.9
  const sphere = new SphereGeometry(0.5, 64, 32);
  [0.1, 0.3, 0.5, 0.7, 0.9].forEach((roughness, i) => {
    add(sphere, new MeshStandardMaterial({ color: 0x808080, roughness }), (i - 2) * 1.3, 0.5, 0);
  });

  // emissive strip, radiance 50, with matching point lights so it actually lights the spheres
  add(new BoxGeometry(3.2, 0.07, 0.07), new MeshBasicMaterial({ color: new Color(50, 50, 50) }), 0, 2.6, 0.6);
  for (const x of [-1.2, 0, 1.2]) {
    const l = new PointLight(0xffffff, 5, 0, 2);
    l.position.set(x, 2.5, 0.6);
    root.add(l);
  }

  // one small, very bright sodium source off to the side: the night case (tiny and far above white)
  const sodium = new Color(1.0, 0.52, 0.12);
  add(new SphereGeometry(0.06, 24, 12), new MeshBasicMaterial({ color: sodium.clone().multiplyScalar(400) }), 4.6, 3.1, -3.5);
  const lamp = new PointLight(sodium, 14, 0, 2);
  lamp.position.set(4.5, 3.0, -3.4);
  root.add(lamp);

  // a trace of cold sky light so unlit surfaces sit just above black
  root.add(new HemisphereLight(0x8fa6c8, 0x05070a, 0.02));

  G.scene.add(root);
  G.shotCam = { cam: [0, 1.5, 5.2, 0, -0.06], fov: 55 };
  return root;
}
