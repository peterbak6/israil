# Updating the schematic map

Israel Railways publishes a new "lines & stations" map a few times a year, usually with a timetable change. The
schematic layout in `public/data/network.json` is digitized from that map in two parts:

| Part | How | Where |
|---|---|---|
| Station circles (pixel centres) | Automatic: `pipeline/detect_circles.py` | `pipeline/sources/circles.json` |
| Line colours around each circle | Automatic, with reference points picked on the image: `pipeline/sample_colors.py` | `pipeline/out/colors.json` |
| Which circle is which station, each line's circles in order, circles to ignore or add, label sides | **By hand** (done with Claude, reviewed by Peter) | `pipeline/build_network.py`: `S`, `LINES`, `IGNORE`, `XY.update(...)`, `LBL` |

Everything about trains (timetable, coordinates, track) is data and is refreshed separately; see the README.

## Steps

1. Download the new map from [rail.co.il/?page=linesmap](https://rail.co.il/?page=linesmap) and save it as a PNG
   (e.g. `pipeline/sources/map_2027-03.png`; images are not committed).
2. Detect the circles and look at the numbered overlay:

   ```bash
   python pipeline/detect_circles.py pipeline/sources/map_2027-03.png pipeline/sources/circles.json pipeline/out/circles_numbered.png
   ```
3. Update the reference points in `sample_colors.py` (`REF`: one pixel on each line's strand; `extra`: circles the
   detector missed), then:

   ```bash
   python pipeline/sample_colors.py pipeline/sources/map_2027-03.png pipeline/sources/circles.json pipeline/out/colors.json
   ```
4. Give Claude the prompt below with the map image, `pipeline/out/circles_numbered.png`, `pipeline/out/colors.json`,
   the current `pipeline/build_network.py`, and `pipeline/out/gtfs_patterns.json` (from step 5's first run, or
   run `python pipeline/gtfs_rail.py` first).
5. Check and build:

   ```bash
   python pipeline/build_network.py        # must print: unassigned circles: [] and stations without dots: []
   python pipeline/gtfs_rail.py            # out/check_report.txt: map lines vs. the feed's stop patterns
   python pipeline/osm_tracks.py           # real track for any new station pairs
   npm test
   npm run dev                             # look at 0%, 50% and 100%, hover lines, plan a few trips
   ```
6. Update the map's validity date in `build_network.py` (docstring and `meta.sources.schematic`) and in the README.

## Prompt

Paste this, with the files from step 4 attached:

> The Israel Railways lines & stations map has changed. Update `pipeline/build_network.py` for the new map, working
> in my local copy (I commit and push myself).
>
> Attached: the new map image; `circles_numbered.png` (each detected circle with its index); `colors.json` (line
> colours found around each circle); the current `build_network.py`; `gtfs_patterns.json` (stop sequences the
> trains actually run, from the Ministry of Transport feed).
>
> Please:
> 1. Compare the new map with the current `LINES`: which lines, stations and stop orders changed.
> 2. Assign every circle index to a station and a line: update `LINES` (each line's (station, circle) pairs in
>    drawing order), `IGNORE` (legend symbols, text artefacts), the hand-added circles in `XY.update(...)` (circles
>    the detector missed, with their pixel position), and `S` for new stations (English and Hebrew names as on the
>    map, GTFS stop_id; coordinates come from the feed).
> 3. Read each label's side off the map into `LBL` (l, r, t, b, bl, lr; l is the default).
> 4. Check every map line against `gtfs_patterns.json`: a line's stops should appear, in order, in a pattern the
>    trains run. List any that don't, with your explanation.
> 5. Run `build_network.py` until it reports no unassigned circles and no stations without dots, then
>    `gtfs_rail.py`, `osm_tracks.py` and `npm test`, and show me the map at 0% and 100% for review.
>
> Don't guess: if a circle or label is ambiguous on the image, ask me. Keep the line ids that still exist, so
> saved searches and tests keep working.
