"""Export the Israel Railways timetable from the Ministry of Transport GTFS feed for the trip planner.

Usage (standard library only, Python 3.9+):
    python pipeline/gtfs_timetable.py                    # uses/downloads pipeline/sources/israel-public-transportation.zip
    python pipeline/gtfs_timetable.py path/to/feed.zip

Writes:
    public/data/timetable.json         compact timetable (schema below), read by the app
    pipeline/out/timetable_report.txt  which GTFS fields exist, sample values, counts, date range, file size

Only facts from the feed are written. A value the feed does not have (e.g. platforms, train numbers) is
written as null, never guessed. Times are minutes after midnight of the service day; GTFS allows values
past 24:00 for trips running after midnight, and those are kept as they are (e.g. 25:10 -> 1510).

timetable.json:
{
  "feed": {"start": "YYYYMMDD", "end": "YYYYMMDD", "generated": ISO time, "fields": {name: bool}},
  "stations": {key: {"name": str, "name_he": str|null, "lat": num, "lon": num}},  # stations not in network.json
  "services": {service_id: {"days": "1111100", "start": "YYYYMMDD", "end": "YYYYMMDD",
                            "add": [dates], "remove": [dates]}},                 # days: Mon..Sun
  "trips": [{"id": trip_id, "n": train number|null, "h": headsign|null (null when it held the train number), "s": service_id,
             "st": [[station key, arrival min, departure min, platform|null], ...]}]
}
Station keys are the ids used in network.json (e.g. "TAU"); stations the map does not show get "G<stop_id>".
The destination of a trip, as on the station boards, is its last station (st[-1]).
"""
import csv, io, json, math, os, sys, urllib.request, zipfile
from collections import defaultdict
from datetime import datetime, timezone

FEED_URL = "https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC, OUT = os.path.join(HERE, "sources"), os.path.join(HERE, "out")
RAIL_ROUTE_TYPE = "2"


