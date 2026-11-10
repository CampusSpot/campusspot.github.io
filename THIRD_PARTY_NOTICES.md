# Third-party notices

CampusSpot's own code is MIT-licensed (see `LICENSE`). It includes or uses the components and online services below, and each keeps its own license or terms. The site shows this list under **About & credits** and links to this file.

This is a good-faith summary for a free, non-commercial student project, not legal advice. Re-check each provider's current terms before adding ads, charging money, or growing to a large audience.

## Code shipped with the website (`public/vendor/`)

| Component | Version | License | Full text |
|---|---|---|---|
| [Leaflet](https://leafletjs.com) | 1.9.4 | BSD 2-Clause. © 2010–2023 Volodymyr Agafonkin, © 2010–2011 CloudMade | `public/vendor/leaflet/LICENSE` |
| [supabase-js](https://github.com/supabase/supabase-js) (browser build, includes `@supabase/auth-js`, `postgrest-js`, `storage-js`, `realtime-js`, `functions-js`, `phoenix`, all MIT, plus `tslib` helpers, 0BSD) | 2.119.0 | MIT. © 2020 Supabase | `public/vendor/supabase.LICENSE` |


## Development and local-mode tools (installed with `npm install`, not part of the published site)

| Component | License |
|---|---|
| [PGlite](https://github.com/electric-sql/pglite) (`@electric-sql/pglite`), Postgres compiled to WebAssembly, runs the database for local mode and tests | Apache-2.0; includes PostgreSQL, under the PostgreSQL License |
| `@supabase/supabase-js` (used by tests) | MIT |

## Online services

| Service | Used for | Terms in short | Credit / notice in the app |
|---|---|---|---|
| **GitHub Pages** | Hosting the website | [GitHub Terms of Service](https://docs.github.com/site-policy/github-terms/github-terms-of-service). Pages are meant for project sites, not commercial services. | Privacy policy names it |
| **Supabase** | Database, sign-in, photo storage | [Supabase Terms](https://supabase.com/terms). The free plan has usage limits and pauses after 7 inactive days. | Privacy policy names it |
| **Google Sign-In** (via Supabase Auth) | "Sign in with Google" | [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy): only basic scopes (email, profile); data is used only to sign players in. The button follows Google's [branding guidelines](https://developers.google.com/identity/branding-guidelines): standard text, full-color "G" on white. | Privacy policy covers it, including Limited Use |
| **USGS The National Map, "USGSImageryOnly"** (`basemap.nationalmap.gov`) | Default satellite layer | U.S. government imagery, mostly USDA NAIP. No use constraints listed; credit requested. | "Imagery: USDA, USGS The National Map" on the map |
| **Esri World Imagery** (`ibasemaps-api.arcgis.com`), *optional* | Sharper satellite layer, only when `esriApiKey` is set in `public/config.js` | Requires an ArcGIS Location Platform account and API key (free tier available); Esri's terms and plan limits apply. | "Powered by Esri \| Esri, Maxar, Earthstar Geographics, and the GIS User Community" |
| **OpenStreetMap tiles** (`tile.openstreetmap.org`) | "Street map (OSM)" layer | [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/): visible attribution, normal browser use, no bulk or offline downloading. Heavy use needs another provider. | "© OpenStreetMap contributors" on the map |
| **OpenStreetMap data via Overpass API** (`overpass-api.de`, `overpass.kumi.systems`) | Building and place names on the campus map, fetched by an admin's browser on request | Data © OpenStreetMap contributors, [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/). Public Overpass servers are fair use; CampusSpot only queries when an admin taps Import. | "Building names © OpenStreetMap contributors (ODbL)" on the map |

### What this means in practice
- **Keep the map credits visible.** The map's corner shows them automatically, so don't hide that with CSS.
- **Building names stored in your Supabase database are ODbL data.** Showing them in the game is fine with the credit. If you publish that data or a database built from it (for example a public export), credit OpenStreetMap and offer it under the ODbL ([details](https://www.openstreetmap.org/copyright)). The repository itself contains no OpenStreetMap data.
- **No offline tile caching from these servers.** For an offline campus map, use imagery you're allowed to download (USGS/NAIP downloads) or a provider that sells offline packages.
- **If CampusSpot grows** past a small campus game, or makes money, move off OpenStreetMap's tile server and Esri's free tier to a paid or self-hosted provider, and upgrade Supabase if you hit its limits.

## Names and trademarks
- **College and university names:** used only to say where a photo was taken. CampusSpot is an independent student project. It is **not affiliated with, sponsored by, or endorsed by** any college or university, the University of California, the California State University or the California Community Colleges, and it uses no school logos, mascots or marks.
- **Campus list:** names, cities and locations in `public/data/campuses.json` come from U.S. Department of Education data (IPEDS and the College Scorecard), which is public domain.
- **GeoGuessr:** CampusSpot is inspired by photo-location guessing games. It is not affiliated with GeoGuessr AB and uses none of its code, art or content.
- **"CampusSpot":** not yet checked for trademarks. Search [USPTO](https://tmsearch.uspto.gov) before any commercial use or registration of your own.

## Photos and players
- Round photos are taken by admins and approved contributors, who keep ownership and license them to the site (see the Terms of Use, `#/terms`). Players' names, guesses and scores are stored as described in the in-app privacy policy (`#/privacy`), and players can delete them at any time.
- Round photos avoid identifiable people (unless they agreed), ID cards, license plates and room numbers, and are never taken in closed areas. Admins take a photo down if asked.
