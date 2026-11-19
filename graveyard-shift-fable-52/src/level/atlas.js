// Signage atlas: every piece of printed, painted or back-lit lettering in the level, drawn once
// into a single canvas. All brands, places and people here are invented.
// createAtlas(rng) -> { texture | null, uv(name) -> [u0, v0, u1, v1], aspect(name) }.
// Without a DOM (unit tests) the texture is null and the rectangles are still valid.
import { CanvasTexture, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter } from 'three';

const SIZE = 2048;
const TEAL = '#0e8f88';
const TEAL_D = '#075a57';
const AMBER = '#f5a31a';
const CREAM = '#efe6cf';
const HEAD = '"Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif';
const SANS = '"Helvetica Neue", "Arial", sans-serif';

// maxW: the room the line has, in the cell's pixels. A line that is wider (the first font in the
// stack is missing, or was simply set too big) is set smaller until it fits, so lettering never
// runs under the block beside it or off the edge of its panel.
function text(c, s, x, y, px, color, font = HEAD, align = 'center', weight = '', maxW = 0) {
  c.font = `${weight} ${px}px ${font}`;
  if (maxW > 0) {
    const wd = c.measureText(s).width;
    if (wd > maxW) c.font = `${weight} ${Math.floor((px * maxW) / wd)}px ${font}`;
  }
  c.textAlign = align; c.textBaseline = 'middle';
  c.fillStyle = color;
  c.fillText(s, x, y);
}

// The Nightjar mark: a swept wing over a low moon.
function mark(c, x, y, s, wing = AMBER, moon = CREAM) {
  c.save();
  c.translate(x, y); c.scale(s, s);
  c.fillStyle = moon;
  c.beginPath(); c.arc(0.1, 0.12, 0.3, 0, Math.PI * 2); c.fill();
  c.fillStyle = wing;
  c.beginPath();
  c.moveTo(-0.62, 0.3); c.quadraticCurveTo(-0.2, -0.5, 0.62, -0.42);
  c.quadraticCurveTo(0.1, -0.2, -0.05, 0.12); c.quadraticCurveTo(-0.3, 0.02, -0.62, 0.3);
  c.fill();
  c.restore();
}

function grime(c, w, h, rng, n = 60, alpha = 0.08) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = `rgba(20,16,10,${alpha * rng.next()})`;
    const x = rng.next() * w, y = rng.next() * h, r = 4 + rng.next() * Math.min(w, h) * 0.25;
    c.beginPath(); c.ellipse(x, y, r, r * (0.3 + rng.next()), rng.next() * 3, 0, Math.PI * 2); c.fill();
  }
}

// Seven-segment digits for the price sign and pump displays.
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd' };
function seven(c, ch, x, y, w, h, on, off, dead = '') {
  const t = w * 0.2;
  const segs = {
    a: [x + t, y, w - 2 * t, t], b: [x + w - t, y + t, t, h / 2 - t * 1.5], c: [x + w - t, y + h / 2 + t * 0.5, t, h / 2 - t * 1.5],
    d: [x + t, y + h - t, w - 2 * t, t], e: [x, y + h / 2 + t * 0.5, t, h / 2 - t * 1.5], f: [x, y + t, t, h / 2 - t * 1.5], g: [x + t, y + h / 2 - t / 2, w - 2 * t, t],
  };
  const lit = SEG[ch] || '';
  for (const k of Object.keys(segs)) {
    c.fillStyle = lit.includes(k) && !dead.includes(k) ? on : off;
    const s = segs[k];
    c.fillRect(s[0], s[1], s[2], s[3]);
  }
}
function price(c, str, x, y, dw, dh, on, off, deadAt = -1) {
  let cx = x;
  let n = 0;
  for (const ch of str) {
    if (ch === '.') { c.fillStyle = on; c.fillRect(cx, y + dh - dw * 0.2, dw * 0.2, dw * 0.2); cx += dw * 0.45; continue; }
    seven(c, ch, cx, y, dw, dh, on, off, n === deadAt ? 'bg' : '');
    cx += dw * 1.3; n++;
  }
}

function chalkStroke(c, pts, rng, width = 5) {
  // a few offset passes with broken alpha: reads as dragged chalk, not a vector line
  for (let pass = 0; pass < 3; pass++) {
    c.strokeStyle = `rgba(245,242,230,${0.55 - pass * 0.12})`;
    c.lineWidth = width * (1 - pass * 0.25);
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.setLineDash([6 + rng.next() * 30, 1 + rng.next() * 3]);
    c.beginPath();
    pts.forEach((p, i) => {
      const x = p[0] + (rng.next() - 0.5) * 3, y = p[1] + (rng.next() - 0.5) * 3;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    });
    c.stroke();
  }
  c.setLineDash([]);
}

