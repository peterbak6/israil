import type { Leg } from "../core/journeys";
import { fmtDay, fmtTime } from "../core/time";
import { LegList } from "./Planner";

export type GeoStatus = "asking" | "ok" | "denied" | "unavailable";

type Props = {
  ymd: string;
  legs: Leg[];
  name(id: string): string;
  /** leg the user is on (from their position, or from the clock without one) */
  leg: number;
  onEnd(): void;
};

/** The trip in progress: its trains and stops, the current train stressed. The next action and the arrival
 * time are shown under the position marker on the map. Scheduled times only; nothing is estimated. */
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
      <LegList legs={p.legs} name={p.name} highlight={p.leg} />
    </div>
  );
}
