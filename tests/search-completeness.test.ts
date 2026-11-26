// Does the planner list every journey it should? Two kinds of test:
//  1. A small hand-made timetable copied from a known real case (Google's answer for Thu 26 Nov 2026:
//     Kfar Yehoshua 15:01 → Hof HaCarmel 15:29, change, train 419 15:43 → Be'er Sheva North 17:56).
//  2. On the real timetable, a brute-force search with no pruning finds every journey with up to 2 changes;
//     each must be matched by a listed journey that is at least as good (leaves no earlier, arrives no later,
//     no more changes). If the search ever drops a journey, this fails.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Timetable, TTrip } from "../src/data/timetable";
import { changeCombos, dayRuns, DEFAULT_SEARCH, planDays, runsOn, searchDay, type Journey, type Run, type SearchOpts } from "../src/core/journeys";
import { addDays, fmtTime, weekday } from "../src/core/time";

const hm = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
/** a trip from "STATION HH:MM" pairs (arrival = departure) */
const trip = (id: string, n: string, s: string, stops: string[]): TTrip =>
  ({ id, n, h: null, s, st: stops.map((x) => { const [k, t] = x.split(" "); return [k, hm(t), hm(t), null]; }) });

describe("runsOn (calendar.txt and calendar_dates.txt)", () => {
  const svc = { days: "1111100", start: "20261125", end: "20261225", add: ["20261128"], remove: ["20261126"] };
  it("follows weekdays and the date range", () => {
    expect(runsOn(svc, "20261125")).toBe(true); // Wednesday
    expect(runsOn(svc, "20261127")).toBe(true); // Friday
    expect(runsOn(svc, "20261129")).toBe(false); // Sunday is off in "1111100" (Mon..Sun)
    expect(runsOn(svc, "20261226")).toBe(false); // after the end
  });
  it("applies removed and added dates", () => {
    expect(runsOn(svc, "20261126")).toBe(false);
    expect(runsOn(svc, "20261128")).toBe(true); // a Saturday, added
  });
  it("handles single-day services", () => {
    expect(runsOn({ days: "0001000", start: "20261126", end: "20261126", add: [], remove: [] }, "20261126")).toBe(true);
    expect(runsOn({ days: "1111100", start: "20261125", end: "20261125", add: [], remove: [] }, "20261126")).toBe(false);
  });
});

describe("reference case: Kfar Yehoshua → Be'er Sheva North, one change in Haifa", () => {
  const D = "20261126";
  const tt: Timetable = {
    feed: { start: "20261125", end: "20261225", generated: "", fields: {} },
    stations: {},
    services: { WD: { days: "1111100", start: "20261125", end: "20261225", add: [], remove: [] } },
    trips: [
      trip("t75", "75", "WD", ["BSH 14:31", "AFU 14:45", "MIG 14:54", "YOK 15:01", "MIF 15:11", "HCE 15:18", "BGA 15:23", "HOF 15:29", "ATL 15:38"]),
      trip("t419", "419", "WD", ["KAR 14:52", "AHI 15:00", "KMO 15:12", "MIF 15:24", "HCE 15:32", "BGA 15:37", "HOF 15:43", "BIN 16:02",
        "HER 16:28", "TAU 16:36", "TAC 16:41", "TAS 16:46", "TAH 16:51", "LOD 17:06", "KGT 17:33", "BSN 17:56", "BSC 18:05"]),
      // a slower alternative with two changes, arriving later
      trip("t121", "121", "WD", ["NAH 14:40", "MIF 15:14", "HCE 15:23", "BGA 15:28", "HOF 15:34", "BIN 15:53", "TAU 16:22", "TAC 16:27"]),
      trip("t655", "655", "WD", ["HER 16:20", "TAU 16:32", "TAC 16:37", "TAS 16:41", "TAH 16:45", "ASK 17:24", "BSN 18:10", "BSC 18:19"]),
    ],
  };
  const js = searchDay(tt, D, "YOK", "BSN");
  const best = js.find((j) => j.dep === hm("15:01") && j.changes === 1);

  it("lists 15:01 → 17:56 with one change", () => {
    expect(best).toBeDefined();
    expect(best!.arr).toBe(hm("17:56"));
    expect(best!.legs.map((g) => g.run.trip.n)).toEqual(["75", "419"]);
  });
  it("offers every Haifa station where the change works", () => {
    expect(changeCombos(best!).map((c) => c[0].station)).toEqual(["MIF", "HCE", "BGA", "HOF"]);
  });
  it("drops the two-change journey that leaves at the same time and arrives later", () => {
    expect(js.some((j) => j.changes === 2)).toBe(false);
  });
});

// ---------- brute force on the real timetable ----------
const tt: Timetable = JSON.parse(readFileSync(new URL("../public/data/timetable.json", import.meta.url), "utf8"));

type Simple = { dep: number; arr: number; changes: number; trains: string };

/** Every journey from a to b leaving on the day, with at most 2 changes and waits of at most WAIT minutes
 * (a bound only to keep the brute force fast; the search itself has none, so it must cover all of these). */
