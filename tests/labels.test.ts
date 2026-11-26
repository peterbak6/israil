import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Network } from "../src/data/types";
import { blockAt, labelLines, placeGeographic, placementOrder, schematicLabelRefs, type LabelStyle } from "../src/core/labels";
import { boxesOverlap, type Pt } from "../src/core/geometry";

const net: Network = JSON.parse(readFileSync(new URL("../public/data/network.json", import.meta.url), "utf8"));
const style: LabelStyle = { fs: 10, r: 4.3, lang: "en", measure: (s) => s.length * 5.5 };
const st = new Map(net.stations.map((s) => [s.id, s]));

describe("labelLines", () => {
  it("splits names placed above/below at the first dash", () => {
    const s = { ...st.get("HOD")!, label: "t" as const };
    expect(labelLines(s, "en")).toEqual(["Hod HaSharon", "Sokolov"]);
  });
  it("keeps names placed left/right on one line", () => {
    expect(labelLines({ ...st.get("HOD")!, label: "l" }, "en")).toHaveLength(1);
  });
});

describe("blockAt", () => {
  it("places a left label to the left of the dot, right-aligned", () => {
    const b = blockAt(st.get("LOD")!, 100, 100, "l", style);
    expect(b.box[2]).toBeLessThan(100);
  });
  it("places a right label to the right of the dot", () => {
    const b = blockAt(st.get("LOD")!, 100, 100, "r", style);
    expect(b.box[0]).toBeGreaterThan(100);
  });
});

describe("schematicLabelRefs", () => {
  it("gives every station a reference dot of its own", () => {
    const refs = schematicLabelRefs(net);
    expect(refs.size).toBe(net.stations.length);
    for (const [id, r] of refs) expect(r.copy.startsWith(id + ".")).toBe(true);
  });
});

describe("placeGeographic", () => {
  it("never hides a label, and spread-out stations get non-overlapping labels", () => {
    const pts = new Map<string, Pt>(net.stations.map((s, i) => [s.id, [220 + (i % 6) * 220, 40 + Math.floor(i / 6) * 45]]));
    const out = placeGeographic(st, pts, placementOrder(net), 1400, 600, style);
    expect(out.size).toBe(net.stations.length);
    const boxes = [...out.values()].map((b) => b.box);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(boxesOverlap(boxes[i], boxes[j])).toBe(false);
  });
  it("prefers the left side when it is free", () => {
    const pts = new Map<string, Pt>([["LOD", [400, 200]]]);
    const out = placeGeographic(st, pts, ["LOD"], 800, 400, style);
    expect(out.get("LOD")!.box[2]).toBeLessThan(400);
  });
});

import { placeCities } from "../src/core/labels";
describe("placeCities", () => {
  const measure = (s: string) => s.length * 6;
  it("places bigger places first and leaves out names that would collide", () => {
    const out = placeCities([
      { x: 112, y: 100, text: "Small", city: false, pop: 5000 },
      { x: 104, y: 100, text: "Big", city: false, pop: 200000 },
      { x: 300, y: 300, text: "Capital", city: true, pop: null },
    ], [], 500, 500, 10, measure);
    const names = out.map((o) => ["Small", "Big", "Capital"][o.i]);
    expect(names[0]).toBe("Capital");
    expect(names).toContain("Big");
    expect(names).not.toContain("Small");
  });
  it("avoids station labels and the screen edge, trying the left side", () => {
    const out = placeCities([{ x: 480, y: 50, text: "Edge", city: false, pop: 1 }], [], 500, 500, 10, measure);
    expect(out[0].right).toBe(false);
    expect(placeCities([{ x: 100, y: 100, text: "Hidden", city: false, pop: 1 }], [[0, 0, 500, 500]], 500, 500, 10, measure)).toEqual([]);
  });
});
