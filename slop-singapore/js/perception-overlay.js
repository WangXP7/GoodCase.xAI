import { predict } from './perception.js';

// js/perception-overlay.js
// What the autopilot sees (js/perception.js, js/navigation.js), drawn over the 3D view on a 2D canvas: every vehicle
// and person it is tracking as a box on the ground, coloured by what it means to the drive (the car it follows, the
// one it is getting out of the way of, the rest), each moving one's predicted course over the autopilot's look-ahead,
// the estimated speed of the ones that matter, and the line it plans to drive (with, faintly, the lanes' line as mapped,
// which it smoothed that line from). Off by default (the Navigate menu, O).
//
// buildOverlay() turns the navigator's state into world-space shapes; drawOverlay() projects and draws them with a
// project(x, y, z) -> { x, y } | null (null: behind the camera) in canvas pixels.

const COLORS = {
  tracked: 'rgba(170, 196, 224, 0.75)',
  person: 'rgba(255, 214, 102, 0.9)',
  lead: 'rgba(80, 170, 255, 0.95)',
  threat: 'rgba(255, 82, 70, 0.98)',
  plan: 'rgba(80, 230, 160, 0.85)',
  mapped: 'rgba(255, 255, 255, 0.38)',
  trail: 'rgba(170, 196, 224, 0.45)'
};

const TRAIL_STEP = 0.5; // s between the points of a predicted course
const RANGE = 70; // m: farther tracks are left off (the autopilot keeps them, the view would only clutter)

/** The shapes to draw for `navigator` driving `ego`: { objects, plan, mapped, conflict, horizon } in world metres */
function buildOverlay(navigator, ego) {
  const out = { objects: [], plan: [], mapped: [], conflict: null, horizon: 0 };
  if (!navigator || !navigator.autopilot || !navigator.tracker) return out;
  const horizon = navigator.driver?.safety?.horizon ?? 4;
  out.horizon = horizon;
  const threatObj = navigator.threat?.track?.obj || null;
  const p = {};
  const ex = ego.position.x;
  const ez = ego.position.z;
  for (const tr of navigator.tracker.tracks.values()) {
    if (Math.abs(tr.x - ex) > RANGE || Math.abs(tr.z - ez) > RANGE || Math.hypot(tr.x - ex, tr.z - ez) > RANGE) continue;
    const role = tr.obj === threatObj ? 'threat' : tr.obj === navigator.leadObj ? 'lead' : tr.ped ? 'person' : 'tracked';
    const hx = tr.hx;
    const hz = tr.hz;
    const rx = -hz; // right of the heading (road-network.js convention)
    const rz = hx;
    const box = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => ({
      x: tr.x + hx * tr.half * a + rx * tr.hw * b,
      z: tr.z + hz * tr.half * a + rz * tr.hw * b
    }));
    const trail = [];
    // (people's courses only when one matters: they mostly walk the pavements)
    if (tr.speed > 0.8 && (!tr.ped || role === 'threat')) {
      for (let t = TRAIL_STEP; t <= horizon + 1e-9; t += TRAIL_STEP) {
        predict(tr, t, p);
        trail.push({ x: p.x, z: p.z });
      }
    }
    out.objects.push({ obj: tr.obj, role, box, trail, x: tr.x, z: tr.z, speed: tr.speed, ped: tr.ped });
  }
  out.plan = navigator.planPreview ? navigator.planPreview() : [];
  out.mapped = navigator.mappedPreview ? navigator.mappedPreview() : [];
  if (navigator.threat) out.conflict = { t: navigator.threat.t, gap: navigator.threat.gap };
  return out;
}

