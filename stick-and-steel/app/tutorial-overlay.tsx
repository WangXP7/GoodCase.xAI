'use client';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TutorialStatus } from '@/lib/duel/tutorial';

const TRAILS = [
  ['M22 58C43 3 140 3 159 58', 'M146 51L161 61L162 43'],
  ['M159 114C135 156 48 153 22 111', 'M21 126L20 109L36 115'],
  ['M143 20C73 12 27 67 33 123', 'M23 111L34 126L43 111'],
  ['M38 125C111 148 162 83 155 26', 'M145 39L154 23L165 37'],
];
/** Alternate curved strokes; button selection stays readable throughout the gesture. */
function Gesture({ guard, touch, held }: { guard: boolean; touch: boolean; held: boolean }) {
  const [direction, setDirection] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setDirection(i => (i + 1) % TRAILS.length), 2400);
    return () => clearInterval(timer);
  }, []);
  return <svg className={'lesson-gesture' + (guard ? ' guard-gesture' : '') + (held ? ' is-held' : '')} viewBox="0 0 180 142" aria-hidden="true">
    {TRAILS.map(([path], i) => <path key={i} className="gesture-track" d={path} fill="none" stroke="currentColor" strokeWidth="1"/>)}
    <g key={direction} data-direction={direction}>
      <path className="gesture-arc" pathLength="1" d={TRAILS[direction][0]} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
      <path className="gesture-arrow" d={TRAILS[direction][1]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </g>
    {touch ? <g className="gesture-touch"><circle cx="92" cy="92" r="24" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="92" cy="92" r="9" fill="currentColor" opacity=".7"/></g> : <g className="gesture-mouse">
      <path className="gesture-button" d={guard ? 'M92 65 Q115 65 115 87 V95 H92Z' : 'M92 65 Q69 65 69 87 V95 H92Z'} fill="currentColor"/>
      <rect x="69" y="65" width="46" height="64" rx="23" fill="none" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M92 66V93M70 95H114" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="89.5" y="75" width="5" height="11" rx="2.5" fill="#efeeeb"/>
    </g>}
  </svg>;
}
function Movement({ touch, progress }: { touch: boolean; progress: number[] }) {
  return <div className="lesson-movement">
    <svg viewBox="0 0 160 136" className="movement-compass" aria-hidden="true">
      <circle cx="80" cy="68" r="31" fill="none" stroke="currentColor" strokeWidth="1" opacity=".18"/>
      {[0, 270, 180, 90].map((angle, i) => <g key={angle} transform={`rotate(${angle} 80 68)`} className={progress[i] >= 1 ? 'move-done' : 'move-direction'} style={{ animationDelay: `${i * .65}s` }}>
        <path d="M80 48V14M69 25L80 13L91 25" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      </g>)}
      {touch && <circle className="movement-dot" cx="80" cy="68" r="11" fill="currentColor" opacity=".65"/>}
      {!touch && <text x="80" y="75" textAnchor="middle" fontSize="21" fill="currentColor">Move</text>}
    </svg>
    {!touch && <div className="movement-keys" aria-label="Move with W A S D">{['W', 'A', 'S', 'D'].map((key, i) => <kbd key={key} className={progress[i] >= 1 ? 'move-done' : ''} style={{ '--progress': progress[i] } as React.CSSProperties}>{key}</kbd>)}</div>}
    {touch && <h1>Move</h1>}
  </div>;
}
export function TutorialOverlay({ status, touch, findMatch, menu }: { status: TutorialStatus; touch: boolean; findMatch: () => void; menu: () => void }) {
  const { step, held } = status;
  const completed = step === 'complete', great = step === 'great', guard = step === 'parry';
  useEffect(() => {
    if (!completed) return;
    const enter = (event: KeyboardEvent) => {
      if (event.code !== 'Enter' || event.repeat || (event.target as HTMLElement).closest('button, [role="dialog"]')) return;
      event.preventDefault(); event.stopPropagation(); findMatch();
    };
    window.addEventListener('keydown', enter, true);
    return () => window.removeEventListener('keydown', enter, true);
  }, [completed, findMatch]);
  return <>
    {!completed && <section className={'tutorial-cue' + (touch ? ' touch-lesson' : '') + (great ? ' lesson-great' : '')} aria-label="Interactive training" data-step={step} data-hits={status.hits} data-practice={status.practiceSwings}>
      {great ? <h1>Great!</h1> : step === 'move' ? <Movement touch={touch} progress={status.movement}/> : <>
        <Gesture guard={guard} touch={touch} held={held}/>
        <h1 aria-live="polite">{guard ? 'Parry' : step === 'hit' ? status.distance > 1.65 ? 'Step closer' : 'Hit the dummy' : touch ? 'Hold + drag' : 'Hold left mouse'}</h1>
        {!guard && <div className="lesson-hit-progress" aria-label={step === 'swing' ? `${status.practiceSwings} of 2 practice swings` : `${status.hits} of 2 strikes`}>{[0, 1].map(i => <i key={i} className={i < (step === 'swing' ? status.practiceSwings : status.hits) ? 'is-done' : ''}/>)}</div>}
      </>}
    </section>}
    {completed && <section className="lesson-complete" aria-label="Training complete" data-step="complete">
      <div className="lesson-finish-card"><Button className="ink-primary" onClick={findMatch}>Find Match {touch ? <ArrowRight size={18}/> : <kbd>↵</kbd>}</Button><button className="lesson-back" onClick={menu}>Back to menu</button></div>
    </section>}
  </>;
}
