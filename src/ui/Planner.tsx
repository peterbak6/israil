import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Station } from "../data/types";
import { DEFAULT_SEARCH, destination, type Change, type Journey, type Leg, type PlanDay, type SearchOpts } from "../core/journeys";
import type { Od, PlannerStore } from "../core/planner";
import { isSaved } from "../core/planner";
import { addDays, fmtDay, fmtDur, fmtTime } from "../core/time";
import { TRAIN_COLORS } from "../core/route";
import { StationInput } from "./StationInput";

export type Pick = { ymd: string; key: string; combo: number };

type Props = {
  od: Od;
  onOd(od: Od): void;
  stations: Station[];
  name(id: string): string;
  store: PlannerStore;
  onToggleSaved(): void;
  /** null while the timetable is loading */
  days: PlanDay[] | null;
  ttError: string | null;
  /** the search limits from the settings */
  opt: SearchOpts;
  feedStart: string | null;
  feedEnd: string | null;
  /** the day and time the list is for (default: today, now) */
  when: { date: string; min: number; isNow: boolean };
  onWhen(date: string | null, min: number | null): void;
  /** when the Ministry published the timetable in use */
  feedPublished: string | null;
  now: { date: string; min: number };
  pick: Pick | null;
  onPick(p: Pick | null): void;
  /** change combinations of the picked journey */
  combos: Change[][];
  onSlot(slot: number, station: string): void;
  legs: Leg[] | null;
  onGo(): void;
};

/** A train as shown in the list: number and destination, marked with the train's colour on the map. */
export function TrainPill({ leg, k, name }: { leg: Leg; k: number; name(id: string): string }) {
  return (
    <span className="pill" style={{ borderLeftColor: TRAIN_COLORS[k % TRAIN_COLORS.length] }}>
      <b>{leg.run.trip.n ?? "–"}</b> {name(destination(leg.run))}
    </span>
  );
}

const changesText = (n: number) => (n === 0 ? "direct" : n === 1 ? "1 change" : `${n} changes`);

/** From and To fields with swap and star; also used alone on the map stage (desktop). */
export function OdFields(p: Pick2<Props, "od" | "onOd" | "stations" | "name" | "store" | "onToggleSaved">) {
  const { od, name } = p;
  const complete = !!od.from && !!od.to;
  return (
      <div className="od">
        <div className="od-fields">
          <StationInput label="From" value={od.from} stations={p.stations} name={name} onChange={(from) => p.onOd({ ...od, from })} />
          <StationInput label="To" value={od.to} stations={p.stations} name={name} onChange={(to) => p.onOd({ ...od, to })} />
        </div>
        <div className="od-btns">
          <button className="icon" aria-label="Swap direction" title="Swap direction" onClick={() => p.onOd({ from: od.to, to: od.from })}>⇅</button>
          <button className="icon" aria-label="Save this search" title="Save this search" aria-pressed={isSaved(p.store, od)}
            disabled={!complete} onClick={p.onToggleSaved}>{isSaved(p.store, od) ? "★" : "☆"}</button>
        </div>
      </div>
  );
}
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

const ymdToInput = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const inputToYmd = (v: string) => v.replace(/-/g, "");

