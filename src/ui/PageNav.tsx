import type { ReactNode } from "react";

export type Screen = 1 | 2 | 3;

const ICONS: Record<Screen, ReactNode> = {
  // favourites: a star
  2: <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" />,
  // map: a folded map
  1: <path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2zM9 4.5v13M15 6.5v13" />,
  // timetable: a clock
  3: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
};

type Item = { s: Screen; label: string };

/** Phone: the three pages as buttons in the header. The open page is marked; the timetable button pulses
 *  (twice, each time `pulse` changes) when trips for the selected stations are ready. */
export function PageNav({ page, items, onPage, pulse }: { page: Screen; items: Item[]; onPage(s: Screen): void; pulse: number }) {
  return (
    <nav className="pagenav" aria-label="Pages">
      {items.map(({ s, label }) => (
        <button key={s === 3 ? `3-${pulse}` : s} className={"pg" + (s === page ? " on" : "") + (s === 3 && pulse > 0 && page !== 3 ? " pulse" : "")}
          aria-label={label} title={label} aria-current={s === page ? "page" : undefined} onClick={() => onPage(s)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">{ICONS[s]}</svg>
        </button>
      ))}
    </nav>
  );
}
