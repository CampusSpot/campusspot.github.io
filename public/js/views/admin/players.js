// Admin: players and their leaderboard names. Hide a name to take it off the leaderboard; the
// player is asked to choose a new one. Admins themselves are managed in the Supabase SQL editor (public.admins).
import { api } from '../../api.js';
import { pageHeader } from '../../components.js';
import { icon } from '../../icons.js';
import { btn, formatTime, h, points, toast } from '../../ui.js';
import { adminNav } from './common.js';

export async function adminPlayers(root) {
  const [players, admins] = await Promise.all([api.admin.players(), api.admin.admins()]);
  const list = h('ul', { class: 'player-list' });
  const search = h('input', { type: 'search', placeholder: 'Search names', 'aria-label': 'Search names', oninput: () => render() });

  function render() {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren(...players.filter(p => !q || p.name.toLowerCase().includes(q)).map(p => h('li', { class: p.hidden ? 'hidden-player' : '' },
      h('div', { class: 'grow' },
        h('strong', {}, p.name), p.hidden ? h('span', { class: 'badge' }, 'hidden') : null,
        h('div', { class: 'small muted' }, `${p.campus ? `${p.campus} · ` : ''}${p.plays} ranked round${p.plays === 1 ? '' : 's'} · ${points(p.total)} pts · joined ${formatTime(p.createdAt)}`)),
      btn(p.hidden ? 'Show' : 'Hide', { icon: p.hidden ? 'eye' : 'eyeOff', class: 'small', onclick: async () => {
        try {
          await api.admin.setHidden(p.userId, !p.hidden);
          p.hidden = !p.hidden;
          toast(p.hidden ? `${p.name} is hidden and will be asked for a new name` : `${p.name} is visible again`);
          render();
        } catch (err) { toast(err.message, 'error'); }
      } }))));
    if (!list.childElementCount) list.append(h('li', { class: 'muted' }, players.length ? 'No matches.' : 'No players yet.'));
  }
  render();

  root.append(
    adminNav(),
    pageHeader('Players', { sub: `${players.length} with a leaderboard name` }),
    h('section', { class: 'card' }, search, list),
    h('section', { class: 'card' },
      h('h2', {}, icon('shield', { size: 18 }), ' Admins'),
      h('ul', { class: 'plain' }, admins.map(a => h('li', {}, a))),
      h('p', { class: 'small muted' }, 'Admins are managed in Supabase (the public.admins table). Keep it to one or two people.')),
  );
}
