import type { Od, PlannerStore } from "../core/planner";

type Props = {
  store: PlannerStore;
  name(id: string): string;
  /** open a favourite: sets From and To */
  onOpen(od: Od): void;
  onRemove(a: string, b: string): void;
};

/** Stage 2: the starred searches. Tapping one is the same as picking its two stations; ★ removes it. */
export function Favorites({ store, name, onOpen, onRemove }: Props) {
  return (
    <div className="favorites">
      <h2>Favourites</h2>
      {store.saved.length === 0 && <p className="hint">No favourites yet. Star a search on the trips screen.</p>}
      <ul>
        {store.saved.map((s) => (
          <li key={s.a + "|" + s.b}>
            <button className="fav" onClick={() => onOpen({ from: s.a, to: s.b })}>
              <span>{name(s.a)}</span><span className="m">⇄</span><span>{name(s.b)}</span>
            </button>
            <button className="icon unstar" aria-label={`Remove ${name(s.a)} – ${name(s.b)} from favourites`} title="Remove from favourites"
              onClick={() => onRemove(s.a, s.b)}>★</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
