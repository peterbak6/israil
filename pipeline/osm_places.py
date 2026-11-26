"""City and town names for the geographic map, from OpenStreetMap.

Usage (standard library only, Python 3.9+):
    python pipeline/osm_places.py              # downloads from the Overpass API (same servers as osm_tracks.py)
    python pipeline/osm_places.py saved.json   # use a saved Overpass response

Writes public/data/places.json:
{
  "source": "© OpenStreetMap contributors, ODbL", "fetched": ISO time,
  "places": [{"id": OSM node id, "en": str|null, "he": str|null, "lon": num, "lat": num,
              "city": bool (place=city, else place=town), "pop": int|null (OSM population tag)}]
}
All place=city and place=town nodes inside Israel (OSM area ISO3166-1=IL). Where OSM has two nodes with the same
Hebrew name, the one with a population is kept. Nothing is added or guessed; the app decides which names fit on
screen (bigger places first).
"""
import json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
QUERY = '[out:json][timeout:90];area["ISO3166-1"="IL"][admin_level=2]->.a;node(area.a)[place~"^(city|town)$"];out body;'


def fetch():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    errors = []
    for url in OVERPASS_SERVERS:
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "israil-pipeline (github.com/peterbak6/israil)"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    data = json.loads(r.read())
                if "elements" in data:
                    return data
                raise ValueError("unexpected response")
            except Exception as e:
                errors.append(f"{url}: {e}")
                print(f"  {url.split('/')[2]} attempt {attempt + 1} failed: {e}")
                time.sleep(10 * (attempt + 1))
    raise SystemExit("All Overpass servers failed:\n  " + "\n  ".join(errors))


def population(v):
    digits = "".join(ch for ch in str(v or "") if ch.isdigit())
    return int(digits) if digits else None


def main():
    data = json.load(open(sys.argv[1], encoding="utf-8")) if len(sys.argv) > 1 else fetch()
    by_he = {}
    for e in data["elements"]:
        t = e.get("tags", {})
        p = {"id": e["id"], "en": t.get("name:en"), "he": t.get("name:he") or t.get("name"),
             "lon": round(e["lon"], 5), "lat": round(e["lat"], 5), "city": t.get("place") == "city",
             "pop": population(t.get("population"))}
        old = by_he.get(p["he"])
        if old is None or (old["pop"] is None and p["pop"] is not None):
            by_he[p["he"]] = p
    places = sorted(by_he.values(), key=lambda p: p["id"])
    out = {"source": "© OpenStreetMap contributors, ODbL", "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "places": places}
    path = os.path.join(ROOT, "public", "data", "places.json")
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(places)} places -> {path}")


if __name__ == "__main__":
    main()
