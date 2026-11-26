import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Network, Tracks } from "../src/data/types";
import type { Timetable } from "../src/data/timetable";
import { changeCombos, legsVia, searchDay } from "../src/core/journeys";
import { NetGraph, optionsOf, pieceShape, pointAlong, routeOf, snapToRoute } from "../src/core/route";

const read = (f: string) => JSON.parse(readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const net: Network = read("network.json"), tracks: Tracks = read("tracks.json"), tt: Timetable = read("timetable.json");
const g = new NetGraph(net);

describe("NetGraph.path", () => {
  it("joins consecutive stations along one line", () => {
    const p = g.path("BIN", "TAU")!;
    expect(p[0].from).toBe("BIN");
    expect(p.at(-1)!.to).toBe("TAU");
    for (let k = 1; k < p.length; k++) expect(p[k].from).toBe(p[k - 1].to);
    expect(new Set(p.map((x) => x.line)).size).toBe(1); // no needless line switches
  });
  it("returns pieces that match the map's segments", () => {
    for (const x of g.path("NAH", "BSC")!) {
      const l = net.lines.find((l) => l.id === x.line)!;
      const [a, b] = [l.stops[x.seg], l.stops[x.seg + 1]];
      expect(x.rev ? [b, a] : [a, b]).toEqual([x.from, x.to]);
    }
  });
});

describe("routeOf", () => {
  const js = searchDay(tt, "20261126", "BIN", "ASK").filter((j) => j.changes === 1);
  const j = js[0], combo = changeCombos(j)[0], legs = legsVia(j, combo);
  const r = routeOf(g, legs);
  it("covers every stop, in order, from origin to destination", () => {
    expect(r.stops[0]).toBe("BIN");
    expect(r.stops.at(-1)).toBe("ASK");
    expect(r.stops).toContain(combo[0].station);
    expect(r.pieces[0].from).toBe("BIN");
    expect(r.pieces.at(-1)!.to).toBe("ASK");
    for (let k = 1; k < r.pieces.length; k++) expect(r.pieces[k].from).toBe(r.pieces[k - 1].to);
    expect(r.pieces.some((p) => p.line === null)).toBe(false);
  });
  it("snaps a station's position to the route at that station", () => {
    const shapes = r.pieces.map((p) => pieceShape(net, tracks, p));
    const s = net.stations.find((x) => x.id === combo[0].station)!;
    const snap = snapToRoute(shapes, s.lon, s.lat)!;
    expect(snap.dist).toBeLessThan(5);
    const p = r.pieces[snap.piece];
    expect(snap.frac < 0.01 ? p.from : snap.frac > 0.99 ? p.to : null).toBe(s.id);
    // a point 2 km off the line is reported as 2 km away
    const off = snapToRoute(shapes, s.lon + 2000 / (111320 * Math.cos((s.lat * Math.PI) / 180)), s.lat)!;
    expect(off.dist).toBeGreaterThan(500);
  });
});

describe("optionsOf", () => {
  const js = searchDay(tt, "20261126", "YOK", "BSN");
  const all = js.map((j) => legsVia(j, changeCombos(j)[0]));
  const o = optionsOf(g, all);
  it("contains every piece of every listed journey, once", () => {
    const key = (p: { line: string | null; seg: number }) => `${p.line}|${p.seg}`;
    const have = new Set(o.pieces.map(key));
    expect(have.size).toBe(o.pieces.length);
    for (const legs of all) for (const p of routeOf(g, legs).pieces) expect(have.has(key(p))).toBe(true);
  });
  it("lists the change stations of all options", () => {
    for (const legs of all) for (const l of legs.slice(1)) expect(o.changes).toContain(l.run.st[l.i]);
  });
});

describe("pointAlong (demo simulation)", () => {
  const shapes: [number, number][][] = [[[34.8, 32.0], [34.8, 32.1]], [[34.8, 32.1], [34.8, 32.3]]];
  it("starts at the origin, ends at the destination, and moves by length", () => {
    expect(pointAlong(shapes, 0)).toEqual([34.8, 32.0]);
    expect(pointAlong(shapes, 1)[1]).toBeCloseTo(32.3, 6);
    expect(pointAlong(shapes, 0.5)[1]).toBeCloseTo(32.15, 6);
  });
  it("snaps back onto the route at increasing pieces", () => {
    const s1 = snapToRoute(shapes, ...pointAlong(shapes, 0.2))!, s2 = snapToRoute(shapes, ...pointAlong(shapes, 0.8))!;
    expect(s1.piece).toBe(0);
    expect(s2.piece).toBe(1);
  });
});
