import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Timetable } from "../src/data/timetable";
import { changeCombos, dayRuns, legsVia, MIN_CHANGE, pareto, preferredCombo, comboWith, searchDay, type Journey } from "../src/core/journeys";
import { addDays, fmtDur, fmtTime, israelNow, weekday } from "../src/core/time";

const tt: Timetable = JSON.parse(readFileSync(new URL("../public/data/timetable.json", import.meta.url), "utf8"));
// a weekday inside the feed: the first Thursday on or after the feed start
let THU = tt.feed.start;
while (weekday(THU) !== 3) THU = addDays(THU, 1);

const stationsOf = (j: Journey) => j.legs.map((g) => [g.run.st[g.i], g.run.st[g.j]]);

function checkValid(j: Journey, from: string, to: string) {
  expect(j.legs[0].run.st[j.legs[0].i]).toBe(from);
  expect(j.legs.at(-1)!.run.st[j.legs.at(-1)!.j]).toBe(to);
  for (const g of j.legs) expect(g.j).toBeGreaterThan(g.i);
  for (let k = 1; k < j.legs.length; k++) {
    const a = j.legs[k - 1], b = j.legs[k];
    expect(a.run.st[a.j]).toBe(b.run.st[b.i]); // change at the same station
    expect(b.run.dep[b.i]).toBeGreaterThanOrEqual(a.run.arr[a.j] + MIN_CHANGE);
  }
  expect(j.dep).toBe(j.legs[0].run.dep[j.legs[0].i]);
  expect(j.arr).toBe(j.legs.at(-1)!.run.arr[j.legs.at(-1)!.j]);
}

describe("time", () => {
  it("formats times and durations", () => {
    expect(fmtTime(487)).toBe("08:07");
    expect(fmtTime(1510)).toBe("01:10");
    expect(fmtDur(41)).toBe("41 min");
    expect(fmtDur(65)).toBe("1 h 05 min");
  });
  it("uses Israel time", () => {
    // 2026-11-25 22:30 UTC is 00:30 on the 26th in Israel (UTC+2 in winter)
    const n = israelNow(new Date(Date.UTC(2026, 10, 25, 22, 30)));
    expect(n.date).toBe("20261126");
    expect(Math.round(n.min)).toBe(30);
  });
  it("adds days and finds weekdays (Mon = 0)", () => {
    expect(addDays("20261231", 1)).toBe("20270101");
    expect(weekday("20261126")).toBe(3); // Thursday
  });
});

describe("searchDay", () => {
  it("finds direct trains with valid times", () => {
    const js = searchDay(tt, THU, "BIN", "TAU");
    expect(js.length).toBeGreaterThan(10);
    for (const j of js) checkValid(j, "BIN", "TAU");
    expect(js.some((j) => j.changes === 0)).toBe(true);
    // sorted by departure, all leaving within the day
    for (let k = 1; k < js.length; k++) expect(js[k].dep).toBeGreaterThanOrEqual(js[k - 1].dep);
    expect(js.every((j) => j.dep >= 0 && j.dep < 1440)).toBe(true);
  });

  it("changes trains when no train runs through", () => {
    const js = searchDay(tt, THU, "KAR", "JNA");
    expect(js.length).toBeGreaterThan(0);
    for (const j of js) { checkValid(j, "KAR", "JNA"); expect(j.changes).toBeGreaterThan(0); }
  });

  it("keeps only Pareto-optimal journeys", () => {
    const js = searchDay(tt, THU, "NAH", "BSC");
    for (const j of js) checkValid(j, "NAH", "BSC");
    for (const a of js)
      for (const b of js)
        if (a !== b) expect(b.dep >= a.dep && b.arr <= a.arr && b.changes <= a.changes && (b.dep > a.dep || b.arr < a.arr || b.changes < a.changes)).toBe(false);
  });

  it("finds nothing for the same station or on a day without trains between them", () => {
    expect(searchDay(tt, THU, "LOD", "LOD")).toEqual([]);
  });

  it("places trains after midnight on the next day's timeline", () => {
    const runs = dayRuns(tt, THU);
    expect(runs.some((r) => r.dep[0] < 0 || r.arr.at(-1)! > 1440)).toBe(true);
  });
});

describe("pareto", () => {
  const j = (dep: number, arr: number, changes: number, key: string) => ({ legs: [], dep, arr, changes, key }) as Journey;
  it("drops dominated journeys and duplicates", () => {
    const out = pareto([j(480, 540, 1, "a"), j(490, 530, 0, "b"), j(495, 560, 0, "c"), j(500, 525, 2, "d"), j(500, 525, 2, "e")]);
    expect(out.map((x) => x.key)).toEqual(["b", "c", "d"]);
  });
});

describe("change stations", () => {
  const js = searchDay(tt, THU, "BIN", "ASK").filter((j) => j.changes === 1);
  it("lists every feasible change station in riding order", () => {
    expect(js.length).toBeGreaterThan(0);
    for (const j of js) {
      const combos = changeCombos(j);
      expect(combos.length).toBeGreaterThan(0);
      // the search's own change is one of them
      expect(combos.map((c) => c[0].station)).toContain(j.legs[0].run.st[j.legs[0].j]);
      for (const c of combos) {
        expect(c[0].dep).toBeGreaterThanOrEqual(c[0].arr + MIN_CHANGE);
        const legs = legsVia(j, c);
        checkValid({ ...j, legs }, "BIN", "ASK");
        expect(stationsOf({ ...j, legs })[0][1]).toBe(c[0].station);
      }
    }
  });

  it("prefers the stations chosen before and keeps other choices when one slot changes", () => {
    const combos = [[{ station: "A", arr: 0, dep: 1 }, { station: "X", arr: 2, dep: 3 }],
      [{ station: "B", arr: 0, dep: 1 }, { station: "X", arr: 2, dep: 3 }],
      [{ station: "B", arr: 0, dep: 1 }, { station: "Y", arr: 2, dep: 3 }]];
    expect(preferredCombo(combos, undefined)).toBe(0);
    expect(preferredCombo(combos, ["B", "Y"])).toBe(2);
    expect(comboWith(combos, 0, 0, "B")).toBe(1); // keeps X
  });
});
