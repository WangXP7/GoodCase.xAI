import { Vector3, type Camera } from 'three';
import type { DuelHit, Fighter } from './physics';

type ScreenRect = { left: number; top: number; right: number; bottom: number };

/** Keep a contact caption nearby, outside silhouettes and inside the HUD margins. */
export function impactPosition(point: { x: number; y: number }, obstacles: ScreenRect[], area: ScreenRect, size: { width: number; height: number }, previous?: { x: number; y: number } | null) {
  const hw = size.width / 2, hh = size.height / 2;
  const xs = [point.x - 90, point.x + 90, point.x - 150, point.x + 150, point.x];
  const ys = [point.y - 28, point.y - 80, point.y + 65, point.y - 130, point.y + 115];
  for (const r of obstacles) { xs.push(r.left - hw - 12, r.right + hw + 12); ys.push(r.top - hh - 12, r.bottom + hh + 12); }
  if (previous) { xs.unshift(previous.x); ys.unshift(previous.y); }
  let best: { x: number; y: number; rect: ScreenRect } | null = null, score = Infinity;
  if (area.right - area.left < size.width || area.bottom - area.top < size.height) return null;
  for (const rawX of xs) for (const rawY of ys) {
    const x = Math.max(area.left + hw, Math.min(area.right - hw, rawX)), y = Math.max(area.top + hh, Math.min(area.bottom - hh, rawY));
    const rect = { left: x - hw, right: x + hw, top: y - hh, bottom: y + hh };
    if (obstacles.some(r => rect.left < r.right + 8 && rect.right > r.left - 8 && rect.top < r.bottom + 8 && rect.bottom > r.top - 8)) continue;
    const distance = (x - point.x) ** 2 + (y - point.y) ** 2;
    if (distance < 72 ** 2) continue;
    const cost = distance + (previous ? 4 * ((x - previous.x) ** 2 + (y - previous.y) ** 2) : 0);
    if (cost >= score) continue;
    best = { x, y, rect }; score = cost;
  }
  // On a very crowded close-up, omit a cosmetic caption instead of covering a fighter.
  return best;
}

export function impactCaption(hit: DuelHit) {
  if (hit.kind === 'floor' || (hit.kind === 'hit' && hit.damage < 2)) return null;
  if (hit.kind === 'block') return { main: hit.counter ? 'Parry!' : 'Clash!', note: hit.counter ? 'counter now' : '', style: 'is-parry' };
  if (hit.kind === 'impale') return { main: 'Impaled!', note: '', style: 'is-heavy' };
  return { main: String(Math.round(hit.damage)), note: hit.kind === 'sever' ? 'severed!' : hit.damage >= 18 ? 'heavy hit' : '', style: hit.kind === 'sever' || hit.damage >= 18 ? 'is-heavy' : '' };
}

/** Training must distinguish an outgoing hit from an actual successful guard. */
export function trainingImpactCaption(hit: DuelHit) {
  if (hit.kind === 'hit' && hit.attacker === 0 && hit.target === 1) return { main: 'Your hit!', note: '', style: 'is-training-hit' };
  if (hit.kind === 'hit' && hit.attacker === 1 && hit.target === 0) return { main: 'Guard here', note: '', style: 'is-training-guard' };
  if (hit.kind === 'block' && hit.counter && hit.target === 0) return { main: 'Parry!', note: '', style: 'is-parry' };
  return null;
}