function poster(bg, draw) {
  return (c, w, h, rng) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    draw(c, w, h, rng);
    grime(c, w, h, rng, 30, 0.1);
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, w - 3, h - 3);
  };
}

const ENTRIES = [
  ['logo', 640, 176, (c, w, h) => {
    c.fillStyle = TEAL; c.fillRect(0, 0, w, h);
    c.fillStyle = TEAL_D; c.fillRect(0, h - 26, w, 26);
    c.fillStyle = AMBER; c.fillRect(0, h - 26, w, 7);
    mark(c, 96, 76, 92);
    text(c, 'NIGHTJAR', 392, 78, 112, CREAM, HEAD, 'center', '', 430);
  }],
  ['mart', 896, 144, (c, w, h) => {
    c.fillStyle = '#f3ecd8'; c.fillRect(0, 0, w, h);
    c.fillStyle = TEAL; c.fillRect(0, 0, 150, h);
    mark(c, 75, 70, 70);
    text(c, 'NIGHTJAR MART', 436, 74, 104, TEAL_D, HEAD, 'center', '', 520);
    c.fillStyle = '#c8281c'; c.fillRect(730, 22, 148, 100);
    text(c, '24 HR', 804, 74, 62, '#fff4de', HEAD, 'center', '', 124);
  }],
  ['priceRegular', 512, 150, (c, w, h) => { c.fillStyle = '#0a0c0c'; c.fillRect(0, 0, w, h); text(c, 'REGULAR', 20, 40, 44, '#d8d2bf', HEAD, 'left'); text(c, 'UNLEADED', 20, 96, 30, '#7d796d', HEAD, 'left'); price(c, '3.49', 230, 20, 62, 110, '#ffb11f', '#1c1608'); text(c, '9', 480, 40, 34, '#ffb11f'); text(c, '10', 480, 82, 22, '#ffb11f', SANS, 'center', 'bold'); }],
  ['pricePlus', 512, 150, (c, w, h) => { c.fillStyle = '#0a0c0c'; c.fillRect(0, 0, w, h); text(c, 'PLUS', 20, 40, 44, '#d8d2bf', HEAD, 'left'); text(c, 'MIDGRADE', 20, 96, 30, '#7d796d', HEAD, 'left'); price(c, '3.89', 230, 20, 62, 110, '#ffb11f', '#1c1608', 1); text(c, '9', 480, 40, 34, '#ffb11f'); text(c, '10', 480, 82, 22, '#ffb11f', SANS, 'center', 'bold'); }],
  ['priceDiesel', 512, 150, (c, w, h) => { c.fillStyle = '#0a0c0c'; c.fillRect(0, 0, w, h); text(c, 'DIESEL', 20, 40, 44, '#9fe08c', HEAD, 'left'); text(c, 'TRUCK LANES', 20, 96, 30, '#5f7d58', HEAD, 'left'); price(c, '4.19', 230, 20, 62, 110, '#62e24a', '#0c1a08'); text(c, '9', 480, 40, 34, '#62e24a'); text(c, '10', 480, 82, 22, '#62e24a', SANS, 'center', 'bold'); }],
  ['signExtras', 512, 120, (c, w, h) => {
    c.fillStyle = '#efe6cf'; c.fillRect(0, 0, w, h);
    text(c, 'SHOWERS · SCALES · DINER', w / 2, 38, 44, '#7a1d14');
    text(c, 'TRUCK PARKING  ➜', w / 2, 88, 40, TEAL_D);
  }],
  // the wall buy: chalked by whoever held out here before. A pistol magazine, drawn big enough to
  // read from the pumps, and the price under it.
  // Two parts in one cell. Top 150 px: the word AMMO, for a board 1.6 m wide nailed across the
  // head of the door (letters 0.4 m tall: readable from the pumps). Below it: the magazine
  // outline and the price, for the door itself. See the wall buy in props/store.js.
  ['chalkMag', 384, 640, (c, W0, H0, rng) => {
    const block = (s, x, y, px, w) => {
      c.save();
      c.font = `${px}px ${HEAD}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const wd = c.measureText(s).width;
      if (wd > w * 0.9) c.font = `${Math.floor((px * w * 0.9) / wd)}px ${HEAD}`;
      c.fillStyle = 'rgba(248,245,232,0.97)'; c.fillText(s, x, y);
      // chalk drags: a few fine diagonal skips taken back out of the fill
      c.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 30; i++) { c.strokeStyle = `rgba(0,0,0,${0.08 + 0.14 * rng.next()})`; c.lineWidth = 1 + rng.next() * 1.5; const sx = x - w / 2 + rng.next() * w, sy = y - px / 2 + rng.next() * px; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + 14 + rng.next() * 40, sy - 6 - rng.next() * 16); c.stroke(); }
      c.restore();
    };
    // the word: drawn in a 512 x 150 space (the board's proportions), squeezed into the cell's width
    c.save(); c.scale(W0 / 512, 1);
    block('AMMO', 256, 78, 150, 500);
    c.restore();
    // the door: drawn in a 448 x 640 space (its proportions), squeezed into the rest of the cell
    c.save(); c.translate(0, 150); c.scale(W0 / 448, (H0 - 150) / 640);
    const w = 448;
    // magazine body leaning forward, floor plate, feed lips with the top round showing: a thick
    // stick, gone over twice
    const ox = 32, oy = -96;
    const P = (pts) => pts.map(([x, y]) => [x + ox, y + oy]);
    for (let pass = 0; pass < 2; pass++) {
      chalkStroke(c, P([[128, 198], [232, 178], [276, 448], [172, 468], [128, 198]]), rng, 16);
      chalkStroke(c, P([[150, 470], [296, 442], [302, 480], [156, 508], [150, 470]]), rng, 16);
      chalkStroke(c, P([[136, 194], [140, 162], [176, 144], [226, 152], [234, 176]]), rng, 12);
    }
    chalkStroke(c, P([[150, 172], [214, 160]]), rng, 8);
    for (let i = 0; i < 4; i++) { // witness holes
      const t = i / 3;
      c.strokeStyle = 'rgba(245,242,230,0.85)'; c.lineWidth = 7; c.beginPath(); c.arc(196 + ox + t * 36, 236 + oy + t * 170, 10, 0, 7); c.stroke();
    }
    for (const [x, y, r] of [[340, 300, 0.5], [50, 364, -0.4]]) { // loose rounds
      c.save(); c.translate(x + ox, y + oy); c.rotate(r);
      chalkStroke(c, [[-12, 38], [-12, -20], [0, -40], [12, -20], [12, 38], [-12, 38]], rng, 8);
      c.restore();
    }
    block('250', w / 2, 528, 176, 420);
    chalkStroke(c, [[70, 628], [w - 70, 620]], rng, 10);
    for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(240,238,228,${0.02 + rng.next() * 0.04})`; c.beginPath(); c.ellipse(rng.next() * w, rng.next() * 640, 10 + rng.next() * 40, 6 + rng.next() * 16, rng.next() * 3, 0, 7); c.fill(); }
    c.restore();
  }],
  // a sheet of paper taped inside the door glass by whoever locked up
  ['noteClosed', 256, 192, (c, w, h, rng) => {
    const hand = '"Marker Felt", "Chalkboard SE", "Comic Sans MS", cursive';
    c.fillStyle = '#e9e5d6'; c.fillRect(0, 0, w, h);
    c.save(); c.translate(w / 2, 62); c.rotate(-0.04); text(c, 'CLOSED', 0, 0, 78, '#15161a', hand); c.restore();
    text(c, 'no fuel · no power', w / 2, 126, 24, '#15161a', hand);
    text(c, 'go home. lock your doors.', w / 2, 160, 20, '#8c1711', hand);
    c.fillStyle = 'rgba(190,170,110,0.75)'; for (const [x, y] of [[0, 0], [w - 44, 0], [0, h - 18], [w - 44, h - 18]]) c.fillRect(x, y, 44, 18);
    grime(c, w, h, rng, 20, 0.1);
  }],
  // vinyl on the glass: opening hours, the cards taken, cash machine inside
  ['stickerHours', 160, 200, (c, w, h) => {
    const v = 'rgba(238,236,224,0.92)';
    text(c, 'HOURS', w / 2, 24, 34, v);
    c.fillStyle = v; c.fillRect(14, 46, w - 28, 3);
    [['MON – FRI', '24 HR'], ['SATURDAY', '24 HR'], ['SUNDAY', '24 HR'], ['HOLIDAYS', '24 HR']].forEach(([d, t], i) => { text(c, d, 14, 70 + i * 28, 15, v, SANS, 'left', 'bold'); text(c, t, w - 14, 70 + i * 28, 15, v, SANS, 'right', 'bold'); });
    text(c, 'WE NEVER CLOSE', w / 2, 184, 16, v, SANS, 'center', 'bold');
  }],
  ['stickerCards', 224, 64, (c, w, h) => {
    [['#1a3f8f', '#f2b01e'], ['#b3141a', '#f2efe4'], ['#0e6b52', '#f2efe4'], ['#f2efe4', '#1d1d1d']].forEach(([bg, fg], i) => {
      c.fillStyle = bg; c.fillRect(4 + i * 55, 6, 50, 34);
      c.fillStyle = fg; c.beginPath(); c.arc(20 + i * 55, 23, 9, 0, 7); c.fill(); c.fillRect(34 + i * 55, 18, 14, 4); c.fillRect(34 + i * 55, 26, 10, 4);
    });
    text(c, 'ATM INSIDE  ·  EBT', w / 2, 53, 14, 'rgba(238,236,224,0.92)', SANS, 'center', 'bold');
  }],
  ['sprayClosed', 448, 288, (c, w, h, rng) => {
    c.save(); c.translate(w / 2, h / 2); c.rotate(-0.06);
    c.shadowColor = 'rgba(190,20,12,0.55)'; c.shadowBlur = 12;
    text(c, 'KEEP OUT', 0, -56, 104, 'rgba(196,24,14,0.92)', '"Marker Felt", "Chalkboard SE", "Comic Sans MS", cursive');
    text(c, 'THEY GOT IN', 0, 50, 62, 'rgba(196,24,14,0.85)', '"Marker Felt", "Chalkboard SE", "Comic Sans MS", cursive');
    c.restore();
    for (let i = 0; i < 7; i++) { const x = 60 + rng.next() * 330, y = 110 + rng.next() * 40; c.fillStyle = 'rgba(170,18,10,0.7)'; c.fillRect(x, y, 3, 30 + rng.next() * 90); }
  }],
  ['posterSlush', 224, 300, poster('#16335e', (c, w, h) => {
    c.fillStyle = '#4fd0e8'; c.beginPath(); c.moveTo(72, 120); c.lineTo(152, 120); c.lineTo(138, 250); c.lineTo(86, 250); c.fill();
    c.fillStyle = '#e83a6f'; c.beginPath(); c.arc(112, 118, 44, Math.PI, 0); c.fill();
    text(c, 'BRAINFREEZE', w / 2, 44, 40, '#fff');
    text(c, '99¢', w / 2, 276, 44, '#ffe14a');
  })],
  ['posterCoffee', 224, 300, poster('#3a1e10', (c, w, h) => {
    text(c, 'HOT', w / 2, 52, 72, '#f1d9a8'); text(c, 'COFFEE', w / 2, 118, 60, '#f1d9a8');
    c.fillStyle = '#f1d9a8'; c.fillRect(70, 160, 84, 70); c.strokeStyle = '#f1d9a8'; c.lineWidth = 9; c.beginPath(); c.arc(160, 194, 20, -1.2, 1.2); c.stroke();
    text(c, 'bottomless  $1.29', w / 2, 266, 24, '#e9a13b', SANS, 'center', 'bold');
  })],
  ['posterLotto', 224, 300, poster('#f1c40f', (c, w, h) => {
    text(c, 'STATE', w / 2, 40, 40, '#1d1d1d'); text(c, 'JACKPOT', w / 2, 88, 56, '#b3141a');
    text(c, '$84', w / 2, 170, 110, '#1d1d1d'); text(c, 'MILLION', w / 2, 236, 38, '#1d1d1d');
    text(c, 'PLAY HERE', w / 2, 278, 26, '#b3141a');
  })],
  ['posterShower', 224, 300, poster('#e9e4d6', (c, w, h) => {
    c.fillStyle = TEAL; c.fillRect(0, 0, w, 86); text(c, 'DRIVER', w / 2, 30, 34, CREAM); text(c, 'SHOWERS', w / 2, 62, 34, CREAM);
    text(c, '$12', w / 2, 150, 92, '#222'); text(c, 'towel + soap incl.', w / 2, 214, 22, '#444', SANS, 'center', 'bold');
    text(c, 'ask at counter', w / 2, 262, 22, '#7a1d14', SANS, 'center', 'bold');
  })],
  ['posterMissing', 224, 300, (c, w, h, rng) => {
    c.fillStyle = '#e8e2d2'; c.fillRect(0, 0, w, h);
    text(c, 'MISSING', w / 2, 36, 52, '#141414');
    c.fillStyle = '#8f8a7e'; c.fillRect(42, 70, 140, 130);
    c.fillStyle = '#5d584f'; c.beginPath(); c.arc(112, 122, 30, 0, 7); c.fill(); c.beginPath(); c.ellipse(112, 196, 52, 44, 0, Math.PI, 0); c.fill();
    text(c, 'DALE PRUITT, 54', w / 2, 222, 24, '#141414', SANS, 'center', 'bold');
    text(c, 'last seen Tuesday', w / 2, 248, 17, '#333', SANS); text(c, 'night shift, pump 3', w / 2, 268, 17, '#333', SANS);
    grime(c, w, h, rng, 40, 0.14);
  }],
  ['posterCurfew', 224, 300, (c, w, h, rng) => {
    c.fillStyle = '#d8d0b4'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#141414'; c.fillRect(0, 0, w, 64); text(c, 'COUNTY NOTICE', w / 2, 34, 34, '#d8d0b4');
    text(c, 'CURFEW', w / 2, 108, 64, '#9b1410'); text(c, '9PM – 6AM', w / 2, 164, 44, '#141414');
    for (let i = 0; i < 5; i++) { c.fillStyle = '#4a4638'; c.fillRect(26, 200 + i * 16, 172 - (i === 4 ? 70 : 0), 6); }
    grime(c, w, h, rng, 40, 0.16);
  }],
  ['ice', 384, 224, (c, w, h, rng) => {
    c.fillStyle = '#e9eef0'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1b5fae'; c.fillRect(0, h - 40, w, 40);
    text(c, 'ICE', w / 2, 96, 170, '#1b5fae');
    c.fillStyle = '#e9eef0';
    for (let i = 0; i < 9; i++) { c.beginPath(); c.ellipse(96 + i * 24, 34 + 8 * Math.sin(i * 1.7), 20, 14, 0, 0, 7); c.fill(); }
    text(c, 'BAG 7 LB  $2.49', w / 2, h - 20, 26, '#e9eef0', SANS, 'center', 'bold');
    grime(c, w, h, rng, 50, 0.1);
  }],
  ['paper', 160, 224, (c, w, h, rng) => {
    c.fillStyle = '#d9d4c4'; c.fillRect(0, 0, w, h);
    text(c, 'The County Ledger', w / 2, 20, 17, '#111', 'Georgia, serif', 'center', 'bold');
    c.fillStyle = '#111'; c.fillRect(8, 34, w - 16, 2);
    text(c, 'ROADS', w / 2, 62, 38, '#111'); text(c, 'CLOSED', w / 2, 100, 38, '#111');
    c.fillStyle = '#77736a'; c.fillRect(12, 126, 62, 50);
    for (let i = 0; i < 9; i++) { c.fillStyle = '#5a564d'; c.fillRect(i < 5 ? 82 : 12, 128 + (i < 5 ? i * 10 : 56 + (i - 5) * 9), i < 5 ? 66 : 136, 3); }
    grime(c, w, h, rng, 20, 0.12);
  }],
  ['plateA', 160, 80, plate('7KD·R241')], ['plateB', 160, 80, plate('NTJ·4409')], ['plateC', 160, 80, plate('2WX·L087')], ['plateD', 160, 80, plate('HVN·5530')],
  ['pumpFace', 288, 400, (c, w, h, rng) => {
    c.fillStyle = '#1b1d1e'; c.fillRect(0, 0, w, h);
    // grade buttons
    const g = [['87', 'REGULAR', '#e8e2cf'], ['89', 'PLUS', '#3d74c9'], ['91', 'SUPER', '#c9302a'], ['D', 'DIESEL', '#2f9b48']];
    g.forEach(([n, l, col], i) => {
      const x = 14 + i * 66;
      c.fillStyle = col; c.fillRect(x, 232, 58, 78);
      text(c, n, x + 29, 262, 38, i === 0 ? '#1b1d1e' : '#fff'); text(c, l, x + 29, 296, 12, i === 0 ? '#1b1d1e' : '#fff', SANS, 'center', 'bold');
    });
    // card reader and keypad
    c.fillStyle = '#2c3033'; c.fillRect(14, 18, 150, 196);
    c.fillStyle = '#0b1210'; c.fillRect(26, 30, 126, 54);
    text(c, 'SEE CASHIER', 89, 57, 17, '#3e7d4a', '"Courier New", monospace', 'center', 'bold');
    for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) { c.fillStyle = '#8d9396'; c.fillRect(34 + k * 38, 98 + r * 27, 30, 20); }
    c.fillStyle = '#0d0d0d'; c.fillRect(182, 30, 20, 120); c.fillStyle = '#34383b'; c.fillRect(178, 160, 92, 54);
    text(c, 'RECEIPT', 224, 187, 14, '#9aa0a3', SANS, 'center', 'bold');
    // out-of-order sticker, taped on crooked
    c.save(); c.translate(216, 92); c.rotate(0.09);
    c.fillStyle = '#f2e9c9'; c.fillRect(-58, -40, 116, 80);
    text(c, 'CARD READER', 0, -18, 16, '#111', SANS, 'center', 'bold'); text(c, 'DOWN', 0, 6, 26, '#a3120e'); text(c, 'pay inside — sorry!', 0, 28, 11, '#333', SANS);
    c.restore();
    c.fillStyle = TEAL; c.fillRect(0, 328, w, 72);
    mark(c, 46, 362, 44); text(c, 'NIGHTJAR', 176, 364, 50, CREAM);
    grime(c, w, h, rng, 50, 0.12);
  }],
  ['pumpLcd', 256, 128, (c, w, h) => {
    c.fillStyle = '#0c1410'; c.fillRect(0, 0, w, h);
    text(c, 'SALE $', 10, 22, 14, '#58705c', SANS, 'left', 'bold'); price(c, '23.41', 96, 8, 22, 42, '#b7e6b0', '#142018');
    text(c, 'GALLONS', 10, 82, 14, '#58705c', SANS, 'left', 'bold'); price(c, '6.708', 96, 68, 22, 42, '#b7e6b0', '#142018');
  }],
  ['pumpLcdIdle', 256, 128, (c, w, h) => {
    c.fillStyle = '#0c1410'; c.fillRect(0, 0, w, h);
    text(c, 'SALE $', 10, 22, 14, '#58705c', SANS, 'left', 'bold'); price(c, '0.00', 118, 8, 22, 42, '#b7e6b0', '#142018');
    text(c, 'GALLONS', 10, 82, 14, '#58705c', SANS, 'left', 'bold'); price(c, '0.000', 96, 68, 22, 42, '#b7e6b0', '#142018');
  }],
  ['numbers', 512, 64, (c, w, h) => {
    for (let i = 0; i < 8; i++) { c.fillStyle = '#efe6cf'; c.beginPath(); c.arc(32 + i * 64, 32, 29, 0, 7); c.fill(); text(c, String(i + 1), 32 + i * 64, 35, 46, TEAL_D); }
  }],
  ['hazard', 256, 48, (c, w, h) => {
    c.fillStyle = '#e7b416'; c.fillRect(0, 0, w, h); c.fillStyle = '#16140f';
    for (let i = -2; i < 12; i++) { c.beginPath(); c.moveTo(i * 32, h); c.lineTo(i * 32 + 16, h); c.lineTo(i * 32 + 16 + h, 0); c.lineTo(i * 32 + h, 0); c.fill(); }
  }],
  ['tape', 256, 24, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#d9d9d2' : '#b3180f'; c.fillRect(i * 32, 0, 32, h); } }],
  ['vendCola', 224, 384, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#d1261c'); g.addColorStop(1, '#6d0d0a'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.moveTo(0, 150); c.quadraticCurveTo(110, 60, w, 170); c.lineTo(w, 196); c.quadraticCurveTo(110, 96, 0, 186); c.fill();
    text(c, 'KOLT', w / 2, 250, 86, '#fff'); text(c, 'COLA', w / 2, 320, 60, '#fff');
    c.fillStyle = '#18191a'; c.fillRect(150, 20, 56, 96);
  }],
  ['vendSnack', 224, 384, (c, w, h, rng) => {
    c.fillStyle = '#10151a'; c.fillRect(0, 0, w, h);
    const cols = ['#e8b023', '#d1432b', '#3a8fd0', '#58a84a', '#e87f23', '#b04fb4', '#e4dccd'];
    for (let r = 0; r < 6; r++) for (let k = 0; k < 5; k++) { c.fillStyle = cols[Math.floor(rng.next() * cols.length)]; c.fillRect(12 + k * 34, 14 + r * 52, 28, 40); }
    c.fillStyle = '#24292e'; c.fillRect(184, 0, 40, h); c.fillStyle = '#0b0d0e'; c.fillRect(0, 330, 184, 54);
  }],
  // drinks cooler seen through its doors: rows of bottles under strip light, door frames, glare
  ['cooler', 512, 320, (c, w, h, rng) => {
    const bg = c.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#5f7078'); bg.addColorStop(1, '#27323a');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    const cols = ['#7d241c', '#24406e', '#2f5c36', '#8a7326', '#b9b7ad', '#3f2857', '#1b1b1b', '#7d4a1f', '#2d6a70'];
    for (let r = 0; r < 5; r++) {
      const y0 = 8 + r * 62;
      let x = 6;
      while (x < w - 10) {
        const bw = 9 + rng.next() * 6, bh = 36 + rng.next() * 12;
        const col = cols[Math.floor(rng.next() * cols.length)];
        const run = 2 + Math.floor(rng.next() * 5); // facings of the same product
        for (let k = 0; k < run && x < w - 10; k++) {
          if (rng.next() < 0.12) { x += bw + 2; continue; } // sold out
          c.fillStyle = col; c.fillRect(x, y0 + 50 - bh, bw, bh);
          c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(x + 1, y0 + 50 - bh, 2, bh);
          c.fillStyle = '#d8d6cc'; c.fillRect(x + 1, y0 + 50 - bh * 0.62, bw - 2, bh * 0.2);
          c.fillStyle = '#16181a'; c.fillRect(x + bw * 0.3, y0 + 50 - bh - 4, bw * 0.4, 4);
          x += bw + 2;
        }
      }
      c.fillStyle = '#aeb9bf'; c.fillRect(0, y0 + 50, w, 5);
      c.fillStyle = '#e9d9a2'; for (let k = 0; k < 16; k++) c.fillRect(8 + k * 32, y0 + 51, 16, 3);
    }
    for (let k = 0; k <= 4; k++) {
      c.fillStyle = '#1c2125'; c.fillRect(k * 127 - 4, 0, 10, h);
      c.fillStyle = 'rgba(235,245,255,0.75)'; c.fillRect(k * 127 + 7, 4, 3, h - 8);
    }
    const gl = c.createLinearGradient(0, 0, w, h); gl.addColorStop(0.3, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.1)'); gl.addColorStop(0.7, 'rgba(255,255,255,0)');
    c.fillStyle = gl; c.fillRect(0, 0, w, h);
  }],
  ['highway', 640, 288, (c, w, h) => {
    c.fillStyle = '#0d5c33'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e8eee6'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
    text(c, 'Harlan Gap', 40, 76, 62, '#e8eee6', SANS, 'left', 'bold'); text(c, '12', w - 40, 76, 62, '#e8eee6', SANS, 'right', 'bold');
    text(c, 'Vesper Falls', 40, 156, 62, '#e8eee6', SANS, 'left', 'bold'); text(c, '31', w - 40, 156, 62, '#e8eee6', SANS, 'right', 'bold');
    c.fillStyle = '#e8eee6'; c.fillRect(30, 200, w - 60, 4);
    text(c, 'EXIT 44   FUEL · FOOD', w / 2, 242, 40, '#e8eee6', SANS, 'center', 'bold');
  }],
  ['noTrespass', 224, 160, (c, w, h, rng) => {
    c.fillStyle = '#e6e1d0'; c.fillRect(0, 0, w, h); c.fillStyle = '#a3120e'; c.fillRect(0, 0, w, 52);
    text(c, 'PRIVATE LOT', w / 2, 28, 36, '#e6e1d0'); text(c, 'NO OVERNIGHT', w / 2, 86, 30, '#151515'); text(c, 'PARKING', w / 2, 122, 30, '#151515');
    grime(c, w, h, rng, 40, 0.2);
  }],
  ['shutoff', 224, 128, (c, w, h) => {
    c.fillStyle = '#b3180f'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 5; c.strokeRect(6, 6, w - 12, h - 12);
    text(c, 'EMERGENCY', w / 2, 40, 38, '#fff'); text(c, 'FUEL SHUTOFF', w / 2, 86, 34, '#fff');
  }],
  ['haulage', 768, 192, (c, w, h) => {
    c.fillStyle = '#b3180f';
    c.beginPath(); c.moveTo(20, 150); c.lineTo(120, 30); c.lineTo(170, 30); c.lineTo(110, 104); c.lineTo(230, 104); c.lineTo(192, 150); c.fill();
    text(c, 'VANE', 250, 74, 104, '#20384f', HEAD, 'left', '', 190); text(c, 'HAULAGE', 448, 74, 104, '#b3180f', HEAD, 'left', '', 300);
    text(c, 'COAST  ·  PLAINS  ·  OVERNIGHT', 252, 158, 36, '#20384f', SANS, 'left', 'bold', 496);
  }],
  ['sheriff', 160, 160, (c, w, h) => {
    c.fillStyle = '#c9a227'; c.beginPath();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 34 : 74; c.lineTo(80 + Math.cos(a) * r, 80 + Math.sin(a) * r); }
    c.fill(); c.fillStyle = '#1c2f4a'; c.beginPath(); c.arc(80, 80, 30, 0, 7); c.fill();
    text(c, 'COUNTY', 80, 72, 14, '#c9a227', SANS, 'center', 'bold'); text(c, 'PATROL', 80, 90, 14, '#c9a227', SANS, 'center', 'bold');
  }],
  ['dinerBoard', 512, 160, (c, w, h, rng) => {
    c.fillStyle = '#d9d2bd'; c.fillRect(0, 0, w, h);
    text(c, "MAE'S", 92, 78, 76, '#8c1711', HEAD, 'center', '', 150); text(c, 'BREAKFAST ALL NIGHT', 340, 54, 38, '#22313a', HEAD, 'center', '', 300);
    text(c, 'PIE  ·  COFFEE  ·  CHILI', 340, 106, 30, '#22313a', SANS, 'center', 'bold', 300);
    grime(c, w, h, rng, 60, 0.22);
  }],
  ['doorDecal', 160, 160, (c, w, h) => {
    text(c, 'PULL', w / 2, 30, 34, 'rgba(240,236,220,0.92)');
    text(c, 'OPEN 24 HOURS', w / 2, 76, 17, 'rgba(240,236,220,0.9)', SANS, 'center', 'bold');
    text(c, 'no shirt · no shoes', w / 2, 108, 14, 'rgba(240,236,220,0.85)', SANS); text(c, 'no service', w / 2, 128, 14, 'rgba(240,236,220,0.85)', SANS);
  }],
  ['airWater', 160, 224, (c, w, h, rng) => {
    c.fillStyle = '#1b5fae'; c.fillRect(0, 0, w, h);
    text(c, 'AIR', w / 2, 56, 74, '#fff'); text(c, 'WATER', w / 2, 130, 54, '#fff'); text(c, '$1.50', w / 2, 190, 40, '#ffe14a');
    grime(c, w, h, rng, 30, 0.18);
  }],
  ['boxLabel', 192, 128, (c, w, h) => {
    c.strokeStyle = '#1a1a1a'; c.lineWidth = 4; c.strokeRect(8, 8, w - 16, h - 16);
    text(c, 'KOLT COLA', w / 2, 44, 34, '#1a1a1a'); text(c, '24 × 12 OZ', w / 2, 86, 22, '#1a1a1a', SANS, 'center', 'bold');
  }],
];

