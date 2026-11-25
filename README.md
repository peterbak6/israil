# Israil · Geo-Schematic Map

An interactive comparison of the Israel Railways schematic network map and the real geography of the network.
Every station is drawn as one dot per line, exactly where it sits on the official map, and every line runs between
its stations as on the map. One slider morphs the whole picture, from the fully schematic map to stations at their
real positions with lines following the real track. Click two stations to see the lines and transfers that
connect them.

© 2026 Peter Bak · [VisualAnalytics](https://visualanalytics.co.il)

Contents: [Sources](#sources) · [Data pipeline](#data-pipeline) · [Data files](#data-files) ·
[Keeping the data up to date](#keeping-the-data-up-to-date) · [Interpolation](#interpolation) · [App](#app) ·
[Develop](#develop) · [Deploy](#deploy)

---

## Sources

| What | Source | Licence / terms |
|---|---|---|
| Schematic layout (station dots, line order) | Israel Railways "lines & stations" map, valid from 14 Nov 2026 | © Israel Railways. The image is not committed; only the digitized circle centres are (`pipeline/sources/circles.json`). |
| Station coordinates | Ministry of Transport GTFS feed, `stops.txt` (gtfs.mot.gov.il) | Israeli government open data |
| Closed stations (Jerusalem Biblical Zoo, Malha) | OpenTrain project, Public Knowledge Workshop (GTFS-derived, c. 2020) | Not in the current feed |
| Real track geometry | OpenStreetMap, `railway=rail`, via the Overpass API | © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Credit shown on the map whenever tracks are visible. |
| Basemap (land, lakes, rivers, urban areas, roads) | Natural Earth 10m | Public domain |

The OpenStreetMap credit is the one source credit that stays in the UI. The licence requires it wherever the data
is shown, so it appears at the bottom left of the map once the slider leaves 0%.

---

## Data pipeline

All scripts are in `pipeline/` and write to `public/data/`, which the app serves as static files. The app never
calls any of these sources at runtime.

```
Israel Railways map image ─► detect_circles.py ─► sources/circles.json ─┐
                                                                        ├─► build_network.py ─► network.json
MOT GTFS feed ──────────────► gtfs_rail.py ─────► sources/gtfs_stations.json ┘   (stations, lines, dots)
                                                  out/check_report.txt
OpenStreetMap (Overpass) ───► osm_tracks.py ────► tracks.json   (+ out/tracks_report.txt)
MOT GTFS feed ──────────────► gtfs_timetable.py ► timetable.json (+ out/timetable_report.txt)
Natural Earth 10m ──────────► build_basemap.py ─► basemap.json
```

```bash
pip install -r pipeline/requirements.txt     # shapely (basemap), opencv + numpy (digitizing only)
python pipeline/gtfs_rail.py                 # optional: refresh station coordinates from GTFS
python pipeline/build_network.py
python pipeline/osm_tracks.py                # needs network.json; downloads OSM once, then reuses it
python pipeline/gtfs_timetable.py            # train timetable for the trip planner -> timetable.json (+ out/timetable_report.txt)
python pipeline/build_basemap.py             # needs Natural Earth GeoJSON in pipeline/sources/
```

### 1. Digitizing the schematic map (`detect_circles.py`, `sample_colors.py`)

The station circles on the Israel Railways map are white with a dark outline. `detect_circles.py`:

1. converts the image to HSV and keeps near-white pixels (saturation < 40, value > 225);
2. erodes that mask with a 5×5 kernel. This cuts the thin white interchange bars that join circles, while the
   larger circle interiors survive;
3. takes connected components of 2–9 px as circle candidates;
4. keeps a candidate only if a dark ring surrounds it (at least 14 of 24 rays hit a dark pixel just outside it).

This found 165 circles. Four were added by hand: three filled grey circles (closed stations) and one circle that a
crossing line hid. `sample_colors.py` samples the line colours around each circle to help with assignment, but the
final assignment of circle → line → station is made by hand in `build_network.py`. Every circle is used exactly
once (the build checks this).

### 2. Network (`build_network.py`)

- **Stations:** English and Hebrew names (Hebrew as printed on the map), GTFS `stop_id`, and coordinates.
  Coordinates come from the GTFS values, overridden by `sources/gtfs_stations.json` when `gtfs_rail.py` has been run.
- **Lines:** the 16 lines drawn on the map (colours sampled from the map), each an ordered list of
  `(station, circle)` pairs in drawing order. Night lines and the out-of-service Beit Shemesh – Malha line are flagged.
- **Dots ("copies"):** one per station per line, at the circle's pixel centre. A station on five lines has five dots.
- **Jitter snap:** dots of one station that lie in a row (less than 4 px apart vertically) get their median y, so
  interchange rows are exactly level.
- **Label placement on the schematic:** each station's label side (`l`, `r`, `t`, `b`, `bl`, `lr`) was read off the
  map. See [Labels](#labels).

### 3. GTFS check (`gtfs_rail.py`)

Downloads (or reads) the MOT GTFS zip and keeps only `route_type = 2` (rail): the trips of those routes, their
`stop_times` (streamed, since the file is large), and the stops they use. It writes:

- `sources/gtfs_stations.json`: every station served by a train: stop_id, name, lat, lon;
- `out/gtfs_patterns.json`: every distinct stop sequence run by trains, with trip counts;
- `out/check_report.txt`: stations whose coordinates moved more than 30 m, stations new to the feed, and map lines
  whose stop order does not appear, in order, in any GTFS stop pattern (either direction).

### 4. Real track (`osm_tracks.py`)

1. **Download.** Overpass query for `way["railway"="rail"][!"service"]` (main and branch lines, no sidings or
   yards), in five latitude strips (one country-wide query tends to time out on the public servers). Each strip is
   retried on four public Overpass servers. The merged response is saved to `sources/osm_rail.json` and reused;
   `--refresh` downloads again.
2. **Graph.** Every OSM node is a vertex, every consecutive node pair on a way is an edge weighted by its
   great-circle length. Ways that share a node are connected.
3. **Virtual crossovers.** OSM maps crossovers and some junctions as service track, which the query excludes. Nodes
   of different ways that lie within 15 m of each other (parallel tracks) are joined with an edge of
   `distance + 20 m`. The penalty keeps routes from hopping between tracks without reason.
4. **Main network only.** The largest connected component is kept for snapping. Small detached fragments, such as
   station tracks tagged differently, would otherwise leave a station with no route.
5. **Snap.** Each station snaps to the nearest node of that network (grid search). Stations more than 600 m from
   any track are skipped.
6. **Route.** For every pair of consecutive stops on any line, the shortest path between their snapped nodes
   (Dijkstra). Pairs are unordered and shared, so a stretch used by several lines is computed once.
7. **Sanity check.** A path longer than `2.2 × straight distance + 2 km` is rejected as a likely detour.
8. **Simplify.** Ramer–Douglas–Peucker with an 8 m tolerance (in a local metric projection).

The latest run, on OSM data from 25 Nov 2026, matched 87 of 89 segments. The two missing ones belong to the closed
Jerusalem line, which has no active track; the app draws those straight. `out/tracks_report.txt` also notes
stations whose GTFS point lies far from the track centre line (up to 290 m, at Yokneam).

### 5. Basemap (`build_basemap.py`)

Natural Earth 10m land, lakes, urban areas, rivers and roads (major and secondary highways only), clipped to
33.9–36.2°E, 29.3–33.5°N with shapely and simplified (0.001–0.002°). National borders are deliberately left out.

### 6. Timetable (`gtfs_timetable.py`)

Exports the train timetable for the trip planner from the same MOT GTFS feed (the ~200 MB zip, downloaded once
to `pipeline/sources/` and not committed). The feed covers all public transport in Israel; only `route_type = 2`
(rail) is kept, so `timetable.json` is a small fraction of the feed.

- **Trips:** every train trip with its stations in order, scheduled arrival and departure (minutes after midnight
  of the service day; trips past midnight keep values above 24:00), destination (`trip_headsign`, as on the
  station boards) and train number (`trip_short_name`).
- **Platforms:** from `stops.platform_code`, only if the feed has it.
- **Service calendar:** weekdays and date range per service (`calendar.txt`), plus added and removed dates such as
  holidays (`calendar_dates.txt`).
- **Stations:** GTFS stops map to the station keys of `network.json` (through `parent_station` for platform-level
  stops). Stations served by trains but not on the map get the key `G<stop_id>` and are listed in the report.

Only facts from the feed are written: a field the feed lacks is `null`, never guessed. `out/timetable_report.txt`
lists which fields the feed has, sample trips (to see what train numbers and destinations look like), the dates
covered, and the file size. No live data (delays, cancellations) is used anywhere.

---

## Data files

All coordinates are WGS84 `[lon, lat]`. Schematic positions are pixels of the 1115 × 1600 map image, y downwards.

### `public/data/network.json`

```ts
{
  meta: { title: string, sources: Record<string, string>, units: string },
  stations: Array<{
    id: string,               // short key, e.g. "TAU"
    name: string,             // English
    name_he: string,          // Hebrew, as on the map
    gtfs_stop_id: number | null,
    lon: number, lat: number,
    label: "l" | "lr" | "r" | "t" | "b" | "bl"   // label side on the schematic
  }>,
  lines: Array<{
    id: string,               // e.g. "orchid"
    name: string,             // "Atlit – Beit She'an"
    color: string,            // hex, sampled from the map
    night: boolean,
    inactive: boolean,        // not in service: drawn dashed, ignored by trip finding
    stops: string[]           // station ids in drawing order
  }>,
  copies: Array<{             // one dot per station per line
    id: string,               // `${station}.${line}`
    station: string, line: string,
    circle: number,           // index of the digitized circle
    sx: number, sy: number    // schematic position (image pixels)
  }>
}
```

### `public/data/tracks.json` (optional; without it every segment is straight)

```ts
{
  source: string,             // credit line
  osm_base: string | null,    // OSM data timestamp
  segments: {
    // key "A|B" with A < B alphabetically; coordinates run from station A to station B
    [pair: string]: { km: number, c: [number, number][] }
  }
}
```

### `public/data/basemap.json`

```ts
{
  land:   [number, number][][],              // polygon rings
  lakes:  [number, number][][],
  urban:  [number, number][][],
  rivers: [number, number][][],              // polylines
  roads:  Array<{ c: [number, number][], k: "Major Highway" | "Secondary Highway" }>
}
```

### `public/data/timetable.json`

```ts
{
  feed: { start: "YYYYMMDD", end: "YYYYMMDD", generated: string, fields: Record<string, boolean> },
  stations: { [key: string]: { name: string, name_he: string | null, lat: number, lon: number } }, // not on the map
  services: {
    [service_id: string]: { days: string /* Mon..Sun, e.g. "1111101" */, start: string, end: string,
                            add: string[], remove: string[] }                                      // YYYYMMDD dates
  },
  trips: Array<{
    id: string,               // GTFS trip_id
    n: string | null,         // train number (trip_short_name)
    h: string | null,         // destination as on the boards (trip_headsign)
    s: string,                // service_id
    st: Array<[station: string, arrival: number | null, departure: number | null, platform: string | null]>
  }>
}
```

### Browser storage

`localStorage["israil.settings.v1"] = { size: number (6–18), lang: "en" | "he" | "off" }`. Invalid or missing
values fall back to `{ size: 10, lang: "en" }`.

---

## Keeping the data up to date

Each source changes at a different pace:

| Data | Changes | Kept current by |
|---|---|---|
| Train timetable (GTFS) | The Ministry republishes the feed regularly; it covers a limited window ahead | Nightly automatic update *(planned)* |
| Station coordinates, stop order | When stations open or services are reorganized | Automatic check, a person approves *(planned)* |
| Real track (OpenStreetMap) | Rarely: new lines, corrections | Monthly automatic update *(planned)*; today `python pipeline/osm_tracks.py --refresh` |
| Schematic map (Israel Railways) | A few times a year, with timetable changes | Manual: re-digitize the new map (`detect_circles.py`, then review the assignments in `build_network.py`) |
| Natural Earth basemap | Practically never | Nothing to do |

### Nightly timetable update (planned)

A scheduled GitHub Actions workflow, run each night:

1. downloads the GTFS feed and runs `gtfs_timetable.py`;
2. validates the result: the file parses, the number of trips hasn't dropped sharply against the last good
   version, the feed covers at least the next 7 days, and every station on the map still has trains;
3. if the checks pass and the timetable changed, commits `public/data/timetable.json`; Cloudflare then deploys
   `main` automatically;
4. if anything fails, commits nothing (the site keeps the last good timetable) and opens a GitHub issue.

The same job runs the `gtfs_rail.py` check. A new station, a moved station, or a map line whose stop order no
longer matches any GTFS pattern opens an issue: the signal that the schematic map needs updating.

A Cloudflare scheduled Worker is not used for this: a Worker's memory is too small to unpack the ~200 MB feed.
If the Ministry's server refuses downloads from GitHub's (non-Israeli) runners, the fallback is to run the same
script on a schedule on a machine in Israel and push the result.

### Safety net in the app (planned)

The app knows the date range of its timetable (`feed.start`–`feed.end`). A search outside that range says the
timetable has expired instead of showing trains that may no longer run.

---

## Interpolation

The slider value is `t ∈ [0, 1]`: 0 is the schematic, 1 is the geography. Everything moves linearly in screen
space. Each element has a schematic position and a geographic position, and is drawn at `lerp(A, B, t)`.

### Two layouts in one viewport

- **Schematic:** the dots' image-pixel positions.
- **Geographic:** station coordinates projected with a Transverse Mercator centred on 35.2044°E, 31.7344°N (the
  central meridian of the Israeli TM grid; `d3-geo`). y points south.

Each layout is fitted to the viewport separately (`fitter` in `src/core/geometry.ts`): uniform scale, aspect ratio
kept, centred, with side padding for labels (14% of the width, 28–90 px) and a 56 px band kept free at the top for
the slider bar. Both are recomputed when the window resizes.

### Points (stations)

Dot `i` of station `s` on line `L` has schematic position `Aᵢ` (its circle) and geographic position `B_s` (the
station). It is drawn at

```
Pᵢ(t) = (1 − t) · Aᵢ + t · B_s
```

All dots of a station share the same `B_s`, so at t = 1 they meet in one point. The bars joining a station's dots
are polylines through its dots (sorted along their main axis), so they shrink to that point.

### Paths (lines)

Each line is a chain of segments between consecutive stops. Every segment is resampled twice to `N = 64` points
spaced evenly by arc length (`resample` in `src/core/geometry.ts`):

- **schematic:** the straight line between the two dots;
- **geographic:** station A, the track polyline from `tracks.json` (reversed if the pair key runs the other way),
  then station B, all projected and fitted. If no track is known, the straight line between the two stations.

Point `k` of the segment moves linearly: `Qₖ(t) = (1 − t) · Sₖ + t · Gₖ`. The segments of a line are joined
(dropping the duplicate end/start point) into one polyline of `64·n − (n − 1)` points. The first and last points of
each segment coincide with the dots, so lines and dots stay attached at every t. Trip routes are cut out of the
same polyline, so they follow the same curves.

Why 64: enough for a smooth curve around the bends (most segments have fewer than 40 track points after
simplification), and cheap. Each frame computes about 10,000 points.

### Labels

A label has one position on each side and slides linearly between them, line by line.

- **Schematic side:** the label sits next to one reference dot of its station, on the side the map uses (`label`
  in `network.json`): `l` = left of the leftmost dot, right-aligned; `r` = right of the rightmost dot; `t`/`b` =
  above/below, centred; `bl` = below-left; `lr` = left of the rightmost dot. A dot that has a neighbour (the
  previous or next stop, or another dot of its station) on both its left and right gets its label centred below
  instead. Names placed above or below are split onto two lines at the first dash (else the last space), as on the
  map. The same lines are used on the geographic side, so a label never re-wraps while it moves.
- **Geographic side:** worked out once for the final positions, then cached until zoom, size or language changes.
  Stations are placed in a fixed order: most lines first, then north to south. Each label tries **left, above,
  below, right** and takes the first position that overlaps no placed label, no dot centre of another station
  (inner 45% of the radius) and stays on screen. Lines may be crossed. If every position collides, the
  least-colliding one is used: labels are never hidden.
- **Spacing:** the gap between a dot and its label is `r + 4 px`. Label widths are measured with the real SVG text
  (`getComputedTextLength`), not estimated.

### Zoom and pan

`d3-zoom` provides a transform `(k, x, y)` that is applied to positions only: `P' = k·P + (x, y)`. Dots, line
widths and text keep their pixel size, so zooming in gives the map more room, as on a web map. The zoom range is
1× to 16×, so you can't zoom out past the full view. Panning is limited to the viewport plus a margin wide enough
to read the outermost labels (`translateExtent`). The basemap is one SVG group with that transform and
non-scaling strokes.

### Trip finding (`src/core/routing.ts`)

Uses the lines as drawn, not timetables, and ignores out-of-service lines. It looks for options with 0 transfers,
then 1, then 2:

- **0 transfers:** lines serving both stations.
- **1 transfer:** for each pair of lines, the shared station that minimises the total number of stops.
- **2 transfers:** for each triple of lines, the best transfer pair the same way.

Options with more than `1.25 × best + 2` stops are dropped. Only the ridden part of each line is highlighted;
labels show only the start, end and transfer stations.

---

## App

```
src/core/        pure, unit-tested logic: geometry, labels, routing, settings
src/data/        data types and loading
src/map/         NetworkMap (imperative SVG controller) + MapView (React wrapper)
src/ui/          TripPanel, SettingsMenu
worker/          Cloudflare Worker (only /api/* reaches it)
tests/           Vitest
```

React owns the UI state (slider, settings, selection). `NetworkMap` owns the SVG and updates attributes directly,
because the slider changes thousands of points per frame. A map created after the first render starts from the
current settings, so saved settings always apply.

Stack: Vite, React, TypeScript, `d3-geo`, `d3-zoom`, Vitest; deployed as a Cloudflare Worker with static assets.

## Develop

```bash
npm ci                 # install exactly what's in package-lock.json (use npm install only to add/update packages)
npm run dev            # Vite dev server, Worker included
npm test               # unit tests
npm run build          # production build into dist/
npm run preview        # run the production build locally (workerd), no Cloudflare account needed
npx wrangler preview   # after a build: upload a remote Preview URL to your Cloudflare account
```

## Deploy

Cloudflare dashboard → **Workers & Pages → Create → Import a repository**, with build command `npm run build` and
deploy command `npx wrangler deploy`. Every push to `main` deploys; other branches get preview URLs. Manual
deploy: `npx wrangler login`, then `npm run deploy`.
