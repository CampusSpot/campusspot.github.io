// Admin: every round, including scheduled ones. The next two weeks at a glance, edit, preview, delete.
import { api } from '../../api.js';
import { deletePhoto } from '../../backend.js';
import { difficultyPicker, pageHeader, roundSummary } from '../../components.js';
import { createMapView } from '../../map/index.js';
import { session } from '../../session.js';
import { btn, confirmDialog, formatDate, h, modal, toast } from '../../ui.js';
import { addDays, adminCampus, adminNav } from './common.js';

export async function adminRounds(root) {
  const today = session.boot.today;
  const campus = adminCampus();
  const [rounds, maps] = await Promise.all([api.rounds(true, campus.id), api.maps(campus.id)]);
  const byDate = new Map();
  for (const r of rounds) if (!byDate.has(r.date)) byDate.set(r.date, r);

  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const week = h('div', { class: 'schedule' }, days.map(d => {
    const r = byDate.get(d);
    const label = new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
    return h('a', { class: `day${r ? ' has' : ''}${d === today ? ' today' : ''}`, href: r ? `#/admin` : '#/admin/new', title: r ? r.title || 'Round' : 'No round yet: tap to make one' },
      h('span', {}, label), h('i', { 'aria-label': r ? 'has a round' : 'empty' }, r ? '✓' : '+'));
  }));
  const gaps = days.filter(d => !byDate.has(d)).length;

  const section = (title, list) => list.length ? [h('h2', { class: 'section-title' }, title), h('ul', { class: 'round-list' }, list.map(row))] : [];

  function row(r) {
    const status = r.date > today ? 'Scheduled' : r.date === today ? 'Live now' : `${r.plays} played`;
    return h('li', { class: 'round' },
      ...roundSummary(r, { extra: h('span', { class: 'small muted' }, status, r.date > today ? '' : ` · ${r.plays} ranked`) }),
      h('div', { class: 'round-actions' },
        btn('Answer', { icon: 'eye', class: 'small', onclick: () => preview(r) }),
        btn('Edit', { icon: 'edit', class: 'small', onclick: () => edit(r) }),
        btn('', { icon: 'trash', class: 'small danger', 'aria-label': 'Delete round', onclick: () => remove(r) })));
  }

  async function preview(r) {
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
      return [h('h2', {}, r.title || formatDate(r.date, today)), box, h('div', { class: 'row end' }, btn('Close', { onclick: () => close() }))];
    }, { label: 'Answer preview' });
  }

  async function edit(r) {
    const saved = await modal(close => {
      const title = h('input', { type: 'text', maxlength: 80, value: r.title });
      const date = h('input', { type: 'date', value: r.date, required: true });
      const diff = difficultyPicker({ value: r.difficulty });
      return h('form', { onsubmit: async e => {
        e.preventDefault();
        try { close(await api.admin.updateRound(r.id, { title: title.value, date: date.value, difficulty: diff.get() })); } catch (err) { toast(err.message, 'error'); }
      } },
      h('h2', {}, 'Edit round'),
      h('label', { class: 'field' }, h('span', {}, 'Title'), title),
      h('label', { class: 'field' }, h('span', {}, 'Goes live on'), date),
      r.plays ? h('p', { class: 'small muted' }, 'People have already played this round; moving it changes which day their scores count for.') : null,
      h('div', { class: 'field' }, h('span', {}, 'Difficulty'), diff.el),
      h('div', { class: 'row end' }, btn('Cancel', { class: 'ghost', onclick: () => close() }), h('button', { type: 'submit', class: 'btn primary' }, 'Save')));
    }, { label: 'Edit round' });
    if (saved) { toast('Saved'); rerender(); }
  }

  async function remove(r) {
    const ok = await confirmDialog('Delete this round?', `Its photo and ${r.plays} leaderboard score${r.plays === 1 ? '' : 's'} will be removed for good.`, { ok: 'Delete', danger: true });
    if (!ok) return;
    try {
      const path = await api.admin.deleteRound(r.id);
      await deletePhoto(path).catch(() => {});
      toast('Deleted');
      rerender();
    } catch (err) { toast(err.message, 'error'); }
  }

  const rerender = () => { root.replaceChildren(); adminRounds(root); };

  root.append(
    adminNav(),
    pageHeader(`${campus.short} rounds`, { sub: 'One photo per day at each campus. Rounds go live at midnight.', actions: btn('New', { href: '#/admin/new', icon: 'plus', class: 'primary small' }) }),
    h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', {}, 'Next 14 days'), h('span', { class: `small ${gaps ? 'warn' : 'muted'}` }, gaps ? `${gaps} day${gaps === 1 ? '' : 's'} without a round` : 'All filled')),
      week),
    ...section('Scheduled', rounds.filter(r => r.date > today).reverse()),
    ...section('Today', rounds.filter(r => r.date === today)),
    ...section('Past', rounds.filter(r => r.date < today)),
    rounds.length ? null : h('div', { class: 'empty-state' }, h('p', { class: 'muted' }, 'No rounds yet.'), btn('Make the first one', { href: '#/admin/new', icon: 'camera', class: 'primary' })),
  );
}

