"""Real track geometry for every station-to-station segment, from OpenStreetMap.

Usage (standard library only, Python 3.9+):
    python pipeline/osm_tracks.py                 # downloads from Overpass once, saves pipeline/sources/osm_rail.json
    python pipeline/osm_tracks.py --refresh       # download again (e.g. after OSM edits)
    python pipeline/osm_tracks.py saved.json      # use another saved Overpass JSON response

Writes:
    public/data/tracks.json          {"A|B": {"km", "c": [[lon, lat], ...]}} for each pair of consecutive
                                     stations on a line; coordinates run from A to B (A < B alphabetically)
    pipeline/out/tracks_report.txt   segments that were skipped or look suspicious

Method: all railway=rail ways without a service tag (main/branch lines) form a graph; nodes shared
between ways join them. Stations snap only to the largest connected part of that graph. OSM maps crossovers and some junctions as service track, so nodes of different
ways within 15 m (parallel tracks) are also joined, with a small penalty. Each station is snapped to the
nearest track node, the shortest path between consecutive stations is found (Dijkstra), and the result
is simplified to within 8 m (Ramer-Douglas-Peucker). Segments whose path is much longer than the
straight line, or whose stations are far from any track, are left out (the app then draws them straight).

Data: © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright). Credit it wherever
the tracks are shown.
"""
import heapq, json, math, os, sys, time, urllib.parse, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(HERE, "out")
# Public Overpass servers, tried in order; they are often busy (HTTP 429/502/504), so each gets retries.
OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
CACHE = os.path.join(HERE, "sources", "osm_rail.json")  # saved response, reused on later runs
# The country is downloaded in strips: one big query often times out on the public servers (HTTP 502/504).
TILES = [(29.4, 31.0), (31.0, 31.7), (31.7, 32.2), (32.2, 32.7), (32.7, 33.4)]  # (south, north) latitude
QUERY = """[out:json][timeout:120];
way["railway"="rail"][!"service"]({s},34.2,{n},35.8);
out tags geom;"""
LINK_M, LINK_PENALTY_M = 15, 20      # join parallel tracks closer than this
MAX_SNAP_M, MAX_DETOUR = 600, 2.2    # sanity limits
SIMPLIFY_M = 8


def hav(a, b):
    r = math.pi / 180
    dla, dlo = (b[1] - a[1]) * r, (b[0] - a[0]) * r
    h = math.sin(dla / 2) ** 2 + math.cos(a[1] * r) * math.cos(b[1] * r) * math.sin(dlo / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def load_osm(path=None, refresh=False):
    """Read a saved Overpass response, or download one (with retries and backup servers) and save it."""
    if path:
        return json.load(open(path, encoding="utf-8"))
    if os.path.exists(CACHE) and not refresh:
        print(f"using saved OSM data {CACHE} (run with --refresh to download again)")
        return json.load(open(CACHE, encoding="utf-8"))
    def fetch(query):
        body = urllib.parse.urlencode({"data": query}).encode()
        for url in OVERPASS_SERVERS:
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url, data=body, headers={"User-Agent": "israil-pipeline (github.com/peterbak6/israil)"})
                    with urllib.request.urlopen(req, timeout=300) as r:
                        data = json.loads(r.read())
                    if "elements" not in data:
                        raise ValueError("unexpected response")
                    return data
                except Exception as e:  # busy server, timeout, bad JSON: wait and retry, then next server
                    errors.append(f"{url}: {e}")
                    print(f"    {url.split('/')[2]} attempt {attempt + 1} failed: {e}")
                    time.sleep(10 * (attempt + 1))
        return None

    errors, ways, base = [], {}, None
    for south, north in TILES:
        print(f"  downloading strip {south}-{north}N ...")
        data = fetch(QUERY.format(s=south, n=north))
        if data is None:
            break
        base = base or data.get("osm3s")
        for w in data["elements"]:
            ways[w["id"]] = w  # ways crossing a strip edge appear twice; keep one
        print(f"    {len(data['elements'])} ways")
    else:
        merged = {"osm3s": base or {}, "elements": list(ways.values())}
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        json.dump(merged, open(CACHE, "w", encoding="utf-8"))
        print(f"saved {len(ways)} ways to {CACHE}")
        return merged
    raise SystemExit("All Overpass servers failed:\n  " + "\n  ".join(errors) + "\nTry again in a few minutes.")


