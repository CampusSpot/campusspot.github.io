// Your account: leaderboard name, campus, class year, sign out, delete account.
import { api } from '../api.js';
import { mode } from '../backend.js';
import { pageHeader } from '../components.js';
import { icon } from '../icons.js';
import { currentCampus, ensureName, googleButton, refreshSession, session, signOut } from '../session.js';
import { btn, confirmDialog, h, toast } from '../ui.js';
import { footer } from './home.js';

export async function account(root) {
  const { user, boot } = session;
  if (!user) {
    root.append(pageHeader('Your account'), h('section', { class: 'card center stack' },
      icon('user', { size: 40 }),
      h('p', {}, 'Sign in to play the daily round, keep your scores, and appear on the leaderboard under a name you choose.'),
      googleButton('Sign in with Google'),
      h('p', { class: 'small muted' }, 'We only use your Google account to know it’s you. Other players never see your email. ',
        h('a', { href: '#/privacy' }, 'Privacy policy'))),
    footer());
    return;
  }

  const name = boot.profile?.displayName;
  root.append(
    pageHeader('Your account'),
    h('section', { class: 'card' },
      h('div', { class: 'profile' },
        h('span', { class: 'avatar large' }, (name || user.email || '?').slice(0, 1).toUpperCase()),
        h('div', { class: 'grow' },
          h('strong', { class: 'big-name' }, name || 'No name yet'),
          h('div', { class: 'small muted' }, `Signed in as ${user.email} (private)`),
          boot.isAdmin ? h('span', { class: 'badge admin' }, icon('shield', { size: 14 }), ' Admin') : null)),
      boot.profile?.hidden ? h('p', { class: 'notice' }, 'An admin removed this name from the leaderboard. Please choose a new one.') : null,
      h('div', { class: 'row wrap' },
        btn(name ? 'Change name' : 'Choose a name', { icon: 'edit',
          onclick: () => ensureName({ force: true, reason: 'Pick a new leaderboard name. Your scores stay with you.' }) }),
        btn('Sign out', { icon: 'logout', onclick: () => signOut() }))),
    schoolCard(),
    h('section', { class: 'card' },
      h('h2', {}, 'Contribute photos'),
      h('p', { class: 'small muted' }, boot.contributor === 'approved' || boot.isAdmin ? 'Submit campus photos for future rounds.' : 'Want to submit your own campus photos? Ask to become a contributor.'),
      btn('Contribute', { icon: 'camera', href: '#/contribute' })),
    h('section', { class: 'card' },
      h('h2', {}, 'Your data'),
      h('p', { class: 'small muted' }, 'We store your Google account’s email and ID, the name you chose, and your guesses. Deleting your account removes all of it right away.'),
      btn('Delete my account', { icon: 'trash', class: 'danger', onclick: async () => {
        if (!(await confirmDialog('Delete your account?', 'Your name and all your scores will be removed for good. This can’t be undone.', { ok: 'Delete', danger: true }))) return;
        try {
          await api.deleteAccount();
          await signOut();
          toast('Your account was deleted');
          location.hash = '#/';
        } catch (err) { toast(err.message, 'error'); }
      } })),
    mode === 'local' ? h('p', { class: 'small muted center' }, 'Local test mode: data lives on this computer only.') : null,
    footer(),
  );
}

/** Your campus (one at a time, changeable) and an optional class year shown next to your name. */
function schoolCard() {
  const { boot } = session;
  const campus = boot.campus || currentCampus();
  const thisYear = session.boot.today ? Number(session.boot.today.slice(0, 4)) : new Date().getFullYear();
  const years = Array.from({ length: 17 }, (_, i) => thisYear - 10 + i);
  const year = h('select', { 'aria-label': 'Graduation year', onchange: async e => {
    const value = e.target.value ? Number(e.target.value) : null;
    if (!(await ensureName({ reason: 'Choose a leaderboard name first. Your class year shows next to it.' }))) { e.target.value = boot.profile?.gradYear ?? ''; return; }
    try {
      await api.setGradYear(value);
      await refreshSession();
      toast(value ? `Class of ${value} saved` : 'Class year removed');
    } catch (err) { toast(err.message, 'error'); }
  } },
  h('option', { value: '' }, 'Don’t show'),
  years.map(y => h('option', { value: y, selected: boot.profile?.gradYear === y }, `Class of ${y}`)));
  return h('section', { class: 'card' },
    h('h2', {}, 'Your campus'),
    h('div', { class: 'profile' },
      h('span', { class: 'avatar' }, icon('school', { size: 20 })),
      h('div', { class: 'grow' },
        h('strong', {}, campus ? campus.name : 'No campus yet'),
        h('div', { class: 'small muted' }, 'Your scores count on this campus’s leaderboard. You can switch anytime; you’re on one campus at a time.')),
      btn(campus ? 'Change' : 'Pick', { href: '#/pick', class: 'small' })),
    h('label', { class: 'field' }, h('span', {}, 'Graduation year (optional, shown next to your name)'), year));
}
