// js/binoculars.js
// Binoculars: the view stays where the camera is (still following the player, walking, driving or flying), turned to a
// target and zoomed in to frame it, through a pair of round eyepieces (the #binoculars overlay), with a hand's slight
// shake. Raised over BINOCULARS.raise s: the aim swings round from the view's and the lens narrows from the view's
// own. A target is anything with focus(out) -> radius (js/air-force.js's flypast: the middle of its jets and how far
// they spread; 0 when there's nothing to see, which lowers them). No three.js: it turns the camera with lookAt.
//
// Each frame: before() ahead of the camera system's update (so the view's own lens carries on underneath), update(dt,
// elapsed) after it.

const BINOCULARS = {
  raise: 0.7, // s to bring them up or down
  fill: 0.5, // of the view's height the target spans
  minFov: 1.2, // degrees: about x50 on a 56 degree view
  maxFov: 40,
  zoomRate: 3, // 1/s the lens follows the target's spread
  shake: 0.012 // of the lens
};

const DEG = Math.PI / 180;
const smooth = (t) => t * t * (3 - 2 * t);

/** The vertical lens (degrees) that spans a target `radius` m across BINOCULARS.fill of the view at `distance` m */
function frameFov(distance, radius) {
  const fov = (2 * Math.atan(radius / (Math.max(1, distance) * BINOCULARS.fill))) / DEG;
  return Math.min(BINOCULARS.maxFov, Math.max(BINOCULARS.minFov, fov));
}

class Binoculars {
  /** `camera`: a three.js PerspectiveCamera; `overlay`, `label`: the eyepieces and their reading (optional) */
  constructor(camera, { overlay = null, label = null } = {}) {
    this.camera = camera;
    this.overlay = overlay;
    this.label = label;
    this.target = null;
    this.raised = 0; // 0 down .. 1 up
    this.viewFov = camera.fov; // the view's own lens
    this.output = NaN; // the lens set here last
    this.lens = 0; // the lens framing the target (degrees), eased
    this.aim = camera.position.clone();
    this.look = camera.position.clone();
    this.savedUp = camera.up.clone();
    this.zoom = 1;
    this.distance = 0;
    this.shown = '';
  }

  /** Up (or still on the way down) */
  get active() {
    return !!this.target || this.raised > 0;
  }

  /** Raise them on `target` */
  watch(target) {
    if (!this.active) this.lens = 0;
    this.target = target;
  }

  lower() {
    this.target = null;
  }

  /** Up on `target` if they're down (or coming down), else down; returns whether they're going up */
  toggle(target) {
    if (this.target) this.lower();
    else if (target) this.watch(target);
    return !!this.target;
  }

  /** Ahead of the camera system's update: the view's own lens back, so it carries on from where it was */
  before() {
    if (this.raised > 0) this.camera.fov = this.viewFov;
  }

  update(dt, elapsed = 0) {
    const cam = this.camera;
    if (!this.target && this.raised === 0) return;
    // the view's own lens (unless before() wasn't called, and the lens is still the one set here last frame)
    if (cam.fov !== this.output) this.viewFov = cam.fov;
    // what there is to see
    const radius = this.target ? this.target.focus(this.aim) : 0;
    if (this.target && !(radius > 0)) this.target = null;
    this.raised = Math.min(1, Math.max(0, this.raised + (this.target ? dt : -dt) / BINOCULARS.raise));
    const e = smooth(this.raised);
    const p = cam.position;
    const dx = this.aim.x - p.x, dy = this.aim.y - p.y, dz = this.aim.z - p.z;
    const d = Math.hypot(dx, dy, dz);
    if (radius > 0) {
      const want = frameFov(d, radius);
      // (eased in log space: a zoom's steps look even)
      this.lens = this.lens > 0 ? Math.exp(Math.log(this.lens) + (Math.log(want) - Math.log(this.lens)) * (1 - Math.exp(-dt * BINOCULARS.zoomRate))) : want;
      this.distance = d;
    }
    if (!(this.lens > 0)) this.lens = this.viewFov;
    const fov = e === 0 ? this.viewFov : Math.exp(Math.log(this.viewFov) + (Math.log(this.lens) - Math.log(this.viewFov)) * e);

    if (e > 0) {
      // the aim: from the view's way round to the target's, then the hand's shake (a share of the lens)
      const view = cam.getWorldDirection(this.look);
      const vYaw = Math.atan2(view.x, view.z), vPitch = Math.asin(Math.max(-1, Math.min(1, view.y)));
      const tYaw = Math.atan2(dx, dz), tPitch = Math.atan2(dy, Math.hypot(dx, dz));
      let dYaw = tYaw - vYaw;
      dYaw -= Math.round(dYaw / (2 * Math.PI)) * 2 * Math.PI;
      const wobble = BINOCULARS.shake * fov * DEG * e;
      const yaw = vYaw + dYaw * e + wobble * (Math.sin(elapsed * 1.7) + 0.6 * Math.sin(elapsed * 4.3 + 1));
      const pitch = vPitch + (tPitch - vPitch) * e + wobble * (Math.sin(elapsed * 2.3 + 2) + 0.5 * Math.sin(elapsed * 5.1));
      const cp = Math.cos(pitch);
      this.savedUp.copy(cam.up);
      cam.up.set(0, 1, 0);
      cam.lookAt(p.x + Math.sin(yaw) * cp, p.y + Math.sin(pitch), p.z + Math.cos(yaw) * cp);
      cam.up.copy(this.savedUp);
    }
    cam.fov = this.output = fov;
    cam.updateProjectionMatrix();
    this.zoom = Math.tan((this.viewFov * DEG) / 2) / Math.tan((fov * DEG) / 2);

    // the eyepieces
    if (this.overlay) {
      this.overlay.toggleAttribute('hidden', e === 0);
      this.overlay.style.opacity = e === 1 ? '1' : e.toFixed(3);
    }
    if (this.label) {
      const text = `×${Math.max(1, Math.round(this.zoom))} · ${this.distance >= 1000 ? `${(this.distance / 1000).toFixed(1)} km` : `${Math.round(this.distance / 10) * 10} m`}`;
      if (text !== this.shown) this.label.textContent = this.shown = text;
    }
  }
}

export { Binoculars, frameFov, BINOCULARS };
