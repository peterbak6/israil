# Israil · Geo-Schematic Map

An interactive comparison of the Israel Railways schematic network map and the real geography of the network.
Every station is drawn as one dot per line, exactly where it sits on the official map, and every line runs between
its stations as on the map. One slider morphs the whole picture, from the fully schematic map to stations at their
real positions with lines following the real track. Click two stations to see the lines and transfers that
connect them.

© 2026 Peter Bak · [VisualAnalytics](https://visualanalytics.co.il)

Contents: [Sources and licences](#sources-and-licences) · [Data pipeline](#data-pipeline) · [Data files](#data-files) ·
[Keeping the data up to date](#keeping-the-data-up-to-date) · [Interpolation](#interpolation) · [App](#app) ·
[Develop](#develop) · [Deploy](#deploy)

---

## Sources and licences

| What | Source | Licence / terms | What we do about it |
|---|---|---|---|
| Schematic layout (station dots, line order, label sides) | Israel Railways "lines & stations" map, valid from 14 Nov 2026 | © Israel Railways. No licence is published. | The image is not committed; only the digitized circle centres are (`pipeline/sources/circles.json`). The layout in `network.json` is derived from their design, so **permission from Israel Railways is needed before the site is made public.** |
| Station coordinates and timetable | Ministry of Transport GTFS feed `israel-public-transportation.zip` ([gov.il page](https://www.gov.il/he/pages/gtfs_general_transit_feed_specifications)) | Terms of use on that page: using or downloading the feed means accepting them; the Ministry may change them at any time without notice; no liability for errors, omissions or outdated data. No named open licence and no attribution requirement. | Credit "Ministry of Transport GTFS" anyway. Show only scheduled times, never estimates. Use only the production feed (the page says `Gtfs_10_days.zip` is for development and testing only). Re-read the terms when updating the pipeline. |
| Closed stations (Jerusalem Biblical Zoo, Malha) | OpenStreetMap station nodes [2930682108](https://www.openstreetmap.org/node/2930682108) and [2930682106](https://www.openstreetmap.org/node/2930682106) | © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright) | Same as the track geometry below. |
| Real track geometry (`tracks.json`) | OpenStreetMap, `railway=rail`, via the Overpass API | © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/1-0/) | Credit shown on the map whenever tracks are visible. `tracks.json` is a derived database and is itself available under the ODbL (see below). |
| Basemap (land, lakes, rivers, urban areas, roads) | Natural Earth 10m | Public domain | Nothing required; credited here. |
| City and town names (`places.json`) | OpenStreetMap `place=city` / `place=town` nodes in Israel, via the Overpass API (`pipeline/osm_places.py`) | © OpenStreetMap contributors, ODbL | Shown only on the geographic map, where the OpenStreetMap credit is already shown. Derived database, available under the ODbL. |
| JavaScript libraries (React, d3, Vite, Wrangler…) | npm | MIT / ISC / Apache-2.0 | Their licence notices are kept in the build. |

Not used: the unofficial `rail.co.il` API. It depends on a key taken from the Israel Railways website, so the
public site does not call it.

**Data licences in this repository.** `public/data/tracks.json` and the two closed-station coordinates are
derived from OpenStreetMap and are made available under the Open Database License 1.0
(© OpenStreetMap contributors). `public/data/timetable.json` and the GTFS-derived station coordinates are subject
to the Ministry of Transport terms above. `public/data/basemap.json` is public domain (Natural Earth). The
schematic layout in `public/data/network.json` and `pipeline/sources/circles.json` is derived from the Israel
Railways map and remains subject to their copyright. Everything else (code and documentation) is covered by
[LICENSE](LICENSE).

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
python pipeline/osm_places.py                # city and town names for the geographic map -> places.json
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

`localStorage["israil.settings.v1"] = { size: number (6–18), lang: "en" | "he" | "off", maxChanges: 0 | 1 | 2,
minChange: integer 0–10 }`. Invalid or missing values fall back to `{ size: 10, lang: "en", maxChanges: 2, minChange: 0 }`.

`localStorage["israil.planner.v1"] = { saved: {a, b}[], prefs: { "FROM>TO": station[] } }`: favourites (starred
searches, each covering both directions) and the change stations last chosen per direction. The user's location is
never stored.

---

## Keeping the data up to date

Each source changes at a different pace:

| Data | Changes | Kept current by |
|---|---|---|
| Train timetable (GTFS) | The Ministry republishes the feed often, including changes for the next few days | Nightly automatic update *(planned)*; today `python pipeline/gtfs_timetable.py --refresh` |
| Station coordinates, stop order | When stations open or services are reorganized | Automatic check, a person approves *(planned)* |
| Real track (OpenStreetMap) | Rarely: new lines, corrections | Monthly automatic update *(planned)*; today `python pipeline/osm_tracks.py --refresh` |
| City and town names (OpenStreetMap) | Rarely | `python pipeline/osm_places.py` when wanted |
| Schematic map (Israel Railways) | A few times a year, with timetable changes | Manual, following [docs/update-schematic-map.md](docs/update-schematic-map.md) (scripted circle detection, assignments by hand with a ready-made prompt) |
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

### Safety net in the app

The app knows the date range of its timetable (`feed.start`–`feed.end`). A search outside that range says the
timetable data has ended instead of showing trains that may no longer run; tomorrow is listed only if covered.

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

### Zoom and pan (limits)

Two zoom steps (1×, 2×, 4×; the + and − buttons double and halve). Panning keeps the centre of the network (as
drawn at the current slider value) on screen, at every zoom level. Double click/tap does not zoom; it clears the
selection.

### City names on the geographic map

At 100% the map shows city and town names from OpenStreetMap (`places.json`), with a dot each, in the station-name
language. They are placed greedily (`placeCities` in `src/core/labels.ts`), bigger places first (cities, then by
population): to the right of the point, else to the left, and left out where they would cover a station label, a
station dot or another name. Zooming in therefore shows more of them.

### Zoom and pan (rendering)

`d3-zoom` provides a transform `(k, x, y)` that is applied to positions only: `P' = k·P + (x, y)`. Dots, line
widths and text keep their pixel size, so zooming in gives the map more room, as on a web map. The limits are
described above (`scaleExtent` 1–4 and a custom `constrain`). The basemap is one SVG group with that transform and
non-scaling strokes.

### Trip planner (`src/core/journeys.ts`, `src/core/route.ts`, `src/ui/Planner.tsx`)

The header ("Israil · the map ⇄ the track") with the undo button (↺) and the settings gear is on every page. Dots at the bottom show the
page; tap a dot (or, on a phone, swipe left/right on a page) to move between pages.

**Phone: three pages, one task each** (dots, left to right: Favourites, Map, Trips; the map opens first).
1. **Map.** The map, slider and zoom. It always shows the current state: the selected stations, the connection
   options, the picked trip, and during a trip the moving marker. The first tapped station is From, the second
   To, and then the trips page opens.
2. **Favourites.** The starred searches; tapping one is the same as picking its two stations, ★ removes it.
3. **Trips.** From and To (with suggestions in English or Hebrew, ⇅ to swap, ☆ to star), the day (shown as
   "Sun 29 Nov") and time (default today and now; "Now" goes back to them), and the list for that day and the next,
   opened at the chosen time (red line); earlier trains above, later ones below, trains already gone greyed out.
   The list opens at the chosen time when the search changes (stations, day, time, settings), not as the clock
   ticks, and keeps its scroll position when the page is reopened. Picking a trip shows its change stations; the
   start button (▶) starts it and switches to the map, which glides to 100%. During the trip this page shows the
   trip in progress instead: its trains and stops, the current train stressed, and End.

**Desktop: two pages** (dots: Favourites, Plan; Plan opens first), with the map always visible: **Plan** (the fields fill as stations are picked, the list
appears once both are set, and the trip in progress replaces it after ▶) and **Favourites**.

**Clearing.** A chip at the top of the map shows the current state (the stations, the picked trip's time, or "Trip
in progress"). The undo button (↺) in the header, the chip's ✕, a double tap or double click on empty map space, or Esc undoes
the latest step: ends the trip,
else unpicks the trip, else clears the stations. A single tap on empty space does nothing.

**The marker** (during a trip) shows only the next action, under or above it depending on the direction of travel:
"Change at Tel Aviv University–Expo, in 12 min", or at the end "Arrive at Ashkelon, in 25 min". Once a scheduled
time has passed it shows "at 13:22" instead of a countdown.

Only scheduled times from the timetable are shown, never estimates or delays. Below the list the app says when the
Ministry published the timetable in use (`feed.published`), since a later change (e.g. works cancelled) is not in it. There is no platform information
(the feed has none) and no minimum change time: every connection is listed with its change time, and the user
judges whether it is enough.

**Search.** For one service day, the trains of that day and of the days before and after (shifted by ±24 h, for
trains around midnight) are indexed by station. For each train that can be boarded at the origin, a round-based
search in the style of RAPTOR finds the earliest arrival with 0, 1 and 2 changes: round 1 rides that train; each
further round boards, at each station whose arrival improved in the previous round, every later train, and keeps
an arrival only if it beats the best one at that station. Nothing later than the best arrival at the destination,
or more than 24 hours after setting off, is followed. Waiting at a change is deliberately not capped: with a cap,
arriving later at a station could open up a train that arriving earlier could not, and this pruning would lose
journeys. Today and tomorrow together take about 100–200 ms for one station pair.

**Pareto filter.** A journey is dropped if another one leaves at the same time or later, arrives at the same time
or earlier and has no more changes. This removes slow detours and trains you would only take to wait somewhere.
Today's list is also checked against tomorrow's, so a late journey that only arrives by waiting overnight is
dropped when tomorrow morning's train gets there as early.

**Tests** (`tests/search-completeness.test.ts`): a brute-force search with no pruning lists every journey with up
to two changes on the real timetable (several station pairs, a weekday, a Friday and the feed's first day); each
must be matched by a listed journey at least as good. A small hand-made timetable reproduces a known real case
(Kfar Yehoshua 15:01 → Hof HaCarmel, train 419 → Be'er Sheva North 17:56, one change) and checks the four Haifa
change stations offered.

**Change stations.** A journey is a sequence of trains; departure and arrival are fixed by the first and last
train, but the change can often happen at several stations (e.g. any of the four Tel Aviv stations). All valid
combinations are listed in riding order; picking a station in one slot keeps the other slots where possible.

**On the map.** Each leg's stops are joined along the map's line segments (shortest path, preferring to stay on one
line; each train starts on the line with most of its stops). These pieces use the same 64-point segment geometry as
the lines, so the journey morphs with the slider. Where no map line joins two consecutive stops, a dotted chord is
drawn.

**Position marker.** The GPS position is snapped to the nearest point of the journey's real-world shape (station →
OSM track → station), giving a piece and a share of its length. Because the segments are resampled by length,
that share is an index into the 64 points, so the marker can be drawn at any slider position, schematic included.
It is rotated towards the next points of the route. More than 1 km from the route, it is drawn hollow and the
panel says how far away the user is. Where a route passes the same track twice, the snap prefers pieces at or
after the last one, so the marker doesn't jump back.

### What the map shows while planning

Only timetable journeys, never the printed lines on their own (a line on the printed map may not run on the day in
the list): before a trip is picked, all the ways the listed journeys go (`optionsOf`, in the map lines' colours,
with the station bars where they change); after, only the picked journey, one colour per train. If the timetable
can't be loaded, the list says so and the map shows just the two stations.

### Settings that steer the search

In the gear menu: **most changes** (direct only, 1 or 2; default 2) and **time to change at least** (0–10 min;
default 0). Both are passed to the search (`SearchOpts`); a fixed extra margin at every change keeps the pruning
exact, and the brute-force tests run with non-default values too. When either differs from the default, the
list says so above the trips.

### Updating the schematic map

When Israel Railways publishes a new map, follow [docs/update-schematic-map.md](docs/update-schematic-map.md):
circle detection is scripted; the assignment of circles to stations and lines is done by hand, with a ready-made
prompt for Claude.

---

## App

```
src/core/        pure, unit-tested logic: geometry, labels, journeys (timetable search), route (map
                 path + GPS snapping), planner (saved searches), time (Israel time), settings
src/data/        data types and loading (network, basemap, tracks, timetable)
src/map/         NetworkMap (imperative SVG controller) + MapView (React wrapper)
src/ui/          Planner, StationInput, JourneyPanel, SettingsMenu
worker/          Cloudflare Worker (only /api/* reaches it)
tests/           Vitest
```

React owns the UI state (slider, settings, search, picked journey, journey mode). `NetworkMap` owns the SVG and updates attributes directly,
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
