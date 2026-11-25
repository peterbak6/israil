import type { Lang } from "../data/types";

/** User preferences kept in the browser between visits. */
export type Settings = { size: number; lang: Lang | "off" };

export const DEFAULT_SETTINGS: Settings = { size: 10, lang: "en" };
export const SIZE_MIN = 6, SIZE_MAX = 18;
const KEY = "israil.settings.v1";

/** Read settings from stored JSON, falling back to defaults for anything missing or invalid. */
export function parseSettings(raw: string | null): Settings {
  let v: Partial<Settings> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { /* corrupt value: use defaults */ }
  const size = typeof v.size === "number" && v.size >= SIZE_MIN && v.size <= SIZE_MAX ? Math.round(v.size) : DEFAULT_SETTINGS.size;
  const lang = v.lang === "en" || v.lang === "he" || v.lang === "off" ? v.lang : DEFAULT_SETTINGS.lang;
  return { size, lang };
}

// localStorage can be missing or throw (private mode, blocked storage); the app works without it.
export function loadSettings(): Settings {
  try { return parseSettings(localStorage.getItem(KEY)); } catch { return DEFAULT_SETTINGS; }
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not persisted */ }
}
