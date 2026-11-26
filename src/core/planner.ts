/** Trip-planner state kept in the browser: saved searches, preferred change stations, journey-mode slider.
 * The user's location is never stored. */
export type Od = { from: string | null; to: string | null };

export interface PlannerStore {
  /** saved searches; each covers both directions */
  saved: { a: string; b: string }[];
  /** preferred change stations per direction, key "FROM>TO" */
  prefs: Record<string, string[]>;
  /** slider position used in journey mode (0 = schematic, 1 = geographic) */
  journeyT: number;
}

export const DEFAULT_PLANNER: PlannerStore = { saved: [], prefs: {}, journeyT: 0.9 };
const KEY = "israil.planner.v1";
const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Z0-9]{2,8}$/.test(v);

export function parsePlanner(raw: string | null): PlannerStore {
  let v: Partial<PlannerStore> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { /* corrupt value: use defaults */ }
  const saved = Array.isArray(v.saved) ? v.saved.filter((s) => s && isId(s.a) && isId(s.b)).slice(0, 20) : [];
  const prefs: Record<string, string[]> = {};
  if (v.prefs && typeof v.prefs === "object")
    for (const [k, p] of Object.entries(v.prefs)) if (Array.isArray(p) && p.every(isId)) prefs[k] = p;
  const journeyT = typeof v.journeyT === "number" && v.journeyT >= 0 && v.journeyT <= 1 ? v.journeyT : DEFAULT_PLANNER.journeyT;
  return { saved, prefs, journeyT };
}

export function loadPlanner(): PlannerStore {
  try { return parsePlanner(localStorage.getItem(KEY)); } catch { return DEFAULT_PLANNER; }
}
export function savePlanner(s: PlannerStore) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not persisted */ }
}

export const isSaved = (s: PlannerStore, od: Od) =>
  !!od.from && !!od.to && s.saved.some((x) => (x.a === od.from && x.b === od.to) || (x.a === od.to && x.b === od.from));

export function toggleSaved(s: PlannerStore, od: Od): PlannerStore {
  if (!od.from || !od.to) return s;
  const saved = isSaved(s, od)
    ? s.saved.filter((x) => !((x.a === od.from && x.b === od.to) || (x.a === od.to && x.b === od.from)))
    : [...s.saved, { a: od.from, b: od.to }];
  return { ...s, saved };
}

/** Tapping stations on the map: the first fills From, the second To, the next starts again from From. */
export function nextOd(od: Od, id: string): Od {
  if (!od.from) return { from: id, to: od.to === id ? null : od.to };
  if (!od.to) return od.from === id ? od : { from: od.from, to: id };
  return { from: id, to: null };
}
