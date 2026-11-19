'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Hand, ArrowDownToLine, Shield, Swords } from 'lucide-react';
import type { DuelAPI } from '@/lib/duel/scene';

/** Independent captured pointers allow moving, aiming and interacting together. */
export function CombatControls({ api, lesson }: { api: DuelAPI | null; lesson?: 'move' | 'swing' | 'parry' }) {
  const [guard, setGuard] = useState(false);
  const [stick, setStick] = useState({ x: 0, y: 0 }), [aim, setAim] = useState({ x: 0, y: 0, down: false });
  const movePointer = useRef<number | null>(null), aimPointer = useRef<{ id: number; x: number; y: number } | null>(null);
  useEffect(() => () => { api?.move(0, 0); api?.attack(false); api?.guard(false); api?.interact(false); }, [api]);
  useEffect(() => {
    // Safari can interrupt a held pointer without delivering its final release
    // when browser chrome or the parent iframe changes fullscreen state.
    const cancel = () => {
      movePointer.current = aimPointer.current = null;
      setStick({ x: 0, y: 0 }); setAim({ x: 0, y: 0, down: false }); setGuard(false);
      api?.move(0, 0); api?.attack(false); api?.guard(false); api?.interact(false);
    };
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('webglcontextlost', cancel, true);
    document.addEventListener('fullscreenchange', cancel); document.addEventListener('webkitfullscreenchange', cancel);
    return () => {
      window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('webglcontextlost', cancel, true);
      document.removeEventListener('fullscreenchange', cancel); document.removeEventListener('webkitfullscreenchange', cancel);
    };
  }, [api]);
  const movement = (e: PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), radius = r.width * .34;
    let x = (e.clientX - r.left - r.width / 2) / radius, y = (r.top + r.height / 2 - e.clientY) / radius;
    const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
    setStick({ x: x * radius, y: -y * radius });
    const strength = Math.max(0, (Math.min(1, length) - .12) / .88);
    api?.move(length ? x * strength : 0, length ? y * strength : 0);
  };
  const endMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (movePointer.current !== e.pointerId) return;
    movePointer.current = null; setStick({ x: 0, y: 0 }); api?.move(0, 0);
  };
  const endAim = (e: PointerEvent<HTMLButtonElement>) => {
    if (aimPointer.current?.id !== e.pointerId) return;
    aimPointer.current = null; setAim({ x: 0, y: 0, down: false }); api?.attack(false);
  };
  return <div className="touch-combat-controls" aria-label="Touch combat controls">
    <button className={'touch-stick' + (lesson === 'move' ? ' lesson-highlight' : '')} aria-label="Movement stick" onPointerDown={e => {
      if (movePointer.current !== null) return; e.preventDefault(); movePointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); movement(e);
    }} onPointerMove={e => { if (movePointer.current === e.pointerId) movement(e); }} onPointerUp={endMove} onPointerCancel={endMove} onLostPointerCapture={endMove}>
      <span className="stick-cross" aria-hidden="true">＋</span><span className="stick-knob" style={{ transform: `translate(${stick.x}px, ${stick.y}px)` }} /><small>Move</small>
    </button>
    {lesson !== 'move' && <div className="touch-weapon">
      <div className="touch-tools">
        {lesson !== 'swing' && <button className={lesson === 'parry' ? 'lesson-highlight' : ''} aria-label="Guard mode" aria-pressed={guard} onClick={() => { const v = !guard; setGuard(v); api?.attack(false); api?.guard(v); }}><Shield size={20}/><span>Guard</span></button>}
        {!lesson && <button aria-label="Interact: pick up, stand or climb" onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); api?.interact(true); }} onPointerUp={() => api?.interact(false)} onPointerCancel={() => api?.interact(false)} onLostPointerCapture={() => api?.interact(false)}><Hand size={20}/><span>Interact</span></button>}
        {!lesson && <button aria-label="Drop weapon or let go" onClick={() => { setGuard(false); api?.guard(false); api?.attack(false); api?.drop(); }}><ArrowDownToLine size={20}/><span>Drop</span></button>}
      </div>
      <button className={'touch-swing' + (guard ? ' is-guarding' : '') + (lesson === 'swing' ? ' lesson-highlight' : '')} aria-label={guard ? 'Drag to aim guard' : 'Hold and drag to swing'} onPointerDown={e => {
        if (aimPointer.current) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
        aimPointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; setAim({ x: 0, y: 0, down: true });
        api?.guard(guard); api?.attack(!guard);
      }} onPointerMove={e => {
        const p = aimPointer.current; if (!p || p.id !== e.pointerId) return;
        api?.steer((e.clientX - p.x) * 2.4, (e.clientY - p.y) * 2.4); p.x = e.clientX; p.y = e.clientY;
        const r = e.currentTarget.getBoundingClientRect(); setAim({ x: Math.max(-38, Math.min(38, p.x - r.left - r.width / 2)), y: Math.max(-38, Math.min(38, p.y - r.top - r.height / 2)), down: true });
      }} onPointerUp={endAim} onPointerCancel={endAim} onLostPointerCapture={endAim}>
        {guard ? <Shield size={25}/> : <Swords size={25}/>}<span>{guard ? 'Aim guard' : 'Hold + swing'}</span>
        {aim.down && <i style={{ transform: `translate(${aim.x}px, ${aim.y}px)` }} />}
      </button>
    </div>}
  </div>;
}
