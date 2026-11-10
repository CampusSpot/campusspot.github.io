// Tests the real database (supabase/schema.sql) in PGlite: security rules, daily-round rules, names,
// leaderboards, admin tools, and that SQL scoring matches the JavaScript scoring.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb } from '../local/db.js';
import config from '../public/shared/scoring.config.js';
import { scoreGuess } from '../public/shared/scoring.js';

let db, today, yesterday, tomorrow;
const ADMIN = 'boss@example.com';
const CPP = 'cal-poly-pomona';
const people = {};
function person(name, email, provider = 'google') {
  const id = randomUUID();
  people[name] = { id, claims: { sub: id, role: 'authenticated', email, app_metadata: { provider } } };
  return people[name];
}
const as = name => people[name]?.claims ?? null;
const rejects = (p, re) => assert.rejects(p, err => re.test(`${err.code} ${err.message} ${err.hint}`));

const truth = { pos: { lat: 34.0577, lng: -117.8223 }, heading: 90 };
let todayRound, pastRound, futureRound;

before(async () => {
  db = await openDb({ adminEmails: [ADMIN] });
  for (const [n, e, p] of [['admin', ADMIN, 'google'], ['ana', 'ana@example.com'], ['ben', 'ben@example.com'], ['cy', 'cy@example.com'],
    ['fake', ADMIN, 'email']]) {
    const u = person(n, e, p);
    await db.ensureUser(u.id, e);
  }
  today = (await db.rpc('get_bootstrap')).today;
  const shift = d => { const t = new Date(today + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  yesterday = shift(-1);
  tomorrow = shift(1);
});
after(() => db.close());

const newRound = (date, extra = {}) => db.rpc('admin_create_round', {
  p: { mapId: 'campus', photoPath: `${randomUUID()}.jpg`, difficulty: 'easy', date, title: 'Test', truth, ...extra },
}, as('admin'));

test('bootstrap: guests vs players vs admins (admin needs the right provider too)', async () => {
  const guest = await db.rpc('get_bootstrap');
  assert.equal(guest.signedIn, false);
  assert.equal(guest.isAdmin, false);
  assert.equal(guest.scoring.position.max, config.position.max);
  assert.equal((await db.rpc('get_bootstrap', {}, as('ana'))).isAdmin, false);
  assert.equal((await db.rpc('get_bootstrap', {}, as('admin'))).isAdmin, true);
  assert.equal((await db.rpc('get_bootstrap', {}, as('fake'))).isAdmin, false, 'same email via email/password sign-up is not admin');
  assert.equal((await db.rpc('get_maps', { p_campus: CPP }))[0].id, 'campus');
});

test('tables are locked: no direct reads or writes from the public API', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(db.asRole(role, 'select * from public.round_answers'), /permission denied/);
    await assert.rejects(db.asRole(role, 'select * from public.admins'), /permission denied/);
    await assert.rejects(db.asRole(role, `insert into public.admins values ('x@y.z')`), /permission denied/);
  }
});

test('only admins can create rounds and use admin tools', async () => {
  await rejects(db.rpc('admin_create_round', { p: { mapId: 'campus' } }, as('ana')), /42501/);
  await rejects(db.rpc('admin_create_round', { p: { mapId: 'campus' } }), /42501|permission denied/);
  await rejects(db.rpc('admin_players', {}, as('fake')), /42501/);
  await rejects(db.rpc('admin_save_map', { p_map: { name: 'x' } }, as('ben')), /42501/);
  todayRound = await newRound(today);
  pastRound = await newRound(yesterday, { difficulty: 'night' });
  futureRound = await newRound(tomorrow);
  assert.equal(todayRound.date, today);
  assert.equal(todayRound.truth, undefined, 'the answer is never in a round listing');
  await rejects(newRound(today, { difficulty: 'bogus' }), /difficulty/);
  await rejects(newRound(today, { truth: { pos: { x: 1, y: 2 }, heading: 0 } }), /photo was taken/);
  await rejects(newRound(today, { photoPath: '../../etc/passwd' }), /photo/);
});

