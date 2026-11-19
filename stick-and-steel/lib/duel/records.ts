export type OnlineResult = { roundId: string; won: boolean };
export type DuelRecord = { wins: number; losses: number; rounds: string[] };
export const recordCacheKey = (userId: string, guest: boolean) => guest ? 'guest-device-v1' : userId;
export const RECORD_BOARD = 'online-bouts-v1';
// Monotonic counters fit Genex's keep-best scores. Wins rank first, ties by bouts played.
export const RECORD_BASE = 1_000_000;
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < RECORD_BASE ? value as number : 0;
export function readRecord(value: unknown): DuelRecord {
  const data = value && typeof value === 'object' ? value as Partial<DuelRecord> : {};
  return { wins: count(data.wins), losses: count(data.losses), rounds: Array.isArray(data.rounds) ? data.rounds.filter(id => typeof id === 'string').slice(-512) : [] };
}
export function addResult(record: DuelRecord, result: OnlineResult): DuelRecord {
  if (!result.roundId || record.rounds.includes(result.roundId)) return record;
  return { wins: record.wins + Number(result.won), losses: record.losses + Number(!result.won), rounds: [...record.rounds, result.roundId].slice(-512) };
}
export function recordScore(record: DuelRecord) {
  if (record.wins >= RECORD_BASE || record.losses >= RECORD_BASE) throw new Error('Record limit reached.');
  return record.wins * RECORD_BASE + record.losses;
}
export function scoreRecord(score: number) {
  return { wins: Math.floor(score / RECORD_BASE), losses: score % RECORD_BASE };
}
type SaveData = { data: unknown; version: number; guest?: boolean };
export type RecordPort = {
  load(): Promise<SaveData>;
  save(data: unknown, version: number): Promise<{ saved: boolean; conflict?: boolean; guest?: boolean; queued?: boolean }>;
  submit(score: number): Promise<unknown>;
};
/** Reload/merge on account races. Duplicate snapshots or submit retries never add a second win. */
export async function persistResult(port: RecordPort, result: OnlineResult) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const loaded = await port.load();
    if (loaded.guest) throw new Error('Guest records stay on this device.');
    const data = loaded.data && typeof loaded.data === 'object' && !Array.isArray(loaded.data) ? loaded.data as Record<string, unknown> : {};
    const record = readRecord(data.onlineRecord);
    const next = addResult(record, result);
    const saved = await port.save({ ...data, onlineRecord: next }, loaded.version);
    if (saved.conflict) continue;
    if (!saved.saved) throw new Error('Your result is waiting to save.');
    await port.submit(recordScore(next));
    return next;
  }
  throw new Error('Your record changed on another device. Retry to finish saving.');
}
