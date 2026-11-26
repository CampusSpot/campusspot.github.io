// Tests round chat and announcements (supabase/community.sql) in PGlite: who can read and write,
// limits, moderation, and the per-account "read" marker.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb } from '../local/db.js';

let db, today, tomorrow;
const ADMIN = 'boss@example.com';
const CPP = 'cal-poly-pomona';
const people = {};
const as = name => people[name]?.claims ?? null;
const rejects = (p, re) => assert.rejects(p, err => re.test(`${err.code} ${err.message} ${err.hint}`));
const truth = { pos: { lat: 34.0577, lng: -117.8223 }, heading: 90 };
let round, futureRound;

before(async () => {
  db = await openDb({ adminEmails: [ADMIN] });
  for (const [n, e] of [['admin', ADMIN], ['ana', 'ana@example.com'], ['ben', 'ben@example.com'], ['cy', 'cy@example.com'], ['dee', 'dee@example.com']]) {
    const id = randomUUID();
    people[n] = { id, claims: { sub: id, role: 'authenticated', email: e, app_metadata: { provider: 'google' } } };
    await db.ensureUser(id, e);
  }
  for (const [n, name] of [['admin', 'Boss'], ['ana', 'Ana'], ['ben', 'Ben'], ['cy', 'Cyrus']]) {
    await db.rpc('set_display_name', { p_name: name }, as(n));
    await db.rpc('join_campus', { p_campus: CPP }, as(n));
  }
  today = (await db.rpc('get_bootstrap')).today;
  const t = new Date(today + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1);
  tomorrow = t.toISOString().slice(0, 10);
  const make = date => db.rpc('admin_create_round', { p: { mapId: 'campus', photoPath: `${randomUUID()}.jpg`, difficulty: 'easy', date, title: 'Chat test', truth } }, as('admin'));
  round = await make(today);
  futureRound = await make(tomorrow);
});
after(() => db.close());

const guess = who => db.rpc('submit_guess', { p_round: round.id, p_pos: truth.pos, p_heading: 90 }, as(who));
const chat = who => db.rpc('get_round_chat', { p_round: round.id }, as(who));
const post = (who, body) => db.rpc('post_chat_message', { p_round: round.id, p_body: body }, as(who));

test('new tables are locked: no direct reads or writes from the public API', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const t of ['chat_messages', 'announcements', 'announcement_reads']) {
      await assert.rejects(db.asRole(role, `select * from public.${t}`), /permission denied/);
    }
    await assert.rejects(db.asRole(role, `insert into public.announcements (title) values ('x')`), /permission denied/);
  }
});

test('chat: signed-in players read and write only after guessing', async () => {
  await rejects(chat('ana'), /needs_guess/);
  await rejects(post('ana', 'hello'), /needs_guess/);
  await guess('ana');
  const empty = await chat('ana');
  assert.deepEqual(empty, { canPost: true, messages: [] });
  const msg = await post('ana', '  near   the library?  ');
  assert.equal(msg.body, 'near the library?', 'spaces are tidied');
  assert.equal(msg.name, 'Ana');
  assert.equal(msg.me, true);
  await rejects(post('ana', 'again'), /slow down/i);
  await rejects(chat('ben'), /needs_guess/, 'ben has not guessed yet');
  await guess('ben');
  const seen = await chat('ben');
  assert.equal(seen.messages.length, 1);
  assert.equal(seen.messages[0].me, false);
  assert.equal(seen.messages[0].admin, false);
});

test('chat: guests can read but not write; names, limits and unreleased rounds', async () => {
  const guest = await chat(null);
  assert.equal(guest.canPost, false);
  assert.equal(guest.messages.length, 1);
  await rejects(post(null, 'hi'), /sign in|permission denied/i);
  await rejects(post('dee', 'hi'), /needs_name/, 'a leaderboard name is needed to chat');
  await guess('cy');
  await rejects(post('cy', '   '), /write a message/i);
  await rejects(post('cy', 'x'.repeat(301)), /300/);
  await rejects(db.rpc('get_round_chat', { p_round: futureRound.id }, as('ana')), /not found/i);
  await rejects(db.rpc('post_chat_message', { p_round: futureRound.id, p_body: 'hi' }, as('ana')), /not found/i);
});