test('scheduled rounds stay hidden from players until their day', async () => {
  const ids = (await db.rpc('list_rounds', { p_campus: CPP })).map(r => r.id);
  assert.ok(ids.includes(todayRound.id) && ids.includes(pastRound.id));
  assert.ok(!ids.includes(futureRound.id));
  assert.ok(!(await db.rpc('list_rounds', { p_campus: CPP, p_include_scheduled: true }, as('ana'))).some(r => r.id === futureRound.id));
  assert.ok((await db.rpc('list_rounds', { p_campus: CPP, p_include_scheduled: true }, as('admin'))).some(r => r.id === futureRound.id));
  await rejects(db.rpc('get_round', { p_id: futureRound.id }, as('ana')), /P0002/);
  await rejects(db.rpc('submit_guess', { p_round: futureRound.id, p_pos: truth.pos, p_heading: 0 }, as('ana')), /P0002/);
  assert.equal((await db.rpc('get_today', { p_campus: CPP })).id, todayRound.id);
});

test('names: rules, blocked words, uniqueness', async () => {
  await rejects(db.rpc('set_display_name', { p_name: 'Ana' }), /sign in|permission denied/i);
  await rejects(db.rpc('set_display_name', { p_name: 'ab' }, as('ana')), /3 to 20/);
  await rejects(db.rpc('set_display_name', { p_name: '<script>' }, as('ana')), /letters, numbers/);
  await rejects(db.rpc('set_display_name', { p_name: 'Shi t lord' }, as('ana')), /different name/);
  await rejects(db.rpc('set_display_name', { p_name: 'The Admin' }, as('ana')), /different name/);
  assert.equal((await db.rpc('set_display_name', { p_name: '  Ana   Bronco ' }, as('ana'))).displayName, 'Ana Bronco');
  await rejects(db.rpc('set_display_name', { p_name: 'ana bronco' }, as('ben')), /taken/);
  await db.rpc('set_display_name', { p_name: 'Ben' }, as('ben'));
  await db.rpc('set_display_name', { p_name: 'Cy' + '_9' }, as('cy'));
  await db.rpc('set_display_name', { p_name: 'Boss' }, as('admin'));
  for (const n of ['ana', 'ben', 'cy', 'admin']) await db.rpc('join_campus', { p_campus: CPP }, as(n));
});

test("today's round: guests play unsaved; players need a name, get one ranked try", async () => {
  const guess = { p_round: todayRound.id, p_pos: { lat: 34.0586, lng: -117.8223 }, p_heading: 100 };
  const asGuest = await db.rpc('submit_guess', guess);
  assert.equal(asGuest.guesses[0].id, null, 'guests can play today, but nothing is stored');
  assert.equal(asGuest.guesses[0].ranked, false);
  assert.equal(asGuest.rank, null);
  const noName = person('dee', 'dee@example.com');
  await db.ensureUser(noName.id, 'dee@example.com');
  await rejects(db.rpc('submit_guess', guess, as('dee')), /needs_name/);

  const first = await db.rpc('submit_guess', guess, as('ana'));
  assert.equal(first.alreadyPlayed, false);
  assert.deepEqual(first.truth, truth);
  assert.equal(first.guesses.length, 1);
  assert.equal(first.guesses[0].ranked, true);
  assert.ok(Math.abs(first.guesses[0].distance - 100) < 1);
  assert.deepEqual(first.rank, { place: 1, of: 1 });

  const again = await db.rpc('submit_guess', { ...guess, p_pos: truth.pos, p_heading: 90 }, as('ana'));
  assert.equal(again.alreadyPlayed, true);
  assert.equal(again.guesses.length, 1, 'second try is not stored');
  assert.equal(again.guesses[0].total, first.guesses[0].total);

  const ben = await db.rpc('submit_guess', { ...guess, p_pos: truth.pos, p_heading: 90 }, as('ben'));
  assert.equal(ben.guesses[0].total, 10000);
  assert.deepEqual(ben.rank, { place: 1, of: 2 });

  const own = await db.rpc('submit_guess', { ...guess, p_pos: truth.pos }, as('admin'));
  assert.equal(own.guesses[0].ranked, false, "the admin who made the round isn't ranked on it");
  assert.equal(own.rank, null);
});

