# CampusSpot

[![Tests](https://github.com/CampusSpot/campusspot.github.io/actions/workflows/test.yml/badge.svg)](https://github.com/CampusSpot/campusspot.github.io/actions/workflows/test.yml)

A daily photo game for California college campuses. Pick your campus; each day there's one photo taken somewhere on it: you guess **where the photographer stood** and **which way the camera was facing**, then see how close you were and where you rank.

**Play:** https://campusspot.github.io/

## How it works

- **Every California college.** UCs, CSUs, private colleges and community colleges, each with its own daily round and leaderboards. You belong to one campus at a time and can switch.
- **One round a day per campus.** It unlocks at midnight Pacific time. Anyone can play; sign in with Google and pick a leaderboard name to get a ranked try.
- **Scoring:** up to 5,000 points for the spot and 5,000 for the direction. Harder rounds (Hard, Nighttime, Impossible) multiply the total.
- **Leaderboards** for your campus: today, this week and all time. Other players only see the name you choose (and your class year, if you add it).
- **Contributors:** players can ask to submit photos of their campus. Admins approve contributors and review every photo before it's scheduled.
- **Past rounds** stay open as practice for anyone; they don't count toward the leaderboard.

## Built with

- A static site (plain HTML, CSS and JavaScript, no build step) hosted on GitHub Pages
- [Supabase](https://supabase.com): Postgres, Google sign-in and photo storage. All game rules, including scoring and keeping answers hidden, run in the database ([`supabase/schema.sql`](supabase/schema.sql)).
- [Leaflet](https://leafletjs.com) with USGS aerial imagery and OpenStreetMap

## Development

Needs [Node.js](https://nodejs.org) 22+.

```bash
npm install
npm start      # http://localhost:3000, with a local test database
npm test
```

## License

MIT, see [`LICENSE`](LICENSE). Third-party code, map imagery and map data are credited in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and on the site.

CampusSpot is an independent student project. It is not affiliated with or endorsed by any college or university.

The campus list (`public/data/campuses.json`) is built from U.S. Department of Education data (IPEDS and the College Scorecard), which is in the public domain.
