import { getLeaderboard, loadPlayerState, savePlayerState, submitScore, waitForPlayer } from '@genex-ai/embed-sdk';
import { bootIdentity } from './embed';
import type { StandingRow } from './arena-rivals';
import { addResult, persistResult, readRecord, scoreRecord, recordCacheKey, RECORD_BOARD, type DuelRecord, type OnlineResult } from './records';

type Cache = { record: DuelRecord; pending: OnlineResult[] };
export type Standings = { items: StandingRow[]; mine: DuelRecord; userId: string; guest: boolean; pending: boolean };
const caches = new Map<string, Cache>();
let serial: Promise<unknown> = Promise.resolve();
function cacheFor(userId: string): Cache {
  if (caches.has(userId)) return caches.get(userId)!;
  let raw: Partial<Cache> = {};
  try { raw = JSON.parse(localStorage.getItem('stick-steel.record.' + userId) ?? '{}'); } catch { /* Storage is optional. */ }
  const cache = { record: readRecord(raw?.record), pending: Array.isArray(raw?.pending) ? raw.pending.filter(r => r && typeof r.roundId === 'string' && typeof r.won === 'boolean') : [] };
  caches.set(userId, cache); return cache;
}
function stash(userId: string, cache: Cache) {
  try { localStorage.setItem('stick-steel.record.' + userId, JSON.stringify(cache)); } catch { /* SDK saving still works. */ }
}
async function requireAccount(userId: string) {
  const current = await waitForPlayer();
  if (current.guest || current.user.id !== userId) throw new Error('Player changed while saving.');
}
async function flush(key: string) {
  const player = await waitForPlayer();
  if (recordCacheKey(player.user.id, player.guest) !== key) throw new Error('Player changed while saving.');
  const cache = cacheFor(key);
  if (player.guest) {
    // Guest IDs rotate on visits. This device record is separate from account standings.
    // Do not queue an entire guest save: the SDK would replace an existing account save on sign-in.
    cache.record = cache.pending.reduce(addResult, cache.record); cache.pending = []; stash(key, cache); return;
  }
  const port = {
    load: async () => { await requireAccount(key); return loadPlayerState(); },
    save: async (data: unknown, version: number) => { await requireAccount(key); return savePlayerState(data, { ifVersion: version }); },
    submit: async (score: number) => { await requireAccount(key); return submitScore(score, { board: RECORD_BOARD, mode: 'max' }); },
  };
  while (cache.pending.length) {
    const result = cache.pending[0];
    cache.record = await persistResult(port, result);
    cache.pending.shift(); stash(key, cache);
  }
}
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = serial.then(work, work); serial = next.catch(() => {}); return next;
}
/** Only called by the network's accepted, host-owned final snapshot. */
export async function recordOnlineResult(result: OnlineResult) {
  bootIdentity(); const { user, guest } = await waitForPlayer();
  const key = recordCacheKey(user.id, guest), cache = cacheFor(key);
  if (!cache.record.rounds.includes(result.roundId) && !cache.pending.some(r => r.roundId === result.roundId)) cache.pending.push(result);
  stash(key, cache); // Keep a retry if a save fails or the tab closes after the bout.
  return enqueue(() => flush(key));
}
export async function readStandings(): Promise<Standings> {
  bootIdentity(); const { user, guest } = await waitForPlayer();
  const key = recordCacheKey(user.id, guest), cache = cacheFor(key);
  await enqueue(() => flush(key)).catch(() => { /* Show the pending record with a Retry control. */ });
  const [board, saved] = await Promise.all([getLeaderboard({ board: RECORD_BOARD, limit: 100, order: 'desc' }), loadPlayerState()]);
  const remote = readRecord((saved.data as { onlineRecord?: unknown } | null)?.onlineRecord);
  if (!guest) cache.record = remote;
  stash(key, cache);
  return { items: board.items.slice(0, 30).map((item, i) => ({ rank: i + 1, userId: item.userId, name: item.name, ...scoreRecord(item.score) })), mine: cache.pending.reduce(addResult, cache.record), userId: user.id, guest, pending: cache.pending.length > 0 };
}
