import { describe, expect, it } from "vitest";
import { easeInOut, fitter, lerp, project } from "../src/core/geometry";

describe("geometry", () => {
  it("interpolates linearly", () => {
    expect(lerp([0, 0], [10, 20], 0.25)).toEqual([2.5, 5]);
  });
  it("fits points inside the box", () => {
    const f = fitter([[0, 0], [10, 50]], 400, 600);
    for (const p of [[0, 0], [10, 50]] as [number, number][]) {
      const [x, y] = f(p);
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(400);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(600);
    }
  });
  it("projects north up (y grows southwards) and east right", () => {
    const nahariya = project(35.0987, 33.0051), beersheva = project(34.7985, 31.2429);
    expect(nahariya[1]).toBeLessThan(beersheva[1]);
    expect(project(35.5, 32)[0]).toBeGreaterThan(project(34.8, 32)[0]);
  });
  it("eases from 0 to 1", () => {
    expect(easeInOut(0)).toBe(0); expect(easeInOut(1)).toBe(1); expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });
});

import { resample } from "../src/core/geometry";
describe("resample", () => {
  it("returns n evenly spaced points, keeping both ends", () => {
    const r = resample([[0, 0], [10, 0], [10, 10]], 5);
    expect(r).toHaveLength(5);
    expect(r[0]).toEqual([0, 0]);
    expect(r[4]).toEqual([10, 10]);
    expect(r[2]).toEqual([10, 0]); // halfway along the 20-unit path
  });
  it("handles a straight two-point line", () => {
    const r = resample([[0, 0], [6, 8]], 3);
    expect(r[1]).toEqual([3, 4]);
  });
});

describe("fitter top inset", () => {
  it("keeps points below the reserved top area", () => {
    const f = fitter([[0, 0], [10, 50]], 400, 600, 28, 56);
    expect(f([0, 0])[1]).toBeGreaterThanOrEqual(56 + 28 - 1e-9);
    expect(f([10, 50])[1]).toBeLessThanOrEqual(600 - 28 + 1e-9);
  });
});
