// A round's chat, shown on the results page (so only after you've guessed). Anyone who guessed can
// read it; signed-in players with a leaderboard name can write. The database checks all of this.
import { api } from '../api.js';
import { icon } from '../icons.js';
import { ensureName, googleButton, session } from '../session.js';
import { btn, confirmDialog, formatTime, h, toast } from '../ui.js';

const POLL_MS = 15000;

/** Returns { el, stop }: the chat card, and a function that stops checking for new messages. */
export function roundChat(round) {
  const list = h('ol', { class: 'chat-list', 'aria-live': 'polite', 'aria-label': 'Chat messages' });
  const foot = h('div', { class: 'chat-foot' });
  const el = h('section', { class: 'card chat' },
    h('div', { class: 'section-head' }, h('h2', {}, icon('chat', { size: 18 }), ' Chat'), h('span', { class: 'small muted' }, 'Spoilers welcome: everyone here has guessed')),
    list, foot);
  let messages = [];
  let canPost = false;
  let stopped = false;
  let timer = null;

  const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 40;

  function draw() {
    const stick = nearBottom();
    list.replaceChildren(...messages.map(m => h('li', { class: `chat-msg${m.me ? ' me' : ''}` },
      h('div', { class: 'chat-meta' },
        h('strong', {}, m.name),
        m.gradYear ? h('span', { class: 'year', title: `Class of ${m.gradYear}` }, `’${String(m.gradYear).slice(2)}`) : null,
        m.admin ? h('span', { class: 'badge admin' }, 'Admin') : null,
        h('span', { class: 'small muted' }, formatTime(m.createdAt)),
        m.me || session.boot.isAdmin
          ? h('button', { type: 'button', class: 'chat-delete', 'aria-label': 'Delete message', onclick: () => remove(m) }, icon('x', { size: 14 }))
          : null),
      h('p', { class: 'chat-body' }, m.body))));
    if (!messages.length) list.append(h('li', { class: 'muted small chat-empty' }, 'No messages yet. Say how you did!'));
    if (stick) list.scrollTop = list.scrollHeight;
  }

  async function remove(m) {
    if (!(await confirmDialog('Delete this message?', m.body, { ok: 'Delete', danger: true }))) return;
    try {
      await api.deleteChat(m.id);
      messages = messages.filter(x => x.id !== m.id);
      draw();
    } catch (err) { toast(err.message, 'error'); }
  }

  function drawFoot() {
    if (!session.user) {
      foot.replaceChildren(h('p', { class: 'small muted' }, 'Sign in to join the chat.'), googleButton('Sign in with Google'));
    } else if (!session.boot.profile || session.boot.profile.hidden) {
      foot.replaceChildren(h('p', { class: 'small muted' }, 'Choose a leaderboard name to join the chat.'),
        btn('Choose a name', { class: 'small', onclick: () => ensureName({ reason: 'Your leaderboard name is shown next to your chat messages.' }) }));
    } else if (!canPost) {
      foot.replaceChildren();
    } else {
      foot.replaceChildren(form());
    }
  }

  function form() {
    const input = h('input', { type: 'text', maxlength: 300, required: true, placeholder: 'Write a message', 'aria-label': 'Chat message', autocomplete: 'off', enterkeyhint: 'send' });
    const send = h('button', { type: 'submit', class: 'btn primary' }, 'Send');
    return h('form', { class: 'chat-form', onsubmit: async e => {
      e.preventDefault();
      if (!input.value.trim()) return;
      send.disabled = true;
      try {
        const m = await api.postChat(round.id, input.value);
        if (!messages.some(x => x.id === m.id)) messages.push(m);
        input.value = '';
        draw();
        list.scrollTop = list.scrollHeight;
      } catch (err) {
        if (err.hint === 'needs_name') ensureName();
        else toast(err.message, 'error');
      } finally { send.disabled = false; input.focus(); }
    } }, input, send);
  }

  async function load() {
    if (stopped) return;
    clearTimeout(timer);
    try {
      const res = await api.chat(round.id);
      if (stopped) return;
      messages = res.messages;
      if (res.canPost !== canPost) { canPost = res.canPost; drawFoot(); }
      draw();
    } catch (err) {
      if (!stopped && !messages.length) list.replaceChildren(h('li', { class: 'muted small chat-empty' }, err.message));
    }
    if (!stopped) timer = setTimeout(() => (document.hidden ? null : load()), POLL_MS);
  }

  const onVisible = () => { if (!document.hidden) load(); };
  document.addEventListener('visibilitychange', onVisible);
  drawFoot();
  load();
  return {
    el,
    stop: () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); },
  };
}
