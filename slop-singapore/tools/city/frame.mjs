// tools/city/frame.mjs — a city's world frame: 1 unit = 1 m, x = grid east, z = grid south (north = -z), the axes turned
// `theta` (clockwise from true north) to line up with the street grid, origin at a chosen point.
// The local tangent plane at (lat0, lon0) on the WGS84 ellipsoid: exact to well under a metre across a city.

const A = 6378137.0;
const E2 = 6.69437999014e-3;

// `theta` & `origin` (the grid (u, v) of the world origin) may be refined after construction (calibration)
export function makeFrame({ lat0, lon0, theta = 0, origin = [0, 0] }) {
  const PHI0 = (lat0 * Math.PI) / 180;
  const SIN0 = Math.sin(PHI0);
  const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
  const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
  const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
  const KY = (Math.PI / 180) * MRAD;
  const frame = {
    lat0, lon0, theta, origin,
    // Local tangent plane (east, north) metres
    enu: (lon, lat) => [(lon - lon0) * KX, (lat - lat0) * KY],
    // Grid frame: u = grid east, v = grid south
    gridUV(lon, lat) {
      const [e, n] = frame.enu(lon, lat);
      const c = Math.cos(frame.theta);
      const s = Math.sin(frame.theta);
      return [e * c - n * s, -(e * s + n * c)];
    },
    toWorld(lon, lat) {
      const [u, v] = frame.gridUV(lon, lat);
      return [u - frame.origin[0], v - frame.origin[1]];
    },
    toLonLat(x, z) {
      const u = x + frame.origin[0], v = z + frame.origin[1];
      const c = Math.cos(frame.theta);
      const s = Math.sin(frame.theta);
      return [lon0 + (u * c - v * s) / KX, lat0 + (-u * s - v * c) / KY];
    }
  };
  return frame;
}

// The street grid's bearing (radians clockwise from true north, in (-45°, 45°]): the length-weighted mode of the
// segments' directions modulo 90°, refined by the weighted mean within ±3° of it. `segs`: [[lon0, lat0, lon1, lat1, w]]
export function gridBearing(frame, segs) {
  const BIN = 0.25;
  const N = 360; // 90° in BIN steps
  const hist = new Float64Array(N);
  const dirs = [];
  for (const [lon0, lat0, lon1, lat1, w = 1] of segs) {
    const [e0, n0] = frame.enu(lon0, lat0);
    const [e1, n1] = frame.enu(lon1, lat1);
    const L = Math.hypot(e1 - e0, n1 - n0);
    if (L < 1) continue;
    const a = ((((Math.atan2(e1 - e0, n1 - n0) * 180) / Math.PI) % 90) + 90) % 90;
    dirs.push([a, L * w]);
    hist[Math.floor(a / BIN) % N] += L * w;
  }
  if (!dirs.length) return 0;
  // circular smoothing over ±2°
  const K = Math.round(2 / BIN);
  let best = 0, bestV = -1;
  for (let i = 0; i < N; i++) {
    let v = 0;
    for (let k = -K; k <= K; k++) v += hist[(i + k + N) % N];
    if (v > bestV) { bestV = v; best = i; }
  }
  const peak = (best + 0.5) * BIN;
  let sum = 0, tot = 0;
  for (const [a, w] of dirs) {
    const d = ((((a - peak) % 90) + 135) % 90) - 45; // signed difference modulo 90°
    if (Math.abs(d) > 3) continue;
    sum += d * w;
    tot += w;
  }
  let deg = peak + (tot ? sum / tot : 0);
  if (deg > 45) deg -= 90;
  return (deg * Math.PI) / 180;
}
