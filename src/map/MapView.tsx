import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Basemap, Lang, Network, Tracks } from "../data/types";
import { NetworkMap, type MapJourney, type MapMe } from "./NetworkMap";

export type MapHandle = { zoomBy(k: number): void; resetZoom(): void; fitJourney(): void };

type Props = {
  network: Network;
  basemap: Basemap;
  tracks: Tracks;
  t: number;
  size: number;
  lang: Lang | "off";
  selection: string[];
  journey: MapJourney | null;
  me: MapMe | null;
  onStation(id: string): void;
  onBackground(): void;
};

/** React wrapper around the imperative NetworkMap; props are forwarded to it in effects. */
export const MapView = forwardRef<MapHandle, Props>(function MapView(p, ref) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<NetworkMap | null>(null);
  const cb = useRef({ onStation: p.onStation, onBackground: p.onBackground });
  cb.current = { onStation: p.onStation, onBackground: p.onBackground };

  const latest = useRef(p);
  latest.current = p;

  useEffect(() => {
    const m = new NetworkMap(host.current!, p.network, p.basemap, p.tracks, {
      onStation: (id) => cb.current.onStation(id),
      onBackground: () => cb.current.onBackground(),
    });
    // A map created after the first render (e.g. new data) must start from the current settings,
    // not its defaults: the per-setting effects below only run when that setting changes.
    const q = latest.current;
    m.setSize(q.size); m.setLang(q.lang); m.setSelection(q.selection); m.setJourney(q.journey); m.setMe(q.me); m.setT(q.t);
    map.current = m;
    return () => { m.destroy(); map.current = null; };
  }, [p.network, p.basemap, p.tracks]);

  useEffect(() => map.current?.setT(p.t), [p.t]);
  useEffect(() => map.current?.setSize(p.size), [p.size]);
  useEffect(() => map.current?.setLang(p.lang), [p.lang]);
  useEffect(() => map.current?.setSelection(p.selection), [p.selection]);
  useEffect(() => map.current?.setJourney(p.journey), [p.journey]);
  useEffect(() => map.current?.setMe(p.me), [p.me]);

  useImperativeHandle(ref, () => ({
    zoomBy: (k) => map.current?.zoomBy(k),
    resetZoom: () => map.current?.resetZoom(),
    fitJourney: () => map.current?.fitJourney(),
  }));

  return <div className="map-host" ref={host} />;
});
