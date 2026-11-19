'use client';
import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function WeaponPreview({ asset, name }: { asset: string; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (!host.current) return;
    const parent = host.current;
    let disposed = false, frame = 0, dragging = false, pointer = -1, lastX = 0, yaw = -.3;
    setState('loading');
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6)); renderer.setClearColor(0, 0);
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    const canvas = renderer.domElement; parent.appendChild(canvas);
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, 1, .01, 15), pivot = new T.Group(); scene.add(pivot);
    const room = new RoomEnvironment(), generator = new T.PMREMGenerator(renderer), env = generator.fromScene(room, .04); room.dispose(); generator.dispose(); scene.environment = env.texture;
    scene.add(new T.HemisphereLight('#ffffff', '#807564', 2.1));
    const light = new T.DirectionalLight('#fff4df', 3.4); light.position.set(-2, 4, 5); scene.add(light);
    let model: T.Group | null = null, length = 1.5;
    const cleanModel = (group: T.Group) => {
      const textures = new Set<T.Texture>(), materials = new Set<T.Material>(), geometries = new Set<T.BufferGeometry>();
      group.traverse(o => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { materials.add(m); for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v); } } });
      textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
    };
    const resize = () => {
      const width = parent.clientWidth, height = parent.clientHeight; if (!width || !height) return;
      renderer.setSize(width, height); camera.aspect = width / height;
      camera.position.set(0, 0, length / (2 * Math.tan(T.MathUtils.degToRad(16))) * 1.23); camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(parent); resize();
    void new GLTFLoader().loadAsync(asset).then(gltf => {
      if (disposed) { cleanModel(gltf.scene); return; }
      model = gltf.scene;
      model.traverse(o => { if (o instanceof T.Mesh) { if (!o.geometry.getAttribute('normal')) o.geometry.computeVertexNormals(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m instanceof T.MeshStandardMaterial) m.envMapIntensity = .85; } });
      const box = new T.Box3().setFromObject(model), center = box.getCenter(new T.Vector3());
      length = box.getSize(new T.Vector3()).y; model.position.sub(center); pivot.add(model); pivot.rotation.z = -.15; resize(); setState('ready');
    }).catch(() => { if (!disposed) setState('error'); });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let previous = 0;
    const draw = (now: number) => { frame = requestAnimationFrame(draw); if (!dragging && !reduced && previous) yaw += Math.min(.04, (now - previous) / 1000) * .14; previous = now; pivot.rotation.y = yaw; renderer.render(scene, camera); }; frame = requestAnimationFrame(draw);
    const down = (e: PointerEvent) => { if (pointer !== -1) return; pointer = e.pointerId; dragging = true; lastX = e.clientX; canvas.setPointerCapture(pointer); };
    const move = (e: PointerEvent) => { if (pointer !== e.pointerId) return; yaw += (e.clientX - lastX) * .012; lastX = e.clientX; };
    const up = (e: PointerEvent) => { if (pointer !== e.pointerId) return; if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer); pointer = -1; dragging = false; };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('lostpointercapture', up);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); if (model) cleanModel(model); env.dispose(); renderer.dispose(); canvas.remove(); };
  }, [asset]);
  return <figure className="weapon-preview" ref={host} aria-label={name + ', rotating 3D preview'}>{state !== 'ready' && <span>{state === 'error' ? 'Preview unavailable' : 'Setting it on the rack…'}</span>}<small>Drag to turn</small></figure>;
}
