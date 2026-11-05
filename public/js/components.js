// Reusable pieces of UI shared by several views.
import { norm360 } from '../shared/geo.js';
import { maxScore } from '../shared/scoring.js';
import { photoUrl } from './backend.js';
import { startCompass } from './compass.js';
import { icon } from './icons.js';
import { scoring, session } from './session.js';
import { formatDate, h, points } from './ui.js';

/** Page heading with an optional back link and actions on the right. */
export function pageHeader(title, { back, sub, actions } = {}) {
  return h('header', { class: 'page-head' },
    back ? h('a', { class: 'icon-btn ghost', href: back, 'aria-label': 'Back' }, icon('back')) : null,
    h('div', { class: 'grow' }, h('h1', {}, title), sub ? h('p', { class: 'muted small' }, sub) : null),
    actions || null);
}

export const card = (...children) => h('section', { class: 'card' }, ...children);

export function difficultyBadge(key) {
  const d = scoring().difficulties[key];
  return h('span', { class: `badge diff-${key}` }, d ? d.label : key);
}

export const maxPointsText = difficulty => `max ${points(maxScore(difficulty, scoring()))} pts`;

/** Photo thumbnail + title + date + difficulty, used in lists. */
export function roundSummary(r, { extra } = {}) {
  return [
    h('img', { class: 'thumb', src: photoUrl(r.photoPath), alt: '', loading: 'lazy' }),
    h('div', { class: 'round-info' },
      h('strong', {}, r.title || formatDate(r.date, session.boot.today)),
      h('span', { class: 'small muted' }, r.title ? formatDate(r.date, session.boot.today) : null, r.title ? ' · ' : null, difficultyBadge(r.difficulty)),
      extra || null),
  ];
}

/** Heading slider with ±5° nudge buttons. onInput(deg) fires as the user changes it. */
export function headingControl({ value = 0, onInput }) {
  let cur = Math.round(value);
  const range = h('input', { type: 'range', min: 0, max: 359, step: 1, value: cur, 'aria-label': 'Facing direction in degrees' });
  const out = h('output', { class: 'heading-val' });
  const arrow = h('span', { class: 'heading-arrow', 'aria-hidden': 'true' }, '↑');
  const show = () => {
    range.value = cur;
    out.textContent = `${cur}°`;
    arrow.style.transform = `rotate(${cur}deg)`;
  };
  const set = v => { cur = Math.round(norm360(v)) % 360; show(); };
  const change = v => { set(v); onInput?.(cur); };
  range.addEventListener('input', () => change(+range.value));
  show();
  const el = h('div', { class: 'heading-ctl' },
    h('button', { type: 'button', class: 'nudge', 'aria-label': 'Rotate left 5 degrees', onclick: () => change(cur - 5) }, '⟲'),
    range,
    h('button', { type: 'button', class: 'nudge', 'aria-label': 'Rotate right 5 degrees', onclick: () => change(cur + 5) }, '⟳'),
    h('span', { class: 'heading-read' }, arrow, out));
  return { el, set };
}

/** Easy / Hard / Nighttime / Impossible chips. */
export function difficultyPicker({ value, onChange }) {
  const el = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Difficulty' });
  const render = () => {
    const cfg = scoring();
    el.replaceChildren(...Object.entries(cfg.difficulties).map(([key, d]) =>
      h('button', {
        type: 'button', class: `chip diff-${key}`, role: 'radio', 'aria-checked': String(key === value),
        onclick: () => { value = key; render(); onChange?.(key); },
      }, d.label, cfg.useDifficultyMultiplier && d.multiplier !== 1 ? h('small', {}, `×${d.multiplier}`) : null)));
  };
  render();
  return { el, get: () => value };
}

/**
 * "Use phone compass" button. While live, onHeading(deg) fires as the phone turns; tap again to lock.
 * offset() returns the compass bearing of the map's top edge (subtracted from readings).
 */
export function compassControl({ label = 'Use phone compass', offset = () => 0, onHeading, onStop }) {
  let stop = null;
  const text = h('span', {}, label);
  const button = h('button', { type: 'button', class: 'btn' }, icon('compass'), text);
  const status = h('p', { class: 'small muted', 'aria-live': 'polite' });
  const end = () => { stop?.(); stop = null; text.textContent = label; button.classList.remove('live'); };

  button.addEventListener('click', () => {
    if (stop) { end(); status.textContent = 'Direction locked. Fine-tune it with the slider if needed.'; onStop?.(); return; }
    status.textContent = 'Starting compass…';
    startCompass(deg => {
      const mapDeg = Math.round(norm360(deg - (offset() || 0)));
      status.textContent = `Compass ${deg}° → map ${mapDeg}°. Hold the phone the way you took the photo, then tap Lock.`;
      onHeading(mapDeg, deg);
    }).then(s => {
      stop = s;
      text.textContent = 'Lock direction';
      button.classList.add('live');
    }).catch(err => {
      status.replaceChildren(err.message);
      if (!window.isSecureContext) {
        const httpsUrl = window.POLYSPOT_LOCAL?.urls?.https?.find(u => u.includes(location.hostname));
        status.append(' ', httpsUrl
          ? h('a', { href: httpsUrl + location.pathname + location.hash }, 'Open the HTTPS version')
          : 'On the published site (https) this works automatically.',
        ' You can always set the direction by hand.');
      }
    });
  });
  return { el: h('div', { class: 'compass' }, button, status), stop: end };
}

/** QR code for a link (shown on the computer so a phone can open the local copy). */
export function qrBox(url) {
  const box = h('div', { class: 'qr', role: 'img', 'aria-label': `QR code for ${url}` });
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch { box.remove(); }
  return box;
}

/** Leaderboard rows. */
export function leaderboardList(rows, { columns = 'round', empty = 'No scores yet.' } = {}) {
  if (!rows.length) return h('p', { class: 'muted empty' }, empty);
  return h('ol', { class: 'board' }, rows.map(r => h('li', { class: r.me ? 'me' : '' },
    h('span', { class: `place p${r.place}` }, r.place <= 3 ? ['🥇', '🥈', '🥉'][r.place - 1] : r.place),
    h('span', { class: 'who' }, r.name, r.me ? h('span', { class: 'you' }, 'you') : null),
    columns === 'round'
      ? h('span', { class: 'detail' }, `${formatDistance(r.distance)} · ${Math.round(r.angleError)}°`)
      : h('span', { class: 'detail' }, `${r.rounds} round${r.rounds === 1 ? '' : 's'} · avg ${points(r.average)}`),
    h('strong', { class: 'score' }, points(r.total)))));
}

/** Short distance for lists, in feet (campus players think in feet; maps have their own units elsewhere). */
export function formatDistance(meters) {
  const ft = meters / 0.3048;
  return ft >= 1000 ? `${(ft / 5280).toFixed(ft >= 10560 ? 0 : 1)} mi` : `${Math.round(ft)} ft`;
}
