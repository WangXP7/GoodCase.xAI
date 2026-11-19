import type { Matchmaking, Session } from '@genex-ai/multiplayer';
import { STEP, type DuelSimulation, type DuelOptions, type DuelHit } from './physics';
import { SNAPSHOT_IDS, fighterSnapshot, weaponSnapshot, applyFighterSnapshot, applyWeaponSnapshot, packInput, validInput, hitToWire, hitFromWire, type Action, type WireState } from './net-state';
import { safeSkin, type WeaponKind, type WeaponSkin } from './weapons';
import type { OnlineResult } from './records';
import { randomRivalName } from './arena-rivals';

export type Profile = { weapon: WeaponKind; skin?: WeaponSkin | null; arena: 'yard' | 'bridge'; ready: boolean; focused: boolean };
type Room = Session<Profile>;
type Round = { epoch: string; owner: string; roster: string[]; options: DuelOptions; deadline: number; rematch: string[] };
import { OFFLINE_STATUS, type NetworkStatus } from './network-status';
export { OFFLINE_STATUS, type NetworkStatus } from './network-status';
const weaponKinds = new Set(['sword', 'mace', 'greatsword']);
const safeWeapon = (value: unknown): WeaponKind => weaponKinds.has(String(value)) ? value as WeaponKind : 'sword';
export const BOT_WAIT_MS = 5_000;

/**
 * Net model: matchmake/open, two seats, host-authoritative contested Rapier world.
 * Start: two connected ready players + 3 seconds. No mid-bout entrants. Below quorum:
 * freeze through reconnect grace; refill a vacated seat and start a fresh bout. Host migration
 * starts a new epoch/bout (never silently adopts incomplete ragdoll constraints).
 * Non-hosts render SDK-smoothed object transforms exactly once; no predictive physics world.
 */
