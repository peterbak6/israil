import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import type { Basemap, Lang, Line, Network, Place, Ring, Station, Tracks } from "../data/types";
import { fitter, lerp, project, resample, type Box, type Pt } from "../core/geometry";
import { blockAt, labelLines, placeCities, placeGeographic, placementOrder, schematicLabelRefs, type LabelBlock, type LabelStyle } from "../core/labels";
import { TRAIN_COLORS, type Piece } from "../core/route";

const NS = "http://www.w3.org/2000/svg";
/** Most zoom: two doubling steps from the full view (1x, 2x, 4x). */
export const ZOOM_MAX = 4;
const el = <K extends keyof SVGElementTagNameMap>(tag: K, cls?: string, parent?: Element) => {
  const e = document.createElementNS(NS, tag);
  if (cls) e.setAttribute("class", cls);
  parent?.appendChild(e);
  return e;
};
const pts = (ps: Pt[]) => ps.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

/** Points per station-to-station segment, on both the schematic and the geographic side. */
export const SEGMENT_POINTS = 64;
/** A stretch of a line between two of its stops (indices into line.stops). */
type Span = { line: string; i0: number; i1: number };

/** A journey to draw: map pieces in riding order, the stations the trains stop at, and the stations to stress
 * (origin, destination, changes). */
export type MapJourney = {
  pieces: Piece[]; stops: string[]; legLine: (string | null)[]; key: string[];
  /** "train": one picked journey, one colour per train. "options": all connection options, in the map lines' colours. */
  colorBy?: "train" | "line";
};
/** The user's position snapped to the journey (piece index, share of that piece's length), with the text shown
 * under the marker. `far`: the real position is far from the route, so the marker is drawn hollow. */
export type MapMe = { piece: number; frac: number; far: boolean; what: string; when: string };
type RouteSpan = { line: string | null; i0: number; i1: number; a?: string; b?: string };

/** What is highlighted. Selected stations always stay visible on top of this. */
type Focus = { segs: Set<string>; dots: Set<string>; labels: Set<string>; links: Set<string>; route?: boolean } | null;

export interface MapCallbacks {
  /** a station dot was clicked/tapped */
  onStation(id: string): void;
  /** empty map was clicked/tapped */
  onBackground(): void;
}

/**
 * Imperative SVG controller for the network. React owns the controls; this class owns the map so
 * the slider can update ~240 elements per frame without React re-rendering.
 *
 * Positions: every dot has a schematic position A and a geographic position B (both fitted to the
 * viewport). At slider value t it is drawn at lerp(A, B, t), then the zoom transform is applied to
 * the position only, so dots, lines and labels keep their pixel size when zooming.
 *
 * Lines: each segment between two consecutive stops is resampled to SEGMENT_POINTS points twice:
 * along the schematic straight line, and along the real track (or a straight line where no track
 * geometry exists). Point k moves linearly from its schematic to its geographic position.
 */
