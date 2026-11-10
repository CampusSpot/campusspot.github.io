// Runs CampusSpot on this computer (http://localhost:3000, and on your phone over the same Wi-Fi).
//
//   Local mode (default until public/config.js has a Supabase URL; force it with: npm run local):
//     the real database runs in-process (PGlite, saved in data/), sign-in is "type an email",
//     admins are the emails in ADMIN_EMAILS (default admin@example.com). Nothing goes online
//     except map images.
//   Live mode (public/config.js has your Supabase project): just serves the site files; data,
//     Google sign-in and photos come from Supabase, exactly like the published site.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanAddresses } from './local/net.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'admin@example.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const configText = fs.readFileSync(path.join(PUBLIC_DIR, 'config.js'), 'utf8');
const hasSupabase = /supabaseUrl:\s*'https:\/\//.test(configText);
const LOCAL = process.env.LOCAL === '1' || process.argv.includes('--local') || !hasSupabase;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

// The deploy copies these into the site; locally they're served from the project root.
const ROOT_FILES = { '/LICENSE.txt': 'LICENSE', '/THIRD_PARTY_NOTICES.txt': 'THIRD_PARTY_NOTICES.md' };

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = ROOT_FILES[pathname] ? path.join(ROOT, ROOT_FILES[pathname]) : path.resolve(PUBLIC_DIR, path.normalize(rel));
  if (!ROOT_FILES[pathname] && !file.startsWith(PUBLIC_DIR + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const type = ROOT_FILES[pathname] ? 'text/plain; charset=utf-8' : MIME[path.extname(file).toLowerCase()] || (path.basename(file).includes('LICENSE') ? 'text/plain; charset=utf-8' : 'application/octet-stream');
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
  return true;
}

const ips = lanAddresses();
const urls = { http: ips.map(ip => `http://${ip}:${PORT}`) };

let emulator = null;
if (LOCAL) {
  const { openDb } = await import('./local/db.js');
  const { createEmulator } = await import('./local/emulator.js');
  const db = await openDb({ dataDir: path.join(DATA_DIR, 'db'), adminEmails: ADMIN_EMAILS });
  emulator = createEmulator({ db, dataDir: DATA_DIR });
}

async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/local-info.js') {
      // Overrides public/local-info.js: tells the page it's served from this computer, and how phones reach it.
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(`window.CAMPUSSPOT_LOCAL = ${JSON.stringify({ local: LOCAL, urls, adminEmails: LOCAL ? ADMIN_EMAILS : [] })};\n`);
    }
    if (emulator && (await emulator(req, res, url))) return;
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (serveStatic(res, url.pathname)) return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(err.status || 500, { 'Content-Type': 'text/plain' }).end(err.status ? err.message : 'Server error');
  }
}

const onError = port => err => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use: an older CampusSpot is probably still running. Stop it, or use another port: PORT=3001 npm start` : err);
  process.exit(1);
};

http.createServer(handle).on('error', onError(PORT)).listen(PORT, HOST, () => {
  const lines = [
    '',
    `  CampusSpot is running — ${LOCAL ? 'LOCAL mode (test database on this computer)' : 'LIVE mode (your Supabase project)'}`,
    '',
    `  On this computer: http://localhost:${PORT}`,
    ...urls.http.map((u, i) => `  ${i ? '                  ' : 'On your phone:    '}${u}   (same Wi-Fi)`),
  ];
  if (LOCAL) lines.push('', `  Admin sign-in for testing: ${ADMIN_EMAILS.join(', ')} (any other email = normal player)`, `  Data: ${DATA_DIR}`);
  console.log([...lines, ''].join('\n'));
});
