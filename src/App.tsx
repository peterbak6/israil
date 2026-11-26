import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Basemap, Network, Tracks } from "./data/types";
import { loadData } from "./data/load";
import { loadTimetable, type Timetable } from "./data/timetable";
import { changeCombos, comboWith, legsVia, planDays, preferredCombo } from "./core/journeys";
import { NetGraph, optionsOf, pieceShape, routeOf, snapToRoute } from "./core/route";
import { loadPlanner, nextOd, savePlanner, toggleSaved, type Od } from "./core/planner";
import { addDays, fmtDur, fmtTime, israelNow } from "./core/time";
import { MapView, type MapHandle } from "./map/MapView";
import type { MapJourney, MapMe } from "./map/NetworkMap";
import { SettingsMenu } from "./ui/SettingsMenu";
import { Planner, type Pick } from "./ui/Planner";
import { JourneyPanel, type GeoStatus } from "./ui/JourneyPanel";
import { loadSettings, saveSettings, type Settings } from "./core/settings";

/** Metres from the route beyond which the marker is drawn hollow. */
const FAR = 1000;

export default function App() {
  const [data, setData] = useState<{ network: Network; basemap: Basemap; tracks: Tracks } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tt, setTt] = useState<Timetable | null>(null);
  const [ttError, setTtError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [store, setStore] = useState(loadPlanner);
  const [od, setOd] = useState<Od>({ from: null, to: null });
  const [pick, setPick] = useState<Pick | null>(null);
  const [mode, setMode] = useState<"plan" | "go">("plan");
  const [now, setNow] = useState(() => israelNow());
  const [pos, setPos] = useState<{ lon: number; lat: number } | null>(null);
  const [geo, setGeo] = useState<GeoStatus>("asking");
  // the list's "today"; frozen during a journey so passing midnight doesn't drop the journey
  const [goDate, setGoDate] = useState<string | null>(null);
  const listDate = goDate ?? now.date;
  const mapRef = useRef<MapHandle>(null);
  const planT = useRef(0);
  const watch = useRef<number | null>(null);
  const lastPiece = useRef(0);

  // Load once; a second run of this effect (React dev mode runs effects twice) must not replace the data.
  useEffect(() => {
    let cancelled = false;
    loadData().then((d) => { if (!cancelled) setData(d); }).catch((e) => { if (!cancelled) setError(String(e)); });
    loadTimetable().then((d) => { if (!cancelled) setTt(d); }).catch((e) => { if (!cancelled) setTtError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => savePlanner(store), [store]);
  useEffect(() => { const id = setInterval(() => setNow(israelNow()), 15000); return () => clearInterval(id); }, []);

  const graph = useMemo(() => (data ? new NetGraph(data.network) : null), [data]);
  const stById = useMemo(() => new Map((data?.network.stations ?? []).map((s) => [s.id, s])), [data]);
  const name = useCallback((id: string) => {
    const s = stById.get(id);
    return s ? (settings.lang === "he" ? s.name_he : s.name) : id;
  }, [stById, settings.lang]);
  // stations trains call at (the closed ones are only on the map)
  const served = useMemo(() => {
    if (!data) return [];
    const ids = tt ? new Set(tt.trips.flatMap((x) => x.st.map((s) => s[0]))) : null;
    return data.network.stations.filter((s) => (ids ? ids.has(s.id) : !s.name.includes("(closed)")));
  }, [data, tt]);

  // ----- planning -----
  const opt = useMemo(() => ({ maxChanges: settings.maxChanges, minChange: settings.minChange }), [settings.maxChanges, settings.minChange]);
  const days = useMemo(() => (tt && od.from && od.to && od.from !== od.to ? planDays(tt, listDate, od.from, od.to, opt) : null), [tt, listDate, od.from, od.to, opt]);
  const journey = useMemo(() => (pick && days ? days.find((d) => d.ymd === pick.ymd)?.journeys.find((j) => j.key === pick.key) ?? null : null), [pick, days]);
  const combos = useMemo(() => (journey ? changeCombos(journey, opt.minChange) : []), [journey, opt.minChange]);
  const prefKey = `${od.from}>${od.to}`;
  const combo = pick && journey ? (pick.combo >= 0 ? pick.combo : preferredCombo(combos, store.prefs[prefKey])) : 0;
  const legs = useMemo(() => (journey ? legsVia(journey, combos[combo] ?? []) : null), [journey, combos, combo]);
  const route = useMemo(() => (legs && graph ? routeOf(graph, legs) : null), [legs, graph]);
  const mapJourney = useMemo<MapJourney | null>(() => route && legs && od.from && od.to
    ? { ...route, key: [od.from, od.to, ...legs.slice(1).map((g) => g.run.st[g.i])] } : null, [route, legs, od.from, od.to]);
  // before a trip is picked: all the ways the listed journeys go, from the timetable (not from the printed lines)
  const options = useMemo<MapJourney | null>(() => {
    if (pick || !days || !graph || !od.from || !od.to) return null;
    const all = days.flatMap((d) => d.journeys);
    if (!all.length) return null;
    const legsOf = (j: (typeof all)[number]) => {
      const c = changeCombos(j, opt.minChange);
      return legsVia(j, c[preferredCombo(c, store.prefs[prefKey])] ?? []);
    };
    const o = optionsOf(graph, all.map(legsOf));
    return { ...o, key: [od.from, od.to, ...o.changes], colorBy: "line" };
  }, [pick, days, graph, od.from, od.to, store.prefs, prefKey, opt.minChange]);
  const shapes = useMemo(() => (route && data ? route.pieces.map((p) => pieceShape(data.network, data.tracks, p)) : null), [route, data]);

  const changeOd = (next: Od) => { setOd(next); setPick(null); };
  const onSlot = (slot: number, station: string) => {
    const c = comboWith(combos, combo, slot, station);
    setPick((p) => (p ? { ...p, combo: c } : p));
    setStore((s) => ({ ...s, prefs: { ...s.prefs, [prefKey]: (combos[c] ?? []).map((x) => x.station) } }));
  };

  // ----- journey mode -----
  const stopWatch = () => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current); watch.current = null; };
  const go = () => {
    if (!legs) return;
    planT.current = t;
    setGoDate(now.date);
    setT(store.journeyT);
    setMode("go");
    lastPiece.current = 0;
    setPos(null);
    // the location is asked for only now, used on this device only and never stored
    if (!navigator.geolocation) { setGeo("unavailable"); return; }
    setGeo("asking");
    watch.current = navigator.geolocation.watchPosition(
      (p) => { setPos({ lon: p.coords.longitude, lat: p.coords.latitude }); setGeo("ok"); },
      (e) => { setGeo(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
  };
  const end = () => { stopWatch(); setPos(null); setMode("plan"); setGoDate(null); setT(planT.current); };
  useEffect(() => stopWatch, []);
  // frame the journey once the map has the journey's slider value (and, on phones, its new size)
  useEffect(() => {
    if (mode !== "go") { mapRef.current?.resetZoom(); return; }
    const id = setTimeout(() => mapRef.current?.fitJourney(), 120);
    return () => clearTimeout(id);
  }, [mode]);

  const snap = useMemo(() => {
    if (mode !== "go" || !pos || !shapes) return null;
    const s = snapToRoute(shapes, pos.lon, pos.lat, lastPiece.current);
    if (s) lastPiece.current = s.piece;
    return s;
  }, [mode, pos, shapes]);

  const live = useMemo(() => {
    if (mode !== "go" || !legs || !route || !pick) return null;
    // the journey's times count from midnight of its own day
    const nowRel = now.min + (pick.ymd === addDays(now.date, 1) ? -1440 : pick.ymd === addDays(now.date, -1) ? 1440 : 0);
    const timeLeg = Math.max(0, legs.findIndex((g) => g.run.arr[g.j] > nowRel));
    const leg = snap ? route.pieces[snap.piece].leg : timeLeg;
    const until = (m: number) => (m - nowRel >= 1 ? `in ${fmtDur(m - nowRel)}` : `due ${fmtTime(m)}`);
    const last = legs[legs.length - 1], arr = last.run.arr[last.j];
    const g = legs[leg];
    const change = leg < legs.length - 1 ? `Change at ${name(g.run.st[g.j])} ${until(g.run.arr[g.j])}` : null;
    return {
      leg, change,
      big: arr - nowRel >= 1 ? fmtDur(arr - nowRel) : `due ${fmtTime(arr)}`,
      sub: `to ${name(last.run.st[last.j])} · ${fmtTime(arr)}`,
    };
  }, [mode, legs, route, pick, now, snap, name]);

  const me = useMemo<MapMe | null>(() => (snap && live
    ? { piece: snap.piece, frac: snap.frac, far: snap.dist > FAR, lines: live.change ? [live.change] : [], big: live.big, sub: live.sub } : null), [snap, live]);

  const selection = useMemo(() => [od.from, od.to].filter((x): x is string => !!x), [od]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && mode === "plan" && !(e.target instanceof HTMLInputElement)) changeOd({ from: null, to: null }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  if (error) return <div className="status">Could not load data: {error}</div>;
  if (!data) return <div className="status">Loading…</div>;

  const setSlider = (v: number) => { setT(v); if (mode === "go") setStore((s) => ({ ...s, journeyT: v })); };

  return (
    <div className={"app" + (mode === "go" ? " go" : "")}>
      <aside>
        <h1>Israil · Geo-Schematic Map</h1>
        {mode === "go" && legs && live && pick ? (
          <JourneyPanel ymd={pick.ymd} legs={legs} name={name} leg={live.leg} change={live.change} big={live.big} sub={live.sub}
            geo={geo === "ok" && snap && snap.dist > FAR ? "far" : geo} farKm={snap ? snap.dist / 1000 : null} onEnd={end} />
        ) : (
          <Planner od={od} onOd={changeOd} stations={served} name={name} store={store}
            onToggleSaved={() => setStore((s) => toggleSaved(s, od))}
            days={days} ttError={ttError} opt={opt} feedEnd={tt?.feed.end ?? null} feedPublished={tt?.feed.published ?? null} now={now}
            pick={pick && { ...pick, combo }} onPick={setPick} combos={combos} onSlot={onSlot} legs={legs} onGo={go} />
        )}
        <div className="credit">© 2026 Peter Bak · <a href="https://visualanalytics.co.il" target="_blank" rel="noopener">VisualAnalytics</a></div>
      </aside>
      <main className={t >= 1 ? "geo" : "schem"}>
        <MapView ref={mapRef} network={data.network} basemap={data.basemap} tracks={data.tracks} t={t} size={settings.size} lang={settings.lang}
          selection={selection} journey={mapJourney ?? options} me={mode === "go" ? me : null}
          onStation={(id) => { if (mode === "plan") changeOd(nextOd(od, id)); }}
          onBackground={() => { if (mode === "plan" && !pick) changeOd({ from: null, to: null }); }} />
        <div className="morph">
          <span>Schematic</span>
          <input type="range" min={0} max={100} step={1} value={Math.round(t * 100)} aria-label="Schematic to geographic"
            onChange={(e) => setSlider(+e.target.value / 100)} />
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