def build_graph(osm):
    key = lambda p: (round(p[0], 7), round(p[1], 7))
    pos, adj, way_of = {}, defaultdict(list), {}
    for w in osm["elements"]:
        if w.get("type") != "way" or "geometry" not in w:
            continue
        g = [(p["lon"], p["lat"]) for p in w["geometry"]]
        for i, p in enumerate(g):
            k = key(p)
            pos[k] = p
            way_of.setdefault(k, w["id"])
            if i:
                k0 = key(g[i - 1]); d = hav(g[i - 1], p)
                adj[k0].append((k, d)); adj[k].append((k0, d))
    # virtual crossovers between parallel tracks
    cell, grid = 0.0002, defaultdict(list)
    for k, p in pos.items():
        grid[(math.floor(p[0] / cell), math.floor(p[1] / cell))].append(k)
    links = 0
    for k, p in pos.items():
        cx, cy = math.floor(p[0] / cell), math.floor(p[1] / cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for k2 in grid.get((cx + dx, cy + dy), ()):
                    if k2 <= k or way_of[k2] == way_of[k]:
                        continue
                    d = hav(p, pos[k2])
                    if d < LINK_M:
                        adj[k].append((k2, d + LINK_PENALTY_M)); adj[k2].append((k, d + LINK_PENALTY_M)); links += 1
    # Snap stations only to the main connected network: small detached fragments (station tracks tagged
    # differently, short unconnected pieces) would leave a station with no route to its neighbours.
    comp, best = {}, set()
    for k in pos:
        if k in comp:
            continue
        members, stack = [k], [k]
        comp[k] = True
        while stack:
            u = stack.pop()
            for v, _ in adj[u]:
                if v not in comp:
                    comp[v] = True; members.append(v); stack.append(v)
        if len(members) > len(best):
            best = set(members)
    grid = {c: [k for k in ks if k in best] for c, ks in grid.items()}
    return pos, adj, grid, cell, links


def nearest(pos, grid, cell, p):
    """Nearest track node, searching outward in grid rings."""
    cx, cy = math.floor(p[0] / cell), math.floor(p[1] / cell)
    best, bd = None, float("inf")
    for r in range(0, 60):
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                if max(abs(dx), abs(dy)) != r:
                    continue
                for k in grid.get((cx + dx, cy + dy), ()):
                    d = hav(p, pos[k])
                    if d < bd:
                        best, bd = k, d
        if best and bd < r * cell * 90000:  # nothing closer can lie in outer rings
            break
    return best, bd


def dijkstra(adj, a, b):
    dist, prev, q = {a: 0.0}, {}, [(0.0, a)]
    while q:
        d, u = heapq.heappop(q)
        if u == b:
            break
        if d > dist.get(u, float("inf")):
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd; prev[v] = u; heapq.heappush(q, (nd, v))
    if b not in dist:
        return None, None
    path = [b]
    while path[-1] != a:
        path.append(prev[path[-1]])
    return dist[b], path[::-1]


def rdp(pts, tol_m):
    if len(pts) < 3:
        return pts
    lat0 = sum(p[1] for p in pts) / len(pts)
    cx, cy = math.cos(math.radians(lat0)) * 111320, 110540
    P = [(p[0] * cx, p[1] * cy) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = P[i], P[j]
        L = math.hypot(x2 - x1, y2 - y1) or 1
        md, mi = 0, -1
        for k in range(i + 1, j):
            d = abs((y2 - y1) * P[k][0] - (x2 - x1) * P[k][1] + x2 * y1 - y2 * x1) / L
            if d > md:
                md, mi = d, k
        if md > tol_m:
            keep[mi] = True; stack += [(i, mi), (mi, j)]
    return [p for p, k in zip(pts, keep) if k]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    osm = load_osm(args[0] if args else None, refresh='--refresh' in sys.argv)
    net = json.load(open(os.path.join(ROOT, "public", "data", "network.json"), encoding="utf-8"))
    st = {s["id"]: (s["lon"], s["lat"]) for s in net["stations"]}
    pos, adj, grid, cell, links = build_graph(osm)
    print(f"{len(pos)} track nodes, {links} parallel-track links")

    snap = {k: nearest(pos, grid, cell, p) for k, p in st.items()}
    pairs = sorted({tuple(sorted((l["stops"][i - 1], l["stops"][i]))) for l in net["lines"] for i in range(1, len(l["stops"]))})
    segments, report = {}, []
    for a, b in pairs:
        (na, da), (nb, db) = snap[a], snap[b]
        straight = hav(st[a], st[b])
        if da > MAX_SNAP_M or db > MAX_SNAP_M:
            far = a if da > db else b
            report.append(f"SKIP {a}|{b}: station {far} has no track within {MAX_SNAP_M} m"); continue
        length, path = dijkstra(adj, na, nb)
        if path is None:
            report.append(f"SKIP {a}|{b}: no track connection"); continue
        if length > straight * MAX_DETOUR + 2000:
            report.append(f"SKIP {a}|{b}: track {length / 1000:.1f} km vs {straight / 1000:.1f} km straight (detour, check OSM)"); continue
        coords = rdp([pos[k] for k in path], SIMPLIFY_M)
        segments[f"{a}|{b}"] = {"km": round(length / 1000, 2), "c": [[round(x, 5), round(y, 5)] for x, y in coords]}
        if max(da, db) > 150:
            report.append(f"note {a}|{b}: station up to {max(da, db):.0f} m from the track centre line")

    out = {
        "source": "© OpenStreetMap contributors (ODbL), railway=rail via Overpass API",
        "osm_base": osm.get("osm3s", {}).get("timestamp_osm_base"),
        "segments": segments,
    }
    json.dump(out, open(os.path.join(ROOT, "public", "data", "tracks.json"), "w", encoding="utf-8"), separators=(",", ":"))
    os.makedirs(OUT_DIR, exist_ok=True)
    text = f"{len(segments)} of {len(pairs)} segments have track geometry\n" + "\n".join(report)
    open(os.path.join(OUT_DIR, "tracks_report.txt"), "w", encoding="utf-8").write(text)
    print(text)


if __name__ == "__main__":
    main()
