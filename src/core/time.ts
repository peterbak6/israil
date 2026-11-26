// Dates and times in Israel time, whatever the device's time zone. Dates are "YYYYMMDD" strings (as in GTFS);
// times are minutes after midnight of a service day (they can pass 1440 for trains after midnight).

export const TZ = "Asia/Jerusalem";
export type Ymd = string;

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** Today's date in Israel and the time of day in minutes (with seconds as a fraction). */
export function israelNow(d: Date = new Date()): { date: Ymd; min: number } {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  return { date: p.year + p.month + p.day, min: +p.hour * 60 + +p.minute + +p.second / 60 };
}

const toDate = (ymd: Ymd) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
const fromDate = (d: Date): Ymd => d.toISOString().slice(0, 10).replace(/-/g, "");

export const addDays = (ymd: Ymd, n: number): Ymd => fromDate(new Date(toDate(ymd).getTime() + n * 86400000));
/** 0 = Monday … 6 = Sunday, as in the GTFS calendar columns. */
export const weekday = (ymd: Ymd) => (toDate(ymd).getUTCDay() + 6) % 7;

/** "08:07"; times past midnight wrap round ("25:10" is shown as "01:10"). */
export function fmtTime(min: number): string {
  const m = ((Math.floor(min) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

/** "41 min", "1 h 05 min". */
export function fmtDur(min: number): string {
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Thu 26 Nov" */
export const fmtDay = (ymd: Ymd) => `${DAYS[weekday(ymd)]} ${+ymd.slice(6, 8)} ${MONTHS[+ymd.slice(4, 6) - 1]}`;
