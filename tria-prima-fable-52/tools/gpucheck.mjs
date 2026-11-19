// Confirms the headless browser renders on the real GPU and lists the WebGL2 features we rely on.
import { launch } from './pw.mjs';

const { browser, page } = await launch({ width: 640, height: 360 });
await page.setContent('<canvas id="c" width="640" height="360"></canvas>');
const info = await page.evaluate(() => {
  const gl = document.getElementById('c').getContext('webgl2', { antialias: false });
  if (!gl) return { error: 'no webgl2' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const ext = (n) => !!gl.getExtension(n);
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
    colorBufferFloat: ext('EXT_color_buffer_float'),
    colorBufferHalfFloat: ext('EXT_color_buffer_half_float'),
    floatLinear: ext('OES_texture_float_linear'),
    aniso: ext('EXT_texture_filter_anisotropic'),
    timerQuery: ext('EXT_disjoint_timer_query_webgl2'),
    wasm: typeof WebAssembly === 'object',
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
