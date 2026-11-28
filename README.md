# Israil · the map ⇄ the track

Israel Railways publishes a schematic network map: tidy, readable, and far from where the tracks really run. Israil
puts that map and the real geography on one screen and lets a slider morph between them. The schematic is the
place to choose stations and plan a trip from the official timetable; the geography is the place to follow the trip,
with a marker on the real track.

© 2026 Peter Bak · [VisualAnalytics](https://visualanalytics.co.il)

1. [Data sources](#1-data-sources)
2. [Data pipeline](#2-data-pipeline)
3. [Visualization](#3-visualization)
4. [Interaction](#4-interaction)
5. [Developer](#5-developer)

---

## 1. Data sources

The app uses no live data and calls no source at runtime: everything below is turned into static files by the
pipeline (section 2).

### 1.1 Schematic map

- **What:** the Israel Railways "lines & stations" map, valid from 14 Nov 2026, from
  [rail.co.il/?page=linesmap](https://rail.co.il/?page=linesmap).
- **Used for:** station positions on the schematic, which stations each line serves and in what order, label sides.
- **Licence:** © Israel Railways. The image is not in the repository, only the digitized layout. Permission from
  Israel Railways is needed before the site is made public.

### 1.2 Timetable and station locations

- **What:** the Ministry of Transport GTFS feed, `https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip`
  (all public transport in Israel, a few weeks ahead; about 150 MB). Described on
  [gov.il](https://www.gov.il/he/pages/gtfs_general_transit_feed_specifications).
- **Used for:** every train trip with its stops and scheduled times, the service calendar, station coordinates.
- **Licence:** gov.il terms of use (no named licence, no attribution required; the Ministry may change the terms and
  accepts no liability). Only the production feed is used; the page marks `Gtfs_10_days.zip` as test data.

### 1.3 Real track

- **What:** OpenStreetMap ways `railway=rail` without a `service` tag (main and branch lines), from the
  [Overpass API](https://overpass-api.de).
- **Used for:** the shape of the line between every two consecutive stations on the geographic map.
- **Licence:** ODbL (© OpenStreetMap contributors, credited on the map whenever it is shown).

### 1.4 Cities and towns

- **What:** OpenStreetMap nodes `place=city` and `place=town` inside Israel, from the Overpass API.
- **Used for:** place names on the geographic map.
- **Licence:** ODbL.

### 1.5 Closed stations

- **What:** OpenStreetMap station nodes [2930682108](https://www.openstreetmap.org/node/2930682108) (Jerusalem
  Biblical Zoo) and [2930682106](https://www.openstreetmap.org/node/2930682106) (Jerusalem Malha), which are on the
  map but not in the timetable.
- **Licence:** ODbL.

### 1.6 Basemap

- **What:** [Natural Earth](https://www.naturalearthdata.com) 10m land, lakes, urban areas, rivers and roads.
- **Licence:** public domain.

### 1.7 Not used

The unofficial rail.co.il API: it needs a key taken from the Israel Railways website.

### 1.8 Licences in this repository

Code and documentation: [LICENSE](LICENSE) (all rights reserved). `tracks.json`, `places.json` and the two
closed-station coordinates are derived from OpenStreetMap and are available under the ODbL. `timetable.json` and
the GTFS station coordinates follow the Ministry's terms. `basemap.json` is public domain. The schematic layout in
`network.json` and `pipeline/sources/circles.json` remains © Israel Railways.

---

## 2. Data pipeline

All scripts are in `pipeline/` (Python, standard library unless noted) and write to `public/data/`, which the app
loads as static files.

```
Israel Railways map image ─► detect_circles.py ─► circles.json ──┐
                              (+ assignment by hand)             ├─► build_network.py ─► network.json
GTFS feed ──────────────────► gtfs_rail.py ─────► gtfs_stations ─┘
GTFS feed ──────────────────► gtfs_timetable.py ────────────────────────────────────► timetable.json
OpenStreetMap rail ─────────► osm_tracks.py (needs network.json) ───────────────────► tracks.json
OpenStreetMap places ───────► osm_places.py ────────────────────────────────────────► places.json
Natural Earth ──────────────► build_basemap.py ─────────────────────────────────────► basemap.json
```

```bash
pip install -r pipeline/requirements.txt   # shapely (basemap); opencv + numpy (digitizing only)
python pipeline/gtfs_rail.py               # station coordinates + check report
python pipeline/build_network.py
python pipeline/osm_tracks.py              # --refresh downloads OSM again
python pipeline/osm_places.py
python pipeline/gtfs_timetable.py          # --refresh downloads the latest feed
python pipeline/build_basemap.py           # needs the Natural Earth GeoJSON files in pipeline/sources/
```

All coordinates are WGS84 `[lon, lat]`; schematic positions are pixels of the 1115 × 1600 map image, y down.

### 2.1 Schematic network → `network.json`

**Digitizing (scripted).** `detect_circles.py` finds the station circles on the map image: near-white pixels
(HSV saturation < 40, value > 225), eroded with a 5×5 kernel to cut the white bars between interchange circles,
connected components of 2–9 px, kept only if a dark ring surrounds them (14 of 24 rays). It found 165 circles.
`sample_colors.py` samples the line colours around each circle.

**Assignment (by hand).** Which circle belongs to which station and line, in what order each line runs, which
detections to ignore, four circles added by hand (three closed stations, one hidden by a crossing line), and each
label's side were written into `build_network.py` while reading the map. The build checks that every circle is used
exactly once. When the map changes, follow [docs/update-schematic-map.md](docs/update-schematic-map.md), which
includes a ready-made prompt for Claude.

**Coordinates.** From the GTFS feed (`gtfs_rail.py` writes `sources/gtfs_stations.json`), matched by `stop_id`;
the two closed stations from OpenStreetMap.

**Content:** 71 stations, 16 lines, 165 dots.

```ts
stations: { id: "TAU", name, name_he, gtfs_stop_id,
            lon, lat,        // real position (WGS84, from GTFS): the geographic end, one per station
            label: "l" | "lr" | "r" | "t" | "b" | "bl" }[]   // label side on the schematic
lines:    { id: "orchid", name: "Atlit – Beit She'an", color: "#…", night: boolean, inactive: boolean,
            stops: string[] /* station ids in drawing order */ }[]
copies:   { id: "TAU.orchid", station, line, circle,
            sx, sy }[]       // pixel centre of the circle on the map image (no lon/lat): the schematic end,
                             // one per station per line
```

So the two ends of the interpolation live on different records: a station has one geographic position, and each
of its dots has its own schematic position.

A station on five lines has five dots. Dots of one station in a row (less than 4 px apart vertically) are levelled
to their median y.

### 2.2 Real track → `tracks.json`

`osm_tracks.py` turns OpenStreetMap rail into one polyline per pair of consecutive stops:

1. **Download** in five latitude strips, each retried on four public Overpass servers; cached in
   `sources/osm_rail.json`.
2. **Graph:** OSM nodes are vertices, way segments are edges weighted by length. Crossovers are often tagged as
   service track (excluded), so nodes of parallel tracks within 15 m are joined by a virtual edge (+20 m penalty).
3. **Snap** each station to the nearest node of the largest connected network (at most 600 m).
4. **Route** every pair of consecutive stops on any line with Dijkstra; reject paths longer than
   2.2 × straight distance + 2 km; simplify with Ramer–Douglas–Peucker (8 m).

Result: 87 of 89 segments (the other two are on the closed Jerusalem line and are drawn straight).

```ts
{ source, osm_base, segments: { "A|B": { km, c: [lon, lat][] } } }   // A < B; coordinates run from A to B
```

### 2.3 Timetable → `timetable.json`

`gtfs_timetable.py` keeps only rail (`route_type = 2`) from the feed and writes only what the feed says; a missing
field is `null`, never guessed.

- **Trips:** stations in order with scheduled arrival and departure in minutes after midnight of the service day
  (above 1440 after midnight), and the train number (`trip_short_name`, or the headsign when the feed puts the number
  there, as it currently does). The destination shown in the app is the trip's last station.
- **Calendar:** weekdays and date range per service, plus added and removed dates.
- **Stations:** mapped to the keys of `network.json` (via `parent_station`, or a Hebrew-name match within 1 km for
  stops with another id).
- **Not in the feed:** platforms, delays, cancellations. The app shows none of them.

```ts
{ feed: { start, end, published /* when the Ministry built it */, generated, fields },
  services: { [id]: { days: "1111100" /* Mon..Sun */, start, end, add: string[], remove: string[] } },
  trips: { id, n /* train number */, h, s /* service */, st: [station, arr, dep, platform][] }[] }
```

### 2.4 Basemap and places → `basemap.json`, `places.json`

`build_basemap.py` clips Natural Earth to 33.9–36.2°E, 29.3–33.5°N and simplifies it (shapely); only major and
secondary highways are kept, and no borders. `osm_places.py` writes each city and town with its English and Hebrew
name, population (when OSM has one) and whether it is a city; duplicate names keep the entry with a population.

### 2.5 Keeping it current

- **Timetable:** the Ministry republishes often, including short-term changes such as works. Today:
  `gtfs_timetable.py --refresh`. Planned: a nightly GitHub Action that refreshes, validates (trip count, at least
  7 days covered, every station still served) and commits, or opens an issue and keeps the last good file. The app
  names the timetable it uses and shows no trains for days the file doesn't cover.
- **Map vs. timetable:** `gtfs_rail.py` reports stations that moved more than 30 m, new stations, and map lines whose
  stop order no longer appears in any train's stops: the signal that the schematic needs updating.
- **Track and places:** rarely change; rerun the scripts when wanted.

---

## 3. Visualization

### 3.1 What is shown and how

- **Stations** are white dots with a dark outline, one dot per line serving the station, at its place on the
  schematic. The dots of one station are joined by a **bar** (dark outline, white inside), so an interchange reads as
  one station.
- **Lines** are polylines in the colour sampled from the official map, running through their dots in drawing order.
  A line not in service is dashed.
- **Labels** name each station in English or Hebrew (or none), on the side the official map uses; on the
  geographic side they are placed to avoid each other.
- **Basemap and places** appear at 100%: land, water, urban areas and roads, and city and town names with a dot each
  (cities larger), placed after the station labels, bigger places first.
- **Focus:** whatever is not part of the current selection, options or trip fades back to a faint trace.
- **Connection options** (two stations chosen) are drawn in the map lines' colours, with the bars where they change.
- **A picked trip** is drawn one colour per train (blue, orange, magenta), so every change of train is a change of
  colour; the same colour marks each train's pill in the list. At a change, only the two dots used are shown, joined
  by a short bar. Origin, changes and destination have dark labels; stops on the way have grey ones.
- **The current position** is a triangle with a concave base in the colour of the train being ridden, pointing along
  the route; hollow when the real position is more than 1 km away. A label centred above it shows only the next
  action and its time ("Change at Tel Aviv University–Expo, in 12 min"; at the end "Arrive at Ashkelon").

Dots, line widths and text keep their size on screen at any zoom; the label and dot size is a setting.

### 3.2 Between schematic and geographic

A full walkthrough, with a worked example in real numbers, is in **[docs/interpolation.md](docs/interpolation.md)**.
In short:

The slider value `t` runs from 0 (schematic) to 1 (geographic). Every element has a schematic position `A` and a
geographic position `B`, both in screen pixels, and is drawn at `(1 − t)·A + t·B`: a straight-line move, the same
for all elements.

**Two layouts, one unit.** Map-image pixels and degrees can't be mixed, so both ends are first turned into screen
pixels for the same viewport, each on its own, and only those are interpolated:

1. **Schematic → screen:** the dots' `(sx, sy)` are scaled uniformly (aspect kept) and shifted so the whole schematic
   fills the viewport, with room for labels at the sides and for the slider at the top. This gives `A`.
2. **Geographic → screen:** each station's `(lon, lat)` is projected with a Transverse Mercator centred on
   35.2044°E, 31.7344°N (the Israeli grid's central meridian; flat x/y, y down), then scaled and shifted by a second,
   independent fit into the same viewport. This gives `B`. Track and basemap points use the same projection and fit.
3. **Interpolate:** `P = (1 − t)·A + t·B`, in pixels; zoom and pan are applied on top (`k·P + (x, y)`).

So at 0% the schematic fills the screen, at 100% the geography does, and the scale changes smoothly in between.
Both fits are recomputed when the window size changes.

**Where a station sits on the schematic.** A station has no single schematic position: the official map draws it
once per line that serves it (an interchange is a row of circles joined by a bar). The digitized circles are
assigned to lines as `(station, circle)` pairs, which gives one dot per station per line (`TAU.orchid`, …), each at
its own circle's pixel centre; a station on five lines has five. Geographically, a station has one position (from
GTFS).

**Stations.** Each dot moves from its own circle to its station's single real position. All dots of a station share
that end point, so at 100% they merge into one and the bar joining them shrinks to nothing. Where one point per
station is needed, a representative dot is used: for a label, the dot on the side the map puts the label (leftmost
for a label on the left, rightmost on the right, top or bottom one above or below); for a chord between stops that
no map line joins, the station's first dot.

**Lines.** A line's segments run between that line's own dots, so on the schematic every line keeps its own lane
and the lanes converge onto the shared track. Every segment between two stops is resampled to 64 points spaced evenly by length, once along the
straight schematic segment and once along the real track (station → OSM track → station). Point *k* moves from its
schematic place to its geographic place. Because both ends of each segment are the dots themselves, lines stay
attached to the stations at every `t`, and at 100% they follow the real track.

**Labels.** Each label has a schematic place (next to its dot, on the map's side, wrapped as on the map) and a
geographic place (worked out for the final positions: left, above, below or right, whichever first overlaps no other
label or dot; never hidden), and moves line by line between the two.

**Trips** are cut from the same 64-point segments of the lines their trains ride (and so start and end at those
lines' dots), so a picked trip morphs exactly with the lines.

### 3.3 Snapping the current position

The GPS position is matched to the trip, not to the map:

1. The trip's real-world shape is known piece by piece (each piece is one segment of the route: station → OSM track
   → station).
2. The position is projected onto the nearest point of that shape (in a local metric projection), which gives a
   piece and the share of its length already travelled.
3. Since the segments are resampled evenly by length, that share is directly an index into the piece's 64 points.
   The marker is placed at that index on the interpolated segment, so it sits on the route at any `t`, on the
   schematic as well as on the real track.
4. It points towards the route a little further ahead. Where a route passes the same track twice, pieces before the
   last matched one count 300 m further away, so the marker doesn't jump back.

The location is asked for only when a trip is started, used on the device and never stored.

---

## 4. Interaction

The header (title, undo ↺, settings ⚙) is on every page.

- **Phone:** three pages, one task each, opened from buttons in the header: ★ Favourites · **Map** (opens first) ·
  🕒 Timetable. The open page is marked; swiping sideways on a page also moves between them. Tapping two stations on
  the map keeps the map open, so the choice and the route options can be checked; the timetable button pulses twice
  when the trips are ready. Opening a favourite goes straight to the timetable.
- **Desktop:** the map is always visible, next to a panel: the favourites (with the station fields) while nothing
  is selected, the trips as soon as a station is picked. No page buttons.

### 4.1 Selecting

- **Slider:** schematic ⇄ geographic.
- **Zoom:** + and − (two steps: 1×, 2×, 4×), pinch or wheel. **Pan** by dragging, until the edge of the network
  (with room for its labels) reaches the edge of the screen: every station can be reached, and the network never
  leaves the screen. The limit follows the slider, since the schematic is wider than the geography.
- **Hover** a line to highlight it with its stations; hover a station to highlight every line through it.
- **Tap a station** (dot or label): the first is From, the second To. A chip at the top shows the selection.
- **Undo** (↺, the chip's ✕, double tap on empty map space, or Esc) goes back one step: ends a trip, else unpicks
  the trip, else clears the stations. A single tap on empty space does nothing.
- **Settings:** station names (English, עברית, off), label and dot size, most changes (direct, 1, 2), minimum time to
  change (0–10 min). Saved in the browser.

### 4.2 Planning a trip

**1 · Choose.** Tap two stations on the map, type them (suggestions in English or Hebrew), or open a favourite (☆
stars a search, ★ removes it; ⇅ swaps the direction). The day and time default to today and now.

**2 · Pick a trip.** The list shows the chosen day and the next, opened at the chosen time (red line): earlier trains
above, later below, departed trains greyed out. Each row: departure – arrival, duration, changes, and the trains as
number and destination ("127 Modi'in Center › 667 Be'er Sheva Center"). Meanwhile the map shows all the connection
options in the list. Below the list the app names the Ministry timetable it uses and when it was published.

**3 · Choose where to change.** Opening a row lists, for each change, every station where it works, with arrival,
departure and the minutes in between; the first is ticked, or the one chosen last time for this direction. The map
shows only this trip. "Show stops" lists every stop with its time.

**4 · ▶ Start.** The map opens (phone), zooms to the trip and glides to 100%; the marker follows the position. The
Trips page now shows the trip in progress: trains and stops, the current train stressed, and End.

**How the trips are found.**

- **Search:** for the chosen day (with the trains of the days around it, for trips across midnight), a round-based
  search in the style of RAPTOR starts from every train leaving the origin and finds the earliest arrival with 0, 1
  and 2 changes. Waiting at a change is not capped (a cap would make this search lose journeys); no trip may take
  more than 24 hours. A day and the next take about 100–200 ms.
- **Pareto filter:** a trip is dropped if another leaves no earlier, arrives no later and has no more changes. This
  removes slow detours, and late trips that only arrive by waiting overnight.
- **Change stations:** a trip is a sequence of trains with fixed departure and arrival; every combination of
  stations where the trains meet in time is offered, in riding order.
- **Honesty:** only scheduled times. No platforms (not in the feed) and no estimate of whether a change is long
  enough: the change time is shown and the user judges, or sets a minimum in the settings.
- **Tests:** a brute-force search without any pruning lists every trip with up to two changes for several station
  pairs and days of the real timetable; each must be matched by a listed trip at least as good. A small hand-made
  timetable reproduces a real case (Kfar Yehoshua 15:01 → Hof HaCarmel → train 419 → Be'er Sheva North 17:56).

**Demo.** `?simulate=20` in the address makes a started trip move a simulated position from start to destination
in 20 seconds, with the clock running from departure to arrival: for screen recordings.

---

## 5. Developer

**Stack:** Vite, React, TypeScript, `d3-geo` and `d3-zoom`, Vitest; deployed as a Cloudflare Worker with static
assets.

```
src/core/    logic with unit tests: geometry, labels, journeys (search), route (map path, snapping),
             planner (favourites), time (Israel time), settings
src/data/    data types and loading
src/map/     NetworkMap (draws and updates the SVG directly) + MapView (React wrapper)
src/ui/      Planner, StationInput, Favorites, JourneyPanel, SettingsMenu, PageNav
worker/      Cloudflare Worker (only /api/* reaches it)
pipeline/    data scripts (section 2)
tests/       Vitest
docs/        interpolation.md (how the morph works), update-schematic-map.md
```

**Icon:** a closed S, blue then orange (two trains, one change), on white, with three stations and a straight white
line (black outline) through them: the real track and the schematic in one mark. `pipeline/make_icons.py` writes
`public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png` (180 px, square; iOS rounds the corners), `icon-192.png`,
`icon-512.png` and `icon-maskable-512.png` (Android, content inside the safe zone), all listed in
`public/site.webmanifest`. It needs `rsvg-convert` and ImageMagick.

React owns the state (slider, search, picked trip, trip in progress, settings); `NetworkMap` owns the SVG and
updates attributes directly, since the slider moves about 10,000 points per frame.

**Run:**

```bash
npm ci            # install (Node 22)
npm run dev       # dev server, Worker included
npm test          # unit and completeness tests
npm run build     # production build into dist/
npm run preview   # run the build locally (workerd)
```

**Deploy:** Cloudflare **Workers & Pages → Import a repository**, build command `npm run build`, deploy command
`npx wrangler deploy`. Every push to `main` deploys; other branches get preview URLs. Access can be limited with
Cloudflare Access (Worker → Access). Manual deploy: `npx wrangler login`, then `npm run deploy`. CI (GitHub Actions)
runs typecheck, tests and build on every push.

**Browser storage:** `israil.settings.v1` (`size`, `lang`, `maxChanges`, `minChange`) and `israil.planner.v1`
(favourites, and the change stations last chosen per direction). The location is never stored.