test('chat: hidden names disappear, admins can always chat and delete, players delete their own', async () => {
  const cyMsg = await post('cy', 'by the CLA building');
  await db.rpc('admin_set_hidden', { p_user: people.cy.id, p_hidden: true }, as('admin'));
  assert.ok(!(await chat('ana')).messages.some(m => m.id === cyMsg.id), 'hidden names are left out');
  await rejects(post('cy', 'still here'), /needs_name/);
  await db.rpc('admin_set_hidden', { p_user: people.cy.id, p_hidden: false }, as('admin'));

  const boss = await post('admin', 'Be nice, everyone');
  assert.equal(boss.admin, true, 'admins can chat without guessing and are marked');
  await rejects(db.rpc('delete_chat_message', { p_id: cyMsg.id }, as('ben')), /not found/i);
  await db.rpc('delete_chat_message', { p_id: cyMsg.id }, as('cy'));
  await db.rpc('delete_chat_message', { p_id: boss.id }, as('admin'));
  const ana = (await chat('ana')).messages;
  assert.deepEqual(ana.map(m => m.body), ['near the library?']);
  await db.rpc('delete_chat_message', { p_id: ana[0].id }, as('admin'));
  assert.equal((await chat('ana')).messages.length, 0);
});

test('announcements: only admins post; everyone reads; each account tracks what it read', async () => {
  assert.deepEqual(await db.rpc('announcements_status'), { latest: null, readAt: null });
  await rejects(db.rpc('admin_post_announcement', { p_title: 'Hi', p_body: '' }, as('ana')), /42501/);
  await rejects(db.rpc('admin_post_announcement', { p_title: 'Hi', p_body: '' }), /42501|permission denied/);
  await rejects(db.rpc('admin_post_announcement', { p_title: '  ', p_body: 'x' }, as('admin')), /title/i);
  await rejects(db.rpc('admin_post_announcement', { p_title: 'x'.repeat(81), p_body: '' }, as('admin')), /80/);
  const first = await db.rpc('admin_post_announcement', { p_title: ' Welcome ', p_body: 'Chat is live!' }, as('admin'));
  assert.equal(first.title, 'Welcome');

  const guest = await db.rpc('get_announcements');
  assert.equal(guest.items.length, 1);
  assert.equal(guest.readAt, null);
  const before = await db.rpc('announcements_status', {}, as('ana'));
  assert.ok(before.latest && before.readAt === null, 'unread for ana');
  await rejects(db.rpc('mark_announcements_read', { p_upto: before.latest }), /sign in|permission denied/i);
  await db.rpc('mark_announcements_read', { p_upto: before.latest }, as('ana'));
  const after = await db.rpc('announcements_status', {}, as('ana'));
  assert.equal(new Date(after.readAt).getTime(), new Date(after.latest).getTime(), 'read for ana');
  assert.equal((await db.rpc('announcements_status', {}, as('ben'))).readAt, null, 'still unread for ben');

  await new Promise(r => setTimeout(r, 5));
  const second = await db.rpc('admin_post_announcement', { p_title: 'Bonus round Friday', p_body: '' }, as('admin'));
  const now = await db.rpc('announcements_status', {}, as('ana'));
  assert.ok(new Date(now.latest) > new Date(now.readAt), 'a new one is unread again');
  await db.rpc('mark_announcements_read', { p_upto: first.createdAt }, as('ana'));
  assert.ok(new Date((await db.rpc('announcements_status', {}, as('ana'))).readAt) >= new Date(now.readAt), 'read marker never goes back');

  assert.deepEqual((await db.rpc('get_announcements')).items.map(a => a.title), ['Bonus round Friday', 'Welcome']);
  await rejects(db.rpc('admin_delete_announcement', { p_id: second.id }, as('ana')), /42501/);
  await db.rpc('admin_delete_announcement', { p_id: second.id }, as('admin'));
  assert.equal((await db.rpc('get_announcements')).items.length, 1);
});

test('deleting an account removes its chat messages and read marker', async () => {
  await new Promise(r => setTimeout(r, 3100));
  await post('ben', 'bye');
  await db.rpc('mark_announcements_read', { p_upto: null }, as('ben'));
  await db.rpc('delete_my_account', {}, as('ben'));
  assert.ok(!(await chat('ana')).messages.some(m => m.body === 'bye'));
  const left = await db.db.query('select count(*)::int as n from public.announcement_reads where user_id = $1', [people.ben.id]);
  assert.equal(left.rows[0].n, 0);
});
