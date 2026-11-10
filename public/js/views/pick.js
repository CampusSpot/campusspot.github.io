// Pick your campus: every college in California, with search. Signed-in players join the campus
// they pick (one at a time); guests keep their pick on this device.
import { chooseCampus, currentCampus, session } from '../session.js';
import { btn, confirmDialog, h, toast } from '../ui.js';
import { footer } from './home.js';

const KINDS = [
  { id: 'uc', label: 'University of California' },
  { id: 'csu', label: 'California State University' },
  { id: 'private', label: 'Private colleges' },
  { id: 'cc', label: 'Community colleges' },
];
const FILTERS = [{ id: 'all', label: 'All' }, { id: 'uc', label: 'UC' }, { id: 'csu', label: 'CSU' }, { id: 'private', label: 'Private' }, { id: 'cc', label: 'Community' }];

let listCache = null;
export const campusList = async () => (listCache ??= await fetch('data/campuses.json').then(r => {
  if (!r.ok) throw new Error('Couldn’t load the list of campuses');
  return r.json();
}));

const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
const SKIP = new Set(['of', 'the', 'and', 'at', 'college', 'university', 'community', 'state', 'city']);
const initials = c => {
  if (/^[A-Z.&']{2,5}$/.test(c.short.replace(/\s/g, ''))) return c.short.replace(/[\s.]/g, '');
  const words = c.name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(w => w && !SKIP.has(w.toLowerCase()));
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.map(w => (/^(UC|CSU)$/.test(w) ? w : w[0])).join('').toUpperCase().slice(0, 4) || c.short.slice(0, 3).toUpperCase();
};

export async function pickCampus(root) {
  const campuses = await campusList();
  const current = currentCampus();
  let filter = 'all';
  const search = h('input', { type: 'search', class: 'campus-search', placeholder: 'Search by name, city or nickname', 'aria-label': 'Search campuses', autocomplete: 'off' });
  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Type of school' });
  const results = h('div', { class: 'campus-results' });
  const index = campuses.map(c => ({ c, text: fold(`${c.name} ${c.short} ${c.city}`) }));

  async function pick(c) {
    if (current?.id === c.id) { location.hash = '#/'; return; }
    if (session.user && session.boot.campus && !(await confirmDialog(`Switch to ${c.short}?`,
      `You can only be on one campus at a time. Your ${session.boot.campus.short} scores leave its leaderboard, and come back if you switch back later.`,
      { ok: 'Switch' }))) return;
    try {
      await chooseCampus(c);
      toast(`Welcome to ${c.short}`);
      location.hash = '#/';
    } catch (err) { toast(err.message, 'error'); }
  }

  const row = c => h('li', {},
    h('button', { type: 'button', class: `campus-row${current?.id === c.id ? ' current' : ''}`, onclick: () => pick(c) },
      h('span', { class: `campus-badge k-${c.kind}`, 'aria-hidden': 'true' }, initials(c)),
      h('span', { class: 'campus-text' }, h('strong', {}, c.name), h('span', { class: 'small muted' }, [c.city, c.short !== c.name && c.short !== c.city && !c.name.includes(c.short) ? c.short : null].filter(Boolean).join(' · '))),
      current?.id === c.id ? h('span', { class: 'you' }, 'Yours') : null));

  function render() {
    chips.replaceChildren(...FILTERS.map(f => h('button', {
      type: 'button', role: 'radio', class: 'chip', 'aria-checked': String(f.id === filter), onclick: () => { filter = f.id; render(); },
    }, f.label)));
    const words = fold(search.value).split(/\s+/).filter(Boolean);
    const hits = index.filter(({ c, text }) => (filter === 'all' || c.kind === filter) && words.every(w => text.includes(w))).map(x => x.c);
    if (!hits.length) {
      results.replaceChildren(h('p', { class: 'muted empty' }, 'No campus matches that. Try a shorter search.'));
      return;
    }
    results.replaceChildren(...KINDS.map(k => {
      const group = hits.filter(c => c.kind === k.id);
      return group.length ? h('section', {}, h('h2', { class: 'section-title' }, `${k.label} (${group.length})`), h('ul', { class: 'campus-list' }, group.map(row))) : null;
    }));
  }
  search.addEventListener('input', render);
  render();

  root.append(
    h('header', { class: 'pick-head' },
      h('h1', {}, current ? 'Change campus' : 'Pick your campus'),
      h('p', { class: 'muted' }, current
        ? 'Each campus has its own daily photo and leaderboard. You can be on one campus at a time.'
        : 'A new photo of your campus every day. Guess where it was taken and climb your school’s leaderboard.'),
      search, chips),
    results,
    current ? btn('Keep ' + current.short, { href: '#/', class: 'ghost block' }) : null,
    footer());
  setTimeout(() => search.focus(), 50);
}
