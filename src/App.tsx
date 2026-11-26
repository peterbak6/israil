import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Basemap, Network, Place, Tracks } from "./data/types";
import { loadData } from "./data/load";
import { loadTimetable, type Timetable } from "./data/timetable";
import { changeCombos, comboWith, legsVia, planDays, preferredCombo } from "./core/journeys";
import { NetGraph, optionsOf, pieceShape, pointAlong, routeOf, snapToRoute } from "./core/route";
import { loadPlanner, nextOd, savePlanner, toggleSaved, type Od } from "./core/planner";
import { daysBetween, fmtDur, fmtTime, israelNow } from "./core/time";
import { easeInOut } from "./core/geometry";
import { MapView, type MapHandle } from "./map/MapView";
import type { MapJourney, MapMe } from "./map/NetworkMap";
import { SettingsMenu } from "./ui/SettingsMenu";
import { Planner, type Pick } from "./ui/Planner";
import { Favorites } from "./ui/Favorites";
import { StageDots, type Screen, type Stage } from "./ui/StageDots";
import { JourneyPanel } from "./ui/JourneyPanel";
import { loadSettings, saveSettings, type Settings } from "./core/settings";

/** Demo: `?simulate=20` in the address makes a started trip move a fake position from start to destination in 20 s
 * (after the slider's glide), with the clock running from departure to arrival. For screen recordings only;
 * without it the app uses the real location. */
const SIMULATE = (() => { const v = new URLSearchParams(location.search).get("simulate"); return v === null ? 0 : Math.max(5, +v || 20); })();

/** Metres from the route beyond which the marker is drawn hollow. */
const FAR = 1000;