def rows(z, name):
    if name not in z.namelist():
        return
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def header(z, name):
    if name not in z.namelist():
        return []
    with z.open(name) as f:
        return next(csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig")), [])


def minutes(t):
    """'HH:MM:SS' (HH may be >= 24) -> minutes after midnight of the service day."""
    if not t:
        return None
    h, m, *_ = t.strip().split(":")
    return int(h) * 60 + int(m)


def clean(v):
    v = (v or "").strip()
    return v or None


def main():
    zpath = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SRC, "israel-public-transportation.zip")
    if not os.path.exists(zpath):
        print("downloading", FEED_URL, "(~200 MB)")
        os.makedirs(SRC, exist_ok=True)
        urllib.request.urlretrieve(FEED_URL, zpath)
    z = zipfile.ZipFile(zpath)
    net = json.load(open(os.path.join(ROOT, "public", "data", "network.json"), encoding="utf-8"))
    key_of_gtfs = {str(s["gtfs_stop_id"]): s["id"] for s in net["stations"] if s.get("gtfs_stop_id") is not None}

    cols = {f: header(z, f) for f in ("trips.txt", "stops.txt", "stop_times.txt", "routes.txt", "calendar.txt", "calendar_dates.txt")}
    fields = {
        "trip_short_name (train number)": "trip_short_name" in cols["trips.txt"],
        "trip_headsign (destination)": "trip_headsign" in cols["trips.txt"],
        "stop_headsign": "stop_headsign" in cols["stop_times.txt"],
        "stops.platform_code": "platform_code" in cols["stops.txt"],
        "stops.parent_station": "parent_station" in cols["stops.txt"],
        "calendar.txt": bool(cols["calendar.txt"]),
        "calendar_dates.txt": bool(cols["calendar_dates.txt"]),
    }

    routes = {r["route_id"]: r for r in rows(z, "routes.txt") if r["route_type"] == RAIL_ROUTE_TYPE}
    trips = {r["trip_id"]: r for r in rows(z, "trips.txt") if r["route_id"] in routes}
    print(f"{len(routes)} rail routes, {len(trips)} rail trips")

    times = defaultdict(list)
    for r in rows(z, "stop_times.txt"):  # large file: streamed, only rail trips kept
        if r["trip_id"] in trips:
            times[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], minutes(r.get("arrival_time")),
                                        minutes(r.get("departure_time")), clean(r.get("stop_headsign"))))
    used = {sid for v in times.values() for _, sid, *_ in v}

    stops, parent = {}, {}
    for r in rows(z, "stops.txt"):
        if r["stop_id"] in used or r["stop_id"] in parent.values():
            stops[r["stop_id"]] = r
        if r.get("parent_station"):
            parent[r["stop_id"]] = r["parent_station"]
    # a platform-level stop maps to its station through parent_station
    def station_key(stop_id):
        for sid in (stop_id, parent.get(stop_id)):
            if sid and sid in key_of_gtfs:
                return key_of_gtfs[sid]
        return "G" + (parent.get(stop_id) or stop_id)

    # A station can have more than one GTFS stop (e.g. HaMifratz Central: coastal platforms 37388 and
    # Valley-line platforms 42507, 400 m apart). An unmapped stop whose name equals a map station's Hebrew
    # name, within 1 km, is treated as that station; each such match is listed in the report.
    by_he = {s["name_he"]: s for s in net["stations"]}
    aliases = []
    for sid in sorted(used):
        if station_key(sid).startswith("G") and sid in stops:
            r = stops[sid]
            m = by_he.get(r["stop_name"].split("/")[0].strip())
            if m and r.get("stop_lat"):
                la1, lo1, la2, lo2 = map(math.radians, (float(r["stop_lat"]), float(r["stop_lon"]), m["lat"], m["lon"]))
                d = 2 * 6371000 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))
                if d < 1000:
                    key_of_gtfs[sid] = m["id"]
                    aliases.append(f"  stop {sid} '{r['stop_name']}' -> {m['id']} ({m['name']}), {d:.0f} m from its main stop")

    extra = {}
    for sid in used:
        k = station_key(sid)
        if k.startswith("G") and k not in extra:
            s = stops.get(parent.get(sid) or sid) or stops.get(sid) or {}
            extra[k] = {"name": clean(s.get("stop_name")), "name_he": None,
                        "lat": float(s["stop_lat"]) if s.get("stop_lat") else None,
                        "lon": float(s["stop_lon"]) if s.get("stop_lon") else None}

    svc_ids = {t["service_id"] for t in trips.values()}
    services = {}
    for r in rows(z, "calendar.txt"):
        if r["service_id"] in svc_ids:
            days = "".join(r[d] for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"))
            services[r["service_id"]] = {"days": days, "start": r["start_date"], "end": r["end_date"], "add": [], "remove": []}
    for r in rows(z, "calendar_dates.txt"):
        if r["service_id"] in svc_ids:
            s = services.setdefault(r["service_id"], {"days": "0000000", "start": None, "end": None, "add": [], "remove": []})
            (s["add"] if r["exception_type"] == "1" else s["remove"]).append(r["date"])

    # Train number: trip_short_name if the feed has it. The MOT feed leaves it empty and puts the train number in
    # trip_headsign instead; that is used only when every headsign is purely numeric. The destination shown to
    # users is then the trip's last station, which is in the data anyway.
    heads = [clean(t.get("trip_headsign")) for t in trips.values()]
    numeric_heads = not fields["trip_short_name (train number)"] and heads and all(h and h.isdigit() for h in heads)
    out_trips = []
    for tid, v in times.items():
        t = trips[tid]
        st = []
        for _, sid, arr, dep, _hs in sorted(v):
            plat = clean(stops.get(sid, {}).get("platform_code")) if fields["stops.platform_code"] else None
            st.append([station_key(sid), arr, dep, plat])
        number = clean(t.get("trip_headsign")) if numeric_heads else clean(t.get("trip_short_name"))
        out_trips.append({"id": tid, "n": number, "h": None if numeric_heads else clean(t.get("trip_headsign")),
                          "s": t["service_id"], "st": st})
    out_trips.sort(key=lambda x: (x["st"][0][2] if x["st"] and x["st"][0][2] is not None else 0, x["id"]))

    dates = [d for s in services.values() for d in [s["start"], s["end"], *s["add"]] if d]
    data = {
        "feed": {"start": min(dates) if dates else None, "end": max(dates) if dates else None,
                 "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "fields": fields},
        "stations": extra, "services": services, "trips": out_trips,
    }
    path = os.path.join(ROOT, "public", "data", "timetable.json")
    json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # report
    lines = ["== Fields in this feed =="] + [f"  {'yes' if v else 'NO '}  {k}" for k, v in fields.items()]
    lines += ["", f"rail trips: {len(out_trips)}, services: {len(services)}, feed dates {data['feed']['start']} - {data['feed']['end']}",
              f"stations served: {len({s[0] for t in out_trips for s in t['st']})} (of which not on the map: {len(extra)})",
              f"timetable.json: {os.path.getsize(path) / 1e6:.2f} MB"]
    lines += ["", "train numbers: " + ("taken from trip_headsign (all values numeric; trip_short_name missing)" if numeric_heads
              else "trip_short_name" if fields["trip_short_name (train number)"] else "not available"),
              "destination: " + ("last station of each trip" if numeric_heads else "trip_headsign")]
    if aliases:
        lines += ["", "== Extra GTFS stops mapped to map stations =="] + aliases
    if extra:
        lines += ["", "== Stations served by trains but not on the map =="] + [f"  {k}: {v['name']}" for k, v in sorted(extra.items())]
    lines += ["", "== Sample trips (check what the train number and destination look like) =="]
    for t in out_trips[:: max(1, len(out_trips) // 8)][:8]:
        r = routes[trips[t["id"]]["route_id"]]
        lines.append(f"  trip_id={t['id']}  train={t['n']!r}  headsign={t['h']!r}  "
                     f"route_short_name={clean(r.get('route_short_name'))!r}  route_long_name={clean(r.get('route_long_name'))!r}  "
                     f"first={t['st'][0][0]} {t['st'][0][2]}  last={t['st'][-1][0]} {t['st'][-1][1]}  stops={len(t['st'])}")
    os.makedirs(OUT, exist_ok=True)
    report = "\n".join(lines)
    open(os.path.join(OUT, "timetable_report.txt"), "w", encoding="utf-8").write(report)
    print(report)


if __name__ == "__main__":
    main()
