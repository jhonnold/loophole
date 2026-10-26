// Names, colours and dates for daily puzzles (PRD FR-22). Days are UTC days, `YYYY-MM-DD`.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The daily size classes, smallest first. */
export const DAILY_SIZES = [7, 10, 20, 40];

/**
 * Display names of the daily size classes (Home artboard). The artboard's "Medium" for 10×10 is
 * "Regular" here, since Medium is also a level (DECISIONS, WT21).
 */
const SIZE_NAMES: Record<number, string> = { 7: "Small", 10: "Regular", 20: "Large", 40: "Giant" };

/** "Small" for 7, … ; "15×15" for a size without a name. */
export function sizeName(size: number): string {
  return SIZE_NAMES[size] ?? `${size}×${size}`;
}

/**
 * Pale cover tint per size class (design kit, Colour): Sakura, Kinari, Sora, Wakaba. The same in
 * both themes; text on covers is always ink.
 */
export function coverTint(width: number): string {
  if (width <= 7) return "#F2C4CE";
  if (width <= 10) return "#E8DFC4";
  if (width <= 20) return "#C8DAE6";
  return "#D5E3C2";
}

/** The UTC day that contains `ms`. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Milliseconds from `ms` to the next 00:00 UTC, when new daily puzzles come out. */
export function msToNextDay(ms: number): number {
  return DAY_MS - (((ms % DAY_MS) + DAY_MS) % DAY_MS);
}

/**
 * Whether Home should ask for today's daily set again (at most every 30 s): the server couldn't be
 * reached (`null`), this device's clock says the next day has started, or a size class isn't ready
 * yet (a slow or failed generation). `undefined` means the first answer hasn't come back.
 */
export function dailyRefreshDue(
  set: { nextAt: string; puzzles: readonly { puzzleId: string | null }[] } | null | undefined,
  now: number,
): boolean {
  if (set === undefined) return false;
  if (set === null) return true;
  return now >= Date.parse(set.nextAt) || set.puzzles.some((p) => p.puzzleId === null);
}

/** "5h 12m" from an hour up, "12m 05s" below. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

const JP_WEEKDAYS = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

function date(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** "日曜日 · Sunday 25 October" (Home artboard). */
export function dayHeading(day: string): string {
  const d = date(day);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const rest = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  return `${JP_WEEKDAYS[d.getUTCDay()]} · ${weekday} ${rest}`;
}

/** "25 Oct". */
export function shortDay(day: string): string {
  return date(day).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "M", "T", "W", … for the streak strip. */
export function weekdayLetter(day: string): string {
  return "SMTWTFS"[date(day).getUTCDay()];
}

/** The play page of a daily puzzle. */
export function dailyPath(day: string, size: number): string {
  return `/daily/${day}/${size}`;
}

/** The second header line of a daily: "Daily · 25 Oct · 今日の問題" on its day. */
export function dailySubtitle(day: string, live: boolean): string {
  return live ? `Daily · ${shortDay(day)} · 今日の問題` : `Daily · ${shortDay(day)}`;
}
