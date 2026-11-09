// Every call the app makes to the database, by name. Permissions are enforced by the database
// functions themselves (see supabase/schema.sql), not here.
import { rpc } from './backend.js';

let mapsCache = null;

export const api = {
  maps: async () => (mapsCache ??= await rpc('get_maps')),
  forgetMaps: () => { mapsCache = null; },
  today: () => rpc('get_today'),
  rounds: (includeScheduled = false) => rpc('list_rounds', { p_include_scheduled: includeScheduled }),
  round: id => rpc('get_round', { p_id: id }),
  guess: (id, pose) => rpc('submit_guess', { p_round: id, p_pos: pose.pos, p_heading: pose.heading }),
  myResult: id => rpc('get_my_result', { p_round: id }),
  leaderboardRound: (id = null) => rpc('leaderboard_round', { p_round: id }),
  leaderboardOverall: (days = null) => rpc('leaderboard_overall', { p_days: days }),
  setName: name => rpc('set_display_name', { p_name: name }),
  deleteAccount: () => rpc('delete_my_account'),
  requestContributor: note => rpc('request_contributor', { p_note: note }),
  submitRound: round => rpc('submit_round', { p: round }),
  mySubmissions: () => rpc('my_submissions'),

  admin: {
    saveMap: async map => { const saved = await rpc('admin_save_map', { p_map: map }); mapsCache = null; return saved; },
    createRound: round => rpc('admin_create_round', { p: round }),
    updateRound: (id, patch) => rpc('admin_update_round', { p_id: id, p: patch }),
    deleteRound: id => rpc('admin_delete_round', { p_id: id }),
    answer: id => rpc('admin_round_answer', { p_id: id }),
    players: () => rpc('admin_players'),
    setHidden: (userId, hidden) => rpc('admin_set_hidden', { p_user: userId, p_hidden: hidden }),
    admins: () => rpc('admin_list_admins'),
    reviewQueue: () => rpc('admin_review_queue'),
    approve: (id, date = null) => rpc('admin_approve_round', { p_id: id, p_date: date }),
    reject: (id, note) => rpc('admin_reject_round', { p_id: id, p_note: note }),
    contributors: () => rpc('admin_contributors'),
    setContributor: (userId, status) => rpc('admin_set_contributor', { p_user: userId, p_status: status }),
  },
};
