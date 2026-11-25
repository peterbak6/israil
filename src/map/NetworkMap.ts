import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import type { Basemap, Lang, Line, Network, Ring, Station } from "../data/types";
import { fitter, lerp, project, type Pt } from "../core/geometry";
import { blockAt, labelLines, placeGeographic, placementOrder, schematicLabelRefs, type LabelBlock, type LabelStyle } from "../core/labels";
import { legStations, type TripOption } from "../core/routing";

const NS = "http://www.w3.org/2000/svg";
const el = <K extends keyof SVGElementTagNameMap>(tag: K, cls?: string, parent?: Element) => {
  const e = document.createElementNS(NS, tag);
  if (cls) e.setAttribute("class", cls);
  parent?.appendChild(e);
  return e;
};
const pts = (ps: Pt[]) => ps.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

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
  private trip: TripOption[] | null = null;
  private hoverFocus: Focus = null;
  private st: Map<string, Station>;
  private refs: ReturnType<typeof schematicLabelRefs>;
  private order: string[];
  private dotEls = new Map<string, SVGCircleElement>();
  private segEls: [SVGPolylineElement, string[]][] = [];
  private hitEls: [SVGPolylineElement, string[]][] = [];
  private linkEls: [SVGPolylineElement[], string[], string][] = [];
  private lblEls = new Map<string, SVGTextElement>();
  private routeEls: [SVGPolylineElement, string[]][] = [];
  private geoCache: { key: string; blocks: Map<string, LabelBlock> } = { key: "", blocks: new Map() };
  private ctx = document.createElement("canvas").getContext("2d")!;
  private ro: ResizeObserver;

  constructor(private host: HTMLElement, private net: Network, private base: Basemap, private cb: MapCallbacks) {
    this.st = new Map(net.stations.map((s) => [s.id, s]));
    this.refs = schematicLabelRefs(net);
    this.order = placementOrder(net);
    this.svg = el("svg", "map");
    host.appendChild(this.svg);
    for (const name of ["land", "net", "labels"]) this.g[name] = el("g", name, this.svg);
    for (const name of ["segs", "hits", "route", "links", "dots"]) this.g[name] = el("g", name, this.g.net);
    this.tip = document.createElement("div");
    this.tip.className = "tip";
    host.appendChild(this.tip);
    this.build();

    this.zoomer = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 16])
      .clickDistance(5)
      .on("zoom", (ev) => { this.view = ev.transform; this.render(); });
    select(this.svg).call(this.zoomer);
    this.svg.addEventListener("click", (ev) => {
      const c = (ev.target as Element).classList;
      if (!c.contains("dot") && !c.contains("hit")) { this.hideTip(); this.cb.onBackground(); }
    });

    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
    this.layout();
  }

  destroy() { this.ro.disconnect(); this.svg.remove(); this.tip.remove(); }

  // ---------- public API ----------
  setT(t: number) { this.t = t; this.render(); }
  setSize(fs: number) {
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
  setSelection(sel: string[], trip: TripOption[] | null) {
    this.sel = sel;
    this.trip = sel.length === 2 ? trip : null;
    for (const [id, e] of this.dotEls) e.classList.toggle("sel", sel.includes(id.split(".")[0]));
    this.buildRoute();
    this.applyFocus();
    this.render();
  }
  zoomBy(k: number) { select(this.svg).call(this.zoomer.scaleBy, k); }
  resetZoom() { select(this.svg).call(this.zoomer.transform, zoomIdentity); }

  // ---------- construction ----------
  private r() { return this.fs * 0.43; }

  private build() {
    const { net } = this;
    for (const l of net.lines) {
      const ids = l.stops.map((k) => `${k}.${l.id}`);
      const seg = el("polyline", "seg" + (l.inactive ? " inactive" : ""), this.g.segs);
      seg.setAttribute("stroke", l.color);
      seg.dataset.line = l.id;
      this.segEls.push([seg, ids]);
      const hit = el("polyline", "hit", this.g.hits); // wide invisible copy, easy to hover or tap
      hit.addEventListener("pointerenter", (ev) => { if (ev.pointerType === "mouse") this.hoverLine(l, ev); });
      hit.addEventListener("pointermove", (ev) => this.moveTip(ev));
      hit.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") this.unhover(); });
      hit.addEventListener("click", (ev) => this.hoverLine(l, ev));
      this.hitEls.push([hit, ids]);
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
    const fS = fitter(this.net.copies.map((c) => [c.sx, c.sy] as Pt), w, h);
    const fG = fitter(this.net.stations.map((s) => project(s.lon, s.lat)), w, h);
    for (const c of this.net.copies) {
      this.A.set(c.id, fS([c.sx, c.sy]));
      const s = this.st.get(c.station)!;
      this.B.set(c.id, fG(project(s.lon, s.lat)));
    }
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
    for (const o of this.trip ?? [])
      for (const leg of o.legs) {
        const e = el("polyline", "rt", this.g.route);
        e.setAttribute("stroke", leg.line.color);
        this.routeEls.push([e, legStations(leg).map((k) => `${k}.${leg.line.id}`)]);
      }
  }

  // ---------- drawing ----------
  private V = (p: Pt): Pt => [p[0] * this.view.k + this.view.x, p[1] * this.view.k + this.view.y];

  private style(): LabelStyle {
    this.ctx.font = `${this.fs}px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;
    return { fs: this.fs, r: this.r(), lang: this.lang, measure: (s) => this.ctx.measureText(s).width };
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
    for (const [e, ids] of [...this.segEls, ...this.hitEls, ...this.routeEls]) e.setAttribute("points", pts(ids.map((i) => P.get(i)!)));

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

  private routeFocus(): Focus {
    if (!this.trip || this.sel.length !== 2) return null;
    const [A, B] = this.sel;
    const f = { segs: new Set<string>(), dots: new Set<string>(), labels: new Set([A, B]), links: new Set([A, B]), route: true };
    for (const o of this.trip)
      for (const g of o.legs) {
        f.dots.add(`${g.from}.${g.line.id}`); f.dots.add(`${g.to}.${g.line.id}`);
        // the start and end stations show all their dots, so their bars read as one station
        for (const k of [g.from, g.to]) if (k === A || k === B) for (const c of this.net.copies) if (c.station === k) f.dots.add(c.id);
        for (const k of [g.from, g.to]) if (k !== A && k !== B) { f.labels.add(k); f.links.add(k); }
      }
    return f;
  }

  private applyFocus() {
    const f = this.trip ? this.routeFocus() : this.hoverFocus;
    const net = this.g.net;
    net.classList.toggle("dim", !!f && !f.route);
    net.classList.toggle("route", !!f?.route);
    this.g.labels.classList.toggle("dim", !!f);
    for (const [e] of this.segEls) e.classList.toggle("hl", !!f?.segs.has(e.dataset.line!));
    for (const [id, d] of this.dotEls) d.classList.toggle("hl", !!f?.dots.has(id));
    for (const [pair, , s] of this.linkEls) pair.forEach((e) => e.classList.toggle("hl", !!f?.links.has(s)));
    for (const [id, t] of this.lblEls) {
      t.classList.toggle("hl", !!f?.labels.has(id));
      t.classList.toggle("sel", this.sel.includes(id));
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
