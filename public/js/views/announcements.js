// Announcements from the people who run CampusSpot: for every campus, or for one campus. The latest
// ones show on the Today screen; this page lists them all, and admins post and delete them here.
// Seeing them (here or on Today) marks them as read, which clears the dot on the Today tab.
import { api } from '../api.js';
import { markAnnouncementsRead, readMarker, sawLatest } from '../announcements.js';
import { pageHeader } from '../components.js';
import { icon } from '../icons.js';
import { currentCampus, session } from '../session.js';
import { btn, confirmDialog, formatTime, h, toast } from '../ui.js';
import { adminCampus } from './admin/common.js';
import { footer } from './home.js';

const later = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b);

/** Marks what was just shown as read; returns the "read up to" time from before, to highlight new ones. */
function seen(res) {
  const before = later(readMarker(), res.readAt);
  if (res.items[0]) {
    sawLatest(res.items[0].createdAt);
    markAnnouncementsRead(res.items[0].createdAt);
  }
  return before;
}

const isNew = (a, readAt) => !readAt || new Date(a.createdAt) > new Date(readAt);

function item(a, { readAt, onDelete, showCampus } = {}) {
  return h('article', { class: `announcement${isNew(a, readAt) ? ' new' : ''}` },
    h('div', { class: 'row between' },
      h('div', { class: 'grow' },
        h('p', { class: 'overline' }, formatTime(a.createdAt), showCampus ? `  ·  ${a.campus || 'All campuses'}` : ''),
        h('h3', {}, a.title)),
      onDelete ? btn('', { icon: 'trash', class: 'small ghost danger', 'aria-label': 'Delete announcement', onclick: () => onDelete(a) }) : null),
    a.body ? h('p', { class: 'announcement-body' }, a.body) : null);
}

/** The Today screen's announcements card (the latest few), or null when there are none. */
export function announcementsCard(res) {
  if (!res?.items?.length && !session.boot.isAdmin) return null;
  const readAt = seen(res);
  const items = res.items.slice(0, 3);
  return h('section', { class: 'card announcements-card' },
    h('div', { class: 'section-head' },
      h('h2', {}, icon('megaphone', { size: 18 }), ' Announcements'),
      h('a', { href: '#/news' }, session.boot.isAdmin ? 'Post or see all' : res.items.length > items.length ? 'See all' : null)),
    items.length
      ? h('div', { class: 'announcement-list' }, items.map(a => item(a, { readAt })))
      : h('p', { class: 'muted small' }, 'No announcements yet. Post one for everyone to see here.'));
}

export async function announcements(root) {
  const res = await api.announcements(session.boot.isAdmin);
  const { items } = res;
  const readAt = seen(res);
  const list = h('div', { class: 'card announcement-list' });

  function draw() {
    list.replaceChildren(...items.map(a => item(a, { readAt, showCampus: session.boot.isAdmin, onDelete: session.boot.isAdmin ? remove : null })));
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
    const campus = adminCampus();
    let scope = 'all';
    const title = h('input', { type: 'text', maxlength: 80, required: true, placeholder: 'Title', 'aria-label': 'Announcement title' });
    const body = h('textarea', { maxlength: 2000, rows: 4, placeholder: 'What’s new? (optional)', 'aria-label': 'Announcement text' });
    const post = h('button', { type: 'submit', class: 'btn primary' }, 'Post');
    const who = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Who sees it' });
    const drawWho = () => who.replaceChildren(...[['all', 'All campuses'], ['campus', campus ? `Only ${campus.short}` : 'One campus']].map(([id, label]) =>
      h('button', { type: 'button', role: 'radio', class: 'seg', 'aria-checked': String(scope === id), 'aria-selected': String(scope === id), disabled: id === 'campus' && !campus,
        onclick: () => { scope = id; drawWho(); } }, label)));
    drawWho();
    return h('section', { class: 'card' },
      h('h2', {}, 'New announcement'),
      h('form', { onsubmit: async e => {
        e.preventDefault();
        post.disabled = true;
        try {
          const a = await api.admin.postAnnouncement(title.value, body.value, scope === 'campus' ? campus.id : null);
          items.unshift(a);
          title.value = '';
          body.value = '';
          draw();
          if (!a.campusId || a.campusId === currentCampus()?.id) { sawLatest(a.createdAt); markAnnouncementsRead(a.createdAt); }
          toast(a.campusId ? `Posted for ${a.campus} players` : 'Posted for every campus');
        } catch (err) { toast(err.message, 'error'); }
        finally { post.disabled = false; }
      } },
      h('div', { class: 'field' }, h('span', {}, 'Who sees it'), who,
        campus ? h('p', { class: 'small muted' }, `To post for another campus, change “Managing” on the Admin tab.`) : null),
      h('label', { class: 'field' }, h('span', {}, 'Title'), title),
      h('label', { class: 'field' }, h('span', {}, 'Message'), body),
      h('div', { class: 'row end' }, post)));
  }

  draw();
  root.append(
    pageHeader('Announcements', { back: '#/', sub: session.boot.isAdmin ? 'Every campus’s announcements. Players see the ones for all campuses and their own.' : 'News from the people who run CampusSpot.' }),
    session.boot.isAdmin ? composer() : null,
    list,
    footer());
}
