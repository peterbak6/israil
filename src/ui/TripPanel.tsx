import type { Network } from "../data/types";
import type { TripOption } from "../core/routing";

type Props = { network: Network; selection: string[]; trip: TripOption[] | null; onClear(): void };

/** Trip between two selected stations: options with the fewest transfers. */
export function TripPanel({ network, selection, trip, onClear }: Props) {
  const name = (id: string) => network.stations.find((s) => s.id === id)?.name ?? id;
  if (!selection.length) return <div className="trip m">Click or tap two stations to see the lines that connect them.</div>;
  if (selection.length === 1)
    return (
      <div className="trip">
        <div><b>From:</b> {name(selection[0])}</div>
        <span className="m">Now pick a destination.</span>
        <button className="ghost" onClick={onClear}>Clear</button>
      </div>
    );
  const [a, b] = selection, opts = trip ?? [];
  const transfers = opts.length ? opts[0].legs.length - 1 : 0;
  return (
    <div className="trip">
      <div><b>{name(a)}</b> → <b>{name(b)}</b></div>
      {opts.length ? (
        <>
          <span className="m">
            {transfers === 0 ? "Direct" : transfers === 1 ? "1 transfer" : "2 transfers"} · {opts.length} option{opts.length > 1 ? "s" : ""}
          </span>
          {opts.slice(0, 8).map((o, i) => (
            <div className="opt" key={i}>
              {o.legs.map((g, j) => (
                <span key={j} className="leg">
                  {j > 0 && <span className="m">→ change at {name(g.from)} → </span>}
                  <span className="ln"><i style={{ background: g.line.color }} />{g.line.name}</span>
                </span>
              ))}
            </div>
          ))}
          {opts.length > 8 && <span className="m">+{opts.length - 8} more shown on the map</span>}
        </>
      ) : (
        <span className="m">No connection within two transfers.</span>
      )}
      <button className="ghost" onClick={onClear}>Clear</button>
    </div>
  );
}