test('older rounds are practice: guests can play, nothing ranked', async () => {
  const guest = await db.rpc('submit_guess', { p_round: pastRound.id, p_pos: truth.pos, p_heading: 90 });
  assert.equal(guest.guesses[0].total, Math.round(10000 * config.difficulties.night.multiplier));
  assert.equal(guest.guesses[0].id, null, 'guest practice is not stored');
  assert.deepEqual(guest.truth, truth);
  const p1 = await db.rpc('submit_guess', { p_round: pastRound.id, p_pos: truth.pos, p_heading: 180 }, as('cy'));
  const p2 = await db.rpc('submit_guess', { p_round: pastRound.id, p_pos: truth.pos, p_heading: 90 }, as('cy'));
  assert.equal(p2.guesses.length, 2, 'practice can be repeated');
  assert.ok(p2.guesses.every(x => !x.ranked));
  assert.equal(p1.rank, null);
  assert.equal((await db.rpc('leaderboard_round', { p_round: pastRound.id })).rows.length, 0);
  const mine = await db.rpc('get_my_result', { p_round: pastRound.id }, as('cy'));
  assert.equal(mine.guesses.length, 2);
  const none = await db.rpc('get_my_result', { p_round: todayRound.id }, as('cy'));
  assert.equal(none.truth, null, "no answer before you've guessed");
});

test('bad guesses are refused', async () => {
  await rejects(db.rpc('submit_guess', { p_round: pastRound.id, p_pos: { x: 1, y: 1 }, p_heading: 0 }), /on the map/);
  await rejects(db.rpc('submit_guess', { p_round: pastRound.id, p_pos: truth.pos, p_heading: null }), /direction/);
  await rejects(db.rpc('submit_guess', { p_round: randomUUID(), p_pos: truth.pos, p_heading: 0 }), /P0002/);
  const far = await db.rpc('submit_guess', { p_round: pastRound.id, p_pos: { lat: 40, lng: -100 }, p_heading: 0 });
  assert.equal(far.guesses[0].pos.lat, 34.066, 'positions are kept inside the play area');
});

test('leaderboards: order, me flag, hidden names, overall totals', async () => {
  const lb = await db.rpc('leaderboard_round', { p_campus: CPP }, as('ana'));
  assert.equal(lb.round.id, todayRound.id);
  assert.deepEqual(lb.rows.map(r => r.name), ['Ben', 'Ana Bronco']);
  assert.equal(lb.rows[1].me, true);
  assert.equal(lb.rows[0].place, 1);

  await db.rpc('admin_set_hidden', { p_user: people.ben.id, p_hidden: true }, as('admin'));
  assert.deepEqual((await db.rpc('leaderboard_round', { p_campus: CPP })).rows.map(r => r.name), ['Ana Bronco']);
  assert.equal((await db.rpc('get_bootstrap', {}, as('ben'))).profile.hidden, true);
  await db.rpc('set_display_name', { p_name: 'Benjamin' }, as('ben')); // a new name un-hides
  assert.deepEqual((await db.rpc('leaderboard_round', { p_campus: CPP })).rows.map(r => r.name), ['Benjamin', 'Ana Bronco']);

  const overall = await db.rpc('leaderboard_overall', { p_campus: CPP });
  assert.equal(overall[0].name, 'Benjamin');
  assert.equal(overall[0].total, 10000);
  assert.equal(overall[0].rounds, 1);
  assert.deepEqual(await db.rpc('leaderboard_overall', { p_campus: CPP, p_days: 0 }), []);
  const players = await db.rpc('admin_players', {}, as('admin'));
  assert.ok(players.some(p => p.name === 'Benjamin' && p.plays === 1));
});

