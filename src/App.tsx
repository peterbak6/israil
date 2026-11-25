import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Basemap, Network, Tracks } from "./data/types";
import { loadData } from "./data/load";
import { findTrips, nextSelection } from "./core/routing";
import { easeInOut } from "./core/geometry";
import { MapView, type MapHandle } from "./map/MapView";
import { TripPanel } from "./ui/TripPanel";
import { SettingsMenu } from "./ui/SettingsMenu";
import { loadSettings, saveSettings, type Settings } from "./core/settings";

export default function App() {
  const [data, setData] = useState<{ network: Network; basemap: Basemap; tracks: Tracks } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [selection, setSelection] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const mapRef = useRef<MapHandle>(null);
  const anim = useRef<number | null>(null);

  useEffect(() => { loadData().then(setData).catch((e) => setError(String(e))); }, []);
  useEffect(() => saveSettings(settings), [settings]);

  const trip = useMemo(
    () => (data && selection.length === 2 ? findTrips(data.network, selection[0], selection[1]) : null),
    [data, selection],
  );

  // Play: ease in-out over time; each dot still moves on a straight line.
  const play = useCallback(() => {
    if (anim.current) { cancelAnimationFrame(anim.current); anim.current = null; setPlaying(false); return; }
    const from = t >= 1 ? 0 : t, dur = 3500 * (1 - from) + 400, t0 = performance.now();
    setPlaying(true);
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / dur);
      setT(from + (1 - from) * easeInOut(u));
      if (u < 1) anim.current = requestAnimationFrame(step);
      else { anim.current = null; setPlaying(false); }
    };
    anim.current = requestAnimationFrame(step);
  }, [t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelection([]); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) return <div className="status">Could not load data: {error}</div>;
  if (!data) return <div className="status">Loading…</div>;
  const src = data.network.meta.sources;

  return (
    <div className="app">
      <aside>
        <div>
          <h1>Israel Railways: schematic vs. geography</h1>
          <p className="hide-m intro">
            Each line is a polyline through its stations as drawn on the Israel Railways map. Each dot is one station on one
            line. Drag the slider: every dot moves in a straight line to the station’s GTFS position, and the dots for the
            same station merge. The lines join stops in order and do not follow the track.
          </p>
        </div>
        <div className="ctrl">
          <div className="row">
            <button onClick={play}>{playing ? "Pause" : "Play"}</button>
            <input type="range" min={0} max={100} step={1} value={Math.round(t * 100)} aria-label="Schematic to geographic"
              onChange={(e) => setT(+e.target.value / 100)} />
            <span className="pct">{Math.round(t * 100)}%</span>
          </div>
          <div className="ends"><span>Schematic</span><span>Geographic (land shown at 100%)</span></div>
        </div>
        <TripPanel network={data.network} selection={selection} trip={trip} onClear={() => setSelection([])} />
        <div className="note hide-m">
          <strong>Schematic:</strong> {src.schematic}<br />
          <strong>Coordinates:</strong> {src.coordinates}<br />
          <strong>Lines:</strong> {src.lines}<br />
          <strong>Map:</strong> {src.basemap}
          {Object.keys(data.tracks.segments).length > 0 && (
            <><br /><strong>Track:</strong> {data.tracks.source}{data.tracks.osm_base ? `, data as of ${data.tracks.osm_base.slice(0, 10)}` : ""}.
              {" "}Real track for {Object.keys(data.tracks.segments).length} station-to-station segments; the rest are drawn straight.</>
          )}
        </div>
        <div className="credit">© 2026 Peter Bak · <a href="https://visualanalytics.co.il" target="_blank" rel="noopener">VisualAnalytics</a></div>
      </aside>
      <main className={t >= 1 ? "geo" : "schem"}>
        <MapView ref={mapRef} network={data.network} basemap={data.basemap} tracks={data.tracks} t={t} size={settings.size} lang={settings.lang}
          selection={selection} trip={trip}
          onStation={(id) => setSelection((s) => nextSelection(s, id))}
          onBackground={() => setSelection([])} />
        <div className="badge">{t >= 1 ? "Geographic: GTFS stations, real track" : t === 0 ? "Schematic layout" : "Interpolating"}</div>
        <SettingsMenu settings={settings} onChange={setSettings} />
        <div className="zoom">
          <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomBy(1.6)}>+</button>
          <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomBy(1 / 1.6)}>−</button>
          <button aria-label="Reset view" className="rs" onClick={() => mapRef.current?.resetZoom()}>⟲</button>
        </div>
      </main>
    </div>
  );
}
