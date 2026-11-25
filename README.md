# Israel Railways: schematic vs. geography

An interactive comparison of the Israel Railways schematic network map and the real geography of its stations.
Every station is drawn as one dot per line, exactly where it sits on the official map. A slider moves each dot in a
straight line to the station's GTFS position, so the copies of a station merge and the schematic's spatial
distortions become visible. Click two stations to see the lines (and transfers) that connect them.

© 2026 Peter Bak · [VisualAnalytics](https://visualanalytics.co.il)

## Stack

- **Vite + React + TypeScript** for the app
- **d3** only where it does real work: `d3-geo` (Transverse Mercator on the Israeli TM meridian), `d3-zoom` (zoom, pan, pinch)
- **Cloudflare Workers with static assets**, built by `@cloudflare/vite-plugin`. Static files are served first;
  only `/api/*` reaches the Worker (`worker/index.ts`), which is where server-side features go later.
- **Vitest** for the core logic, **GitHub Actions** for type checks, tests and build

## Layout

```
pipeline/        Python data pipeline (not part of the app bundle)
  build_network.py   map digitization + stations + lines  -> public/data/network.json
  build_basemap.py   Natural Earth layers clipped           -> public/data/basemap.json
  gtfs_rail.py       MOT GTFS feed -> rail stations, stop patterns, check report
  detect_circles.py  find station circles in the map image (re-digitizing only)
  sources/circles.json  digitized circle centres (the map image itself is not committed)
public/data/     generated JSON served as static files
src/core/        pure logic, unit tested: geometry, label placement, trip finding
src/map/         NetworkMap (imperative SVG controller) + MapView (React wrapper)
src/ui/          React panels
tests/           Vitest tests
worker/          Cloudflare Worker entry
```

Why the map is imperative: the slider updates about 240 SVG elements per frame. React owns the controls and state;
`NetworkMap` owns the SVG and updates attributes directly, so animation stays smooth.

## Develop

```bash
npm install
npm run dev        # Vite dev server, Worker included
npm test           # unit tests
npm run build      # production build into dist/
npm run preview    # run the production build locally (workerd), no Cloudflare account needed
npx wrangler preview   # build first; uploads a remote Preview URL to your Cloudflare account
```

## Data

The app reads `public/data/network.json` and `public/data/basemap.json`. Regenerate them with:

```bash
pip install -r pipeline/requirements.txt
python pipeline/gtfs_rail.py          # optional: downloads the MOT GTFS feed, writes coordinates + check report
python pipeline/build_network.py      # uses pipeline/sources/gtfs_stations.json if present
python pipeline/build_basemap.py      # needs Natural Earth 10m GeoJSON files in pipeline/sources/
python pipeline/osm_tracks.py         # real track per station-to-station segment from OpenStreetMap -> public/data/tracks.json
```

`pipeline/out/tracks_report.txt` lists segments without track geometry; the app draws those straight.
Each segment is resampled to 64 points on both sides, and every point moves linearly between them.

`pipeline/out/check_report.txt` lists stations that moved, new stations, and map lines whose stop order does not
match any GTFS stop pattern.

### Sources

- Schematic: Israel Railways lines & stations map, valid from 14 Nov 2026 (circle centres digitized)
- Station coordinates and stop order: Ministry of Transport GTFS feed (gtfs.mot.gov.il)
- Basemap: Natural Earth 10m land, lakes, rivers, urban areas, roads (public domain)
- Track geometry: © OpenStreetMap contributors (ODbL), via the Overpass API

## Deploy to Cloudflare

One-time setup in the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**, pick this repo.

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

Every push to `main` then deploys; other branches get preview URLs. Manual deploy from your machine:
`npx wrangler login` then `npm run deploy`.

## Roadmap

- Timetable-based trip planner from GTFS (real departure times and transfer times), client-side or in the Worker
- Scheduled Worker (Cron Trigger) that refreshes the GTFS-derived data
- Shareable URLs for slider position and selected trip
