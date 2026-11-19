import { MathUtils, Vector2, Vector3 } from 'three';

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, dt));
const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** A slow, bounded establishing shot with space reserved for the menu. */
export function menuCameraPose(player: Readonly<Vector3>, opponent: Readonly<Vector3>, heading: number, aspect: number, time: number, reducedMotion = false) {
  const portrait = aspect < 1, t = reducedMotion ? 0 : time;
  const yaw = heading + .92 + Math.sin(t * .17) * .045;
  const distance = (portrait ? 6.4 : 4.95) + Math.sin(t * .21) * .08;
  const target = new Vector3().copy(player).lerp(opponent, .5); target.y = 1.12 + Math.sin(t * .23) * .015;
  const position = target.clone().add(new Vector3(-Math.sin(yaw) * distance, 1.55 + Math.sin(t * .19) * .035, -Math.cos(yaw) * distance));
  return { position, target, offsetX: portrait ? 0 : .115, offsetY: portrait ? .14 : 0 };
}

/** An upright shoulder camera. Smooth the pivot and yaw, never the ragdoll's rotation. */
export class DuelCamera {
  readonly position = new Vector3();
  readonly target = new Vector3();
  private anchor = new Vector3();
  private forward = new Vector3();
  private right = new Vector3();
  private opponent = new Vector3();
  private framingDistance = 0;
  private yaw = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private desiredLookYaw = 0;
  private desiredLookPitch = 0;
  private distance = 4.5;
  private desiredDistance = 4.5;

  reset(pelvis: Readonly<Vector3>, heading: number, opponent?: Readonly<Vector3>) {
    this.anchor.copy(pelvis); this.anchor.y = MathUtils.clamp(pelvis.y, -.7, 1.08);
    this.opponent.copy(opponent ?? pelvis); this.opponent.y = Math.max(-1.5, this.opponent.y); this.framingDistance = this.requiredFraming();
    this.yaw = heading; this.lookYaw = this.lookPitch = this.desiredLookYaw = this.desiredLookPitch = 0;
    this.distance = this.desiredDistance;
    this.compose();
  }

  look(dx: number, dy: number) {
    this.desiredLookYaw = MathUtils.clamp(this.desiredLookYaw - dx * .003, -1.05, 1.05);
    this.desiredLookPitch = MathUtils.clamp(this.desiredLookPitch + dy * .003, -.2, .25);
  }

  zoom(deltaPixels: number) {
    this.desiredDistance = MathUtils.clamp(this.desiredDistance * Math.exp(deltaPixels * .001), 3.3, 7);
  }

  update(pelvis: Readonly<Vector3>, heading: number, dt: number, looking = false, opponent?: Readonly<Vector3>) {
    const follow = damp(8, dt);
    this.anchor.x = MathUtils.lerp(this.anchor.x, pelvis.x, follow);
    this.anchor.z = MathUtils.lerp(this.anchor.z, pelvis.z, follow);
    this.anchor.y = MathUtils.lerp(this.anchor.y, MathUtils.clamp(pelvis.y, -.7, 1.08), damp(4, dt));
    this.opponent.lerp(opponent ?? pelvis, damp(6, dt)); this.opponent.y = Math.max(-1.5, this.opponent.y);
    this.yaw += MathUtils.clamp(angleDelta(this.yaw, heading) * damp(5, dt), -2.8 * dt, 2.8 * dt);
    this.framingDistance = MathUtils.lerp(this.framingDistance, this.requiredFraming(), damp(3, dt));
    if (!looking) this.desiredLookYaw = this.desiredLookPitch = 0;
    const lookFollow = damp(looking ? 16 : 6, dt);
    this.lookYaw = MathUtils.lerp(this.lookYaw, this.desiredLookYaw, lookFollow);
    this.lookPitch = MathUtils.lerp(this.lookPitch, this.desiredLookPitch, lookFollow);
    this.distance = MathUtils.lerp(this.distance, this.desiredDistance, damp(10, dt));
    this.compose();
  }

  private requiredFraming() {
    return MathUtils.clamp(this.anchor.distanceTo(this.opponent) - 2.2, 0, 2) + MathUtils.clamp(Math.abs(this.anchor.y - this.opponent.y) - .5, 0, 2);
  }

  private compose() {
    const yaw = this.yaw + .65 + this.lookYaw, pitch = .38 + this.lookPitch;
    this.forward.set(Math.sin(yaw), 0, Math.cos(yaw));
    // Facing +Z, screen-right is local -X (the same convention as the movement controls).
    this.right.set(-Math.cos(yaw), 0, Math.sin(yaw));
    // Rebuild the boom after smoothing its angles so turns cannot cut through the fighter.
    const distance = this.distance + this.framingDistance * .65;
    this.position.copy(this.anchor).addScaledVector(this.forward, -distance * Math.cos(pitch)).addScaledVector(this.right, .35);
    this.position.y += distance * Math.sin(pitch);
    this.target.copy(this.anchor).lerp(this.opponent, .4).addScaledVector(this.forward, .3);
    this.target.y += .35;
  }
}

/** Relative steering works both with pointer lock and ordinary dragging, without a click-time jump. */
export function steerWeapon(aim: Vector2, dx: number, dy: number) {
  aim.set(MathUtils.clamp(aim.x - dx * .006, -1, 1), MathUtils.clamp(aim.y - dy * .006, -1, 1));
}
