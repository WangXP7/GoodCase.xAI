'use client';

import './duel.css';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Play, RotateCcw, Swords, Settings2, CircleHelp, Users, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DuelAPI, DuelStatus } from '@/lib/duel/scene';
import { WEAPONS, type WeaponKind } from '@/lib/duel/weapons';
import { OFFLINE_STATUS } from '@/lib/duel/network-status';
import { ARENAS, type ArenaKind } from '@/lib/duel/arena';
import { TUTORIAL_STORAGE_KEY } from '@/lib/duel/tutorial';
import { TutorialOverlay } from './tutorial-overlay';
import { CombatControls } from './combat-controls';
import { Leaderboard } from './leaderboard';
import { Armory } from './armory';
import { useArmoryShop } from './use-armory-shop';
import { WeaponTiles } from './weapon-tiles';
import { InkCrown } from './ink-crown';
import { ArenaMark } from './arena-mark';
import { canEquip, getLoadout, loadoutId, loadoutName, type LoadoutId } from '@/lib/duel/armory';

const initial: DuelStatus = { tutorial: null, phase: 'ready', interaction: '', guardDirection: '', network: OFFLINE_STATUS, hp: [100, 100], stamina: [100, 100], stagger: [0, 0], hits: 0, blocks: 0, cuts: 0, states: ['Ready', 'Guarding'], result: '', resultReady: false, winner: null, message: 'Preparing the arena…', slow: false, paused: false, muted: false, practice: false, pointerLocked: false, options: { arena: 'bridge', playerWeapon: 'sword', rivalWeapon: 'sword', spares: true, ledgeDrill: false }, weapons: ['Arming sword · right hand', 'Arming sword · right hand'], grips: [100, 100], disarms: 0 };
const controls = [
  ['W A S D', 'Move & circle'], ['Left mouse + sweep', 'Guide your weapon'], ['Right mouse + drag', 'Aim your guard'],
  ['Space / C', 'Slash / downward chop'], ['Shift', 'Lunge'], ['E / hold E', 'Pick up / stand · climb'], ['F', 'Shove'], ['G', 'Drop weapon · let go'],
  ['Middle drag / wheel', 'Look around / zoom'], ['Esc', 'Menu & release mouse'], ['R', 'Rematch'], ['Q', 'Slow motion (solo)'],
];