export function createDuelNetwork(sim: DuelSimulation, hooks: {
  reset(options: Partial<DuelOptions>): void;
  hit(hit: DuelHit): void;
  changed(): void;
  finished?(result: OnlineResult): void;
  join?: () => Promise<Matchmaking<Profile>>;
  focused?: () => boolean;
  canStartBot?: () => boolean;
  now?: () => number;
}) {
  let info = { ...OFFLINE_STATUS }, matchmaking: Matchmaking<Profile> | null = null, room: Room | null = null;
  let roundCache: Round | undefined, roomOpen: boolean | undefined;
  let disposed = false, generation = 0, active = false, hostReady = false, claiming = false, lease = '', epoch = '', accumulator = 0;
  let pendingActions: Action[] = [], choice: Profile, lastProfileAt = 0, lastPublishAt = 0, inputSequence = 0, error = '', transport = true;
  let stopRoom: (() => void)[] = [], stopQueue: (() => void)[] = [];
  const sequences = new Map<string, number>(), heardAt = new Map<string, number>();
  const hitJournal: { id: number; hit: ReturnType<typeof hitToWire> }[] = [];
  let hitSequence = 0, seenHit = 0;
  let soloSince: number | null = null, lastSearchTick = 0, hadHumanRound = false;
  let queueSoloSince: number | null = null, lastQueueAt = 0;
  const clock = hooks.now ?? (() => performance.now());
  const reportedRounds = new Set<string>();
  const published = new Map<string, { json: string; at: number }>();
  const focused = hooks.focused ?? (() => typeof document === 'undefined' || !document.hidden);
  const setInfo = (next: Partial<NetworkStatus>) => { const value = { ...info, ...next }; if (JSON.stringify(value) === JSON.stringify(info)) return; info = value; hooks.changed(); };
  const currentRound = () => room?.isHost && roundCache?.owner === room.id ? roundCache : room?.shared.get('bout') as Round | undefined;
  function writeRound(round: Round) { roundCache = round; room?.shared.set('bout', round); }
  function setOpen(open: boolean) { if (roomOpen !== open) { room?.setRoomOpen(open); roomOpen = open; } }
  function sendProfile() { if (room) room.me.set({ ...choice, focused: focused() }); }
  function canFight() {
    const round = currentRound();
    return !!room && transport && !!round && round.roster.length === 2 && round.roster.every(id => {
      const p = room!.activePlayers.get(id); return p?.stateRaw.ready === true && p.stateRaw.focused !== false;
    });
  }
  function publish(snap = false) {
    if (!room?.isHost || !hostReady || !SNAPSHOT_IDS.every(id => room!.objects.get(id)?.isMine)) return;
    const write = (id: string, value: WireState) => {
      value.epoch = epoch; const json = JSON.stringify(value), now = performance.now(), previous = published.get(id);
      if (!snap && previous?.json === json && now - previous.at < 500) return;
      published.set(id, { json, at: now });
      if (snap) room!.objects.snap(id, value); else room!.objects.set(id, value);
    };
    sim.fighters.forEach((f, i) => write(SNAPSHOT_IDS[i], fighterSnapshot(f)));
    write('weapons', { ...weaponSnapshot(sim), impacts: hitJournal }); lastPublishAt = performance.now();
  }
  function reportResult() {
    const round = currentRound();
    if (!room || !epoch || round?.epoch !== epoch || !round.roster.includes(room.id) || sim.phase !== 'finished' || sim.endedAt === null || (sim.winner !== 0 && sim.winner !== 1) || reportedRounds.has(epoch)) return;
    reportedRounds.add(epoch);
    hooks.finished?.({ roundId: epoch, won: round.roster[sim.winner] === room.id });
  }
  function startRound(roster: string[]) {
    if (!room?.isHost || !hostReady || roster.length !== 2) return;
    hadHumanRound = true;
    const old = currentRound();
    const arena = old?.options.arena ?? (choice.arena === 'yard' ? 'yard' : 'bridge');
    const round: Round = { epoch: `${room.id}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, owner: room.id, roster,
      options: { arena, playerWeapon: safeWeapon(room.players.get(roster[0])?.stateRaw.weapon), rivalWeapon: safeWeapon(room.players.get(roster[1])?.stateRaw.weapon), playerSkin: safeSkin(safeWeapon(room.players.get(roster[0])?.stateRaw.weapon), room.players.get(roster[0])?.stateRaw.skin) ?? null, rivalSkin: safeSkin(safeWeapon(room.players.get(roster[1])?.stateRaw.weapon), room.players.get(roster[1])?.stateRaw.skin) ?? null, spares: true, ledgeDrill: false },
      deadline: Date.now() + 3000, rematch: [] };
    epoch = round.epoch; accumulator = 0; published.clear(); sequences.clear(); heardAt.clear(); hitJournal.length = 0; seenHit = hitSequence = 0; pendingActions = [];
    sim.localPlayerId = roster.indexOf(room.id); sim.practice = false; hooks.reset(round.options);
    writeRound(round); setOpen(false); publish(true);
  }
  async function ensureHost() {
    const live = room; if (!live?.isHost || claiming || (hostReady && lease === live.host)) return;
    claiming = true; hostReady = false; lease = live.host ?? '';
    try {
      for (const id of SNAPSHOT_IDS) {
        const result = await live.objects.claimConfirmed(id, { authority: 'host' });
        if (!result.accepted) throw new Error(`Physics ownership unavailable (${result.reason}). Leave and retry.`);
        if (room !== live || !live.isHost || disposed || !active) return;
      }
      hostReady = true;
    } catch (e) { error = e instanceof Error ? e.message : 'Could not start shared physics.'; }
    finally { claiming = false; }
  }
  function acceptInput(from: string, value: unknown) {
    if (!room?.isHost || !hostReady || !room.activePlayers.has(from)) return;
    const round = currentRound(), id = round?.roster.indexOf(from) ?? -1;
    if (id < 0 || !validInput(value, epoch, sequences.get(from) ?? -1)) return;
    sequences.set(from, value.seq); heardAt.set(from, performance.now());
    sim.inputs[id].move.fromArray(value.move).clampLength(0, 1); sim.inputs[id].aim.fromArray(value.aim).clampScalar(-1, 1);
    sim.inputs[id].attack = value.attack; sim.inputs[id].guard = value.guard; sim.inputs[id].interact = value.interact;
    for (const action of value.actions) {
      if (action === 'rematch') {
        if (sim.phase === 'finished' && round && !round.rematch.includes(from)) writeRound({ ...round, rematch: [...round.rematch, from] });
      } else if (sim.phase === 'fighting' && canFight()) sim[action](id);
    }
    if (sim.phase !== 'fighting' || !canFight()) { sim.clearInput(id); return; }

  }
  function hostTick(dtMs: number) {
    if (!active || !room?.isHost || !hostReady || error || !canFight() || currentRound()?.epoch !== epoch) { accumulator = 0; return; }
    if (!SNAPSHOT_IDS.every(id => room!.objects.get(id)?.isMine)) { hostReady = false; return; }
    const round = currentRound()!;
    if (Date.now() < round.deadline) return;
    if (sim.phase === 'ready') sim.start();
    const now = performance.now();
    for (const [id, side] of round.roster.map((id, i) => [id, i] as const)) if (id !== room.id && now - (heardAt.get(id) ?? 0) > 300) sim.clearInput(side);
    if (sim.phase !== 'finished' || sim.endedAt === null || sim.time - sim.endedAt < 3) {
      accumulator += Math.min(.07, dtMs / 1000); let steps = 0;
      while (accumulator >= STEP && steps++ < 8) { sim.step(); accumulator -= STEP; }
    }
    if (now - lastPublishAt >= 48) { publish(); reportResult(); }
  }
  function bind(next: Room | null) {
    soloSince = queueSoloSince = null;
    stopRoom.forEach(stop => stop()); stopRoom = []; room = next; roundCache = undefined; roomOpen = undefined; hostReady = false; claiming = false; lease = ''; epoch = ''; transport = true;
    if (!room) return;
    sendProfile(); lastProfileAt = performance.now();
    stopRoom.push(room.inputs.on(acceptInput), room.onHostTick(60, hostTick));
    stopRoom.push(room.on('host', () => { hostReady = false; lease = ''; roundCache = undefined; }),
      room.on('reconnecting', () => { transport = false; sim.clearInput(); }),
      room.on('reconnected', () => { transport = true; sendProfile(); }),
      room.on('disconnect', code => { transport = false; if (code === 4409) error = 'This game was opened in another tab or device.'; else error = 'Connection ended. Leave and find a new duel.'; }),
      room.on('rate:drop', () => { error = 'Connection limit reached. Leave and retry the duel.'; }));
  }
  function refresh() {
    if (!active || disposed) return;
    if (matchmaking?.session !== room) bind(matchmaking?.session ?? null);
    if (error) { soloSince = null; setInfo({ mode: 'error', label: error, botIn: null }); return; }
    if (!room) { soloSince = null; if (matchmaking) setInfo({ mode: 'queue', label: 'Finding a challenger…', players: 1, botIn: null }); return; }
    const now = performance.now();
    if (now - lastProfileAt > 450) { sendProfile(); lastProfileAt = now; }
    if (room.isHost) {
      void ensureHost();
      if (hostReady) {
        const ids = [...room.players.keys()];
        const round = currentRound();
        if (ids.length < 2) setOpen(true);
        if (ids.length === 2 && [...room.activePlayers.values()].length === 2 && [...room.players.values()].every(p => p.stateRaw.ready)) {
          if (!round || round.owner !== room.id || round.roster.some(id => !ids.includes(id)) || round.rematch.length === 2) {
            const roster = round?.roster.filter(id => ids.includes(id)) ?? [];
            startRound([...roster, ...ids.filter(id => !roster.includes(id))]);
          }
        }
      }
    }
    const round = currentRound();
    if (round?.roster.includes(room.id)) hadHumanRound = true;
    // Only a healthy, actually seated solo lobby can time out. Count ALL seats,
    // including a peer still loading or reconnecting, before considering the bot.
    // This runs after human-round setup, so an arrival on the deadline wins.
    const searchNow = clock();
    const solo = !hadHumanRound && !round && hostReady && room.isHost && transport && focused() && (hooks.canStartBot?.() ?? true)
      && room.players.size === 1 && room.players.has(room.id) && room.activePlayers.has(room.id);
    // Don't turn returning from a backgrounded/throttled tab into an instant fight.
    if (!solo || searchNow - lastSearchTick > 1000) soloSince = null;
    lastSearchTick = searchNow;
    if (solo) soloSince ??= searchNow;
    const botIn = soloSince === null ? null : Math.max(0, Math.ceil((BOT_WAIT_MS - (searchNow - soloSince)) / 1000));
    if (botIn === 0) {
      setOpen(false);
      leave(true); // Cancel the SDK handle and listeners before starting local AI.
      return;
    }
    setInfo({ botIn });
    if (round && round.roster.includes(room.id)) {
      const side = round.roster.indexOf(room.id); sim.localPlayerId = side;
      if (!room.isHost && epoch !== round.epoch) {
        epoch = round.epoch; seenHit = 0; pendingActions = []; hooks.reset(round.options); sim.localPlayerId = side;
      }
      if (epoch === round.epoch) {
        const packet = packInput(sim.input, epoch, ++inputSequence, pendingActions.splice(0, 4));
        if (room.isHost) acceptInput(room.id, packet); else room.inputs.send(packet);
      }
      const countdown = Math.max(0, Math.ceil((round.deadline - Date.now()) / 1000));
      const names = [side, 1 - side].map(i => room!.players.get(round.roster[i])?.name ?? 'Challenger');
      const waiting = !canFight() || !transport;
      const requested = round.rematch.includes(room.id);
      setInfo({ mode: waiting ? 'waiting' : countdown ? 'countdown' : 'playing',
        label: !transport ? 'Reconnecting…' : waiting ? 'Waiting for both players to return…' : countdown ? `Blades ready · ${countdown}` : requested ? 'Rematch requested · waiting for your rival' : 'Online duel',
        localPlayer: side, names, host: room.isHost, players: room.activePlayers.size, countdown });
    } else setInfo({ mode: 'waiting', label: 'Waiting for a second player…', players: room.activePlayers.size, host: room.isHost });
  }
  const timer = setInterval(refresh, 50);
  function detach() {
    active = false; generation++; matchmaking?.cancel(); matchmaking = null; bind(null);
    stopQueue.forEach(stop => stop()); stopQueue = []; pendingActions = []; error = '';
  }
  function leave(fallbackBot = false) {
    detach(); sim.online = false; sim.localPlayerId = 0; info = { ...OFFLINE_STATUS, fallbackBot, names: ['You', fallbackBot ? randomRivalName() : OFFLINE_STATUS.names[1]] };
    hooks.reset({ ledgeDrill: false, playerWeapon: choice?.weapon ?? sim.options.playerWeapon, playerSkin: choice?.skin ?? null });
    if (fallbackBot) sim.start();
    hooks.changed();
  }
  return {
    get active() { return active; },
    get status() { return info; },
    async join() {
      if (active || disposed) return;
      hadHumanRound = false; soloSince = queueSoloSince = null; lastQueueAt = 0; lastSearchTick = clock();
      active = true; const attempt = ++generation; choice = { weapon: sim.options.playerWeapon, skin: safeSkin(sim.options.playerWeapon, sim.options.playerSkin) ?? null, arena: sim.options.arena, ready: true, focused: focused() };
      sim.online = true; sim.practice = false; sim.clearInput(); setInfo({ ...OFFLINE_STATUS, mode: 'connecting', label: 'Connecting to the arena…' });
      if (sim.phase !== 'ready') hooks.reset({ ledgeDrill: false });
      try {
        let match: Matchmaking<Profile>;
        if (hooks.join) match = await hooks.join();
        else {
          // One lazy browser entry with static internal imports. Importing symbols back
          // out of the app entry broke when production chunk exports were renamed.
          const { joinOnlineSession } = await import('./online-session');
          const joined = await joinOnlineSession(() => active && !disposed && attempt === generation);
          if (!joined) return;
          match = joined;
        }
        if (!active || disposed || attempt !== generation) { match.cancel(); return; }
        matchmaking = match;
        stopQueue.push(match.on('error', value => { queueSoloSince = null; error = value instanceof Error ? value.message : 'Could not find a duel. Leave and try again.'; }),
          match.on('searching', () => { queueSoloSince = null; lastQueueAt = 0; }),
          match.on('queue', value => {
            if (!active || disposed || attempt !== generation || match.session || hadHumanRound || error) return;
            const message = value as { position?: unknown; size?: unknown } | undefined;
            const now = clock();
            const alone = message?.position === 1 && message.size === 1 && focused() && (hooks.canStartBot?.() ?? true);
            if (!alone || now - lastQueueAt > 2500) queueSoloSince = null;
            lastQueueAt = now;
            if (!alone) return;
            queueSoloSince ??= now;
            // Public matchmaking has NO session until two people are paired.
            // Decide only on a fresh server queue report (sent after reservations),
            // so a stalled connection or an in-flight human seat cannot time out.
            if (now - queueSoloSince >= BOT_WAIT_MS) leave(true);
          }));
        refresh();
      } catch (e) { if (attempt === generation) { error = e instanceof Error ? e.message : 'Could not connect.'; setInfo({ mode: 'error', label: error }); } }
    },
    action(action: Action) { if (active && pendingActions.length < 4) pendingActions.push(action); },
    hit(hit: DuelHit) { if (!active || !room?.isHost) return; hitJournal.push({ id: ++hitSequence, hit: hitToWire(hit) }); if (hitJournal.length > 6) hitJournal.shift(); },
    render() {
      if (!active || !room || room.isHost || !epoch) return;
      const weapon = room.objects.get('weapons');
      if (!weapon || weapon.owner !== room.host || weapon.stateRaw.epoch !== epoch || weapon.state.epoch !== epoch) return;
      applyWeaponSnapshot(sim, weapon.state, weapon.stateRaw);
      reportResult();
      for (let i = 0; i < 2; i++) {
        const body = room.objects.get(SNAPSHOT_IDS[i]);
        if (body && body.owner === room.host && body.stateRaw.epoch === epoch && body.state.epoch === epoch) applyFighterSnapshot(sim, i, body.state, body.stateRaw);
      }
      for (const event of (weapon.stateRaw.impacts ?? []) as typeof hitJournal) if (event.id > seenHit) { seenHit = event.id; hooks.hit(hitFromWire(event.hit)); }
    },
    leave() { leave(); },
    dispose() { disposed = true; clearInterval(timer); detach(); },
  };
}
