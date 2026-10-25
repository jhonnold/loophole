import type { Clock, RateDecision, RateLimiter, RateRule } from "../ports.ts";

/** From this many keys on, ended windows are dropped, at most once per `PRUNE_EVERY_MS`. */
const PRUNE_AT = 10_000;
const PRUNE_EVERY_MS = 60_000;
/**
 * The most keys held at once. A new key past this is refused (fail closed), so a flood of distinct
 * emails or addresses can't grow the process's memory without bound.
 */
const MAX_KEYS = 100_000;

/**
 * Fixed-window counters in memory. Enough for the single API process; the counts reset when it
 * restarts.
 */
export class MemoryRateLimiter implements RateLimiter {
  readonly #clock: Clock;
  readonly #windows = new Map<string, { start: number; windowMs: number; count: number }>();
  #lastPruneAt = Number.NEGATIVE_INFINITY;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** How many keys are being counted. */
  get size(): number {
    return this.#windows.size;
  }

  hit(key: string, rule: RateRule): RateDecision {
    const now = this.#clock.now();
    if (this.#windows.size >= PRUNE_AT && now - this.#lastPruneAt >= PRUNE_EVERY_MS) {
      this.#lastPruneAt = now;
      this.#prune(now);
    }
    let w = this.#windows.get(key);
    if (w === undefined && this.#windows.size >= MAX_KEYS) {
      return { allowed: false, retryAfterMs: rule.windowMs };
    }
    if (w === undefined || now >= w.start + w.windowMs) {
      w = { start: now, windowMs: rule.windowMs, count: 0 };
      this.#windows.set(key, w);
    }
    w.count++;
    return w.count <= rule.limit
      ? { allowed: true }
      : { allowed: false, retryAfterMs: w.start + w.windowMs - now };
  }

  #prune(now: number): void {
    for (const [key, w] of this.#windows) {
      if (now >= w.start + w.windowMs) this.#windows.delete(key);
    }
  }
}
