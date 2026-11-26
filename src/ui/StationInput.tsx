import { useMemo, useRef, useState } from "react";
import type { Station } from "../data/types";

type Props = {
  label: string;
  value: string | null;
  stations: Station[];
  name(id: string): string;
  onChange(id: string | null): void;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ'’"״׳–-]/g, "").replace(/\s+/g, " ");

/** Text field with station suggestions (English or Hebrew names). */
export function StationInput({ label, value, stations, name, onChange }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const n = norm(q.trim());
    const score = (s: Station) => {
      const a = norm(s.name), b = norm(s.name_he);
      if (!n) return 1;
      if (a.startsWith(n) || b.startsWith(n)) return 2;
      return a.includes(n) || b.includes(n) ? 1 : 0;
    };
    return stations.map((s) => [s, score(s)] as const).filter(([, k]) => k > 0)
      .sort((x, y) => y[1] - x[1] || name(x[0].id).localeCompare(name(y[0].id))).map(([s]) => s);
  }, [q, stations, name]);

  const pick = (id: string) => { onChange(id); setOpen(false); setQ(""); input.current?.blur(); };

  return (
    <div className="station-input">
      <span className="lab">{label}</span>
      <input ref={input} dir="auto" placeholder="Station" aria-label={label} autoComplete="off" spellCheck={false}
        value={open ? q : value ? name(value) : ""}
        onFocus={() => { setOpen(true); setQ(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) pick(matches[0].id);
          if (e.key === "Escape") input.current?.blur();
        }} />
      {value && !open && <button className="clr" aria-label={`Clear ${label}`} onClick={() => onChange(null)}>×</button>}
      {open && (
        <ul className="sugg" role="listbox">
          {matches.map((s) => (
            <li key={s.id} role="option" aria-selected={s.id === value} onMouseDown={(e) => { e.preventDefault(); pick(s.id); }}>
              {name(s.id)} <span className="m" dir="auto">{name(s.id) === s.name ? s.name_he : s.name}</span>
            </li>
          ))}
          {!matches.length && <li className="m none">No station matches</li>}
        </ul>
      )}
    </div>
  );
}
