// Making a round: photo → where it was taken + camera direction → difficulty (→ release date).
// Admins publish directly on a chosen day. Contributors submit for review; an admin approves it
// and it's scheduled on the next open day.
import { api } from '../../api.js';
import { deletePhoto, photoUrl, uploadPhoto } from '../../backend.js';
import { card, difficultyPicker, headingControl, maxPointsText, pageHeader } from '../../components.js';
import { icon } from '../../icons.js';
import { createMapView } from '../../map/index.js';
import { dataUrlToBytes, fileToJpeg } from '../../photo.js';
import { scoring, session } from '../../session.js';
import { btn, formatDate, h, toast } from '../../ui.js';
import { adminCampus, adminNav, nextFreeDate } from './common.js';

export const adminHost = root => roundForm(root, { admin: true });
export const contributeNew = root => roundForm(root, { admin: false });

async function roundForm(root, { admin }) {
  const campus = admin ? adminCampus() : session.boot.campus;
  if (!campus) { location.replace('#/pick'); return; }
  const [maps, rounds] = await Promise.all([api.maps(campus.id), admin ? api.rounds(true, campus.id) : []]);
  const nav = () => (admin ? adminNav() : null);
  const today = session.boot.today;
  const state = {
    photo: null, map: maps.find(m => m.type === 'latlng') || maps[0], pos: null, heading: 0,
    difficulty: scoring().defaultDifficulty, date: nextFreeDate(rounds, today), title: '', bonus: null,
  };
  let view, editor;

  // 1. photo
  const preview = h('img', { class: 'preview', alt: 'Selected photo', hidden: true });
  const onFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      state.photo = await fileToJpeg(file);
      preview.src = state.photo;
      preview.hidden = false;
    } catch (err) { toast(err.message, 'error'); }
  };
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: onFile });
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: onFile });

  // 2. where + which way
  const box = h('div', { class: 'map-box' });
  const hint = h('p', { class: 'hint' });
  const heading = headingControl({ value: 0, onInput: deg => { state.heading = deg; editor.set({ heading: deg }); } });
  const mapSelect = maps.length > 1
    ? h('select', { 'aria-label': 'Map', onchange: e => useMap(maps.find(m => m.id === e.target.value)) },
      maps.map(m => h('option', { value: m.id, selected: m.id === state.map.id }, m.name)))
    : null;

  function useMap(map) {
    state.map = map;
    state.pos = null;
    view?.destroy();
    view = createMapView(box, map);
    hint.textContent = view.hints.place;
    editor = view.editPose({
      value: { pos: null, heading: state.heading }, color: 'var(--truth)', label: 'Camera',
      onChange: v => {
        state.pos = v.pos;
        state.heading = v.heading;
        heading.set(v.heading);
        hint.textContent = view.hints.adjust;
      },
    });
  }

  // 3–4. difficulty, date, title
  const maxText = h('p', { class: 'small muted' });
  const showMax = () => { maxText.textContent = maxPointsText(state.difficulty, state.bonus); };
  showMax();
  const difficulty = difficultyPicker({ value: state.difficulty, onChange: d => { state.difficulty = d; showMax(); } });

  // regular round (takes the day) or a bonus round (extra, on a day that has its regular round)
  const BONUS = [[null, 'Regular', 'The day’s round'], [1, 'Bonus 1×', 'Extra round, normal points'], [1.5, 'Bonus 1.5×', 'Extra round, 1.5× points'], [2, 'Bonus 2×', 'Extra round, double points'], [3, 'Bonus 3×', 'Extra round, triple points']];
  const typeBtns = BONUS.map(([value, label, sub]) => h('button', {
    type: 'button', class: 'type-option', 'aria-pressed': String(value === state.bonus),
    onclick: () => { if ((value == null) !== (state.bonus == null)) { state.date = value == null ? nextFreeDate(rounds, today) : today; date.value = state.date; } state.bonus = value; typeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(BONUS[i][0] === value))); showMax(); showTaken(); },
  }, h('strong', {}, label), h('span', { class: 'small muted' }, sub)));
  const typeCard = admin ? card(h('h2', {}, 'Round type'), h('div', { class: 'type-options' }, typeBtns),
    h('p', { class: 'small muted' }, 'Bonus rounds don’t use up a day. Players get one ranked try, and the points count toward the week and all-time boards.')) : null;
  const taken = h('p', { class: 'small muted' });
  const showTaken = () => {
    const regular = rounds.filter(r => r.date === state.date && r.bonus == null);
    const extra = rounds.filter(r => r.date === state.date && r.bonus != null);
    taken.textContent = state.bonus != null
      ? (regular.length ? `Joins ${formatDate(state.date, today).replace(/^(Today|Tomorrow|Yesterday)$/, w => w.toLowerCase())}’s round as a bonus.` : `Heads up: ${formatDate(state.date, today)} has no regular round yet.`)
      : regular.length ? `Heads up: ${formatDate(state.date, today)} already has a round. The newest one is shown that day.`
        : extra.length ? `${formatDate(state.date, today)} has ${extra.length} bonus round${extra.length === 1 ? '' : 's'}.` : '';
  };
  const date = h('input', { type: 'date', value: state.date, min: today, required: true, oninput: e => { state.date = e.target.value; showTaken(); } });
  const title = h('input', { type: 'text', maxlength: 80, placeholder: 'Optional, e.g. “Near the library”', oninput: e => (state.title = e.target.value) });
  showTaken();

  const saveBtn = h('button', { type: 'button', class: 'btn primary block' }, icon('check'), h('span', {}, 'Save round'));
  saveBtn.addEventListener('click', async () => {
    if (!state.photo) return toast('Add a photo first', 'error');
    if (!state.pos) return toast('Tap the map where the photo was taken', 'error');
    if (admin && !state.date) return toast('Pick a release date', 'error');
    saveBtn.disabled = true;
    saveBtn.lastChild.textContent = 'Uploading photo…';
    const photoPath = `${crypto.randomUUID()}.jpg`; // random name: scheduled photos can't be guessed
    let uploaded = false;
    try {
      const bytes = dataUrlToBytes(state.photo);
      await uploadPhoto(photoPath, bytes, 'image/jpeg');
      uploaded = true;
      saveBtn.lastChild.textContent = 'Saving…';
      const input = {
        mapId: state.map.id, photoPath, truth: { pos: state.pos, heading: state.heading },
        difficulty: state.difficulty, title: state.title,
      };
      const round = admin ? await api.admin.createRound({ ...input, date: state.date, bonus: state.bonus }) : await api.submitRound(input);
      done(round);
    } catch (err) {
      if (uploaded) deletePhoto(photoPath).catch(() => {});
      toast(err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.lastChild.textContent = admin ? 'Save round' : 'Submit for review';
    }
  });

  function done(round) {
    view.destroy();
    view = null;
    const again = admin ? '#/admin/new' : '#/contribute/new';
    const back = admin ? '#/admin' : '#/contribute';
    root.replaceChildren(...[nav(), pageHeader(admin ? 'Round saved' : 'Submitted for review'), card(
      h('img', { class: 'preview', src: photoUrl(round.photoPath), alt: '' }),
      h('p', {}, !admin ? 'Thanks! An admin will review it. Once approved, it’s scheduled for the next open day.'
        : round.bonus != null ? (round.date === today ? 'It’s live now as a bonus round.' : `It goes live as a bonus round on ${formatDate(round.date, today)}.`)
        : round.date === today ? 'It’s live now as today’s round.' : `It goes live on ${formatDate(round.date, today)} (campus time).`),
      h('div', { class: 'row wrap' },
        btn(admin ? 'All rounds' : 'Your submissions', { href: back, class: 'primary' }),
        btn(admin ? 'Make another' : 'Submit another', { onclick: () => { location.hash = back; setTimeout(() => (location.hash = again), 0); } })))].filter(Boolean));
  }

  if (!admin) saveBtn.lastChild.textContent = 'Submit for review';
  root.append(
    nav(),
    admin ? pageHeader(`New round at ${campus.short}`, { sub: 'Only admins can see this page.' })
      : pageHeader(`Submit a photo of ${campus.short}`, { back: '#/contribute', sub: 'Photos are reviewed by an admin before they’re scheduled.' }),
    card(
      h('h2', {}, '1. Photo'),
      h('div', { class: 'row wrap' },
        btn('Take photo', { icon: 'camera', onclick: () => camInput.click() }),
        btn('Choose photo', { icon: 'image', onclick: () => fileInput.click() })),
      h('p', { class: 'small muted' }, 'Avoid people’s faces, license plates, ID cards and room numbers. Location data in the file is removed.'),
      camInput, fileInput, preview),
    card(h('h2', {}, '2. Where was it taken?'), mapSelect, hint),
    box,
    card(h('h2', {}, 'Camera direction'), heading.el),
    card(h('h2', {}, '3. Difficulty'), difficulty.el, maxText),
    typeCard,
    admin ? card(
      h('h2', {}, '4. Release'),
      h('label', { class: 'field' }, h('span', {}, 'Goes live on (midnight, campus time)'), date),
      taken,
      h('label', { class: 'field' }, h('span', {}, 'Title'), title))
      : card(h('h2', {}, '4. Title'), h('label', { class: 'field' }, h('span', {}, 'Optional'), title)),
    h('div', { class: 'sticky-actions' }, saveBtn),
  );
  useMap(state.map);
  return () => view?.destroy();
}
