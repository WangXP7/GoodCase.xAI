/* QR Code (ISO/IEC 18004) em modo byte, correção M, versões 1 a 10: cobre o link de convite sem dependência. */
const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCOS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

const mul = (x, y) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z;
};
function divisor(grau) {
  const r = new Array(grau).fill(0); r[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < grau; j++) { r[j] = mul(r[j], raiz); if (j + 1 < grau) r[j] ^= r[j + 1]; }
    raiz = mul(raiz, 2);
  }
  return r;
}
function resto(dados, div) {
  const r = new Array(div.length).fill(0);
  for (const b of dados) {
    const f = b ^ r.shift(); r.push(0);
    div.forEach((c, i) => { r[i] ^= mul(c, f); });
  }
  return r;
}
const modulosBrutos = (v) => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
};
const capacidade = (v) => Math.floor(modulosBrutos(v) / 8) - ECC[v] * BLOCOS[v];
function alinhamentos(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, passo = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, lado = v * 4 + 17;
  const r = [6];
  for (let i = n - 2; i >= 0; i--) r.splice(1, 0, lado - 7 - i * passo);
  return r.sort((a, b) => a - b);
}
const MASCARAS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

/** Matriz de módulos (true = escuro) do texto, ou null se ele não cabe na versão 10. */
export function qrMatriz(texto) {
  const bytes = [...new TextEncoder().encode(texto)];
  let v = 1;
  while (v <= 10 && capacidade(v) < bytes.length + 2) v++;
  if (v > 10) return null;
  const bits = [];
  const poe = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  poe(4, 4); poe(bytes.length, 8); for (const b of bytes) poe(b, 8);
  const cap = capacidade(v) * 8;
  poe(0, Math.min(4, cap - bits.length));
  poe(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) poe(p, 8);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const nb = BLOCOS[v], ecc = ECC[v], brutos = Math.floor(modulosBrutos(v) / 8);
  const curtos = nb - (brutos % nb), lenCurto = Math.floor(brutos / nb), div = divisor(ecc);
  const blocos = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = dados.slice(k, k + lenCurto - ecc + (i < curtos ? 0 : 1)); k += d.length;
    const e = resto(d, div);
    if (i < curtos) d.push(0);
    blocos.push(d.concat(e));
  }
  const final = [];
  for (let i = 0; i < blocos[0].length; i++)
    blocos.forEach((b, j) => { if (i !== lenCurto - ecc || j >= curtos) final.push(b[i]); });

  const n = v * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  const fixo = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (x, y, escuro) => { m[y][x] = escuro; fixo[y][x] = true; };
  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
    }
  const al = alinhamentos(v);
  for (const ax of al) for (const ay of al) {
    if ((ax === 6 && ay === 6) || (ax === 6 && ay === n - 7) || (ax === n - 7 && ay === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const formato = (mascara) => {
    const d = mascara;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true);
  };
  formato(0);
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) === 1, a = n - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); }
  }
  let i = 0;
  for (let dir = n - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const x = dir - j, y = ((dir + 1) & 2) === 0 ? n - 1 - vert : vert;
      if (!fixo[y][x] && i < final.length * 8) { m[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  let melhor = null, menor = Infinity;
  for (let k = 0; k < 8; k++) {
    const t = m.map((linha, y) => linha.map((e, x) => (fixo[y][x] ? e : e !== MASCARAS[k](x, y))));
    const p = penalidade(t);
    if (p < menor) { menor = p; melhor = k; }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fixo[y][x] && MASCARAS[melhor](x, y)) m[y][x] = !m[y][x];
  formato(melhor);
  return m;
}

function penalidade(m) {
  const n = m.length;
  let p = 0, escuros = 0;
  for (let y = 0; y < n; y++) for (const eixo of [0, 1]) {
    let corrida = 1;
    for (let x = 1; x <= n; x++) {
      const igual = x < n && (eixo ? m[x][y] === m[x - 1][y] : m[y][x] === m[y][x - 1]);
      if (igual) corrida++; else { if (corrida >= 5) p += corrida - 2; corrida = 1; }
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) escuros++;
    if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  }
  return p + Math.floor(Math.abs(escuros * 20 - n * n * 10) / (n * n)) * 10;
}

/** SVG com 4 módulos de margem silenciosa; cores do pacote (asfalto sobre tinta). */
export function qrSvg(texto, rotulo = '') {
  const m = qrMatriz(texto);
  if (!m) return null;
  const n = m.length, ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `-4 -4 ${n + 8} ${n + 8}`);
  svg.setAttribute('role', 'img');
  if (rotulo) svg.setAttribute('aria-label', rotulo);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const fundo = document.createElementNS(ns, 'rect');
  for (const [k, val] of [['x', -4], ['y', -4], ['width', n + 8], ['height', n + 8], ['fill', '#f0f0ed']]) fundo.setAttribute(k, val);
  let d = '';
  m.forEach((linha, y) => linha.forEach((e, x) => { if (e) d += `M${x} ${y}h1v1h-1z`; }));
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d); path.setAttribute('fill', '#090704');
  svg.append(fundo, path);
  return svg;
}
