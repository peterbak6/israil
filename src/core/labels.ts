import type { Copy, LabelMode, Lang, Network, Station } from "../data/types";
import { boxesOverlap, type Box, type Pt } from "./geometry";

export type Measure = (text: string) => number;
export type LabelBlock = { pos: Pt[]; box: Box };
export type LabelStyle = { fs: number; r: number; measure: Measure; lang: Lang };

const SPLIT_MODES: LabelMode[] = ["t", "b", "bl"];

/** Label text as lines. Names placed above/below a dot on the map are split onto two lines (at the
 * first dash, else the last space), as the map does. The same lines are used at every slider position. */
export function labelLines(s: Station, lang: Lang): string[] {
  const txt = lang === "he" ? s.name_he : s.name;
  if (!SPLIT_MODES.includes(s.label)) return [txt];
  let parts = txt.split(/\s*[–-]\s*(.*)/s).filter(Boolean);
  const i = txt.lastIndexOf(" ");
  if (parts.length === 1 && txt.length > 10 && i > 0) parts = [txt.slice(0, i), txt.slice(i + 1)];
  return parts;
}

/** Lay out a label block next to point (x, y). Returns each line's left x and baseline y, and the box. */
export function blockAt(s: Station, x: number, y: number, mode: LabelMode, st: LabelStyle): LabelBlock {
  const { fs, r, measure, lang } = st;
  const ls = labelLines(s, lang), ws = ls.map(measure), n = ls.length;
  const g = r + 4, lh = fs * 1.1, bw = Math.max(...ws), bh = (n - 1) * lh;
  const mid = y + fs * 0.35 - bh / 2, below = y + g + fs * 0.8;
  const [ax, align, first]: [number, number, number] = {
    l: [x - g, 1, mid], lr: [x - g, 1, mid], r: [x + g, 0, mid],
    t: [x, 0.5, y - g - bh], b: [x, 0.5, below], bl: [x + r, 1, below],
  }[mode] as [number, number, number];
  const pos = ws.map((w, i): Pt => [ax - w * align, first + i * lh]);
  const x0 = ax - bw * align;
  return { pos, box: [x0 - 1, first - fs * 0.8 - 1, x0 + bw + 1, first + bh + fs * 0.25 + 1] };
}

/** True if the dot has a neighbour (previous/next stop on its line, or another dot of its station)
 * both to its left and to its right, more sideways than vertical. Such labels are centred below. */
function centred(net: Network, c: Copy, same: Copy[]): boolean {
  const line = net.lines.find((l) => l.id === c.line)!;
  const i = line.stops.indexOf(c.station);
  const byId = new Map(net.copies.map((x) => [x.id, x]));
  const nb = [line.stops[i - 1], line.stops[i + 1]]
    .filter(Boolean)
    .map((k) => byId.get(`${k}.${c.line}`)!)
    .concat(same.filter((o) => o !== c));
  const side = nb.filter((o) => Math.abs(o.sx - c.sx) > Math.abs(o.sy - c.sy)).map((o) => Math.sign(o.sx - c.sx));
  return side.includes(-1) && side.includes(1);
}

/** For each station: the dot its schematic label is attached to, and the label mode. */
export function schematicLabelRefs(net: Network): Map<string, { copy: string; mode: LabelMode }> {
  const out = new Map<string, { copy: string; mode: LabelMode }>();
  for (const s of net.stations) {
    const cs = net.copies.filter((c) => c.station === s.id);
    const key: Record<LabelMode, (c: Copy) => number> = {
      l: (c) => c.sx, bl: (c) => c.sx, r: (c) => -c.sx, lr: (c) => -c.sx, t: (c) => c.sy, b: (c) => -c.sy,
    };
    const ref = cs.reduce((a, c) => (key[s.label](c) < key[s.label](a) ? c : a));
    const mode: LabelMode = centred(net, ref, cs) ? (s.label === "t" ? "t" : "b") : s.label;
    out.set(s.id, { copy: ref.id, mode });
  }
  return out;
}

/** Fixed placement order: stations with most lines first, then north to south. */
export function placementOrder(net: Network): string[] {
  const n = (id: string) => net.copies.filter((c) => c.station === id).length;
  const lat = new Map(net.stations.map((s) => [s.id, s.lat]));
  return net.stations.map((s) => s.id).sort((a, b) => n(b) - n(a) || lat.get(b)! - lat.get(a)!);
}

/**
 * Geographic label placement. Each label tries left, above, below, then right, and takes the first
 * position that avoids other labels, the centres of other stations' dots and the screen edge. Lines
 * may be crossed. If every position collides, the least-colliding one is used: labels are never hidden.
 */
export function placeGeographic(
  stations: Map<string, Station>, pts: Map<string, Pt>, order: string[], w: number, h: number, st: LabelStyle,
): Map<string, LabelBlock> {
  const MODES: LabelMode[] = ["l", "t", "b", "r"];
  const ri = st.r * 0.45; // labels may cover the edge of a dot, not its centre
  const placed: Box[] = [], out = new Map<string, LabelBlock>();
  for (const id of order) {
    const s = stations.get(id)!, [x, y] = pts.get(id)!;
    if (x < -100 || x > w + 100 || y < -50 || y > h + 50) { out.set(id, blockAt(s, x, y, "l", st)); continue; }
    let best: { score: number; b: LabelBlock } | null = null;
    MODES.forEach((m, k) => {
      const b = blockAt(s, x, y, m, st), bx = b.box;
      const off = bx[0] < 0 || bx[2] > w || bx[1] < 0 || bx[3] > h ? 1 : 0;
      const nl = placed.filter((o) => boxesOverlap(bx, o)).length;
      let nd = 0;
      for (const [o, p] of pts) if (o !== id && boxesOverlap(bx, [p[0] - ri, p[1] - ri, p[0] + ri, p[1] + ri])) nd++;
      const score = nl * 100 + nd * 10 + off * 5 + k * 0.1;
      if (!best || score < best.score) best = { score, b };
    });
    placed.push(best!.b.box);
    out.set(id, best!.b);
  }
  return out;
}
