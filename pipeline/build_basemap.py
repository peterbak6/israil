"""Clip Natural Earth 10m layers to the Israel rail extent -> public/data/basemap.json.

Download the GeoJSON files from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
into pipeline/sources/: ne_10m_land, ne_10m_lakes, ne_10m_rivers_lake_centerlines,
ne_10m_urban_areas, ne_10m_roads (.geojson). Requires: pip install shapely
"""
import json, os
from shapely.geometry import shape, box

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "sources")
OUT = os.path.join(os.path.dirname(HERE), "public", "data", "basemap.json")
BBOX = box(33.9, 29.3, 36.2, 33.5)  # lon/lat extent around the network
R = lambda c: [round(c[0], 4), round(c[1], 4)]


def features(name, keep=lambda p: True):
    for f in json.load(open(os.path.join(SRC, f"{name}.geojson")))["features"]:
        if keep(f["properties"]):
            g = shape(f["geometry"])
            if g.intersects(BBOX):
                yield f, g.intersection(BBOX)


def polys(name, tol):
    out = []
    for _, g in features(name):
        for p in getattr(g.simplify(tol), "geoms", [g.simplify(tol)]):
            if p.geom_type == "Polygon" and not p.is_empty:
                out.append([R(x) for x in p.exterior.coords])
    return out


def lines(name, tol, keep=lambda p: True, attr=None):
    out = []
    for f, g in features(name, keep):
        s = g.simplify(tol)
        for p in getattr(s, "geoms", [s]):
            if p.geom_type == "LineString" and not p.is_empty:
                pts = [R(x) for x in p.coords]
                out.append({"c": pts, "k": f["properties"].get(attr)} if attr else pts)
    return out


data = {
    "land": polys("ne_10m_land", 0.002),
    "lakes": polys("ne_10m_lakes", 0.001),
    "urban": polys("ne_10m_urban_areas", 0.0015),
    "rivers": lines("ne_10m_rivers_lake_centerlines", 0.001),
    "roads": lines("ne_10m_roads", 0.0015, keep=lambda p: p.get("type") in ("Major Highway", "Secondary Highway"), attr="type"),
}
json.dump(data, open(OUT, "w"), separators=(",", ":"))
print({k: len(v) for k, v in data.items()}, "->", OUT)
