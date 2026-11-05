// Local mode speaks enough of Supabase's API for the real Supabase client library: sign-in,
// database functions, and photo upload/delete with admin-only permissions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { openDb } from '../local/db.js';
import { createEmulator } from '../local/emulator.js';

let server, base, dataDir, db;
const client = () => createClient(base, 'local-mode', { auth: { persistSession: false, autoRefreshToken: false } });
async function signIn(email) {
  const sb = client();
  const tokens = await (await fetch(`${base}/auth/v1/dev-login`, { method: 'POST', body: JSON.stringify({ email }) })).json();
  const { error } = await sb.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
  assert.equal(error, null);
  return sb;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polyspot-local-'));
  db = await openDb({ adminEmails: ['admin@example.com'] });
  const emulator = createEmulator({ db, dataDir });
  server = http.createServer(async (req, res) => {
    if (!(await emulator(req, res, new URL(req.url, 'http://x')))) res.writeHead(404).end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('guests can call public functions; errors come back in Supabase format', async () => {
  const sb = client();
  const { data } = await sb.rpc('get_bootstrap');
  assert.equal(data.signedIn, false);
  const { error } = await sb.rpc('set_display_name', { p_name: 'Nope' });
  assert.match(error.message, /permission denied/);
});

test('signed-in players and admins', async () => {
  const player = await signIn('ana@example.com');
  assert.equal((await player.auth.getUser()).data.user.email, 'ana@example.com');
  const { data: boot } = await player.rpc('get_bootstrap');
  assert.equal(boot.signedIn, true);
  assert.equal(boot.isAdmin, false);
  const named = await player.rpc('set_display_name', { p_name: 'x' });
  assert.match(named.error.message, /3 to 20/);
  assert.equal((await player.rpc('set_display_name', { p_name: 'Ana' })).data.displayName, 'Ana');

  const admin = await signIn('Admin@Example.com');
  assert.equal((await admin.rpc('get_bootstrap')).data.isAdmin, true);
  await admin.auth.signOut();
});

test('photos: admins upload and delete, others are refused, anyone can view', async () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer;
  const player = await signIn('ben@example.com');
  const refused = await player.storage.from('photos').upload('a.jpg', bytes, { contentType: 'image/jpeg' });
  assert.ok(refused.error);

  const admin = await signIn('admin@example.com');
  const up = await admin.storage.from('photos').upload('rounds/a.jpg', bytes, { contentType: 'image/jpeg' });
  assert.equal(up.error, null);
  const url = admin.storage.from('photos').getPublicUrl('rounds/a.jpg').data.publicUrl;
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${base}/storage/v1/object/public/photos/..%2Flocal-secret`)).status, 404);

  assert.ok((await player.storage.from('photos').remove(['rounds/a.jpg'])).error);
  assert.equal((await admin.storage.from('photos').remove(['rounds/a.jpg'])).error, null);
  assert.equal((await fetch(url)).status, 404);
});

test('forged tokens are ignored', async () => {
  const fake = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '00000000-0000-4000-8000-000000000000', email: 'admin@example.com', app_metadata: { provider: 'dev' }, exp: 9e9 })).toString('base64url')}.bad`;
  const res = await fetch(`${base}/rest/v1/rpc/get_bootstrap`, { method: 'POST', headers: { Authorization: `Bearer ${fake}` }, body: '{}' });
  assert.equal((await res.json()).isAdmin, false);
});
