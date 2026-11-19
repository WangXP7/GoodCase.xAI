// Eyes, teeth and the inside of the head: small hard parts that are geometry of their own.
//   eye    a cornea dome over each eyeball (the white is the face cage, wrapped over the ball and
//          painted by the bake): iris and pupil drawn across it, its bulge takes its own highlight,
//          the glow of the design lives in the pupil only
//   teeth  two arcs, upper on the head, lower on the jaw, behind the lips
//   mouth  a dark pocket hung from the split lip line, so an open jaw shows depth, not daylight
//   core   a lump inside the skull that shows when a blast opens it
import { SID } from './sculpt/cage.js';
import { BODY } from './sculpt/uv.js';
import { EYE, EYE_R } from './sculpt/head.js';
import { march } from './sculpt/sdf.js';
import { B, SHOULDER } from './skeleton.js';

const MU = (BODY.misc[0] + BODY.misc[2]) / 2, MV = (BODY.misc[1] + BODY.misc[3]) / 2;
const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export function buildEyes(mesh, q) {
  // The dome is the cornea alone: it ends in the dark ring round the iris. (It used to run on over
  // the white to 7.4 mm in ten segments, and its edge showed between the lids as a pale octagon.)
  const seg = q >= 1 ? 16 : 6, rings = q >= 1 ? [0.4, 0.75, 1] : [1];
  const Rd = 0.0053, SH = Rd / 0.0074;        // the shader's radii are in units of 7.4 mm
  for (const side of [1, -1]) {
    mesh.shell = 'eyes';
    // each eye drifts its own way: a dead stare, slightly down and apart
    const g = nrm([0.1 * side + 0.05, -0.16, 1]);
    const u = nrm([g[2], 0, -g[0]]), v = [g[1] * u[2] - g[2] * u[1], g[2] * u[0] - g[0] * u[2], g[0] * u[1] - g[1] * u[0]];
    const c = [EYE[0] * side, EYE[1], EYE[2]];
    const w = [[B.head, 1]];
    const at = (lx, ly) => {
      const rho = Math.hypot(lx, ly) * Rd;
      const d = Math.sqrt(EYE_R * EYE_R - rho * rho) + 0.00035 + 0.00085 * (1 - (rho / Rd) ** 2);
      const p = [c[0] + g[0] * d + (u[0] * lx + v[0] * ly) * Rd, c[1] + g[1] * d + (u[1] * lx + v[1] * ly) * Rd, c[2] + g[2] * d + (u[2] * lx + v[2] * ly) * Rd];
      const n = nrm([p[0] - (c[0] + g[0] * 0.006), p[1] - (c[1] + g[1] * 0.006), p[2] - (c[2] + g[2] * 0.006)]);
      return mesh.vert(p[0], p[1], p[2], n[0], n[1], n[2], MU, MV, w, [lx * SH, ly * SH, 0, SID.eye]);
    };
    const mid = at(0, 0);
    let prev = null;
    for (const r of rings) {
      const ring = [];
      for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; ring.push(at(Math.cos(a) * r, -Math.sin(a) * r)); }
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        if (!prev) mesh.tri(mid, ring[k1], ring[k]); else mesh.quad(prev[k], prev[k1], ring[k1], ring[k], true);
      }
      prev = ring;
    }
  }
}

