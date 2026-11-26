import type { Leg } from "../core/journeys";
import { fmtDay, fmtTime } from "../core/time";
import { LegList } from "./Planner";

export type GeoStatus = "asking" | "ok" | "denied" | "unavailable" | "far";

type Props = {
  ymd: string;
  legs: Leg[];
  name(id: string): string;
  /** leg the user is on (from their position, or from the clock without one) */
  leg: number;
  change: string | null;
  big: string;
  sub: string;
  geo: GeoStatus;
  farKm: number | null;
  onEnd(): void;
};

const GEO_TEXT: Record<GeoStatus, string> = {
  asking: "Finding your location…",
  ok: "Your position is shown on the route.",
  denied: "Location is off, so only the timetable is shown.",
  unavailable: "Location is not available, so only the timetable is shown.",
  far: "",
};

/** Step 4: journey mode. Scheduled times only; nothing is estimated. */
export function JourneyPanel(p: Props) {
  const first = p.legs[0], last = p.legs[p.legs.length - 1];
  return (
    <div className="journey">
      <div className="jp-head">
        <div>
          <b>{p.name(first.run.st[first.i])} → {p.name(last.run.st[last.j])}</b>
          <div className="m small">{fmtDay(p.ymd)} · {fmtTime(first.run.dep[first.i])} – {fmtTime(last.run.arr[last.j])} · scheduled</div>
        </div>
        <button className="ghost" onClick={p.onEnd}>End</button>
      </div>
      <div className="jp-eta"><b>{p.big}</b> <span className="m">{p.sub}</span></div>
      {p.change && <div className="jp-chg">{p.change}</div>}
      <div className="m small">{p.geo === "far" ? `You are ${p.farKm?.toFixed(1)} km from the route; the marker shows the nearest point.` : GEO_TEXT[p.geo]}</div>
      <LegList legs={p.legs} name={p.name} highlight={p.leg} />
    </div>
  );
}
