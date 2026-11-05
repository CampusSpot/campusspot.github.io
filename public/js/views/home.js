// Home: today's round, your result, a peek at today's leaderboard, and how to play.
import { api } from '../api.js';
import { localInfo, photoUrl } from '../backend.js';
import { difficultyBadge, leaderboardList, maxPointsText, qrBox } from '../components.js';
import { icon } from '../icons.js';
import { googleButton, session } from '../session.js';
import { btn, formatDuration, h, msUntilMidnight, points } from '../ui.js';

function countdown() {
  const el = h('span', {});
  const tick = () => { el.textContent = formatDuration(msUntilMidnight(session.boot.timezone)); };
  tick();
  const timer = setInterval(tick, 30000);
  return { el, stop: () => clearInterval(timer) };
}

export async function home(root) {
  const [today, board] = await Promise.all([api.today(), api.leaderboardRound().catch(() => ({ rows: [] }))]);
  const next = countdown();
  const signedIn = !!session.user;
  const played = today?.mine?.played;

  let hero;
  if (today) {
    const action = played
      ? [h('p', { class: 'hero-score' }, h('strong', {}, points(today.mine.best)), ' points today'),
        h('div', { class: 'row wrap' }, btn('See your result', { href: `#/result/${today.id}`, icon: 'check', class: 'primary' }),
          btn('Leaderboard', { href: '#/leaderboard', icon: 'trophy' }))]
      : signedIn
        ? [btn('Play today’s round', { href: '#/play/today', icon: 'play', class: 'primary big' })]
        : [h('p', { class: 'small hero-note' }, 'Sign in to play today’s round and get on the leaderboard.'), googleButton('Sign in with Google'),
          h('a', { class: 'small hero-alt', href: '#/archive' }, 'or practice on past rounds without signing in')];
    hero = h('section', { class: 'hero' },
      h('div', { class: 'hero-photo' },
        h('img', { src: photoUrl(today.photoPath), alt: '', class: played ? '' : 'veiled' }),
        h('div', { class: 'hero-badges' }, h('span', { class: 'badge solid' }, 'Today'), difficultyBadge(today.difficulty))),
      h('div', { class: 'hero-body' },
        h('h1', {}, today.title || 'Today’s round'),
        h('p', { class: 'muted small' }, `${today.plays} player${today.plays === 1 ? '' : 's'} so far · ${maxPointsText(today.difficulty)}`),
        ...action));
  } else {
    hero = h('section', { class: 'hero empty' },
      h('div', { class: 'hero-body' },
        icon('clock', { size: 36 }),
        h('h1', {}, 'No round today'),
        h('p', { class: 'muted' }, 'A new photo usually drops at midnight. Meanwhile, try a past round.'),
        btn('Past rounds', { href: '#/archive', icon: 'calendar', class: 'primary' })));
  }

  const howTo = h('details', { class: 'card how', open: !signedIn && !played },
    h('summary', {}, icon('info'), h('span', {}, 'How to play')),
    h('ol', { class: 'steps' },
      h('li', {}, h('strong', {}, 'Look at the photo. '), 'It was taken somewhere on campus.'),
      h('li', {}, h('strong', {}, 'Tap the map '), 'where you think the photographer stood.'),
      h('li', {}, h('strong', {}, 'Aim the arrow '), 'the way the camera was facing, then submit.'),
      h('li', {}, h('strong', {}, 'Score up to 10,000: '), '5,000 for the spot, 5,000 for the direction. One try per day.')));

  root.append(
    hero,
    h('p', { class: 'next-round muted small' }, icon('clock', { size: 16 }), ' Next round in ', next.el),
    h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', {}, 'Today’s top players'), h('a', { class: 'small', href: '#/leaderboard' }, 'Full leaderboard')),
      leaderboardList((board.rows || []).slice(0, 5), { empty: today ? 'Be the first on the board today.' : 'No round today.' })),
    howTo,
    phoneCard(),
    footer());
  return () => next.stop();
}

/** In local mode on the computer itself: how to open this on a phone. */
function phoneCard() {
  const urls = localInfo?.urls?.http || [];
  if (!['localhost', '127.0.0.1'].includes(location.hostname) || !urls.length) return null;
  return h('section', { class: 'card' },
    h('h2', {}, 'Open on your phone'),
    h('p', { class: 'small muted' }, 'Same Wi-Fi as this computer. Scan or type:'),
    qrBox(urls[0]),
    h('p', { class: 'url center' }, urls.join('  ·  ')));
}

export function footer() {
  return h('footer', { class: 'site-footer' },
    h('nav', {}, h('a', { href: '#/about' }, 'About & credits'), h('a', { href: '#/privacy' }, 'Privacy'), h('a', { href: '#/terms' }, 'Terms')),
    h('p', {}, 'An independent student project. Not affiliated with or endorsed by Cal Poly Pomona.'));
}

/** Shown when the site is published but config.js hasn't been filled in yet. */
export function setupNeeded(root) {
  root.append(h('div', { class: 'empty-state' },
    h('span', { class: 'brand-mark big', 'aria-hidden': 'true' }),
    h('h1', {}, 'PolySpot is almost ready'),
    h('p', { class: 'muted' }, 'This site isn’t connected to its database yet. If you run it, follow docs/SETUP.md and fill in public/config.js.')));
}