export default function Home() {
  const host = useRef<HTMLDivElement>(null), api = useRef<DuelAPI | null>(null);
  const [engine, setEngine] = useState<DuelAPI | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [panel, setPanel] = useState<'menu' | 'controls' | 'leaderboard' | 'armory' | null>(null);
  const [armorySelection, setArmorySelection] = useState<LoadoutId | undefined>();
  const shop = useArmoryShop(), restoredLoadout = useRef(false);
  const [status, setStatus] = useState<DuelStatus>(initial);
  const [touch, setTouch] = useState(false);
  const [sfxVolume, setSfxVolume] = useState(.8), [crowdVolume, setCrowdVolume] = useState(.55);
  const online = status.network.mode !== 'offline', menuOpen = panel !== null || status.paused;
  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => setTouch(media.matches); update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    let cancelled = false, instance: DuelAPI | undefined;
    import('@/lib/duel/scene').then(async ({ createDuel }) => {
      if (cancelled || !host.current) return;
      instance = await createDuel(host.current, s => { if (!cancelled) setStatus(s); });
      if (cancelled) { instance.dispose(); return; }
      api.current = instance; setEngine(instance);
      setReady(true);
    }).catch(e => { if (!cancelled) { console.error(e); setError('The arena could not start. Reload with WebGL enabled.'); } });
    return () => { cancelled = true; instance?.dispose(); api.current = null; };
  }, []);
  useEffect(() => {
    if (!ready || shop.loading || status.tutorial || online || status.phase !== 'ready' || restoredLoadout.current) return;
    restoredLoadout.current = true;
    try { const choice = getLoadout(localStorage.getItem('stick-steel.loadout.v1') ?? 'sword'); if (canEquip(choice.id, shop.owned)) api.current?.configure({ playerWeapon: choice.kind, playerSkin: choice.skin }); } catch { /* A loadout remains selectable without storage. */ }
  }, [ready, shop.loading, shop.owned, status.tutorial, status.phase, online]);
  const equipWeapon = (id: LoadoutId) => {
    if (online || status.tutorial || !canEquip(id, shop.owned)) return;
    restoredLoadout.current = true; const choice = getLoadout(id);
    api.current?.configure({ playerWeapon: choice.kind, playerSkin: choice.skin });
    try { localStorage.setItem('stick-steel.loadout.v1', id); } catch { /* Selection still works for this session. */ }
  };
  const openPanel = (next: 'menu' | 'controls' | 'leaderboard' | 'armory') => { api.current?.setPaused(true); setPanel(next); };
  const closePanel = () => { setPanel(null); api.current?.setPaused(false); };
  const begin = () => { setPanel(null); api.current?.setPaused(false); api.current?.start(); };
  const restart = () => { setPanel(null); api.current?.setPaused(false); api.current?.reset(); };
  const exitTraining = (completed: boolean) => {
    try { localStorage.setItem(TUTORIAL_STORAGE_KEY, completed ? 'complete' : 'skipped'); } catch { /* Training still works without persistence. */ }
    api.current?.exitTutorial();
  };
  const replayTraining = () => { setPanel(null); api.current?.startTutorial(); };
  const findMatch = () => { setPanel(null); if (status.tutorial) exitTraining(true); api.current?.joinOnline(); };
  const playBot = () => { api.current?.leaveOnline(); begin(); };
  const chooseOpponent = () => { setPanel(null); if (online || status.network.fallbackBot) api.current?.leaveOnline(); else if (status.tutorial) exitTraining(false); else api.current?.reset(); };
  const tutorial = status.tutorial;
  const lessonActive = tutorial && ['move', 'swing', 'hit', 'parry'].includes(tutorial.step);
  const playerState = status.states[0];
  const contextualHint = playerState.includes('Falling') || playerState === 'Down' ? '' : playerState.includes('Holding the edge') ? 'Hold E to climb · G to let go'
    : playerState.includes('Knocked down') ? 'Hold E to get back up'
    : status.guardDirection ? status.guardDirection + ' guard · right-drag to change'
    : status.states[1].includes('Holding the edge') ? 'C — chop down at the gripping hand'
    : status.interaction ? status.interaction
    : playerState.includes('Unarmed') || status.weapons[0] === 'Empty hands' ? 'Move closer to a weapon · E to pick it up'
    : playerState.includes('Counter ready') ? 'An opening. Strike now!'
    : status.slow ? 'Quarter speed · Q to return' : '';

  return (
    <main className={"game-shell" + (tutorial ? " is-training" : "") + (status.phase === 'ready' ? " is-idle" : "")}>
      <section className="game-arena" aria-label="Dueling arena">
        <div ref={host} className="game-canvas" />
        <header className="game-hud">
          {[0, 1].map(i => <div key={i} className={'ink-meter side-' + i + (online && status.network.localPlayer === 1 ? ' reversed' : '') + (status.stagger[i] > .25 ? ' is-hit' : '')}>
            <div className="ink-meter-name"><span>{i === 0 ? 'You' : online || status.network.fallbackBot ? status.network.names[i] : status.practice ? 'Practice partner' : 'The challenger'}</span><span className="ink-hp">{status.hp[i]}</span></div>
            <progress className="ink-health" aria-label={i === 0 ? 'Your health' : 'Opponent health'} value={status.hp[i]} max={100} />
            <progress className={'ink-stamina' + (status.stamina[i] < 25 ? ' exhausted' : '')} aria-label={i === 0 ? 'Your stamina' : 'Opponent stamina'} value={status.stamina[i]} max={100} />
            {status.phase === 'fighting' && !['Ready', 'Guarding', 'Striking', 'Recovering'].includes(status.states[i]) && <span className="ink-condition">{status.states[i]}</span>}
          </div>)}
          {(tutorial || status.phase === 'ready') && <div className="game-wordmark">{tutorial ? <><span className="training-title">The Practice Yard</span>{ready && !menuOpen && tutorial.step !== 'complete' && <button className="tutorial-skip" onClick={() => exitTraining(false)}>Skip Tutorial</button>}</> : <ArenaMark arena={status.options.arena}/>}</div>}
        </header>
        {!ready && <div className="game-loading" role={error ? 'alert' : 'status'}><Swords size={28} /><p>{error || 'Setting the stage…'}</p>{error && <Button onClick={() => window.location.reload()}>Reload</Button>}</div>}
        {ready && tutorial && !menuOpen && <TutorialOverlay status={tutorial} touch={touch} findMatch={findMatch} menu={() => exitTraining(true)}/>}
        {ready && !tutorial && !menuOpen && status.phase === 'fighting' && <button className="battle-leaderboard" aria-label="Leaderboard" title="Leaderboard" onClick={() => openPanel('leaderboard')}><InkCrown/></button>}
        {ready && !tutorial && !online && status.phase === 'ready' && !menuOpen && <div className="game-invitation mode-choice">
          <nav className="menu-rail" aria-label="Arena menu"><button onClick={() => openPanel('leaderboard')}><InkCrown/><span>Leaderboard</span></button></nav>
          <h1>Shall we duel?</h1>
          <div className="mode-buttons"><Button className="ink-primary" onClick={findMatch}><Users size={19}/>Online Match</Button><Button className="ink-secondary" onClick={begin}><Bot size={20}/>Play with a Bot</Button></div>
          <WeaponTiles equipped={loadoutId(status.options.playerWeapon, status.options.playerSkin)} shop={shop} select={id => { if (canEquip(id, shop.owned)) equipWeapon(id); else { setArmorySelection(id); openPanel('armory'); } }}/>
          <button className="learn-to-fight" onClick={replayTraining}>Learn to Fight</button>
        </div>}
        {ready && online && status.phase !== 'finished' && ['connecting', 'queue', 'waiting', 'countdown', 'error'].includes(status.network.mode) && !menuOpen && <output className="online-invitation bout-dock">
          <div className="dock-copy"><h1>{status.network.mode === 'countdown' ? 'Duel in ' + status.network.countdown : status.network.mode === 'error' ? 'Connection interrupted' : 'Finding a challenger…'}{status.network.mode !== 'error' && status.network.mode !== 'countdown' && <small>{Math.min(2, status.network.players)} / 2</small>}</h1>
          {status.network.mode === 'error' && <p>{status.network.label}</p>}</div><div className="dock-actions"><Button className="dock-button" onClick={playBot}><Bot size={16}/>Play with a Bot</Button><button className="dock-link" onClick={() => api.current?.leaveOnline()}>Back to menu</button></div>
        </output>}
        {ready && !tutorial && status.phase === 'finished' && status.resultReady && !menuOpen && <div className="game-result bout-dock" aria-live="polite">
          <div className="dock-copy"><h1>{status.winner === 0 ? 'Well struck.' : 'Down to the last line.'}</h1><p>{status.result || 'Bout complete'}</p>
          <p className="bout-tally">{status.hits} {status.hits === 1 ? 'hit' : 'hits'} · {status.blocks} {status.blocks === 1 ? 'clash' : 'clashes'} · {status.cuts} {status.cuts === 1 ? 'cut' : 'cuts'}</p>
          {online && status.network.mode !== 'playing' && <p>{status.network.label}</p>}</div>
          <div className="dock-actions"><Button className="dock-button dock-primary" disabled={online && (status.network.mode !== 'playing' || status.network.label.startsWith('Rematch requested'))} onClick={status.network.fallbackBot ? findMatch : restart}>{status.network.fallbackBot ? <Users size={16}/> : <RotateCcw size={16} />}{status.network.fallbackBot ? 'Online Match' : online ? status.network.label.startsWith('Rematch requested') ? 'Waiting for rival…' : 'Request rematch' : 'One more round'}</Button>
          <div className="dock-links">{online && <button aria-label="Leaderboard" onClick={() => openPanel('leaderboard')}><InkCrown/></button>}<button className="dock-link" onClick={chooseOpponent}>Back to menu</button></div></div>
        </div>}
        {!tutorial && status.phase === 'fighting' && !menuOpen && contextualHint && <output className="game-context">{touch ? contextualHint.replace('Hold E', 'Hold Interact').replace(' · G to let go', '').replace('E — pick up', 'Interact — pick up').replace('E to pick it up', 'Interact to pick it up').replace('G to drop · E to take', 'Drop, then Interact to take').replace('C — chop down at the gripping hand', 'Swing down at the gripping hand').replace('right-drag to change', 'drag the guard pad to change').replace('Q to return', 'Menu to return') : contextualHint}</output>}
        <footer className="game-footer">
          <div className="footer-tools"><button className="game-control-hint" onClick={() => openPanel('controls')} aria-label="Show all controls"><CircleHelp size={17} /><span><b>WASD</b> move <i>·</i> <b>Mouse</b> swing & guard</span></button>{ready && !tutorial && !online && status.phase !== 'ready' && <button className="yard-shortcut" onClick={replayTraining} aria-label="Replay training">Practice yard <ArrowUpRight size={14}/></button>}</div>
          <div className="game-menu-links">
            {!tutorial && status.phase === 'fighting' && !status.pointerLocked && !menuOpen && <button className="mouse-hint" onClick={() => api.current?.captureMouse()}>Click to control</button>}
            <button className="game-menu-button" disabled={!ready} onClick={() => openPanel('menu')} aria-label="Open game menu"><Settings2 size={18}/><span>Menu</span><kbd>Esc</kbd></button>
          </div>
        </footer>
        {ready && status.phase === 'fighting' && !menuOpen && (!tutorial || lessonActive) && <CombatControls key={tutorial?.step === 'move' ? 'move' : tutorial?.step === 'parry' ? 'parry' : tutorial ? 'swing' : 'duel'} api={engine} lesson={tutorial ? tutorial.step === 'move' ? 'move' : tutorial.step === 'parry' ? 'parry' : 'swing' : undefined}/>}

      </section>
      <Dialog open={menuOpen} onOpenChange={open => { if (!open) closePanel(); }}>
        <DialogContent className={"ink-menu" + (panel === 'armory' ? " armory-menu" : "")} finalFocus={false}>
          <DialogTitle>{panel === 'leaderboard' && <InkCrown/>}{panel === 'armory' ? 'Choose your steel.' : panel === 'leaderboard' ? 'The leaderboard.' : panel === 'controls' ? 'Know your moves.' : status.phase === 'fighting' ? 'Take a breath.' : 'Make it your fight.'}</DialogTitle>
          <DialogDescription className="sr-only">{panel === 'armory' ? 'Weapon selection' : panel === 'leaderboard' ? 'Duel standings' : panel === 'controls' ? 'Game controls' : 'Game settings'}</DialogDescription>
          <nav className="ink-menu-tabs" aria-label="Menu sections"><button aria-pressed={panel === 'armory'} onClick={() => setPanel('armory')}>Weapons</button><button aria-pressed={panel === 'menu' || panel === null} onClick={() => setPanel('menu')}>Arena & sound</button><button aria-pressed={panel === 'controls'} onClick={() => setPanel('controls')}>Controls</button><button aria-pressed={panel === 'leaderboard'} onClick={() => setPanel('leaderboard')}>Leaderboard</button></nav>
          {panel === 'armory' ? <Armory equipped={loadoutId(status.options.playerWeapon, status.options.playerSkin)} initialSelection={armorySelection} locked={online || !!tutorial} shop={shop} equip={equipWeapon}/> : panel === 'leaderboard' ? <Leaderboard/> : panel === 'controls' ? <div className="ink-controls-list">{controls.map(([key, label]) => <div key={key}><kbd>{key}</kbd><span>{label}</span></div>)}<p className="touch-help">Touch: use the left stick to move. Hold and drag the right pad to swing. Tap Guard to keep your guard up; drag the pad to aim it. Tap Guard again to attack. Two fingers on the arena look and zoom. Hold Interact to pick up, stand or climb. Drag down to strike low. Drop releases your weapon or lets go of the ledge.</p></div> : <>
            <div className="ink-setup">
              <span id="arena-label">Arena</span><Select value={status.options.arena} onValueChange={v => { if (v) api.current?.configure({ arena: v as ArenaKind }); }} disabled={!ready || online || !!tutorial}><SelectTrigger aria-labelledby="arena-label"><SelectValue>{ARENAS[status.options.arena].name}</SelectValue></SelectTrigger><SelectContent className="ink-select">{Object.values(ARENAS).map(a => <SelectItem key={a.kind} value={a.kind}>{a.name}</SelectItem>)}</SelectContent></Select>
              <div className="ink-field"><span>Your weapon</span><button className="ink-loadout-link setup-weapon-link" onClick={() => setPanel('armory')}>{loadoutName(status.options.playerWeapon, status.options.playerSkin)}<ArrowUpRight size={16}/></button></div>
              <div className="ink-field"><span id="rivalWeapon-label">Rival weapon</span><Select value={status.options.rivalWeapon} onValueChange={v => { if (v) api.current?.configure({ rivalWeapon: v as WeaponKind, rivalSkin: null }); }} disabled={!ready || online || !!tutorial}><SelectTrigger aria-labelledby="rivalWeapon-label"><SelectValue>{WEAPONS[status.options.rivalWeapon].name}</SelectValue></SelectTrigger><SelectContent className="ink-select">{Object.values(WEAPONS).map(w => <SelectItem key={w.kind} value={w.kind}>{w.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            {online && <p className="ink-menu-note">Loadouts locked during battle.</p>}
            <div className="ink-mode-row"><ToggleGroup value={[status.practice ? 'practice' : 'duel']} onValueChange={v => { if (v[0]) api.current?.setPractice(v[0] === 'practice'); }} disabled={!ready || online || !!tutorial} aria-label="Game mode"><ToggleGroupItem value="duel">Duel</ToggleGroupItem><ToggleGroupItem value="practice">Practice</ToggleGroupItem></ToggleGroup><Button variant="ghost" disabled={!ready || online || !!tutorial} onClick={() => api.current?.ledgeDrill()}>Ledge drill ↗</Button></div>
            <div className="ink-audio">{([['Effects', sfxVolume, setSfxVolume, 'effects'], ['Crowd', crowdVolume, setCrowdVolume, 'crowd']] as const).map(([label, value, setter, channel]) => <label key={channel}><span>{label}</span><input type="range" min="0" max="100" value={Math.round(value * 100)} aria-label={label + ' volume'} onChange={e => { const next = Number(e.target.value) / 100; setter(next); api.current?.setVolume(channel, next); }} /><output>{Math.round(value * 100)}%</output></label>)}</div>
            <div className="ink-extras">{!online && <button onClick={replayTraining}>Replay training</button>}<button onClick={() => api.current?.setMuted(!status.muted)}>{status.muted ? 'Unmute all sounds' : 'Mute all sounds'}</button><button disabled={online} aria-pressed={status.slow} onClick={() => api.current?.setSlow(!status.slow)}>{status.slow ? 'Normal speed' : 'Slow motion'}</button><Link href="/lab">Rig lab <ArrowUpRight size={14}/></Link></div>
          </>}
          <div className="ink-menu-actions"><Button className="ink-primary" disabled={!ready} onClick={panel === 'leaderboard' && !online && status.phase !== 'fighting' ? chooseOpponent : closePanel}><Play size={16}/>{panel === 'leaderboard' ? online || status.phase === 'fighting' ? 'Back to battle' : 'Start battle' : panel === 'armory' ? 'Back to menu' : tutorial ? 'Back to training' : status.phase === 'ready' && !online ? 'Start battle' : 'Back to the arena'}</Button>{panel !== 'leaderboard' && tutorial && <Button variant="ghost" onClick={() => { setPanel(null); api.current?.retryTutorial(); }}>Reset positions</Button>}{panel !== 'leaderboard' && (online || status.phase !== 'ready' || tutorial) && <Button variant="ghost" disabled={!ready} onClick={chooseOpponent}><Users size={16}/>{online ? 'Leave online' : tutorial ? 'Skip training' : 'Back to menu'}</Button>}</div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
