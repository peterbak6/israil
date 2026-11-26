import type { Timetable, TService, TTrip } from "../data/timetable";
import { addDays, weekday, type Ymd } from "./time";

/** Minutes needed between arriving and departing at a change station, by default. 0 on purpose: without platform
 * data the app can't judge whether a change is feasible, so it lists every connection and shows the change time.
 * The user can raise it in the settings. */
export const MIN_CHANGE = 0;
/** Most changes in one journey, by default (the user can lower it in the settings). */
export const MAX_CHANGES = 2;

/** Search settings chosen by the user. A fixed extra margin at every change keeps the search's pruning exact. */
export interface SearchOpts { maxChanges: number; minChange: number }
export const DEFAULT_SEARCH: SearchOpts = { maxChanges: MAX_CHANGES, minChange: MIN_CHANGE };

export function runsOn(s: TService, ymd: Ymd): boolean {
  if (s.remove.includes(ymd)) return false;
  if (s.add.includes(ymd)) return true;
  return ymd >= s.start && ymd <= s.end && s.days[weekday(ymd)] === "1";
}

/** Is the timetable valid for this date? (The feed covers a few weeks ahead.) */
export const feedCovers = (tt: Timetable, ymd: Ymd) => ymd >= tt.feed.start && ymd <= tt.feed.end;

/** One train run placed on the timeline of a service day: times are minutes after midnight of that day, so
 * yesterday's trains after midnight have small times and tomorrow's have times past 1440. */
export interface Run {
  trip: TTrip;
  st: string[];
  arr: number[];
  dep: number[];
}

/** Runs that can be part of a journey on day `ymd`: that day's trains plus the neighbouring days', shifted. */
export function dayRuns(tt: Timetable, ymd: Ymd): Run[] {
  const out: Run[] = [];
  for (const o of [-1, 0, 1]) {
    const date = addDays(ymd, o), off = o * 1440;
    for (const trip of tt.trips) {
      if (!runsOn(tt.services[trip.s], date)) continue;
      const arr = trip.st.map((x) => x[1] + off), dep = trip.st.map((x) => x[2] + off);
      if (arr[arr.length - 1] < 0) continue;
      out.push({ trip, st: trip.st.map((x) => x[0]), arr, dep });
    }
  }
  return out;
}

/** Board `run` at stop index i, get off at stop index j. */
export interface Leg { run: Run; i: number; j: number }

export interface Journey {
  legs: Leg[];
  dep: number;
  arr: number;
  changes: number;
  /** identifies the train sequence (the change stations may still vary) */
  key: string;
}

type Entry = { run: Run; p: number; dep: number };
type Label = { arr: number; run: Run; i: number; j: number; prev: Label | null };

function index(runs: Run[]): Map<string, Entry[]> {
  const by = new Map<string, Entry[]>();
  for (const run of runs)
    run.st.forEach((s, p) => {
      if (p === run.st.length - 1) return; // can't board at the last stop
      let a = by.get(s);
      if (!a) by.set(s, (a = []));
      a.push({ run, p, dep: run.dep[p] });
    });
  for (const a of by.values()) a.sort((x, y) => x.dep - y.dep);
  return by;
}

const firstAtOrAfter = (a: Entry[], t: number) => {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].dep < t) lo = m + 1; else hi = m; }
  return lo;
};

function toJourney(l: Label): Journey {
  const legs: Leg[] = [];
  for (let x: Label | null = l; x; x = x.prev) legs.unshift({ run: x.run, i: x.i, j: x.j });
  return {
    legs, dep: legs[0].run.dep[legs[0].i], arr: l.arr, changes: legs.length - 1,
    key: legs.map((g) => g.run.trip.id + "@" + g.run.dep[0]).join(">"),
  };
}