// mouth: { upper, lower } vertex ids along the split lip line (same order)
export function buildMouth(mesh, mouth, q) {
  if (!mouth || mouth.upper.length < 2) return;
  const P = (i) => [mesh.p[i * 3], mesh.p[i * 3 + 1], mesh.p[i * 3 + 2]];
  // ---- pocket
  mesh.shell = 'mouth';
  const wH = [[B.head, 1]], wJ = [[B.jaw, 1]];
  const n = mouth.upper.length;
  const gore = (p, nz, w, shade) => mesh.vert(p[0], p[1], p[2], 0, 0, nz, MU, MV, w, [0, 0, shade, SID.gore]);
  const ue = [], le = [], ui = [], li = [];
  for (let k = 0; k < n; k++) {
    const a = P(mouth.upper[k]), b = P(mouth.lower[k]);
    ue.push(gore([a[0], a[1] + 0.0004, a[2] - 0.0012], 1, wH, 0.4)); le.push(gore([b[0], b[1] - 0.0004, b[2] - 0.0012], 1, wJ, 0.4));
    ui.push(gore([a[0] * 0.85, a[1] + 0.006, a[2] - 0.036], 1, wH, 0.07)); li.push(gore([b[0] * 0.85, b[1] - 0.012, b[2] - 0.036], 1, wJ, 0.07));
  }
  for (let k = 0; k + 1 < n; k++) {
    mesh.quad(ue[k], ue[k + 1], ui[k + 1], ui[k], false);
    mesh.quad(le[k], li[k], li[k + 1], le[k + 1], false);
    mesh.quad(ui[k], ui[k + 1], li[k + 1], li[k], false);
  }
  mesh.tri(ue[0], ui[0], le[0]); mesh.tri(le[0], ui[0], li[0]);
  mesh.tri(ue[n - 1], le[n - 1], ui[n - 1]); mesh.tri(le[n - 1], li[n - 1], ui[n - 1]);
  // ---- tongue: a low swollen mound on the floor of the mouth, so an open jaw shows something
  if (q >= 1) {
    const tc = [0, 1.6035, 0.05], tr = [0.0135, 0.0065, 0.024], na = 7, nl = 3, ids = [];
    for (let i = 0; i <= nl; i++) for (let j = 0; j <= na; j++) {
      const la = (i / nl) * 1.5, a = (j / na) * Math.PI * 2;
      const n = [Math.cos(la) * Math.sin(a), Math.sin(la), Math.cos(la) * Math.cos(a)];
      ids.push(mesh.vert(tc[0] + n[0] * tr[0], tc[1] + n[1] * tr[1], tc[2] + n[2] * tr[2], n[0], n[1], n[2], MU, MV, wJ, [0, 0, 0.5 + 0.3 * Math.sin(la), SID.gore]));
    }
    for (let i = 0; i < nl; i++) for (let j = 0; j < na; j++) mesh.quad(ids[i * (na + 1) + j], ids[i * (na + 1) + j + 1], ids[(i + 1) * (na + 1) + j + 1], ids[(i + 1) * (na + 1) + j], true);
  }
  // ---- teeth: uneven, some gone
  mesh.shell = 'teeth';
  // a full upper row that hangs below the lip line, so an open mouth shows teeth (they sat wholly
  // behind the lips, and an open mouth was a dark slot)
  const count = q >= 1 ? 12 : 6;
  const gone = q >= 1 ? [[9], [4]] : [[], []];
  for (let row = 0; row < 2; row++) {
    const up = row === 0, w = up ? wH : wJ;
    for (let t = 0; t < count; t++) {
      if (gone[row].includes(t)) continue;
      const th0 = -1.3 + (2.6 * t) / count, th1 = -1.3 + (2.6 * (t + 1)) / count;
      const mid = (th0 + th1) / 2, front = Math.abs(mid) < 0.5;
      const len = (up ? (front ? 0.0125 : 0.0095) : front ? 0.0086 : 0.007) * (0.85 + 0.3 * ((t * 7 + row * 3) % 5) / 4);
      const rx = up ? 0.0236 : 0.0218, rz = up ? 0.0265 : 0.025, cz = up ? 0.0635 : 0.061;
      const yRoot = up ? 1.6285 : 1.6105, yTip = up ? 1.6285 - len : 1.6105 + len;
      const ids = [];
      for (let c = 0; c < 3; c++) {
        const th = th0 + (th1 - th0) * (0.08 + 0.84 * (c / 2));
        const bulge = c === 1 ? 0.0009 : 0;
        const x = rx * Math.sin(th), z = cz + rz * Math.cos(th);
        const nx = Math.sin(th), nz = Math.cos(th);
        for (let r = 0; r < 2; r++) {
          const y = r === 0 ? yRoot : yTip + (c === 1 ? 0 : (up ? 0.0008 : -0.0008));
          ids.push(mesh.vert(x + nx * bulge, y, z + nz * bulge, nx, 0, nz, MU, MV, w, [0, r, 0, SID.tooth]));
        }
      }
      for (let c = 0; c < 2; c++) mesh.quad(ids[c * 2], ids[c * 2 + 2], ids[c * 2 + 3], ids[c * 2 + 1], up);
    }
  }
}

