// Past rounds: practice on any earlier day's photo (not ranked; no sign-in needed).
import { api } from '../api.js';
import { pageHeader, roundSummary } from '../components.js';
import { currentCampus, session } from '../session.js';
import { btn, h, points } from '../ui.js';

export async function archive(root) {
  const today = session.boot.today;
  const rounds = (await api.rounds()).filter(r => r.date < today || (r.date === today && r.mine?.played));
  root.append(
    pageHeader('Past rounds', { sub: `Earlier photos from ${currentCampus().short}. Practice on them; they don’t count for the leaderboard.` }),
    rounds.length
      ? h('ul', { class: 'round-list' }, rounds.map(r => h('li', { class: 'round' },
        ...roundSummary(r, { extra: h('span', { class: 'small muted' }, r.mine ? `Your best: ${points(r.mine.best)}` : `${r.plays} played on the day`) }),
        h('div', { class: 'round-actions' },
          btn(r.mine ? 'Play again' : 'Play', { href: `#/play/${r.id}`, icon: 'play', class: 'primary small' }),
          r.mine ? btn('Result', { href: `#/result/${r.id}`, class: 'small' }) : null))))
      : h('div', { class: 'empty-state' }, h('p', { class: 'muted' }, 'No past rounds yet. Come back after the first day!')),
  );
}
