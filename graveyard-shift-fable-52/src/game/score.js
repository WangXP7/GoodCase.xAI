// Scoring for the end screen and the leaderboard. Pure: no DOM, no three.js.
//
// Counts, from events: shots (weapon:fire, not dry), hits (shots that struck a zombie at least once:
// a shotgun's pellets on one shot are one hit), kills and headshots (zombie:die), doors (door:open),
// and active play seconds (add(dt) with sim dt: paused time never counts).
//   summary({round, earned, spent, best, newBest}) -> { round, kills, headshots, accuracy, earned,
//     spent, seconds, doors, best, newBest, rows:[{label, value}] }   (the end screen)
//   run({round, earned, device}) -> { round, kills, headshots, points, timeSec, version, device }
//     (the leaderboard's run shape; points = points earned this run)
export const GAME_VERSION = '0.2.0';

export function createScore() {
  let shotOpen = false; // the last shot has not struck a zombie yet
  const s = {
    shots: 0, hits: 0, kills: 0, headshots: 0, doors: 0, seconds: 0,

    onFire(e) { if (e && e.dry) return; s.shots++; shotOpen = true; },
    onHit(h) {
      if (!h || !shotOpen) return;
      if (h.source && h.source !== 'bullet' && h.source !== 'arc') return;
      s.hits++; shotOpen = false;
    },
    onKill(z) { s.kills++; if (z && z.headshot) s.headshots++; },
    onDoor() { s.doors++; },
    add(dt) { if (dt > 0) s.seconds += dt; },

    get accuracy() { return s.shots > 0 ? Math.min(1, s.hits / s.shots) : 0; },

    summary({ round = 0, earned = 0, spent = 0, best = 0, newBest = false } = {}) {
      const acc = s.accuracy;
      const rows = [
        { label: 'Round reached', value: String(round) },
        { label: 'Kills', value: String(s.kills) },
        { label: 'Headshots', value: String(s.headshots) },
        { label: 'Accuracy', value: `${Math.round(acc * 100)}%` },
        { label: 'Points earned', value: String(earned) },
        { label: 'Points spent', value: String(spent) },
        { label: 'Doors opened', value: String(s.doors) },
        { label: 'Time', value: clock(s.seconds) },
        { label: 'Best round', value: newBest ? `${best} (new)` : String(best) },
      ];
      return { round, kills: s.kills, headshots: s.headshots, accuracy: acc, earned, spent, seconds: s.seconds, doors: s.doors, best, newBest, rows };
    },

    run({ round = 0, earned = 0, device = 'desktop' } = {}) {
      return { round, kills: s.kills, headshots: s.headshots, points: Math.max(0, Math.floor(earned)), timeSec: Math.floor(s.seconds), version: GAME_VERSION, device };
    },

    reset() { s.shots = 0; s.hits = 0; s.kills = 0; s.headshots = 0; s.doors = 0; s.seconds = 0; shotOpen = false; },
  };
  return s;
}

function clock(sec) {
  const t = Math.floor(sec);
  const m = Math.floor(t / 60), r = t % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