/** Stage 3: From/To, day and time, the trips, the change stations, Go. */
export function Planner(p: Props) {
  const { od, when } = p;
  const complete = !!od.from && !!od.to;
  const minDate = [p.now.date, p.feedStart ?? p.now.date].sort()[1];
  return (
    <div className="planner">
      <OdFields {...p} />
      <div className="when">
        {/* the day as "Sun 29 Nov"; the native date picker sits invisibly on top and opens on tap */}
        <label className="date-field">
          <span>{fmtDay(when.date)}</span>
          <input type="date" aria-label="Day" value={ymdToInput(when.date)} min={ymdToInput(minDate)} max={p.feedEnd ? ymdToInput(p.feedEnd) : undefined}
            onClick={(e) => { try { (e.target as HTMLInputElement).showPicker?.(); } catch { /* not supported: native behaviour */ } }}
            onChange={(e) => e.target.value && p.onWhen(inputToYmd(e.target.value), when.isNow ? null : when.min)} />
        </label>
        <input type="time" aria-label="Time" value={fmtTime(when.min)}
          onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); if (!isNaN(h)) p.onWhen(when.date === p.now.date && when.isNow ? null : when.date, h * 60 + (m || 0)); }} />
        <button className="ghost" disabled={when.isNow} onClick={() => p.onWhen(null, null)}>Now</button>
      </div>
      {complete && (p.opt.maxChanges !== DEFAULT_SEARCH.maxChanges || p.opt.minChange !== DEFAULT_SEARCH.minChange) && (
        // a filtered list should never be a surprise (the limits are set in the gear menu)
        <p className="filtered">Settings: {p.opt.maxChanges === 0 ? "direct trains only" : `at most ${p.opt.maxChanges} change${p.opt.maxChanges > 1 ? "s" : ""}`}
          {p.opt.minChange > 0 ? ` · at least ${p.opt.minChange} min to change` : ""}</p>
      )}
      {complete && <JourneyList {...p} />}
    </div>
  );
}

let openedDetail = "";
/** Where the trip list was scrolled, kept while the page is closed (phone) so it reopens at the same place. */
const listScroll = { key: "", top: 0 };

