import type { Basemap, Network, Place, Tracks } from "./types";

/** Load the generated data files from /data (served as static assets). */
const NO_TRACKS: Tracks = { source: "", segments: {} };

export async function loadData(): Promise<{ network: Network; basemap: Basemap; tracks: Tracks; places: Place[] }> {
  const [network, basemap, tracks, places] = await Promise.all([
    fetch("/data/network.json").then((r) => { if (!r.ok) throw new Error("network.json " + r.status); return r.json(); }),
    fetch("/data/basemap.json").then((r) => { if (!r.ok) throw new Error("basemap.json " + r.status); return r.json(); }),
    // optional: without it every segment is drawn straight
    fetch("/data/tracks.json").then((r) => (r.ok ? r.json() : NO_TRACKS)).catch(() => NO_TRACKS),
    // optional: city names on the geographic map
    fetch("/data/places.json").then((r) => (r.ok ? r.json() : { places: [] })).then((d) => d.places as Place[]).catch(() => [] as Place[]),
  ]);
  return { network, basemap, tracks, places };
}
