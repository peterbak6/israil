import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Network } from "../src/data/types";
import { findTrips, legStations, nextSelection } from "../src/core/routing";

const net: Network = JSON.parse(readFileSync(new URL("../public/data/network.json", import.meta.url), "utf8"));
const names = (o: ReturnType<typeof findTrips>[number]) => o.legs.map((g) => g.line.id);

describe("findTrips", () => {
  it("finds direct lines", () => {
    const opts = findTrips(net, "HER", "BSC");
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.legs.length === 1)).toBe(true);
    expect(opts.map((o) => o.legs[0].line.id).sort()).toEqual(["green", "orange"]);
  });

  it("uses one transfer when no line connects both stations", () => {
    const opts = findTrips(net, "KAR", "JNA");
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.legs).toHaveLength(2);
      expect(o.legs[0].to).toBe(o.legs[1].from);
    }
  });

  it("uses two transfers when needed", () => {
    const opts = findTrips(net, "BSH", "DIM");
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.legs.length === 3)).toBe(true);
    expect(opts.every((o) => names(o)[0] === "orchid" && names(o)[2] === "brown")).toBe(true);
  });

  it("ignores lines that are not in service", () => {
    const opts = findTrips(net, "BSM", "JMA");
    expect(opts.flatMap((o) => o.legs).some((g) => g.line.inactive)).toBe(false);
  });

  it("returns nothing for the same station", () => {
    expect(findTrips(net, "LOD", "LOD")).toEqual([]);
  });
});

describe("legStations", () => {
  it("lists stations in riding order, in either direction", () => {
    const line = net.lines.find((l) => l.id === "brown")!;
    expect(legStations({ line, from: "DIM", to: "BSN" })).toEqual(["DIM", "BSN"]);
    expect(legStations({ line, from: "BSN", to: "DIM" })).toEqual(["BSN", "DIM"]);
  });
});

describe("nextSelection", () => {
  it("picks origin, destination, then starts over", () => {
    expect(nextSelection([], "A")).toEqual(["A"]);
    expect(nextSelection(["A"], "B")).toEqual(["A", "B"]);
    expect(nextSelection(["A", "B"], "C")).toEqual(["C"]);
    expect(nextSelection(["A"], "A")).toEqual(["A"]);
  });
});
