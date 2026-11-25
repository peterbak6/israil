import type { Line, Network } from "../data/types";

/** One ride: line, boarding station, alighting station. */
export type Leg = { line: Line; from: string; to: string };
export type TripOption = { legs: Leg[]; stops: number };

const idx = (l: Line, k: string) => l.stops.indexOf(k);
const span = (l: Line, a: string, b: string) => Math.abs(idx(l, a) - idx(l, b));

/**
 * Ways to travel between two stations with the fewest transfers (0, 1 or 2), using the lines as
 * drawn on the map. For each combination of lines the transfer station giving the fewest stops is
 * used; options with clearly more stops than the best one are dropped.
 * Lines marked inactive (not in service) are ignored. Counts stops, not travel time.
 */
export function findTrips(net: Network, from: string, to: string): TripOption[] {
  if (from === to) return [];
  const active = net.lines.filter((l) => !l.inactive);
  const at = (k: string) => active.filter((l) => l.stops.includes(k));
  let opts: TripOption[] = at(from)
    .filter((l) => l.stops.includes(to))
    .map((l) => ({ legs: [{ line: l, from, to }], stops: span(l, from, to) }));

  if (!opts.length)
    for (const l1 of at(from))
      for (const l2 of at(to)) {
        if (l1 === l2) continue;
        let best: TripOption | null = null;
        for (const t of l1.stops)
          if (t !== from && t !== to && l2.stops.includes(t)) {
            const n = span(l1, from, t) + span(l2, t, to);
            if (!best || n < best.stops) best = { legs: [{ line: l1, from, to: t }, { line: l2, from: t, to }], stops: n };
          }
        if (best) opts.push(best);
      }

  if (!opts.length)
    for (const l1 of at(from))
      for (const l3 of at(to))
        for (const l2 of active) {
          if (l2 === l1 || l2 === l3 || l1 === l3) continue;
          let best: TripOption | null = null;
          for (const t1 of l1.stops)
            if (t1 !== from && l2.stops.includes(t1))
              for (const t2 of l2.stops)
                if (t2 !== t1 && t2 !== to && l3.stops.includes(t2)) {
                  const n = span(l1, from, t1) + span(l2, t1, t2) + span(l3, t2, to);
                  if (!best || n < best.stops)
                    best = { legs: [{ line: l1, from, to: t1 }, { line: l2, from: t1, to: t2 }, { line: l3, from: t2, to }], stops: n };
                }
          if (best) opts.push(best);
        }

  if (!opts.length) return [];
  const min = Math.min(...opts.map((o) => o.stops));
  return opts.filter((o) => o.stops <= min * 1.25 + 2).sort((a, b) => a.stops - b.stops);
}

/** Stations of a leg, in riding order. */
export function legStations(leg: Leg): string[] {
  const i = idx(leg.line, leg.from), j = idx(leg.line, leg.to);
  const ks = leg.line.stops.slice(Math.min(i, j), Math.max(i, j) + 1);
  return i <= j ? ks : ks.reverse();
}

/** Clicking stations: first click = origin, second = destination, a third starts over. */
export function nextSelection(sel: string[], station: string): string[] {
  if (sel.length >= 2 || sel[0] === station) return [station];
  return [...sel, station];
}
