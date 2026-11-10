// Every call the app makes to the database, by name. Permissions are enforced by the database
// functions themselves (see supabase/schema.sql), not here.
import { rpc } from './backend.js';
import { currentCampus } from './session.js';

// Calls about "the campus" default to the one you're playing; admin pages pass the one they manage.
const cid = () => currentCampus()?.id ?? null;
const mapsCache = new Map();

export const api = {
  maps: async (campus = cid()) => {
    if (!mapsCache.has(campus)) mapsCache.set(campus, await rpc('get_maps', { p_campus: campus }));
    return mapsCache.get(campus);
  },
  forgetMaps: () => mapsCache.clear(),
  today: (campus = cid()) => rpc('get_today', { p_campus: campus }),
  rounds: (includeScheduled = false, campus = cid()) => rpc('list_rounds', { p_campus: campus, p_include_scheduled: includeScheduled }),
  round: id => rpc('get_round', { p_id: id }),
  guess: (id, pose) => rpc('submit_guess', { p_round: id, p_pos: pose.pos, p_heading: pose.heading }),
  myResult: id => rpc('get_my_result', { p_round: id }),
  leaderboardRound: (id = null, campus = cid()) => rpc('leaderboard_round', { p_round: id, p_campus: campus }),
  leaderboardOverall: (days = null, campus = cid()) => rpc('leaderboard_overall', { p_campus: campus, p_days: days }),
  joinCampus: id => rpc('join_campus', { p_campus: id }),
  setGradYear: year => rpc('set_grad_year', { p_year: year }),
  setName: name => rpc('set_display_name', { p_name: name }),
  deleteAccount: () => rpc('delete_my_account'),
  requestContributor: note => rpc('request_contributor', { p_note: note }),
  submitRound: round => rpc('submit_round', { p: round }),
  mySubmissions: () => rpc('my_submissions'),

  admin: {
    saveMap: async map => { const saved = await rpc('admin_save_map', { p_map: map }); mapsCache.clear(); return saved; },
    createRound: round => rpc('admin_create_round', { p: round }),
    updateRound: (id, patch) => rpc('admin_update_round', { p_id: id, p: patch }),
    deleteRound: id => rpc('admin_delete_round', { p_id: id }),
    answer: id => rpc('admin_round_answer', { p_id: id }),
    players: () => rpc('admin_players'),
    setHidden: (userId, hidden) => rpc('admin_set_hidden', { p_user: userId, p_hidden: hidden }),
    admins: () => rpc('admin_list_admins'),
    reviewQueue: () => rpc('admin_review_queue'),
    approve: (id, date = null) => rpc('admin_approve_round', { p_id: id, p_date: date }),
    store: id => rpc('admin_store_round', { p_id: id }),
    reject: (id, note) => rpc('admin_reject_round', { p_id: id, p_note: note }),
    contributors: () => rpc('admin_contributors'),
    setContributor: (userId, status) => rpc('admin_set_contributor', { p_user: userId, p_status: status }),
  },
};