test('admin: maps are validated, rounds can be edited and deleted', async () => {
  const area = await db.rpc('admin_save_map', { p_map: {
    campusId: CPP, name: 'North campus', bounds: { sw: { lat: 34.05, lng: -117.83 }, ne: { lat: 34.06, lng: -117.82 } },
    features: [{ label: 'Fountain', pos: { lat: 40, lng: -117.825 } }, { label: 'bad', pos: { x: 1, y: 2 } }],
  } }, as('admin'));
  assert.equal(area.type, 'latlng');
  assert.deepEqual(area.features.map(f => f.pos), [{ lat: 34.06, lng: -117.825 }], 'labels are kept inside, malformed ones dropped');
  await rejects(db.rpc('admin_save_map', { p_map: { bounds: { sw: { lat: 34.06, lng: -117.82 }, ne: { lat: 34.05, lng: -117.83 } } } }, as('admin')), /Invalid play area/);
  await rejects(db.rpc('admin_save_map', { p_map: { type: 'latlng', bounds: { sw: { lat: 30, lng: -120 }, ne: { lat: 35, lng: -110 } } } }, as('admin')), /too big/);
  const campus = (await db.rpc('get_maps', { p_campus: CPP })).find(m => m.id === 'campus');
  const relabeled = await db.rpc('admin_save_map', { p_map: { ...campus, features: [{ label: 'Library', kind: 'building', source: 'osm', pos: { lat: 34.0577, lng: -117.8223 } }] } }, as('admin'));
  assert.equal(relabeled.type, 'latlng');
  assert.equal(relabeled.features[0].source, 'osm');

  const moved = await db.rpc('admin_update_round', { p_id: futureRound.id, p: { date: yesterday, title: 'Moved' } }, as('admin'));
  assert.equal(moved.date, yesterday);
  assert.deepEqual(await db.rpc('admin_round_answer', { p_id: futureRound.id }, as('admin')), truth);
  await rejects(db.rpc('admin_round_answer', { p_id: futureRound.id }, as('ana')), /42501/);
  const path = await db.rpc('admin_delete_round', { p_id: futureRound.id }, as('admin'));
  assert.match(path, /\.jpg$/);
  await rejects(db.rpc('get_round', { p_id: futureRound.id }), /P0002/);
  assert.deepEqual(await db.rpc('admin_list_admins', {}, as('admin')), [ADMIN]);
});

test('delete my account removes my name and scores', async () => {
  await db.rpc('delete_my_account', {}, as('ana'));
  const lb = await db.rpc('leaderboard_round', { p_campus: CPP });
  assert.deepEqual(lb.rows.map(r => r.name), ['Benjamin']);
  assert.equal((await db.rpc('get_bootstrap', {}, as('ana'))).profile, null);
});

test('SQL scoring matches the JavaScript scoring', async () => {
  const cfg = (await db.rpc('get_bootstrap')).scoring;
  const campus = (await db.rpc('get_maps', { p_campus: CPP })).find(m => m.id === 'campus');
  // a tiny play area too (about 200 m), where small distances swing the score a lot
  const small = { type: 'latlng', bounds: { sw: { lat: 34.0570, lng: -117.8230 }, ne: { lat: 34.0585, lng: -117.8210 } } };
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cases = [];
  for (let i = 0; i < 60; i++) {
    const map = i % 2 ? small : campus;
    const { sw, ne } = map.bounds;
    const pt = () => ({ lat: sw.lat + rand() * (ne.lat - sw.lat), lng: sw.lng + rand() * (ne.lng - sw.lng) });
    cases.push({ map, difficulty: Object.keys(cfg.difficulties)[i % 4], truth: { pos: pt(), heading: rand() * 360 }, guess: { pos: pt(), heading: rand() * 720 - 360 } });
  }
  for (const c of cases) {
    const js = scoreGuess(c, cfg);
    const sql = (await db.db.query(`select public.score_guess($1, $2, $3, $4, $5, $6, $7) as s`,
      [JSON.stringify(c.map), c.difficulty, JSON.stringify(c.truth.pos), c.truth.heading, JSON.stringify(c.guess.pos), c.guess.heading, JSON.stringify(cfg)])).rows[0].s;
    assert.ok(Math.abs(js.distance - sql.distance) < 1e-6, `distance ${js.distance} vs ${sql.distance}`);
    assert.ok(Math.abs(js.angleError - sql.angleError) < 1e-9);
    for (const k of ['position', 'direction', 'total', 'max']) assert.ok(Math.abs(js[k] - sql[k]) <= 1, `${k}: ${js[k]} vs ${sql[k]}`);
  }
});

