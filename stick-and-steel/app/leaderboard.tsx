'use client';
import { useEffect, useState } from 'react';
import type { Standings } from '@/lib/duel/standings';
import { withArenaRivals } from '@/lib/duel/arena-rivals';
export function Leaderboard() {
  const [data, setData] = useState<Standings | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    import('@/lib/duel/standings').then(s => s.readStandings()).then(next => { if (active) { setData(next); setError(''); } }).catch(() => { if (active) setError('The leaderboard could not load. Try again.'); });
    return () => { active = false; };
  }, [revision]);
  const rows = data ? withArenaRivals(data.items) : [];
  return <div className="leaderboard-content">
    {data && <div className="personal-record" aria-label="Your online record"><span>{data.guest ? 'This device' : 'Your record'}</span><strong>{data.mine.wins}<small>wins</small></strong><strong>{data.mine.losses}<small>losses</small></strong><strong>{data.mine.wins + data.mine.losses ? Math.round(100 * data.mine.wins / (data.mine.wins + data.mine.losses)) : 0}%<small>win rate</small></strong></div>}
    {error ? <p role="alert">{error}</p> : !data ? <output>Loading…</output> : <table className="leaderboard-table"><caption className="sr-only">Duel standings, including starter arena rivals</caption><thead><tr><th scope="col">#</th><th scope="col">Duelist</th><th scope="col">W</th><th scope="col">L</th></tr></thead><tbody>{rows.map(row => <tr key={row.userId} className={row.userId === data.userId ? 'is-you' : ''}><td>{row.rank}</td><th scope="row">{row.name}{row.userId === data.userId ? <small>you</small> : row.arenaRival && <small title="Starter arena rival">rival</small>}</th><td>{row.wins}</td><td>{row.losses}</td></tr>)}</tbody></table>}
    {(data?.pending || error) && <div className="leaderboard-foot">{data?.pending && <small>Saving your result…</small>}<button onClick={() => setRevision(v => v + 1)}>Try again</button></div>}
  </div>;
}
