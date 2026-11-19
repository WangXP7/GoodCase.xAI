// esbuild bundle -> single self-contained $GS_DIST/index.html (js + css inlined, three bundled).
import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, process.env.GS_DIST || 'dist');
const watch = process.argv.includes('--watch');
const MAX_BYTES = 16 * 1024 * 1024;
// Key art: the loading screen's art is inlined as a data URI only while it stays this small, so
// the single file stays self-contained; the link-preview image is a separate file next to index.html.
const MAX_ART_BYTES = 150 * 1024;
const OG_IMAGE = join(root, 'assets/keyart/og.jpg');
const VERCEL_ANALYTICS =
  '<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};<\/script>' +
  '<script defer src="/_vercel/insights/script.js"><\/script>';

// Math.random is banned outside src/core/rng.js (all randomness goes through G.rng).
function checkNoMathRandom() {
  const bad = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js') && !p.endsWith(join('core', 'rng.js')) && /Math\.random/.test(readFileSync(p, 'utf8'))) bad.push(relative(root, p));
    }
  };
  walk(join(root, 'src'));
  if (bad.length) throw new Error(`Math.random is banned outside src/core/rng.js: ${bad.join(', ')}`);
}

const inlinePlugin = {
  name: 'inline-html',
  setup(b) {
    b.onEnd((result) => {
      if (result.errors.length) return;
      const js = result.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
      const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
      // function replacers: bundled code contains "$&" style sequences; "</script" must not appear in inline JS
      const safeJs = js.replace(/<\/script/gi, '<\\/script');
      const html = readFileSync(join(root, 'src/index.html'), 'utf8')
        .replace('<!--LOADING_CSS-->', () => (loading.css ? `<style>${loading.css}</style>` : ''))
        .replace('<!--LOADING_JS-->', () => loading.js)
        .replace('<!--INLINE_CSS-->', () => (css ? `<style>${css}</style>` : ''))
        .replace('<!--INLINE_JS-->', () => safeJs)
        // Vercel Web Analytics: only in builds made on Vercel (VERCEL=1). The artifact and
        // file:// builds stay free of network requests.
        .replace('</head>', () => (process.env.VERCEL ? `${VERCEL_ANALYTICS}</head>` : '</head>'));
      const bytes = Buffer.byteLength(html);
      if (bytes > MAX_BYTES) throw new Error(`index.html is ${bytes} bytes, over the 16 MB limit`);
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, 'index.html'), html);
      copyFileSync(OG_IMAGE, join(dist, 'og.jpg')); // Open Graph / X card, served at /og.jpg
      console.log(`[build] ${join(dist, 'index.html')} ${(bytes / 1024).toFixed(0)} KB`);
    });
  },
};

// Online features (leaderboard, "Report a problem") are configured from the environment at build time
// (see .env.example). Without both settings they are compiled in switched off: no requests are made.
const apiBase = (process.env.GS_API_BASE || '').trim();
const origins = (process.env.GS_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const define = { __GS_API_BASE__: JSON.stringify(apiBase), __GS_ORIGINS__: JSON.stringify(origins) };
console.log(apiBase && origins.length
  ? `[build] online features configured (${origins.length} allowed origin${origins.length === 1 ? '' : 's'})`
  : '[build] online features off (GS_API_BASE / GS_ALLOWED_ORIGINS not set)');

const options = {
  entryPoints: [join(root, 'src/main.js')],
  define,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: !watch,
  sourcemap: false,
  write: false,
  outdir: join(root, '.esbuild-virtual'), // never written; write:false
  logLevel: 'warning',
  plugins: [inlinePlugin],
};

// The loading screen (src/ui/loading.js + loading.css) is its own small bundle, inlined ahead of the game so
// it paints and runs before the game script is parsed. Its images become data URIs.
async function buildLoading() {
  const art = statSync(join(root, 'assets/keyart/keyart-1280.webp')).size;
  if (art > MAX_ART_BYTES) throw new Error(`assets/keyart/keyart-1280.webp is ${art} bytes, over the ${MAX_ART_BYTES} inline limit`);
  const r = await build({
    entryPoints: [join(root, 'src/ui/loading.js')],
    bundle: true, format: 'iife', target: 'es2022', minify: true, write: false,
    outdir: join(root, '.esbuild-virtual'), logLevel: 'warning',
    loader: { '.webp': 'dataurl' },
  });
  const js = r.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
  const css = r.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
  return { js: js.replace(/<\/script/gi, '<\\/script'), css };
}

checkNoMathRandom();
const loading = await buildLoading();
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build] watching src/ ...');
} else {
  await build(options);
}
