// App shell (top bar, bottom tabs) and router. Each view renders into a fresh container and may
// return a cleanup function. Admin pages are hidden from everyone else; the database refuses their
// actions anyway.
import { mode } from './backend.js';
import { icon } from './icons.js';
import { googleButton, initSession, onSessionChange, session } from './session.js';
import { h, loading } from './ui.js';
import { home, setupNeeded } from './views/home.js';
import { play, playToday } from './views/play.js';
import { result } from './views/result.js';
import { leaderboard } from './views/leaderboard.js';
import { archive } from './views/archive.js';
import { account } from './views/account.js';
import { about, privacy, terms } from './views/legal.js';
import { adminRounds } from './views/admin/rounds.js';
import { adminHost, contributeNew } from './views/admin/host.js';
import { adminReview } from './views/admin/review.js';
import { adminContributors } from './views/admin/contributors.js';
import { contribute } from './views/contribute.js';
import { adminMaps } from './views/admin/maps.js';
import { adminPlayers } from './views/admin/players.js';

const routes = [
  ['/', home],
  ['/play/today', playToday, { fullscreen: true }],
  ['/play/:id', play, { fullscreen: true }],
  ['/result/:id', result],
  ['/leaderboard', leaderboard],
  ['/archive', archive],
  ['/account', account],
  ['/about', about],
  ['/privacy', privacy],
  ['/terms', terms],
  ['/contribute', contribute],
  ['/contribute/new', contributeNew, { contributor: true }],
  ['/admin', adminRounds, { admin: true }],
  ['/admin/new', adminHost, { admin: true }],
  ['/admin/maps', adminMaps, { admin: true }],
  ['/admin/maps/:id', adminMaps, { admin: true }],
  ['/admin/players', adminPlayers, { admin: true }],
  ['/admin/review', adminReview, { admin: true }],
  ['/admin/contributors', adminContributors, { admin: true }],
].map(([pattern, view, opts = {}]) => ({
  re: new RegExp(`^${pattern.replace(/:\w+/g, '([\\w-]+)')}$`),
  view, ...opts,
}));

const TABS = [
  { href: '#/', label: 'Today', icon: 'sun', match: p => p === '/' || p.startsWith('/play') || p.startsWith('/result') },
  { href: '#/leaderboard', label: 'Leaderboard', icon: 'trophy', match: p => p === '/leaderboard' },
  { href: '#/archive', label: 'Archive', icon: 'calendar', match: p => p === '/archive' },
  { href: '#/admin', label: 'Admin', icon: 'shield', match: p => p.startsWith('/admin'), admin: true },
  { href: '#/account', label: 'You', icon: 'user', match: p => p === '/account' },
];

const accountSlot = h('div', { class: 'account-slot' });
const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' });
const view = h('main', { id: 'view', class: 'view', tabindex: '-1' });
document.getElementById('app').replaceChildren(
  h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'PolySpot home' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('span', { class: 'wordmark' }, 'PolySpot')),
    accountSlot),
  view,
  tabbar);

const path = () => (location.hash.replace(/^#/, '').split('?')[0] || '/');

function renderChrome() {
  const p = path();
  const { boot, user } = session;
  accountSlot.replaceChildren(user
    ? h('a', { class: 'avatar-chip', href: '#/account', 'aria-label': 'Your account' },
      h('span', { class: 'avatar' }, (boot.profile?.displayName || user.email || '?').slice(0, 1).toUpperCase()),
      h('span', { class: 'chip-name' }, boot.profile?.displayName || 'Choose a name'))
    : mode === 'unconfigured' ? null : googleButton('Sign in'));
  tabbar.replaceChildren(...TABS.filter(t => !t.admin || boot.isAdmin).map(t =>
    h('a', { href: t.href, class: `tab${t.match(p) ? ' active' : ''}`, 'aria-current': t.match(p) ? 'page' : null }, icon(t.icon, { size: 22 }), h('span', {}, t.label))));
}

let cleanup = null;
let renderId = 0;

async function render() {
  try { cleanup?.(); } catch (err) { console.error(err); }
  cleanup = null;
  const id = ++renderId;
  const p = path();
  const found = routes.find(r => r.re.test(p));
  // Before the site is connected to its database, only the legal pages work (Google asks for their links).
  const route = mode === 'unconfigured' && !['/about', '/privacy', '/terms'].includes(p) ? { view: setupNeeded } : found;
  if (!route) return location.replace('#/');
  document.body.classList.toggle('fullscreen', !!route.fullscreen);
  renderChrome();
  const container = h('div', { class: 'view-inner' });
  view.replaceChildren(container);
  window.scrollTo(0, 0);
  if (route.admin && !session.boot.isAdmin) {
    container.append(h('div', { class: 'empty-state' }, icon('shield', { size: 40 }), h('h1', {}, 'Admins only'),
      h('p', { class: 'muted' }, 'This page is for the people who run PolySpot.')));
    return;
  }
  if (route.contributor && !session.boot.isAdmin && session.boot.contributor !== 'approved') return location.replace('#/contribute');
  const slow = setTimeout(() => container.isConnected && !container.childElementCount && container.append(loading()), 150);
  try {
    const done = await route.view(container, ...(route.re ? p.match(route.re).slice(1) : []));
    container.querySelector('.loading')?.remove();
    if (typeof done === 'function') { if (id === renderId) cleanup = done; else done(); }
  } catch (err) {
    console.error(err);
    if (id !== renderId) return;
    container.replaceChildren(h('div', { class: 'empty-state' }, icon('info', { size: 40 }), h('h1', {}, 'Something went wrong'),
      h('p', { class: 'muted' }, err.message), h('a', { class: 'btn', href: '#/' }, 'Home')));
  } finally {
    clearTimeout(slow);
  }
}

// Re-render when the player changes (sign-in/out, name, admin); otherwise just refresh the top bar.
const identity = () => `${session.user?.id}|${session.boot.isAdmin}|${session.boot.profile?.displayName}|${session.boot.profile?.hidden}`;
let lastIdentity = identity();
onSessionChange(() => {
  const now = identity();
  if (now !== lastIdentity) { lastIdentity = now; render(); } else renderChrome();
});
window.addEventListener('hashchange', render);
view.append(loading());
initSession().catch(err => console.error(err)).finally(() => { lastIdentity = identity(); render(); });