const WAIT = 180;
function bruteForce(runs: Run[], a: string, b: string, opt: SearchOpts = DEFAULT_SEARCH): Simple[] {
  const by = new Map<string, { r: Run; p: number }[]>();
  runs.forEach((r) => r.st.forEach((s, p) => { let x = by.get(s); if (!x) by.set(s, (x = [])); x.push({ r, p }); }));
  const out: Simple[] = [];
  const ok = (arr: number, dep: number) => dep >= arr + opt.minChange && dep <= arr + WAIT;
  for (const { r: r1, p: i } of by.get(a) ?? []) {
    const dep = r1.dep[i];
    if (dep < 0 || dep >= 1440) continue;
    for (let q1 = i + 1; q1 < r1.st.length; q1++) {
      const x = r1.st[q1];
      if (x === b) { out.push({ dep, arr: r1.arr[q1], changes: 0, trains: r1.trip.n! }); break; }
      if (x === a) continue;
      for (const { r: r2, p: p2 } of by.get(x) ?? []) {
        if (r2 === r1 || !ok(r1.arr[q1], r2.dep[p2])) continue;
        for (let q2 = p2 + 1; q2 < r2.st.length; q2++) {
          const y = r2.st[q2];
          if (y === b) { out.push({ dep, arr: r2.arr[q2], changes: 1, trains: `${r1.trip.n}>${r2.trip.n}` }); break; }
          if (y === a) continue;
          for (const { r: r3, p: p3 } of by.get(y) ?? []) {
            if (r3 === r2 || r3 === r1 || !ok(r2.arr[q2], r3.dep[p3])) continue;
            const k = r3.st.indexOf(b, p3 + 1);
            if (k > 0) out.push({ dep, arr: r3.arr[k], changes: 2, trains: `${r1.trip.n}>${r2.trip.n}>${r3.trip.n}` });
          }
        }
      }
    }
  }
  return out.filter((s) => s.changes <= opt.maxChanges);
}

const covered = (s: Simple, list: Journey[]) => list.some((j) => j.changes <= s.changes && j.dep >= s.dep && j.arr <= s.arr);

let weekdayDate = tt.feed.start;
while (weekday(weekdayDate) !== 0) weekdayDate = addDays(weekdayDate, 1); // a Monday
let friday = tt.feed.start;
while (weekday(friday) !== 4) friday = addDays(friday, 1);

describe("today and tomorrow together", () => {
  it.each([["MIF", "BSN"], ["YOK", "BSN"], ["NAH", "DIM"]])("keeps no journey today that one tomorrow beats (%s → %s)", (a, b) => {
    const [today, tomorrow] = planDays(tt, weekdayDate, a, b);
    for (const j of today.journeys)
      expect(tomorrow.journeys.some((k) => k.dep + 1440 >= j.dep && k.arr + 1440 <= j.arr && k.changes <= j.changes)).toBe(false);
  });
});

describe.each([weekdayDate, friday, tt.feed.start])("no journey is missing on %s", (D) => {
  const runs = dayRuns(tt, D);
  it.each([["YOK", "BSN"], ["MIF", "BSN"], ["BIN", "ASK"], ["KAR", "JNA"], ["NAH", "DIM"], ["BSH", "MOD"]])("%s → %s", (a, b) => {
    const list = searchDay(tt, D, a, b);
    const missing = bruteForce(runs, a, b).filter((s) => !covered(s, list));
    expect(missing.map((s) => `${fmtTime(s.dep)}-${fmtTime(s.arr)} ${s.changes} change(s) [${s.trains}]`)).toEqual([]);
  });
});

describe.each([{ maxChanges: 1, minChange: 5 }, { maxChanges: 2, minChange: 8 }, { maxChanges: 0, minChange: 0 }])(
  "no journey is missing with the settings %o",
  (opt) => {
    const runs = dayRuns(tt, weekdayDate);
    it.each([["YOK", "BSN"], ["MIF", "BSN"], ["KAR", "JNA"]])("%s → %s", (a, b) => {
      const list = searchDay(tt, weekdayDate, a, b, opt);
      expect(list.every((j) => j.changes <= opt.maxChanges)).toBe(true);
      for (const j of list)
        for (let k = 1; k < j.legs.length; k++)
          expect(j.legs[k].run.dep[j.legs[k].i] - j.legs[k - 1].run.arr[j.legs[k - 1].j]).toBeGreaterThanOrEqual(opt.minChange);
      const missing = bruteForce(runs, a, b, opt).filter((s) => !covered(s, list));
      expect(missing.map((s) => `${fmtTime(s.dep)}-${fmtTime(s.arr)} ${s.changes} [${s.trains}]`)).toEqual([]);
    });
  },
);

describe("real timetable, normal day: the Karmiel–Be'er Sheva train gives a one-change journey", () => {
  // the first date on which a train numbered 419 runs the full Karmiel → Be'er Sheva route (on 26–27 Nov 2026 it
  // was split at Tel Aviv/Lod for works, so those days must not be used for this check)
  let D: string | null = null;
  for (let d = tt.feed.start; d <= tt.feed.end && !D; d = addDays(d, 1))
    if (tt.trips.some((t) => t.n === "419" && t.st[0][0] === "KAR" && t.st.some((x) => x[0] === "BSN") && runsOn(tt.services[t.s], d))) D = d;

  it("finds such a day in the feed", () => expect(D).not.toBeNull());
  it("lists Kfar Yehoshua → Be'er Sheva North with one change onto 419, changing in Haifa", () => {
    const js = searchDay(tt, D!, "YOK", "BSN");
    const j = js.find((x) => x.changes === 1 && x.legs[1].run.trip.n === "419");
    expect(j).toBeDefined();
    expect(changeCombos(j!).map((c) => c[0].station)).toContain("HOF");
  });
});
