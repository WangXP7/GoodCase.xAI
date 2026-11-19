// js/jet-hud.js
// The F-15SG's head-up display, drawn in green on a canvas over the view while flying it (js/jet-flight.js). From the
// cockpit: the pitch ladder rolling with the horizon, the heading tape (true heading), the boresight cross and the
// flight path marker; speed in knots with the Mach number and g on the left, altitude in feet with the climb rate on
// the right, the throttle with the afterburner's stage, and the warnings (STALL, PULL UP, GEAR). Behind the jet (the
// chase cameras, where the speed cluster has the numbers) just the throttle and the warnings. Units are aviation's wherever the city is: knots and feet.

const GREEN = '#7dffa8';
const WARN = '#ffb347';
const KT = 1.943844, FT = 3.28084, SOUND = 340.3, LB = 2.20462;
// fuel in thousands of pounds, as the jet's own gauges; FUEL LOW under 2,000 lb
const fuelText = (s) => (s.unlimitedFuel ? 'FUEL ∞' : `FUEL ${((s.fuel ?? 0) * LB / 1000).toFixed(1)}`);
const FUEL_LOW = 2000 / LB;

class JetHUD {
  constructor(parent, { bearingDeg = 0 } = {}) {
    this.bearing = (bearingDeg * Math.PI) / 180;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'jet-hud';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.visible = false;
    this.time = 0;
  }

  setVisible(on) {
    on = !!on;
    if (on === this.visible) return;
    this.visible = on;
    this.canvas.hidden = !on;
  }