// Inside the body: a lump of brain inside the skull (seen through a blast wound), and a cap of cut
// flesh inside the neck, each upper arm and each thigh just short of where sever() cuts, so a stump
// is closed by meat and bone and not by stretched skin. All of it is enclosed by skin until then.
export function buildCore(mesh, fig, q = 1) {
  mesh.shell = 'core';
  if (q >= 1) {
    const w = [[B.head, 1]];
    const nA = 10, nL = 7, c = [0, 1.705, -0.016], r = [0.058, 0.066, 0.076];
    const ids = [];
    for (let i = 0; i <= nL; i++) for (let j = 0; j <= nA; j++) {
      const la = -1.45 + (2.9 * i) / nL, a = (j / nA) * Math.PI * 2;
      const lump = 1 + 0.07 * Math.sin(a * 5 + i * 1.7) * Math.cos(la * 4);
      const n = [Math.cos(la) * Math.sin(a), Math.sin(la), Math.cos(la) * Math.cos(a)];
      ids.push(mesh.vert(c[0] + n[0] * r[0] * lump, c[1] + n[1] * r[1] * lump, c[2] + n[2] * r[2] * lump, n[0], n[1], n[2], MU, MV, w, [0, 0, 0.9, SID.gore]));
    }
    for (let i = 0; i < nL; i++) for (let j = 0; j < nA; j++) {
      const a = ids[i * (nA + 1) + j], b = ids[i * (nA + 1) + j + 1], d = ids[(i + 1) * (nA + 1) + j], e = ids[(i + 1) * (nA + 1) + j + 1];
      mesh.quad(a, b, e, d, true);
    }
  }
  if (!fig) return;
  // stump caps: [centre, axis toward the part that goes, bone]
  const AT = nrm([SHOULDER[0] - 0.186 + 0.5646, -0.8253, 0]);
  const caps = [
    [[0, 1.522, -0.022], [0, 1, 0.08], 'neck', 0],
    [[SHOULDER[0] + AT[0] * 0.232, SHOULDER[1] + AT[1] * 0.232, SHOULDER[2]], AT, 'upperArm', 1],
    [[0.0975, 0.578, 0.003], [0, -1, 0], 'thigh', 1],
  ];
  const seg = q >= 1 ? 10 : 6;
  for (const [c, ax0, bone, paired] of caps) for (const side of paired ? [1, -1] : [1]) {
    const ax = nrm(ax0), u = nrm(Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [-ax[1], ax[0], 0]);
    const v = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
    const w = [[B[paired ? `${bone}${side > 0 ? 'L' : 'R'}` : bone], 1]];
    const at = (rr, a, R) => {
      const ca = Math.cos(a), sa = Math.sin(a), dome = 0.012 * (1 - rr * rr);
      const p = [c[0] + (u[0] * ca + v[0] * sa) * R * rr + ax[0] * dome, c[1] + (u[1] * ca + v[1] * sa) * R * rr + ax[1] * dome, c[2] + (u[2] * ca + v[2] * sa) * R * rr + ax[2] * dome];
      return mesh.vert(p[0] * side, p[1], p[2], ax[0] * side, ax[1], ax[2], MU, MV, w, [ca * rr, sa * rr, 2, SID.gore]);
    };
    const mid = at(0, 0, 0);
    let prev = null;
    for (const rr of [0.5, 1]) {
      const ring = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        // out to just inside the skin of this sculpt
        const h = march(fig, c[0], c[1], c[2], u[0] * ca + v[0] * sa, u[1] * ca + v[1] * sa, u[2] * ca + v[2] * sa, 0.12);
        ring.push(at(rr, a, (h < 0 ? 0.045 : h) * 0.93));
      }
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        if (!prev) mesh.tri(mid, ring[k], ring[k1]); else mesh.quad(prev[k], ring[k], ring[k1], prev[k1], false);
      }
      prev = ring;
    }
  }
}
