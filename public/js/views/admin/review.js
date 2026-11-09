// Admin: review contributors' photos. Approve → scheduled on the next open day; reject → the
// contributor sees the reason and the photo is deleted.
import { api } from '../../api.js';
import { deletePhoto, photoUrl } from '../../backend.js';
import { difficultyBadge, pageHeader } from '../../components.js';
import { createMapView } from '../../map/index.js';
import { session } from '../../session.js';
import { btn, formatDate, formatTime, h, modal, toast } from '../../ui.js';
import { adminNav } from './common.js';

export async function adminReview(root) {
  const [queue, maps] = await Promise.all([api.admin.reviewQueue(), api.maps()]);
  const list = h('ul', { class: 'review-list' });

  function render() {
    list.replaceChildren(...queue.map(r => h('li', { class: 'card review-item' },
      h('img', { class: 'preview', src: photoUrl(r.photoPath), alt: 'Submitted photo' }),
      h('div', { class: 'review-meta' },
        h('strong', {}, r.title || 'Untitled'), ' ', difficultyBadge(r.difficulty),
        h('div', { class: 'small muted' }, `By ${r.submittedBy}${r.submitterEmail ? ` (${r.submitterEmail})` : ''} · ${formatTime(r.createdAt)}`)),
      h('div', { class: 'row wrap' },
        btn('Check answer', { onclick: () => showAnswer(r) }),
        btn('Approve', { class: 'primary', onclick: () => approve(r) }),
        btn('Reject', { class: 'danger', onclick: () => reject(r) })))));
    if (!queue.length) list.append(h('li', { class: 'muted empty' }, 'Nothing waiting for review.'));
  }

  async function showAnswer(r) {
    const answer = await api.admin.answer(r.id);
    const map = maps.find(m => m.id === r.mapId);
    await modal(close => {
      const box = h('div', { class: 'map-box' });
      setTimeout(() => {
        const view = createMapView(box, map);
        view.setPoses([{ id: 't', ...answer, color: 'var(--truth)', label: 'Answer' }]);
        view.focus([answer.pos]);
        box.closest('dialog').addEventListener('close', () => view.destroy());
      });
      return [h('h2', {}, 'Where they say it was taken'), box, h('div', { class: 'row end' }, btn('Close', { onclick: () => close() }))];
    }, { label: 'Answer' });
  }

  async function approve(r) {
    try {
      const done = await api.admin.approve(r.id);
      queue.splice(queue.indexOf(r), 1);
      render();
      toast(done.date === session.boot.today ? 'Approved. It’s live now as today’s round.' : `Approved. Goes live ${formatDate(done.date, session.boot.today)}.`);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function reject(r) {
    const note = await modal(close => {
      const input = h('textarea', { maxlength: 300, rows: 3, placeholder: 'e.g. Too blurry, or shows a person’s face', 'aria-label': 'Reason' });
      return h('form', { onsubmit: e => { e.preventDefault(); close(input.value.trim()); } },
        h('h2', {}, 'Reject this photo?'),
        h('p', { class: 'muted small' }, 'The contributor sees this reason. The photo is deleted.'),
        input,
        h('div', { class: 'row end' }, btn('Cancel', { class: 'ghost', onclick: () => close(null) }), h('button', { type: 'submit', class: 'btn danger solid' }, 'Reject')));
    }, { label: 'Reject photo' });
    if (note == null) return;
    try {
      const path = await api.admin.reject(r.id, note);
      deletePhoto(path).catch(() => {});
      queue.splice(queue.indexOf(r), 1);
      render();
      toast('Rejected');
    } catch (err) { toast(err.message, 'error'); }
  }

  render();
  root.append(adminNav(), pageHeader('Review', { sub: `${queue.length} photo${queue.length === 1 ? '' : 's'} waiting. Approved photos go to the next open day.` }), list);
}