  /** True heading (degrees, 0 = north) of a world heading (forward (sin h, cos h); z is grid south) */
  trueHeading(h) {
    const deg = ((Math.PI - h + this.bearing) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }

  // `bore`, from the cockpit: where the jet's boresight is on screen ({ x, y } CSS pixels) and how much of the HUD the
  // pilot's head still sees through the combiner (0..1): the symbology is fixed to the jet, not the head
  update(dt, jet, camera, cockpit, bore = null) {
    if (!this.visible || !jet || !this.ctx) return;
    this.time += dt;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.scale(dpr, dpr);
    const w = W / dpr, h = H / dpr;
    const s = jet.flight;
    const cx = cockpit && bore ? bore.x : w / 2, cy = cockpit && bore ? bore.y : h / 2;
    if (cockpit && bore && bore.alpha < 0.02) return;
    g.globalAlpha = cockpit && bore ? bore.alpha : 1;
    const unit = Math.max(0.75, Math.min(1.25, Math.min(w, h) / 760));
    g.lineWidth = 1.5 * unit;
    g.strokeStyle = GREEN;
    g.fillStyle = GREEN;
    g.shadowColor = 'rgba(0, 40, 10, 0.85)';
    g.shadowBlur = 3;
    g.textBaseline = 'middle';
    const font = (px, weight = 600) => `${weight} ${Math.round(px * unit)}px "SF Mono", ui-monospace, Menlo, Consolas, monospace`;
    const blink = Math.floor(this.time * 3) % 2 === 0;

    const kt = s.speed * KT;
    const mach = s.speed / SOUND;
    // (the wheels' height: 0 on the runway)
    const altFt = Math.max(0, jet.position.y - 2.3) * FT;
    const vsi = s.climbRate * FT * 60;

    if (cockpit) {
      const f = (h / 2) / Math.tan(((camera.fov || 60) * Math.PI) / 360);
      const pitch = jet.attitude.pitch, bank = jet.attitude.bank;
      // the ladder, rolled with the horizon
      g.save();
      g.beginPath();
      g.rect(cx - 210 * unit, cy - 190 * unit, 420 * unit, 380 * unit);
      g.clip();
      g.translate(cx, cy);
      g.rotate(-bank);
      g.font = font(12);
      for (let deg = -85; deg <= 85; deg += 5) {
        const d = (deg * Math.PI) / 180 - pitch;
        if (Math.abs(d) > 0.6) continue;
        const y = -Math.tan(d) * f;
        const half = deg === 0 ? 190 * unit : 62 * unit, gap = deg === 0 ? 40 * unit : 26 * unit;
        g.setLineDash(deg < 0 ? [7 * unit, 5 * unit] : []);
        g.beginPath();
        g.moveTo(-half, y); g.lineTo(-gap, y);
        g.moveTo(gap, y); g.lineTo(half, y);
        if (deg !== 0) {
          // the ends turn towards the horizon
          const tick = (deg > 0 ? 8 : -8) * unit;
          g.moveTo(-half, y); g.lineTo(-half, y + tick);
          g.moveTo(half, y); g.lineTo(half, y + tick);
        }
        g.stroke();
        if (deg !== 0) {
          g.textAlign = 'right';
          g.fillText(String(Math.abs(deg)), -half - 6 * unit, y);
          g.textAlign = 'left';
          g.fillText(String(Math.abs(deg)), half + 6 * unit, y);
        }
      }
      g.setLineDash([]);
      g.restore();

      // the boresight (the gun cross) and the flight path marker a little below it (angle of attack)
      g.beginPath();
      g.moveTo(cx - 10 * unit, cy); g.lineTo(cx + 10 * unit, cy);
      g.moveTo(cx, cy - 10 * unit); g.lineTo(cx, cy + 10 * unit);
      g.stroke();
      const aoa = s.onGround ? 0 : Math.min(0.35, 0.03 * Math.max(0.3, s.g) * (120 / Math.max(60, s.speed)) ** 2);
      const fy = cy + Math.tan(aoa) * f;
      g.beginPath();
      g.arc(cx, fy, 7 * unit, 0, Math.PI * 2);
      g.moveTo(cx - 7 * unit, fy); g.lineTo(cx - 19 * unit, fy);
      g.moveTo(cx + 7 * unit, fy); g.lineTo(cx + 19 * unit, fy);
      g.moveTo(cx, fy - 7 * unit); g.lineTo(cx, fy - 14 * unit);
      g.stroke();

      // the bank scale under the ladder
      const r = 150 * unit;
      g.beginPath();
      for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const t = (a * Math.PI) / 180;
        const len = a % 30 === 0 ? 12 : 7;
        g.moveTo(cx + Math.sin(t) * r, cy + Math.cos(t) * r);
        g.lineTo(cx + Math.sin(t) * (r + len * unit), cy + Math.cos(t) * (r + len * unit));
      }
      g.stroke();
      const bt = Math.max(-1.2, Math.min(1.2, -bank));
      g.beginPath();
      g.moveTo(cx + Math.sin(bt) * (r - 2 * unit), cy + Math.cos(bt) * (r - 2 * unit));
      g.lineTo(cx + Math.sin(bt - 0.04) * (r - 12 * unit), cy + Math.cos(bt - 0.04) * (r - 12 * unit));
      g.lineTo(cx + Math.sin(bt + 0.04) * (r - 12 * unit), cy + Math.cos(bt + 0.04) * (r - 12 * unit));
      g.closePath();
      g.fill();

      // the heading tape
      const hdg = this.trueHeading(jet.heading);
      const ty = cy - 215 * unit, pxPerDeg = 6 * unit;
      g.font = font(12);
      g.textAlign = 'center';
      g.beginPath();
      for (let k = Math.floor((hdg - 30) / 5) * 5; k <= hdg + 30; k += 5) {
        const x = cx + (k - hdg) * pxPerDeg;
        if (Math.abs(x - cx) > 180 * unit) continue;
        const major = ((k % 10) + 10) % 10 === 0;
        g.moveTo(x, ty); g.lineTo(x, ty + (major ? 9 : 5) * unit);
        if (major) g.fillText(String((((k / 10) % 36) + 36) % 36).padStart(2, '0'), x, ty - 9 * unit);
      }
      g.stroke();
      g.font = font(14, 700);
      const label = String(Math.round(hdg) % 360).padStart(3, '0');
      g.strokeRect(cx - 24 * unit, ty + 13 * unit, 48 * unit, 20 * unit);
      g.fillText(label, cx, ty + 23 * unit);
    }

    // behind the jet the speed cluster has the numbers: just the throttle and the warnings
    if (!cockpit) {
      this.drawThrottle(g, s, cx, h * 0.66, unit, font, blink, jet, h * 0.66 - 40 * unit);
      return;
    }
    // speed (left) and altitude (right): boxes at the ladder's sides
    const by = cy, bx = 250 * unit;
    g.textAlign = 'center';
    g.font = font(18, 700);
    const box = (x, text) => {
      g.strokeRect(x - 42 * unit, by - 14 * unit, 84 * unit, 28 * unit);
      g.fillText(text, x, by + 1);
    };
    box(cx - bx, String(Math.round(kt)));
    box(cx + bx, Math.round(altFt).toLocaleString('en-US'));
    g.font = font(12);
    g.fillText('KT', cx - bx, by - 24 * unit);
    g.fillText('FT', cx + bx, by - 24 * unit);
    g.textAlign = 'left';
    g.fillText(`M ${mach.toFixed(2)}`, cx - bx - 40 * unit, by + 30 * unit);
    g.fillText(`G ${s.g.toFixed(1)}`, cx - bx - 40 * unit, by + 48 * unit);
    g.fillText(fuelText(s), cx - bx - 40 * unit, by + 66 * unit);
    g.fillText(`${vsi >= 0 ? '+' : '−'}${Math.abs(Math.round(vsi / 100) * 100).toLocaleString('en-US')} FPM`, cx + bx - 40 * unit, by + 30 * unit);

    this.drawThrottle(g, s, cx, cy + 175 * unit, unit, font, blink, jet, cy + 90 * unit);
  }

