'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Circle, Crosshair, Hand, MoveUpRight, Orbit, Pause, Play, RotateCcw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Mode, PlaygroundAPI, PlaygroundStatus } from '@/lib/rig/scene';
import type { PoseName } from '@/lib/rig/physics';

export default function Home() {
  const stage = useRef<HTMLDivElement>(null), api = useRef<PlaygroundAPI | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('throw'), [pose, setPose] = useState<PoseName>('ready');
  const [strength, setStrength] = useState(62), [power, setPower] = useState(11);
  const [slow, setSlow] = useState(false), [paused, setPaused] = useState(false), [ragdoll, setRagdoll] = useState(false), [hint, setHint] = useState(true);
  const [status, setStatus] = useState<PlaygroundStatus>({ hits: 0, balls: 3, message: 'Preparing the playground…', catchPhase: 'idle' });
  const handlingBall = ['reaching', 'incoming', 'holding', 'windup', 'throwing'].includes(status.catchPhase);
  const catchStep = { idle: -1, reaching: 0, incoming: 1, holding: 2, windup: 3, throwing: 3, released: 3, missed: -1 }[status.catchPhase];
  useEffect(() => {
    let cancelled = false, instance: PlaygroundAPI | undefined;
    import('@/lib/rig/scene').then(async ({ createPlayground }) => {
      if (cancelled || !stage.current) return;
      instance = await createPlayground(stage.current, value => { if (!cancelled) setStatus(value); });
      if (cancelled) { instance.dispose(); return; }
      api.current = instance; setReady(true);
    }).catch(e => { if (!cancelled) { console.error(e); setError('The 3D playground could not start. Please reload in a browser with WebGL enabled.'); } });
    return () => { cancelled = true; instance?.dispose(); api.current = null; };
  }, []);
  const reset = () => { api.current?.reset(); api.current?.setPaused(false); setRagdoll(false); setPose('ready'); setPaused(false); };
  return (
    <main className="lab-shell">
      <header className="lab-header">
        <Link className="wordmark" href="/" aria-label="Stick Lab home"><span className="brand-icon"><Orbit size={22} strokeWidth={1.7} /></span>STICK<span className="wordmark-light">LAB</span><span className="version">MVP 01</span></Link>
        <div className="header-right"><span className="live-dot" />Physics playground<span className="header-divider" /><span className="header-note">Small rig. Real reactions.</span></div>
      </header>
      <div className="lab-workspace">
        <aside className="control-panel">
          <div className="panel-intro"><span className="eyebrow">YOUR TEST SUBJECT</span><h1>Make it move<span>.</span></h1><p>Throw a ball. Move a hand.<br />See how the whole body responds.</p></div>
          <section className="control-section">
            <div className="section-heading"><span>Interaction</span><span className="section-number">01</span></div>
            <ToggleGroup className="mode-picker" value={[mode]} onValueChange={v => { if (v[0]) { const m = v[0] as Mode; setMode(m); api.current?.setMode(m); } }} disabled={!ready} aria-label="Interaction mode">
              <ToggleGroupItem value="throw" aria-label="Throw balls"><Crosshair />Throw</ToggleGroupItem>
              <ToggleGroupItem value="pose" aria-label="Move IK targets"><Hand />Pose</ToggleGroupItem>
              <ToggleGroupItem value="view" aria-label="Orbit camera"><Orbit />View</ToggleGroupItem>
            </ToggleGroup>
            <p className="control-help">{mode === 'throw' ? 'Click anywhere on the character to launch a ball at that spot.' : mode === 'pose' ? 'Drag the blue rings to move hands and plant feet. Reach is limited by the limbs.' : 'Drag to rotate around the character. Scroll or pinch to move closer.'}</p>
          </section>
          <section className="control-section">
            <div className="section-heading"><span>Starting pose</span><span className="section-number">02</span></div>
            <ToggleGroup className="pose-picker" value={[pose]} onValueChange={v => { if (v[0]) { const p = v[0] as PoseName; setPose(p); api.current?.setPose(p); } }} disabled={!ready || ragdoll} aria-label="Starting pose">
              <ToggleGroupItem value="ready">Ready</ToggleGroupItem><ToggleGroupItem value="guard">Guard</ToggleGroupItem><ToggleGroupItem value="reach">Reach</ToggleGroupItem>
            </ToggleGroup>
          </section>
          <section className="control-section catch-section">
            <div className="section-heading"><span>Catch & throw</span><span className="section-number">03</span></div>
            <div className="catch-actions">
              <Button className="impact-button" disabled={!ready || paused || ragdoll || handlingBall} onClick={() => { api.current?.catchPass(); setPose('ready'); setHint(false); }}><Hand size={17} />Catch a pass</Button>
              <Button className="rain-button" variant="outline" disabled={!ready || paused || ragdoll || status.catchPhase !== 'holding'} onClick={() => api.current?.throwHeld()}><MoveUpRight size={17} />Throw held ball</Button>
            </div>
            <p className="control-help">Catch a pass, inspect the grip, then throw. Try slow motion to watch the fingers close.</p>
            <div className="catch-progress" aria-label={`Ball handling: ${status.catchPhase}`}>
              {['Reach', 'Catch', 'Hold', 'Throw'].map((label, i) => <span key={label} className={catchStep === i ? 'active' : ''}>{label}</span>)}
            </div>
          </section>
          <section className="control-section dynamics-section">
            <div className="section-heading"><span>Feel & physics</span><span className="section-number">04</span></div>
            <div className="range-label"><span id="strength-label">Muscle strength</span><output>{strength}%</output></div>
            <Slider aria-labelledby="strength-label" value={[strength]} min={5} max={100} step={1} disabled={!ready || ragdoll} onValueChange={v => { const n = Array.isArray(v) ? v[0] : v; setStrength(n); api.current?.setStrength(n / 100); }} />
            <div className="range-extremes"><span>Loose</span><span>Firm</span></div>
            <div className="range-label power-label"><span id="power-label">Throw power</span><output>{power < 9 ? 'Gentle' : power > 14 ? 'Heavy' : 'Medium'}</output></div>
            <Slider aria-labelledby="power-label" value={[power]} min={6} max={18} step={1} disabled={!ready} onValueChange={v => { const n = Array.isArray(v) ? v[0] : v; setPower(n); api.current?.setPower(n); }} />
            <div className="switch-row"><label htmlFor="slow-motion">Slow motion<span>See every contact · ¼ speed</span></label><Switch aria-label="Slow motion" id="slow-motion" checked={slow} disabled={!ready} onCheckedChange={v => { setSlow(v); api.current?.setSlow(v); }} /></div>
            <div className="switch-row"><label htmlFor="ragdoll">Ragdoll<span>Release all muscles & balance</span></label><Switch aria-label="Ragdoll" id="ragdoll" checked={ragdoll} disabled={!ready} onCheckedChange={v => { setRagdoll(v); api.current?.setRagdoll(v); }} /></div>
          </section>
          <div className="test-actions">
            <Button className="impact-button" disabled={!ready || paused} onClick={() => api.current?.hitArm()}><Crosshair size={17} />Test arm impact<ArrowUpRight size={17} /></Button>
            <Button className="rain-button" variant="outline" disabled={!ready || paused} onClick={() => api.current?.dropBalls()}><Circle size={15} />Drop a few balls</Button>
          </div>
          <div className="balance-note"><span className="small-status-dot" /><div>Assisted balance<p>IK sets the pose. Physical joints yield to impacts and recover.</p></div></div>
        </aside>
        <section className="stage-wrap" aria-label="Physics playground">
          <div className="scene-topline"><div><span className="court-mark">01</span><span>TEST COURT</span></div><span className={`simulation-state ${ragdoll ? 'is-ragdoll' : ''}`}><span />{paused ? 'PAUSED' : ragdoll ? 'RAGDOLL' : 'LIVE SIMULATION'}</span></div>
          <div className="three-stage" ref={stage} />
          {!ready && <div className="loading-state" role={error ? 'alert' : 'status'}>{error ? <><p>{error}</p><Button onClick={() => window.location.reload()}>Reload playground</Button></> : <><Orbit className="loading-orbit" /><p>Waking up your stick figure…</p></>}</div>}
          {ready && hint && <div className="first-hint"><div className="hint-icon"><MoveUpRight size={19} /></div><div><strong>Start with an arm.</strong><p>Click it, or use “Test arm impact”.</p></div><button aria-label="Dismiss tip" onClick={() => setHint(false)}><X size={15} /></button></div>}
          <div className="scene-bottomline">
            <div className="scene-readout"><span className="readout-label">BALLS</span><strong>{String(status.balls).padStart(2, '0')}</strong><span className="readout-divider" /><span className="readout-label">CONTACTS</span><strong>{String(status.hits).padStart(2, '0')}</strong></div>
            <div className="playback"><span className="playback-speed">{slow ? '0.25' : '1.0'}×</span><Button variant="ghost" size="icon" disabled={!ready} aria-label={paused ? 'Resume simulation' : 'Pause simulation'} onClick={() => { setPaused(!paused); api.current?.setPaused(!paused); }}>{paused ? <Play size={17} /> : <Pause size={17} />}</Button><Button variant="ghost" size="icon" disabled={!ready} aria-label="Reset playground" onClick={reset}><RotateCcw size={17} /></Button></div>
          </div>
          <div className="status-line" aria-live="polite"><Sparkles size={13} /><span>{status.message}</span><span className="orbit-tip">Right-drag to orbit · scroll to zoom</span></div>
        </section>
      </div>
    </main>
  );
}
