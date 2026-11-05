// Shared bits for the admin pages.
import { icon } from '../../icons.js';
import { h } from '../../ui.js';

const LINKS = [
  ['#/admin', 'Rounds', 'calendar'],
  ['#/admin/new', 'New round', 'camera'],
  ['#/admin/maps', 'Maps', 'map'],
  ['#/admin/players', 'Players', 'users'],
];

export function adminNav() {
  const hash = location.hash || '#/admin';
  const active = href => (href === '#/admin/maps' ? hash.startsWith(href) : hash === href);
  return h('nav', { class: 'subnav', 'aria-label': 'Admin' }, LINKS.map(([href, label, name]) =>
    h('a', { href, class: active(href) ? 'active' : '' }, icon(name, { size: 18 }), h('span', {}, label))));
}

/** YYYY-MM-DD plus n days. */
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First day from `from` onward that has no round yet. */
export function nextFreeDate(rounds, from) {
  const taken = new Set(rounds.map(r => r.date));
  let d = from;
  while (taken.has(d)) d = addDays(d, 1);
  return d;
}
