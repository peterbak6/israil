// Shape of public/data/timetable.json (written by pipeline/gtfs_timetable.py from the Ministry of Transport GTFS feed).

/** [station key, arrival, departure, platform] — times in minutes after midnight of the service day
 * (values past 1440 for trains running after midnight); platform is null (not in the feed). */
export type TStop = [string, number, number, string | null];

export interface TTrip {
  id: string;
  /** train number */
  n: string | null;
  /** headsign, null when the feed used it for the train number */
  h: string | null;
  /** service id */
  s: string;
  st: TStop[];
}

export interface TService {
  /** Mon..Sun as "1"/"0" */
  days: string;
  start: string; // YYYYMMDD
  end: string;
  add: string[];
  remove: string[];
}

export interface Timetable {
  /** published: when the Ministry built the feed (Israel time, "YYYY-MM-DDTHH:MM"); missing in older exports */
  feed: { start: string; end: string; published?: string; generated: string; fields: Record<string, boolean> };
  /** stations the map does not show, keyed "G<stop_id>" */
  stations: Record<string, { name: string; name_he: string | null; lat: number; lon: number }>;
  services: Record<string, TService>;
  trips: TTrip[];
}

export async function loadTimetable(): Promise<Timetable> {
  const r = await fetch("/data/timetable.json");
  if (!r.ok) throw new Error("timetable.json " + r.status);
  return r.json();
}
