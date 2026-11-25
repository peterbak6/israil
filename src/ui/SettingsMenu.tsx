import { useEffect, useRef, useState } from "react";
import type { Lang } from "../data/types";
import { SIZE_MAX, SIZE_MIN, type Settings } from "../core/settings";

type Props = { settings: Settings; onChange(s: Settings): void };
const LANGS: { v: Lang | "off"; label: string }[] = [
  { v: "en", label: "English" },
  { v: "he", label: "עברית" },
  { v: "off", label: "Off" },
];

/** Gear button with a small panel: label & dot size, station-name language. */
export function SettingsMenu({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div className="settings" ref={box}>
      <button className="gear" aria-label="Settings" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .3.2.5.5.5h4c.3 0 .5-.2.5-.4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
        </svg>
      </button>
      {open && (
        <div className="panel" role="dialog" aria-label="Settings">
          <div className="field">
            <span>Station names</span>
            <div className="seg" role="radiogroup" aria-label="Station names">
              {LANGS.map((l) => (
                <button key={l.v} role="radio" aria-checked={settings.lang === l.v} className={settings.lang === l.v ? "on" : ""}
                  onClick={() => onChange({ ...settings, lang: l.v })}>{l.label}</button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Label &amp; dot size <b>{settings.size}px</b></span>
            <input type="range" min={SIZE_MIN} max={SIZE_MAX} step={1} value={settings.size}
              onChange={(e) => onChange({ ...settings, size: +e.target.value })} />
          </label>
          <span className="m small">Saved in this browser.</span>
        </div>
      )}
    </div>
  );
}
