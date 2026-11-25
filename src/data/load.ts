import type { Basemap, Network } from "./types";

/** Load the generated data files from /data (served as static assets). */
export async function loadData(): Promise<{ network: Network; basemap: Basemap }> {
  const [network, basemap] = await Promise.all([
    fetch("/data/network.json").then((r) => { if (!r.ok) throw new Error("network.json " + r.status); return r.json(); }),
    fetch("/data/basemap.json").then((r) => { if (!r.ok) throw new Error("basemap.json " + r.status); return r.json(); }),
  ]);
  return { network, basemap };
}