/**
 * All journeys from `from` to `to` that leave `from` on service day `ymd` (00:00 to 24:00), with at most
 * MAX_CHANGES changes, keeping only Pareto-optimal ones (see `pareto`).
 *
 * For every train that can be boarded at `from`, a round-based search in the style of RAPTOR finds the earliest
 * arrival with 0, 1 and 2 changes: round 1 rides that train; each further round boards, at every station whose
 * arrival improved in the previous round, every later train (until the best arrival at the destination so far).
 * A station's arrival only counts if it beats the best arrival there so far. This pruning is exact only because
 * waiting is unlimited: with a cap on waiting, arriving later at a station could open up a train that arriving
 * earlier could not, and journeys would be lost (tests/search-completeness.test.ts checks this by brute force).
 */
export function searchDay(tt: Timetable, ymd: Ymd, from: string, to: string, opt: SearchOpts = DEFAULT_SEARCH): Journey[] {
  if (from === to) return [];
  return searchRuns(dayRuns(tt, ymd), from, to, 0, 1440, opt);
}

export function searchRuns(runs: Run[], from: string, to: string, t0: number, t1: number, opt: SearchOpts = DEFAULT_SEARCH): Journey[] {
  const by = index(runs), found: Journey[] = [];
  for (const e of by.get(from) ?? []) {
    if (e.dep < t0 || e.dep >= t1) continue;
    const best = new Map<string, number>([[from, -Infinity]]);
    // no journey takes more than a day; a fixed horizon (not one relative to each arrival) keeps the pruning exact
    const horizon = e.dep + 1440;
    let marked = new Map<string, Label>(), destBest = Infinity;
    for (let q = e.p + 1; q < e.run.st.length; q++) {
      const s = e.run.st[q];
      if (best.has(s)) continue; // a train passing a station twice: keep the first visit
      const l: Label = { arr: e.run.arr[q], run: e.run, i: e.p, j: q, prev: null };
      best.set(s, l.arr);
      marked.set(s, l);
    }
    if (marked.has(to)) { const l = marked.get(to)!; found.push(toJourney(l)); destBest = l.arr; }
    for (let round = 1; round <= opt.maxChanges && marked.size; round++) {
      const next = new Map<string, Label>();
      for (const [x, lab] of marked) {
        if (x === to) continue;
        const es = by.get(x) ?? [];
        for (let k = firstAtOrAfter(es, lab.arr + opt.minChange); k < es.length && es[k].dep < Math.min(destBest, horizon); k++) {
          const e2 = es[k];
          if (e2.run === lab.run) continue;
          for (let q = e2.p + 1; q < e2.run.st.length; q++) {
            const a = e2.run.arr[q];
            if (a >= destBest) break;
            const s = e2.run.st[q];
            if (a < (best.get(s) ?? Infinity)) {
              best.set(s, a);
              next.set(s, { arr: a, run: e2.run, i: e2.p, j: q, prev: lab });
            }
          }
        }
      }
      if (next.has(to)) { const l = next.get(to)!; found.push(toJourney(l)); destBest = l.arr; }
      marked = next;
    }
  }
  return pareto(found);
}

/**
 * Keep a journey only if no other journey leaves at the same time or later, arrives at the same time or earlier
 * and has no more changes. This drops slow detours and trains you would only take to wait somewhere.
 * Sorted by departure, then arrival.
 */
