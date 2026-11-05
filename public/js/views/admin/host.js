// Admin: make a new round. Photo → where it was taken + camera direction → difficulty → release date.
import { api } from '../../api.js';
import { deletePhoto, photoUrl, uploadPhoto } from '../../backend.js';
import { card, compassControl, difficultyPicker, headingControl, maxPointsText, pageHeader } from '../../components.js';
import { icon } from '../../icons.js';
import { createMapView } from '../../map/index.js';
import { dataUrlToBytes, fileToJpeg } from '../../photo.js';
import { scoring, session } from '../../session.js';
import { btn, formatDate, h, toast } from '../../ui.js';
import { adminNav, nextFreeDate } from './common.js';

export async function adminHost(root) {
  const [maps, rounds] = await Promise.all([api.maps(), api.rounds(true)]);
  const today = session.boot.today;
  const state = {
    photo: null, map: maps.find(m => m.type === 'latlng') || maps[0], pos: null, heading: 0,
    difficulty: scoring().defaultDifficulty, date: nextFreeDate(rounds, today), title: '',
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
  const compass = compassControl({
    offset: () => state.map.topBearing ?? 0,
    onHeading: deg => { state.heading = deg; heading.set(deg); editor.set({ heading: deg }); },
  });
  const compassNote = h('p', { class: 'small muted' });
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
    compassNote.textContent = map.type === 'latlng'
      ? 'North is up on this map, so compass readings are used as they are.'
      : map.topBearing == null
        ? 'Compass assumes the top of this floor plan faces north. Set the real direction under Maps → Compass alignment.'
        : `Top of this map faces ${Math.round(map.topBearing)}°.`;
  }

  // 3–4. difficulty, date, title
  const maxText = h('p', { class: 'small muted' }, maxPointsText(state.difficulty));
  const difficulty = difficultyPicker({ value: state.difficulty, onChange: d => { state.difficulty = d; maxText.textContent = maxPointsText(d); } });
  const taken = h('p', { class: 'small muted' });
  const showTaken = () => {
    const clash = rounds.filter(r => r.date === state.date);
    taken.textContent = clash.length ? `Heads up: ${formatDate(state.date, today)} already has a round. The newest one is shown that day.` : '';
  };
  const date = h('input', { type: 'date', value: state.date, min: today, required: true, oninput: e => { state.date = e.target.value; showTaken(); } });
  const title = h('input', { type: 'text', maxlength: 80, placeholder: 'Optional, e.g. “Near the library”', oninput: e => (state.title = e.target.value) });
  showTaken();

  const saveBtn = h('button', { type: 'button', class: 'btn primary block' }, icon('check'), h('span', {}, 'Save round'));
  saveBtn.addEventListener('click', async () => {
    if (!state.photo) return toast('Add a photo first', 'error');
    if (!state.pos) return toast('Tap the map where the photo was taken', 'error');
    if (!state.date) return toast('Pick a release date', 'error');
    saveBtn.disabled = true;
    saveBtn.lastChild.textContent = 'Uploading photo…';
    const photoPath = `${crypto.randomUUID()}.jpg`; // random name: scheduled photos can't be guessed
    let uploaded = false;
    try {
      compass.stop();
      const bytes = dataUrlToBytes(state.photo);
      await uploadPhoto(photoPath, bytes, 'image/jpeg');
      uploaded = true;
      saveBtn.lastChild.textContent = 'Saving…';
      const round = await api.admin.createRound({
        mapId: state.map.id, photoPath, truth: { pos: state.pos, heading: state.heading },
        difficulty: state.difficulty, date: state.date, title: state.title,
      });
      done(round);
    } catch (err) {
      if (uploaded) deletePhoto(photoPath).catch(() => {});
      toast(err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.lastChild.textContent = 'Save round';
    }
  });

  function done(round) {
    view.destroy();
    view = null;
    root.replaceChildren(adminNav(), pageHeader('Round saved'), card(
      h('img', { class: 'preview', src: photoUrl(round.photoPath), alt: '' }),
      h('p', {}, round.date === today ? 'It’s live now as today’s round.' : `It goes live on ${formatDate(round.date, today)} (campus time).`),
      h('div', { class: 'row wrap' },
        btn('All rounds', { href: '#/admin', icon: 'calendar', class: 'primary' }),
        btn('Make another', { icon: 'plus', onclick: () => { location.hash = '#/admin'; setTimeout(() => (location.hash = '#/admin/new'), 0); } }))));
  }

  root.append(
    adminNav(),
    pageHeader('New round', { sub: 'Only admins can see this page.' }),
    card(
      h('h2', {}, '1. Photo'),
      h('div', { class: 'row wrap' },
        btn('Take photo', { icon: 'camera', onclick: () => camInput.click() }),
        btn('Choose photo', { icon: 'image', onclick: () => fileInput.click() })),
      h('p', { class: 'small muted' }, 'Avoid people’s faces, license plates, ID cards and room numbers. Location data in the file is removed.'),
      camInput, fileInput, preview),
    card(h('h2', {}, '2. Where was it taken?'), mapSelect, hint),
    box,
    card(h('h2', {}, 'Camera direction'), heading.el, compass.el, compassNote),
    card(h('h2', {}, '3. Difficulty'), difficulty.el, maxText),
    card(
      h('h2', {}, '4. Release'),
      h('label', { class: 'field' }, h('span', {}, 'Goes live on (midnight, campus time)'), date),
      taken,
      h('label', { class: 'field' }, h('span', {}, 'Title'), title)),
    h('div', { class: 'sticky-actions' }, saveBtn),
  );
  useMap(state.map);
  return () => { compass.stop(); view?.destroy(); };
}