export class NetworkMap {
  private svg: SVGSVGElement;
  private g: Record<string, SVGGElement> = {};
  private tip: HTMLDivElement;
  private zoomer: ZoomBehavior<SVGSVGElement, unknown>;
  private view: ZoomTransform = zoomIdentity;
  private A = new Map<string, Pt>();
  private B = new Map<string, Pt>();
  private t = 0;
  private fs = 10;
  private lang: Lang = "en";
  private labelsOn = true;
  private sel: string[] = [];
  private hoverFocus: Focus = null;
  private st: Map<string, Station>;
  private refs: ReturnType<typeof schematicLabelRefs>;
  private order: string[];
  private dotEls = new Map<string, SVGCircleElement>();
  private segEls: [SVGPolylineElement, Span][] = [];
  private hitEls: [SVGPolylineElement, Span][] = [];
  /** per line, per segment: resampled schematic and geographic points */
  private segGeom = new Map<string, { sch: Pt[]; geo: Pt[] }[]>();
  private linkEls: [SVGPolylineElement[], string[], string][] = [];
  private lblEls = new Map<string, SVGTextElement>();
  private routeEls: [SVGPolylineElement, RouteSpan][] = [];
  /** short bars joining the two dots used where a journey moves between map lines (e.g. at a change) */
  private xferEls: [SVGPolylineElement[], string, string][] = [];
  private journey: MapJourney | null = null;
  private me: MapMe | null = null;
  private meEl!: SVGPathElement;
  private meLbl: HTMLDivElement;
  /** one dot per station, for placing chords */
  private stationCopy = new Map<string, string>();
  private geoCache: { key: string; blocks: Map<string, LabelBlock> } = { key: "", blocks: new Map() };
  /** label widths measured with the real SVG text (canvas measurement can differ slightly) */
  private textW = new Map<string, number>();
  /** city/town points in fitted geographic coordinates (pre-zoom) */
  private placeXY: Pt[] = [];
  private cityKey = "";
  /** centre of the drawn network at the current slider value (pre-zoom): panning keeps it on screen */
  private center: Pt = [0, 0];
  private lastBgTap = { t: 0, x: 0, y: 0 };
  private probe: SVGTextElement | null = null;
  private ro: ResizeObserver;

