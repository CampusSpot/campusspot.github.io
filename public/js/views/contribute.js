// Contribute photos: ask for access, then submit photos and follow their review.
import { api } from '../api.js';
import { pageHeader, roundSummary } from '../components.js';
import { ensureName, googleButton, refreshSession, session } from '../session.js';
import { btn, formatDate, h, toast } from '../ui.js';
import { footer } from './home.js';

const STATUS = {
  pending: ['Waiting for review', ''],
  stored: ['Approved', 'ok'],
  published: ['Approved', 'ok'],
  rejected: ['Not accepted', 'no'],
};

export async function contribute(root) {
  const { user, boot } = session;
  root.append(pageHeader('Contribute photos', { sub: 'Help keep a new photo up every day.' }));

  if (!user) {
    root.append(h('section', { class: 'card stack' },
      h('p', {}, 'Contributors take photos around campus and submit them with the answer. Sign in to ask for access.'),
      googleButton('Sign in with Google')), footer());
    return;
  }

  const status = boot.isAdmin ? 'approved' : boot.contributor;
  if (status !== 'approved') {
    root.append(requestCard(status), footer());
    return;
  }

  const subs = await api.mySubmissions();
  root.append(
    h('section', { class: 'card' },
      h('p', {}, 'Take a photo somewhere on campus, mark where you stood and which way you faced, and submit it. An admin reviews each photo; approved photos are scheduled for the next open day.'),
      h('p', { class: 'small muted' }, 'Avoid people’s faces, license plates, ID cards and room numbers, and stay out of closed areas. You won’t be ranked on your own photos.'),
      btn('Submit a photo', { href: '#/contribute/new', class: 'primary' })),
    h('h2', { class: 'section-title' }, `Your submissions (${subs.length})`),
    subs.length
      ? h('ul', { class: 'round-list' }, subs.map(r => {
        const [label, cls] = STATUS[r.status] || [r.status, ''];
        return h('li', { class: 'round' }, ...roundSummary(r, { extra: h('span', { class: 'small' },
          h('span', { class: `status ${cls}` }, label),
          r.status === 'published' && r.date ? ` · ${r.date === boot.today ? 'live today' : `${r.date < boot.today ? 'went live' : 'goes live'} ${formatDate(r.date, boot.today)}`}` : '',
          r.status === 'stored' ? ' · saved for a future day' : '',
          r.status === 'rejected' && r.reviewNote ? ` · “${r.reviewNote}”` : '') }));
      }))
      : h('p', { class: 'muted empty' }, 'Nothing submitted yet.'),
    footer());
}

function requestCard(status) {
  const card = h('section', { class: 'card' });
  if (status === 'pending') {
    card.append(h('h2', {}, 'Request sent'), h('p', { class: 'muted' }, 'An admin will review your request. Check back here soon.'));
    return card;
  }
  const note = h('textarea', { maxlength: 300, rows: 3, placeholder: 'Optional: tell us a bit about yourself (e.g. your major, or which parts of campus you know well)', 'aria-label': 'Note to the admins' });
  const send = btn('Ask to contribute', { class: 'primary' });
  send.addEventListener('click', async () => {
    if (!(await ensureName({ reason: 'Contributors need a leaderboard name too.' }))) return;
    send.disabled = true;
    try {
      await api.requestContributor(note.value);
      await refreshSession();
      toast('Request sent');
    } catch (err) { toast(err.message, 'error'); send.disabled = false; }
  });
  card.append(
    h('h2', {}, 'Become a contributor'),
    status === 'denied' ? h('p', { class: 'notice' }, 'Your last request wasn’t approved. You’re welcome to ask again.') : null,
    h('p', {}, 'Contributors submit photos of campus with the answer. Admins approve contributors, then review each photo before it’s scheduled.'),
    note, send);
  return card;
}
