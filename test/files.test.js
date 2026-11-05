// Checks on generated and published files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupSql } from '../scripts/build-sql.js';

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('supabase/setup.sql is up to date (run: npm run build:sql)', () => {
  assert.equal(read('supabase/setup.sql'), setupSql());
});

test('no real admin email or secret key is committed', () => {
  const config = read('public/config.js');
  assert.doesNotMatch(config, /sb_secret_[A-Za-z0-9_-]{8,}/, 'secret keys must never be in the site');
  for (const [jwt] of config.matchAll(/eyJ[\w-]+\.([\w-]+)\.[\w-]+/g)) {
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    assert.notEqual(claims.role, 'service_role', 'the service_role key must never be in the site');
  }
  assert.match(read('supabase/setup.sql'), /set_config\('polyspot\.admin_emails', 'your\.email@gmail\.com'/);
});

test('the bundled Supabase library matches the installed version', () => {
  const pkg = JSON.parse(read('node_modules/@supabase/supabase-js/package.json'));
  const bundled = read('public/vendor/supabase.js');
  assert.ok(bundled.includes(pkg.version), `public/vendor/supabase.js should be supabase-js ${pkg.version} (run: npm run vendor)`);
});

test('every file the page loads exists', () => {
  const html = read('public/index.html');
  for (const [, src] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) assert.ok(fs.existsSync(new URL(`../public/${src}`, import.meta.url)), src);
});
