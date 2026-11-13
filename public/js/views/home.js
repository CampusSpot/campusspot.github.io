// Home: today's round, your result, a peek at today's leaderboard, and how to play.
import { api } from '../api.js';
import { localInfo, photoUrl } from '../backend.js';
import { leaderboardList, maxPointsText } from '../components.js';
import { currentCampus, googleButton, scoring, session } from '../session.js';
import { btn, formatDuration, h, msUntilMidnight, points } from '../ui.js';

function countdown() {
  const el = h('span', {});
  const tick = () => { el.textContent = formatDuration(msUntilMidnight(session.boot.timezone)); };
  tick();
  const timer = setInterval(tick, 30000);
  return { el, stop: () => clearInterval(timer) };
}

const longDate = ymd => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
};

export async function home(root) {
  const [today, board, bonus] = await Promise.all([api.today(), api.leaderboardRound().catch(() => ({ rows: [] })), api.todayBonus().catch(() => [])]);
  const next = countdown();
  const signedIn = !!session.user;
  const played = today?.mine?.played;
  const label = scoring().difficulties[today?.difficulty]?.label;
  const campus = currentCampus();

  let hero;
  if (today) {
    const action = played
      ? [h('p', { class: 'hero-score' }, h('strong', {}, points(today.mine.best)), ' points'),
        h('div', { class: 'row wrap' }, btn('See your result', { href: `#/result/${today.id}`, class: 'primary' }), btn('Leaderboard', { href: '#/leaderboard' }))]
      : signedIn
        ? [btn('Play', { href: '#/play/today', class: 'primary big' })]
        : [btn('Play', { href: '#/play/today', class: 'primary big' }),
          h('p', { class: 'small muted' }, 'Playing as a guest won’t be saved. Sign in to keep your score and get on the leaderboard.'),
          googleButton('Sign in with Google')];
    hero = h('section', { class: 'hero' },
      h('img', { class: 'hero-photo', src: photoUrl(today.photoPath), alt: '' }),
      h('div', { class: 'hero-body' },
        h('p', { class: 'overline' }, `${campus.short}  ·  ${longDate(today.date)}`),
        h('h1', {}, today.title || 'Where was this taken?'),
        h('p', { class: 'meta' }, [label, `${today.plays} played`, maxPointsText(today.difficulty)].filter(Boolean).join('  ·  ')),
        ...action));
  } else {
    hero = h('section', { class: 'hero empty' },
      h('div', { class: 'hero-body' },
        h('p', { class: 'overline' }, `${campus.short}  ·  ${session.boot.today ? longDate(session.boot.today) : 'Today'}`),
        h('h1', {}, `No photo today at ${campus.short}`),
        h('p', { class: 'muted' }, 'Photos come from students on campus. Know your campus well? Become a contributor and add the first ones.'),
        h('div', { class: 'row wrap' }, btn('Contribute photos', { href: '#/contribute', class: 'primary' }), btn('Past photos', { href: '#/archive' }))));
  }

  const howTo = h('details', { class: 'card how', open: !signedIn && !played },
    h('summary', {}, 'How to play'),
    h('ol', { class: 'steps' },
      h('li', {}, `Look at the photo. It was taken somewhere at ${campus.short}.`),
      h('li', {}, 'Tap the map where you think the photographer stood.'),
      h('li', {}, 'Drag the ring to aim the way the camera was facing, then submit.'),
      h('li', {}, 'Up to 5,000 points for the spot and 5,000 for the direction. One try a day.')));

  root.append(
    hero,
    ...bonus.map(bonusCard),
    h('p', { class: 'next-round' }, 'Next photo in ', next.el),
    h('section', { class: 'card' },
      h('div', { class: 'section-head' }, h('h2', {}, `Today’s top 5 at ${campus.short}`), h('a', { href: '#/leaderboard' }, 'Leaderboard')),
      leaderboardList((board.rows || []).slice(0, 5), { empty: today ? 'No scores yet today.' : 'No photo today.' })),
    howTo,
    phoneCard(),
    footer());
  return () => next.stop();
}

/** An extra round today, with its points multiplier. */
function bonusCard(r) {
  const played = r.mine?.played;
  return h('section', { class: 'card bonus-card' },
    h('img', { class: 'thumb', src: photoUrl(r.photoPath), alt: '' }),
    h('div', { class: 'grow' },
      h('p', { class: 'overline' }, r.bonus === 1 ? 'Bonus round' : `Bonus round · ${r.bonus}× points`),
      h('strong', {}, r.title || 'One more for today'),
      h('div', { class: 'small muted' }, played ? `You scored ${points(r.mine.best)}` : `${scoring().difficulties[r.difficulty]?.label || ''} · ${maxPointsText(r.difficulty, r.bonus)}`)),
    played ? btn('Result', { href: `#/result/${r.id}`, class: 'small' }) : btn('Play', { href: `#/play/${r.id}`, class: 'primary small' }));
}

/** In local mode on the computer itself: how to open this on a phone. */
function phoneCard() {
  const urls = localInfo?.urls?.http || [];
  if (!['localhost', '127.0.0.1'].includes(location.hostname) || !urls.length) return null;
  return h('section', { class: 'card' },
    h('h2', {}, 'Open on your phone'),
    h('p', { class: 'small muted' }, 'Same Wi-Fi as this computer. Type this into your phone’s browser:'),
    h('p', { class: 'url center' }, urls.join('  ·  ')));
}

export function footer() {
  return h('footer', { class: 'site-footer' },
    h('nav', {}, h('a', { href: '#/about' }, 'About & credits'), h('a', { href: '#/privacy' }, 'Privacy Policy'), h('a', { href: '#/terms' }, 'Terms of Use')),
    h('p', {}, 'An independent student project. Not affiliated with or endorsed by any college or university.'));
}

/** Shown when the site is published but config.js hasn't been filled in yet. */
export function setupNeeded(root) {
  root.append(h('div', { class: 'empty-state' },
    h('span', { class: 'brand-mark big', 'aria-hidden': 'true' }),
    h('h1', {}, 'CampusSpot is almost ready'),
    h('p', { class: 'muted' }, 'The game isn’t connected to its database yet. Check back soon.')));
}
