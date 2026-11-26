// Shapes of the generated data files in public/data (written by pipeline/build_network.py
// and pipeline/build_basemap.py).

/** Where a station's label sits on the schematic, read off the Israel Railways map:
 * l = left (right-aligned), lr = left of the rightmost dot, r = right, t = above,
 * b = below, bl = below-left (right-aligned). */
export type LabelMode = "l" | "lr" | "r" | "t" | "b" | "bl";

export interface Station {
  id: string;
  name: string;
  name_he: string;
  gtfs_stop_id: number | null;
  lon: number;
  lat: number;
  label: LabelMode;
}

export interface Line {
  id: string;
  name: string;
  color: string;
  night: boolean;
  inactive: boolean;
  /** station ids in drawing order */
  stops: string[];
}

/** One dot on the schematic: a station as drawn on one line. */
export interface Copy {
  id: string; // `${station}.${line}`
  station: string;
  line: string;
  circle: number;
  /** schematic position, image pixels, y down */
  sx: number;
  sy: number;
}

export interface Network {
  meta: { title: string; sources: Record<string, string>; units: string };
  stations: Station[];
  lines: Line[];
  copies: Copy[];
}

export type Ring = [number, number][];

export interface Basemap {
  land: Ring[];
  lakes: Ring[];
  urban: Ring[];
  rivers: Ring[];
  roads: { c: Ring; k: string }[];
}

export type Lang = "en" | "he";

/** A city or town from OpenStreetMap (public/data/places.json, pipeline/osm_places.py). */
export interface Place { id: number; en: string | null; he: string | null; lon: number; lat: number; city: boolean; pop: number | null }

/** Real track geometry per pair of consecutive stations (pipeline/osm_tracks.py).
 * Key "A|B" with A < B alphabetically; coordinates run from A to B. */
export interface Tracks {
  source: string;
  osm_base?: string | null;
  segments: Record<string, { km: number; c: Ring }>;
}
