export type Screen = 1 | 2 | 3 | 4;
export type Stage = { s: Screen; label: string; enabled: boolean };

/** Dots showing which page is open; a dot can be tapped when its page is available. */
export function StageDots({ screen, stages, onScreen }: { screen: Screen; stages: Stage[]; onScreen(s: Screen): void }) {
  return (
    <nav className="stages" aria-label="Pages">
      {stages.map(({ s, label, enabled }) => (
        <button key={s} className={"stage" + (s === screen ? " on" : "")} aria-label={label} title={label}
          aria-current={s === screen ? "page" : undefined} disabled={!enabled} onClick={() => onScreen(s)} />
      ))}
    </nav>
  );
}
