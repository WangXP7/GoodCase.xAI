'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, LockKeyhole } from 'lucide-react';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LOADOUTS, type LoadoutId } from '@/lib/duel/armory';
import type { ArmoryShop } from './use-armory-shop';

/** Four live views share one renderer and environment, including on phones. */
export function WeaponTiles({ equipped, shop, select }: { equipped: LoadoutId; shop: ArmoryShop; select: (id: LoadoutId) => void }) {
  const host = useRef<HTMLFieldSetElement>(null), [loaded, setLoaded] = useState<string[]>([]);
  useEffect(() => {
    const parent = host.current; if (!parent) return;
    let disposed = false, frame = 0, last = 0, angle = -.4;
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.setClearColor(0, 0);
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    const canvas = renderer.domElement; canvas.setAttribute('aria-hidden', 'true'); parent.appendChild(canvas);
    const room = new RoomEnvironment(), pmrem = new T.PMREMGenerator(renderer), environment = pmrem.fromScene(room, .04); room.dispose(); pmrem.dispose();
    const views = LOADOUTS.map(() => {
      const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, 1, .01, 20), pivot = new T.Group();
      scene.environment = environment.texture; scene.add(pivot, new T.HemisphereLight('#fff', '#807564', 2.1));
      const light = new T.DirectionalLight('#fff4df', 3.4); light.position.set(-2, 4, 5); scene.add(light);
      return { scene, camera, pivot, model: null as T.Group | null };
    });
    const clean = (model: T.Group) => {
      const textures = new Set<T.Texture>(), materials = new Set<T.Material>(), geometries = new Set<T.BufferGeometry>();
      model.traverse(o => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { materials.add(m); for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v); } } });
      textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
    };
    const loader = new GLTFLoader();
    LOADOUTS.forEach((weapon, i) => { void loader.loadAsync(weapon.asset).then(gltf => {
      if (disposed) { clean(gltf.scene); return; }
      const model = gltf.scene, box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3());
      model.position.sub(box.getCenter(new T.Vector3())); views[i].model = model; views[i].pivot.add(model); views[i].pivot.rotation.z = -.2;
      views[i].camera.position.z = Math.max(size.y, size.x) / (2 * Math.tan(T.MathUtils.degToRad(16))) * 1.1;
      setLoaded(old => [...old, weapon.id]);
    }).catch(() => { /* The labeled tile stays usable if its preview cannot load. */ }); });
    const resize = () => renderer.setSize(parent.clientWidth, parent.clientHeight);
    const observer = new ResizeObserver(resize); observer.observe(parent); resize();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (document.hidden || now - last < 33) return;
      if (!reduced) angle += Math.min(.06, (now - (last || now)) / 1000) * .3;
      last = now;
      const bounds = parent.getBoundingClientRect();
      renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
      parent.querySelectorAll<HTMLElement>('.tile-preview-window').forEach((art, i) => {
        const rect = art.getBoundingClientRect(), x = rect.left - bounds.left, y = bounds.bottom - rect.bottom;
        if (!rect.width || !rect.height) return;
        const view = views[i]; view.pivot.rotation.y = angle + i * .32; view.camera.aspect = rect.width / rect.height; view.camera.updateProjectionMatrix();
        renderer.setViewport(x, y, rect.width, rect.height); renderer.setScissor(x, y, rect.width, rect.height); renderer.render(view.scene, view.camera);
      });
    };
    frame = requestAnimationFrame(draw);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); views.forEach(v => { if (v.model) clean(v.model); }); environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); };
  }, []);
  return <fieldset className="weapon-tiles" ref={host} aria-label="Choose your weapon">{LOADOUTS.map(w => <button key={w.id} className={'weapon-tile' + (w.id === 'ravenblade' ? ' premium-tile' : '')} aria-label={w.name} aria-pressed={equipped === w.id} onClick={() => select(w.id)}>
    <span className="tile-art"><span className="tile-preview-window"/>{!loaded.includes(w.id) && <span className="tile-loading">· · ·</span>}{equipped === w.id ? <Check className="tile-mark" size={14}/> : w.id === 'ravenblade' && !shop.owned ? <LockKeyhole className="tile-mark" size={13}/> : null}
    <span className="tile-name">{w.name}</span>{w.id === 'ravenblade' && !shop.owned && shop.item && <small className="tile-price">{shop.item.priceCoins} coins</small>}</span>
  </button>)}</fieldset>;
}
