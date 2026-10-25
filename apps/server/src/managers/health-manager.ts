import { GENERATOR_VERSION } from "@loophole/core";
import type { Job } from "../domain.ts";
import type { BlobStore, Clock, DailyRepository, JobQueue } from "../ports.ts";
import { stockedDays } from "./daily-stock-manager.ts";
import { utcDay } from "./days.ts";

/** One dependency's check. */
export interface Check {
  readonly ok: boolean;
  /** How long the check took, in milliseconds. */
  readonly ms: number;
  /** Why it failed; null when it passed. Only admins see it. */
  readonly error: string | null;
}

/** Whether the API can serve requests: its database and blob store answer. */
export interface Readiness {
  readonly ok: boolean;
  readonly database: Check;
  readonly blobs: Check;
}

/** Which build is running. */
export interface Versions {
  /** The app's version (the git commit in a production image), or "dev". */
  readonly app: string;
  readonly generator: string;
  readonly runtime: string;
}

/** What the admin health page shows (PRD §5: admins view system health). */
export interface HealthReport {
  readonly readiness: Readiness;
  readonly jobs: { queued: number; running: number; oldestQueuedAt: number | null };
  /** For each daily size class, how many days in a row from today on are generated. */
  readonly dailies: readonly { size: number; days: number }[];
  /** The latest failed and timed-out jobs, newest first. */
  readonly failures: readonly Job[];
  readonly versions: Versions;
  readonly startedAt: number;
}

export interface HealthManagerDeps {
  readonly jobs: JobQueue;
  readonly dailies: DailyRepository;
  readonly blobs: BlobStore;
  readonly clock: Clock;
  /** The worker's `DAILY_DAYS_AHEAD`: how many days, today included, it keeps generated. */
  readonly daysAhead: number;
  readonly versions: Omit<Versions, "generator">;
  /** A check that takes longer than this fails. */
  readonly checkTimeoutMs: number;
}

/** A blob key nobody writes: reading it proves the store answers without changing anything. */
const PROBE_KEY = "health/probe";
const FAILURES_SHOWN = 10;

/** Health checks for container orchestration and the admins' health page. */
export class HealthManager {
  readonly #deps: HealthManagerDeps;
  readonly #startedAt: number;

  constructor(deps: HealthManagerDeps) {
    this.#deps = deps;
    this.#startedAt = deps.clock.now();
  }

  /** Checks the database and the blob store. */
  async readiness(): Promise<Readiness> {
    const { jobs, blobs } = this.#deps;
    const [database, blobCheck] = await Promise.all([
      this.#check(async () => {
        jobs.countActive();
      }),
      this.#check(async () => {
        await blobs.get(PROBE_KEY);
      }),
    ]);
    return { ok: database.ok && blobCheck.ok, database, blobs: blobCheck };
  }

  /** Readiness plus the queue, the daily stock, recent failures and versions. */
  async report(): Promise<HealthReport> {
    const { jobs, dailies, clock, daysAhead, versions } = this.#deps;
    const readiness = await this.readiness();
    const safe = <T>(read: () => T, fallback: T): T => {
      try {
        return read();
      } catch {
        return fallback;
      }
    };
    return {
      readiness,
      jobs: safe(() => jobs.countActive(), { queued: 0, running: 0, oldestQueuedAt: null }),
      dailies: safe(() => stockedDays(dailies, utcDay(clock.now()), daysAhead), []),
      failures: safe(() => jobs.listFailed(FAILURES_SHOWN), []),
      versions: { ...versions, generator: GENERATOR_VERSION },
      startedAt: this.#startedAt,
    };
  }

  async #check(run: () => Promise<void>): Promise<Check> {
    const { clock, checkTimeoutMs } = this.#deps;
    const started = clock.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`No answer within ${checkTimeoutMs} ms`)),
        checkTimeoutMs,
      );
    });
    try {
      await Promise.race([run(), timeout]);
      return { ok: true, ms: clock.now() - started, error: null };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, ms: clock.now() - started, error };
    } finally {
      clearTimeout(timer);
    }
  }
}
