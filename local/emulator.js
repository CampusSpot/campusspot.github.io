// Local mode: answers the small part of Supabase's web API that PolySpot uses, backed by the real
// database SQL running in PGlite. The browser app talks to it with the normal Supabase library, so
// local mode and the live site run the same code. Sign-in is a simple "type an email" form (no Google).
//
//   POST   /rest/v1/rpc/<function>                 database functions
//   GET    /auth/v1/user, POST /auth/v1/token, POST /auth/v1/logout, POST /auth/v1/dev-login
//   POST   /storage/v1/object/photos/<path>        upload (admins only)
//   DELETE /storage/v1/object/photos               delete (admins only)
//   GET    /storage/v1/object/public/photos/<path> view
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_UPLOAD = 6 * 1024 * 1024;
const b64url = buf => Buffer.from(buf).toString('base64url');

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

/**
 * @param {{ db: Awaited<ReturnType<import('./db.js').openDb>>, dataDir: string }} opts
 * @returns {(req, res, url: URL) => Promise<boolean>} handles the request and returns true, or returns false
 */
export function createEmulator({ db, dataDir }) {
  const photosDir = path.join(dataDir, 'photos');
  fs.mkdirSync(photosDir, { recursive: true });
  const secretFile = path.join(dataDir, 'local-secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
  const secret = fs.readFileSync(secretFile, 'utf8');
  const refreshTokens = new Map(); // refresh token → user

  function sign(payload) {
    const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    return `${head}.${body}.${b64url(crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest())}`;
  }
  function verify(token) {
    const [head, body, sig] = String(token || '').split('.');
    if (!sig) return null;
    const good = b64url(crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest());
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    return claims.exp * 1000 > Date.now() ? claims : null;
  }
  const claimsOf = req => verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));

  const userJson = c => ({
    id: c.sub, aud: 'authenticated', role: 'authenticated', email: c.email,
    app_metadata: c.app_metadata, user_metadata: {}, created_at: new Date(0).toISOString(),
  });

  function session(user) {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 30 * 24 * 3600;
    const claims = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', app_metadata: { provider: 'dev', providers: ['dev'] }, iat: now, exp: now + expiresIn };
    const refresh = crypto.randomBytes(24).toString('base64url');
    refreshTokens.set(refresh, user);
    return { access_token: sign(claims), refresh_token: refresh, token_type: 'bearer', expires_in: expiresIn, expires_at: now + expiresIn, user: userJson(claims) };
  }

  const userIdFor = email => {
    const h = crypto.createHash('sha256').update(`polyspot-local:${email}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };

  return async function handle(req, res, url) {
    const p = url.pathname;

    // ── database functions ──
    const rpc = p.match(/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/);
    if (rpc && req.method === 'POST') {
      const raw = (await readBody(req)).toString() || '{}';
      let args;
      try { args = JSON.parse(raw); } catch { json(res, 400, { message: 'Invalid JSON', code: 'PGRST102' }); return true; }
      try {
        json(res, 200, await db.rpc(rpc[1], args, claimsOf(req)));
      } catch (err) {
        json(res, 400, { message: err.message, code: err.code, hint: err.hint, details: err.details });
      }
      return true;
    }

    // ── sign-in (local only: no passwords, no Google) ──
    if (p === '/auth/v1/dev-login' && req.method === 'POST') {
      const { email } = JSON.parse((await readBody(req)).toString() || '{}');
      if (!/^[^@\s]+@[^@\s]+$/.test(email || '')) { json(res, 400, { message: 'Enter an email address' }); return true; }
      const user = { id: userIdFor(email.toLowerCase()), email: email.toLowerCase() };
      await db.ensureUser(user.id, user.email);
      json(res, 200, session(user));
      return true;
    }
    if (p === '/auth/v1/user' && req.method === 'GET') {
      const c = claimsOf(req);
      if (c) json(res, 200, userJson(c)); else json(res, 401, { message: 'Invalid token', code: 'bad_jwt' });
      return true;
    }
    if (p === '/auth/v1/token' && req.method === 'POST') {
      const { refresh_token: token } = JSON.parse((await readBody(req)).toString() || '{}');
      const user = refreshTokens.get(token);
      if (!user) { json(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', message: 'Invalid Refresh Token' }); return true; }
      refreshTokens.delete(token);
      json(res, 200, session(user));
      return true;
    }
    if (p === '/auth/v1/logout' && req.method === 'POST') {
      res.writeHead(204).end();
      return true;
    }

    // ── photo storage ──
    const pub = p.match(/^\/storage\/v1\/object\/public\/photos\/([A-Za-z0-9][A-Za-z0-9/_.-]*)$/);
    if (pub && req.method === 'GET') {
      const file = path.join(photosDir, path.normalize(pub[1]));
      if (!file.startsWith(photosDir + path.sep) || !fs.existsSync(file)) { json(res, 404, { message: 'Object not found' }); return true; }
      const type = { '.png': 'image/png', '.webp': 'image/webp' }[path.extname(file)] || 'image/jpeg';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
      fs.createReadStream(file).pipe(res);
      return true;
    }
    const up = p.match(/^\/storage\/v1\/object\/photos\/([A-Za-z0-9][A-Za-z0-9/_.-]*)$/);
    if ((up && req.method === 'POST') || (p === '/storage/v1/object/photos' && req.method === 'DELETE')) {
      const claims = claimsOf(req);
      const admin = claims && (await db.rpc('get_bootstrap', {}, claims)).isAdmin;
      if (!admin) { json(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }); return true; }
      if (up) {
        if (!/^image\/(jpeg|png|webp)$/.test(req.headers['content-type'] || '')) { json(res, 415, { message: 'Only JPEG, PNG or WebP' }); return true; }
        const file = path.join(photosDir, path.normalize(up[1]));
        if (!file.startsWith(photosDir + path.sep)) { json(res, 400, { message: 'Bad path' }); return true; }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, await readBody(req, MAX_UPLOAD));
        json(res, 200, { Key: `photos/${up[1]}`, Id: crypto.randomUUID() });
      } else {
        const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}');
        const removed = [];
        for (const name of prefixes) {
          const file = path.join(photosDir, path.normalize(String(name)));
          if (file.startsWith(photosDir + path.sep) && fs.existsSync(file)) { fs.rmSync(file); removed.push({ name }); }
        }
        json(res, 200, removed);
      }
      return true;
    }
    return false;
  };
}
