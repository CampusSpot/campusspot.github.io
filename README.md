# PolySpot

[![Tests](https://github.com/Rassa1/polyspot/actions/workflows/test.yml/badge.svg)](https://github.com/Rassa1/polyspot/actions/workflows/test.yml)

A daily photo game for Cal Poly Pomona. Every day there's one photo taken somewhere on campus: players guess **where the photographer stood** and **which way the camera faced**, then see how close they were and where they rank.

- **Play:** sign in with Google, choose a leaderboard name, and get **one try** at the day's round. Past rounds are open to everyone as practice.
- **Leaderboards:** today, this week, all time.
- **Admins (1–2 people):** take photos, mark the spot and direction, schedule rounds day by day, edit the campus map, and hide inappropriate names.
- **Map:** overhead satellite view of campus with building names, plus to-scale indoor floor plans.

**Contents:** [Put it online](#put-it-online) · [Run it on your computer](#run-it-on-your-computer) · [How it works](#how-it-works) · [Scoring](#scoring) · [Project layout](#project-layout) · [Legal](#legal-and-licenses) · [Next steps](#next-steps)

## Put it online

Free, using GitHub Pages (website) + Supabase (database, Google sign-in, photos). Step-by-step guide with every click: **[docs/SETUP.md](docs/SETUP.md)**.

## Run it on your computer

You need [Git](https://git-scm.com) and [Node.js](https://nodejs.org) 20 or newer.

```bash
cd ~
git clone https://github.com/Rassa1/polyspot.git
cd polyspot
npm install
npm start
```

Open `http://localhost:3000`. On your phone (same Wi-Fi), open the `http://192.168…:3000` address it prints, or scan the QR code on the home page.

- **Local mode (default):** until `public/config.js` has a Supabase URL, PolySpot runs a complete test copy on your computer. It uses the same database code as the live site, saved in `data/`. Sign-in is "type any email". `admin@example.com` is an admin; change that with `ADMIN_EMAILS=you@x.com npm start`. Map images still need internet.
- **Live mode:** once `public/config.js` is filled in, `npm start` serves the site against your real Supabase project, like the published site. `npm run local` forces local mode.

| Command | What it does |
|---|---|
| `npm start` | Run the site (and local test database) on port 3000 |
| `npm run local` | Force local mode even when Supabase is configured |
| `npm run dev` | Same as start, restarting on file changes |
| `npm test` | All tests: database rules, scoring, local server, files |
| `npm run check` | Syntax-check every JavaScript file |
| `npm run build:sql` | Rebuild `supabase/setup.sql` after changing scoring or SQL |
| `npm run vendor` | Copy the Supabase browser library into `public/vendor` after updating it |
| `npm run cert` | HTTPS certificates for testing the phone compass on your Wi-Fi (the published site already has HTTPS) |

### Troubleshooting
- **"Port 3000 is already in use":** an older copy is still running. Stop it, then start again.
  - Windows PowerShell: `Get-NetTCPConnection -LocalPort 3000 | % { Stop-Process -Id $_.OwningProcess -Force }`
  - macOS/Linux: `lsof -ti :3000 | xargs kill`
- **"Cannot find path" / "not a git repository":** run `cd ~/polyspot` first.
- **Phone can't connect:** allow Node through the firewall (private networks). Campus Wi-Fi often blocks device-to-device traffic; use your phone's hotspot for the computer instead.
- **To start over in local mode:** stop the server and delete the `data` folder.

## How it works

- **Today's round** unlocks at midnight Pacific time. You need to be signed in with a leaderboard name. You get one try, and it's ranked, except for the admin who made it.
- **Past rounds** are practice: anyone can play, as often as they like, and they're not ranked. Guests' practice isn't saved.
- **Answers stay hidden.** The database only reveals the true spot to someone who has already guessed, and scheduled rounds are invisible to players until their day.
- **Names:** 3–20 characters. A list of blocked words catches the obvious bad ones (`supabase/blocked-names.json`), and admins can hide any name. That player is then asked for a new one.
- **Privacy:** other players see only the chosen name. Players can delete their account and scores at any time.

**Playing:** look at the photo, tap **Guess on map**, tap where the photographer stood, then aim:
- **Campus map:** drag the white ring.
- **Indoor floor plan:** drag from the dot.

The slider and ⟲/⟳ buttons fine-tune the direction. When hosting, **Use phone compass** sets the direction from the phone; it needs HTTPS, which the published site has.

## Scoring

All scoring settings are in **[`public/shared/scoring.config.js`](public/shared/scoring.config.js)**. The database scores every guess with the same formulas (`supabase/schema.sql`), and a test checks that the two always agree. After changing the settings:
1. Run `npm run build:sql`.
2. Re-run `supabase/setup.sql` in Supabase.

```
position  = 5000 × exp(−distance / scale)      scale = map diagonal × 0.15 × difficulty.scale
direction = 5000 × (1 − angleError / 180)      angleError = shortest difference, 0–180°
total     = (position + direction) × difficulty.multiplier
```

| Difficulty | distance leniency | multiplier | max |
|---|---|---|---|
| Easy | ×1.0 | ×1 | 10,000 |
| Hard | ×1.3 | ×1.25 | 12,500 |
| Nighttime | ×1.6 | ×1.5 | 15,000 |
| Impossible | ×2.0 | ×2 | 20,000 |

On campus (play area about 3 km across), the Easy scale is about 450 m. Being 50 m off gives about 4,470 position points; 100 m off gives about 4,000; 300 m off gives about 2,560.

## Project layout

```
public/                     the website (published to GitHub Pages as-is)
  index.html, style.css, config.js (your Supabase settings), icon.svg
  shared/                   scoring, geometry, OpenStreetMap import (also used by tests)
  js/
    app.js                  app shell + router
    backend.js, session.js, api.js   Supabase connection, sign-in, every database call
    map/                    floorplan.js (SVG floor plans), leaflet.js (campus satellite map)
    views/                  home, play, result, leaderboard, archive, account, legal, admin/*
  vendor/                   Leaflet, supabase-js, qrcode-generator (+ their licenses)
supabase/
  schema.sql                tables, security rules, game logic, leaderboard (the backend)
  storage.sql               photo storage rules
  setup.sql                 everything combined, to paste into Supabase (generated)
local/                      local mode: same SQL on PGlite, a stand-in for Supabase's API
server.js                   npm start
test/                       database, scoring, local server and file checks
docs/SETUP.md               how to put it online
```

**Security model:**
- Every table is locked (row-level security on, no policies).
- The site can only call database functions, and each one checks whether you're a guest, a signed-in player or an admin (by Google email, from the `admins` table).
- The site's Content Security Policy only allows this site, Supabase and the map providers.

## Legal and licenses

- **Code:** MIT ([`LICENSE`](LICENSE)). Bundled libraries keep their licenses: Leaflet (BSD-2), supabase-js (MIT), qrcode-generator (MIT). Full list, with map imagery and data terms, in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The site shows them under **About & credits**.
- **Privacy policy and terms of use** are built into the site (`#/privacy`, `#/terms`). Google requires them for sign-in, and they cover California privacy law (CCPA). Put a contact email in `public/config.js` so they're complete.
- **Map credits** appear on the map automatically. Don't hide them.
- **Not affiliated:** PolySpot is an independent student project, not endorsed by Cal Poly Pomona, the CSU, or GeoGuessr. It uses no university logos. Keep university marks out of any domain name.
- **Photos:**
  - Only use photos you took.
  - Avoid people, ID cards, license plates and room numbers.
  - Don't go into closed areas.
  - Remove a photo if someone asks.
- **Growing up:** the free OpenStreetMap tile server and Esri's free tier aren't meant for big or commercial sites. If PolySpot gets popular or makes money, move to a paid map provider and review each provider's terms.

This is a good-faith summary for a free student project, not legal advice.

## Next steps

1. **Streaks and stats:** daily streak, personal best, average by difficulty.
2. **Hints:** an optional hint that costs points (e.g. "near a parking lot").
3. **Notifications:** an installable app (PWA) with a daily reminder.
4. **Friends leagues:** private leaderboards with a join code.
5. **Offline campus map:** serve the play area's imagery from the site itself (from USGS downloads) instead of tile servers.
6. **Moderation log:** record admin actions (hidden names, deleted rounds).
