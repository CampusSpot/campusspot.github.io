// Announcements from the people who run CampusSpot. Admins post and delete them here. Opening this
// page marks them as read (the dot on the News tab goes away).
import { api } from '../api.js';
import { markAnnouncementsRead, readMarker, sawLatest } from '../announcements.js';
import { pageHeader } from '../components.js';
import { icon } from '../icons.js';
import { session } from '../session.js';
import { btn, confirmDialog, formatTime, h, toast } from '../ui.js';
import { footer } from './home.js';

export async function announcements(root) {
  const res = await api.announcements();
  const { items } = res;
  // What you'd read before opening the page (newer ones are highlighted).
  const marker = readMarker();
  const readAt = !marker ? res.readAt : !res.readAt ? marker : new Date(marker) > new Date(res.readAt) ? marker : res.readAt;
  const list = h('div', { class: 'announcements' });

  function draw() {
    list.replaceChildren(...items.map(a => h('article', { class: `card announcement${readAt && new Date(a.createdAt) <= new Date(readAt) ? '' : ' new'}` },
      h('div', { class: 'row between' },
        h('div', { class: 'grow' },
          h('p', { class: 'overline' }, formatTime(a.createdAt)),
          h('h2', {}, a.title)),
        session.boot.isAdmin ? btn('', { icon: 'trash', class: 'small ghost danger', 'aria-label': 'Delete announcement', onclick: () => remove(a) }) : null),
      a.body ? h('p', { class: 'announcement-body' }, a.body) : null)));
    if (!items.length) list.append(h('div', { class: 'empty-state' }, icon('megaphone', { size: 40 }), h('p', { class: 'muted' }, 'No announcements yet.')));
  }

  async function remove(a) {
    if (!(await confirmDialog('Delete this announcement?', a.title, { ok: 'Delete', danger: true }))) return;
    try {
      await api.admin.deleteAnnouncement(a.id);
      items.splice(items.indexOf(a), 1);
      draw();
      toast('Announcement deleted');
    } catch (err) { toast(err.message, 'error'); }
  }

  function composer() {
    const title = h('input', { type: 'text', maxlength: 80, required: true, placeholder: 'Title', 'aria-label': 'Announcement title' });
    const body = h('textarea', { maxlength: 2000, rows: 4, placeholder: 'What’s new? (optional)', 'aria-label': 'Announcement text' });
    const post = h('button', { type: 'submit', class: 'btn primary' }, 'Post');
    return h('details', { class: 'card' },
      h('summary', {}, 'New announcement'),
      h('form', { onsubmit: async e => {
        e.preventDefault();
        post.disabled = true;
        try {
          const a = await api.admin.postAnnouncement(title.value, body.value);
          items.unshift(a);
          title.value = '';
          body.value = '';
          draw();
          sawLatest(a.createdAt);
          markAnnouncementsRead(a.createdAt);
          toast('Posted. Everyone will see a dot on the News tab.');
        } catch (err) { toast(err.message, 'error'); }
        finally { post.disabled = false; }
      } },
      h('label', { class: 'field' }, h('span', {}, 'Title'), title),
      h('label', { class: 'field' }, h('span', {}, 'Message'), body),
      h('div', { class: 'row end' }, post)));
  }

  draw();
  root.append(
    pageHeader('Announcements', { sub: 'News from the people who run CampusSpot.' }),
    session.boot.isAdmin ? composer() : null,
    list,
    footer());
  if (items[0]) {
    sawLatest(items[0].createdAt);
    markAnnouncementsRead(items[0].createdAt);
  }
}
