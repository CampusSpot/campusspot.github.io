// Admin: review contributors' photos. Approve → next open day, a chosen day, or storage (schedule
// later). Reject → the contributor sees the reason and the photo is deleted.
import { api } from '../../api.js';
import { deletePhoto, photoUrl } from '../../backend.js';
import { difficultyBadge, pageHeader } from '../../components.js';
import { createMapView } from '../../map/index.js';
import { session } from '../../session.js';
import { btn, formatDate, formatTime, h, modal, toast } from '../../ui.js';
import { adminNav, nextFreeDate } from './common.js';

export async function adminReview(root) {
  const [items, maps, rounds] = await Promise.all([api.admin.reviewQueue(), api.maps(), api.rounds(true)]);
  const today = session.boot.today;
  const header = h('div');
  const waitingList = h('ul', { class: 'review-list' });
  const storedList = h('ul', { class: 'review-list' });
  const storedSection = h('section', {}, h('h2', { class: 'section-title' }, 'In storage'),
    h('p', { class: 'small muted' }, 'Approved photos without a day yet. Schedule one whenever you need it.'), storedList);

  const item = r => h('li', { class: 'card review-item' },
    h('img', { class: 'preview', src: photoUrl(r.photoPath), alt: 'Submitted photo' }),
    h('div', { class: 'review-meta' },
      h('strong', {}, r.title || 'Untitled'), ' ', difficultyBadge(r.difficulty),
      h('div', { class: 'small muted' }, `By ${r.submittedBy}${r.submitterEmail ? ` (${r.submitterEmail})` : ''} · ${formatTime(r.createdAt)}`)),
    h('div', { class: 'row wrap' },
      btn('Check answer', { onclick: () => showAnswer(r) }),
      btn(r.status === 'stored' ? 'Schedule' : 'Approve', { class: 'primary', onclick: () => approve(r) }),
      btn(r.status === 'stored' ? 'Delete' : 'Reject', { class: 'danger', onclick: () => reject(r) })));

  function render() {
    const waiting = items.filter(r => r.status === 'pending');
    const stored = items.filter(r => r.status === 'stored');
    waitingList.replaceChildren(...waiting.map(item));
    if (!waiting.length) waitingList.append(h('li', { class: 'muted empty' }, 'Nothing waiting for review.'));
    storedList.replaceChildren(...stored.map(item));
    storedSection.hidden = !stored.length;
    header.replaceChildren(pageHeader('Review', { sub: `${waiting.length} photo${waiting.length === 1 ? '' : 's'} waiting${stored.length ? ` · ${stored.length} in storage` : ''}.` }));
  }
  const drop = r => { items.splice(items.indexOf(r), 1); render(); };

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

  // Returns { when: 'next' | 'date' | 'store', date } or null if cancelled.
  function pickWhen(r) {
    const next = nextFreeDate(rounds, today);
    return modal(close => {
      let when = 'next';
      const date = h('input', { type: 'date', min: today, value: next, 'aria-label': 'Day', disabled: true });
      const clash = h('p', { class: 'small muted' });
      const checkClash = () => {
        clash.textContent = when === 'date' && rounds.some(x => x.date === date.value)
          ? `${formatDate(date.value, today)} already has a round. The newest one is shown that day.` : '';
      };
      date.addEventListener('input', checkClash);
      const option = (value, label, sub, extra) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'when', value, checked: value === when,
          onchange: () => { when = value; date.disabled = when !== 'date'; checkClash(); } }),
        h('span', {}, h('strong', {}, label), h('span', { class: 'small muted' }, sub), extra));
      return h('form', { onsubmit: e => {
        e.preventDefault();
        if (when === 'date' && !date.value) return toast('Pick a day', 'error');
        close({ when, date: date.value });
      } },
        h('h2', {}, r.status === 'stored' ? 'Schedule this photo' : 'Approve this photo'),
        h('div', { class: 'choices' },
          option('next', 'Next open day', formatDate(next, today)),
          option('date', 'Pick a day', 'Choose any day from today on', h('span', {}, date, clash)),
          r.status === 'stored' ? null : option('store', 'Save for later', 'Approve now, pick a day later')),
        h('div', { class: 'row end' }, btn('Cancel', { class: 'ghost', onclick: () => close(null) }),
          h('button', { type: 'submit', class: 'btn primary' }, r.status === 'stored' ? 'Schedule' : 'Approve')));
    }, { label: 'Approve photo' });
  }

  async function approve(r) {
    const choice = await pickWhen(r);
    if (!choice) return;
    try {
      if (choice.when === 'store') {
        Object.assign(r, await api.admin.store(r.id));
        render();
        toast('Approved and saved for later');
        return;
      }
      const done = await api.admin.approve(r.id, choice.when === 'date' ? choice.date : null);
      rounds.push(done);
      drop(r);
      toast(done.date === today ? 'Approved. It’s live now as today’s round.' : `Scheduled for ${formatDate(done.date, today)}.`);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function reject(r) {
    const stored = r.status === 'stored';
    const note = await modal(close => {
      const input = h('textarea', { maxlength: 300, rows: 3, placeholder: 'e.g. Too blurry, or shows a person’s face', 'aria-label': 'Reason' });
      return h('form', { onsubmit: e => { e.preventDefault(); close(input.value.trim()); } },
        h('h2', {}, stored ? 'Delete this photo?' : 'Reject this photo?'),
        h('p', { class: 'muted small' }, 'The contributor sees this reason. The photo is deleted.'),
        input,
        h('div', { class: 'row end' }, btn('Cancel', { class: 'ghost', onclick: () => close(null) }),
          h('button', { type: 'submit', class: 'btn danger solid' }, stored ? 'Delete' : 'Reject')));
    }, { label: 'Reject photo' });
    if (note == null) return;
    try {
      const path = await api.admin.reject(r.id, note);
      deletePhoto(path).catch(() => {});
      drop(r);
      toast(stored ? 'Deleted' : 'Rejected');
    } catch (err) { toast(err.message, 'error'); }
  }

  render();
  root.append(adminNav(), header, waitingList, storedSection);
}