function plate(str) {
  return (c, w, h) => {
    c.fillStyle = '#e9e6da'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#27506e'; c.fillRect(0, 0, w, 18);
    text(c, 'CASCADE TERRITORY', w / 2, 10, 11, '#e9e6da', SANS, 'center', 'bold');
    text(c, str, w / 2, 50, 42, '#1b2630');
    c.strokeStyle = '#8b8a80'; c.lineWidth = 3; c.strokeRect(2, 2, w - 4, h - 4);
  };
}

export function createAtlas(rng) {
  // shelf packing, tallest first
  const order = ENTRIES.map((e, i) => i).sort((a, b) => ENTRIES[b][2] - ENTRIES[a][2]);
  const rects = {};
  let x = 2, y = 2, rowH = 0;
  for (const i of order) {
    const [name, w, h] = ENTRIES[i];
    if (x + w + 2 > SIZE) { x = 2; y += rowH + 4; rowH = 0; }
    rects[name] = { x, y, w, h };
    x += w + 4; rowH = Math.max(rowH, h);
  }
  if (y + rowH > SIZE) throw new Error('signage atlas overflow');

  let texture = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, SIZE, SIZE);
    for (const [name, w, h, draw] of ENTRIES) {
      const r = rects[name];
      c.save();
      c.beginPath(); c.rect(r.x, r.y, w, h); c.clip();
      c.translate(r.x, r.y);
      draw(c, w, h, rng.fork(name));
      c.restore();
    }
    texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
  }
  const inset = 1.5 / SIZE;
  return {
    texture,
    uv(name) {
      const r = rects[name];
      if (!r) throw new Error(`atlas: no entry "${name}"`);
      return [r.x / SIZE + inset, 1 - (r.y + r.h) / SIZE + inset, (r.x + r.w) / SIZE - inset, 1 - r.y / SIZE - inset];
    },
    // sub-rectangle of an entry, in 0..1 of that entry (u from left, v from top)
    sub(name, u0, v0, u1, v1) {
      const r = rects[name];
      return [(r.x + r.w * u0) / SIZE + inset, 1 - (r.y + r.h * v1) / SIZE + inset, (r.x + r.w * u1) / SIZE - inset, 1 - (r.y + r.h * v0) / SIZE - inset];
    },
    aspect: (name) => rects[name].w / rects[name].h,
  };
}
