import type { Network, Ring, Tracks } from "../data/types";
import type { Leg } from "./journeys";

/**
 * A journey drawn on the map is a chain of pieces. A piece is one segment of a map line (between consecutive
 * stops `seg` and `seg + 1` of that line), ridden forwards or backwards. Where no map line joins two stops a
 * train calls at one after the other, the piece is a straight chord (line = null).
 */
export interface Piece {
  line: string | null;
  seg: number;
  /** true when ridden from stop seg+1 to stop seg */
  rev: boolean;
  from: string;
  to: string;
  /** index of the journey leg */
  leg: number;
}

export interface Route {
  pieces: Piece[];
  /** stations the trains stop at, in riding order (change stations once) */
  stops: string[];
  /** per leg, the map line covering most of the train's stops: the train is drawn in that line's colour */
  legLine: (string | null)[];
}

/** Colours of the 1st, 2nd and 3rd train of a journey, on the map and on the train pills: each train its own
 * colour, so every change is a change of colour. Chosen to differ from each other, not from the map's lines. */
export const TRAIN_COLORS = ["#1f6feb", "#f08c00", "#c2255c"];

type Edge = { to: string; line: string; seg: number; rev: boolean };

/** Shortest paths over the map's line segments, preferring to stay on one line. */
export class NetGraph {
  private adj = new Map<string, Edge[]>();
  private cache = new Map<string, Omit<Piece, "leg">[] | null>();
  private lineStops: Map<string, Set<string>>;
  constructor(net: Network) {
    this.lineStops = new Map(net.lines.filter((l) => !l.inactive).map((l) => [l.id, new Set(l.stops)]));
    for (const l of net.lines)
      for (let i = 0; i + 1 < l.stops.length; i++) {
        const a = l.stops[i], b = l.stops[i + 1];
        this.edges(a).push({ to: b, line: l.id, seg: i, rev: false });
        this.edges(b).push({ to: a, line: l.id, seg: i, rev: true });
      }
  }
  /** The line serving the most of these stations (and the first of them), if any. */
  bestLine(stations: string[]): string | null {
    let best: string | null = null, n = 0;
    for (const [id, set] of this.lineStops) {
      if (!set.has(stations[0])) continue;
      const c = stations.filter((s) => set.has(s)).length;
      if (c > n) { n = c; best = id; }
    }
    return best;
  }
  private edges(k: string) { let e = this.adj.get(k); if (!e) this.adj.set(k, (e = [])); return e; }

  /** Pieces from a to b (fewest segments; a change of line costs a third of a segment). */
  path(a: string, b: string, startLine: string | null = null): Omit<Piece, "leg">[] | null {
    const ck = `${a}|${b}|${startLine}`;
    if (this.cache.has(ck)) return this.cache.get(ck)!;
    type St = { k: string; line: string | null; d: number; prev: St | null; e: Edge | null };
    const done = new Set<string>();
    let open: St[] = [{ k: a, line: startLine, d: 0, prev: null, e: null }], found: St | null = null;
    while (open.length) {
      open.sort((x, y) => x.d - y.d);
      const s = open.shift()!;
      const id = s.k + "|" + s.line;
      if (done.has(id)) continue;
      done.add(id);
      if (s.k === b) { found = s; break; }
      for (const e of this.adj.get(s.k) ?? [])
        open.push({ k: e.to, line: e.line, d: s.d + 1 + (s.line && s.line !== e.line ? 0.34 : 0), prev: s, e });
    }
    let out: Omit<Piece, "leg">[] | null = null;
    if (found) {
      out = [];
      for (let s: St | null = found; s?.e; s = s.prev) out.unshift({ line: s.e.line, seg: s.e.seg, rev: s.e.rev, from: s.prev!.k, to: s.k });
    }
    this.cache.set(ck, out);
    return out;
  }
}

