// Launch kit wiring: the credit lines, the end screen's share bar, analytics events and, on the
// production origins only, the leaderboard. Built after 'hints' (which builds G.ui.endScreen). Event-driven:
// it has no update(). Every part is guarded so one failing never takes the others or the game down.
import './launch.css';
import { store } from '../core/store.js';
import { boardMode, createApi, createBoardClient, createIdentity } from '../net/board.js';
import { track } from '../core/analytics.js';
import { createCredit } from './credits.js';
import { createShareBar } from './share.js';
import { createLeaderboard } from './leaderboard.js';
import { reportMode, createReportApi, createReportClient } from '../net/report.js';
import { createReport } from './report.js';

const deviceOf = (G) => { const d = G.device || {}; return d.phone || (d.touch && d.coarse) ? 'phone' : 'desktop'; };

export function wireAnalytics(G) {
  if (!G.events || !G.events.on) return;
  let prev = G.game && G.game.state;
  const rounds = new Set();
  G.events.on('game:state', ({ state }) => {
    if (state === 'playing' && prev !== 'paused' && prev !== 'playing') {
      rounds.clear();
      track('game_start', { device: deviceOf(G), tier: String((G.quality && G.quality.tier) || 'unknown') });
    }
    if (state === 'dead') {
      let r = null;
      try { r = G.game.runSummary(); } catch { r = null; }
      track('death', { round: (r && r.round) || (G.game && G.game.round) || 0, kills: (r && r.kills) || 0, device: deviceOf(G) });
    }
    prev = state;
  });
  G.events.on('round:start', ({ n } = {}) => {
    if ((n === 10 || n === 20) && !rounds.has(n)) { rounds.add(n); track(`round_${n}`); }
  });
}

export function createLaunch(G) {
  const ui = G.ui || {};
  const menus = ui.menus;
  const endScreen = ui.endScreen;
  const out = { mode: 'off', board: null, reportMode: 'off', report: null };
  const credits = { title: null, end: null };
  const warn = (name, e) => {
    if (typeof window !== 'undefined' && Array.isArray(window.__errors)) window.__errors.push(`[launch] ${name}: ${e && e.message}`);
  };
  const guard = (name, fn) => { try { fn(); } catch (e) { warn(name, e); } };

  guard('analytics', () => wireAnalytics(G));

  guard('title credit', () => {
    if (!menus || !menus.addToScreen) return;
    credits.title = createCredit({ source: true });
    menus.addToScreen('title', credits.title);
  });

  guard('end screen', () => {
    if (!endScreen || !endScreen.addAside) return;
    const aside = document.createElement('div');
    aside.className = 'gs-lk-endfoot';
    const share = createShareBar(G, { where: 'end' });
    credits.end = createCredit();
    aside.append(share.el, credits.end);
    endScreen.addAside(aside);
    endScreen.onShow(({ run, summary }) => {
      const r = run || summary;
      share.update(r ? { round: r.round, kills: r.kills } : null);
    });
  });

  guard('leaderboard', () => {
    const mode = boardMode(typeof window !== 'undefined' ? window.location : null);
    out.mode = mode;
    if (mode === 'off' || !menus || !menus.setScreen || !menus.addMenuRow) return;
    const board = createBoardClient(createApi({ mode }));
    out.board = board;
    out.leaderboard = createLeaderboard(G, { menus, endScreen: endScreen || {}, board, identity: createIdentity(store) });
  });

  // "Report a problem": production origins (and ?report=mock) only, and only once the server says
  // reporting is on; in the artifact frame, file:// and previews nothing is built and nothing is requested.
  guard('report', () => {
    const mode = reportMode(typeof window !== 'undefined' ? window.location : null);
    out.reportMode = mode;
    if (mode === 'off' || !menus || !menus.setScreen) return;
    const client = createReportClient(createReportApi({ mode }));
    out.report = createReport(G, {
      menus, client,
      links: [{ host: credits.title, where: 'title' }, { host: credits.end, where: 'end' }],
    });
  });

  return out;
}
