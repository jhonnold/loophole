/**
 * A pausable stopwatch as plain data. `now` is passed in (milliseconds, e.g. `performance.now()` or
 * `Date.now()`), so the functions are pure and easy to test.
 */
export interface Stopwatch {
  /** Time banked from earlier running spans. */
  readonly bankedMs: number;
  /** When the current running span started, or null while stopped. */
  readonly since: number | null;
}

export function createStopwatch(bankedMs = 0): Stopwatch {
  return { bankedMs: Math.max(0, bankedMs), since: null };
}

export function isRunning(w: Stopwatch): boolean {
  return w.since !== null;
}

export function start(w: Stopwatch, now: number): Stopwatch {
  return w.since === null ? { bankedMs: w.bankedMs, since: now } : w;
}

export function stop(w: Stopwatch, now: number): Stopwatch {
  return w.since === null ? w : { bankedMs: elapsed(w, now), since: null };
}

export function elapsed(w: Stopwatch, now: number): number {
  return w.since === null ? w.bankedMs : w.bankedMs + Math.max(0, now - w.since);
}

/** `mm:ss` below an hour, `h:mm:ss` from an hour up. Rounds down to whole seconds. */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
