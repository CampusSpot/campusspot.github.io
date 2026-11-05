// Leaderboards: today's round, the last 7 days, and all time.
import { api } from '../api.js';
import { leaderboardList, pageHeader } from '../components.js';
import { ensureName, session } from '../session.js';
import { btn, h, loading } from '../ui.js';

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'all', label: 'All time' },
];

export async function leaderboard(root) {
  let tab = sessionStorage.getItem('polyspot.board') || 'today';
  const body = h('div', {});
  const tabs = h('div', { class: 'segmented wide', role: 'tablist' });

  async function load() {
    try { sessionStorage.setItem('polyspot.board', tab); } catch {}
    tabs.replaceChildren(...TABS.map(t => h('button', {
      type: 'button', role: 'tab', class: 'seg', 'aria-selected': String(t.id === tab), onclick: () => { tab = t.id; load(); },
    }, t.label)));
    body.replaceChildren(loading());
    if (tab === 'today') {
      const { round, rows } = await api.leaderboardRound();
      body.replaceChildren(round
        ? leaderboardList(rows, { empty: 'Nobody has played today’s round yet.' })
        : h('p', { class: 'muted empty' }, 'There’s no round today.'));
    } else {
      const rows = await api.leaderboardOverall(tab === 'week' ? 7 : null);
      body.replaceChildren(leaderboardList(rows, { columns: 'overall', empty: 'No scores yet.' }));
    }
  }

  const hidden = session.boot.profile?.hidden;
  root.append(
    pageHeader('Leaderboard', { sub: 'Only each player’s first try at the day’s round counts.' }),
    tabs,
    hidden ? h('div', { class: 'notice' }, 'Your name was removed from the leaderboard by an admin. ', btn('Choose a new name', { class: 'small', onclick: () => ensureName() })) : null,
    h('section', { class: 'card flush' }, body));
  await load();
}
