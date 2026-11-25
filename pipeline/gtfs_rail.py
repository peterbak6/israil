"""Extract Israel Railways data from the Ministry of Transport GTFS feed and check our network against it.

Usage (standard library only, Python 3.9+):
    python pipeline/gtfs_rail.py                       # downloads the feed (~200 MB) to pipeline/sources/
    python pipeline/gtfs_rail.py path/to/feed.zip      # use a feed you already have

Writes:
    pipeline/sources/gtfs_stations.json   rail stations: stop_id, name, lat, lon (used by build_network.py)
    pipeline/out/gtfs_patterns.json       every distinct stop sequence run by trains, with trip counts
    pipeline/out/check_report.txt         differences between public/data/network.json and the feed

Then run `python pipeline/build_network.py` to rebuild the app data with the feed's coordinates.
"""
import csv, io, json, math, os, sys, urllib.request, zipfile
from collections import Counter, defaultdict

FEED_URL = "https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC, OUT = os.path.join(HERE, "sources"), os.path.join(HERE, "out")
RAIL_ROUTE_TYPE = "2"  # GTFS route_type for rail


def rows(z, name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def haversine_m(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def extract(zpath):
    z = zipfile.ZipFile(zpath)
    agencies = {r["agency_id"]: r["agency_name"] for r in rows(z, "agency.txt")}
    routes = {r["route_id"]: r for r in rows(z, "routes.txt") if r["route_type"] == RAIL_ROUTE_TYPE}
    print("rail agencies:", sorted({agencies.get(r["agency_id"], r["agency_id"]) for r in routes.values()}))
    trips = {r["trip_id"]: r["route_id"] for r in rows(z, "trips.txt") if r["route_id"] in routes}
    print(f"{len(routes)} rail routes, {len(trips)} rail trips")

    seq = defaultdict(list)  # trip_id -> [(stop_sequence, stop_id)]
    for r in rows(z, "stop_times.txt"):  # large file: streamed, only rail trips kept
        if r["trip_id"] in trips:
            seq[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))
    used = {s for v in seq.values() for _, s in v}

    stops = {}
    for r in rows(z, "stops.txt"):
        if r["stop_id"] in used:
            stops[r["stop_id"]] = dict(stop_id=int(r["stop_id"]) if r["stop_id"].isdigit() else r["stop_id"],
                                       name=r["stop_name"], lat=float(r["stop_lat"]), lon=float(r["stop_lon"]))
    patterns = Counter()
    pattern_routes = defaultdict(set)
    for tid, v in seq.items():
        p = tuple(s for _, s in sorted(v))
        patterns[p] += 1
        rt = routes[trips[tid]]
        pattern_routes[p].add(rt.get("route_short_name") or rt.get("route_long_name") or trips[tid])
    pats = [dict(trips=n, routes=sorted(pattern_routes[p]), stops=[int(s) if s.isdigit() else s for s in p])
            for p, n in patterns.most_common()]
    return stops, pats


def check(stops, pats):
    net = json.load(open(os.path.join(ROOT, "public", "data", "network.json"), encoding="utf-8"))
    by_id = {str(s["stop_id"]): s for s in stops.values()}
    out = []
    out.append("== Station coordinates (network.json vs GTFS) ==")
    known = set()
    for s in net["stations"]:
        gid = s.get("gtfs_stop_id")
        if gid is None:
            out.append(f"  {s['id']:4} {s['name']}: no GTFS id (closed/not in feed)")
            continue
        known.add(str(gid))
        g = by_id.get(str(gid))
        if not g:
            out.append(f"  {s['id']:4} {s['name']}: GTFS stop {gid} not served by any train in this feed")
            continue
        d = haversine_m((s["lat"], s["lon"]), (g["lat"], g["lon"]))
        if d > 30:
            out.append(f"  {s['id']:4} {s['name']}: moved {d:.0f} m in the feed")
    for sid, g in by_id.items():
        if sid not in known:
            out.append(f"  NEW in feed: {g['name']} (stop_id {sid}) {g['lat']:.5f},{g['lon']:.5f}")

    out.append("\n== Line stop order (each map line should follow some GTFS stop pattern) ==")
    pat_lists = [[str(x) for x in p["stops"]] for p in pats]
    gid_of = {s["id"]: str(s["gtfs_stop_id"]) for s in net["stations"] if s.get("gtfs_stop_id") is not None}
    for line in net["lines"]:
        ids = [gid_of[k] for k in line["stops"] if k in gid_of]
        best, best_n = None, -1
        for p in pat_lists:
            for cand in (p, p[::-1]):
                pos = [cand.index(x) for x in ids if x in cand]
                ordered = all(a < b for a, b in zip(pos, pos[1:]))
                n = len(pos) if ordered else 0
                if n > best_n:
                    best, best_n = cand, n
        status = "OK" if best_n == len(ids) else f"only {best_n}/{len(ids)} stops match one pattern in order"
        out.append(f"  {line['id']:8} {line['name']}: {status}")
        if best_n == len(ids) and best:
            extra = [by_id[x]["name"] for x in best[best.index(ids[0]):best.index(ids[-1]) + 1] if x not in ids and x in by_id]
            if extra:
                out.append(f"           trains also stop at: {', '.join(extra)}")
    return "\n".join(out)


def main():
    zpath = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SRC, "israel-public-transportation.zip")
    if not os.path.exists(zpath):
        print("downloading", FEED_URL)
        urllib.request.urlretrieve(FEED_URL, zpath)
    stops, pats = extract(zpath)
    os.makedirs(OUT, exist_ok=True)
    stations = sorted(stops.values(), key=lambda s: -s["lat"])
    json.dump(stations, open(os.path.join(SRC, "gtfs_stations.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(pats, open(os.path.join(OUT, "gtfs_patterns.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    report = check(stops, pats)
    open(os.path.join(OUT, "check_report.txt"), "w", encoding="utf-8").write(report)
    print(f"{len(stations)} rail stations, {len(pats)} stop patterns\n")
    print(report)


if __name__ == "__main__":
    main()
