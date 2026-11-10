// Who's playing: sign-in (Google on the live site, a simple email form in local mode), the player's
// leaderboard name, campus, admin status, and settings from the database (today's date, scoring).
import defaultScoring from '../shared/scoring.config.js';
import { mode, rpc, sb } from './backend.js';
import { api } from './api.js';
import { googleG } from './icons.js';
import { btn, h, modal, toast } from './ui.js';

const CAMPUS_KEY = 'campusspot.campus';
export const session = {
  user: null,
  boot: { today: null, timezone: 'America/Los_Angeles', scoring: defaultScoring, signedIn: false, isAdmin: false, profile: null, campus: null },
  localCampus: readLocalCampus(),
};
const listeners = new Set();
export const onSessionChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const scoring = () => session.boot.scoring || defaultScoring;

// The campus you're playing: your membership when signed in, otherwise the one picked on this device.
function readLocalCampus() {
  try { return JSON.parse(localStorage.getItem(CAMPUS_KEY)) || null; } catch { return null; }
}
function saveLocalCampus(c) {
  session.localCampus = c;
  try { localStorage.setItem(CAMPUS_KEY, JSON.stringify(c)); } catch {}
}
export const currentCampus = () => (session.user && session.boot.campus) || session.localCampus;

/** Picks (guests) or joins (signed in) a campus. Signed-in players belong to one campus at a time. */
export async function chooseCampus(c) {
  saveLocalCampus(c);
  if (session.user) {
    await api.joinCampus(c.id);
    await refreshSession();
  } else listeners.forEach(fn => fn(session));
}

export async function refreshSession() {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  session.user = data.session?.user ?? null;
  try {
    session.boot = { ...session.boot, ...(await rpc('get_bootstrap')) };
    // First sign-in on this device: join the campus picked as a guest.
    if (session.user && !session.boot.campus && session.localCampus) {
      try {
        await api.joinCampus(session.localCampus.id);
        session.boot = { ...session.boot, ...(await rpc('get_bootstrap')) };
      } catch (err) { console.error(err); }
    }
    if (session.boot.campus) saveLocalCampus(session.boot.campus);
  } catch (err) {
    if (session.user && /JWT|token/i.test(err.message)) { await sb.auth.signOut(); return refreshSession(); }
    throw err;
  }
  listeners.forEach(fn => fn(session));
}

/** A sign-in error handed back in the address (after "?" or "#"), or null. */
function signInErrorFromUrl() {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  const src = query.has('error') ? query : hash.has('error') ? hash : null;
  return src && { code: src.get('error_code') || src.get('error'), message: src.get('error_description') || src.get('error') };
}

function showSignInProblem(problem) {
  console.error('Sign-in failed:', problem);
  modal(close => [
    h('h2', {}, 'Sign-in didn’t work'),
    h('p', { class: 'muted' }, problem.code === 'access_denied' ? 'Google sign-in was cancelled or not allowed for this account.' : 'Something went wrong while signing in.'),
    h('pre', { class: 'error-detail' }, problem.message || problem.code || 'Unknown error'),
    h('div', { class: 'row end' }, btn('Close', { class: 'ghost', onclick: () => close() }), btn('Try again', { class: 'primary', onclick: () => { close(); signIn(); } })),
  ], { label: 'Sign-in problem' });
}

export async function initSession() {
  if (!sb) return;
  const params = new URLSearchParams(location.search);
  const urlError = signInErrorFromUrl();
  const returnTo = sessionStorage.getItem('campusspot.return');
  // Finishes a Google sign-in when we're coming back from it (?code=…).
  const { error: exchangeError } = await sb.auth.initialize();
  if (params.has('code') || urlError) {
    history.replaceState(null, '', location.pathname + (returnTo || '#/'));
    sessionStorage.removeItem('campusspot.return');
  }
  const problem = urlError || (params.has('code') && exchangeError ? { code: exchangeError.code, message: exchangeError.message } : null);
  if (problem) setTimeout(() => showSignInProblem(problem), 300);
  await refreshSession();
  sb.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => refreshSession().catch(console.error), 0);
  });
}