/** Cosmetic labels use actual contact positions. They never alter damage or network state. */
export function createImpactLabels(host: HTMLElement, camera: Camera) {
  const layer = document.createElement('div'); layer.className = 'impact-label-layer'; layer.setAttribute('aria-hidden', 'true'); host.appendChild(layer);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)');
  const projected = new Vector3(), edge = new Vector3(), right = new Vector3(), position = new Vector3();
  const impaled = new Set<number>();
  const labels = Array.from({ length: 6 }, () => {
    const node = document.createElement('div'), main = document.createElement('strong'), note = document.createElement('small');
    node.className = 'impact-label'; node.hidden = true; node.appendChild(main); node.appendChild(note); layer.appendChild(node);
    return { node, main, note, point: new Vector3(), age: 0, life: 0, target: -1, kind: '' as string, damage: 0, placement: null as { x: number; y: number } | null, measured: null as { width: number; height: number; phone: boolean } | null };
  });
  let next = 0;
  return {
    hit(hit: DuelHit, caption = impactCaption(hit)) {
      if (!caption) return;
      // A fall can contact many spikes/limbs in one physics step. Announce the
      // event once per fighter, instead of plastering the impact with labels.
      if (hit.kind === 'impale') { if (impaled.has(hit.target)) return; impaled.add(hit.target); }
      const nearby = labels.find(l => l.life > 0 && l.target === hit.target && l.kind === hit.kind && l.age < .24);
      if (nearby) {
        if (hit.kind === 'hit' && hit.damage > 0) { nearby.damage += hit.damage; nearby.main.textContent = String(Math.round(nearby.damage)); nearby.measured = null; }
        return;
      }
      const label = labels[next++ % labels.length];
      label.placement = null; label.measured = null; label.target = hit.target; label.kind = hit.kind; label.damage = hit.damage;
      label.point.copy(hit.point); label.main.textContent = caption.main; label.note.textContent = caption.note;
      label.node.className = 'impact-label ' + caption.style; label.age = 0; label.life = caption.style === 'is-heavy' ? 1 : .75;
      label.node.hidden = true;
    },
    update(dt: number, width: number, height: number, fighters: readonly Fighter[] = []) {
      if (!labels.some(label => label.life > 0)) return;
      const occupied: ScreenRect[] = [];
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      for (const fighter of fighters) {
        const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        for (const part of fighter.rig.parts.values()) {
          if (fighter.rig.disabledParts.has(part.name)) continue;
          position.copy(part.body.translation()); projected.copy(position).project(camera);
          if (projected.z < -1 || projected.z > 1) continue;
          const radius = part.shape === 'head' ? .25 : part.shape === 'hand' ? .19 : Math.max(part.radius, part.length / 2, part.name === 'chest' ? .24 : 0);
          edge.copy(position).addScaledVector(right, radius).project(camera);
          const padding = Math.abs(edge.x - projected.x) * width / 2 + 6;
          const x = (projected.x * .5 + .5) * width, y = (-projected.y * .5 + .5) * height;
          box.left = Math.min(box.left, x - padding); box.right = Math.max(box.right, x + padding);
          box.top = Math.min(box.top, y - padding); box.bottom = Math.max(box.bottom, y + padding);
        }
        if (Number.isFinite(box.left)) occupied.push(box);
      }
      const phone = coarse.matches, landscape = width > height;
      const area = { left: 10, right: width - 10, top: phone ? 132 : 105, bottom: height - (phone ? landscape ? 55 : 240 : 65) };
      for (const label of labels) {
        if (!label.life) continue;
        label.age += dt;
        if (label.age >= label.life) { label.life = 0; label.node.hidden = true; continue; }
        projected.copy(label.point).project(camera);
        const visible = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
        label.node.hidden = !visible; if (!visible) continue;
        // Measure only on a new caption or breakpoint change. Short words can
        // use narrow gaps beside a fighter without reserving an empty 100px box.
        if (!label.measured || label.measured.phone !== phone) label.measured = { width: label.node.offsetWidth, height: label.node.offsetHeight, phone };
        const size = { width: label.measured.width + 16, height: label.measured.height + 16 };
        const t = label.age / label.life, rise = reduced.matches ? 0 : t * 18;
        const placement = impactPosition({ x: (projected.x * .5 + .5) * width, y: (-projected.y * .5 + .5) * height - rise }, occupied, area, size, label.placement);
        if (!placement) { label.node.hidden = true; continue; }
        label.placement = placement; occupied.push(placement.rect);
        const x = placement.x - label.measured.width / 2, y = placement.y - label.measured.height / 2;
        label.node.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(-3deg)';
        label.node.style.opacity = String(Math.min(1, (1 - t) * 3));
      }
    },
    reset() { impaled.clear(); for (const label of labels) { label.life = 0; label.node.hidden = true; } },
    dispose() { layer.remove(); },
  };
}
