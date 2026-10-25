// UTC calendar days as `YYYY-MM-DD` strings, for daily puzzles (PRD FR-22). Days switch at
// 00:00 UTC, which has no daylight saving, so every day is 24 hours long.

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day that contains `ms`. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 00:00 UTC at the start of `day`, in milliseconds. */
export function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** The day `n` days after `day` (before it when `n` is negative). */
export function addDays(day: string, n: number): string {
  return utcDay(dayStart(day) + n * DAY_MS);
}

/** Whether `text` is a real calendar day written as `YYYY-MM-DD`. */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const start = dayStart(text);
  return !Number.isNaN(start) && utcDay(start) === text;
}

/**
 * The current streak (PRD FR-24): consecutive days, ending today, with a finished daily. A streak
 * that ended yesterday still counts until today is over, so it doesn't drop to 0 at midnight.
 */
export function streakLength(days: Iterable<string>, today: string): number {
  const set = new Set(days);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}
