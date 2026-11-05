// Admin: map editor.
//   Campus (real-world) map: play area, building labels imported from OpenStreetMap, your own labels.
//   Floor plan: a rectangle (width × length, feet or meters) plus labeled reference features,
//   for indoor rounds (a building lobby, a lab…).
import { fetchOsmFeatures } from '../../../shared/osm.js';
import { api } from '../../api.js';
import { card, compassControl, pageHeader } from '../../components.js';
import { createMapView } from '../../map/index.js';
import { FT, fromUnit, toUnit } from '../../units.js';
import { btn, h, toast } from '../../ui.js';
import { adminNav } from './common.js';

const QUICK_FEATURES = ['Door', 'Bed', 'Desk', 'Window', 'Closet'];
const newMap = () => ({ name: 'New room', type: 'floorplan', units: 'ft', width: 12 * FT, length: 15 * FT, topBearing: null, features: [] });

export async function adminMaps(root, id) {
  const maps = await api.maps();
  const source = id ? maps.find(m => m.id === id) : maps[0];
  const m = id === 'new' || !source ? newMap() : structuredClone(source);
  root.append(adminNav(), pageHeader(m.id ? 'Maps' : 'New indoor map', { sub: 'Players see these maps when they guess.' }));
  const main = root;
  const box = h('div', { class: 'map-box' });
  const hint = h('p', { class: 'hint' });
  let view;

  const redraw = () => { view.setMap(m); renderFeatures(); };

  // ── shared: name, units ──
  const name = h('input', { type: 'text', maxlength: 60, value: m.name, oninput: () => (m.name = name.value) });
  const unitBtns = ['ft', 'm'].map(u => h('button', { type: 'button', class: 'seg', 'aria-pressed': String(m.units === u), onclick: () => setUnits(u) }, u === 'ft' ? 'Feet' : 'Meters'));
  const unitListeners = [];
  function setUnits(u) {
    m.units = u;
    unitBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['ft', 'm'][i] === u)));
    unitListeners.forEach(fn => fn());
    redraw();
  }

  // ── features (labels) ──
  const featureList = h('ul', { class: 'features-list' });
  const featureCount = h('span', { class: 'muted' });
  function place(feature) {
    hint.textContent = `Tap the map where “${feature.label || 'it'}” is.`;
    hint.classList.add('active');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    view.pickPoint(pos => {
      feature.pos = pos;
      hint.textContent = 'Placed. Remember to save.';
      hint.classList.remove('active');
      redraw();
    });
  }
  function addFeature(label) {
    const center = m.type === 'latlng'
      ? { lat: (m.bounds.sw.lat + m.bounds.ne.lat) / 2, lng: (m.bounds.sw.lng + m.bounds.ne.lng) / 2 }
      : { x: m.width / 2, y: m.length / 2 };
    const f = { id: Math.random().toString(36).slice(2, 10), label, kind: 'custom', source: 'user', pos: center };
    m.features.push(f);
    redraw();
    place(f);
    if (!label) featureList.querySelector('li:last-child input')?.focus();
  }
  function renderFeatures() {
    featureCount.textContent = ` (${m.features.length})`;
    featureList.replaceChildren(...m.features.map(f => {
      const label = h('input', { type: 'text', maxlength: 60, value: f.label, placeholder: 'Label', 'aria-label': 'Label' });
      label.addEventListener('input', () => { f.label = label.value; view.setMap(m); });
      return h('li', {},
        label,
        btn('Move', { icon: 'pin', class: 'small', onclick: () => place(f) }),
        btn('', { icon: 'x', class: 'small danger', 'aria-label': `Remove ${f.label}`, onclick: () => { m.features = m.features.filter(x => x !== f); redraw(); } }));
    }));
    if (!m.features.length) featureList.append(h('li', { class: 'muted small' }, 'No labels yet.'));
  }

  async function save({ quiet = false } = {}) {
    if (m.type === 'floorplan' && !(m.width > 0 && m.length > 0)) return toast('Enter a width and a length', 'error');
    try {
      compass?.stop();
      const saved = await api.admin.saveMap({ ...m, name: m.name || 'Untitled map' });
      Object.assign(m, saved);
      history.replaceState(null, '', `#/admin/maps/${saved.id}`);
      if (!quiet) toast('Map saved');
      return saved;
    } catch (err) { toast(err.message, 'error'); }
  }

  let compass = null;
  const top = h('div', { class: 'row wrap' },
    maps.length > 1 ? h('select', { 'aria-label': 'Choose map', onchange: e => (location.hash = `#/admin/maps/${e.target.value}`) },
      maps.map(x => h('option', { value: x.id, selected: x.id === m.id }, x.name))) : null,
    btn('New indoor map', { href: '#/admin/maps/new', icon: 'plus', class: 'small' }));

  if (m.type === 'latlng') {
    // ── campus map ──
    hint.textContent = 'Satellite view. Switch to the street map or hide labels with the layers button. The dashed box is the play area.';
    const importBtn = btn(m.osmImportedAt ? 'Re-import building names' : 'Import building names from OpenStreetMap', { icon: 'layers', class: m.osmImportedAt ? '' : 'primary' });
    const importStatus = h('p', { class: 'small muted' }, m.osmImportedAt
      ? `Last imported ${new Date(m.osmImportedAt).toLocaleString()}.`
      : 'Not imported yet. Do this once so players see building names.');
    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      importStatus.textContent = 'Asking OpenStreetMap… (can take 30 s)';
      try {
        const osm = await fetchOsmFeatures(m.bounds);
        m.features = [...osm, ...m.features.filter(f => f.source !== 'osm')];
        m.osmImportedAt = new Date().toISOString();
        if (!(await save({ quiet: true }))) throw new Error('Save failed');
        redraw();
        importStatus.textContent = `Imported ${osm.length} names and saved. Your own labels were kept.`;
      } catch (err) {
        importStatus.textContent = `${err.message}. Check your internet connection and try again.`;
      } finally { importBtn.disabled = false; }
    });
    main.append(
      top,
      card(
        h('label', { class: 'field' }, h('span', {}, 'Name'), name),
        h('div', { class: 'field' }, h('span', {}, 'Show distances in'), h('div', { class: 'segmented' }, unitBtns))),
      hint,
      box,
      h('div', { class: 'row wrap' },
        btn('Use current view as play area', { icon: 'map', class: 'small',
          onclick: () => { m.bounds = view.currentBounds(); redraw(); toast('Play area set to the current view. Save to keep it.'); } })),
      card(h('h2', {}, 'Building names'), importBtn, importStatus),
      h('details', { class: 'card', open: m.features.length <= 15 },
        h('summary', {}, 'Labels', featureCount),
        h('p', { class: 'small muted' }, 'Rename, move or remove labels, or add your own (e.g. “Fountain”, “Rose Garden”).'),
        h('p', { class: 'small muted' }, 'Building names are © OpenStreetMap contributors (ODbL); the map credits them automatically.'),
        h('div', { class: 'chips' }, h('button', { type: 'button', class: 'chip', onclick: () => addFeature('') }, '+ Add label')),
        featureList),
      h('div', { class: 'sticky-actions' }, btn('Save map', { icon: 'check', class: 'primary block', onclick: () => save() })),
    );
  } else {
    // ── floor plan ──
    hint.textContent = 'Drawn to scale. Add features as reference points for players.';
    const round2 = v => +toUnit(v, m.units).toFixed(2);
    const width = h('input', { type: 'number', inputmode: 'decimal', min: 0.5, step: 0.1, value: round2(m.width), required: true });
    const length = h('input', { type: 'number', inputmode: 'decimal', min: 0.5, step: 0.1, value: round2(m.length), required: true });
    const unitLabels = [h('span', { class: 'unit' }, m.units), h('span', { class: 'unit' }, m.units)];
    unitListeners.push(() => {
      unitLabels.forEach(l => (l.textContent = m.units));
      width.value = round2(m.width);
      length.value = round2(m.length);
    });
    const readSize = () => {
      const w = parseFloat(width.value), l = parseFloat(length.value);
      if (!(w > 0 && l > 0)) return;
      m.width = fromUnit(w, m.units);
      m.length = fromUnit(l, m.units);
      m.features.forEach(f => { f.pos.x = Math.min(f.pos.x, m.width); f.pos.y = Math.min(f.pos.y, m.length); });
      redraw();
    };
    width.addEventListener('input', readSize);
    length.addEventListener('input', readSize);
    const topBearing = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 359, step: 1, placeholder: 'not set', value: m.topBearing ?? '' });
    topBearing.addEventListener('input', () => {
      const v = parseFloat(topBearing.value);
      m.topBearing = Number.isFinite(v) ? ((v % 360) + 360) % 360 : null;
      redraw();
    });
    compass = compassControl({
      label: 'Measure with phone compass',
      onHeading: deg => { topBearing.value = deg; m.topBearing = deg; view.setMap(m); },
    });
    main.append(
      top,
      card(
        h('label', { class: 'field' }, h('span', {}, 'Name'), name),
        h('div', { class: 'field' }, h('span', {}, 'Units'), h('div', { class: 'segmented' }, unitBtns)),
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, h('span', {}, 'Width (left ↔ right)'), h('div', { class: 'with-unit' }, width, unitLabels[0])),
          h('label', { class: 'field grow' }, h('span', {}, 'Length (top ↕ bottom)'), h('div', { class: 'with-unit' }, length, unitLabels[1])))),
      hint,
      box,
      card(
        h('h2', {}, 'Reference features'),
        h('div', { class: 'chips' },
          QUICK_FEATURES.map(l => h('button', { type: 'button', class: 'chip', onclick: () => addFeature(l) }, `+ ${l}`)),
          h('button', { type: 'button', class: 'chip', onclick: () => addFeature('') }, '+ Other')),
        featureList),
      h('details', { class: 'card' },
        h('summary', {}, 'Compass alignment (optional)'),
        h('p', { class: 'small muted' }, 'Which compass direction does the top edge of the map face? Needed only if you use the phone compass to set headings. Stand inside, point the back camera at the top wall, then lock.'),
        h('label', { class: 'field' }, h('span', {}, 'Top of map faces (°, 0 = north)'), topBearing),
        compass.el),
      h('div', { class: 'sticky-actions' }, btn('Save map', { icon: 'check', class: 'primary block', onclick: () => save() })),
    );
  }

  view = createMapView(box, m);
  renderFeatures();
  return () => { compass?.stop(); view.destroy(); };
}