test('contributors: request, approval, submissions, review queue and scheduling', async () => {
  const eve = person('eve', 'eve@example.com');
  await db.ensureUser(eve.id, 'eve@example.com');
  const photo = { mapId: 'campus', photoPath: `${randomUUID()}.jpg`, difficulty: 'hard', title: 'Eve 1', truth };

  await rejects(db.rpc('request_contributor', { p_note: 'hi' }, as('eve')), /needs_name/);
  await db.rpc('set_display_name', { p_name: 'Eve Photos' }, as('eve'));
  await rejects(db.rpc('request_contributor', { p_note: 'hi' }, as('eve')), /needs_campus/);
  await db.rpc('join_campus', { p_campus: CPP }, as('eve'));
  await rejects(db.rpc('submit_round', { p: photo }, as('eve')), /approved contributors/);
  assert.equal(await db.rpc('request_contributor', { p_note: 'I take lots of campus photos' }, as('eve')), 'pending');
  assert.equal((await db.rpc('get_bootstrap', {}, as('eve'))).contributor, 'pending');
  assert.equal(await db.rpc('can_upload', {}, as('eve')), false);
  await rejects(db.rpc('admin_set_contributor', { p_user: eve.id, p_status: 'approved' }, as('ben')), /42501/);

  const requests = await db.rpc('admin_contributors', {}, as('admin'));
  assert.equal(requests.find(r => r.userId === eve.id).note, 'I take lots of campus photos');
  await db.rpc('admin_set_contributor', { p_user: eve.id, p_status: 'approved' }, as('admin'));
  assert.equal(await db.rpc('can_upload', {}, as('eve')), true);

  const s1 = await db.rpc('submit_round', { p: photo }, as('eve'));
  const s2 = await db.rpc('submit_round', { p: { ...photo, title: 'Eve 2', photoPath: `${randomUUID()}.jpg` } }, as('eve'));
  const s3 = await db.rpc('submit_round', { p: { ...photo, title: 'Eve 3', photoPath: `${randomUUID()}.jpg` } }, as('eve'));
  assert.equal(s1.status, 'pending');
  assert.equal(s1.date, null);

  // pending photos are invisible to players, visible to their submitter and admins
  await rejects(db.rpc('get_round', { p_id: s1.id }, as('ana')), /P0002/);
  await rejects(db.rpc('get_round', { p_id: s1.id }), /P0002/);
  assert.equal((await db.rpc('get_round', { p_id: s1.id }, as('eve'))).round.status, 'pending');
  assert.ok(!(await db.rpc('list_rounds', { p_campus: CPP, p_include_scheduled: true }, as('admin'))).some(r => r.id === s1.id), 'not in the schedule until approved');
  assert.deepEqual((await db.rpc('admin_review_queue', {}, as('admin'))).map(r => r.title), ['Eve 1', 'Eve 2', 'Eve 3']);
  assert.equal((await db.rpc('admin_review_queue', {}, as('admin')))[0].submittedBy, 'Eve Photos');
  await rejects(db.rpc('admin_review_queue', {}, as('eve')), /42501/);
  await rejects(db.rpc('admin_approve_round', { p_id: s1.id }, as('eve')), /42501/);

  // approvals fill the next open days, one per day
  const busy = new Set((await db.rpc('list_rounds', { p_campus: CPP, p_include_scheduled: true }, as('admin'))).map(r => r.date));
  const a1 = await db.rpc('admin_approve_round', { p_id: s1.id }, as('admin'));
  const a2 = await db.rpc('admin_approve_round', { p_id: s2.id }, as('admin'));
  assert.equal(a1.status, 'published');
  assert.ok(a1.date >= today && !busy.has(a1.date), `scheduled on a free day, got ${a1.date}`);
  assert.ok(a2.date > a1.date, 'second approval goes on a later day');
  await rejects(db.rpc('admin_approve_round', { p_id: s1.id }, as('admin')), /no longer waiting/);

  // storage: approved but unscheduled, then scheduled on a chosen day
  const st = await db.rpc('admin_store_round', { p_id: s3.id }, as('admin'));
  assert.equal(st.status, 'stored');
  assert.equal(st.date, null);
  assert.equal((await db.rpc('admin_review_queue', {}, as('admin')))[0].status, 'stored');
  assert.ok(!(await db.rpc('list_rounds', { p_campus: CPP, p_include_scheduled: true }, as('admin'))).some(r => r.id === s3.id), 'stored rounds are not scheduled');
  await rejects(db.rpc('admin_approve_round', { p_id: s3.id, p_date: '2000-01-01' }, as('admin')), /today or a later day/);
  const s4 = await db.rpc('submit_round', { p: { ...photo, title: 'Eve 4' } }, as('eve'));
  const custom = await db.rpc('admin_approve_round', { p_id: s4.id, p_date: '2099-03-04' }, as('admin'));
  assert.equal(custom.date, '2099-03-04');

  const path = await db.rpc('admin_reject_round', { p_id: s3.id, p_note: 'Too blurry' }, as('admin'));
  assert.match(path, /\.jpg$/);
  const mine = await db.rpc('my_submissions', {}, as('eve'));
  assert.deepEqual(mine.map(r => [r.title, r.status]), [['Eve 4', 'published'], ['Eve 3', 'rejected'], ['Eve 2', 'published'], ['Eve 1', 'published']]);
  assert.equal(mine[1].reviewNote, 'Too blurry');
  assert.deepEqual(await db.rpc('admin_review_queue', {}, as('admin')), []);

  // denied contributors can't submit
  await db.rpc('admin_set_contributor', { p_user: eve.id, p_status: 'denied' }, as('admin'));
  await rejects(db.rpc('submit_round', { p: photo }, as('eve')), /approved contributors/);
});