function polyline(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/**
 * Draws `view` (buildOverlay) on ctx: project(x, y, z) gives canvas pixels or null behind the camera; y is the ground
 * height to draw at. Returns { objects } drawn (for tests).
 */
function drawOverlay(ctx, view, project, { y = 0, dpr = 1, metric = true } = {}) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const lift = y + 0.08;
  const proj = (pts, h = lift) => {
    const out = [];
    for (const q of pts) {
      const s = project(q.x, h, q.z);
      if (!s) return null;
      out.push(s);
    }
    return out;
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // the lanes' line as mapped: thin and faint, under the planned line smoothed from it
  if (view.mapped && view.mapped.length > 1) {
    const pts = [];
    for (const q of view.mapped) {
      const s = project(q.x, lift, q.z);
      if (s) pts.push(s);
    }
    if (pts.length > 1) {
      ctx.strokeStyle = COLORS.mapped;
      ctx.lineWidth = 1.25 * dpr;
      polyline(ctx, pts);
      ctx.stroke();
    }
  }

  // the planned line: a ribbon of dots fading out with distance
  if (view.plan.length > 1) {
    const pts = [];
    for (const q of view.plan) {
      const s = project(q.x, lift, q.z);
      if (s) pts.push(s);
    }
    if (pts.length > 1) {
      ctx.strokeStyle = COLORS.plan;
      ctx.lineWidth = 3 * dpr;
      ctx.setLineDash([2 * dpr, 7 * dpr]);
      polyline(ctx, pts);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  let drawn = 0;
  // the picked-out ones on top
  const order = { tracked: 0, person: 1, lead: 2, threat: 3 };
  const objects = [...view.objects].sort((a, b) => order[a.role] - order[b.role]);
  ctx.font = `600 ${12 * dpr}px Inter, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  for (const o of objects) {
    const box = proj(o.box);
    if (!box) continue;
    drawn++;
    const color = COLORS[o.role];
    // the course it is predicted to take
    if (o.trail.length) {
      const from = project(o.x, lift, o.z);
      const trail = proj(o.trail);
      if (from && trail) {
        ctx.strokeStyle = o.role === 'tracked' || o.role === 'person' ? COLORS.trail : color;
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        polyline(ctx, [from, ...trail]);
        ctx.stroke();
        ctx.setLineDash([]);
        const end = trail[trail.length - 1];
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(end.x, end.y, 2.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // its footprint, and a frame standing up from it for vehicles
    ctx.strokeStyle = color;
    ctx.lineWidth = (o.role === 'tracked' || o.role === 'person' ? 1.5 : 2.5) * dpr;
    polyline(ctx, [...box, box[0]]);
    ctx.stroke();
    if (o.role === 'threat' || o.role === 'lead') {
      ctx.fillStyle = o.role === 'threat' ? 'rgba(255, 82, 70, 0.18)' : 'rgba(80, 170, 255, 0.14)';
      polyline(ctx, box);
      ctx.closePath();
      ctx.fill();
      const top = project(o.x, lift + (o.ped ? 1.9 : 1.7), o.z);
      if (top) {
        const v = o.speed * (metric ? 3.6 : 2.237);
        const label = `${o.role === 'threat' ? '⚠ ' : ''}${Math.round(v)} ${metric ? 'km/h' : 'mph'}`;
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.strokeText(label, top.x, top.y);
        ctx.fillStyle = color;
        ctx.fillText(label, top.x, top.y);
      }
    }
  }
  return { objects: drawn };
}

/** The overlay canvas over the view, and its per-frame update */
class PerceptionOverlay {
  constructor(container, { metric = true } = {}) {
    this.metric = metric;
    this.enabled = false;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'perception-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this._v = null;
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    this.canvas.hidden = !this.enabled;
    if (!this.enabled && this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Draw for `navigator` driving `ego` as `camera` (a three.js camera; V, a Vector3 class) sees it */
  update(navigator, ego, camera, V) {
    if (!this.enabled || !this.ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const v = this._v || (this._v = new V());
    camera.updateMatrixWorld();
    const project = (x, y, z) => {
      v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      if (v.z > -0.5) return null; // behind (or right at) the camera
      v.applyMatrix4(camera.projectionMatrix);
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
    };
    drawOverlay(this.ctx, buildOverlay(navigator, ego), project, { y: ego.position.y, dpr, metric: this.metric });
  }
}

export { buildOverlay, drawOverlay, PerceptionOverlay, COLORS };
