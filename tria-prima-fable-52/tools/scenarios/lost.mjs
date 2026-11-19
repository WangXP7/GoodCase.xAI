// The graphics card takes the picture away mid-game: the page must stop, keep the save and say so.
//   node tools/play.mjs tools/scenarios/lost.mjs --live 1 --q high
export default async function ({ ev, log, page, shot }) {
  await page.waitForTimeout(2500);
  await ev(() => {
    TP.play();
  });
  await page.waitForTimeout(2500);
  log('before', JSON.stringify(await ev(() => ({ mode: TP.game.state.mode, save: !!localStorage.getItem(Object.keys(localStorage).find((k) => /tria/i.test(k)) || '') }))));
  const errorsBefore = await ev(() => (window.__errs = []).length);
  await ev(() => {
    window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
    const gl = TP.engine.renderer.getContext();
    gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await page.waitForTimeout(2000);
  const after = await ev(() => {
    const el = document.querySelector('.tp-fatal');
    const r = el ? el.getBoundingClientRect() : null;
    const top = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      note: el ? el.textContent : null,
      onTop: !!(top && el && (top === el || el.contains(top))),
      link: el && el.querySelector('a') ? el.querySelector('a').getAttribute('href') : null,
      audio: TP.game.audio && TP.game.audio.ctx ? TP.game.audio.ctx.state : 'n/a',
      lock: !!document.pointerLockElement,
      errors: window.__errs.slice(0, 3),
      save: Object.keys(localStorage).filter((k) => /tria/i.test(k)),
    };
  });
  log('after', JSON.stringify(after), 'errors before', errorsBefore);
  await shot('lost');
}
