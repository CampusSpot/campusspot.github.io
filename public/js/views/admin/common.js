// Shared bits for the admin pages.
import { icon } from '../../icons.js';
import { currentCampus } from '../../session.js';
import { h, modal } from '../../ui.js';
import { campusList } from '../pick.js';

const LINKS = [
  ['#/admin', 'Rounds', 'calendar'],
  ['#/admin/new', 'New round', 'camera'],
  ['#/admin/maps', 'Map', 'map'],
  ['#/admin/review', 'Review', 'check'],
  ['#/admin/players', 'Players', 'users'],
  ['#/admin/contributors', 'Contributors', 'camera'],
];

// The campus the admin pages manage. Separate from the admin's own campus, so admins can run any
// campus without leaving their own leaderboard.
const ADMIN_CAMPUS_KEY = 'campusspot.adminCampus';
export function adminCampus() {
  try { return JSON.parse(sessionStorage.getItem(ADMIN_CAMPUS_KEY)) || currentCampus(); } catch { return currentCampus(); }
}

async function chooseAdminCampus() {
  const campuses = await campusList();
  const picked = await modal(close => {
    const input = h('input', { type: 'search', placeholder: 'Search campuses', 'aria-label': 'Search campuses', autocomplete: 'off' });
    const list = h('ul', { class: 'campus-list compact' });
    const draw = () => {
      const q = input.value.toLowerCase();
      list.replaceChildren(...campuses.filter(c => `${c.name} ${c.short} ${c.city}`.toLowerCase().includes(q)).slice(0, 40).map(c =>
        h('li', {}, h('button', { type: 'button', class: 'campus-row', onclick: () => close(c) }, h('span', { class: 'campus-text' }, h('strong', {}, c.name), h('span', { class: 'small muted' }, c.city))))));
    };
    input.addEventListener('input', draw);
    draw();
    return [h('h2', {}, 'Manage which campus?'), input, list];
  }, { label: 'Manage which campus' });
  if (!picked) return;
  try { sessionStorage.setItem(ADMIN_CAMPUS_KEY, JSON.stringify(picked)); } catch {}
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function adminNav() {
  const hash = location.hash || '#/admin';
  const active = href => (href === '#/admin/maps' ? hash.startsWith(href) : hash === href);
  const campus = adminCampus();
  return h('div', {},
    h('nav', { class: 'subnav', 'aria-label': 'Admin' }, LINKS.map(([href, label, name]) =>
      h('a', { href, class: active(href) ? 'active' : '' }, icon(name, { size: 18 }), h('span', {}, label)))),
    h('button', { type: 'button', class: 'managing', onclick: chooseAdminCampus },
      h('span', { class: 'small muted' }, 'Managing'), h('strong', {}, campus?.name || 'Pick a campus'), icon('chevron-down', { size: 14 })));
}

/** YYYY-MM-DD plus n days. */
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First day from `from` onward that has no round yet. */
export function nextFreeDate(rounds, from) {
  const taken = new Set(rounds.filter(r => r.bonus == null).map(r => r.date));
  let d = from;
  while (taken.has(d)) d = addDays(d, 1);
  return d;
}
