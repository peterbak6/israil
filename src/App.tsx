import { useEffect, useMemo, useRef, useState } from "react";
import type { Basemap, Network, Tracks } from "./data/types";
import { loadData } from "./data/load";
import { findTrips, nextSelection } from "./core/routing";
import { MapView, type MapHandle } from "./map/MapView";
import { SettingsMenu } from "./ui/SettingsMenu";
import { loadSettings, saveSettings, type Settings } from "./core/settings";

export default function App() {
  const [data, setData] = useState<{ network: Network; basemap: Basemap; tracks: Tracks } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [selection, setSelection] = useState<string[]>([]);
  const mapRef = useRef<MapHandle>(null);

  // Load once; a second run of this effect (React dev mode runs effects twice) must not replace the data.
  useEffect(() => {
    let cancelled = false;
    loadData().then((d) => { if (!cancelled) setData(d); }).catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => saveSettings(settings), [settings]);

  const trip = useMemo(
    () => (data && selection.length === 2 ? findTrips(data.network, selection[0], selection[1]) : null),
    [data, selection],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelection([]); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) return <div className="status">Could not load data: {error}</div>;
  if (!data) return <div className="status">Loading…</div>;

  return (
    <div className="app">
      <aside>
        <h1>Israil · Geo-Schematic Map</h1>
        {/* Trip details UI to be designed; for now the map highlights the trip and the tooltip names the lines.
            A fixed hint keeps the panel's height constant, so selecting never moves the map. */}
        <p className="hint">Click or tap two stations to see the lines that connect them. Esc or a click on the map clears.</p>
        <div className="credit">© 2026 Peter Bak · <a href="https://visualanalytics.co.il" target="_blank" rel="noopener">VisualAnalytics</a></div>
      </aside>
      <main className={t >= 1 ? "geo" : "schem"}>
        <MapView ref={mapRef} network={data.network} basemap={data.basemap} tracks={data.tracks} t={t} size={settings.size} lang={settings.lang}
          selection={selection} trip={trip}
          onStation={(id) => setSelection((s) => nextSelection(s, id))}
          onBackground={() => setSelection([])} />
        <div className="morph">
          <span>Schematic</span>
          <input type="range" min={0} max={100} step={1} value={Math.round(t * 100)} aria-label="Schematic to geographic"
            onChange={(e) => setT(+e.target.value / 100)} />
          <span>Geographic</span>
          <b className="pct">{Math.round(t * 100)}%</b>
        </div>
        {/* OpenStreetMap's licence requires this credit wherever its data is shown */}
        {t > 0 && Object.keys(data.tracks.segments).length > 0 && (
          <div className="attrib">Track © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</div>
        )}
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