  // the throttle: a bar, the afterburner's stage marked AB; the warnings above it at wy
  drawThrottle(g, s, cx, tyy, unit, font, blink, jet, wy) {
    const tw = 120 * unit, tx = cx - tw / 2;
    g.strokeRect(tx, tyy, tw, 8 * unit);
    g.fillRect(tx, tyy, tw * s.throttle, 8 * unit);
    g.beginPath();
    g.moveTo(tx + tw * 0.8, tyy - 4 * unit); g.lineTo(tx + tw * 0.8, tyy + 12 * unit);
    g.stroke();
    g.font = font(12, 700);
    g.textAlign = 'center';
    const thrust = s.throttle > 0.8 ? `AB ${Math.min(5, 1 + Math.floor(((s.throttle - 0.8) / 0.2) * 5))}` : s.throttle <= 0 ? (s.speedBrake ? (s.onGround ? 'BRAKES' : 'SPD BRK') : 'IDLE') : `${Math.round((s.throttle / 0.8) * 100)}%`;
    g.fillText(s.flameout ? 'FLAMEOUT' : thrust, cx, tyy + 22 * unit);
    g.font = font(11, 600);
    g.fillText(jet.refuelling ? `REFUELLING ${fuelText(s).slice(5)}` : fuelText(s), cx, tyy + 38 * unit);

    // warnings
    const warnings = [];
    if (jet.crashed > 0) warnings.push('CRASHED');
    else {
      if (s.stalled) warnings.push('STALL');
      // ground in under 5 s at this descent
      const agl = jet.position.y - 2.3;
      if (!s.onGround && s.climbRate < -15 && agl / -s.climbRate < 5) warnings.push('PULL UP');
      if (s.gear > 0.05 && !s.onGround) warnings.push(s.gear < 0.95 ? 'GEAR TRANSIT' : 'GEAR DOWN');
      if (s.flameout) warnings.push('NO FUEL');
      else if (!s.unlimitedFuel && s.fuel < FUEL_LOW) warnings.push('FUEL LOW');
    }
    if (warnings.length) {
      g.font = font(16, 800);
      g.textAlign = 'center';
      warnings.forEach((text, i) => {
        const urgent = text === 'PULL UP' || text === 'STALL' || text === 'CRASHED' || text === 'NO FUEL' || text === 'FUEL LOW';
        if (urgent && !blink) return;
        g.fillStyle = urgent ? WARN : GREEN;
        g.fillText(text, cx, wy + i * 22 * unit);
      });
      g.fillStyle = GREEN;
    }
  }
}

export { JetHUD };
