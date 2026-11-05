// Small DOM helpers. Text always goes in as text (never as HTML), so names and titles can't inject markup.
import { icon } from './icons.js';

// Views build pages like `root.append(a, maybe ? b : null)`. The DOM would print empty slots as the
// word "null", so these methods skip null/undefined/false, the same way h() does.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ['append', 'prepend', 'replaceChildren', 'before', 'after']) {
    const original = proto[name];
    if (!original || original.__skipsEmpty) continue;
    const patched = function (...nodes) { return original.apply(this, nodes.filter(n => n != null && n !== false)); };
    patched.__skipsEmpty = true;
    proto[name] = patched;
  }
}

/** h('button', { class: 'btn', onclick }, 'Label', child, …) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

/** btn('Play', { class: 'primary', onclick }). Text buttons are text only; `icon` is drawn when there's no label. */
export function btn(label, { icon: name, class: cls = '', href, ...props } = {}) {
  const kids = label ? [h('span', {}, label)] : [icon(name), null];
  if (!label) cls += ' icon-only';
  return href
    ? h('a', { class: `btn ${cls}`, href, ...props }, kids)
    : h('button', { type: 'button', class: `btn ${cls}`, ...props }, kids);
}

let toastTimer;
export function toast(message, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3600);
}

/**
 * Modal dialog. Returns a promise resolved with the value passed to close().
 * build(close) returns the dialog's content.
 */
export function modal(build, { dismissable = true, label = 'Dialog' } = {}) {
  return new Promise(resolve => {
    const dlg = h('dialog', { class: 'modal', 'aria-label': label });
    const close = value => { dlg.close(); dlg.remove(); resolve(value); };
    if (dismissable) {
      dlg.addEventListener('cancel', e => { e.preventDefault(); close(undefined); });
      dlg.addEventListener('click', e => { if (e.target === dlg) close(undefined); });
    } else dlg.addEventListener('cancel', e => e.preventDefault());
    dlg.append(h('div', { class: 'modal-body' }, build(close)));
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('input, [autofocus]')?.focus();
  });
}

export function confirmDialog(title, text, { ok = 'OK', danger = false } = {}) {
  return modal(close => [
    h('h2', {}, title),
    h('p', { class: 'muted' }, text),
    h('div', { class: 'row end' },
      btn('Cancel', { class: 'ghost', onclick: () => close(false) }),
      btn(ok, { class: danger ? 'danger solid' : 'primary', onclick: () => close(true) })),
  ], { label: title });
}

export const points = n => Math.round(n).toLocaleString();

const parseYmd = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };

export function formatDate(ymd, today) {
  if (ymd === today) return 'Today';
  const date = parseYmd(ymd);
  const t = today ? parseYmd(today) : new Date();
  const days = Math.round((t - date) / 86400000);
  if (days === 1) return 'Yesterday';
  if (days === -1) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(date.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
}

export const formatTime = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Milliseconds until the next midnight in a time zone (when the next daily round unlocks). */
export function msUntilMidnight(timeZone) {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(now).map(p => [p.type, Number(p.value)]));
  const elapsed = ((parts.hour % 24) * 3600 + parts.minute * 60 + parts.second) * 1000;
  return 86400000 - elapsed;
}

export function formatDuration(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const hrs = Math.floor(m / 60);
  return hrs ? `${hrs}h ${m % 60}m` : `${m}m`;
}

export function loading(text = 'Loading…') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}
