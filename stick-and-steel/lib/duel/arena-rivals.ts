export type StandingRow = { rank: number; userId: string; name: string; wins: number; losses: number; arenaRival?: boolean };

// Fictional starter rivals are display-only. Never create accounts or submit
// these scores to the online board; real players replace them as it fills up.
const STARTER_RIVALS: readonly StandingRow[] = [
  [24, 12, 7], [63, 10, 6], [17, 9, 8], [82, 8, 5], [35, 7, 6],
  [56, 6, 4], [91, 5, 7], [48, 4, 3], [72, 3, 5], [29, 2, 4],
].map(([id, wins, losses]) => ({ rank: 0, userId: `arena-rival-${id}`, name: `Player ${id}`, wins, losses, arenaRival: true }));

export function withArenaRivals(items: readonly StandingRow[]): StandingRow[] {
  const names = new Set(items.map(item => item.name));
  const starters = STARTER_RIVALS.filter(item => !names.has(item.name)).slice(0, Math.max(0, 10 - items.length));
  return [...items, ...starters].sort((a, b) => b.wins - a.wins || b.losses - a.losses || Number(!!a.arenaRival) - Number(!!b.arenaRival))
    .map((item, i) => ({ ...item, rank: i + 1 }));
}

export function randomRivalName() {
  return `Player ${10 + Math.floor(Math.random() * 90)}`;
}
