// Admin: requests to contribute photos. Approve to let someone submit; deny or revoke to stop them.
import { api } from '../../api.js';
import { pageHeader } from '../../components.js';
import { btn, formatTime, h, toast } from '../../ui.js';
import { adminNav } from './common.js';

const LABEL = { pending: 'Waiting', approved: 'Contributor', denied: 'Denied' };

export async function adminContributors(root) {
  const people = await api.admin.contributors();
  const list = h('ul', { class: 'player-list' });

  function render() {
    list.replaceChildren(...people.map(p => h('li', {},
      h('div', { class: 'grow' },
        h('strong', {}, p.name), h('span', { class: `status ${p.status === 'approved' ? 'ok' : p.status === 'denied' ? 'no' : ''}` }, LABEL[p.status]),
        h('div', { class: 'small muted' }, `${p.email || ''} · asked ${formatTime(p.requestedAt)} · ${p.published}/${p.submitted} photos approved`),
        p.note ? h('div', { class: 'small' }, `“${p.note}”`) : null),
      h('div', { class: 'row' },
        p.status !== 'approved' ? btn('Approve', { class: 'small primary', onclick: () => set(p, 'approved') }) : null,
        p.status !== 'denied' ? btn(p.status === 'approved' ? 'Revoke' : 'Deny', { class: 'small danger', onclick: () => set(p, 'denied') }) : null))));
    if (!people.length) list.append(h('li', { class: 'muted' }, 'No requests yet.'));
  }

  async function set(p, status) {
    try {
      await api.admin.setContributor(p.userId, status);
      p.status = status;
      render();
      toast(status === 'approved' ? `${p.name} can now submit photos` : `${p.name} can’t submit photos`);
    } catch (err) { toast(err.message, 'error'); }
  }

  render();
  const waiting = people.filter(p => p.status === 'pending').length;
  root.append(adminNav(), pageHeader('Contributors', { sub: waiting ? `${waiting} waiting for a decision` : 'People who can submit photos' }), h('section', { class: 'card' }, list));
}
