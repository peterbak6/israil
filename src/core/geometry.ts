import { geoTransverseMercator } from "d3-geo";

export type Pt = [number, number];

/** Linear interpolation between two points. Every dot moves on a straight line in pixel space. */
export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Transverse Mercator centred on Israel (the central meridian of the Israeli TM grid). y points down. */
const tm = geoTransverseMercator().rotate([-35.2044, -31.7344]).scale(1).translate([0, 0]);
export const project = (lon: number, lat: number): Pt => tm([lon, lat]) as Pt;

/** Returns a function that fits points into a w×h box with padding, preserving aspect ratio. */
export function fitter(pts: Pt[], w: number, h: number, padY = 28): (p: Pt) => Pt {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padX = Math.max(padY, Math.min(90, w * 0.14)); // room for labels at the sides
  const k = Math.min((w - 2 * padX) / (x1 - x0 || 1), (h - 2 * padY) / (y1 - y0 || 1));
  const ox = (w - k * (x1 - x0)) / 2, oy = (h - k * (y1 - y0)) / 2;
  return (p) => [ox + (p[0] - x0) * k, oy + (p[1] - y0) * k];
}

export type Box = [number, number, number, number]; // x0, y0, x1, y1
export const boxesOverlap = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** Cubic ease-in-out, used only for timing the Play animation. */
export const easeInOut = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);