export default function App() {
  const [data, setData] = useState<{ network: Network; basemap: Basemap; tracks: Tracks; places: Place[] } | null>(null);
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
  // Pages. Phone: 1 map, 2 favourites, 3 trips (replaced by the trip in progress after the start button); each
  // its own screen, and the map shows the current selection, options or trip. Desktop: the map is always visible;
  // pages are Plan (3) and Favourites (2).
  const desktop = useDesktop();
  const [screen, setScreen] = useState<Screen>(() => (window.matchMedia(DESKTOP).matches ? 3 : 1));
  // day and time the trip list is for; null = today / now
  const [whenSel, setWhenSel] = useState<{ date: string | null; min: number | null }>({ date: null, min: null });
  // the list's day; frozen during a journey so passing midnight doesn't drop the journey
  const [goDate, setGoDate] = useState<string | null>(null);
  const listDate = goDate ?? whenSel.date ?? now.date;
  const when = { date: listDate, min: whenSel.min ?? now.min, isNow: whenSel.date === null && whenSel.min === null };
  const anim = useRef(0);
  const sim = useRef(0);
  const [simMin, setSimMin] = useState<number | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  // A sideways swipe on a page must not reach the browser, which would treat it as "back" and leave the app.
  // (React's touch listeners are passive, so this one is added directly.)
  useEffect(() => {
    const a = asideRef.current;
    if (!a) return;
    const move = (e: TouchEvent) => {
      const st = swipe.current, t0 = e.touches[0];
      if (st && t0 && Math.abs(t0.clientX - st.x) > Math.abs(t0.clientY - st.y)) e.preventDefault();
    };
    a.addEventListener("touchmove", move, { passive: false });
    return () => a.removeEventListener("touchmove", move);
  });
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
  /** Picking stations (map, fields or a favourite): once both are set, the trips stage opens. */
  const chooseOd = (next: Od) => { changeOd(next); if (next.from && next.to && next.from !== next.to) setScreen(3); };
  /** Move the slider smoothly to `to` (used when a journey starts). */
  const glide = (from: number, to: number, ms = 2500) => {
    cancelAnimationFrame(anim.current);
    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms);
      setT(from + (to - from) * easeInOut(u));
      if (u < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
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
    setGoDate(listDate);
    setMode("go");
    if (!desktop) setScreen(1); // phone: the map page, where the marker moves
    glide(t, 1); // on route: slowly to the geographic view
    lastPiece.current = 0;
    setPos(null);
    if (SIMULATE && shapes) {
      // demo: move along the route once the glide to 100% has finished
      const dep = legs[0].run.dep[legs[0].i], last = legs[legs.length - 1], arr = last.run.arr[last.j];
      const t0 = performance.now() + 2700, ms = SIMULATE * 1000;
      setSimMin(dep);
      const step = (nowT: number) => {
        const u = Math.max(0, Math.min(1, (nowT - t0) / ms));
        const [lon, lat] = pointAlong(shapes, u);
        setPos({ lon, lat });
        setSimMin(dep + u * (arr - dep));
        if (u < 1) sim.current = requestAnimationFrame(step);
      };
      sim.current = requestAnimationFrame(step);
      return;
    }
    // the location is asked for only now, used on this device only and never stored
    if (!navigator.geolocation) return;
    watch.current = navigator.geolocation.watchPosition(
      (p) => setPos({ lon: p.coords.longitude, lat: p.coords.latitude }),
      () => setPos(null), // no position: the timetable still works, without the marker
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
  };
  const end = () => {
    cancelAnimationFrame(anim.current); cancelAnimationFrame(sim.current); setSimMin(null);
    stopWatch(); setPos(null); setMode("plan"); setGoDate(null); setT(planT.current);
  };
  useEffect(() => stopWatch, []);
  // frame the journey as it will look at the end of the glide (and after the screen's new size on phones)
  useEffect(() => {
    if (mode !== "go") { mapRef.current?.resetZoom(); return; }
    const id = setTimeout(() => mapRef.current?.fitJourney(1), 150);
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
    const nowRel = simMin ?? now.min - 1440 * daysBetween(now.date, pick.ymd); // (simMin: demo clock)
    const timeLeg = Math.max(0, legs.findIndex((g) => g.run.arr[g.j] > nowRel));
    const leg = snap ? route.pieces[snap.piece].leg : timeLeg;
    // a countdown while it is ahead; once the scheduled time has passed, just the time
    const when = (m: number) => (m - nowRel >= 1 ? `in ${fmtDur(m - nowRel)}` : `at ${fmtTime(m)}`);
    const last = legs[legs.length - 1], g = legs[leg];
    // only the next action: the next change, or else the arrival
    return leg < legs.length - 1
      ? { leg, what: `Change at ${name(g.run.st[g.j])}`, when: when(g.run.arr[g.j]) }
      : { leg, what: `Arrive at ${name(last.run.st[last.j])}`, when: when(last.run.arr[last.j]) };
  }, [mode, legs, route, pick, now, snap, name, simMin]);

  const me = useMemo<MapMe | null>(() => (snap && live
    ? { piece: snap.piece, frac: snap.frac, far: snap.dist > FAR, what: live.what, when: live.when } : null), [snap, live]);

  const selection = useMemo(() => [od.from, od.to].filter((x): x is string => !!x), [od]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) clear(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** The ✕ on the map (or a double tap on empty space) undoes the latest step: a trip in progress, else a
   * picked trip, else the selected stations. */
  function clear() {
    if (mode === "go") end();
    else if (pick) setPick(null);
    else changeOd({ from: null, to: null });
  }

  if (error) return <div className="status">Could not load data: {error}</div>;
  if (!data) return <div className="status">Loading…</div>;

  const setSlider = (v: number) => { cancelAnimationFrame(anim.current); setT(v); };
  const complete = !!od.from && !!od.to;
  const odProps = { od, onOd: chooseOd, stations: served, name, store, onToggleSaved: () => setStore((s) => toggleSaved(s, od)) };
  const page: Screen = desktop ? (screen === 2 ? 2 : 3) : screen;
  const stages: Stage[] = desktop
    // order of the dots: favourites on the left, so the map and the trips (plan) sit next to each other
    ? [{ s: 2, label: "Favourites", enabled: true }, { s: 3, label: "Plan", enabled: true }]
    : [{ s: 2, label: "Favourites", enabled: true }, { s: 1, label: "Map", enabled: true },
      { s: 3, label: mode === "go" ? "Trip in progress" : "Trips", enabled: true }];
  // phone: swipe left/right on a page (not on the map, where dragging pans) to go to the next/previous page
  const onSwipeEnd = (x: number, y: number) => {
    const st = swipe.current; swipe.current = null;
    if (desktop || !st || Math.abs(x - st.x) < 70 || Math.abs(x - st.x) < 2 * Math.abs(y - st.y)) return;
    const order = stages.filter((g) => g.enabled).map((g) => g.s), i = order.indexOf(page);
    const next = order[i + (x < st.x ? 1 : -1)];
    if (next) setScreen(next);
  };
  const chip = mode === "go" ? "Trip in progress" : od.from || od.to ? `${od.from ? name(od.from) : "…"} → ${od.to ? name(od.to) : "…"}` : null;

  return (
    <div className={"app" + (mode === "go" ? " go" : "")} data-page={page}>
      <header>
        <div className="brand"><img className="logo" src="/favicon.svg" alt="" width="28" height="28" /><b>Israil</b><span>the map ⇄ the track</span></div>
        <div className="hdr-btns">
          {/* undo the latest step: end the trip, else unpick the trip, else clear the stations */}
          <button className="undo" onClick={clear} disabled={!chip}
            aria-label={mode === "go" ? "End the trip" : pick ? "Unpick the trip" : "Clear the selected stations"}
            title={mode === "go" ? "End the trip" : pick ? "Unpick the trip" : "Clear the stations"}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M4.6 15a8 8 0 1 0 1.9-8.3L4 10" /></svg>
          </button>
          <SettingsMenu settings={settings} onChange={setSettings} />
        </div>
      </header>
      <aside ref={asideRef} onTouchStart={(e) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => onSwipeEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY)}>
        {page === 2 ? (
          <Favorites store={store} name={name} onOpen={chooseOd} onRemove={(a, b) => setStore((s) => toggleSaved(s, { from: a, to: b }))} />
        ) : mode === "go" && legs && live && pick && page === 3 ? (
          <JourneyPanel ymd={pick.ymd} legs={legs} name={name} leg={live.leg} onEnd={end} />
        ) : page === 3 ? (
          <Planner {...odProps} onOd={changeOd}
            days={complete ? days : null} ttError={ttError} opt={opt} feedStart={tt?.feed.start ?? null} feedEnd={tt?.feed.end ?? null}
            feedPublished={tt?.feed.published ?? null} now={now} when={when}
            onWhen={(date, min) => { setWhenSel({ date: date === now.date ? null : date, min }); setPick(null); }}
            pick={pick && { ...pick, combo }} onPick={setPick} combos={combos} onSlot={onSlot} legs={legs} onGo={go} />
        ) : null}
        <div className="credit">© 2026 Peter Bak · <a href="https://visualanalytics.co.il" target="_blank" rel="noopener">VisualAnalytics</a></div>
      </aside>
      <StageDots screen={page} stages={stages} onScreen={setScreen} />
      <main className={t >= 1 ? "geo" : "schem"}>
        <MapView ref={mapRef} network={data.network} basemap={data.basemap} tracks={data.tracks} places={data.places} t={t} size={settings.size} lang={settings.lang}
          selection={selection} journey={mapJourney ?? options} me={mode === "go" ? me : null}
          onStation={(id) => { if (mode === "plan") chooseOd(nextOd(od, id)); }}
          onBackground={clear} />
        <div className="morph">
          <span>Schematic</span>
          <input type="range" min={0} max={100} step={1} value={Math.round(t * 100)} aria-label="Schematic to geographic"
            onChange={(e) => setSlider(+e.target.value / 100)} />
          <span>Geographic</span>
          <b className="pct">{Math.round(t * 100)}%</b>
        </div>
        {chip && (
          <button className="sel-chip" onClick={clear} title="Clear (or double-tap empty map space)"
            aria-label={mode === "go" ? "End the trip" : pick ? "Unpick the trip" : "Clear the selected stations"}>
            <span>{chip}{mode !== "go" && journey ? ` · ${fmtTime(journey.dep)}` : ""}</span><b aria-hidden="true">✕</b>
          </button>
        )}
        {/* OpenStreetMap's licence requires this credit wherever its data is shown */}
        {t > 0 && Object.keys(data.tracks.segments).length > 0 && (
          <div className="attrib">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</div>
        )}
        <div className="zoom">
          <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomBy(2)}>+</button>
          <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomBy(0.5)}>−</button>
        </div>
      </main>
    </div>
  );
}

const DESKTOP = "(min-width: 761px)";
/** True on wide screens (the map and a side panel side by side). */
function useDesktop() {
  const [d, setD] = useState(() => window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    const m = window.matchMedia(DESKTOP), on = () => setD(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return d;
}
