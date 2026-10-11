// standalone.js —— 单文件版的入口：在同一页里切换正常版 / 像素版
import { boot } from './app.js';

const stage = document.getElementById('stage');
const hud = document.getElementById('hud');
const btnRotate = document.getElementById('btn-rotate');
const tag = document.getElementById('tag');
const subtitle = document.getElementById('subtitle');

const TAGS = {
  smooth: '平滑几何 · ACES 色调映射 · 阴影贴图 2048',
  voxel: '体素化 + 240P 内部缓冲 + 最近邻放大',
};
const SUBTITLE = { smooth: '鹈鹕骑自行车 · 正常版 3D', voxel: '鹈鹕骑自行车 · 像素版 3D' };

let app = null;
let wantRotate = true;
let current = null;

function setMode(mode) {
  if (current === mode) return;
  current = mode;

  if (app) { app.dispose(); app = null; }

  document.body.classList.toggle('pixel', mode === 'voxel');
  document.documentElement.lang = 'zh-CN';
  document.title = '鹈鹕骑自行车 3D · ' + (mode === 'voxel' ? '像素版' : '正常版');
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('cur', b.dataset.mode === mode));
  if (tag) tag.textContent = TAGS[mode];
  if (subtitle) subtitle.textContent = SUBTITLE[mode];

  app = boot(mode, {
    stage,
    autoRotate: wantRotate,
    onFirstFrame(a) {
      hud.classList.add('ready');
      a.controls.autoRotate = wantRotate;
      const info = a.renderer.info.render;
      window.__DIAG__ = {
        mode: a.mode,
        triangles: info.triangles,
        drawCalls: info.calls,
        canvasBuffer: [a.canvas.width, a.canvas.height],
        parts: a.rig.parts.length,
        kneeSample: a.rig.state.knee,
      };
    },
  });
  window.__APP__ = app;

  try {
    const u = new URL(location.href);
    if (mode === 'voxel') u.searchParams.set('mode', 'pixel');
    else u.searchParams.delete('mode');
    history.replaceState(null, '', u);
  } catch (e) { /* file:// 下可能不允许，忽略 */ }
}

document.querySelectorAll('[data-mode]').forEach((b) => {
  b.addEventListener('click', (e) => { e.preventDefault(); setMode(b.dataset.mode); });
});

if (btnRotate) {
  btnRotate.classList.add('on');
  btnRotate.addEventListener('click', () => {
    wantRotate = !wantRotate;
    btnRotate.classList.toggle('on', wantRotate);
    if (app) app.controls.autoRotate = wantRotate;
  });
}

let initial = 'smooth';
try {
  if (new URLSearchParams(location.search).get('mode') === 'pixel') initial = 'voxel';
} catch (e) { /* 忽略 */ }
setMode(initial);