test('campuses: one per player, switching, per-campus rounds and leaderboards, grad year', async () => {
  const campuses = await db.rpc('get_campuses');
  assert.ok(campuses.length > 150, 'California colleges are seeded');
  assert.ok(campuses.some(c => c.id === 'ucla' && c.short === 'UCLA'));
  await rejects(db.rpc('join_campus', { p_campus: 'nope' }, as('ben')), /needs_campus/);
  await rejects(db.rpc('join_campus', { p_campus: 'ucla' }), /sign in|permission denied/i);

  // every campus starts with a default map around its center
  const [uclaMap] = await db.rpc('get_maps', { p_campus: 'ucla' });
  assert.equal(uclaMap.campusId, 'ucla');
  assert.ok(uclaMap.bounds.sw.lat < 34.0689 && uclaMap.bounds.ne.lat > 34.0689);
  assert.equal((await db.rpc('get_maps', { p_campus: 'ucla' })).length, 1, 'only made once');

  // UCLA's round doesn't show at Cal Poly Pomona, and the days are independent
  const before = (await db.rpc('get_today', { p_campus: CPP })).id;
  const ucla = await newRound(today, { mapId: uclaMap.id, truth: { pos: { lat: 34.07, lng: -118.444 }, heading: 10 } });
  assert.equal(ucla.campusId, 'ucla');
  assert.equal((await db.rpc('get_today', { p_campus: 'ucla' })).id, ucla.id);
  assert.equal((await db.rpc('get_today', { p_campus: CPP })).id, before);
  assert.ok(!(await db.rpc('list_rounds', { p_campus: CPP })).some(r => r.id === ucla.id));

  // a CPP member playing UCLA's round is scored but not ranked
  person('dee', 'dee@example.com'); await db.ensureUser(people.dee.id, 'dee@example.com');
  await db.rpc('set_display_name', { p_name: 'Dee' }, as('dee'));
  await db.rpc('join_campus', { p_campus: 'ucla' }, as('dee'));
  const deeRes = await db.rpc('submit_guess', { p_round: ucla.id, p_pos: { lat: 34.07, lng: -118.444 }, p_heading: 10 }, as('dee'));
  assert.equal(deeRes.guesses[0].ranked, true);
  const anaRes = await db.rpc('submit_guess', { p_round: ucla.id, p_pos: { lat: 34.07, lng: -118.444 }, p_heading: 10 }, as('ben'));
  assert.equal(anaRes.guesses[0].ranked, false, 'not a member of UCLA');
  assert.deepEqual((await db.rpc('leaderboard_round', { p_campus: 'ucla' })).rows.map(r => r.name), ['Dee']);
  assert.deepEqual((await db.rpc('leaderboard_overall', { p_campus: 'ucla' })).map(r => r.name), ['Dee']);
  assert.ok(!(await db.rpc('leaderboard_overall', { p_campus: CPP })).some(r => r.name === 'Dee'));

  // switching campus moves you between leaderboards; switching back brings your scores back
  const cppBoard = async () => (await db.rpc('leaderboard_overall', { p_campus: CPP })).map(r => r.name);
  assert.ok((await cppBoard()).includes('Benjamin'));
  assert.equal((await db.rpc('join_campus', { p_campus: 'ucla' }, as('ben'))).id, 'ucla');
  assert.equal((await db.rpc('get_bootstrap', {}, as('ben'))).campus.id, 'ucla');
  assert.ok(!(await cppBoard()).includes('Benjamin'), 'left CPP');
  await db.rpc('join_campus', { p_campus: CPP }, as('ben'));
  assert.ok((await cppBoard()).includes('Benjamin'), 'back on CPP');

  // grad year
  await db.rpc('set_grad_year', { p_year: 2027 }, as('dee'));
  assert.equal((await db.rpc('get_bootstrap', {}, as('dee'))).profile.gradYear, 2027);
  assert.equal((await db.rpc('leaderboard_overall', { p_campus: 'ucla' }))[0].gradYear, 2027);
  await rejects(db.rpc('set_grad_year', { p_year: 1800 }, as('dee')), /graduation year/);
  await db.rpc('set_grad_year', { p_year: null }, as('dee'));
  assert.equal((await db.rpc('get_bootstrap', {}, as('dee'))).profile.gradYear, null);

  // contributors submit for their own campus only
  const eveId = people.eve.id;
  await db.rpc('admin_set_contributor', { p_user: eveId, p_status: 'approved' }, as('admin'));
  const photo = { mapId: uclaMap.id, photoPath: `${randomUUID()}.jpg`, difficulty: 'easy', truth: { pos: { lat: 34.07, lng: -118.444 }, heading: 0 } };
  await rejects(db.rpc('submit_round', { p: photo }, as('eve')), /own campus/);
  await db.rpc('join_campus', { p_campus: 'ucla' }, as('eve'));
  const sub = await db.rpc('submit_round', { p: photo }, as('eve'));
  assert.equal((await db.rpc('admin_review_queue', {}, as('admin'))).find(r => r.id === sub.id).campus, 'UCLA');
  const approved = await db.rpc('admin_approve_round', { p_id: sub.id }, as('admin'));
  assert.notEqual(approved.date, today, 'UCLA already has a round today, so the next free UCLA day');
});
