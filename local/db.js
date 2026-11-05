// The real PolySpot database (supabase/schema.sql) running in-process with PGlite (Postgres compiled
// to WebAssembly). Used by local mode and the tests, so they exercise the exact SQL that runs on Supabase.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { seedSql } from '../scripts/build-sql.js';

const sqlDir = fileURLToPath(new URL('../supabase/', import.meta.url));
const read = f => fs.readFileSync(sqlDir + f, 'utf8');

export class RpcError extends Error {
  constructor(err) {
    super(err.message);
    this.code = err.code || 'XX000';
    this.hint = err.hint || null;
    this.details = err.detail || null;
  }
}

/**
 * @param {{ dataDir?: string, adminEmails?: string[] }} opts  dataDir: folder to keep the database in (omit = in memory)
 */
export async function openDb({ dataDir, adminEmails = [] } = {}) {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.exec(read('local-auth.sql'));
  await db.exec(read('schema.sql'));
  await db.query(`select set_config('polyspot.admin_emails', $1, false)`, [adminEmails.join(',')]);
  await db.exec(seedSql({ adminProviders: ['google', 'dev'] }));

  /**
   * Calls a public function the way Supabase's API does: as role "anon" (no claims) or "authenticated"
   * (claims = the signed-in user's token contents), with named arguments.
   */
  async function rpc(fn, args = {}, claims = null) {
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new RpcError({ message: 'Bad function name', code: '42883' });
    const keys = Object.keys(args);
    if (!keys.every(k => /^[a-z_][a-z0-9_]*$/.test(k))) throw new RpcError({ message: 'Bad argument name', code: '42883' });
    const role = claims?.sub ? 'authenticated' : 'anon';
    const params = keys.map(k => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    try {
      return await db.transaction(async tx => {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || { role: 'anon' })]);
        await tx.exec(`set local role ${role}`);
        const res = await tx.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as result`, params);
        const value = res.rows[0]?.result;
        return value === '' ? null : value ?? null; // "void" functions
      });
    } catch (err) {
      throw new RpcError(err);
    }
  }

  /** Runs SQL as a given role (tests use this to prove tables are locked). */
  async function asRole(role, sql, claims = null) {
    return db.transaction(async tx => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || {})]);
      await tx.exec(`set local role ${role}`);
      return (await tx.query(sql)).rows;
    });
  }

  /** Local-mode sign-in: makes sure the user row exists (Supabase does this itself). */
  async function ensureUser(id, email) {
    await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do update set email = excluded.email`, [id, email]);
  }

  return { db, rpc, asRole, ensureUser, close: () => db.close() };
}