/** Map pieces for a journey's legs: each pair of consecutive stops is joined along the map's lines. */
export function routeOf(g: NetGraph, legs: Leg[]): Route {
  const pieces: Piece[] = [], stops: string[] = [], legLine: (string | null)[] = [];
  let line: string | null = null;
  legs.forEach((leg, li) => {
    const st = leg.run.st.slice(leg.i, leg.j + 1);
    // each train starts on the map line that has most of its stops, so a new train gets its own colour
    line = g.bestLine(st) ?? line;
    legLine.push(g.bestLine(st));
    for (let k = 0; k < st.length; k++) {
      if (k > 0 || li === 0) stops.push(st[k]);
      if (k === 0) continue;
      const p = g.path(st[k - 1], st[k], line);
      if (p) { for (const x of p) pieces.push({ ...x, leg: li }); line = p.at(-1)?.line ?? line; }
      else pieces.push({ line: null, seg: 0, rev: false, from: st[k - 1], to: st[k], leg: li });
    }
  });
  return { pieces, stops, legLine };
}

/**
 * The connection options between two stations, for the map before a trip is picked: every distinct way the listed
 * journeys go (each with its usual change stations), merged into one set of pieces without duplicates.
 * `changes` are the stations where any of them changes train.
 */
export function optionsOf(g: NetGraph, journeysLegs: Leg[][]): Route & { changes: string[] } {
  const pieces = new Map<string, Piece>(), stops = new Set<string>(), changes = new Set<string>();
  for (const legs of journeysLegs) {
    const r = routeOf(g, legs);
    for (const p of r.pieces) {
      const k = p.line ? `${p.line}|${p.seg}` : `chord|${[p.from, p.to].sort().join("|")}`;
      if (!pieces.has(k)) pieces.set(k, { ...p, leg: 0 });
    }
    r.stops.forEach((s) => stops.add(s));
    legs.slice(1).forEach((l) => changes.add(l.run.st[l.i]));
  }
  return { pieces: [...pieces.values()], stops: [...stops], legLine: [], changes: [...changes] };
}

type LonLat = [number, number];

/** A piece's real-world shape, in riding order: station, the OSM track between, station (as the map draws it). */
export function pieceShape(net: Network, tracks: Tracks, p: Piece): LonLat[] {
  const at = (k: string) => { const s = net.stations.find((x) => x.id === k)!; return [s.lon, s.lat] as LonLat; };
  const key = p.from < p.to ? `${p.from}|${p.to}` : `${p.to}|${p.from}`;
  const tr = p.line ? tracks.segments[key] : undefined;
  const mid: Ring = tr ? (p.from < p.to ? tr.c : [...tr.c].reverse()) : [];
  return [at(p.from), ...mid, at(p.to)];
}

export interface Snap {
  /** index into route.pieces */
  piece: number;
  /** 0..1 along the piece by length, in riding order */
  frac: number;
  /** metres from the given position to the route */
  dist: number;
}

/**
 * Nearest point on the route to a position. Lengths use a local flat projection (fine at the scale of a
 * country this size). `frac` is a share of the piece's length, which is how the map's resampled segments are
 * spaced, so the map can place the marker on any blend of schematic and geography.
 * Where a route passes the same track twice, pieces before `from` (the last known piece) count 300 m further away,
 * so the marker doesn't jump back.
 */
export function snapToRoute(shapes: LonLat[][], lon: number, lat: number, from = 0): Snap | null {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  const P = (q: LonLat) => [q[0] * kx, q[1] * ky];
  const [x, y] = P([lon, lat]);
  let best: Snap | null = null;
  shapes.forEach((shape, pi) => {
    const pts = shape.map(P);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum.at(-1)!;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d = Math.hypot(ax + u * dx - x, ay + u * dy - y);
      if (!best || d + (pi < from ? 300 : 0) < best.dist + (best.piece < from ? 300 : 0)) best = { piece: pi, frac: total ? (cum[i - 1] + u * Math.sqrt(l2)) / total : 0, dist: d };
    }
  });
  return best;
}
