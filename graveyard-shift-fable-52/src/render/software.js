// Is the page drawing without the graphics card? A software renderer (SwiftShader, Microsoft's
// Basic Render Driver / WARP, Mesa's llvmpipe) names itself in the WebGL renderer string. The game
// still loads there, slowly; the loading screen and the boot details say so, and the effects
// atlases are drawn at half size (fx/atlas.js).
export const SOFTWARE_RE = /swiftshader|basic render driver|microsoft basic render|llvmpipe|softpipe|software/i;
export const isSoftwareRenderer = (name) => !!name && SOFTWARE_RE.test(String(name));

export const SOFTWARE_TEXT = 'Your browser is drawing without your graphics card (hardware acceleration is off or unavailable). The game will load slowly and run poorly. Turn on hardware acceleration in your browser settings and reload.';
export const SOFTWARE_HOWTO = [
  'Chrome or Edge: Settings > System > turn on "Use graphics acceleration when available" (Chrome: "Use hardware acceleration when available"), then relaunch.',
  'Firefox: Settings > General > Performance > untick "Use recommended performance settings", tick "Use hardware acceleration when available", then restart.',
];

// The renderer string of a WebGL context ('' when it cannot be read).
export function rendererName(gl) {
  try {
    if (!gl || (gl.isContextLost && gl.isContextLost())) return '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  } catch { return ''; }
}
