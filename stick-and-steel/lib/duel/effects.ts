import * as T from 'three';
import type { DuelHit, Fighter } from './physics';
import { onPlatform, type ArenaKind } from './arena';

const UP = new T.Vector3(0, 1, 0);
const DROP_LIMIT = 192, STAIN_LIMIT = 256;

/** Only catch a falling drop as it crosses a real surface, never above its source. */
export function bloodSurface(arena: ArenaKind, previousY: number, point: T.Vector3): number | null {
  if (previousY >= 0 && point.y <= 0 && (arena === 'yard' || onPlatform(arena, point))) return 0;
  if (arena === 'bridge' && previousY >= -7 && point.y <= -7 && Math.hypot(point.x, point.z) < 12) return -7;
  return null;
}

/** Bounded cosmetic particles; droplets follow ballistic arcs without adding physics bodies. */
export function createImpactEffects(scene: T.Scene) {
  const dropGeometry = new T.SphereGeometry(1, 8, 6), stainGeometry = new T.CircleGeometry(1, 24);
  const vertices = stainGeometry.getAttribute('position');
  for (let i = 1; i < vertices.count; i++) {
    const angle = Math.atan2(vertices.getY(i), vertices.getX(i));
    const radius = .9 + Math.sin(angle * 3) * .07 + Math.cos(angle * 5) * .03;
    vertices.setXYZ(i, vertices.getX(i) * radius, vertices.getY(i) * radius, 0);
  }
  const dropMaterial = new T.MeshStandardMaterial({ color: '#ffffff', roughness: .27, metalness: 0 });
  const stainMaterial = new T.MeshBasicMaterial({ color: '#ffffff', depthWrite: false, transparent: true, opacity: .88, polygonOffset: true, polygonOffsetFactor: -1 });
  const drops = new T.InstancedMesh(dropGeometry, dropMaterial, DROP_LIMIT);
  const stains = new T.InstancedMesh(stainGeometry, stainMaterial, STAIN_LIMIT);
  drops.frustumCulled = stains.frustumCulled = false; drops.castShadow = true; stains.renderOrder = 0;
  drops.instanceMatrix.setUsage(T.DynamicDrawUsage); stains.instanceMatrix.setUsage(T.DynamicDrawUsage);
  scene.add(drops, stains);
  const particles = Array.from({ length: DROP_LIMIT }, () => ({ position: new T.Vector3(), velocity: new T.Vector3(), life: 0, size: .01, blood: true }));
  const marks = Array.from({ length: STAIN_LIMIT }, () => ({ x: 0, y: 0, z: 0, size: 0, aspect: 1, angle: 0, age: 0 }));
  const outlets = new Map<string, { point: T.Vector3; velocity: T.Vector3; carry: number }>();
  const dummy = new T.Object3D(), color = new T.Color(), direction = new T.Vector3(), freshBlood = new T.Color('#a31523'), dryBlood = new T.Color('#49181e');
  let nextDrop = 0, nextStain = 0;

  function emit(point: T.Vector3, velocity: T.Vector3, size: number, blood: boolean) {
    const index = nextDrop++ % DROP_LIMIT, p = particles[index];
    p.position.copy(point); p.velocity.copy(velocity); p.size = size; p.blood = blood; p.life = blood ? 2 : .23;
    drops.setColorAt(index, color.set(blood ? (index % 3 ? '#b81828' : '#810f23') : '#ffd786'));
    drops.instanceColor!.needsUpdate = true;
  }
  function splat(x: number, y: number, z: number, size: number, velocity: T.Vector3, arena: ArenaKind) {
    // Repeated drips gather into a small pool instead of stacking coplanar circles.
    const nearby = marks.find(m => m.size > 0 && m.age < 18 && m.y === y && Math.hypot(m.x - x, m.z - z) < Math.max(.035, m.size * .65));
    if (nearby) { nearby.size = Math.min(.16, Math.sqrt(nearby.size ** 2 + size ** 2 * .3)); nearby.age = 0; return; }
    const mark = marks[nextStain++ % STAIN_LIMIT];
    if (arena === 'bridge' && y === 0 && !onPlatform(arena, { x, z }, size * 2.5)) size *= .45;
    Object.assign(mark, { x, y, z, size, aspect: 1 + Math.min(1.5, Math.hypot(velocity.x, velocity.z) * .18), angle: Math.atan2(velocity.z, velocity.x), age: 0 });
  }
  function hit(hit: DuelHit, training = false) {
    const blood = !training && (hit.kind === 'hit' || hit.kind === 'sever' || hit.kind === 'impale'), sever = hit.kind === 'sever' || hit.kind === 'impale';
    const count = blood ? sever ? 34 : Math.round(T.MathUtils.clamp(hit.damage, 6, 20)) : 9;
    const base = hit.velocity.clone().multiplyScalar(blood ? .24 : .10).clampLength(0, sever ? 3.5 : 2.2);
    for (let i = 0; i < count; i++) {
      direction.set((Math.random() - .5) * 2, Math.random() * 1.4, (Math.random() - .5) * 2).multiplyScalar(sever ? 1.6 : .9).add(base);
      emit(hit.point, direction, (blood ? .012 : .009) * (.65 + Math.random() * .8), blood);
    }
  }
  function update(dt: number, fighters: Fighter[], time: number, arena: ArenaKind = 'yard') {
    const active = new Set<string>();
    for (const f of fighters) for (const wound of f.wounds) {
      const age = time - wound.born;
      if (age < 0 || age > 16) continue;
      for (const [end, name, anchor] of [[0, wound.parent, wound.parentAnchor], [1, wound.part, wound.childAnchor]] as const) {
        const body = f.rig.parts.get(name)!.body, rotation = new T.Quaternion().copy(body.rotation());
        const point = anchor.clone().applyQuaternion(rotation).add(new T.Vector3().copy(body.translation()));
        const key = `${f.id}:${wound.born}:${wound.part}:${end}`; active.add(key);
        let outlet = outlets.get(key);
        if (!outlet) { outlet = { point: point.clone(), velocity: new T.Vector3().copy(body.linvel()), carry: 0 }; outlets.set(key, outlet); }
        // Position-derived velocity also follows interpolated network bodies,
        // whose Rapier linear velocities are not simulated on the remote client.
        if (dt > 0) outlet.velocity.lerp(point.clone().sub(outlet.point).divideScalar(dt).clampLength(0, 8), 1 - Math.exp(-dt * 18));
        outlet.point.copy(point); outlet.carry += dt;
        const interval = age < 2.4 ? .035 : age < 8 ? .09 : .24;
        if (outlet.carry < interval) continue;
        outlet.carry %= interval;
        const pulse = Math.max(0, Math.sin(age * 9 + f.id)) ** 6;
        const pressure = (1.8 * Math.exp(-age / 1.4) + pulse * .8 * Math.exp(-age / 5)) * (end ? .55 : 1) * (f.hp > 0 ? 1 : .35);
        const normal = anchor.clone().normalize().applyQuaternion(rotation);
        direction.copy(outlet.velocity).multiplyScalar(.7).addScaledVector(normal, pressure);
        direction.x += (Math.random() - .5) * .18; direction.z += (Math.random() - .5) * .18; direction.y -= .18;
        emit(point, direction, (age < 3 ? .011 : .014) * (.8 + Math.random() * .4), true);
      }
    }
    for (const key of outlets.keys()) if (!active.has(key)) outlets.delete(key);
    particles.forEach((p, i) => {
      if (p.life > 0) {
        const previousY = p.position.y;
        p.life -= dt; p.velocity.y -= 9.81 * dt; p.position.addScaledVector(p.velocity, dt);
        const surface = bloodSurface(arena, previousY, p.position);
        if (surface !== null) {
          if (p.blood) splat(p.position.x, surface, p.position.z, p.size * (2 + Math.random() * 2), p.velocity, arena);
          p.life = 0;
        }
      }
      dummy.position.copy(p.position); dummy.quaternion.setFromUnitVectors(UP, direction.copy(p.velocity).normalize());
      const size = p.life > 0 ? p.size : 0;
      dummy.scale.set(size, size * (p.blood ? 1 + Math.min(3, p.velocity.length() * .5) : 1), size);
      dummy.updateMatrix(); drops.setMatrixAt(i, dummy.matrix);
    });
    marks.forEach((mark, i) => {
      mark.age += dt;
      const size = mark.size * T.MathUtils.clamp((35 - mark.age) / 8, 0, 1);
      dummy.position.set(mark.x, mark.y + .009 + i * .000003, mark.z); dummy.rotation.set(-Math.PI / 2, 0, mark.angle); dummy.scale.set(size * mark.aspect, size, 1);
      dummy.updateMatrix(); stains.setMatrixAt(i, dummy.matrix);
      stains.setColorAt(i, color.copy(freshBlood).lerp(dryBlood, Math.min(1, mark.age / 18)));
    });
    drops.instanceMatrix.needsUpdate = stains.instanceMatrix.needsUpdate = true;
    if (stains.instanceColor) stains.instanceColor.needsUpdate = true;
  }
  function reset() {
    particles.forEach(p => { p.life = 0; }); marks.forEach(mark => { mark.size = 0; }); outlets.clear(); nextDrop = nextStain = 0;
    update(0, [], 0);
  }
  reset();
  return {
    hit, update, reset,
    dispose() { scene.remove(drops, stains); drops.dispose(); stains.dispose(); dropGeometry.dispose(); stainGeometry.dispose(); dropMaterial.dispose(); stainMaterial.dispose(); },
  };
}