/** Starts sign-in. Live: goes to Google and comes back. Local mode: asks for an email. */
export async function signIn() {
  if (mode === 'live') {
    sessionStorage.setItem('campusspot.return', location.hash || '#/');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
    });
    if (error) showSignInProblem({ code: error.code, message: error.message });
    return false; // the page navigates away
  }
  const admins = window.CAMPUSSPOT_LOCAL?.adminEmails || [];
  const email = await modal(close => {
    const input = h('input', { type: 'email', required: true, placeholder: 'you@example.com', autocomplete: 'email', 'aria-label': 'Email' });
    const submit = e => { e.preventDefault(); if (input.value.includes('@')) close(input.value.trim()); };
    return h('form', { onsubmit: submit },
      h('h2', {}, 'Sign in (local test mode)'),
      h('p', { class: 'muted small' }, 'This copy runs on your computer, so there’s no Google sign-in. Type any email to play as that person.',
        admins.length ? ` Admin: ${admins.join(', ')}.` : ''),
      input,
      h('div', { class: 'row end' }, btn('Cancel', { class: 'ghost', onclick: () => close(null) }), h('button', { type: 'submit', class: 'btn primary' }, 'Sign in')));
  }, { label: 'Sign in' });
  if (!email) return false;
  const res = await fetch('/auth/v1/dev-login', { method: 'POST', body: JSON.stringify({ email }) });
  const tokens = await res.json();
  if (!res.ok) { toast(tokens.message || 'Sign-in failed', 'error'); return false; }
  await sb.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
  await refreshSession();
  return true;
}

export async function signOut() {
  await sb.auth.signOut();
  await refreshSession();
}

/** The official-style "Sign in with Google" button (Google's branding guidelines). */
export function googleButton(label = 'Sign in with Google') {
  if (mode !== 'live') return btn('Sign in', { icon: 'user', class: 'primary', onclick: () => signIn() });
  return h('button', { type: 'button', class: 'gsi-button', onclick: () => signIn() }, googleG(18), h('span', {}, label));
}

/** Asks for a leaderboard name. Resolves true once the player has one. */
export async function ensureName({ reason, force = false } = {}) {
  if (!session.user) return false;
  if (!force && session.boot.profile && !session.boot.profile.hidden) return true;
  const saved = await modal(close => {
    const hidden = session.boot.profile?.hidden;
    const input = h('input', { type: 'text', maxlength: 20, minlength: 3, required: true, autocomplete: 'nickname', placeholder: 'e.g. QuadExplorer', 'aria-label': 'Leaderboard name', value: hidden ? '' : session.boot.profile?.displayName || '' });
    const error = h('p', { class: 'field-error', 'aria-live': 'polite' });
    const go = h('button', { type: 'submit', class: 'btn primary' }, 'Save name');
    const submit = async e => {
      e.preventDefault();
      go.disabled = true;
      error.textContent = '';
      try {
        await api.setName(input.value);
        close(true);
      } catch (err) { error.textContent = err.message; go.disabled = false; input.focus(); }
    };
    return h('form', { onsubmit: submit },
      h('h2', {}, hidden ? 'Please choose a new name' : 'Choose your leaderboard name'),
      h('p', { class: 'muted small' }, hidden
        ? 'An admin removed your previous name from the leaderboard.'
        : reason || 'This is what other players see next to your scores. Your Google name and email stay private.'),
      input,
      h('p', { class: 'muted small' }, '3–20 characters: letters, numbers, spaces, - _ .'),
      error,
      h('div', { class: 'row end' }, btn('Not now', { class: 'ghost', onclick: () => close(false) }), go));
  }, { label: 'Choose your leaderboard name' });
  if (saved) await refreshSession();
  return !!saved;
}