function JourneyList(p: Props) {
  const { days, now, pick, name, when } = p;
  const box = useRef<HTMLDivElement>(null), nowMark = useRef<HTMLDivElement>(null);
  // The list opens at the chosen time (or now) only when the search changes; the clock ticking does not move it,
  // and coming back to the page restores where it was scrolled.
  const searchKey = [p.od.from, p.od.to, when.date, when.isNow ? "now" : when.min, p.opt.maxChanges, p.opt.minChange].join("|");
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !days) return;
    if (listScroll.key === searchKey) el.scrollTop = listScroll.top;
    else if (nowMark.current) el.scrollTop = nowMark.current.offsetTop - el.offsetTop - 8;
    listScroll.key = searchKey;
  }, [searchKey, !!days]);

  if (p.ttError) return <p className="hint">Timetable not available ({p.ttError}), so no trains can be shown.</p>;
  if (!days) return <p className="hint">Loading timetable…</p>;
  if (!days[0].covered)
    return <p className="hint">{p.feedEnd && when.date > p.feedEnd
      ? `The timetable in this app runs until ${fmtDay(p.feedEnd)}, so there are no trains to show for ${fmtDay(when.date)} yet.`
      : `There is no timetable for ${fmtDay(when.date)} in this app.`}</p>;
  const dayName = (ymd: string) => (ymd === now.date ? "Today · " : ymd === addDays(now.date, 1) ? "Tomorrow · " : "") + fmtDay(ymd);
  const markText = when.isNow ? `now ${fmtTime(now.min)}` : fmtTime(when.min);

  let marked = false;
  return (
    <div className="jlist" ref={box} onScroll={(e) => { listScroll.top = e.currentTarget.scrollTop; listScroll.key = searchKey; }}>
      {days.filter((d) => d.covered).map((d, di) => (
        <Fragment key={d.ymd}>
          {di > 0 && <div className="day">{dayName(d.ymd)}</div>}
          {!d.journeys.length && <p className="hint">No trains between these stations on this day (within two changes).</p>}
          {d.journeys.map((j) => {
            // trains already gone are greyed out (only today); the list opens at the chosen time
            const past = d.ymd === now.date && j.dep < now.min;
            const mark = di === 0 && j.dep >= when.min && !marked && (marked = true);
            const open = pick?.ymd === d.ymd && pick.key === j.key;
            return (
              <Fragment key={j.key}>
                {mark && <div className="now" ref={nowMark}><span>{markText}</span></div>}
                <button className={"jrow" + (past ? " past" : "") + (open ? " open" : "")} aria-expanded={open}
                  onClick={() => p.onPick(open ? null : { ymd: d.ymd, key: j.key, combo: -1 })}>
                  <span className="l1"><b>{fmtTime(j.dep)} – {fmtTime(j.arr)}</b><span className="m">{fmtDur(j.arr - j.dep)} · {changesText(j.changes)}</span></span>
                  <span className="l2">{j.legs.map((g, k) => <Fragment key={k}>{k > 0 && <span className="sep">›</span>}<TrainPill leg={g} k={k} name={name} /></Fragment>)}</span>
                </button>
                {open && <JourneyDetail {...p} j={j} />}
              </Fragment>
            );
          })}
          {/* the now line after the last train of today */}
          {di === 0 && !marked && (marked = true) && <div className="now" ref={nowMark}><span>{markText} · no more trains this day</span></div>}
        </Fragment>
      ))}
      <p className="m small feedinfo">Scheduled times from the Ministry of Transport timetable
        {p.feedPublished ? ` published ${fmtPublished(p.feedPublished)}` : ""}. Changes made after that are not included.</p>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-24T19:41" -> "24 Nov, 19:41" */
const fmtPublished = (s: string) => `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1]}, ${s.slice(11, 16)}`;

function JourneyDetail(p: Props & { j: Journey }) {
  const { j, combos, pick, name, legs } = p;
  const [stops, setStops] = useState(false);
  const cur = combos[pick?.combo ?? 0] ?? [];
  const ref = useRef<HTMLDivElement>(null);
  // bring the change choices and the start button into view when a trip is opened (not when the page reopens)
  useEffect(() => {
    if (openedDetail === j.key) return;
    openedDetail = j.key;
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [j.key]);
  return (
    <div className="jdetail" ref={ref}>
      {Array.from({ length: j.changes }, (_, slot) => {
        const seen = new Map<string, Change>();
        for (const c of combos) if (c[slot] && !seen.has(c[slot].station)) seen.set(c[slot].station, c[slot]);
        return (
          <fieldset key={slot} className="slot">
            <legend>Change {j.changes > 1 ? slot + 1 : ""} · train {j.legs[slot].run.trip.n} → {j.legs[slot + 1].run.trip.n}</legend>
            {[...seen.values()].map((c) => (
              <label key={c.station} className={cur[slot]?.station === c.station ? "on" : ""}>
                <input type="radio" name={`slot${slot}`} checked={cur[slot]?.station === c.station} onChange={() => p.onSlot(slot, c.station)} />
                <span className="st">{name(c.station)}</span>
                <span className="m">{fmtTime(c.arr)} → {fmtTime(c.dep)} · {c.dep - c.arr} min</span>
              </label>
            ))}
          </fieldset>
        );
      })}
      <div className="jd-btns">
        <button className="ghost" onClick={() => setStops((s) => !s)} aria-expanded={stops}>{stops ? "Hide stops" : "Show stops"}</button>
        <button className="go" onClick={p.onGo} aria-label="Start the trip" title="Start the trip">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
        </button>
      </div>
      {stops && legs && <LegList legs={legs} name={name} />}
    </div>
  );
}

/** Every stop of each leg with its time; changes in between. */
export function LegList({ legs, name, highlight }: { legs: Leg[]; name(id: string): string; highlight?: number }) {
  return (
    <ol className="legs">
      {legs.map((g, k) => (
        <li key={k} className={highlight === k ? "cur" : ""} style={{ ["--train" as string]: TRAIN_COLORS[k % TRAIN_COLORS.length] }}>
          {k > 0 && <div className="chg">Change at {name(g.run.st[g.i])} · {g.run.dep[g.i] - legs[k - 1].run.arr[legs[k - 1].j]} min</div>}
          <div className="leg-h"><TrainPill leg={g} k={k} name={name} /></div>
          <ul>
            {g.run.st.slice(g.i, g.j + 1).map((s, q) => {
              const x = g.i + q;
              return <li key={s} className={q === 0 || x === g.j ? "end" : ""}><span className="t">{fmtTime(q === 0 ? g.run.dep[x] : g.run.arr[x])}</span>{name(s)}</li>;
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
