import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "../src/core/settings";

describe("parseSettings", () => {
  it("reads valid stored settings", () => {
    expect(parseSettings('{"size":14,"lang":"he","maxChanges":1,"minChange":5}')).toEqual({ size: 14, lang: "he", maxChanges: 1, minChange: 5 });
  });
  it("falls back to defaults for missing, corrupt or out-of-range values", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"size":99,"lang":"fr","maxChanges":3,"minChange":11}')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"minChange":2.5,"maxChanges":"1"}')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"lang":"off"}')).toEqual({ ...DEFAULT_SETTINGS, lang: "off" });
  });
});

import { DEFAULT_PLANNER, isSaved, nextOd, parsePlanner, toggleSaved } from "../src/core/planner";

describe("planner store", () => {
  it("falls back to defaults for missing or invalid values", () => {
    expect(parsePlanner(null)).toEqual(DEFAULT_PLANNER);
    expect(parsePlanner("{oops")).toEqual(DEFAULT_PLANNER);
    expect(parsePlanner(JSON.stringify({ saved: [{ a: "BIN", b: 3 }], journeyT: 7, prefs: { "A>B": ["TAU"], x: [1] } })))
      .toEqual({ saved: [], prefs: { "A>B": ["TAU"] } });
  });
  it("saves a search once for both directions", () => {
    const s = toggleSaved(DEFAULT_PLANNER, { from: "BIN", to: "ASK" });
    expect(isSaved(s, { from: "ASK", to: "BIN" })).toBe(true);
    expect(toggleSaved(s, { from: "ASK", to: "BIN" }).saved).toEqual([]);
  });
  it("fills From, then To, then starts again", () => {
    let od = nextOd({ from: null, to: null }, "BIN");
    expect(od).toEqual({ from: "BIN", to: null });
    od = nextOd(od, "TAU");
    expect(od).toEqual({ from: "BIN", to: "TAU" });
    expect(nextOd(od, "LOD")).toEqual({ from: "LOD", to: null });
    expect(nextOd({ from: null, to: "TAU" }, "BIN")).toEqual({ from: "BIN", to: "TAU" });
  });
});
