// Admin: the campus map. Play area, building names imported from OpenStreetMap, your own labels,
// and whether distances show in feet or meters.
import { fetchOsmFeatures } from '../../../shared/osm.js';
import { api } from '../../api.js';
import { card, pageHeader } from '../../components.js';
import { createMapView } from '../../map/index.js';
import { btn, h, toast } from '../../ui.js';
import { adminNav } from './common.js';

export async function adminMaps(root, id) {
  const maps = await api.maps();
  const source = (id && maps.find(x => x.id === id)) || maps[0];
  if (!source) {
    root.append(adminNav(), pageHeader('Map'), card(h('p', { class: 'muted' }, 'No map found. Run supabase/setup.sql again to add the campus map.')));
    return;
  }
  const m = structuredClone(source);
  const box = h('div', { class: 'map-box' });
  const hint = h('p', { class: 'hint' }, 'Switch between satellite and street map, or hide labels, with the layers button. The dashed box is the play area.');
  let view;

  const redraw = () => { view.setMap(m); renderFeatures(); };

  // name and units
  const name = h('input', { type: 'text', maxlength: 60, value: m.name, oninput: () => (m.name = name.value) });
  const unitBtns = ['ft', 'm'].map(u => h('button', {
    type: 'button', class: 'seg', 'aria-pressed': String(m.units === u),
    onclick: () => { m.units = u; unitBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['ft', 'm'][i] === u))); redraw(); },
  }, u === 'ft' ? 'Feet' : 'Meters'));

  // labels
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
  function addFeature() {
    const center = { lat: (m.bounds.sw.lat + m.bounds.ne.lat) / 2, lng: (m.bounds.sw.lng + m.bounds.ne.lng) / 2 };
    const f = { id: Math.random().toString(36).slice(2, 10), label: '', kind: 'custom', source: 'user', pos: center };
    m.features.push(f);
    redraw();
    place(f);
    featureList.querySelector('li:last-child input')?.focus();
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
    try {
      const saved = await api.admin.saveMap({ ...m, name: m.name || 'Campus' });
      Object.assign(m, saved);
      history.replaceState(null, '', `#/admin/maps/${saved.id}`);
      if (!quiet) toast('Map saved');
      return saved;
    } catch (err) { toast(err.message, 'error'); }
  }

  // building names from OpenStreetMap
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

  root.append(
    adminNav(),
    pageHeader('Map', { sub: 'Players see this map when they guess.' }),
    maps.length > 1 ? h('select', { 'aria-label': 'Choose map', onchange: e => (location.hash = `#/admin/maps/${e.target.value}`) },
      maps.map(x => h('option', { value: x.id, selected: x.id === m.id }, x.name))) : null,
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
      h('div', { class: 'chips' }, h('button', { type: 'button', class: 'chip', onclick: addFeature }, '+ Add label')),
      featureList),
    h('div', { class: 'sticky-actions' }, btn('Save map', { icon: 'check', class: 'primary block', onclick: () => save() })),
  );

  view = createMapView(box, m);
  renderFeatures();
  return () => view.destroy();
}
