# From the schematic to the track: how the morph works

The slider moves every element of the map between two pictures of the same network: the Israel Railways schematic
map, and the real geography. This document explains how a schematic position (pixels on an image) and a real
position (longitude and latitude) can be blended at all, step by step, with real numbers from the app.

## 1. The idea in one line

Every element has two screen positions, `A` on the schematic and `B` in the geography, and is drawn at

```
P(t) = (1 − t) · A + t · B          t = 0: schematic, t = 1: geographic
```

That is all the motion there is: each point slides on a straight line from `A` to `B`. The interesting part is
getting `A` and `B` into the same space, and deciding what "each point" means for stations and lines.

## 2. Two coordinate systems, one screen

The two pictures don't share a unit:

- **Schematic:** pixels on the 1115 × 1600 map image, y down. Each dot (a station on one line) has `(sx, sy)`.
- **Geographic:** degrees on a sphere. Each station has `(lon, lat)` from the timetable feed.

Pixels and degrees can't be mixed, so neither is turned into the other. Both are turned, separately, into **screen
pixels for the same map area**, and only then interpolated.

```
(sx, sy)   ──────────────── fit S ──►  A ─┐
                                          ├─►  P = (1 − t)·A + t·B  ──►  zoom/pan  ──►  drawn
(lon, lat) ── projection ── fit G ──►  B ─┘
```

### 2.1 Fitting

A *fit* takes a set of points and returns the function that maps them onto the screen:

1. take the bounding box of all the points;
2. choose one scale `k`, the same horizontally and vertically (so shapes are not distorted), as large as possible
   while the box fits inside the map area minus padding (room for labels at the sides, 28 px above and below, and
   a 56 px band at the top for the slider);
3. shift the result so it is centred.

```
screen = offset + k · (point − corner of the bounding box)
```

### 2.2 Schematic → screen (`A`)

The fit is applied to the dots' `(sx, sy)`. Example for a 1000 × 700 map area: the dots span x 225–1057 and y
56–1506 on the image; the height is the limit, so `k_S = 0.405`. Tel Aviv University's green-line dot at
`(503, 709.7)` lands at **A = (444.1, 349.0)**.

### 2.3 Geographic → screen (`B`)

