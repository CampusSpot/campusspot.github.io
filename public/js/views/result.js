// Results: the answer vs your guess on the map, the points, your rank today, and sharing.
import { api } from '../api.js';
import { photoUrl } from '../backend.js';
import { difficultyBadge, pageHeader } from '../components.js';
import { icon } from '../icons.js';
import { createMapView } from '../map/index.js';
import { currentCampus, googleButton, scoring, session } from '../session.js';
import { formatLength } from '../units.js';
import { btn, formatDate, formatTime, h, points, toast } from '../ui.js';

// The latest result, kept in memory so guests (whose practice isn't stored) still see it.
let last = null;
export const rememberResult = res => { last = res; };

export async function result(root, roundId) {
  const data = last?.round?.id === roundId ? last : session.user ? await api.myResult(roundId) : null;
  if (!data?.guesses?.length) {
    const { round, isToday } = await api.round(roundId);
    root.append(pageHeader('Results', { back: '#/' }), h('div', { class: 'empty-state' },
      h('p', { class: 'muted' }, 'You haven’t played this round yet.'),
      btn(isToday ? 'Play today’s round' : 'Play this round', { href: `#/play/${round.id}`, icon: 'play', class: 'primary' })));
    return;
  }
  const { round, map, truth, guesses, rank } = data;
  const isToday = round.date === session.boot.today;
  const cfg = scoring();
  let current = guesses.find(g => g.ranked) || guesses.at(-1);

  const hero = h('div', { class: 'score-hero' });
  const stats = h('div', { class: 'stats' });
  const box = h('div', { class: 'map-box' });
  const history = h('ol', { class: 'history' });
  const view = createMapView(box, map);

  const bar = (value, max, cls) => h('div', { class: `bar ${cls}`, role: 'img', 'aria-label': `${points(value)} of ${points(max)}` },
    h('span', { style: { width: `${(100 * value) / max}%` } }));

  function show(g) {
    current = g;
    view.setPoses([
      { id: 'truth', pos: truth.pos, heading: truth.heading, color: 'var(--truth)', label: 'Actual', labelSide: 'left' },
      { id: 'guess', pos: g.pos, heading: g.heading, color: 'var(--guess)', label: 'You' },
    ]);
    view.setLines([{ a: g.pos, b: truth.pos }]);
    view.focus([g.pos, truth.pos]);
    hero.replaceChildren(
      h('div', { class: 'total' }, points(g.total)),
      h('div', { class: 'muted' }, `of ${points(g.max)} points`, g.multiplier !== 1 ? ` · ×${g.multiplier} ${cfg.difficulties[round.difficulty]?.label || ''} bonus` : ''),
      g.ranked && rank ? h('div', { class: 'rank-pill' }, `#${rank.place} of ${rank.of} today`) : null,
      !g.ranked && !session.user && isToday ? h('div', { class: 'guest-note' }, 'Played as a guest, so this score isn’t saved. ', googleButton('Sign in with Google'), h('div', { class: 'small muted' }, 'Signed-in players get one ranked try a day.')) : null,
      !g.ranked && session.user ? h('div', { class: 'small muted' }, isToday ? 'Not ranked: you made this round.' : 'Practice round · not on the leaderboard') : null,
      !g.ranked && !session.user && !isToday ? h('div', { class: 'small muted' }, 'Practice round · not on the leaderboard') : null);
    stats.replaceChildren(
      h('div', { class: 'stat' },
        h('div', { class: 'stat-head' }, h('span', {}, 'Position'), h('strong', {}, `${points(g.position)}`)),
        bar(g.position, cfg.position.max, 'pos'),
        h('div', { class: 'small muted' }, `${formatLength(g.distance, map.units)} away`)),
      h('div', { class: 'stat' },
        h('div', { class: 'stat-head' }, h('span', {}, 'Direction'), h('strong', {}, `${points(g.direction)}`)),
        bar(g.direction, cfg.direction.max, 'dir'),
        h('div', { class: 'small muted' }, `${Math.round(g.angleError)}° off · you ${Math.round(g.heading)}°, actual ${Math.round(truth.heading)}°`)));
    renderHistory();
  }

  function renderHistory() {
    history.replaceChildren(...[...guesses].reverse().map((g, i) => h('li', {},
      h('button', { type: 'button', class: `history-row${g === current ? ' current' : ''}`, onclick: () => show(g) },
        h('span', { class: 'n' }, `#${guesses.length - i}`),
        h('span', { class: 'grow' }, g.createdAt ? formatTime(g.createdAt) : 'Just now'),
        h('span', { class: 'small muted' }, `${formatLength(g.distance, map.units)} · ${Math.round(g.angleError)}°`),
        h('strong', {}, points(g.total))))));
  }

  async function share() {
    const g = current;
    const where = currentCampus()?.id === round.campusId ? ` ${currentCampus().short}` : '';
    const text = `CampusSpot${where} ${formatDate(round.date, '')}: ${points(g.total)}/${points(g.max)}\n📍 ${formatLength(g.distance, map.units)} off · 🧭 ${Math.round(g.angleError)}° off${g.ranked && rank ? ` · #${rank.place} of ${rank.of}` : ''}\n${location.origin + location.pathname}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Copied, ready to paste'); }
    } catch { /* cancelled */ }
  }

  root.append(
    pageHeader(isToday ? 'Today’s result' : 'Practice result', { back: isToday ? '#/' : '#/archive',
      sub: [round.title || formatDate(round.date, session.boot.today), ' · ', difficultyBadge(round.difficulty)] }),
    hero,
    box,
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'swatch truth' }), 'Actual spot'),
      h('span', {}, h('i', { class: 'swatch guess' }), 'Your guess')),
    stats,
    h('div', { class: 'row wrap' },
      isToday ? btn('Share', { icon: 'share', class: 'primary grow', onclick: share }) : btn('Try again', { href: `#/play/${round.id}`, icon: 'play', class: 'primary grow' }),
      btn('Leaderboard', { href: '#/leaderboard', icon: 'trophy', class: 'grow' }),
      btn('Past rounds', { href: '#/archive', icon: 'calendar', class: 'grow' })),
    h('section', { class: 'card' }, h('h2', {}, 'The photo'),
      h('a', { href: photoUrl(round.photoPath), target: '_blank', rel: 'noopener' }, h('img', { class: 'preview', src: photoUrl(round.photoPath), alt: 'Round photo' }))),
    guesses.length > 1 ? h('section', { class: 'card' }, h('h2', {}, `Your tries (${guesses.length})`), history) : null,
  );
  show(current);
  return () => view.destroy();
}