export function pareto(js: Journey[]): Journey[] {
  const uniq = [...new Map(js.map((j) => [j.key, j])).values()];
  const keep = uniq.filter((j) => !uniq.some((k) => k !== j &&
    k.dep >= j.dep && k.arr <= j.arr && k.changes <= j.changes &&
    (k.dep > j.dep || k.arr < j.arr || k.changes < j.changes)));
  // identical times and changes on different trains: keep the first only
  const seen = new Set<string>();
  return keep
    .sort((a, b) => a.dep - b.dep || a.arr - b.arr || a.changes - b.changes)
    .filter((j) => { const k = `${j.dep}|${j.arr}|${j.changes}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** One possible change between two consecutive trains of a journey. */
export interface Change { station: string; arr: number; dep: number }

/**
 * Every combination of change stations that works for the journey's trains: at each change the first train must
 * reach the station before the next one leaves it (with MIN_CHANGE minutes), and the stations must come in riding
 * order. Combinations are in riding order, so the first one changes as early as possible.
 */
export function changeCombos(j: Journey, minChange = MIN_CHANGE): Change[][] {
  const runs = j.legs.map((g) => g.run);
  const from = runs[0].st[j.legs[0].i], to = runs[runs.length - 1].st[j.legs[j.legs.length - 1].j];
  const out: Change[][] = [];
  const walk = (k: number, b: number, acc: Change[]) => {
    const r = runs[k];
    if (k === runs.length - 1) { if (r.st.indexOf(to, b + 1) > b) out.push(acc); return; }
    const n = runs[k + 1];
    for (let q = b + 1; q < r.st.length; q++) {
      const s = r.st[q];
      if (s === from || s === to) continue;
      const p = n.st.indexOf(s);
      if (p < 0 || p === n.st.length - 1 || r.arr[q] + minChange > n.dep[p]) continue;
      walk(k + 1, p, [...acc, { station: s, arr: r.arr[q], dep: n.dep[p] }]);
    }
  };
  walk(0, j.legs[0].i, []);
  return out;
}

/** The journey's legs when changing at the given stations. */
export function legsVia(j: Journey, changes: Change[]): Leg[] {
  const runs = j.legs.map((g) => g.run);
  const to = runs[runs.length - 1].st[j.legs[j.legs.length - 1].j];
  const legs: Leg[] = [];
  let i = j.legs[0].i;
  runs.forEach((r, k) => {
    const stop = k < changes.length ? changes[k].station : to;
    const jj = r.st.indexOf(stop, i + 1);
    legs.push({ run: r, i, j: jj });
    if (k < changes.length) i = runs[k + 1].st.indexOf(stop);
  });
  return legs;
}

/** Pick the combination that best matches the stations the user chose before (in any slot); else the first. */
export function preferredCombo(combos: Change[][], pref: string[] | undefined): number {
  if (!pref?.length || !combos.length) return 0;
  let bestI = 0, bestN = -1;
  combos.forEach((c, i) => {
    const n = c.filter((x, k) => pref[k] === x.station).length;
    if (n > bestN) { bestN = n; bestI = i; }
  });
  return bestI;
}

/** After picking `station` for change slot `slot`, the combination that keeps as many other choices as possible. */
export function comboWith(combos: Change[][], current: number, slot: number, station: string): number {
  const cur = combos[current] ?? [];
  let bestI = current, bestN = -1;
  combos.forEach((c, i) => {
    if (c[slot]?.station !== station) return;
    const n = c.filter((x, k) => cur[k]?.station === x.station).length;
    if (n > bestN) { bestN = n; bestI = i; }
  });
  return bestI;
}

/** The last stop of a train: its destination, as shown on station boards. */
export const destination = (r: Run) => r.st[r.st.length - 1];

export interface PlanDay { ymd: Ymd; covered: boolean; journeys: Journey[] }

/**
 * Journeys for today and tomorrow (only for days the timetable covers). Today's journeys are also checked
 * against tomorrow's: one that only gets there by waiting overnight (e.g. 23:14 → 08:44) is dropped when a
 * journey tomorrow morning arrives as early with no more changes.
 */
export function planDays(tt: Timetable, today: Ymd, from: string, to: string, opt: SearchOpts = DEFAULT_SEARCH): PlanDay[] {
  const days = [today, addDays(today, 1)].map((ymd) =>
    feedCovers(tt, ymd) ? { ymd, covered: true, journeys: searchDay(tt, ymd, from, to, opt) } : { ymd, covered: false, journeys: [] });
  const next = days[1].journeys.map((k) => ({ dep: k.dep + 1440, arr: k.arr + 1440, changes: k.changes }));
  days[0].journeys = days[0].journeys.filter((j) => !next.some((k) => k.dep >= j.dep && k.arr <= j.arr && k.changes <= j.changes));
  return days;
}
