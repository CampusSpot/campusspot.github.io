// Playing a round: full-screen photo ↔ map. Tap to place, aim, submit.
// Today's round needs a signed-in player with a name and allows one try; past rounds are practice.
import { api } from '../api.js';
import { photoUrl } from '../backend.js';
import { difficultyBadge, headingControl, maxPointsText } from '../components.js';
import { icon } from '../icons.js';
import { createMapView } from '../map/index.js';
import { ensureName, session } from '../session.js';
import { btn, confirmDialog, formatDate, h, toast } from '../ui.js';
import { rememberResult } from './result.js';

export async function playToday(root) {
  const today = await api.today();
  if (today) return location.replace(`#/play/${today.id}`);
  location.replace('#/');
}

export async function play(root, id) {
  const { round, map, isToday } = await api.round(id);

  // today's round: sign in, have a name, and only once
  if (isToday && round.mine?.played) return location.replace(`#/result/${round.id}`);
  const guest = !session.user;
  if (isToday && !guest && !(await ensureName({ reason: 'Pick the name shown next to your score on the leaderboard.' }))) {
    return location.replace('#/');
  }

  let guess = { pos: null, heading: 0 };
  const wrap = h('div', { class: 'play', 'data-view': 'photo' });
  const show = v => { wrap.dataset.view = v; };
  const src = photoUrl(round.photoPath);

  // photo pane
  const img = h('img', { class: 'photo', src, alt: 'Where was this photo taken?' });
  const scroller = h('div', { class: 'photo-scroll', onclick: () => scroller.classList.toggle('zoomed') }, img);
  const info = h('div', { class: 'overlay-top' },
    h('a', { class: 'icon-btn', href: isToday ? '#/' : '#/archive', 'aria-label': 'Leave round' }, icon('x')),
    h('div', { class: 'overlay-info' },
      h('strong', {}, round.title || (isToday ? 'Today’s round' : formatDate(round.date, session.boot.today))), ' ', difficultyBadge(round.difficulty),
      h('div', { class: 'small' }, isToday && !guest ? `${maxPointsText(round.difficulty)} · one try` : isToday ? 'Playing as a guest · not saved' : 'Practice round · not on the leaderboard')));
  const photoPane = h('section', { class: 'pane photo-pane' }, scroller, info,
    h('div', { class: 'overlay-bottom' },
      h('span', { class: 'small hint-light' }, icon('zoom', { size: 16 }), ' Tap photo to zoom'),
      btn('Guess on map', { icon: 'map', class: 'primary', onclick: () => show('map') })));

  // map pane
  const box = h('div', { class: 'map-box fill' });
  const hint = h('p', { class: 'hint' });
  const submit = h('button', { type: 'button', class: 'btn primary grow', disabled: true }, icon('check'), h('span', {}, 'Submit guess'));
  const heading = headingControl({ value: 0, onInput: deg => { guess.heading = deg; editor.set({ heading: deg }); } });
  const mapPane = h('section', { class: 'pane map-pane' },
    h('div', { class: 'map-head' },
      h('button', { type: 'button', class: 'icon-btn ghost', 'aria-label': 'Back to photo', onclick: () => show('photo') }, icon('back')),
      hint),
    h('div', { class: 'map-stage' }, box,
      h('button', { type: 'button', class: 'peek', 'aria-label': 'Show photo', onclick: () => show('photo') }, h('img', { src, alt: '' }))),
    h('div', { class: 'map-controls' },
      heading.el,
      h('div', { class: 'row' }, btn('Photo', { icon: 'image', onclick: () => show('photo') }), submit)));

  wrap.append(photoPane, mapPane);
  root.append(wrap);

  const view = createMapView(box, map);
  hint.textContent = view.hints.place;
  const editor = view.editPose({
    value: guess, color: 'var(--guess)', label: 'You',
    onChange: v => {
      guess = v;
      heading.set(v.heading);
      submit.disabled = !v.pos;
      hint.textContent = view.hints.adjust;
    },
  });

  submit.addEventListener('click', async () => {
    if (!guess.pos) return;
    if (isToday && !guest && !(await confirmDialog('Submit your guess?', 'You get one try at today’s round.', { ok: 'Submit' }))) return;
    submit.disabled = true;
    submit.lastChild.textContent = 'Scoring…';
    try {
      const res = await api.guess(round.id, guess);
      rememberResult(res);
      location.hash = `#/result/${round.id}`;
    } catch (err) {
      if (err.hint === 'needs_name') { await ensureName(); }
      toast(err.message, 'error');
      submit.disabled = false;
      submit.lastChild.textContent = 'Submit guess';
    }
  });

  return () => view.destroy();
}
