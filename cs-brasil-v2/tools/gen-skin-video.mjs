// Vídeo curto de cada skin da loja, para o hover do card (pedido do dono, 14/10/2026).
//
// Os quadros saem do GLB REAL da skin, pelo mesmo caminho do jogo: public/charvideo.html
// com ?skin=<id> chama preloadCosmeticAssets() e buildCharacterModel() de glbchars.js.
// Nada é gerado por IA aqui. O personagem gira 360° (turntable) enquanto toca o idle;
// a duração é um múltiplo inteiro do clipe idle entre 2 e 4 s, então o último quadro
// emenda no primeiro e o loop não pula.
//
// Fundo: o render sai com alfa e é composto sobre o mesmo gradiente radial do card
// (.treta-card em public/treta.css, cor da skin a 28% sobre #282a25, até #171913).
// Quadro quadrado: a área da imagem do card é quase quadrada em todos os breakpoints
// (270×260, 230 e 176 px de altura), e o vídeo entra nela com object-fit: cover,
// cobrindo a área inteira sem emenda de fundo.
// Saídas por skin, em public/video/skins/:
//   <id>.webm (VP9) · <id>.mp4 (H.264, fallback) · <id>.webp (poster = pose do instante zero do loop)
// e o campo `video` da skin em public/models/skins/manifest.json.
// Teto: 400 KB por vídeo. Se passar, o CRF sobe até caber; se não couber, falha.
//
// Uso (servidor próprio, nunca a 8123 de outra sessão):
//   node tools/eval/serve.mjs 9311 &
//   tools/eval/with-browser-lock.sh node tools/gen-skin-video.mjs --base http://localhost:9311
//   ... --ids janja,lula-drip   (padrão: todas as skins aprovadas do manifesto)
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { TRETA_SKINS } from '../public/js/treta-catalog.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const die = (m) => { console.error('ERRO:', m); process.exit(1); };

const BASE = arg('base') || die('passe --base http://localhost:<porta> (serve.mjs próprio)');
const FPS = 24, W = 480, H = 480, MAX_BYTES = 400 * 1024;
const OUT = 'public/video/skins';
const MANIFEST = 'public/models/skins/manifest.json';
const TMP = '/tmp/gen-skin-video';
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const approved = Object.entries(manifest.skins).filter(([, e]) => e.approved === true).map(([id]) => id);
const IDS = arg('ids') ? arg('ids').split(',') : approved;
for (const id of IDS) if (!approved.includes(id)) die(`${id} não é skin aprovada no manifesto`);

/* Duração do loop: o maior múltiplo inteiro do idle que cabe em 4 s, nunca abaixo de 2 s. */
export function loopSecs(idle) {
  if (!(idle > 0)) return 4;
  const k = Math.max(1, Math.floor(4 / idle));
  const secs = k * idle;
  return secs >= 2 ? secs : Math.ceil(2 / idle) * idle;
}

function plate(color, file) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
<radialGradient id="g" cx="50%" cy="30%" r="80%" fx="50%" fy="30%"><stop offset="0" stop-color="${mix(color)}"/><stop offset=".85" stop-color="#171913"/></radialGradient>
</defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toFile(file);
}
/* color-mix(in srgb, cor 28%, #282a25), o mesmo do CSS do card. */
function mix(hex) {
  const a = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16)), b = [0x28, 0x2a, 0x25];
  return '#' + a.map((v, i) => Math.round(v * 0.28 + b[i] * 0.72).toString(16).padStart(2, '0')).join('');
}

function encode(dir, bg, out, kind, crf) {
  const input = ['-y', '-loglevel', 'error', '-i', bg, '-framerate', String(FPS), '-i', `${dir}/%04d.png`,
    '-filter_complex', '[0:v][1:v]overlay=format=auto,format=yuv420p', '-an'];
  const codec = kind === 'webm'
    ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2']
    : ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-movflags', '+faststart'];
  execFileSync('ffmpeg', [...input, ...codec, '-r', String(FPS), out], { stdio: 'pipe' });
  return statSync(out).size;
}
function fit(dir, bg, out, kind) {
  for (let crf = kind === 'webm' ? 32 : 22; crf <= (kind === 'webm' ? 52 : 36); crf += 2) {
    const bytes = encode(dir, bg, out, kind, crf);
    if (bytes <= MAX_BYTES) return { bytes, crf };
  }
  die(`${out} não coube em ${MAX_BYTES} bytes`);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = [];
for (const id of IDS) {
  const spec = TRETA_SKINS.find((s) => s.id === id) || die(`${id} fora de TRETA_SKINS`);
  const dir = `${TMP}/${id}`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const probe = `${BASE}/charvideo.html?skin=${id}&bg=alpha&shot=corpo&fatia=1.04&exp=1.4&w=${W}&h=${H}&fps=${FPS}`;
  await page.goto(probe, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.CHARVID?.ready, null, { timeout: 120000 }).catch(() => die(`${id}: página não ficou pronta ${errors.join(' | ')}`));
  const info = await page.evaluate(() => ({ skinned: window.CHARVID.skinned, idle: window.CHARVID.idleSecs }));
  if (!info.skinned) die(`${id}: o modelo montado não é o GLB da skin`);
  const secs = loopSecs(info.idle), frames = Math.round(secs * FPS), spin = 360 / (frames / FPS);
  await page.goto(`${probe}&spin=${spin}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.CHARVID?.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.CHARVID.reset());
  for (let f = 0; f < frames; f++) {
    const url = await page.evaluate((fps) => { window.CHARVID.step(1 / fps); return window.CHARVID.grab(); }, FPS);
    writeFileSync(`${dir}/${String(f).padStart(4, '0')}.png`, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  }
  await page.close();
  const bg = `${dir}/bg.png`;
  await plate(spec.color, bg);
  const webm = fit(dir, bg, `${OUT}/${id}.webm`, 'webm');
  const mp4 = fit(dir, bg, `${OUT}/${id}.mp4`, 'mp4');
  /* Poster = o último quadro, que é a mesma pose do instante zero do loop. */
  await sharp(bg).composite([{ input: `${dir}/${String(frames - 1).padStart(4, '0')}.png` }]).webp({ quality: 80 }).toFile(`${OUT}/${id}.webp`);
  const poster = statSync(`${OUT}/${id}.webp`).size;
  manifest.skins[id].video = { webm: `/video/skins/${id}.webm`, mp4: `/video/skins/${id}.mp4`, poster: `/video/skins/${id}.webp`, seconds: +secs.toFixed(3), width: W, height: H };
  report.push({ id, idle: +info.idle.toFixed(3), secs: +secs.toFixed(3), frames, webm, mp4, poster });
  console.log(`✓ ${id} · ${secs.toFixed(2)} s · webm ${(webm.bytes / 1024).toFixed(0)} KB (crf ${webm.crf}) · mp4 ${(mp4.bytes / 1024).toFixed(0)} KB (crf ${mp4.crf}) · poster ${(poster / 1024).toFixed(0)} KB`);
  rmSync(dir, { recursive: true, force: true });
}
await browser.close();
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(`${TMP}-report.json`, JSON.stringify(report, null, 2));
console.log(`pronto: ${report.length} skin(s) em ${OUT}/ · relatório ${TMP}-report.json`);