  constructor(private host: HTMLElement, private net: Network, private base: Basemap, private tracks: Tracks,
    private places: Place[], private cb: MapCallbacks) {
    this.st = new Map(net.stations.map((s) => [s.id, s]));
    this.refs = schematicLabelRefs(net);
    this.order = placementOrder(net);
    this.svg = el("svg", "map");
    host.appendChild(this.svg);
    for (const name of ["land", "cities", "net", "labels"]) this.g[name] = el("g", name, this.svg);
    for (const name of ["segs", "hits", "route", "links", "dots", "me"]) this.g[name] = el("g", name, this.g.net);
    for (const c of net.copies) if (!this.stationCopy.has(c.station)) this.stationCopy.set(c.station, c.id);
    // position marker: a triangle with a concave base, pointing up before rotation
    this.meEl = el("path", "me-arrow", this.g.me);
    this.meEl.setAttribute("d", "M0,-12 L9,10 L0,5 L-9,10 Z");
    this.tip = document.createElement("div");
    this.tip.className = "tip";
    host.appendChild(this.tip);
    this.meLbl = document.createElement("div");
    this.meLbl.className = "me-lbl";
    host.appendChild(this.meLbl);
    this.build();

    // Zoom: two steps (1x, 2x, 4x). Panning keeps the centre of the network on screen (see constrain()).
    this.zoomer = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, ZOOM_MAX])
      .clickDistance(5)
      .constrain((tr) => this.constrain(tr))
      .on("zoom", (ev) => { this.view = ev.transform; this.render(); });
    select(this.svg).call(this.zoomer).on("dblclick.zoom", null); // double click/tap is used to clear, not to zoom
    // A single tap on empty map space does nothing (it was too easy to clear a selection by accident);
    // a double tap or double click there clears it.
    this.svg.addEventListener("click", (ev) => {
      const c = (ev.target as Element).classList;
      const onStation = c.contains("dot") || c.contains("hit") || !!(ev.target as Element).closest?.(".lbl");
      if (onStation) return;
      this.hideTip();
      const last = this.lastBgTap, now = performance.now();
      if (now - last.t < 400 && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 30) {
        this.lastBgTap = { t: 0, x: 0, y: 0 };
        this.cb.onBackground();
      } else this.lastBgTap = { t: now, x: ev.clientX, y: ev.clientY };
    });

    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
    this.layout();
  }

  destroy() { this.ro.disconnect(); this.svg.remove(); this.tip.remove(); this.meLbl.remove(); }

  // ---------- public API ----------
  setT(t: number) {
    this.t = t;
    this.updateCenter();
    select(this.svg).call(this.zoomer.transform, this.view); // re-apply the pan limit for the new centre (renders)
  }
  setSize(fs: number) {
    if (fs !== this.fs) this.textW.clear();
    this.fs = fs;
    const r = this.r();
    this.host.style.setProperty("--fs", fs + "px");
    this.host.style.setProperty("--lo", r * 1.7 + "px");
    this.host.style.setProperty("--li", r + "px");
    this.render();
  }
  setLang(lang: Lang | "off") {
    this.labelsOn = lang !== "off";
    if (lang !== "off") this.lang = lang;
    this.g.labels.style.display = this.labelsOn ? "" : "none";
    for (const s of this.net.stations) this.setLabelText(s);
    this.render();
  }
  setSelection(sel: string[]) {
    this.sel = sel;
    this.hideTip(); // a tap's tooltip should not stay up once the station is picked (phones)
    this.applyFocus();
    this.render();
  }
  /** Show one journey or the connection options; null goes back to the normal map. */
  setJourney(j: MapJourney | null) {
    this.journey = j;
    this.hideTip();
    this.buildRoute();
    this.applyFocus();
    this.render();
  }
  setMe(m: MapMe | null) { this.me = m; this.render(); }
  /** Zoom so the whole journey fills the view (below the slider bar), as drawn at slider value `t`. */
  fitJourney(t = this.t) {
    const j = this.journey, w = this.host.clientWidth, h = this.host.clientHeight;
    if (!j || !this.A.size || !w || !h) return;
    const S = SEGMENT_POINTS - 1, ps: Pt[] = [];
    j.pieces.forEach((_, pi) => { for (const idx of [0, S / 2, S]) ps.push(this.routePoint(pi, idx, t)); });
    const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const TOP = 56, pad = 48;
    const k = Math.max(1, Math.min(ZOOM_MAX, (w - 2 * pad) / (x1 - x0 || 1), (h - TOP - 2 * pad) / (y1 - y0 || 1)));
    const x = w / 2 - k * (x0 + x1) / 2, y = TOP + (h - TOP) / 2 - k * (y0 + y1) / 2;
    select(this.svg).call(this.zoomer.transform, zoomIdentity.translate(x, y).scale(k));
  }
  zoomBy(k: number) { select(this.svg).call(this.zoomer.scaleBy, k); }
  resetZoom() { select(this.svg).call(this.zoomer.transform, zoomIdentity); }

  // ---------- construction ----------
  private r() { return this.fs * 0.43; }

  private build() {
    const { net } = this;
    for (const l of net.lines) {
      const span: Span = { line: l.id, i0: 0, i1: l.stops.length - 1 };
      const seg = el("polyline", "seg" + (l.inactive ? " inactive" : ""), this.g.segs);
      seg.setAttribute("stroke", l.color);
      seg.dataset.line = l.id;
      this.segEls.push([seg, span]);
      const hit = el("polyline", "hit", this.g.hits); // wide invisible copy, easy to hover or tap
      hit.addEventListener("pointerenter", (ev) => { if (ev.pointerType === "mouse") this.hoverLine(l, ev); });
      hit.addEventListener("pointermove", (ev) => this.moveTip(ev));
      hit.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") this.unhover(); });
      hit.addEventListener("click", (ev) => this.hoverLine(l, ev));
      this.hitEls.push([hit, span]);
    }
    // Bars joining the dots of one station, ordered along their main axis.
    for (const s of net.stations) {
      const cs = net.copies.filter((c) => c.station === s.id);
      if (cs.length < 2) continue;
      const xs = cs.map((c) => c.sx), ys = cs.map((c) => c.sy);
      const byX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
      const ids = [...cs].sort((a, b) => (byX ? a.sx - b.sx : a.sy - b.sy)).map((c) => c.id);
      const pair = ["link-o", "link-i"].map((cls) => { const e = el("polyline", cls, this.g.links); e.dataset.station = s.id; return e; });
      this.linkEls.push([pair, ids, s.id]);
    }
    for (const c of net.copies) {
      const d = el("circle", "dot", this.g.dots);
      Object.assign(d.dataset, { line: c.line, station: c.station, id: c.id });
      d.addEventListener("pointerenter", (ev) => { if (ev.pointerType === "mouse") this.hoverStation(c.station, ev); });
      d.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") this.unhover(); });
      d.addEventListener("click", (ev) => {
        if ((ev as PointerEvent).pointerType !== "mouse") this.hoverStation(c.station, ev);
        this.cb.onStation(c.station);
      });
      this.dotEls.set(c.id, d);
    }
    for (const s of net.stations) {
      const t = el("text", "lbl", this.g.labels);
      t.setAttribute("direction", "ltr");
      // a label selects and hovers its station, like the station's dots
      t.addEventListener("pointerenter", (ev) => { if (ev.pointerType === "mouse") this.hoverStation(s.id, ev); });
      t.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") this.unhover(); });
      t.addEventListener("click", (ev) => {
        if ((ev as PointerEvent).pointerType !== "mouse") this.hoverStation(s.id, ev);
        this.cb.onStation(s.id);
      });
      this.lblEls.set(s.id, t);
      this.setLabelText(s);
    }
  }

  private setLabelText(s: Station) {
    const t = this.lblEls.get(s.id)!;
    t.textContent = "";
    for (const line of labelLines(s, this.lang)) el("tspan", undefined, t).textContent = line;
  }

  /** Fit schematic and geography into the current viewport; draw the basemap. */
  private layout() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.zoomer.extent([[0, 0], [w, h]]);
    this.textW.clear();
    const TOP = 56; // room for the slider bar drawn over the top of the map
    const fS = fitter(this.net.copies.map((c) => [c.sx, c.sy] as Pt), w, h, 28, TOP);
    const fG = fitter(this.net.stations.map((s) => project(s.lon, s.lat)), w, h, 28, TOP);
    for (const c of this.net.copies) {
      this.A.set(c.id, fS([c.sx, c.sy]));
      const s = this.st.get(c.station)!;
      this.B.set(c.id, fG(project(s.lon, s.lat)));
    }
    // Segment geometry: schematic straight line vs real track (straight where none is known).
    this.segGeom.clear();
    for (const l of this.net.lines) {
      const segs = [];
      for (let i = 1; i < l.stops.length; i++) {
        const a = l.stops[i - 1], b = l.stops[i];
        const ca = `${a}.${l.id}`, cb = `${b}.${l.id}`;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const tr = this.tracks.segments[key];
        const mid = tr ? (a < b ? tr.c : [...tr.c].reverse()).map(([lo, la]) => fG(project(lo, la))) : [];
        segs.push({
          sch: resample([this.A.get(ca)!, this.A.get(cb)!], SEGMENT_POINTS),
          geo: resample([this.B.get(ca)!, ...mid, this.B.get(cb)!], SEGMENT_POINTS),
        });
      }
      this.segGeom.set(l.id, segs);
    }
    this.placeXY = this.places.map((p) => fG(project(p.lon, p.lat)));
    this.cityKey = "";
    this.updateCenter();
    select(this.svg).call(this.zoomer.transform, this.view); // re-clamp the current view to the new size
    const path = (r: Ring) => "M" + r.map(([lo, la]) => fG(project(lo, la)).map((v) => v.toFixed(1)).join(",")).join("L");
    const b = this.base;
    this.g.land.innerHTML =
      `<path class="landmass" d="${b.land.map((r) => path(r) + "Z").join("")}"/>` +
      `<path class="urban" d="${b.urban.map((r) => path(r) + "Z").join("")}"/>` +
      `<path class="river" d="${b.rivers.map(path).join("")}"/>` +
      `<path class="road minor" d="${b.roads.filter((r) => r.k !== "Major Highway").map((r) => path(r.c)).join("")}"/>` +
      `<path class="road" d="${b.roads.filter((r) => r.k === "Major Highway").map((r) => path(r.c)).join("")}"/>` +
      `<path class="lake" d="${b.lakes.map((r) => path(r) + "Z").join("")}"/>`;
    this.geoCache.key = "";
    this.render();
  }

  private buildRoute() {
    this.g.route.innerHTML = "";
    this.routeEls = [];
    this.xferEls = [];
    if (this.journey) {
      const j = this.journey, lineColor = new Map(this.net.lines.map((l) => [l.id, l.color]));
      if (j.colorBy === "line") {
        for (const p of j.pieces) {
          const e = el("polyline", "rt" + (p.line ? "" : " chord"), this.g.route);
          e.setAttribute("stroke", p.line ? lineColor.get(p.line)! : "#555");
          this.routeEls.push([e, p.line ? { line: p.line, i0: p.seg, i1: p.seg + 1 } : { line: null, i0: 0, i1: 0, a: p.from, b: p.to }]);
        }
        return;
      }
      const color = (leg: number) => TRAIN_COLORS[leg % TRAIN_COLORS.length];
      // one colour per train (by its place in the journey), whichever map lines its track runs along
      for (const p of j.pieces) {
        const e = el("polyline", "rt" + (p.line ? "" : " chord"), this.g.route);
        e.setAttribute("stroke", color(p.leg));
        this.routeEls.push([e, p.line ? { line: p.line, i0: p.seg, i1: p.seg + 1 } : { line: null, i0: 0, i1: 0, a: p.from, b: p.to }]);
      }
      // where the track moves between map lines: within one train, the train's colour continues across;
      // at a change of train, the station's bar joins the two dots used
      j.pieces.forEach((p, i) => {
        const q = j.pieces[i + 1];
        if (!q || !p.line || !q.line || p.line === q.line) return;
        const els = p.leg === q.leg
          ? [el("polyline", "rt", this.g.route)]
          : ["link-o hl", "link-i hl"].map((cls) => el("polyline", cls, this.g.route));
        if (p.leg === q.leg) els[0].setAttribute("stroke", color(p.leg));
        this.xferEls.push([els, `${p.to}.${p.line}`, `${q.from}.${q.line}`]);
      });
    }
  }

  // ---------- drawing ----------
  private V = (p: Pt): Pt => [p[0] * this.view.k + this.view.x, p[1] * this.view.k + this.view.y];

  private style(): LabelStyle {
    return { fs: this.fs, r: this.r(), lang: this.lang, measure: (s) => this.measure(s) };
  }

  private measure(text: string): number {
    const key = this.fs + "|" + text;
    let w = this.textW.get(key);
    if (w === undefined) {
      if (!this.probe) { this.probe = el("text", "lbl probe", this.svg); this.probe.setAttribute("direction", "ltr"); }
      this.probe.textContent = text;
      w = this.probe.getComputedTextLength();
      this.textW.set(key, w);
    }
    return w;
  }

  /** Geographic label positions for the final (100%) dot positions at the current zoom; cached. */
  private geoLabels(): Map<string, LabelBlock> {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const key = [this.view.k, this.view.x, this.view.y, this.fs, this.lang, w, h].join();
    if (key === this.geoCache.key) return this.geoCache.blocks;
    const p = new Map<string, Pt>();
    for (const c of this.net.copies) p.set(c.station, this.V(this.B.get(c.id)!));
    const blocks = placeGeographic(this.st, p, this.order, w, h, this.style());
    this.geoCache = { key, blocks };
    return blocks;
  }

  private render() {
    if (!this.A.size) return;
    const P = new Map<string, Pt>();
    for (const c of this.net.copies) P.set(c.id, this.V(lerp(this.A.get(c.id)!, this.B.get(c.id)!, this.t)));
    const r = this.r();
    for (const [id, d] of this.dotEls) { const p = P.get(id)!; d.setAttribute("cx", String(p[0])); d.setAttribute("cy", String(p[1])); d.setAttribute("r", String(r)); }
    for (const [pair, ids] of this.linkEls) { const s = pts(ids.map((i) => P.get(i)!)); pair.forEach((e) => e.setAttribute("points", s)); }
    // Lines: interpolate every resampled point, then cut spans (whole lines, trip legs) out of it.
    const S = SEGMENT_POINTS - 1, full = new Map<string, Pt[]>();
    for (const [line, segs] of this.segGeom) {
      const out: Pt[] = [];
      segs.forEach((g, k) => { for (let i = k ? 1 : 0; i < SEGMENT_POINTS; i++) out.push(this.V(lerp(g.sch[i], g.geo[i], this.t))); });
      full.set(line, out);
    }
    for (const [e, sp] of [...this.segEls, ...this.hitEls, ...this.routeEls])
      e.setAttribute("points", pts(sp.line === null
        ? [P.get(this.stationCopy.get((sp as RouteSpan).a!)!)!, P.get(this.stationCopy.get((sp as RouteSpan).b!)!)!]
        : (full.get(sp.line) ?? []).slice(sp.i0 * S, sp.i1 * S + 1)));
    for (const [pair, a, b] of this.xferEls) { const s = pts([P.get(a)!, P.get(b)!]); pair.forEach((e) => e.setAttribute("points", s)); }
    this.drawMe();

    // Labels move like the dots: a straight line from the map position to the geographic position.
    if (this.labelsOn) {
      const style = this.style(), geo = this.geoLabels();
      for (const [id, ref] of this.refs) {
        const s = this.st.get(id)!, a = this.V(this.A.get(ref.copy)!);
        const S = blockAt(s, a[0], a[1], ref.mode, style), G = geo.get(id)!;
        this.lblEls.get(id)!.childNodes.forEach((n, i) => {
          const p = lerp(S.pos[i], G.pos[i], this.t);
          (n as SVGTSpanElement).setAttribute("x", String(p[0]));
          (n as SVGTSpanElement).setAttribute("y", String(p[1]));
        });
      }
    }
    this.g.land.setAttribute("transform", `translate(${this.view.x},${this.view.y}) scale(${this.view.k})`);
    this.g.land.style.opacity = this.t >= 1 ? "1" : "0";
    this.drawCities();
  }

  /** Centre of the network's bounding box as drawn at the current slider value (pre-zoom). */
  private updateCenter() {
    if (!this.A.size) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of this.net.copies) {
      const p = lerp(this.A.get(c.id)!, this.B.get(c.id)!, this.t);
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    this.center = [(x0 + x1) / 2, (y0 + y1) / 2];
  }

  /** Pan limit: the centre of the network stays on screen (below the slider bar), at every zoom level. */
  private constrain(tr: ZoomTransform): ZoomTransform {
    const w = this.host.clientWidth, h = this.host.clientHeight, m = 24, TOP = 56;
    if (!w || !h) return tr;
    const [cx, cy] = this.center, k = tr.k;
    const x = Math.min(w - m - k * cx, Math.max(m - k * cx, tr.x));
    const y = Math.min(h - m - k * cy, Math.max(TOP + m - k * cy, tr.y));
    return x === tr.x && y === tr.y ? tr : zoomIdentity.translate(x, y).scale(k);
  }

  /** City and town names on the geographic map: placed around station labels and dots, bigger places first. */
  private drawCities() {
    const show = this.t >= 1 && this.places.length > 0;
    this.g.cities.style.display = show ? "" : "none";
    if (!show) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const key = [this.view.k, this.view.x, this.view.y, this.fs, this.lang, this.labelsOn, w, h].join();
    if (key === this.cityKey) return;
    this.cityKey = key;
    const r = this.r() + 2, avoid: Box[] = [];
    for (const c of this.net.copies) { const p = this.V(this.B.get(c.id)!); avoid.push([p[0] - r, p[1] - r, p[0] + r, p[1] + r]); }
    if (this.labelsOn) for (const b of this.geoLabels().values()) avoid.push(b.box);
    const fs = Math.round(this.fs * 0.9);
    const name = (p: Place) => (this.lang === "he" ? p.he ?? p.en : p.en ?? p.he) ?? "";
    const cities = this.places.map((p, i) => {
      const [x, y] = this.V(this.placeXY[i]);
      return { x, y, text: name(p), city: p.city, pop: p.pop };
    });
    const out = placeCities(cities, avoid, w, h, fs, (s) => this.measure(s) * 0.9, 56);
    this.g.cities.innerHTML = out.map((o) =>
      `<circle class="city-dot" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${this.places[o.i].city ? 2.6 : 1.8}"/>` +
      `<text class="city${this.places[o.i].city ? " big" : ""}" x="${o.lx.toFixed(1)}" y="${o.ly.toFixed(1)}" style="font-size:${fs}px">${esc(cities[o.i].text)}</text>`).join("");
  }

  /** A point on the journey: piece `pi`, `idx` samples (0..SEGMENT_POINTS-1) along it in riding order. Pre-zoom. */
  private routePoint(pi: number, idx: number, t = this.t): Pt {
    const S = SEGMENT_POINTS - 1, p = this.journey!.pieces[pi];
    const at = (k: string) => { const c = this.stationCopy.get(k)!; return lerp(this.A.get(c)!, this.B.get(c)!, t); };
    if (!p.line) return lerp(at(p.from), at(p.to), idx / S);
    const g = this.segGeom.get(p.line)![p.seg], k = p.rev ? S - idx : idx;
    const i0 = Math.max(0, Math.min(S - 1, Math.floor(k))), u = k - i0;
    return lerp(lerp(g.sch[i0], g.geo[i0], t), lerp(g.sch[i0 + 1], g.geo[i0 + 1], t), u);
  }

  /** The position marker: on the route, pointing towards the next point of the route. */
  private drawMe() {
    const m = this.me, j = this.journey;
    if (!m || !j || !j.pieces[m.piece]) { this.meEl.style.display = "none"; this.meLbl.style.display = "none"; return; }
    const S = SEGMENT_POINTS - 1, idx = m.frac * S, cl = (v: number) => Math.max(0, Math.min(S, v));
    const p = this.V(this.routePoint(m.piece, idx));
    let a = this.V(this.routePoint(m.piece, cl(idx - 2))), b = this.V(this.routePoint(m.piece, cl(idx + 2)));
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) { a = this.V(this.routePoint(m.piece, 0)); b = this.V(this.routePoint(m.piece, S)); }
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    this.meEl.style.display = "";
    this.meEl.classList.toggle("far", m.far);
    this.meEl.setAttribute("transform", `translate(${p[0].toFixed(1)},${p[1].toFixed(1)}) rotate(${deg.toFixed(1)})`);
    // the label sits behind the arrow (on the stretch already travelled), so it never hides the route ahead
    const G = 16, [lx, ly, tr] = Math.abs(dy) >= Math.abs(dx)
      ? dy > 0 ? [p[0], p[1] - G, "translate(-50%,-100%)"] : [p[0], p[1] + G, "translate(-50%,0)"]
      : dx > 0 ? [p[0] - G, p[1], "translate(-100%,-50%)"] : [p[0] + G, p[1], "translate(0,-50%)"];
    this.meLbl.style.display = "block";
    this.meLbl.style.left = lx + "px";
    this.meLbl.style.top = ly + "px";
    this.meLbl.style.transform = tr as string;
    this.meLbl.innerHTML = `<div>${esc(m.what)}</div><b>${esc(m.when)}</b>`;
  }

  // ---------- highlighting ----------
  private linesFocus(lineIds: Set<string>, links: string[] = []): Focus {
    const ls = this.net.lines.filter((l) => lineIds.has(l.id));
    return {
      segs: lineIds,
      dots: new Set(this.net.copies.filter((c) => lineIds.has(c.line)).map((c) => c.id)),
      labels: new Set(ls.flatMap((l) => l.stops)),
      links: new Set(links),
    };
  }

  private journeyFocus(): Focus {
    const j = this.journey!, stops = new Set(j.stops);
    // picked journey: one dot per stop; at a change of train, the two dots used, joined by a short bar (see
    // buildRoute). The stations' full bars stay faded.
    const f = { segs: new Set<string>(), dots: new Set<string>(), labels: stops, links: new Set<string>(), route: true };
    const has = new Set<string>(), changes = new Set(j.key);
    if (j.colorBy === "line") {
      // options: every used dot of every stop, and the station bars where options change train or switch lines
      const lines = new Map<string, Set<string>>();
      for (const p of j.pieces)
        if (p.line) for (const k of [p.from, p.to]) {
          if (stops.has(k)) f.dots.add(`${k}.${p.line}`);
          let s = lines.get(k); if (!s) lines.set(k, (s = new Set())); s.add(p.line);
        }
      for (const [k, s] of lines) if (s.size > 1 || changes.has(k)) f.links.add(k);
      return f;
    }
    for (const p of j.pieces)
      if (p.line)
        for (const k of [p.from, p.to])
          if (stops.has(k) && (!has.has(k) || changes.has(k))) { f.dots.add(`${k}.${p.line}`); has.add(k); }
    return f;
  }

  private applyFocus() {
    const f = this.journey ? this.journeyFocus() : this.hoverFocus;
    const sel = new Set(this.journey ? this.journey.key : this.sel);
    // in a journey only the used dots of the key stations are stressed, not every dot of those stations
    for (const [id, e] of this.dotEls) e.classList.toggle("sel", sel.has(id.split(".")[0]) && (!this.journey || !!f?.dots.has(id)));
    const net = this.g.net;
    net.classList.toggle("dim", !!f && !f.route);
    net.classList.toggle("route", !!f?.route);
    this.g.labels.classList.toggle("dim", !!f);
    this.g.labels.classList.toggle("journey", !!this.journey);
    for (const [e] of this.segEls) e.classList.toggle("hl", !!f?.segs.has(e.dataset.line!));
    for (const [id, d] of this.dotEls) d.classList.toggle("hl", !!f?.dots.has(id));
    for (const [pair, , s] of this.linkEls) pair.forEach((e) => e.classList.toggle("hl", !!f?.links.has(s)));
    for (const [id, t] of this.lblEls) {
      t.classList.toggle("hl", !!f?.labels.has(id));
      t.classList.toggle("sel", sel.has(id));
    }
  }

  private hoverLine(l: Line, ev: MouseEvent) {
    this.hoverFocus = this.linesFocus(new Set([l.id]));
    this.applyFocus();
    const extra = [l.night && "night service", l.inactive && "not in service"].filter(Boolean).join(" · ");
    this.showTip(`<b>${esc(l.name)}</b><br><span class="m">${l.stops.length} stations${extra ? " · " + extra : ""}</span>`, ev);
  }

  private hoverStation(id: string, ev: MouseEvent) {
    const through = this.net.lines.filter((l) => l.stops.includes(id));
    this.hoverFocus = this.linesFocus(new Set(through.map((l) => l.id)), [id]);
    this.applyFocus();
    const s = this.st.get(id)!;
    const rows = through.map((l) => `<span style="color:${l.color}">■</span> ${esc(l.name)}`).join("<br>");
    this.showTip(`<b>${esc(s.name)}</b> <span class="m" dir="rtl">${esc(s.name_he)}</span><br>${rows}<br><span class="m">GTFS ${s.gtfs_stop_id ?? "–"} · click to plan a trip</span>`, ev);
  }

  private unhover() { this.hoverFocus = null; this.applyFocus(); this.hideTip(); }

  private showTip(html: string, ev: MouseEvent) { this.tip.innerHTML = html; this.tip.style.display = "block"; this.moveTip(ev); }
  private hideTip() { this.tip.style.display = "none"; if (this.hoverFocus) { this.hoverFocus = null; this.applyFocus(); } }
  private moveTip(ev: MouseEvent) {
    const r = this.host.getBoundingClientRect();
    this.tip.style.left = Math.min(ev.clientX - r.left + 12, r.width - 250) + "px";
    this.tip.style.top = ev.clientY - r.top + 12 + "px";
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
