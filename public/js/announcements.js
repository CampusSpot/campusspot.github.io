// Whether there are announcements you haven't read, for the dot on the News tab. Signed-in players'
// "read up to" time is kept in the database (so it follows them across devices); this browser
// also remembers it, which is all signed-out players have.
import { api } from './api.js';
import { session } from './session.js';

const READ_KEY = 'campusspot.announcementsRead';
const listeners = new Set();
let latest = null;
let readAt = null;

export const onAnnouncementsChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach(fn => fn());

function localRead() {
  try { return localStorage.getItem(READ_KEY); } catch { return null; }
}
const later = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b);

/** When you last read the announcements (null if never). */
export const readMarker = () => readAt;

export const hasUnread = () => !!latest && (!readAt || new Date(latest) > new Date(readAt));

/** Asks the database when the newest announcement was posted and when you last read them. */
export async function refreshAnnouncements() {
  try {
    const status = await api.announcementsStatus();
    latest = status.latest;
    readAt = later(status.readAt, localRead());
    changed();
  } catch (err) { console.error(err); }
}

/** Marks everything up to `upto` (the newest announcement shown) as read. */
export async function markAnnouncementsRead(upto) {
  if (!upto) return;
  readAt = later(readAt, upto);
  try { localStorage.setItem(READ_KEY, readAt); } catch {}
  changed();
  if (session.user) {
    try { await api.markAnnouncementsRead(upto); } catch (err) { console.error(err); }
  }
}

/** After the announcements page loads its list: the newest one is the latest there is. */
export function sawLatest(value) {
  latest = later(latest, value);
}