Longitude and latitude first need flattening. A **Transverse Mercator projection** centred on 35.2044°E, 31.7344°N
(the central meridian of the Israeli grid) maps the sphere onto a plane with very little distortion over a country
this size; `d3-geo` computes it, with y turned to point down like the screen. The projected values are small
(units of the Earth's radius): Tel Aviv University at `(34.8045°E, 32.1035°N)` becomes `(−0.00591, −0.00645)`.

Then a **second, independent fit** is applied to all projected stations. Their box is about 0.0136 × 0.0338
units, so `k_G ≈ 17 400`, and Tel Aviv University lands at **B = (442.8, 357.6)**.

The OSM track points and the basemap go through exactly the same projection and fit, so the real lines meet the
real stations.

### 2.4 Why two separate fits

Each picture is made to fill the screen as well as it can: at 0% the schematic does, at 100% the geography does. The
schematic is taller and narrower than the country, so during the morph the whole network visibly squeezes and
stretches into its real shape, and the scale changes smoothly with it. Both fits are recomputed whenever the window
size changes.

## 3. Stations: many dots, one place

A station has **no single schematic position**. The official map draws it once per line that serves it, and an
interchange is a row of circles joined by a bar. In the data each of these is a dot (`TAU.green`, `TAU.orange`, …)
with its own `(sx, sy)`. Geographically, the station has one position.

So the interpolation is **many-to-one**: every dot of a station starts at its own `A` and ends at the shared `B`.

Tel Aviv University has seven dots, all at y = 349.0 on the screen and spread across x 427–493. Their shared
end point is (442.8, 357.6). At t = 0.5 they sit at y = 353.3, spread across x 435–468: halfway to the point. At
t = 1 they coincide. The bar joining them is a polyline through the dots, so it shrinks with them and vanishes.

```
t = 0     ○─○─○─○─○─○─○        seven dots, one per line
t = 0.5     ○○○○○○○            closing in
t = 1          ●               one station
```

Where one point per station is needed, a representative dot is used: for the label, the dot on the side where the
map puts the label (the leftmost for a label on the left, and so on); for a straight chord between stops that no
map line joins, the station's first dot.

## 4. Lines: the same, point by point

A line is a chain of segments between consecutive stops. On the schematic a segment is a straight stroke between
two of that line's dots; in the geography it follows the real track. To blend them, both sides must have the same
number of points that correspond to each other.

Each segment is **resampled to 64 points spaced evenly by length**, twice:

- **schematic side:** along the straight stroke between the two dots;
- **geographic side:** along station A → the OSM track → station B (projected and fitted as in 2.3). If no track is
  known, the straight line between the two stations.

Point *k* of the schematic side corresponds to point *k* of the geographic side: both are at the same share of the
segment's length. Each slides from its `A` to its `B`, exactly like a station.

```
schematic   A₀ ─ A₁ ─ A₂ ─ … ─ A₆₃          straight stroke between the dots
                │    │           │
geographic  B₀ ~ B₁ ~ B₂ ~ … ~ B₆₃          the real track, same 64 shares of its length
```

Three things follow:

- **Lines stay attached to stations.** The first and last points of each segment *are* that line's dots at the two
  stops, so at any `t` the line ends exactly in its dots.
- **Lines keep their lanes.** Each line runs between its own dots, so on the schematic parallel lines stay side by
  side, and they converge onto the shared real track as their dots converge.
- **Even spacing matters.** Spacing by length (rather than reusing the track's own vertices) makes point *k* mean
  "*k*/63 of the way along" on both sides, so the curve unfolds evenly instead of bunching.

The segments of a line are joined into one polyline (dropping the duplicate point where two meet). 64 points are
enough for the bends: after simplification a track segment has a median of 18 points and at most 82. A frame
computes about 10,000 points.

## 5. Labels

A label also has two places. On the schematic it sits next to its representative dot, on the side the official map
uses, wrapped onto lines as on the map. In the geography it is placed for the final positions (left, above, below or
right of the station, whichever first overlaps no other label or dot; never hidden). It slides between the two, line
by line, keeping the same wrapping so it never re-flows mid-move.

## 6. Trips

A picked trip is not drawn separately: it is cut from the same 64-point segments of the lines its trains ride. So it
starts and ends in those lines' dots and morphs exactly with them.

## 7. The position marker

During a trip the GPS position has to appear on the route at any slider position, including on the schematic, where
there is no longitude or latitude at all. It is done by matching the position to the trip, then reusing the
segments' correspondence:

1. **Match to the real shape.** The trip's real-world shape is known piece by piece: each piece is one segment of
   the route (station → OSM track → station) in riding order.
2. **Nearest point.** The GPS position is projected onto the nearest point of that shape (in a local metric
   projection). This gives a piece and the share of its length already travelled, say 0.42 of the way along the
   Binyamina–Herzliya piece.
3. **Share → index.** Because both sides of every segment are spaced evenly by length, 0.42 of the length is point
   0.42 × 63 ≈ 26.5 on the geographic side *and* on the schematic side.
4. **Draw.** The marker is placed between points 26 and 27 of the interpolated segment, at the current `t`. So it sits
   on the real track at 100%, on the schematic stroke at 0%, and on the route in between.
5. **Direction.** It is rotated towards the route a little further ahead.

Where a route passes the same track twice, pieces before the last matched one count 300 m further away, so the
marker doesn't jump back.

## 8. Zoom and pan

Zoom and pan apply last, to the interpolated positions only:

```
screen = k_zoom · P + (pan_x, pan_y)
```

Dots, line widths and text keep their size on screen, so zooming gives the map more room rather than enlarging it,
and zoom works the same at any slider position.

## Where it is in the code

- `fitter`, `project`, `lerp`, `resample`: `src/core/geometry.ts`
- the two fits, segment geometry, labels, marker: `layout()`, `render()`, `routePoint()`, `drawMe()` in
  `src/map/NetworkMap.ts`
- snapping (`snapToRoute`) and the trip's pieces (`routeOf`, `pieceShape`): `src/core/route.ts`
- schematic label sides and representative dots: `src/core/labels.ts`
